# OpenPlan Ship Board — Week 1

**Sprint Window:** 2026-03-01 to 2026-03-07  
**Status:** Active

## P0 Must-Ship
- [ ] Auth/session regression suite passes (signup/login/reset/session expiry).
- [ ] Workspace + role enforcement verified server-side.
- [ ] Core planner workflow E2E pass in production-like env.
- [ ] Grant-lab workflow E2E pass (required fields, save/reload, output actions).
- [ ] Billing checkout + webhook + cancel/refund canary evidence captured.
- [ ] Production smoke + rollback checklist complete.

## P1 High-Impact
- [ ] Error handling standardization on all critical API routes.
- [ ] User-facing failure-state copy improvements on critical journeys.
- [ ] Usage/rate limit messaging clarity and supportability.

## P2 Deferred (v1.1+)
- [ ] Non-critical UI polish items.
- [ ] Experimental integrations not required for pilot conversion.
- [ ] Extended feature concepts outside core ship gate.

## QA/QC Control Checks (Daily)
- [ ] 09:00 Scope + risk gate completed
- [ ] 13:00 Midday QA sweep completed
- [ ] 17:30 Ship gate review completed
- [ ] Evidence pack updated (auth, core planner, grant-lab, billing, P0/P1)

## Daily Cadence
- 09:00 — Plan + scope/risk gate
- 13:00 — Midday QA sweep + progress check
- 17:30 — Ship gate review + blocker decisions

## Evidence Links
- Ship sprint plan: `openplan/docs/ops/2026-03-01-openplan-7-day-ship-sprint.md`
- QA/QC rhythm: `openplan/docs/ops/2026-03-01-openplan-qa-qc-rhythm.md`
- Day 1 ship evidence index: `openplan/docs/ops/2026-03-01-ship-evidence-index.md`
- Revenue queue draft: `projects/revenue-engine/distribution_queue_2026-03-01_openplan_ship_week.md`
