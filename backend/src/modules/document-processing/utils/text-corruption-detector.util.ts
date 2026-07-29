/**
 * Post-extraction Arabic text-corruption detector (scan-corruption guard — Fix #1).
 *
 * A scanned / broken-text-layer PDF is silently OCR-reconstructed by the extractor:
 * Arabic ligatures come back as runs of Latin garbage ("Sones 2018" for "لسنة 2018",
 * "(4B)" for "(48)"). The Phase-7.25 image-quality gate (_assess_quality: blur /
 * contrast / rotation) never catches this — a PDF with ANY text layer skips OCR
 * entirely, and even on the OCR path the gate measures the INPUT image, not the
 * extracted TEXT. This detector runs on the FINAL extracted text, so it covers EVERY
 * route (docx / pdf-text-layer / ocr), and raises a NON-PARKING observability flag so
 * the document is surfaced for review — clauses still extract normally.
 *
 * Pure function, unit-tested in isolation. Returns [] or a single
 * 'text_corruption_suspected:<score>' flag (mirrors the 'blur:<n>' flag format).
 */

// Legit English terms observed embedded in otherwise-Arabic construction contracts
// (authority abbreviations, software + product names, technical terms). Excluded from
// the corruption score so a clean bilingual doc never false-triggers. Case-insensitive;
// extend freely as new legitimate terms surface.
const LEGIT_LATIN_ALLOWLIST = new Set(
  [
    'NAT',
    'Aconex',
    'Deliverables',
    'ORASCOM',
    'CONSTRUCTION',
    'Retail',
    'Advisory',
    'Proposal',
    'Managed',
    'Chrome',
    'Nissan',
    'Sunny',
    'USED',
    'Employer',
    'Requirements',
    'DIRECT',
    'Preliminary',
    'Detailed',
  ].map((t) => t.toLowerCase()),
);

// Arabic script must DOMINATE before the Latin-run heuristic applies — an English or
// bilingual document is legitimately full of Latin and must NEVER be flagged.
const ARABIC_DOMINANCE_RATIO = 0.5;

// Fire when non-allowlisted Latin runs exceed this density per 10,000 chars.
// Calibrated against the corpus: Project10 (scanned PDF, OCR-reconstructed) measured
// ~61 runs/10k → fires; clean Arabic docx (Project8 / Project4) measured <1/10k → silent.
const CORRUPTION_RUNS_PER_10K_THRESHOLD = 25;

/**
 * Detect OCR/text-layer corruption in Arabic-dominant extracted text.
 *
 * @param text the final extracted (post-cover-trim) document text
 * @returns [] when clean or non-Arabic; ['text_corruption_suspected:<score>'] when the
 *   non-allowlisted Latin-run density crosses the threshold.
 */
export function detectTextCorruption(text: string): string[] {
  const total = text?.length ?? 0;
  if (total === 0) {
    return [];
  }

  // Arabic-classify FIRST — only Arabic-dominant text is a candidate. This is what
  // keeps the legit-English / bilingual docx silent (they never reach the run count).
  // Count Arabic-script chars by codepoint (U+0600–U+06FF); a numeric scan avoids a
  // literal-glyph or escape-sensitive regex.
  let arabicChars = 0;
  for (let i = 0; i < total; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0x0600 && code <= 0x06ff) {
      arabicChars += 1;
    }
  }
  if (arabicChars / total <= ARABIC_DOMINANCE_RATIO) {
    return [];
  }

  const latinRuns = text.match(/[A-Za-z]{2,}/g) ?? [];
  const suspicious = latinRuns.filter(
    (run) => !LEGIT_LATIN_ALLOWLIST.has(run.toLowerCase()),
  );
  const score = (suspicious.length / total) * 10000;

  if (score < CORRUPTION_RUNS_PER_10K_THRESHOLD) {
    return [];
  }
  return [`text_corruption_suspected:${score.toFixed(1)}`];
}
