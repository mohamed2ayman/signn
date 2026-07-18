/**
 * Contract-party extraction from a contract's PREAMBLE window.
 *
 * Background (see docs/parties-extraction-bug-investigation.md): the previous
 * inline regex in document-processing.service.ts covered exactly ONE Arabic
 * format, was gated Arabic-only, ran on the whole document (scraping body
 * company-names into the party slot), and used a first-writer-wins guard that let
 * an early wrong document permanently block the real Agreement document. Only
 * 3/15 gold contracts extracted both parties correctly.
 *
 * This module is a PURE, unit-tested extractor:
 *  - PART C (scoping): callers pass the PREAMBLE window (text before clause 1 —
 *    see computePreambleWindow in cover-trim.util.ts), so body cross-references
 *    like "between the Attachments" inside clause 1 can never be captured.
 *  - PART A (coverage): Arabic classic (بين كل من … (طرف أول) و …) + فريق variants
 *    + English preambles ("between X and Y", "First Party" / "Second Party").
 *  - PART C (first-writer-wins) + PART B (Haiku fallback) orchestration lives in
 *    resolveParties(), which prefers the BEST result across a contract's
 *    documents and never overwrites a human edit.
 *
 * No DB access, no network — the AI fallback is injected as a function so the
 * decision logic stays pure and testable.
 */

export interface ExtractedParties {
  firstParty: string | null;
  secondParty: string | null;
}

/** 0, 1 or 2 — how many party slots are populated. Drives best-result-wins. */
export function partyScore(p: ExtractedParties): number {
  return (p.firstParty ? 1 : 0) + (p.secondParty ? 1 : 0);
}

/** Higher score wins; on a tie the first argument (`a`) is kept. */
export function pickBetter(a: ExtractedParties, b: ExtractedParties): ExtractedParties {
  return partyScore(b) > partyScore(a) ? b : a;
}

// ---------------------------------------------------------------------------
// Arabic patterns (ported + extended from the old inline regex)
// ---------------------------------------------------------------------------

/** Anchor that opens the Arabic party block. */
const AR_ANCHOR =
  /(?:تم\s*الاتفاق\s*بين\s*كل\s*من|بين\s*كل\s*من|كل\s*من\s*:)/;

/**
 * Stop-words that END a party name (address / representation / ordinal-role
 * markers). Extended with الفريق (some templates use فريق instead of طرف).
 */
const AR_STOP_WORDS =
  /(?:ويمثلها|ويمثله|ومقرها|ومقره|مقرها|ويشار|طرف\s*أول|الطرف\s*الأول|فريق\s*أول|الفريق\s*الأول|طرف\s*ثان|الطرف\s*الثاني|فريق\s*ثان|الفريق\s*الثاني|–\s*طرف|هاتف|تليفون|ص\.?\s*ب|والكائن|الكائن|يقع\s*مقرها|الواقع|بالعنوان|سرايات|ميدان|في\s+\d)/;

/** Boundary after the first party's "(طرف أول)"/"(الفريق الأول)" label. */
const AR_FIRST_PARTY_BOUNDARY =
  /(?:طرف\s*أول\s*\)?|الطرف\s*الأول\s*\)?|فريق\s*أول\s*\)?|الفريق\s*الأول\s*\)?)\s*(?:و\s*(?:بين\s*)?|[\s\-–:]*\d*[\s\-–:]*)/;

// ---------------------------------------------------------------------------
// English patterns (best-effort; the Haiku fallback is the real English path)
// ---------------------------------------------------------------------------

/** English opener. */
const EN_ANCHOR = /\b(?:by\s+and\s+between|between)\b/i;

/**
 * Stop-words that END an English party name — role labels, address /
 * representation phrases, and the recitals opener.
 */
const EN_STOP_WORDS =
  /(?:\(|,|"|“|”|;|\bwhose\b|\brepresented\s+by\b|\bhaving\s+its\b|\bwith\s+its\b|\ba\s+company\b|\bhereinafter\b|\bof\s+the\s+first\s+part\b|\bof\s+the\s+second\s+part\b|\bfirst\s+party\b|\bsecond\s+party\b|\bthe\s+employer\b|\bthe\s+client\b|\bthe\s+owner\b|\bthe\s+contractor\b|\bthe\s+subcontractor\b|\bwitnesseth\b|\bwhereas\b|\bnow\s+therefore\b)/i;

/** The " and " that separates the first English party from the second. */
const EN_SEPARATOR = /\s+and\s+/i;

const MIN_NAME = 2;
const MAX_NAME = 400;
const MAX_WORDS = 15;

/** Trim an over-long Arabic name at the first address word after "في". */
function trimArabicName(name: string): string {
  const words = name.split(/\s+/);
  if (words.length <= MAX_WORDS) return name;
  const addressCut = name.match(/\s+في\s+(?:\d|ميدان|شارع|منطقة|مدينة|حي|سرايات|طريق)/);
  if (addressCut?.index !== undefined) return name.substring(0, addressCut.index).trim();
  return words.slice(0, MAX_WORDS).join(' ');
}

function clean(raw: string): string {
  return raw.replace(/^[\s\-–:،.]+|[\s\-–:،.]+$/g, '').trim();
}

function acceptable(name: string): boolean {
  return name.length >= MIN_NAME && name.length <= MAX_NAME;
}

function extractArabic(preamble: string): ExtractedParties {
  const result: ExtractedParties = { firstParty: null, secondParty: null };
  const anchor = preamble.match(AR_ANCHOR);
  if (!anchor || anchor.index === undefined) return result;

  const afterAnchor = preamble.substring(anchor.index + anchor[0].length);
  const firstStop = afterAnchor.match(AR_STOP_WORDS);
  if (firstStop?.index !== undefined) {
    const name = trimArabicName(clean(afterAnchor.substring(0, firstStop.index)));
    if (acceptable(name)) result.firstParty = name;
  }

  const boundary = preamble.match(AR_FIRST_PARTY_BOUNDARY);
  if (boundary?.index !== undefined) {
    const remaining = preamble.substring(boundary.index + boundary[0].length);
    const secondStop = remaining.match(AR_STOP_WORDS);
    if (secondStop?.index !== undefined) {
      const name = trimArabicName(clean(remaining.substring(0, secondStop.index)));
      if (acceptable(name)) result.secondParty = name;
    }
  }
  return result;
}

function extractEnglish(preamble: string): ExtractedParties {
  const result: ExtractedParties = { firstParty: null, secondParty: null };
  const anchor = preamble.match(EN_ANCHOR);
  if (!anchor || anchor.index === undefined) return result;

  const afterAnchor = preamble.substring(anchor.index + anchor[0].length);

  // The block up to the second party's stop-word / recitals is the two-party
  // span. Split it on the first " and " to separate first ⇄ second.
  const sep = afterAnchor.match(EN_SEPARATOR);
  if (sep?.index === undefined) return result;

  const firstRaw = afterAnchor.substring(0, sep.index);
  const firstStop = firstRaw.match(EN_STOP_WORDS);
  const first = clean(firstStop?.index !== undefined ? firstRaw.substring(0, firstStop.index) : firstRaw);
  if (acceptable(first)) result.firstParty = first;

  const afterSep = afterAnchor.substring(sep.index + sep[0].length);
  const secondStop = afterSep.match(EN_STOP_WORDS);
  const second = clean(secondStop?.index !== undefined ? afterSep.substring(0, secondStop.index) : afterSep);
  if (acceptable(second)) result.secondParty = second;

  return result;
}

/**
 * Extract {firstParty, secondParty} from a PREAMBLE window (Arabic + English).
 * Tries Arabic first, then English, and keeps whichever yields more parties.
 * Returns nulls when nothing matches (e.g. a Conditions/TOC window with no
 * named party block) — the caller then leaves the contract untouched.
 */
export function extractPartiesFromPreamble(preamble: string): ExtractedParties {
  if (!preamble || !preamble.trim()) return { firstParty: null, secondParty: null };
  return pickBetter(extractArabic(preamble), extractEnglish(preamble));
}

/**
 * Decision + orchestration for a single document's contribution to a contract's
 * party fields. PURE except for the injected `aiFallback` (the Haiku call).
 *
 * - Human edits are sacrosanct: `current.edited` ⇒ never write (PART B #6).
 * - Regex-first; the AI fallback fires ONLY when regex yields < 2 parties
 *   (PART B #5) and its result is used only if it is strictly better.
 * - Best-result-wins across documents (PART C #2): write only when the chosen
 *   result has MORE parties than what is already stored — so a later Agreement
 *   doc upgrades an earlier partial, and a later partial never downgrades a
 *   good earlier result.
 */
export async function resolveParties(
  preamble: string,
  current: { firstParty: string | null; secondParty: string | null; edited: boolean },
  aiFallback: (preamble: string) => Promise<ExtractedParties>,
): Promise<{ write: boolean; parties: ExtractedParties; usedAi: boolean }> {
  const regex = extractPartiesFromPreamble(preamble);

  // NEVER overwrite a human edit — and don't waste an AI call on one either.
  if (current.edited) return { write: false, parties: regex, usedAi: false };

  let chosen = regex;
  let usedAi = false;

  if (partyScore(regex) < 2) {
    try {
      const ai = await aiFallback(preamble);
      const better = pickBetter(regex, ai);
      if (partyScore(better) > partyScore(regex)) {
        chosen = better;
        usedAi = true;
      }
    } catch {
      // AI fallback failed (no key / timeout / bad JSON) — keep the regex result.
    }
  }

  const currentScore = partyScore(current);
  const write = partyScore(chosen) > 0 && partyScore(chosen) > currentScore;
  return { write, parties: chosen, usedAi };
}
