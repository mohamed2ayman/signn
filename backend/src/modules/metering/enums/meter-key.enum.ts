/**
 * Phase 7.18 — Metering Primitive: closed enum of meter keys.
 *
 * String values match the PG enum `meter_key_enum` (snake_case) created by
 * migration 1753000000001. Adding a value here without a matching ALTER TYPE
 * migration will fail at runtime when the column writes.
 *
 * NEVER pass a string into the meter API — always pass `MeterKey.X`. Closed
 * set is the discipline.
 */
export enum MeterKey {
  COMPLIANCE = 'compliance',
  RISK = 'risk',
  AI_ASSISTANT_MESSAGE = 'ai_assistant_message',
  UPLOAD_EXTRACTION = 'upload_extraction',
  // Phase 7.18 — finalize-review consumer. The finalize-review action
  // dispatches a 3-agent burst (risk + obligations + conflict-detection);
  // per Ayman's decision it is metered as ONE charge covering the whole
  // burst, NOT per-agent. ADDITIVE enum value only — the engine
  // (resolver / reserve / commit / release / sweeper) treats this exactly
  // like compliance + upload_extraction (per_contract / closed); NO engine
  // logic changes for this key. The matching PG `meter_key_enum` ALTER TYPE
  // ADD VALUE lands in migration 1756000000001.
  //
  // NOTE: `RISK` above now has NO consumer — the on-demand /ai/risk-analysis
  // route is UI-dead + result-orphaned (recon: docs/metering-risk-recon.md),
  // and finalize-review charges `finalize_review`, not `risk`. `RISK` stays
  // in the enum as RESERVED; do NOT remove it.
  FINALIZE_REVIEW = 'finalize_review',
  // Feature #4 — guest upload of a new contract version. A SEPARATE meter
  // from `upload_extraction` so a guest's metered usage is capped/attributed
  // independently and does NOT consume the host's managing upload quota.
  // BILLING/ATTRIBUTION only: the 5/day-per-contract daily cap is enforced
  // at the route layer (advisory-lock count-and-create), NOT by this meter —
  // the metering engine has no daily window (see metering-resolver
  // computeWindowKey). ADDITIVE enum value only; the engine treats it exactly
  // like upload_extraction (per_contract / closed). The matching PG
  // `meter_key_enum` ALTER TYPE ADD VALUE lands in migration 1761000000001.
  GUEST_UPLOAD = 'guest_upload',
  // Guest chat Slice 1 — guest AI questions about the bound contract. A
  // SEPARATE meter from `ai_assistant_message` so a guest's metered usage is
  // capped/attributed independently and does NOT consume the host's managing
  // AI quota. BILLING/ATTRIBUTION only: the 20/day-per-contract daily cap is
  // enforced at the route layer (atomic conditional UPSERT in
  // GuestChatService, the guest_upload idiom), NOT by this meter — the
  // metering engine has no daily window (see metering-resolver
  // computeWindowKey). ADDITIVE enum value only; the engine treats it exactly
  // like guest_upload (per_contract / closed). The matching PG
  // `meter_key_enum` ALTER TYPE ADD VALUE lands in migration 1763000000001.
  GUEST_AI_QUERY = 'guest_ai_query',
}

export enum MeterWindowType {
  ROLLING = 'rolling',
  CALENDAR_PERIOD = 'calendar_period',
  PER_CONTRACT = 'per_contract',
  LIFETIME = 'lifetime',
}

export enum MeterFailMode {
  CLOSED = 'closed',
  OPEN = 'open',
}

export enum MeterLedgerStatus {
  RESERVED = 'reserved',
  COMMITTED = 'committed',
  RELEASED = 'released',
}
