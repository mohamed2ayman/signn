import { mapRawToNeutral } from '../services/erp-cost-mapper';
import { ErpRawCostRecord } from '../connectors/erp-connector.interface';

/**
 * Phase 7.28 — neutral-model field mapping (pure, vendor-neutral).
 */
const MAPPINGS = [
  { source_field: 'cost_center', target_field: 'cost_code' },
  { source_field: 'wbs', target_field: 'wbs_ref' },
  { source_field: 'value', target_field: 'amount' },
  { source_field: 'curr', target_field: 'currency' },
  { source_field: 'period', target_field: 'period' },
  { source_field: 'desc', target_field: 'description' },
];

function raw(fields: Record<string, string | number | null>): ErpRawCostRecord {
  return { externalRef: 'EXT-1', fields };
}

describe('mapRawToNeutral', () => {
  it('projects ERP-native fields onto the neutral cost shape', () => {
    const out = mapRawToNeutral(
      raw({
        cost_center: 'CC-100',
        wbs: 'WBS-1.1',
        value: 125000.5,
        curr: 'EGP',
        period: '2026-05',
        desc: 'Earthworks',
      }),
      MAPPINGS,
    );
    expect(out).toEqual({
      external_ref: 'EXT-1',
      cost_code: 'CC-100',
      wbs_ref: 'WBS-1.1',
      period: '2026-05',
      amount: 125000.5,
      currency: 'EGP',
      description: 'Earthworks',
    });
  });

  it('coerces a string amount to a finite number', () => {
    const out = mapRawToNeutral(
      raw({ cost_center: 'CC', value: '48250.00', curr: 'EGP' }),
      MAPPINGS,
    );
    expect(out?.amount).toBe(48250);
  });

  it('returns null when a required field (cost_code) is unmapped/absent', () => {
    const out = mapRawToNeutral(
      raw({ value: 100, curr: 'EGP' }), // no cost_center
      MAPPINGS,
    );
    expect(out).toBeNull();
  });

  it('returns null when amount is missing', () => {
    const out = mapRawToNeutral(
      raw({ cost_center: 'CC', curr: 'EGP' }),
      MAPPINGS,
    );
    expect(out).toBeNull();
  });

  it('returns null when amount is non-numeric', () => {
    const out = mapRawToNeutral(
      raw({ cost_center: 'CC', value: 'not-a-number', curr: 'EGP' }),
      MAPPINGS,
    );
    expect(out).toBeNull();
  });

  it('leaves optional fields null when unmapped, ignores extra ERP fields', () => {
    const out = mapRawToNeutral(
      raw({ cost_center: 'CC', value: 10, curr: 'USD', junk_field: 'ignored' }),
      MAPPINGS,
    );
    expect(out).toEqual({
      external_ref: 'EXT-1',
      cost_code: 'CC',
      wbs_ref: null,
      period: null,
      amount: 10,
      currency: 'USD',
      description: null,
    });
  });
});
