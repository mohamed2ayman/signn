import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

import { User, UserRole, Organization } from '../../database/entities';
import { EmailService } from '../notifications/email.service';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  InviteUserDto,
  UpdateRoleDto,
  CreateOperationsUserDto,
} from './dto';
import { ORG_ADMIN_ROLES, canAssignRole } from './role-authz';

/** JWT-derived caller context for the team-management endpoints. */
interface ActorContext {
  id: string;
  role: UserRole;
}

// Invitation is considered expired after 72 hours with no login
const INVITATION_EXPIRY_HOURS = 72;

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly emailService: EmailService,
    private readonly dataSource: DataSource,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['organization'],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
    });
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['organization'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Exclude sensitive fields
    const {
      password_hash,
      mfa_secret,
      mfa_totp_secret,
      mfa_recovery_codes,
      invitation_token,
      ...profile
    } = user;

    return profile;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData: Record<string, any> = {};
    if (dto.first_name !== undefined) updateData.first_name = dto.first_name;
    if (dto.last_name !== undefined) updateData.last_name = dto.last_name;
    if (dto.preferred_language !== undefined)
      updateData.preferred_language = dto.preferred_language;
    if (dto.job_title !== undefined) updateData.job_title = dto.job_title;

    await this.userRepository.update(userId, updateData as any);

    return this.getProfile(userId);
  }

  // TODO(Phase 5.8): This endpoint is legacy — frontend migrated to POST /me/change-password.
  // Do NOT add new callers. Missing: assertNotReused, appendToHistory, security event,
  // password_changed_at update. Keep until confirmed no external API consumers.
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify old password
    const isOldPasswordValid = await bcrypt.compare(
      dto.old_password,
      user.password_hash,
    );
    if (!isOldPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Hash and save new password
    const newPasswordHash = await bcrypt.hash(
      dto.new_password,
      BCRYPT_SALT_ROUNDS,
    );
    await this.userRepository.update(userId, {
      password_hash: newPasswordHash,
    });

    return { message: 'Password changed successfully' };
  }

  async getOrgMembers(organizationId: string): Promise<User[]> {
    const users = await this.userRepository.find({
      where: { organization_id: organizationId },
      select: [
        'id',
        'email',
        'first_name',
        'last_name',
        'role',
        'job_title',
        'is_active',
        'is_email_verified',
        'last_login_at',
        'created_at',
      ],
      order: { created_at: 'ASC' },
    });

    return users;
  }

  async inviteUser(
    organizationId: string,
    dto: InviteUserDto,
    inviterName: string,
    actor: ActorContext,
  ) {
    // Rank ceiling (defense-in-depth on top of the DTO allow-list): a caller
    // can never invite a role that OUTRANKS their own. Closes the invite
    // escalation vector even if the allow-list were widened later.
    if (!canAssignRole(actor.role, dto.role)) {
      throw new ForbiddenException(
        'You cannot invite a user with a role higher than your own.',
      );
    }

    // Check if user already exists with this email
    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    // Verify the organization exists
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // Generate invitation token
    const invitationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48); // 48 hour expiry

    // Create user with invitation token (inactive, pending acceptance)
    const user = this.userRepository.create({
      email: dto.email,
      password_hash: '', // Will be set when invitation is accepted
      first_name: '',
      last_name: '',
      role: dto.role,
      job_title: dto.job_title || null,
      default_permission_level: dto.default_permission_level || null,
      organization_id: organizationId,
      is_active: false,
      is_email_verified: false,
      invitation_token: invitationToken,
      invitation_expires_at: expiresAt,
    });

    const savedUser = await this.userRepository.save(user);

    // Send invitation email
    await this.emailService.sendInvitation(
      dto.email,
      invitationToken,
      dto.role,
      organization.name,
      inviterName,
    );

    return {
      id: savedUser.id,
      email: savedUser.email,
      role: savedUser.role,
      job_title: savedUser.job_title,
      invitation_sent: true,
    };
  }

  /**
   * Org-scoped user lookup — the tenancy wall for team-management writes.
   * Mirrors ContractAccessService.findInOrg: a target outside the caller's org
   * is a 404 (never 403), so cross-tenant existence is not leaked.
   *
   * Nullable-org guard: a caller with no org (orgId null/undefined) can reach
   * NO ONE — we never fall through to an unscoped or null-matching query.
   */
  private async findUserInOrg(
    userId: string,
    orgId: string | null | undefined,
  ): Promise<User> {
    if (!orgId) {
      throw new NotFoundException('User not found');
    }
    const user = await this.userRepository.findOne({
      where: { id: userId, organization_id: orgId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Atomic last-admin (org-decapitation) guard. Runs INSIDE the caller's
   * transaction and pessimistic-write-LOCKS the org's active admin-tier rows
   * (SELECT … FOR UPDATE) before counting, so two concurrent operations that
   * each remove an admin serialize: the first commits, the second re-reads the
   * reduced set under the lock and is rejected. The invariant "an org always
   * keeps ≥ 1 active admin" therefore holds even under a mutual-demote race —
   * which the previous non-locking count() did NOT guarantee. Mirrors the
   * metering / guest-sign-slip pessimistic-write pattern.
   *
   * No-op unless the operation REMOVES the target's admin-tier status
   * (targetWasAdmin && !targetWillBeAdmin) — i.e. deactivating an admin, or
   * re-roling an admin to a non-admin role. Admin-tier = ORG_ADMIN_ROLES.
   */
  private async assertNotLastOrgAdmin(
    manager: EntityManager,
    orgId: string,
    targetUserId: string,
    targetWasAdmin: boolean,
    targetWillBeAdmin: boolean,
  ): Promise<void> {
    if (!targetWasAdmin || targetWillBeAdmin) {
      return;
    }
    const activeAdmins = await manager
      .getRepository(User)
      .createQueryBuilder('u')
      .setLock('pessimistic_write')
      .where('u.organization_id = :orgId', { orgId })
      .andWhere('u.is_active = :active', { active: true })
      .andWhere('u.role IN (:...roles)', { roles: ORG_ADMIN_ROLES })
      .getMany();
    // Would ANY active admin remain after this op strips the target's
    // admin-tier status? (Exclude the target — it is the one losing it.)
    const remaining = activeAdmins.filter((a) => a.id !== targetUserId).length;
    if (remaining < 1) {
      throw new ForbiddenException(
        'Cannot remove the last active admin of the organization.',
      );
    }
  }

  async updateUserRole(
    userId: string,
    dto: UpdateRoleDto,
    orgId: string | null | undefined,
    actor: ActorContext,
  ) {
    // (L1) Org-wall: a target outside the caller's org → 404. Closes the
    // cross-tenant re-role AND the email disclosure (a foreign user never
    // loads, so the response can never carry its email).
    const user = await this.findUserInOrg(userId, orgId);

    // (L3) No self-role-change — blocks self-promotion. There is no legitimate
    // self-service role-change flow (updateUserRole is the ONLY User.role write
    // path; the /me + profile DTOs carry no role field).
    if (user.id === actor.id) {
      throw new ForbiddenException('You cannot change your own role.');
    }

    // (L2) Rank ceiling: a caller can never confer a role above their own.
    if (!canAssignRole(actor.role, dto.role)) {
      throw new ForbiddenException(
        'You cannot assign a role higher than your own.',
      );
    }

    const targetWasAdmin = ORG_ADMIN_ROLES.includes(user.role);
    const targetWillBeAdmin = ORG_ADMIN_ROLES.includes(dto.role);

    // (L3) Atomic last-admin guard + the write in ONE locked transaction:
    // re-roling the last admin DOWN to a non-admin role cannot decapitate the
    // org, even under a concurrent mutual-demote race.
    await this.dataSource.transaction(async (manager) => {
      await this.assertNotLastOrgAdmin(
        manager,
        orgId as string,
        userId,
        targetWasAdmin,
        targetWillBeAdmin,
      );
      await manager.getRepository(User).update(userId, { role: dto.role });
    });

    return {
      id: user.id,
      email: user.email,
      role: dto.role,
    };
  }

  async deactivateUser(
    userId: string,
    orgId: string | null | undefined,
    actor: ActorContext,
  ) {
    // (L1) Org-wall: cross-tenant deactivation → 404.
    const user = await this.findUserInOrg(userId, orgId);

    // (L3) No self-deactivation.
    if (user.id === actor.id) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }

    const targetWasAdmin = ORG_ADMIN_ROLES.includes(user.role);

    // (L3) Atomic last-admin guard + the write in ONE locked transaction.
    // Deactivation always strips admin-tier status (targetWillBeAdmin = false).
    await this.dataSource.transaction(async (manager) => {
      await this.assertNotLastOrgAdmin(
        manager,
        orgId as string,
        userId,
        targetWasAdmin,
        false,
      );
      await manager.getRepository(User).update(userId, { is_active: false });
    });

    return {
      id: user.id,
      email: user.email,
      is_active: false,
    };
  }

  async checkEmailExists(email: string): Promise<{ exists: boolean }> {
    const user = await this.userRepository.findOne({ where: { email } });
    return { exists: !!user };
  }

  async getAllUsersForAdmin(role?: string) {
    const where: Record<string, unknown> = {};
    if (role) where.role = role;

    const users = await this.userRepository.find({
      where: Object.keys(where).length ? where : undefined,
      select: [
        'id',
        'email',
        'first_name',
        'last_name',
        'role',
        'organization_id',
        'is_active',
        'mfa_enabled',
        'mfa_method',
        'last_login_at',
        'invitation_sent_at',
        'created_at',
      ],
      order: { created_at: 'DESC' },
    });

    const now = Date.now();
    return users.map((u) => ({
      ...u,
      invitation_status: this.computeInvitationStatus(u, now),
    }));
  }

  /** Derives invitation status from persisted timestamps — never stored in DB. */
  private computeInvitationStatus(
    user: Pick<User, 'last_login_at' | 'invitation_sent_at'>,
    now = Date.now(),
  ): 'ACCEPTED' | 'PENDING' | 'EXPIRED' | null {
    if (user.last_login_at) return 'ACCEPTED';
    if (!user.invitation_sent_at) return null;
    const hoursSince =
      (now - new Date(user.invitation_sent_at).getTime()) / 3_600_000;
    return hoursSince > INVITATION_EXPIRY_HOURS ? 'EXPIRED' : 'PENDING';
  }

  async adminResetUserMfa(targetUserId: string) {
    const user = await this.userRepository.findOne({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update(targetUserId, {
      mfa_enabled: false,
      mfa_method: null as unknown as string,
      mfa_totp_secret: null as unknown as string,
      mfa_secret: null as unknown as string,
      mfa_recovery_codes: null as unknown as string[],
    });

    return { message: `MFA reset for user ${user.email}` };
  }

  // ─── Operations team management ───────────────────────────────────────────

  async createOperationsUser(
    dto: CreateOperationsUserDto,
    inviterName: string,
  ) {
    // 1. Uniqueness check
    const existing = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    // 2. Hash the temporary password
    const passwordHash = await bcrypt.hash(dto.temporaryPassword, BCRYPT_SALT_ROUNDS);

    // 3. Generate an invitation token (used in the email link)
    const invitationToken = crypto.randomBytes(32).toString('hex');
    const now = new Date();

    // 4. Persist the user
    const user = this.userRepository.create({
      email:              dto.email,
      password_hash:      passwordHash,
      first_name:         dto.firstName,
      last_name:          dto.lastName,
      role:               UserRole.OPERATIONS,
      job_title:          dto.jobTitle ?? null,
      is_active:          true,
      is_email_verified:  true,
      invitation_token:   invitationToken,
      invitation_sent_at: now,
    } as Partial<User>);

    const saved = await this.userRepository.save(user);

    // 5. Send invitation email
    await this.emailService.sendInvitation(
      dto.email,
      invitationToken,
      UserRole.OPERATIONS,
      'SIGN Platform',
      inviterName,
    );

    const { password_hash, mfa_secret, mfa_totp_secret, mfa_recovery_codes, invitation_token, ...safeUser } = saved;
    return safeUser;
  }

  async resendInvitation(
    targetUserId: string,
    inviterName: string,
  ): Promise<{ success: boolean; sentAt: string }> {
    const user = await this.userRepository.findOne({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Regenerate a new temporary password and token
    const newTempPassword    = crypto.randomBytes(6).toString('base64url').slice(0, 10) + 'A1!';
    const newPasswordHash    = await bcrypt.hash(newTempPassword, BCRYPT_SALT_ROUNDS);
    const newInvitationToken = crypto.randomBytes(32).toString('hex');
    const now = new Date();

    await this.userRepository.update(targetUserId, {
      password_hash:      newPasswordHash,
      invitation_token:   newInvitationToken,
      invitation_sent_at: now,
    } as any);

    await this.emailService.sendInvitation(
      user.email,
      newInvitationToken,
      user.role,
      'SIGN Platform',
      inviterName,
    );

    return { success: true, sentAt: now.toISOString() };
  }
}
