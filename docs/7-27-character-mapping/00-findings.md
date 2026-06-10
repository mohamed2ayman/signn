# Character-Mapping Diagnostic — ETA Civil Code PDF

> Investigation only (Phase 7.27). No production code changes, no re-ingestion, no
> `requirements.txt` updates. Diagnostic ran in the `sign-celery-worker` container
> against `/tmp/law-131-1948.pdf`.

## Summary

The corruption is dominated by a **single substitution, آ→ك** (53 of 64 aligned
events; the rest are OCR-ground-truth noise), and the root cause is a **wrong
ToUnicode CMap in the PDF's embedded Arabic font subset** — a genuine font-encoding
defect. **However, a deterministic character map CANNOT be adopted**, because the
defect is a *lossy merge*: the kaf glyph is mapped to **U+0622 (آ)**, the same
codepoint as the legitimate alef-madda. Global آ→ك fixes all 5 target words but
**breaks every legitimate آ word** (آخر→كخر, الآخرين→الكخرين, القرآن→القركن, آلات,
آثار, الآتية…), with no positional signal to separate the two. **Recommendation:
fall back to OCR** (already proven clean in the prior investigation, ~6 min/doc).

## Step 1 — Font inspection

`pdffonts` (full output in `01-fonts.txt`):

| name | type | encoding | emb | sub | uni |
|---|---|---|---|---|---|
| TimesNewRomanPS-BoldMT | TrueType | WinAnsi | no | no | no |
| TimesNewRomanPSMT | TrueType | WinAnsi | no | no | no |
| **CDOGHB+TimesNewRomanPS-BoldMT** | **CID TrueType** | **Identity-H** | **yes** | **yes** | **yes** |
| **CDOGPA+TimesNewRomanPSMT** | **CID TrueType** | **Identity-H** | **yes** | **yes** | **yes** |

- **4 fonts**: 2 non-embedded WinAnsi TrueType (Latin/digits) + **2 embedded CID
  TrueType subsets** (`CDOGHB+`, `CDOGPA+`) that carry the Arabic text.
- The Arabic subsets are **custom subsets** (the `CDOGHB+`/`CDOGPA+` prefixes) using
  **Identity-H** encoding — glyph IDs are font-internal and only resolve to Unicode
  via the font's **ToUnicode CMap**.
- **ToUnicode is present** (`uni=yes`) — so this is **not a *missing* CMap**; it is a
  **wrong CMap**. The subset's ToUnicode maps the kaf glyph to the alef-madda
  codepoint (U+0622).
- **Verdict: yes, this is a font-encoding problem** — specifically a corrupt
  ToUnicode table in a subsetted Arabic font, which is why all text-layer extractors
  (pymupdf, pdftotext, current Tesseract digital path) produced byte-identical
  corruption: they all faithfully apply the same wrong CMap.

## Step 2 — Substitution table

Aligned pymupdf (corrupted) vs 300-dpi Tesseract OCR (clean ground truth) over
**5 pages (95–99)**, word-matched via `SequenceMatcher`, char-aligned on
equal-length matched words, Arabic-letter substitutions only.

- **matched_words = 2224**, **total substitution events = 64**, **distinct pairs = 10**
- Top substitutions (full data in `03-substitution-counts.json`):

| substitution | count | nature |
|---|---:|---|
| **آ→ك** | **53** | the real corruption |
| ،→ء | 2 | OCR ground-truth noise |
| ي→ى | 2 | OCR noise (ي/ى confusion) |
| ،→؛ | 1 | OCR noise |
| ت→ن | 1 | OCR noise |
| آ→ا | 1 | OCR noise |
| أ→ج, ج→ر, ر→ة, أ→ا | 1 each | OCR noise |

- **N=7 substitutions cover ≥95%** of events (61/64) — but that figure is dominated
  by the single آ→ك; the long tail is Tesseract's own minor misreads in the
  "ground truth," **not** text-layer corruption.
- Effectively the corruption is **ONE substitution: آ→ك**.

(The absolute count of 64 is low only because equal-length word alignment skips
length-mismatched OCR words; the full-document corruption magnitude was already
measured in the prior investigation: madda≈1999 of which ~1840 are corrupted kaf.)

## Step 3 — Confidence + testing

Confidence (full data in `04-confidence-table.json`) = sub_count / (sub_count +
legitimate occurrences of the LHS char in clean text):

| substitution | sub_count | legit_in_clean | confidence |
|---|---:|---:|---:|
| **آ→ك** | 53 | 8 | **0.869** |
| ،→ء | 2 | 0 | 1.000 |
| ي→ى | 2 | 571 | 0.004 |
| ت→ن | 1 | 394 | 0.003 |
| آ→ا | 1 | 8 | 0.111 |
| أ→ج | 1 | 223 | 0.005 |

The only meaningful rule, **آ→ك, scores 0.869 — high but NOT safe.** The 13% gap is
real legitimate آ usage, not rounding.

**Test-word results (`05-test-results.md`):**
- Target words corrected: **5/5** (الشركاء, كل, كان, كذلك, كقانون all fixed). ✅
- Legitimate-آ words intact: **0/9 — ALL BROKEN.** ❌
  آخر→كخر, الآخرين→الكخرين, القرآن→القركن, مرآة→مركة, آلات→كلات, الآتية→الكتية,
  آثار→كثار, آلاف→كلاف, مكافآت→مكافكت.
- Legit آ-words confirmed present in the corpus (clean OCR, 5 pages):
  `آلات, الآتية, آخر, الآموال, آثار` — common legal vocabulary.

**Why it's unfixable by a map:** lossy merge. `آل` (=كل) is word-initial آ, identical
in position to `آخر` (legit); `شرآاء` (=شركاء) has آ-after-ر, identical to `مرآة`
(legit). Same glyph, same position, opposite intended letter → non-invertible
without a dictionary/language model.

## Recommendation

**Fall back to OCR** (force-OCR per source), as scoped in
`docs/7-27-extractor-investigation.md`.

- The character-fix path **fails the legitimate-word safety test**: it would fix
  ~1,840 corrupted kaf but introduce ~160 new corruptions in legitimate آ-words
  across the document — trading a uniform, known error for a subtle, scattered one
  in a legal corpus where terms like آخر / الآتية / آثار / أموال matter.
- A dictionary/LM-based corrector could in principle disambiguate, but that is **not
  a deterministic substitution map**: it is slower, lexicon-dependent, and risks
  silent errors on legal terms of art — strictly worse than OCR, which the prior
  investigation already proved produces clean, logical-order text at ~6 min/100-page
  document.
- **No hybrid is worth it.** A whitelist of "protected آ-words" would need to be a
  comprehensive Arabic legal lexicon; any omission = corruption. OCR sidesteps the
  whole class of problem by reading pixels instead of the broken text layer.

### Net guidance for the implementation prompt
- Implement **force-OCR per `legal_source`** (300 dpi, `ara`), not a character map.
- OCR emits logical order natively → for OCR'd sources, **suppress** the
  `is_visual_order` reversal (it would re-corrupt order).
- Keep the (now-proven-wrong-for-this-PDF) text-layer fast path for *other* sources
  with clean fonts; pymupdf is the fastest clean-text reader if/when one appears.

## Artifacts in this folder
- `01-fonts.txt` — pdffonts + pymupdf per-page font dump
- `02-alignment-pairs.csv` — corrupted/clean word pairs with substitution events
- `03-substitution-counts.json` — full substitution-count table
- `04-confidence-table.json` — confidence for the ≥95%-covering set
- `05-test-results.md` — target-word + legitimate-word test detail
