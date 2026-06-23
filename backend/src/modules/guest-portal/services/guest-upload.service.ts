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
 *      window. The count-and-create is serialized by a per-(contract, day)
 *      transaction-scoped advisory lock so two concurrent "6th" uploads can
 *      NEVER both pass (closes the TOCTOU hole without SERIALIZABLE retries —
 *      consistent with the engine's READ COMMITTED requirement).
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

    // (2) RACE-SAFE DAILY CAP + UPLOAD.
    // The advisory lock serializes concurrent guest uploads for THIS
    // (contract, UTC-day). The lock is held from the count through
    // `uploadAndProcess` (which commits the counted document_uploads row on
    // its own pool connection) until this outer transaction commits — so a
    // concurrent "6th" upload blocks on the lock, then counts the now-5 rows
    // and is capped. The outer transaction itself writes nothing; it exists
    // purely as the mutex + the read snapshot.
    const now = new Date();
    const utcDay = now.toISOString().slice(0, 10); // 'YYYY-MM-DD' (UTC)
    const dayStart = new Date(`${utcDay}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const lockKey = `guest_upload:${contractId}:${utcDay}`;

    const result = await this.dataSource.transaction(async (manager) => {
      // Transaction-scoped advisory lock — released automatically on
      // commit/rollback. hashtextextended → bigint matches the
      // pg_advisory_xact_lock(bigint) signature.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [lockKey],
      );

      // Count today's GUEST uploads on this contract. `document_uploads` has
      // no guest-distinguishing column, so the guest-ness is resolved via the
      // uploader's account_type. This counts all guests' uploads on the
      // contract (the cap is per-contract, not per-guest).
      const rows: Array<{ c: number | string }> = await manager.query(
        `SELECT count(*)::int AS c
           FROM document_uploads du
           JOIN users u ON u.id = du.uploaded_by
          WHERE du.contract_id = $1
            AND u.account_type = 'GUEST'
            AND du.created_at >= $2
            AND du.created_at < $3`,
        [contractId, dayStart.toISOString(), dayEnd.toISOString()],
      );
      const used = Number(rows[0]?.c ?? 0);

      if (used >= GuestUploadService.GUEST_DAILY_UPLOAD_CAP) {
        return { capped: true as const };
      }

      // Under cap → run the real upload + extraction lifecycle, charged to
      // the SEPARATE guest meter. `uploadAndProcess` runs its own
      // reserve/commit/release on other pool connections; its committed
      // document_uploads row is what the next waiter will count.
      const doc = await this.documentProcessing.uploadAndProcess(
        contractId,
        file,
        guest.id,
        hostOrgId,
        { account_type: 'GUEST', meterKey: MeterKey.GUEST_UPLOAD },
      );
      return { capped: false as const, doc };
    });

    if (result.capped) {
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

    // ON SUCCESS — notify the managing party (net-new: the managing upload
    // path is silent today). Best-effort; never blocks the upload.
    await this.notifyManagingOnUpload(contract, guest, result.doc.id);

    return {
      id: result.doc.id,
      file_name: result.doc.file_name,
      original_name: result.doc.original_name ?? null,
      processing_status: result.doc.processing_status,
      created_at: result.doc.created_at,
    };
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
