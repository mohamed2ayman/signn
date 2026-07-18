import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  AccountType,
  Clause,
  ClauseReviewStatus,
  Contract,
  ContractClause,
  ContractStatus,
  Project,
  UserRole,
} from '../../../database/entities';
import { ContractVersionEventType } from '../../../database/entities/contract-version.entity';
import { ContractsService } from '../../contracts/contracts.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Feature #8d — "Import to my workspace": copy a shared contract into the
 * IMPORTER's own org.
 *
 * A real (MANAGING) customer viewing a contract another org shared with them
 * (a `guest_contract_access` binding — the #8b Shared-with-me → shared-viewer
 * flow) imports a COPY into a project THEY pick, so they can run their own
 * risk analysis / comments / obligations. The original stays with the sharing
 * org — untouched and un-notified.
 *
 * The FOUR locked invariants:
 *
 *   1. PERMISSION = BINDING-ALONE. Import is authorized PURELY by holding a
 *      guest_contract_access binding to the source contract — the same wall
 *      as the viewer. `assertGuestContractAccess` runs FIRST (not the
 *      org-first `findAccessibleContract` dispatch, which would admit an
 *      own-org manager WITHOUT a binding). Every denial is a uniform 404
 *      (standing invariant 2 — no existence oracle). A revoked binding at
 *      call time → the same clean 404, nothing copied.
 *
 *   2. THE COPY SOURCE IS THE GUEST-SCOPED READ. The content is read via
 *      `findAccessibleContract` — the exact wall+shape the guest viewer
 *      renders: contract scalars + LIVE clauses (`is_proposed = false`) only.
 *      Comments (incl. internal notes), risk findings, obligations, versions,
 *      documents, and T0c contract_parties rows are never even loaded, so the
 *      copy STRUCTURALLY cannot contain anything the guest couldn't already
 *      see. Never replace this with a privileged read (findInOrg / bare repo).
 *
 *   3. THE COPY IS ATOMIC. New contract + fresh Clause rows + fresh
 *      ContractClause junctions + the initial version snapshot commit in ONE
 *      transaction — any failure mid-copy rolls back EVERYTHING (no orphan
 *      contract, no partial clause set).
 *
 *   4. THE SOURCE IS UNTOUCHED. This path writes ONLY new rows in the
 *      importer's org. Fresh Clause rows are minted (`clauses` rows carry
 *      organization_id and are shareable across contracts — reusing the
 *      source clause_id would cross-link tenants); `source_document_id` is
 *      NOT carried over (the source's DocumentUpload rows belong to the
 *      source org's storage and are not guest-visible). No notification is
 *      sent to the sharing org (the design promises "not modified or
 *      notified").
 *
 * Deliberately NOT here (v1):
 *   - No plan/quota gate — no per-org contract-count limit exists in the
 *     plan model (only the dead, org-blind SubscriptionGuard; CLAUDE.md).
 *     Do NOT invent one; the design's "plan limit" failure state is
 *     unreachable until a real quota model ships.
 *   - No metering — no meter_definition exists for import; a copy is a pure
 *     DB write in the importer's own workspace. Any AI re-analysis the
 *     importer later runs is metered on THEIR org through the normal paths.
 *   - No link back to the source (pure one-time snapshot — the copy does not
 *     stay in sync; `creation_flow = 'IMPORT'` is the only provenance marker).
 */
@Injectable()
export class GuestImportService {
  private readonly logger = new Logger(GuestImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly contractAccess: ContractAccessService,
    private readonly contractsService: ContractsService,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
  ) {}

  async importSharedContract(params: {
    contractId: string;
    caller: {
      id: string;
      organization_id?: string | null;
      role?: UserRole | null;
      account_type?: AccountType | null;
    };
    destinationProjectId: string;
  }): Promise<{ id: string; name: string; project_id: string }> {
    const { contractId, caller, destinationProjectId } = params;

    // (1) BINDING-ALONE gate — 404 unless a guest_contract_access row binds
    // THIS caller to THIS contract. Runs before anything else so a revoked
    // (or never-granted) binding can never reach the copy. Uniform 404.
    await this.contractAccess.assertGuestContractAccess(contractId, caller.id);

    // (2) The guest-scoped SOURCE read — the same wall+shape the viewer
    // renders (live clauses only, no comments/risk/obligations/documents).
    // For a managing caller the org-first dispatch may serve an own-org
    // binding via findInOrg — identical read shape, same is_proposed=false
    // clause filter, so the copy source is guest-visible content either way.
    const source = await this.contractAccess.findAccessibleContract(
      contractId,
      {
        id: caller.id,
        organization_id: caller.organization_id ?? null,
        role: caller.role as UserRole,
        account_type: caller.account_type as AccountType,
      },
    );

    // (3) DESTINATION ownership — the project must belong to the CALLER'S
    // org. NOTE (standing invariant 3): reading caller.organization_id here
    // authorizes the DESTINATION workspace (their own org) — it is never the
    // source/metering subject, which invariant 3 forbids deriving from the
    // user row. A pure GUEST account (organization_id = null) has no
    // workspace to import into → the same uniform 404.
    if (!caller.organization_id) {
      throw new NotFoundException('Project not found');
    }
    const destination = await this.projectRepo.findOne({
      where: {
        id: destinationProjectId,
        organization_id: caller.organization_id,
      },
      select: ['id'],
    });
    if (!destination) {
      throw new NotFoundException('Project not found');
    }

    // (4) THE ATOMIC COPY — one transaction; any failure rolls back the
    // contract row, every clause, every junction, and the snapshot together.
    const importerOrgId = caller.organization_id;
    const newContractId = await this.dataSource.transaction(
      async (manager) => {
        const contractRepo = manager.getRepository(Contract); // lint-exempt: binding-walled (assertGuestContractAccess + guest-scoped read) txn-bound repo — import copy engine writes NEW rows in the importer's org only
        const clauseRepo = manager.getRepository(Clause); // lint-exempt: binding-walled (assertGuestContractAccess + guest-scoped read) txn-bound repo — fresh Clause rows minted in the importer's org
        const ccRepo = manager.getRepository(ContractClause); // lint-exempt: binding-walled (assertGuestContractAccess + guest-scoped read) txn-bound repo — fresh junctions for the new contract only

        // The new contract — EXPLICIT field mapping (this codebase never
        // spreads a source row into a create; lesson #231). Content scalars
        // are copied; ALL workflow state starts fresh:
        //   status DRAFT · version 1 · unsigned · unpinned · unapproved ·
        //   no relationship/parent (parent would point into the source org).
        const created = contractRepo.create({
          project_id: destinationProjectId,
          name: source.name,
          contract_type: source.contract_type,
          status: ContractStatus.DRAFT,
          current_version: 1,
          creation_flow: 'IMPORT',
          party_type: source.party_type,
          // The importer has not acknowledged any standard-form license —
          // never inherit the SOURCE org's acknowledgment.
          license_acknowledged: false,
          license_organization: source.license_organization ?? null,
          relationship_type: null,
          parent_contract_id: null,
          created_by: caller.id,
          party_first_name: source.party_first_name ?? null,
          party_second_name: source.party_second_name ?? null,
          contract_value: source.contract_value ?? null,
          currency: source.currency ?? null,
          start_date: source.start_date ?? null,
          end_date: source.end_date ?? null,
          effective_date: source.effective_date ?? null,
          expiry_date: source.expiry_date ?? null,
          notice_period_days: source.notice_period_days ?? null,
          defects_liability_period_days:
            source.defects_liability_period_days ?? null,
        });
        const saved = await contractRepo.save(created); // lint-exempt: binding-walled import copy — new row in the importer's org

        // Fresh clause rows + junctions. `source.contract_clauses` is the
        // wall's read: LIVE clauses only (is_proposed = false), sorted by
        // order_index. The `is_proposed` filter lives in the wall's JOIN —
        // re-assert it here as defense-in-depth.
        const sourceCcs = (source.contract_clauses ?? []).filter(
          (cc) => !cc.is_proposed && cc.clause,
        );
        for (const cc of sourceCcs) {
          const src = cc.clause;
          const newClause = await clauseRepo.save( // lint-exempt: binding-walled import copy — fresh Clause row in the importer's org
            clauseRepo.create({
              organization_id: importerOrgId,
              title: src.title,
              content: src.content,
              clause_type: src.clause_type,
              version: 1,
              // parent_clause_id omitted → NULL (no version chain yet).
              is_active: true,
              source: src.source,
              // NOT carried over: the source DocumentUpload belongs to the
              // source org's storage and is not guest-visible.
              source_document_id: null,
              confidence_score: src.confidence_score ?? null,
              review_status: ClauseReviewStatus.APPROVED,
              reviewed_by: null,
              reviewed_at: null,
              created_by: caller.id,
            }),
          );
          await ccRepo.save( // lint-exempt: binding-walled import copy — fresh junction for the new contract
            ccRepo.create({
              contract_id: saved.id,
              clause_id: newClause.id,
              section_number: cc.section_number ?? null,
              order_index: cc.order_index,
              is_proposed: false,
              customizations: cc.customizations ?? null,
            } as Partial<ContractClause>),
          );
        }

        // Initial V1 snapshot — same as create()'s CREATED event, inside the
        // SAME transaction (a mid-snapshot failure rolls the whole copy back).
        await this.contractsService.createVersionSnapshot(
          saved.id,
          caller.id,
          undefined,
          { eventType: ContractVersionEventType.CREATED },
          manager,
        );

        return saved.id;
      },
    );

    this.logger.log(
      `Guest import: contract ${contractId} copied to ${newContractId} ` +
        `(org ${importerOrgId}, project ${destinationProjectId}) by user ${caller.id}`,
    );

    return {
      id: newContractId,
      name: source.name,
      project_id: destinationProjectId,
    };
  }
}
