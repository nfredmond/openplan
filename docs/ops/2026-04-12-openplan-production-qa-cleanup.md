# OpenPlan Production QA Cleanup — 2026-04-12

- Started: 2026-04-12T07:06:24.055Z
- Mode: apply
- Env path: /home/narford/.openclaw/workspace/openplan/openplan/.env.local
- Created-after filter: 2026-04-12
- QA match rule: /qa|proof|trace|canary|debug|smoke|scenario-compare|managed-run|county-scaffold|layout-audit/i

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-04-12.
- Targeted workspaces: 15
- Targeted county runs: 0
- Targeted auth users: 8

## Stripe checkout sessions
- No Stripe checkout sessions found for targeted workspaces.

## Delete plan
- programs: planned=7
- billing_events: planned=15
- workspace_members: planned=15
- workspaces: planned=15

## Auth plan
- openplan-prod-grants-smoke-2026-04-12t07-05-49-248z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t07-04-48-154z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t07-04-17-509z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t07-03-09-814z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t06-55-50-648z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t06-54-52-038z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t06-53-24-167z@natfordplanning.com
- openplan-prod-grants-smoke-2026-04-12t06-49-01-777z@natfordplanning.com

## Delete results
- programs: status=200 ok=true planned=7 deleted=7
- billing_events: status=200 ok=true planned=15 deleted=0
- workspace_members: status=200 ok=true planned=15 deleted=15
- workspaces: status=200 ok=true planned=15 deleted=15

## Auth deletes
- openplan-prod-grants-smoke-2026-04-12t07-05-49-248z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t07-04-48-154z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t07-04-17-509z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t07-03-09-814z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t06-55-50-648z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t06-54-52-038z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t06-53-24-167z@natfordplanning.com: status=200 ok=true
- openplan-prod-grants-smoke-2026-04-12t06-49-01-777z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
