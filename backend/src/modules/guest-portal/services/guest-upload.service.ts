import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  AccountType,
  Contract,
  User,
  UserRole,
} from '../../../database/entities';
import { NotificationType } from '../../../database/entities/notification.entity';
import { escapeHtml } from '../../../common/utils/escape-html-email';
import { UploadedFile } from '../../storage/storage.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { assertContractMutable } from '../../contracts/utils/contract-pin-guard.util';
import { DocumentProcessingService } from '../../document-processing/document-processing.service';
import { MeterKey } from '../../metering/enums/meter-key.enum';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';

/**
 * Feature #4 — Guest upload of a new contract version.
 *
 * A bound guest with established identity (account_type=GUEST, Path B) uploads
 * a revised contract file; it lands as a `document_uploads` row and re-runs
 * the existing AI extraction pipeline (the same `uploadAndProcess` the
 * managing path uses), but metered against the SEPARATE `guest_upload` meter.
 *
 * Three locked invariants live here:
 *   1. BINDING WALL — `ContractAccessService.findAccessibleContract` routes a
 *      guest caller to `findForGuest` (the `guest_contract_access` row); a
 *      contract the guest is not bound to is 404 (NOT 403 — no existence leak).
 *      No bare-repo access — everything goes through the access service.
 *   2. RACE-SAFE DAILY CAP — 5 guest uploads/day PER CONTRACT (UTC day),
 *      enforced at this route layer because the metering engine has no per-day
 *      window. Gated by a SINGLE atomic conditional UPSERT against the
 *      `guest_upload_daily_counts` counter row — the same shape as the metering
 *      engine's reserve gate (Rule 9 Invariant 2: a hot single-row counter uses
 *      an atomic conditional UPDATE, NOT a held lock). The row lock lives only
 *      for that statement, so NOTHING is locked across the heavy upload work
 *      (storage + metering sub-transaction + AI dispatch) — closing the TOCTOU
 *      hole with no SERIALIZABLE retries AND no held-lock-across-extra-pool-
 *      connections deadlock. A claimed slot is released if the upload throws
 *      before a document lands (fail-safe toward over-denial).
 *   3. SUBJECT = HOST ORG — the metering subject is derived
 *      contract → project → organization_id (the inviting org), never the
 *      guest's null org. Here we read it off the contract the binding wall
 *      already loaded and hand it to `uploadAndProcess`, whose resolver
 *      re-derives the same host org.
 */
@Injectable()
export class GuestUploadService {
  private readonly logger = new Logger(GuestUploadService.name);

  /**
   * Product-locked daily cap: a contract accepts at most this many GUEST
   * uploads per UTC calendar day (across all guests bound to it). The
   * `guest_upload` meter is billing/attribution only — THIS is the enforcer.
   */
  static readonly GUEST_DAILY_UPLOAD_CAP = 5;

  constructor(
    private readonly dataSource: DataSource,
    private readonly contractAccess: ContractAccessService,
    private readonly documentProcessing: DocumentProcessingService,
    private readonly dispatch: NotificationDispatchService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Upload a revised contract version as a bound guest. Returns a sanitized
   * view of the created document (never the full entity — no org_id /
   * reservation_id leak to the guest).
   */
  async guestUploadNewVersion(params: {
    contractId: string;
    guest: {
      id: string;
      email?: string | null;
      role?: UserRole | null;
      account_type?: AccountType | null;
      organization_id?: string | null;
    };
    file: UploadedFile;
  }): Promise<{
    id: string;
    file_name: string;
    original_name: string | null;
    processing_status: string;
    created_at: Date;
  }> {
    const { contractId, guest, file } = params;

    // (1) BINDING WALL — 404 (not 403) if the guest is not bound to this
    // contract. Returns the contract with `project` + `creator` loaded.
    const contract = await this.contractAccess.findAccessibleContract(
      contractId,
      {
        id: guest.id,
        organization_id: guest.organization_id ?? null,
        role: guest.role as any,
        account_type: guest.account_type as any,
      },
    );

    // (3) Host org — derived from the contract the wall already loaded.
    const hostOrgId = contract.project?.organization_id;
    if (!hostOrgId) {
      // Defensive — a contract with no project/org is unusable as a metering
      // subject. 404 keeps parity with the no-existence-leak contract.
      throw new NotFoundException('Contract not found');
    }

    // Signed-state pinning (Slice 2) — AFTER the binding wall (404-first),
    // BEFORE the daily-slot claim: a pinned (signed) contract's clause set is
    // frozen, so a guest new-version upload is rejected with the coded 409
    // CONTRACT_PINNED (same envelope family as GUEST_UPLOAD_DAILY_LIMIT) and
    // never touches the day's quota. Pure pin check at the mutation seam —
    // identity/binding logic above is untouched. uploadAndProcess carries the
    // same guard as the shared backstop seam.
    await assertContractMutable(this.dataSource.manager, contract);

    // (2) RACE-SAFE DAILY CAP — atomic conditional UPSERT-counter.
    //
    // One statement decides the cap: INSERT count=1 on the day's first upload;
    // on conflict, increment ONLY while still under the cap. 0 rows returned ⇒
    // the cap is reached for this contract today. Two concurrent "6th" uploads
    // serialize on the row lock (held for the statement only) and exactly one
    // can win — closing the TOCTOU hole. Crucially, NO lock is held across the
    // heavy `uploadAndProcess` below, so there is no pool-starvation deadlock
    // (the upload checks out its own pool connections + makes an AI HTTP call).
    const utcDay = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' (UTC)
    const claim: Array<{ count: number }> = await this.dataSource.query(
      `INSERT INTO guest_upload_daily_counts (contract_id, day, count)
            VALUES ($1, $2, 1)
       ON CONFLICT (contract_id, day) DO UPDATE
            SET count = guest_upload_daily_counts.count + 1, updated_at = now()
          WHERE guest_upload_daily_counts.count < $3
       RETURNING count`,
      [contractId, utcDay, GuestUploadService.GUEST_DAILY_UPLOAD_CAP],
    );

    if (claim.length === 0) {
      // AT LIMIT — notify the host org (best-effort) and return a clear,
      // non-leaky quota error to the guest. NOT a silent 403.
      await this.notifyHostDailyCapHit(contract, guest);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'GUEST_UPLOAD_DAILY_LIMIT',
          message:
            `Daily upload limit reached. A maximum of ` +
            `${GuestUploadService.GUEST_DAILY_UPLOAD_CAP} new versions can be ` +
            `uploaded for this contract per day. Please try again tomorrow.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Slot claimed → run the real upload + extraction lifecycle OUTSIDE any
    // lock, charged to the SEPARATE guest meter (subject = host org). If it
    // throws before a document lands, release the claimed slot so a failed
    // attempt doesn't burn the day's quota.
    let doc: {
      id: string;
      file_name: string;
      original_name: string | null;
      processing_status: string;
      created_at: Date;
    };
    try {
      doc = await this.documentProcessing.uploadAndProcess(
        contractId,
        file,
        guest.id,
        hostOrgId,
        { account_type: 'GUEST', meterKey: MeterKey.GUEST_UPLOAD },
      );
    } catch (err) {
      await this.releaseDailySlot(contractId, utcDay);
      throw err;
    }

    // ON SUCCESS — notify the managing party (net-new: the managing upload
    // path is silent today). Best-effort; never blocks the upload.
    await this.notifyManagingOnUpload(contract, guest, doc.id);

    return {
      id: doc.id,
      file_name: doc.file_name,
      original_name: doc.original_name ?? null,
      processing_status: doc.processing_status,
      created_at: doc.created_at,
    };
  }

  /**
   * Best-effort release of a claimed daily-cap slot when the upload throws
   * before a document lands. Never throws — a lost slot fails safe toward
   * over-denial, and the CHECK(count >= 0) + `count > 0` guard prevent
   * underflow.
   */
  private async releaseDailySlot(
    contractId: string,
    utcDay: string,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE guest_upload_daily_counts
            SET count = count - 1, updated_at = now()
          WHERE contract_id = $1 AND day = $2 AND count > 0`,
        [contractId, utcDay],
      );
    } catch (err) {
      this.logger.error(
        `Failed to release guest daily-cap slot for contract ${contractId} ` +
          `day ${utcDay}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Net-new notification — tell the managing owner (contract.creator) that a
   * guest uploaded a revised version. Best-effort: a notify failure NEVER
   * rolls back the upload (lesson #114).
   */
  private async notifyManagingOnUpload(
    contract: Contract,
    guest: { email?: string | null },
    documentId: string,
  ): Promise<void> {
    const creator = contract.creator;
    if (!creator?.id) {
      return;
    }
    const who = guest.email || 'A guest';
    const contractName = contract.name || contract.id;
    try {
      await this.dispatch.dispatch({
        userId: creator.id,
        title: 'New contract version uploaded by guest',
        message: `${who} uploaded a new version to "${contractName}".`,
        type: NotificationType.BOTH,
        relatedEntityType: 'contract',
        relatedEntityId: contract.id,
        email: creator.email
          ? {
              to: creator.email,
              subject: `Sign — a guest uploaded a new version of "${contractName}"`,
              html: this.buildEmailHtml(
                'New contract version uploaded',
                [
                  `${who} uploaded a new version of "${contractName}".`,
                  'It is being processed (clause extraction) now. Open the contract in Sign to review the new version.',
                ],
              ),
              templateName: 'guest-version-uploaded',
            }
          : undefined,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify managing owner ${creator.id} of guest upload on ` +
          `contract ${contract.id} (document ${documentId}): ` +
          `${(err as Error).message}`,
      );
    }
  }

  /**
   * At-limit notification — tell the host org's OWNER_ADMINs that a guest hit
   * the daily upload cap. Best-effort, per-recipient try/catch.
   */
  private async notifyHostDailyCapHit(
    contract: Contract,
    guest: { email?: string | null },
  ): Promise<void> {
    const orgId = contract.project?.organization_id;
    if (!orgId) {
      return;
    }
    let admins: User[] = [];
    try {
      admins = await this.userRepo.find({
        where: {
          organization_id: orgId,
          role: UserRole.OWNER_ADMIN,
          is_active: true,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to load OWNER_ADMINs for org ${orgId} (guest cap notify): ` +
          `${(err as Error).message}`,
      );
      return;
    }

    const who = guest.email || 'A guest';
    const contractName = contract.name || contract.id;
    const cap = GuestUploadService.GUEST_DAILY_UPLOAD_CAP;

    for (const admin of admins) {
      try {
        await this.dispatch.dispatch({
          userId: admin.id,
          title: 'Guest reached daily upload limit',
          message: `${who} reached the daily upload limit (${cap}/day) on "${contractName}".`,
          type: NotificationType.BOTH,
          relatedEntityType: 'contract',
          relatedEntityId: contract.id,
          email: admin.email
            ? {
                to: admin.email,
                subject: `Sign — a guest reached the daily upload limit on "${contractName}"`,
                html: this.buildEmailHtml('Guest daily upload limit reached', [
                  `${who} attempted more than ${cap} uploads in one day on "${contractName}".`,
                  'No further guest uploads will be accepted on this contract until tomorrow (UTC). This is an automated notice.',
                ]),
                templateName: 'guest-upload-cap-hit',
              }
            : undefined,
        });
      } catch (err) {
        this.logger.error(
          `Guest cap notify: failed to notify admin ${admin.id} for org ` +
            `${orgId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /** Minimal escaped HTML email body. Lines are plain text (escaped here). */
  private buildEmailHtml(heading: string, lines: string[]): string {
    const body = lines
      .map((l) => `<p style="margin:0 0 12px;">${escapeHtml(l)}</p>`)
      .join('');
    return (
      `<div style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.5;">` +
      `<h2 style="color:#4F6EF7;margin:0 0 16px;">${escapeHtml(heading)}</h2>` +
      `${body}</div>`
    );
  }
}
