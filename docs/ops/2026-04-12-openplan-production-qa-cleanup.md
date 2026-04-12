# OpenPlan Production QA Cleanup — 2026-04-12

- Started: 2026-04-12T20:35:39.706Z
- Mode: apply
- Env path: /home/narford/.openclaw/workspace/openplan/openplan/.env.local
- Created-after filter: 2026-04-12
- QA match rule: /qa|proof|trace|canary|debug|smoke|scenario-compare|managed-run|county-scaffold|layout-audit/i

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-04-12.
- Targeted workspaces: 10
- Targeted county runs: 0
- Targeted auth users: 5

## Stripe checkout sessions
- No Stripe checkout sessions found for targeted workspaces.

## Delete plan
- programs: planned=5
- billing_events: planned=10
- projects: planned=10
- workspace_members: planned=10
- workspaces: planned=10

## Auth plan
- openplan-prod-grants-smoke-2026-04-12t20-34-15-252z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t20-32-40-542z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t20-30-49-872z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t20-27-59-255z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t11-27-49-615z@natfordplanning.com

## Delete results
- programs: status=200 ok=true planned=5 deleted=5
- billing_events: status=200 ok=true planned=10 deleted=0
- projects: status=200 ok=true planned=10 deleted=10
- workspace_members: status=200 ok=true planned=10 deleted=10
- workspaces: status=200 ok=true planned=10 deleted=10

## Auth deletes
- openplan-prod-grants-smoke-2026-04-12t20-34-15-252z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t20-32-40-542z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t20-30-49-872z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t20-27-59-255z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t11-27-49-615z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
