import { BadRequestException } from '@nestjs/common';

/**
 * Phase 7.17 Prompt 2a — Decision D3, enforced at the persistence boundary.
 *
 * A monetary value is meaningless without a currency, so currency is REQUIRED
 * whenever contract_value is set. This is checked against the MERGED entity
 * state (persisted row + incoming payload), NOT the payload alone — so a
 * value-only PATCH on an already-priced contract is accepted because the
 * currency comes from the persisted row. (Payload-only DTO validation can't
 * see the existing currency, which is exactly the trap this avoids.)
 *
 * CreateContractDto also enforces the rule at the DTO layer for the create
 * path (no existing row to merge); this helper is the save-time backstop there
 * and the sole enforcement for updates. cf. lessons on validating repo.save state.
 *
 * Note: 0 counts as a "set" value (a zero-value contract still needs a currency),
 * matching the DTO's `contract_value != null` predicate.
 */
export function assertValueCurrencyPaired(
  value: number | null | undefined,
  currency: string | null | undefined,
): void {
  if (value != null && (currency == null || currency === '')) {
    throw new BadRequestException(
      'currency is required when contract_value is set',
    );
  }
}
