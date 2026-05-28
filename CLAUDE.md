# CLAUDE.md — Project Intelligence File
> Read this entire file at the start of every Claude Code session before touching any code.
> This file is the single source of truth for all architectural decisions, rules, and context.
> Last updated: 2026-05-28 (Phase 9.1 shipped — Abstract infrastructure layers: StorageService (9.1a), EmailService (9.1b), OCR/text extraction (9.1c). Gaps #5 and #6 resolved. Lessons #112–#114 added.)

---

## MANAGEX — Parent Brand Context

### What MANAGEX Is
MANAGEX is the parent brand and AI project management platform purpose-built for the construction industry.
Tagline: "Build Smarter. Deliver Certain."
Domain: managex.ai
Mission: Give every construction professional the clarity to walk into every project meeting knowing exactly where they stand — on risk, cost, time, and contract.
MANAGEX is a House of Brands — it owns 6 products, each covering a distinct construction discipline.

### MANAGEX Landing Page — Codebase Map
- Folder: `apps/managex/` (renamed from `apps/cenvox/`)
- Workspace name: `@managex/landing`
- Tokens package: `@managex/tokens` → `packages/tokens/managex.css`
- Logo: `apps/managex/src/components/ManagexLogo.tsx` — geometry copied verbatim from `managex_logo_final.svg`
- Dev URL: http://localhost:5175/ (Vite). Preview launches on 5175 when host 5175 is occupied by Docker.
- All `--cx-*` tokens were retired. Brand-level dark/light tokens are now `--mx-*` (dark, light, mx-cyan, etc.). SIGN's blue palette lives at `--mx-sign-primary*` / `--mx-navy-*` / `--mx-success|warning|danger`.

### The 6 MANAGEX Products

| Product | Discipline | Domain | Brand Color | Status |
|---------|-----------|--------|-------------|--------|
| **SIGN** | Contract & Legal Intelligence | sign.ai | Indigo `#4F6EF7` | 🟢 Active — Being Built Now |
| **VENDRIX** | Procurement & Vendor Management | vendrix.ai | Orange `#FF8C42` | 🔵 Coming Soon |
| **SPANTEC** | Project Scheduling & Planning | spantec.ai | Sky Blue `#38BDF8` | 🔵 Coming Soon |
| **CLAIMX** | Claims & Disputes Resolution | claimx.ai | Purple `#A855F7` | 🔵 Coming Soon |
| **GUARDIA** | Safety & Compliance | guardia.ai | Green `#22C55E` | 🔵 Coming Soon |
| **DOXEN** | Document Management | doxen.ai | Yellow `#EAB308` | 🔵 Coming Soon |

### MANAGEX Brand Identity
- Primary accent: `--mx-cyan: #00D4FF` (electric cyan)
- Secondary accent: `--mx-cyan-d: #0099CC` (deep cyan — used on light surfaces)
- Dark zone bg: `--dark: #07080D` (hero, why section, footer)
- Light zone bg: `--light: #FFFFFF` / `--light-2: #F7F8FA` (lifecycle, products, testimonials, CTA)
- Typography: Bricolage Grotesque (display 700/800, also 400 for hero subtitle) · DM Sans (body 300/400/500) · JetBrains Mono (labels/code)
- Logo: rounded square + 3 vertical pillars (M silhouette) + 2 diagonal lines converging on a luminous cyan dot (the X). Wordmark "MANAGE" + dominant cyan "X". See `apps/managex/src/components/ManagexLogo.tsx`.
- Design pattern: split dark/light layout — sections alternate between `--dark` zones and `--light`/`--light-2` zones with smooth gradient fades at boundaries.

### MANAGEX Brand Rules — Never Violate
1. MANAGEX is the parent — SIGN is a child product. Never confuse the two.
2. The SIGN app must always carry MANAGEX brand attribution ("Powered by MANAGEX" in footer, "← MANAGEX" back-link in nav).
3. SIGN's indigo `#4F6EF7` is SIGN-specific. MANAGEX cyan `#00D4FF` is parent-level only — never use inside SIGN app UI (and never use the retired CENVOX orange `#FF4D1C`).
4. Do not build any other MANAGEX product — VENDRIX, SPANTEC, CLAIMX, GUARDIA, DOXEN are placeholders only.
5. The MANAGEX landing page (`apps/managex/`) is a separate app — never mix its codebase, styles, or dependencies with SIGN.
6. Every SIGN feature must align with SIGN's discipline: Contract & Legal Intelligence for the construction industry.
7. The MANAGEX wordmark always uses split font sizes: a smaller "MANAGE" + a dominant, lower-line-height "X" in cyan. Never render them at the same size.

---

## What This Project Is
SIGN is an AI-powered contract management platform for the construction industry, built as part of the MANAGEX product suite. It handles contract creation, risk analysis, claims, notices, obligations, and e-signatures for construction contracts following FIDIC, NEC, and JCT standards.

---

## Monorepo Structure
```
apps/
  sign/        → React + Vite frontend (localhost:5173)
  managex/     → MANAGEX landing page (localhost:5175)
backend/       → NestJS API (localhost:3000)
ai-backend/    → FastAPI + Celery AI service (localhost:8000)
```

---

## Port Map
| Service | Port |
|---------|------|
| SIGN frontend | 5173 |
| MANAGEX landing | 5175 (canonical — the prior port was retired due to Docker port-bind collision; see lesson #42) |
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

### 6a. Frontend Env Vars — Never Hardcode URLs
All cross-app URLs in the SIGN frontend must come from Vite env vars:

| Var | Default | Used for |
|-----|---------|----------|
| `VITE_API_URL` | `http://localhost:3000/api/v1` | All API calls via `axios.ts` |
| `VITE_SOCKET_URL` | `http://localhost:3000` | WebSocket connection |
| `VITE_MANAGEX_URL` | `http://localhost:5175` | MANAGEX backlinks in AuthLayout, AdminLayout, TopBar |

**Critical:** Vite env vars that are missing from `.env` do NOT crash the app — they silently evaluate to `undefined` and render as the string `"undefined"` in the UI. This is the opposite of backend Joi validation (which crashes loudly). Always check `apps/sign/.env.example` after every pull. See lesson #83.

### 6b. i18n — Supported Locales
The SIGN frontend supports three locales: **EN** (English), **AR** (Arabic), **FR** (French).
- Locale files: `apps/sign/src/i18n/locales/{en,ar,fr}/common.json`
- Language switcher: `apps/sign/src/components/common/LanguageToggle.tsx`
- **Hard rule:** Adding a new locale requires TWO changes in the same commit: (1) the new `locales/<code>/common.json` file AND (2) registering the option in `LanguageToggle.tsx`. A locale file without a toggle entry is unreachable from the UI.

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
docker-compose up --build sign managex

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

## Known Local Dev Gotchas

### ✅ obligation_status enum MET/WAIVED — RESOLVED (Phase 7.3, PR #27)

Migration `1718000000002-AddComplianceMonitoring.ts` previously used the
wrong enum type name (`obligations_status_enum` vs `obligation_status`)
and swallowed the failure with a silent catch. Fixed 2026-05-25:

- `1718000000002` corrected for fresh rebuilds
- Corrective migration `1748000000004` runs `ALTER TYPE … ADD VALUE IF
  NOT EXISTS` for all existing environments
- `ObligationSchemaCheckService` throws on startup if any required value
  is missing — the problem can never silently recur

Run `npm run migration:run` once on any DB that predates PR #27.

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
| 7 — MANAGEX | Landing page only | SIGN layers |
| 8 — Store & Payments | Paymob, templates, licensing | Auth layer |
| 9 — Guest Portal | /contractor/* invited-party access only | Client portal layer |

---

## Features That MUST Use Plan Mode Before Coding (Rule 6)

| Feature | Why Planning Is Critical |
|---------|-------------------------|
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
- MANAGEX landing page

### Critical Known Bugs — Do Not Build On Top Of These
1. **~~DocuSign webhook was a no-op~~** — resolved in Phase 1.3: webhook now updates contract state correctly. EXECUTED status is safe to build on.
2. **axios.ts default URL is wrong** — points to port 3001 instead of 3000. Always use `VITE_API_URL`.
3. **Guest Portal is a stub** — treat `/contractor/*` as not built. Needs full planning session before building.
4. **~~No automated tests~~** — resolved in Phase 2: 49 tests across all 3 services (33 backend, 8 frontend, 8 AI pipeline). Backend count now 87 as of Phase 7.4 (PR #29).
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
| 2 | DocuSign webhook was a no-op | Fixed in Phase 1.3 — webhook updates contract state | ~~Do not build on EXECUTED status~~ — resolved |
| 3 | Guest Portal is a stub | Plan full build before starting | Use Plan Mode for this layer |
| 4 | Login breaks after laptop restart | Seed chained to migration:run in docker entrypoint | `command: sh -c "npm run migration:run && npm start"` |
| 5 | Stale node_modules after git pull | `docker-compose up --force-recreate --renew-anon-volumes -d backend` | Use named volumes |
| 6 | Admin portal inaccessible after restart | SYSTEM_ADMIN seed user missing | Seed is idempotent — runs on every startup |
| 7 | Port 3000 conflict | Stop local backend before docker-compose up | Use `docker-compose up frontend managex` to skip backend |
| 8 | MANAGEX not accessible | Frontend not started | Run `npm run dev` inside `apps/managex` |
| 9 | Orphaned clauses inflate dashboard count | `DELETE FROM clauses WHERE id NOT IN (SELECT DISTINCT clause_id FROM contract_clauses)` | Check for orphans after any killed extraction task |
| 10 | currentUser always null after page refresh | Add `refreshUserProfile()` in `useEffect` on mount in AppLayout and AdminLayout | Always test permission features after page refresh not just fresh login |
| 11 | Portal chooser bypassed for existing sessions | Use `sessionStorage` flag `portal-chosen` in AdminLayout redirect check | Never put role-based redirect logic only in LoginPage |
| 12 | مادة (N) prefix appearing in extracted clause content | `_strip_article_prefix()` called in `_parse_json()` on every clause | clause_number field stores the number — never repeat it in content |

### Outstanding Issues (not yet fixed — do not build on top of these)
No outstanding issues as of 2026-05-22.

---

## Password Validation Policy

Finalised 2026-05-20. All password-setting flows enforce identical rules.

### Rules (apply everywhere, no exceptions)
- Minimum **12 characters**
- At least **1 uppercase** letter
- At least **1 number**
- At least **1 special character** from `!@#$%^&*()_+-=[]{};\\':"\\|,.<>/?`

### All Six Password DTOs — ALL Must Stay in Sync

There are six DTOs that accept a password field. **Editing only one has no effect on the others.** When changing password rules, update all six in the same commit.

| File | Endpoint | Notes |
|------|----------|-------|
| `backend/src/modules/admin-security/dto/admin-security.dto.ts` | `POST /me/change-password` | **Frontend** (`meService.changePassword`) — live change-password path |
| `backend/src/modules/auth/dto/change-password.dto.ts` | `PATCH /auth/change-password` | Auth controller — legacy, deprecated in Phase 5.8, not called by any frontend page |
| `backend/src/modules/users/dto/change-password.dto.ts` | `PUT /users/me/password` | Users controller — legacy, deprecated in Phase 5.8, not called by any frontend page |
| `backend/src/modules/auth/dto/register.dto.ts` | `POST /auth/register` | New account registration |
| `backend/src/modules/auth/dto/reset-password.dto.ts` | `POST /auth/reset-password` | Password reset via email token |
| `backend/src/modules/auth/dto/accept-invitation.dto.ts` | `POST /auth/accept-invitation` | Invited-user first-time password — equivalent to registration |

### DB Policy — Must Stay in Sync With DTOs
`security_policies` table row `id='global'`:
- `password_min_length = 12` — enforced by `PasswordPolicyService.assertComplexity()` (called from `profile.controller.ts`)
- All require flags: `password_require_upper = true`, `password_require_lower = true`, `password_require_number = true`, `password_require_symbol = true`

### Frontend Pages With Password Validation
Four pages enforce the full `.{12,}` regex (uppercase + number + symbol + length):
- `RegisterPage.tsx` — registration
- `ResetPasswordPage.tsx` — password reset
- `AcceptInvitationPage.tsx` — invitation acceptance
- `MySecurityPage.tsx` — change password (validated in `handleChangePw()` before `changePw.mutate()`)

One page enforces a length-only check (no full regex — backend enforces the rest):
- `ProfilePage.tsx` — change password (length check `< 12` only, routes to `POST /me/change-password` via `meService.changePassword()`, added Phase 5.8)

### Hard Rules — Never Violate
1. When updating password validation rules, update **ALL SIX DTOs + the DB policy + ALL FIVE frontend pages** in the same commit. Search first: `grep -rn "password" backend/src --include="*.dto.ts"` to find every DTO with a password field.
2. Always trace `meService.ts → API route → controller → DTO import` before editing any DTO — never assume by filename.
3. Never test change-password or other destructive endpoints with your real admin account on the live DB — use a dedicated test user.
4. The `@Matches` regex and `@Length(12, 128)` on each DTO are the DTO-level floor. The `PasswordPolicyService` DB-driven check runs on top — if an admin lowers `password_min_length` below 12, the DTO still enforces 12.

---

## Rate Limiting Policy

Auth endpoints are rate-limited at the network layer via `@nestjs/throttler`
backed by Redis (same `REDIS_URL` Bull uses — no separate connection).
Account-level lockout in `AuthService` (5 wrong passwords → 30 min) still runs
on top — the two layers are complementary, never redundant.

### Thresholds (canonical — keep table and `app.module.ts` in lock-step)

| Endpoint                       | Throttler   | Limit                  |
|--------------------------------|-------------|------------------------|
| POST /auth/login               | `login`     | 5 per 10 min per IP    |
| POST /auth/register            | `register`  | 3 per hour per IP      |
| POST /auth/forgot-password     | `forgot`    | 3 per hour per IP      |
| POST /auth/reset-password      | `reset`     | 5 per 15 min per IP    |
| POST /auth/verify-mfa          | `mfa`       | 5 per 10 min per IP    |
| POST /auth/verify-recovery     | `recovery`  | 3 per hour per IP      |
| POST /auth/refresh             | `refresh`   | 20 per 15 min per IP   |
| POST /auth/accept-invitation   | `invitation`| 5 per hour per IP      |

Thresholds were modeled after Stripe, Okta, and AWS Cognito — strict limits
appropriate for a legal/contract platform handling sensitive documents.

### Hard rules — never violate
1. ThrottlerGuard is applied **per-method**, NOT globally and NOT per-controller.
   Only the 8 unauthenticated auth endpoints carry throttle decoration. Use
   the `@ThrottleOnly(name)` helper at `backend/src/common/decorators/throttle-only.decorator.ts`
   — it composes `@UseGuards(ThrottlerGuard) + @Throttle + @SkipThrottle` so a
   method only obeys its own bucket. Plain `@Throttle({foo: {}})` would also
   activate all 7 other named throttlers with their module defaults.
2. Storage is **Redis-backed** (`@nest-lab/throttler-storage-redis`). In-memory
   storage resets on restart and does not work across instances — never use it
   in production.
3. Every 429 response carries a `Retry-After` header AND a JSON body shaped
   `{ statusCode, error, message, retryAfter }`. Both come from
   `ThrottlerExceptionFilter` registered globally in `main.ts`.
4. `app.set('trust proxy', 1)` in `main.ts` is **required** for IP-based
   throttling to key on the real client behind Render/Vercel/nginx. Without
   it the throttler keys on the proxy IP and the entire control is useless.
5. The IP tracker is `getClientIp()` from `backend/src/common/utils/get-client-ip.util.ts` —
   the single source of truth for client-IP extraction across throttler,
   audit logs, IP-filter middleware, and auth controller.

### How to change a threshold safely
1. Edit the `throttlers: [...]` array in `backend/src/app.module.ts`.
2. Update the table above so docs match code.
3. Add or update a `lessons.md` entry if the change captures a learning.
4. **Never lower a limit without discussing the security implications first** —
   we err strict on auth endpoints. Raising a limit on a non-auth endpoint is
   fine; lowering it (or any change to login/register/forgot/reset/mfa/recovery)
   needs review.

---

## JWT & Token Security Policy

This policy was finalised in Phase 4.2. Every JWT-touching change MUST
adhere to these rules.

- **Access token expiry is env-driven.** `JWT_ACCESS_EXPIRES_IN` (default `15m`)
  is read by `AuthService.generateTokens()`. Do NOT hardcode `'15m'` anywhere
  in `backend/src/modules/auth/`.
- **Refresh token expiry is env-driven.** `JWT_REFRESH_EXPIRES_IN` (default `7d`)
  is read by `AuthService.generateTokens()`. Do NOT hardcode `'7d'`.
- **Every access token carries a `jti` claim.** Generated via `randomUUID()` in
  `generateTokens()`. JwtStrategy enforces it; SessionTrackingMiddleware keys
  off it; logout blacklists by it.
- **Refresh tokens carry a `family_id` claim.** A new family UUID is minted on
  fresh login (login / register / verifyMfa / verifyRecoveryCode /
  acceptInvitation). On rotation (refreshToken), the new refresh inherits the
  old family_id and sets `parent_token_hash` to the previous session's hash.
- **Reuse attack detection — entire family invalidated.** If a refresh token
  is presented but its `user_sessions` row is missing OR `revoked_at IS NOT NULL`,
  `SessionService.revokeFamily()` is called on the family_id and a
  `security.refresh_token_reuse_detected` event is recorded. Return 401.
- **Redis blacklist for access tokens.** Key format: `blacklist:jti:{jti}`,
  TTL equal to the access token's remaining lifetime (`exp - now`). On every
  request, `JwtStrategy.validate()` calls `TokenBlacklistService.isBlacklisted(jti)` —
  ~1ms overhead is acceptable. The service fails-OPEN on Redis errors so a
  Redis outage doesn't lock everyone out.
- **JwtStrategy validation order.** 1) user exists + active, 2) blacklist check
  (only when `payload.jti` is present — pre-Phase-4.2 tokens get a warning but
  pass under a 7-day grace window since all such tokens expire within 15 min).
- **SessionTrackingMiddleware keys on jti.** It decodes (no verify) the bearer
  access token, extracts `jti`, and calls `SessionService.findActiveByJti(jti)`
  to bump `last_active_at`. The old token-hash fallback was broken (user_sessions
  stores refresh hashes, not access hashes) and has been removed.
- **`JWT_REFRESH_SECRET` is a required env var, min 32 chars.** Joi enforces this
  at startup; must be DIFFERENT from `JWT_SECRET`. There is a dev-only fallback
  in `docker-compose.yml` so contributors don't break on pull; the real value
  goes in `./backend/.env`.
- **`users.refresh_token_hash` was retired in Phase 4.2.** All refresh-token
  validation now goes through `user_sessions` only. Any code that still reads
  or writes that column is a regression — remove it.

### How to change a token policy safely
1. Edit `backend/.env.example` AND `backend/src/app.module.ts` Joi schema in
   the same commit (Phase 1.5 rule still applies).
2. If lowering the access-token expiry, verify the Redis blacklist still
   has time to be useful (TTL must be > 0 for the call to do anything).
3. Never re-introduce a hardcoded `'15m'` or `'7d'` literal — always go
   through `ConfigService`.
4. Never reuse `JWT_SECRET` for refresh tokens — Phase 4.2 explicitly
   requires them to be different signing keys.

---

## Security
- .env.staging and .env.production are gitignored
- Per-service .gitignore files exist in all 4 service folders
- Seed passwords read from SEED_ADMIN_PASSWORD_1/2/3 env vars
- ~~DB fallback credentials in data-source.ts~~ — fixed in Phase 4.3 (throws if missing)
- DB fallback credentials in settings.py → cleanup before AWS deployment
- docker-compose.prod.yml needed before AWS deployment → reads DB password from env vars

---

## Secrets & Environment Variable Policy

This policy was finalised in Phase 4.3. Every change that touches an env
var MUST adhere to these rules.

### Hard rules — never violate
1. **Every env var used in code MUST be in BOTH `.env.example` AND the Joi
   schema in `app.module.ts`, in the SAME commit.** (Phase 1.5 rule.) If
   you add a `configService.get('NEW_VAR')` call, the same PR must add
   `NEW_VAR` to both places with a descriptive comment.
2. **NO hardcoded fallback secrets or passwords anywhere in source code.**
   No `process.env.X || 'literal-secret'`, no `?? 'dev-fallback'`. Phase 4.3
   removed every such fallback. Adding one back is a regression.
3. **Seed scripts MUST validate their own env vars and throw with a clear,
   developer-friendly error if missing.** Joi does NOT run when seeds
   execute. Use the `requireSeedPassword()` helper pattern in
   `admin-users.seed.ts` — boxed error, names the missing var, names the
   file to edit, gives a concrete example value.
4. **`data-source.ts` runs OUTSIDE NestJS — it must validate `DATABASE_URL`
   itself.** TypeORM CLI and migration commands import it directly,
   bypassing the Nest bootstrap and Joi entirely. Any new env var
   referenced inside `data-source.ts` must be validated manually at the
   top of that file with a clear `throw` on missing.
5. **Dev-only CSP/CORS entries MUST be gated behind
   `NODE_ENV !== 'production'`.** Production CSP `connectSrc` must NOT
   contain any `localhost` or `ws://localhost:*` entries. Same pattern
   already used for CORS origin pushes in `main.ts`.
6. **`SEED_ADMIN_PASSWORD_*` are optional in Joi (app boots without them)
   but required at RUNTIME when seed scripts execute.** This is by
   design — the API should not fail to start just because seeds haven't
   been configured on a given environment.
7. **`DOCUSIGN_RSA_PRIVATE_KEY` is PEM multiline** — when setting in
   production, ensure newlines are preserved. Use `\n` escapes if your
   secrets store flattens to one line, or use a multiline-aware secrets
   manager.

### How to add a new env var
1. Add it to the Joi schema in `backend/src/app.module.ts` with the
   right required/optional + default + URI/email shape.
2. Add it to `backend/.env.example` with a descriptive comment block
   explaining what it controls and what the safe default is.
3. Reference it via `configService.get<T>('NEW_VAR')` — never raw
   `process.env.NEW_VAR` inside Nest application code (seed scripts are
   the only exception because they run outside Nest).
4. If the var is also needed by `data-source.ts` or any other
   pre-bootstrap script, add a manual validation throw there too.
5. Update this section of CLAUDE.md if the new var introduces a new
   class of secret (e.g. a new third-party integration).

---

## Phase 1 — Critical Bug Fixes (In Progress)

### Phase 1.1 — Fix Wrong API URL (shipped)
- Fixed socketService.ts: was connecting to localhost:3001 (wrong port). Now uses `VITE_SOCKET_URL || localhost:3000`
- Fixed supportSocketService.ts: had fragile double `.replace()` chain. Now uses `VITE_SOCKET_URL || localhost:3000`
- Fixed apps/cenvox/src/App.tsx: SIGN_URL was a bare hardcoded string. Now uses `VITE_SIGN_APP_URL` env var with fallback
- Created apps/cenvox/.env.example with VITE_SIGN_APP_URL documented
- Fixed orphaned clauses bug in document-processing `reprocess()` — now cleans up old clauses before reprocessing a document
- ~~Flagged: 4 localhost:5175 CENVOX backlinks remain in SIGN layouts (AuthLayout.tsx ×2, AdminLayout.tsx, TopBar.tsx)~~ — **fixed in Phase 5.4**: all 4 replaced with `import.meta.env.VITE_MANAGEX_URL`
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
- apps/managex (formerly apps/cenvox) has no tests — skipped entirely

**Hard rules — never violate:**
- CI is unit-test ONLY — never start Docker containers, never use real database, never use real Redis, never use real Anthropic API
- Frontend CI runs from repo root because @managex/tokens is a workspace dependency — running `cd apps/sign && npm ci` would fail to resolve it
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

### Phase 3.1 — SQL Injection Prevention (shipped — 2026-05-16)

Full audit of all database query patterns across the backend.

**Audit findings:**
- TypeORM named parameter binding used consistently across all
  28 query builder files — zero injection vulnerabilities found
- Zero raw SQL with user input (only one hardcoded SELECT 1
  health check ping)
- Zero dangerous ORDER BY patterns with user input
- Zero dynamic table/column names
- AI backend has no SQL at all — pure HTTP delegation
- pgvector queries: TypeScript side fully parameterized

**One gap found and fixed — LIKE wildcard leakage:**
- 8 ILIKE search patterns used correct named parameter binding
  (no injection possible) but did not escape %, _, \ characters
- User searching for "100%" would match "1000", "100abc" etc.
  because % is a PostgreSQL wildcard — not injection, but wrong
- 8 sites patched (all ILIKE sites across the entire backend are now protected)

**What was added:**
- New helper: backend/src/common/utils/escape-like.ts
  exports escapeLikeParam(value: string): string
  escapes \, %, _ in correct order with null guard
- Applied at 8 ILIKE sites across 6 files:
  admin-audit-log/admin-audit-log.service.ts (1 site)
  admin-organizations/admin-organizations.service.ts (2 sites)
  clauses/clauses.service.ts (1 site)
  contracts/contracts.service.ts (1 site)
  knowledge-assets/knowledge-assets.service.ts (1 site)
  admin-security/services/admin-activity-log.service.ts (1 site)
  admin-security/services/security-audit-log.service.ts (1 site)

**Hard rules — never violate:**
- LIKE/ILIKE queries must ALWAYS use escapeLikeParam() on the
  user input before wrapping in %
- Backslash must be escaped FIRST in the helper — reordering
  the replace() calls causes double-escaping bugs
- The % wrapping stays at the call site, NOT inside the helper

### Phase 3.3 — Input Validation (shipped — 2026-05-16)

Fixed raw @Body() mass assignment vulnerabilities and missing DTO validation across 5 controllers.

**6 HIGH findings fixed — raw @Body() bypassing class-validator:**
- H1: compliance-obligations — `Partial<Obligation>` mass assignment replaced with `UpdateObligationInlineDto` (status + completed_at only)
- H2: compliance-obligations — `ObligationFilters` plain interface replaced with `ObligationFiltersDto` class with @IsEnum, @IsDateString
- H3: contracts — reorderClauses raw body replaced with `ReorderClausesDto` (@IsUUID each + @ValidateNested + @ArrayMaxSize(500))
- H4: compliance — inline `{status}` body replaced with `UpdateFindingStatusDto` (@IsEnum(ComplianceFindingStatus))
- H5: auth — inline `{level: string}` replaced with `CompleteOnboardingDto` (@IsIn(['none','quick','comprehensive']))
- H6: document-processing — inline `{clause_ids}` replaced with `ClauseIdsDto` (@IsUUID each + @ArrayMaxSize(500))

**6 MEDIUM findings fixed — missing range/format validators:**
- M4: contracts — party name update now uses `UpdatePartiesDto` (@MaxLength(255) on both party name fields)
- M5: contracts — change summary now uses `UpdateChangeSummaryDto` (@MaxLength(1000))
- M6: contracts — comment content update now uses `UpdateCommentContentDto` (@MaxLength(5000))
- M1: obligations — @Min(0) @Max(365) on reminder_days_before
- M2: subscriptions — @Min(0) on price
- M3: subscriptions — @Min(1) on duration_days, max_projects, max_users, max_contracts_per_project

**Deferred to Phase 3.5:**
- AI controller raw @Body() patterns (JWT-guarded, Bull queue)
- @IsUrl() on logo_url and evidence_url
- @ArrayMaxSize() on tags and approver arrays

**Hard rules — never violate:**
- NEVER use `Partial<Entity>` as a @Body() type — entities expose all database fields including id, created_at, relations. Always create a dedicated DTO that exposes only what the endpoint should accept.
- NEVER use a plain TypeScript interface for @Query() or @Body() — class-validator decorators only work on classes, not interfaces. A plain interface gets zero validation silently.
- Every raw `@Body()` inline object (`{ field: type }`) must become a proper DTO class before merging. Inline objects bypass the global ValidationPipe entirely.

### Phase 3.4 — File Upload Security (shipped — 2026-05-16)

Audited all 5 file upload endpoints across 4 modules.
Fixed path traversal, missing size limits, missing type validation, and a broken file URL assignment.

**Upload architecture:**
- multer uses memoryStorage — entire file buffered in Node.js heap before any code runs
- StorageService.uploadFile() manually writes buffer to disk with UUID filename — user filename never appears in stored path
- Local disk only, /app/uploads mounted as Docker named volume
- All endpoints JWT-guarded — no unauthenticated upload possible
- No static file serving of /uploads/ directory

**5 HIGH findings fixed:**
- H1: File size limits added to all 5 FileInterceptor() calls at the multer level (50MB/20MB/10MB/50MB/10MB per endpoint). Previously: multer had no limit — any file size accepted, entire file buffered to Node.js heap before any check ran
- H2: File type validation (MIME + extension dual guard) added to document-processing (PDF+DOCX), parse-docx (DOCX only), organizations policy (PDF only). New shared helper: `backend/src/common/utils/file-validation.ts`
- H3: Path traversal prevention in storage.service.ts — `assertContained()` added to getFilePath, getFileBuffer, deleteFile — resolves both paths, appends path.sep to base, throws BadRequestException if path escapes upload directory
- H4: Path containment before res.sendFile() in compliance.controller.ts — job.file_path resolved and verified to start with upload dir before Express serves the file
- H5: organizations.service.ts fileUrl bug fixed — `uploadFile?.(file)` returns StorageResult object — was storing the entire object (then falling back to raw originalname) as the file_url. Fixed to use `uploaded.file_url` (string)

**1 MEDIUM finding fixed:**
- M4: ParseDocxBodyDto created with @MaxLength(500000) on text field — deferred from Phase 3.3, now fixed

**Bonus fix:**
- HttpExceptionFilter updated to catch MulterError LIMIT_FILE_SIZE and return 413 Payload Too Large instead of 500

**Hard rules — never violate:**
- Every FileInterceptor() MUST have a `limits: { fileSize: N }` option — never call `FileInterceptor('field')` with no options
- ALWAYS use `assertContained()` or equivalent before using any file path derived from a URL or database value
- `path.resolve()` MUST be used on BOTH sides of the `startsWith()` check AND the base path must have `path.sep` appended to prevent prefix-bypass attacks (e.g. `/app/uploads-evil` bypasses `startsWith('/app/uploads')` without the separator)
- NEVER use `file.originalname` in a file path — UUID filename generation in StorageService is the correct pattern
- NEVER use optional chaining result directly as a string — `uploadFile?.(file)` returns StorageResult not string; always access the specific field (`uploaded.file_url`)

### Phase 3.5 — XSS Prevention (shipped — 2026-05-17)

Audited all XSS vectors across the full stack. React frontend
is essentially XSS-proof. Two active fixes applied.

**XSS surface audit results:**
- dangerouslySetInnerHTML: ZERO uses anywhere in the codebase ✅
- innerHTML / outerHTML: ZERO uses ✅
- document.write / eval: ZERO uses ✅
- React auto-escaping: covers all normal {variable} renders ✅
- Phase 3.2 sanitize-html: covers all stored backend fields ✅
- pdfmake: uses text fields (plain text, not HTML) ✅
- AI output: rendered via normal React renders (auto-escaped) ✅
- Third-party JS: none in index.html ✅
- Open redirects: none (all navigate() targets hardcoded) ✅
- Helmet: active with explicit CSP configuration ✅

**Fix 1 — Email HTML injection prevention:**
- New helper: `backend/src/common/utils/escape-html-email.ts`
  exports `escapeHtml()` — escapes &, <, >, ", ' in correct order
- Applied to all 9 email template functions in `templates/index.ts`
  38 call sites covering all user-supplied strings:
  inviterName, organizationName, contractName, projectName,
  requesterName, reviewerName, comments, recipientName,
  sharedByName, permission, userName, obligationDescription,
  dueDate, subject, category, priority, entityName, reason,
  operationsUserName, ticketIdDisplay
- System-generated values (OTP codes, UUIDs, enum keys, numbers)
  intentionally NOT escaped — documented with inline comments
- Prevents: malicious display name injecting HTML/JS into every
  invitation or approval email sent from the platform

**Fix 2 — Explicit CSP configuration in helmet():**
- Replaced bare `helmet()` with fully documented CSP directives
- `scriptSrc 'self'`: blocks all inline scripts and eval
- `connectSrc` includes BASE_URL from config: production API
  calls won't break (missing connectSrc was the critical gap)
- `frameAncestors 'none'`: clickjacking protection
- `objectSrc 'none'`: no Flash or plugin injection
- `crossOriginEmbedderPolicy: false`: preserved for pdfmake
  blob: URL compatibility

**Fix 3 — JWT localStorage documented as known risk:**
- Code comment added to `authSlice.ts` at localStorage lines
- Current risk level: LOW (no XSS vector exists to exploit it)
- Migration path to httpOnly cookies documented for Phase 6

**Known deferred item (Phase 6 — Pre-Deployment Security):**
- JWT migration from localStorage to httpOnly cookies
- Requires: Set-Cookie header (backend) + remove localStorage
  (frontend) + axios withCredentials: true + refresh token
  endpoint reads from cookie instead of Authorization header
- ~1 day coordinated backend + frontend effort
- Not urgent: no current XSS vector to exploit the tokens

**Hard rules — never violate:**
- NEVER use `dangerouslySetInnerHTML` with API or user content.
  If you need to render HTML from the server, run it through
  DOMPurify first: `import DOMPurify from 'dompurify'`
- ALWAYS use `escapeHtml()` on user-supplied strings before
  interpolating them into email template literals
- The `&` replacement MUST be first in `escapeHtml()` — otherwise
  you double-escape the `&` in `&lt;`, `&gt;` etc.
- This `escapeHtml()` is for EMAIL OUTPUT only — do not use it
  for input sanitization (use `sanitize.ts`/`stripHtml` for that)
- `connectSrc` in CSP MUST include the production API origin —
  omitting it causes all fetch/XHR calls to fail silently
- Do NOT add `'unsafe-inline'` or `'unsafe-eval'` to `scriptSrc` —
  that defeats the entire purpose of CSP
- `crossOriginEmbedderPolicy` MUST stay false — setting it to
  true breaks pdfmake blob: URL generation

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

### Critical Legal Gaps — All Resolved

All 7 pre-launch legal gaps have been closed. Do not reopen without team agreement.

| # | Gap | Status | Fixed by |
|---|-----|--------|----------|
| 1 | No T&C checkbox in RegisterPage.tsx | ✅ Resolved | Phase 4.4 — `agreedToTerms` state + disabled submit; `agreed_to_terms` sent to API |
| 2 | No `accepted_terms_at` column in users entity | ✅ Resolved | Phase 4.4 — migration `1746950000001-AddConsentColumns.ts`; `auth.service.ts` sets timestamp on register |
| 3 | No cookie consent banner | ✅ Resolved | Phase 4.4 — `CookieConsentBanner` in `App.tsx`; Phase 5.5 added server-side persistence via `UpdateCommunicationPreferencesDto` |
| 4 | All `/legal/*` routes return 404 | ✅ Resolved | Phase 4.4 — 11 policy pages live at `apps/sign/src/pages/legal/` |
| 5 | No AI disclaimer on any AI output | ✅ Resolved | Phase 5.5 — `<AIDisclaimer compact />` added to `ClauseReviewPage.tsx` and `ClausesPage.tsx` |
| 6 | No communication preferences UI | ✅ Resolved | Phase 4.4 — comms preferences page + `PATCH /me/communication-preferences` API surface |
| 7 | Word Add-In LoginTab.tsx has no legal disclosures | ✅ Resolved | Phase 4.4 — `LoginTab.tsx` has Terms of Service + Privacy Policy links via `Office.context.ui.openBrowserWindow` |

---

## Phase 4 — CENVOX → MANAGEX Rebrand (shipped — 2026-05-12)

End-to-end rebrand of the parent brand from CENVOX to MANAGEX. Landing page completely rebuilt with a new design system (dark/light split, electric cyan accent, Bricolage Grotesque display + DM Sans body + JetBrains Mono mono).

### What changed
- `apps/cenvox/` → `apps/managex/`. Workspace name `@cenvox/landing` → `@managex/landing`. Docker compose service, container name, volume paths, and Dockerfile all updated.
- `packages/tokens/cenvox.css` → `packages/tokens/managex.css`. Package `@cenvox/tokens` → `@managex/tokens`. The token file no longer carries the orange (`--cx-fire`, `--cx-ember`) or void (`--cx-void`, `--cx-void2`) palette. New `--mx-*` token system with split dark/light zones, plus SIGN-namespaced `--mx-sign-primary*` / `--mx-navy-*` extension palette for the SIGN app to keep working.
- Apps/sign: import path `@managex/tokens/managex.css`, package name `@managex/sign`, CSS classes `.cenvox-backlink` / `.cenvox-attribution` / `.sign-cenvox-attribution` renamed (and recolored to cyan). Backlink label "← CENVOX" → "← MANAGEX". Footer attribution "Powered by CENVOX" → "Powered by MANAGEX". Auth page sub-brand tag "A CENVOX product" → "A MANAGEX product". The orange SVG glyph in the auth footer was replaced with the small MANAGEX mark (rounded-square + 3 pillars + cyan accent dot).
- Word Add-in: `CenvoxAttribution` component renamed to `ManagexAttribution`; CSS class `.sign-cenvox-attribution` → `.sign-managex-attribution`; copy "Powered by CENVOX" → "Powered by MANAGEX".
- Root `package.json` workspace scripts and name updated. `.claude/launch.json` config renamed (port 5175 → preview falls back to 5175 when Docker holds 5175). README.md banner updated.
- Old landing components removed entirely: `CenvoxLogo.tsx`, `StatsTicker.tsx`, `OrbitalDiagram.tsx`, `PhaseCard.tsx`, `ProductCard.tsx`, `TestimonialCard.tsx`. The custom-cursor system from the old landing is gone too.

### New landing page structure (apps/managex/)
- `src/components/ManagexLogo.tsx` — `ManagexMark` (88×88 viewBox, geometry copied verbatim from `managex_logo_final.svg`) + `ManagexLogo` lockup with split font sizes ("MANAGE" smaller, dominant "X" in cyan with `top: 2px` baseline offset). Three variants: `nav` (30px mark, 17/28 wordmark), `footer` (24px mark, 16/24), `sidebar` (20px mark, 13/20).
- `src/components/HeroDashboard.tsx` — static dashboard mockup inside browser chrome: sidebar nav + 3 stat cards + 3 contract rows. Pure decoration.
- `src/App.tsx` — single page with sections: Nav · Hero · Logos bar · Lifecycle (light) · Products (light-2) · Why MANAGEX (dark, 3 alternating rows) · Testimonials (light) · Mission (dark-2) · CTA (light-2) · Footer (dark).
- `src/index.css` — Tailwind base + extensive custom CSS using only `--mx-*` and the new dark/light/product tokens. No `--cx-*` references anywhere.

### Hard rules added from rebrand — never violate
1. **Logo geometry is sacrosanct.** The mark SVG is copied verbatim from `managex_logo_final.svg` (88×88 viewBox: rounded-rect frame, 3 vertical pillars at x=17/40/63, two diagonals converging on (46, 39), 5px cyan accent dot). Do not redraw or "improve" it.
2. **Wordmark always uses split sizes.** "MANAGE" font-size sits below the dominant cyan "X" font-size. Line-height on "X" is 0.82 with `position: relative; top: 2px;` to align baselines. Rendering them at the same size is wrong.
3. **MANAGEX cyan `#00D4FF` is parent-level only.** Never use it inside the SIGN app UI body — SIGN uses its own indigo `#4F6EF7`. The only MANAGEX-cyan elements inside SIGN are the "← MANAGEX" backlink and the "Powered by MANAGEX" attribution.
4. **Dark/light split is the brand pattern.** The MANAGEX landing alternates dark and light sections with a 280px gradient fade at the bottom of the hero. Do not put a third color zone in between — it breaks the rhythm.
5. **Logo color rules for surface contrast.** On dark surfaces the mark uses white pillars + bright cyan (`#00D4FF`) accent. On light surfaces, dark pillars (`#0A0F1E`) + deep cyan (`#0099CC`) accent. `ManagexLogo` and `ManagexMark` both take an `onLight` prop for this; never hardcode.
6. **Preview port quirk.** Docker holds 5175 when `docker-compose up` has been run on this machine. The Vite preview server cannot bind 5175 in that state — `.claude/launch.json` is configured for port 5175 with `--strictPort` to keep this deterministic. Don't switch back to 5175 unless Docker is stopped.

### Targeted copy & visual revisions (applied 2026-05-12 in the same session)
Fourteen targeted text and visual changes were applied after the initial landing build:
1. Hero eyebrow: "AI Platform for Construction Intelligence"
2. Hero subtitle: "Six AI products. One platform. Built for the professionals…" (Bricolage Grotesque 400, clamp(18px, 2.5vw, 24px), `rgba(244,246,255,0.55)`, line-height 1.5)
3. Hero body: "We built MANAGEX because the construction industry deserves better…"
4. Logos bar: "Powering the teams building tomorrow's world"
5. Lifecycle body: "Construction doesn't happen in phases — it happens in one connected, high-stakes continuum…"
6. Products body: "We didn't build one product and call it a platform…"
7. Why row 1 body: extended with "Not the internet. … the way a commercial manager does."
8. Why row 1 visual: two-zone card. Zone 1 = "Trained on construction." (white) + "Not the internet." (cyan). Cyan-to-transparent gradient divider. Zone 2 = "⚠ Delay detected" (mono, #EAB308) + "Critical path · 26 days at risk" (DM Sans 400, d-mid) + "Identified 6 weeks early." (DM Sans 500, cyan). Implemented via the `WhyRow1Visual` component when `row.visual === null`.
9. Why row 2 body: extended with "One platform. One source of truth. Zero information lost between disciplines."
10. Why row 3 body: extended with "Not reactive. Not retrospective. Predictive."
11. Mission quote: "We believe every construction professional deserves to walk into every project meeting **knowing exactly where they stand** — on risk, on cost, on time, on contract. We built MANAGEX to make that possible." (`knowing exactly where they stand` wrapped in `var(--mx-cyan)`).
12. Mission body: "Through six AI-powered products, we give construction organisations the clarity to plan precisely… For every project."
13. CTA heading: "Start building with intelligence on your side." (`intelligence on your side` uses the dark-cyan→#0066AA gradient via `.mx-grad-cyan-d`).
14. CTA body: "One platform. Six products. Every phase covered. Join the teams already building smarter with MANAGEX."

---

## Phase 4.2 — JWT & Refresh Token Hardening (shipped — 2026-05-18)

Hardened the JWT and refresh token lifecycle. Closed the 15-min logout
abuse window. Added rotation-chain reuse-attack detection. Retired the
dual-storage `users.refresh_token_hash` column.

### What shipped
- **Token family tracking.** `user_sessions` gained 3 columns: `family_id`
  (UUID), `parent_token_hash` (SHA-256 hex), and `jti` (UUID). New migration
  `1747000000001-AddTokenFamilyTracking.ts` adds them idempotently
  (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- **Reuse-attack detection.** `AuthService.refreshToken()` now looks up the
  session by SHA-256 of the raw refresh JWT. If row not found OR `revoked_at`
  is set, every session in the family is revoked atomically and a
  `security.refresh_token_reuse_detected` event is recorded. Return 401.
- **Redis access-token blacklist.** New `TokenBlacklistService` + `TokenBlacklistModule`
  (`@Global()`). On logout, the access token's jti is added to Redis with TTL
  = remaining token lifetime. `JwtStrategy.validate()` checks the blacklist
  on every request. Key format: `blacklist:jti:{jti}`. Fails-open on Redis
  errors so a Redis outage doesn't lock everyone out.
- **jti on every access token.** `generateTokens()` now stamps a `randomUUID()`
  jti claim on each access token. `family_id` is stamped on each refresh token.
- **Env-driven expiries.** `JWT_ACCESS_EXPIRES_IN` and `JWT_REFRESH_EXPIRES_IN`
  added to Joi (`.default('15m')`/`.default('7d')`). The hardcoded `'15m'`/`'7d'`
  literals in `auth.service.ts` are gone.
- **`JWT_REFRESH_SECRET` Joi-validated.** Required at startup with `min(32)`.
  Dev-only fallback in `docker-compose.yml` so contributors aren't broken on
  pull; `.env.example` documents it as required.
- **acceptInvitation now uses `_finalizeLogin`.** Previously this method skipped
  session tracking entirely, leaving no user_sessions row for the invited user
  until their first refresh.
- **`users.refresh_token_hash` retired.** New migration
  `1747000000002-RemoveLegacyRefreshTokenHash.ts` drops the column. All
  read/write sites in code are gone. Property removed from the User entity.
- **SessionTrackingMiddleware fixed.** Now keys on the access token's `jti`
  (via `SessionService.findActiveByJti()`), not on a hash of the bearer token.
  The old approach silently never matched because `user_sessions.token_hash`
  stores refresh hashes, not access hashes.
- **Filter ordering regression test.** TEST 6 in `rate-limit.spec.ts` mounts
  both `HttpExceptionFilter` and `ThrottlerExceptionFilter` in production order
  and asserts the 6th login attempt still gets a proper 429 envelope.
- **5 new token security tests** in `backend/src/modules/auth/tests/token-security.spec.ts`:
  reuse attack triggers family invalidation, logout blacklists jti, blacklisted
  refresh cannot be reused, acceptInvitation creates a session, every access
  token carries a distinct UUID jti.

### Hard rules added — never violate
- NEVER store refresh tokens in `users.refresh_token_hash` — that column is
  gone. All refresh-token state lives in `user_sessions`.
- NEVER use a JWT signing function with a hardcoded `'15m'` or `'7d'` —
  always read from `ConfigService.get('JWT_ACCESS_EXPIRES_IN')` /
  `JWT_REFRESH_EXPIRES_IN`.
- NEVER instantiate `new Redis()` per-request — the `TokenBlacklistModule`
  owns the shared client. Inject `TokenBlacklistService` instead.
- The `TokenBlacklistService` MUST fail-open on Redis errors. A Redis outage
  must not lock every user out; the session row revocation still catches
  refresh-token reuse.
- Every new login path MUST call `_finalizeLogin()` with `family_id`,
  `parent_token_hash` (null for fresh logins), and `accessJti`. Skipping it
  leaves the user with no session row and breaks security telemetry.
- The `&` replacement order matters in encoders. (Phase 3.5 escapeHtml has
  the same rule for HTML escaping; here it's a reminder that
  `parent_token_hash` MUST be set BEFORE the new session is created in a
  rotation, never after.)
- Token-family invalidation MUST be atomic — `SessionService.revokeFamily()`
  uses a single UPDATE … WHERE family_id = $1 statement. Do not split it
  into a loop of per-row revokes.
- **`revokeFamily()` alone is NOT sufficient to invalidate active access tokens.**
  DB revocation only prevents new refresh operations — already-issued access
  tokens remain valid for their full TTL (default 15 min) unless their JTIs
  are also blacklisted in Redis. The `JwtStrategy` checks Redis on every
  request; it does NOT hit the database. ALWAYS blacklist JTIs BEFORE
  revoking the DB family rows, in this exact order:
  1. Call `SessionService.listByFamily(familyId)` to fetch all session rows
  2. For each row with a `jti`, call `tokenBlacklist.blacklistToken(jti, ttlSeconds)`
     where `ttlSeconds = parseExpiryToSeconds(JWT_ACCESS_EXPIRES_IN)`
  3. Only then call `SessionService.revokeFamily(familyId)`
  Skipping step 2 leaves all rotated access tokens live through their full TTL
  even after a reuse attack is detected. This was a post-ship bug found during
  manual testing — fix commits `501d48f` + `ef13a1e`.

---

## Phase 5.2 — Developer Setup Guide (shipped — 2026-05-21)

Created `docs/SETUP.md`: a complete from-scratch setup guide for new and returning contributors.
Merged as PR #15 with green CI.

### What shipped
- **`docs/SETUP.md`** — 524 lines, 13 sections, every command cross-verified against the actual codebase:
  1. Prerequisites (Node 20, npm 10, Python 3.11, Docker Desktop, gh CLI)
  2. Clone & First-Time Setup (workspace install rules, backend independence note)
  3. Environment Files (4 `cp` commands, per-service minimum-values tables with per-var notes)
  4. Start the Stack (first-time vs subsequent, startup flow diagram, verify commands)
  5. Seed Users (3 SYSTEM_ADMIN accounts, 9 KB assets, `ON CONFLICT DO NOTHING` note)
  6. Port Map (all 7 services + container names)
  7. Running Tests (backend `--runInBand`, frontend repo-root rule, AI Docker vs local)
  8. What Works Without External APIs (feature list + external-key table with free alternatives)
  9. Hot Reload Behaviour (per-service table covering Linux/Mac and Windows + override.yml note)
  10. Common Failures & Fixes (7 issues: bcrypt, CRLF, stale node_modules, Joi var, port 5175, gh scope, `--runInBand`)
  11. Database Reset & Recovery (9 one-liners)
  12. gh CLI Setup (install, required scopes, verify)
  13. Pre-PR Checklist (8-step checklist sourced from CLAUDE.md)
- **`README.md`** — added `docs/SETUP.md` as the first Documentation link
- **`README-DEV.md`** — added first-time-setup callout at the top pointing to `docs/SETUP.md`

### Hard rules — never violate
- `docs/SETUP.md` is the single source of truth for contributor onboarding. If a setup step changes (new required env var, new Docker command, port change), update `docs/SETUP.md` in the same commit.
- Never duplicate setup instructions between `README-DEV.md` and `docs/SETUP.md` — `README-DEV.md` is a quick-start summary; `docs/SETUP.md` is the authoritative reference.

---

## Phase 5.3 — Branch Cleanup (shipped — 2026-05-21)

Deleted all 13 stale remote branches accumulated across Phases 1–5.2. All content was confirmed on `main` before deletion (DocuSign impl, rate limiting, JWT hardening, legal pages — all verified via `grep` against the live codebase).

**After cleanup:** `origin/main` only. Local worktree branches (`claude/eager-allen`, `claude/relaxed-lamarr-9a7616`) are Claude Code infrastructure — not feature branches, never delete.

**Hard rule:** Run `git branch -r --merged main` after every merge sprint. Any branch older than 48 hours that is merged into main is a delete candidate. Worktree branches (`claude/*`) are managed by tooling — skip them.

---

## Phase 5.4 — ManageX Backlink URL Hardcode Fix (shipped — 2026-05-22)

Shipped by Youssef, commit `0a93c3e`. No PR — direct commit to main.

### What shipped
- **`VITE_MANAGEX_URL`** env var introduced — the canonical way to reference the MANAGEX landing URL from within the SIGN app
- **`apps/sign/src/components/common/ManagexLogo.tsx`** — new MANAGEX logo mark component for use in SIGN layouts (backlinks, attribution)
- **4 hardcoded `localhost:5175` URLs replaced** with `import.meta.env.VITE_MANAGEX_URL` in:
  - `apps/sign/src/components/common/AuthLayout.tsx` (×2)
  - `apps/sign/src/components/layout/AdminLayout.tsx`
  - `apps/sign/src/components/layout/TopBar.tsx`
- **`apps/sign/.env.example`** updated with `VITE_MANAGEX_URL=http://localhost:5175`
- **`apps/sign/src/vite-env.d.ts`** updated with type declaration
- **`NEXT_PHASES.md`** created as a local planning doc and immediately gitignored

### Action required on pull
After pulling this commit, add to `apps/sign/.env`:
```
VITE_MANAGEX_URL=http://localhost:5175
```
Missing this var causes backlinks to render as `"undefined"` with no error (see lesson #83 and section 6a).

---

## Phase 5.5 — Legal Compliance Gaps Closed (shipped — 2026-05-22)

Shipped by Youssef, PR #17. 22 files, 791 insertions, 127 deletions.

### What shipped
- **French locale** — `apps/sign/src/i18n/locales/fr/common.json` (new, 381 lines). Full French translation of all UI strings.
- **`i18n/index.ts`** — French locale registered alongside EN and AR
- **`LanguageToggle.tsx`** — reworked from 2-way (EN/AR) to 3-way dropdown (EN/AR/FR)
- **Cookie consent server-side persistence** — `CookieConsentContext.tsx` updated to call `PATCH /me/communication-preferences` when consent is saved; banner and modal updated accordingly
- **AI disclaimer** — `<AIDisclaimer compact />` added to `ClauseReviewPage.tsx` and `ClausesPage.tsx` (closes legal gap #5)
- **All 10 legal pages updated** — content centralised into `apps/sign/src/pages/legal/content/index.ts` (new, 162 lines); each page now pulls from this index
- **Backend DTO** — `UpdateCommunicationPreferencesDto` in `admin-security.dto.ts` gained two optional fields: `cookie_consent_given_at` (ISO-8601 string, `@MaxLength(40)`) and `cookie_consent_version` (`@MaxLength(20)`)
- **Backend controller** — `profile.controller.ts` validates `cookie_consent_given_at` as a valid ISO-8601 timestamp; throws `BadRequestException` on malformed input

### No migration, no new packages, no new Joi vars
These backend changes are additive and `@IsOptional()` — no breaking change.

---

## Phase 6.2 — Coming Soon Cards (ManageX Landing) (shipped — 2026-05-23)

Upgraded the 5 sibling product placeholders on the MANAGEX landing page into fully styled cards with brand colour accents and a local-only "Notify Me" opt-in. No backend wiring — purely a visual + UI state change.

### What shipped
- Enhanced the existing 5 sibling product cards in `apps/managex/src/App.tsx`. Before: faded placeholders at `opacity: 0.5` showing only name/domain/desc + a tiny "Coming soon" label. After: full-opacity cards with brand-coloured top strip, "Coming Soon" pill badge, microcopy, email input, and a "Notify Me" button.
- Each card carries its own local state. State shape: `Record<string, { email: string; submitted: boolean }>` keyed by product `name`. On submit, the form row is replaced with an inline confirmation message ("You're on the list! We'll notify you at launch.") coloured in the product's brand colour. State isolation: submitting one card never affects the other four.
- Email opt-in is local state only — no backend call, no persistence, no data stored anywhere. The submit handler bails out silently on empty input (no validation toast).
- Component pattern: inline JSX + CSS classes — no new component files. Matches the existing MANAGEX landing convention (the entire landing page is one `App.tsx` with `ManagexLogo.tsx` and `HeroDashboard.tsx` as the only sub-components).
- New CSS classes added in `apps/managex/src/index.css`: `.mx-product__top-strip`, `.mx-product__soon-badge`, `.mx-product__soon-badge-dot`, `.mx-product__microcopy`, `.mx-product__notify-form`, `.mx-product__notify-input`, `.mx-product__notify-btn`, `.mx-product__notify-confirm`, `.mx-visually-hidden`. Per-card brand colour is driven by a CSS custom property `--soon-color` set inline on the card, then consumed by `color-mix()` in the supporting classes.
- Card surface: light (`background: var(--light)`) to match the adjacent SIGN.ai card in the same 3×2 grid row. The Products section background is `var(--light-2)` — using dark cards would have clashed with the unchanged SIGN card.
- Font fix: `.mx-product__notify-btn` explicitly sets `font-family: var(--f-body)`. Browsers do NOT inherit `font-family` into `<button>` or `<input>` elements — without an explicit declaration they fall back to the platform default UI font.

### Hard rules — never violate
1. The "Notify Me" form is local state only. Do NOT wire it to a backend, an email queue, or any persistence layer without a dedicated task in the next sprint. The product team needs to design the waitlist data model, consent surface, and unsubscribe flow first.
2. The SIGN.ai card branch of the products-grid ternary at `App.tsx` is untouched. Never edit the SIGN card to "match" the soon cards — they intentionally use different layouts (SIGN uses `.mx-product--available` with its own `.mx-product__top-border` hover behaviour).
3. Every `<input>` and `<button>` on this page (and elsewhere in MANAGEX) MUST set `font-family` explicitly. See lesson #85.
4. The card surface colour matches the live SIGN.ai card on the same row. Before changing it, audit the section background in the running app — see lesson #86.

---

## Phase 6.3 — Fine Touches (ManageX Landing) (shipped — 2026-05-23)

A small, contained copy and render cleanup on the MANAGEX landing page. Single file touched: `apps/managex/src/App.tsx`.

### What shipped
- Removed `"/"` visual separators from `WHY_ROWS` (App.tsx lines 139 and 146). Strings `'/ one brain'` and `'/ fewer disputes'` became `'one brain'` and `'fewer disputes'`. The two-line typography already separates the stat from its caption — no replacement glyph needed.
- Replaced the brittle `line.includes('/')` split-and-color branch in the Why visual renderer with an index-based renderer: the **last item** in each `WHY_ROWS[i].visual` array renders in `var(--mx-cyan)`, every other item uses the default text colour. The dead `line.includes('.')` else branch was removed at the same time — `visual` strings never contained `.`. See lesson #87.
- One tone fix: lifecycle section body changed from "MANAGEX is the first platform **intelligent enough to treat it that way**" to "MANAGEX is the first platform **built to treat it that way**". Removes hedgy phrasing where the rest of the page is direct. No meaning change.
- Mission statement section (lines 582–597) deliberately **untouched** — deferred to the next sprint.

### Files changed
- `apps/managex/src/App.tsx` only. `index.css` was NOT touched in this phase.

### Hard rules — never violate
1. The Why-section visual renderer is now keyed off array index, not string content. If a row's `visual` array is ever changed, the last item is always the cyan-coloured line — that contract drives both the data and the renderer. Do not reintroduce content-based parsing.
2. Do not edit the mission section (`<section id="mission">`) without an explicit task in the active sprint — the copy is being rewritten as its own work item.

---

## Custom Slash Commands

Custom slash commands live in `.claude/commands/*.md`. Each file becomes a `/filename` command available in any Claude Code session opened in this repo.

### Available Commands

| Command | File | What it does |
|---------|------|--------------|
| `/review` | `.claude/commands/review.md` | Structured pre-PR checklist: git diff, 5 security vectors, Phase 3.2 artifacts, console.log sweep, TODO sweep, backend tests, PASS/FAIL report |

### Claude Code Extensibility Model
There are exactly four ways to extend Claude Code. There is **no `/plugin` command and no plugin registry**.

| Mechanism | How to use |
|-----------|-----------|
| Custom commands | Add `.md` files to `.claude/commands/` — invoked as `/filename` |
| MCP servers | `claude mcp add <name> <command>` or edit `.claude/settings.json` under `"mcpServers"` |
| Hooks | Edit `.claude/settings.json` under `"hooks"` — fire on tool events |
| Skills | Add to `.claude/skills/` — more structured than commands, can have parameters |

### Hard Rules — Never Violate
- **Never assume a Claude Code command exists** without running `claude --help` or checking the [Anthropic Claude Code docs](https://docs.anthropic.com/en/docs/claude-code) first
- If a command is suggested (by a human or AI) and it's not in `claude --help`, it doesn't exist — do not attempt it
- Custom commands are committed to the repo so all team members get them automatically on pull

---
## Phase 6.4 — Mobile Responsive Design (shipped — 2026-05-23)

End-to-end mobile responsiveness for the SIGN app shell, every data table across the platform, and the MANAGEX landing nav. Desktop (≥ 768 px) is visually unchanged across every page. The breakpoint boundary is the Tailwind default `md:` (768 px).

### Step 1 — AppLayout Mobile Shell
Covers all `/app/*` (Client Portal) and `/contractor/*` (Guest Portal) pages — both routes use `AppLayout` with different `navItems` arrays.

- **`AppLayout.tsx`** — added `mobileOpen` state, an overlay backdrop (`fixed inset-0 z-30 bg-black/50 md:hidden`), a `useLocation`-based effect that auto-closes the drawer on route change, and a responsive `<main>` margin: `ml-0 md:ltr:ml-[240px] md:rtl:mr-[240px]` when expanded, `ml-0 md:ltr:ml-[68px] md:rtl:mr-[68px]` when collapsed.
- **`Sidebar.tsx`** — transform-based off-canvas drawer. Closed: `ltr:-translate-x-full rtl:translate-x-full`. Open: `translate-x-0`. Desktop override: `md:ltr:translate-x-0 md:rtl:translate-x-0`. Added `transition-all duration-300 ease-in-out` for the slide. New 44 × 44 px close button (`md:hidden`) at the start edge inside the drawer.
- **`TopBar.tsx`** — header position changed from `ltr:left-[240px] rtl:right-[240px]` to base `left-0 right-0` (full-width mobile) plus `md:ltr:left-[240px] md:rtl:right-[240px]` (desktop offset). 44 × 44 px hamburger button (`md:hidden`) as the first child of the left group; search input wrapped in `hidden md:block`.

**Bug found and fixed (Tailwind variant ordering).** `md:translate-x-0` sorted *before* `ltr:-translate-x-full` in the generated stylesheet, so the single-`ltr:` variant won at desktop and the sidebar stayed off-canvas. Fix: use compound variants `md:ltr:translate-x-0 md:rtl:translate-x-0` — Tailwind orders compound variants after single-variant `ltr:`/`rtl:`. See Lesson 91.

**Bug found and fixed (RTL header right edge).** The original `ltr:right-0 rtl:left-0` pattern only set the far edge per direction; switching the base to `left-0` alone left RTL mobile with an unbound right edge, pushing the hamburger off-screen. Fix: base is now `left-0 right-0` (header full-width by default) and the `md:` overrides narrow it on desktop.

**Side-fix.** `ProfilePage.tsx` had a pre-existing import bug (`import { meService }` from a default-export module) that broke the Vite dev server. Fixed inline (`import meService`) so visual verification of Phase 6.4 could proceed.

### Step 2 — AdminLayout Mobile Shell
Covers all `/admin/*` pages. `AdminLayout` is independent from `AppLayout` — it ships its own inline 64 px icon rail, not the shared `Sidebar.tsx` component.

- **AdminLayout is LTR-only by design.** Searching the file returns zero `ltr:`/`rtl:` variants — every position is direction-agnostic. The compound-variant workaround from Step 1 is **not** needed; plain `md:translate-x-0` correctly overrides `-translate-x-full` at desktop (responsive variants sort after unprefixed utilities). See Lesson 92.
- Added `mobileOpen` state + extended the existing route-change `useEffect` to also call `setMobileOpen(false)`.
- Added a hamburger button as the first child of the top utility bar's left group (`md:hidden`, 44 × 44 px, inline SVG matching the file's existing icon pattern).
- Added the overlay backdrop immediately before the inline `<aside>`.
- Updated the inline `<aside>` className: `${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0` plus `transition-transform duration-300 ease-in-out`.
- Added a × close button as the first child of the `<aside>` (centered, `md:hidden`, 44 × 44 px).
- Replaced the hard-coded `style={{ marginLeft: 64 }}` on `<main>` with `className="flex-1 ml-0 md:ml-16"` (kept `minHeight: 'calc(100vh - 48px)'` in the inline style).

### Step 3A — Table Overflow Wrappers
Every HTML `<table>` across the platform now sits inside `<div className="overflow-x-auto w-full">` with `min-w-full` on the table className. Without this, every admin and several app tables forced the entire page to scroll horizontally on mobile.

- **21 tables across 20 files** in scope.
- **16 files modified** (9 needed both wrapper + `min-w-full`; 4 already had a wrapper and only needed `min-w-full`; 3 already had `min-w-full` and only needed a wrapper).
- **4 files skipped** as already complete (5 tables): `AdminOrganizationsPage`, `AdminOperationsReviewPage`, `AdminBillingPage` (×2 tables), `LegalContent`.
- Tables already inside `overflow-hidden` rounded-card parents had the new `overflow-x-auto w-full` div inserted **between** them so the rounded corners and borders are preserved while the table scrolls inside.

### Step 3D — ManageX Landing Mobile Fixes
- Added `mobileNavOpen` state to the `App` component.
- Added a hamburger button (44 × 44 px, inline SVG) as the last child of `.mx-nav__cta` (`display: none` on desktop, `display: inline-flex` inside the existing `@media (max-width: 768px)` block).
- Added a right-anchored mobile drawer (`width: min(280px, 75vw)`) rendered after `</nav>`. Drawer contains all 4 nav links (Platform / Products / Company / Research) + Sign in + Get started. Closes on overlay tap, × button tap, and any nav link tap. Uses `data-open` toggling so the CSS transition can animate in both directions (drawer is always in the DOM, hidden via `display: none` outside the media query).
- Overlay: `position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 998`, transitions opacity 0 → 1.
- Drawer: `z-index: 999`, `transform: translateX(100%) → translateX(0)`, `transition: transform 0.3s ease`.
- Hero `h1` clamp minimum lowered from 52 px to 36 px (`clamp(36px, 8vw, 88px)`). Desktop unchanged — 8vw becomes the dominant value at ≥ 450 px and caps at 88 px.
- New CSS classes follow the `.mx-` BEM convention: `.mx-nav__hamburger`, `.mx-nav__drawer-overlay`, `.mx-nav__drawer`, `.mx-nav__drawer-close`, `.mx-nav__drawer-nav`, `.mx-nav__drawer-link`, `.mx-nav__drawer-actions`, `.mx-nav__drawer-btn`.
- **Note (prompt-vs-code drift):** the implementation prompt stated Get Started was hidden on mobile; the actual CSS only hides Sign in (`.mx-btn--ghost-d`). Get Started stays visible on mobile alongside the hamburger — the stronger primary-CTA pattern. See Lesson 93.

### Hard rules from Phase 6.4 — never violate
1. The layout shell is the mobile blocker. Fix `AppLayout` / `AdminLayout` before any page-level mobile work. A page with perfect responsive grid classes is still broken if the sidebar lock leaves only ~135 px of usable width on a 375 px screen. See Lesson 89.
2. Always use compound variants `md:ltr:` / `md:rtl:` when combining responsive and directional overrides. Plain `ltr:-translate-x-full` will be overridden by `md:translate-x-0` because of Tailwind's stylesheet sort order. See Lesson 91.
3. `AdminLayout.tsx` is LTR-only and intentionally has no `ltr:`/`rtl:` variants. Do not add them without a deliberate RTL plan that covers the inline rail's position math.
4. Every HTML `<table>` must sit inside an `overflow-x-auto w-full` wrapper and carry `min-w-full`. A standalone `<table>` anywhere in the codebase is a regression.
5. The 768 px boundary is the canonical mobile/desktop breakpoint across every layer. Do not introduce intermediate breakpoints without a team agreement — the global CSS in `apps/sign/src/styles/index.css` and the `@media` block in `apps/managex/src/index.css` both use 768 px as the sole flip.
6. 44 × 44 px is the minimum tap target for hamburger / close buttons (WCAG / iOS HIG). Smaller hit areas fail usability and accessibility audits.

### Outstanding mobile work deferred to next sprint
- **`ContractDetailPage.tsx`** — 2,308-line desktop-only layout with zero responsive classes. Requires design work, not a class sweep.
- **`ClauseReviewPage.tsx`** — hard 55/45 horizontal split (`w-[55%]` / `w-[45%]`). Needs a mobile redesign as a tab switcher or vertical stack.
- **Modal max-width standardization** — most modals use fixed `max-w-2xl` / `max-w-3xl` without a `w-full max-w-[calc(100vw-2rem)]` guard. Spec needed before a sweep.

---

## Team Coordination Rules (Learned May 2026)

These rules were extracted from a painful multi-day coordination exercise involving the Phase 3.2 security work, the MANAGEX rebrand, and the legal layer — three branches that had to be cleanly rebased onto each other before merging.

### "Done" Definition
Work is NEVER done until it is on main with green CI. A pushed branch is work in progress. Never tell a teammate "it's done" until the PR is merged and CI has passed.

| State | Meaning |
|-------|---------|
| "I pushed the branch" | Work in progress |
| "PR is open" | Work in progress |
| "PR merged to main + CI green" | **Done** |

### Pre-PR Checklist (MANDATORY before opening any PR)
Run these commands before creating any PR:

1. Fetch latest main:
   `git fetch origin`

2. Check if you're behind:
   `git log HEAD..origin/main --oneline`
   (If ANY output appears → rebase before PR)

3. Rebase if needed:
   `git rebase origin/main`

4. Resolve conflicts — keep BOTH sides for CLAUDE.md / lessons.md

5. Verify Phase 3.2 artifacts survived (all 5 must pass):
   ```
   ls backend/src/common/utils/sanitize.ts
   grep "sanitize-html" backend/package.json
   grep "@MaxLength" backend/src/modules/clauses/dto/create-clause.dto.ts
   grep "@Transform" backend/src/modules/clauses/dto/create-clause.dto.ts
   grep "is_internal_note" backend/src/modules/support/support.service.ts
   ```

6. Run all tests locally before pushing
   Optional: run `/review` for a structured security + artifact checklist before opening the PR

7. Force-push with lease:
   `git push --force-with-lease origin <branch>`

8. Create PR and wait for green CI before merging

**Rule:** Never open a PR from a branch that is behind `origin/main`.

### Rebrand Sweep Rule
Any rename (brand, package, URL, service name) must end with a NEGATIVE-filter grep sweep:

```bash
grep -rni "OLD_NAME" . \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=dist \
  --exclude-dir=build \
  --exclude-dir=coverage \
  --exclude="*.lock" \
  --exclude="*.log"
```

Never use `--include` for a final sweep. Files with no extension (Dockerfile), `.xml`, and `.md` active instructions will always be missed by positive-filter greps.

### gitignored Files After a Rename
After any rename touching service names or config:
- Manually check `docker-compose.override.yml` (gitignored — won't appear in any automated check)
- Update it to match new service names
- The file is local-only but WILL break `docker-compose up` if stale

### gh CLI Authentication
The gh CLI requires the `workflow` scope to push changes to `.github/workflows/` files. Default login scopes exclude it.

Always authenticate with:
```
gh auth login --scopes "repo,workflow,read:org,gist" --web
```

Verify before any push touching CI files:
```
gh auth status | grep "Token scopes"
```
Must show: `workflow`

### Feature Branch Lifetime Rule
Open a DRAFT PR the same day you start a branch. Mark it "Ready for review" when complete. Merge within 24–48 hours of creation. The rebase cost grows non-linearly — a branch 10 days old can take 10× longer to rebase than a branch 1 day old.

---

## Phase 6.8 — /review Custom Slash Command (shipped — 2026-05-24)

Created the first custom slash command for the SIGN repo. Closes out the Claude Code extensibility exploration (Phase 6.7 attempted `/plugin install` which does not exist — see lesson #88).

### What shipped
- New file: `.claude/commands/review.md` (commit `01fd9f4`)
- Invoked as `/review` in any Claude Code session in this repo
- 8-step checklist:
  1. `git diff main --stat` — files changed summary
  2. `git diff main` — full diff
  3. Security scan: passwords/secrets, ILIKE without `escapeLikeParam`, raw `@Body()`, file uploads without limits, `dangerouslySetInnerHTML`
  4. Phase 3.2 artifact verification (all 5 mandatory checks)
  5. `console.log` / `debugger` sweep
  6. TODO / FIXME / HACK sweep
  7. `npm test --prefix backend` — full test suite
  8. Structured PASS / FAIL report per check

### Phase 6.7 — No Work Needed
Phase 6.7 was originally noted as "Frontend Design plugin install". This was based on a false assumption that Claude Code has a plugin registry. It does not. Frontend design awareness is already available natively through Claude Code's built-in multimodal capabilities and MCP servers — no install required.

### Hard rules added
- See Custom Slash Commands section above
- Never attempt `/plugin install` — the command does not exist

---

## Phase 6.9 — Waitlist Email Capture & Admin Export (shipped — 2026-05-27)

Full-stack implementation wiring the "Notify Me" inputs on the 5 MANAGEX Coming Soon product cards (VENDRIX, SPANTEC, CLAIMX, GUARDIA, DOXEN) to a real backend, with a SIGN admin export page. PR #33.

### What shipped

**Backend (new module `backend/src/modules/waitlist/`):**
- Migration `1749000000001-CreateProductWaitlist.ts` — `product_waitlist` table: UUID PK, email VARCHAR(255), product_name VARCHAR(50), created_at TIMESTAMPTZ. Named unique constraint `uq_product_waitlist_email_product(email, product_name)`. Two indexes: `idx_product_waitlist_product_name`, `idx_product_waitlist_created_at`. `CREATE TABLE IF NOT EXISTS` — no `EXCEPTION WHEN` blocks (per lessons #31, #103).
- `ProductWaitlist` entity with `@Entity('product_waitlist')`, `@PrimaryGeneratedColumn('uuid')`, `@Column`, `@CreateDateColumn`.
- `CreateWaitlistEntryDto` — `@IsEmail @MaxLength(255)` on email, `@IsIn(WAITLIST_PRODUCTS)` on product_name. `WAITLIST_PRODUCTS = ['VENDRIX','SPANTEC','CLAIMX','GUARDIA','DOXEN'] as const`.
- `WaitlistService.create()` — saves entry; on PostgreSQL error code `'23505'` (duplicate key) returns `{ success: true }` silently (no 409 — enumeration risk). `WaitlistService.findAll(productName?)` — optional `WHERE product_name =` filter, ordered by `created_at DESC`.
- `WaitlistController`:
  - `POST /waitlist` — unauthenticated, `@ThrottleOnly('waitlist')` (3 req/hr per IP), calls `stripHtml(dto.email)`, returns `{ success: true }`.
  - `GET /admin/waitlist` — `JwtAuthGuard + RolesGuard + @Roles(SYSTEM_ADMIN)`, optional `?product_name` query param.
  - `GET /admin/waitlist/export` — same guards, returns full array for CSV assembly.
- `app.module.ts` — added `{ name: 'waitlist', ttl: 3_600_000, limit: 3 }` to throttlers array + `WaitlistModule` import.
- `throttle-only.decorator.ts` — `'waitlist'` added to `THROTTLER_NAMES`.
- 17 new backend tests (5 service + 12 controller), total backend: 104 tests.

**MANAGEX frontend (`apps/managex/src/App.tsx`):**
- Native `fetch()` — never imports SIGN's `axios.ts` (different app, different process).
- `API_URL = import.meta.env.VITE_API_URL` with `console.warn` in DEV if undefined.
- `NotifyEntry` type extended with `loading: boolean`, `error: string | null`.
- `submitNotify` async — client email regex validation → loading state → `fetch(${API_URL}/waitlist)` → handles 429 ("Too many requests, try again later") / network error / success.
- JSX: disabled input/button during loading, button shows "Sending…", `<p role="alert">` for inline error.
- `apps/managex/.env.example` — `VITE_API_URL=http://localhost:3000/api/v1` with lesson #83 warning.
- `apps/managex/.env` — created locally (gitignored).
- `apps/managex/src/index.css` — `.mx-product__notify-error` style class added.

**SIGN admin portal:**
- `AdminWaitlistPage.tsx` — React Query `['admin', 'waitlist', productFilter]`, product-colour badges (VENDRIX=orange, SPANTEC=sky, CLAIMX=purple, GUARDIA=green, DOXEN=yellow), overflow-x-auto table wrapper, `toCsv()` + `downloadCsv()` helpers, CSV filename `managex-waitlist-YYYYMMDD.csv`, empty state with envelope icon.
- Route: `<Route path="waitlist" element={<AdminWaitlistPage />} />` under `/admin/*` in `App.tsx`.
- Nav item in AdminLayout Group 3 (Insights): `nav.waitlist`, `/admin/waitlist`, mail/envelope icon, `opsHidden: true`.
- `adminService.ts` — `getWaitlist(productName?)` + `exportWaitlist(productName?)` + `WaitlistEntry` type.
- i18n: `nav.waitlist` key added to EN/AR/FR. `admin.waitlist.*` block (title, subtitle, export, exporting, empty, filter.all, columns.*{product,email,signedUp}, total) added to all 3 locales in previous step.

### Hard rules — never violate
1. **Return 200 on duplicate email+product — NEVER 409.** The `POST /waitlist` endpoint is unauthenticated. A 409 would confirm whether an email is already registered, enabling enumeration attacks. The service catches PG error code `'23505'` and returns `{ success: true }` silently.
2. **Use `@ThrottleOnly('waitlist')` — NEVER plain `@Throttle`.** Adding `'waitlist'` to `THROTTLER_NAMES` in `throttle-only.decorator.ts` is mandatory when adding the throttler to `app.module.ts`. Both must stay in lock-step.
3. **Never import SIGN's `axios.ts` from the ManageX app.** They are separate Vite apps with separate processes. Use native `fetch()` in ManageX.
4. **`VITE_API_URL` missing causes silent `"undefined"` in the fetch URL (lesson #83).** Always document it in `.env.example` with a warning comment. The `console.warn` in DEV mode is the runtime guard.
5. **Every DTO field must have a class-validator decorator (lesson #40).** Plain `@Body()` without DTO, or a DTO with undecorated fields, bypasses ValidationPipe entirely.

---

## Phase 7.1 Step 1 — Obligation Tracking Foundation (shipped — 2026-05-24)

Backend-only foundation for the Phase 7.1 Obligation Tracking & Deadline Alerts feature.
No frontend code was touched. No ai-backend code was touched. All existing 33 tests pass.

### What was built

**3 new migrations (all idempotent):**
- `1748000000001-AddContractDateFields.ts` — adds 6 nullable columns to `contracts`:
  `start_date`, `end_date`, `effective_date`, `expiry_date`, `notice_period_days`,
  `defects_liability_period_days`. Uses `ADD COLUMN IF NOT EXISTS`.
- `1748000000002-AddObligationAssigneesAndEscalation.ts` — creates `obligation_assignees`
  join table (UUID PK, obligation_id FK CASCADE, user_id FK CASCADE, assigned_at, assigned_by
  FK SET NULL). UNIQUE index on (obligation_id, user_id). Adds `escalation_contact_user_id`
  UUID FK + `escalation_contact_email` VARCHAR(255) to `contracts`. Uses `DO $$ BEGIN
  IF NOT EXISTS ... END$$` block for the FK constraint (PostgreSQL has no
  `ADD CONSTRAINT IF NOT EXISTS` syntax).
- `1748000000003-AddObligationReminderSchedule.ts` — adds `reminder_schedule INTEGER[]
  NOT NULL DEFAULT ARRAY[30, 14, 7, 1]` to `obligations`.

**New entity:**
- `obligation-assignee.entity.ts` — `@Entity('obligation_assignees')` with ManyToOne→Obligation
  (CASCADE), ManyToOne→User (CASCADE), and ManyToOne→User assigner (SET NULL).

**Entity updates:**
- `obligation.entity.ts` — added `reminder_schedule: number[]` column and `assignees:
  ObligationAssignee[]` OneToMany relation.
- `contract.entity.ts` — added 6 date columns + `escalation_contact_user_id`,
  `escalation_contact_user` ManyToOne, and `escalation_contact_email`.

**DTOs (create + update both updated):**
- `CreateContractDto` / `UpdateContractDto` — 8 new optional fields. Escalation contact
  uses `@ValidateIf((o) => !o.escalation_contact_email)` / `@ValidateIf((o) =>
  !o.escalation_contact_user_id)` for mutual exclusion (provide one or neither, never both).

**5 new endpoints (ComplianceObligationsController):**
- `POST /contracts/:contractId/obligations/:obligationId/assign` — `{ user_id: UUID }`,
  returns 409 if already assigned.
- `DELETE /contracts/:contractId/obligations/:obligationId/assign/:userId` — 204 on success,
  404 if not assigned.
- `PUT /contracts/:contractId/obligations/:obligationId/evidence` — `{ evidence_url: IsUrl }`,
  attaches completion evidence to an obligation.
- `GET /obligations/portfolio` — org-scoped cross-contract portfolio. Optional query filters:
  `from`, `to`, `project_id`, `status`, `type`, `assignee`.
- `GET /obligations/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` — calendar events for date
  range (max 1 year). Returns `{ id, title, start, end, status, contract_id, project_id, color }`.
  Color: PENDING=#4F6EF7, IN_PROGRESS=#F59E0B, OVERDUE=#DC2626, MET/COMPLETED=#059669, WAIVED=#9CA3AF.

**Reminder processor upgrade (obligation-reminder.processor.ts):**
- Relations now load `assignees.user` + `contract.escalation_contact_user`.
- Multi-recipient: sends to all assignees first; falls back to `contract.creator`
  only when no assignees are set.
- Custom `reminder_schedule` per obligation: `scheduledTierFor()` replaces the old
  hardcoded `tierFor()`. Maps day thresholds to nearest standard tier (DAYS_30/14/7/1)
  via `thresholdToTier()`. Falls back to `[30, 14, 7, 1]` if schedule is empty.
- OVERDUE escalation: fires `sendEscalation()` after primary recipients.
  Priority: `escalation_contact_user` (email + in-app) → `escalation_contact_email`
  (email only, no in-app notification possible for external addresses).
- In-app notifications: `dispatch.dispatchObligationReminder()` is called for every
  platform-user recipient immediately after the email is enqueued.
- `weekly-digest` now includes assignee users, not just contract creators.
- Existing email HTML rendering (renderReminder / renderDigest) preserved unchanged.

**NotificationDispatchService — new method:**
- `dispatchObligationReminder({ obligationId, description, userId, tier, contractName })`
  — creates IN_APP notification only (email is handled directly by the processor for
  full template control). Best-effort: never throws, logs errors instead.
  Title examples: "Obligation Overdue", "Obligation Due in 7 Days".

### Hard rules — never violate

1. **Use `obligation_assignees` for recipient lookup** — NEVER read `contract.created_by`
   directly as the obligation owner. Always call `primaryRecipientsFor()` (or equivalent):
   assignees first, fallback to creator. Future obligation endpoints must follow this pattern.

2. **Every reminder tier must create BOTH email AND in-app notification** — do not add
   new reminder paths that send email only. The processor sends email via `enqueueEmail()`,
   then immediately calls `dispatchObligationReminder()`. These two calls must always be
   paired for platform users.

3. **External escalation contacts (email-only) cannot receive in-app notifications** —
   `escalation_contact_email` rows have no `user_id`. Only enqueue email for them. Never
   try to call `notificationsService.create()` with an email address instead of a user UUID.

4. **`reminder_schedule` is the canonical source for tier timing** — never add hardcoded
   day thresholds in processor code. Always pass `o.reminder_schedule` to `scheduledTierFor()`.

5. **The UNIQUE constraint on `(obligation_id, user_id)` in `obligation_assignees` is
   enforced at DB level** — the service also throws `ConflictException` (409) before hitting
   the DB constraint. Both layers must remain in place.

---

## Phase 7.1 Step 2 — Frontend Foundation (shipped — 2026-05-25)

Frontend-only build on top of the Step 1 backend. Adds the new Obligations tab on
the Contract Detail page, upgrades `/app/obligations` from a 278-line placeholder
to a real cross-contract portfolio view, wires the previously-unreachable
`/app/projects/:id/obligations` route into ProjectDetailPage, and closes a pre-existing
CLAUDE.md `dir="auto"` hard-rule violation. Zero backend changes, zero new npm
packages, zero layout-shell modifications.

### What shipped
- **`components/obligations/` — 9 new reusable primitives.** Single source for status
  palette, days-remaining traffic light, KPI bucketing, badges, filter bar, card,
  empty/loading/error states. `statusUtils.ts` exports `effectiveStatus()`
  (PENDING + past-due → OVERDUE in the UI before the reminder job flips it),
  `daysTone()` (green ≥14d, amber 1-13d, red ≤0d), `tierKey()`, `computeKpis()`,
  `OBLIGATION_TYPES`, `OBLIGATION_STATUSES`. Every obligation surface in SIGN
  composes from these — no more per-page `statusConfig` objects.
- **`components/contracts/ObligationsTab.tsx`.** Composes the primitives for the
  Contract Detail page. React Query `['contract-obligations', contractId]`.
  "Mark as Actioned" → `PATCH /contracts/:id/obligations/:obligationId { status: 'COMPLETED' }`.
  Notifies the parent of count via `onCountChange` so the tab label can show a badge.
- **`ContractDetailPage.tsx` — new "Obligations" tab inserted between Risk Analysis
  and Claims.** Not status-gated (available on DRAFT too). Tab label shows a gray
  count pill when obligations > 0.
- **`ObligationsPage.tsx` upgraded** to the cross-contract portfolio view backed
  by `GET /obligations/portfolio`. Header with View Calendar + Export buttons
  (placeholders; Step 3/4 work). KPI row in portfolio variant
  (Total / Due This Week / Overdue / Actioned). Filter bar with Project, Type,
  Status, Assignee, date range, search. Assignees derived from loaded obligations
  or from project members when a project is selected.
- **`ProjectDetailPage.tsx`.** Added "View Obligations" button next to
  Permissions + Add Contract, navigating to `/app/projects/:id/obligations`.
  Route already existed; UI link was missing.
- **`ProjectObligationsPage.tsx` dir="auto" fix.** Added `dir="auto"` +
  `style={{ unicodeBidi: 'plaintext' }}` to both `<p>` renders of
  `obligation.description`. Pre-existing CLAUDE.md hard-rule violation from
  Phase 3.4 — now closed.
- **Service extensions** — 5 new methods on the existing services (no new files):
  - `obligationService.getPortfolioObligations(filters)` → `GET /obligations/portfolio`
  - `obligationService.getCalendarObligations(from, to)` → `GET /obligations/calendar`
  - `complianceService.assignObligation(contractId, oblId, userId)`
  - `complianceService.unassignObligation(contractId, oblId, userId)`
  - `complianceService.updateEvidence(contractId, oblId, evidenceUrl)`
  - New types: `ObligationPortfolioItem` (extends `ContractObligation` with project + assignees),
    `ObligationAssignee`, `ObligationCalendarEvent`, `PortfolioObligationFilters`.
- **53 new i18n keys × 3 locales (EN/AR/FR) with exact parity.** `obligation.status.*`
  (6 statuses including MET + WAIVED), `obligation.type.*` (12 types),
  `obligation.tier.*` (6 tiers including `overdue` with `{{days}}` interpolation),
  `obligation.actions.*` (5 actions), `obligation.ui.*` (KPI labels, page chrome,
  filter labels, empty/no-matches/error/retry copy). Plus
  `contract.tabs.obligations` and `project.viewObligations`. Construction-law
  translations chosen to match FIDIC conventions in Arabic and French.
- **11 new tests across 2 spec files** (`ObligationsTab.test.tsx` 6 tests,
  `ObligationsPage.test.tsx` 5 tests). Full suite: 4 files / 19 tests, 1.3 s.

### What's deferred (do NOT rebuild before reading this)
- **Plan gating (Starter vs Professional/Enterprise) was deferred entirely.**
  There is no plan-tier enum in the codebase — `OrganizationSubscription.plan.name`
  is an admin-editable string, not a canonical tier identifier. Hard-coding a
  `plan.name === 'Starter'` match would silently break the moment an admin
  renames a plan. The portfolio view is shown to everyone for now; gating
  belongs in its own task once the plan-tier model is designed (likely a
  `plan.features.portfolio_view` jsonb flag plus a small backend seed update).
  See lesson #97.
- **Pagination not implemented.** Matches the existing `ProjectObligationsPage`
  pattern — return all, render all. Backend `GET /obligations/portfolio` returns
  a plain array. If a single org accumulates 1000+ obligations we add
  server-side pagination then; until that's real data pressure the simplicity
  is the right trade.
- **Add / Assign / Edit / View Details action menus are no-op placeholders**
  that log to console — modals come in Phase 7.1 Step 3, single-obligation
  detail page in Step 4.

### Hard rules — never violate

1. **Every obligation surface must compose from `components/obligations/` primitives.**
   No more per-page `statusConfig` objects, no more per-page `daysUntil()` helpers,
   no more per-page badge JSX. If you need a new colour bucket or a new tier, add
   it to `statusUtils.ts` and consume from there. Drift = the four obligation
   surfaces (ObligationsTab, ObligationsPage, ProjectObligationsPage, future
   calendar view) drifting out of sync — which is exactly what we just collapsed.
2. **`dir="auto"` + `style={{ unicodeBidi: 'plaintext' }}` on every render of
   `obligation.description` and `obligation.timeframe_description`.** Both can
   contain Arabic. `ObligationCard.tsx` is the canonical example — when adding
   a new surface that renders these fields, copy the attribute pair verbatim.
   `ObligationsTab.test.tsx` asserts on this; failing the test = the build
   should fail in CI.
3. **Any new obligation i18n key MUST land in all three locales (EN/AR/FR) in
   the same commit.** Step 2 added 53 new keys with exact parity. Construction-
   specific terms (PERFORMANCE_BOND, DEFECTS_LIABILITY, etc.) use established
   FIDIC translations — do not paraphrase. Pre-existing parity gaps elsewhere
   (`nav.system`, `portal.*`, `userType.*` missing from AR; `language.fr` extra
   in FR) are out of scope for obligation work.
4. **Use the canonical PATCH endpoint, NOT the legacy PUT, for marking actioned.**
   `complianceService.updateObligation(contractId, oblId, { status: 'COMPLETED' })`
   is the way. The legacy `obligationService.complete(id)` path is left in place
   for backward compatibility but the contract-scoped PATCH is what new code
   should call. (See the audit note about endpoint duplication — a future cleanup.)
5. **The Obligations tab on Contract Detail is NOT status-gated.** Unlike Claims /
   Notices / Sub-Contracts, obligations exist from DRAFT onward. Do not add an
   `activeOnly: true` flag to its tab config.
6. **Service split rule.** Contract-scoped endpoints
   (`/contracts/:id/obligations/:obligationId/...`) live on `complianceService`
   next to the existing obligation reads. Org-scoped portfolio + calendar
   endpoints (`/obligations/portfolio`, `/obligations/calendar`) live on
   `obligationService` next to the existing org-scoped reads. Don't move them.
7. **No backend code in any frontend-only Phase 7.1 step.** Step 2 added no
   backend code; Step 3 (modals + calendar UI) and Step 4 (real-time + remaining
   fixes) should also stay frontend-only. Backend work happens in Step 1
   (already shipped) and any follow-up backend phases.


---

## Phase 7.1 Step 3 — Interactive Obligation UI (shipped — 2026-05-25)

Built the four modals + one drawer + one calendar page that turn Step 2's
read-mostly obligation surfaces into a usable workflow. Replaces every
console.info placeholder from Step 2. PR #25 (stacked on top of Step 2's
PR #24). Frontend-only — no backend changes.

### What shipped

**6 new components under `apps/sign/src/components/obligations/`:**

- **`ModalShell.tsx`** — shared centered-card modal shell. Backdrop, body-
  scroll lock, Escape-to-close, click-outside-to-close, sticky header
  (title + subtitle + ×), scrollable body, optional sticky footer slot.
  Sizes: `sm` / `md` / `lg` / `xl`. Every obligation modal renders inside
  this shell — single source for the modal pattern.
- **`AddEditObligationModal.tsx`** — create + edit forms. Same component
  used in both modes (presence of `obligation` prop = edit). 11 fields
  total: description (with `dir="auto"`), type, clause ref, due date,
  frequency, responsible party, amount, currency, reminder schedule
  (4 checkboxes default `[30, 14, 7, 1]`), critical toggle. Conditional:
  Amount + Currency only render for `PAYMENT | PERFORMANCE_BOND | INSURANCE`
  types. Validation: required description, due date in the future for
  create mode, amount ↔ currency mutual requirement. Submits via
  `obligationService.create` (create) or `complianceService.updateObligation`
  (edit).
- **`MarkActionedModal.tsx`** — status select (MET default / COMPLETED /
  WAIVED w/ required reason), actioned-date (defaults to today, can't be
  future), notes textarea, **protective evidence message** verbatim,
  evidence URL input. **No file picker** — Step 3 decision (backend has
  no generic file upload endpoint; see lesson #101). Submit chains:
  if evidence URL present → `complianceService.updateEvidence` first,
  then `complianceService.updateObligation` for the status patch.
- **`AssignUserModal.tsx`** — chip-based current assignees + searchable
  team-member picker. Assign and unassign as separate mutations (Step 1
  backend exposes them as individual operations). 409 Conflict surfaces
  as inline toast.
- **`ObligationActionMenu.tsx`** — three-dot dropdown. Items: View Details,
  Mark Actioned (conditional on effective status), Edit, Assign. Click-
  outside + Escape close. **Delete intentionally deferred** — no per-role
  permission model exists; documented in CLAUDE.md "what's deferred" and
  lesson #102.
- **`ObligationDetailDrawer.tsx`** — right-anchored slide-in drawer with
  overlay backdrop. Six sections: Description / Key Details / Assignees /
  Evidence / Reminder History (deferred placeholder — see below) / Activity
  Timeline. Sticky header (badges + ×) and footer (Edit + Mark Actioned).
  Mobile responsive (full-width below `sm`). "View Clause" back-link
  navigates to `/app/contracts/:id#clause-:id` and closes drawer.

**1 new page:**
- **`apps/sign/src/pages/app/ObligationsCalendarPage.tsx`** at route
  `/app/obligations/calendar`. Uses `react-big-calendar` with a date-fns
  localizer (en-US / ar / fr based on current `i18n.language`). Month /
  Week / Day views via RBC's built-in toolbar. Events colour-coded by
  status:
  - `PENDING` → `#F59E0B` amber
  - `IN_PROGRESS` → `#3B82F6` blue
  - `COMPLETED` / `MET` → `#10B981` emerald
  - `OVERDUE` → `#EF4444` red
  - `WAIVED` → `#6B7280` gray

  Filter bar: Project / Type / Status. Clicking an event opens the same
  `ObligationDetailDrawer` used elsewhere. Drawer footer routes to the
  same modal stack.

**Page wiring:**
- `ObligationsTab.tsx` — Step 2 placeholder handlers replaced with real
  modal state. The legacy inline "Mark as Actioned" mutation retired
  (modal owns the patch now).
- `ObligationsPage.tsx` — same modal pattern, no Add modal (creation
  always scoped to a contract). "View Calendar" button now reaches
  the working calendar route.

**Backend type extension:** `complianceService.ts` `ContractObligation`
gained `contract_clause_id` and `evidence_url` fields. Both already exist
on the backend Obligation entity (per Step 1 audit) but were missing from
the frontend type, blocking the drawer from compiling.

### One new npm package
- `react-big-calendar ^1.19.4` + `@types/react-big-calendar ^1.16.3`.
  Chosen because no calendar primitive existed and the prompt's
  hard-rule list permitted exactly this one package. Hoisted to workspace
  root per existing npm workspace pattern.

### Decisions documented (asked & answered before implementation)

| Question | Answer |
|---|---|
| Branch base | Stacked on `feat/phase-7.1-step-2-frontend` (PR #24 still open) |
| Evidence input | URL input + protective message (no file picker — no backend endpoint) |
| Delete action | Hidden entirely until a per-role permission model exists |
| View Clause back-link | Navigate to `/app/contracts/:id#clause-:id`; close drawer |

### What's deferred — DO NOT rebuild before reading these
- **Direct file upload for evidence.** Backend has no generic upload
  endpoint. Adding one is a Step 4+ backend task. Until then, the URL
  input is the documented path.
- **Reminder history.** The drawer's Section 5 shows a placeholder. The
  backend endpoint `GET /contracts/:id/obligations/:oblId/reminders`
  does not exist yet — adding it is a Step 4+ backend task.
- **Per-role Delete-obligation permission model.** Backend has DELETE
  with JWT-only gating; UI Delete deferred until the model is designed.
- **View Clause auto-tab-switch.** Native hash scroll works when the
  Clauses tab is the default (which it is). Adding a hash listener to
  `ContractDetailPage` to switch tabs on `#clause-*` is a Step 4+
  enhancement — out of Step 3's allowed-edit list.
- **Assignee filter on the calendar.** The calendar payload from Step 1
  doesn't include assignee data per event — would require either a richer
  endpoint or post-fetch hydration. Step 4 work.
- **Excel export.** Button still a placeholder. Backend has no CSV/XLSX
  obligation export endpoint.

### Hard rules — never violate

1. **Modal pattern must use `ModalShell`.** Every new obligation modal
   composes from `ModalShell` — single source for the centered-card
   pattern. Don't reinvent the overlay/backdrop/Escape/scroll-lock
   logic per modal.
2. **`dir="auto"` + `unicodeBidi: 'plaintext'` on every obligation
   description render in modals AND in the drawer.** Description appears
   in: AddEdit modal textarea, MarkActioned modal subtitle, Assign modal
   subtitle, Drawer description section, Drawer assignee row metadata,
   ObligationCard. All eight sites carry the attribute pair.
3. **Two-step evidence flow is the canonical pattern.** When evidence URL
   is provided, call `updateEvidence` BEFORE `updateObligation` so a
   URL-validation 400 doesn't leave the obligation in
   MET-without-evidence state. Both calls happen inside the same
   `mutationFn` so React Query treats them as one transaction.
4. **Calendar events always open the detail drawer — never navigate
   away.** Clicking an event must NOT change route; it sets drawer state.
   Keeps interaction consistent with the rest of the obligation UI.
5. **Mobile drawer is full-width (`w-full sm:w-[480px]`).** Don't add
   a fixed `w-[480px]` without the `sm:` breakpoint — that breaks below
   480 px viewport widths.
6. **`react-big-calendar` Calendar component must be wrapped in a
   responsive container with explicit `height: '70vh', minHeight: 500`.**
   RBC measures its own DOM and needs a parent with deterministic height.

---

## Phase 7.1 Step 4 — Notification Freshness via React Query Polling (shipped — 2026-05-25)

Frontend-only data-layer surgery on the notification surfaces. Replaces
three `useState + useEffect` fetches that were silently stale for the
lifetime of a session with React Query polling that keeps the bell badge
and NotificationsPage automatically fresh.

### What shipped

**Three queries on a shared key prefix.** All three notification queries
live under the `['notifications', …]` namespace:

| Consumer | queryKey | refetchInterval |
|---|---|---|
| `TopBar.tsx` bell badge | `['notifications', 'unread-count']` | 30 s |
| `AdminLayout.tsx` bell badge | `['notifications', 'unread-count']` | 30 s |
| `NotificationsPage.tsx` list | `['notifications', filter]` | 30 s |

Both bell badges read from the EXACT same cache entry, so when one
mutates the count, the other refreshes instantly via the same
invalidation. No Redux, no event bus, no cross-component messaging.

**Tab-visibility-aware polling.** Every query carries
`refetchIntervalInBackground: false`. When the browser tab is hidden,
React Query pauses the poll. When focus returns, polling resumes
immediately. Backend request rate scales with focused tabs, not open
tabs.

**Cache invalidation via the shared prefix.** NotificationsPage's
mark-as-read, mark-all-as-read, and delete mutations all call
`queryClient.invalidateQueries({ queryKey: ['notifications'] })`. This
prefix matches BOTH the list query and the unread-count queries — the
badge in TopBar/AdminLayout updates instantly without waiting for the
30s poll cycle.

### Hard rules — never violate

1. **Any new notification surface MUST use the `['notifications', …]`
   queryKey prefix.** The shared cache pattern only works as long as
   every consumer joins the same namespace. Inventing a new top-level
   key (e.g. `['unreadBell']`) breaks the cross-component coherence.
2. **`refetchInterval` MUST be paired with `refetchIntervalInBackground:
   false`** on any new polling query. Polling without the visibility
   guard amplifies backend load with every open-but-unfocused tab. The
   30s cadence is canonical across the codebase — match it unless you
   have a documented reason.
3. **Mutations that touch notifications MUST invalidate the
   `['notifications']` prefix.** Don't invalidate only the specific
   sub-key — the prefix invalidation is what keeps the bell badge in
   sync with the list.
4. **Never reintroduce `useState + useEffect` for periodically-changing
   server data.** That pattern fetches once on mount and goes silently
   stale. Use React Query with `refetchInterval` instead. See lesson
   #105.

### Phase 7.10 — confirmed already implemented (2026-05-27)

The Phase 7.10 gap described at the time Step 4 was written was confirmed
**already implemented** during a codebase investigation on 2026-05-27.
`ObligationReminderProcessor` calls `this.dispatch.dispatchObligationReminder()`
in two places (primary recipients loop + escalation user path), and
`NotificationDispatchService.dispatchObligationReminder()` already exists and
creates `NotificationType.IN_APP` rows in the `notifications` table.
Module DI wiring (`ObligationsModule` imports `NotificationsModule` which exports
`NotificationDispatchService`) was also already in place. Two dedicated tests
in `obligation-reminder.processor.spec.ts` assert the call is made with the
correct parameters. No code changes were needed — 7.10 can be treated as resolved.

---

## Phase 7.2-7.4 — Bug Fixes & Backend Enhancements (shipped — 2026-05-25)

Three backend fixes shipped as PRs #26, #27, #29. No frontend changes
in this batch — Youssef wires the drawer integration separately.

### Phase 7.2 — Route Shadowing Fix (PR #26)

**Problem:** `GET /obligations/portfolio` and `GET /obligations/calendar`
returned `400 Validation failed (uuid is expected)` instead of reaching
their handlers in `ComplianceObligationsController`.

**Root cause:** NestJS registers routes in module-import order. Static-
before-dynamic sorting only applies *within* one controller, not across
controllers from different modules. `ObligationsModule` is imported at
line 190 of `app.module.ts`; `ComplianceModule` at line 218. So
`ObligationsController`'s `@Get(':id')` was registered first and
matched `portfolio`/`calendar` before the correct handlers were reached.
`ParseUUIDPipe` then rejected the non-UUID segment.

**Fix:** UUID regex constraint on all 4 legacy `:id` routes in
`backend/src/modules/obligations/obligations.controller.ts`:
```typescript
@Get(':id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
```

**Hard rule:** Any dynamic `:id` route that coexists with static routes
in *other* controllers sharing the same prefix MUST use a UUID regex
constraint. `ParseUUIDPipe` alone is not enough — it runs after route
matching, not during.

---

### Phase 7.3 — Obligation Status Enum Fix (PR #27)

**Problem:** `MET` and `WAIVED` were permanently absent from the
`obligation_status` PostgreSQL enum on every environment. Mark-as-met
and waived endpoints would throw at runtime.

**Root cause:** Migration `1718000000002-AddComplianceMonitoring.ts`
referenced `obligations_status_enum` (wrong — plural + `_enum` suffix)
instead of `obligation_status` (correct). A `DO $$ BEGIN … EXCEPTION
WHEN undefined_object THEN null; END $$` block silently swallowed the
error. The migrations table showed success; the work was never done.
Same anti-pattern as lesson #31.

**Three-part fix:**
1. `1718000000002` corrected for fresh rebuilds — uses `ALTER TYPE
   obligation_status ADD VALUE IF NOT EXISTS` with no catch block.
2. New corrective migration `1748000000004` — adds MET + WAIVED with
   `IF NOT EXISTS`, safe on patched and unpatched DBs alike. Sets
   `transaction = false` (required — see Hard rule below).
3. New `ObligationSchemaCheckService` (`OnModuleInit`) — queries
   `pg_enum` on startup and throws if any required value is missing.
   Prevents silent recurrence.
4. `data-source.ts`: `migrationsTransactionMode: 'each'` — enables
   per-migration `transaction = false` overrides (default `'all'` mode
   blocks them with `ForbiddenTransactionModeOverrideError`).

**Hard rules:**
- `ALTER TYPE ADD VALUE` requires `transaction = false` on the migration
  class. PostgreSQL < 14 forbids it inside a transaction block;
  good practice on all versions.
- Never use `EXCEPTION WHEN` to swallow migration failures — use
  `IF NOT EXISTS` / `IF EXISTS` instead (idempotent, no silent failure).

---

### Phase 7.4 — Reminders Endpoint (PR #29)

**What shipped:**
- New `GET /contracts/:contractId/obligations/:obligationId/reminders`
- Returns `obligation_reminder_logs` rows ordered by `sent_at DESC`
- Contract ownership check: 404 if obligation doesn't belong to the
  contract in the URL
- Response shape: `{ id, reminder_type, sent_to, sent_at, email_status }`
  — `obligation_id` omitted (redundant from URL)
- Service: `ComplianceObligationService.getReminderLogs()` — injects the
  `ObligationReminderLog` repo already registered in `ComplianceModule`
- 7 new tests (2 service unit + 5 HTTP): 200×2, 401, 404×2
- **Total backend tests: 87** (was 80 before this PR)

**Frontend wiring:** Youssef wires `ObligationDetailDrawer`'s Reminder
History section to this endpoint — tracked as the remaining 7.7
frontend half.

---

## Phase 7.9 — Audit Silent Migrations (shipped — 2026-05-27, PR #34)

Full audit and source-level fix of the `EXCEPTION WHEN` anti-pattern across
all TypeORM migration files. No new migration needed — these are fresh-build
fixes only; existing environments were already corrected by Phase 7.3 (PR #27).

**25 instances patched across 5 files:**

| File | Instances | Type |
|------|-----------|------|
| `1710000000000-InitialSchema.ts` | 9 | CREATE TYPE blocks |
| `1710000000001-RenameContractorsToProjectParties.ts` | 1 | CREATE TYPE block |
| `1713000000001-AddContractApprovers.ts` | 1 | CREATE TYPE block |
| `1716000000001-CreateNegotiationEvents.ts` | 2 | CREATE TYPE blocks |
| `1718000000002-AddComplianceMonitoring.ts` | 10 + 2 | CREATE TYPE + ADD CONSTRAINT blocks |

**Pattern replaced:**
```sql
-- BEFORE (dangerous — swallows all errors silently):
DO $$ BEGIN
  CREATE TYPE foo_enum AS ENUM ('A', 'B');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AFTER (idempotent, transparent on failure):
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'foo_enum') THEN
    CREATE TYPE foo_enum AS ENUM ('A', 'B');
  END IF;
END $$;
```

**For ADD CONSTRAINT blocks:**
```sql
-- BEFORE:
DO $$ BEGIN
  ALTER TABLE t ADD CONSTRAINT fk_name FOREIGN KEY ...;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AFTER:
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_name') THEN
    ALTER TABLE t ADD CONSTRAINT fk_name FOREIGN KEY ...;
  END IF;
END $$;
```

**Why `EXCEPTION WHEN` is dangerous:** Developers copy the pattern and change
the exception type to `undefined_object` for `ALTER TYPE` statements — which
silently swallows wrong type names. This was the exact root cause of the
Phase 7.3 incident where `MET` and `WAIVED` were absent from `obligation_status`
for months. See lessons #31, #103, and #111.

**Hard rule — never violate:**
- Never write `EXCEPTION WHEN ... THEN null` in any migration block.
- For CREATE TYPE: use `IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '...')`.
- For ADD CONSTRAINT: use `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '...')`.
- Note: PostgreSQL has no `CREATE TYPE IF NOT EXISTS` or `ADD CONSTRAINT IF NOT EXISTS` syntax
  — the `DO $$ ... IF NOT EXISTS ... END $$` block is the only correct approach.

---

## Phase 9.1 — Abstract Infrastructure Layers (shipped — 2026-05-28)

Three sub-tasks shipped together as one PR. Zero behaviour change — all defaults unchanged,
no new env vars required for existing deployments, no Docker rebuild needed for local dev.

### Phase 9.1a — StorageService abstraction (NestJS backend)

**What shipped:**
- New interface `IStorageAdapter` + DI symbol `STORAGE_ADAPTER` at
  `backend/src/modules/storage/interfaces/storage-adapter.interface.ts`.
  Single `upload()` method returns `StorageResult { file_url, storage_key }`.
- `LocalStorageAdapter` — writes buffer to `/app/uploads/` (previously inlined in `StorageService`).
- `S3StorageAdapter` — skeleton; `upload()` raises at runtime until `AWS_S3_BUCKET` is set.
- `StorageModule` (`@Global()`) — `useFactory` reads `STORAGE_DRIVER` env var:
  `'local'` (default) → `LocalStorageAdapter`; `'s3'` → `S3StorageAdapter`.
  Providers are lazily imported inside the factory body.
- `StorageService` — now delegates entirely to the injected `IStorageAdapter`.
  New `uploadBuffer(buffer, filename, mimeType)` method added (used by PDF reports).
- **3 fs bypass fixes:** `compliance-report.processor.ts`, `compliance.controller.ts`,
  `gdpr-export.service.ts` — all now go through `StorageService` instead of writing
  to `__dirname` or calling `fs` directly.
- **New Joi vars:** `STORAGE_DRIVER: Joi.string().valid('local','s3').default('local')`.

**Files changed:**
- `backend/src/modules/storage/interfaces/storage-adapter.interface.ts` (new)
- `backend/src/modules/storage/adapters/local-storage.adapter.ts` (new)
- `backend/src/modules/storage/adapters/s3-storage.adapter.ts` (new)
- `backend/src/modules/storage/storage.module.ts` (rewritten)
- `backend/src/modules/storage/storage.service.ts` (refactored)
- `backend/src/modules/compliance/processors/compliance-report.processor.ts`
- `backend/src/modules/compliance/controllers/compliance.controller.ts`
- `backend/src/modules/admin-security/services/gdpr-export.service.ts`
- `backend/src/app.module.ts` (new Joi var)

---

### Phase 9.1b — EmailService abstraction (NestJS backend)

**What shipped:**
- New interface `IEmailProvider` + DI symbol `EMAIL_PROVIDER` at
  `backend/src/modules/notifications/interfaces/email-provider.interface.ts`.
  Single `send({ from, to, subject, html })` method.
- `SmtpEmailProvider` — wraps nodemailer (existing SMTP path).
- `SesEmailProvider` — wraps AWS SES `SendEmailCommand` (requires `AWS_ACCESS_KEY_ID` etc.).
- `NotificationsModule` — `useFactory` reads `EMAIL_DRIVER` env var:
  `'smtp'` (default) → `SmtpEmailProvider`; `'ses'` → `SesEmailProvider`.
- `EmailService` — now delegates to the injected `IEmailProvider`.
  Template rendering (HTML construction) stays in `EmailService`; the provider is
  pure transport.
- **`FROM_EMAIL` bug fixed:** env var was referenced as `EMAIL_FROM` in one path,
  causing silent wrong-sender-address on some email types. Unified to `FROM_EMAIL`
  throughout. See lesson #112.
- **`require()` → `import`** for nodemailer — eliminates a dynamic-require anti-pattern.
- **New Joi vars:** `EMAIL_DRIVER: Joi.string().valid('smtp','ses').default('smtp')`.

**Files changed:**
- `backend/src/modules/notifications/interfaces/email-provider.interface.ts` (new)
- `backend/src/modules/notifications/providers/smtp-email.provider.ts` (new)
- `backend/src/modules/notifications/providers/ses-email.provider.ts` (new)
- `backend/src/modules/notifications/notifications.module.ts` (rewritten)
- `backend/src/modules/notifications/email.service.ts` (refactored)
- `backend/src/app.module.ts` (new Joi var)

---

### Phase 9.1c — OCR/text extraction abstraction (ai-backend)

**What shipped:**
- New Python ABC `BaseTextExtractor` at
  `ai-backend/app/services/base_text_extractor.py`.
  Single abstract method: `extract_pdf(file_path: str, page_count: int) -> str`.
  First use of the ABC pattern in the ai-backend codebase.
- `TesseractTextExtractor` at `ai-backend/app/services/tesseract_text_extractor.py`
  — renamed and refactored from `TextExtractorService`. Key improvement:
  `self.last_page_count: int = 0` mutable instance state removed;
  `_ocr_pdf()` now takes an explicit `page_count: int` parameter, eliminating
  a potential race condition across concurrent Celery workers.
- `TextractTextExtractor` at `ai-backend/app/services/textract_text_extractor.py`
  — skeleton only; `extract_pdf()` always raises `NotImplementedError`. Instantiated
  only when `TEXT_EXTRACTOR=textract` is set. See known gaps below.
- `get_text_extractor()` factory at `ai-backend/app/services/text_extractor_factory.py`
  — reads `TEXT_EXTRACTOR` env var; lazy imports inside function body (matching
  the existing Celery task pattern).
- `ai-backend/app/services/text_extractor.py` — original file replaced with a
  one-line backward-compat re-export: `TextExtractorService = TesseractTextExtractor`.
  Any code that imports `TextExtractorService` continues to work unchanged.
- `ai-backend/app/tasks.py` — `run_extract_text` updated to call
  `get_text_extractor()` factory instead of instantiating `TextExtractorService`
  directly.
- **New settings fields:** `TEXT_EXTRACTOR: str = "tesseract"`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` added to
  `ai-backend/app/config/settings.py`.

**Files changed:**
- `ai-backend/app/services/base_text_extractor.py` (new)
- `ai-backend/app/services/tesseract_text_extractor.py` (new — renamed from TextExtractorService)
- `ai-backend/app/services/textract_text_extractor.py` (new — skeleton)
- `ai-backend/app/services/text_extractor_factory.py` (new)
- `ai-backend/app/services/text_extractor.py` (replaced with re-export alias)
- `ai-backend/app/tasks.py` (factory call in `run_extract_text`)
- `ai-backend/app/config/settings.py` (5 new fields)

---

### Phase 9.1 — Known Gaps / Future Work

These gaps are documented here so they are NOT accidentally built on top of without
a plan. None are urgent for local development. All will be addressed before AWS deployment.

1. **`compliance_report_jobs.file_path` semantic change** — column now stores a full
   URL (e.g., `http://localhost:3000/uploads/compliance-reports/uuid.pdf`) after the
   9.1a storage abstraction. When switching to S3, the stored value will become an
   S3 URL. Any code that reads this column and treats it as an absolute filesystem
   path will break. Audit before switching `STORAGE_DRIVER=s3`.

2. **`operations-review.service.ts` still writes config JSON to `__dirname`** —
   this service writes a local config file outside the `StorageService` abstraction.
   Needs a DB migration or StorageService integration in Phase 9.3+.

3. **`DocumentProcessingService.getLocalFilePath()` passes local paths to Celery** —
   when `TEXT_EXTRACTOR=textract` is activated, this method must be changed to pass
   S3 coordinates (bucket + key) instead of a local filesystem path. The Textract
   skeleton raises `NotImplementedError` until this is resolved.

4. **Textract skeleton prerequisites (do NOT implement until all are met):**
   - S3 storage must be active (`STORAGE_DRIVER=s3`, Phase 9.1a S3 adapter deployed)
   - `DocumentProcessingService.getLocalFilePath()` replaced with S3-coordinate passing
   - `boto3` added to `ai-backend/requirements.txt`
   - Block-tree parser `_parse_textract_blocks()` written for Arabic RTL text layout
   - Celery `soft_time_limit` raised for async Textract polling (current 1800s may
     be insufficient for large multi-page Arabic documents via async API)
   - Integration tests with real Textract API on a scanned Arabic PDF

5. **S3 adapter skeleton** — `S3StorageAdapter.upload()` raises `NotImplementedError`
   until `AWS_S3_BUCKET` is set and `@aws-sdk/client-s3` is verified in
   `package.json`. The adapter class exists and is wired in; only the
   implementation method body needs filling.

**Hard rules — never violate:**
- Do NOT set `STORAGE_DRIVER=s3` or `EMAIL_DRIVER=ses` or `TEXT_EXTRACTOR=textract`
  in any environment until the corresponding prerequisites above are met.
- When Textract is eventually activated, change `DocumentProcessingService` AND update
  this section to reflect the resolved state. Never leave known-gap items stale.
- The `BaseTextExtractor` ABC `extract_pdf()` method signature is fixed:
  `(file_path: str, page_count: int) -> str`. Do not add instance state to pass
  page_count implicitly — the parameter exists specifically to prevent race conditions.
