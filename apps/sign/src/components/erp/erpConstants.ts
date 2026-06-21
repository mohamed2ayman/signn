import type {
  ErpConnectionStatus,
  ErpSyncJobStatus,
} from '@/services/api/erpService';

/**
 * Phase 7.28 Part 2a — frontend ERP constants.
 *
 * The backend resolves the active adapter from a per-org connector REGISTRY and
 * does not (yet) expose a "list available vendors" endpoint, so the create-form
 * vendor options are listed here, mirroring the registered adapters (MOCK, SAP).
 * A future `/erp/vendors` endpoint would make this dynamic. Per-connection
 * capability detail (skeleton flag, supported domains) comes from the
 * connection's `capabilities_snapshot` once created — never hardcoded per row.
 */
export interface ErpVendorOption {
  value: string;
  labelKey: string;
  /** Prerequisite-gated skeleton (e.g. SAP) — surfaced as a warning in the form. */
  skeleton: boolean;
}

export const ERP_VENDOR_OPTIONS: ErpVendorOption[] = [
  { value: 'MOCK', labelKey: 'erp.vendor.mock', skeleton: false },
  { value: 'SAP', labelKey: 'erp.vendor.sap', skeleton: true },
];

/**
 * SIGN's neutral cost target fields — the fixed set an ERP field can map onto
 * (matches the backend `mapRawToNeutral`). `source_field` is free-text (the
 * customer's ERP-native field name); `target_field` is one of these.
 */
export const ERP_TARGET_FIELDS = [
  'cost_code',
  'wbs_ref',
  'period',
  'amount',
  'currency',
  'description',
] as const;

export type ErpTargetField = (typeof ERP_TARGET_FIELDS)[number];

/** Required neutral fields — a mapping set missing any of these can't import. */
export const ERP_REQUIRED_TARGET_FIELDS: ErpTargetField[] = [
  'cost_code',
  'amount',
  'currency',
];

/** Tailwind badge classes per connection status (neutral palette, no new tokens). */
export const CONNECTION_STATUS_BADGE: Record<ErpConnectionStatus, string> = {
  configured: 'bg-gray-100 text-gray-700',
  active: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
  disabled: 'bg-gray-100 text-gray-500',
};

/** Tailwind badge classes per sync-job status. */
export const JOB_STATUS_BADGE: Record<ErpSyncJobStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-700',
  success: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

/** A job is still in flight (drives polling) when pending or running. */
export const ACTIVE_JOB_STATUSES: ErpSyncJobStatus[] = ['pending', 'running'];

/**
 * Phase 7.28 v1.1 — operator-hold badge styling. Operator vs auto must read
 * distinctly (red vs amber); `none` is muted (no hold).
 */
export const OPERATOR_HOLD_BADGE: Record<string, string> = {
  none: 'bg-gray-100 text-gray-400',
  operator_suspended: 'bg-red-100 text-red-700',
  auto_suspended: 'bg-amber-100 text-amber-800',
};
