# CLAUDE.md — Project Intelligence File
> Read this entire file at the start of every Claude Code session before touching any code.
> This file is the single source of truth for all architectural decisions, rules, and context.
> Last updated: 2026-06-24 (Arabic PDF rendering — Acrobat-strict fix, PR #97 squash-merged to `main` at `f3f1c5f`. Real-world Arabic contract exports crashed Adobe Acrobat (CTJPEGReader / Font Capture access violations) AND rendered the footer as garbled Latin — one root cause: pdfkit's fontkit subset has `sfntVersion = 'true'` (Apple TTF magic, not standard 0x00010000) + missing OpenType-required tables (`cmap` / `name` / `post` / `OS/2`), which lenient validators (qpdf, fontTools, Chrome) accept but Acrobat strict-rejects. Fix: module-init monkey-patch on pdfkit's internal `EmbeddedFont.embed` swaps the subset for the FULL Amiri TTF + writes a `/CIDToGIDMap` stream from `fontkit.Subset.glyphs[]` so content-stream subset gids round-trip to the correct full-font glyphs; pure-Latin chrome (footer, brand, English labels) routes to PDF base-14 Helvetica (no embedding, no fontkit subset, no Acrobat strict risk). Scoped to `export.service.ts` + `portfolio-export-renderer.service.ts`; compliance separately tracked as PR-A in NEXT_PHASES 7.43 (still v0.1 pdfmake pattern + latent Arabic-tofu gap, neither addressed by this PR). See lessons #174–#176 and the new bottom-of-file "Arabic PDF Rendering — Acrobat-Strict Fix (shipped 2026-06-24)" section. Prior 2026-06-21: Phase 7.35 — `users.mfa_totp_secret` encrypted at rest via CryptoService, PR #88 squash-merged to `main` at `7c1e914`. Reuses `ERP_CREDENTIAL_ENC_KEY` (no new key/env); shared `CryptoModule` (`common/crypto/`) now feeds BOTH AuthModule + IntegrationsModule; encrypt-on-write in `setupMfaTotp` (still returns plaintext for the QR), decrypt-at-use in `verifyMfa`/`enableMfaTotp` via the version-prefixed dual-read `decryptTotp` (anti-lockout); forward-only idempotent migration `1759000000001` (`NOT LIKE 'v1.%'`, throws + zero rows if key missing). Scoped OUT: DocuSign RSA key (env var → Phase 9.2 secrets manager), `mfa_secret` + `mfa_recovery_codes` (already hashed). DEPLOYMENT: `ERP_CREDENTIAL_ENC_KEY` is now functionally required for MFA enrollment in every env. Updated CryptoService section (Consumers + hard rules); lesson #172; NEXT_PHASES 7.35 marked complete + DocuSign deferred to 9.2. Prior same day: Phase 7.28 ERP Integration shipped end-to-end — v1 + v1.1, PRs #79–#83. Per-org connector registry (vendor→adapter via Symbol DI), neutral cost model (`erp_cost_records`), Bull-queue sync (import-only), Mock + SAP-skeleton adapters; Client Portal "ERP Connections" screen + Admin "ERP Health" dashboard; v1.1 operator control (suspend/unsuspend/force-check/guarded-delete), actor-tracked hold state machine (`operator_suspended` vs `auto_suspended`), automatic consecutive-failure circuit-breaker, reason-required immutable audit + OWNER_ADMIN notification, "who suspended" on the admin list. Feature-flagged OFF by default (`ERP_INTEGRATION_ENABLED`); migrations `1757000000001` + `1758000000001`. New bottom-of-file "ERP Integration — Phase 7.28 (shipped, v1 + v1.1)" section; lessons #170–#171; NEXT_PHASES 7.28 marked complete + new follow-on tasks 7.37–7.41 added. Prior 2026-06-16: Encryption-at-rest `CryptoService` shipped — PR #73 squash-merged to `main` at `b36b3d0` — AES-256-GCM util at `backend/src/common/utils/crypto.ts`, the first encryption-at-rest primitive; key `ERP_CREDENTIAL_ENC_KEY` (Joi `string().min(32).optional().allow('')`), SHA-256-derived to 32 bytes, random IV per call, auth-tag-verified. New bottom-of-file "Encryption-at-Rest Utility — CryptoService" section; lesson #169; 7.28 reframed to a per-org connector registry (import-only v1); new task 7.35 to encrypt the existing plaintext MFA TOTP + DocuSign RSA secrets. Prior 2026-06-10: Phase 7.27 Legal Corpus shipped end-to-end (local branch `feature/7-27-legal-corpus`, pending push/merge) — country-agnostic `legal_documents`/`legal_document_chunks`/`legal_sources` schema with pgvector HNSW; full ingestion pipeline (StorageService → text extraction with a force-OCR branch for broken-font PDFs → NFKC + optional Arabic visual→logical reversal → tiktoken-capped article-boundary chunking → OpenAI text-embedding-3-small → bulk vector write), jurisdiction-scoped retrieval, and AI Chat wired as the first consumer with async polling. Per-source flags `is_visual_order`/`force_ocr` handle per-country quirks; Egyptian Tax Authority seeded (force_ocr=true). Phase D verified GREEN on Egyptian Civil Code 131/1948; Phase E + async chat verified GREEN via UI (Arabic force-majeure → grounded answer citing Civil Code Articles 215/217/373). New bottom-of-file "Phase 7.27 — Legal Corpus (shipped 2026-06-10)" section; lessons #153–#167. Prior: Phase 7.18 Part 2 shipped — managing-user compliance run is the FIRST wired metering consumer. PR #49 squash-merged at `49f785f` on top of engine PR #46 (`9200f38`). Async reconcile shape: reserve in-request behind the #45 access wall, commit/release in `refreshFromAi` + both synchronous fail paths, sweeper backstop for never-polled runs; `reservation_id` on `compliance_checks` via additive migration `1754000000001`; four ops-search log signals (`metering.compliance.{committed_after_release|released_after_terminal|commit_error|release_error}`); engine code UNTOUCHED. Rule 9 parenthetical updated. New bottom-of-file "Phase 7.18 Part 2 — Compliance metering consumer" section. Staging gate (G.1–G.7) reframed as a **Phase 9 release-gate, NOT a merge-gate** — runbook stays in `docs/metering-part2-staging-gate.md`. NO new lessons added — substantive Part 2 lessons (TTL-vs-p99, sweeper-at-scale) need real load, deferred to Phase 9. ContractShare Step 1 deprecation shipped — dead public token endpoint removed, broken external email path removed, cross-tenant info disclosure in `getSharesByContract()` fixed, frontend external sharing gated with "coming soon" message. Lesson #152. Phase 7.18 metering engine primitive shipped — commit `dc31bb6` on `feat/metering-primitive-7.18`. Schema + allowance resolver + MeteringService authority (reserve/commit/release) + dangling-reserve sweeper + READ COMMITTED startup invariant. 20 real-Postgres concurrency + precedence tests; full backend suite 430/430. ENGINE ONLY — no consumer wiring (Part 2). See "Metering Engine Invariants — Phase 7.18 (shipped 2026-06-04)" section at the bottom; new ARCHITECTURE RULES Rule 9 is the spine pointer. Lessons #148–#150 capture the engine-earned discipline (TypeORM 0.3 `[rows, rowCount]` shape, read-then-write transitions, existence-check-then-insert idempotency race). Phase 7.26 shipped — Track A complete. 12 missing i18n keys added across EN and AR locales; FR was already structurally complete. Track B (legal page localization) deferred pending legal team translated content. Phase 7.25 fully documented (PR #41). **CRITICAL** — Phase 3.4 compliance PDF reports + Phase 4 ExportService contract PDFs are CURRENTLY BROKEN by the same pdfmake v0.1 require pattern 2c just fixed; see Critical Known Bugs + lesson #142, HIGH priority. Internal Contract Sharing fix shipped (PR #44) — cross-tenant bug in `createShare()` fixed + ProjectMember creation + notification dispatch + org-member autocomplete.)

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
| Type B — Responding Party (Guest) | An external counterparty invited to respond to a specific contract. **Progressive identity**: enters via a secure invitation link, views the assigned contract with no password; sets a password on first action requiring durable identity (sign, upload a version, leave attributed comments) and is upgraded to a lightweight **restricted user row** with a guest role, hard-walled to the invited contract(s). | Guest Portal `/contractor/*` | No SIGN subscription. Guest **counts per inviting org are capped by that org's subscription plan** and Operations-configurable from the admin portal. |
| Type C — Individual Practitioner | Solo professional (independent engineer, consultant, etc.) | Client Portal `/app/*` with personal workspace mode | Has own personal subscription |

### Portal Rules — Never Violate
1. The portal at `/contractor/*` is the **Guest Portal** — NOT "Contractor Portal". Rename all references in code, UI labels, and comments.
2. A contractor FIRM with its own SIGN subscription uses the **Client Portal** (`/app/*`) — they are Type A, never directed to Guest Portal.
3. A person may hold different PROJECT-LEVEL ROLES across projects inside the Client Portal — e.g. a managing-party role on one project and an internal reviewing/responding role on another — all handled via project-level permissions in the Client Portal, not by switching portals. NOTE: 'responding role' here means an INTERNAL Client-Portal project role, and is distinct from the external 'Type B — Responding Party (Guest)' persona in Rules 5–6, who is an external counterparty in the Guest Portal hard-walled to their invited contract(s). The case of the same real person being BOTH an internal Client-Portal user AND an external guest (separate user rows / contexts) is out of scope for the 7.18 build and will be specified if/when required.
4. Type C practitioners use Client Portal (`/app/*`) in **personal workspace mode**: no team management UI, no org management UI, lighter sidebar, personal dashboard. Same codebase — UI mode flag set by subscription type.
5. Guest Portal (`/contractor/*`) onboarding follows the **progressive-identity** model. Entry is via a secure invitation link with **no password required for view**. The first action requiring durable identity (sign, upload a new version, leave attributed comments) triggers password creation, after which the visitor becomes a lightweight **restricted user row** with a guest role and no subscription. Access is **HARD-WALLED to the invited contract(s) at the data/service layer** (project-scoped guards + service-layer ownership joins) — NOT just at the UI level. The guest user row never gains visibility into anything outside its invitation scope, regardless of role.
6. Guest Portal capabilities are **scoped, metered, and Operations-configurable** — not "minimal." A guest CAN: view the assigned contract; see the existing AI clause classification on it; download a **watermarked** copy; add comments; upload a new version; trigger AI extraction + classification on their own uploads (**METERED** per the inviting org's plan); use the AI assistant (**rate-limited**); sign; trigger risk + compliance analysis on their uploads with **findings PREVIEWED but full detail GATED behind upgrade**. Everything else is blocked or surfaced as a paid-tier upsell. All allowances (per-action quotas, AI assistant rate limits, watermark policy, version-upload size, etc.) are Operations-configurable from the admin portal.
7. Never build separate UIs for managing vs responding roles inside the Client Portal — use project-level permissions instead.
8. Personal subscription plans must set a `workspace_mode: personal` flag that hides team/org features in the Client Portal.

### 2026-06-02 — Guest persona redefinition (supersedes prior "no-account / link-only / minimal" definition)

Per the approved 7.18 Guest Portal architecture plan: the Guest Portal is the **first door on a shared external-access foundation**. The Type B row + Rules 5 and 6 above replace the earlier "no-account, link-only, minimal" definition. A **free/freemium tier on the same foundation is the planned next sprint** — its rules will extend, not replace, the progressive-identity + restricted-user-row + hard-wall + Ops-configurable-allowances model established here. Any new external-access surface must compose with this foundation, not bypass it.

### 2026-06-22 — Guest watermarked download shipped (feature #3, PR #94, merged `99f431d`)

The "download a **watermarked** copy" capability promised in Rule 6 is now SHIPPED end-to-end (`GET /guest/contracts/:id/pdf`). The invariants below are **additive** to Rules 5–6 above (which are unchanged):

- **Download requires ESTABLISHED IDENTITY (Path B).** Only a guest with a real `account_type=GUEST` JWT (the progressive-identity "restricted user row") can download — the route is `JwtAuthGuard` + an explicit `account_type === GUEST` assertion (a managing-user JWT routed here gets a loud **403**, never a silent download). A **passwordless viewer credential (Path A — `Authorization: Viewer <token>`) CANNOT download**: it is not a JWT and never authenticates on this route. Consistent with progressive-identity — download is an attributed action, so it sits behind the same identity gate as sign / upload / attributed-comment.
- **The watermark is SERVER-SIDE identity, never client input.** Every page is stamped with a visible diagonal watermark `CONFIDENTIAL — <guest email> — <timestamp>`, where the email comes ONLY from the authenticated principal (`JwtStrategy` loads the User row by token `sub`) and the timestamp from the server clock. The route accepts **no** identity input of any kind — a client-supplied `?email=` is ignored. Implemented via pdfmake 0.3.x's **native top-level `watermark` property** (auto per-page) on `ExportService.generateContractPdf(contractId, watermarkText?)`: the guest path passes the stamp; the **managing-user export path passes no `watermarkText` → no `watermark` key → output is un-watermarked, byte-for-byte unchanged.** The service never constructs the stamp itself — identity construction stays at the authenticated boundary.
- **Binding-gated, no existence leak, no bare-repo.** Contract scope is walled through `ContractAccessService.findAccessibleContract → findForGuest` (the `guest_contract_access` binding). A guest requesting any contract they are not bound to gets **404, never 403** (existence is not leaked). The route goes through the scoped access service — **no bare-repo access** (`lint:contract-repo` clean). It renders ONLY contract metadata + clauses (no risk / obligations / comments — Portal Rule 6 gates that detail behind upgrade).
- **Known dependency (NOT a defect of feature #3):** `generateContractPdf` renders Arabic clause content as mojibake (Helvetica has no Arabic glyphs + no RTL/bidi shaping) — a platform-wide bug affecting the managing export too, owned by a **separate** fix (Ayman). Feature #3 shipped with this as a documented, owned limitation; the watermark/download mechanism itself is correct. See lesson #173 (watermark byte-verification: FlateDecode + hex-TJ decode) and lesson #140 (mock-blindness).

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

### 9. Metering Engine — Phase 7.18 Invariants (engine commit `dc31bb6`)
Spine pointer; full details in the "Metering Engine Invariants — Phase 7.18 (shipped 2026-06-04)" section at the bottom of this file. **First wired consumer: managing-user compliance run (Phase 7.18 Part 2 — squash `49f785f`, PR #49) — see the "Phase 7.18 Part 2 — Compliance metering consumer" section at the bottom of this file.** Future consumers (risk on upload, AI assistant chat, guest upload-extraction) follow the same shape: reserve in-request behind the contract-access wall, commit/release across the async boundary, sweeper backstop. The seven invariants in shorthand:
- (1) Subject is **always** derived `contract → project → project.organization_id`. A guest's `User.organization_id` is **never** trusted as the metering subject. Managing-user JWT org is a defense-in-depth cross-check only.
- (2) `reserve()` uses an **atomic conditional UPDATE**, a DELIBERATE exception to Bucket 1's `setLock('pessimistic_write')` idiom. Future single-hot-row counters follow this, not setLock. Do NOT "fix" the inconsistency.
- (3) Idempotency = **INSERT-FIRST + ON CONFLICT DO NOTHING + return-existing** (Pattern C). NEVER existence-check-then-insert (lesson #150).
- (4) `commit()` / `release()` / sweeper are **status-guarded conditional UPDATEs**; refund happens at-most-once across any number of concurrent callers (lesson #149).
- (5) Allowance precedence: `subject_allowance → plan_allowance → meter_definition.default_limit`. Branches on **row presence**. `limit = 0` is **BINDING** — meter disabled, NEVER coalesced.
- (6) **READ COMMITTED is required and startup-enforced.** `MeteringService.onModuleInit()` refuses to boot otherwise. The gates rely on EvalPlanQual + per-statement snapshots.
- (7) Meter limits are **Ops-set** at runtime. `default_limit = 1000` for compliance is a PLACEHOLDER. NEVER hardcode limits in app code.

Engine-earned lessons: #148 (TypeORM 0.3 `[rows, rowCount]` shape), #149 (read-then-write status transitions double-refund), #150 (existence-check-then-insert idempotency race).

### 10. PostgreSQL Enum Type Names — Always Use the `_enum`-Suffixed Name
TypeORM auto-appends `_enum` to enum type names in PostgreSQL. The mapping is:
`<snake_case_column_name>_enum` — NOT the TypeScript enum name.

Example: a `@Column({ type: 'enum', enum: DocumentProcessingStatus })` on a column
named `processing_status` produces the PostgreSQL type `document_processing_status_enum`.

**Any `ALTER TYPE` migration MUST use the actual PostgreSQL type name.** Always verify first:
```sql
SELECT typname FROM pg_type WHERE typname LIKE '%your_enum%';
```
Or from a running container:
```bash
docker exec sign-postgres psql -U sign_user -d sign_db \
  -c "SELECT typname FROM pg_type WHERE typname LIKE '%your_enum%';"
```
Targeting the wrong name fails silently if wrapped in `EXCEPTION WHEN` (the lesson #31/#103 anti-pattern) and loudly if not. See lesson #143.

### 11. Contract-Scoped Repository Access — Go Through the Chokepoint
Contract-scoped reads and by-id loads MUST go through the scoped-repository
chokepoint (`backend/src/modules/scoped-repository/*ScopedRepository`), which
always applies the canonical `contract → project → organization_id` tenancy
gate. The `ContractAccessService` walls (`findInOrg` / `findAccessibleContract`)
STAY as independent defense-in-depth (two checks, two layers — see Option B).

A "contract-scoped entity" is one rooted in the `contract → project → org` chain.
The enforced set (24, deliberately over-inclusive — over-detection beats missing
surface; **pending Ayman confirm**): the 11 wired (`Contract`, `ContractVersion`,
`ContractorResponse`, `ContractApprover`, `ContractComment`, `Obligation`,
`RiskAnalysis`, `Notice`, `Claim`, `SubContract`, `DocumentUpload`) plus 13
discovered (`ContractClause`, `ComplianceCheck`, `ComplianceFinding`,
`ComplianceReportJob`, `NegotiationEvent`, `ContractShare`, `GuestContractAccess`,
`GuestInvitation`, `ChatSession`, `ChatMessage`, `RiskAnalysisOverrideLog`,
`ObligationAssignee`, `ObligationReminderLog`).

**Enforced by the `no-bare-contract-repo-access` ESLint rule**
(`backend/tools/eslint-rules/`, isolated config `backend/.eslintrc.contract-repo.cjs`,
`npm run lint:contract-repo`, wired into the CI `Backend Tests` job). It is
ERROR-level: a new bare repo access (`@InjectRepository(Entity)`,
`getRepository(Entity)`, `<repo>.<dataMethod>()` on a `Repository<Entity>`,
`<manager>.<dataMethod>(Entity, …)`) on a contract-scoped entity fails the build.
The ONLY sanctioned exemption is a `// lint-exempt: <reason>` comment with a
non-empty reason (a bare `// lint-exempt` is rejected). `noInlineConfig` makes
`eslint-disable` of this rule inert — `// lint-exempt:` is the single exemption
path, and every exemption therefore carries a reviewed reason.

**This rule does NOT claim a stronger invariant than it enforces.** It currently
ships with ~306 annotated/allowlisted exceptions (full classified inventory:
`docs/option-b-lint-phase1-inventory.md`). The named, legitimate exceptions are:
- **Org-wide aggregation QBs** (Q3) — dashboards/analytics/portfolio/drift, obligation
  portfolio, `checkOverdueNotices`, create-sequence counts. Org-scoped, not per-contract.
- **System / no-orgId paths** — background processors (obligation-reminder,
  compliance-report), org-derivation (metering resolver), project-resolution
  middleware, HMAC public token routes, admin GDPR export, the dead-code SubscriptionGuard.
- **Two-step hydration / parked inline-join** — reads hydrated on ids already
  validated by a scoped load; `getExplanation`/`applyOverride` inline-`r→c→p.org` joins.
- **Wall-protected sites pending chokepoint migration** (≈104) — `compliance/*`,
  `chat`, `guest-portal`, `negotiation`, `docusign`, `export`, and `ContractClause`
  reads. Tenancy-safe TODAY via the `findInOrg` wall; a SCHEDULED future phase
  migrates them onto the chokepoint. They are NOT yet on the chokepoint — the doc
  and the `// lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled`
  annotations say so honestly.
- **Deprecating `contract-sharing`** — removed in ContractShare Step 2, not migrated.
- **`subscription.guard.ts` count** — DEAD CODE; never wire without an org wall
  (the count is org-blind and would be a cross-tenant leak if activated).

When adding a new contract-scoped read: route it through the relevant
`*ScopedRepository` (or add one). Do NOT reach for `// lint-exempt:` to silence
the rule unless the access genuinely fits one of the named exception classes —
and then state which one in the reason.

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
6. **🔴 HIGH PRIORITY — Compliance PDF service still BROKEN; Export PDF service FIXED (PR #92) + Acrobat-strict crash class CLOSED for export + portfolio (PR #97)** (originally discovered Phase 7.17 Prompt 2c; Acrobat-strict crash surfaced 2026-06-24). `backend/src/modules/compliance/services/pdf-report.service.ts` STILL uses the `require('pdfmake')` + `new PdfPrinter(...)` pattern from pdfmake v0.1.x. The installed version is `pdfmake@0.3.7` where the main export is an INSTANCE, not a class, so it WILL throw `TypeError: PdfPrinter is not a constructor` the moment it is triggered end-to-end — the shipped Phase 3.4 compliance reports (COMPLIANCE_SUMMARY / OBLIGATIONS_REPORT / JURISDICTION_CONFLICT) currently DO NOT WORK. **`backend/src/modules/export/export.service.ts` was fixed by PR #92 (`46eb075`)** for the pdfmake-0.3.x API, and **PR #97 (`f3f1c5f`) closed the separate Acrobat-strict Arabic-rendering class** (full Amiri embed + `/CIDToGIDMap` stream + pure-Latin chrome routed to base-14 Helvetica) for both `export.service.ts` and `portfolio-export-renderer.service.ts`. **Compliance is immune to BOTH PR #97 classes** (it registers only Helvetica, never embeds Amiri — so it can neither crash from the Acrobat-strict subset issue nor produce a garbled Latin footer), but two compliance gaps remain separately open: (a) the v0.1 require pattern (above) and (b) a latent **Arabic-tofu** rendering gap — Arabic content fed into compliance PDFs (obligation descriptions / jurisdiction names / contract titles in Arabic) renders as Helvetica `.notdef` boxes because the service never wires the `pdf-arabic.ts` helper. PR-A (NEXT_PHASES 7.43) is scoped to fix BOTH compliance gaps in one mechanically-small PR: mirror PR #92's 0.3.x pattern + wire `pdf-arabic.ts` for Arabic safety. Do NOT file as housekeeping — production-breaking + latent tofu, cheap urgent fix. See lessons #142 + #174.

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
| # | Issue | Severity | Fix | Reference |
|---|-------|----------|-----|-----------|
| 1 | `compliance/services/pdf-report.service.ts` uses broken pdfmake v0.1 require pattern — `TypeError: PdfPrinter is not a constructor` on first trigger. Phase 3.4 compliance reports do not work end-to-end. **Plus** a latent Arabic-tofu gap: the service registers only Helvetica (no Amiri, no `pdf-arabic.ts` helper) — any Arabic content (obligation description, jurisdiction name, contract title) renders as `.notdef` boxes. No crash, no garble; just missing glyphs. | **HIGH** | Single PR-A (tracked in NEXT_PHASES 7.43): (a) mirror PR #92's pdfmake-0.3.x pattern (`require('pdfmake/js/Printer').default` + `require('pdfmake/js/URLResolver').default` + `await printer.createPdfKitDocument(...)`) + add a no-mock renderer integration test (`%PDF` magic + `%%EOF`); (b) wire `backend/src/common/utils/pdf-arabic.ts` (`arabicFontDescriptors` + `arabicVfs` + `emitArabicParagraph` + `arabicHeadingText`) and flip `defaultStyle` to Helvetica — exactly as PR #97 did for export + portfolio. The PR #97 helper's monkey-patches install globally at first import, so compliance benefits from the full-Amiri-embed + `/CIDToGIDMap` fix automatically once the helper is imported. ~1 hour. | Lessons #142 + #174 |
| 2 | ~~`export/export.service.ts` uses the same broken pdfmake v0.1 require pattern — ExportService contract-PDF endpoint does not work end-to-end.~~ **RESOLVED — PR #92 (`46eb075`).** | ✅ Done | Render method rebuilt as the async `createPdfBuffer()` on the pdfmake 0.3.x pattern + no-mock `%PDF` test; endpoint works end-to-end. Mirrored 2c fix `d4dc54a`. | Lesson #142 |
| 3 | ~~`export/export.service.ts` + `portfolio-export-renderer.service.ts`: Acrobat-strict crash on Arabic PDFs (CTJPEGReader / Font Capture access violation) + garbled Latin footer.~~ **RESOLVED — PR #97 (`f3f1c5f`).** | ✅ Done | Full Amiri TTF embedded via pdfkit `EmbeddedFont.embed` monkey-patch (sfntVersion 0x00010000 + all 15 tables) + `/CIDToGIDMap` stream from `fontkit.Subset.glyphs[]` so content-stream subset gids resolve to correct full-Amiri glyphs; pure-Latin chrome routed to base-14 Helvetica (no fontkit subset, no Acrobat strict risk). RED-first font-validity test guards regression; CI qpdf assertion gated behind `spawnSync('qpdf','--version')` presence probe (commit `3c595db`). Visual-verified in real Acrobat. | Lessons #174 + #175 + #176 |

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

---

## Phase 7.17 Prompt 2a — Portfolio Analytics Backend (shipped — 2026-05-29)

Backend prerequisite track for the OWNER_ADMIN Portfolio Analytics dashboard
(Prompt 2b, frontend). Backend-only; no frontend code. Merged after a staged
review (checkpoint → hardening → docs).

### What shipped
- **Migration `1750000000001-AddContractValueAndCurrency.ts`** — adds
  `contract_value NUMERIC(15,2) NULL` + `currency VARCHAR(3) NULL` to `contracts`.
  `ADD COLUMN IF NOT EXISTS`, **no backfill** (existing rows stay NULL by design;
  there is no source of truth for legacy values). Down-migration round-trip
  verified on dev (revert drops both + removes the migrations row; re-run restores).
- **Contract entity** — the two nullable columns (`decimal(15,2)` mirrors
  `sub_contracts.contract_value`).
- **Create/UpdateContractDto + `contracts.service`** — value/currency wired into
  BOTH `create()` and `update()` (the service maps fields **explicitly**, not via
  spread — a value added only to the DTO would silently never persist).
- **New `portfolio-analytics` module** — `GET /api/v1/portfolio-analytics`,
  `JwtAuthGuard + RolesGuard + @Roles(OWNER_ADMIN)`, org-scoped via the
  `contract → project → p.organization_id` join (Contract has no direct
  `organization_id`). Every widget wrapped in a `safeQuery()` so one failing
  aggregation degrades a single widget, not the page. Widgets: KPIs + QoQ deltas,
  contracts-by-status (6-bucket), value-per-currency, time-to-signature + trend,
  30/60/90 expirations, per-project worst-finding risk, org-wide risk
  distribution, contracts-by-standard-form, top-projects table.
- **Obligations `within` param** — optional `within` (days) on
  `ObligationPortfolioFiltersDto`; the service translates it to `from = today`,
  `to = today + within`. **Explicit `from`/`to` always win** (so callers that
  never pass `within` are byte-identical to pre-2a behaviour — regression-tested).
- **Tests** — pure helpers (bucket folds, pctChange), controller role-gating
  (401/403/200), DTO + merged-entity value↔currency pairing, `within` regression,
  empty-DB orchestrator null-safety. Full backend suite: 285 green.

### Decisions as shipped (locked)
- **D1 — contract status pie = 6 buckets, not 5.** `DRAFT` /
  `IN_APPROVAL` (PENDING_APPROVAL, APPROVED, PENDING_FINAL_APPROVAL,
  CHANGES_REQUESTED, RISK_ESCALATION_PENDING) / `WITH_COUNTERPARTY`
  (PENDING_TENDERING, SENT_TO_CONTRACTOR, CONTRACTOR_REVIEWING) / `ACTIVE` /
  `COMPLETED` / `TERMINATED`. COMPLETED and TERMINATED are kept DISTINCT (the
  success-vs-failure signal matters). The fold map (`CONTRACT_STATUS_BUCKETS`)
  is keyed by every one of the 12 `ContractStatus` values — adding a 13th status
  is a compile error until it is bucketed.
- **D2 — time-to-signature anchor = `shared_at → executed_at`** (the
  review→signed interval), NOT `created_at` (which is total cycle time and is
  what `admin-analytics` measures — the divergence is intentional and documented
  in code).
- **D2 — QoQ = rolling `AnalyticsPeriod` (7/30/90/365, default 90)** with
  `pctChange` against the previous equal-length window. NOT calendar quarters.
- **D3 — currency is required whenever `contract_value` is set.** Enforced two
  ways: `CreateContractDto` `@ValidateIf(o => o.contract_value != null)`
  (payload-only is correct for create); **`update()` enforces it on the MERGED
  entity** via `assertValueCurrencyPaired()` so a value-only PATCH on an
  already-priced contract is accepted (currency comes from the persisted row).
  `UpdateContractDto.currency` is therefore format-only at the DTO layer.

### Verification honesty — READ THIS before building on 2a
2a is **verified** for: no-crash, clean DI/wiring, logic-unit correctness (pure
folds + pairing + pctChange), and no regressions — all on the **empty dev DB**
(2 contracts, 0 risk_analyses). It is **NOT verified** for aggregation VALUES,
because there is no representative data locally (lessons #134, #135). A green
suite here proves the code runs and the unit-logic is right, NOT that the numbers
are right at scale.

**Two staging gates — MUST be cleared against representative data before 2a's
numbers are trusted in production:**
1. **Re-EXPLAIN the worst-finding query** (`MAX(risk_score) GROUP BY project` in
   `PortfolioAnalyticsService.getProjectRisk`). The dev EXPLAIN was inconclusive
   (0 rows → degenerate planner tie-break). No index was added — that is a
   workload-shape DEFAULT (write-hot `risk_analyses` vs infrequent OWNER_ADMIN
   read), not "verified". The fix — IFF heap fetches dominate at scale — is a
   covering index `(contract_id) INCLUDE (risk_score)`.
2. **Confirm aggregation values against real data** — every widget's numbers
   (bucket counts, per-currency sums, time-to-sig averages, expiration buckets,
   risk distribution) checked against a seeded/representative dataset.

### Hard rules — never violate
1. **`contract_value`/`currency` map explicitly in `contracts.service`** — never
   assume DTO presence means persistence; the service does not spread the DTO.
2. **The value↔currency pairing for UPDATES is enforced on the merged entity**
   (`assertValueCurrencyPaired` in the service), never payload-only — else
   value-only updates on priced contracts are wrongly rejected.
3. **No cross-currency totals** — value is reported per-currency only (no FX in
   v1). Do not sum across currencies anywhere.
4. **`within` never overrides explicit `from`/`to`** on the obligations portfolio
   query — explicit dates win; `within` is the convenience fallback.
5. **Do NOT add the worst-finding covering index speculatively** — it is gated on
   staging gate (1) above. Adding it now trades guaranteed write-amplification on
   a hot table for a speculative read win.
6. **Org scope always traverses `contract → project`** (Contract has no
   `organization_id`); never trust a client-supplied org id — use
   `@OrganizationId()` from the JWT.

---

## Phase 7.17 Prompt 2b — Portfolio Analytics Dashboard (shipped — 2026-05-30)

Frontend OWNER_ADMIN portfolio dashboard built on the 2a backend endpoint.
Frontend-only; no backend code. Merged after live triangulation on
`/app/portfolio` against real authenticated data — page render + Network tab
all-200 + console clean of app code + full EN/AR scroll composition review.

### What shipped — the 12-widget dashboard

**Page shell** — new route `/app/portfolio` (`PortfolioPage.tsx`, 221 lines)
gated by OWNER_ADMIN role + nav entry in the AppLayout sidebar. Page-level
filters: `period` (7/30/90/365 days, default 90) and `projectId` (org's
projects), both passed as query params to every widget query — **server-side
filters only; NO client-side cross-filter** (clicking a status slice does not
refetch other widgets).

**Infrastructure (new under `apps/sign/src/components/portfolio/`):**
- `ChartBlock.tsx` (152 lines) — universal RTL-aware Chart.js wrapper.
  `withRtlChrome` helper applies `animation: false` per #136 and per-geometry
  RTL flip (axis reversal, bar direction, doughnut rotation, legend alignment).
- `states.tsx` (83 lines) — `EmptyState`, `LoadingState`, `ErrorState`
  primitives. **Empty vs Error are distinct components, never collapsed.**

**The 12 widgets:**
1. **AttentionStrip** — sticky 3-source strip at the top of the page:
   high-risk count (`/portfolio-analytics?period=90d`), expiring count
   (`/obligations/portfolio?within=14`), overdue count
   (`/obligations/portfolio?status=OVERDUE`). **Per-source error states** —
   each tile renders its own loading/empty/error independently; one failing
   query never blacks out the strip. Red alarm color reserved for OVERDUE
   (the only true alarm source); high-risk + expiring stay neutral-gray at 0.
2. **KPI strip** — 5 cards (Total, Active, Open Risks, Contracts Created,
   Risks Flagged). Each card carries an `inverseGood` flag — Open Risks and
   Risks Flagged are lower-is-better, so green QoQ delta = decrease. QoQ
   delta badges set `dir="ltr"` (signed notation `+12%` / `−3%` reads LTR
   even under RTL).
3. **StatusPie** — contracts-by-status doughnut, 6-bucket fold per 2a D1.
4. **StandardFormDoughnut** — StatusPie clone for contracts-by-standard-form
   share. Same Chart.js config, different data slice — keeps visual parity
   and one place to edit doughnut geometry.
5. **RiskDistributionBar** — org-wide risk-level distribution (Low / Medium /
   High / Critical) as horizontal bar.
6. **ProjectRiskBar** — per-project worst-finding
   (`MAX(risk_score) GROUP BY project`).
7. **TimeToSignatureTrend** — avg days `shared_at → executed_at` with monthly
   trend line.
8. **ValueByCurrencyList** — per-currency contract value totals (no FX in v1
   per 2a hard-rule 3). Latin numerals + ISO currency codes per #137.
9. **UpcomingExpirationsCard** — 30/60/90 day bucket counts.
10. **UpcomingObligationsList** — obligations due within 14 days
    (`/obligations/portfolio?within=14`).
11. **TopProjectsTable** — top projects by aggregate contract value.

**Backend integrations:**
- `portfolioService.ts` (120 lines, new) — typed client for
  `/api/v1/portfolio-analytics`, response shapes mirror the 2a service.
- `obligationService.ts` — 4 lines added: typed `within` param on the
  portfolio query (2a's new param).

**i18n** — 102 keys added per locale × 3 locales (EN / AR / FR) with exact
parity. New namespace `portfolio.*` covering KPI labels, widget titles,
empty/error/retry copy, filter labels, attention-strip messages, status /
risk / standard-form translations.

### Decisions as shipped (locked)
- **D1 — period + project are server-side filters only.** No client-side
  cross-filtering. Clicking a status slice does NOT refetch other widgets
  filtered by that status. Page-level filters refetch all 12 widgets;
  per-widget clicks navigate (e.g. to a contract list view) but never
  mutate page state.
- **D2 — Empty vs Error are distinct UI states.** EmptyState is the
  *expected* rendering for sparse data (no contracts in period, no
  obligations in the next 14 days); ErrorState is for failed network calls
  or thrown queries. Sparse endpoints never render as errors, even on the
  near-empty dev DB.
- **D3 — Per-source error isolation on the multi-query attention strip.**
  The strip fires 3 independent queries; each tile owns its own
  loading/empty/error state. A 500 on `/obligations/portfolio?status=OVERDUE`
  does not blank the high-risk or expiring tiles.
- **D4 — Latin numerals + ISO currency codes for monetary AND counts**
  under AR per #137. Refuse `Intl.NumberFormat('ar-EG', ...)` on financial
  figures and KPI counts.
- **D5 — `animation: false` on every Chart.js chart** per #136. Dev-StrictMode
  guard + prudent prod default; do NOT re-enable per-widget without first
  re-deriving the multi-recreate safety argument — "it's only the bar" is
  the documented trap.
- **D6 — `dir="ltr"` on every numeric badge** that uses signed notation
  (`+12%`, `−3%`, `▲`, `▼`). Signed notation reads LTR even under RTL;
  bare prose with no signs can inherit page direction.
- **D7 — StandardFormDoughnut is a StatusPie clone, not a new chart.**
  Same Chart.js config, different data slice.

### Lessons added in this prompt
- **#136** — Portfolio Chart.js charts set `animation: false` (interrupted
  grow-animation under React re-render leaves charts mid-state). The
  Chart.js 4.5.0 bump that landed mid-debug was reverted (commit `3177253`) —
  the cause was React×animation, not the library version. #136's attribution
  was corrected post-fix (commit `e144b5a`) to record that `animation:false`
  is a dev-StrictMode guard + prudent default, NOT a confirmed production bug.
- **#137** — Latin numerals for monetary AND count values even under AR
  locale (MENA construction-finance convention).
- **#138** — `nest start --watch` can silently stop hot-restarting across an
  edit cascade, leaving the running process as a stale snapshot. Symptom: 404
  on a route present in CURRENT source AND in CURRENT `dist/`. Tell: the route
  is absent from the most recent Nest boot's `RouterExplorer.Mapped` log lines.
  Fix: `docker restart sign-backend`. Rule: verify the route is in the last
  boot's RouterExplorer log BEFORE debugging the code.

### Verification honesty — READ THIS before building on 2b
2b is **verified** for:
1. **No-crash** — all 12 widgets render without throwing on sparse real data
   (`/app/portfolio` clean under live OWNER_ADMIN session).
2. **RTL-correct rendering** — full EN + AR scroll composition review
   passes; every widget drawn, sticky attention strip behaves under scroll,
   no overlap / break / stuck spinner under either direction.
3. **Empty-state behavior** — sparse data renders `EmptyState`, NOT
   `ErrorState`. First-paint attention strip shows honest values (no
   false-calm gray "0" flash before snapping to the red alarm).
4. **Authenticated endpoint health** — Network tab confirmed the 3
   attention-strip queries return 200
   (`portfolio-analytics?period=90d` 200/2.2kB,
   `obligations/portfolio?status=OVERDUE` 200/4.7kB,
   `obligations/portfolio?within=14` 200/3.3kB). All 9 backend aggregations
   from 2a executed against the real schema and returned valid JSON. Cause (a)
   (a runtime throw on one of the aggregations against a real-schema null /
   join / GROUP BY) is ruled out **by execution**, not just by typecheck.

**Aggregation VALUES against representative data remain staging-gated per
#135.** A sparse-but-valid render proves "no crash + endpoint healthy + RTL
geometry correct" — it does NOT prove the numbers are right at scale. The 2a
staging gates carry forward unchanged — 2b inherits them, since the frontend
renders exactly what 2a returns:
1. Re-EXPLAIN the worst-finding query at representative scale.
2. Confirm bucket sums + per-currency totals + time-to-signature averages +
   expiration bucket counts + risk distribution against a seeded /
   representative dataset.

### Hard rules — never violate
1. **Every Chart.js chart in the portfolio uses `animation: false`** per
   #136. Do not re-enable per-widget without first re-deriving the
   multi-recreate safety argument from scratch.
2. **Monetary AND count values render with Latin (0-9) numerals + ISO
   currency codes** per #137 — including under AR locale. Refuse the
   `Intl.NumberFormat('ar-EG', ...)` refactor.
3. **Every signed-notation numeric badge carries `dir="ltr"`** (e.g. KPI QoQ
   delta cards). Plain count cards (no sign) can inherit page direction.
4. **Empty and Error are distinct UI states** — never collapse them. Sparse
   data → `EmptyState`; failed query → `ErrorState`. The dev DB renders as
   EmptyState by design.
5. **Page-level filters are server-side only** — `period` and `projectId`
   query params refetch all widgets. No client-side cross-filter inside
   the page.
6. **Per-source error isolation on `AttentionStrip`** — each of the 3
   sources renders its own state. Do not re-introduce a shared
   `loading || error` gate that blanks the whole strip on one failure.
7. **`StandardFormDoughnut` stays a `StatusPie` clone** — same Chart.js
   config, different data slice. A divergent doughnut config defeats the
   visual-parity decision.

---

## Phase 7.17 Prompt 2c — Portfolio PDF Export (shipped — 2026-05-31)

Token-gated PDF export of the portfolio dashboard. Closes the Phase 7.17
trio: 2a backend → 2b frontend → 2c PDF export. Built in 5 buckets behind
a single PR.

### What shipped — end-to-end pipeline

```
Frontend: ExportPdfButton on /app/portfolio → ExportPdfModal
   (confirmation, 1h expiry copy, single-email recovery)
   → POST /api/v1/portfolio-exports
Backend POST: JWT + RolesGuard(@Roles OWNER_ADMIN) + @ThrottleOnly
   ('portfolio_export', 5/15min/IP)
   → PortfolioExportService.createJob() persists PENDING row +
     enqueues `render-export` on `portfolio-export-jobs` queue
   → 202 { job_id, email }
Processor (@Process({ name: 'render-export', concurrency: 1 }) explicit
   per #13): RUNNING → PortfolioAnalyticsService.getPortfolioAnalytics()
   → PortfolioExportRendererService.render() (pdfmake)
   → StorageService.uploadBuffer() → token issued in-memory →
   EmailService.sendGenericEmail() (sync + throws on fail) →
   COMPLETED with file_path + expires_at on success
Public download: GET /api/v1/portfolio-exports/download?token=...
   bare HTTP + token only (no @UseGuards per §3 #11, see lesson #141)
   → HMAC verify (constant-time, BEFORE DB) → DB existence + status
     COMPLETED + user_id match → DB-side expires_at re-check →
     stream file (StorageService.getBuffer)
Cleanup: PortfolioExportCleanupScheduler registers a repeatable
   `cleanup-expired` cron every 30 min; PortfolioExportCleanupProcessor
   sweeps rows where `expires_at < NOW() AND NOT file_deleted` (predicate
   matches the partial index from Bucket 1).
```

### Decisions locked (D1–D7)

- **D1 — Token gating: 1h TTL, reusable, no nonce.** Rejected single-use
  at plan review — MENA mobile networks make on('end') nonce-burn punish
  legitimate users on flaky connections (partial download burns the link).
  24h was rejected as too long for org financials (especially deactivated-
  user residual). 1h gives ≈4× headroom over the realistic ~15min download
  window and compresses the deactivated-user residual exposure to <1h.
  Verification chain runs in deliberate code order: parse → constant-time
  HMAC compare → payload JSON parse → payload expiry → DB existence +
  COMPLETED + user_id match → DB-side expires_at re-check.
- **D2 — Queue: 1 attempt + failure email.** No retry on processor failure.
  Surfacing failure fast > silently retrying a deterministic failure (which
  most pdfmake / aggregation crashes are).
- **D3 — StorageService driver + retention.** `STORAGE_DRIVER` per Phase
  9.1a (local default, S3 future). File-retention TTL coupled to D1 via
  `PORTFOLIO_EXPORT_TTL_HOURS = 1` — single constant read by both the
  token issuance and the cleanup cron. Audit row retention = 7 days
  post-file-deletion.
- **D4 — Email-only delivery, no in-app notification.** Matches compliance
  precedent. **Deliberately diverges from compliance's fire-and-forget**:
  uses `EmailService.sendGenericEmail()` directly + await + throws-on-fail,
  because the spec mandates "email send fail → status=FAILED + no token";
  fire-and-forget returns success on enqueue and can't deliver that.
  Trade: less resilience to transient SMTP, but strict consistency between
  "row says COMPLETED" and "user got the email."
- **D5 — pdfmake renderer.** Cover page + watermark + footer + permissions
  block (printing high-res, edit/copy/annotate denied, random discarded
  owner password). EN-only labels v1 (Arabic glyph wall in pdfmake
  explicitly deferred to v2). Latin numerals + ISO currency codes (#137)
  applied throughout — no `Intl.NumberFormat('ar-EG', ...)` in the PDF
  even when the requester's UI locale is AR. Real-pdfmake integration
  test (`%PDF` magic + `%%EOF`) asserts the path works against sparse +
  null + empty docDef shapes (lesson #140).
- **D6 — Rate limit: 5/15min per IP.** Abuse mitigation framing (NOT
  capacity limit). Legitimate burst ceiling ≈3 (generate → change period →
  regenerate → maybe filter). 5 leaves slack for legit users without
  enabling efficient exfiltration of compromised OWNER_ADMIN account.
- **D7 — User-deleted residual exposure: ACCEPT <1h.** Deactivated user's
  in-flight token still works for up to the remaining TTL after
  deactivation (max <1h compressed from the D1 fix). Documented as
  acceptable trade-off — adding a DB-session check on the download
  endpoint would import the entire JWT model into the bare-HTTP path
  (lesson #141), creating new failure modes for marginal residual-window
  benefit.

### Deployment verification — DO NOT BURY THESE

2c's code path is verified by unit + integration tests but four pieces
require explicit end-to-end verification against real infrastructure at
deployment time. These are NOT staging-gated as a polish item — they are
the gate between "the tests pass" and "the feature works in production":

1. **Email dispatch over real SMTP.** Dev has no SMTP server; the
   processor's email-send call fails with `ECONNREFUSED 127.0.0.1:1025`,
   which exercises the failure-cleanup path but NOT the success email.
   Deployment must verify: a real export → real `EmailService.sendGenericEmail()`
   over real SMTP → email lands in the requester's inbox → contains a
   working download link.
2. **Token-gated download against a real issued token.** Unit tests
   exercise verify() against mocked rows; the bare-HTTP download
   controller is exercised against mocked storage. Deployment must verify:
   a real token from a real COMPLETED export → real GET request → real
   `StorageService.getBuffer()` → real PDF bytes stream back → file opens
   in Acrobat / Preview cleanly.
3. **Renderer against representative data.** Real pdfmake works against
   sparse / null / empty (verified by Bucket 4 integration tests, #140).
   Deployment must verify: real org data with ~10k contracts, multiple
   currencies, real time-to-signature distribution → renderer survives
   without throwing AND output is visually correct (no overflow, no
   text-clipping, no missing sections, no font-substitution warnings).
4. **Cleanup cron at scale.** Bucket 1 migration created a partial index
   on `expires_at WHERE NOT file_deleted`. Bucket 3 cleanup query
   matches the predicate (EXPLAIN against the dev DB confirmed the SHAPE;
   the planner correctly chose Seq Scan over 0 rows). Deployment must
   verify: with N rows (10k+) in `portfolio_export_jobs`, EXPLAIN ANALYZE
   the cleanup query and confirm `Bitmap Index Scan on
   idx_portfolio_export_jobs_expires_at`. If the planner falls back to
   seq scan at scale, the cleanup tick becomes O(N) and the cron's 30-min
   cadence becomes a slow DDoS on the DB.

Same #135 staging-gate posture carried throughout. Unit/integration tests
prove no-crash + logic-unit correctness; the four items above prove
real-environment behavior. They go on the deployment checklist explicitly.

### What the trimmed pipeline check caught — the real bug

The user's Bucket 5 review demanded a trimmed live trigger (query the row
from a real export) rather than letting email + download defer. That check
surfaced `TypeError: PdfPrinter is not a constructor` — pdfmake@0.3.7's
main export is an INSTANCE, not a class. 49 unit tests had passed clean
because the renderer was mocked at the processor level. The renderer was
broken from commit `33f4e41` (Bucket 2) through commit `6f459c1` (Bucket
4) — no test could have caught it because every test mocked the renderer.

Fix at commit `d4dc54a` (post-Bucket-4): `require('pdfmake/js/Printer').default`
+ `require('pdfmake/js/URLResolver').default` + `await
printer.createPdfKitDocument(...)`. Plus 3 no-mock renderer integration
tests (real pdfmake) covering sparse / null / empty docDef shapes. Direct
proof: 2.1KB valid `%PDF` / `%%EOF` buffer for the sparse-data shape.

The same broken pattern lives in `pdf-report.service.ts` (compliance) and
`export.service.ts` (contract export). Both are SHIPPED but currently
broken end-to-end — see Critical Known Bugs #6 + Outstanding Issues + lesson
#142. HIGH priority small-PR fixes; do not file as housekeeping. **(Update: the
`export.service.ts` half was fixed in PR #92, `46eb075`; only the compliance
`pdf-report.service.ts` half remains.)**

### New lessons (added in Bucket 5)

- **#140** — Mocking the external-library render/call path hides total
  failure (#135 applied to renderers). Any service whose RISK is the
  external library call itself needs at least one no-mock integration test.
- **#141** — SIGN has no global JwtAuthGuard. Token-gated endpoints
  inherit the bare-HTTP threat model — HMAC verification IS the entire
  auth gate, must precede any DB lookup, the secret env var is the
  security floor, audit-log every outcome with caller-side try/catch.
- **#142** — Compliance + Export PDF services use the same broken
  pdfmake v0.1 require pattern. Known-broken production state, HIGH
  priority small-PR fix mechanically-identical to the 2c renderer fix.

### Hard rules — never violate

1. **Every download token verifier MUST run HMAC compare BEFORE DB lookup.**
   The `no-DB-on-HMAC-fail` regression test in
   `portfolio-export-token.service.spec.ts` asserts
   `findOne.not.toHaveBeenCalled()` on signature failure. Any refactor that
   reorders verify() trips the test. Don't reorder for convenience.
2. **`PORTFOLIO_EXPORT_DOWNLOAD_SECRET` is Joi `.min(32).required()`.**
   This secret IS the entire security floor on the bare-HTTP download
   endpoint (lesson #141). Never lower the floor. Rotate by replacing
   the value — all in-flight tokens become invalid immediately, the 1h
   TTL caps user-facing impact.
3. **The cleanup query MUST include `AND NOT file_deleted`.** It matches
   the partial index from Bucket 1. Without it, the planner falls back
   to seq scan (#134/#135 index-shape mismatch). The query-shape test
   in `portfolio-export-cleanup.processor.spec.ts` asserts both WHERE
   clauses are present.
4. **`PORTFOLIO_EXPORT_TTL_HOURS = 1` is the single source of truth.**
   Both the token's signed `expires_at` and the cleanup cron's
   `WHERE expires_at < NOW()` read from this constant. Changing it
   cascades automatically. Never hardcode a duration in either path.
5. **Audit-record calls in the download controller MUST be wrapped in
   `safeAudit` (try/catch + logger.warn).** A `SecurityEventService.record()`
   hiccup must NEVER turn a valid 200 download into a 500. Mirrors the
   docusign.service.ts convention. Tested by 3 critical-path-invariant
   tests in `portfolio-export-download.controller.spec.ts`.
6. **`PortfolioExportRendererService` MUST have at least one no-mock
   integration test against real pdfmake** (lesson #140). The shipped
   tests cover sparse / null / empty docDef shapes; add to the same spec
   when new section types are added to the renderer.
7. **Email is sent synchronously + throws on failure** in the processor —
   NOT fire-and-forget like compliance. This divergence is deliberate
   (the "row says COMPLETED implies email delivered" consistency
   requirement). Do not refactor to `enqueueEmail()` without re-deriving
   why the spec mandates sync delivery.
8. **The HMAC secret env var addition pattern is the canonical model**
   for adding a new bare-HTTP token-gated endpoint. See lesson #141 for
   the 6-step checklist (no @Public, omit @UseGuards, Joi-require with
   min(32), HMAC-before-DB tested invariant, audit every outcome with
   wrapped audit-record).

### Verification honesty

2c is verified for:
1. **No-crash on real data** — renderer integration tests (`%PDF` /
   `%%EOF` against sparse / null / empty), backend unit tests
   (334/334 green), frontend unit tests (67/67 green).
2. **Security-floor invariants** — HMAC-before-DB regression, wrong-
   secret rejection, no-DB-on-failed-signature, audit-record wrap on
   download critical path.
3. **Boot health post-restart** — Both routes registered, cleanup
   scheduler initialised, Nest application successfully started.
4. **Bare-HTTP probe responses** — unauthenticated POST → 401
   (JwtAuthGuard rejecting), unauthenticated GET → 401 "Invalid
   download link." (verifier rejecting empty as malformed; controller
   maps to generic 401 body, no info leak).

2c is NOT verified for:
1. **Real SMTP delivery** — dev has no SMTP server (deployment gate).
2. **Real token-gated download** — bare-HTTP probe covers the gate but
   not the success-stream against a real issued token (deployment gate).
3. **Renderer against representative data** — sparse + null + empty
   covered, real ~10k-contract org data NOT covered (deployment gate).
4. **Cleanup cron at scale** — dev DB has 0 rows; planner pick of
   Bitmap Index Scan on partial index NOT yet proven at scale
   (deployment gate; same #135 inherited from 2a worst-finding query).

The four deployment gates are explicit, not buried. They go on the
deployment checklist.

---

## Phase 7.15 — Obligation Permission Model (shipped — 2026-06-01, PR #40)

**Scope:** Backend-only. Adds proper role-based access control to obligation mutation
endpoints, plus a middleware that resolves the route's `project_id` for the permission
guard. (NOTE: this phase does NOT add org-ownership verification — see the correction
below; that gap is closed in S0 + Option B.)

### What shipped

**`ResolveObligationProjectMiddleware`**
(`backend/src/common/middleware/resolve-obligation-project.middleware.ts`):
- Applied to all `/contracts/:contractId/obligations/*` routes
- **Resolves a `project_id`** for the request — looks up the contract (or obligation,
  for `/obligations/:id`) by id and attaches its `project_id` to `req.params` so the
  downstream `PermissionLevelGuard` can resolve project membership without an extra
  DB query
- **Does NOT verify org ownership.** It loads the contract/obligation by id with **no
  org filter**, never compares the contract's org to the caller's org, and **never
  throws** — the whole `use()` body is wrapped in a best-effort `try/catch` that always
  calls `next()`. A failed lookup silently falls through.
- Wired into `ObligationsModule` via `NestModule.configure()`

> **⚠️ CORRECTION (S0, 2026-06-08): a prior version of this section claimed the
> middleware "validates that the contract belongs to the requesting user's organization"
> and "returns 403 if the contract is not org-scoped to the requester's org." That was a
> FALSE security claim — the middleware does neither (see the two bullets above for what
> it actually does). The org-ownership gap on the obligation contract routes is closed by
> the route-level `ContractAccessService.findInOrg` wall added in S0 (see
> `docs/s0-pre-option-b-fixes.md`) and, ultimately, by the Option B scoped-repository
> chokepoint (see `docs/option-b-scoped-repository-audit.md`). Do NOT rely on this
> middleware as a tenancy boundary.**

**Role guards on mutation endpoints (`ComplianceObligationsController`):**
- `POST /contracts/:id/obligations/:oblId/assign` — `PROJECT_MANAGER+`
- `DELETE /contracts/:id/obligations/:oblId/assign/:userId` — `PROJECT_MANAGER+`
- `PUT /contracts/:id/obligations/:oblId/evidence` — `PROJECT_MANAGER+`
- `PATCH /contracts/:id/obligations/:oblId` — `PROJECT_MANAGER+`
- Read-only endpoints remain open to any authenticated user

**New test coverage:**
- `backend/src/modules/obligations/tests/obligations.controller.spec.ts` —
  12 new tests: 401 on unauthenticated, 403 on wrong role, 200/204 on correct role
  for assign, unassign, evidence update, inline patch
- `backend/src/modules/compliance/tests/compliance-obligations.controller.spec.ts`
  updated to reflect new guards

### Hard rules — never violate

1. **`ResolveObligationProjectMiddleware` always precedes `RolesGuard`** for obligation
   mutation routes — middleware populates `req.projectId` which role resolution depends on.
2. **Obligation read endpoints are intentionally NOT role-gated** — any authenticated
   org member can view obligations for a contract in their org.
3. **`PROJECT_MANAGER+` is the floor for mutations** — assigning obligations, attaching
   evidence, and patching status all require at least `PROJECT_MANAGER` role.

---

## Phase 7.24 — Knowledge Base Enhancements (shipped — 2026-06-01, PR #40)

Five sub-phases extending the knowledge asset system with backlinks, bulk import,
retry OCR, version history, and project-level scoping. All migrations are idempotent
(`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, no `EXCEPTION WHEN` blocks).

---

### Phase 7.24a — "Used In" Backlinks

**What shipped:**
- New entity `KnowledgeAssetUsage` (`backend/src/database/entities/knowledge-asset-usage.entity.ts`):
  `id`, `asset_id` (FK → `knowledge_assets`), `context_type` (VARCHAR 50),
  `context_id` (UUID), `used_at` (TIMESTAMPTZ).
- Migration `1751000000002-CreateKnowledgeAssetUsages.ts` — `knowledge_asset_usages`
  table + indexes on `asset_id` and `context_id`.
- `KnowledgeAssetsService.getUsages(id)` — returns backlink rows ordered by `used_at DESC`.
- `GET /knowledge-assets/:id/usages` endpoint.
- `compliance.service.ts` — best-effort backlink write on compliance check creation
  (fire-and-forget with `.catch()`, never blocks the check per lesson #114).
- Frontend: expandable "Used In" row in `KnowledgeAssetsPage`, populated lazily on expand.

**Hard rules:**
- Backlink writes are ALWAYS fire-and-forget — never `await` them in the compliance
  check hot path. The `.catch()` logs a warning but never rethrows.
- `context_type` values: `'COMPLIANCE_CHECK'` (currently). Add new context types as needed
  but keep them string constants, never a DB enum (no migration needed for new types).

---

### Phase 7.24b — Bulk Import

**What shipped:**
- `BulkCreateKnowledgeAssetDto` (`backend/src/modules/knowledge-assets/dto/bulk-create-knowledge-asset.dto.ts`) —
  shared metadata (title prefix, asset_type, jurisdiction, tags, project_id) applied to all files.
- `POST /knowledge-assets/bulk` — accepts multipart up to 20 files; returns
  `{ created: [...], duplicates: string[], failed: [...] }`.
- Partial-success: failing or duplicate files are reported without aborting the batch.
- `bulkCreate()` service method iterates files, calls the existing `checkDuplicate` hash
  guard, and inserts successful rows; collects per-file errors into the `failed` array.
- `knowledgeAssetService.bulkCreate(data)` frontend method added.

**Hard rules:**
- `POST /knowledge-assets/bulk` MUST return 200 even when some files fail — only 400 if
  ZERO files were supplied or DTO validation fails entirely. A partial result is not an error.
- Duplicate files are silently skipped (added to `duplicates[]`, not `failed[]`).

---

### Phase 7.24c — Retry OCR

**What shipped:**
- `POST /knowledge-assets/:id/retry-ocr` — re-queues OCR + embedding for a failed asset.
- Service sets `ocr_status = PENDING`, `embedding_status = PENDING` before dispatching
  the job so the frontend can observe the reset state.
- Frontend: "Retry OCR" button visible on assets whose `ocr_status === 'FAILED'`.

---

### Phase 7.24d — Version History

**What shipped:**
- New entity `KnowledgeAssetVersion` (`backend/src/database/entities/knowledge-asset-version.entity.ts`):
  `id`, `asset_id` (FK → `knowledge_assets` CASCADE), `version_number` (INT),
  `changed_by` (UUID FK nullable), `changer_name`, `change_summary`, `snapshot_data` (JSONB),
  `created_at`.
- Migration `1751000000003-AddKnowledgeAssetVersionHistory.ts` — `knowledge_asset_versions`
  table + unique index on `(asset_id, version_number)`.
- Snapshot is taken BEFORE the update is applied (pre-update state); `version_number`
  in the snapshot row = the current version before increment. Snapshot write is
  best-effort (wrapped in try/catch — failure never blocks the update).
- `GET /knowledge-assets/:id/versions` — returns list sorted by `version_number DESC`.
- `GET /knowledge-assets/:id/versions/:number` — returns full `snapshot_data` for a
  specific version.
- Frontend (`KnowledgeAssetsPage.tsx`): tabbed expandable row with "Used In" and
  "Version History" tabs. Tab switch to "Version History" lazy-loads the version list.
  Clicking a version row opens a snapshot modal showing all `snapshot_data` fields
  as a `<dl>` with `dir="auto"` on values.

**Hard rules:**
- Snapshot write MUST be wrapped in try/catch — a version save failure must NEVER
  block the asset update. Log the error; never rethrow.
- Snapshot captures the pre-update state. If a caller updates only `tags`, the snapshot
  still records the full entity so rollback / audit is meaningful.
- `version_number` starts at 1 (first version = before first edit). The entity column
  starts at `0`; the service increments BEFORE saving the snapshot.

---

### Phase 7.24e — Project Scoping

**What shipped:**
- Migration `1751000000004-AddKnowledgeAssetProjectScope.ts`:
  - `ALTER TABLE knowledge_assets ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL`
  - `CREATE INDEX IF NOT EXISTS idx_knowledge_assets_project_id ON knowledge_assets (project_id) WHERE project_id IS NOT NULL`
- `KnowledgeAsset` entity: `project_id: string | null` column + `@ManyToOne(() => Project)` relation.
- `KnowledgeAssetsService.findAll()`: three-tier visibility query:
  - Platform (no org, no project): `organization_id IS NULL AND project_id IS NULL`
  - Org-wide: `organization_id = :orgId AND project_id IS NULL`
  - Project-scoped: `organization_id = :orgId AND project_id = :projectId`
  - When `project_id` filter is supplied, all three tiers are returned; when absent, only platform + org-wide (backward-compatible).
- `CreateKnowledgeAssetDto` + `BulkCreateKnowledgeAssetDto`: `@IsOptional() @IsUUID() project_id?`.
- `ComplianceKnowledgeService.buildContext()`: accepts `projectId?: string | null`.
  Both `queryByTags()` and `queryByJurisdictionAndTags()` propagate `projectId` into
  their visibility filters (three-tier when `projectId` supplied; two-tier otherwise).
- `compliance.service.ts`: passes `contract.project_id ?? null` to `buildContext()` so
  compliance checks automatically use project-scoped KB assets.
- `GET /knowledge-assets` controller: accepts `?project_id=<uuid>` query param.
- Frontend (`KnowledgeAssetsPage.tsx`):
  - Project filter dropdown in the KB page header (populated from `projectService.getAll()` on mount).
  - New "Scope" column with badges: Platform (gray) / Org (blue) / Project (violet).
  - Project scope selector in the upload modal (hidden when org has no projects).
  - `knowledgeAssetService.getAll()` accepts `project_id` param.

**Three-tier visibility rules — never violate:**
1. An asset with `organization_id IS NULL AND project_id IS NULL` = platform asset — visible to everyone.
2. An asset with `organization_id = X AND project_id IS NULL` = org-wide — visible to members of org X.
3. An asset with `organization_id = X AND project_id = Y` = project-scoped — visible only when querying with `project_id = Y` (or higher-tier queries that include Y).
4. Project-scoped assets are ALWAYS returned alongside platform + org-wide when a `projectId` is supplied. Never filter them exclusively.
5. When `projectId` is NOT supplied, project-scoped assets are NEVER returned (two-tier only). This ensures the KB list page without a project filter doesn't silently mix scopes.

---

## Phase 7.25 — Poor Scan Quality Handling (shipped — 2026-06-01)

Detects low-quality scanned PDFs (blurry, low-contrast, skewed), parks processing in a new
`HUMAN_REVIEW_RECOMMENDED` terminal status, and shows an amber warning banner in the frontend
with per-flag explanations and a "Continue anyway" bypass.

### What shipped

**AI backend (`ai-backend/app/services/tesseract_text_extractor.py`):**
- New `_assess_quality(images: list[PIL.Image]) -> list[str]` — samples first 2 pages:
  - **Blur:** pure-numpy Laplacian via `np.lib.stride_tricks.as_strided`; variance vs `BLUR_THRESHOLD=50.0`
  - **Contrast:** `PIL.ImageStat.Stat(img.convert("L")).stddev[0]` vs `CONTRAST_THRESHOLD=20.0`
  - **Rotation:** `pytesseract.image_to_osd(img, output_type=DICT)` on page 1 only; wrapped in `try/except` so OSD failures never block extraction; vs `ROTATION_THRESHOLD=10.0`
  - Returns flag strings: `"blur:32.1"`, `"contrast:15.4"`, `"rotation:12"`
- New `_enhance_image(image, flags) -> image` — applies `PIL.ImageOps.autocontrast(cutoff=2)` for contrast flags, `image.rotate(-degrees, expand=True, fillcolor=(255,255,255))` for rotation ≥ 5°; returns same object if no flags
- `_ocr_pdf()` now returns `tuple[str, list[str]]`; calls `_assess_quality` after `convert_from_path`, applies `_enhance_image` per image when flags fire
- `extract_pdf()` return type changed to `tuple[str, list[str]]`; digital PDF fast path returns `(text, [])`
- `run_extract_text` in `tasks.py` calls `result.setdefault("quality_flags", [])` — key always present regardless of file type
- 3 new settings in `settings.py`: `BLUR_THRESHOLD`, `CONTRAST_THRESHOLD`, `ROTATION_THRESHOLD`

**Backend (NestJS):**
- Migration `1751000000005-AddHumanReviewQualityFlags.ts` — `transaction = false` (required for `ALTER TYPE ADD VALUE`):
  - `ALTER TYPE document_processing_status_enum ADD VALUE IF NOT EXISTS 'HUMAN_REVIEW_RECOMMENDED'`
  - `ALTER TABLE document_uploads ADD COLUMN IF NOT EXISTS quality_flags VARCHAR[] NULL`
- `DocumentProcessingStatus.HUMAN_REVIEW_RECOMMENDED` added to enum in `document-upload.entity.ts`
- `quality_flags: string[] | null` column on `DocumentUpload` entity
- `document-processing.service.ts`:
  - `pollAndAdvance()` terminal-state guard extended to include `HUMAN_REVIEW_RECOMMENDED`
  - After text extraction: reads `quality_flags` from AI result; if non-empty → saves flags to DB, sets status to `HUMAN_REVIEW_RECOMMENDED`, returns early (skips clause extraction)
  - `reprocess()` resets `quality_flags = null` before re-queuing

**Frontend (`apps/sign/src/components/common/ProcessingStatusCard.tsx`):**
- `HUMAN_REVIEW_RECOMMENDED` entry in `STAGE_CONFIG` — amber `bg-amber-500`, label from i18n key
- Stage dots: `effectiveStatusForDots()` maps `HUMAN_REVIEW_RECOMMENDED` → `EXTRACTING_TEXT` (branch state, not linear)
- Amber border/background warning banner when status is `HUMAN_REVIEW_RECOMMENDED`
- `parseQualityFlag(flag, t)` helper: parses `"blur:32.1"` → translated message with measured value
- Per-flag messages with `dir="auto"` (Arabic-safe)
- Re-upload tip and "Continue anyway" button (calls `onRetry` → `reprocess()`)
- i18n keys added to EN / AR / FR in `apps/sign/src/i18n/locales/*/common.json`:
  - `document.processing.humanReviewRecommended`, `reuploadTip`, `continueAnyway`
  - `document.processing.qualityWarning.blur`, `contrast`, `rotation`

**Tests (`ai-backend/tests/test_quality_detection.py` — 7 new tests):**
- T1: clean checkerboard → no flags
- T2: solid grey → blur flag (score < 50)
- T3: solid pale → contrast flag (score < 20)
- T4: contrast flag → `_enhance_image` returns PIL Image
- T5: rotation flag ≥ 5° → `_enhance_image` applies rotate, returns PIL Image
- T6: no flags → `_enhance_image` returns same object (`is img`)
- T7: `run_extract_text` always includes `quality_flags` key in result dict

### Migration fix documented — lesson #143
`ALTER TYPE` in NestJS migrations must use the PostgreSQL type name `document_processing_status_enum`
(TypeORM appends `_enum` suffix), NOT the bare TypeScript enum name. See lesson #143.

### Hard rules — never violate
1. **`quality_flags` is always present in `run_extract_text` result** — never check with `if 'quality_flags' in result`; use `result.get('quality_flags', [])` or the guaranteed `setdefault`.
2. **`HUMAN_REVIEW_RECOMMENDED` is a terminal state** — `pollAndAdvance()` returns early on it exactly like `FAILED`. The only exit is `reprocess()`.
3. **`reprocess()` MUST clear `quality_flags = null`** before re-queuing. Stale flags would re-trigger the amber banner on the retry attempt even if the new upload is clean.
4. **OSD failures are silent** — `pytesseract.image_to_osd()` is wrapped in `try/except`; if the OSD language pack is absent or the page has no text, rotation check is skipped, never blocking extraction.
5. **Partial text is preserved** — when quality flags fire, `extracted_text` is still saved to DB. `HUMAN_REVIEW_RECOMMENDED` only skips clause extraction, not text storage.
6. **TypeORM enum type names use `_enum` suffix** — any `ALTER TYPE` migration on a TypeORM-managed enum must target `<snake_case_column_name>_enum`, not the TypeScript enum name. See lesson #143.

---

## Phase 7.26 — i18n Completion — Track A (shipped — 2026-06-02)

Closed all missing i18n keys in the EN and AR locale files. FR was already structurally
complete. Track B (legal page localization into FR + AR) is deferred pending legal team
translated content.

### Investigation findings (pre-implementation audit)

**FR locale (`fr/common.json`):** Structurally complete — every EN key is present including
`portal.*`, `userType.*`, all 39 `nav` keys, all Phase 7.25 `document.processing.*` keys,
full `portfolio.*` section. FR had one key EN was missing: `language.fr = "Français"`.
The 8 `_TODO_*` keys in `obligation.type` are internal annotation markers for legal-translator
review (lesson #16); no component ever calls `t('obligation.type._TODO_*')`. No work needed on FR.

**AR locale (`ar/common.json`):** 4 confirmed gaps:
1. `portal` section entirely absent — `portal.client`, `portal.guest`, `portal.admin`
2. `userType` section entirely absent — `userType.managingParty`, `userType.respondingParty`, `userType.individual`
3. `nav` section missing 4 of 39 keys: `operationsReview`, `auditLog`, `billing`, `accountSettings`
4. `language.fr` missing — FR option label in LanguageToggle renders raw key `"language.fr"` when UI is in Arabic

**EN locale (`en/common.json`):** Missing `language.fr` — LanguageToggle reads this key to
label the French option; silently falls back to key name.

**Legal pages:** 11 pages under `apps/sign/src/pages/legal/` use hardcoded TypeScript content
objects in `content/*.content.ts` — NOT in the i18n JSON system. English-only. FR and AR
versions do not exist. Adding them requires Option B (per-locale content files) — see Track B.

### What shipped — Track A (12 keys)

**`apps/sign/src/i18n/locales/en/common.json`:**
- Added `"fr": "French"` to `language` section

**`apps/sign/src/i18n/locales/ar/common.json`:**
- Added `"fr": "الفرنسية"` to `language` section
- Added `portal` section: `{ client: "بوابة العميل", guest: "بوابة الضيف", admin: "لوحة الإدارة" }`
- Added `userType` section: `{ managingParty: "الطرف المُدير", respondingParty: "الطرف المُستجيب", individual: "ممارس مستقل" }`
- Added 4 nav keys: `operationsReview: "مراجعة العمليات"`, `auditLog: "سجل التدقيق"`, `billing: "الفواتير"`, `accountSettings: "إعدادات الحساب"`

### Track B — deferred (legal page localization)

Legal pages are outside the i18n system entirely. Adding FR + AR requires:
- Option B (correct approach): 10 content files × 2 new locales = 20 new `.content.ts` files
  + component-level locale selector in each page (`lang === 'fr' ? contentFr : lang === 'ar' ? contentAr : contentEn`)
- The 20 content files require qualified legal translator content — do NOT machine-translate
  Terms of Service, Privacy Policy, or compliance-related policies
- Regulatory note: GDPR + French Loi Toubon may require French-language legal pages for EU users

**Track B is gated on:** legal team providing translated content. Engineering scaffolding
(Option B component pattern) is ~1 day; translation is the long pole.

### Hard rules — never violate
1. **Audit ALL three locales (EN/AR/FR) when any i18n task names one language.** A task
   titled "French completion" revealed EN was missing `language.fr`. See lesson #144.
2. **`_TODO_*` keys in `obligation.type` are internal annotations — never delete them.**
   They mark terms awaiting legal-translator review (lesson #16). Only remove after
   a qualified legal translator has reviewed and approved the adjacent translation.
3. **Legal page content is outside the i18n JSON system.** Adding a new locale key to
   `common.json` has zero effect on `/legal/*` page content. Legal pages require the
   Option B per-locale content-file pattern; do not attempt to put 1000+ word legal
   documents into `common.json`.
4. **LanguageToggle requires `language.<code>` key in ALL locales.** When a new locale is
   added (e.g. adding Spanish), add `"es": "Spanish"` / `"es": "الإسبانية"` / `"es": "Espagnol"`
   to all three `language` sections in the same commit — otherwise the switcher label
   degrades to the raw key string in any locale missing it.

---

## Metering Engine Invariants — Phase 7.18 (shipped 2026-06-04)

The metering engine is the shared primitive every metered surface in the platform
(compliance, risk, AI assistant, upload-extraction; Part 2 wiring) gates through.
Engine-only on commit `dc31bb6`; consumer wiring is Part 2. These invariants are
proven by 20 real-Postgres tests (`backend/src/modules/metering/tests/`) and MUST
hold for any future change to the engine OR any future consumer that calls it.
ARCHITECTURE RULES Rule 9 is the spine pointer back to this section.

### 1. Metering subject is ALWAYS derived `contract → project → project.organization_id`

`MeteringResolver.resolveMeteringSubject()` walks the contract row to its project
to the project's `organization_id`. This works UNIFORMLY for all three Bucket-1
caller shapes (managing user, guest user row, viewer credential). A guest's
`User.organization_id` is **never** trusted as the metering subject — it is
attribution metadata only.

For managing-user callers, the JWT `organization_id` is used **only as a
defense-in-depth cross-check** against the derived org; on mismatch, the
resolver throws + logs `metering.resolveSubject: cross-tenant signal`. Never
silently proceed. This is the same class of security regression PR #42 closed
at the contract-read layer.

Implementation: `backend/src/modules/metering/services/metering-resolver.service.ts`.

### 2. `reserve()` uses an ATOMIC CONDITIONAL UPDATE — DELIBERATE exception to the pessimistic_write idiom

Bucket 1's `establishIdentity` is the canonical transaction shape:
`dataSource.transaction()` + `setLock('pessimistic_write')` + defensive re-check.
It is correct for "load row → branch in app code → write back" flows.

The metering reserve path replaces `setLock` with a single conditional UPDATE:

```sql
UPDATE metering_balance
SET    consumed = consumed + :amount, updated_at = NOW()
WHERE  subject_ref = :s AND meter_key = :k AND window_key = :w
  AND  consumed + :amount <= :limit
RETURNING consumed;
```

The affected-row count IS the gate. Postgres holds the row lock only for the
statement's duration (not across an app round-trip). Under READ COMMITTED,
concurrent writers serialise via EvalPlanQual and re-evaluate the predicate.
Proven by N=50 / M=5 race tests with zero oversell.

**This inconsistency with `establishIdentity`'s `setLock` shape is INTENTIONAL.**
Future single-hot-row counters should follow this pattern, NOT `pessimistic_write`.
Do not "fix" the inconsistency.

### 3. Idempotency = INSERT-FIRST + ON CONFLICT DO NOTHING + return-existing (Pattern C)

The reserve path's FIRST action inside the transaction is an INSERT against the
ledger's unique index `uq_metering_ledger_subject_meter_idem` on
`(subject_ref, meter_key, idempotency_key)`. ON CONFLICT DO NOTHING is the gate:
RETURNING yields one row → the winner runs the capacity decrement; RETURNING
yields zero rows → the loser SELECTs the existing row and returns it as
`{reused:true}`.

- Concurrent retries with the same key NEVER surface a raw 23505 to the caller.
- The capacity decrement runs ONLY on the winner; losers never decrement.
- If the capacity decrement fails (limit reached), the txn rolls back AND the
  just-inserted ledger row rolls back with it — the idempotency claim does not
  persist when capacity was denied. A retry-after-capacity-frees is clean.
- Pattern C lookup covers the row's whole lifetime (reserved / committed /
  released) — a same-key retry after `commit()` returns the committed
  reservation; no double-charge.

New at-most-once side effects in the codebase should align to this shape rather
than invent a new idempotency contract. The closest precedents are
`guest_invitations` revoke/exchange (Phase 7.18 Bucket 1) and obligation-token
single-use-via-nonce (Phase 3.4); use Pattern C here over either of those.
See lesson #150 for why existence-check-then-insert is racy and insert-first
is the fix.

### 4. `commit()` and `release()` are status-guarded with AT-MOST-ONCE refund

Both transitions use a single conditional UPDATE keyed on the current status:

```sql
UPDATE metering_ledger SET status='committed', committed_at=NOW()
WHERE  reservation_id = $1 AND status = 'reserved';
```

The affected-row count is the gate. The refund (`UPDATE metering_balance
SET consumed = consumed - :amount`) runs ONLY when the status UPDATE actually
flipped a row — gated on `affected = 1` from `RETURNING`. Re-release, commit-
after-sweeper, and release-of-committed are NO-OPs that return
`{applied:false, status:<current>}` rather than throwing. Refund is at-most-
once across any number of concurrent commit / release / sweeper callers.

The dangling-reserve sweeper (`releaseByLedgerId`) follows the same shape with
an additional `AND expires_at < NOW()` guard.

`release()` does NOT clamp with `GREATEST(consumed - amount, 0)`. The DDL
`CHECK (consumed >= 0)` is the drift-detector — a CHECK violation rolls back
the status flip and refund together, surfacing inconsistency rather than
silently underflowing. See lesson #149 for the read-then-write pattern this
replaced and why.

### 5. Allowance precedence: `subject_allowance → plan_allowance → meter_definition.default_limit`. `limit = 0` is BINDING.

`MeteringResolver.resolveLimit()` branches on **row presence**, never on the
`limit` field's value. A row with `limit = 0` propagates as binding — meter
disabled, deny anything ≥ 1. The 0 is NEVER coalesced away to a lower tier.

**Do NOT refactor to `subject?.limit ?? plan?.limit ?? default_limit`.** That
chain is almost right but subtly wrong if a later edit downgrades `??` to `||`
— a `limit = 0` would then be coalesced away. The explicit
`if (row) return row.limit` shape is the canonical form; keep it.

`getOrgSubscription()` from the existing `SubscriptionsService` is the SINGLE
source for the org-plan lookup. Do not invent a second org→plan resolver.

### 6. READ COMMITTED is a STARTUP-ENFORCED invariant

`MeteringService.onModuleInit()` runs `SHOW transaction_isolation` once at
boot and refuses to start if the result is not `'read committed'`. The
reserve / commit / release gates rely on Postgres READ COMMITTED semantics
(EvalPlanQual under concurrent UPDATEs; per-statement snapshots under
ON CONFLICT + same-txn SELECT). REPEATABLE READ or SERIALIZABLE would
require a different gate design (`40001 serialization failure` retry
loops); the engine does NOT handle that today.

An ops change to `default_transaction_isolation` MUST be paired with a
deliberate redesign of the gates — the startup assertion forces the
conversation rather than letting silent corruption ship.

**Open caveat (Part 2 staging-gate):** the startup assertion only validates
the connection the boot process happens to take from the pool. It does NOT
prove that every pooled connection runs READ COMMITTED under load (e.g. a
PgBouncer transaction-mode pooler can rewrite session state). The first
consumer wiring must add a per-connection or per-transaction probe under
representative load before this invariant can be considered closed at scale.

### 7. Meter limits are Ops-configured. `default_limit` is a PLACEHOLDER.

The migration seeds `meter_definitions.compliance` with `default_limit = 1000`
as a generous placeholder. Real per-plan caps live in `plan_allowances`; per-
org overrides in `subject_allowances`. NEVER hardcode a limit value in
application code, and NEVER treat the seeded `1000` as authoritative — the
real numbers come from Youssef + Ayman with cost data, set via the admin
portal at wiring time.

Only the `compliance` meter_definition row is seeded in Part 1. The other
three meter_keys (`risk`, `ai_assistant_message`, `upload_extraction`) are
DEFINED in the closed enum but intentionally NOT seeded — their rows land
when each consumer is wired in Part 2 (with windows + fail_modes decided
then).

### Consumer wiring is Part 2 — DO NOT call `MeteringService.reserve()` from any controller yet

The engine is shipped; consumer wiring lives in Part 2 and is the next
well-scoped unit of work. The eventual wire points are the four meter_keys
above; the primary seam is `guest-invitation.service.ts:445-451`'s
`TODO(upload-bucket, depends: metering)`. Part 2 will also decide whether
`RESERVATION_TTL_SECONDS` (currently a module const, 1h) needs to be
promoted to env-driven — paired with its Joi entry + `.env.example` line
in the same commit per Phase 1.5 hard rule.

---

## ContractShare Deprecation — Step 1 (shipped — 2026-06-05)

Security hardening and dead-code removal from the `contract-sharing` module. First step
in a planned phased deprecation of `ContractShare` in favour of `GuestInvitation`
(Phase 7.18 bucket 7) for external counterparty access.

### What shipped

- **Removed unauthenticated `GET /contract-sharing/shared/:token` endpoint.** The route
  returned full contract data (including all clauses and risk analyses) to any caller with
  a share token — no JWT required, no rate limit, no audit log. The route was dead: the
  corresponding frontend page (`/shared/:token`) never existed in `App.tsx`, so no real
  user flow ever hit it. Deleted from controller + `getContractByShareToken()` deleted from
  service. `BadRequestException` import removed (was only used by the deleted method).

- **Removed broken external email path from `createShare()`.** The `else` branch sent a
  `contractSharedEmail` containing `${frontendUrl}/shared/${token}` — a link to the same
  nonexistent `/shared/:token` route. External recipients received an email with a 404
  link. Replaced with a `logger.warn()` noting that external sharing is pending
  GuestInvitation wiring (bucket-7 TODO preserved). Share row is still created; no broken
  email is sent.

- **Deleted `sendContractShared()` from `NotificationDispatchService`** and
  **`contractSharedEmail()` from `templates/index.ts`** — both were only called by the
  removed external branch. Zero remaining callers.

- **Fixed `getSharesByContract()` cross-tenant info disclosure.** The method previously
  queried `{ contract_id: contractId, is_active: true }` with no organisation filter —
  any authenticated user could list active shares for any contract in the platform.
  Added `orgId: string` param; method now verifies `contract.project.organization_id ===
  orgId` (same pattern as `createShare()`) before returning shares. Controller passes
  `@OrganizationId() orgId` from the JWT. Lesson #151 grep pattern applied.

- **Frontend: external sharing disabled with "coming soon" messaging.**
  - `handleShareEmailChange` now sets `shareIsInternal(false)` when debounced search returns
    empty (email not found in this org).
  - Amber warning banner below the email field: "External sharing coming soon. External
    counterparties are invited via the Guest Portal — available in the next release."
  - Share button disabled and label changes to "External sharing coming soon" when
    `shareIsInternal === false`.
  - Internal sharing (org-member suggestions → ProjectMember + in-app notification)
    completely unchanged.

- **Removed dead `accessShared()` from `contractSharingService.ts`** (frontend). Called
  the deleted `GET /contract-sharing/shared/:token` endpoint; no component ever imported
  or called it.

### What remains intact (working pieces, do NOT touch)

- `POST /contract-sharing` — create share (JWT, org-scoped) ✅
- `GET /contract-sharing/org-members?q=` — autocomplete search ✅
- `GET /contract-sharing/contract/:contractId` — list shares (JWT, now org-scoped) ✅
- `DELETE /contract-sharing/:id` — revoke share (JWT, user-scoped) ✅
- Internal share notification (ProjectMember upsert + in-app + email) ✅

### What's deferred (ContractShare Step 2)

Remove the entire `ContractShare` module once `GuestInvitation` email delivery
(Phase 7.18 bucket 7) ships. At that point:
- Wire external `createShare()` to create a `GuestInvitation` row instead of a
  `ContractShare` row.
- Migrate `searchOrgMembers` to `contracts.controller.ts` or a dedicated autocomplete
  endpoint.
- Hard-delete the `contract_shares` table in a migration.

### Hard rules — never violate

1. **`GET /contract-sharing/shared/:token` is permanently gone.** Do not re-add a
   public unauthenticated contract-read endpoint. External access is via GuestInvitation
   with HMAC-signed tokens + progressive identity (Phase 7.18 bucket 1b-i). See lesson
   #141 (bare-HTTP threat model).
2. **`getSharesByContract()` MUST keep the org-scope check.** Removing it re-opens the
   cross-tenant info disclosure. The fix is the same pattern as `createShare()` —
   contract → project → organization_id.
3. **Never ship an email that links to a frontend route before verifying the route exists**
   in `App.tsx`. See lesson #152.

---

## Internal Contract Sharing Fix (shipped — 2026-06-04, PR #47)

Closed a cross-tenant data access bug in `ContractSharingService.createShare()` (same class as PR #42), added internal-user enrichment (ProjectMember creation + in-app + email notification), and org-member autocomplete for the share modal.

### What shipped

**Backend (`backend/src/modules/contract-sharing/`):**
- **`dto/create-share.dto.ts`** (new) — `@IsUUID contract_id`, `@IsEmail @MaxLength(255) shared_with_email`, `@IsIn(['view','comment','edit']) permission`, `@IsInt @Min(1) @Max(365) expires_in_days`. Replaces raw `@Body()` inline object (Phase 3.3 rule).
- **`contract-sharing.module.ts`** — added `TypeOrmModule.forFeature([User, ProjectMember])`, `NotificationsModule`, `ConfigModule`.
- **`contract-sharing.service.ts`** changes:
  - `createShare()` now verifies `contract.project.organization_id === orgId` — returns 404 if the contract doesn't belong to the caller's org (lesson #145 pattern, same as PR #42).
  - After save: looks up recipient by `{ email, organization_id: orgId }`.
  - **Internal path** (recipient found): upserts a `ProjectMember` row (`permission_level` mapped from share permission: `view→VIEWER`, `comment→COMMENTER`, `edit→EDITOR`); fires `NotificationDispatchService.dispatch()` with `NotificationType.BOTH` (in-app + email).
  - **External path** (no org match): calls existing `sendContractShared()` (email only, no ProjectMember).
  - New `searchOrgMembers(orgId, q)` — ILIKE search on email/first_name/last_name within org, `escapeLikeParam()` applied, max 10 results.
- **`contract-sharing.controller.ts`** — `@OrganizationId()` injected on `createShare()`; new `GET /contract-sharing/org-members?q=` endpoint (JWT-guarded).

**Frontend:**
- **`contractSharingService.ts`** — `ShareResult` type with `isInternal: boolean` + `recipientName?: string`; `searchOrgMembers(q)` method.
- **`ContractDetailPage.tsx`** — debounced autocomplete on the email input (300 ms), dropdown showing org member suggestions with "Internal" badge; success message distinguishes internal ("Access granted to X — they've been notified") vs external ("Share link sent to Y").

**i18n** — `sharing.*` section (9 keys: `emailLabel`, `internal`, `external`, `sendButton`, `activeShares`, `successInternal`, `successExternal`, `searching`, `placeholder`) added to EN/AR/FR with exact parity.

### CONTRACTOR_* Role Audit — No Code Changes

Full audit of `CONTRACTOR_ADMIN`, `CONTRACTOR_TENDERING`, `CONTRACTOR_USER`, `CONTRACTOR_VIEWER` roles:
- All 4 values are active in 13 locations: route guards, redirect logic, permission checks.
- `ContractStatus.CONTRACTOR_REVIEWING` and `ObligationType.CONTRACTOR_OBLIGATION` share the `CONTRACTOR_` prefix but are in DIFFERENT enums — must never be removed with user-role cleanup.
- **Removal is BLOCKED until Phase 7.18 (Guest Portal) ships.** Safe removal sequence: (1) Add new guest/restricted-user roles; (2) migrate all 13 call sites; (3) run with dual values; (4) `DROP` old enum values from PostgreSQL in a separate migration after old values confirm zero rows.

### Hard rules — never violate
1. **`createShare()` MUST verify `contract.project.organization_id === orgId`** before creating any share row. This is the org-scope gate — removing it re-opens the cross-tenant vulnerability.
2. **`ProjectMember` upsert is best-effort** — the `catch` in `upsertProjectMember()` logs and silently continues (race conditions produce a duplicate key; that's fine). Never rethrow from this helper.
3. **`notifyInternal()` is best-effort** — wrapped in try/catch, never throws. A notification failure must never roll back the share creation.
4. **`searchOrgMembers()` MUST use `escapeLikeParam()`** on the query before wrapping in `%`. Same rule as all 8 ILIKE sites hardened in Phase 3.1.
5. **Do NOT remove `CONTRACTOR_*` UserRole values until Phase 7.18 ships** and the 13 call sites are migrated. Removing them early causes silent runtime errors on every route that uses those roles.

---

## Phase 7.18 Part 2 — Compliance metering consumer (shipped 2026-06-06)

First wired consumer of the metering engine. Squash commit `49f785f` (PR #49). Sits
on top of the engine PR #46 (`9200f38`) and the compliance access-wall PR #45
(`63a9ed6`).

**Scope of this section:** the consumer's wiring + the observable signals + the
deferred staging-gate posture. The engine's seven invariants live in ARCHITECTURE
RULES Rule 9 and the "Metering Engine Invariants — Phase 7.18 (shipped 2026-06-04)"
section earlier in this file; this section does NOT restate them — it documents
the FIRST consumer pattern, which future consumers (risk, AI assistant chat,
guest upload-extraction) must follow.

### Consumer surface
- Route: `POST /api/v1/contracts/:contractId/compliance-checks` (managing-user
  compliance run; `runCheck`).
- Reconciled lazily via `GET /api/v1/contracts/:contractId/compliance-checks/:checkId`
  which calls `refreshFromAi(checkId)`.

### Async reconcile shape
HTTP request flow (synchronous, inside `runCheck`):
1. `JwtAuthGuard` (controller level).
2. **`assertContractInCallerOrg(contractId, user)`** (the PR #45 access wall) —
   the wall runs BEFORE reserve. Reserve trusts `contractId` only because the
   wall already authorized it.
3. **`MeteringService.reserve({caller, meterKey: COMPLIANCE, amount: 1,
   idempotencyKey: randomUUID(), contractId, actorRef: userId, …})`** —
   capacity-failure throws `MeterLimitExceededError` (envelope:
   `{statusCode: 403, error: 'METER_LIMIT_COMPLIANCE', message:
   'Meter limit reached for compliance: <current>/<limit> already consumed
   in the current window.'}`). No check row, no AI dispatch on cap failure.
4. Load contract + project + clauses; create `ComplianceCheck` row with
   `reservation_id` set.
5. **Sync fail path #1 (no clauses):** release reservation; throw 400.
6. **Sync fail path #2 (AI dispatch threw):** release reservation; re-throw.
7. Return `ComplianceCheck` (PENDING).

Reconcile flow (lazy, user-driven via GET):
1. PR #45 wall walks `check.contract_id` and asserts org match.
2. `refreshFromAi(checkId)` polls the AI job.
3. On **terminal SUCCESS** (`persistFindings` + `startObligationExtraction`):
   **`commitReservationOnSuccess`** is called. `{applied: false}` from the
   engine means a peer (almost always the sweeper because the run outlived
   `RESERVATION_TTL_SECONDS = 3600`) released first; an OBSERVABLE warn fires
   (signal name below).
4. On **terminal FAILURE** (AI job reported failed): **`releaseReservationOnFailure`**
   is called. `{applied: false}` from a peer (sweeper / double-poll) gets the same
   observable treatment.
5. Never-polled runs rely on the engine's sweeper (every 5 min, dangling reserves
   with `expires_at < NOW()`). Fail-safe direction: over-deny, never oversell.

The internal `startObligationExtraction` (after `persistFindings` in the success
branch) is an **AUDIT POINT, NOT a second reserve.** It rides inside the compliance
intent today. **When obligations becomes its own meter dimension later**
(`meter_key = 'obligations'`), this is the §2.3 bypass point that needs its own
reserve.

### Reservation linkage (the only schema touch outside the engine)
Migration `1754000000001-AddReservationIdToComplianceChecks.ts`:
- `ALTER TABLE compliance_checks ADD COLUMN IF NOT EXISTS reservation_id UUID NULL`
- Partial index `(reservation_id) WHERE reservation_id IS NOT NULL` for ops
  "show me the reservation behind this check" queries.
- **NO foreign key to `metering_ledger.reservation_id`** — attribution, not
  ownership. Mirrors the engine's own choice on `ledger.actor_ref` / `contract_ref`
  (a future ledger-retention prune MUST NOT cascade into compliance).
- NULLABLE because pre-existing rows pre-date metering and synchronous-failure
  runs never persist a check row.

### Four ops-search log signal names
Wire these to log search / alerting:

| Signal | Site | Means |
|---|---|---|
| `metering.compliance.committed_after_release` | `commitReservationOnSuccess` warn path | Run succeeded but reservation was already released (sweeper / peer). Run was NOT charged. |
| `metering.compliance.released_after_terminal` | `releaseReservationOnFailure` warn path | Failure release found a peer won the race. Idempotent; refund already applied. |
| `metering.compliance.commit_error` | `commitReservationOnSuccess` catch | Engine `commit()` threw. Vanishingly rare; loud if it fires. |
| `metering.compliance.release_error` | `releaseReservationOnFailure` + the sync-failure release catch | Engine `release()` threw. Original failure error still rules; metering is best-effort here. |

### Idempotency v1 limitation (locked posture)
Compliance is intentionally **non-idempotent across distinct user clicks**
(matches existing behaviour pre-metering). The engine's `idempotency_key` is
a fresh `randomUUID()` per call — it dedupes only an in-flight retry of the
SAME reserve, NOT a user clicking "Run check" twice.

Two distinct clicks = two distinct reservations = two distinct charges. Until
a client-supplied `Idempotency-Key` HTTP header convention lands (audit §9.2
deferred), the **frontend must own the click-disable / double-submit guard**.

### Hard rules for future consumers — never violate
1. **Reserve sits DOWNSTREAM of the contract-access wall.** Never reserve before
   the access gate has authorized the contract_id. The engine's JWT cross-check
   in `resolveMeteringSubject` is defense-in-depth at the metering layer; it is
   NOT the access gate.
2. **The reserve idempotency_key is a fresh `randomUUID()` per call** unless and
   until a client `Idempotency-Key` header convention lands. Do not reuse it
   across distinct user intents.
3. **Every consumer MUST inspect `TransitionResult` from `commit()` and `release()`**
   and emit an OBSERVABLE log + metric on `{applied: false}`. Never swallow it.
   Use the `metering.<surface>.{committed_after_release|released_after_terminal|commit_error|release_error}`
   naming convention so a single search across all consumers finds every
   applied:false occurrence.
4. **Persist the `reservation_id` on the consumer's domain row** so the lazy
   reconcile path (poll, webhook, scheduled job — whatever the consumer uses)
   can find it. Use a nullable column, no FK to `metering_ledger`.
5. **Both synchronous and asynchronous failure paths MUST release.** Synchronous
   failure releases in-request before re-throwing; asynchronous failure releases
   in the terminal handler. Never-polled / never-reconciled runs rely on the
   engine sweeper — that's the v1 backstop, fail-safe toward over-denial.
6. **Internal sub-calls (like compliance's `startObligationExtraction`) that
   dispatch a SECOND AI agent ride inside the FIRST intent's reservation and
   are NOT separately metered** — UNTIL that sub-call gets its own `meter_key`,
   at which point it becomes a bypass point and needs its own reserve.

### Staging gate is a Phase 9 release-gate, NOT a merge-gate
The runbook `docs/metering-part2-staging-gate.md` (committed to main as part of
the PR #49 squash) contains 7 items (G.1–G.7) that exercise the engine + consumer
under representative load: pooled-connection READ COMMITTED probe, p99 reserve→
commit vs `RESERVATION_TTL_SECONDS`, the scheduled sweeper actually releasing an
expired reserve (NOT hand-run SQL), capacity gate under realistic concurrent
volume, the migration in the deploy pipeline, the metering specs running against
real Postgres on staging (CI skips them per #46), and the frontend double-submit
guard.

**These attach to the Phase 9 production cut, not to the consumer PR.** The
substantive Part 2 lessons (TTL-vs-p99 tuning, sweeper-at-scale behaviour,
applied:false alert cadence) are deliberately deferred to that pass — same
discipline as engine lessons #148–#150 which were earned by failing tests, not
written ahead of evidence.

---

## Phase 7.27 — Legal Corpus (shipped 2026-06-10)

Country-agnostic, jurisdiction-scoped legal document corpus with semantic retrieval for AI consumers. First wired consumer: AI Chat (Phase E + async Option 2).

### Tables

**legal_sources** — catalog of legal content sources with per-source flags
- `id, name, base_url, jurisdiction, is_visual_order, force_ocr, notes`
- Seed: Egyptian Tax Authority (force_ocr=true, is_visual_order=false)

**legal_documents** — one row per ingested law/decree
- `jurisdiction` (varchar(10), DTO-allowlisted to EG/AE/SA/QA/UK — extend the allowlist to add countries)
- `source_type` (PRIMARY_TEXT | CURATED_SUMMARY)
- Law metadata: `title, law_number, law_year, gregorian_date, hijri_date, status` (IN_FORCE | AMENDED | REPEALED), `language` (varchar(5)[] for bilingual support)
- `source_id` FK → `legal_sources`
- `parent_law_id` self-FK (for "regulation implements law" relationships)
- `storage_key, extracted_text, content_hash`
- `embedding_status_enum` (PENDING | PROCESSING | INDEXED | FAILED) — TypeORM column, `_enum` suffix per lesson #143

**legal_document_chunks** — chunked text with embeddings
- `chunk_index, chunk_text, article_reference, token_count`
- `embedding vector(1536)` — NOT modeled in the TypeORM entity (Python owns writes via psycopg2; lesson #157)
- `jurisdiction` denormalized for index-only filter scans
- HNSW index: `m=16, ef_construction=64, vector_cosine_ops`

### Ingestion pipeline

Celery task `run_ingest_legal_document` (in ai-backend):
1. Admin uploads PDF → `POST /admin/legal-documents`
2. Backend stores file via `StorageService`, creates `legal_documents` row (status PENDING), dispatches the Celery task
3. ai-backend extracts text:
   - `force_ocr=true` branch: 300 dpi page-by-page OCR with per-page error isolation (lesson #160)
   - `force_ocr=false` branch: text-layer extraction (uses Phase 9.1c TextExtractorService abstraction)
4. NFKC normalize
5. If `is_visual_order=true` AND `force_ocr=false`: per-line Arabic word-order reversal (lesson #163)
6. Chunk: split at article boundaries (Arabic مادة and English Article, with Western or Arabic-Indic numerals); oversized articles (>6000 tokens via tiktoken cl100k_base) sub-split at sentence boundaries
7. Bulk insert chunks (embedding=NULL)
8. Embed in batches of 50 via OpenAI text-embedding-3-small; bulk UPDATE vectors. Bounded retry on transient errors (4 attempts, exponential backoff)
9. Mark INDEXED
10. `on_failure` backstop (lesson #161) catches OOM/SIGKILL/unhandled exceptions, marks doc FAILED with error message (status-guarded — never overwrites terminal states)

### Retrieval

`LegalDocumentsService.retrieveRelevantChunks(query, jurisdiction, topK)`:
- Embeds the query via `POST /agents/embed-query` (synchronous, not Celery — small enough for per-message use)
- SQL: `SELECT … FROM legal_document_chunks JOIN legal_documents WHERE jurisdiction = $2 AND status != 'REPEALED' ORDER BY embedding <=> $1 LIMIT $3`
- Returns top-K chunks with parent doc metadata for citation

### AI Chat consumer (Phase E + Option 2)

- Chat session is contract-scoped; jurisdiction derived as contract → project → country (display name normalized to ISO; lesson #165)
- When jurisdiction is in the allowlist, ChatService calls `retrieveRelevantChunks` with topK=5, formats results as `<legal_context jurisdiction="EG">…</legal_context>` block with citation instruction
- Block passed through existing `knowledge_context` parameter on the conversational agent (no new parameter added)
- When jurisdiction is absent or retrieval returns 0 chunks: silent fallback — chat proceeds without legal-context block, no error to user
- Conversational agent uses fence-strip + prose fallback for Claude's response (lesson #166)

### Async chat (Option 2)

- `chat_messages` table extended with `status, job_id, error_message` columns; `content` made nullable (migration 1755000000005)
- `POST /chat/sessions/:id/messages` creates user (COMPLETED) + assistant (PENDING) message rows, dispatches AI job, returns immediately
- `GET /chat/messages/:id/status` endpoint-triggered advancer: polls ai-backend, persists result when job done, idempotent on terminal rows
- In-flight messages older than 5 minutes auto-marked FAILED by next status check (staleness backstop)
- Frontend ChatPanel polls every 1.5 s, 90 s cap, resumes on page refresh

### Per-source flags

- `is_visual_order` (boolean) — PDF stores Arabic in visual (RTL-reversed) word order. Triggers per-line word reversal during chunking. Suppressed when `force_ocr=true`.
- `force_ocr` (boolean) — PDF's text layer has broken ToUnicode CMap (e.g. Egyptian Tax Authority kaf glyph mapped to wrong codepoint). Triggers page-by-page 300 dpi OCR. Lesson #162.

### Adding a new source

See NEXT_PHASES.md 7.27 "How to add a new country" — test PDF in a plain text editor → determine flags → SQL INSERT into `legal_sources` → upload via admin endpoint.

### Adding a new country

No code change required beyond the DTO `@IsIn` allowlist. Existing schema supports any jurisdiction string.

### Embeddings provider

OpenAI text-embedding-3-small (1536 dims, cl100k_base tokenizer). Same model as the Knowledge Base. **If this is ever swapped, ALL stored vectors must be re-embedded** — vectors from different models are not comparable.

### Known limitations (v1)

- No frontend admin UI for `legal_sources` — SQL-managed
- No scheduled crawlers — manual upload only (UAE federal crawler is on the deferred list since it's the one source verified license-permissive for automated access)
- No incremental updates — re-ingesting a document creates a new row; `content_hash` prevents exact duplicates but not amendments
- Dual-concept queries with secondary semantic load surface on-topic but not specifically-correct articles (e.g. "force majeure AND effect on contract" surfaces contract-effect articles higher than the dedicated force-majeure article). Tuning is deferred work.

### Hard rules — never violate

1. The embedding model is OpenAI text-embedding-3-small. Never embed legal chunks with a different model without a full re-embedding plan — vectors from different models are not comparable.
2. Source-level quirks (`is_visual_order`, `force_ocr`) must always be set per-source in `legal_sources`, never hardcoded in the pipeline. New sources require a manual evaluation before INSERT (see "Adding a new source").
3. `force_ocr=true` ALWAYS suppresses `is_visual_order` — OCR output is logical-order natively, applying bidi reversal corrupts it.
4. TypeORM entities must NOT include the `embedding` vector column. Python owns vector writes; TypeORM reads via raw SQL when needed (lesson #157).
5. Async chat: the status-poll endpoint is the ONLY path that advances message state; do not duplicate the polling logic elsewhere.
6. AI Chat must always silently fall back when no legal context is available. NEVER show users an empty `<legal_context>` block or a "no laws found" warning.

---

## Encryption-at-Rest Utility — CryptoService (shipped 2026-06-16, PR #73)

First encryption-at-rest primitive in the codebase. A standalone, security-focused
unit of work — the prerequisite for Phase 7.28 ERP credential storage. **Utility
only — no ERP code, tables, or endpoints** (those land with 7.28). PR #73
squash-merged to `main` at `b36b3d0`; CI green.

### What shipped
- **`backend/src/common/utils/crypto.ts`** — `@Injectable() CryptoService`, a GENERIC
  AES-256-GCM `encrypt(plaintext)` / `decrypt(payload)` for any string (not ERP-specific).
  - **Self-contained payload** `v1.<base64url(iv)>.<base64url(authTag)>.<base64url(ciphertext)>`
    — decryption needs only the stored value + the key. The `v1.` prefix reserves room
    for a future algorithm rotation.
  - **Random 12-byte IV per call** (`randomBytes(12)` inside `encrypt()`) — never a
    constant/field/derived value (IV reuse breaks GCM).
  - **Auth tag verified on decrypt** (`setAuthTag` before `final()`); a tampered payload
    or wrong key throws and is rethrown loudly — never swallowed.
  - **Key from `ERP_CREDENTIAL_ENC_KEY` via ConfigService** (no `process.env`, no
    hardcoded fallback), resolved lazily; SHA-256-derived to exactly 32 bytes.
    `encrypt`/`decrypt` throw a clear, var-named error when the key is missing or below
    the 32-char floor. No key material or plaintext in logs or error messages.
- **`backend/src/app.module.ts`** — Joi: `ERP_CREDENTIAL_ENC_KEY: Joi.string().min(32).optional().allow('')`
  — optional at boot (the app starts without it, like the other optional integration
  vars); rejects a non-empty value shorter than 32.
- **`backend/.env.example`** — documented entry (same-commit rule) with high-entropy
  generation guidance (`openssl rand -base64 48`) and an explicit anti-passphrase warning.
- **`crypto.spec.ts`** — 9 tests: round-trip (incl. unicode/empty), random-IV
  distinctness, tampered-payload rejection, malformed-payload rejection, wrong-key
  failure, missing-key + short-key errors, non-string guard.

See lesson #169 for the design rationale (the random-IV invariant; why a fast-hashed
key forces a high-entropy secret).

### Consumers (a SHARED primitive, not ERP-specific)
CryptoService is now exposed via a shared **`CryptoModule`** (`backend/src/common/crypto/crypto.module.ts`)
that provides + exports it; consumers import the module rather than re-declaring the provider:
1. **ERP credential storage** (Phase 7.28) — `erp_connections.credentials_encrypted`,
   encrypted in `ErpConnectionService`, decrypted only in the sync worker.
2. **MFA TOTP secret at rest** (Phase 7.35, PR #88) — `users.mfa_totp_secret`, encrypted
   on write in `AuthService.setupMfaTotp`, decrypted at use in `verifyMfa` / `enableMfaTotp`
   via a **version-prefixed dual-read** (`decryptTotp`: decrypt only when the value starts
   with `v1.`, otherwise treat as legacy plaintext and use as-is — the anti-lockout control).
   Forward-only idempotent migration `1759000000001` converts existing plaintext rows
   (`NOT LIKE 'v1.%'`, throws + modifies zero rows if the key is missing). See lesson #172.

### Hard rules — never violate
1. **`ERP_CREDENTIAL_ENC_KEY` MUST be a high-entropy random value** (`openssl rand -base64 48`),
   NEVER a memorable passphrase. The key is fast-hashed (SHA-256, not a slow KDF), so a
   guessable passphrase is brute-forceable.
2. **The same `ERP_CREDENTIAL_ENC_KEY` now encrypts BOTH ERP credentials AND MFA TOTP
   secrets** (Phase 7.28 + 7.35). Losing or rotating it makes BOTH undecryptable — a
   re-encryption migration (decrypt-with-old → encrypt-with-new) is required BEFORE any
   rotation; never rotate in place. The key is also **functionally required for MFA
   enrollment** (TOTP setup hard-fails / throws if it is absent — no silent plaintext
   fallback), so every environment must set it before 7.35 ships and before the
   `1759000000001` migration runs.
3. **Encrypted credential fields are decrypted ONLY at use time (inside the worker for
   ERP; at verify/enroll for MFA TOTP), and NEVER returned on an API response**
   (`@Exclude()` on the entity field, same convention as the existing MFA/secret fields).
4. **When migrating any other live secret onto CryptoService, use the dual-read +
   key-guarded forward-only migration pattern** from 7.35 (lesson #172) — do NOT decrypt a
   bare value that may still be legacy plaintext, or you risk locking users out.

**Testing note:** when testing a consumer's encrypt→decrypt round-trip, decrypt through the
SAME DI `CryptoService` instance the production path encrypts with (e.g. `moduleRef.get(CryptoService)`)
under a real production-shaped key — NEVER a hand-rolled second instance pinned to a dummy.
`@nestjs/config` gives `process.env` precedence over `load()` unless `ignoreEnvVars: true`, so
a second instance silently diverges from the real env key (green for the wrong reason when the
key is absent, red when it's present). See lesson #179.

---

## ERP Integration — Phase 7.28 (shipped, v1 + v1.1)

Per-org ERP integration (SAP / Oracle Primavera / Dynamics), import-only in v1.
Shipped end-to-end across PRs #73 (CryptoService prereq) · #79 (Part 1 backend) ·
#80 (Part 2a Client Portal) · #81 (Part 2b Admin Health) · #82 (v1.1 Part A
operator-control backend + circuit-breaker) · #83 (v1.1 Part B admin UI +
"who suspended"). Migrations `1757000000001-AddErpIntegration` (base) +
`1758000000001-AddErpOperatorControl` (operator-hold state machine). Module:
`backend/src/modules/integrations/`.

### Architecture
- **Per-org connector registry** — vendors map to adapters via Symbol DI tokens
  (`ERP_CONNECTOR_REGISTRY` / `ERP_CONNECTORS`, `useFactory`; lesson #113). The adapter
  is resolved at job time from the org's `erp_connections.vendor` row — NOT a global
  `ERP_PROVIDER` env var. Different orgs run different ERPs simultaneously. Adding a new
  ERP = one adapter file + one registry entry, zero core-engine changes.
- **Capability descriptors** — each adapter declares what it supports (import cost,
  export, health-check, field auto-discover); unsupported capabilities are flagged, not
  silently no-op'd. Mock adapter (dev/test) + SAP cost skeleton (capability-flagged,
  real API calls deferred to task 7.38).
- **Neutral cost model** (`erp_cost_records`) — vendor-agnostic; per-connection field
  mapping translates each ERP's raw field names into the neutral shape.
- **Sync via Bull queue** — async, import-only. Credentials encrypted at rest
  (CryptoService), decrypted ONLY inside the worker, never returned on any API response.
- **Operator-hold state machine** — `operator_hold_state`: `none` →
  `operator_suspended` (set by a SYSTEM_ADMIN) vs `auto_suspended` (set by the
  circuit-breaker). Tracks `hold_reason`, `hold_by_user_id` (FK users SET NULL; null for
  auto-holds), `hold_at`. The customer-facing response exposes the state/reason/at but
  NEVER `hold_by_user_id`; the admin list resolves the operator's name/email via a single
  batched user lookup ("who suspended").
- **Circuit-breaker** — consecutive-failure model. `consecutive_failures` increments on
  each failed check and resets to 0 on success; at the threshold the connection is
  auto-suspended (`auto_suspended`, actor = SYSTEM).
- **Operator control surface** (`/admin/erp/*`, SYSTEM_ADMIN) — suspend / unsuspend /
  force-check / guarded-delete (delete rejected unless the connection is on hold). Every
  action is reason-required, immutably audited (state + audit in one transaction via
  `SecurityEventService.recordAtomic`), and the target org's OWNER_ADMINs are notified
  (suspend / restore / remove — email + in-app). On remove, recipients are resolved
  BEFORE the hard delete and dispatched AFTER it commits (lesson #171).

### Env vars
- `ERP_INTEGRATION_ENABLED` (default **false**) — master flag; OFF hides every ERP route
  (customer + admin) behind `ErpEnabledGuard`.
- `ERP_CIRCUIT_BREAKER_ENABLED` (default **true**) — toggles the auto-suspend breaker.
- `ERP_CIRCUIT_BREAKER_THRESHOLD` (default **5**) — consecutive failures before auto-suspend.
- `ERP_CREDENTIAL_ENC_KEY` — the CryptoService key used to encrypt connection credentials
  (see the CryptoService section above; must be high-entropy random).

### Hard rules — never violate
1. **Operators govern PERMISSION TO OPERATE; customers own identity / config /
   credentials / data.** Operators never see, enter, or edit a customer's credentials, and
   never trigger a sync on a customer's behalf as if they were the customer. Operator
   power is limited to suspend / unsuspend / force-check (a health probe, no cost write) /
   guarded-delete.
2. **Every operator action is reason-required + immutably audited + customer-notified.**
   The reason DTO is mandatory; the audit row and the state change are written in one
   transaction; the target org's OWNER_ADMINs are notified best-effort (never roll back
   the action on a notify failure — lesson #114 / #171).
3. **The customer cannot clear an operator/auto hold.** A held connection
   (`operator_suspended` or `auto_suspended`) rejects the customer's `enabled=true` /
   trigger-sync with a `ForbiddenException`. Only a SYSTEM_ADMIN unsuspend (or a
   successful force-check resetting the breaker) lifts a hold.
4. **ERP connections are org-scoped, NOT contract-scoped** — they carry
   `organization_id` directly, so they are outside the Option B contract chokepoint.
   Cross-tenant SYSTEM_ADMIN authority is made safe by role-gate + reason-required audit
   (the `admin-organizations` precedent), not a repository wall. Verify with the
   contract-repo lint gate (exit 0, no exemption needed) before assuming the chokepoint
   applies. See lessons #170 and #171.

---

## Arabic PDF Rendering — Acrobat-Strict Fix (shipped 2026-06-24, PR #97)

Closes two long-standing real-world Arabic export failures that lenient
validators (qpdf, fontTools, Chrome's PDF viewer) all missed: an Adobe Acrobat
crash (`EXCEPTION_ACCESS_VIOLATION` in CTJPEGReader / Font Capture) and a
garbled-Latin footer ("Įeįerated by Sİıį PlatĲorĳ") that turned out to be the
same root cause surfacing in a different subsystem. PR #97 squash-merged to
`main` at `f3f1c5f`. Visual verification in real Acrobat passed.

### Root cause

pdfkit's default font-embedding pipeline routes through `fontkit.TTFSubset.encode()`,
which produces a minimal subset with:
- `sfntVersion = 'true'` (Apple TrueType magic, NOT the standard 0x00010000
  Windows/OpenType magic)
- Only 7 tables present (head, hhea, loca, maxp, prep, glyf, hmtx) — MISSING
  the OpenType-required `cmap`, `name`, `post`, `OS/2`

Lenient parsers accept this. Adobe Acrobat strict-parses the FontFile2 and either
crashes outright (memory corruption surfaces in whichever subsystem Acrobat
runs next — often the imaging path → CTJPEGReader) or renders glyph data
with wrong indexing (the garbled Latin footer was the same defect surfacing as
wrong glyphs, not a crash). One root cause, two symptoms.

### Fix shape (two layers, both required)

1. **Full Amiri embed via a module-init monkey-patch.** Two IIFEs at the top of
   `backend/src/common/utils/pdf-arabic.ts` install patches on pdfkit's
   prototypes the first time the helper is imported. The embed patch finds
   the internal `EmbeddedFont` class via a throwaway probe and wraps its
   `embed()` method. For fonts whose `postscriptName ∈ {Amiri-Regular,
   Amiri-Bold}` (the `FULL_EMBED_BUFFERS` map):
   - Swap `subset.encode()`'s output for the FULL Amiri TTF buffer
     (sfntVersion 0x00010000 + all 15 tables — Acrobat-valid).
   - Replace pdfkit's `/CIDToGIDMap = /Identity` with a STREAM built from
     `fontkit.Subset.glyphs[]` — content-stream subset gids round-trip to
     the correct full-Amiri glyphs (verified: 24 distinct shaped Arabic
     glyphs match the full Amiri outlines byte-for-byte).

2. **Route pure-Latin chrome to PDF base-14 Helvetica.** Each PDF generator's
   `defaultStyle` flipped from `{ font: 'Amiri' }` to `{ font: 'Helvetica' }`
   so the footer, brand line, page numbers, and English meta labels render
   via pdfkit's base-14 Type1 AFM path (Helvetica + `/WinAnsiEncoding`).
   Helvetica is NEVER embedded (base-14 is referenced by name), so it never
   goes through `EmbeddedFont` and is structurally immune to the
   Acrobat-strict crash class. `emitArabicParagraph` explicitly tags
   Arabic-script inlines `font: 'Amiri'` and Latin sub-runs inside an
   Arabic-bearing line `font: 'Helvetica'`.

### Patch install trigger — IMPORTANT for new PDF code

- The two monkey-patches install at the moment `pdf-arabic.ts` is first
  `require`/`import`ed in the Node.js process.
- Once installed, they live on `pdfkit.PDFDocument.prototype` and
  `EmbeddedFont.prototype` — **shared by every pdfkit consumer in the
  process**.
- Currently `pdf-arabic.ts` is imported by `ExportService` and
  `PortfolioExportRendererService`, both providers in `AppModule`. They
  instantiate during NestJS boot, BEFORE the HTTP server listens — so the
  patches are in place for the lifetime of the running process.
- **The embed patch is gated** at runtime on `font.postscriptName ∈
  FULL_EMBED_BUFFERS` — only Amiri-Regular and Amiri-Bold trigger it. Any
  other font (including Helvetica, which doesn't go through `EmbeddedFont`
  at all) is untouched.
- **Practical implication for compliance + future PDF code:** because the
  patches are GLOBAL in the process, compliance PDFs (when PR-A wires the
  helper) automatically inherit the Acrobat-strict-safe Amiri embed. No
  per-service wiring needed beyond importing the helper somewhere in the
  module graph.

### Hard rules — never violate

1. **`backend/src/common/utils/pdf-arabic.ts` is the single source of truth
   for the Amiri embed + monkey-patches.** Do NOT add a second `EmbeddedFont`
   monkey-patch elsewhere in the codebase — the install gate is keyed on a
   single boolean flag and a parallel patch would race the install or
   silently no-op. If a future PDF generator needs the Acrobat-strict-safe
   Amiri embed, import the helper (or any module that transitively imports
   it) somewhere in its module graph; the patches install on first
   `require`.
2. **Never use `Intl.NumberFormat('ar-EG', ...)` for PDF numeric content.**
   See lesson #137 — financial figures + counts in MENA construction
   contracts use Latin numerals + ISO currency codes. The Arabic helper does
   NOT auto-localize digits.
3. **Routing rule: Arabic-script inlines carry `font: 'Amiri'`; pure-Latin
   runs (including Latin sub-runs inside an Arabic-bearing line) carry
   `font: 'Helvetica'`.** The `defaultStyle: { font: 'Helvetica' }` is the
   backstop — the explicit per-inline `font` keys are the contract. A new
   PDF section that drops the explicit Arabic-path `font: 'Amiri'` will
   render Arabic through Helvetica = `.notdef` tofu.
4. **Do NOT add a new entry to `FULL_EMBED_BUFFERS` without verifying the
   font's `sfntVersion` is already 0x00010000 + all 10 required OpenType
   tables are present.** The patch's correctness depends on the SOURCE TTF
   being Acrobat-valid; adding an Apple-TTF-flavored font would re-introduce
   the exact bug PR #97 fixed.
5. **The qpdf external check in `export.service.arabic.spec.ts` MUST stay
   gated behind `spawnSync('qpdf','--version')` ENOENT detection** — see
   lesson #176. CI runners and dev hosts without qpdf installed must not
   false-fail.
6. **Visual verification is the canonical gate for PDF-rendering changes.**
   qpdf / fontTools / Chrome's PDF viewer all said "clean" while real
   Acrobat crashed — see lesson #175. Any PR touching the PDF rendering
   pipeline must include a real-Acrobat eye-test, not just an in-container
   tool check.

---

## Guest Upload a New Contract Version — Feature #4 (shipped 2026-06-26, PR #96, merged `42127a1`)

The first guest **WRITE-of-a-file** capability on the Guest Portal's shared
external-access foundation. A bound guest with established identity
(`account_type=GUEST`, Path B) uploads a revised contract file at
`POST /guest/contracts/:id/documents`; it lands as a `document_uploads` row and
re-runs the existing AI extraction pipeline (`uploadAndProcess`). This is
additive to Portal Rules 5–6 and the prior guest features (#1 viewer/comments,
#3 watermarked download); those rules are unchanged.

### What shipped
- **Route + gate:** `GuestUploadController` (`backend/src/modules/guest-portal/controllers/guest-upload.controller.ts`),
  `@Controller('guest/contracts')` + class-level `JwtAuthGuard` + an explicit
  `account_type === GUEST` assertion (a managing JWT here gets a loud 403; a
  passwordless Viewer credential — Path A — is not a JWT and never authenticates
  on the route) + `@ThrottleOnly('guest_upload')` (5/15min/IP burst guard,
  SEPARATE from the daily cap). Identity is taken ENTIRELY from the server-side
  principal, never client input.
- **Binding wall:** scope is walled through
  `ContractAccessService.findAccessibleContract → findForGuest` (the
  `guest_contract_access` binding). A guest requesting a contract it is not bound
  to gets **404, never 403** (no existence leak). No bare-repo access
  (`lint:contract-repo` clean).
- **File safety — magic-bytes:** `assertAllowedDocumentSignature`
  (`backend/src/common/utils/file-validation.ts`) validates the file's REAL
  leading bytes (PDF `%PDF`, DOCX `PK\x03\x04`, legacy DOC OLE2) on top of the
  spoofable ext+MIME check — a disguised payload (e.g. an executable renamed
  `.pdf`) is rejected 400.
- **Race-safe daily cap = 5 guest uploads/day PER CONTRACT (UTC day),** enforced
  at the ROUTE layer because the metering engine has no per-day window (only
  rolling[throws] / calendar_period[monthly] / per_contract[lifetime] /
  lifetime). The cap is a SINGLE **atomic conditional UPSERT** on a new
  `guest_upload_daily_counts(contract_id, day, count)` row (migration
  `1761000000002`) — the codebase's hot-counter idiom (ARCHITECTURE RULE 9
  Invariant 2): `INSERT … ON CONFLICT (contract_id, day) DO UPDATE SET
  count = count + 1 WHERE count < :cap RETURNING count` (0 rows = capped). The
  row lock lives only for that statement; nothing is locked across the heavy
  upload. **This replaced a first cut that held a `pg_advisory_xact_lock` across
  `uploadAndProcess` — an adversarial self-review found it would pool-starvation-
  deadlock the whole backend at ≥ pool-max concurrent same-contract uploads
  (deadlock-fix commit `6083b4b`; see lesson #177).** A claimed slot is released
  (best-effort) if the upload throws before a document lands.
- **Billing meter — SEPARATE from managing:** new `MeterKey.GUEST_UPLOAD =
  'guest_upload'` (PG enum value via migration `1761000000001`,
  `window_type=per_contract`, billing/attribution only — the daily cap is the
  enforcer). `uploadAndProcess` gained a `meterKey` option (default
  `UPLOAD_EXTRACTION`) so the guest path charges `guest_upload` while the
  **MANAGING upload path stays byte-identical** (default meter, still silent).
  **Subject = host org** (resolver derives `contract → project → organization_id`;
  the guest's null org is never trusted).
- **Notifications (net-new on the guest path):** at the daily limit → host org
  OWNER_ADMINs notified + a clear **429 `GUEST_UPLOAD_DAILY_LIMIT`** to the guest
  (NOT a silent 403); on success → the managing party (`contract.creator`)
  notified. Both best-effort (try/catch, never block the upload). The managing
  upload path remains silent — the notification is guest-path-only.
- **Frontend:** "Upload new version" affordance in `GuestContractView` (Path-B
  gated, beside the watermarked-download button); `guestService.uploadGuestContractVersion`
  via `guestHttp` with a per-request `multipart/form-data` override + Bearer
  guest JWT; `guest.upload.*` i18n keys in en/ar/fr (exact parity).

### KNOWN ISSUE flagged at merge (NOT a #4 defect; owned by Ayman — ERP/crypto subsystem)
`erp-sync.integration.spec.ts › "credentials are encrypted at rest, decrypt
back, and are never returned"` fails with `CryptoService.decrypt: authentication
failed (payload tampered or wrong key)` **whenever `ERP_CREDENTIAL_ENC_KEY` is
set in the container's `process.env`**. Root cause: the test injects a dummy key
via `ConfigModule.forRoot({ load: [() => ({ ERP_CREDENTIAL_ENC_KEY: ENC_KEY })] })`
without `ignoreEnvVars`, and `@nestjs/config` gives **`process.env` precedence
over `load()`-ed config** — so the ENCRYPT path (real `CryptoService` →
`ConfigService.get`) uses the container's real 64-char key while the test's
manual DECRYPT (`new CryptoService` hardcoded to the 42-char dummy `ENC_KEY`)
uses the dummy → GCM auth-tag mismatch. It is a **test-robustness bug, not a
code defect** (the production encryption-at-rest path is correct). The test was
previously passing only because the container had NO `ERP_CREDENTIAL_ENC_KEY`
set (ConfigService fell through to the dummy) — i.e. it was **passing for the
wrong reason and never verified encryption-at-rest under a real key**. Fix
(Ayman): `ignoreEnvVars: true` on the test's `ConfigModule`, or decrypt via the
SAME injected `ConfigService` the encrypt path used. This is branch-independent
(the ERP/crypto code is identical to `main`; PR #96 touches zero ERP/crypto
files) and was NOT a #96 merge blocker.

### DEFERRED follow-ups (from #4 — tracked so they're not lost)
1. **AV / malware content scanning** of guest-uploaded files (none today).
2. **OOXML structural / zip-bomb validation for the DOCX magic-bytes check** — it
   currently accepts ANY `PK\x03\x04` (ZIP) container as DOCX; the 50MB multer
   cap bounds input size, and magic-bytes still beats the prior ext+MIME-only
   check.
