import {
  PlaybookPosition,
  PlaybookRuleType,
  PlaybookScope,
  PlaybookThresholdDirection,
} from '../../../database/entities';
import {
  PLAYBOOK_BLOCK_HEADER,
  PLAYBOOK_SEVERITY_CAP_INSTRUCTION,
  renderClauseTypeLabel,
  renderPositionLine,
  serializePlaybookPositions,
} from '../playbook-serializer.util';

/**
 * 7.22 Slice 2 — the serializer is a PURE function over already-resolved rows,
 * so it is unit-tested without Postgres. The org wall and the precedence fold
 * are the resolver's invariants and are proven against real PG in
 * playbook-resolver.real-pg.spec.ts.
 */

/** Minimal row shaped like the entity — only the fields the serializer reads. */
const position = (over: Partial<PlaybookPosition>): PlaybookPosition =>
  ({
    id: 'id',
    organization_id: 'org',
    scope: PlaybookScope.ORG,
    project_id: null,
    contract_id: null,
    clause_type: 'payment',
    is_custom_clause_type: false,
    rule_type: PlaybookRuleType.RANGE,
    value_config: { min: 28, max: 45, unit: 'days' },
    note: null,
    is_active: true,
    created_by: null,
    ...over,
  }) as PlaybookPosition;

describe('playbook serializer', () => {
  describe('per rule_type rendering', () => {
    it('RANGE renders a preferred band with an en dash', () => {
      expect(
        renderPositionLine(
          position({
            clause_type: 'payment',
            rule_type: PlaybookRuleType.RANGE,
            value_config: { min: 28, max: 45, unit: 'days' },
          }),
        ),
      ).toBe('- PAYMENT: preferred 28–45 days');
    });

    it('THRESHOLD AT_MOST renders an upper bound', () => {
      expect(
        renderPositionLine(
          position({
            clause_type: 'retention',
            rule_type: PlaybookRuleType.THRESHOLD,
            value_config: {
              direction: PlaybookThresholdDirection.AT_MOST,
              value: 10,
              unit: 'percent',
            },
          }),
        ),
      ).toBe('- RETENTION: at most 10 percent');
    });

    it('THRESHOLD AT_LEAST renders a lower bound', () => {
      expect(
        renderPositionLine(
          position({
            clause_type: 'liability',
            rule_type: PlaybookRuleType.THRESHOLD,
            value_config: {
              direction: PlaybookThresholdDirection.AT_LEAST,
              value: 100,
              unit: 'percent of contract value',
            },
          }),
        ),
      ).toBe('- LIABILITY: at least 100 percent of contract value');
    });

    it('ENUM renders the allowed set', () => {
      expect(
        renderPositionLine(
          position({
            clause_type: 'dispute_resolution',
            rule_type: PlaybookRuleType.ENUM,
            value_config: { allowed: ['ICC Arbitration', 'DIAC'] },
          }),
        ),
      ).toBe('- DISPUTE RESOLUTION: one of [ICC Arbitration, DIAC]');
    });

    it('REQUIRED renders a presence requirement', () => {
      expect(
        renderPositionLine(
          position({
            clause_type: 'force_majeure',
            rule_type: PlaybookRuleType.REQUIRED,
            value_config: { required: true },
          }),
        ),
      ).toBe('- FORCE MAJEURE: clause required');
    });

    it('TEXT renders the free-text position verbatim, including Arabic', () => {
      expect(
        renderPositionLine(
          position({
            clause_type: 'governing_law',
            rule_type: PlaybookRuleType.TEXT,
            value_config: { text: 'القانون المصري هو القانون الحاكم' },
          }),
        ),
      ).toBe('- GOVERNING LAW: القانون المصري هو القانون الحاكم');
    });

    it('says so plainly when the rule_type cannot be rendered', () => {
      // A row written by a newer build than this one. It must not be presented
      // to the model as a confident position.
      const line = renderPositionLine(
        position({
          clause_type: 'payment',
          rule_type: 'SOMETHING_NEW' as PlaybookRuleType,
          value_config: { anything: true } as never,
        }),
      );
      expect(line).toBe('- PAYMENT: (position could not be rendered)');
    });
  });

  describe('clause type labels', () => {
    it('humanises a standard machine key', () => {
      expect(
        renderClauseTypeLabel(
          position({
            clause_type: 'dispute_resolution',
            is_custom_clause_type: false,
          }),
        ),
      ).toBe('DISPUTE RESOLUTION');
    });

    it('renders a custom clause type verbatim', () => {
      expect(
        renderClauseTypeLabel(
          position({
            clause_type: 'Site Access Windows',
            is_custom_clause_type: true,
          }),
        ),
      ).toBe('Site Access Windows');
    });

    it('renders an Arabic custom clause type verbatim', () => {
      expect(
        renderClauseTypeLabel(
          position({
            clause_type: 'شروط الدفع',
            is_custom_clause_type: true,
          }),
        ),
      ).toBe('شروط الدفع');
    });
  });

  describe('notes', () => {
    it('appends a short note as rationale', () => {
      expect(
        renderPositionLine(
          position({ note: 'cashflow policy agreed with finance' }),
        ),
      ).toBe(
        '- PAYMENT: preferred 28–45 days (Rationale: cashflow policy agreed with finance)',
      );
    });

    it('omits an empty or whitespace-only note', () => {
      expect(renderPositionLine(position({ note: '   ' }))).toBe(
        '- PAYMENT: preferred 28–45 days',
      );
    });

    it('clips a long note so it cannot crowd out the position', () => {
      const line = renderPositionLine(position({ note: 'x'.repeat(400) }));
      expect(line.length).toBeLessThan(250);
      expect(line).toContain('…');
      expect(line.startsWith('- PAYMENT: preferred 28–45 days (Rationale: ')).toBe(
        true,
      );
    });
  });

  describe('block assembly', () => {
    const fullSet = () => [
      position({
        id: 'a',
        clause_type: 'dispute_resolution',
        rule_type: PlaybookRuleType.ENUM,
        value_config: { allowed: ['ICC Arbitration', 'DIAC'] },
      }),
      position({
        id: 'b',
        clause_type: 'force_majeure',
        rule_type: PlaybookRuleType.REQUIRED,
        value_config: { required: true },
      }),
      position({
        id: 'c',
        clause_type: 'payment',
        rule_type: PlaybookRuleType.RANGE,
        value_config: { min: 28, max: 45, unit: 'days' },
      }),
      position({
        id: 'd',
        clause_type: 'retention',
        rule_type: PlaybookRuleType.THRESHOLD,
        value_config: {
          direction: PlaybookThresholdDirection.AT_MOST,
          value: 10,
          unit: 'percent',
        },
      }),
    ];

    it('returns null for an empty set rather than an empty section', () => {
      expect(serializePlaybookPositions([])).toBeNull();
    });

    it('renders header, severity-cap instruction, then one line per position', () => {
      expect(serializePlaybookPositions(fullSet())).toBe(
        `${PLAYBOOK_BLOCK_HEADER}\n${PLAYBOOK_SEVERITY_CAP_INSTRUCTION}\n` +
          '- DISPUTE RESOLUTION: one of [ICC Arbitration, DIAC]\n' +
          '- FORCE MAJEURE: clause required\n' +
          '- PAYMENT: preferred 28–45 days\n' +
          '- RETENTION: at most 10 percent',
      );
    });

    it('always carries the severity-cap instruction', () => {
      const out = serializePlaybookPositions(fullSet())!;
      expect(out).toContain('never CRITICAL');
      expect(out).toContain('organisation preferences, not legal requirements');
    });

    it('preserves the order it is given — it never reorders', () => {
      // The resolver owns ordering; the serializer must not second-guess it.
      const reversed = fullSet().reverse();
      const lines = serializePlaybookPositions(reversed)!.split('\n').slice(2);
      expect(lines).toEqual([
        '- RETENTION: at most 10 percent',
        '- PAYMENT: preferred 28–45 days',
        '- FORCE MAJEURE: clause required',
        '- DISPUTE RESOLUTION: one of [ICC Arbitration, DIAC]',
      ]);
    });

    it('is byte-identical across repeated calls on the same data', () => {
      const set = fullSet();
      expect(serializePlaybookPositions(set)).toBe(
        serializePlaybookPositions(set),
      );
    });

    it('truncates within maxChars and states how many positions were dropped', () => {
      const many = Array.from({ length: 40 }, (_, i) =>
        position({ id: `p${i}`, clause_type: `clause_${i}` }),
      );
      const out = serializePlaybookPositions(many, { maxChars: 400 })!;

      // STRICT: maxChars is a hard budget, not an approximate one. The caller
      // (the compliance feed) subtracts this length from a fixed section cap
      // and hands the remainder to the asset renderer, so any overshoot here
      // silently pushes the whole section over MAX_SECTION_CHARS.
      expect(out.length).toBeLessThanOrEqual(400);
      expect(out).toMatch(/\[\.\.\.truncated — \d+ more playbook positions\]/);
      // The header + instruction always survive: the cap must never silently
      // drop the severity instruction while still shipping positions.
      expect(out).toContain(PLAYBOOK_SEVERITY_CAP_INSTRUCTION);
    });

    it('keeps the final position when the set exactly fits, with no phantom marker', () => {
      // The marker reserve must not be charged against the LAST position —
      // otherwise a set that fits gets its last entry dropped and then
      // announces a truncation that never happened.
      const set = fullSet();
      const exact = serializePlaybookPositions(set)!.length;

      const out = serializePlaybookPositions(set, { maxChars: exact })!;

      expect(out).toContain('- RETENTION: at most 10 percent'); // the last line
      expect(out).not.toContain('truncated');
      expect(out.length).toBe(exact);
    });

    it('does not truncate when the set fits', () => {
      expect(serializePlaybookPositions(fullSet(), { maxChars: 30_000 })).not.toContain(
        'truncated',
      );
    });
  });
});
