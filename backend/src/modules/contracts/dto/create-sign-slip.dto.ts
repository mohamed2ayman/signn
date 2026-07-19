import { IsUUID } from 'class-validator';

/**
 * Guest Signing v1 — host issuance body for POST /contracts/:id/sign-slips.
 * The grantee is an existing bound counterparty (guest_contract_access) —
 * the service validates the binding BEFORE creating the slip.
 */
export class CreateSignSlipDto {
  @IsUUID()
  grantee_user_id: string;
}
