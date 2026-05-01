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
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

import {
  User,
  UserRole,
  Organization,
  SubscriptionPlan,
  OrganizationSubscription,
  SubscriptionStatus,
} from '../../database/entities';
import { EmailService } from '../notifications/email.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { SessionService } from '../admin-security/services/session.service';
import { KnownDeviceService } from '../admin-security/services/known-device.service';
import { SuspiciousLoginService } from '../admin-security/services/suspicious-login.service';
import { GeoLookupService } from '../admin-security/services/geo-lookup.service';
import { UserAgentService } from '../admin-security/services/user-agent.service';
import { SecurityEventService } from '../admin-security/services/security-event.service';
import { SECURITY_EVENT_TYPES } from '../../common/enums/security-event-types';
import { baseEmailLayout } from '../notifications/templates/base-layout';
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
const RECOVERY_CODE_COUNT = 8;

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
    private readonly dispatch: NotificationDispatchService,
    private readonly sessions: SessionService,
    private readonly devices: KnownDeviceService,
    private readonly suspicious: SuspiciousLoginService,
    private readonly geo: GeoLookupService,
    private readonly ua: UserAgentService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  // ─── Phase 3.3: post-login session + suspicious detection ─────

  /**
   * Called immediately after a refresh token is issued on any successful
   * login path (register, login, verifyMfa, acceptInvitation, refresh).
   * Creates a UserSession row, evaluates suspicious-login signals,
   * upserts the known-device record, and emails the user if the
   * device is new. Best-effort: errors are logged but never thrown.
   */
  private async _finalizeLogin(input: {
    user: User;
    refreshToken: string;
    ip?: string | null;
    userAgent?: string | null;
    /** Pass already-known failure count to skip a query. */
    recentFailureCount?: number;
  }): Promise<void> {
    try {
      const ip = input.ip ?? null;
      const ua = input.userAgent ?? null;
      const parsed = this.ua.parse(ua);
      const geo = this.geo.lookup(ip);

      const evaluation = await this.suspicious.evaluate({
        user_id: input.user.id,
        ip,
        country_code: geo.country_code,
        recent_failure_count: input.recentFailureCount ?? 0,
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await this.sessions.create({
        user_id: input.user.id,
        rawJwt: input.refreshToken,
        ip_address: ip,
        user_agent: ua,
        browser: parsed.browser,
        os: parsed.os,
        device_type: parsed.device_type,
        location: geo.pretty,
        country_code: geo.country_code,
        is_suspicious: evaluation.is_suspicious,
        suspicious_reason: evaluation.reason,
        expires_at: expiresAt,
      });

      const deviceResult = await this.devices.upsert({
        user_id: input.user.id,
        ip,
        country_code: geo.country_code,
        browser: parsed.browser,
        os: parsed.os,
      });

      await this.securityEvents.record({
        type: SECURITY_EVENT_TYPES.LOGIN_SUCCESS,
        actor_id: input.user.id,
        user_id: input.user.id,
        organization_id: input.user.organization_id ?? null,
        ip_address: ip,
        metadata: {
          country: geo.country_code,
          browser: parsed.browser,
          os: parsed.os,
          suspicious: evaluation.is_suspicious,
          suspicious_reason: evaluation.reason,
          new_device: deviceResult.isNew,
        },
      });

      if (evaluation.is_suspicious) {
        await this.securityEvents.record({
          type: SECURITY_EVENT_TYPES.SUSPICIOUS_LOGIN,
          actor_id: input.user.id,
          user_id: input.user.id,
          organization_id: input.user.organization_id ?? null,
          ip_address: ip,
          metadata: { reason: evaluation.reason, location: geo.pretty },
        });
      }

      // Email user if this is a brand-new device combination
      if (deviceResult.isNew) {
        try {
          await this.dispatch.enqueueEmail({
            to: input.user.email,
            subject: evaluation.is_suspicious
              ? 'Suspicious sign-in detected'
              : 'New device sign-in to your Sign account',
            html: this._renderNewDeviceEmail({
              recipientName: input.user.first_name || input.user.email,
              browser: parsed.browser,
              os: parsed.os,
              location: geo.pretty ?? 'Unknown location',
              ip: ip || 'unknown',
              suspiciousReason: evaluation.is_suspicious ? evaluation.reason : null,
              when: new Date().toUTCString(),
            }),
            templateName: 'new_device_login',
          });
        } catch (err) {
          this.logger.error(
            `Failed to send new-device email: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `_finalizeLogin failed for user ${input.user.id}: ${(err as Error).message}`,
      );
    }
  }

  private _renderNewDeviceEmail(data: {
    recipientName: string;
    browser: string | null;
    os: string | null;
    location: string;
    ip: string;
    suspiciousReason: string | null;
    when: string;
  }): string {
    const banner = data.suspiciousReason
      ? `<div style="background:#FEF2F2; border-left:3px solid #DC2626; padding:12px 16px; border-radius:0 8px 8px 0; margin:12px 0;"><p style="margin:0; font-size:13px; color:#991B1B; font-weight:600;">⚠ Flagged as ${data.suspiciousReason.replace(/_/g, ' ').toLowerCase()}</p></div>`
      : '';
    const content = `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">${data.suspiciousReason ? 'Suspicious Sign-In' : 'New Device Sign-In'}</h1>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">Hi ${data.recipientName}, your account was just signed in from a device we haven't seen before.</p>
      ${banner}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFF; border-radius:10px; margin:20px 0;">
        <tr><td style="padding:10px 16px;"><span style="font-size:12px; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px;">When</span><br/><span style="font-size:14px; color:#0F1729; font-weight:600;">${data.when}</span></td></tr>
        <tr><td style="padding:10px 16px;"><span style="font-size:12px; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px;">Device</span><br/><span style="font-size:14px; color:#0F1729; font-weight:600;">${data.browser ?? 'Unknown browser'} on ${data.os ?? 'unknown OS'}</span></td></tr>
        <tr><td style="padding:10px 16px;"><span style="font-size:12px; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px;">Location</span><br/><span style="font-size:14px; color:#0F1729; font-weight:600;">${data.location}</span></td></tr>
        <tr><td style="padding:10px 16px;"><span style="font-size:12px; color:#6B7280; text-transform:uppercase; letter-spacing:0.5px;">IP</span><br/><span style="font-size:14px; color:#0F1729; font-weight:600; font-family:monospace;">${data.ip}</span></td></tr>
      </table>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">If this was you, no action is needed. If you don't recognize this sign-in, change your password and revoke other sessions immediately from your security settings.</p>
    `;
    return baseEmailLayout(content, { preheader: 'New device signed in to your Sign account' });
  }

  /** Records a failed login attempt as a security event. Best-effort. */
  private async _recordLoginFailure(input: {
    email: string;
    ip: string | null;
    user_agent: string | null;
    user_id?: string | null;
  }): Promise<void> {
    try {
      await this.securityEvents.record({
        type: SECURITY_EVENT_TYPES.LOGIN_FAILED,
        user_id: input.user_id ?? null,
        ip_address: input.ip,
        metadata: { email: input.email, user_agent: input.user_agent },
      });
    } catch {
      // ignore
    }
  }

  async register(dto: RegisterDto, ctx: { ip?: string | null; user_agent?: string | null } = {}) {
    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id: dto.plan_id },
    });
    if (!plan) {
      throw new BadRequestException('Invalid subscription plan');
    }

    const passwordHash = await this.hashData(dto.password);

    const organization = this.organizationRepository.create({
      name: dto.organization_name,
      industry: dto.industry,
      country: dto.country,
    });
    const savedOrganization =
      await this.organizationRepository.save(organization);

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

    const tokens = await this.generateTokens(savedUser);

    const refreshTokenHash = await this.hashData(tokens.refresh_token);
    await this.userRepository.update(savedUser.id, {
      refresh_token_hash: refreshTokenHash,
      password_changed_at: new Date(),
    });

    await this._finalizeLogin({
      user: savedUser,
      refreshToken: tokens.refresh_token,
      ip: ctx.ip ?? null,
      userAgent: ctx.user_agent ?? null,
    });

    return {
      user: this.sanitizeUser(savedUser),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async login(dto: LoginDto, ctx: { ip?: string | null; user_agent?: string | null } = {}) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.is_active) {
      throw new ForbiddenException('Account has been deactivated');
    }

    if (user.locked_until && user.locked_until > new Date()) {
      const remainingMinutes = Math.ceil(
        (user.locked_until.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(
        `Account is locked due to too many failed login attempts. Try again in ${remainingMinutes} minute(s).`,
      );
    }

    const isPasswordValid = await this.validatePassword(
      dto.password,
      user.password_hash,
    );

    if (!isPasswordValid) {
      const failedAttempts = user.failed_login_attempts + 1;
      const updateData: Record<string, any> = {
        failed_login_attempts: failedAttempts,
      };

      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_DURATION_MINUTES);
        updateData.locked_until = lockUntil;
        this.logger.warn(
          `Account locked for user ${user.email} after ${failedAttempts} failed attempts`,
        );
      }

      await this.userRepository.update(user.id, updateData as any);
      await this._recordLoginFailure({
        email: dto.email,
        ip: ctx.ip ?? null,
        user_agent: ctx.user_agent ?? null,
        user_id: user.id,
      });
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        await this.securityEvents.record({
          type: SECURITY_EVENT_TYPES.ACCOUNT_LOCKED,
          actor_id: user.id,
          user_id: user.id,
          ip_address: ctx.ip ?? null,
          metadata: { failed_attempts: failedAttempts },
        });
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.userRepository.update(user.id, {
      failed_login_attempts: 0,
      locked_until: null as unknown as Date,
    });

    // Check if MFA is enabled for this user
    if (user.mfa_enabled) {
      if (user.mfa_method === 'totp') {
        // For TOTP, user enters code from authenticator app — no email OTP needed
        return {
          requires_mfa: true,
          mfa_method: 'totp',
          email: user.email,
        };
      } else {
        // Email OTP: generate and send
        const otpCode = this.generateOtp();
        const otpHash = await this.hashData(otpCode);
        const otpTimestamp = Date.now().toString();
        await this.userRepository.update(user.id, {
          mfa_secret: `${otpHash}|${otpTimestamp}`,
        });
        await this.emailService.sendMfaOtp(user.email, otpCode);

        return {
          requires_mfa: true,
          mfa_method: 'email',
          email: user.email,
        };
      }
    }

    // Check if org's subscription plan requires MFA
    if (user.organization_id) {
      const requiresMfaSetup = await this.checkPlanRequiresMfa(
        user.organization_id,
      );
      if (requiresMfaSetup) {
        // Issue full tokens but flag that MFA setup is required
        const tokens = await this.generateTokens(user);
        const refreshTokenHash = await this.hashData(tokens.refresh_token);
        await this.userRepository.update(user.id, {
          last_login_at: new Date(),
          refresh_token_hash: refreshTokenHash,
        });
        await this._finalizeLogin({
          user,
          refreshToken: tokens.refresh_token,
          ip: ctx.ip ?? null,
          userAgent: ctx.user_agent ?? null,
        });
        return {
          user: this.sanitizeUser(user),
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          requires_mfa_setup: true,
        };
      }
    }

    const tokens = await this.generateTokens(user);

    const refreshTokenHash = await this.hashData(tokens.refresh_token);
    await this.userRepository.update(user.id, {
      last_login_at: new Date(),
      refresh_token_hash: refreshTokenHash,
    });

    await this._finalizeLogin({
      user,
      refreshToken: tokens.refresh_token,
      ip: ctx.ip ?? null,
      userAgent: ctx.user_agent ?? null,
    });

    return {
      user: this.sanitizeUser(user),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async verifyMfa(dto: VerifyMfaDto, ctx: { ip?: string | null; user_agent?: string | null } = {}) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid verification request');
    }

    if (user.mfa_method === 'totp') {
      // TOTP verification
      if (!user.mfa_totp_secret) {
        throw new UnauthorizedException('TOTP not configured');
      }
      const isValid = authenticator.verify({
        token: dto.otp_code,
        secret: user.mfa_totp_secret,
      });
      if (!isValid) {
        throw new UnauthorizedException('Invalid authenticator code');
      }
    } else {
      // Email OTP verification
      if (!user.mfa_secret) {
        throw new UnauthorizedException('No MFA verification pending');
      }

      const separatorIndex = user.mfa_secret.lastIndexOf('|');
      if (separatorIndex === -1) {
        throw new UnauthorizedException('Invalid MFA state');
      }

      const otpHash = user.mfa_secret.substring(0, separatorIndex);
      const otpTimestamp = user.mfa_secret.substring(separatorIndex + 1);

      const otpIssueTime = parseInt(otpTimestamp, 10);
      const elapsed = Date.now() - otpIssueTime;
      if (elapsed > OTP_VALIDITY_MINUTES * 60 * 1000) {
        throw new UnauthorizedException('OTP has expired. Please login again.');
      }

      const isOtpValid = await this.validatePassword(dto.otp_code, otpHash);
      if (!isOtpValid) {
        throw new UnauthorizedException('Invalid OTP code');
      }
    }

    const tokens = await this.generateTokens(user);

    const refreshTokenHash = await this.hashData(tokens.refresh_token);
    await this.userRepository.update(user.id, {
      mfa_secret: null as unknown as string,
      last_login_at: new Date(),
      refresh_token_hash: refreshTokenHash,
    });

    await this._finalizeLogin({
      user,
      refreshToken: tokens.refresh_token,
      ip: ctx.ip ?? null,
      userAgent: ctx.user_agent ?? null,
    });

    return {
      user: this.sanitizeUser(user),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async verifyRecoveryCode(email: string, recoveryCode: string, ctx: { ip?: string | null; user_agent?: string | null } = {}) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user || !user.mfa_enabled) {
      throw new UnauthorizedException('Invalid recovery request');
    }

    if (!user.mfa_recovery_codes || user.mfa_recovery_codes.length === 0) {
      throw new UnauthorizedException('No recovery codes available');
    }

    // Find matching recovery code
    let matchIndex = -1;
    for (let i = 0; i < user.mfa_recovery_codes.length; i++) {
      const isMatch = await this.validatePassword(
        recoveryCode.trim().toUpperCase(),
        user.mfa_recovery_codes[i],
      );
      if (isMatch) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) {
      throw new UnauthorizedException('Invalid recovery code');
    }

    // Remove the used recovery code (single-use)
    const updatedCodes = user.mfa_recovery_codes.filter(
      (_, i) => i !== matchIndex,
    );

    const tokens = await this.generateTokens(user);
    const refreshTokenHash = await this.hashData(tokens.refresh_token);

    await this.userRepository.update(user.id, {
      mfa_secret: null as unknown as string,
      mfa_recovery_codes: updatedCodes.length > 0 ? updatedCodes : null as unknown as string[],
      last_login_at: new Date(),
      refresh_token_hash: refreshTokenHash,
    });

    await this._finalizeLogin({
      user,
      refreshToken: tokens.refresh_token,
      ip: ctx.ip ?? null,
      userAgent: ctx.user_agent ?? null,
    });

    return {
      user: this.sanitizeUser(user),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      recovery_codes_remaining: updatedCodes.length,
    };
  }

  // ─── MFA Settings ─────────────────────────────────────────────

  async getMfaStatus(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    let requiresMfaSetup = false;
    if (user.organization_id) {
      requiresMfaSetup = await this.checkPlanRequiresMfa(user.organization_id);
    }

    return {
      mfa_enabled: user.mfa_enabled,
      mfa_method: user.mfa_method,
      recovery_codes_count: user.mfa_recovery_codes?.length ?? 0,
      requires_mfa_setup: requiresMfaSetup && !user.mfa_enabled,
    };
  }

  async setupMfaTotp(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    // Generate a new TOTP secret
    const secret = authenticator.generateSecret();
    const appName = 'SIGN Platform';
    const otpauthUri = authenticator.keyuri(user.email, appName, secret);

    // Store secret temporarily (will be confirmed on enable)
    await this.userRepository.update(userId, {
      mfa_totp_secret: secret,
    });

    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

    return {
      secret,
      otpauth_uri: otpauthUri,
      qr_code: qrCodeDataUrl,
    };
  }

  async enableMfaTotp(userId: string, totpCode: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    if (!user.mfa_totp_secret) {
      throw new BadRequestException(
        'TOTP setup not initiated. Call /auth/mfa/setup/totp first.',
      );
    }

    // Verify the TOTP code to confirm the user has scanned it correctly
    const isValid = authenticator.verify({
      token: totpCode,
      secret: user.mfa_totp_secret,
    });
    if (!isValid) {
      throw new BadRequestException(
        'Invalid TOTP code. Make sure you scanned the QR code correctly.',
      );
    }

    const recoveryCodes = await this.generateRecoveryCodes();

    await this.userRepository.update(userId, {
      mfa_enabled: true,
      mfa_method: 'totp',
      mfa_recovery_codes: recoveryCodes.hashed,
    });

    await this.emailService.sendMfaRecoveryCodes(
      user.email,
      recoveryCodes.plain,
      'totp',
    );

    return {
      message: 'MFA enabled with authenticator app',
      recovery_codes: recoveryCodes.plain,
    };
  }

  async enableMfaEmail(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    if (user.mfa_enabled) {
      throw new BadRequestException('MFA is already enabled');
    }

    const recoveryCodes = await this.generateRecoveryCodes();

    await this.userRepository.update(userId, {
      mfa_enabled: true,
      mfa_method: 'email',
      mfa_recovery_codes: recoveryCodes.hashed,
    });

    await this.emailService.sendMfaRecoveryCodes(
      user.email,
      recoveryCodes.plain,
      'email',
    );

    return {
      message: 'MFA enabled with email OTP',
      recovery_codes: recoveryCodes.plain,
    };
  }

  async disableMfa(userId: string, password: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    if (!user.mfa_enabled) {
      throw new BadRequestException('MFA is not enabled');
    }

    // Require password confirmation for security
    const isPasswordValid = await this.validatePassword(
      password,
      user.password_hash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Incorrect password');
    }

    await this.userRepository.update(userId, {
      mfa_enabled: false,
      mfa_method: null as unknown as string,
      mfa_totp_secret: null as unknown as string,
      mfa_secret: null as unknown as string,
      mfa_recovery_codes: null as unknown as string[],
    });

    return { message: 'MFA disabled successfully' };
  }

  // ─── Admin MFA Management ──────────────────────────────────────

  async adminResetUserMfa(adminUserId: string, targetUserId: string) {
    // Verify admin
    const admin = await this.userRepository.findOne({
      where: { id: adminUserId },
    });
    if (
      !admin ||
      (admin.role !== UserRole.SYSTEM_ADMIN && admin.role !== UserRole.OPERATIONS)
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const user = await this.userRepository.findOne({
      where: { id: targetUserId },
    });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    await this.userRepository.update(targetUserId, {
      mfa_enabled: false,
      mfa_method: null as unknown as string,
      mfa_totp_secret: null as unknown as string,
      mfa_secret: null as unknown as string,
      mfa_recovery_codes: null as unknown as string[],
    });

    this.logger.log(
      `Admin ${admin.email} reset MFA for user ${user.email}`,
    );

    return { message: `MFA reset for user ${user.email}` };
  }

  // ─── Auth Helpers ──────────────────────────────────────────────

  async refreshToken(refreshToken: string, ctx: { ip?: string | null; user_agent?: string | null } = {}) {
    let payload: { sub: string; email: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });
    if (!user || !user.is_active) {
      throw new UnauthorizedException('User not found or inactive');
    }

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

    const tokens = await this.generateTokens(user);

    const refreshTokenHash = await this.hashData(tokens.refresh_token);
    await this.userRepository.update(user.id, {
      refresh_token_hash: refreshTokenHash,
    });

    // Revoke the old session and create a new one — keeps UserSession
    // table in sync with the actual valid refresh token.
    await this.sessions.revokeByToken(refreshToken);
    await this._finalizeLogin({
      user,
      refreshToken: tokens.refresh_token,
      ip: ctx.ip ?? null,
      userAgent: ctx.user_agent ?? null,
    });

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async logout(userId: string, ctx: { ip?: string | null; refreshToken?: string | null } = {}) {
    if (ctx.refreshToken) {
      await this.sessions.revokeByToken(ctx.refreshToken);
    } else {
      await this.sessions.revokeAllForUser(userId);
    }
    await this.securityEvents.record({
      type: SECURITY_EVENT_TYPES.LOGOUT,
      actor_id: userId,
      user_id: userId,
      ip_address: ctx.ip ?? null,
    });
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

    const updatedUser = await this.userRepository.findOne({
      where: { id: user.id },
    });

    const tokens = await this.generateTokens(updatedUser!);

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

  // ─── Private Helpers ───────────────────────────────────────────

  private async checkPlanRequiresMfa(organizationId: string): Promise<boolean> {
    const subscription = await this.orgSubscriptionRepository.findOne({
      where: {
        organization_id: organizationId,
        status: SubscriptionStatus.ACTIVE,
      },
      relations: ['plan'],
    });
    return subscription?.plan?.require_mfa ?? false;
  }

  private async generateRecoveryCodes(): Promise<{
    plain: string[];
    hashed: string[];
  }> {
    const plain: string[] = [];
    const hashed: string[] = [];

    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      // Format: XXXX-XXXX (8 uppercase hex chars with dash)
      const code =
        crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4) +
        '-' +
        crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4);
      plain.push(code);
      hashed.push(await this.hashData(code));
    }

    return { plain, hashed };
  }

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
    const {
      password_hash,
      mfa_secret,
      mfa_totp_secret,
      mfa_recovery_codes,
      refresh_token_hash,
      ...sanitized
    } = user;
    return sanitized;
  }
}
