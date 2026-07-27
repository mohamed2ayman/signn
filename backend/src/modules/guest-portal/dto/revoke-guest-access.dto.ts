import { IsUUID } from 'class-validator';

/**
 * Guest Portal #8c Part 4a — body of
 * `POST /guest-access/:contractId/revoke`.
 *
 * The contract is in the path (it is what the host's org wall is proven
 * against); the grantee is in the body. Only the target user id is accepted —
 * there is no org id, no binding id, and nothing else a client could use to
 * widen the scope of the operation.
 */
export class RevokeGuestAccessDto {
  /** The bound counterparty whose access is being withdrawn. */
  @IsUUID()
  user_id: string;
}
