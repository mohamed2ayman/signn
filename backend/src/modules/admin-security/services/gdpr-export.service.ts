import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import {
  AuditLog,
  Claim,
  Contract,
  KnownDevice,
  Notice,
  Notification,
  PasswordHistory,
  SupportTicket,
  User,
  UserSession,
} from '../../../database/entities';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { SecurityEventService } from './security-event.service';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';
import { baseEmailLayout } from '../../notifications/templates/base-layout';

export interface GdprExportRequest {
  userId: string;
  actorId: string;
  ipAddress: string | null;
}

export interface GdprExportResult {
  job_id: string;
  download_url: string;
  expires_at: string;
}

export interface GdprDeleteRequest {
  userId: string;
  actorId: string;
  ipAddress: string | null;
  /** Required confirmation string from the admin UI: must equal user's email. */
  confirmation: string;
}

const EXPORT_RETENTION_HOURS = 24;

/**
 * GDPR data-portability + right-to-erasure.
 *
 *   • Export: builds a ZIP of everything we have on a user (profile,
 *     audit logs, contracts they own, sessions, etc.) and emails them
 *     a download link. ZIP lives in /uploads/gdpr-exports for 24h.
 *   • Anonymize-delete: replaces PII with deterministic placeholders
 *     while preserving foreign-key integrity (so audit trails on
 *     contracts they signed remain valid). Hard-delete is a separate,
 *     opt-in path the admin can request later.
 */
@Injectable()
export class GdprExportService {
  private readonly logger = new Logger(GdprExportService.name);
  private readonly exportDir: string;
  private readonly baseUrl: string;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(Claim)
    private readonly claimRepo: Repository<Claim>,
    @InjectRepository(Notice)
    private readonly noticeRepo: Repository<Notice>,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(SupportTicket)
    private readonly supportRepo: Repository<SupportTicket>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(UserSession)
    private readonly sessionRepo: Repository<UserSession>,
    @InjectRepository(KnownDevice)
    private readonly deviceRepo: Repository<KnownDevice>,
    @InjectRepository(PasswordHistory)
    private readonly historyRepo: Repository<PasswordHistory>,
    @InjectQueue('email-queue') private readonly emailQueue: Queue,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly dispatch: NotificationDispatchService,
    private readonly securityEvents: SecurityEventService,
  ) {
    const uploadDir = this.configService.get<string>(
      'UPLOAD_DIR',
      path.join(process.cwd(), 'uploads'),
    );
    this.exportDir = path.join(uploadDir, 'gdpr-exports');
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
    this.baseUrl = this.configService.get<string>('BASE_URL', 'http://localhost:3000');
  }

  /** Synchronously builds the ZIP and returns the download URL. */
  async exportNow(req: GdprExportRequest): Promise<GdprExportResult> {
    const user = await this.userRepo.findOne({ where: { id: req.userId } });
    if (!user) throw new NotFoundException('User not found');

    const jobId = uuidv4();
    const filename = `gdpr-export-${user.id}-${jobId}.zip`;
    const filePath = path.join(this.exportDir, filename);

    const data = await this.collectUserData(user.id);

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      for (const [name, payload] of Object.entries(data)) {
        archive.append(JSON.stringify(payload, null, 2), { name: `${name}.json` });
      }
      archive.append(this.buildReadme(user), { name: 'README.txt' });
      void archive.finalize();
    });

    const downloadUrl = `${this.baseUrl}/uploads/gdpr-exports/${filename}`;
    const expiresAt = new Date(Date.now() + EXPORT_RETENTION_HOURS * 60 * 60 * 1000);

    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.GDPR_EXPORT,
      user_id: user.id,
      actor_id: req.actorId,
      ip_address: req.ipAddress,
      metadata: { export_file: filename, expires_at: expiresAt.toISOString() },
    });

    // Email user that the export is ready
    try {
      await this.dispatch.enqueueEmail({
        to: user.email,
        subject: 'Your data export is ready',
        html: this.renderExportReadyEmail({
          recipientName: user.first_name || user.email,
          downloadUrl,
          expiresAt: expiresAt.toUTCString(),
        }),
        templateName: 'gdpr_export_ready',
      });
    } catch (e) {
      this.logger.error(`Failed to email GDPR export link: ${(e as Error).message}`);
    }

    return {
      job_id: jobId,
      download_url: downloadUrl,
      expires_at: expiresAt.toISOString(),
    };
  }

  /**
   * Anonymize-delete: scrub PII while preserving FK targets so historical
   * audit/contract trails remain consistent. This is the GDPR-compliant
   * default; full row deletion can be done out-of-band.
   */
  async anonymizeDelete(req: GdprDeleteRequest): Promise<{ user_id: string }> {
    const user = await this.userRepo.findOne({ where: { id: req.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (req.confirmation !== user.email) {
      throw new BadRequestException(
        'Confirmation string must match the user email exactly',
      );
    }

    const placeholder = `deleted-${user.id.slice(0, 8)}@anonymized.local`;

    await this.dataSource.transaction(async (em) => {
      await em.update(User, user.id, {
        email: placeholder,
        first_name: 'Deleted',
        last_name: 'User',
        password_hash: 'DELETED',
        mfa_enabled: false,
        mfa_secret: null as unknown as string,
        mfa_recovery_codes: null as unknown as string[],
        is_active: false,
        job_title: null,
      });
      // Hard-delete session + device + history rows (no analytical value once anonymized)
      await em.delete(UserSession, { user_id: user.id });
      await em.delete(KnownDevice, { user_id: user.id });
      await em.delete(PasswordHistory, { user_id: user.id });
      // Insert audit row inside the same transaction
      await em.insert(AuditLog, {
        user_id: req.actorId,
        action: SECURITY_EVENT_TYPES.GDPR_DELETE,
        entity_type: 'user',
        entity_id: user.id,
        ip_address: req.ipAddress ?? undefined,
        new_values: { anonymized_email: placeholder },
      } as any);
    });

    return { user_id: user.id };
  }

  // ─── Private helpers ──────────────────────────────────────

  private async collectUserData(userId: string): Promise<Record<string, unknown>> {
    const [
      profile,
      contracts,
      claims,
      notices,
      notifications,
      supportTickets,
      auditLogs,
      sessions,
      devices,
    ] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId } }),
      this.contractRepo.find({ where: { created_by: userId }, take: 1000 }),
      this.claimRepo.find({ where: { submitted_by: userId } as any, take: 1000 }),
      this.noticeRepo.find({ where: { submitted_by: userId } as any, take: 1000 }),
      this.notificationRepo.find({ where: { user_id: userId }, take: 500 }),
      this.supportRepo.find({ where: { user_id: userId }, take: 500 }),
      this.auditRepo.find({
        where: { user_id: userId },
        order: { created_at: 'DESC' },
        take: 1000,
      }),
      this.sessionRepo.find({ where: { user_id: userId }, take: 500 }),
      this.deviceRepo.find({ where: { user_id: userId }, take: 100 }),
    ]);

    // Strip secrets from the profile dump before returning
    const safeProfile = profile
      ? {
          ...profile,
          password_hash: '[redacted]',
          refresh_token_hash: '[redacted]',
          mfa_secret: '[redacted]',
          mfa_recovery_codes: '[redacted]',
        }
      : null;

    return {
      profile: safeProfile,
      contracts,
      claims,
      notices,
      notifications,
      support_tickets: supportTickets,
      audit_logs: auditLogs,
      sessions,
      known_devices: devices,
    };
  }

  private buildReadme(user: User): string {
    return [
      'Sign — GDPR Data Export',
      '═══════════════════════════════════════',
      `Generated for: ${user.email}`,
      `Generated at:  ${new Date().toISOString()}`,
      '',
      'This archive contains every record we hold that is associated with',
      'your account. Each .json file is one collection. Sensitive secrets',
      '(password hashes, refresh-token hashes, MFA secrets, recovery code',
      'hashes) are redacted and shown as "[redacted]".',
      '',
      'If you believe a record is missing or you have questions about how',
      'we processed your data, contact privacy@sign.ai.',
      '',
      'This download link expires 24 hours after generation.',
      '',
    ].join('\n');
  }

  private renderExportReadyEmail(data: {
    recipientName: string;
    downloadUrl: string;
    expiresAt: string;
  }): string {
    const content = `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Your Data Export Is Ready</h1>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">Hi ${data.recipientName}, the data export you requested is ready for download.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;">
        <tr><td align="center">
          <a href="${data.downloadUrl}"
             style="display:inline-block; padding:14px 32px; background-color:#4F6EF7; color:#ffffff !important; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">Download Archive</a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0; font-size:12px; color:#9CA3AF; line-height:1.5;">This link expires at ${data.expiresAt}. After that the file will be deleted automatically.</p>
    `;
    return baseEmailLayout(content, { preheader: 'Your data export is ready' });
  }
}
