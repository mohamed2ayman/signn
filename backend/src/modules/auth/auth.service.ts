import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

import {
  User,
  UserRole,
  Organization,
  SubscriptionPlan,
  OrganizationSubscription,
  SubscriptionStatus,
} from '../../database/entities';
import { EmailService } from '../notifications/email.service';
import {
  RegisterDto,
  LoginDto,
  VerifyMfaDto,
  AcceptInvitationDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto';

const BCRYPT_SALT_ROUNDS = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;
const OTP_VALIDITY_MINUTES = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(SubscriptionPlan)
    private readonly subscriptionPlanRepository: Repository<SubscriptionPlan>,
    @InjectRepository(OrganizationSubscription)
    private readonly orgSubscriptionRepository: Repository<OrganizationSubscription>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    // Check if email is already taken
    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    // Verify the subscription plan exists
    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id: dto.plan_id },
    });
    if (!plan) {
      throw new BadRequestException('Invalid subscription plan');
    }

    // Hash password
    const passwordHash = await this.hashData(dto.password);

    // Create Organization
    const organization = this.organizationRepository.create({
      name: dto.organization_name,
      industry: dto.industry,
      country: dto.country,
    });
    const savedOrganization =
      await this.organizationRepository.save(organization);

    // Create User with role OWNER_ADMIN
    const user = this.userRepository.create({
      email: dto.email,
      password_hash: passwordHash,
      first_name: dto.first_name,
      last_name: dto.last_name,
      role: UserRole.OWNER_ADMIN,
      organization_id: savedOrganization.id,
      is_active: true,
      is_email_verified: false,
    });
    const savedUser = await this.userRepository.save(user);

    // Create OrganizationSubscription (INACTIVE, will be activated by Paymob webhook)
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + plan.duration_days);

    const subscription = this.orgSubscriptionRepository.create({
      organization_id: savedOrganization.id,
      plan_id: dto.plan_id,
      status: SubscriptionStatus.INACTIVE,
      start_date: now,
      end_date: endDate,
    });
    await this.orgSubscriptionRepository.save(subscription);

    // Generate tokens
    const tokens = await this.generateTokens(savedUser);

    // Store refresh token hash
    const refreshTokenHash = await this.hashData(tokens.refresh_token);
    await this.userRepository.update(savedUser.id, {
      refresh_token_hash: refreshTokenHash,
    });

    return {
      user: this.sanitizeUser(savedUser),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async login(dto: LoginDto) {
    // Find user by email
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check if account is active
    if (!user.is_active) {
      throw new ForbiddenException('Account has been deactivated');
    }

    // Check if account is locked
    if (user.locked_until && user.locked_until > new Date()) {
      const remainingMinutes = Math.ceil(
        (user.locked_until.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(
        `Account is locked due to too many failed login attempts. Try again in ${remainingMinutes} minute(s).`,
      );
    }

    // Verify password
    const isPasswordValid = await this.validatePassword(
      dto.password,
      user.password_hash,
    );

    if (!isPasswordValid) {
      // Increment failed login attempts
      const failedAttempts = user.failed_login_attempts + 1;
      const updateData: Partial<User> = {
        failed_login_attempts: failedAttempts,
      };

      // Lock account if too many failed attempts
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_DURATION_MINUTES);
        updateData.locked_until = lockUntil;
        this.logger.warn(
          `Account locked for user ${user.email} after ${failedAttempts} failed attempts`,
        );
      }

      await this.userRepository.update(user.id, updateData);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Reset failed login attempts on successful password verification
    await this.userRepository.update(user.id, {
      failed_login_attempts: 0,
      locked_until: null as unknown as Date,
    });

    // Check if MFA is enabled
    if (user.mfa_enabled) {
      const otpCode = this.generateOtp();
      const otpHash = await this.hashData(otpCode);

      // Store OTP hash with timestamp in mfa_secret field (format: "hash|timestamp")
      const otpTimestamp = Date.now().toString();
      await this.userRepository.update(user.id, {
        mfa_secret: `${otpHash}|${otpTimestamp}`,
      });

      // Send OTP via email
      await this.emailService.sendMfaOtp(user.email, otpCode);

      return {
        requires_mfa: true,
        email: user.email,
      };
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Update last login and store refresh token hash
    const refreshTokenHash = await this.hashData(tokens.refresh_token);
    await this.userRepository.update(user.id, {
      last_login_at: new Date(),
      refresh_token_hash: refreshTokenHash,
    });

    return {
      user: this.sanitizeUser(user),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async verifyMfa(dto: VerifyMfaDto) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid verification request');
    }

    if (!user.mfa_secret) {
      throw new UnauthorizedException('No MFA verification pending');
    }

    // Parse stored OTP hash and timestamp (format: "bcryptHash|timestamp")
    const separatorIndex = user.mfa_secret.lastIndexOf('|');
    if (separatorIndex === -1) {
      throw new UnauthorizedException('Invalid MFA state');
    }

    const otpHash = user.mfa_secret.substring(0, separatorIndex);
    const otpTimestamp = user.mfa_secret.substring(separatorIndex + 1);

    // Check if OTP is expired (10 minutes)
    const otpIssueTime = parseInt(otpTimestamp, 10);
    const elapsed = Date.now() - otpIssueTime;
    if (elapsed > OTP_VALIDITY_MINUTES * 60 * 1000) {
      throw new UnauthorizedException('OTP has expired. Please login again.');
    }

    // Verify OTP
    const isOtpValid = await this.validatePassword(dto.otp_code, otpHash);
    if (!isOtpValid) {
      throw new UnauthorizedException('Invalid OTP code');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Clear MFA secret, update last login, and store refresh token hash
    const refreshTokenHash = await this.hashData(tokens.refresh_token);
    await this.userRepository.update(user.id, {
      mfa_secret: null as unknown as string,
      last_login_at: new Date(),
      refresh_token_hash: refreshTokenHash,
    });

    return {
      user: this.sanitizeUser(user),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async refreshToken(refreshToken: string) {
    // Verify the refresh token
    let payload: { sub: string; email: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Find the user
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });
    if (!user || !user.is_active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Verify the refresh token matches stored hash
    if (!user.refresh_token_hash) {
      throw new UnauthorizedException('No active session found');
    }

    const isTokenValid = await this.validatePassword(
      refreshToken,
      user.refresh_token_hash,
    );
    if (!isTokenValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Generate new tokens
    const tokens = await this.generateTokens(user);

    // Update stored refresh token hash
    const refreshTokenHash = await this.hashData(tokens.refresh_token);
    await this.userRepository.update(user.id, {
      refresh_token_hash: refreshTokenHash,
    });

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async logout(userId: string) {
    await this.userRepository.update(userId, {
      refresh_token_hash: null as unknown as string,
    });

    return { success: true };
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const user = await this.userRepository.findOne({
      where: { invitation_token: dto.token },
    });

    if (!user) {
      throw new BadRequestException('Invalid invitation token');
    }

    if (user.invitation_expires_at && user.invitation_expires_at < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    // Update user with password and details
    const passwordHash = await this.hashData(dto.password);
    await this.userRepository.update(user.id, {
      password_hash: passwordHash,
      first_name: dto.first_name,
      last_name: dto.last_name,
      is_active: true,
      is_email_verified: true,
      invitation_token: null as unknown as string,
      invitation_expires_at: null as unknown as Date,
    });

    // Reload user with updated data
    const updatedUser = await this.userRepository.findOne({
      where: { id: user.id },
    });

    // Generate tokens
    const tokens = await this.generateTokens(updatedUser!);

    // Store refresh token hash
    const refreshTokenHash = await this.hashData(tokens.refresh_token);
    await this.userRepository.update(updatedUser!.id, {
      refresh_token_hash: refreshTokenHash,
      last_login_at: new Date(),
    });

    return {
      user: this.sanitizeUser(updatedUser!),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    // Always return the same message to prevent email enumeration
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      await this.userRepository.update(user.id, {
        invitation_token: resetToken,
        invitation_expires_at: expiresAt,
      });

      await this.emailService.sendPasswordReset(user.email, resetToken);
    }

    return { message: 'If email exists, a reset link will be sent' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userRepository.findOne({
      where: { invitation_token: dto.token },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (user.invitation_expires_at && user.invitation_expires_at < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    // Hash new password and update
    const passwordHash = await this.hashData(dto.password);
    await this.userRepository.update(user.id, {
      password_hash: passwordHash,
      invitation_token: null as unknown as string,
      invitation_expires_at: null as unknown as Date,
      failed_login_attempts: 0,
      locked_until: null as unknown as Date,
    });

    return { message: 'Password reset successful' };
  }

  async completeOnboarding(userId: string, level: string): Promise<void> {
    await this.userRepository.update(userId, {
      onboarding_completed: true,
      onboarding_level: level,
    } as any);
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['organization'],
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return this.sanitizeUser(user);
  }

  // --- Private Helper Methods ---

  private async generateTokens(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organization_id: user.organization_id,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(
        { sub: user.id, email: user.email },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: '7d',
        },
      ),
    ]);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  private generateOtp(): string {
    // Generate a secure 6-digit OTP
    const buffer = crypto.randomBytes(4);
    const num = buffer.readUInt32BE(0) % 1000000;
    return num.toString().padStart(6, '0');
  }

  private async hashData(data: string): Promise<string> {
    return bcrypt.hash(data, BCRYPT_SALT_ROUNDS);
  }

  private async validatePassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  private sanitizeUser(user: User) {
    const { password_hash, mfa_secret, refresh_token_hash, ...sanitized } =
      user;
    return sanitized;
  }
}
