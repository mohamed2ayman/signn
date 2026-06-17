import { ErpRawCostRecord } from '../connectors/erp-connector.interface';

/** SIGN's neutral cost shape produced from a raw ERP record + field mappings. */
export interface NeutralCostRecord {
  external_ref: string;
  cost_code: string;
  wbs_ref: string | null;
  period: string | null;
  amount: number;
  currency: string;
  description: string | null;
}

/** A field-mapping pair (ERP-native source → SIGN-neutral target). */
export interface FieldMappingPair {
  source_field: string;
  target_field: string;
}

/**
 * Project a raw ERP record onto SIGN's neutral cost shape using the
 * connection's field mappings. Pure + vendor-neutral — no DB, no adapter.
 *
 * Returns null (→ the engine counts the record as failed and the job becomes
 * PARTIAL) when a REQUIRED neutral field (cost_code, amount, currency) cannot
 * be produced from the mappings. `amount` is coerced to a finite number.
 */
export function mapRawToNeutral(
  raw: ErpRawCostRecord,
  mappings: FieldMappingPair[],
): NeutralCostRecord | null {
  const neutral: Record<string, string | number | null> = {};
  for (const m of mappings) {
    if (Object.prototype.hasOwnProperty.call(raw.fields, m.source_field)) {
      neutral[m.target_field] = raw.fields[m.source_field];
    }
  }

  const costCode = neutral['cost_code'];
  const currency = neutral['currency'];
  const amountRaw = neutral['amount'];
  const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);

  if (
    costCode == null ||
    String(costCode).length === 0 ||
    currency == null ||
    String(currency).length === 0 ||
    amountRaw == null ||
    !Number.isFinite(amount)
  ) {
    return null;
  }

  return {
    external_ref: raw.externalRef,
    cost_code: String(costCode),
    wbs_ref: neutral['wbs_ref'] != null ? String(neutral['wbs_ref']) : null,
    period: neutral['period'] != null ? String(neutral['period']) : null,
    amount,
    currency: String(currency),
    description:
      neutral['description'] != null ? String(neutral['description']) : null,
  };
}
