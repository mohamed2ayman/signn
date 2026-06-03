import { IsEmail, IsIn, IsOptional, IsUUID, MaxLength } from 'class-validator';

/**
 * Phase 7.18 bucket 1b-i — managing user creates an invitation for a
 * contract they can access (the create endpoint scopes ownership via
 * ContractAccessService.findInOrg).
 */
export class CreateGuestInvitationDto {
  @IsUUID()
  contract_id: string;

  @IsEmail()
  @MaxLength(255)
  invited_email: string;

  /**
   * ISO 639-1 — captured for auto-language on the recipient's landing.
   * Defaults to 'en' if absent.
   */
  @IsOptional()
  @IsIn(['en', 'ar', 'fr'])
  invited_language?: string;
}
