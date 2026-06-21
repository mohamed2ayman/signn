import api from './axios';

/**
 * Phase 7.28 Part 2a — typed client for the ERP integration endpoints (PR #79).
 *
 * All routes are org-scoped (org from JWT) + OWNER_ADMIN-gated on the backend,
 * and feature-gated: they 404 when ERP_INTEGRATION_ENABLED is off. The UI must
 * handle that 404 gracefully (see ErpConnectionsPage). Credentials are
 * WRITE-ONLY — the API never returns them, only `has_credentials`.
 */

export type ErpSyncDirection = 'import' | 'export';
export type ErpSyncDomain = 'cost' | 'schedule' | 'milestones' | 'payment_terms';
export type ErpConnectionStatus = 'configured' | 'active' | 'error' | 'disabled';
/** Phase 7.28 v1.1 — operator/system hold (distinct from the customer `enabled` switch). */
export type ErpOperatorHoldState = 'none' | 'operator_suspended' | 'auto_suspended';
export type ErpSyncJobStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed';

export interface ErpCapabilities {
  vendor: string;
  label: string;
  directions: ErpSyncDirection[];
  domains: ErpSyncDomain[];
  transport: string;
  auth: string;
  skeleton: boolean;
}

export interface ErpConnection {
  id: string;
  organization_id: string;
  vendor: string;
  name: string;
  base_url: string | null;
  capabilities_snapshot: ErpCapabilities | null;
  enabled: boolean;
  status: ErpConnectionStatus;
  // Phase 7.28 v1.1 — operator hold (present on both customer + admin list
  // responses). `hold_by_user_id` is NOT on the list response by design.
  operator_hold_state: ErpOperatorHoldState;
  hold_reason: string | null;
  hold_at: string | null;
  // Admin-list-only (Phase 7.28 v1.1 Part B). Resolved operator identity for the
  // ERP Health dashboard; absent on the customer-facing response.
  hold_by_user_id?: string | null;
  hold_by_name?: string | null;
  hold_by_email?: string | null;
  last_sync_at: string | null;
  error_message: string | null;
  /** Write-only credential indicator — the API NEVER returns the value. */
  has_credentials: boolean;
  created_at: string;
  updated_at: string;
}

export interface ErpFieldMapping {
  id: string;
  connection_id: string;
  source_field: string;
  target_field: string;
  created_at: string;
}

export interface ErpSyncJob {
  id: string;
  connection_id: string;
  organization_id: string;
  direction: ErpSyncDirection;
  domain: ErpSyncDomain;
  status: ErpSyncJobStatus;
  idempotency_key: string;
  records_processed: number;
  records_imported: number;
  records_failed: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface CreateConnectionInput {
  vendor: string;
  name: string;
  base_url?: string;
  /** Vendor-specific credential object; omitted entirely when empty. */
  credentials?: Record<string, string>;
  enabled?: boolean;
}

export interface UpdateConnectionInput {
  name?: string;
  base_url?: string | null;
  /** Supplying this REPLACES stored credentials; omit to leave them untouched. */
  credentials?: Record<string, string>;
  enabled?: boolean;
}

export interface FieldMappingInput {
  source_field: string;
  target_field: string;
}

export interface TriggerSyncResult {
  jobId: string;
  reused: boolean;
}

export const erpService = {
  listConnections: () =>
    api.get<ErpConnection[]>('/erp/connections').then((r) => r.data),

  getConnection: (id: string) =>
    api.get<ErpConnection>(`/erp/connections/${id}`).then((r) => r.data),

  createConnection: (input: CreateConnectionInput) =>
    api.post<ErpConnection>('/erp/connections', input).then((r) => r.data),

  updateConnection: (id: string, input: UpdateConnectionInput) =>
    api.patch<ErpConnection>(`/erp/connections/${id}`, input).then((r) => r.data),

  deleteConnection: (id: string) =>
    api.delete(`/erp/connections/${id}`).then((r) => r.data),

  getMappings: (id: string) =>
    api
      .get<ErpFieldMapping[]>(`/erp/connections/${id}/mappings`)
      .then((r) => r.data),

  setMappings: (id: string, mappings: FieldMappingInput[]) =>
    api
      .put<ErpFieldMapping[]>(`/erp/connections/${id}/mappings`, { mappings })
      .then((r) => r.data),

  /** Enqueue an IMPORT/COST sync (the only working path in v1). */
  triggerSync: (id: string) =>
    api
      .post<TriggerSyncResult>(`/erp/connections/${id}/sync`, {
        direction: 'import',
        domain: 'cost',
      })
      .then((r) => r.data),

  listJobs: (id: string) =>
    api.get<ErpSyncJob[]>(`/erp/connections/${id}/jobs`).then((r) => r.data),
};
