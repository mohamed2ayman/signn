import api from './axios';

/**
 * 7.22 Slice 3 — client for the Contract Playbook CRUD shipped by Slice 1.
 *
 * ORG-SCOPED, OWNER_ADMIN-ONLY. The owning org comes from the JWT server-side
 * (`@OrganizationId()`), never from the body — so nothing here sends an
 * organization_id, and `created_by` is likewise set from the authenticated
 * principal. `RolesGuard` is EXACT-match membership, NOT a hierarchy: every
 * route below is OWNER_ADMIN and nobody else, SYSTEM_ADMIN included. Callers
 * must gate their UI on that same role or the request 403s.
 *
 * NO RESOLVER / PREVIEW ENDPOINT EXISTS. `PlaybookResolverService` (Slice 2) is
 * service-only — it is consumed by the compliance knowledge builder inside the
 * backend and is not exposed over HTTP. There is deliberately no `resolve()` or
 * `preview()` method here; adding one would need a new backend route first.
 *
 * `GET /playbook/positions` takes NO query parameters — no filtering, no
 * pagination, no `?scope=`. It returns every row for the org (INACTIVE rows
 * included) ordered `created_at DESC`. All filtering is the client's job.
 */

// ─── Enums (mirror backend/src/database/entities/playbook-position.entity.ts) ──

export type PlaybookScope = 'ORG' | 'PROJECT' | 'CONTRACT';

export type PlaybookRuleType =
  | 'RANGE'
  | 'THRESHOLD'
  | 'ENUM'
  | 'REQUIRED'
  | 'TEXT';

export type PlaybookThresholdDirection = 'AT_MOST' | 'AT_LEAST';

// ─── value_config shapes, keyed by rule_type ──────────────────────────────────
//
// `value_config` is jsonb and is ALWAYS read through `rule_type` — the pair is
// the unit of meaning and neither half is interpretable alone. The backend
// rejects UNKNOWN KEYS outright (a typo'd `{ minimum: 28 }` is a 400, not a
// silently-stored no-op), so these types are exact, not merely indicative.

/** RANGE — an acceptable band, e.g. payment terms 28–45 days. */
export interface PlaybookRangeConfig {
  min: number;
  max: number;
  unit: string;
}

/** THRESHOLD — a one-sided bound, e.g. retention AT_MOST 10 percent. */
export interface PlaybookThresholdConfig {
  direction: PlaybookThresholdDirection;
  value: number;
  unit: string;
}

/** ENUM — a closed set of acceptable values, e.g. preferred arbitration rules. */
export interface PlaybookEnumConfig {
  allowed: string[];
}

/** REQUIRED — the clause type must simply be present. Literal `true` only. */
export interface PlaybookRequiredConfig {
  required: true;
}

/** TEXT — a free-text standard position (Arabic supported per 7.22). */
export interface PlaybookTextConfig {
  text: string;
}

export type PlaybookValueConfig =
  | PlaybookRangeConfig
  | PlaybookThresholdConfig
  | PlaybookEnumConfig
  | PlaybookRequiredConfig
  | PlaybookTextConfig;

/**
 * Backend limits, mirrored so the form can enforce them BEFORE the round-trip
 * rather than surfacing a raw 400. Source of truth is
 * backend/src/modules/playbook/dto/value-config.validator.ts — if these drift,
 * the backend still wins (it re-validates every write).
 */
export const VALUE_CONFIG_LIMITS = {
  UNIT_MAX_LENGTH: 50,
  ENUM_MAX_ENTRIES: 50,
  ENUM_ENTRY_MAX_LENGTH: 200,
  TEXT_MAX_LENGTH: 5000,
} as const;

export const CLAUSE_TYPE_MAX_LENGTH = 100;
export const NOTE_MAX_LENGTH = 2000;

// ─── The row ──────────────────────────────────────────────────────────────────

/**
 * One org's standard position for one clause type, as returned by the API.
 *
 * Relations (organization / project / contract / creator) are NEVER hydrated —
 * the controller returns the bare row. Do not expect `position.project.name`.
 */
export interface PlaybookPosition {
  id: string;
  organization_id: string;
  scope: PlaybookScope;
  /** Set when scope = PROJECT (or denormalized for a CONTRACT under a project). */
  project_id: string | null;
  /** Set when scope = CONTRACT. */
  contract_id: string | null;
  /** One of the 17 standard keys, or the org's own free string. */
  clause_type: string;
  /** true = `clause_type` is org-invented, not one of the standard keys. */
  is_custom_clause_type: boolean;
  rule_type: PlaybookRuleType;
  value_config: PlaybookValueConfig;
  note: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Request bodies ───────────────────────────────────────────────────────────

/**
 * POST body. `organization_id` / `created_by` are deliberately absent — the
 * server takes both from the JWT. The global ValidationPipe runs
 * `forbidNonWhitelisted: true`, so ANY extra top-level key is a 400.
 */
export interface CreatePlaybookPositionInput {
  scope?: PlaybookScope;
  project_id?: string;
  contract_id?: string;
  clause_type: string;
  is_custom_clause_type?: boolean;
  rule_type: PlaybookRuleType;
  value_config: PlaybookValueConfig;
  note?: string;
  is_active?: boolean;
}

/**
 * PATCH body. Every field optional. An ABSENT key means "keep existing"; an
 * explicit `null` on project_id / contract_id / note CLEARS that column.
 *
 * TWO MERGE RULES THE CALLER MUST RESPECT (the service re-validates the MERGED
 * result, so a half-patch is a 400 and NOTHING is written):
 *   1. Changing `rule_type` requires sending the matching `value_config` too —
 *      switching to TEXT while a RANGE config is stored is rejected.
 *   2. Re-scoping requires sending both halves — `{ scope: 'ORG' }` alone while
 *      project_id is still set is rejected; send `{ scope: 'ORG', project_id: null }`.
 */
export interface UpdatePlaybookPositionInput {
  scope?: PlaybookScope;
  project_id?: string | null;
  contract_id?: string | null;
  clause_type?: string;
  is_custom_clause_type?: boolean;
  rule_type?: PlaybookRuleType;
  value_config?: PlaybookValueConfig;
  note?: string | null;
  is_active?: boolean;
}

// ─── Client ───────────────────────────────────────────────────────────────────

const playbookService = {
  /**
   * Every position for the caller's org, newest first. INACTIVE rows included
   * (this is the Settings surface; only the backend resolver filters is_active).
   */
  async list(): Promise<PlaybookPosition[]> {
    const { data } = await api.get<PlaybookPosition[]>('/playbook/positions');
    return data;
  },

  async getOne(id: string): Promise<PlaybookPosition> {
    const { data } = await api.get<PlaybookPosition>(`/playbook/positions/${id}`);
    return data;
  },

  async create(body: CreatePlaybookPositionInput): Promise<PlaybookPosition> {
    const { data } = await api.post<PlaybookPosition>('/playbook/positions', body);
    return data;
  },

  async update(
    id: string,
    body: UpdatePlaybookPositionInput,
  ): Promise<PlaybookPosition> {
    const { data } = await api.patch<PlaybookPosition>(
      `/playbook/positions/${id}`,
      body,
    );
    return data;
  },

  /** HARD delete (204, empty body). `is_active: false` is the soft-off switch. */
  async remove(id: string): Promise<void> {
    await api.delete(`/playbook/positions/${id}`);
  },
};

export default playbookService;
