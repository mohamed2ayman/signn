import { Type } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { stripHtml } from '../../../common/utils/sanitize';

/**
 * Phase 7.18 bucket 1b-ii — captured-intent kinds.
 *
 * The recipient was reading a contract via /viewer/* and tried to do
 * something that requires durable identity. We capture WHAT they wanted
 * to do (and any draft they had typed) so the request can be resumed
 * immediately after identity creation — no "now go click that thing
 * again" friction.
 *
 * NOTE: SIGN and UPLOAD are not implemented in this bucket. Only their
 * intent is captured so the response can point to the right route once
 * the upgrade lands. See identity-creation service for the seam markers.
 */
export enum GuestIntentKind {
  COMMENT = 'COMMENT',
  SIGN = 'SIGN',
  UPLOAD = 'UPLOAD',
}

/**
 * Comment draft carried through the upgrade. Mirrors AddCommentDto so
 * the inline post on the other side has a 1:1 shape.
 */
export class GuestCommentDraftDto {
  @IsString()
  @Transform(({ value }) => stripHtml(value))
  @MinLength(1)
  @MaxLength(10_000)
  content: string;

  @IsOptional()
  @IsUUID()
  contract_clause_id?: string;

  @IsOptional()
  @IsUUID()
  parent_comment_id?: string;
}

export class GuestIntentDto {
  @IsEnum(GuestIntentKind)
  kind: GuestIntentKind;

  /**
   * Comment draft. REQUIRED when kind=COMMENT (validated at the service
   * layer because cross-field DTO validation in class-validator is
   * clunky). Ignored for SIGN/UPLOAD.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => GuestCommentDraftDto)
  comment?: GuestCommentDraftDto;
}

export class EstablishIdentityDto {
  /** Long-lived invitation token (same shape as the exchange endpoint). */
  @IsString()
  @MinLength(8)
  @MaxLength(2048)
  token: string;

  /**
   * Password the recipient is setting. SAME complexity rules as
   * AcceptInvitationDto / RegisterDto / ResetPasswordDto — never
   * weaken in isolation. See CLAUDE.md "Password Validation Policy"
   * (all six DTOs must stay in sync).
   */
  @IsString()
  @MinLength(12)
  @Matches(
    /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/,
    {
      message:
        'Password must be at least 12 characters and contain at least 1 uppercase letter, 1 number, and 1 special character',
    },
  )
  password: string;

  /**
   * Display name. Optional — defaults to "Guest" + suffix if absent.
   * Two fields so the User entity (NOT NULL on first_name + last_name)
   * stays happy without nullable migrations.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name?: string;

  /** What the recipient was trying to do that required identity. */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => GuestIntentDto)
  intent?: GuestIntentDto;
}
