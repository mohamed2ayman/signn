# Extractor Investigation — ETA Civil Code PDF

> Investigation only (Phase 7.27). No production-pipeline changes, no re-ingestion,
> no new entries in `requirements.txt`. Test extractors were `pip install`-ed in the
> `sign-celery-worker` container for measurement only.

## Summary

All three text-layer extractors (current Tesseract digital path, **pymupdf**,
**pdftotext**) return **byte-identical corruption** — the ك→آ glyph error is baked
into the PDF's embedded text layer, so every text-layer reader inherits it
(corrupted ≈ 1,300 occurrences, `الشركاء` broken to `الشرآاء`). **pdfplumber** has
far less آ-corruption but returns **character-reversed** output (a worse problem).
**Only real OCR (Extractor 5 — render to image + Tesseract `ara`) produces clean
Arabic**: `للشركاء`, `كل`, `ذلك` all correct, in **logical reading order natively**,
with corruption ≈ 0. **Recommendation: switch the ETA/visual-order corpus to an
OCR extraction path.** As a bonus, OCR emits logical order, so the `is_visual_order`
line-reversal would no longer be needed for OCR'd sources.

## Test target

- PDF: `docs/law-131-1948.pdf` (100 pages, staged at `/tmp/law-131-1948.pdf`)
- Reference passage: مادة 1149 (page index 99 — the last page)
- Expected words: الشركاء, كل, كان, كذلك
- Corrupted versions to detect: الشرآاء, آل, آان, آذلك
- All metrics computed **after NFKC normalization** (the same transform the
  production chunker applies), so the ك→آ corruption is measured in standard form.

---

## Extractor 1 — Current Tesseract (baseline, digital fast path)

- Metrics (full PDF): `kaf=2455  madda=1999  ka_words=118  corrupted=1301`
- مادة 1149 excerpt: `مادة 1149– اقتسم الذين للشرآاء فى حق من القسمة … رجوع آل منهم على الآخرين`
- `الشركاء` intact? **NO** → renders `للشرآاء`
- Speed: **3.6 s** (full PDF)

This is the corruption profile already seen in Phase D. The digital fast path reads
the PDF's text layer directly (no OCR, because the layer is non-empty — just wrong).

## Extractor 2 — pymupdf (fitz)

- Metrics (full PDF): `kaf=2455  madda=1999  ka_words=118  corrupted=1312`
- مادة 1149 excerpt: `مادة 1149 – للشرآاء الذين اقتسموا عقاراً ، … رجوع آل منهم على الآخرين`
- `الشركاء` intact? **NO** → `للشرآاء`
- Speed: **0.2 s** (fastest)
- Note: pymupdf emits **logical word order** (unlike E1's visual order) — but the
  character-level ك→آ corruption is identical, so it doesn't help retrieval.

## Extractor 3 — pdftotext (poppler-utils)

Both variants tested.

- **3a `-enc UTF-8 -layout`**: `kaf=2455  madda=1999  ka_words=118  corrupted=1324`, 0.4 s
- **3b `-enc UTF-8` (plain)**: `kaf=2455  madda=1999  ka_words=118  corrupted=1324`, 0.2 s
- مادة 1149 excerpt (both): `مادة 1149 للشرآاء الذين اقتسموا عقارًا ، … رجوع آل منهم على الآخرين`
  (also injects bidi control marks `‪ ‫` around runs)
- `الشركاء` intact? **NO** → `للشرآاء`
- `-layout` inflates char count (410k vs 298k) by preserving column whitespace; no
  effect on the corruption.

## Extractor 4 — pdfplumber

- Metrics (full PDF): `kaf=2455  madda=1999  ka_words=1100  corrupted=26`
- مادة 1149 excerpt: `نيذلا ءاآرشلل –1149 ةدام … نيرخلآا ىلع مهنم لآ عوجر`
- `الشركاء` intact? **NO**
- Speed: **18.5 s** (slowest of the text-layer readers)
- **Observation:** pdfplumber's much lower `corrupted` count (26) and high
  `ka_words` (1100) are misleading — its output is **character-reversed**
  (`ةدام` = `مادة` spelled backwards). It orders glyphs by x-position, which for
  this visually-laid-out RTL PDF reverses each word's characters. Character-level
  reversal is harder to undo than the word-level reversal we already handle, and
  the ك→آ glyph corruption is still present underneath. Not viable.

## Extractor 5 — Real OCR (pdf2image @ 300 dpi + Tesseract `ara`)

Renders pages to images and OCRs the pixels — **bypasses the corrupt text layer
entirely.** Tested on 2 pages around مادة 1149 (page 99–100; the doc is 100 pages).

- Metrics (2 pages only): `kaf=74  madda=10  ka_words=21  corrupted=1`
  (the single `corrupted` hit and the 10 `madda` are legitimate آ words such as
  `الآخرين`, not glyph errors)
- مادة 1149 excerpt:
  > `مادة 1149 - للشركاء الذين اقتسموا عقاراً » حق امتياز عليه تأمينا لما تخوله القسمة من حق فى رجوع كل منهم على الآخرين بما فى ذلك حق المطالبة بمعدل القسمة . ويجب أن يقيد هذا الامتياز`
- `الشركاء` intact? In context **YES** — the page contains `للشركاء` with the
  **correct ك**. (The strict standalone-`الشركاء` substring test reports NO only
  because the page uses the contracted `للشركاء` form, not because of corruption.)
  `كل`, `ذلك`, `تخوله` all correct.
- **Logical order: YES, natively** — no word/char reversal needed.
- Speed: **3.5 s/page** at 300 dpi → **~6 min for the full 100-page PDF**
  (well inside the legal-ingest Celery `soft_time_limit=1800s` / `time_limit=2400s`).

---

## Comparison table

| Extractor | kaf | madda | ka_words | corrupted | الشركاء (kaf correct?) | speed |
|---|---:|---:|---:|---:|:--:|---:|
| E1 Current Tesseract (text layer) | 2455 | 1999 | 118 | **1301** | NO | 3.6 s |
| E2 pymupdf | 2455 | 1999 | 118 | **1312** | NO | 0.2 s |
| E3a pdftotext -layout | 2455 | 1999 | 118 | **1324** | NO | 0.4 s |
| E3b pdftotext plain | 2455 | 1999 | 118 | **1324** | NO | 0.2 s |
| E4 pdfplumber | 2455 | 1999 | 1100 | 26 | NO (char-reversed) | 18.5 s |
| **E5 OCR (2 pages)** | 74\* | 10\* | 21\* | **1\*** | **YES (`للشركاء`)** | 3.5 s/pg |

\* E5 numbers are for 2 sampled pages, not the full doc — compare the *ratio*
(corrupted≈0) and the eyeball excerpt, not absolute totals. E1–E4 totals are full-PDF.

The identical `kaf=2455 / madda=1999` across E1–E4 is the key finding: every
text-layer reader sees the same corrupted glyph stream. The corruption is in the
PDF's font/ToUnicode map, not in any extractor's handling.

## Recommendation

**Switch ETA / visual-order legal sources to an OCR extraction path (Extractor 5).**
It is the only approach that produces correct Arabic from this PDF.

### Estimated integration effort — small-to-moderate

The existing `TesseractTextExtractor` **already has an OCR routine** (`_ocr_pdf`,
using `pdf2image` + `pytesseract` with `ara+eng`). The blockers are:

1. **It only triggers when the text layer is empty.** This PDF has a (corrupt)
   non-empty text layer, so `_extract_pdf` takes the digital fast path and never
   OCRs. A **force-OCR switch** is needed — most naturally gated on a per-source
   flag, parallel to `is_visual_order` (e.g. `legal_sources.force_ocr` or a single
   `extraction_mode` column: `auto` | `ocr`). The ETA row would set it.
2. **DPI:** `_ocr_pdf` currently renders at `dpi=150`; the clean result above used
   **`dpi=300`**. The OCR path (or the forced-OCR path) should use 300 dpi for
   Arabic legal text. 150 dpi was not tested here and may corrupt.
3. **`pdf2image` + `poppler-utils` + `tesseract-ocr-ara`** are **already installed**
   in the worker image (CI installs them; `pdf2image>=1.16.0` is in
   `requirements.txt`; `ara` langpack present). No new dependencies for OCR.
4. No new pip package is required for the *winning* approach — unlike pymupdf /
   pdfplumber, OCR reuses what's already in the image.

A reasonable shape: add a `force_ocr` (or `extraction_mode`) flag to `legal_sources`,
thread it through ingestion exactly like `is_visual_order`, and have the task call a
300-dpi OCR path when set. ~1 focused change, mirroring the source-flag plumbing
just built.

### Other observations

- **The `is_visual_order` flag becomes unnecessary for OCR'd sources.** OCR emits
  logical order natively, so word-reversal must **not** be applied on top of OCR
  output (doing so would re-corrupt the order). If a source is `force_ocr=true`,
  ingestion should pass `is_visual_order=false` to the chunker regardless of the
  source's visual-order flag — i.e. OCR supersedes the reversal. Worth making the
  two flags mutually coherent (OCR ⇒ skip reversal).
- **pymupdf is logical-order + extremely fast (0.2 s)** — if a *different* legal
  source ships a clean (non-corrupt) text layer, pymupdf would be the ideal
  fast path for it. Keep it in mind as the preferred text-layer reader for
  good-quality PDFs, even though it loses on this corrupted one.
- **OCR cost/latency:** ~6 min/100-page document, single-threaded at 300 dpi. For a
  growing corpus this is acceptable as a background Celery job but is ~100× slower
  than text-layer extraction — so OCR should be opt-in per source, not the default.
- The corruption is **source-specific** (the ETA publisher's PDFs). Cataloguing
  extraction mode per `legal_source` (the same place `is_visual_order` lives) is the
  right level of granularity.
