Phase 7.1 frontend foundation is done. PR #24 (Step 2 — Obligations tab
+ portfolio page) and PR #25 (Step 3 — calendar + modals + drawer +
housekeeping) are both merged.

Pull main when convenient:

git checkout main
git pull origin main

**Heads-up on a local DB workaround:** if your obligations table doesn't
have MET or WAIVED enum values, you'll hit an insert error when seeding
test data. There's a documented workaround in CLAUDE.md under "Known Local
Dev Gotchas" — one-time ALTER, takes 2 seconds. Tracked as 7.2-E for a
proper migration fix.

**Three new Phase 7.2 backend items surfaced during verification** that
would be good for you to look at when you have cycles:

- **7.2-E:** Silent-catch in 1718000000002-AddComplianceMonitoring.ts —
  the migration claims success while doing nothing. Wrong enum type name
  + swallowed exception. Same anti-pattern as lesson #31.

- **7.2-G:** Route ordering bug — GET /obligations/portfolio and
  GET /obligations/calendar are shadowed by the legacy /obligations/:id
  route in obligations.controller.ts. Both return 400 "uuid expected."
  Bug evidence screenshots in PR #25 at
  docs/screenshots/phase-7.1-step-3/bug-evidence/.

- **7.2-C:** No GET /contracts/:id/obligations/:oblId/reminders endpoint
  — the detail drawer's Reminder History section shows a placeholder
  until this lands.

Full Phase 7.2 backlog (8 items A-H) is in NEXT_PHASES.md.

Step 4 (in-app real-time notifications + dir="auto" final audit) is up
next on my side — branch already created off the freshly-synced main.

Note: PR #25's CI was the first time CI actually ran on Phase 7.1 frontend
work — previously the workflow filtered to main-only and stacked PRs
weren't being checked. That's fixed now (commit f0e214a). All your future
PRs targeting feature branches will get CI runs.
