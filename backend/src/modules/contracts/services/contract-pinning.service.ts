import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  AuditLog,
  Contract,
  ContractClause,
  ContractStatus,
  ContractVersion,
  ContractVersionEventType,
  SignatureStatus,
} from '../../../database/entities';
import { ContractsService } from '../contracts.service';
import { ContractAccessService } from './contract-access.service';
import {
  buildPinPayload,
  computePinHash,
  PinPayload,
} from '../utils/canonical-pin.util';

/** The two doors through which a contract reaches FULLY_EXECUTED. */
export type PinDoor = 'DOCUSIGN_WEBHOOK' | 'MANUAL_MARK_SIGNED';

export interface PinResult {
  /** True when THIS call performed the pin (false = already pinned, no-op). */
  pinned: boolean;
  already_pinned: boolean;
  pinned_version_id: string;
  content_hash: string;
  pinned_at: Date;
}

/** Result of the pin-verification read path (Slice 2). */
export interface PinVerificationResult {
  pinned: boolean;
  /** null when not pinned; false = live content OR stored record drifted from the pinned hash. */
  valid: boolean | null;
  pinned_version_id: string | null;
  pinned_at: Date | null;
  pinned_content_hash: string | null;
  /** Canonical hash recomputed from the CURRENT live clauses + metadata. */
  live_hash: string | null;
  /** Canonical hash recomputed from the STORED pin payload (jsonb round-trip). */
  stored_payload_hash: string | null;
}

/**
 * Manual mark-signed preconditions: the contract must plausibly be in a
 * signable/circulating state. Clearly-not-ready states (still drafting or
 * mid-approval) and terminal states are rejected. Mirrors the precondition
 * philosophy of createEnvelope (which requires APPROVED) but widens to the
 * post-approval circulation states, because wet-sign paperwork happens at any
 * point after internal approval.
 */
const MARK_SIGNED_ALLOWED_STATUSES: ReadonlySet<ContractStatus> = new Set([
  ContractStatus.APPROVED,
  ContractStatus.ACTIVE,
  ContractStatus.PENDING_TENDERING,
  ContractStatus.SENT_TO_CONTRACTOR,
  ContractStatus.CONTRACTOR_REVIEWING,
]);

/**
 * Signed-state pinning — Slice 1 (CAPTURE).
 *
 * ONE shared pin operation for BOTH execution doors (DocuSign completed
 * webhook + manual mark-signed). The instant signature_status becomes
 * FULLY_EXECUTED, the contract's legal content is frozen:
 *   snapshot (createVersionSnapshot, EXECUTED event)
 *   → canonical pin payload (clauses in the shared ordering, lesson #214,
 *     + the substantive-metadata freeze set)
 *   → SHA-256 hex over the canonical serialization
 *   → stored on the version (content_hash + metadata.pin_payload)
 *   → pointers + executed state on the contract
 * all inside a single transaction.
 *
 * Slice 1 captures only — it does NOT block mutations on pinned contracts
 * (enforcement is a later slice).
 */
@Injectable()
export class ContractPinningService {
  private readonly logger = new Logger(ContractPinningService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly contractsService: ContractsService,
    private readonly contractAccess: ContractAccessService,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  /**
   * Pin the signed state of a contract. Idempotent: if the contract is
   * already pinned this is a no-op (no second snapshot, no re-hash, no
   * error) — safe under DocuSign redelivery and double-submitted manual
   * marks. The contract row is locked (pessimistic_write, the Bucket-1
   * load→branch→write idiom) so concurrent callers serialize and exactly
   * one performs the pin.
   *
   * NOTE: this method does NOT apply an org wall — callers own their gate
   * (webhook: envelope→contract lookup; manual: findInOrg in markAsSigned).
   */
  async pinExecutedContract(
    contractId: string,
    opts: {
      actorUserId: string | null;
      door: PinDoor;
      envelopeId?: string;
    },
  ): Promise<PinResult> {
    const result = await this.dataSource.transaction(async (manager) => {
      const contract = await manager // lint-exempt: wall-protected (caller-gated door: webhook envelope lookup / markAsSigned findInOrg); txn-bound pessimistic-lock load
        .getRepository(Contract)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: contractId })
        .getOne();

      if (!contract) {
        throw new NotFoundException('Contract not found');
      }

      // IDEMPOTENT no-op: already pinned (redelivery / double-submit).
      if (contract.pinned_version_id) {
        return {
          pinned: false,
          already_pinned: true,
          pinned_version_id: contract.pinned_version_id,
          content_hash: contract.pinned_content_hash!,
          pinned_at: contract.pinned_at!,
        } satisfies PinResult;
      }

      // (a) Version snapshot via the canonical entry point, inside THIS txn.
      const version = await this.contractsService.createVersionSnapshot(
        contractId,
        opts.actorUserId ?? contract.created_by,
        undefined,
        {
          eventType: ContractVersionEventType.EXECUTED,
          metadata: {
            pin_door: opts.door,
            ...(opts.envelopeId ? { envelope_id: opts.envelopeId } : {}),
          },
        },
        manager,
      );

      // (b) Canonical payload — live clauses in the SHARED ordering expression
      // (lesson #214; mirrors getContractClauses / RiskAnalysisService), guest-
      // proposed clauses excluded exactly as the snapshot excludes them.
      const orderedClauses = await manager // lint-exempt: wall-protected (caller-gated door); txn-bound shared-ordering read for the pin payload
        .getRepository(ContractClause)
        .createQueryBuilder('cc')
        .leftJoinAndSelect('cc.clause', 'clause')
        .leftJoinAndSelect('clause.source_document', 'doc')
        .where('cc.contract_id = :contractId', { contractId })
        .andWhere('cc.is_proposed = false')
        .orderBy('CASE WHEN doc.document_priority > 0 THEN 0 ELSE 1 END', 'ASC')
        .addOrderBy('doc.document_priority', 'ASC')
        .addOrderBy('doc.created_at', 'ASC')
        .addOrderBy('cc.order_index', 'ASC')
        .addOrderBy('cc.id', 'ASC')
        .getMany();

      const payload = buildPinPayload(contract, orderedClauses);

      // (c) SHA-256 hex over the canonical serialization. The SAME payload
      // object is stored (metadata.pin_payload) — stored and hashed
      // representations derive from one canonical serializer.
      const contentHash = computePinHash(payload);

      await manager.getRepository(ContractVersion).update( // lint-exempt: wall-protected (caller-gated door); txn-bound write to the just-created snapshot row
        { id: version.id },
        {
          content_hash: contentHash,
          metadata: {
            ...(version.metadata ?? {}),
            pin_payload: payload as unknown as Record<string, unknown>,
          },
        },
      );

      // (d)+(e) Pin pointers + executed state — targeted UPDATE (never a full
      // entity save; createVersionSnapshot already bumped current_version).
      // Mirrors the DocuSign completed handler's contract-state writes.
      const pinnedAt = new Date();
      await manager.getRepository(Contract).update( // lint-exempt: wall-protected (caller-gated door); txn-bound targeted pin write
        { id: contractId },
        {
          pinned_version_id: version.id,
          pinned_at: pinnedAt,
          pinned_content_hash: contentHash,
          signature_status: SignatureStatus.FULLY_EXECUTED,
          executed_at: contract.executed_at ?? pinnedAt,
          status: ContractStatus.ACTIVE,
        },
      );

      return {
        pinned: true,
        already_pinned: false,
        pinned_version_id: version.id,
        content_hash: contentHash,
        pinned_at: pinnedAt,
      } satisfies PinResult;
    });

    // (f) Audit — best-effort AFTER commit (mirrors the webhook's recordAudit
    // pattern: an audit hiccup never rolls back a legally-significant pin,
    // and a rolled-back pin never leaves an audit row claiming one).
    if (result.pinned) {
      try {
        await this.auditLogRepo.insert({
          user_id: opts.actorUserId ?? undefined,
          action: 'contract.signed_state_pinned',
          entity_type: 'contract',
          entity_id: contractId,
          new_values: {
            door: opts.door,
            pinned_version_id: result.pinned_version_id,
            content_hash: result.content_hash,
            pinned_at: result.pinned_at.toISOString(),
            ...(opts.envelopeId ? { envelope_id: opts.envelopeId } : {}),
          },
        });
      } catch (err) {
        this.logger.warn(`Failed to record pin audit log: ${err}`);
      }
      this.logger.log(
        `Contract ${contractId} signed state PINNED via ${opts.door} ` +
          `(version ${result.pinned_version_id}, hash ${result.content_hash.slice(0, 12)}…)`,
      );
    } else {
      this.logger.log(
        `Contract ${contractId} pin no-op via ${opts.door} — already pinned ` +
          `(version ${result.pinned_version_id})`,
      );
    }

    return result;
  }

  /**
   * Manual "Mark as signed" — door (2), for wet-signed-on-paper contracts.
   * Org-walled (findInOrg → cross-tenant 404, no existence leak), permission
   * gate lives on the controller (APPROVER, mirroring updateStatus).
   * Idempotent: an already-executed contract returns the existing pin.
   */
  async markAsSigned(
    contractId: string,
    userId: string,
    orgId: string,
  ): Promise<PinResult> {
    // WALL (persona) — findInOrg, same gate as every managing contract route.
    const contract = await this.contractAccess.findInOrg(contractId, orgId);

    // Idempotent no-op BEFORE the precondition check — re-marking an
    // already-executed contract must never error.
    if (
      contract.pinned_version_id ||
      contract.signature_status === SignatureStatus.FULLY_EXECUTED
    ) {
      return this.pinExecutedContract(contractId, {
        actorUserId: userId,
        door: 'MANUAL_MARK_SIGNED',
      });
    }

    if (!MARK_SIGNED_ALLOWED_STATUSES.has(contract.status)) {
      throw new BadRequestException(
        `Contract cannot be marked as signed from status ${contract.status}. ` +
          `Allowed: ${[...MARK_SIGNED_ALLOWED_STATUSES].join(', ')}.`,
      );
    }

    return this.pinExecutedContract(contractId, {
      actorUserId: userId,
      door: 'MANUAL_MARK_SIGNED',
    });
  }

  /**
   * Signed-state pinning (Slice 2) — the tamper-detection READ path.
   * Recomputes the canonical hash TWICE and compares each to the pinned hash:
   *   live_hash            — from the CURRENT live clauses (shared ordering,
   *                          lesson #214) + the contract's metadata freeze
   *                          set. Detects post-signature drift of the live
   *                          content (e.g. a direct DB edit past the guard).
   *   stored_payload_hash  — from the STORED pin payload re-serialized by the
   *                          canonical serializer (jsonb round-trip is safe:
   *                          the serializer imposes key order). Detects
   *                          tampering of the stored record itself.
   * Org-walled (findInOrg → cross-tenant 404). Read-only.
   */
  async verifyContractPin(
    contractId: string,
    orgId: string,
  ): Promise<PinVerificationResult> {
    const contract = await this.contractAccess.findInOrg(contractId, orgId);

    if (!contract.pinned_version_id) {
      return {
        pinned: false,
        valid: null,
        pinned_version_id: null,
        pinned_at: null,
        pinned_content_hash: null,
        live_hash: null,
        stored_payload_hash: null,
      };
    }

    // Live recompute — the SAME shared ordering expression + canonical
    // builder the pin operation used (guest-proposed clauses excluded).
    const orderedClauses = await this.dataSource.manager // lint-exempt: wall-protected (findInOrg above); read-only shared-ordering load for pin verification
      .getRepository(ContractClause)
      .createQueryBuilder('cc')
      .leftJoinAndSelect('cc.clause', 'clause')
      .leftJoinAndSelect('clause.source_document', 'doc')
      .where('cc.contract_id = :contractId', { contractId })
      .andWhere('cc.is_proposed = false')
      .orderBy('CASE WHEN doc.document_priority > 0 THEN 0 ELSE 1 END', 'ASC')
      .addOrderBy('doc.document_priority', 'ASC')
      .addOrderBy('doc.created_at', 'ASC')
      .addOrderBy('cc.order_index', 'ASC')
      .addOrderBy('cc.id', 'ASC')
      .getMany();
    const liveHash = computePinHash(buildPinPayload(contract, orderedClauses));

    const version = await this.dataSource.manager // lint-exempt: wall-protected (findInOrg above); read-only load of the contract's OWN pinned version row
      .getRepository(ContractVersion)
      .findOne({ where: { id: contract.pinned_version_id } });
    const storedPayload = version?.metadata?.['pin_payload'] as
      | PinPayload
      | undefined;
    const storedPayloadHash = storedPayload
      ? computePinHash(storedPayload)
      : null;

    const valid =
      liveHash === contract.pinned_content_hash &&
      storedPayloadHash === contract.pinned_content_hash &&
      version?.content_hash === contract.pinned_content_hash;

    if (!valid) {
      this.logger.warn(
        `Pin verification FAILED for contract ${contractId}: ` +
          `pinned=${contract.pinned_content_hash?.slice(0, 12)}… ` +
          `live=${liveHash.slice(0, 12)}… ` +
          `stored=${storedPayloadHash?.slice(0, 12) ?? 'null'}… ` +
          `signed-state drift detected. contract.pin_verification_failed`,
      );
    }

    return {
      pinned: true,
      valid,
      pinned_version_id: contract.pinned_version_id,
      pinned_at: contract.pinned_at,
      pinned_content_hash: contract.pinned_content_hash,
      live_hash: liveHash,
      stored_payload_hash: storedPayloadHash,
    };
  }
}
