import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ILike, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ContractShare, Contract } from '../../database/entities';
import { User, PermissionLevel } from '../../database/entities/user.entity';
import { ProjectMember } from '../../database/entities/project-member.entity';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { NotificationType } from '../../database/entities';
import { escapeLikeParam } from '../../common/utils/escape-like';
import { escapeHtml } from '../../common/utils/escape-html-email';

export interface ShareResult extends ContractShare {
  /** True when the recipient is a user in the same organisation */
  isInternal: boolean;
  /** Recipient's display name when internal */
  recipientName?: string;
}

@Injectable()
export class ContractSharingService {
  private readonly logger = new Logger(ContractSharingService.name);

  constructor(
    @InjectRepository(ContractShare) // lint-exempt: deprecating (ContractShare Step 2 removal)
    private readonly shareRepository: Repository<ContractShare>,
    @InjectRepository(Contract) // lint-exempt: deprecating (ContractShare Step 2 removal)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    private readonly dispatch: NotificationDispatchService,
    private readonly config: ConfigService,
  ) {}

  // ─── Create Share ─────────────────────────────────────────────────────────

  async createShare(params: {
    contractId: string;
    sharedBy: string;
    orgId: string;
    sharedWithEmail: string;
    permission: string;
    expiresInDays?: number;
  }): Promise<ShareResult> {
    // Org-scope: verify the contract belongs to the caller's org
    const contract = await this.contractRepository.findOne({ // lint-exempt: deprecating (ContractShare Step 2 removal)
      where: { id: params.contractId },
      relations: ['project'],
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    if (contract.project.organization_id !== params.orgId) {
      throw new NotFoundException('Contract not found');
    }

    // Generate unique token
    const token = crypto.randomBytes(32).toString('hex');

    const expiresAt = params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const share = this.shareRepository.create({
      contract_id: params.contractId,
      shared_by: params.sharedBy,
      shared_with_email: params.sharedWithEmail,
      permission: params.permission || 'view',
      token,
      expires_at: expiresAt as any,
      is_active: true,
    } as any);

    const saved = (await this.shareRepository.save(share as any)) as ContractShare; // lint-exempt: deprecating (ContractShare Step 2 removal)
    this.logger.log(
      `Contract ${params.contractId} shared with ${params.sharedWithEmail} by user ${params.sharedBy}`,
    );

    // ── Internal-user enrichment ──────────────────────────────────────────
    const recipient = await this.userRepository.findOne({
      where: { email: params.sharedWithEmail, organization_id: params.orgId },
    });

    const isInternal = !!recipient;
    const sharer = await this.userRepository.findOne({ where: { id: params.sharedBy } });

    if (recipient) {
      // Upsert ProjectMember row so the recipient has access through the normal gate
      await this.upsertProjectMember(
        contract.project_id,
        recipient.id,
        params.permission,
      );

      // Send in-app + email notification
      await this.notifyInternal({
        sharerName: sharer ? `${sharer.first_name} ${sharer.last_name}`.trim() : 'A colleague',
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        recipientName: `${recipient.first_name} ${recipient.last_name}`.trim(),
        contractId: params.contractId,
        contractName: contract.name,
        permission: params.permission,
        expiresAt,
        token,
      });
    } else {
      // External recipient — external sharing via GuestInvitation (bucket-7).
      // The old sendContractShared() email pointed to a /shared/:token route
      // that never existed in the frontend. Do NOT send a broken link.
      // TODO(bucket-7): wire GuestInvitation flow here once email delivery is ready.
      this.logger.warn(
        `Contract ${params.contractId} shared with external recipient ${params.sharedWithEmail} — email delivery pending GuestInvitation wiring`,
      );
    }

    return Object.assign(saved, { isInternal, recipientName: recipient
      ? `${recipient.first_name} ${recipient.last_name}`.trim()
      : undefined,
    });
  }

  // ─── Org-member search (for frontend autocomplete) ─────────────────────

  async searchOrgMembers(
    orgId: string,
    query: string,
  ): Promise<Array<{ id: string; name: string; email: string }>> {
    if (!query || query.length < 2) return [];

    const escaped = escapeLikeParam(query);
    const users = await this.userRepository.find({
      where: [
        { organization_id: orgId, email: ILike(`%${escaped}%`) },
        { organization_id: orgId, first_name: ILike(`%${escaped}%`) },
        { organization_id: orgId, last_name: ILike(`%${escaped}%`) },
      ],
      select: ['id', 'first_name', 'last_name', 'email'],
      take: 10,
    });

    return users.map((u) => ({
      id: u.id,
      name: `${u.first_name} ${u.last_name}`.trim(),
      email: u.email,
    }));
  }

  // ─── Existing read methods (unchanged) ───────────────────────────────────

  async getSharesByContract(contractId: string, orgId: string): Promise<ContractShare[]> {
    // Org-scope: verify the contract belongs to the caller's org before returning shares.
    // Same pattern as createShare() — traverses contract → project → organization_id.
    const contract = await this.contractRepository.findOne({ // lint-exempt: deprecating (ContractShare Step 2 removal)
      where: { id: contractId },
      relations: ['project'],
    });

    if (!contract || contract.project.organization_id !== orgId) {
      throw new NotFoundException('Contract not found');
    }

    return this.shareRepository.find({ // lint-exempt: deprecating (ContractShare Step 2 removal)
      where: { contract_id: contractId, is_active: true },
      relations: ['sharer'],
      order: { created_at: 'DESC' },
    });
  }

  async revokeShare(shareId: string, userId: string): Promise<void> {
    const share = await this.shareRepository.findOne({ // lint-exempt: deprecating (ContractShare Step 2 removal)
      where: { id: shareId, shared_by: userId },
    });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    await this.shareRepository.update(share.id, { is_active: false }); // lint-exempt: deprecating (ContractShare Step 2 removal)
    this.logger.log(`Share ${shareId} revoked by user ${userId}`);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Upsert a ProjectMember row for an internal recipient.
   * Silently skips if the user is already a member.
   */
  private async upsertProjectMember(
    projectId: string,
    userId: string,
    permission: string,
  ): Promise<void> {
    const existing = await this.memberRepository.findOne({
      where: { project_id: projectId, user_id: userId },
    });

    if (existing) return; // Already has access

    const permissionLevel = this.permissionToLevel(permission);
    const member = this.memberRepository.create({
      project_id: projectId,
      user_id: userId,
      role: 'viewer',
      permission_level: permissionLevel,
    });

    try {
      await this.memberRepository.save(member);
      this.logger.log(
        `Added user ${userId} as project member (project ${projectId}) via contract share`,
      );
    } catch (err) {
      // Best-effort — duplicate key means we raced; that's fine
      this.logger.warn(
        `upsertProjectMember race ignored for user ${userId} project ${projectId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Map share permission string to PermissionLevel enum value.
   */
  private permissionToLevel(permission: string): PermissionLevel {
    switch (permission) {
      case 'edit':
        return PermissionLevel.EDITOR;
      case 'comment':
        return PermissionLevel.COMMENTER;
      default:
        return PermissionLevel.VIEWER;
    }
  }

  /**
   * Fire in-app + email notification for an internal share recipient.
   * Best-effort — never throws.
   */
  private async notifyInternal(params: {
    sharerName: string;
    recipientId: string;
    recipientEmail: string;
    recipientName: string;
    contractId: string;
    contractName: string;
    permission: string;
    expiresAt: Date | null;
    token: string;
  }): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:5173');

    try {
      await this.dispatch.dispatch({
        userId: params.recipientId,
        title: 'Contract Shared With You',
        message: `${params.sharerName} shared "${params.contractName}" with you (${params.permission} access)`,
        type: NotificationType.BOTH,
        relatedEntityType: 'contract',
        relatedEntityId: params.contractId,
        email: {
          to: params.recipientEmail,
          subject: `Sign — "${params.contractName}" shared with you`,
          html: this.buildShareEmail({
            recipientName: params.recipientName,
            sharerName: params.sharerName,
            contractName: params.contractName,
            permission: params.permission,
            expiresAt: params.expiresAt,
            contractLink: `${frontendUrl}/app/contracts/${params.contractId}`,
          }),
          templateName: 'contract-shared-internal',
        },
      });
    } catch (err) {
      // Best-effort — never block the share creation
      this.logger.error(
        `Failed to send share notification to ${params.recipientEmail}: ${(err as Error).message}`,
      );
    }
  }

  private buildShareEmail(params: {
    recipientName: string;
    sharerName: string;
    contractName: string;
    permission: string;
    expiresAt: Date | null;
    contractLink: string;
  }): string {
    const expiry = params.expiresAt
      ? `<p style="color:#6B7280;font-size:14px;">Access expires: ${escapeHtml(params.expiresAt.toISOString().split('T')[0])}</p>`
      : '';

    return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#4F6EF7;">Contract Shared With You</h2>
        <p>Hi ${escapeHtml(params.recipientName)},</p>
        <p>${escapeHtml(params.sharerName)} has shared the contract
          <strong>${escapeHtml(params.contractName)}</strong> with you
          with <strong>${escapeHtml(params.permission)}</strong> access.</p>
        ${expiry}
        <a href="${escapeHtml(params.contractLink)}"
           style="display:inline-block;background:#4F6EF7;color:#fff;padding:12px 24px;
                  border-radius:6px;text-decoration:none;margin-top:16px;">
          View Contract
        </a>
        <p style="color:#9CA3AF;font-size:12px;margin-top:32px;">
          SIGN — Contract & Legal Intelligence by MANAGEX
        </p>
      </div>
    `;
  }
}
