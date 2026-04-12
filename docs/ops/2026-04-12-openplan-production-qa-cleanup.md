# OpenPlan Production QA Cleanup — 2026-04-12

- Started: 2026-04-12T08:47:55.857Z
- Mode: apply
- Env path: /home/narford/.openclaw/workspace/openplan/openplan/.env.local
- Created-after filter: 2026-04-12
- QA match rule: /qa|proof|trace|canary|debug|smoke|scenario-compare|managed-run|county-scaffold|layout-audit/i

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-04-12.
- Targeted workspaces: 12
- Targeted county runs: 0
- Targeted auth users: 6

## Stripe checkout sessions
- No Stripe checkout sessions found for targeted workspaces.

## Delete plan
- programs: planned=6
- billing_events: planned=12
- projects: planned=6
- workspace_members: planned=12
- workspaces: planned=12

## Auth plan
- openplan-prod-grants-smoke-2026-04-12t08-47-02-740z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t08-46-08-604z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t08-45-12-608z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t08-43-53-213z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t08-42-42-027z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t08-40-52-786z@natfordplanning.com

## Delete results
- programs: status=200 ok=true planned=6 deleted=6
- billing_events: status=200 ok=true planned=12 deleted=0
- projects: status=200 ok=true planned=6 deleted=6
- workspace_members: status=200 ok=true planned=12 deleted=12
- workspaces: status=200 ok=true planned=12 deleted=12

## Auth deletes
- openplan-prod-grants-smoke-2026-04-12t08-47-02-740z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t08-46-08-604z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t08-45-12-608z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t08-43-53-213z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t08-42-42-027z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t08-40-52-786z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
