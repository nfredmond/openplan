# OpenPlan Production QA Cleanup — 2026-04-12

- Started: 2026-04-12T08:11:12.869Z
- Mode: apply
- Env path: /home/narford/.openclaw/workspace/openplan/openplan/.env.local
- Created-after filter: 2026-04-12
- QA match rule: /qa|proof|trace|canary|debug|smoke|scenario-compare|managed-run|county-scaffold|layout-audit/i

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-04-12.
- Targeted workspaces: 4
- Targeted county runs: 0
- Targeted auth users: 2

## Stripe checkout sessions
- No Stripe checkout sessions found for targeted workspaces.

## Delete plan
- programs: planned=2
- billing_events: planned=4
- projects: planned=2
- workspace_members: planned=4
- workspaces: planned=4

## Auth plan
- openplan-prod-grants-smoke-2026-04-12t08-10-26-100z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t08-09-47-351z@natfordplanning.com

## Delete results
- programs: status=200 ok=true planned=2 deleted=2
- billing_events: status=200 ok=true planned=4 deleted=0
- projects: status=200 ok=true planned=2 deleted=2
- workspace_members: status=200 ok=true planned=4 deleted=4
- workspaces: status=200 ok=true planned=4 deleted=4

## Auth deletes
- openplan-prod-grants-smoke-2026-04-12t08-10-26-100z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t08-09-47-351z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
