# OpenPlan Production QA Cleanup — 2026-04-05

- Started: 2026-04-05T00:49:35.481Z
- Created-after filter: 2026-04-05
- QA match rule: /qa|proof|trace|canary|debug/i

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-04-05.
- Targeted workspaces: 3
- Targeted auth users: 2

## Stripe cleanup
- No Stripe checkout sessions found for targeted workspaces.

## Delete results
- plans: status=200 ok=true planned=1 deleted=1
- models: status=200 ok=true planned=1 deleted=1
- programs: status=200 ok=true planned=1 deleted=1
- billing_events: status=200 ok=true planned=3 deleted=0
- projects: status=200 ok=true planned=1 deleted=1
- workspace_members: status=200 ok=true planned=3 deleted=3
- workspaces: status=200 ok=true planned=3 deleted=3

## Auth deletes
- openplan-qa-2026-04-05t00-48-50-442z@natfordplanning.com: status=200 ok=true
- openplan-qa-2026-04-05t00-47-34-705z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targeted obvious test-only records and QA identities, not user-authored production workspaces.
- Historical evidence remains in repo-side docs/screenshots even after production row cleanup.
