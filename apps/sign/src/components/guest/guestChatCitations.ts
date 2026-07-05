/**
 * Citation-chip parsing for the Guest AI Assistant (Feature #6, Slice 2).
 *
 * The Slice-1 backend labels every clause in the AI's context as `[§N] title`,
 * so the conversational agent cites sections as `§N` (occasionally the Arabic
 * `البند N` / `المادة N` forms). Chips are rendered ONLY for refs that
 * (a) parse cleanly AND (b) match a real clause section on this contract —
 * never invented (per the build rule: parseable §refs only).
 */

export interface GuestCitationTarget {
  /** The clause's section number exactly as stored (`section_number`). */
  section: string;
  title: string | null;
  /** First ~200 chars of the clause body for the chip's excerpt panel. */
  excerpt: string | null;
}

export interface GuestChatClauseRef {
  section_number?: string | null;
  title?: string | null;
  content?: string | null;
}

const ARABIC_INDIC_ZERO = 0x0660;

/** Normalize Arabic-Indic digits to Latin and trim for stable matching. */
export function normalizeSectionRef(raw: string): string {
  let out = '';
  for (const ch of raw.trim()) {
    const code = ch.charCodeAt(0);
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else {
      out += ch;
    }
  }
  // Unify sub-section separators: `12/3` and `12-3` → `12.3` (the clause
  // extractor stores parent-level sections, but be tolerant on the AI side).
  return out.replace(/[/⁄-]/g, '.').replace(/\s+/g, '');
}

// `§ 12`, `§12.3`, `§١٤` … — the canonical form the backend context teaches.
const SECTION_SIGN_RE = /§\s*([0-9٠-٩]+(?:\s*[./-]\s*[0-9٠-٩]+)*)/g;
// Conservative Arabic clause-heading references: `البند 14` / `المادة (٣)` /
// `البند رقم 5`. Anything fancier is skipped rather than guessed.
const ARABIC_REF_RE =
  /(?:البند|المادة|بند|مادة)\s*(?:رقم\s*)?\(?\s*([0-9٠-٩]+(?:\s*[./-]\s*[0-9٠-٩]+)*)\s*\)?/g;

/**
 * Extract candidate section refs from an assistant answer, normalized and
 * de-duplicated in first-appearance order. Garbage in → empty array out.
 */
export function parseSectionRefs(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const re of [SECTION_SIGN_RE, ARABIC_REF_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const ref = normalizeSectionRef(m[1]);
      if (ref && !seen.has(ref)) {
        seen.add(ref);
        out.push(ref);
      }
    }
  }
  return out;
}

/**
 * Match parsed refs against the contract's REAL clause list. A ref that has
 * no matching clause is dropped (no invented chips). Returns chip targets in
 * the answer's citation order.
 */
export function buildGuestCitations(
  text: string | null | undefined,
  clauses: GuestChatClauseRef[] | null | undefined,
): GuestCitationTarget[] {
  const refs = parseSectionRefs(text);
  if (!refs.length || !clauses?.length) return [];

  const bySection = new Map<string, GuestChatClauseRef>();
  for (const c of clauses) {
    if (c.section_number) {
      const key = normalizeSectionRef(String(c.section_number));
      if (key && !bySection.has(key)) bySection.set(key, c);
    }
  }

  const out: GuestCitationTarget[] = [];
  for (const ref of refs) {
    const clause = bySection.get(ref);
    if (!clause) continue;
    const body = clause.content ?? null;
    out.push({
      // Anchor with the STORED section string so the DOM lookup matches the
      // `data-guest-clause-section` attribute exactly.
      section: String(clause.section_number),
      title: clause.title ?? null,
      excerpt: body ? (body.length > 200 ? `${body.slice(0, 200)}…` : body) : null,
    });
  }
  return out;
}

/**
 * Scroll the guest viewer's clause card for `section` into view and pulse a
 * highlight on it. DOM-anchored (the panel is a sibling of the contract view;
 * no ref threading through the page). No-op when the anchor is absent.
 */
export function scrollToGuestClause(section: string): boolean {
  const esc =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(section)
      : section.replace(/"/g, '\\"');
  const el = document.querySelector<HTMLElement>(
    `[data-guest-clause-section="${esc}"]`,
  );
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('guest-clause-highlight');
  // Force a reflow so re-adding the class restarts the CSS animation.
  void el.offsetWidth;
  el.classList.add('guest-clause-highlight');
  const clear = () => el.classList.remove('guest-clause-highlight');
  el.addEventListener('animationend', clear, { once: true });
  window.setTimeout(clear, 3000);
  return true;
}
