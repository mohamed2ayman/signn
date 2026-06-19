import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Phase 7.28 v1.1 — required reason for every SYSTEM_ADMIN operator action
 * (suspend / unsuspend / force-check / guarded-delete). Mirrors
 * SuspendOrganizationDto — the reason is written to the immutable audit log.
 */
export class ErpOperatorReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
