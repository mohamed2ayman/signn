import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  PlaybookRuleType,
  PlaybookThresholdDirection,
} from '../../../database/entities';

/**
 * 7.22 Slice 1 — the single authority on whether a `value_config` matches its
 * `rule_type`.
 *
 * `rule_type` + `value_config` are ONE unit of meaning: the jsonb is
 * uninterpretable without the discriminator, so validating either alone is
 * meaningless. This module is the ONLY place that pairing is checked, and it is
 * used from BOTH sides:
 *
 *   - CREATE — via the class-validator constraint below, so a bad body is a
 *     clean 400 from the global ValidationPipe (both halves are always present
 *     on a create).
 *   - UPDATE — via `validateValueConfig()` called DIRECTLY from the service on
 *     the MERGED (existing row + patch) pair. A PATCH may legally change only
 *     `rule_type` or only `value_config`, so the DTO can NEVER see both halves
 *     of the resulting pair; only the service can. Validating the DTO alone on
 *     update would let a caller switch rule_type to RANGE while leaving a TEXT
 *     value_config in place.
 *
 * Returns an error MESSAGE (string) or null when valid — deliberately not a
 * boolean, so the caller can surface exactly what was wrong.
 *
 * Unknown keys are REJECTED rather than silently stored: `value_config` is
 * jsonb, so nothing else would ever catch a typo'd key (`{ minimum: 28 }` would
 * persist forever and read as "no min" to the Slice-2 resolver).
 *
 * String/array bounds are enforced here because a jsonb blob bypasses the
 * `@MaxLength` floor that CLAUDE.md requires of every free-text field — without
 * these, `value_config` would be the one unbounded user-controlled string in
 * the table.
 */

/** Bounds — the jsonb equivalent of the mandatory @MaxLength on free text. */
export const VALUE_CONFIG_LIMITS = {
  UNIT_MAX_LENGTH: 50,
  ENUM_MAX_ENTRIES: 50,
  ENUM_ENTRY_MAX_LENGTH: 200,
  TEXT_MAX_LENGTH: 5000,
} as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Finite real number — rejects NaN/Infinity, which survive JSON round-trips as null/errors. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

/** Reject any key the shape does not define. */
function unknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

/**
 * The authority. Returns an error message, or null when the pair is valid.
 */
export function validateValueConfig(
  ruleType: unknown,
  valueConfig: unknown,
): string | null {
  if (!isPlainObject(valueConfig)) {
    return 'value_config must be an object';
  }

  switch (ruleType) {
    case PlaybookRuleType.RANGE: {
      const allowed = ['min', 'max', 'unit'] as const;
      const extra = unknownKeys(valueConfig, allowed);
      if (extra.length) {
        return `value_config for RANGE must contain only {min, max, unit} — unexpected: ${extra.join(', ')}`;
      }
      if (!isFiniteNumber(valueConfig.min)) {
        return 'value_config.min must be a finite number for rule_type RANGE';
      }
      if (!isFiniteNumber(valueConfig.max)) {
        return 'value_config.max must be a finite number for rule_type RANGE';
      }
      if (valueConfig.min > valueConfig.max) {
        return 'value_config.min must be less than or equal to value_config.max';
      }
      if (!isNonEmptyString(valueConfig.unit, VALUE_CONFIG_LIMITS.UNIT_MAX_LENGTH)) {
        return `value_config.unit must be a non-empty string of at most ${VALUE_CONFIG_LIMITS.UNIT_MAX_LENGTH} characters`;
      }
      return null;
    }

    case PlaybookRuleType.THRESHOLD: {
      const allowed = ['direction', 'value', 'unit'] as const;
      const extra = unknownKeys(valueConfig, allowed);
      if (extra.length) {
        return `value_config for THRESHOLD must contain only {direction, value, unit} — unexpected: ${extra.join(', ')}`;
      }
      const directions = Object.values(PlaybookThresholdDirection) as string[];
      if (
        typeof valueConfig.direction !== 'string' ||
        !directions.includes(valueConfig.direction)
      ) {
        return `value_config.direction must be one of: ${directions.join(', ')}`;
      }
      if (!isFiniteNumber(valueConfig.value)) {
        return 'value_config.value must be a finite number for rule_type THRESHOLD';
      }
      if (!isNonEmptyString(valueConfig.unit, VALUE_CONFIG_LIMITS.UNIT_MAX_LENGTH)) {
        return `value_config.unit must be a non-empty string of at most ${VALUE_CONFIG_LIMITS.UNIT_MAX_LENGTH} characters`;
      }
      return null;
    }

    case PlaybookRuleType.ENUM: {
      const allowed = ['allowed'] as const;
      const extra = unknownKeys(valueConfig, allowed);
      if (extra.length) {
        return `value_config for ENUM must contain only {allowed} — unexpected: ${extra.join(', ')}`;
      }
      const list = valueConfig.allowed;
      if (!Array.isArray(list) || list.length === 0) {
        return 'value_config.allowed must be a non-empty array for rule_type ENUM';
      }
      if (list.length > VALUE_CONFIG_LIMITS.ENUM_MAX_ENTRIES) {
        return `value_config.allowed must contain at most ${VALUE_CONFIG_LIMITS.ENUM_MAX_ENTRIES} entries`;
      }
      if (
        !list.every((e) =>
          isNonEmptyString(e, VALUE_CONFIG_LIMITS.ENUM_ENTRY_MAX_LENGTH),
        )
      ) {
        return `every value_config.allowed entry must be a non-empty string of at most ${VALUE_CONFIG_LIMITS.ENUM_ENTRY_MAX_LENGTH} characters`;
      }
      return null;
    }

    case PlaybookRuleType.REQUIRED: {
      const allowed = ['required'] as const;
      const extra = unknownKeys(valueConfig, allowed);
      if (extra.length) {
        return `value_config for REQUIRED must contain only {required} — unexpected: ${extra.join(', ')}`;
      }
      // Literal `true` only — `false` would mean "this clause is optional",
      // which is the absence of a position, not a position.
      if (valueConfig.required !== true) {
        return 'value_config.required must be exactly true for rule_type REQUIRED';
      }
      return null;
    }

    case PlaybookRuleType.TEXT: {
      const allowed = ['text'] as const;
      const extra = unknownKeys(valueConfig, allowed);
      if (extra.length) {
        return `value_config for TEXT must contain only {text} — unexpected: ${extra.join(', ')}`;
      }
      if (!isNonEmptyString(valueConfig.text, VALUE_CONFIG_LIMITS.TEXT_MAX_LENGTH)) {
        return `value_config.text must be a non-empty string of at most ${VALUE_CONFIG_LIMITS.TEXT_MAX_LENGTH} characters`;
      }
      return null;
    }

    default:
      // rule_type itself is invalid — @IsEnum on the DTO reports that
      // separately; this keeps the pair check total rather than throwing.
      return `value_config cannot be validated: unknown rule_type '${String(ruleType)}'`;
  }
}

/**
 * CREATE-side adapter. Reads the sibling `rule_type` off the DTO instance so
 * the pair is checked as a unit inside the normal ValidationPipe pass.
 */
@ValidatorConstraint({ name: 'ValueConfigMatchesRuleType', async: false })
export class ValueConfigMatchesRuleTypeConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, args: ValidationArguments): boolean {
    const ruleType = (args.object as { rule_type?: unknown }).rule_type;
    return validateValueConfig(ruleType, value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const ruleType = (args.object as { rule_type?: unknown }).rule_type;
    return (
      validateValueConfig(ruleType, args.value) ?? 'value_config is invalid'
    );
  }
}
