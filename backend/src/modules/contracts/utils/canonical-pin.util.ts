import * as crypto from 'crypto';
import { Contract } from '../../../database/entities/contract.entity';
import { ContractClause } from '../../../database/entities/contract-clause.entity';

/**
 * Signed-state pinning — canonical payload + serializer (Slice 1, CAPTURE).
 *
 * ONE canonical serializer produces BOTH the stored pinned record
 * (ContractVersion.metadata.pin_payload) and the bytes that are SHA-256
 * hashed (ContractVersion.content_hash / contracts.pinned_content_hash).
 *
 * Determinism rules:
 *  - Object keys are serialized in SORTED order, recursively — so the hash
 *    never depends on JS property-insertion order OR on Postgres jsonb
 *    round-trips (jsonb does not preserve key order; it DOES preserve array
 *    order, which carries the clause ordering).
 *  - Clause order in the payload array follows the shared ordering
 *    expression (lesson #214: document priority → document upload order →
 *    order_index → id) — the caller passes clauses already in that order.
 *  - Values are normalized to strings/numbers/null before serialization
 *    (decimal columns round-trip as strings from TypeORM; date columns as
 *    'YYYY-MM-DD' strings) so live-recompute and stored-recompute agree.
 *
 * The freeze set is SUBSTANTIVE LEGAL CONTENT only. Volatile / operational
 * fields (status, signature_status, signature_signers, docusign_envelope_id,
 * approved_at / shared_at / executed_at / created_at / updated_at, user ids,
 * annotation-tracking fields) are deliberately EXCLUDED — they legitimately
 * change during and after signing and must not perturb the hash.
 */

export interface PinPayloadClause {
  section_number: string | null;
  title: string;
  content: string;
  order_index: number;
}

export interface PinPayloadMetadata {
  name: string;
  contract_type: string;
  party_type: string | null;
  party_first_name: string | null;
  party_second_name: string | null;
  contract_value: string | null;
  currency: string | null;
  start_date: string | null;
  end_date: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  notice_period_days: number | null;
  defects_liability_period_days: number | null;
}

export interface PinPayload {
  schema: 'sign.pin.v1';
  contract_id: string;
  metadata: PinPayloadMetadata;
  clauses: PinPayloadClause[];
}

/** Normalize a date-ish DB value ('date' columns round-trip as string OR Date). */
function normalizeDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/** Normalize decimal columns (TypeORM returns string; tests may pass number). */
function normalizeDecimal(value: number | string | null | undefined): string | null {
  if (value == null) return null;
  return String(value);
}

/**
 * Build the canonical pin payload from a live contract + its clause set.
 * `orderedClauses` MUST be the live (is_proposed=false) clauses in the shared
 * ordering expression (lesson #214) with the `clause` relation loaded.
 */
export function buildPinPayload(
  contract: Contract,
  orderedClauses: ContractClause[],
): PinPayload {
  return {
    schema: 'sign.pin.v1',
    contract_id: contract.id,
    metadata: {
      name: contract.name,
      contract_type: contract.contract_type,
      party_type: contract.party_type ?? null,
      party_first_name: contract.party_first_name ?? null,
      party_second_name: contract.party_second_name ?? null,
      contract_value: normalizeDecimal(contract.contract_value),
      currency: contract.currency ?? null,
      start_date: normalizeDate(contract.start_date),
      end_date: normalizeDate(contract.end_date),
      effective_date: normalizeDate(contract.effective_date),
      expiry_date: normalizeDate(contract.expiry_date),
      notice_period_days: contract.notice_period_days ?? null,
      defects_liability_period_days:
        contract.defects_liability_period_days ?? null,
    },
    clauses: orderedClauses.map((cc) => ({
      section_number: cc.section_number ?? null,
      title: cc.clause?.title ?? '',
      content: cc.clause?.content ?? '',
      order_index: cc.order_index,
    })),
  };
}

/**
 * Deterministic JSON serialization: recursively sorts object keys.
 * Arrays keep their order (that is where clause ordering lives).
 */
export function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalSerialize(v)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${canonicalSerialize((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(',')}}`;
}

/** SHA-256 hex over the canonical serialization (the ONLY hashing path). */
export function computePinHash(payload: PinPayload): string {
  return crypto
    .createHash('sha256')
    .update(canonicalSerialize(payload), 'utf8')
    .digest('hex');
}
