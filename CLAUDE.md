# CLAUDE.md — Project Intelligence File
> Read this entire file at the start of every Claude Code session before touching any code.
> This file is the single source of truth for all architectural decisions, rules, and context.
> Last updated: 2026-05-13 (Added: Phase 3 — Input Security; sanitize-html installed, @MaxLength on 16 DTOs, @Transform on 5 XSS-risk fields, support ticket defense-in-depth)

---

## CENVOX — Parent Brand Context

### What CENVOX Is
CENVOX is the parent brand and AI intelligence platform purpose-built for the construction industry.
Tagline: "Build Smarter. Deliver Certain."
Domain: cenvox.ai
Mission: Transform how the world builds — unifying fragmented construction disciplines into one intelligent ecosystem through AI-powered platforms.
CENVOX is a House of Brands — it owns 6 products, each covering a distinct construction discipline.

### The 6 CENVOX Products

| Product | Discipline | Domain | Brand Color | Status |
|---------|-----------|--------|-------------|--------|
| **SIGN** | Contract & Legal Intelligence | sign.ai | Indigo `#4F6EF7` | 🟢 Active — Being Built Now |
| **VENDRIX** | Procurement & Vendor Management | vendrix.ai | Orange `#FF8C42` | 🔵 Coming Soon |
| **SPANTEC** | Project Scheduling & Planning | spantec.ai | Sky Blue `#38BDF8` | 🔵 Coming Soon |
| **CLAIMX** | Claims & Disputes Resolution | claimx.ai | Purple `#A855F7` | 🔵 Coming Soon |
| **GUARDIA** | Safety & Compliance | guardia.ai | Green `#22C55E` | 🔵 Coming Soon |
| **DOXEN** | Document Management | doxen.ai | Yellow `#EAB308` | 🔵 Coming Soon |

### CENVOX Brand Identity
- Primary accent: `--cx-fire: #FF4D1C` (combustion orange)
- Secondary accent: `--cx-ember: #FF7A45`
- Page background: `--cx-void: #06060A`
- Typography: Syne (headings 700/800) · Instrument Sans (body) · JetBrains Mono (labels/code)
- Logo: Abstract C+V geometric mark inside hexagonal frame, rendered in --cx-fire

### CENVOX Brand Rules — Never Violate
1. CENVOX is the parent — SIGN is a child product. Never confuse the two.
2. The SIGN app must always carry CENVOX brand attribution ("Powered by CENVOX" in footer, "← CENVOX" back-link in nav).
3. SIGN's indigo `#4F6EF7` is SIGN-specific. CENVOX `#FF4D1C` is parent-level only — never use inside SIGN app UI.
4. Do not build any other CENVOX product — VENDRIX, SPANTEC, CLAIMX, GUARDIA, DOXEN are placeholders only.
5. The CENVOX landing page (`apps/cenvox/`) is a separate app — never mix its codebase, styles, or dependencies with SIGN.
6. Every SIGN feature must align with SIGN's discipline: Contract & Legal Intelligence for the construction industry.

---

## What This Project Is
SIGN is an AI-powered contract management platform for the construction industry, built as part of the CENVOX product suite. It handles contract creation, risk analysis, claims, notices, obligations, and e-signatures for construction contracts following FIDIC, NEC, and JCT standards.

---

## Monorepo Structure
```
apps/
  sign/        → React + Vite frontend (localhost:5173)
  cenvox/      → CENVOX landing page (localhost:5174)
backend/       → NestJS API (localhost:3000)
ai-backend/    → FastAPI + Celery AI service (localhost:8000)
```

---

## Port Map
| Service | Port |
|---------|------|
| SIGN frontend | 5173 |
| CENVOX landing | 5174 |
| NestJS backend | 3000 |
| FastAPI AI | 8000 |
| PostgreSQL | 5432 |
| Redis | 6379 |

---

## Seed Users (always exist after migration:run)
| Email | Password | Role |
|-------|----------|------|
| youssef141162@gmail.com | Youssef@1997 | SYSTEM_ADMIN |
| admin@sign.com | Admin@Sign2026 | SYSTEM_ADMIN |
| mohameddaaymande@gmail.com | (set manually) | SYSTEM_ADMIN |

> All 3 users are SYSTEM_ADMIN — full platform access including /admin/* portal.
> Seed uses ON CONFLICT DO NOTHING — existing users are never overwritten.
> mohameddaaymande@gmail.com is NOT in the seed — set role manually if lost.

---

## Role Hierarchy
SYSTEM_ADMIN > OWNER_ADMIN > PROJECT_MANAGER > REVIEWER > CONTRACTOR_ADMIN > CONTRACTOR_TENDERING > CONTRACTOR_USER

---

## PORTAL ARCHITECTURE — Critical Decision (do not change without team agreement)

### The Three User Types

| Type | Who They Are | Portal They Use | Subscription |
|------|-------------|-----------------|--------------|
| Type A — Managing Party | A firm that creates projects, drafts contracts, manages contractors | Client Portal `/app/*` | Has own SIGN subscription |
| Type B — Responding Party (Guest) | An individual or firm invited to respond to a specific contract. No own subscription. | Guest Portal `/contractor/*` | No subscription — invited access only |
| Type C — Individual Practitioner | Solo professional (independent engineer, consultant, etc.) | Client Portal `/app/*` with personal workspace mode | Has own personal subscription |

### Portal Rules — Never Violate
1. The portal at `/contractor/*` is the **Guest Portal** — NOT "Contractor Portal". Rename all references in code, UI labels, and comments.
2. A contractor FIRM with its own SIGN subscription uses the **Client Portal** (`/app/*`) — they are Type A, never directed to Guest Portal.
3. The same person can be a managing party on one project AND a responding party on another. The Client Portal handles both via project-level roles — not by switching portals.
4. Type C practitioners use Client Portal (`/app/*`) in **personal workspace mode**: no team management UI, no org management UI, lighter sidebar, personal dashboard. Same codebase — UI mode flag set by subscription type.
5. Guest Portal (`/contractor/*`) is ONLY for invited parties with no subscription. Access via secure invitation link only.
6. Guest Portal is minimal: view assigned contract, respond to clauses, submit claims/notices, sign. Nothing more.
7. Never build separate UIs for managing vs responding roles inside the Client Portal — use project-level permissions instead.
8. Personal subscription plans must set a `workspace_mode: personal` flag that hides team/org features in the Client Portal.

---

## ARCHITECTURE RULES — Never Violate These

### 1. Clause-Centric Architecture
Contracts are ALWAYS `contract + array of clauses`. Never treat a contract as a single text blob. Every AI operation works at the clause level.

### 2. Async AI — No Synchronous AI Calls Ever
NEVER call the AI service (localhost:8000) synchronously from a controller.
Always: queue a Bull/Celery job → return job ID → frontend polls for result.
Violating this blocks the Node.js event loop and crashes under load.

### 3. Multi-Tenancy — org_id on Every Query
EVERY database query on org-scoped data MUST include `org_id` filter.
Use the NestJS guard that injects org from JWT. Never trust user-supplied org_id.

### 4. Status Gates
Claims, Notices, and Sub-Contracts tabs/endpoints are ONLY accessible when contract status = ACTIVE.
Return 403 from all endpoints and hide tabs in UI for any other status.

### 5. Naming Conventions
- Always: "Main Contract" — never "Parent Contract"
- Always: "Sub-Contract" — never "Subcontract"
- Always: "Sub-Contracts" tab label
- Always: "Guest Portal" — never "Contractor Portal"
- Reference formats: CLM-[ref]-[seq] / NTC-[ref]-[seq] / SUB-[ref]-[seq]

### 6. API Base URL
Backend API base: `http://localhost:3000/api/v1`
Always use VITE_API_URL env var — never hardcode localhost URLs in service files.
AI backend base: `http://localhost:8000`

### 7. Arabic Text Display — Always RTL
Any UI element that may display Arabic text MUST have `dir="auto"` attribute.
Also add `style={{ unicodeBidi: 'plaintext' }}` for clause titles and content.
Never assume all text is LTR — SIGN handles both Arabic and English contracts.
Test every clause display feature with actual Arabic content after any UI change.

### 8. Document Priority System — Never Reverse
Priority 1 = HIGHEST importance. Lower number = more authoritative document.
The priority system is used for conflict detection between contract documents.
- Priority 1 document = GOVERNING (its clauses win in conflicts)
- Priority 2+ document = OVERRIDDEN (its conflicting clauses are subordinate)
- User CAN manually override conflict resolution per clause
- Never reverse this logic — Priority 1 must always be the most authoritative

---

## Contract Status Machine
Valid transitions only — never add ad-hoc status changes:
```
DRAFT → UNDER_REVIEW → PENDING_APPROVAL → ACTIVE → PENDING_TENDERING → SENT_TO_CONTRACTOR → EXECUTED / TERMINATED
```

---

## AI Pipeline Architecture
```
Frontend → NestJS controller → Bull queue job → Celery task (FastAPI) → result stored in DB → frontend polls GET endpoint
```
Never shortcut this flow. The AI backend has 9 Celery tasks and 11 FastAPI routes.

---

## Arabic Document Processing Architecture

### Supported File Types
- Word documents (.docx) — primary format for Arabic construction contracts
- PDF (digital/searchable) — text extracted directly
- PDF (scanned) — OCR pipeline: Tesseract (ara+eng), DPI=300, pdf2image conversion

### Text Extraction Rules — All 3 Sources Required
When extracting text from Word files, ALWAYS extract from ALL THREE sources:
1. `doc.paragraphs` — main body text
2. `doc.tables` — ALL cells in ALL tables (payment schedules, liability clauses often live here)
3. `doc.sections` (headers) — section headers

Extracting only paragraphs will SILENTLY miss contract terms in table cells.
File: `ai-backend/app/services/text_extractor.py`

### Cover Page Trimming Rules
Different document types use different start markers:
- **Agreement documents** (اتفاقية, agreement): look for `تم الاتفاق` or `إنه في يوم`
- **Conditions documents** (شروط, particular, general, spec, مواصفات): look for FIRST `مادة` marker using regex `/مادة\s*[\(\s]?[١-٩\d]/`

⚠️ NEVER use `تم الاتفاق` as the start marker for conditions documents — this phrase appears inside article bodies and will cut off Articles 1-8.
File: `backend/src/modules/document-processing/document-processing.service.ts`

### Arabic Clause Markers — Per Document Type
Construction contracts use different clause markers depending on document type.
Always check the actual extracted text before assuming the marker format.

**Contract Agreement (اتفاقية العقد):**
- `البند رقم (1)` / `البند رقم (١)` — Egyptian government / NTA format (most common)
- `البند (1)` — without رقم
- `البند الأول` / `البند الثاني` — ordinal Arabic forms
- `البند 1` — numeral directly after البند

**Particular Conditions (الشروط الخاصة):**
- `مادة (1)` / `مادة (١)` — most common format
- `مادة رقم (1)` / `مادة رقم (١)` — with رقم
- `مادة 1` / `مادة ١` — no brackets
- `المادة (1)` / `المادة 1` — with definite article ال

**General Conditions (الشروط العامة):**
- `مادة (1) : تعريفات وتفسيرات :` — with colons (colons are OPTIONAL not required)
- `مادة (1) تعريفات وتفسيرات` — without colons
- Same مادة variations as Particular Conditions apply

**All document types support:**
- Western numerals: 1, 2, 3
- Arabic-Indic numerals: ١, ٢, ٣
- Both with and without brackets ()

### Sub-Article Rules — Never Violate
Sub-articles are sections INSIDE a parent مادة/بند. They are NOT separate clauses.
- Dash format: `2-1`, `9-3`, `12-5` means sub-article 1 of Article 2, etc.
- Slash format: `4/1`, `4/2`, `4/3` means sub-section 1 of Article 4
- Everything from `مادة (N)` up to (but NOT including) `مادة (N+1)` = ONE single clause
- `clause_number` must always be the PARENT number (4), never the sub-article (4/1)
- Never create separate clause objects for sub-articles

### Definitions Clause Formatting
The first clause (مادة 1) in General/Particular Conditions is usually a definitions article.
It contains many terms with explanations. Always format as bullet points:
```
- الهيئة أو العميل: يقصد بها الهيئة القومية للأنفاق
- ممثل الهيئة: يقصد به الإستشارى العام للمشروع
```
Each definition on ONE line: `- term: explanation`
In UI: render as RTL `<ul>` with `dir="rtl"` so bullets appear on RIGHT side.
File: `ai-backend/app/agents/clause_extractor.py` (Guideline 12)
File: `apps/sign/src/components/review/ClauseReviewCard.tsx` (ClauseContentDisplay component)

---

## Clause Extraction Architecture Rules — Never Violate

### Chunking Rule — Mandatory for Large Documents
- Documents **≤ 30,000 chars** → use `_extract_single()` (one API call)
- Documents **> 30,000 chars** → MUST use `_extract_chunked()` (multiple API calls)
- Chunk size: `_CHUNK_SIZE = 15,000` chars maximum per chunk
- Never send a full large Arabic document in one Claude API call — it will timeout

### Chunking Method Hierarchy
When splitting large documents into chunks:
1. Split at `مادة` article boundaries first (`_split_on_article_boundaries()`)
2. If any single article > 15,000 chars → break it further (`_break_oversized_chunk()`):
   - Level 1: split at sub-article boundaries (N-M or N/M patterns)
   - Level 2: split at paragraph boundaries (`\n\n`)
   - Level 3: hard cut every 15,000 chars with 200-char overlap (last resort)
3. Merge any chunk < 500 chars into previous chunk (`_merge_small_chunks()`)
4. If chunk doesn't start with مادة marker → prepend last مادة heading from previous chunk (`_add_article_context()`)

### Chunk Instruction Rule
Every chunk sent to Claude MUST include this instruction:
```
"CHUNK {N} OF {TOTAL}:
Only extract clauses that START in this chunk.
A clause STARTS when you see a مادة marker at the beginning of a line.
Do NOT extract content that is a continuation of a clause from a previous chunk."
```

### مادة Prefix Stripping Rule
ALWAYS strip `مادة (N)` / `البند رقم (N)` prefix from clause CONTENT before saving.
The clause number is stored separately in `clause_number` field — it should NOT repeat in the content.
Method: `_strip_article_prefix()` called in `_parse_json()` on every clause.

### TOC Skipping Rule
Arabic contracts have a Table of Contents (sometimes appended at END of extracted text).
TOC entries look identical to real article headings — Claude must skip them.
TOC identified by: مادة (N) entries followed by dotted lines (`......`) and standalone page numbers.
See Guideline 7 in SYSTEM_PROMPT.

### Cross-Reference Rule
`مادة (N)` appears both as real headings AND as inline cross-references in body text.
- Real heading: `مادة (N)` at START of line + colon + title
- Cross-reference: `مادة (N)` mid-sentence after من / طبقا للمادة / بموجب مادة
Cross-references are NEVER clause boundaries. See Guideline 11 in SYSTEM_PROMPT.

### max_tokens Tiers — Use These Values
| Chunk Size | max_tokens | Savings vs 64k |
|-----------|-----------|----------------|
| < 10,000 chars | 16,000 | 75% |
| < 20,000 chars | 24,000 | 62% |
| ≥ 20,000 chars | 32,000 | 50% |

⚠️ Do NOT use dynamic formula (chars/4 * 1.5) — underestimates Arabic output density and causes truncation.
⚠️ Do NOT hardcode 64,000 — 6x more expensive than needed.

---

## Document Priority System Architecture

### How Priority Works
When multiple documents are uploaded to one contract, each gets a priority number.
- Priority 1 = HIGHEST importance (most authoritative document)
- Priority 2 = second most important
- Priority 3 = least important (of the three)
- Lower number = more authoritative

### Typical Priority Assignment
Users set priority during document upload. Common pattern for construction contracts:
- Contract Agreement → Priority 1 (governs all)
- Particular Conditions → Priority 2 (modifies General)
- General Conditions → Priority 3 (base standard)

⚠️ Documents don't always come in sets of 3. Valid combinations:
- Contract Agreement alone
- Contract Agreement + Particular Conditions only
- Contract Agreement + General Conditions only
- All 3 together
- Particular Conditions alone
- General Conditions alone
Always handle any combination — never assume all 3 are present.

### Conflict Detection
The AI conflict detector (`run_detect_conflicts` Celery task) compares clauses across documents.
When two clauses from different documents address the same topic:
- Higher priority document (lower number) = **GOVERNING** badge
- Lower priority document (higher number) = **OVERRIDDEN** badge
- Conflicts saved as `DOCUMENT_CONFLICT` risks in `risk_analyses` table
- User can Accept (keep auto-resolution) or Override (manually choose which governs)

### Priority Rules — Never Violate
1. Priority 1 always wins in automatic conflict resolution
2. User CAN manually override per clause — this is by design
3. Never reverse the priority logic (higher number ≠ more important)
4. Priority metadata must be passed to AI analysis with document label and ID

---

## Celery Worker Critical Configuration

These settings in `docker-compose.yml` are the result of production-level debugging. Do not change without understanding the impact.

```yaml
command: celery -A app.tasks worker 
  --loglevel=info 
  --concurrency=3          # NEVER set back to 1 — docs process in parallel
  --time-limit=2400        # 40 min hard kill — needed for large Arabic docs
  --soft-time-limit=1800   # 30 min graceful warning
```

### Why These Values
- `--concurrency=3`: 3 documents can extract clauses simultaneously. Setting to 1 makes all docs sequential (20+ min total instead of ~5 min)
- `--time-limit=2400`: General Conditions (81k chars, 9 chunks) needs ~20 min. Old 600s limit killed it every time
- `--soft-time-limit=1800`: Gives task 30 min before graceful shutdown signal

### Source Code Volume Mount — Required
```yaml
volumes:
  - ./ai-backend:/app          # ← REQUIRED — live code changes
  - uploads_data:/app/uploads  # ← keep this too
```
Without `./ai-backend:/app` mount → code changes to `clause_extractor.py`, `tasks.py`, `text_extractor.py` are INVISIBLE to the running worker. Must do full `docker-compose up --build` for every change. With the mount → just `docker restart sign-celery-worker`.

### Memory
Minimum 3G for celery-worker container. Formula: concurrency × 512MB + 512MB overhead = 2G minimum. Set to 3G for safety buffer.

---

## WebSocket
One gateway: `/collaboration` namespace. Used for real-time contract collaboration.
Do not add new namespaces without a planning session.

---

## Docker Recovery Commands
```bash
# Stale node_modules after pull
docker-compose up --force-recreate --renew-anon-volumes -d backend

# Login broken after restart
docker-compose exec backend npm run migration:run

# Port 3000 conflict — run only frontends
docker-compose up --build sign cenvox

# Full clean restart
docker-compose down && docker-compose up --build

# Celery worker code change (with source mount)
docker restart sign-celery-worker

# Celery worker code change (without source mount — full rebuild needed)
docker-compose up --build -d celery-worker

# Check celery worker settings (concurrency, time limits)
docker exec sign-celery-worker celery inspect stats 2>/dev/null

# Check document processing status
docker exec sign-postgres psql -U sign_user -d sign_db -c \
  "SELECT file_name, processing_status, processing_stage FROM document_uploads ORDER BY created_at DESC LIMIT 5;"

# Clean orphaned clauses after failed extraction
docker exec sign-postgres psql -U sign_user -d sign_db -c \
  "DELETE FROM clauses WHERE id NOT IN (SELECT DISTINCT clause_id FROM contract_clauses);"
```

---

## Session Layer Boundaries (One Session Per Layer — Rule 3)

| Layer | Scope | Never Mix With |
|-------|-------|----------------|
| 1 — Auth & Users | Login, MFA, invitations, roles | Other layers |
| 2 — Org & Projects | Org profile, projects, team, contractors | Other layers |
| 3 — Contract Core | Contract CRUD, clauses, versions, approvals, comments | AI layer |
| 4 — AI Pipeline | Risk, summarize, compliance, chat, obligations, diff | Contract layer |
| 5 — Claims / Notices / Sub-Contracts | Post-contract modules | Contract core layer |
| 6 — Admin Portal | All /admin/* pages and admin API | User-facing layers |
| 7 — CENVOX | Landing page only | SIGN layers |
| 8 — Store & Payments | Paymob, templates, licensing | Auth layer |
| 9 — Guest Portal | /contractor/* invited-party access only | Client portal layer |

---

## Features That MUST Use Plan Mode Before Coding (Rule 6)

| Feature | Why Planning Is Critical |
|---------|-------------------------|
| DocuSign webhook completion | Webhook → contract state → notification — complex failure handling |
| Real-time live chat | WebSocket architecture, scaling, ops dashboard design |
| AI Research Agent | Crawl → embed → approve pipeline architecture |
| Paymob webhook | Payment state machine, idempotency, failure recovery |
| Microsoft Word Add-in | Separate deployment, auth bridge, API surface |
| Guest Portal (full build) | Entire persona needs architectural plan before any code |
| Personal workspace mode | UI mode flag system needs planning across all components |

---

## Integration & Deployment Rules

### We Are NOT in the Deployment Phase Yet
Do not configure production API keys or deploy to any server.
All work is local development only.

### Features That Need Real API Keys to Work

| Feature Area | Integration | Env Vars Required |
|-------------|-------------|-------------------|
| ALL AI features | Anthropic API | `ANTHROPIC_API_KEY` |
| E-signature | DocuSign | `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_SECRET_KEY`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_WEBHOOK_HMAC_SECRET` |
| Payments | Paymob | `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID`, `PAYMOB_IFRAME_ID`, `PAYMOB_HMAC_SECRET` |
| File uploads | AWS S3 | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` |
| Email sending | SendGrid/SMTP | `SENDGRID_API_KEY` or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |
| Async AI jobs | Redis | `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT` |

### Features That Work Right Now Without External APIs
- Full authentication (register, login, MFA, invitations, password reset)
- Organization and team management
- Project and contractor management
- Contract creation and clause editing
- Version history and approval workflow
- Claims, Notices, Sub-contract submission and tracking
- Obligations dashboard (manual entry)
- Admin portal (user management, plan CRUD)
- Audit trail
- CENVOX landing page

### Critical Known Bugs — Do Not Build On Top Of These
1. **DocuSign webhook is a no-op** — returns 200 but never updates contract state. Do not build features depending on EXECUTED status until fixed.
2. **axios.ts default URL is wrong** — points to port 3001 instead of 3000. Always use `VITE_API_URL`.
3. **Guest Portal is a stub** — treat `/contractor/*` as not built. Needs full planning session before building.
4. **~~No automated tests~~** — resolved in Phase 2: 32 tests across all 3 services (16 backend, 8 frontend, 8 AI pipeline).
5. **~~No CI pipeline~~** — resolved in Phase 2: GitHub Actions CI runs on every push and PR to main (3 parallel jobs).

### Local Development Workarounds (before deployment)
| Integration | Free Local Workaround |
|-------------|----------------------|
| DocuSign | Free sandbox at developers.docusign.com |
| Paymob | Test mode API keys from Paymob dashboard |
| AWS S3 | MinIO via Docker (local S3 emulator) |
| Email | Mailtrap.io (free — catches all emails locally) |
| Anthropic | Real API key required — no free alternative |

---

## Known Issues Log (do not re-introduce these)

| # | Issue | Fix | Prevention |
|---|-------|-----|------------|
| 1 | axios.ts default URL points to port 3001 | Use `VITE_API_URL` env var always | Never hardcode localhost URLs |
| 2 | DocuSign webhook is a no-op | Fix webhook handler before deployment | Do not build on EXECUTED status |
| 3 | Guest Portal is a stub | Plan full build before starting | Use Plan Mode for this layer |
| 4 | Login breaks after laptop restart | Seed chained to migration:run in docker entrypoint | `command: sh -c "npm run migration:run && npm start"` |
| 5 | Stale node_modules after git pull | `docker-compose up --force-recreate --renew-anon-volumes -d backend` | Use named volumes |
| 6 | Admin portal inaccessible after restart | SYSTEM_ADMIN seed user missing | Seed is idempotent — runs on every startup |
| 7 | Port 3000 conflict | Stop local backend before docker-compose up | Use `docker-compose up frontend cenvox` to skip backend |
| 8 | CENVOX not accessible | Frontend not started | Run `npm run dev` inside `apps/cenvox` |
| 9 | Orphaned clauses inflate dashboard count | `DELETE FROM clauses WHERE id NOT IN (SELECT DISTINCT clause_id FROM contract_clauses)` | Check for orphans after any killed extraction task |
| 10 | currentUser always null after page refresh | Add `refreshUserProfile()` in `useEffect` on mount in AppLayout and AdminLayout | Always test permission features after page refresh not just fresh login |
| 11 | Portal chooser bypassed for existing sessions | Use `sessionStorage` flag `portal-chosen` in AdminLayout redirect check | Never put role-based redirect logic only in LoginPage |
| 12 | مادة (N) prefix appearing in extracted clause content | `_strip_article_prefix()` called in `_parse_json()` on every clause | clause_number field stores the number — never repeat it in content |

---

## Security
- .env.staging and .env.production are gitignored
- Per-service .gitignore files exist in all 4 service folders
- Seed passwords read from SEED_ADMIN_PASSWORD_1/2/3 env vars
- DB fallback credentials in data-source.ts and settings.py → cleanup before AWS deployment
- docker-compose.prod.yml needed before AWS deployment → reads DB password from env vars

---

## Phase 1 — Critical Bug Fixes (In Progress)

### Phase 1.1 — Fix Wrong API URL (shipped)
- Fixed socketService.ts: was connecting to localhost:3001 (wrong port). Now uses `VITE_SOCKET_URL || localhost:3000`
- Fixed supportSocketService.ts: had fragile double `.replace()` chain. Now uses `VITE_SOCKET_URL || localhost:3000`
- Fixed apps/cenvox/src/App.tsx: SIGN_URL was a bare hardcoded string. Now uses `VITE_SIGN_APP_URL` env var with fallback
- Created apps/cenvox/.env.example with VITE_SIGN_APP_URL documented
- Fixed orphaned clauses bug in document-processing `reprocess()` — now cleans up old clauses before reprocessing a document
- Flagged: 4 localhost:5174 CENVOX backlinks remain in SIGN layouts (AuthLayout.tsx ×2, AdminLayout.tsx, TopBar.tsx) — scheduled for Phase 1.2 fix
- Lesson #30 added to lessons.md

### Phase 1.2 — Fix Seed Role Mismatch (shipped)
- Root cause was wrong documentation, not wrong code
- Seed script was already correct: youssef seeded as SYSTEM_ADMIN
- CLAUDE.md seed table was wrong: showed OWNER_ADMIN
- Fixed: updated CLAUDE.md seed table to show correct SYSTEM_ADMIN role
- Updated seed note to document ON CONFLICT DO NOTHING idempotency behavior
- No seed script changes, no database changes

### Phase 1.3 — Complete DocuSign Flow (skipped)
- Owner: Youssef
- Blocked: requires DocuSign sandbox credentials
- Status: postponed until Youssef sets up DocuSign sandbox

### Phase 1.4 — Fix Silent try/catch Blocks (shipped)
- Full audit of all 62 catch blocks across 32 files in 20 modules
- 9 blocks were already correctly implemented — left untouched
- 12 blocks fixed across 9 files in 6 commits
- 41 blocks are intentional design (health checks, best-effort audit, WebSocket auth, version snapshots, email fallbacks) — left untouched
- Zero cron jobs found in the entire backend
- Key fixes: auth login security events, Paymob webhook parser, document extraction failures, DocuSign getSigningUrl, AI chat fallback, project findOne silent retry
- CRITICAL: #59 subscriptions activateSubscription — added detailed TODO(1.6) comment. User can pay and never get access. Needs idempotency fix before proper error handling. Blocked on Paymob test keys.
- Backend rebuilt with zero TypeScript errors after all fixes
- One smart deviation: `doc.id` used instead of `docId` in extraction methods (doc: DocumentUpload parameter, not a string id)

**Hard rules added from Phase 1.4 audit — never violate:**
- `audit-log.interceptor.ts` catch block is INTENTIONALLY silent — if rethrown it breaks every request in the system. Never add rethrow here.
- `admin-health` service catch blocks must return `{status:'down'}`, never throw
- `contracts` version snapshot catch blocks are best-effort — rethrowing would break contract mutations for a non-critical side effect
- Bull queue processor catch blocks: log only, no rethrow — Bull handles its own retries

### Phase 1.5 — Joi Startup Env Var Validation (shipped)
- Installed `joi@^18.2.1` in backend
- Added `import * as Joi from 'joi'` and `validationSchema` to `ConfigModule.forRoot()` in `app.module.ts`
- Added startup Logger in `main.ts` — logs Environment, Port, and "✅ All environment variables validated successfully" before `app.listen()`
- `abortEarly: false` — all missing vars reported at once on startup, never one-by-one
- `allowUnknown: true` — extra vars in `.env` never break startup
- Rewrote `backend/.env.example` with clean section grouping matching the schema
- Migrated `FRONTEND_URL` from `process.env` to `ConfigService` in 3 files: `mfa-admin.service.ts`, `public-obligation.controller.ts`, `docusign.controller.ts`
- Added `NESTJS_INTERNAL_TOKEN` to `.env.example` (was in `.env` but undocumented)
- Added `BASE_URL` to Joi schema as `.required()` and to `.env` + `.env.example` (was used in 3 files but not validated)
- Fixed `ai.service.ts` fallback default: `http://localhost:8000` → `http://ai-backend:8000` to match Joi schema default
- Fail-fast verified: missing required var → hard crash with `Config validation error: "VAR_NAME" is required` — app never silently starts with broken config

**Required vars (crash on missing):** `DATABASE_URL`, `JWT_SECRET` (min 16 chars), `NESTJS_INTERNAL_TOKEN`, `REDIS_URL`, `FRONTEND_URL` (URI), `BASE_URL` (URI)

**Defaulted vars (safe fallback):** `NODE_ENV=development`, `PORT=3000`, `JWT_EXPIRES_IN=7d`, `AI_BACKEND_URL=http://ai-backend:8000`, `AWS_REGION=us-east-1`

**Optional vars (allow empty string):** All DocuSign, Paymob, AWS credentials, SMTP, Anthropic, S3 — none are required for local dev

**Hard rules added from Phase 1.5 — never violate:**
- Any new `.required()` Joi var is a **breaking change** for every teammate — notify team BEFORE pushing
- Always add the new var to `.env.example` with a description in the same commit that adds it to the schema
- Default to `.optional().default(...)` when possible — only use `.required()` when there is truly no safe default
- When adding new npm packages to backend: run `docker-compose up --build --force-recreate --renew-anon-volumes -d backend` — a plain `--build` is NOT enough if the anonymous node_modules volume exists from a previous run

### Phase 1.7 — Auth _finalizeLogin Silent Device Tracking Failure (deferred)
- Phase 1.4 already added logger.error with full context inside the outer catch
- Full monitoring/alerting (dead letter table + admin dashboard) requires Sentry or CloudWatch
- Deferred to Phase 9 (Deployment Prep) where monitoring infrastructure will be wired up
- File: `backend/src/modules/auth/auth.service.ts` line ~184
- When Phase 9 starts, also revisit Phase 1.6 and the dead letter pattern can be built once and reused for both

---

## Phase 2 — Recently Shipped

### Phase 2.1 — Backend Tests (shipped — 2026-05-10)

First-ever tests for the NestJS backend. Established baseline test infrastructure.

**What was added:**
- 3 spec files, 16 tests, all passing
- `backend/src/health/health.controller.spec.ts` — 3 tests, 100% coverage on health controller
- `backend/src/modules/contracts/contracts.service.spec.ts` — 6 tests covering create() and findAll()
- `backend/src/modules/auth/auth.service.spec.ts` — 7 tests covering login success, wrong password, locked account, deactivated account, non-existent user, MFA flag

**Confirmed before starting:**
- All Jest packages already in devDependencies (jest, @nestjs/testing, ts-jest, supertest)
- "test": "jest" script already existed
- Jest config already in package.json with @/ alias mapped
- Zero packages installed, zero Docker rebuilds, zero colleague impact

**Hard rules — never violate:**
- AuthService has 14 constructor dependencies — every single one must be mocked or TestingModule throws missing-provider errors
- _finalizeLogin() is private — test indirectly via login() and assert on mock call counts
- ContractsService.createVersionSnapshot() makes 3 extra repository calls after main save — all 3 mocks must return sensible values or create() throws TypeError on undefined
- CollaborationGateway is a WebSocket gateway — must mock every emit* method used or "not a function" errors fire at runtime
- Coverage baseline: 18.47% overall, 100% on health.controller.ts — correct starting point for a codebase this size

### Phase 2.2 — Frontend Tests (shipped — 2026-05-10)

First-ever tests for the SIGN React frontend. Vitest + React Testing Library.

**What was added:**
- 6 packages installed as devDependencies: vitest, @vitest/coverage-v8, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, jsdom
- New file: `apps/sign/vitest.config.ts` — separate config from vite.config.ts (zero build impact)
- New file: `apps/sign/src/test/setup.ts` — jest-dom matchers
- New file: `apps/sign/src/pages/auth/LoginPage.test.tsx` — 5 tests
- New file: `apps/sign/src/pages/app/DashboardPage.test.tsx` — 3 tests
- 3 new scripts in apps/sign/package.json: test, test:watch, test:cov

**Confirmed before starting:**
- Zero test infrastructure existed in apps/sign — complete greenfield
- Provider order in main.tsx: Provider → QueryClientProvider → BrowserRouter
- LoginPage uses pure React useState (no react-hook-form)
- DashboardPage has zero Redux dependency

**Hard rules — never violate:**
- vite.config.ts is NEVER touched — vitest config lives in a separate vitest.config.ts file. Mixing them risks affecting the dev server and build output.
- Mock at the SERVICE level, never at the axios level — axios.ts imports the Redux store as a side effect, which would pull store initialization into every test
- authSlice.initialState reads localStorage at module load — call localStorage.clear() in beforeEach for any test touching auth state
- FormInput renders a `*` span inside the label, making accessible text "auth.email *" — use regex matchers (e.g. /auth\.email/i), never exact strings
- i18n t() returns the key as fallback in tests — use literal keys like "auth.email" as selectors (no i18n initialization needed in test setup)
- DashboardPage accesses deeply nested analytics properties — every field accessed must exist in the test fixture or component crashes with "Cannot read properties of undefined"
- Frontend has 2 anonymous Docker volumes (/app/node_modules + /app/apps/sign/node_modules) — colleagues must run docker-compose up --build --force-recreate --renew-anon-volumes -d frontend after pulling

### Phase 2.3 — AI Pipeline Tests (shipped — 2026-05-10)

First-ever tests for the FastAPI + Celery AI backend. pytest + pytest-mock.

**What was added:**
- 2 packages added to ai-backend/requirements.txt: pytest>=8.0, pytest-mock>=3.12
- New file: `ai-backend/pytest.ini` — `pythonpath = .` (mandatory for imports)
- New file: `ai-backend/tests/__init__.py` — empty, marks tests/ as a package
- New file: `ai-backend/tests/conftest.py` — autouse fixture clears get_settings.lru_cache between tests
- New file: `ai-backend/tests/test_health.py` — 1 test (FastAPI /health smoke test)
- New file: `ai-backend/tests/test_clause_extractor.py` — 4 tests (short doc, Arabic text, chunking path, invalid JSON graceful handling)
- New file: `ai-backend/tests/test_tasks.py` — 3 tests (success, exception handling, missing key)
- 8 tests passing, 44% coverage overall, 71% on clause_extractor.py

**Confirmed before starting:**
- Zero test infrastructure existed in ai-backend — complete greenfield
- Architecture is poll-based — NO callback to NestJS, NESTJS_INTERNAL_TOKEN unused
- ai-backend uses bind mounts (NOT anonymous volumes) — colleagues just need docker-compose up --build (no --renew-anon-volumes)

**Hard rules — never violate:**
- pytest.ini MUST have `pythonpath = .` — without it every "from app.agents..." import fails with ModuleNotFoundError
- Anthropic client is created in ClauseExtractorAgent.__init__ — mock target is "app.agents.clause_extractor.Anthropic" and the patch must be in place BEFORE agent = ClauseExtractorAgent() is called
- run_extract_clauses imports ClauseExtractorAgent lazily inside the function body — mock target is "app.agents.clause_extractor.ClauseExtractorAgent", NOT "app.tasks.ClauseExtractorAgent"
- get_settings() uses @lru_cache — must clear in conftest.py autouse fixture or settings leak between tests
- FastAPI TestClient must NOT be used as context manager — `with TestClient(app) as client:` triggers lifespan which calls Base.metadata.create_all(bind=engine) and tries to hit PostgreSQL. Use `client = TestClient(app)` directly.
- Celery bind=True tasks: calling task(None, payload) injects an extra self causing TypeError. Correct pattern is task.run(payload) — self is already bound.
- _parse_json() returns [] on any JSON parse failure — never raises. Test mocks must return valid JSON strings (not dicts) for meaningful assertions.

### Phase 2.4 — CI Pipeline (shipped — 2026-05-10)

First GitHub Actions workflow. CI ONLY — no CD until Phase 9 (Deployment Prep).

**What was added:**
- New file: `.github/workflows/ci.yml` — 3 parallel jobs (backend-tests, frontend-tests, ai-backend-tests)
- New file: `README.md` at repo root with CI badge
- Triggers: every push to main + every pull_request targeting main
- Zero env vars, zero secrets, no Docker, no deployment

**Confirmed before starting:**
- GitHub repo: mohamed2ayman/signn
- Root package.json IS an npm workspace (apps/* + packages/*) — frontend CI must run npm ci at REPO ROOT, not in apps/sign/
- backend/ is independent (own lockfile, NOT in workspace)
- Node 20, Python 3.11
- ai-backend needs apt-get install tesseract-ocr tesseract-ocr-ara poppler-utils libpq-dev BEFORE pip install (for pytesseract and pdf2image)
- apps/cenvox has no tests — skipped entirely

**Hard rules — never violate:**
- CI is unit-test ONLY — never start Docker containers, never use real database, never use real Redis, never use real Anthropic API
- Frontend CI runs from repo root because @cenvox/tokens is a workspace dependency — running `cd apps/sign && npm ci` would fail to resolve it
- Backend lint script has --fix which auto-fixes silently in CI — DO NOT add lint job until script is fixed (use eslint without --fix or skip entirely)
- Frontend lint has --max-warnings 0 — DO NOT add lint job until codebase is verified clean of warnings
- No CD/deployment in this phase — that comes in Phase 9 with staging environment, manual approval gates, blue-green deploy, and rollback strategy
- AI backend CI MUST install system packages (tesseract-ocr, poppler-utils, libpq-dev) before pip install or installation fails

---

## Phase 3 — Input Security (in progress)

### Phase 3.2 — Input Sanitization (shipped — 2026-05-13)

**Scope:** NestJS backend — all user-supplied string inputs hardened against oversized payloads and stored-XSS injection.

**What was built:**

1. **`@MaxLength` on 16 DTOs** (12 create + 4 standalone update) across 11 modules:
   - Tiers: 500 (identifiers), 10,000 (comments/chat/objectives), 20,000 (descriptions/ticket bodies), 500,000 (clause content/negotiation text)
   - Applies to both create and update DTOs — never protect only the create path

2. **`sanitize-html` installed** (`backend/package.json` deps + `@types/sanitize-html` devDeps)
   - `backend/src/common/utils/sanitize.ts` — central `stripHtml()` helper (null-safe, strips all tags/attributes)
   - Import pattern: `import * as sanitizeHtml` — required because tsconfig has no `esModuleInterop` and `@types/sanitize-html` uses `export =`

3. **`@Transform` on 5 high-XSS-risk fields** across 4 DTOs:
   - `CreateClauseDto.content` + `UpdateClauseDto.content` (clause bodies)
   - `AddCommentDto.content` (contract inline comments)
   - `CreateNegotiationEventDto.original_text` + `new_text` (redline negotiation text)

4. **Support ticket defense-in-depth** (2 fixes):
   - `AddReplyDto.is_internal_note` was silently stripped by ValidationPipe (no class-validator decorator) — fixed with `@IsBoolean()`
   - `SupportService.getTicketById` now filters `is_internal_note = false` at DB level for non-staff users (was frontend-only filter before)

**Files changed:**
- `backend/src/common/utils/sanitize.ts` (new)
- `backend/src/modules/clauses/dto/create-clause.dto.ts`
- `backend/src/modules/clauses/dto/update-clause.dto.ts`
- `backend/src/modules/contracts/dto/add-comment.dto.ts`
- `backend/src/modules/negotiation/dto/create-negotiation-event.dto.ts`
- `backend/src/modules/support/dto/create-ticket.dto.ts`
- `backend/src/modules/support/support.service.ts`
- `backend/src/modules/support/support.controller.ts`
- `backend/src/modules/contracts/dto/add-clause.dto.ts`
- `backend/src/modules/contracts/dto/update-clause-order.dto.ts`
- `backend/src/modules/chat/dto/send-message.dto.ts`
- `backend/src/modules/contracts/dto/review-approval.dto.ts`
- `backend/src/modules/knowledge-assets/dto/create-knowledge-asset.dto.ts`
- `backend/src/modules/knowledge-assets/dto/update-knowledge-asset.dto.ts`
- `backend/src/modules/obligations/dto/create-obligation.dto.ts`
- `backend/src/modules/obligations/dto/update-obligation.dto.ts`
- `backend/src/modules/organizations/dto/update-organization.dto.ts`
- `backend/src/modules/projects/dto/create-project.dto.ts`
- `backend/src/modules/projects/dto/update-project.dto.ts`
- `backend/src/modules/subscriptions/dto/create-plan.dto.ts`
- `backend/src/modules/subscriptions/dto/update-plan.dto.ts`

**Hard rules — never violate:**
- Every free-text `@IsString()` field MUST have `@MaxLength()` — no unbounded strings in DTOs
- Apply `@MaxLength` to BOTH create AND update DTOs — standalone update DTOs inherit nothing from create
- Use `import * as sanitizeHtml` (never default import) when `esModuleInterop` is absent
- `@Transform` fires on `undefined` for optional fields — always null-guard in the transformer function
- `is_internal_note` visibility must be enforced at DB level (service query), never only in frontend

---

## Phase 3 — Recently Shipped

### Phase 3.1 — Microsoft Word Add-in (shipped)
Office.js add-in shell with package versions pinned, SIGN logo icons generated, dependencies installed. Live integration with the contracts API still requires the auth bridge described in the integration rules above.

### Phase 3.2 — Live Chat Support (shipped)
Real-time human support channel sitting beside the AI ChatPanel:
- Floating bottom-right widget on every `/app/*` page (hidden for SYSTEM_ADMIN/OPERATIONS roles)
- `/admin/operations` ops dashboard with Chat Queue, Active Chats, CSAT Analytics tabs
- Socket.io `/support` namespace (separate from `/collaboration`)
- Lifecycle: WAITING → ACTIVE → CLOSED, with TRANSFERRED side-state
- Internal notes (ops-only), canned responses with `/` autocomplete, file attachments, CSAT, Convert-to-Ticket
- Audit-logged via `support_chat.*` action prefix

### Phase 3.3 — Admin Security Management (shipped)
Platform-wide security posture management. **All endpoints SYSTEM_ADMIN-only via `JwtAuthGuard + RolesGuard + @Roles(SYSTEM_ADMIN)`** unless prefixed with `/me`.

**Database (5 new tables)**: `security_policies` (singleton, id=`global`), `user_sessions` (replaces single `users.refresh_token_hash` model), `known_devices`, `password_history`, `blocked_ip_attempts`. Plus `users.password_changed_at`. Migration is idempotent (`CREATE TABLE IF NOT EXISTS` + `ON CONFLICT DO NOTHING` for the seed row).

**Module**: `backend/src/modules/admin-security/`
- 13 services: `SecurityPolicyService` (60s in-memory cache), `SessionService` (SHA-256 hex tokens), `KnownDeviceService` (coarse `browser|os|country|/24` fingerprint), `PasswordPolicyService`, `IpFilterService`, `SuspiciousLoginService` (BRUTE_FORCE / NEW_COUNTRY / IMPOSSIBLE_TRAVEL), `GeoLookupService` (geoip-lite), `UserAgentService` (ua-parser-js), `MfaAdminService` (admin reset + remind), `SecurityScoreService` (0-100 with 6 weighted components), `GdprExportService` (archiver-built ZIP, anonymize-delete with FK preservation), `SecurityEventService` (`record()` + `recordAtomic()` flavors), `SecurityAuditLogService` + `AdminActivityLogService`.
- 3 controllers: `ProfileController` (`/me/*`), `AdminSecurityController` (`/admin/security/*`), `AdminUserSecurityController` (`/admin/users/:id/*`).
- 2 middleware: `IpFilterMiddleware` (mounted globally, skips `/health`), `SessionTrackingMiddleware`.

**Auth integration**: `auth.service.ts` calls a shared `_finalizeLogin(user, refreshToken, ip, ua)` after every successful login path (register, login, verifyMfa, verifyRecoveryCode, refreshToken). It creates a UserSession row, evaluates suspicious signals, upserts the known-device record, and emails the user when a brand-new device combination signs in. `refreshToken` revokes the old session by hash before creating a new one. `logout` revokes the session by token (or all-for-user fallback) and emits `security.logout`.

**Security event types**: 18 event strings under the `security.*` prefix in `backend/src/common/enums/security-event-types.ts` (LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, MFA_ENABLED/DISABLED/RESET, PASSWORD_CHANGED/RESET, SESSION_REVOKED/EXPIRED, ACCOUNT_LOCKED/UNLOCKED, IP_BLOCKED, SETTINGS_CHANGED, ADMIN_ACTION, SUSPICIOUS_LOGIN, GDPR_EXPORT/DELETE).

**Frontend**: 4 new pages
- `/admin/security` — Security Dashboard (score widget, suspicious banner, blocked-IP feed)
- `/admin/security/settings` — Security Settings editor
- `/admin/security/audit` — security.* audit log feed
- `/app/settings/security` — User Profile & Security (name edit, password change, sessions list, GDPR export)

**Hard escape hatch**: `IpFilterService.check()` always allows loopback / private addresses when `NODE_ENV !== 'production'`. Never remove this — it's the only thing keeping a misconfigured blocklist from locking developers out of the docker stack.

**Atomic vs fire-and-forget audit writes**: use `SecurityEventService.recordAtomic(input, work)` only when the audit row MUST exist with the action (e.g. inside a critical state transition). Use `record(input)` for everything else — it logs but never throws.

### Phase 3.4 — Compliance Monitoring (shipped)
Five-layer compliance pipeline that uses the entire Knowledge Base — both SIGN platform assets and the user's organisation assets — as the brain behind every contract check.

**Database (4 new tables)**: `compliance_checks`, `compliance_findings`, `obligation_reminder_logs`, `compliance_report_jobs`. Plus 13 new fields on the existing `obligations` table (`project_id`, `compliance_check_id`, `obligation_type`, `clause_ref`, `duration`, `timeframe_description`, `amount`, `currency`, `is_critical`, `next_reminder_date`, `last_reminder_sent_at`, `mark_met_token`, `mark_met_token_expires_at`) and the new `MET` / `WAIVED` status values. Plus `users.email_digest_opt_out`. Migration is idempotent (`ADD COLUMN IF NOT EXISTS`, `ALTER TYPE … ADD VALUE IF NOT EXISTS`).

**Strategic decisions — never violate**:
1. **Reuse the existing `obligations` table — do not fork.** All compliance-aware fields are columns on `obligations`, not a parallel `contract_obligations` table. Single source of truth for everything obligation-related.
2. **Use the existing `ContractType` enum as the standard.** ComplianceCheck stores `contract_type: string` (a ContractType value) — do not create a parallel "standard" enum.
3. **Knowledge taxonomy = tags, not enum values.** `type:PLAYBOOK` / `type:MANDATORY_LAW` / `type:CONFLICT_GUIDE` / `jurisdiction:EG` / `standard:FIDIC_RED_BOOK_2017` are all tag strings inside the existing `KnowledgeAsset.tags` jsonb. No new `AssetType` enum values.
4. **Layers 1-3 run as ONE Claude call** with all knowledge context. Avoids 3× token cost and gives Claude cross-layer awareness. The compliance agent (`ai-backend/app/agents/compliance_checker.py`) returns findings already partitioned by `layer`.
5. **Layer 4 (obligation extraction) reuses the existing obligations extractor agent** — chains after the compliance agent completes.

**Module**: `backend/src/modules/compliance/`
- 8 services: `ComplianceService` (orchestrator), `ComplianceKnowledgeService` (tag-driven KA queries → 3 partitioned context buckets), `ComplianceObligationService` (bulk-creates Obligation rows from extractor with `is_critical` heuristics), `ComplianceFindingService`, `ComplianceReportService`, `PdfReportService` (pdfmake-based with watermark + permissions), `ObligationTokenService` (HMAC mark-as-met tokens), `IcalExportService` (`ical-generator`)
- 4 controllers: `ComplianceController` (`/contracts/:id/compliance-checks/*` — auth'd), `ComplianceObligationsController` (`/contracts/:id/obligations`, `/projects/:id/obligations` — auth'd), `ComplianceReportDownloadController` (`/compliance/reports/download` — token-gated, no JWT), `PublicObligationController` (`/public/obligations/mark-met` — token-gated, no JWT, **separate `/public/` prefix** to avoid collision with the existing `/obligations/:id` route)
- BullMQ queue `compliance-jobs` for async report rendering

**Reminder engine** (extends the existing `obligation-reminders` queue):
- Multi-tier cadence: DAYS_30 / DAYS_14 / DAYS_7 / DAYS_1 / DUE_TODAY / OVERDUE
- Dedup via `obligation_reminder_logs` per `(obligation_id, reminder_type)` so each tier fires at most once
- New `weekly-digest` repeatable cron Mondays 06:00 UTC; honours `users.email_digest_opt_out`
- Daily reminder cron shifted to 06:00 UTC = 08:00 Cairo / 09:00 Riyadh / 10:00 Dubai
- Each reminder email contains a one-click "Mark as Met" button with an HMAC-signed token (`ObligationTokenService.issue`); single-use, 7-day expiry

**Global Report Standards (every PDF)**:
- pdfmake renderer with random discarded `ownerPassword` and `permissions: { printing: 'highResolution', modifying: false, copying: false, annotating: false }` — file opens freely but cannot be edited or copied
- Cover page (SIGN logo, report title, contract / project / org / jurisdiction / date / generated-by)
- Confidentiality footer + page number on every page
- Reports are **NEVER** downloaded directly from the browser — they are queued (`compliance-jobs` BullMQ), written to `/uploads/compliance-reports/<uuid>.pdf`, and emailed with an HMAC-signed download URL that expires in 24h
- Three report types: `COMPLIANCE_SUMMARY`, `OBLIGATIONS_REPORT`, `JURISDICTION_CONFLICT`
- Email subject format: `[SIGN] Your <Report Name> is ready — <Contract Name>`

**AI integration**:
- New Celery task `tasks.run_compliance_check` and FastAPI route `POST /agents/compliance-check`
- New agent `compliance_checker.py` accepts `(contract_type, jurisdiction, clauses, standard_knowledge, jurisdiction_knowledge, playbook_knowledge)` and returns `{findings: [...], summary: {...}}`. The 3 knowledge sections are passed as separate fields so the prompt can reason layer-by-layer.

**Knowledge base seed** (`compliance-knowledge.seed.ts`, idempotent): 9 SIGN-platform assets (`organization_id IS NULL`, `review_status = AUTO_APPROVED`, `source = 'PLATFORM_SEED'`):
1. FIDIC Red Book 2017 reference
2. FIDIC Yellow Book 2017 reference
3. NEC4 ECC core clauses
4. Egyptian Civil Code construction articles (incl. Art 651 decennial liability — overrides FIDIC limitation clauses)
5. Egyptian Public Procurement Law 182/2018
6. UAE Civil Code Muqawala (incl. Art 880 decennial liability)
7. UK Housing Grants Construction Act
8. FIDIC vs Egyptian law conflict guide
9. FIDIC vs UAE law conflict guide

`content` jsonb shape on each asset: `{ summary, articles: [{ ref, title, text, citation }] }` — structured so the AI receives parsed legal references, not opaque blobs.

**Frontend**:
- New tab "Compliance" on ContractDetailPage (`apps/sign/src/components/contracts/ComplianceTab.tsx`) — shows status badge, knowledge sources count, 3 "Email Report" buttons with confirmation dialog ("This report will be sent to <email>. Reports are sent by email for confidentiality purposes."), 4 layer tabs, sortable findings table with severity coloring + per-row status, obligations panel grouped by responsible party with mark-as-met buttons and iCal export
- New page `/app/projects/:id/obligations` (`ProjectObligationsPage.tsx`) — project-wide aggregation with summary cards (Total / Critical / Due This Week / Overdue / Met), filters (party / type / status), and timeline grouped by month
- Polling: ComplianceTab uses `refetchInterval` while `overall_status === PENDING` or `obligation_extraction_status === RUNNING` so the user sees progress in real time

**Frontend report request UX — never violate**: every "Email Report" button opens a confirmation dialog that says "Reports are sent by email for confidentiality purposes" — there is **no** browser download fallback. On confirm: `POST /contracts/:id/compliance-checks/:id/{report|conflict-report|obligations-report}` returns `{job_id, email}` and a toast confirms "Your report is being generated and will be sent to <email> within a few minutes."

**Public mark-as-met flow**: email contains a button → `${BASE_URL}/api/v1/public/obligations/mark-met?token=<HMAC>` → no-auth controller verifies the HMAC, transitions status to `MET`, returns a small inline HTML confirmation page with a "View dashboard" link. Token includes `obligation_id`, `user_id`, `expires_at`, and a nonce; token verification is timing-safe.
## Legal & Policy Layer

A complete set of 10 legally drafted policy documents has been prepared for SIGN
and is located in `/legal-docs/policies/`. These are the authoritative source for
all /legal/* policy page content.

See `/legal-docs/README.md` for the full document index and implementation guidance.

See `/legal-docs/prompt/SIGN_Claude_Code_Prompt.docx` for the 18-task implementation
prompt covering: cookie consent banner, T&C acceptance in registration, 11 new
/legal/* routes, app footer, AI disclaimers, claims/e-signature notices, Word Add-In
disclosures, communication preferences page, and backend consent column migration.

### Critical Legal Gaps (implement before launch)
1. No T&C checkbox in RegisterPage.tsx — users complete registration without consent
2. No accepted_terms_at column in users entity — no consent record exists
3. No cookie consent banner — no consent mechanism for future analytics
4. All /legal/* routes return 404 — all footer policy links are broken
5. No AI disclaimer on any AI output — transparency obligation unmet
6. No communication preferences UI — email_digest_opt_out has no API surface
7. Word Add-In LoginTab.tsx has no legal disclosures
