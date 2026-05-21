# SIGN Platform — Development Roadmap
> Last updated: 2026-05-21
> Next review: When Phase 5 is complete
> Maintained by: Ayman & Youssef
> Market: Arabic, English, French (Middle East + Global)
> AI Strategy: Anthropic Claude API now → migrate to open-source models later

---

## ⚠️ ACTION REQUIRED

**Update CLAUDE.md immediately:** Remove "Known Bug #2" — the DocuSign webhook is now **fully implemented** with HMAC-SHA256 signature verification and contract state transitions (`FULLY_EXECUTED`, `VOIDED`, etc.). The no-op claim is false as of 2026-05-20.

---

## Priority Colour Legend

| Priority | Meaning |
|----------|---------|
| 🔴 CRITICAL | Must be done — blocker for progress |
| 🟠 HIGH | Important — do in current sprint |
| 🟡 MEDIUM | Valuable — schedule in next sprint |
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
| `VITE_MANAGEX_URL` | Not yet wired — see Phase 5.4 |

---

## ✅ PHASE 2 — Testing & CI — COMPLETED
Implemented by: Ayman | Completed: 2026-05-20

- **2.1** Backend Tests ✅ — 6 spec files, 33 tests
- **2.2** Frontend Tests ✅ — 2 test files, 8 tests (expand coverage in Phase 7.19)
- **2.3** AI Pipeline Tests ✅ — 8 tests, Anthropic mocked
- **2.4** CI/CD Pipeline ✅ — GitHub Actions, 3 parallel jobs, 49 tests total

---

## ✅ PHASE 3 — Input Security — COMPLETED
Implemented by: Ayman & Youssef | Completed: 2026-05-20

- **3.1** SQL Injection Prevention ✅ (admin-security ILIKE gap → fix in Phase 5.6)
- **3.2** Input Sanitization ✅
- **3.3** Input Validation ✅
- **3.4** File Upload Security ✅
- **3.5** XSS Prevention ✅

---

## ✅ PHASE 4 — Security Hardening — COMPLETED
Implemented by: Ayman & Youssef | Completed: 2026-05-20

- **4.1** Rate Limiting ✅
- **4.2** JWT & Refresh Token Handling ✅
- **4.3** Secrets to Env Vars ✅
- **4.4** Legal Pages & Privacy ✅ (functional gaps remain → fix in Phase 5.5)

#### Password Validation Hardening ✅ (Ayman, PR #13 + #14, 2026-05-20)
- All 6 password DTOs enforce: min 12 chars, 1 uppercase, 1 number, 1 special character
- DTOs: RegisterDto, ResetPasswordDto, 3× ChangePasswordDto, AcceptInvitationDto
- DB `security_policies.password_min_length` = 12
- Frontend validation on all 4 pages
- Lessons #78, #79, #80

---

## 📋 PHASE 5 — Documentation, Compliance & Pre-Feature Fixes
> Current phase. Complete everything here before moving to Phase 6.
> This phase closes all remaining gaps from Phases 1-4 and prepares the codebase for feature work.

---

### 5.1 — Keep CLAUDE.md + lessons.md Updated ✅
**Owner:** Ayman + Youssef | **Status:** ✅ Active habit
- CLAUDE.md: 1,482 lines, current as of 2026-05-20
- lessons.md: 80 lessons, current as of 2026-05-20
- Update CLAUDE.md: remove DocuSign "Known Bug #2" (now fixed)

---

### 5.2 — Create Basic Setup Guide
**Owner:** Ayman | **Priority:** 🟡 MEDIUM | **Status:** ⏳ IN PROGRESS
**Target file:** `docs/SETUP.md`
**Sections:**
1. Prerequisites (Node 20, Python 3.11, Docker Desktop, gh CLI)
2. Clone + install (`npm ci` at repo root)
3. `.env` setup (copy `.env.example` × 4 services, required vars)
4. `docker-compose up --build` — first run
5. Migrations + seed verification
6. Port map (5173, 5175, 3000, 8000, 5432, 6379)
7. Working without external APIs (what works without Anthropic, DocuSign, Paymob keys)
8. Running tests (Jest, Vitest, pytest — all three)
9. Pre-PR checklist (reference CLAUDE.md)
10. Common issues and fixes (top 5 from lessons.md)

---

### 5.3 — Clean Up Stale Git Branches
**Owner:** Ayman | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Delete `fix/password-validation-all-dtos` (merged via PR #13)
- Delete or complete `wip/docusign-webhook-work` (DocuSign is now done on main)
- Delete `phase-4.4-legal-compliance` if content is on main

---

### 5.4 — Fix Hardcoded ManageX Backlink URLs
**Owner:** Youssef | **Priority:** 🔴 CRITICAL — do now
**Status:** ⚠️ 4 files still hardcode `http://localhost:5175/`
**Files:**
- `apps/sign/src/layouts/TopBar.tsx:57`
- `apps/sign/src/layouts/AuthLayout.tsx:35, 65`
- `apps/sign/src/layouts/AdminLayout.tsx:338`

**Fix:** Replace with `import.meta.env.VITE_MANAGEX_URL || 'http://localhost:5175'`. Add `VITE_MANAGEX_URL` to `apps/sign/.env.example`.

---

### 5.5 — Complete Legal Pages & Privacy Compliance Gaps
**Owner:** Youssef | **Priority:** 🔴 CRITICAL — legally required before any real users
**Status:** ⚠️ PARTIALLY DONE

**What's done:**
- 13 `/legal/*` pages present
- CookieConsentBanner, CookieConsentContext, CookiePreferenceModal all built

**Still missing:**
1. **T&C acceptance in registration:** No checkbox in `RegisterPage.tsx` → users register without consent. Needs: checkbox + `accepted_terms_at` column on `users` entity + DB migration
2. **AI output disclaimer:** No disclaimer shown before AI results. Must say: "AI output is a tool, not legal advice."
3. **French locale:** `apps/sign/src/i18n/locales/` has only `ar/` and `en/` — no `fr/`. All legal pages need French translations.
4. **Communication preferences UI:** `email_digest_opt_out` exists on `users` entity but has no UI surface

---

### 5.6 — Fix Admin-Security ILIKE Search Injection
**Owner:** Ayman | **Priority:** 🟠 HIGH — 15 min fix
**Status:** ❌ Not started
- Two files lack `escapeLikeParam()` on ILIKE patterns: `admin-activity-log.service.ts` and `security-audit-log.service.ts`
- Module is now on main — deferred from Phase 3.1, fix is overdue
- Apply same pattern from `common/utils/escape-like.ts` used at 6 other sites

---

### 5.7 — Fix failed_login_attempts Not Resetting on Success
**Owner:** Ayman | **Priority:** 🟠 HIGH — 10 min investigation
**Status:** ❌ Not started
- `failed_login_attempts` may not reset to 0 on successful login
- If true, counter drifts and users get locked out after 5 total logins regardless of correctness
- Check `auth.service.ts` login success path: must call `userRepository.update(id, { failed_login_attempts: 0 })`
- Check all login paths: `login`, `verifyMfa`, `verifyRecoveryCode`

---

### 5.8 — Block Password Reuse in Change-Password
**Owner:** Ayman | **Priority:** 🟡 MEDIUM — 30 min fix
**Status:** ❌ Not started
- `PasswordPolicyService.assertNotReused()` checks password history table but not the current password hash when `history_count = 0`
- User can change password to the exact same value
- Fix: add `bcrypt.compare(newPassword, currentHash)` guard in `profile.controller.ts`. If match, reject with "New password must be different from current password."

---

## 🎨 PHASE 6 — Brand & UI Foundation
> Youssef-led. Do 6.1-6.4 before feature development.
> 6.5-6.6 after feature development (features will change the UI).

---

### ✅ 6.1 — CENVOX → ManageX Rename — COMPLETED
- 71 files rebranded. Backlinks fixed in Phase 5.4.

---

### 6.2 — Coming Soon Pages (VENDRIX, SPANTEC, CLAIMX, GUARDIA, DOXEN)
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Placeholder cards on ManageX landing page
- Each card: product name, discipline, brand colour, "Coming Soon" badge, email notification opt-in
- Do NOT build any functionality — placeholders only

---

### 6.3 — Fine Touches to ManageX Landing
**Owner:** Youssef | **Priority:** 🟢 LOW | **Status:** ❌ Not started
- Update mission statement, fix "/" separators, remove "--" artifacts

---

### 6.4 — Mobile View & Responsive Design
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Audit all `/app/*` pages for mobile breakpoints (desktop-first currently)
- Priority: Dashboard, Contract Detail, Clause Review
- Guest Portal (Phase 7.3) must be mobile-first — owners review on phone

---

### 6.5 — Visual Confidentiality (25 Attack Vectors)
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
**DO AFTER Phase 7 features — features will change the UI**
- Screen capture protection (CSS + JS), right-click disable on clause content
- Print CSS watermark overlay, DevTools detector
- Phase 7.17 Insurance Portal must also implement this

---

### 6.6 — Invisible Watermark System
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
**DO AFTER Phase 7 features**
- Invisible watermarks in downloaded PDFs (user ID + timestamp + org ID)
- Extend existing pdfmake watermarks from compliance reports
- Watermark decoder tool in admin portal
- Mention in Terms & Conditions as legal deterrent

---

### 6.7 — Install Frontend Design Plugin
**Owner:** Ayman or Youssef | **Priority:** 🟢 LOW
- Install before starting Phase 7 UI work: `/plugin install frontend-design@claude-plugins-official`
- Skill version already available in Claude Code

---

### 6.8 — Install Code Review Plugin
**Owner:** Ayman or Youssef | **Priority:** 🟢 LOW
- Anthropic-verified plugin for automated PR review

---

## 🚀 PHASE 7 — Feature Development
> Main feature phase. Competitive sprint features integrated here.
> Ordered by: competitive urgency → dependency chain → business value.
> Four tiers. Do Tier 1 first, then Tier 2, etc.

---

### ═══ TIER 1: Competitive Essentials (Do First) ═══

---

### 7.1 — Obligation Tracking & Deadline Alerts
**Owner:** Ayman (AI extraction) + Youssef (UI + notifications)
**Priority:** 🔴 CRITICAL — URGENT
**Competitors:** Document Crunch/Trimble (primary value prop), Tomorro
**Status:** ❌ Not started
**Why critical:** Missing a FIDIC notice deadline can void a claim worth millions. This is Trimble's core value prop — SIGN must match before they enter MENA.

**⚠️ Audit first:** `obligations` table + `obligation_reminder_logs` may already exist from Phase 3.4 — **extend, do not rebuild.**

**Tasks:**
- AI extraction (Arabic + English): payment deadlines, notice periods, milestone dates, termination periods, renewal/expiry dates, insurance renewals
- Build obligation register: table view per contract with due dates + status (Pending / Actioned / Missed / Not Applicable)
- Allow manual obligation entry — AI may miss some
- Build alert system: email at 30/7/1 days before; in-app notification; alerts to contract owner + assigned members
- Build portfolio obligation view: calendar/timeline across ALL projects
- Link to Phase 7.5 Project Section enhancements

**Success metric:** A project manager sees all upcoming contract deadlines across all projects in one view and receives email alerts before each deadline.

---

### 7.2 — Portfolio-Level Contract Analytics Dashboard
**Owner:** Youssef
**Priority:** 🟠 HIGH — URGENT
**Competitors:** Juro, Luminance, Ironclad
**Status:** ❌ Not started
**Why critical:** Drives C-suite adoption — construction directors need portfolio visibility.
**Depends on:** 7.1 (obligation data feeds dashboard)

**⚠️ Audit first:** Check if any portfolio-level analytics already exist.

**Tasks:**
- Build Analytics Dashboard (OWNER_ADMIN + SYSTEM_ADMIN roles):
  - Total active contracts (count + value)
  - Contract status breakdown (pie chart)
  - Upcoming expirations next 30/60/90 days (timeline)
  - Upcoming obligation deadlines next 14 days (list — links to 7.1)
  - Risk distribution High/Medium/Low (bar chart)
  - Average time from creation to signature (trend line)
  - Contracts by counterparty (top 10 table)
  - Contract value by project
- All charts filterable by: date range, project, contract type, counterparty
- Export as PDF report
- Full Arabic UI support

**Success metric:** A construction director opens SIGN on Monday morning and in 30 seconds knows the state of all contracts across all projects.

---

### 7.3 — Guest Portal (`/contractor/*`)
**Owner:** Youssef | **Priority:** 🟠 HIGH
**Status:** ❌ Not started
**⚠️ Requires Plan Mode before any code**
- Foundation for 7.4 (Counterparty Redlining) — must be built first
- See CLAUDE.md Portal Architecture for persona (Type B — Responding Party)
- Scope: view assigned contract, respond to clauses, submit claims/notices, sign. Nothing more.
- Invitation-based access (secure link, no SIGN account required)
- Guest dashboard — minimal, mobile-first

---

### 7.4 — In-Platform Counterparty Redlining
**Owner:** Youssef
**Priority:** 🔴 CRITICAL — URGENT
**Competitors:** Juro, Tomorro, Luminance (via Word add-in)
**Status:** ❌ Not started
**Depends on:** 7.3 (Guest Portal — counterparties need access)
**Why critical:** Biggest gap vs competitors — once negotiation starts, users leave SIGN.

**⚠️ Audit first:** How do users currently share contracts? Audit `ContractDetailPage.tsx` + negotiation module.

**Tasks:**
- External guest link: share via secure link (no account required)
- Inline commenting: counterparty comments on specific clauses
- Redline suggestions: counterparty proposes changes as tracked changes
- Internal response workflow: SIGN user accepts/rejects/modifies each redline
- Full version history: every round preserved and auditable
- Email notifications on changes
- Negotiation status: Draft → Shared → Under Review → Agreed → Ready to Sign
- Arabic + English including RTL-correct tracked changes

**Success metric:** A construction subcontract goes from first draft to fully agreed without leaving SIGN once.

---

### ═══ TIER 2: Deepening the Moat (Do Second) ═══

---

### 7.5 — Project Section Enhancements
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Portfolio-level project dashboard
- Project health score based on contract status + risk levels
- Contractor directory within a project
- Link project phases to contract milestones
- % Progress field, Member Count display
- Integrates with 7.1 obligation tracking

---

### 7.6 — RFP & Specification Document Analysis
**Owner:** Ayman (AI) + Youssef (UI)
**Priority:** 🟠 HIGH — URGENT
**Competitors:** Document Crunch/Trimble — investing heavily here
**Status:** ❌ Not started
**Why critical:** Construction risk decisions happen BEFORE signing. No general CLM addresses this.

**Tasks:**
- Extend uploads to accept RFP and Specification document types
- **RFP Analysis:** extract payment terms, liquidated damages, retention, liability caps; flag onerous provisions vs FIDIC/NEC; generate clarification questions for owner
- **Specification Analysis:** identify contradictions between sections, flag ambiguous scope, extract referenced standards (ASTM, BS, EN, ECP)
- Link RFP/Spec to resulting contract — side-by-side comparison
- Arabic + English

**Success metric:** A contractor uploads an RFP and within 5 minutes has a risk summary and clarification questions — before deciding whether to bid.

---

### 7.7 — Contract Playbook & Standard Positions
**Owner:** Ayman (AI) + Youssef (UI)
**Priority:** 🟠 HIGH
**Competitors:** Luminance, Ironclad
**Status:** ❌ Not started
**Depends on:** 7.1 (obligation data) + 7.4 (redlining data)
**Why valuable:** Creates switching costs — once a firm builds their playbook, they won't leave.

**Tasks:**
- Playbook section in Settings (org-level, OWNER_ADMIN only)
- Define standard positions: payment terms, liability cap, retention rate, defects period, dispute forum, governing law, custom types
- AI compares each clause against playbook during review
- Flag deviations: Matches Standard / Minor Deviation / Major Deviation / Non-Standard
- Arabic + English playbook definitions

**Success metric:** Org admin sets up playbook once. Every contract gives personalised, org-specific risk flags.

---

### 7.8 — Microsoft Word Add-In (Extend Existing)
**Owner:** Youssef | **Priority:** 🟡 MEDIUM
**Competitors:** Luminance, Harvey
**Status:** ❌ Not started

**⚠️ `apps/word-addin/` already exists — audit before building. Extend, don't rebuild.**

**Tasks:**
- Audit current state, login from Word, open/edit SIGN contracts, save back with versioning
- AI risk flags as inline Word comments
- Playbook suggestions as tracked changes (after 7.7)
- Arabic RTL support in Word
- Import Word docs into SIGN from add-in
- Publish to Microsoft AppSource

**Success metric:** Lawyer reviews AI risk flags in Word and pushes revisions back to SIGN without opening a browser.

---

### ═══ TIER 3: Existing Features + Polish ═══

---

### 7.9 — Knowledge Base Enhancements
**Owner:** Ayman | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Bulk import, version history, "Used In" backlinks, scope per-project/all, search

### 7.10 — Poor Scan Quality Handling
**Owner:** Ayman + Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Detect low DPI, quality warning, re-upload option, image enhancement before OCR, "Human Review Recommended" status

### 7.11 — Multilingual Support (French)
**Owner:** Ayman + Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Add `fr/` locale, translate UI strings + legal pages, add to language switcher
- Partially overlaps with Phase 5.5 (French legal pages)

### 7.12 — Official Gazette Integration
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Monitor Egyptian Official Gazette, auto-import to Knowledge Base, admin notifications
- Phase 1: Egypt only; Phase 2: UAE; Phase 3: per-country expansion

### 7.13 — ERP System Integration (SAP / Oracle / Primavera / Dynamics)
**Owner:** Ayman + Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Abstract integration layer (`ERP_PROVIDER` env var)
- SAP first (Egyptian gov + large contractors), then Oracle Primavera P6 (MENA scheduling), then MS Dynamics 365
- Export milestones/payment terms to ERP, import cost data for claims
- ERP sync status dashboard in admin portal

### 7.14 — Settlement Agreement Acknowledgement Checkbox
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ❌ Not started
- Mandatory checkbox in Claims settlement modal per AUP Section 4.3
- Text: "I understand that executing this settlement agreement has legal consequences. I have obtained independent legal advice or waive my right to do so."
- Confirm button disabled until checked

### 7.15 — Clause Library Type Dropdown ✅ COMPLETED (Ayman)

### 7.16 — Expand Frontend Test Coverage
**Owner:** Youssef | **Priority:** 🟡 MEDIUM | **Status:** ⚠️ PARTIAL — only 2 test files
- Add `ContractDetailPage.test.tsx`, `ClauseReviewPage.test.tsx`
- Write tests alongside new features as they are built in Phase 7

---

### ═══ TIER 4: Advanced Competitive Features (Do After Tiers 1-3) ═══

---

### 7.17 — Negotiation History & Institutional Memory
**Owner:** Ayman (data) + Youssef (UI)
**Priority:** 🟡 MEDIUM
**Competitors:** Luminance (biggest 2026 feature)
**Status:** ❌ Not started
**Depends on:** 7.4 (Redlining) + 7.7 (Playbook)

**Tasks:**
- Store negotiation events per contract (proposed → accepted/rejected/modified, who, when)
- Counterparty profile: past contracts, patterns, accepted positions
- AI surfaces history for repeat counterparties
- Reasoning notes: annotate why positions were accepted/rejected
- Tie into 7.7 Playbook

**Success metric:** New contract with repeat counterparty → SIGN shows relevant negotiation history automatically.

---

### 7.18 — Self-Service Contract Generation
**Owner:** Youssef | **Priority:** 🟡 MEDIUM
**Competitors:** Juro, Tomorro
**Status:** ❌ Not started
**Depends on:** 7.7 (Playbook defines guardrails)

**⚠️ Audit first:** Check if any template/generation feature already exists.

**Tasks:**
- Template library (admin-managed): fixed/variable clauses, approval rules
- Self-service flow: select template → fill form → SIGN generates → approval → e-signature
- Guardrails: fixed clauses trigger legal review if modified
- Arabic + English templates

**Success metric:** Procurement manager generates subcontract without emailing legal once.

---

### 7.19 — Insurance Carrier & Owner Portal
**Owner:** Youssef (portal) + Ayman (permissions)
**Priority:** 🟡 MEDIUM
**Competitors:** Document Crunch/Trimble
**Status:** ❌ Not started
**Depends on:** 7.2 (Dashboard) + 7.1 (Obligations)

**Tasks:**
- External stakeholder portal (separate from Guest Portal 7.3)
- Project owner: read-only, invited via email, contract list + status + key dates + risk summary
- Insurance carrier: coverage requirements, compliance status
- Lender/bank: contract values, payment terms, milestones
- No SIGN account required — secure time-limited link
- Permission controls: share scope, set expiry, revoke, audit log
- Portal notifications on signing/scope changes
- Arabic + English, mobile-friendly
- **Must also implement Phase 6.5 visual confidentiality**

**Success metric:** Project owner opens secure link on phone, sees all subcontract status within 2 minutes, no SIGN account needed.

---

## 🤖 PHASE 8 — AI Model Migration
**Status:** ❌ Not started

### 8.1 — AI Model Evaluation & Migration Path
- Document all Claude API prompts, tag each with replacement model
- Arabic accuracy test suite on General Conditions (81k chars, 9 chunks) as baseline
- Migrate only if accuracy improves AND cost is acceptable
- **Hard rule:** Never migrate without running the Arabic accuracy test suite first

### 8.2 — OCR Migration: AWS Textract
- Abstract OCR layer: `OCR_PROVIDER` env var (tesseract | textract)
- Test Arabic scanned documents — compare accuracy
- ⚠️ Textract Arabic: specific AWS regions only (us-east-1, eu-west-1)

### 8.3 — Annotation Setup: Label Studio
### 8.4 — Clause Classification: ContractBERT
### 8.5 — Risk Classification & Confidence Threshold

### 8.6 — Model Training Infrastructure (AWS SageMaker)
- Training jobs config, pipeline: data prep → train → evaluate → deploy
- Cost: per compute hour. Only needed with 500+ annotated examples

---

## ☁️ PHASE 9 — Deployment Preparation
> ⚠️ Phase 9.1 (Abstract Infrastructure Layers) should start during mid-Phase 7, not after.
> All other Phase 9 tasks start when MVP features are ready.

**Status:** ❌ Not started

### 9.1 — Abstract Infrastructure Layers
**Priority:** 🟠 HIGH — start during Phase 7, before other deployment work
- Storage: `STORAGE_TYPE=local` → `s3`
- Email: `EMAIL_PROVIDER=smtp` → `ses`
- OCR: `OCR_PROVIDER=tesseract` → `textract`

### 9.2 — AWS Infrastructure Setup
- RDS PostgreSQL 15 (pgvector + uuid-ossp), ElastiCache Redis, S3 (AES-256)
- ECS or EC2 for containers, VPC security groups, automated backups (7-day retention)
- Production secrets in AWS Secrets Manager
- Replace `JWT_REFRESH_SECRET` placeholder with cryptographically random value

### 9.3 — CI → CD Pipeline & Staging
- Staging deploy job with manual approval gate
- Blue-green deploy + rollback strategy
- `docker-compose.prod.yml` — secrets from env vars only
- Staging environment with separate DB and S3

### 9.4 — Monitoring: Sentry + CloudWatch
- Sentry for React frontend JS errors (free tier)
- Structured logging (winston/pino) → CloudWatch
- Alarms: CPU > 80%, Memory > 85%, Error rate > 1%, queue depth > 100
- Wire `_finalizeLogin` alert (deferred from Phase 1.7): Sentry alert when outer catch fires > N times/hour
- Wire Paymob activation failure to dead-letter notification (deferred from Phase 1.6)

### 9.5 — Frontend: Vercel Deployment
- vercel.json config, custom domain, preview deploys for PRs

### 9.6 — Paymob Webhook Activation
**Status:** ⏳ BLOCKED — Paymob test API keys required
**Location:** `subscriptions.service.ts:383` — `TODO(1.6)` in place
**When unblocked:**
- Idempotency check, DB transaction guard for race conditions
- Admin alert on activation failure
- Non-200 response on failure for Paymob retry

### 9.7 — Migrate JWT from localStorage to httpOnly Cookies
**Priority:** 🟡 MEDIUM — do before production deployment
- Current JWTs in localStorage (authSlice.ts, axios.ts ×3)
- ~1 day effort: Set-Cookie (backend) + remove localStorage (frontend) + `axios withCredentials: true` + refresh reads from cookie

### 9.8 — Fix localhost:5175 → Production URLs
- If not already done in Phase 5.4, replace remaining references with production URLs
- `NODE_ENV !== 'production'` gate on CORS/CSP localhost entries already in place — verify before deploy

---

## 🔒 PHASE 10 — SOC 2 Readiness
**Status:** ❌ Not started

### 10.1 — Data Retention & Audit Trail
- Retention periods: Contracts 7yr, Audit logs 3yr, Sessions 30d
- Soft delete for contracts (never hard delete), immutable audit_logs
- Audit log viewer in admin portal
- Document in `docs/DATA_RETENTION_POLICY.md`

### 10.2 — Encryption & Access Controls
- RDS encryption at rest, S3 SSE, HTTPS/TLS at load balancer
- Never log PII in application logs
- External penetration test before launch

### 10.3 — AI Prompt Data Compliance (SOC 2 + GDPR)
- Audit all Anthropic API prompts — no full user PII sent
- Data anonymization layer before external AI calls
- MENA privacy: Egypt Law 151 of 2020, UAE Decree-Law No. 45 of 2021

### 10.4 — Mobile App (PWA First)
**Status:** ❌ Not started

---

## 📊 PHASE 11 — Training Data & AI Improvement
**Status:** ❌ Not started

### 11.1 — Build Feedback Loop & Training Dataset
- UI for flagging incorrect clause extractions
- `clause_extraction_feedback` table + admin review UI
- Corrections become few-shot examples
- Track accuracy per document type (Agreement, Particular Conditions, General Conditions)
- Label Studio setup: `docker run -p 8080:8080 heartexlabs/label-studio`
- Target: 500+ annotated clauses before fine-tuning

---

## 🏆 Competitive Moat — Must Never Be Deprioritized

1. **Arabic contract NLP** — genuine extraction + risk analysis, not just translated UI
2. **MENA regulatory compliance** — UAE PDPL, Egypt Law 151, Saudi PDPL built natively
3. **Construction-specific clause library** — FIDIC, NEC, local Egyptian/UAE standards
4. **MENA price accessibility** — enterprise CLMs cost $50k–$500k/year; SIGN targets mid-size MENA firms

**⚠️ TIMING ALERT:** Trimble acquired Document Crunch (April 2026). Zero MENA presence currently. SIGN has ~12-18 months before they potentially enter. Use this window.

---

## 🏁 Completion Tracker

| Phase | Task | Status | Owner |
|-------|------|--------|-------|
| 1 | All core bug fixes | ✅ Complete | A+Y |
| 2 | Testing & CI (49 tests) | ✅ Complete | A |
| 3 | Input Security (all 5) | ✅ Complete | A+Y |
| 4 | Security Hardening + Password (6 DTOs) | ✅ Complete | A+Y |
| 5.1 | CLAUDE.md + lessons.md | ✅ Ongoing (80 lessons) | A+Y |
| 5.2 | docs/SETUP.md | ⏳ In progress | A |
| 5.3 | Clean stale branches | ❌ Not started | A |
| 5.4 | Fix ManageX backlinks (4 files) | ❌ Not started | Y |
| 5.5 | Legal compliance gaps | ❌ Not started | Y |
| 5.6 | Admin-security ILIKE fix | ❌ Not started | A |
| 5.7 | failed_login_attempts reset | ❌ Not started | A |
| 5.8 | Password reuse block | ❌ Not started | A |
| 6.1 | ManageX Rebrand | ✅ Complete | Y |
| 6.2 | Coming Soon Pages | ❌ Not started | Y |
| 6.3 | ManageX Landing Polish | ❌ Not started | Y |
| 6.4 | Mobile Responsive | ❌ Not started | Y |
| 6.5 | Visual Confidentiality | ❌ After Phase 7 | Y |
| 6.6 | Invisible Watermarks | ❌ After Phase 7 | Y |
| 7.1 | Obligation Tracking | ❌ Not started | A+Y |
| 7.2 | Portfolio Dashboard | ❌ Not started | Y |
| 7.3 | Guest Portal | ❌ Not started | Y |
| 7.4 | Counterparty Redlining | ❌ Not started | Y |
| 7.5 | Project Enhancements | ❌ Not started | Y |
| 7.6 | RFP Analysis | ❌ Not started | A+Y |
| 7.7 | Contract Playbook | ❌ Not started | A+Y |
| 7.8 | Word Add-In | ❌ Not started | Y |
| 7.9 | Knowledge Base | ❌ Not started | A |
| 7.10 | Poor Scan Quality | ❌ Not started | A+Y |
| 7.11 | French i18n | ❌ Not started | A+Y |
| 7.12 | Official Gazette | ❌ Not started | Y |
| 7.13 | ERP Integration | ❌ Not started | A+Y |
| 7.14 | Settlement Checkbox | ❌ Not started | Y |
| 7.15 | Clause Library | ✅ Complete | A |
| 7.16 | Frontend Test Coverage | ⚠️ Partial | Y |
| 7.17 | Negotiation History | ❌ Not started | A+Y |
| 7.18 | Self-Service Generation | ❌ Not started | Y |
| 7.19 | Owner/Insurer Portal | ❌ Not started | Y+A |
| 8 | AI Migration | ❌ Not started | A+Y |
| 9 | Deployment | ❌ Not started | A+Y |
| 10 | SOC 2 | ❌ Not started | A+Y |
| 11 | Training Data | ❌ Not started | A+Y |

---

## 📅 Timeline

| Month | Focus | Status |
|-------|-------|--------|
| Month 1 | Bugs, tests, input security | ✅ Done |
| Month 2 | Security, docs, compliance, pre-feature fixes | ✅ Phase 4 done. Phase 5 in progress |
| Month 3 | Feature development (Tier 1 + 2) | ⏳ 7.1 → 7.2 → 7.3 → 7.4 → 7.5 → 7.6 |
| Month 4 | Features (Tier 3-4) + deployment prep (9.1) | ⏳ Phase 7 continued + 9.1 starts |
| Month 5+ | Deployment, SOC, advanced features | ⏳ Phase 9, 10, 7.17-7.19 |

---

## 🔥 What's Next (Priority Order)

**Ayman:**
1. 5.2 — Create docs/SETUP.md (in progress)
2. 5.7 — Investigate failed_login_attempts reset (10 min)
3. 5.6 — Fix admin-security ILIKE gap (15 min)
4. 5.8 — Block password reuse (30 min)
5. 5.3 — Clean stale branches
6. Update CLAUDE.md — remove DocuSign "Known Bug #2"

**Youssef:**
1. 5.4 — Fix ManageX backlinks (5 min)
2. 5.5 — Complete legal compliance gaps (T&C checkbox, AI disclaimer, FR locale, comms prefs)
3. 6.2 — Coming Soon pages
4. 6.4 — Mobile responsive design

**Both (after Phase 5 + 6 complete):**
1. 7.1 — Obligation Tracking (Ayman: AI, Youssef: UI)
2. 7.2 — Portfolio Dashboard (Youssef)
3. 7.3 — Guest Portal (Youssef — Plan Mode first)
4. 7.4 — Counterparty Redlining (Youssef)

---

## 💡 Claude's Recommendations (May 2026)

1. **Fix 5.7 (failed_login_attempts) immediately** — Users may get locked out after 5 total logins. 10-min investigation.
2. **Fix 5.6 this week** — Copy existing escapeLikeParam() pattern. 15 min.
3. **Start 7.1 (Obligation Tracking) as soon as Phase 5 + 6 are done** — #1 competitive differentiator.
4. **Start 9.1 (Abstract Infrastructure) during Phase 7** — don't wait until all features are done.
5. **Phase 6.5–6.6 after features** — Features change UI, protection layers built now need rebuilding.
6. **AWS SA course** — Ayman is taking this. Maps directly to Phase 9.

---

*Last updated: 2026-05-21*
*Next review: When Phase 5 is complete*
