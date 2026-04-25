# CLAUDE.md — Project Intelligence File
> Read this entire file at the start of every Claude Code session before touching any code.
> This file is the single source of truth for all architectural decisions, rules, and context.

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
apps/
sign/        → React + Vite frontend (localhost:5173)
cenvox/      → CENVOX landing page (localhost:5174)
backend/       → NestJS API (localhost:3000)
ai-backend/    → FastAPI + Celery AI service (localhost:8000)

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

---

## Contract Status Machine
Valid transitions only — never add ad-hoc status changes:
DRAFT → UNDER_REVIEW → PENDING_APPROVAL → ACTIVE → PENDING_TENDERING → SENT_TO_CONTRACTOR → EXECUTED / TERMINATED

---

## AI Pipeline Architecture
Frontend → NestJS controller → Bull queue job → Celery task (FastAPI) → result stored in DB → frontend polls GET endpoint
Never shortcut this flow. The AI backend has 9 Celery tasks and 11 FastAPI routes.

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
