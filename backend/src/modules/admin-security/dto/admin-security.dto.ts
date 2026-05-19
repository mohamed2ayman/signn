import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Profile ──────────────────────────────────────────────

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(100) first_name?: string;
  @IsOptional() @IsString() @MaxLength(100) last_name?: string;
  @IsOptional() @IsString() @MaxLength(100) job_title?: string;
  @IsOptional() @IsString() @Length(2, 5) preferred_language?: string;
}

const PW_REGEX =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/;
const PW_MESSAGE =
  'Password must be at least 12 characters and contain at least 1 uppercase letter, 1 number, and 1 special character';

export class ChangePasswordDto {
  @IsString() @MaxLength(128) current_password: string;
  @IsString() @Length(12, 128) @Matches(PW_REGEX, { message: PW_MESSAGE }) new_password: string;
}

export class UpdateCommunicationPreferencesDto {
  @IsOptional() @IsBoolean() marketing_email_opt_in?: boolean;
  @IsOptional() @IsBoolean() email_digest_opt_out?: boolean;
  @IsOptional() @IsBoolean() ai_training_opt_in?: boolean;
}

// ─── Security Policy ──────────────────────────────────────

export class UpdateSecurityPolicyDto {
  @IsOptional() @IsInt() @Min(5) @Max(1440) session_timeout_minutes?: number;

  @IsOptional() @IsInt() @Min(6) @Max(128) password_min_length?: number;
  @IsOptional() @IsBoolean() password_require_upper?: boolean;
  @IsOptional() @IsBoolean() password_require_lower?: boolean;
  @IsOptional() @IsBoolean() password_require_number?: boolean;
  @IsOptional() @IsBoolean() password_require_symbol?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(3650) password_expiry_days?: number;
  @IsOptional() @IsInt() @Min(0) @Max(20) password_history_count?: number;

  @IsOptional() @IsInt() @Min(0) @Max(20) lockout_max_attempts?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) lockout_duration_minutes?: number;

  @IsOptional() @IsBoolean() mfa_required_admins?: boolean;
  @IsOptional() @IsBoolean() mfa_required_owners?: boolean;
  @IsOptional() @IsBoolean() mfa_required_all?: boolean;

  @IsOptional() @IsBoolean() ip_filter_enabled?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true })
  ip_allowlist?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true })
  ip_blocklist?: string[];
}

// ─── User MFA / Sessions ──────────────────────────────────

export class SendMfaReminderDto {
  @IsString() user_id: string;
}

// ─── GDPR ─────────────────────────────────────────────────

export class GdprDeleteDto {
  /** Must equal the target user's email exactly. */
  @IsString() confirmation: string;
}

// ─── Audit log queries ────────────────────────────────────

export class AuditLogQueryDto {
  @IsOptional() @IsString() actor_id?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() entity_type?: string;
  @IsOptional() @IsString() target_user_id?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
