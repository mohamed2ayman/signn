# SIGN Platform — Development Roadmap
> Last updated: 2026-06-24 (7.42 — Arabic PDF rendering Acrobat-strict fix shipped, PR #97 squash-merged at `f3f1c5f`; 7.43 added — Compliance PDF Rebuild + Arabic Support (PR-A) as the consolidated follow-on. Prior 2026-06-21: Phase 7.35 — mfa_totp_secret encrypted at rest via CryptoService, PR #88. Prior same day: Phase 7.28 ERP Integration shipped end-to-end — v1 + v1.1; follow-on tasks 7.37–7.41 added)
> Next review: When 7.5-7.8 are cleared; 9.2 AWS setup planning starts
> Maintained by: Ayman & Youssef
> Market: Arabic, English, French (Middle East + Global)
> AI Strategy: Anthropic Claude API now → migrate to open-source models later

---

## Priority Colour Legend

| Priority | Meaning |
|----------|---------|
| 🔴 CRITICAL | Must be done — blocker for progress |
| 🟠 HIGH | Important — do in current sprint |
| 🟡 MEDIUM | Valuable — schedule in next sprint |
| 🟢 LOW | Nice to have — when time allows |
| ⏳ BLOCKED | Cannot proceed — external dependency required |

---

## ✅ PHASE 1 — Critical Bug Fixes & Foundation — COMPLETED
Implemented by: Ayman & Youssef | Completed: 2026-05-20

- **1.1** Fix Wrong API URL ✅
- **1.2** Fix Seed Role Mismatch ✅
- **1.3** Complete DocuSign Flow ✅ (HMAC-SHA256 verification, contract state transitions)
- **1.4** Fix Silent try/catch Blocks ✅
- **1.5** Validate Env Vars on Startup ✅

#### Hard Rules from Phase 1 — Never Violate
1. `audit-log.interceptor.ts` catch block is **intentionally silent** — rethrowing breaks every request
2. `admin-health` service catch blocks must return `{status:'down'}`, never throw
3. `contracts` version snapshot catch blocks are **best-effort** — rethrowing breaks mutations
4. Bull queue processor catch blocks: **log only, no rethrow** — Bull handles retries

#### Env Var Names — Always Use These
| Variable | Used In |
|----------|---------|
| `VITE_API_URL` | `apps/sign/src/services/api/axios.ts` |
| `VITE_SOCKET_URL` | `socketService.ts`, `supportSocketService.ts` |
| `VITE_SIGN_APP_URL` | `apps/managex/src/App.tsx` |
| `VITE_MANAGEX_URL` | SIGN layouts (TopBar, AuthLayout, AdminLayout) — wired in Phase 5.4 |

---

## ✅ PHASE 2 — Testing & CI — COMPLETED
Implemented by: Ayman | Completed: 2026-05-20 | Expanded through Phase 7.1

- **2.1** Backend Tests ✅ — 8 spec files, 87 tests (grew from 33 through Phases 5-7)
- **2.2** Frontend Tests ✅ — 10 test files, 44 tests (grew from 8 through Phase 7.1)
- **2.3** AI Pipeline Tests ✅ — 8 tests, Anthropic mocked
- **2.4** CI/CD Pipeline ✅ — GitHub Actions, 3 parallel jobs, **139 tests total**

---

## ✅ PHASE 3 — Input Security — COMPLETED
Implemented by: Ayman & Youssef | Completed: 2026-05-25 (ILIKE gap closed in Phase 5.6)

- **3.1** SQL Injection Prevention ✅ — all 8 ILIKE sites now protected (Phase 5.6 closed the final 2)
- **3.2** Input Sanitization ✅
- **3.3** Input Validation ✅
- **3.4** File Upload Security ✅
- **3.5** XSS Prevention ✅

---

## ✅ PHASE 4 — Security Hardening — COMPLETED
Implemented by: Ayman & Youssef | Completed: 2026-05-20

- **4.1** Rate Limiting ✅ — `@nestjs/throttler` + Redis-backed storage, 8 unauthenticated auth endpoints, 429 JSON with Retry-After header, account lockout (5 wrong → 30 min)
- **4.2** JWT & Refresh Token Handling ✅ — token family tracking (family_id + parent_token_hash), jti UUID on every access token, Redis blacklist on logout, JWT_REFRESH_SECRET required (min 32 chars)
- **4.3** Secrets to Env Vars ✅ — requireSeedPassword() helper, data-source.ts validates DATABASE_URL independently, 9 new vars in Joi schema, dev-only CSP/CORS gated behind NODE_ENV
- **4.4** Legal Pages & Privacy ✅ — 14 components (LegalHubPage + 10 policy pages + layout + content), cookie consent system (4 categories), T&C checkbox in registration, AI disclaimers, communications preferences endpoint, 8 consent columns on users table. Remaining gaps closed in Phase 5.5.

#### Password Validation Hardening ✅ (Ayman, PR #13 + #14, 2026-05-20)
- All 6 password DTOs enforce: min 12 chars, 1 uppercase, 1 number, 1 special character
- DTOs: RegisterDto, ResetPasswordDto, 3× ChangePasswordDto, AcceptInvitationDto
- DB `security_policies.password_min_length` = 12
- Frontend validation on all 5 pages (Register, Reset, Accept Invitation, MySecurityPage, ProfilePage)
- Lessons #78, #79, #80, #84

---

## ✅ PHASE 5 — Documentation, Compliance & Pre-Feature Fixes — COMPLETED
Implemented by: Ayman & Youssef | Completed: 2026-05-22

---

### ✅ 5.1 — Keep CLAUDE.md + lessons.md Updated
**Owner:** Ayman + Youssef | **Status:** ✅ Active ongoing habit
- CLAUDE.md: ~1,600+ lines, current as of 2026-05-25, covers through Phase 7
- lessons.md: 109 lessons (#1-109), current as of 2026-05-25
- DocuSign "Known Bug #2" removed ✅
- Custom Slash Commands section added ✅
- Phase 7.2 section added ✅
- Zero outstanding issues in CLAUDE.md as of 2026-05-22

---

### ✅ 5.2 — Create Basic Setup Guide
**Owner:** Ayman | **Status:** ✅ SHIPPED (PR #15, 2026-05-21)
- `docs/SETUP.md` — 524 lines, 13 sections
- Covers: prerequisites, env files, Docker startup, seeds, port map, tests, hot reload, common failures, DB recovery, gh CLI, pre-PR checklist
- README.md and README-DEV.md updated with links
- Every command cross-verified against actual codebase

---

### ✅ 5.3 — Clean Up Stale Git Branches
**Owner:** Ayman | **Status:** ✅ SHIPPED (2026-05-22)
- 13 stale remote branches deleted (all verified content is on main before deletion)
- 3 local branches cleaned
- Only main + Claude Code worktree branches remain

---

### ✅ 5.4 — Fix Hardcoded ManageX Backlink URLs
**Owner:** Youssef | **Status:** ✅ SHIPPED (commit 0a93c3e, 2026-05-22)
- 4 hardcoded `localhost:5175` URLs replaced with `import.meta.env.VITE_MANAGEX_URL`
- New `VITE_MANAGEX_URL` env var added to `apps/sign/.env.example`
- New `ManagexLogo.tsx` component added to SIGN layouts

---

### ✅ 5.5 — Complete Legal Pages & Privacy Compliance Gaps
**Owner:** Youssef | **Status:** ✅ SHIPPED (PR #17, 2026-05-22)
- French locale added (fr/common.json, 381 lines)
- Language toggle reworked from 2-way (EN/AR) to 3-way dropdown with FR
- Cookie consent server-side persistence added
- AI disclaimer added to ClauseReviewPage and ClausesPage
- All 10 legal pages updated with centralised content
- Backend DTO + controller updated for cookie consent fields

---

### ✅ 5.6 — Fix Admin-Security ILIKE Search Injection
**Owner:** Ayman | **Status:** ✅ SHIPPED (PR #19, 2026-05-25)
- `escapeLikeParam()` applied to admin-activity-log.service.ts and security-audit-log.service.ts
- All 8 ILIKE sites across entire backend now protected
- Phase 3.1 fully closed

---

### ✅ 5.7 — Investigate failed_login_attempts Reset
**Owner:** Ayman | **Status:** ✅ CONFIRMED WORKING (2026-05-22)
- `failed_login_attempts` resets correctly at auth.service.ts line 411
- Reset fires immediately after bcrypt.compare succeeds, before MFA check
- All 3 login paths covered (login, verifyMfa, verifyRecoveryCode)
- No bug — no fix needed

---

### ✅ 5.8 — Block Password Reuse in Change-Password
**Owner:** Ayman | **Status:** ✅ SHIPPED (PR #20, 2026-05-22)
- Always-on `bcrypt.compare(newPassword, currentHash)` guard in profile.controller.ts
- ProfilePage.tsx migrated from legacy `PATCH /auth/change-password` to hardened `POST /me/change-password`
- Client-side min-length updated from 8 to 12
- Two legacy change-password endpoints marked deprecated with TODO comments
- Lessons #83, #84

---

## ✅ PHASE 6 — Brand & UI Foundation — MOSTLY COMPLETED
> 6.1-6.4, 6.7-6.8 done. 6.5-6.6 moved to Phase 6B (after Phase 7 — features will change the UI).

---

### ✅ 6.1 — CENVOX → ManageX Rename
**Status:** ✅ COMPLETED — 71 files rebranded. Backlinks fixed in Phase 5.4.

---

### ✅ 6.2 — Coming Soon Pages (VENDRIX, SPANTEC, CLAIMX, GUARDIA, DOXEN)
**Owner:** Youssef | **Status:** ✅ SHIPPED (PR #21, 2026-05-24)
- 5 sibling product cards upgraded: brand colour border, "Coming Soon" badge, "Notify Me" email input
- Email capture is local state only — backend wiring in Phase 6.9

---

### ✅ 6.3 — Fine Touches to ManageX Landing
**Owner:** Youssef | **Status:** ✅ SHIPPED (PR #21, 2026-05-24)
- Removed "/" separators from Why ManageX section
- Replaced brittle split-on-"/" logic with index-based cyan colouring
- Tone fix: "intelligent enough to treat it that way" → "built to treat it that way"
- Mission statement intentionally deferred to Phase 6.10

---

### ✅ 6.4 — Mobile View & Responsive Design
**Owner:** Youssef | **Status:** ✅ SHIPPED (PR #22, 2026-05-25)
- AppLayout mobile shell: hamburger menu, off-canvas sidebar drawer, route-change auto-close, responsive main margin
- AdminLayout mobile shell: LTR-only off-canvas drawer with hamburger + overlay
- Table overflow wrappers across 20 files (all 21 tables now scroll horizontally on mobile)
- ManageX landing mobile nav drawer + hero font fix (h1 min reduced from 52px to 36px)
- Lessons #85-92

**Deferred to next sprint:**
- ContractDetailPage full responsive redesign
- ClauseReviewPage 55/45 split → tab switcher
- Modal max-width standardization

---

### ✅ 6.7 — Frontend Design Skill
**Status:** ✅ Already available in Claude Code at `/mnt/skills/public/frontend-design/SKILL.md`
- No plugin install needed — skill is auto-loaded when Claude Code does UI work
- Lesson #88: Claude Code has no `/plugin` command — extensibility is via MCP, custom commands, hooks, skills

---

### ✅ 6.8 — /review Custom Slash Command
**Owner:** Ayman | **Status:** ✅ SHIPPED (commit 01fd9f4, 2026-05-24)
- `.claude/commands/review.md` — 8-step structured code review checklist
- Type `/review` before any PR: diff, 5 security vectors, Phase 3.2 artifacts, console.log sweep, TODO sweep, backend tests, PASS/FAIL report

---

### 6.9 — Waitlist Email Capture & Admin Export
**Owner:** Youssef (frontend + backend) + Ayman (admin portal)
**Priority:** 🟡 MEDIUM | **Status:** ✅ Complete — 2026-05-27 (PR #33)
**Depends on:** 6.2 ✅ (cards already built) — can start anytime

**Tasks:**
- Database: new `product_waitlist` table (id, email, product_name, created_at, unique on email+product_name)
- Backend: POST /waitlist endpoint (rate limited per Phase 4.1 pattern, input sanitized per Phase 3.2, 200 on duplicate silently — do not expose whether email already exists)
- Frontend: wire existing "Notify Me" button in ManageX App.tsx to POST /waitlist
- Admin Portal: Waitlist Manager (SYSTEM_ADMIN role only), table view filterable by product, Excel export (.xlsx)
- Launch notification: bulk email per product when ready to launch, using existing email infrastructure
- No PII in application logs (SOC 2 alignment — Phase 10.3)

---

### 6.10 — Mission Statement Rewrite
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ⏳ BLOCKED — needs founder brand conversation
- Answer 5 brand voice questions (primary user, real pain, genuine differentiator, what ManageX should never feel like, a real founder phrase)
- Write 3 candidate mission statements
- Pick one, get Ayman's sign-off, implement in App.tsx lines 582-597
- Wire "Our mission →" CTA href to real destination page

---

## 🚀 PHASE 7 — Feature Development
> Main feature phase. Competitive sprint features integrated here.
> Ordered by: competitive urgency → dependency chain → business value.
> Four tiers. Do Tier 1 first, then Tier 2, etc.

---

### ═══ TIER 1: Competitive Essentials (Do First) ═══

---

### ✅ 7.1 — Obligation Tracking & Deadline Alerts
**Owner:** Ayman (backend) + Youssef (frontend)
**Priority:** 🔴 CRITICAL | **Status:** ✅ SHIPPED (PRs #23, #24, #25, #28, 2026-05-25)
**Competitors:** Document Crunch/Trimble (primary value prop), Tomorro

**What shipped:**
- **Step 1 (Ayman, PR #23):** 3 migrations (contract dates, obligation_assignees, reminder_schedule), 5 new endpoints (assign, unassign, evidence, portfolio, calendar), reminder processor upgrade (assignee-based sending, OVERDUE escalation, in-app notifications, per-obligation schedule), email consolidated to templates. 47 new backend tests.
- **Step 2 (Youssef, PR #24):** ObligationsTab on Contract Detail page, upgraded ObligationsPage with portfolio view, 9 reusable obligation components, 53 i18n keys (EN/AR/FR). 36 new frontend tests.
- **Step 3 (Youssef, PR #25):** 4 modals (AddEditObligationModal, AssignUserModal, MarkActionedModal, ObligationDetailDrawer), ObligationsCalendarPage with react-big-calendar.
- **Step 4 (Youssef, PR #28):** In-app notification polling (30s refetchInterval), unread count badge on bell icon in TopBar, dir="auto" fixes on obligation text, ProjectDetailPage obligation navigation link.
- Lessons #94-104

**Success metric:** A project manager sees all upcoming contract deadlines across all projects in one view and receives email alerts before each deadline. ✅ Achieved.

---

### ✅ 7.2 — Fix Route Shadowing
**Owner:** Ayman | **Status:** ✅ SHIPPED (PR #26, 2026-05-25)
- Legacy `/obligations/:id` route (ObligationsModule) shadowed `/obligations/portfolio` and `/obligations/calendar` (ComplianceModule) due to NestJS cross-controller route registration order
- Fix: UUID regex constraint `@Get(':id([0-9a-f]{8}-...-[0-9a-f]{12})')` on all 4 legacy routes (GET, PUT, PUT/complete, DELETE)
- Portfolio and calendar pages now return 200
- Lesson #108

---

### ✅ 7.3 — Fix Obligation Status Enum Migration
**Owner:** Ayman | **Status:** ✅ SHIPPED (PR #27, 2026-05-25)
- Migration 1718000000002 referenced wrong enum name (`obligations_status_enum` instead of `obligation_status`)
- Silent `EXCEPTION WHEN undefined_object THEN null` catch hid the failure — MET and WAIVED values were never added
- Corrective migration 1748000000004 adds MET + WAIVED with `IF NOT EXISTS`
- New `ObligationSchemaCheckService`: startup assertion verifies all 6 enum values on boot (OnModuleInit)
- `data-source.ts`: `migrationsTransactionMode: 'each'` to support per-migration `transaction = false`
- Lessons #108, #109

---

### ✅ 7.4 — Add Obligation Reminders Endpoint
**Owner:** Ayman | **Status:** ✅ SHIPPED (PR #29, 2026-05-25)
- `GET /contracts/:contractId/obligations/:obligationId/reminders`
- Returns `obligation_reminder_logs` ordered by sent_at DESC
- Response: `{ id, reminder_type, sent_to, sent_at, email_status }` — obligation_id omitted (redundant from URL)
- Contract ownership verification (404 if obligation doesn't belong to contract)
- 7 new tests (2 service unit + 5 HTTP)

---

### 7.5 — Obligation Type Dropdown Label Consistency
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Obligation type badges may not match the dropdown labels in the Add/Edit modal
- Audit all 12 obligation type labels for consistency across ObligationsTab, ObligationsPage, and AddEditObligationModal

---

### 7.6 — Calendar Page Plan Gate for Starter Users
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- ObligationsCalendarPage should show plan upgrade modal for Starter plan users
- Professional and Enterprise only
- Check existing plan gating patterns (SubscriptionGuard or frontend check)

---

### 7.7 — Wire Reminder History in Detail Drawer
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- ObligationDetailDrawer currently shows placeholder for Reminder History section
- Wire to `GET /contracts/:id/obligations/:oblId/reminders` (endpoint shipped in 7.4)
- Display: tier, sent_to, sent_at, email status per row

---

### 7.8 — Portfolio + Calendar Empty State UX
**Owner:** Youssef | **Priority:** 🟢 LOW | **Status:** ❌ Not started
- When no obligations exist, portfolio and calendar pages show raw empty arrays
- Add proper empty state: centered icon + "No obligations tracked yet" heading + CTA to create first obligation
- Follow existing empty state pattern from other pages

---

### 7.9 — Audit All Migrations for Silent Exception Pattern
**Owner:** Ayman | **Priority:** 🟡 MEDIUM | **Status:** ✅ Complete — 2026-05-27 (PR #34)
- Audited ALL 5 migration files — found 25 live `EXCEPTION WHEN` instances
- Replaced all 25 with `IF NOT EXISTS (SELECT 1 FROM pg_type/pg_constraint ...)` guards
- No corrective migration needed — source-level fix only (existing envs already patched by PR #27)
- All 104 backend tests pass

---

### 7.10 — Wire obligation reminder processor to in-app dispatch
**Owner:** Ayman | **Priority:** 🟠 HIGH | **Status:** ✅ Complete — already implemented (confirmed 2026-05-27)
**Deferred from:** Phase 7.1 Step 4 scoping (2026-05-25)

Codebase investigation on 2026-05-27 confirmed this was already fully
implemented as part of Phase 7.1 Step 1 backend work:
- `ObligationReminderProcessor` already calls `this.dispatch.dispatchObligationReminder()`
  in two places: primary recipients loop (lines 149–155) and escalation user path (lines 320–326)
- `NotificationDispatchService.dispatchObligationReminder()` exists and creates `IN_APP` rows
- Module DI wiring already correct (`ObligationsModule` imports `NotificationsModule`)
- Two dedicated tests in `obligation-reminder.processor.spec.ts` assert the calls
- No code changes were made — the gap described in the Step 4 notes was written
  ahead of the implementation that shipped in Step 1

**Dependencies:** None — resolved.

---

### 7.11 — Arabic RTL polish for react-big-calendar
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
**Deferred from:** Phase 7.1 cleanup PR #30 (2026-05-25)
**Why:** Concrete Arabic RTL inventory captured for the first time in
`docs/screenshots/phase-7.1-step-3/calendar-arabic-rtl.png` shows
react-big-calendar does not natively support RTL grid layout:
- Days-of-week stay Mon→Sun (LTR) instead of Sun→Mon (RTL)
- Day numbers stay Western (27, 28) instead of Arabic-Indic (٢٧، ٢٨)
- Two pre-existing app-wide issues also visible in the screenshot:
  breadcrumb chevron `›` does not flip; TopBar "← MANAGEX" arrow does
  not flip. Not RBC-specific but noticed during the same review.

What DOES work (confirmed in same screenshot):
- Toolbar buttons translate and align correctly
- Filter labels translate and align correctly
- Event titles render correctly via the `dir="auto"` event wrapper
  shipped in Step 4

**Scope:**
- Custom RBC layout component or library replacement to get grid
  direction mirrored under Arabic locale
- Locale-aware number formatting for day numbers (`Intl.NumberFormat`
  with Arabic-Indic digits)
- Audit-and-fix pass for the pre-existing breadcrumb and backlink arrow
  non-flipping — separate from RBC but discovered in same review

**Dependencies:** Decision on whether to fix RBC RTL inline (custom
components) or replace the library entirely. RBC's maintenance is
mixed — worth a brief review before committing significant work.

**Reference:** `docs/screenshots/phase-7.1-step-3/calendar-arabic-rtl.png`

---

### 7.12 — Generic file-upload endpoint + obligation evidence FileDropZone
**Owner:** Ayman (backend) + Youssef (frontend) | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
**Deferred from:** Phase 7.1 Step 3 (2026-05-25)
**Why:** Backend has no generic file-upload endpoint. PUT /evidence
accepts a URL string only. Step 3 shipped a URL input + protective
message in MarkActionedModal instead of a file picker. Users currently
can't upload evidence directly — they must host the file themselves
and paste the URL.

**Scope:**
- Backend: file-upload endpoint with S3 storage + MIME/size validation
- Frontend: swap URL input for FileDropZone in MarkActionedModal,
  reusing the existing FileDropZone component from contracts upload
- Migration of any existing evidence_url values (likely none in
  production)

**Dependencies:** Storage decision (existing S3 bucket vs new). MIME
allowlist needs review (PDF, DOCX, JPG, PNG were Step 3 placeholders).

---

### 7.13 — Proper clause deep-linking from ObligationDetailDrawer
**Owner:** Youssef | **Priority:** 🟢 LOW | **Status:** ❌ Not started
**Deferred from:** Phase 7.1 Step 3 (2026-05-25)
**Why:** "View Clause" back-link in ObligationDetailDrawer uses URL
hash navigation only. Works in the common case (Clauses is the default
tab on ContractDetailPage) but won't switch tabs if the user lands
elsewhere. ContractDetailPage.tsx wasn't on Step 3's allowed-edit list.

**Scope:**
- Add hash/query-param reading to `ContractDetailPage.tsx` to
  auto-switch to the Clauses tab and scroll to the clause on mount
- ~10 LOC change
- Test: navigate to /app/contracts/:id#clause-:id from a fresh tab,
  verify Clauses tab is active and scroll target is in view

**Dependencies:** None. Pure frontend.

---

### 7.14 — Calendar event coloring uses raw status, not effective status
**Owner:** Youssef | **Priority:** 🟢 LOW | **Status:** ❌ Not started
**Deferred from:** Phase 7.1 Step 3 housekeeping (2026-05-25)
**Why:** `ObligationsCalendarPage.tsx`'s event color mapping reads the
raw `status` field. Every other surface (card list, detail drawer, KPI
cards) uses `effectiveStatus()` which auto-derives OVERDUE for PENDING
obligations whose `due_date` has passed. Result: a critical overdue
obligation displays as amber (PENDING) on the calendar but red
(OVERDUE) everywhere else. The dashboard-scanning use case is exactly
where this inconsistency matters most.

**Scope:**
- Update `eventPropGetter` in `ObligationsCalendarPage.tsx` to call
  `effectiveStatus(obligation)` before color lookup
- ~3 LOC frontend change
- Add a test case: PENDING obligation with past-due `due_date` renders
  red (OVERDUE color)

**Dependencies:** None. Pure frontend.

**Reference:** Visible in
`docs/screenshots/phase-7.1-step-3/calendar-desktop-en.png` — the
obligation due 2026-04-15 displays amber despite being past-due.

---

### 7.15 — Per-role permission model for obligation Delete + Edit
**Owner:** Ayman | **Priority:** 🟡 MEDIUM | **Status:** ✅ Complete (2026-06-01, PR #40)
**Deferred from:** Phase 7.1 Step 3 (2026-05-25)
**Why:** Backend `DELETE /obligations/:id` is gated only by JWT — any
authenticated user with contract access can delete. Step 3 hid the
Delete action from the UI entirely rather than ship a security-theater
role check on the frontend.

**Scope:**
- Define obligation-level permissions (who can delete? who can edit?)
- Add per-role checks in backend service
- Re-enable Delete in ObligationActionMenu gated on the new permission
- Open question: should obligation Edit also be permission-gated, or
  stay open to any contract member?

**Dependencies:** Permission-model conversation with Ayman.

---

### 7.16 — Legal-translator review of construction-law i18n terms
**Owner:** Ayman + Youssef (engagement decision) | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started — non-engineering item
**Deferred from:** Phase 7.1 Step 3 housekeeping (2026-05-25)
**Why:** Construction-law terms in `ar/common.json` and `fr/common.json`
were translated during Step 3 implementation against FIDIC-aligned
usage, but have not been reviewed by a qualified legal translator.
Arabic terminology varies meaningfully by jurisdiction (UAE / Egypt /
Saudi / etc.) and French construction terminology has Maghreb-specific
variants. Confident translations in a frontend implementation pass are
not a substitute for jurisdiction-specific legal-translator review
before any production launch in MENA or French-speaking markets.

**Scope:**
1. Identify target launch jurisdictions (likely UAE + Egypt primary
   for AR; France + Morocco / Algeria / Tunisia for FR)
2. Engage a legal translator with FIDIC and construction-contract
   experience for each target jurisdiction
3. Review and refine all `_TODO_*` keyed terms in both locale files
4. Remove the `_TODO_*` parallel keys once reviewed
5. Document the jurisdiction-specific choices made (e.g. which Arabic
   variant for "Performance Bond") in CLAUDE.md

**Dependencies:** Decision on target launch jurisdictions. Budget for
qualified translators — this is not a low-cost item, expect significant
per-jurisdiction cost for legal-quality review.

**Note:** Greppable `_TODO_*` markers were added to both locales in PR
#25 (Phase 7.1 Step 3 housekeeping). Current worklist:
`grep "_TODO_" apps/sign/src/i18n/locales/ar/common.json`
`grep "_TODO_" apps/sign/src/i18n/locales/fr/common.json`

---

### 7.17 — Portfolio-Level Contract Analytics Dashboard
**Owner:** Youssef
**Priority:** 🟠 HIGH — URGENT
**Competitors:** Juro, Luminance, Ironclad
**Status:** 🟢 Prompt 1 backend foundation COMPLETE (S.1–S.5, A.1, B.1–B.6; 216 tests green) — remaining Prompt 1 gaps: A.1 behind a DO-NOT-MERGE-TO-PROD gate pending Ayman's L/I anchor sign-off; A.2/A.3 platform-default seeds operator-blocked; F.* frontend not started. Prompt 2 (Dashboard) not started — backend prereqs now satisfied except the small `contract_value`+`currency` migration.
**Depends on:** 7.1 ✅ (obligation data feeds dashboard)
**Why critical:** Drives C-suite adoption — construction directors need portfolio visibility.

#### Prompt 1 — Risk Methodology Foundation (in progress)

**Scope:** PMBOK 5×5 qualitative risk scoring as the data foundation for
Prompt 2's dashboard. Every risk finding gets a Likelihood (1-5) and an
Impact (1-5); risk_score = L × I; defaults follow a priority chain
(user KB ref → org learned baseline → platform default → fallback).

**Status as of 2026-05-29:**
- ✅ B.1 — RiskMethodologyResolverService (14 tests)
- ✅ S.1-S.5 — schema migrations + entity files + hooks (8 tests)
- ✅ B.2 — KB risk-methodology reader/validator (24 tests)
- 🟡 A.1 — AI prompt update (`risk_analyzer.py`) + document-processing resolver wiring — implemented; pending Ayman sign-off on L/I anchor language before prod
- ❌ A.2 / A.3 — canonical risk categories + platform-default seeds (operator-blocked)
- ✅ B.3 — override service (OWNER_ADMIN gated, drift warning, append-only audit log)
- ✅ B.4 — learned baseline computation (Bull job, median of last 50 once ≥10)
- ✅ B.5 — explanation + drift-report endpoints (8 explanation + 12 drift + 3 controller tests; 2 migrations incl. state-aware corrective)
- ✅ B.6 — backfill migration for legacy RiskAnalysis rows (HIGH 3/5/15, MEDIUM 3/3/9, LOW 2/2/4 → PLATFORM_DEFAULT with null ref; idempotent via `likelihood_source='FALLBACK'` guard; risk_level not recomputed; no override-log rows)
  - ⚠️ **Staging real-data verification PENDING** — staging not reachable from the dev environment. Dev run was a 0-row no-op (empty `risk_analyses` table); correctness proven via a rolled-back synthetic-row test (mapping + NULL-ref preservation + USER_OVERRIDE skip + idempotent second UPDATE=0). Run on staging and record the `UPDATE N` count before any prod rollout.
- ❌ F.1 — explanation tooltip
- ❌ F.2 — override modal
- ❌ F.3 — drift report page
- ❌ F.4 — KB risk-methodology flagging UI

**Known F.4 product gap to address during F.4 design:** when an
OWNER_ADMIN flags a KB entry as `is_risk_methodology_source = TRUE` but
the asset's `content.risk_methodology` block is missing or malformed,
the B.2 reader silently falls through and the user sees "no effect from
my flag" with no in-context explanation. F.4's UI MUST surface the
validation error in-context at save time (not let the user navigate
away). The B.2 reader's audit-log entries are admin-visible only.
Without a UI-layer block at save time, the flag becomes a silent no-op
from the user's perspective. Block the save with the specific reason
returned by the B.2 reader; offer inline help linking to the methodology
block schema.

#### Prompt 2 — Portfolio Analytics Dashboard (not started)

**⚠️ Audit first:** Check if any portfolio-level analytics already exist.

**Tasks:**
- Build Analytics Dashboard (OWNER_ADMIN + SYSTEM_ADMIN roles):
  - Total active contracts — count and total value
  - Contract status breakdown: Draft / In Negotiation / Signed / Expired / Terminated (pie chart)
  - Upcoming expirations: next 30 / 60 / 90 days (timeline)
  - Upcoming obligation deadlines: next 14 days (list — links to 7.1)
  - Risk distribution: High / Medium / Low across portfolio (bar chart) — driven by Prompt 1's L×I scoring
  - Average time from creation to signature (trend line)
  - Contracts by counterparty (top 10 table)
  - Contract value by project (if value field exists)
- Make all charts filterable by: date range, project, contract type, counterparty
- Export analytics as PDF report (for sharing with management)
- Full Arabic UI support

**Success metric:** A construction director opens SIGN on Monday morning and in 30 seconds knows the state of all their contracts across all projects.

---

### 7.18 — Guest Portal (`/contractor/*`)
**Owner:** Youssef | **Priority:** 🟠 HIGH
**Status:** ❌ Not started
**⚠️ Requires Plan Mode architectural session before any code is written**
- Foundation for 7.19 (Counterparty Redlining) — must be built first
- See CLAUDE.md Portal Architecture section for persona definition (Type B — Responding Party)
- Scope: view assigned contract, respond to clauses, submit claims/notices, sign. Nothing more.
- Invitation-based access (secure link, no SIGN account required)
- Build guest dashboard — minimal, mobile-first

---

### 7.19 — In-Platform Counterparty Redlining
**Owner:** Youssef
**Priority:** 🔴 CRITICAL — URGENT
**Competitors:** Juro, Tomorro, Luminance (via Word add-in)
**Status:** ❌ Not started
**Depends on:** 7.18 (Guest Portal — counterparties need access layer first)
**Why critical:** Biggest gap vs competitors — once negotiation starts, users leave SIGN entirely.

**⚠️ Audit first:** How do users currently share contracts? Audit `ContractDetailPage.tsx` + negotiation module.

**Tasks:**
- Build external guest link: share a contract with a counterparty via a secure link (no account required to view)
- Build inline commenting: counterparty can leave comments on specific clauses
- Build redline suggestions: counterparty can propose clause changes which appear as tracked changes
- Build internal response workflow: SIGN user sees redlines, accepts/rejects/modifies each one
- Maintain full version history: every round of changes is preserved and auditable
- Notify both parties by email when changes are made
- Show negotiation status: Draft → Shared → Under Review → Agreed → Ready to Sign
- All of the above must work in Arabic and English including RTL-correct tracked changes display

**Success metric:** A construction subcontract can go from first draft to fully agreed without leaving SIGN once.

---

### ═══ TIER 2: Deepening the Moat (Do Second) ═══

---

### 7.20 — Project Section Enhancements
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Portfolio-level project dashboard
- Project health score based on contract status + risk levels
- Contractor directory within a project
- Link project phases to contract milestones
- % Progress field, Member Count display
- Integrates with 7.1 obligation tracking data

---

### 7.21 — RFP & Specification Document Analysis
**Owner:** Ayman (AI) + Youssef (UI)
**Priority:** 🟠 HIGH — URGENT
**Competitors:** Document Crunch/Trimble — investing heavily here
**Status:** ❌ Not started
**Why critical:** Construction risk decisions happen BEFORE signing — during bid evaluation. No general CLM addresses this.

**Tasks:**
- Extend document upload to accept RFP and Specification document types (in addition to contracts)
- Build RFP Analysis mode:
    - Extract: payment terms, liquidated damages, retention, liability caps, insurance requirements, notice periods
    - Flag: unusual or onerous provisions vs FIDIC/NEC standard
    - Summarise: key commercial risks for the bid team
    - Generate: list of clarification questions to send to owner
- Build Specification Analysis mode:
    - Identify contradictions between spec sections
    - Flag ambiguous scope items that could cause disputes
    - Extract: key technical standards referenced (e.g. ASTM, BS, EN, ECP standards)
- Link RFP/Spec analysis to the resulting contract when awarded:
    - Show side-by-side: what was promised in RFP vs what ended up in the contract
- Support Arabic and English documents

**Success metric:** A contractor uploads an RFP and within 5 minutes has a risk summary and list of clarification questions — before deciding whether to bid.

---

### 7.22 — Contract Playbook & Standard Positions
**Owner:** Ayman (AI integration) + Youssef (UI)
**Priority:** 🟠 HIGH
**Competitors:** Luminance, Ironclad
**Status:** ❌ Not started
**Depends on:** 7.1 ✅ (obligation data) + 7.19 (redlining creates the negotiation data playbooks compare against)
**Why valuable:** Creates switching costs — once a firm has built their playbook in SIGN, they won't leave.

**Tasks:**
- Build Playbook section in Settings (org-level, OWNER_ADMIN only)
- Allow admin to define standard positions for common construction clause types:
    - Payment terms (acceptable range: e.g. 28-45 days)
    - Liability cap (acceptable: e.g. min 100% of contract value)
    - Retention rate (acceptable: e.g. max 10%)
    - Defects liability period (acceptable: e.g. max 24 months)
    - Dispute resolution (preferred: e.g. ICC Arbitration)
    - Governing law (preferred: e.g. UAE law / Egyptian law)
    - And any custom clause type the org wants to track
- When AI analyses a contract, compare each clause against the org's playbook
- Flag deviations clearly: "Payment terms: 60 days — your standard is max 45 days. Recommend negotiating."
- Distinguish between: Matches Standard / Minor Deviation / Major Deviation / Non-Standard (not in playbook)
- Support Arabic and English playbook definitions

**Success metric:** An org admin sets up their playbook once. Every contract reviewed after that gives personalised, organisation-specific risk flags instead of generic ones.

---

### 7.23 — Microsoft Word Add-In (Extend Existing)
**Owner:** Youssef | **Priority:** 🟡 MEDIUM
**Competitors:** Luminance, Harvey
**Status:** ❌ Not started
**⚠️ `apps/word-addin/` already exists in the repo — audit current state before building. Extend, do not rebuild.**

**Tasks:**
- Audit current add-in state — document what is already built
- Build Microsoft Word Add-In (Office Add-ins API / Office JS framework):
    - Login to SIGN account from within Word
    - Open any SIGN contract directly in Word for editing
    - Save changes back to SIGN with version tracking
    - View AI risk flags as comments inside the Word document
    - Apply playbook suggestions as tracked changes (once 7.22 is built)
    - Send for approval or signature from within Word
    - Support Arabic RTL documents in Word correctly
- Build companion feature: import any Word document into SIGN directly from the add-in
- Publish to Microsoft AppSource for discoverability

**Success metric:** A lawyer can open a SIGN contract in Word, review AI risk flags as inline comments, make edits, and push the revised version back to SIGN — without opening a browser once.

---

### ═══ TIER 3: Existing Features + Polish ═══

---

### ✅ 7.24 — Knowledge Base Enhancements — COMPLETED (2026-06-01, PR #40)
**Owner:** Ayman | **Priority:** 🟡 MEDIUM | **Status:** ✅ Complete (all 5 sub-phases)
- ✅ **7.24a** — "Used In" backlinks: `KnowledgeAssetUsage` entity + migration + `GET /knowledge-assets/:id/usages` + frontend expandable row
- ✅ **7.24b** — Bulk import: `BulkCreateKnowledgeAssetDto` + `POST /knowledge-assets/bulk`, partial-success response
- ✅ **7.24c** — Retry OCR: `POST /knowledge-assets/:id/retry-ocr` + frontend retry button
- ✅ **7.24d** — Version history: `KnowledgeAssetVersion` entity + migration + pre-update snapshots + `GET /knowledge-assets/:id/versions[/:number]` + tabbed UI + snapshot modal
- ✅ **7.24e** — Project scoping: `project_id` FK migration + three-tier visibility (platform / org-wide / project-scoped) in service + compliance knowledge service + frontend Scope column + project filter + upload scope selector

---

### 7.25 — Poor Scan Quality Handling
**Owner:** Ayman + Youssef | **Priority:** 🟡 MEDIUM | **Status:** ✅ Complete (PR #41, 2026-06-01)
- Detect low-quality scanned PDFs (blur/contrast/rotation) — pure numpy + PIL, no opencv
- `HUMAN_REVIEW_RECOMMENDED` terminal status in `document_processing_status_enum`
- `quality_flags VARCHAR[]` column on `document_uploads`
- AI backend: `_assess_quality()` + `_enhance_image()` in `TesseractTextExtractor`
- Amber warning banner in `ProcessingStatusCard` with per-flag messages + "Continue anyway" button
- i18n ×3 (EN/AR/FR) for all quality warning copy
- 7 new AI-backend tests in `test_quality_detection.py`

---

### ✅ 7.26 — Multilingual Support (French) — Track A Complete
**Owner:** Ayman + Youssef | **Priority:** 🟡 MEDIUM | **Status:** ✅ Complete — Track A (PR #42, 2026-06-02)

**Track A — JSON gaps (complete):**
- FR locale was already structurally complete (all EN keys present). No FR changes needed beyond confirming `language.fr = "Français"` already existed.
- EN: added `language.fr = "French"` (LanguageToggle label was missing in EN locale)
- AR: added `portal` section (3 keys), `userType` section (3 keys), 4 missing `nav` keys (`operationsReview`, `auditLog`, `billing`, `accountSettings`), `language.fr = "الفرنسية"`
- 12 keys total across EN + AR. 67/67 frontend tests pass.

**Track B — Legal page localization (deferred):**
- 11 legal pages use hardcoded TypeScript content objects, NOT the i18n JSON system
- Adding FR + AR requires 20 new `.content.ts` files + component locale selectors
- Gated on: legal team providing translated content (do NOT machine-translate Terms of Service, Privacy Policy, etc.)
- Regulatory note: GDPR + French Loi Toubon may require FR-language legal pages before EU launch

---

### ✅ 7.27 — Legal Corpus Foundation — COMPLETE (2026-06-10)
**Owner:** Ayman | **Priority:** 🟡 MEDIUM | **Status:** ✅ Complete (local branch feature/7-27-legal-corpus, pending push + merge to main)

**Scope shipped (v1):**
- Country-agnostic `legal_documents` + `legal_document_chunks` tables with pgvector HNSW index (m=16, ef_construction=64)
- `legal_sources` catalog with per-source flags (`is_visual_order`, `force_ocr`) for handling source-specific quirks (broken text layers, RTL visual order)
- Admin upload endpoint `POST /admin/legal-documents` (SYSTEM_ADMIN, 50 MB cap)
- Full ingestion pipeline:
  - Text extraction (reuses Phase 9.1c abstraction): force-OCR branch at 300 dpi (page-by-page rendering, no OOM) for PDFs with broken text layers; text-layer branch for clean digital PDFs
  - NFKC normalization
  - Optional per-line Arabic visual→logical word-order reversal (flag-gated; suppressed when force_ocr=true since OCR is logical-order natively)
  - Hybrid chunking: article-boundary split (Arabic مادة and English Article with Western or Arabic-Indic numerals); oversized articles (>6000 tokens via tiktoken cl100k_base) sub-split at sentence boundaries
  - Bulk insert chunks; embed via OpenAI text-embedding-3-small (1536 dims) in batches of 50; bulk UPDATE vectors
  - Bounded retry on transient OpenAI errors (4 attempts, exponential backoff)
  - Celery `on_failure` backstop marks PENDING/PROCESSING docs FAILED if worker dies (OOM, SIGKILL, unhandled exceptions)
- Jurisdiction-scoped retrieval via cosine distance + per-source quirk handling
- AI Chat consumer (Phase E) — chat queries the corpus when the project's country maps to a supported jurisdiction, injects retrieved chunks as `<legal_context>` block, AI cites specific articles in responses
- Async chat with polling (Option 2) — chat backend returns immediately with job_id, frontend polls status endpoint every 1.5s, 90s cap, resumes polling on page refresh if in-flight
- Seed: Egyptian Tax Authority as first source (force_ocr=true, is_visual_order=false)
- 15 lessons captured (#153–#167)

**Phase D smoke verified GREEN on Civil Code 131/1948:**
- Clean Arabic text (corruption rate dropped from ~1300 → 7)
- 1107 chunks all embedded, 980 distinct articles detected
- Retrieval works for sales (مادة 418+), partnership (مادة 1149), and cross-language EN→AR queries
- Jurisdiction isolation enforced at data layer

**Phase E + Option 2 verified GREEN via manual UI test:**
- Arabic force-majeure question returned grounded Arabic response citing Egyptian Civil Code Articles 215, 217, 373
- Non-legal questions (e.g. "capital of France") gracefully answer without errors or empty legal-context blocks
- Async polling renders typing dots immediately; response appears smoothly when ready (~22-27 s total)

**Architectural decisions (locked):**
- pgvector with HNSW index (easy swap to IVFFlat via single migration if needed)
- OpenAI text-embedding-3-small (same model as KB; vectors from different models are not comparable, so this is fixed until a coordinated migration)
- TypeORM enum types with `_enum` suffix (lesson #143)
- TypeORM cannot own pgvector columns; Python owns writes (lesson #157)
- Jurisdiction as `varchar(10)` with DTO-level `@IsIn` allowlist (`EG`, `AE`, `SA`, `QA`, `UK`) — adding a country is a data change, not a schema migration

**Deferred (future enhancements, not blocking):**
**Chat speed (chat is currently ~22-27s for Arabic legal questions — bottleneck is Claude generating Arabic text on Anthropic's servers, ~20s of that; AWS deployment will save ~2-3s of network/CPU but not the generation itself). Two paths to faster chat:**
- **Streaming responses** — same total time, but text appears progressively (perceived 5× faster, like ChatGPT/Claude.ai). Touches backend, ai-backend, and frontend (SSE or similar). ~1-2 days of work.
- **Claude Haiku for chat** — 3× faster generation (~8s instead of 25s), possibly weaker legal reasoning. Requires A/B testing against real Arabic legal questions before committing. Sonnet stays for non-chat consumers (risk, compliance, claims, etc.) where quality matters more than latency.
- Additional AI consumers using the same retrieval pattern: risk analysis, compliance check, claims, notices, drafting, conflict-of-law / governing-law detection
- Scheduled crawler for UAE federal (uaelegislation.gov.ae — the only source verified permissive for automated access). All other sources (Dubai SLC, Dubai Legal Affairs, Qatar Al Meezan, KSA BoE, KSA Umm al-Qura, Egypt Alamiria) confirmed restricted/personal-use only — manual ingestion or licensed access only
- `source_type=CURATED_SUMMARY` content shape for license-restricted jurisdictions (team-authored summaries rather than verbatim law text)
- Admin UI for managing `legal_sources` (currently SQL-managed)
- Tuning for dual-concept Arabic queries (e.g. force majeure + contract effect — currently the target article ranks #20-ish; query rewriting or hybrid keyword+vector search are future options)
- Cleanup of deprecated `triggerEmbedLegalChunks` / `run_embed_legal_chunks` / `EmbedLegalChunksRequest` (marked @deprecated, still present)

**How to add a new country (operational checklist):**
1. Identify a clean PDF source from a ministry or parliament site
2. Verify the source's terms permit commercial reuse, or use curated summaries instead
3. Open a sample PDF in a plain text editor:
   - If word order is reversed in Arabic → `is_visual_order = true`
   - If characters are corrupted (ك→آ etc.) → `force_ocr = true`
4. INSERT a row into `legal_sources` with the correct flags
5. Add the country code to the DTO `@IsIn` allowlist if it's not already there (`EG`, `AE`, `SA`, `QA`, `UK`)
6. Upload via the admin endpoint with the new `source_id`; the pipeline handles everything else

---

### ✅ 7.28 — ERP System Integration (SAP / Oracle / Primavera / Dynamics) — per-org connector registry, import-only — COMPLETE (v1 + v1.1)
**Owner:** Ayman + Youssef | **Priority:** 🟡 MEDIUM | **Status:** ✅ Complete (v1 + v1.1) — shipped 2026-06-21
**PRs:** #73 (CryptoService prereq) · #75 (docs) · #79 (Part 1 backend) · #80 (Part 2a Client Portal) · #81 (Part 2b Admin Health) · #82 (v1.1 Part A operator-control backend + circuit-breaker) · #83 (v1.1 Part B admin UI + "who suspended")
**Migrations:** `1757000000001-AddErpIntegration` (ERP base) · `1758000000001-AddErpOperatorControl` (operator-hold state machine)
**Feature flag:** OFF by default — `ERP_INTEGRATION_ENABLED` must be `true` to expose any ERP route (customer or admin).

**What shipped (v1 — backend + both screens):**
- PER-ORG CONNECTOR REGISTRY (vendor→adapter via Symbol DI tokens; adapters self-register), resolved at job time from the org's `erp_connections.vendor` row — NOT a single global `ERP_PROVIDER` env var. Different orgs use different ERPs simultaneously (Org A on SAP, Org B on P6). Adding a new ERP = one adapter file + one registry entry, zero changes to the core sync engine / neutral model / queue / dashboard.
- Neutral cost model (`erp_cost_records`) — vendor-agnostic; per-connection field mapping translates each ERP's raw field names into the neutral shape.
- Sync engine + Bull queue (async, import-only v1). Credentials encrypted at rest (CryptoService), decrypted ONLY inside the worker, never returned on any API response.
- Adapters: Mock (dev/test) + SAP cost skeleton (capability-flagged; real API calls deferred — see 7.38).
- Client Portal "ERP Connections" screen (Part 2a) — customer owns identity/config/credentials/field-mapping; enable/disable + trigger sync.
- Admin "ERP Health" dashboard (Part 2b) — SYSTEM_ADMIN cross-tenant read of every org's connection state.

**What shipped (v1.1 — operator control + resilience):**
- Operator actions: suspend / unsuspend / force-check / guarded-delete (delete rejected unless the connection is on hold).
- Actor-tracked hold state machine: `none` → `operator_suspended` (a SYSTEM_ADMIN) vs `auto_suspended` (the circuit-breaker). The customer can re-enable ONLY a connection that is not held.
- Automatic circuit-breaker — consecutive-failure model (`ERP_CIRCUIT_BREAKER_ENABLED`, `ERP_CIRCUIT_BREAKER_THRESHOLD`); auto-suspends at the threshold, resets the counter on a successful check.
- Every operator action is reason-required, immutably audited (state + audit written in one transaction), and the target org's OWNER_ADMINs are notified (suspend/restore/remove — email + in-app). Delete resolves recipients BEFORE the hard delete and dispatches AFTER it commits (lesson #171).
- "Who suspended" surfaced on the admin list — the operator's name/email (or "System" for auto-holds) resolved via a single batched user lookup; the customer-facing response NEVER exposes `hold_by_user_id`.

**Cross-tenant safety:** ERP connections are org-scoped (carry `organization_id` directly), so they are NOT behind the Option B contract chokepoint. SYSTEM_ADMIN cross-tenant authority is made safe by role-gate + reason-required immutable audit (the `admin-organizations` precedent), verified by the contract-repo lint gate (exit 0, no exemption needed). See lesson #170.

**Remaining follow-ons:** 7.37 (entitlement) · 7.38 (working SAP adapter) · 7.39 (export direction) · 7.40 (schedule-linkage consumer) · 7.41 (mapping auto-discover). Task 7.35 (encrypt legacy plaintext secrets) reuses the same CryptoService.

---

### 7.29 — Settlement Agreement Acknowledgement Checkbox
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
**Legal basis:** AUP Section 4.3
- Mandatory checkbox in Claims settlement execution modal
- Text: "I understand that executing this settlement agreement has legal consequences. I have obtained independent legal advice or waive my right to do so."
- Confirm button remains disabled until checkbox is checked

---

### ✅ 7.30 — Clause Library Type Dropdown — COMPLETED (Ayman)
- Clickable type dropdown in ClauseReviewPage.tsx and ClausesPage.tsx

---

### 7.31 — Expand Frontend Test Coverage
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ⚠️ PARTIAL
- Grew from 2 test files / 8 tests to 10 test files / 44 tests through Phase 7.1
- Add `ContractDetailPage.test.tsx`, `ClauseReviewPage.test.tsx`
- Continue writing tests alongside new features as they are built

---

### ═══ TIER 4: Advanced Competitive Features (Do After Tiers 1-3) ═══

---

### 7.32 — Negotiation History & Institutional Memory
**Owner:** Ayman (data layer) + Youssef (UI)
**Priority:** 🟡 MEDIUM
**Competitors:** Luminance — their biggest 2026 feature (January 2026 update)
**Status:** ❌ Not started
**Depends on:** 7.19 (Redlining) + 7.22 (Playbook)

**Tasks:**
- Store negotiation events per contract:
    - Clause proposed → accepted / rejected / modified
    - Who made each change and when
    - Final agreed position per clause
- Build counterparty profile:
    - List of all past contracts with this counterparty
    - Patterns: which clauses they typically push back on
    - Their accepted positions from previous contracts
- When starting a new contract with a known counterparty:
    - AI surfaces: "You last worked with this counterparty in March 2025. They accepted 30-day payment terms but rejected the liquidated damages cap."
- Store reasoning notes: allow users to annotate why a position was accepted or rejected
- Tie into 7.22 Playbook: show where counterparty positions deviated from org standard

**Success metric:** When a user creates a contract with a repeat counterparty, SIGN automatically shows relevant history from previous negotiations before they start.

---

### 7.33 — Self-Service Contract Generation for Non-Legal Users
**Owner:** Youssef | **Priority:** 🟡 MEDIUM
**Competitors:** Juro, Tomorro
**Status:** ❌ Not started
**Depends on:** 7.22 (Playbook defines the guardrails)

**⚠️ Audit first:** Check if any template/generation feature already exists.

**Tasks:**
- Build Template Library (org-level):
    - Admin creates approved contract templates
    - Mark fields as: fixed (cannot change) / editable (can change within limits) / free text (full flexibility)
    - Set approval requirements per template type: e.g. subcontracts under $50k = no approval needed, above = legal review required
- Build self-service contract creation flow:
    - User selects template type
    - Fills in a simple form (counterparty, value, dates, scope summary)
    - SIGN generates the contract automatically
    - Routes for approval if required by template rules
    - Sends for signature when approved
- Build guardrail enforcement:
    - Fixed clauses cannot be edited by non-legal users
    - If a user tries to change a fixed clause, it triggers legal review
- Support Arabic and English templates

**Success metric:** A procurement manager generates a standard subcontract, gets it approved, and sends it for signature — all within SIGN, without emailing legal once.

---

### 7.34 — Insurance Carrier & Owner Portal
**Owner:** Youssef (portal UI) + Ayman (permissions + API)
**Priority:** 🟡 MEDIUM
**Competitors:** Document Crunch/Trimble
**Status:** ❌ Not started
**Depends on:** 7.17 (Dashboard) + 7.1 ✅ (Obligations)

**Tasks:**
- Build external stakeholder portal (separate from Guest Portal 7.18):
    - Project owner: invited via email to a read-only project portal
    - Portal shows: contract list, status, key dates, risk summary (NOT full contract text unless explicitly shared)
    - Insurance carrier view: coverage requirements extracted, compliance status
    - Lender/bank view: contract values, payment terms, milestone schedule extracted from contracts
    - No SIGN account required — secure link with configurable expiry date
- Build permission controls:
    - Choose what to share with each external stakeholder: full contract / summary only / specific sections only
    - Set portal link expiry date, revoke access at any time
    - Audit log: see who viewed what and when
- Build portal-specific notifications:
    - Notify owner when a contract is signed
    - Notify insurance carrier when a contract changes scope or value above a threshold
- Arabic + English, must be mobile-friendly
- **Must also implement Phase 6B.1 visual confidentiality on this portal**

**Success metric:** A project owner receives a secure portal link from their contractor, opens it on their phone, and within 2 minutes sees the status of all subcontracts on their project — without needing a SIGN account.

---

### ✅ 7.35 — Encrypt MFA TOTP Secret at Rest — COMPLETE
**Owner:** Ayman | **Priority:** 🟡 MEDIUM | **Status:** ✅ Complete (PR #88) — shipped 2026-06-21
**Depends on:** CryptoService (PR #73, shipped 2026-06-16)

**What shipped:**
- `users.mfa_totp_secret` is now encrypted at rest via `CryptoService` (`backend/src/common/utils/crypto.ts`), **reusing `ERP_CREDENTIAL_ENC_KEY`** (no new key/env var).
- **Dual-read anti-lockout helper** (`AuthService.decryptTotp`): a stored value is decrypted only when it starts with the `v1.` ciphertext marker; anything else is treated as legacy plaintext and used as-is — so reads never throw regardless of code-deploy vs data-migration ordering. Both read paths (`verifyMfa` login, `enableMfaTotp` enroll-confirm) go through it; `setupMfaTotp` encrypts on write but still returns the plaintext secret to the client for the QR/manual entry.
- **Forward-only idempotent migration `1759000000001`**: selects only `mfa_totp_secret NOT LIKE 'v1.%'` (re-runnable / half-run-safe), encrypts via the same `CryptoService` (no AES reimplemented in SQL), and **throws before any UPDATE if the key is missing (zero rows modified)**; `down()` is a no-op (reverting at-rest encryption is a security regression).
- **Shared `CryptoModule`** (`backend/src/common/crypto/`) extracted: both `AuthModule` and `IntegrationsModule` now consume `CryptoService` from it (ERP behaviour unchanged).
- Hard-fail (no silent plaintext): TOTP enrollment throws if the key is absent.
- See lesson #172 (live-auth secret → encryption-at-rest without lockout).

**Scoped OUT (and why):**
- **DocuSign RSA private key** — it is an **env var** (`DOCUSIGN_RSA_PRIVATE_KEY`, read via ConfigService in `docusign.service.ts`), NOT a DB-at-rest value, so `CryptoService` does not apply. Belongs to **deployment secrets management (Phase 9.2 — AWS Secrets Manager)**.
- **`mfa_secret`** (email-OTP compound `bcrypt(otp)|timestamp`) and **`mfa_recovery_codes`** — already one-way **hashed**, not recoverable secrets; encrypting them adds nothing.

> **⚠️ DEPLOYMENT PREREQUISITE:** `ERP_CREDENTIAL_ENC_KEY` is now **functionally required for MFA enrollment in every environment** — staging/prod MUST set it before this ships, or TOTP enrollment hard-fails AND the `1759000000001` migration refuses to run (throws, zero rows modified). It is already set in dev and documented in `.env.example`.

---

### 7.36 — ContractClause Chokepoint Migration (Option B remainder)

**Status:** ❌ Not started
**Depends on:** Option B 4-module chokepoint migration (COMPLETE — negotiation #72 /
guest-portal #74 / chat #76 / compliance); scopedFindByIdWithRelations base method
(shipped in the compliance finale)

**Context:** The 4-module chokepoint migration (negotiation/guest-portal/chat/compliance)
is complete — zero "migration scheduled" annotations remain in those modules. Three areas
with bare contract-scoped reads remain OUTSIDE that plan, surfaced by the enforcing lint,
all wall-protected + honestly labeled today:
- contracts.service.ts — ~9 ContractClause reads
- document-processing.service.ts — ~5 ContractClause reads
- compliance's loadClauses aggregation QB (closeable by the same subclass)

No ContractClauseScopedRepository exists yet — that subclass is the unit that closes all three.

**Scope (one recon-then-wire bucket, same model as the 4 modules):**
- New ContractClauseScopedRepository extending the scoped base — canonical
  clause → contract → project → org join, allowedFilterKeys per recon, registered in
  ScopedRepositoryModule.
- Route the contract-scoped ContractClause by-id/list reads through scopedFind /
  scopedFindByIdOrThrow / scopedFindAndCount; existing walls stay as defense-in-depth
  (two layers, never a swap).
- Reuse scopedFindByIdWithRelations (compliance finale) for any parent-load-with-relations shape.
- Leave + honestly re-label: writes, aggregation QBs (or wire loadClauses if cleanly
  contract-scoped), system/no-orgId, public-token reads.
- Red-before/green-after on real Postgres; live wall-denial assertions; the enforcing lint
  must stay exit 0; remove "migration scheduled" annotations from genuinely-chokepointed sites.

**Separate adjacent items (do NOT bundle — own buckets):**
- docusign.service.ts (~8 Contract reads/writes) — assess whether these belong here or their own bucket.
- ComplianceReportProcessor + ObligationReminderProcessor + learned-baseline.processor →
  future findAcrossAllOrgs-escape-hatch migration (system paths).

**Definition of done:** ContractClause reads chokepointed; loadClauses resolved; zero
"migration scheduled" annotations remain in the ContractClause surface; lint exit 0; suite green.

---

### 7.37 — ERP Feature Entitlement (per-package + per-org on/off)
**Owner:** Ayman | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
**Depends on:** 7.28 ✅ (ERP Integration v1 + v1.1)
- Add a second operator layer ABOVE connection control: entitlement decides WHETHER an org may use ERP integration at all (per subscription package + per-org override) — distinct from connection control (suspend/unsuspend a specific live connection).
- Two clean layers: entitlement ("may this org have ERP at all?") vs connection control ("is this org's existing connection allowed to operate right now?").
- Surfaces in the admin portal; gates the Client Portal "ERP Connections" screen behind the entitlement, not just the `ERP_INTEGRATION_ENABLED` global flag.

---

### 7.38 — Working SAP Cost Adapter
**Owner:** Ayman | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
**Depends on:** 7.28 ✅ · live SAP credentials + deployment
- Replace the SAP cost skeleton (capability-flagged, currently throws) with real SAP API calls returning live cost data into the neutral `erp_cost_records` model.
- Needs live SAP creds and a deployed environment to exercise end-to-end; the registry / queue / model / dashboard need zero changes (one adapter file).

---

### 7.39 — ERP Export Direction (push to ERP)
**Owner:** Ayman | **Priority:** 🟢 LOW | **Status:** ❌ Not started
**Depends on:** 7.28 ✅
- The import-only counterpart: push milestones / payment terms FROM SIGN INTO the ERP project schedule.
- Currently a capability-flagged skeleton on the connector interface; build the real export path + per-vendor mapping.

---

### 7.40 — ERP Schedule-Linkage Consumer
**Owner:** Ayman | **Priority:** 🟢 LOW | **Status:** ❌ Not started
**Depends on:** 7.28 ✅ · 7.1 ✅ (Obligations)
- The `obligations.external_activity_ref` column already exists; build the consumer that uses it for early-warning (link an obligation to an ERP schedule activity and surface slippage).
- Column is shipped; only the consumer is missing.

---

### 7.41 — ERP Mapping Field Auto-Discover
**Owner:** Ayman | **Priority:** 🟢 LOW | **Status:** ❌ Not started
**Depends on:** 7.28 ✅
- Let customers pick ERP field names from a discovered list (introspect the connected ERP) instead of hand-typing field names in the connection's mapping config.
- Reduces mapping errors; depends on each adapter exposing a "list available fields" capability.

---

### ✅ 7.42 — Arabic PDF Rendering (Acrobat-Strict Fix) — COMPLETE (PR #97)
**Owner:** Ayman | **Priority:** ✅ DONE | **Status:** Shipped 2026-06-24
**Depends on:** None (closes a real-world bug surfaced via the Muhlbauer Arabic contract)
- Closes the Acrobat crash (`EXCEPTION_ACCESS_VIOLATION` in CTJPEGReader / Font Capture) on real-world Arabic contract exports.
- Closes the garbled-Latin-footer regression (`Įeįerated by Sİıį PlatĲorĳ`) on the same exports — same root cause surfacing as wrong glyph indexing instead of a crash.
- Root cause: pdfkit's `fontkit.TTFSubset.encode()` produces a minimal subset with non-standard `sfntVersion 'true'` + only 7 tables — Acrobat strict-rejects this; qpdf / fontTools / Chrome accept it.
- Fix:
  - Full Amiri TTF embedded via a module-init monkey-patch on pdfkit's `EmbeddedFont.embed` (full sfntVersion 0x00010000 + all 15 tables).
  - `/CIDToGIDMap` stream built from `fontkit.Subset.glyphs[]` so content-stream subset gids round-trip to the original full-Amiri glyphs (0 outline mismatches end-to-end).
  - All pure-Latin chrome (footer, brand, English labels) routed to PDF base-14 Helvetica (Type1 /WinAnsiEncoding, no embedding, no fontkit subset, no Acrobat strict risk).
- Scope of the fix: `export.service.ts` (contract PDF / risk report / contract summary) + `portfolio-export-renderer.service.ts`. Compliance was OUT of scope (separately broken; consolidated into 7.43 below).
- New central helper: `backend/src/common/utils/pdf-arabic.ts` (1103 lines) — owns Amiri loading + per-script-run emission + bracket mirror swap + whole-line `/ActualText` sentinels + the two pdfkit monkey-patches. The patches install at first import and are globally effective for the rest of the process lifetime (idempotent, postscriptName-gated, fail-safe on missing pdfkit).
- Trade-off: PDF size grows ~500 KB per Arabic export. Accepted for Acrobat correctness. Latin-only PDFs unaffected.
- Regression guard: RED-first font-validity test in `export.service.arabic.spec.ts` asserts every embedded FontFile2 has standard sfntVersion + all 10 OpenType-required tables.
- CI-portability follow-up (commit `3c595db` on the same PR): qpdf `--check` external assertion gated behind a `spawnSync('qpdf','--version')` ENOENT presence probe — CI runners without qpdf installed no longer false-fail.
- Verified in real Acrobat: no crash, Arabic letter joining + brackets + mixed Arabic/Latin/digit content all correct, copy/paste returns logical text, footer reads correctly.
- New lessons: #174 (Acrobat-strict subset rejection + the fix shape), #175 (in-container tools disagree with the real reader — trust the real reader), #176 (gate external-binary test deps behind presence detection).

---

### 7.43 — Compliance PDF Rebuild + Arabic Support (PR-A)
**Owner:** Ayman | **Priority:** 🟠 HIGH | **Status:** ❌ Not started
**Depends on:** 7.42 ✅ (the `pdf-arabic.ts` helper that PR #97 introduced)
- Single small consolidated PR that closes TWO compliance gaps:
  - **(a) pdfmake 0.3.x migration** — `backend/src/modules/compliance/services/pdf-report.service.ts` still uses the legacy v0.1 `require('pdfmake')` + `new PdfPrinter(...)` pattern; throws `TypeError: PdfPrinter is not a constructor` on first end-to-end trigger. Phase 3.4 compliance reports (COMPLIANCE_SUMMARY / OBLIGATIONS_REPORT / JURISDICTION_CONFLICT) do not work end-to-end. Mechanically mirror PR #92's export-service fix: `require('pdfmake/js/Printer').default` + `require('pdfmake/js/URLResolver').default` + `new URLResolver(null)` + `await printer.createPdfKitDocument(...)` in an async `toBuffer()`. Add a no-mock `%PDF` integration test (lesson #140).
  - **(b) Arabic-tofu latent gap** — compliance currently registers only Helvetica (no Amiri, no `pdf-arabic.ts` wiring). Any Arabic content fed into a compliance PDF (Arabic obligation description, Arabic jurisdiction name, Arabic contract title) renders as Helvetica `.notdef` boxes — no crash, no garble, just missing glyphs. Wire `arabicFontDescriptors()` + `arabicVfs` into the PdfPrinter call, wrap Arabic-bearing fields with `emitArabicParagraph` / `arabicHeadingText`, and keep `defaultStyle: { font: 'Helvetica' }` exactly as PR #97 did. The PR #97 monkey-patches install globally at first import of the helper, so compliance automatically inherits the Acrobat-strict-safe Amiri embed once it imports the helper anywhere in its module graph — no per-service wiring beyond the import.
- Add an Arabic-rendering regression test for compliance (real pdfmake — no mock; assert Amiri + Helvetica both in font dict; assert `%PDF` magic + `%%EOF`).
- ~1 hour of work; mechanical follow-on. Do NOT file as housekeeping — this is production-broken (a) + latent tofu (b).
- See CLAUDE.md Outstanding Issues #1 + lessons #142 + #174.

---

## 🎨 PHASE 6B — Visual Confidentiality & Watermarks
> These were originally Phase 6.5 and 6.6. Moved here because features in Phase 7 will change the UI — building protection layers before features means rebuilding them after.
> Do these AFTER Phase 7 feature development is complete.

---

### 6B.1 — Visual Confidentiality (25 Attack Vectors)
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- 25 attack vectors across 3 tiers (Casual, Intermediate, Advanced)
- Components: ScreenshotProtection, KeypressInterceptor, DevToolsDetector, DOMIntegrityGuard, VisibilityOverlay, PrintBlocker, BotDetector, RootJailbreakDetector
- Screen capture protection (CSS + JS-based), right-click disable on clause content
- Print CSS watermark overlay, DevTools detector — blur content when DevTools is open
- ⚠️ 3 scenarios are technically UNBLOCKABLE (physical camera, GPU frame buffer, VM screenshots) — answer is invisible watermark (6B.2)
- Phase 7.34 Insurance Carrier Portal must also implement this

---

### 6B.2 — Invisible Watermark System
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Invisible watermarks in all downloaded contract PDFs (user ID + timestamp + org ID)
- CSS steganography: diagonal repeating text at opacity 0.03-0.05
- Unique per user per session: encodes user email, date, contract ID
- Extend existing pdfmake watermarks from compliance reports
- Add watermark decoder tool in admin portal
- Mention watermarking in Terms & Conditions as legal deterrent

---

## 🤖 PHASE 8 — AI Model Migration
**Status:** ❌ Not started — begin evaluation during Phase 7

---

### ✅ 8.1 — AI Model Evaluation & Migration Path — COMPLETE (2026-06-27, PR #103)
**Owner:** Ayman + Youssef | **Status:** ✅ Complete (squash-merged to `main` at `28cf3a3`)

**What shipped:**
- **Model-id centralization** — `ANTHROPIC_MODEL` in `ai-backend/app/config/settings.py`
  (default `claude-sonnet-4-6`, env-overridable); all 9 agents read `settings.ANTHROPIC_MODEL`
  via `self._model` — same model, single source of truth. A guard test fails if any agent
  reintroduces a hardcoded literal. (No model swap — that is 8.4/8.5.)
- **Arabic clause-extraction accuracy harness** (`ai-backend/tests/accuracy/`) — anonymized
  General Conditions baseline fixture (81k chars / 9 chunks; raw doc never committed), a
  38-clause structural golden set, a pure model-agnostic scorer (count, boundary P/R/F1,
  missing/spurious/duplicate, clause-type accuracy, verbatim fidelity), a gated live runner
  (`temperature=0` in the harness only + token/cost capture), and CI-safe unit tests. The live
  billable test is skipped in CI (needs `RUN_ACCURACY_SUITE=1` + `ANTHROPIC_API_KEY`).
- **Captured `claude-sonnet-4-6` baseline** (live run on the fixture): boundary
  precision/recall/F1 = **1.0 / 1.0 / 1.0** (38/38 clauses; 0 missing/spurious/duplicate; TOC
  correctly skipped), verbatim fidelity **0.9995**, clause-type accuracy **0.6842** (a soft
  signal over fuzzy categories). ~72.7k in / 50.7k out tokens, ~$0.98 est. (placeholder pricing).
- **Prompt inventory** — `docs/ai-prompt-inventory.md` (living inventory of all 9 Claude prompts
  tagged with intended OSS replacements) + `docs/phase-8.1-investigation.md` (findings + rule).

**Preferred OSS replacement candidates** (to be tested in 8.4/8.5 — NOT selected yet; all
self-hosted on SageMaker so data stays inside our AWS):
- Clause classification → **ContractBERT**
- Risk classification → **ContractBERT (fine-tuned)**
- Risk explanation generation → **Mistral 7B** OR **DeepSeek-R1-Distill-Qwen-32B**
- Arabic / bilingual contracts → **LEGAL-XLM-RoBERTa**

**Migration rule (refined this phase):** migration is gated on **Arabic accuracy only** — never
migrate without running the Arabic accuracy suite first, and the candidate's Arabic accuracy must
hold or improve vs the `claude-sonnet-4-6` baseline. **Cost is recorded for awareness but is NOT a
hard gate — quality decides.** Migrate one prompt at a time; the embeddings model is excluded
(changing it requires a coordinated re-embedding migration).

---

### 8.2 — OCR Migration: AWS Textract
**Owner:** Ayman | **Status:** ❌ Not started
- Abstract OCR layer: `OCR_PROVIDER` env var (tesseract | textract)
- Test Arabic scanned documents — compare accuracy between tesseract and Textract
- ⚠️ Textract Arabic: available in specific AWS regions only (us-east-1, eu-west-1)

---

### 8.3 — Annotation Setup: in-app review tooling (Label Studio superseded)
**Owner:** Ayman | **Status:** ✅ ANNOTATION COMPLETE — gold set exported 2026-07-14 (`docs/phase-8.3-gold/`); Option-2 scope done (clauses reviewed, all 166 visible-High risks human-verified, the rest tagged unverified)
- **DECISION:** annotate IN-APP (editable Risk Analysis tab + editable contract parties), NOT Label Studio — the app already renders Arabic/RTL clauses + risks correctly and the pre-labels already live in the DB, so correcting them in place beats an external tool + import/export round-trip. (Label Studio tooling was investigated then removed; `docs/phase-8.3-labelstudio-plan.md` is the decision record.)
- **BUILT (PR #130):** risk LEVEL + CATEGORY (the 17 clause-type labels, not the 8 broad buckets) human-correctable with original-vs-corrected tracking (`is_edited_by_user` + `original_risk_level`/`original_risk_category`); contract parties correctable (Swap First⇄Second + `is_parties_edited_by_user` + `original_party_first_name`/`original_party_second_name`). Additive migrations `1764000000001` / `1765000000001`.
- **Prior:** the one-off risk pre-labeling batch (PR #125) populated `risk_analyses` (1,061 rows); the new tracking columns capture human corrections on top = the was_corrected signal.
- **Risk-tab rework — ✅ COMPLETE (PR #137, merged `8a21274`, 2026-07-07):** the annotation surface is upgraded — Risk tab now lists risks clause-by-clause grouped per source document (shared server-side ordering with the Clauses tab); Clauses tab is clauses-only; **recommendation is now human-editable** via `PATCH /risk-analysis/:id` with `original_recommendation` snapshot-once tracking (a THIRD was_corrected field alongside level/category); plus an AI re-phrase → review → merge flow (ClauseRewriterAgent) that proposes a rewritten clause. Migrations `1766000000001/2/3`. This makes the recommendation column part of the correctable ground-truth. **Phase 8.3 annotation is now UNBLOCKED / ready** — Ayman can correct level, category, AND recommendation in place; the gold export just needs to include the three was_corrected fields.
- **✅ Gold set EXPORTED — 2026-07-14 (`docs/phase-8.3-gold/`, read-only, untracked working files).** PR #156 (`6388e57`) shipped the risk-tab **top-2 visible per clause + "Show more" + persisted swap** (`risk_clause_visibility`, migration `1770000000004`) + **soft-delete infra** (`is_deleted`, migration `1770000000003`, **0 rows deleted**) + completeness/export redefined to the visible top-2. Export snapshot: **468 clauses included** (461 APPROVED + 7 EDITED) / 40 REJECTED excluded / 508 total; **1,246 risks** — 236 verified, **all 166 visible-High human-verified**, rest tagged unverified; every risk tagged `verified`/`unverified`/`visible`/`clause_rejected` (`clean_training_signal` = 212). `_build.js` + `_raw_*.jsonl` allow deterministic re-export. **8.4/8.5 are UNBLOCKED — downstream MUST filter `verified=true` for clean training signal (lesson #244).**
- **Still DRAFT (`_TODO`):** Arabic/French `riskTab.*` + category + swap labels pending Youssef's legal review (does NOT block the gold set).
- **✅ DONE — risk-analyzer same-language output (Arabic in → Arabic out) — PR #163 (Issue 4):** `RiskAnalyzerAgent` now emits `description`/`suggestion` in the clause's language (Arabic in → Arabic out), matching `ClauseRewriterAgent`. Shipped as part of the batched/parallel/replace risk-analysis rework (PR #163, Issues 4 + 5 — see CLAUDE.md "AI Pipeline Architecture").
- **BACKLOG (post-annotation — surfaced during the gold-set build):**
  1. **Chunking-truncation fix — ✅ CODE FIXED + MERGED (PR #165, Issue 1); remaining = verification on a real 81k GC doc.** Long Arabic multi-bullet clauses lost their tails DETERMINISTICALLY per template family (NTA twins lose GC secs 10/12/15/38; Orascom family loses GC sec 3 in 4/4; O&M twins both lose clause 9); ~16+ clauses REJECTED. Root cause (grounded on Project_2Depot GC sec 10, truncated at source offset 14,835 ≈ `_CHUNK_SIZE`): the packer overshot 15k, hard-split the boundary article, and the "skip continuations" note dropped the orphaned tail (no partial to stitch — lesson #239). FIX (PR #165): the packer now moves an overshooting article WHOLE into the next chunk (never hard-split at packing). **Still OPEN:** existing contracts are NOT re-extracted — verify on a FRESH upload of a bullet-heavy 81k General-Conditions doc that the previously-truncated sections carry full tails, then (optionally) re-extract the affected legacy contracts. See `docs/issue-1-clause-extraction-investigation.md`.
  2. **Parties-extraction bug** — the reversed-party EXTRACTION regex in `document-processing.service.ts` fails in ~7/15 contracts (missing / second-missing / swapped); fix the root, don't rely on manual correction (lesson #242).
  3. **✅ DONE — Project14 document-tab UI bug — PR #163 (Issue 3):** the clause-review document tabs mis-rendered when documents shared a label (5 of 6 shown, a clause hidden); fixed — duplicate-label fallback to filename, overflow-scroll tab bar, zero-clause "No clauses in this document" empty state, `dir="auto"`. Shipped in PR #163.
  4. **Clause-edit snapshot + revert + unlock** — clause TEXT edits overwrite in place with no original snapshot AND lock the review card afterward; give clause edits the same snapshot/revert/unlock treatment risk/party edits have (lesson #241).
  5. **🔴 SECURITY — exposed GitHub token (flagged this session):** investigate and **ROTATE immediately**; if it was ever committed, purge from history. **Prioritize.**
  6. **Regenerate legacy risks for the 13 remaining projects** — the Issue-5 batched/parallel/replace machinery is READY (PR #163); only Project9 was regenerated (the pilot). Re-run `finalizeReview` (or a batch driver) per project for full-coverage, same-language, real-category risks — the replace step preserves any human-edited/merged rows (`is_edited_by_user=true` OR `merged_at IS NOT NULL`). NOT urgent; legacy risks keep working until regenerated.
  7. **Strip leading list-number from clause content once captured in `section_number`** — after the Issue-1 numPr reconstruction (PR #165), a reconstructed `N-` / `N.` appears in BOTH `section_number` and the content start (e.g. `"1. التعريفات"`), matching pre-existing literally-numbered clauses. Extend `_strip_article_prefix` (or the writer) to strip a leading list number once it's captured. Cosmetic; not a defect (no doubling).
  8. **Category vocabulary redesign (needs Youssef)** — three vocabularies remain misaligned: the AI prompt's category names, the 8-row `risk_categories` taxonomy, and the 17 clause-type labels the annotation UI uses. Issue-5 shipped a minimal `RISK_CATEGORY_ALIASES` map + broadened prompt (Uncategorized → 0% on the pilot) as a bridge; the real fix is ONE agreed taxonomy. Needs Youssef's legal-terminology decision.
  9. **Obligations job parse failure** (`Expecting value: line 1 column 1`) — the obligations extraction job failed to parse the AI response during the Project9 pilots. Separate from the risk pipeline; likely the same fence-/prose-tolerant-parse gap already fixed in the risk agent. Root-cause the obligations agent's response parse.
  10. **Project14 Annex-7 DB label patch must be re-run on other environments** — a 1-row DB patch fixing the Project14 "ملحق العقد رقم 7" (Annex 7) document label was applied LOCALLY only during annotation. It is NOT a migration — re-run the same 1-row `UPDATE` on any other environment that carries Project14 data.

---

### 8.4 — Clause Classification: ContractBERT
**Owner:** Ayman | **Status:** ❌ Not started
- Fine-tune ContractBERT (or legal-BERT) on annotated clause data from 8.3
- Compare accuracy vs Claude API for clause type classification
- Only proceed when 500+ annotated examples available

---

### 8.5 — Risk Classification & Confidence Threshold
**Owner:** Ayman | **Status:** ❌ Not started
- Train risk classifier on annotated data
- Set confidence threshold: below threshold → flag for human review
- A/B test: Claude API risk assessment vs trained model

---

### 8.6 — Model Training Infrastructure (AWS SageMaker)
**Owner:** Ayman + Youssef | **Status:** ❌ Not started
- Set up SageMaker training jobs configuration
- Define training pipeline: data prep → train → evaluate → deploy
- Cost estimate: SageMaker training is charged per compute hour
- Only needed when you have enough annotated data (500+ examples minimum)

---

## ☁️ PHASE 9 — Deployment Preparation
> All other Phase 9 tasks start when MVP features are ready.

**Status:** ⏳ In progress (9.1 ✅ Complete)

---

### ✅ 9.1 — Abstract Infrastructure Layers
**Owner:** Ayman | **Status:** ✅ SHIPPED (PR #35, 2026-05-28)

Three adapters abstracted behind interfaces. Zero behaviour change — all defaults unchanged.
No new env vars required for existing local dev deployments.

- **9.1a — StorageService** (`STORAGE_DRIVER`: `local` default → `s3`):
  `IStorageAdapter` interface + `STORAGE_ADAPTER` DI symbol. `LocalStorageAdapter` (active).
  `S3StorageAdapter` (skeleton — raises until `AWS_S3_BUCKET` set). `StorageModule` `@Global()`.
  3 fs-bypass fixes: `compliance-report.processor.ts`, `compliance.controller.ts`,
  `gdpr-export.service.ts`. New `uploadBuffer()` method on `StorageService`.

- **9.1b — EmailService** (`EMAIL_DRIVER`: `smtp` default → `ses`):
  `IEmailProvider` interface + `EMAIL_PROVIDER` DI symbol. `SmtpEmailProvider` (active).
  `SesEmailProvider` (ready — requires AWS credentials). `FROM_EMAIL` env var mismatch
  bug fixed (was `EMAIL_FROM` in one code path). `require()` → `import` for nodemailer.

- **9.1c — Text extraction** (`TEXT_EXTRACTOR`: `tesseract` default → `textract`):
  `BaseTextExtractor` ABC (`extract_pdf(file_path, page_count) -> str`).
  `TesseractTextExtractor` concrete impl (active — renamed from `TextExtractorService`,
  `self.last_page_count` mutable state removed, explicit `page_count` param in `_ocr_pdf()`).
  `TextractTextExtractor` skeleton (raises `NotImplementedError` — see known gaps below).
  `get_text_extractor()` factory with lazy imports. Backward-compat re-export preserved.

**Known gaps before `s3`/`ses`/`textract` can be activated (do NOT enable without resolving):**
1. `compliance_report_jobs.file_path` stores full localhost URL after 9.1a — must audit before S3 switch
2. `operations-review.service.ts` writes config JSON to `__dirname` — out of StorageService abstraction
3. `DocumentProcessingService.getLocalFilePath()` passes local paths to Celery — must pass S3 coordinates for Textract to work
4. Textract also requires: `boto3` in requirements.txt, block-tree parser for Arabic RTL layout, raised Celery `soft_time_limit`
5. S3 adapter `upload()` body still raises `NotImplementedError` until `AWS_S3_BUCKET` is set

~~5. `contract_status` enum drift~~ ✅ Resolved 2026-05-28 — audit confirmed no drift (12 values in sync; see comment in `contract.entity.ts`)
~~6. `sendGenericEmail` swallows errors~~ ✅ Resolved 2026-05-28 — `sendGenericEmail` now throws; Bull retries live; high-level methods catch at caller level (PR #36)

**Hard rules — never violate:**
- Do NOT set `STORAGE_DRIVER=s3`, `EMAIL_DRIVER=ses`, or `TEXT_EXTRACTOR=textract` in any
  environment until ALL prerequisites above are resolved.
- The `BaseTextExtractor.extract_pdf()` signature is fixed: `(file_path: str, page_count: int) -> str`.
  Do not add instance state to pass `page_count` implicitly — the explicit parameter exists to
  prevent race conditions across concurrent Celery workers.

---

### 9.2 — AWS Infrastructure Setup
**Owner:** Ayman + Youssef | **Status:** ❌ Not started
- RDS PostgreSQL 15 (pgvector + uuid-ossp extensions), ElastiCache Redis, S3 (AES-256 encryption)
- ECS or EC2 for containers, VPC security groups, automated backups (7-day retention)
- Production secrets in AWS Secrets Manager
- Replace `JWT_REFRESH_SECRET` placeholder with cryptographically random value
- **DocuSign RSA private key (`DOCUSIGN_RSA_PRIVATE_KEY`)** — deferred here from Phase 7.35: it is an env secret (not DB-at-rest), so it belongs in the secrets manager, not `CryptoService`. Store it in AWS Secrets Manager with PEM newlines preserved.
- Ensure `ERP_CREDENTIAL_ENC_KEY` (encrypts ERP credentials AND MFA TOTP secrets — Phase 7.28 / 7.35) is set in the secrets manager as a high-entropy random value; a re-encryption migration is required before any rotation.

---

### 9.3 — CI → CD Pipeline & Staging
**Owner:** Ayman + Youssef | **Status:** ❌ Not started
- Staging deploy job with manual approval gate
- Blue-green deploy + rollback strategy
- `docker-compose.prod.yml` — secrets from env vars only
- Staging environment with separate DB and S3 bucket

---

### 9.4 — Monitoring: Sentry + CloudWatch
**Owner:** Ayman + Youssef | **Status:** ❌ Not started
- Sentry for React frontend JS errors (free tier)
- Structured logging (winston/pino) → CloudWatch
- Alarms: CPU > 80%, Memory > 85%, Error rate > 1%, queue depth > 100
- Wire `_finalizeLogin` alert (deferred from Phase 1.7): Sentry alert when outer catch fires > N times/hour
- Wire Paymob activation failure to dead-letter notification (deferred from Phase 1.6)

---

### 9.5 — Frontend: Vercel Deployment
**Owner:** Youssef | **Status:** ❌ Not started
- vercel.json config, custom domain, preview deploys for PRs

---

### 9.6 — Paymob Webhook Activation
**Owner:** Ayman | **Status:** ⏳ BLOCKED — Paymob test API keys required
**Location:** `subscriptions.service.ts:383` — `TODO(1.6)` already in place
**When unblocked:**
- Idempotency check — prevent double-activation in race conditions
- DB transaction guard
- Admin alert on activation failure
- Non-200 response on failure so Paymob knows to retry

---

### 9.7 — Migrate JWT from localStorage to httpOnly Cookies
**Owner:** Youssef | **Priority:** 🟡 MEDIUM — do before production deployment
**Status:** ❌ Not started
- Current JWTs in localStorage (authSlice.ts, axios.ts ×3)
- Zero XSS risk today (Phase 3.5 confirmed zero dangerouslySetInnerHTML)
- ~1 day effort: Set-Cookie (backend) + remove localStorage (frontend) + `axios withCredentials: true` + refresh endpoint reads from cookie

---

### 9.8 — Fix localhost:5175 → Production URLs
**Owner:** Ayman | **Status:** ❌ Not started
- If not already done in Phase 5.4, replace any remaining localhost references with production URLs
- `NODE_ENV !== 'production'` gate on CORS/CSP localhost entries already in place (Phase 4.3) — verify before deploy

---

## 🔒 PHASE 10 — SOC 2 Readiness
**Status:** ❌ Not started — build security habits now, formal certification later

---

### 10.1 — Data Retention & Audit Trail
**Owner:** Ayman + Youssef | **Status:** ❌ Not started
- Retention periods: Contracts 7yr, Audit logs 3yr, Sessions 30d
- Soft delete for contracts — never hard delete, mark as deleted only
- Immutable `audit_logs` table (no UPDATE/DELETE allowed)
- Audit log viewer in admin portal
- Document in `docs/DATA_RETENTION_POLICY.md`

---

### 10.2 — Encryption & Access Controls
**Owner:** Ayman + Youssef | **Status:** ❌ Not started
- RDS encryption at rest, S3 SSE, HTTPS/TLS enforced at load balancer
- Never log PII in application logs
- External penetration test before launch

---

### 10.3 — AI Prompt Data Compliance (SOC 2 + GDPR)
**Owner:** Ayman | **Status:** ❌ Not started
- Audit all Anthropic API prompts — ensure no full user PII is sent to external AI
- Data anonymization layer before any external AI calls
- MENA privacy law compliance: Egypt Law 151 of 2020, UAE Decree-Law No. 45 of 2021, Saudi PDPL

---

### 10.4 — Mobile App (PWA First)
**Owner:** Youssef | **Status:** ❌ Not started
- Progressive Web App first — installable, offline-capable
- Native shell (Capacitor) later if needed

---

## 📊 PHASE 11 — Training Data & AI Improvement
**Status:** ❌ Not started — start collecting data now

---

### 11.1 — Build Feedback Loop & Training Dataset
**Owner:** Ayman + Youssef | **Status:** ❌ Not started
- UI for flagging incorrect clause extractions (thumbs up/down on each extracted clause)
- `clause_extraction_feedback` table + admin review UI (correct + approve)
- Approved corrections become few-shot examples in future extraction prompts
- Track extraction accuracy per document type (Agreement, Particular Conditions, General Conditions)
- Label Studio setup: `docker run -p 8080:8080 heartexlabs/label-studio`
- Target: 500+ annotated clauses before attempting any fine-tuning

---

## 🏆 Competitive Moat — Must Never Be Deprioritized

1. **Arabic contract NLP** — genuine Arabic clause extraction and risk analysis, not just a translated UI
2. **MENA regulatory compliance** — UAE PDPL, Egypt Law 151, Saudi PDPL built natively into the platform
3. **Construction-specific clause library** — FIDIC, NEC, local Egyptian/UAE standard contracts as reference
4. **MENA price accessibility** — enterprise CLMs cost $50k–$500k/year. SIGN targets mid-size MENA construction firms

**⚠️ TIMING ALERT:** Trimble acquired Document Crunch (April 2026) and is integrating it into Trimble Construction One. They currently have zero Arabic/MENA presence. SIGN has approximately 12-18 months before a well-funded competitor with 10,000+ construction project deployments potentially enters the MENA market. Use this window.

---

## 🏁 Completion Tracker

| Phase | Task | Status | Owner | Date |
|-------|------|--------|-------|------|
| 1 | All core bug fixes (1.1-1.5) | ✅ Complete | A+Y | 2026-05-20 |
| 2 | Testing & CI (139 tests) | ✅ Complete | A | 2026-05-20 |
| 3 | Input Security (all 5 + ILIKE) | ✅ Complete | A+Y | 2026-05-25 |
| 4 | Security Hardening + Password | ✅ Complete | A+Y | 2026-05-20 |
| 5.1 | CLAUDE.md + lessons.md (109) | ✅ Ongoing | A+Y | ongoing |
| 5.2 | docs/SETUP.md (524 lines) | ✅ Complete | A | 2026-05-21 |
| 5.3 | Clean stale branches | ✅ Complete | A | 2026-05-22 |
| 5.4 | Fix ManageX backlinks | ✅ Complete | Y | 2026-05-22 |
| 5.5 | Legal compliance + FR locale | ✅ Complete | Y | 2026-05-22 |
| 5.6 | Admin-security ILIKE fix | ✅ Complete | A | 2026-05-25 |
| 5.7 | failed_login_attempts (no bug) | ✅ Confirmed | A | 2026-05-22 |
| 5.8 | Password reuse block | ✅ Complete | A | 2026-05-22 |
| 6.1 | ManageX Rebrand | ✅ Complete | Y | 2026-05-14 |
| 6.2 | Coming Soon Pages | ✅ Complete | Y | 2026-05-24 |
| 6.3 | Landing Polish | ✅ Complete | Y | 2026-05-24 |
| 6.4 | Mobile Responsive | ✅ Complete | Y | 2026-05-25 |
| 6.7 | Frontend Design Skill | ✅ Available | — | — |
| 6.8 | /review Command | ✅ Complete | A | 2026-05-24 |
| 6.9 | Waitlist Email Capture | ✅ Complete | A+Y | 2026-05-27 |
| 6.10 | Mission Statement | ⏳ Blocked | Y | |
| 7.1 | Obligation Tracking (4 steps) | ✅ Complete | A+Y | 2026-05-25 |
| 7.2 | Route Shadowing Fix | ✅ Complete | A | 2026-05-25 |
| 7.3 | Enum Migration Fix | ✅ Complete | A | 2026-05-25 |
| 7.4 | Reminders Endpoint | ✅ Complete | A | 2026-05-25 |
| 7.5 | Type Dropdown Labels | ❌ Not started | Y | |
| 7.6 | Calendar Plan Gate | ❌ Not started | Y | |
| 7.7 | Wire Reminder History | ❌ Not started | Y | |
| 7.8 | Portfolio Empty State | ❌ Not started | Y | |
| 7.9 | Audit Silent Migrations | ✅ Complete (PR #34) | A | 2026-05-27 |
| 7.10 | In-app Dispatch (Reminder Processor) | ✅ Complete (already done) | A | 2026-05-27 |
| 7.11 | RTL Polish (react-big-calendar) | ❌ Not started | Y | |
| 7.12 | File Upload + Evidence FileDropZone | ❌ Not started | A+Y | |
| 7.13 | Clause Deep-Linking from Drawer | ❌ Not started | Y | |
| 7.14 | Calendar effectiveStatus Coloring | ❌ Not started | Y | |
| 7.15 | Obligation Delete/Edit Permissions | ✅ Complete (PR #40) | A | 2026-06-01 |
| 7.16 | Legal-Translator i18n Review | ❌ Not started | A+Y | |
| 7.17 | Portfolio Dashboard | ❌ Not started | Y | |
| 7.18 | Guest Portal | ❌ Not started | Y | |
| 7.19 | Counterparty Redlining | ❌ Not started | Y | |
| 7.20 | Project Enhancements | ❌ Not started | Y | |
| 7.21 | RFP Analysis | ❌ Not started | A+Y | |
| 7.22 | Contract Playbook | ❌ Not started | A+Y | |
| 7.23 | Word Add-In | ❌ Not started | Y | |
| 7.24 | Knowledge Base | ✅ Complete (PR #40) | A | 2026-06-01 |
| 7.25 | Poor Scan Quality | ✅ Complete (PR #41) | A+Y | 2026-06-01 |
| 7.26 | i18n Completion (Track A) | ✅ Complete (Track A, PR #42) | A+Y | 2026-06-02 |
| — | Internal Contract Sharing Fix | ✅ Complete (PR #44) | A | 2026-06-04 |
| — | CONTRACTOR_* Audit | ✅ Audited — removal blocked until 7.18 | A | 2026-06-04 |
| — | ContractShare Step 1 — dead endpoint + broken email + org-scope fix | ✅ Complete | A | 2026-06-05 |
| 7.27 | Legal Corpus | ✅ Complete (feature/7-27-legal-corpus, pending push) | A | 2026-06-10 |
| 7.28 | ERP Integration (per-org connector registry, import-only; + v1.1 operator control) | ✅ Complete (v1 + v1.1, PRs #79–#83) | A+Y | 2026-06-21 |
| 7.29 | Settlement Checkbox | ❌ Not started | Y | |
| 7.30 | Clause Library | ✅ Complete | A | |
| 7.31 | Frontend Tests | ⚠️ Partial (44) | Y | |
| 7.32 | Negotiation History | ❌ Not started | A+Y | |
| 7.33 | Self-Service Generation | ❌ Not started | Y | |
| 7.34 | Owner/Insurer Portal | ❌ Not started | Y+A | |
| 7.35 | Encrypt MFA TOTP Secret at Rest (DocuSign key → Phase 9.2) | ✅ Complete (PR #88) | A | 2026-06-21 |
| 7.37 | ERP Feature Entitlement (per-package + per-org) | ❌ Not started | A | |
| 7.38 | Working SAP Cost Adapter | ❌ Not started | A | |
| 7.39 | ERP Export Direction (push to ERP) | ❌ Not started | A | |
| 7.40 | ERP Schedule-Linkage Consumer | ❌ Not started | A | |
| 7.41 | ERP Mapping Field Auto-Discover | ❌ Not started | A | |
| 7.42 | Arabic PDF Rendering — Acrobat-Strict Fix | ✅ Complete (PR #97) | A | 2026-06-24 |
| 7.43 | Compliance PDF Rebuild + Arabic Support (PR-A) | ❌ Not started | A | |
| 6B.1 | Visual Confidentiality | ❌ After Phase 7 | Y | |
| 6B.2 | Invisible Watermarks | ❌ After Phase 7 | Y | |
| 8.1 | AI Model Eval + Arabic accuracy harness + model centralization | ✅ Complete (PR #103) | A+Y | 2026-06-27 |
| 8.2-8.6 | AI Migration (OCR, annotation, training) | 🟡 8.3 annotation ✅ (gold set 2026-07-14); 8.2/8.4/8.5/8.6 ❌ | A+Y | |
| 9.1 | Abstract Infrastructure Layers | ✅ Complete (PR #35) | A | 2026-05-28 |
| 9.2+ | AWS, CI/CD, monitoring, cookies | ❌ Not started | A+Y | |
| 10 | SOC 2 | ❌ Not started | A+Y | |
| 11 | Training Data | ❌ Not started | A+Y | |

---

## 📅 Timeline

| Month | Focus | Status |
|-------|-------|--------|
| Month 1 | Bugs, tests, input security | ✅ Done |
| Month 2 | Security, docs, compliance, brand, UI | ✅ Phases 4, 5, 6.1-6.4 done |
| Month 3 | Feature development (Tier 1) | ✅ 7.1-7.4 done. 7.5-7.19 next |
| Month 4 | Features (Tier 2-3) + deployment prep (9.1) | ⏳ Phase 7 continued + 9.1 starts |
| Month 5+ | Deployment, 6B, SOC, advanced features | ⏳ Phase 9, 6B, 10, 7.32-7.34 |

---

## 🔥 What's Next (Priority Order)

**Ayman:**
1. ~~9.1 — Abstract Infrastructure Layers~~ ✅ Done (PR #35)
2. ~~7.15 — Obligation Permission Model~~ ✅ Done (PR #40)
3. ~~7.24 — Knowledge Base Enhancements (all 5 sub-phases)~~ ✅ Done (PR #40)
4. ~~7.25 — Poor Scan Quality Handling~~ ✅ Done (PR #41)
5. ~~7.26 — i18n Completion (Track A)~~ ✅ Done (PR #42)
6. ~~Internal Contract Sharing Fix~~ ✅ Done (PR #44) — cross-tenant bug + ProjectMember + notification + autocomplete
7. ~~CONTRACTOR_* Role Audit~~ ✅ Done — all 4 roles active in 13 places; removal BLOCKED until 7.18 ships
8. ~~ContractShare Step 1~~ ✅ Done — dead endpoint + broken email + org-scope fix + frontend "coming soon" gate
9. **PR #42 follow-up fix A (🟠 HIGH):** `negotiation_events.performed_by` nullability — this column is declared NOT NULL in the migration but the FK is `ON DELETE SET NULL`, creating a deferred integrity violation that blocks GDPR delete for any user who has performed a negotiation event. Fix: `ALTER TABLE negotiation_events ALTER COLUMN performed_by DROP NOT NULL`. Own small migration + test.
10. **PR #42 follow-up fix B (🟡 MEDIUM):** `GET /me/profile` leaks `invitation_token` — the endpoint calls a code path that returns the raw user row (pre-`@Exclude`). Even with the global `ClassSerializerInterceptor`, this path returns a plain object, bypassing the interceptor. 2-line fix: add `invitation_token` to the existing destructure-and-omit in the profile response builder.
11. **ContractShare Step 2 (⏳ BLOCKED — depends on 7.18 bucket-7 email delivery):** Remove entire `ContractShare` module once GuestInvitation external email delivery ships. Steps: (1) wire `createShare()` external path to create a `GuestInvitation` row; (2) migrate `searchOrgMembers` to `contracts.controller.ts` or a dedicated autocomplete controller; (3) hard-delete `contract_shares` table in a migration; (4) remove `ContractShare` entity, service, controller, module, and all imports.
12. 7.21 — RFP & Specification Document Analysis (AI — competitive priority)
13. ~~7.9 — Audit Silent Migrations~~ ✅ Done (PR #34)
14. ~~7.10 — In-app Dispatch~~ ✅ Already implemented
15. ~~8.1 — AI Model Evaluation & Migration Path~~ ✅ Done (PR #103) — model-id centralization + Arabic accuracy harness + baseline + prompt inventory

**Youssef:**
1. 7.7 — Wire Reminder History in Detail Drawer (quick, endpoint ready)
2. 7.5 — Obligation Type Dropdown Label Consistency
3. 7.6 — Calendar Page Plan Gate
4. 7.8 — Portfolio Empty State UX
5. 7.17 — Portfolio Dashboard (Tier 1 priority)
6. 7.18 — Guest Portal (Plan Mode first)
7. 7.19 — Counterparty Redlining

**Both (when convenient):**
1. ~~6.9 — Waitlist Email Capture~~ ✅ Done (PR #33)
2. 6.10 — Mission Statement Rewrite (when brand conversation happens)

---

## 💡 Claude's Recommendations (May 2026)

1. ~~**Start 9.1 now**~~ ✅ Done (PR #35) — Infrastructure layers abstracted. Before switching any driver to production (`s3`/`ses`/`textract`), resolve the 7 known gaps documented in the 9.1 section above.
2. **Youssef: clear 7.5-7.8 first** — Quick polish items from 7.1 that take 1-2 hours total, then move to 7.17 Dashboard.
3. **7.21 (RFP Analysis) is Ayman's next competitive feature** — Unique to construction, Trimble investing heavily, builds on existing AI extraction pipeline.
4. **Phase 6B after Phase 7** — Features will change UI, protection layers built now need rebuilding.
5. **AWS SA course** — Ayman is taking this. Maps directly to Phase 9 (RDS, ElastiCache, S3, EC2/ECS, VPC, IAM, CloudWatch).

---

*Last updated: 2026-06-04*
*Next review: When 7.5-7.8 are cleared; 9.2 AWS setup planning starts*
