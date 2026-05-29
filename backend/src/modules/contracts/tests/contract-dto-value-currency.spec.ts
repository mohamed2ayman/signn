import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateContractDto } from '../dto/create-contract.dto';
import { UpdateContractDto } from '../dto/update-contract.dto';
import { ContractType } from '../../../database/entities';

// Phase 7.17 Prompt 2a — Decision D3: currency is REQUIRED whenever
// contract_value is set, and must be a 3-letter uppercase ISO-4217 code.

const BASE = {
  project_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Test contract',
  contract_type: ContractType.ADHOC,
};

function createErrs(extra: Record<string, unknown>) {
  return validateSync(plainToInstance(CreateContractDto, { ...BASE, ...extra }), {
    whitelist: true,
  });
}
function updateErrs(extra: Record<string, unknown>) {
  return validateSync(plainToInstance(UpdateContractDto, { ...extra }), {
    whitelist: true,
  });
}
const hasErrOn = (errs: ReturnType<typeof validateSync>, prop: string) =>
  errs.some((e) => e.property === prop);

describe('Create/UpdateContractDto — value ↔ currency pairing', () => {
  it('accepts neither value nor currency', () => {
    const errs = createErrs({});
    expect(hasErrOn(errs, 'contract_value')).toBe(false);
    expect(hasErrOn(errs, 'currency')).toBe(false);
  });

  it('accepts a value with a valid uppercase ISO-4217 currency', () => {
    expect(createErrs({ contract_value: 1000000, currency: 'EGP' })).toHaveLength(0);
    expect(createErrs({ contract_value: 250.5, currency: 'AED' })).toHaveLength(0);
  });

  it('REJECTS a value with NO currency (currency becomes required)', () => {
    expect(hasErrOn(createErrs({ contract_value: 1000 }), 'currency')).toBe(true);
  });

  it('rejects a lowercase or wrong-length currency when value is set', () => {
    expect(hasErrOn(createErrs({ contract_value: 1000, currency: 'egp' }), 'currency')).toBe(true);
    expect(hasErrOn(createErrs({ contract_value: 1000, currency: 'US' }), 'currency')).toBe(true);
    expect(hasErrOn(createErrs({ contract_value: 1000, currency: 'USDD' }), 'currency')).toBe(true);
  });

  it('rejects a negative value or > 2 decimal places', () => {
    expect(hasErrOn(createErrs({ contract_value: -5, currency: 'USD' }), 'contract_value')).toBe(true);
    expect(hasErrOn(createErrs({ contract_value: 1.234, currency: 'USD' }), 'contract_value')).toBe(true);
  });

  it('ignores currency validation when no value is provided (ValidateIf short-circuits)', () => {
    // currency alone, no value → ValidateIf(false) → currency not validated
    expect(hasErrOn(createErrs({ currency: 'whatever' }), 'currency')).toBe(false);
  });

  // UpdateContractDto deliberately does NOT enforce the pairing at the DTO
  // layer (payload-only validation can't see the persisted currency). It only
  // format-validates currency when present; the pairing is enforced on the
  // merged entity in contracts.service.update() — see the service spec + util spec.
  describe('UpdateContractDto — format-only currency at the DTO layer', () => {
    it('accepts a value-only update (pairing is checked later against the merged row)', () => {
      expect(hasErrOn(updateErrs({ contract_value: 1000 }), 'currency')).toBe(false);
    });
    it('accepts value + a valid currency', () => {
      expect(updateErrs({ contract_value: 1000, currency: 'QAR' })).toHaveLength(0);
    });
    it('still rejects a malformed currency when present', () => {
      expect(hasErrOn(updateErrs({ currency: 'qar' }), 'currency')).toBe(true);
    });
    it('accepts an empty update', () => {
      expect(updateErrs({})).toHaveLength(0);
    });
  });
});
