import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import {
  AccountType,
  Clause,
  ClauseRedline,
  ClauseReviewStatus,
  ClauseSource,
  ContractClause,
  ContractVersionEventType,
  RedlineAuthorIdentitySource,
  RedlineStatus,
} from '../../database/entities';
import { ContractsService } from '../contracts/contracts.service';
import {
  ContractAccessService,
  ManagingOrGuestCaller,
} from '../contracts/services/contract-access.service';
import { assertContractMutable } from '../contracts/utils/contract-pin-guard.util';
import {
  AcceptRedlineDto,
  CounterRedlineDto,
  ProposeRedlineDto,
  RejectRedlineDto,
} from './dto/redline.dto';

/** Coded 409 envelopes — the CONTRACT_PINNED / GUEST_UPLOAD_DAILY_LIMIT precedent. */
export const STALE_REDLINE_ERROR = 'STALE_REDLINE';
export const REDLINE_NOT_PROPOSED_ERROR = 'REDLINE_NOT_PROPOSED';

/**
 * Internal marker thrown INSIDE the accept transaction on a staleness hit so
 * the txn rolls back cleanly; caught outside, where the STALE flip is
 * persisted NON-transactionally (a rollback must not undo the STALE marker)
 * and re-surfaced as the coded 409.
 */
class StaleRedlineMarker extends Error {
  constructor(public readonly redlineId: string) {
    super('stale redline');
  }
}

/** The scrubbed list row — mirrors the guest comment-read author projection. */
export interface RedlineListRow {
  id: string;
  contract_id: string;
  contract_clause_id: string;
  round: number;
  parent_redline_id: string | null;
  status: RedlineStatus;
  proposed_title: string | null;
  proposed_content: string;
  note: string | null;
  base_content_snapshot: string;
  decided_at: Date | null;
  decision_note: string | null;
  resulting_version_id: string | null;
  resulting_clause_id: string | null;
  created_at: Date;
  author_name: string;
  author_role: 'TEAM' | 'GUEST';
  is_author: boolean;
}

/**
 * 7.19 Slice 1 — the counterparty redlining spine (Model A).
 *
 * The negotiation loop for CLAUSE-LEVEL BLOCK-REPLACE proposals:
 * counterparty PROPOSES a full new clause body → host ACCEPTS / REJECTS /
 * COUNTERS / the author WITHDRAWS. Accepting resolves INTO the existing
 * version model — snapshot-BEFORE-promote + the parent-chain promotion,
 * REPLICATING ContractsService.applyProposedVersion's mechanics in a focused
 * single-clause path (the RiskRephraseService precedent: that entry point is
 * document-scoped and stays byte-untouched; the MODEL is reused, not the
 * function).
 *
 * Access shape (the standing invariants):
 *  - propose / list / withdraw → findAccessibleContract (org-first →
 *    binding-fallback; the binding is the SOLE cross-org grant; the caller's
 *    organization_id is NEVER read on the binding path; every denial is a
 *    uniform 404).
 *  - accept / reject / counter → findInOrg (HOST-ORG ONLY — clause mutations
 *    execute host-side; a counterparty "accept" of a host counter is a later
 *    slice's SIGNAL, never a cross-org clause write).
 *  - assertContractMutable ALWAYS runs AFTER the access wall (cross-org stays
 *    404 first; CONTRACT_PINNED 409 never becomes an existence oracle).
 *
 * Concurrency posture (Slice 1): every status transition is a CONDITIONAL
 * UPDATE keyed on status = PROPOSED (affected-rows gate, lesson #149's
 * discipline) — two racing deciders resolve to exactly one winner for the
 * FLIP itself. A full row-lock (SELECT … FOR UPDATE) around the accept's
 * read-then-promote span is a known follow-up; the in-txn conditional flip
 * covers the common case.
 */
@Injectable()
export class RedlineService {
  private readonly logger = new Logger(RedlineService.name);

  constructor(
    @InjectRepository(ClauseRedline) // lint-exempt: wall-protected (findAccessibleContract/findInOrg run first on every entry point); redline rows are loaded by id AND contract_id after the wall
    private readonly redlineRepo: Repository<ClauseRedline>,
    @InjectRepository(ContractClause) // lint-exempt: wall-protected (findAccessibleContract/findInOrg); chokepoint migration scheduled (ContractClause has no scoped repo)
    private readonly ccRepo: Repository<ContractClause>,
    private readonly contractAccess: ContractAccessService,
    private readonly contractsService: ContractsService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // PROPOSE — either bound party (org-first → binding-fallback)
  // ────────────────────────────────────────────────────────────────────────
  async propose(
    contractId: string,
    contractClauseId: string,
    dto: ProposeRedlineDto,
    caller: ManagingOrGuestCaller,
  ): Promise<ClauseRedline> {
    // WALL first — own-org OR binding; anything else is a uniform 404.
    const contract = await this.contractAccess.findAccessibleContract(
      contractId,
      caller,
    );
    // PIN second (after the wall — 404 before 409, no existence oracle). A
    // signed contract's legal content is frozen; proposing against it is
    // rejected up front rather than farming doomed STALE/409 accepts.
    await assertContractMutable(this.redlineRepo.manager, contract);

    const cc = await this.resolveLiveJunction(
      this.redlineRepo.manager,
      contractId,
      contractClauseId,
    );

    const redline = this.redlineRepo.create({
      contract_id: contractId,
      contract_clause_id: cc.id,
      round: 1,
      parent_redline_id: null,
      proposed_title: dto.proposedTitle ?? null,
      proposed_content: dto.proposedContent,
      note: dto.note ?? null,
      // Diff base + staleness guard: the ACTIVE body the author actually saw.
      base_content_snapshot: cc.clause.content,
      author_user_id: caller.id,
      author_identity_source: this.identitySourceOf(caller),
      status: RedlineStatus.PROPOSED,
    });
    return this.redlineRepo.save(redline); // lint-exempt: wall-protected (findAccessibleContract) — contract validated before write
  }

  // ────────────────────────────────────────────────────────────────────────
  // LIST — either bound party; author projection scrubbed
  // ────────────────────────────────────────────────────────────────────────
  async list(
    contractId: string,
    caller: ManagingOrGuestCaller,
    filters: { status?: string; contractClauseId?: string } = {},
  ): Promise<RedlineListRow[]> {
    const contract = await this.contractAccess.findAccessibleContract(
      contractId,
      caller,
    );
    const hostOrgId = contract?.project?.organization_id ?? null;

    // EXPLICIT raw select — the author's email / role / org id are never
    // projected (mirrors readGuestVisibleComments: display name + TEAM/GUEST
    // flag only; the flag keys on HOST-org membership, not account_type —
    // a managing counterparty acting via a binding is EXTERNAL, never TEAM).
    const qb = this.redlineRepo // lint-exempt: wall-protected (findAccessibleContract) — list scoped to the walled contract id
      .createQueryBuilder('cr')
      .leftJoin('cr.author', 'author')
      .select('cr.id', 'id')
      .addSelect('cr.contract_id', 'contract_id')
      .addSelect('cr.contract_clause_id', 'contract_clause_id')
      .addSelect('cr.round', 'round')
      .addSelect('cr.parent_redline_id', 'parent_redline_id')
      .addSelect('cr.status', 'status')
      .addSelect('cr.proposed_title', 'proposed_title')
      .addSelect('cr.proposed_content', 'proposed_content')
      .addSelect('cr.note', 'note')
      .addSelect('cr.base_content_snapshot', 'base_content_snapshot')
      .addSelect('cr.decided_at', 'decided_at')
      .addSelect('cr.decision_note', 'decision_note')
      .addSelect('cr.resulting_version_id', 'resulting_version_id')
      .addSelect('cr.resulting_clause_id', 'resulting_clause_id')
      .addSelect('cr.created_at', 'created_at')
      .addSelect('cr.author_user_id', 'author_user_id')
      .addSelect('author.first_name', 'author_first_name')
      .addSelect('author.last_name', 'author_last_name')
      .addSelect('author.account_type', 'author_account_type')
      .addSelect('author.organization_id', 'author_org_id')
      .where('cr.contract_id = :contractId', { contractId })
      .orderBy('cr.created_at', 'DESC');

    if (filters.status) {
      qb.andWhere('cr.status = :status', { status: filters.status });
    }
    if (filters.contractClauseId) {
      qb.andWhere('cr.contract_clause_id = :ccId', {
        ccId: filters.contractClauseId,
      });
    }

    const rows = await qb.getRawMany<{
      id: string;
      contract_id: string;
      contract_clause_id: string;
      round: number;
      parent_redline_id: string | null;
      status: RedlineStatus;
      proposed_title: string | null;
      proposed_content: string;
      note: string | null;
      base_content_snapshot: string;
      decided_at: Date | null;
      decision_note: string | null;
      resulting_version_id: string | null;
      resulting_clause_id: string | null;
      created_at: Date;
      author_user_id: string | null;
      author_first_name: string | null;
      author_last_name: string | null;
      author_account_type: AccountType | null;
      author_org_id: string | null;
    }>();

    return rows.map((r): RedlineListRow => {
      const isTeam =
        r.author_account_type !== AccountType.GUEST &&
        r.author_org_id != null &&
        r.author_org_id === hostOrgId;
      const name = [r.author_first_name, r.author_last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      return {
        id: r.id,
        contract_id: r.contract_id,
        contract_clause_id: r.contract_clause_id,
        round: Number(r.round),
        parent_redline_id: r.parent_redline_id ?? null,
        status: r.status,
        proposed_title: r.proposed_title ?? null,
        proposed_content: r.proposed_content,
        note: r.note ?? null,
        base_content_snapshot: r.base_content_snapshot,
        decided_at: r.decided_at ?? null,
        decision_note: r.decision_note ?? null,
        resulting_version_id: r.resulting_version_id ?? null,
        resulting_clause_id: r.resulting_clause_id ?? null,
        created_at: r.created_at,
        author_name: name || (isTeam ? 'SIGN Team' : 'Guest'),
        author_role: isTeam ? 'TEAM' : 'GUEST',
        is_author: r.author_user_id != null && r.author_user_id === caller.id,
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // ACCEPT — HOST-ORG ONLY; snapshot-BEFORE-promote, atomic
  // ────────────────────────────────────────────────────────────────────────
  async accept(
    contractId: string,
    redlineId: string,
    caller: ManagingOrGuestCaller,
    dto: AcceptRedlineDto,
  ): Promise<ClauseRedline> {
    // HOST wall — own-org only (a bound counterparty gets the same uniform
    // 404 findInOrg gives any cross-org caller; never a 403).
    const contract = await this.hostContract(contractId, caller);

    const redline = await this.loadRedline(contractId, redlineId);
    this.assertProposed(redline);

    let promotedClauseId: string | null = null;
    let versionId: string | null = null;

    try {
      await this.redlineRepo.manager.transaction(async (manager) => {
        // a. PIN — after the wall, inside the txn (the freeze must hold for
        //    the whole promote span).
        await assertContractMutable(manager, contract);

        // b. STALENESS — re-resolve the CURRENT active body; a mismatch with
        //    what the author saw means someone changed the clause since
        //    propose-time → the redline dies STALE, nothing mutates.
        const cc = await this.resolveLiveJunction(
          manager,
          contractId,
          redline.contract_clause_id,
        );
        const original = cc.clause;
        if (original.content !== redline.base_content_snapshot) {
          throw new StaleRedlineMarker(redline.id);
        }

        // c. Final content/title + review status (applyProposedVersion's
        //    accept-vs-edit semantic).
        const finalContent = dto.editedContent ?? redline.proposed_content;
        const finalTitle =
          dto.editedTitle ?? redline.proposed_title ?? original.title;
        const reviewStatus = dto.editedContent
          ? ClauseReviewStatus.EDITED
          : ClauseReviewStatus.APPROVED;

        // d. SNAPSHOT-BEFORE — the recoverable "before" rides the SAME txn
        //    (applyProposedVersion's exact ordering; a later throw rolls the
        //    snapshot back with the promotion — all-or-nothing).
        const version = await this.contractsService.createVersionSnapshot(
          contractId,
          caller.id,
          this.acceptSummary(cc, dto),
          { eventType: ContractVersionEventType.EDITED },
          manager,
        );
        versionId = version.id;

        // e. PROMOTE — the parent-chain mechanics, replicated (NOT extracted)
        //    from applyProposedVersion's replaces-branch.
        const clauseRepo = manager.getRepository(Clause);
        const newClause = clauseRepo.create({
          organization_id: original.organization_id,
          title: finalTitle,
          content: finalContent,
          clause_type: original.clause_type,
          version: (original.version ?? 1) + 1,
          parent_clause_id: original.id,
          is_active: true,
          source: ClauseSource.COUNTERPARTY_REDLINE,
          source_document_id: null,
          confidence_score: null,
          review_status: reviewStatus,
          reviewed_by: caller.id,
          reviewed_at: new Date(),
          // Provenance: the counterparty authored the content; the host
          // (reviewed_by) executed the promotion.
          created_by: redline.author_user_id ?? caller.id,
        });
        await clauseRepo.save(newClause);
        promotedClauseId = newClause.id;

        // Retire the original clause version.
        original.is_active = false;
        await clauseRepo.save(original);

        // Repoint the LIVE junction at the new clause — a column UPDATE, not
        // save(): cc has its `clause` relation loaded (the original), and
        // save() would derive the FK from that stale relation object and
        // silently revert the repoint (applyProposedVersion's exact note).
        await manager.getRepository(ContractClause).update( // lint-exempt: wall-protected (findInOrg) txn-bound repo; junction id resolved under the wall
          { id: cc.id },
          { clause_id: newClause.id },
        );

        // f. Flip the redline — CONDITIONAL on status = PROPOSED so two
        //    racing accepts resolve to exactly one winner; a lost race rolls
        //    the whole txn back (no orphan version, no double-promote).
        const flip = await manager.getRepository(ClauseRedline).update(
          { id: redline.id, status: RedlineStatus.PROPOSED },
          {
            status: RedlineStatus.ACCEPTED,
            decided_by_user_id: caller.id,
            decided_at: new Date(),
            decision_note: dto.note ?? null,
            resulting_version_id: version.id,
            resulting_clause_id: newClause.id,
          },
        );
        if (flip.affected !== 1) {
          throw this.notProposedConflict();
        }
      });
    } catch (err) {
      if (err instanceof StaleRedlineMarker) {
        // Persist STALE OUTSIDE the rolled-back txn (conditional — only if
        // still PROPOSED, so a racing decision is never clobbered), then
        // surface the coded 409. The txn rollback already guaranteed: no
        // version row, no clause flip, no junction move.
        await this.redlineRepo.update( // lint-exempt: wall-protected (findInOrg) — row loaded by id+contract under the wall
          { id: err.redlineId, status: RedlineStatus.PROPOSED },
          { status: RedlineStatus.STALE },
        );
        throw new ConflictException({
          statusCode: 409,
          error: STALE_REDLINE_ERROR,
          message:
            'The clause has changed since this redline was proposed. The ' +
            'redline is now stale — re-propose against the current text.',
        });
      }
      throw err;
    }

    this.logger.log(
      `redline.accepted contract=${contractId} redline=${redlineId} ` +
        `version=${versionId} clause=${promotedClauseId}`,
    );
    return this.reloadRedline(redlineId);
  }

  // ────────────────────────────────────────────────────────────────────────
  // REJECT — HOST-ORG ONLY; no clause mutation, no pin guard
  // ────────────────────────────────────────────────────────────────────────
  async reject(
    contractId: string,
    redlineId: string,
    caller: ManagingOrGuestCaller,
    dto: RejectRedlineDto,
  ): Promise<ClauseRedline> {
    await this.hostContract(contractId, caller);
    const redline = await this.loadRedline(contractId, redlineId);
    this.assertProposed(redline);

    const flip = await this.redlineRepo.update( // lint-exempt: wall-protected (findInOrg) — row loaded by id+contract under the wall
      { id: redline.id, status: RedlineStatus.PROPOSED },
      {
        status: RedlineStatus.REJECTED,
        decided_by_user_id: caller.id,
        decided_at: new Date(),
        decision_note: dto.note ?? null,
      },
    );
    if (flip.affected !== 1) {
      throw this.notProposedConflict();
    }
    return this.reloadRedline(redlineId);
  }

  // ────────────────────────────────────────────────────────────────────────
  // COUNTER — HOST-ORG ONLY; original → COUNTERED, child PROPOSED round+1
  // ────────────────────────────────────────────────────────────────────────
  async counter(
    contractId: string,
    redlineId: string,
    caller: ManagingOrGuestCaller,
    dto: CounterRedlineDto,
  ): Promise<ClauseRedline> {
    const contract = await this.hostContract(contractId, caller);
    const redline = await this.loadRedline(contractId, redlineId);
    this.assertProposed(redline);
    // PIN after the wall — a counter proposes future clause-content change on
    // a frozen contract; reject it up front.
    await assertContractMutable(this.redlineRepo.manager, contract);

    let childId = '';
    await this.redlineRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ClauseRedline);

      // Conditional flip first — exactly one counter wins a race.
      const flip = await repo.update(
        { id: redline.id, status: RedlineStatus.PROPOSED },
        {
          status: RedlineStatus.COUNTERED,
          decided_by_user_id: caller.id,
          decided_at: new Date(),
        },
      );
      if (flip.affected !== 1) {
        throw this.notProposedConflict();
      }

      // FRESH base snapshot — the counter is measured against the CURRENT
      // body, not the original round's base.
      const cc = await this.resolveLiveJunction(
        manager,
        contractId,
        redline.contract_clause_id,
      );

      const child = repo.create({
        contract_id: contractId,
        contract_clause_id: redline.contract_clause_id,
        round: redline.round + 1,
        parent_redline_id: redline.id,
        proposed_title: dto.proposedTitle ?? null,
        proposed_content: dto.proposedContent,
        note: dto.note ?? null,
        base_content_snapshot: cc.clause.content,
        author_user_id: caller.id,
        author_identity_source: this.identitySourceOf(caller),
        status: RedlineStatus.PROPOSED,
      });
      const saved = await repo.save(child);
      childId = saved.id;
    });

    // The child awaits the counterparty's response — counterparty-side accept
    // is DEFERRED (a later slice's signal path); in Slice 1 it sits PROPOSED.
    return this.reloadRedline(childId);
  }

  // ────────────────────────────────────────────────────────────────────────
  // WITHDRAW — author only (either party); no clause mutation, no pin guard
  // ────────────────────────────────────────────────────────────────────────
  async withdraw(
    contractId: string,
    redlineId: string,
    caller: ManagingOrGuestCaller,
  ): Promise<ClauseRedline> {
    await this.contractAccess.findAccessibleContract(contractId, caller);
    const redline = await this.loadRedline(contractId, redlineId);
    // Author-only — a non-author gets the SAME NotFound as an unknown id
    // (no existence oracle on who authored what).
    if (redline.author_user_id !== caller.id) {
      throw new NotFoundException('Redline not found');
    }
    this.assertProposed(redline);

    const flip = await this.redlineRepo.update( // lint-exempt: wall-protected (findAccessibleContract) — row loaded by id+contract under the wall
      { id: redline.id, status: RedlineStatus.PROPOSED },
      { status: RedlineStatus.WITHDRAWN },
    );
    if (flip.affected !== 1) {
      throw this.notProposedConflict();
    }
    return this.reloadRedline(redlineId);
  }

  // ────────────────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────────────────

  /**
   * HOST wall — own-org only. A caller with no org (pure guest) or the wrong
   * org gets the same uniform 404 findInOrg gives any cross-org caller. The
   * caller's organization_id is read HERE ONLY because this is the OWN-ORG
   * path (decision authority), never a binding path (standing invariant 3).
   */
  private async hostContract(contractId: string, caller: ManagingOrGuestCaller) {
    if (!caller.organization_id) {
      throw new NotFoundException('Contract not found');
    }
    return this.contractAccess.findInOrg(contractId, caller.organization_id);
  }

  /**
   * Resolve the LIVE junction row (is_proposed = false) + its current clause
   * for this contract. The contract_id predicate is the IDOR guard — a
   * junction belonging to another contract 404s without existing-elsewhere
   * leakage.
   */
  private async resolveLiveJunction(
    manager: EntityManager,
    contractId: string,
    contractClauseId: string,
  ): Promise<ContractClause & { clause: Clause }> {
    const cc = await manager.getRepository(ContractClause).findOne({ // lint-exempt: wall-protected (findAccessibleContract/findInOrg) — contract validated before this contract_id-scoped read
      where: {
        id: contractClauseId,
        contract_id: contractId,
        is_proposed: false,
      },
      relations: ['clause'],
    });
    if (!cc || !cc.clause) {
      throw new NotFoundException('Clause not found');
    }
    return cc as ContractClause & { clause: Clause };
  }

  /** Load a redline scoped to the walled contract (IDOR guard); 404 otherwise. */
  private async loadRedline(
    contractId: string,
    redlineId: string,
  ): Promise<ClauseRedline> {
    const redline = await this.redlineRepo.findOne({ // lint-exempt: wall-protected (findAccessibleContract/findInOrg) — contract validated before this contract_id-scoped read
      where: { id: redlineId, contract_id: contractId },
    });
    if (!redline) {
      throw new NotFoundException('Redline not found');
    }
    return redline;
  }

  private async reloadRedline(redlineId: string): Promise<ClauseRedline> {
    const redline = await this.redlineRepo.findOne({ // lint-exempt: wall-protected — reload of a row already walled + acted on in this request
      where: { id: redlineId },
    });
    if (!redline) {
      // Only reachable via a concurrent hard-delete (contract cascade).
      throw new NotFoundException('Redline not found');
    }
    return redline;
  }

  private assertProposed(redline: ClauseRedline): void {
    if (redline.status !== RedlineStatus.PROPOSED) {
      throw this.notProposedConflict(redline.status);
    }
  }

  private notProposedConflict(current?: RedlineStatus): ConflictException {
    return new ConflictException({
      statusCode: 409,
      error: REDLINE_NOT_PROPOSED_ERROR,
      message: current
        ? `This redline is ${current} — only a PROPOSED redline can be acted on.`
        : 'This redline was already decided — only a PROPOSED redline can be acted on.',
    });
  }

  private identitySourceOf(
    caller: ManagingOrGuestCaller,
  ): RedlineAuthorIdentitySource {
    // Slice 1 traffic is Model A managing counterparties; recorded honestly
    // if an established-identity GUEST account (admitted by its binding via
    // the same wall) ever proposes here.
    return caller.account_type === AccountType.GUEST
      ? RedlineAuthorIdentitySource.GUEST
      : RedlineAuthorIdentitySource.MANAGING_USER;
  }

  private acceptSummary(
    cc: ContractClause,
    dto: AcceptRedlineDto,
  ): string {
    const clauseRef = cc.section_number ? ` — clause ${cc.section_number}` : '';
    const how = dto.editedContent ? 'accepted with host edits' : 'accepted';
    return `Counterparty redline ${how}${clauseRef}`;
  }
}
