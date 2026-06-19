/**
 * Phase 7.28 — ERP connector contract (vendor-neutral spine).
 *
 * The CORE engine talks ONLY to this interface and to the capability
 * descriptor. It NEVER branches on a vendor name. Everything vendor-specific
 * (protocol, auth, API shape, field names) lives inside a concrete adapter.
 *
 * Adding a future ERP = write ONE adapter implementing `IErpConnector` +
 * register it in the connector registry. ZERO changes to the sync engine, the
 * neutral data model, the queue, or the dashboard. That is the central design
 * constraint of 7.28 (locked decision 1).
 *
 * Selection is PER-ORG at runtime — the active adapter is resolved at job time
 * from the org's `erp_connections.vendor` row via the registry, NOT from a
 * global `ERP_PROVIDER` env var (a single global driver cannot express "Org A
 * on SAP, Org B on P6" simultaneously).
 */

/** Direction of a sync. v1 is IMPORT-only; EXPORT is a capability-flagged skeleton. */
export enum ErpSyncDirection {
  IMPORT = 'import',
  EXPORT = 'export',
}

/** Data domain a sync moves. v1 imports COST; the rest are forward-looking. */
export enum ErpSyncDomain {
  COST = 'cost',
  SCHEDULE = 'schedule',
  MILESTONES = 'milestones',
  PAYMENT_TERMS = 'payment_terms',
}

/** Transport an adapter uses — descriptive metadata for UI/ops, never branched on by the core. */
export type ErpTransport = 'mock' | 'rest_api' | 'odata' | 'file_batch';

/** Auth scheme an adapter requires — descriptive metadata for UI/ops. */
export type ErpAuth = 'none' | 'api_key' | 'basic' | 'oauth2' | 'certificate';

/**
 * What an adapter declares it can do. The core reads CAPABILITIES to decide
 * which sync actions are legal for a connection — it never inspects the vendor
 * string to make that decision.
 */
export interface ErpCapabilities {
  /** Stable vendor key (e.g. 'MOCK', 'SAP'). Matches `erp_connections.vendor`. */
  vendor: string;
  /** Human-readable label for dashboards. */
  label: string;
  /** Directions this adapter supports. v1 adapters declare `[IMPORT]` only. */
  directions: ErpSyncDirection[];
  /** Data domains this adapter supports. */
  domains: ErpSyncDomain[];
  transport: ErpTransport;
  auth: ErpAuth;
  /**
   * Skeleton flag — true when the adapter is a prerequisite-gated stub that
   * throws until live creds/SDK exist (mirrors the S3/SES/Textract posture).
   * Surfaced so the UI can show "configured but not yet operational".
   */
  skeleton: boolean;
}

/**
 * Resolved, decrypted context handed to an adapter at job time INSIDE the
 * worker. Credentials are decrypted via CryptoService here and NEVER logged.
 */
export interface ErpConnectorContext {
  connectionId: string;
  /** The metering/ownership subject — the org that owns the connection row. */
  organizationId: string;
  baseUrl: string | null;
  /** Decrypted credential object (vendor-specific shape), or null when none. */
  credentials: Record<string, unknown> | null;
  domain: ErpSyncDomain;
}

/**
 * One raw record an adapter emits from the ERP. `fields` are ERP-NATIVE
 * keys/values; the engine applies the connection's field-mapping config to
 * project them onto SIGN's neutral cost shape. `externalRef` is the ERP's
 * stable id for the line (drives idempotent upsert — re-import never dups).
 */
export interface ErpRawCostRecord {
  externalRef: string;
  fields: Record<string, string | number | null>;
}

/**
 * The vendor-neutral connector contract.
 *
 * v1 implements IMPORT/cost only. Export is intentionally NOT on this
 * interface as a working method — the core must NEVER auto-write to an ERP in
 * v1 (locked decision 2). A future export capability would add a separate,
 * explicitly-gated method.
 */
export interface IErpConnector {
  readonly capabilities: ErpCapabilities;

  /**
   * Pull actual-cost records from the ERP. The core only calls this when the
   * adapter declares `ErpSyncDomain.COST` in `capabilities.domains` AND
   * `ErpSyncDirection.IMPORT` in `capabilities.directions` — the capability
   * gate runs in the engine before this is ever invoked.
   *
   * Skeleton adapters throw (prerequisite-gated) — the engine records the job
   * as FAILED with the thrown message.
   */
  importCostData(ctx: ErpConnectorContext): Promise<ErpRawCostRecord[]>;

  /**
   * Phase 7.28 v1.1 — operator force-check probe. A SIDE-EFFECTING READ: it
   * makes a real outbound call with the customer's credentials (consuming their
   * ERP rate limit) and reports reachability/health. It MUST NOT write cost data
   * — never reuse importCostData for this. Runs server-side in the worker only.
   *
   * Returns `{ ok: true }` when the connection is healthy, `{ ok: false, detail }`
   * for a soft failure. Skeleton adapters throw (prerequisite-gated) — the worker
   * treats a throw as a failed check.
   */
  healthCheck(ctx: ErpConnectorContext): Promise<{ ok: boolean; detail?: string }>;
}

/**
 * DI token for the connector registry (Symbol per the storage/email
 * interface+Symbol convention — lesson #113). Consumers inject the registry
 * via `@Inject(ERP_CONNECTOR_REGISTRY)`.
 */
export const ERP_CONNECTOR_REGISTRY = Symbol('ERP_CONNECTOR_REGISTRY');

/**
 * DI token for the array of registered connector instances. Each adapter is a
 * provider; the module's factory collects them into this array, and the
 * registry builds its vendor→adapter map from it. Adding an adapter = add the
 * provider + one entry to that factory — no change to the registry or engine.
 */
export const ERP_CONNECTORS = Symbol('ERP_CONNECTORS');

/** Registry contract — resolve an adapter by vendor, list/inspect known vendors. */
export interface IErpConnectorRegistry {
  /** Resolve the adapter for a vendor key, or throw if none is registered. */
  resolve(vendor: string): IErpConnector;
  /** True when an adapter is registered for the vendor key. */
  has(vendor: string): boolean;
  /** All registered vendor keys (drives DTO validation — no DB enum needed). */
  knownVendors(): string[];
  /** Capability descriptors for every registered adapter (drives the UI). */
  allCapabilities(): ErpCapabilities[];
  /** Capability descriptor for one vendor, or throw if unknown. */
  capabilitiesFor(vendor: string): ErpCapabilities;
}
