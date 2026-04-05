# OpenPlan Production QA Cleanup — 2026-04-05

- Started: 2026-04-05T02:37:02.941Z
- Created-after filter: 2026-04-05
- QA match rule: /qa|proof|trace|canary|debug|smoke|scenario-compare|managed-run/i

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-04-05.
- Targeted workspaces: 2
- Targeted auth users: 1

## Stripe cleanup
- No Stripe checkout sessions found for targeted workspaces.

## Delete results
- models: status=200 ok=true planned=1 deleted=1
- billing_events: status=200 ok=true planned=2 deleted=0
- projects: status=200 ok=true planned=1 deleted=1
- workspace_members: status=200 ok=true planned=2 deleted=2
- workspaces: status=200 ok=true planned=2 deleted=2

## Auth deletes
- openplan-scenario-compare-2026-04-05t02-36-37-964z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targeted obvious test-only records and QA identities, not user-authored production workspaces.
- Historical evidence remains in repo-side docs/screenshots even after production row cleanup.
