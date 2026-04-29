# CLAUDE.md — Project Intelligence File
> Read this entire file at the start of every Claude Code session before touching any code.
> This file is the single source of truth for all architectural decisions, rules, and context.
> Last updated: 2026-04-28 (Added: Arabic document processing, document priority system, clause extraction architecture, Celery rules)

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
| youssef141162@gmail.com | Youssef@1997 | OWNER_ADMIN |
| admin@sign.com | Admin@Sign2026 | SYSTEM_ADMIN |
| mohameddaaymande@gmail.com | (set manually) | SYSTEM_ADMIN |

> Note: mohameddaaymande@gmail.com is not auto-seeded — role must be set manually in DB if lost:
> `UPDATE users SET role = 'SYSTEM_ADMIN' WHERE email = 'mohameddaaymande@gmail.com';`

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
4. **No automated tests** — add tests for any new critical path built.
5. **No CI pipeline** — do not assume code is safe just because it commits.

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
