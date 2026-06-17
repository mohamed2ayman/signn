import { IsEnum, IsOptional } from 'class-validator';
import {
  ErpSyncDirection,
  ErpSyncDomain,
} from '../connectors/erp-connector.interface';

/**
 * Phase 7.28 — POST /erp/connections/:id/sync body.
 *
 * Defaults to IMPORT/COST (the only working path in v1). The service runs the
 * capability gate against the connection's adapter, so an unsupported
 * direction/domain (e.g. EXPORT) is rejected with a clear error rather than
 * silently attempted — the core NEVER auto-writes to an ERP in v1.
 */
export class TriggerSyncDto {
  @IsOptional()
  @IsEnum(ErpSyncDirection)
  direction?: ErpSyncDirection;

  @IsOptional()
  @IsEnum(ErpSyncDomain)
  domain?: ErpSyncDomain;
}
