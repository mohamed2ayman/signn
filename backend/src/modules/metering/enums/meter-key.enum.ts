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
