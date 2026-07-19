import { IsUUID } from 'class-validator';

/**
 * Feature #8d — "Import to my workspace".
 *
 * The ONLY client input the import takes: which of the CALLER'S OWN projects
 * the copy lands in. The service verifies the project belongs to the caller's
 * org (404 if not — a caller must never write into another org's project).
 * Everything else (identity, the source content) comes from the server-side
 * principal + the binding-walled guest-scoped read.
 */
export class ImportSharedContractDto {
  @IsUUID()
  destinationProjectId: string;
}
