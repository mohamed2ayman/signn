import {
  bucketContractStatus,
  bucketStandardForm,
  pctChange,
  CONTRACT_STATUS_BUCKETS,
} from '../portfolio-analytics.service';
import { ContractStatus, ContractType } from '../../../database/entities';

// Phase 7.17 Prompt 2a — pure-helper coverage (no DI / no DB).

describe('PortfolioAnalytics pure helpers', () => {
  describe('bucketContractStatus (Decision D1 — 12 statuses → 6 buckets)', () => {
    const cases: Array<[ContractStatus, string]> = [
      [ContractStatus.DRAFT, 'DRAFT'],
      [ContractStatus.PENDING_APPROVAL, 'IN_APPROVAL'],
      [ContractStatus.APPROVED, 'IN_APPROVAL'],
      [ContractStatus.PENDING_FINAL_APPROVAL, 'IN_APPROVAL'],
      [ContractStatus.CHANGES_REQUESTED, 'IN_APPROVAL'],
      [ContractStatus.RISK_ESCALATION_PENDING, 'IN_APPROVAL'],
      [ContractStatus.PENDING_TENDERING, 'WITH_COUNTERPARTY'],
      [ContractStatus.SENT_TO_CONTRACTOR, 'WITH_COUNTERPARTY'],
      [ContractStatus.CONTRACTOR_REVIEWING, 'WITH_COUNTERPARTY'],
      [ContractStatus.ACTIVE, 'ACTIVE'],
      [ContractStatus.COMPLETED, 'COMPLETED'],
      [ContractStatus.TERMINATED, 'TERMINATED'],
    ];

    it.each(cases)('maps %s → %s', (status, bucket) => {
      expect(bucketContractStatus(status)).toBe(bucket);
    });

    it('covers every one of the 12 ContractStatus values', () => {
      // Guards against a future status being added without a bucket.
      expect(Object.keys(CONTRACT_STATUS_BUCKETS).sort()).toEqual(
        Object.values(ContractStatus).sort(),
      );
    });

    it('folds COMPLETED and TERMINATED into DISTINCT buckets (success vs failure)', () => {
      expect(bucketContractStatus(ContractStatus.COMPLETED)).toBe('COMPLETED');
      expect(bucketContractStatus(ContractStatus.TERMINATED)).toBe('TERMINATED');
    });

    it('defaults an unknown status to DRAFT', () => {
      expect(bucketContractStatus('SOMETHING_NEW')).toBe('DRAFT');
    });
  });

  describe('bucketStandardForm (FIDIC / NEC / OTHER / ADHOC)', () => {
    it('maps FIDIC_* → FIDIC', () => {
      expect(bucketStandardForm(ContractType.FIDIC_RED_BOOK_2017)).toBe('FIDIC');
    });
    it('maps NEC* → NEC', () => {
      expect(bucketStandardForm(ContractType.NEC4_ECC)).toBe('NEC');
      expect(bucketStandardForm(ContractType.NEC3_ECC)).toBe('NEC');
    });
    it('maps FAC_1 / TAC_1 → NEC', () => {
      expect(bucketStandardForm(ContractType.FAC_1)).toBe('NEC');
      expect(bucketStandardForm(ContractType.TAC_1)).toBe('NEC');
    });
    it('maps ADHOC and UPLOADED → ADHOC', () => {
      expect(bucketStandardForm(ContractType.ADHOC)).toBe('ADHOC');
      expect(bucketStandardForm(ContractType.UPLOADED)).toBe('ADHOC');
    });
    it('maps an unrecognised standard-form string → OTHER', () => {
      expect(bucketStandardForm('SOME_OTHER_STANDARD')).toBe('OTHER');
    });
  });

  describe('pctChange', () => {
    it('computes a positive delta', () => {
      expect(pctChange(10, 5)).toBe(100);
    });
    it('computes a negative delta', () => {
      expect(pctChange(5, 10)).toBe(-50);
    });
    it('returns 100 when previous is 0 and current > 0', () => {
      expect(pctChange(5, 0)).toBe(100);
    });
    it('returns 0 when both are 0', () => {
      expect(pctChange(0, 0)).toBe(0);
    });
    it('rounds to one decimal place', () => {
      expect(pctChange(7, 3)).toBe(133.3);
    });
  });
});
