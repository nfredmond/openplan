# OpenPlan Production QA Cleanup — 2026-04-12

- Started: 2026-04-12T08:01:32.840Z
- Mode: apply
- Env path: /home/narford/.openclaw/workspace/openplan/openplan/.env.local
- Created-after filter: 2026-04-12
- QA match rule: /qa|proof|trace|canary|debug|smoke|scenario-compare|managed-run|county-scaffold|layout-audit/i

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-04-12.
- Targeted workspaces: 2
- Targeted county runs: 0
- Targeted auth users: 1

## Stripe checkout sessions
- No Stripe checkout sessions found for targeted workspaces.

## Delete plan
- programs: planned=1
- billing_events: planned=2
- projects: planned=1
- workspace_members: planned=2
- workspaces: planned=2

## Auth plan
- openplan-prod-grants-smoke-2026-04-12t08-00-48-179z@natfordplanning.com

## Delete results
- programs: status=200 ok=true planned=1 deleted=1
- billing_events: status=200 ok=true planned=2 deleted=0
- projects: status=200 ok=true planned=1 deleted=1
- workspace_members: status=200 ok=true planned=2 deleted=2
- workspaces: status=200 ok=true planned=2 deleted=2

## Auth deletes
- openplan-prod-grants-smoke-2026-04-12t08-00-48-179z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
