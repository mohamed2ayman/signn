# OCR OOM Investigation

> Investigation only (Phase 7.27). No production code changes, no requirements
> changes, no restarts. Findings for review before the fix prompt.

## Summary

**Confirmed: the force-OCR path OOM-killed the worker.** `_extract_pdf_force_ocr`
calls `pdf2image.convert_from_path(path, dpi=300)` with **no page bounds**, so
poppler renders and pdf2image loads **all 100 pages at once** — ~2.5 GB of PIL
images held simultaneously against the worker's **3 GB** hard limit, plus poppler
subprocess + temp-file + Tesseract overhead on top. `docker inspect` shows
`OOMKilled=true`. **Recommended fix: Option A — page-by-page rendering via
pdf2image's `first_page`/`last_page`** (flat ~30 MB/page, reuses already-installed
deps). Recommend bumping the worker limit to **4 GB** alongside, because the worker
runs `--concurrency=3` (up to 3 OCR jobs at once).

## 1. OOM confirmation

- **celery-worker memory limit: 3,221,225,472 bytes = 3.0 GB** (exact).
- **Source:** `docker-compose.yml` `celery-worker` service (line ~110–113):
  ```yaml
      deploy:
        resources:
          limits:
            memory: 3G
          reservations:
            memory: 512M
  ```
- **SIGKILL / OOM evidence:**
  - `docker inspect sign-celery-worker` → **`OOMKilled=true`** (decisive).
  - Worker logs:
    ```
    [19:56:08] Task tasks.run_ingest_legal_document[804dd4b3...] received
    [19:56:49] Process 'ForkPoolWorker-2' pid:9 exited with 'signal 9 (SIGKILL)'
    [19:56:50] WorkerLostError: Worker exited prematurely: signal 9 (SIGKILL) Job: 0.
    ```
  - ~41 s elapsed before the kill — consistent with poppler rendering pages and
    pdf2image accumulating PIL images until the 3 GB ceiling was hit.
- **Failed document state** (`73fe2f31-67b9-40a1-b299-5167e53908ee`):
  | field | value |
  |---|---|
  | embedding_status | **PENDING** |
  | text_len | (null) |
  | error_message | (null) |
  | created_at | 2026-06-07 19:56:07 |

  OCR never finished — no extracted text was ever written. Note the doc is stuck in
  **PENDING with no error_message**: the OOM kill (signal 9) terminated the process
  before the task's `_mark_document_status(..., 'FAILED', ...)` path could run, so a
  killed OCR job leaves the document silently stuck. (See Open Questions.)

## 2. Current extractor code

- **Path:** `ai-backend/app/services/tesseract_text_extractor.py`
- **Function:** `_extract_pdf_force_ocr`
- **Verdict: all-at-once (no batching)** — hypothesis confirmed.

```python
def _extract_pdf_force_ocr(self, path: str) -> dict[str, Any]:
    from pdf2image import convert_from_path
    import pytesseract

    images = convert_from_path(path, dpi=FORCE_OCR_DPI)   # ← ALL pages at once, no bounds
    pages_text: list[str] = []
    for img in images:                                    # list already fully in RAM here
        try:
            pages_text.append(pytesseract.image_to_string(img, lang="ara"))
        finally:
            img.close()
    text = "\n\n".join(pages_text)
    return {"text": text, "page_count": len(images), "quality_flags": ["ocr_forced"]}
```

`convert_from_path(path, dpi=300)` has no `first_page`/`last_page`, no
`output_folder`, no `thread_count` tuning — it builds the entire `images` list in
memory before the OCR loop even starts. The per-image `img.close()` in the loop is
correct but irrelevant to peak memory, because the **whole list is already
resident** by the time the loop runs.

## 3. Memory estimate

- **PDF page count: 100** (via `pdfinfo`; cross-checked against the earlier fitz
  read of 100 — the hypothesis's "~200" was an overestimate, but the conclusion
  holds).
- **Per-page image @ 300 dpi:** an A4-ish page ≈ 2480 × 3508 px × 3 B (RGB) ≈
  **~26 MB** as a PIL image.
- **Estimated peak (all-at-once):** 100 × ~26 MB ≈ **~2.6 GB** of PIL images held
  simultaneously — *before* adding:
  - poppler `pdftoppm` subprocess working set + its temp image files being read,
  - PIL decode buffers,
  - the ~70 MB Python/celery baseline,
  - Tesseract's own footprint.
- **Container limit: 3.0 GB.**
- **Verdict: oversubscribed.** The ~2.6 GB image list alone is ~87 % of the limit;
  with poppler + decode + baseline + Tesseract, peak crosses 3 GB → OOMKilled. At
  100 pages it's a near-miss-then-kill; the design would fail harder on any larger
  document. The approach does not scale with page count — it must be bounded.

## 4. Fix options

### Option A — page-by-page via `pdf2image` `first_page`/`last_page` (RECOMMENDED)
```python
total = pdfinfo_from_path(path)["Pages"]   # or PdfReader page count
pages_text = []
for n in range(1, total + 1):
    imgs = convert_from_path(path, dpi=300, first_page=n, last_page=n)
    try:
        pages_text.append(pytesseract.image_to_string(imgs[0], lang="ara"))
    finally:
        imgs[0].close()
```
- **Pros:** peak memory stays flat at **~30 MB/iteration** regardless of page count;
  reuses the **already-installed** `pdf2image` + `poppler-utils` (no new dependency);
  smallest diff; mirrors the batching the existing `_ocr_pdf` fallback already uses
  (which renders in batches of 5). Proven library path.
- **Cons:** spawns one `pdftoppm` subprocess per page (100 short subprocess
  invocations) — minor latency overhead vs one big render; negligible against the
  ~3.5 s/page OCR cost.

### Option B — pymupdf (`fitz`) in-process rendering
```python
doc = fitz.open(path)
for page in doc:
    pix = page.get_pixmap(dpi=300)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    pages_text.append(pytesseract.image_to_string(img, lang="ara"))
```
- **Pros:** no poppler subprocess per page; in-process, predictable memory;
  pymupdf is fast.
- **Cons:** **`fitz` is NOT in the production image** (confirmed:
  `ModuleNotFoundError: No module named 'fitz'` in the recreated worker — it was
  only pip-installed ad-hoc during prior investigations). Adopting B means a **new
  `requirements.txt` entry** + image rebuild, and introduces a second PDF-rendering
  stack alongside poppler. Larger change for no functional gain here.

### Recommendation
**Option A.** It fixes the OOM with a minimal, dependency-free diff, stays on the
poppler stack we already ship, and matches the batching pattern already present in
`_ocr_pdf`. Option B's only real advantage (no subprocess) doesn't justify a new
dependency and a parallel render stack.

## 5. Container memory policy

- **celery-worker limit: 3 GB**, set in `docker-compose.yml`
  `deploy.resources.limits.memory: 3G` (line ~113). Reservation 512M.
- **Concurrency factor:** the worker runs `--concurrency=3` (per `docker-compose.yml`
  command + CLAUDE.md). After the page-by-page fix each OCR job holds only
  ~30–50 MB of image at a time, so 3 concurrent OCR jobs ≈ ~150 MB of images +
  3× Tesseract — comfortably under 3 GB. So **Option A alone is sufficient** to stop
  the OOM.
- **Recommendation:** bump to **4 GB** alongside the code fix as safety headroom
  (3 concurrent OCR + embedding payloads + Python baseline leaves little slack at
  3 GB on edge cases), but this is *defense-in-depth*, not required for correctness.
  The code fix is the actual cause-fix; the limit bump is optional insurance.

## Open questions for Ayman

1. **Stuck-PENDING on worker kill.** An OOM (signal 9) kills the process before the
   task's FAILED-marking runs, leaving the document in PENDING with no
   error_message and no job behind it. Out of scope for the OOM fix, but worth a
   follow-up: either mark such docs FAILED via a sweeper / `task_reject_on_worker_lost`
   + visibility, or surface "stuck PENDING > N min" in ops. Want this folded into
   the fix prompt or tracked separately?
2. **Memory bump decision.** Take the 4 GB bump now (defense-in-depth) or ship the
   page-by-page fix alone and leave the limit at 3 GB?
3. **DPI vs memory tradeoff.** 300 dpi is locked in `FORCE_OCR_DPI` (quality-proven).
   Page-by-page makes DPI memory-irrelevant, so no change recommended — just
   confirming we keep 300.
