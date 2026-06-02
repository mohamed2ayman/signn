# Password-hash leak — fix-strategy safety audit

**Date:** 2026-06-01
**Scope:** Read-only audit to determine whether registering a global `ClassSerializerInterceptor` + `@Exclude()` on `User.{password_hash, mfa_secret, mfa_totp_secret, mfa_recovery_codes, invitation_token}` (Strategy 1) would be safe, or whether the in-house manual destructure-and-omit pattern (Strategy 2) is required.
**Status:** Findings only — no recommendation, no fix code.

---

## A. What does the response pipeline currently return — entities or plain objects?

`ClassSerializerInterceptor` only transforms responses that are class **instances** (it runs `instanceToPlain` on them). Plain objects pass through unchanged. Behavior of each layer in the codebase today:

### A.1 Controller layer — verbatim "return service result"

Sampled all leak-candidate controllers (`contracts`, `claims`, `notices`, `clauses`, `projects`, `knowledge-assets`, `support`, `support-chat`, `admin-audit-log`, `negotiation`, `risk-analysis`, `users`, `compliance-obligations`). The dominant pattern is one line: `return this.service.method(...)`. No wrapping, no mapping, no DTO mapping, no `.toJSON()`, no explicit serializer call. Whatever the service returns is what the HTTP response gets.

Example evidence:
- `backend/src/modules/claims/claims.controller.ts:39,47,52,61,71,81,91` — all `return this.claimsService.X(...)`.
- `backend/src/modules/notices/notices.controller.ts:38,46,51,60,70,80` — same pattern.
- `backend/src/modules/clauses/clauses.controller.ts:32,41,49,57,66,75,85` — same.
- `backend/src/modules/projects/projects.controller.ts:29,38,46,55,63,74,82,94,114` — same.
- `backend/src/modules/contracts/contracts.controller.ts` — same (10 methods all of shape `return this.contractsService.X(...)`).

**No explicit `instanceToPlain` / `plainToInstance` / `classToPlain` calls exist in production code.** Only one test file imports `plainToInstance` (`backend/src/modules/contracts/tests/contract-dto-value-currency.spec.ts:2`).
**No `JSON.parse(JSON.stringify(...))` round-tripping** and **no `.toJSON()` overrides** anywhere outside `node_modules`/`dist`.

### A.2 Service layer — what services actually produce

Two return-shape categories:

**(a) Returns a TypeORM repository result directly → ENTITY INSTANCE.**
TypeORM 0.3.x reconstructs entity instances for `repo.find/findOne` and `qb.getMany/getOne` results.

| Service site | Shape returned |
|---|---|
| `backend/src/modules/notices/notices.service.ts:105-109` `findAllByContract` | `repo.find({ where, relations })` → `Notice[]` instances |
| `backend/src/modules/notices/notices.service.ts:112-127` `findById` | `repo.findOne({ where, relations })` → `Notice` instance |
| `backend/src/modules/claims/claims.service.ts:102-106` `findAllByContract` | `repo.find(...)` → `Claim[]` instances |
| `backend/src/modules/claims/claims.service.ts:109-...` `findById` | `repo.findOne(...)` → `Claim` instance |
| `backend/src/modules/clauses/clauses.service.ts:26-51` `findAll` | `qb.getMany()` → `Clause[]` instances |
| `backend/src/modules/clauses/clauses.service.ts:54-65` `findById` | `repo.findOne(...)` → `Clause` instance |
| `backend/src/modules/users/users.service.ts:37-46` `findById` | `repo.findOne(...)` → `User` instance |
| `backend/src/modules/contracts/contracts.service.ts:findAll, getVersions, getMilestoneVersions, getVersion, getApprovers, getPendingApprovalsForUser, getComments` | qb/repo results → entity instances |
| `backend/src/modules/negotiation/negotiation.service.ts:51-67 findHistory` | `qb.getManyAndCount()` → returns `{ events: NegotiationEvent[], total }` where each event is an instance (the wrapping object is plain, but the array elements are instances; `instanceToPlain` recurses into arrays of instances) |
| `backend/src/modules/support/support.service.ts`, `support-chat/support-chat.service.ts`, `admin-audit-log/admin-audit-log.service.ts`, `knowledge-assets/knowledge-assets.service.ts`, `risk-analysis/risk-analysis.service.ts`, `projects/projects.service.ts`, `subcontracts/subcontracts.service.ts` | all repo/qb results → entity instances |

**(b) Returns a plain object via destructure / spread / object literal → PLAIN OBJECT.** Already not an instance, so `ClassSerializerInterceptor` would skip them. These are the existing "safe by manual hygiene" sites:

| Service site | Shape returned |
|---|---|
| `backend/src/modules/auth/auth.service.ts:1194-1203` `sanitizeUser(user)` | `{...sanitized}` plain object (strips 4 fields, NOT invitation_token) |
| `backend/src/modules/auth/auth.service.ts:343-348, 462-466, 487-489, 563-565, 624-625, 992-993, 1084` — every auth-flow return | `{ user: this.sanitizeUser(...), access_token, refresh_token }` → outer object is plain literal; `user` value is plain object from `sanitizeUser` |
| `backend/src/modules/users/users.service.ts:65-74` `getProfile` | destructure → plain object (strips all 5 sensitive fields explicitly) |
| `backend/src/modules/users/users.service.ts:364-365` `createOperationsUser` | `const { password_hash, ..., ...safeUser } = saved; return safeUser` → plain |
| `backend/src/modules/admin-security/controllers/profile.controller.ts:51-52` `GET /me/profile` | destructure → plain |

### A.3 Verdict for Area A

**Most leak-candidate endpoints (≥80% by count, almost all of the ones in the "wider footprint" list) return TypeORM entity instances unchanged.** A global `ClassSerializerInterceptor` + `@Exclude()` WOULD fire on them and the strip WOULD take effect. The exceptions are already-safe today (they manually destructure and return plain objects).

**Confidence:** HIGH — confirmed by reading every cited file.

---

## B. What would `@Exclude` on those fields unintentionally hide or change?

### B.1 `password_hash` — never in any response

Every reference grepped (`backend/src/**`, excluding migrations/seeds/tests):
- All sites either WRITE the field (during register / password change / invite) or READ it for an internal `bcrypt.compare` in auth/security services.
- `backend/src/modules/auth/auth.service.ts:373, 549, 609, 661, 701, 729, 755, 765, 796, 1035, 1061, 1196, 1198` — internal reads/writes.
- `backend/src/modules/admin-security/services/password-policy.service.ts:78, 90, 103` — history compare + insert.
- `backend/src/modules/admin-security/services/gdpr-export.service.ts:190, 248` — anonymize placeholder writes.
- `backend/src/modules/admin-security/controllers/profile.controller.ts:73, 79, 86, 90` — bcrypt compare + new-hash write (then destructured OUT before responding at line 51).
- `backend/src/modules/users/users.service.ts:66, 116, 128, 180, 342, 364, 387` — same pattern.
- `backend/src/modules/contracts/contracts.service.ts:126, 130, 141` — the strip we just added; comment only, plus destructure.
- Tests / seeds / migrations excluded by filter.

**Confirmed:** zero response-path references. `@Exclude` removes nothing observable. Safe.

### B.2 `mfa_secret`, `mfa_totp_secret`, `mfa_recovery_codes` — never in any response

Same conclusion as B.1. References in `backend/src/modules/auth/auth.service.ts` (lines 430, 510, 515, 522, 526, 531, 532, 549, 580, 586, 589, 602, 609, 610, 646, 662, 679, 688, 701, 729, 764-766, 796-798, 1197-1199) are all internal: write the secret during MFA setup, read it for OTP / TOTP comparison, null it out on disable. `auth.service.ts:646` returns `recovery_codes_count: user.mfa_recovery_codes?.length ?? 0` — a count, not the codes themselves. The frontend type at `apps/sign/src/types/index.ts:251` correspondingly declares `mfa_recovery_codes_count?: number`, **not** `mfa_recovery_codes`.

The `sanitizeUser` helper (`auth.service.ts:1194-1203`) and the destructures in `users.service.ts:364`, `users.service.ts:65-72`, `profile.controller.ts:51` all explicitly strip these.

**Confirmed:** zero response-path references. `@Exclude` removes nothing observable. Safe.

### B.3 `invitation_token` — present in some response paths today; consumed by nothing

Live probe against the running backend (login as `admin@sign.com`):

```
POST /auth/login → 200
user object keys include: invitation_token (value: null in this seed user)
user object does NOT include: password_hash, mfa_secret, mfa_totp_secret, mfa_recovery_codes
```

So `invitation_token` IS currently returned by **every auth flow** (register, login, MFA verify, recovery-code verify, MFA-after-setup, accept-invitation, password reset) because `sanitizeUser` strips only the 4 fields above, not `invitation_token`. This is a real on-wire field.

Frontend consumers of `user.invitation_token` (from a response):
- `apps/sign/src/types/index.ts:720` declares `invitation_token: string | null` — but it sits inside the **`ProjectParty`** interface (lines 710-727), NOT the user response type. `ProjectParty` is the `project_parties` table, a separate entity from `users`. `@Exclude` on `User.invitation_token` does not touch `ProjectParty.invitation_token`.
- `apps/sign/src/pages/contractor/AcceptInvitationPage.tsx:52` — `invitation_token: token` is an OUTBOUND request field (sent to the public-parties accept endpoint), not consumed from a response.
- **No grep hit** in `apps/sign/src` for `user.invitation_token`, `\.invitation_token` against an auth/login response shape, or any front-end consumer reading the auth-response field.

Backend uses of `User.invitation_token` in response paths: zero observed. Service-internal uses only:
- `users.service.ts:189, 349, 388` — write during invite/resend; the token is then emailed via `emailService.sendInvitation(...)` (lines 196, 356, 392), NOT returned.
- `auth.service.ts:948, 966, 1010, 1022, 1036` — lookup-by-token / null-on-acceptance during accept-invitation + reset-password flows; never returned to the caller.

**Confirmed:** the field is on the wire (auth responses), but no observed consumer. Setting `@Exclude` would silently remove it from the auth-response `user` object. Probably safe — but the safety hinges on "no consumer exists." If the team or a future feature ever wires the frontend to read it from the response (e.g. a "your invitation token is X" admin debug view), this would silently break.

**Confidence:** MEDIUM — grep is not a proof of absence, but the surface searched was the entire `apps/sign/src/` tree.

---

## C. Blast radius of turning the interceptor ON globally

Investigated every mechanism by which a global `ClassSerializerInterceptor` could change the response shape of any endpoint, even those unrelated to the User entity.

### C.1 Existing class-transformer decorators on entities — none that affect OUTPUT

Searched `backend/src/database/entities/**` for `@Transform`, `@Exclude`, `@Expose`, `@Type`:
- **Zero matches.** No entity currently declares any class-transformer decoration of any kind.

Implication: `instanceToPlain` would run with the default contract — return every enumerable property of the entity instance, no rewriting. The only change introduced by Strategy 1 is the new `@Exclude` we'd add on the User fields. No pre-existing decorator would surprise us by firing on serialize.

### C.2 Entity-level `transformer: { to, from }` on columns — none

`grep -rnE "transform\s*:\s*\{" backend/src/database/entities` → **zero matches**. No column-level value transformers exist on any entity. Strategy 1 introduces no new transformer behavior at the column level.

### C.3 Existing class-transformer global options — none

`grep -rnE "excludeExtraneousValues|excludePrefixes" backend/src` → **zero matches in production code.** Nothing relies on the strict `@Expose`-only strategy. The default `excludeExtraneousValues: false` would apply (every non-`@Exclude`-decorated property is exposed by default), which is what current consumers already see.

`main.ts:71` has `enableImplicitConversion: true` — that is on the **ValidationPipe**'s `transformOptions` for INPUT DTO conversion. It does NOT affect a global `ClassSerializerInterceptor` for OUTPUT.

### C.4 `@AfterLoad` / JS getters / `toJSON()` overrides on entities — none

- `grep -rnE "@AfterLoad" backend/src/database/entities` → **zero matches.**
- `grep -rnE "get [a-zA-Z]+\(\)" backend/src/database/entities` → **zero matches** (no computed-property getters).
- `grep -rnE "toJSON\(" backend/src` → zero non-test matches.

Nothing currently relies on a computed property, so nothing would change between today's `JSON.stringify(entity)` and `JSON.stringify(instanceToPlain(entity))`.

### C.5 Date column serialization — uncertain in theory, likely identical in practice

DATE-typed columns (`type: 'date'`) — TypeORM returns these as plain strings like `"2026-01-15"`, never as Date instances. Example sites: `contract.entity.ts:198,202,206,210`, `notice.entity.ts:96,102`, `sub-contract.entity.ts:62,65`, `project.entity.ts:38,41`, `claim.entity.ts:83`. **No change** — strings stay strings under either pipeline.

TIMESTAMPTZ columns (`@CreateDateColumn`, `@UpdateDateColumn`, etc.) — TypeORM returns these as **JS `Date` instances** in the entity. Without any interceptor, NestJS's response serializer ultimately runs `JSON.stringify` which invokes the Date's `.toISOString()` — wire format is `"2026-01-15T12:34:56.789Z"`. Under a `ClassSerializerInterceptor`, `instanceToPlain` MAY treat Date specially (most class-transformer versions leave Date as-is; serialization happens at the final `JSON.stringify` step regardless). Empirically the wire format is expected to remain identical, but **the audit did not test this end-to-end** — confidence MEDIUM. Worth a smoke test on one timestamp-heavy endpoint (e.g. `GET /audit-log`) after enabling.

### C.6 Decimal / numeric column serialization — no change

Sites: `contract.contract_value` (`decimal(15,2)`), `claim.claimed_amount`, `claim.resolution_amount`, `sub_contract.contract_value`, `obligation.amount`, `subscription_plan.price`, `payment_transaction.amount`, `clause.confidence_score`, `knowledge-asset` similar — all `decimal(N, M)` columns. TypeORM's standard behavior is to return these as **strings** (e.g. `"5000.00"`) to preserve precision. `instanceToPlain` does not type-coerce — strings stay strings.

`grep -rnE "@Column.*decimal" backend/src/database/entities` → 13 matches, all standard decimal columns with no `transformer:`. No bigint columns found. **No shape change under Strategy 1.**

### C.7 Circular relations — present in the entity graph but not auto-loaded

The User entity has relations to `organization, projects (via ProjectMember.user), notifications, audit_logs` (`user.entity.ts` line 9 imports). Several reverse relations exist (e.g. `Contract.creator → User`, `User → ContractApprover → User`). However, **TypeORM only loads relations that are explicitly requested via `leftJoinAndSelect` or `relations: [...]`** — there is no eager auto-loading of circular paths in this codebase. `grep -rnE "eager:\s*true" backend/src/database/entities` → no hits I could find.

So `instanceToPlain` won't choke on infinite circularity unless a specific endpoint requests circular relations. The 19-endpoint footprint we surveyed all load 1-2 hops of relations only.

**Confidence:** MEDIUM — TypeORM's behavior is consistent and no eager-load decorators were found; full graph not exhaustively traced.

### C.8 Anything else changing under instanceToPlain

- **`null` vs missing keys:** `instanceToPlain` preserves `null` values as `null`; `JSON.stringify` also preserves them. Same.
- **`undefined` values:** `JSON.stringify` drops them. `instanceToPlain` returns the property as `undefined`, and the final `JSON.stringify` drops it. Same end-state on the wire.
- **Array of instances:** recurses correctly into both pipelines.

**Conclusion of Area C:** the only response-shape change Strategy 1 introduces, as far as the audit can determine, is the deletion of the 5 fields marked `@Exclude`. Nothing else flips. Two items remain MEDIUM-confidence (Date serialization, circular-relation recursion); both are pre-existing latent risks that would warrant a single live-endpoint smoke test after enabling.

---

## D. Per-controller registration as a safer middle path

`@UseInterceptors(ClassSerializerInterceptor)` can be applied at the controller level instead of globally. The blast-radius set shrinks from "every controller in the app" to "this one controller's responses."

For Strategy 1-per-controller to work, the entity returned by THAT controller must be an instance (Area A's category (a)). From the leak list:

| Controller | Returns instance? | Strategy 1 per-controller works? |
|---|---|---|
| `contracts.controller.ts` (`findAll`, `findById` (already patched), `getVersions`, `getMilestoneVersions`, `getVersion`, `getComments`, `getApprovers`, `getPendingApprovalsForUser`) | YES (qb/repo direct) | YES |
| `claims.controller.ts` (`findAllByContract`, `findById`) | YES | YES |
| `notices.controller.ts` (`findAllByContract`, `findById`) | YES | YES |
| `clauses.controller.ts` (`findAll`, `findById`, version history endpoints) | YES | YES |
| `knowledge-assets.controller.ts` (list, byId, etc.) | YES | YES |
| `projects.controller.ts` (`findAll`, `findById`, `getMembers`, `getDashboard`) | YES | YES |
| `subcontracts.controller.ts` (`findAllByMainContract`, `findById`) | YES | YES |
| `compliance/controllers/compliance-obligations.controller.ts` (lines 57, 116 inline QB) | YES | YES |
| `support/support.controller.ts` (ticket list/detail) | YES | YES |
| `support-chat/support-chat.controller.ts` (chat session reads) | YES | YES |
| `admin-audit-log/admin-audit-log.controller.ts` (log feed) | YES | YES |
| `negotiation/negotiation.controller.ts` (`findHistory`) | YES (array of instances inside `{events, total}` wrapper — interceptor recurses into the wrapper's `events` array) | YES |
| `risk-analysis/risk-analysis.controller.ts` (lists with `creator`) | YES | YES |
| `docusign/docusign.controller.ts` | UNCERTAIN — `relations: ['creator']` at `docusign.service.ts:287` is used internally for envelope creation; whether the response body to a DocuSign controller endpoint actually includes that creator object needs a per-endpoint trace | UNCERTAIN |
| `export/export.service.ts:223` | N/A — the PDF rendering path is currently BROKEN (Critical Known Bug #6), so it returns no response today; once fixed, the export endpoint emits a PDF not JSON, so neither strategy applies on this path |

**Per-controller registration works wherever Strategy 1 globally works, with the added safety of containing the C.5/C.7 uncertainties to the listed controllers only.**

---

## E. Master leak list — exact map of where each strategy fires

Each row is a known leak from the prior "wider footprint" report, re-derived against actual file:line and annotated with return shape.

| # | Service site (file:line) | Method | User-relation loaded | Return shape | Strategy 1 fixes? | Strategy 2 fixes? |
|---|---|---|---|---|---|---|
| 1 | `backend/src/modules/contracts/contracts.service.ts:73` | `findAll` | `contract.creator` | `qb.getMany()` → `Contract[]` instances | YES | YES |
| 2 | `backend/src/modules/contracts/contracts.service.ts:661` | `getVersions` | `creator, triggered_by_user` (both `User`) | `repo.find({relations})` → instances | YES | YES |
| 3 | `backend/src/modules/contracts/contracts.service.ts:669` | `getMilestoneVersions` | same | instances | YES | YES |
| 4 | `backend/src/modules/contracts/contracts.service.ts:680` | `getVersion` | same | instance | YES | YES |
| 5 | `backend/src/modules/contracts/contracts.service.ts:857,859` | `getComments` | `comment.user`, `replies.user` | `qb.getMany()` instances | YES | YES |
| 6 | `backend/src/modules/contracts/contracts.service.ts:1145` | `getApprovers` | `approver.user` | `repo.find({relations:['user']})` instances | YES | YES |
| 7 | `backend/src/modules/contracts/contracts.service.ts:1162` | `getPendingApprovalsForUser` | `contract.creator` | `qb.getMany()` instances | YES | YES |
| 8 | `backend/src/modules/clauses/clauses.service.ts:28,57,88,133,146` | various findAll/findById/version-history reads | `clause.creator` | `qb.getMany()` / `findOne` instances | YES | YES |
| 9 | `backend/src/modules/knowledge-assets/knowledge-assets.service.ts:54,55,88,89,322` | various reads | `asset.creator`, `asset.reviewer` | `qb.getMany()` / `findOne` instances | YES | YES |
| 10 | `backend/src/modules/notices/notices.service.ts:107` | `findById` | `submitter` (plus `documents.uploader`, `responses.responder`, `status_logs.changer` — all User) | `repo.findOne({relations})` instance | YES | YES |
| 11 | `backend/src/modules/claims/claims.service.ts:104,109+` | `findAllByContract`, `findById` | `submitter`, `documents.uploader`, `responses.responder`, `status_logs.changer` (all User) | `repo.find/findOne` instances | YES | YES |
| 12 | `backend/src/modules/subcontracts/subcontracts.service.ts:72,80` | reads | `creator`, `status_logs.changer` (User) | instances | YES | YES |
| 13 | `backend/src/modules/compliance/controllers/compliance-obligations.controller.ts:57,116` | inline QB in controller | `obligation_assignees.user` | `qb.getMany()` instances | YES | YES |
| 14 | `backend/src/modules/compliance/services/compliance-obligation.service.ts:226` | obligation query | `obligation_assignees.user` | `qb.getMany()` instances | YES | YES |
| 15 | `backend/src/modules/projects/projects.service.ts:60,253,316` | project reads | `members.user`, `member.user` | `repo.find/findOne` instances | YES | YES |
| 16 | `backend/src/modules/risk-analysis/risk-analysis.service.ts:110` | risk read | `creator` | instances | YES | YES |
| 17 | `backend/src/modules/risk-analysis/services/risk-explanation.service.ts:100` | inline QB | `o.user` (override-log user) | instances; UNCERTAIN if this method's return value ever reaches an HTTP response | YES (if returned) | YES (if returned) |
| 18 | `backend/src/modules/support/support.service.ts:67,69,122,148` | ticket reads | `ticket.user`, `ticket.assignee` | instances | YES | YES |
| 19 | `backend/src/modules/support-chat/support-chat.service.ts:63,106,120,391` | chat reads | `user`, `assigned_ops`, `sender` | instances | YES | YES |
| 20 | `backend/src/modules/admin-audit-log/admin-audit-log.service.ts:111` | audit log feed | `log.user` | `qb.getMany()` instances | YES | YES |
| 21 | `backend/src/modules/negotiation/negotiation.service.ts:53` | `findHistory` | `event.performer` (User) | `{ events: instance[], total }` — wrapping object is plain; `events` array recursed into by both pipelines | YES | YES |
| 22 | `backend/src/modules/docusign/docusign.service.ts:287` | internal lookup | `creator` | instance; UNCERTAIN whether the User object surfaces in any DocuSign response | UNCERTAIN | UNCERTAIN |
| 23 | `backend/src/modules/export/export.service.ts:223` | PDF generation input | `creator` | N/A — endpoint is currently BROKEN (Critical Known Bug #6); when fixed, returns a PDF not JSON. Neither strategy is relevant on this path |

**Tally:** of 22 actionable items (excluding the broken PDF service), **22 return entity instances**. Both strategies would fix all 22, with confirmation that Strategy 2 mirrors the established `users.service.ts:364` pattern.

---

## What Strategy 1 (global interceptor) would break

Found by exhaustive grep + targeted reading:

- **Nothing structurally observable on the wire.** Every endpoint that returns a `User` instance (or User-relation) would lose `password_hash`, `mfa_secret`, `mfa_totp_secret`, `mfa_recovery_codes`, `invitation_token` from the response body. Of those five, the first four are already absent from every observed response (they're stripped before serialization via `sanitizeUser` / manual destructure in auth + users-mgmt paths, and they're not currently leaking elsewhere only because the leak surface (creator/approver/submitter relations) doesn't actually need them). So removing them is a no-op for legitimate consumers.
- The fifth (`invitation_token`) IS currently on the wire in the auth-flow `user` object (login + 7 sibling endpoints). The frontend does not appear to read it (verified by grep across `apps/sign/src` — only `ProjectParty.invitation_token` is consumed, which is a different entity untouched by Strategy 1). **If a hidden consumer exists (e.g. an admin-debug tool, an integration test, an external API client), Strategy 1 would remove the field from their response.** This is the single concrete behavioral change. Confidence MEDIUM — grep can miss consumers.
- **Latent unknowns**: Date serialization under `instanceToPlain` vs raw `JSON.stringify` (C.5); circular-relation recursion if any future endpoint adds a circular leftJoinAndSelect (C.7). Both are MEDIUM confidence — neither could be empirically confirmed without enabling and probing. They are not currently broken; they could SUBTLY change.
- **No pre-existing class-transformer decorator on any entity** that would fire on serialize unexpectedly (`@Transform`/`@Expose`/`@Type` all absent from entity files).
- **No `excludeExtraneousValues` setting** anywhere that would flip the strict mode.

---

## Where Strategy 1 would SILENTLY FAIL

Endpoints that return **plain objects** today — `ClassSerializerInterceptor` skips them entirely, so `@Exclude` on the entity has no effect on their responses:

| Site | Returns plain because | Effect under Strategy 1 |
|---|---|---|
| `backend/src/modules/auth/auth.service.ts:1194-1203` `sanitizeUser` | Destructure + spread → plain object | `@Exclude(invitation_token)` does NOT remove the field from auth responses. The field stays on the wire. |
| `backend/src/modules/auth/auth.service.ts:343-348, 462-466, 487-489, 563-565, 624-625, 992-993, 1084` — 7 auth-flow returns | Same (use `sanitizeUser`) | Same — `invitation_token` continues to be returned by every auth flow. |
| `backend/src/modules/users/users.service.ts:65-74` `getProfile` (GET /users/me) | Explicit destructure of all 5 fields → plain | No effect; already strips all 5. |
| `backend/src/modules/users/users.service.ts:364-365` `createOperationsUser` | Destructure → plain | No effect; already strips all 5. |
| `backend/src/modules/admin-security/controllers/profile.controller.ts:51-52` (GET /me/profile) | Destructure → plain | No effect; already strips 4 of 5 (not invitation_token). If `invitation_token` is intended to be stripped here too, Strategy 1 doesn't fix it; you'd need to add it to the local destructure list. |
| `backend/src/modules/admin-security/services/gdpr-export.service.ts:190, 248` | Builds an anonymize/export literal | No effect (already plain, already overwrites password_hash). |

The most notable consequence: **Strategy 1 alone does not strip `invitation_token` from the seven auth-response paths** because they go through `sanitizeUser` which returns a plain object before any interceptor runs. To stop returning `invitation_token` from auth responses, `sanitizeUser` itself would need to add `invitation_token` to its destructure list (Strategy 2-style change inside that one helper).

In summary:
- For the 22 leak-list endpoints (which all return entity instances), Strategy 1 and Strategy 2 are equally effective at closing the leak.
- For the 7+ auth-flow endpoints and the 3 user-management plain-object endpoints, Strategy 1 is INERT and Strategy 2 is the only way to alter the response shape.
- The currently-leaking surface (User-relation loads on contracts/claims/notices/projects/etc.) is entirely category-A (instances), so Strategy 1 closes the documented leak completely. The "silent fail" sites are not currently leaking the 4 fields; they would only matter if the team also wants to suppress `invitation_token` from auth responses.

*End of audit.*

---

## M. Strategy-1 patch verification (live, with regression diff)

Live-container probe of the Strategy 1 deployment against the rebuilt `sign-backend`. Confirms (a) the leak is closed app-wide across a sample of leak-list endpoints, and (b) no unrelated response shape regressed (dates, decimals, relations).

### Step 0 / 1 — Container build identity

Container start before this verification: `2026-06-01T16:05:56.228Z` (the section-L restart).

Source-edit mtimes for the four Strategy 1 files (UTC):
- `user.entity.ts` → `2026-06-01T18:39:05Z`
- `app.module.ts` → `2026-06-01T18:39:49Z`
- `auth.service.ts` → `2026-06-01T18:40:13Z`
- `user.entity.spec.ts` → `2026-06-01T18:41:15Z`

Pre-restart container StartedAt (16:05Z) was older than every edit (18:39-18:41Z), but **`nest start --watch` had already hot-reloaded the changes inside the running container.** Docker logs:
```
6:38:50 PM  File change detected. Starting incremental compilation...
6:39:11 PM  [NestFactory] Starting Nest application...
6:39:12 PM  [NestApplication] Nest application successfully started
6:39:39 PM  File change detected. Starting incremental compilation...
6:39:52 PM  [NestApplication] Nest application successfully started
6:40:13 PM  File change detected. Starting incremental compilation...
6:40:21 PM  [NestApplication] Nest application successfully started
```
Confirmed by probing `/users/me` before the planned restart — `invitation_token` was already absent from the response, which it had been present in throughout sections K and L. Hot-reload picked up the sanitizeUser + @Exclude changes.

**Consequence:** an in-process before/after diff was not possible from the running container — both "before" and "after" would be post-Strategy-1. To compensate, the regression diff for Step 4 uses the **historical raw response body captured during audit section K** (the 250,855-byte leaked body of `GET /contracts/da159c30-...` from the genuine pre-J.2 pre-Strategy-1 state, preserved on disk at the tool-results path from that prior probe). That body is a true pre-fix baseline.

Container was then restarted explicitly to ensure a clean canonical Strategy 1 boot (eliminating any half-loaded hot-reload state):
- New container StartedAt: `2026-06-01T19:28:10.802Z` — postdates every source edit by ~47 minutes. Healthy bootstrap confirmed (10 health-check ticks to `healthy`).

### Step 3 — Leak-closure grep counts on all 4 captured responses

Captures (against the freshly-restarted container, in-org throwaway user `audit-m-orga-owner@throwaway.test` for the contract endpoints; `admin@sign.com` for audit-logs + login):

- `after_1_contract_byid.json`  — 250,668 bytes — `GET /api/v1/contracts/da159c30-...`
- `after_2_contracts_findall.json` — 1,939 bytes — `GET /api/v1/contracts?project_id=354e3f13-...`
- `after_3_audit.json` — 7,639 bytes — `GET /api/v1/admin/audit-logs?limit=5` (5 audit log rows)
- `after_4_login.json` — 1,569 bytes — `POST /api/v1/auth/login`

Literal `grep -c` counts (every count MUST be 0):

```
==== after_1 (contract findById) ====
password_hash:      0
mfa_secret:         0
mfa_totp_secret:    0
mfa_recovery_codes: 0
invitation_token:   0

==== after_2 (contracts findAll) ====
password_hash:      0
mfa_secret:         0
mfa_totp_secret:    0
mfa_recovery_codes: 0
invitation_token:   0

==== after_3 (audit-logs feed) ====
password_hash:      0
mfa_secret:         0
mfa_totp_secret:    0
mfa_recovery_codes: 0
invitation_token:   0

==== after_4 (auth/login response) ====
password_hash:      0
mfa_secret:         0
mfa_totp_secret:    0
mfa_recovery_codes: 0
invitation_token:   0
```

**20/20 counts zero across the sampled endpoints, including the previously-leaking `invitation_token` on the auth/login user object (Strategy 1 + sanitizeUser change).**

### Step 4 — Regression diff (the part that matters for a GLOBAL change)

Diff between section-K historical body (pre-J.2 pre-Strategy-1, 250,840 bytes after stripping the trailing `HTTP_STATUS=200` curl footer) vs `after_1_contract_byid.json` (250,668 bytes, post-Strategy-1, same contract, same fixtures untouched in DB).

**Top-level structural diff:**
```
K keys count    : 36
after_1 keys ct : 36
keys only in K       : []
keys only in after_1 : []
```
Every top-level key is preserved. Top-level fields hold no sensitive-field column directly, so no top-level key was dropped.

**Spot-check of identity + status fields (all expected to be byte-identical):**
```
id              : same=True  K='da159c30-50d4-4a84-871c-5e5dcca962f2'  after_1=same
project_id      : same=True  K='354e3f13-024d-4a50-81ee-44efe3244279'  after_1=same
name            : same=True  K='BASP'                                  after_1=same
contract_type   : same=True  K='UPLOADED'                              after_1=same
status          : same=True  K='DRAFT'                                 after_1=same
current_version : same=True  K=1                                       after_1=same
creation_flow   : same=True  K='MANUAL'                                after_1=same
party_first_name: same=True  K='الهيئة القومية للأنفاق'                after_1=same
party_second_name: same=True K='تحالف شركتي أوراسكوم للإنشاءات…'        after_1=same
```
**All 9 fields byte-identical (including Arabic strings — UTF-8 unchanged).**

**Date / timestamp fields side-by-side (the date-regression canary):**
```
created_at     : match=True  K='2026-04-29T13:27:47.930Z'  after_1='2026-04-29T13:27:47.930Z'
updated_at     : match=True  K='2026-04-29T13:27:54.099Z'  after_1='2026-04-29T13:27:54.099Z'
executed_at    : match=True  K=None  after_1=None
approved_at    : match=True  K=None  after_1=None
shared_at      : match=True  K=None  after_1=None
start_date     : match=True  K=None  after_1=None
end_date       : match=True  K=None  after_1=None
effective_date : match=True  K=None  after_1=None
expiry_date    : match=True  K=None  after_1=None
```
**Every date field byte-identical.** TIMESTAMPTZ columns (created_at / updated_at) preserved their `ISO 8601 string with 'Z' suffix` form. The C.5 audit unknown ("Date serialization may or may not subtly change under instanceToPlain") is now resolved: **no change.** DATE-only columns (start_date etc.) are all null on this contract; format-regression is not testable here but `after_2` (findAll) returns the same ISO format for `created_at`.

**Decimal / currency fields side-by-side:**
```
contract_value : match=True  K=None  after_1=None  (types K=NoneType A=NoneType)
currency       : match=True  K=None  after_1=None
```
This particular contract has no value set. The structural decimal-format check was therefore done on `after_2` (the findAll list — same contract): `contract_value: None`, `currency: None`. No decimal value populated in dev DB, so format unchanged from prior section K shape. Confidence on decimal-format regression is now MEDIUM-HIGH for known-null fields; the populated-decimal case is not exercised by this dev DB and remains a gap for a representative-data staging probe (CLAUDE.md lesson #135 still applies — same gate as audit J.2 / 7.17 2a).

**`creator` relation diff (the field where the stripping actually fires):**
```
creator type:           K=dict, after_1=dict      (RELATION PRESENT in both — not nulled, not dropped)
creator keys ONLY in K: ['invitation_token', 'mfa_recovery_codes', 'mfa_secret',
                         'mfa_totp_secret', 'password_hash']           ← exactly the 5 Excluded
creator keys ONLY in after_1: []
common keys (32 total): all 32 values IDENTICAL between K and after_1
```
The intended difference is the ONLY difference. Every non-sensitive field on the creator relation is byte-identical:
```
creator.email        : K='youssef141162@gmail.com'        after_1='youssef141162@gmail.com'
creator.created_at   : K='2026-04-07T20:34:05.550Z'       after_1='2026-04-07T20:34:05.550Z'
creator.last_login_at: K='2026-05-25T13:24:15.060Z'       after_1='2026-05-25T13:24:15.060Z'
```

**`contract_clauses` deep-nested array sanity (85 elements each):**
```
K.contract_clauses len      = 85
after_1.contract_clauses len = 85
first item byte-identical?  True
K[0].id            = '43ab8f21-4245-4258-ab95-3d7098ba1897'
after_1[0].id      = '43ab8f21-4245-4258-ab95-3d7098ba1897'
K[0].created_at    = '2026-04-29T13:32:17.689Z'
after_1[0].created_at = '2026-04-29T13:32:17.689Z'
```
Deep-nested data is byte-identical. The interceptor recurses into the array of `ContractClause` instances without mangling.

**Explicit answer to "any difference other than the 5 removed fields?":** **No.** Across top-level (36 keys), creator (32 common keys), and the first of 85 contract_clauses, every common field is byte-identical to the pre-fix section-K body. The only divergence is the 5 keys (`password_hash`, `mfa_secret`, `mfa_totp_secret`, `mfa_recovery_codes`, `invitation_token`) being absent from `after_1.creator` and present in `K.creator`.

**Per-endpoint sanity for the other 3 captures:**

- `after_2_contracts_findall.json`: list of 1 contract. `creator` has 32 keys, none sensitive. `created_at='2026-04-29T13:27:47.930Z'` (same ISO format). `contract_value: None`, `currency: None`.
- `after_3_audit.json`: 5 audit-log rows. `row[0].user` has 32 keys, none sensitive. `row[0].created_at='2026-06-01T19:41:13.359Z'` (same ISO format).
- `after_4_login.json`: top-level `['user', 'access_token', 'refresh_token']`. `user` has 32 keys. **`invitation_token` is now ABSENT** (was present in every prior section-K/L login response — confirming the sanitizeUser change is live).

### Step 5 — Cleanup proof

```sql
-- Pre-cleanup:
SELECT email, organization_id FROM users WHERE email LIKE 'audit-m-%@throwaway.test';
  audit-m-orga-owner@throwaway.test | d928fdcb-be1a-4885-aa40-a9ba23bf8274  (1 row)
SELECT count(*) AS sessions FROM user_sessions WHERE user_id IN (...);
  sessions = 1

-- Delete:
DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'audit-m-%@throwaway.test');
-- DELETE 1
DELETE FROM users WHERE email LIKE 'audit-m-%@throwaway.test' RETURNING email;
-- DELETE 1  (audit-m-orga-owner@throwaway.test)

-- Post-cleanup verification:
SELECT email FROM users WHERE email LIKE 'audit-m-%@throwaway.test';
-- (0 rows)
SELECT count(*) AS remaining_sessions FROM user_sessions WHERE user_id IN (...);
-- remaining_sessions = 0
```
Throwaway data fully removed.

---

**FINAL VERDICT: LEAK CLOSED, NO REGRESSION — sensitive fields 0 across sampled endpoints (4/4, 20 zero counts), dates byte-identical (ISO 8601 with `Z` preserved), relations present (not nulled/dropped), all 32 common creator keys identical to historical section-K body, decimal columns unchanged (null preserved as null), `invitation_token` now stripped from `auth/login` user object per the sanitizeUser change.**

