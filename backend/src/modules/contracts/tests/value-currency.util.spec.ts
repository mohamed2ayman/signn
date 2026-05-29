import { BadRequestException } from '@nestjs/common';
import { assertValueCurrencyPaired } from '../utils/value-currency.util';

// Phase 7.17 Prompt 2a — Decision D3 pairing invariant (merged-state helper).

describe('assertValueCurrencyPaired', () => {
  it('passes when neither value nor currency is set', () => {
    expect(() => assertValueCurrencyPaired(null, null)).not.toThrow();
    expect(() => assertValueCurrencyPaired(undefined, undefined)).not.toThrow();
  });

  it('passes when value + currency are both present', () => {
    expect(() => assertValueCurrencyPaired(1000, 'USD')).not.toThrow();
  });

  it('passes when currency is present without a value (harmless)', () => {
    expect(() => assertValueCurrencyPaired(null, 'USD')).not.toThrow();
  });

  it('throws when a value has no currency', () => {
    expect(() => assertValueCurrencyPaired(1000, null)).toThrow(BadRequestException);
    expect(() => assertValueCurrencyPaired(1000, undefined)).toThrow(BadRequestException);
    expect(() => assertValueCurrencyPaired(1000, '')).toThrow(BadRequestException);
  });

  it('treats 0 as a set value that still requires a currency', () => {
    expect(() => assertValueCurrencyPaired(0, null)).toThrow(BadRequestException);
    expect(() => assertValueCurrencyPaired(0, 'USD')).not.toThrow();
  });
});
