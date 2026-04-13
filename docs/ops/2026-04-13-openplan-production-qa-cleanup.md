# OpenPlan Production QA Cleanup — 2026-04-13

- Started: 2026-04-13T04:42:30.628Z
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
- report_artifacts: planned=8
- report_sections: planned=52
- plans: planned=4
- programs: planned=4
- billing_events: planned=10
- reports: planned=8
- projects: planned=4
- workspace_members: planned=10
- workspaces: planned=10

## Auth plan
- openplan-prod-rtp-release-smoke-2026-04-13t04-41-17-091z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-04-13t04-39-15-597z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-04-13t04-38-53-854z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-04-13t04-37-06-925z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-04-13t04-35-23-160z@natfordplanning.com

## Delete results
- report_artifacts: status=200 ok=true planned=8 deleted=8
- report_sections: status=200 ok=true planned=52 deleted=52
- plans: status=200 ok=true planned=4 deleted=4
- programs: status=200 ok=true planned=4 deleted=4
- billing_events: status=200 ok=true planned=10 deleted=0
- reports: status=200 ok=true planned=8 deleted=8
- projects: status=200 ok=true planned=4 deleted=4
- workspace_members: status=200 ok=true planned=10 deleted=10
- workspaces: status=200 ok=true planned=10 deleted=10

## Auth deletes
- openplan-prod-rtp-release-smoke-2026-04-13t04-41-17-091z@natfordplanning.com: status=200 ok=true
- openplan-prod-rtp-release-smoke-2026-04-13t04-39-15-597z@natfordplanning.com: status=200 ok=true
- openplan-prod-rtp-release-smoke-2026-04-13t04-38-53-854z@natfordplanning.com: status=200 ok=true
- openplan-prod-rtp-release-smoke-2026-04-13t04-37-06-925z@natfordplanning.com: status=200 ok=true
- openplan-prod-rtp-release-smoke-2026-04-13t04-35-23-160z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
