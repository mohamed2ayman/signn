import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

import { User, UserRole, Organization } from '../../database/entities';
import { EmailService } from '../notifications/email.service';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  InviteUserDto,
  UpdateRoleDto,
} from './dto';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly emailService: EmailService,
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
      refresh_token_hash,
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

  async inviteUser(organizationId: string, dto: InviteUserDto) {
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
    await this.emailService.sendInvitation(dto.email, invitationToken, dto.role);

    return {
      id: savedUser.id,
      email: savedUser.email,
      role: savedUser.role,
      job_title: savedUser.job_title,
      invitation_sent: true,
    };
  }

  async updateUserRole(userId: string, dto: UpdateRoleDto) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update(userId, { role: dto.role });

    return {
      id: user.id,
      email: user.email,
      role: dto.role,
    };
  }

  async deactivateUser(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update(userId, {
      is_active: false,
      refresh_token_hash: null as unknown as string,
    });

    return {
      id: user.id,
      email: user.email,
      is_active: false,
    };
  }

  async getAllUsersForAdmin(): Promise<
    {
      id: string;
      email: string;
      first_name: string;
      last_name: string;
      role: string;
      organization_id: string;
      is_active: boolean;
      mfa_enabled: boolean;
      mfa_method: string | null;
      last_login_at: Date;
      created_at: Date;
    }[]
  > {
    const users = await this.userRepository.find({
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
        'created_at',
      ],
      order: { created_at: 'DESC' },
    });
    return users as any;
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
}
