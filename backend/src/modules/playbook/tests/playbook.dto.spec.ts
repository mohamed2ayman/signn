import { ValidationPipe, BadRequestException } from '@nestjs/common';

import {
  CreatePlaybookPositionDto,
  UpdatePlaybookPositionDto,
} from '../dto';
import {
  PlaybookRuleType,
  PlaybookScope,
  PlaybookThresholdDirection,
} from '../../../database/entities';

/**
 * 7.22 Slice 1 — DTO validation, run through the REAL global ValidationPipe
 * configuration from main.ts (`whitelist: true, forbidNonWhitelisted: true,
 * transform: true`). Constructing the pipe with the production options rather
 * than calling `validate()` directly is deliberate: whitelist/forbidNonWhitelisted
 * change which bodies are rejected, so a bare validate() would prove something
 * the app does not actually do.
 *
 * The load-bearing case is the rule_type ↔ value_config PAIR: `value_config` is
 * jsonb, so if the DTO does not reject a malformed shape, NOTHING downstream
 * will — a `{ minimum: 28 }` typo would persist forever and read as "no min" to
 * the Slice-2 resolver.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const runCreate = (body: unknown) =>
  pipe.transform(body, {
    type: 'body',
    metatype: CreatePlaybookPositionDto,
  });

const runUpdate = (body: unknown) =>
  pipe.transform(body, {
    type: 'body',
    metatype: UpdatePlaybookPositionDto,
  });

/** Asserts a 400 and returns the flattened message list for assertion. */
const expectRejected = async (p: Promise<unknown>): Promise<string> => {
  let thrown: unknown;
  try {
    await p;
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(BadRequestException);
  const res = (thrown as BadRequestException).getResponse() as {
    message?: string | string[];
  };
  return Array.isArray(res.message)
    ? res.message.join(' | ')
    : String(res.message);
};

const base = {
  clause_type: 'payment',
  rule_type: PlaybookRuleType.RANGE,
  value_config: { min: 28, max: 45, unit: 'days' },
};

describe('CreatePlaybookPositionDto — valid value_config per rule_type', () => {
  // One valid example per rule_type, taken from the NEXT_PHASES 7.22 worked
  // examples so the accepted shapes match the product spec, not just the code.
  const valid: Array<[PlaybookRuleType, Record<string, unknown>]> = [
    [PlaybookRuleType.RANGE, { min: 28, max: 45, unit: 'days' }],
    [
      PlaybookRuleType.THRESHOLD,
      {
        direction: PlaybookThresholdDirection.AT_MOST,
        value: 10,
        unit: 'percent',
      },
    ],
    [PlaybookRuleType.ENUM, { allowed: ['ICC Arbitration', 'LCIA'] }],
    [PlaybookRuleType.REQUIRED, { required: true }],
    [PlaybookRuleType.TEXT, { text: 'القانون المصري هو القانون الحاكم' }],
  ];

  it.each(valid)('accepts a well-formed %s', async (rule_type, value_config) => {
    const out = (await runCreate({
      ...base,
      rule_type,
      value_config,
    })) as CreatePlaybookPositionDto;
    expect(out.rule_type).toBe(rule_type);
    expect(out.value_config).toEqual(value_config);
  });

  it('accepts an equal min and max (a single-point RANGE is legal)', async () => {
    await expect(
      runCreate({ ...base, value_config: { min: 30, max: 30, unit: 'days' } }),
    ).resolves.toBeDefined();
  });
});

describe('CreatePlaybookPositionDto — each rule_type rejects a malformed value_config', () => {
  it('RANGE rejects a missing min', async () => {
    const msg = await expectRejected(
      runCreate({ ...base, value_config: { max: 45, unit: 'days' } }),
    );
    expect(msg).toContain('value_config.min');
  });

  it('RANGE rejects a missing max', async () => {
    const msg = await expectRejected(
      runCreate({ ...base, value_config: { min: 28, unit: 'days' } }),
    );
    expect(msg).toContain('value_config.max');
  });

  it('RANGE rejects min > max', async () => {
    const msg = await expectRejected(
      runCreate({ ...base, value_config: { min: 45, max: 28, unit: 'days' } }),
    );
    expect(msg).toContain('less than or equal');
  });

  it('RANGE rejects a non-numeric min', async () => {
    const msg = await expectRejected(
      runCreate({
        ...base,
        value_config: { min: '28', max: 45, unit: 'days' },
      }),
    );
    expect(msg).toContain('value_config.min');
  });

  it('RANGE rejects a missing unit', async () => {
    const msg = await expectRejected(
      runCreate({ ...base, value_config: { min: 28, max: 45 } }),
    );
    expect(msg).toContain('value_config.unit');
  });

  it('RANGE rejects an unknown key (the typo case jsonb would silently keep)', async () => {
    const msg = await expectRejected(
      runCreate({
        ...base,
        value_config: { min: 28, max: 45, unit: 'days', minimum: 28 },
      }),
    );
    expect(msg).toContain('minimum');
  });

  it('THRESHOLD rejects an invalid direction', async () => {
    const msg = await expectRejected(
      runCreate({
        ...base,
        rule_type: PlaybookRuleType.THRESHOLD,
        value_config: { direction: 'LESS_THAN', value: 10, unit: 'percent' },
      }),
    );
    expect(msg).toContain('value_config.direction');
  });

  it('THRESHOLD rejects a missing value', async () => {
    const msg = await expectRejected(
      runCreate({
        ...base,
        rule_type: PlaybookRuleType.THRESHOLD,
        value_config: {
          direction: PlaybookThresholdDirection.AT_LEAST,
          unit: 'percent',
        },
      }),
    );
    expect(msg).toContain('value_config.value');
  });

  it('ENUM rejects an empty allowed list', async () => {
    const msg = await expectRejected(
      runCreate({
        ...base,
        rule_type: PlaybookRuleType.ENUM,
        value_config: { allowed: [] },
      }),
    );
    expect(msg).toContain('value_config.allowed');
  });

  it('ENUM rejects non-string entries', async () => {
    const msg = await expectRejected(
      runCreate({
        ...base,
        rule_type: PlaybookRuleType.ENUM,
        value_config: { allowed: ['ICC', 42] },
      }),
    );
    expect(msg).toContain('value_config.allowed');
  });

  it('REQUIRED rejects required:false (that is the absence of a position)', async () => {
    const msg = await expectRejected(
      runCreate({
        ...base,
        rule_type: PlaybookRuleType.REQUIRED,
        value_config: { required: false },
      }),
    );
    expect(msg).toContain('value_config.required');
  });

  it('TEXT rejects an empty string', async () => {
    const msg = await expectRejected(
      runCreate({
        ...base,
        rule_type: PlaybookRuleType.TEXT,
        value_config: { text: '   ' },
      }),
    );
    expect(msg).toContain('value_config.text');
  });

  it('TEXT rejects text beyond the length bound', async () => {
    const msg = await expectRejected(
      runCreate({
        ...base,
        rule_type: PlaybookRuleType.TEXT,
        value_config: { text: 'x'.repeat(5001) },
      }),
    );
    expect(msg).toContain('value_config.text');
  });

  it('rejects a value_config belonging to a DIFFERENT rule_type', async () => {
    // The whole point of pair validation: each half is individually well-formed.
    const msg = await expectRejected(
      runCreate({
        ...base,
        rule_type: PlaybookRuleType.RANGE,
        value_config: { text: 'this is a TEXT config' },
      }),
    );
    expect(msg).toContain('RANGE');
  });

  it('rejects a non-object value_config', async () => {
    await expectRejected(runCreate({ ...base, value_config: 'not-an-object' }));
  });
});

describe('CreatePlaybookPositionDto — field-level rules', () => {
  it('rejects a whitespace-only clause_type (trimmed first)', async () => {
    const msg = await expectRejected(runCreate({ ...base, clause_type: '   ' }));
    expect(msg).toContain('clause_type');
  });

  it('trims a padded clause_type', async () => {
    const out = (await runCreate({
      ...base,
      clause_type: '  payment  ',
    })) as CreatePlaybookPositionDto;
    expect(out.clause_type).toBe('payment');
  });

  it('rejects a clause_type beyond 100 chars', async () => {
    const msg = await expectRejected(
      runCreate({ ...base, clause_type: 'x'.repeat(101) }),
    );
    expect(msg).toContain('clause_type');
  });

  it('accepts a CUSTOM clause_type (7.22 requires arbitrary org-defined types)', async () => {
    await expect(
      runCreate({
        ...base,
        clause_type: 'liquidated_damages_cap_custom',
        is_custom_clause_type: true,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects an unknown rule_type', async () => {
    const msg = await expectRejected(
      runCreate({ ...base, rule_type: 'NOT_A_RULE' }),
    );
    expect(msg).toContain('rule_type');
  });

  it('rejects an unknown scope', async () => {
    const msg = await expectRejected(runCreate({ ...base, scope: 'GLOBAL' }));
    expect(msg).toContain('scope');
  });

  it('rejects a non-UUID project_id', async () => {
    const msg = await expectRejected(
      runCreate({ ...base, scope: PlaybookScope.PROJECT, project_id: 'nope' }),
    );
    expect(msg).toContain('project_id');
  });

  it('STRIPS a client-supplied organization_id by rejecting it (forbidNonWhitelisted)', async () => {
    // Tenancy: the org must come from the JWT. forbidNonWhitelisted turns an
    // attempt to set it into a 400 rather than silently ignoring it.
    const msg = await expectRejected(
      runCreate({ ...base, organization_id: '11111111-1111-4111-8111-111111111111' }),
    );
    expect(msg).toContain('organization_id');
  });

  it('rejects a client-supplied created_by', async () => {
    const msg = await expectRejected(
      runCreate({ ...base, created_by: '11111111-1111-4111-8111-111111111111' }),
    );
    expect(msg).toContain('created_by');
  });
});

describe('UpdatePlaybookPositionDto', () => {
  it('accepts an empty patch', async () => {
    await expect(runUpdate({})).resolves.toBeDefined();
  });

  it('accepts a lone value_config (the pair is checked in the service, not here)', async () => {
    // Documents the deliberate layer split: the DTO CANNOT check the pair on a
    // PATCH because it never sees the stored rule_type.
    await expect(
      runUpdate({ value_config: { min: 1, max: 2, unit: 'days' } }),
    ).resolves.toBeDefined();
  });

  it('still enforces field-level format', async () => {
    const msg = await expectRejected(runUpdate({ rule_type: 'NOPE' }));
    expect(msg).toContain('rule_type');
  });

  it('rejects a client-supplied organization_id on update too', async () => {
    const msg = await expectRejected(
      runUpdate({ organization_id: '11111111-1111-4111-8111-111111111111' }),
    );
    expect(msg).toContain('organization_id');
  });
});
