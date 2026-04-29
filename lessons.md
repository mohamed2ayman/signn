# lessons.md — SIGN + CENVOX Platform
> This file documents every bug, issue, and fix that took significant time to resolve.
> Feed this file to Claude at the start of every session to avoid repeating mistakes.
> Last updated: 2026-04-28

---

## How to Use This File
- Read this file at the start of every Claude session
- Add new lessons after every bug that took more than 30 minutes to fix
- Format: Problem → Root Cause → Fix → How to Avoid

---

## 📋 Table of Contents
1. Clause Extraction — max_tokens too small
2. Clause Extraction — Wrong Arabic clause patterns
3. Clause Extraction — Sub-articles split as separate clauses
4. Clause Extraction — Cover page trimming too aggressive
5. Clause Extraction — Large documents timing out (chunking solution)
6. Clause Extraction — Tiny orphan chunks crashing extraction
7. Clause Extraction — Oversized single articles still too large after chunking
8. Clause Extraction — Chunk boundaries splitting articles in half
9. Clause Extraction — TOC entries extracted as real clauses
10. Clause Extraction — Cross-references mistaken as clause headings
11. Clause Extraction — Duplicate clauses from overlapping chunks
12. Clause Extraction — API costs too high (tiered max_tokens fix)
13. Clause Extraction — Definitions clause not formatted as bullet points
14. Docker — bcrypt binary fails on Windows
15. Docker — CRLF line endings crash entrypoint on Linux
16. Docker — Celery worker code changes not taking effect
17. Docker — Concurrency set to 1 (all documents process sequentially)
18. Docker — Celery tasks killed at 600s (large documents always fail)
19. Word File Extraction — Tables and headers missing
20. Database — Orphaned clauses inflating dashboard count
21. Frontend — currentUser always null after page refresh
22. Frontend — Arabic text displaying left-to-right
23. Frontend — Comment edit/delete icons not showing
24. Frontend — Portal chooser redirect loop for admin users
25. GitHub — Personal access token expiring
26. GitHub — Mac osxkeychain interfering with token
27. Clause Extraction — مادة (N) prefix appearing in clause content

---

## 1. Clause Extraction — max_tokens Too Small

**Problem:**
- Clause extraction was returning 0 clauses
- No error shown in UI
- JSON responses were being cut off mid-string

**Root Cause:**
- `max_tokens` was hardcoded to `8192` in `clause_extractor.py`
- Arabic contracts with 20+ clauses require 15,000–25,000 output tokens
- Claude was generating correct JSON but hitting the token limit mid-response
- `json.loads()` then threw `JSONDecodeError` on the truncated response

**Fix:**
- Implemented tiered `_calculate_max_tokens()` method:
  - Chunks < 10,000 chars → 16,000 tokens
  - Chunks < 20,000 chars → 24,000 tokens
  - Chunks >= 20,000 chars → 32,000 tokens
- This saves 50-75% vs old hardcoded 64,000

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- Never hardcode `max_tokens` for Arabic content
- Arabic JSON output is larger than estimated — always add 50% buffer
- Always check celery logs for JSONDecodeError when clauses = 0

---

## 2. Clause Extraction — Wrong Arabic Clause Patterns

**Problem:**
- Particular Conditions clauses not being recognized
- Extraction returning 0 clauses even with correct text
- The document used `مادة (1)` format but prompt only handled `المادة (1)`

**Root Cause:**
- SYSTEM_PROMPT only listed: `"المادة 1"`, `"المادة (1)"`, `"مادة رقم"`
- Missing the most common Egyptian government contract format: `مادة (1)` (without ال article)
- Also missing: `مادة (١)` Arabic-Indic numerals, `مادة رقم (١)`, `مادة 1` without brackets

**Fix:**
- Added all مادة variations to Guideline 8 in SYSTEM_PROMPT:
  - `مادة (1)` / `مادة (١)` — Western or Arabic-Indic in brackets
  - `مادة رقم (1)` / `مادة رقم (١)` — with رقم
  - `مادة 1` / `مادة ١` — no brackets
  - `المادة 1` / `المادة (1)` / `المادة رقم` — with definite article
- Also added البند رقم (N) format for Contract Agreement documents

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- Egyptian government contracts use `البند رقم (N):` format
- Particular Conditions use `مادة (N)` format
- General Conditions use `مادة (N) : title :` format
- Always check actual document text before assuming clause marker format
- Run: `SELECT LEFT(extracted_text, 500) FROM document_uploads WHERE ...`

---

## 3. Clause Extraction — Sub-articles Split as Separate Clauses

**Problem:**
- Particular Conditions: 16 clauses extracted but structure was wrong
- Sub-articles like `9-1`, `9-2`, `9-3` were extracted as separate top-level clauses
- مادة 12 with sub-articles 12-1 through 12-10 created 10 separate clauses instead of 1

**Root Cause:**
- SYSTEM_PROMPT Guideline 3 said "each clause should be atomic" with no exception for sub-articles
- Claude treated `9-2`, `9-3` as "separate" and made them atomic
- No rule existed to explain that N-M and N/M patterns are sub-articles not top-level clauses

**Fix:**
- Updated Guideline 3: Added explicit sub-article exception
- Added Guideline 10: "Everything from مادة (N) to مادة (N+1) = ONE clause"
- Sub-articles numbered N-M (dash) or N/M (slash) must stay inside parent مادة
- `clause_number` should always be the parent number, never the sub-article number

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- Always verify sub-article containment after first extraction
- Check DB: `SELECT clause_number, title FROM clauses WHERE source_document_id = '...'`
- If you see clause_number like "9-2" or "4/1" — sub-article rule is broken

---

## 4. Clause Extraction — Cover Page Trimming Too Aggressive

**Problem:**
- Particular Conditions extraction was missing Articles 1-8 completely
- First extracted clause had no section number and started mid-article
- General Conditions started from wrong position in document

**Root Cause:**
- `trimCoverPages()` in `document-processing.service.ts` matched `تم الاتفاق` pattern
- This phrase appeared inside a sub-article body (not just on the cover page)
- The function cut everything before that match — deleting Articles 1-8

**Fix:**
- For Conditions documents (Particular/General): now searches for FIRST `مادة` marker
- Pattern: `/مادة\s*[\(\s]?[١-٩\d]/`
- For Agreement documents: kept existing behavior (searches for `تم الاتفاق` first)
- Document type detected by label: conditions/شروط/general/particular/spec/مواصفات

**File:** `backend/src/modules/document-processing/document-processing.service.ts`

**How to Avoid:**
- After reprocessing always verify: `SELECT LEFT(extracted_text, 200) FROM document_uploads WHERE ...`
- Text should start at the first real clause marker not mid-sentence
- Never use broad Arabic phrases as cover page markers — they appear in body text too

---

## 5. Clause Extraction — Large Documents Timing Out (Chunking Solution)

**Problem:**
- General Conditions (81,315 chars) always timed out
- Task was killed at exactly 600 seconds every time
- Retry loop: killed → NestJS retried → killed again → infinite loop
- Single API call for 70k+ chars is too large for Claude to process reliably

**Root Cause:**
- Sending the entire document in one Claude API call
- Claude needs 8-10 minutes just for the API call on 70k+ char documents
- No chunking strategy existed — all or nothing approach

**Fix — Chunking Implementation:**
- Documents > 30,000 chars → automatically use `_extract_chunked()` method
- Documents <= 30,000 chars → use `_extract_single()` (existing behavior unchanged)
- Chunk size: `_CHUNK_SIZE = 15,000` chars maximum
- Split at `مادة` article boundaries using `_ARTICLE_BOUNDARY_RE` regex
- Each chunk processed by separate Claude API call sequentially
- Results merged and deduplicated after all chunks complete

**Key Methods Added to clause_extractor.py:**
- `_extract_single()` — existing logic moved here for small documents
- `_extract_chunked()` — orchestrates chunking for large documents
- `_split_on_article_boundaries()` — splits text at مادة markers respecting chunk size
- `_merge_small_chunks()` — merges tiny leftover fragments (< 500 chars) into previous chunk
- `_break_oversized_chunk()` — handles single articles that still exceed chunk size
- `_add_article_context()` — prepends مادة heading when chunk starts mid-article
- `_group_by_boundaries()` — groups text into ≤ max_size pieces with overlap
- `_calculate_max_tokens()` — dynamic token limit based on chunk size
- `_call_api_with_retry()` — handles 529/connection errors with exponential backoff
- `_parse_json()` — graceful JSON parsing with empty response handling

**Fix — Docker Settings in docker-compose.yml:**
- `--concurrency=1` → `--concurrency=3` (3 docs in parallel)
- `--time-limit=2400` (40 minutes hard limit)
- `--soft-time-limit=1800` (30 minutes soft limit)
- Memory: 2G → 3G to support 3 parallel workers
- Added source code volume mount: `./ai-backend:/app`

**Files:**
- `ai-backend/app/agents/clause_extractor.py`
- `docker-compose.yml`

**How to Avoid:**
- Any document over 30,000 chars MUST use chunking automatically
- Never send full large Arabic document in one API call
- Check document size: `SELECT length(extracted_text) FROM document_uploads WHERE ...`
- Expected chunk count: document_chars / 15,000 = approximate number of chunks
- General Conditions (81k chars) → ~9-12 chunks → ~20 minutes total

---

## 6. Clause Extraction — Tiny Orphan Chunks Crashing Extraction

**Problem:**
- After implementing chunking, extraction kept failing on chunk 3
- Error: `Expecting value: line 1 column 1 (char 0)` — empty JSON response
- A 202-character chunk was being sent to Claude
- Claude returned prose instead of JSON for tiny fragments
- Entire task failed when one chunk failed

**Root Cause:**
- `_split_on_article_boundaries()` was creating tiny leftover fragments
- When splitting large articles, small text pieces (202 chars) were left as separate chunks
- Claude cannot extract clauses from 202 chars and returned empty/prose response
- Empty response caused `json.loads()` to crash the entire task

**Fix:**
- Added `_merge_small_chunks()` method:
  - Any chunk < 500 chars gets merged into the PREVIOUS chunk
  - Prevents orphan fragments from reaching Claude API
- Min chunk skip threshold raised: 100 → 500 chars as extra safety net
- Graceful error handling in chunk processing loop:
  - If one chunk fails → log warning and continue with next chunk
  - Never crash entire task due to one bad chunk

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- Always run `_merge_small_chunks()` after splitting before processing
- Log chunk sizes when extraction starts — check for any chunk < 500 chars
- If you see "Expecting value: line 1 column 1" — a tiny chunk is the cause
- Check logs for: "Merging tiny chunk (N chars) into previous chunk"

---

## 7. Clause Extraction — Oversized Single Articles Still Too Large After Chunking

**Problem:**
- Even after implementing 15,000 char chunks, Article 1 (Definitions) in General Conditions was 44,378 chars
- This single article exceeded the chunk size — sent as one 44k chunk
- Claude took 9+ minutes to process it — nearly hitting timeout again
- The basic chunking only split at مادة boundaries, so a huge single article stayed huge

**Root Cause:**
- `_split_on_article_boundaries()` split ONLY at مادة markers
- Article 1 (Definitions) has no sub-مادة markers — it's one massive definitions article
- Result: chunk 1 = 44,378 chars (too big), causing slow API response
- The chunk size limit was not enforced when a single article exceeded it

**Fix:**
- Added `_break_oversized_chunk()` method with 3-level fallback:
  1. **Level 1:** Split at sub-article boundaries (`_SUB_ARTICLE_RE`: N-M or N/M patterns)
  2. **Level 2:** Split at paragraph boundaries (`\n\n`)
  3. **Level 3:** Hard cut every 15,000 chars with 200-char overlap (last resort)
- Added `_group_by_boundaries()` helper: groups text into ≤ max_size pieces at given split points
- Added `_SUB_ARTICLE_RE` regex: `r"(?m)^[١-٩\d]{1,3}\s*[-/]\s*[١-٩\d]{1,3}"`
- Result: 44,378-char Article 1 now splits into ~3 sub-chunks of ~15k chars each
- Processing time improved: 9.5 minutes → ~3 minutes per sub-chunk

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- After splitting, check if any chunk exceeds `_CHUNK_SIZE` (15,000 chars)
- Arabic Definitions articles (مادة 1 in General Conditions) are almost always oversized
- Look for log message: "Oversized chunk (N chars) → M pieces at paragraph boundaries"
- Expected result for General Conditions: 81k chars → 9-12 chunks of 8-15k each

---

## 8. Clause Extraction — Chunk Boundaries Splitting Articles in Half

**Problem:**
- General Conditions extracted 56 clauses instead of correct 38
- Sub-articles of مادة 12 were extracted as separate top-level clauses
- Some clause content started mid-sentence
- Chunk 2 started mid-article and Claude extracted the continuation as new clauses

**Root Cause:**
- Chunking split at 15,000 char boundaries
- Sometimes a chunk ended in the MIDDLE of a large article (like مادة 12)
- The next chunk started mid-article with no مادة header context
- Claude saw the continuation text and extracted it as new standalone clauses

**Fix:**
- Added `_add_article_context()` method:
  - Checks if chunk starts with a مادة marker using `_ARTICLE_BOUNDARY_RE`
  - If NOT → finds the last مادة heading from the previous chunk
  - Prepends that heading to give Claude the article context
- Added explicit instruction to Claude prompt for each chunk:
  ```
  "CHUNK {i+1} OF {total}:
  Only extract clauses that START in this chunk.
  A clause STARTS when you see a مادة marker at the beginning of a line.
  Do NOT extract content that is a continuation of a clause that started before this chunk."
  ```
- Result: Chunk 2 starting mid-article → Claude correctly returns 0 clauses (recognized as continuation)
- General Conditions went from 56 wrong clauses → 38 correct clauses

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- After chunked extraction always verify total clause count matches expected document count
- If clause count is HIGHER than expected → chunk boundary issue
- Check: `SELECT clause_number, title FROM clauses WHERE source_document_id = '...' ORDER BY clause_number`
- Look for clause_numbers like "9-2" or clauses with very short content (< 50 chars)
- Check logs for: "Chunk X starts mid-article — prepending heading: مادة (N)..."

---

## 9. Clause Extraction — TOC Entries Extracted as Real Clauses

**Problem:**
- General Conditions document has a Table of Contents appended at the end of extracted text
- TOC contains entries like: `مادة (1) : تعريفات وتفسيرات ......... 4`
- Claude was extracting these TOC entries as real clauses (creating duplicates)

**Root Cause:**
- TOC entries look identical to real article headings syntactically
- Original Guideline 7 said "skip table of contents" but wasn't specific enough
- Claude couldn't reliably distinguish TOC from real articles
- Word file extractor appends table content (including TOC tables) at the END of extracted text

**Fix:**
- Strengthened Guideline 7 with specific TOC identification rules:
  - TOC identified by: مادة (N) followed by dotted lines (`......`)
  - Standalone page numbers on their own lines between entries
  - Multiple مادة entries listed sequentially with NO body text between them
  - ALL such entries must be completely skipped — never extracted as clauses

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- Word files often append the TOC table at the END of extracted text
- Always verify extracted text end: `SELECT RIGHT(extracted_text, 500) FROM document_uploads WHERE ...`
- If you see dotted lines and page numbers → TOC is appended and needs Guideline 7
- TOC pattern: `مادة (N) : title ......... page_number`

---

## 10. Clause Extraction — Cross-References Mistaken as Clause Headings

**Problem:**
- General Conditions body text contains phrases like:
  `طبقا للمادة (22) من هذه الشروط العامة`
- These look identical to real clause headings syntactically
- Claude was creating phantom clauses from inline cross-references

**Root Cause:**
- `مادة (N)` appears both as real headings AND as cross-references in body text
- No rule existed to distinguish between them
- Real heading: `مادة (12) :` at start of line followed by title
- Cross-reference: `مادة (22)` mid-sentence after من/طبقا/بموجب

**Fix:**
- Added Guideline 11: Real article headings vs cross-references
- Real heading characteristics: مادة (N) at START of line + colon + title + body text follows
- Cross-reference characteristics: مادة (N) mid-sentence preceded by:
  - من / طبقا للمادة / بموجب مادة / أحكام مادة / وفقاً للمادة / تطبيق مادة
- Cross-references are NEVER clause boundaries — always ignore them

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- Any Arabic contract document with frequent article cross-references needs Guideline 11
- FIDIC-based Arabic contracts are especially prone to this issue
- Check for phantom clauses: clauses with no body text or very short content (< 50 chars)
- Phantom clauses from cross-references usually have no title or generic titles

---

## 11. Clause Extraction — Duplicate Clauses from Overlapping Chunks

**Problem:**
- After chunked extraction, duplicate clauses appeared in the database
- Same clause extracted by two adjacent chunks
- Total clause count was inflated

**Root Cause:**
- When a chunk boundary fell near a مادة heading
- Both the previous chunk (end) and next chunk (start) extracted the same clause
- No deduplication was happening after merging all chunk results

**Fix:**
- Added deduplication by normalized title after merging all chunks:
  - `seen_titles` set tracks extracted clause titles
  - First occurrence kept, subsequent duplicates silently dropped with debug log
- Also added deduplication by clause_number as secondary check

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- Always run deduplication after merging chunk results
- Check for duplicates:
  ```sql
  SELECT clause_number, COUNT(*) FROM clauses
  WHERE source_document_id = '...'
  GROUP BY clause_number HAVING COUNT(*) > 1
  ```
- If duplicates found in DB (cleanup query):
  ```sql
  DELETE FROM clauses WHERE id NOT IN (
    SELECT MIN(id) FROM clauses
    WHERE source_document_id = '...'
    GROUP BY clause_number
  )
  ```

---

## 12. Clause Extraction — API Costs Too High

**Problem:**
- Anthropic API costs were much higher than expected
- `max_tokens=64000` was hardcoded — paying for 64k tokens even when only 5k used
- With 9 chunks per document × 64,000 max_tokens = massive unnecessary cost

**Root Cause:**
- Original fix for truncation (Lesson 1) set max_tokens to 64,000 globally
- Arabic contracts with 15k char chunks only need ~16,000-24,000 output tokens
- Paying for 64,000 but using maybe 10,000 = 6x more expensive than needed

**Fix:**
- Replaced hardcoded 64,000 with tiered `_calculate_max_tokens()` method:
  - Chunk < 10,000 chars → max_tokens = 16,000 (saves 75% vs 64k)
  - Chunk < 20,000 chars → max_tokens = 24,000 (saves 62% vs 64k)
  - Chunk >= 20,000 chars → max_tokens = 32,000 (saves 50% vs 64k)
- Dynamic value calculated and logged at DEBUG level for each API call
- Note: Do NOT go below these values — earlier attempt with dynamic formula failed
  because Arabic JSON output is denser than estimated (see Lesson 1)

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- Never hardcode max_tokens to maximum value for Arabic content
- Use the tiered approach — tested and confirmed safe
- Monitor Anthropic API usage at console.anthropic.com after each extraction
- Do not use dynamic formula (input_chars / 4 * 1.5) — underestimates Arabic output density

---

## 13. Clause Extraction — Definitions Clause Not Formatted as Bullet Points

**Problem:**
- مادة (1) in General Conditions contains 25+ definitions
- All definitions were stored and displayed as one long unreadable paragraph
- Terms and explanations were merged together with no visual separation

**Root Cause:**
- No instruction in SYSTEM_PROMPT for how to format definitions clauses
- Claude merged all definitions into continuous prose
- Frontend rendered clause content as a single `<p>` tag with no structure

**Fix — Part 1: Extraction (Guideline 12 added to SYSTEM_PROMPT):**
- Instructs Claude to format definitions as bullet points:
  ```
  - الهيئة أو العميل: يقصد بها الهيئة القومية للأنفاق
  - ممثل الهيئة: يقصد به الإستشارى العام للمشروع
  ```
- Each definition merged onto ONE line: `- term: explanation`
- Heading and intro sentence go on their own lines before the bullets
- Only applies to definitions clauses (تعريفات) not regular articles

**Fix — Part 2: Display (ClauseReviewCard.tsx):**
- Added `ClauseContentDisplay` component that:
  - Detects lines starting with `- ` automatically
  - Renders as RTL `<ul>` list:
    - `dir="rtl"` so bullets appear on RIGHT side (correct for Arabic)
    - `paddingRight: 1.5rem`, `paddingLeft: 0`
    - `textAlign: right`
  - Non-bullet lines render as regular `<p dir="auto">` paragraphs inline
  - Show more/Show less functionality preserved (shows max 4 bullets collapsed)

**Files:**
- `ai-backend/app/agents/clause_extractor.py` (Guideline 12)
- `apps/sign/src/components/review/ClauseReviewCard.tsx` (ClauseContentDisplay component)

**How to Avoid:**
- Arabic definitions clauses always need bullet point formatting
- Verify in DB after extraction:
  `SELECT LEFT(content, 300) FROM clauses WHERE title ILIKE '%تعريف%'`
- Should see lines starting with `- ` prefix
- In UI: bullets must appear on RIGHT side not left (use `dir="rtl"` on `<ul>`)

---

## 14. Docker — bcrypt Binary Fails on Windows

**Problem:**
- Backend container crashed on startup after `docker-compose up`
- Error: `Error loading shared library` or `invalid ELF header` for bcrypt
- Only happened on Windows machines

**Root Cause:**
- bcrypt is a native Node.js module compiled for the host OS
- When `node_modules` is volume-mounted from Windows into Linux container
- The Windows-compiled bcrypt binary is incompatible with Linux

**Fix:**
- Added `docker-entrypoint.sh` that runs `npm rebuild bcrypt` at container startup
- This recompiles bcrypt for the Linux container environment
- Added to `backend/Dockerfile`: `sed -i 's/\r//'` to strip CRLF from entrypoint

**Files:**
- `backend/docker-entrypoint.sh`
- `backend/Dockerfile`

**How to Avoid:**
- Any native Node.js module (bcrypt, sharp, canvas) will have this issue on Windows
- Always run `npm rebuild <module>` in the container, not on the host
- Add to entrypoint script, not Dockerfile build step (runs every container start)

---

## 15. Docker — CRLF Line Endings Crash Entrypoint on Linux

**Problem:**
- Backend container crashed with: `/usr/bin/env: 'bash\r': No such file or directory`
- Only happened after pulling from Windows-developed code

**Root Cause:**
- Windows uses CRLF (`\r\n`) line endings
- Linux expects LF (`\n`) only
- Git on Windows sometimes commits CRLF even with autocrlf settings
- The `\r` in bash scripts causes Linux to look for `bash\r` instead of `bash`

**Fix:**
- Added to `backend/Dockerfile` build step:
  `sed -i 's/\r//' /app/docker-entrypoint.sh`
- This strips all carriage returns at Docker build time
- Permanent fix — works regardless of how the file was committed

**File:** `backend/Dockerfile`

**How to Avoid:**
- Always add `sed -i 's/\r//'` in Dockerfile for any shell scripts
- Configure Git globally: `git config --global core.autocrlf input`
- Check for CRLF: `cat -A docker-entrypoint.sh | grep '\^M'`

---

## 16. Docker — Celery Worker Code Changes Not Taking Effect

**Problem:**
- Modified `tasks.py` or `clause_extractor.py` but celery worker kept using old code
- Restarting the container didn't help
- Changes were invisible to the running worker

**Root Cause:**
- The celery-worker container in `docker-compose.yml` only had:
  `volumes: - uploads_data:/app/uploads`
- It did NOT have the source code mounted: `./ai-backend:/app`
- The worker was using code baked into the Docker image at build time
- Only `docker-compose up --build` would pick up changes — very slow

**Fix:**
- Added source code volume mount to celery-worker in `docker-compose.yml`:
  `- ./ai-backend:/app`
- Now changes to any Python file are immediately visible to the worker
- Only need `docker restart sign-celery-worker` not a full rebuild

**File:** `docker-compose.yml`

**How to Avoid:**
- Always check if the container has a source code volume mount
- Without `./ai-backend:/app` mount → must rebuild image for every code change
- With mount → just restart the container: `docker restart sign-celery-worker`

---

## 17. Docker — Concurrency Set to 1 (Sequential Processing)

**Problem:**
- Uploading 3 documents → total processing time 20+ minutes
- Second document couldn't start until first finished
- Third document couldn't start until second finished
- Users saw 0% → 33% → 66% → 100% progress very slowly

**Root Cause:**
- `docker-compose.yml` had: `command: celery -A app.tasks worker --concurrency=1`
- Only ONE document could be processed at a time
- With 3 documents at ~4 min each: total = 12+ minutes sequential wait

**Fix:**
- Changed to `--concurrency=3`
- All 3 documents now process in parallel
- Total time: max(doc1_time, doc2_time, doc3_time) instead of sum
- Also raised memory limit from 2G to 3G to support 3 parallel workers (~512MB each)

**File:** `docker-compose.yml`

**How to Avoid:**
- Always set concurrency to number of expected parallel documents
- Monitor with: `docker exec sign-celery-worker celery inspect stats 2>/dev/null`
- Check `"max-concurrency"` and `"processes"` in output
- Memory formula: concurrency × 512MB + 512MB overhead = minimum container memory

---

## 18. Docker — Celery Tasks Killed at 600s

**Problem:**
- Large documents (General Conditions — 81k chars) always failed
- Task killed at exactly 600 seconds every time
- NestJS would auto-retry → killed again → infinite retry loop

**Root Cause:**
- Default Celery hard time limit was 600 seconds (10 minutes)
- Large Arabic documents need 15-20 minutes for full Claude API processing
- Worker process received SIGKILL at exactly 600s with no warning

**Fix:**
- Added to docker-compose celery command:
  `--time-limit=2400 --soft-time-limit=1800`
- Soft limit (30 min): graceful SoftTimeLimitExceeded exception — task can clean up
- Hard limit (40 min): absolute SIGKILL — never reached in practice with chunking

**File:** `docker-compose.yml`

**How to Avoid:**
- Always check document size before setting time limits
- General Conditions (81k chars) with chunking needs ~20 minutes total
- Formula: (num_chunks × avg_chunk_api_time) + merge_time = total time needed
- Set hard limit to 2x estimated total time as safety buffer

---

## 19. Word File Extraction — Tables and Headers Missing

**Problem:**
- Word files with contract terms in tables had those terms missing from extraction
- Extracted text had large gaps compared to actual document content
- Clause extraction missed payment schedules and liability clauses entirely

**Root Cause:**
- `_extract_docx()` in `text_extractor.py` only read `doc.paragraphs`
- Text inside table cells is NOT included in `doc.paragraphs`
- Headers and footers are also NOT in `doc.paragraphs`
- Arabic contracts frequently put payment terms and liability clauses in table cells

**Fix:**
- Added table cell extraction loop:
  ```python
  for table in doc.tables:
      for row in table.rows:
          for cell in row.cells:
              if cell.text.strip():
                  paragraphs.append(cell.text.strip())
  ```
- Added header paragraph extraction from `doc.sections`

**File:** `ai-backend/app/services/text_extractor.py`

**How to Avoid:**
- Always extract from paragraphs + tables + headers for Word files
- Verify extraction quality: `SELECT length(extracted_text) FROM document_uploads WHERE ...`
- A 3MB Word file should yield at least 50,000+ chars if tables are properly extracted

---

## 20. Database — Orphaned Clauses Inflating Dashboard Count

**Problem:**
- Dashboard showed 179 clauses but only 85 were in the active project
- Clause count was wrong and confusing for users

**Root Cause:**
- Multiple failed/killed extraction runs had saved SOME clauses to `clauses` table
- But the pipeline never completed so `contract_clauses` junction table entries were never created
- Dashboard query counted ALL rows in `clauses` table instead of only linked ones
- 94 "ghost clauses" had no `source_document_id` and no `contract_clauses` entry

**Fix:**
- Deleted orphaned clauses:
  ```sql
  DELETE FROM clauses WHERE id NOT IN (
    SELECT DISTINCT clause_id FROM contract_clauses
  );
  ```
- Fixed dashboard query to use `innerJoin` on `contract_clauses` table
- Now only counts clauses properly linked to contracts via junction table

**Files:**
- `backend/src/modules/dashboard-analytics/dashboard-analytics.service.ts`

**How to Avoid:**
- After any killed/failed extraction run → check for orphaned clauses
- Check: `SELECT COUNT(*) FROM clauses WHERE id NOT IN (SELECT clause_id FROM contract_clauses)`
- If count > 0 → run the DELETE query above before reprocessing
- If dashboard numbers look wrong → first check for orphaned clauses

---

## 21. Frontend — currentUser Always Null After Page Refresh

**Problem:**
- After page refresh, user appeared logged in (token in localStorage)
- But `currentUser` in Redux was always `null`
- All permission checks failed: comment edit/delete, role checks, admin detection

**Root Cause:**
- Redux auth slice restores `token` from localStorage on startup
- But `user` object (with id, role, name) is NOT restored from localStorage
- `refreshUserProfile()` was only called in `MfaSetupPage` — never on app startup
- So after refresh: `isAuthenticated = true` but `currentUser = null` permanently

**Fix:**
- Added `useEffect` in both `AppLayout.tsx` and `AdminLayout.tsx`:
  ```javascript
  useEffect(() => {
    if (isAuthenticated && !user) {
      refreshUserProfile();
    }
  }, []);
  ```
- This fetches user profile from API on mount whenever token exists but user is null

**Files:**
- `apps/sign/src/components/layout/AppLayout.tsx`
- `apps/sign/src/components/layout/AdminLayout.tsx`

**How to Avoid:**
- Any feature using `currentUser?.id` or `currentUser?.role` depends on this fix being present
- Always test permission features after PAGE REFRESH, not just after fresh login
- If permission checks fail → first check if `currentUser` is null in Redux DevTools

---

## 22. Frontend — Arabic Text Displaying Left-to-Right

**Problem:**
- Extracted Arabic clauses displayed with text aligned to LEFT
- Should be RIGHT aligned (RTL direction)
- Made Arabic content very hard to read

**Root Cause:**
- Clause title and content elements had no RTL direction specified
- Browser defaulted to LTR for all text regardless of content language
- `dir="auto"` was not applied to text containers

**Fix:**
- Added `dir="auto"` and `style={{ unicodeBidi: 'plaintext' }}` to:
  - Clause titles (`<h4>`) in ClauseReviewCard
  - Clause content (`<p>`) in ClauseReviewCard
  - Edit textarea and title input in ClauseReviewCard
  - All clause display elements in ContractDetailPage (list view + modal)
- `dir="auto"` makes browser detect direction from first strong directional character
- Arabic text → right aligned automatically
- English text → left aligned automatically
- Mixed content → each paragraph detects its own direction

**Files:**
- `apps/sign/src/components/review/ClauseReviewCard.tsx`
- `apps/sign/src/pages/app/ContractDetailPage.tsx`

**How to Avoid:**
- Always add `dir="auto"` to any element that may display Arabic text
- Never assume all text is LTR in a bilingual Arabic/English application
- Test with actual Arabic content after any UI change to clause or document display

---

## 23. Frontend — Comment Edit/Delete Icons Not Showing

**Problem:**
- Pencil ✏️ and trash 🗑️ icons were in the code but never visible on hover
- No error shown — icons simply didn't appear
- `opacity-0 group-hover:opacity-100` was applied but elements didn't exist in DOM

**Root Cause (Two Issues):**

**Issue 1 — currentUser was null (see Lesson 21):**
- `isAuthor = comment.user_id === currentUser?.id` → always false when currentUser is null
- `canEdit = isAuthor` → false → pencil icon not rendered at all
- `canDelete = isAuthor || isAdmin` → false → trash icon not rendered at all
- `opacity-0/opacity-100` only helps if elements exist in the DOM — they didn't

**Issue 2 — AdminLayout logout race condition:**
- `handleLogout` was not async/await
- `logout()` started (async API call in flight)
- `navigate('/auth/login')` fired immediately before logout completed
- Redux state still had user data → LoginPage saw authenticated user → redirect loop

**Fix:**
- Fixed currentUser null issue by adding refreshUserProfile on mount (Lesson 21)
- Made `handleLogout` async/await in AdminLayout:
  ```javascript
  const handleLogout = async () => {
    await logout();
    navigate('/auth/login', { replace: true });
  };
  ```

**Files:**
- `apps/sign/src/components/layout/AdminLayout.tsx`
- `apps/sign/src/components/layout/AppLayout.tsx`

**How to Avoid:**
- Always make logout handlers async/await — logout is an async API operation
- Test icon visibility after PAGE REFRESH not just after fresh login
- If icons not showing → check currentUser in Redux DevTools first before debugging CSS

---

## 24. Frontend — Portal Chooser Redirect Loop for Admin Users

**Problem:**
- Users with SYSTEM_ADMIN role were always redirected to `/admin/dashboard`
- Portal chooser page (`/portal-select`) never appeared
- After colleague implemented the portal chooser, it was still bypassed for existing sessions

**Root Cause (Three Issues):**

**Issue 1 — Existing session bypasses LoginPage entirely:**
- Portal chooser redirect logic was only in `LoginPage.tsx`
- Only fires on fresh login flow
- Users with valid token in localStorage → app skips LoginPage completely
- Goes directly to last visited URL (/admin/dashboard)
- Portal chooser never triggered for returning users

**Issue 2 — AdminLayout had no user profile hydration:**
- `AppLayout.tsx` had `refreshUserProfile()` on mount (Lesson 21)
- `AdminLayout.tsx` did NOT have it
- `user` was null when navigating directly to `/admin/*`
- Role check could not run → portal chooser logic never executed

**Issue 3 — Logout race condition (see Lesson 23):**
- Non-async logout caused redirect loops between login and admin pages

**Fix:**
- Added `sessionStorage` flag `portal-chosen` to track portal selection per browser session
- In `AdminLayout.tsx` — added useEffect to redirect if flag not set:
  ```javascript
  useEffect(() => {
    if (isAdminRole && !sessionStorage.getItem('portal-chosen')) {
      navigate('/portal-select');
    }
  }, [user]);
  ```
- In `PortalSelectPage.tsx` — set flag when user clicks either portal button:
  ```javascript
  sessionStorage.setItem('portal-chosen', '1');
  ```
- On logout → clear the flag so chooser shows again next session:
  ```javascript
  sessionStorage.removeItem('portal-chosen');
  ```
- Added `refreshUserProfile()` on mount to AdminLayout (same as AppLayout)

**Files:**
- `apps/sign/src/components/layout/AdminLayout.tsx`
- `apps/sign/src/pages/auth/PortalSelectPage.tsx`

**How to Avoid:**
- Never put role-based redirect logic ONLY in LoginPage — it won't run for existing sessions
- Always use layout-level checks for role-based redirects (AdminLayout, AppLayout)
- Use sessionStorage to prevent repeated redirects within the same browser session
- Always clear sessionStorage portal flags on logout
- Test ALL redirect logic with an EXISTING session (don't logout first before testing)

---

## 25. GitHub — Personal Access Token Expiring

**Problem:**
- Push failed with 403 Permission denied
- Colleague couldn't pull latest updates
- Token had expired — email notification was sent but missed

**Root Cause:**
- GitHub PAT (Personal Access Token) was created with an expiry date
- Token expired → all push/pull operations fail silently with 403

**Fix:**
- Generate new classic PAT at: https://github.com/settings/tokens
- Must use: "Generate new token (classic)" — NOT fine-grained tokens
- Must check: `repo` scope checkbox (full control of repositories)
- Set expiration to: "No expiration" for development tokens
- Classic tokens start with `ghp_` — fine-grained tokens start with `github_pat_`
- Update remote URL: `git remote set-url origin https://TOKEN@github.com/USER/REPO.git`

**How to Avoid:**
- Always set token expiration to "No expiration" for active development
- Save token immediately in a password manager — GitHub shows it only ONCE
- Never share token in chat, email, or screenshots — treat like a password
- If you see `github_pat_` prefix → wrong token type created (fine-grained won't work)
- Best long-term solution: use GitHub CLI (`gh auth login`) — no token management needed

---

## 26. GitHub — Mac osxkeychain Interfering with Token

**Problem:**
- Colleague on Mac couldn't push/pull even with the correct new token
- Error: "Device not configured" or "Invalid username or token"
- Token was verified correct but Mac was using cached old credentials

**Root Cause:**
- Mac stores GitHub credentials in the system keychain (osxkeychain)
- Old expired credentials were cached in keychain
- New token in the remote URL was being ignored — keychain credentials take priority
- The `credential.helper = osxkeychain` Git config intercepts all Git operations

**Fix:**
- Clear cached credentials from Mac keychain:
  ```
  git credential-osxkeychain erase
  host=github.com
  protocol=https
  [press Enter twice]
  ```
- Change credential helper to store:
  `git config --global credential.helper store`
- Update remote URL with new token
- Better permanent solution: Use GitHub CLI:
  `gh auth login` → login via browser → credentials managed automatically

**How to Avoid:**
- Mac developers should use GitHub CLI instead of token-in-URL approach
- `gh auth login` → browser login → no token management needed ever
- Never store token directly in remote URL on Mac (keychain will override it)
- For Windows developers: token in remote URL works correctly without this issue

---

## 27. Clause Extraction — مادة (N) Prefix Appearing in Clause Content

**Problem:**
- Extracted clauses showed `مادة (1)` or `البند رقم (1)` at the start of every clause content
- The clause number was visible TWICE — once in the clause number field AND again at the start of the content
- Made clause content look messy and unprofessional in the UI

**Root Cause:**
- Claude was correctly including the article marker in its JSON response content field
- No stripping was happening before saving to the database
- The `clause_number` field already stores the number separately — repeating it in content was redundant
- Example of wrong output:
  ```
  clause_number: "1"
  content: "مادة (1) موضوع العقد: التصميم الكامل..."
  ```
- Example of correct output:
  ```
  clause_number: "1"
  content: "موضوع العقد: التصميم الكامل..."
  ```

**Fix:**
- Added `_strip_article_prefix()` static method to `ClauseExtractorAgent`
- Regex covers ALL Arabic clause marker variations:
  - `مادة (1)` / `مادة (١)` — with brackets
  - `مادة 1` / `مادة ١` — without brackets
  - `المادة (1)` — with definite article ال
  - `مادة رقم (1)` — with رقم
  - `البند رقم (1)` — Contract Agreement format
  - `البند (1)` — without رقم
  - Optional trailing `: - – —` after the marker
- Called in `_parse_json()` on EVERY clause before returning:
  ```python
  @staticmethod
  def _strip_article_prefix(content: str) -> str:
      return _ARTICLE_PREFIX_RE.sub('', content).strip()
  ```
- Applied on both return paths in `_parse_json()`:
  - Fast path (direct JSON array)
  - Prose-wrapped path (JSON inside text)

**File:** `ai-backend/app/agents/clause_extractor.py`

**How to Avoid:**
- Always strip article markers from content before saving — the number lives in `clause_number` field
- After any extraction run verify: `SELECT clause_number, LEFT(content, 50) FROM clauses WHERE source_document_id = '...' LIMIT 5`
- Content should start directly with the clause text — never with `مادة` or `البند`
- If prefix appears → check that `_strip_article_prefix()` is being called in `_parse_json()`

---

## 📝 Template for New Lessons

```
## N. Category — Short Description

**Problem:**
- What symptom did you see?
- What was the error message?

**Root Cause:**
- Why did it happen?
- What was the underlying issue?

**Fix:**
- What exact change fixed it?
- Code snippet if applicable

**File:** which file(s) were changed

**How to Avoid:**
- How to detect this early next time
- What to check first when this symptom appears
```

---

*Last updated: 2026-04-28*
*Feed this file to Claude at the start of every new session*
