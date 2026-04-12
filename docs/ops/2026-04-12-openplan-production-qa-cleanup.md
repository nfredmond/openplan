# OpenPlan Production QA Cleanup — 2026-04-12

- Started: 2026-04-12T23:33:32.706Z
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
- report_artifacts: planned=5
- report_sections: planned=30
- billing_events: planned=10
- reports: planned=5
- projects: planned=5
- workspace_members: planned=10
- workspaces: planned=10

## Auth plan
- openplan-prod-rtp-release-smoke-2026-04-12t23-32-52-656z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-04-12t23-27-35-775z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-04-12t23-16-39-943z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-04-12t23-14-30-239z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-04-12t23-12-55-297z@natfordplanning.com

## Delete results
- report_artifacts: status=200 ok=true planned=5 deleted=5
- report_sections: status=200 ok=true planned=30 deleted=30
- billing_events: status=200 ok=true planned=10 deleted=0
- reports: status=200 ok=true planned=5 deleted=5
- projects: status=200 ok=true planned=5 deleted=5
- workspace_members: status=200 ok=true planned=10 deleted=10
- workspaces: status=200 ok=true planned=10 deleted=10

## Auth deletes
- openplan-prod-rtp-release-smoke-2026-04-12t23-32-52-656z@natfordplanning.com: status=200 ok=true
- openplan-prod-rtp-release-smoke-2026-04-12t23-27-35-775z@natfordplanning.com: status=200 ok=true
- openplan-prod-rtp-release-smoke-2026-04-12t23-16-39-943z@natfordplanning.com: status=200 ok=true
- openplan-prod-rtp-release-smoke-2026-04-12t23-14-30-239z@natfordplanning.com: status=200 ok=true
- openplan-prod-rtp-release-smoke-2026-04-12t23-12-55-297z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
