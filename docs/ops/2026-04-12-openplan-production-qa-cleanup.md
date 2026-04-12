# OpenPlan Production QA Cleanup — 2026-04-12

- Started: 2026-04-12T22:59:12.211Z
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
- report_artifacts: planned=2
- report_sections: planned=12
- billing_events: planned=4
- reports: planned=2
- projects: planned=2
- workspace_members: planned=4
- workspaces: planned=4

## Auth plan
- openplan-prod-rtp-release-smoke-2026-04-12t22-58-43-892z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-04-12t22-57-44-547z@natfordplanning.com

## Delete results
- report_artifacts: status=200 ok=true planned=2 deleted=2
- report_sections: status=200 ok=true planned=12 deleted=12
- billing_events: status=200 ok=true planned=4 deleted=0
- reports: status=200 ok=true planned=2 deleted=2
- projects: status=200 ok=true planned=2 deleted=2
- workspace_members: status=200 ok=true planned=4 deleted=4
- workspaces: status=200 ok=true planned=4 deleted=4

## Auth deletes
- openplan-prod-rtp-release-smoke-2026-04-12t22-58-43-892z@natfordplanning.com: status=200 ok=true
- openplan-prod-rtp-release-smoke-2026-04-12t22-57-44-547z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
