# OpenPlan Production QA Cleanup — 2026-04-12

- Started: 2026-04-12T22:21:08.394Z
- Mode: apply
- Env path: /home/narford/.openclaw/workspace/openplan/openplan/.env.local
- Created-after filter: 2026-04-12
- QA match rule: /qa|proof|trace|canary|debug|smoke|scenario-compare|managed-run|county-scaffold|layout-audit/i

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-04-12.
- Targeted workspaces: 6
- Targeted county runs: 0
- Targeted auth users: 3

## Stripe checkout sessions
- No Stripe checkout sessions found for targeted workspaces.

## Delete plan
- report_artifacts: planned=2
- report_sections: planned=14
- billing_events: planned=6
- reports: planned=2
- projects: planned=3
- workspace_members: planned=6
- workspaces: planned=6

## Auth plan
- openplan-report-funding-qa-2026-04-12t22-20-35-033z@natfordplanning.com
- openplan-report-funding-qa-2026-04-12t22-18-16-398z@natfordplanning.com
- openplan-report-funding-qa-2026-04-12t21-57-10-051z@natfordplanning.com

## Delete results
- report_artifacts: status=200 ok=true planned=2 deleted=2
- report_sections: status=200 ok=true planned=14 deleted=14
- billing_events: status=200 ok=true planned=6 deleted=0
- reports: status=200 ok=true planned=2 deleted=2
- projects: status=200 ok=true planned=3 deleted=3
- workspace_members: status=200 ok=true planned=6 deleted=6
- workspaces: status=200 ok=true planned=6 deleted=6

## Auth deletes
- openplan-report-funding-qa-2026-04-12t22-20-35-033z@natfordplanning.com: status=200 ok=true
- openplan-report-funding-qa-2026-04-12t22-18-16-398z@natfordplanning.com: status=200 ok=true
- openplan-report-funding-qa-2026-04-12t21-57-10-051z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
