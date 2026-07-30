import {
  PlaybookEnumConfig,
  PlaybookPosition,
  PlaybookRangeConfig,
  PlaybookRuleType,
  PlaybookTextConfig,
  PlaybookThresholdConfig,
  PlaybookThresholdDirection,
} from '../../database/entities';

/**
 * 7.22 Slice 2 — turns resolved positions into prompt-ready text.
 *
 * The output is appended to the compliance AI's `playbook_knowledge` channel,
 * alongside the free-text PLAYBOOK knowledge assets that already feed it. It
 * therefore matches the house block style of
 * `ComplianceKnowledgeService.formatAssets` — an `## ` header followed by
 * one bullet per item — so the two bodies of text read as one section rather
 * than two different formats stapled together.
 *
 * DETERMINISM is a requirement, not a nicety: this text is a model input, and
 * a set of positions that renders differently on two runs makes an output
 * difference impossible to attribute. The resolver hands rows back already
 * sorted by normalized clause type; this module preserves that order and never
 * reorders, dedupes, or injects anything data-dependent (no timestamps, no
 * ids, no counts that could churn).
 */

/** Per-section soft cap. Defaults to the compliance section budget. */
export const DEFAULT_PLAYBOOK_MAX_CHARS = 30_000;

/** Notes are context, not the position — kept short so they cannot crowd it out. */
const MAX_NOTE_CHARS = 160;

export const PLAYBOOK_BLOCK_HEADER = '## Organisation Playbook — Standard Positions';

/**
 * SEVERITY CAP (7.22 Slice 2, v1 mitigation).
 *
 * A playbook position is an organisation PREFERENCE, not law. Without this
 * instruction the model can return a CRITICAL finding for a preference miss,
 * and a CRITICAL finding drives the check's `overall_status` to NON_COMPLIANT —
 * i.e. a contract that is perfectly legal gets reported as legally
 * non-compliant because it pays on day 60 instead of day 45.
 *
 * This is the v1 mitigation and it is a PROMPT-LEVEL instruction, so it is
 * persuasive, not enforced — a model may still ignore it. The real fix is a
 * layer-aware status axis that computes `overall_status` from legal layers only
 * and reports playbook deviations on their own axis (Ayman's Option-2 handoff);
 * that is deliberately NOT in this slice, and this line is not a substitute for
 * it.
 */
export const PLAYBOOK_SEVERITY_CAP_INSTRUCTION =
  'These are organisation preferences, not legal requirements. Flag any ' +
  'deviation from them as advisory (severity LOW or MEDIUM, never CRITICAL) — ' +
  'a deviation from a playbook position does NOT indicate legal ' +
  'non-compliance.';

/**
 * Render an effective position set as one prompt block.
 *
 * Returns `null` — not an empty string — when there is nothing to say, so a
 * caller can treat "no playbook" as absent rather than as an empty section
 * (the `formatAssets` convention).
 *
 * Positions that overflow `maxChars` are dropped with an explicit truncation
 * marker; the block never silently loses a position.
 */
export function serializePlaybookPositions(
  positions: PlaybookPosition[],
  opts: { maxChars?: number } = {},
): string | null {
  if (!positions || positions.length === 0) return null;

  const maxChars = opts.maxChars ?? DEFAULT_PLAYBOOK_MAX_CHARS;
  const head = `${PLAYBOOK_BLOCK_HEADER}\n${PLAYBOOK_SEVERITY_CAP_INSTRUCTION}\n`;

  // Length accounting must be EXACT, not approximate. `lines` is joined with
  // '\n', so k lines carry k-1 separators, not k — charging +1 per line
  // overshoots and can drop a position that actually fits.
  let bodyLen = 0;
  const bodyWith = (lineLen: number) =>
    bodyLen === 0 ? lineLen : bodyLen + 1 + lineLen;

  const rendered = positions.map(renderPositionLine);

  // Decide truncation UP FRONT rather than per line. Reserving room for the
  // marker while filling is necessary once truncation is happening (the lines
  // are short, so a break-time-only check leaves less slack than the marker
  // needs and it would never be emitted) — but charging that reserve against a
  // set that would otherwise fit exactly is what drops its last position and
  // then announces a truncation that never happened. Whether truncation is
  // needed is knowable before the loop, so ask first.
  const fullBodyLen =
    rendered.reduce((sum, line) => sum + line.length, 0) +
    Math.max(0, rendered.length - 1);
  if (head.length + fullBodyLen <= maxChars) {
    return `${head}${rendered.join('\n')}`;
  }

  // Truncating. Size the reserve for the worst case (every position, i.e. the
  // longest possible count string) so the marker is guaranteed to fit.
  const markerReserve =
    `[...truncated — ${positions.length} more playbook positions]`.length + 1;

  const lines: string[] = [];
  for (const line of rendered) {
    if (head.length + bodyWith(line.length) + markerReserve > maxChars) break;
    lines.push(line);
    bodyLen = bodyWith(line.length);
  }

  const marker = `[...truncated — ${positions.length - lines.length} more playbook positions]`;
  if (head.length + bodyWith(marker.length) <= maxChars) lines.push(marker);

  // NOTE: the header + severity-cap instruction is never sacrificed to the
  // budget — a maxChars smaller than the header is not a supported budget, and
  // shipping positions to the model without the "advisory, never CRITICAL"
  // instruction would be worse than returning a slightly oversized block.
  return `${head}${lines.join('\n')}`;
}

/** One position → one bullet. Exported for focused tests. */
export function renderPositionLine(position: PlaybookPosition): string {
  const label = renderClauseTypeLabel(position);
  const value = renderValue(position);
  const note = renderNote(position.note);
  return `- ${label}: ${value}${note}`;
}

/**
 * STANDARD clause types are machine keys (`dispute_resolution`) and are
 * humanised for the prompt: underscores to spaces, upper-cased, matching the
 * "PAYMENT" / "DISPUTE RESOLUTION" shape.
 *
 * CUSTOM clause types are free text the org authored itself, so they are
 * rendered VERBATIM (only trimmed). Upper-casing an org's own phrasing would
 * mangle it, and for Arabic — which 7.22 explicitly supports — casing is a
 * no-op anyway, so the transform buys nothing and risks distortion.
 */
export function renderClauseTypeLabel(position: PlaybookPosition): string {
  const raw = (position.clause_type ?? '').trim();
  if (position.is_custom_clause_type) return raw;
  return raw.replace(/_/g, ' ').toUpperCase();
}

function renderValue(position: PlaybookPosition): string {
  const config = position.value_config as unknown;

  switch (position.rule_type) {
    case PlaybookRuleType.RANGE: {
      const c = config as PlaybookRangeConfig;
      // En dash for the numeric range, matching the 7.22 worked examples.
      return `preferred ${fmtNumber(c.min)}–${fmtNumber(c.max)} ${c.unit}`.trim();
    }

    case PlaybookRuleType.THRESHOLD: {
      const c = config as PlaybookThresholdConfig;
      const direction =
        c.direction === PlaybookThresholdDirection.AT_LEAST
          ? 'at least'
          : 'at most';
      return `${direction} ${fmtNumber(c.value)} ${c.unit}`.trim();
    }

    case PlaybookRuleType.ENUM: {
      const c = config as PlaybookEnumConfig;
      return `one of [${(c.allowed ?? []).join(', ')}]`;
    }

    case PlaybookRuleType.REQUIRED:
      return 'clause required';

    case PlaybookRuleType.TEXT: {
      const c = config as PlaybookTextConfig;
      return (c.text ?? '').trim();
    }

    default:
      // A rule_type this build does not know about. Say so plainly rather than
      // emitting a confident-looking but wrong position — the model must not
      // be told something the code could not actually read.
      return '(position could not be rendered)';
  }
}

function renderNote(note: string | null): string {
  const trimmed = (note ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= MAX_NOTE_CHARS) return ` (Rationale: ${trimmed})`;

  // Never cut between the halves of a surrogate pair — that emits a lone
  // surrogate, which renders as a replacement glyph. (Arabic is BMP and safe
  // either way; an emoji in an org's rationale is not.)
  const lastUnit = trimmed.charCodeAt(MAX_NOTE_CHARS - 1);
  const end =
    lastUnit >= 0xd800 && lastUnit <= 0xdbff
      ? MAX_NOTE_CHARS - 1
      : MAX_NOTE_CHARS;
  return ` (Rationale: ${trimmed.slice(0, end).trimEnd()}…)`;
}

/**
 * Latin digits, no locale grouping — CLAUDE.md's Latin-numerals rule for MENA
 * construction finance (lesson #137). `toLocaleString` is deliberately avoided:
 * it would make the output depend on the process locale, breaking determinism.
 */
function fmtNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}
