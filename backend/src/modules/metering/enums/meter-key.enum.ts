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
