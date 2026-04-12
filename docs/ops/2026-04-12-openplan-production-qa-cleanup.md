# OpenPlan Production QA Cleanup — 2026-04-12

- Started: 2026-04-12T23:46:06.515Z
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
- report_artifacts: planned=1
- report_sections: planned=6
- billing_events: planned=2
- reports: planned=1
- projects: planned=1
- workspace_members: planned=2
- workspaces: planned=2

## Auth plan
- openplan-prod-rtp-release-smoke-2026-04-12t23-45-24-830z@natfordplanning.com

## Delete results
- report_artifacts: status=200 ok=true planned=1 deleted=1
- report_sections: status=200 ok=true planned=6 deleted=6
- billing_events: status=200 ok=true planned=2 deleted=0
- reports: status=200 ok=true planned=1 deleted=1
- projects: status=200 ok=true planned=1 deleted=1
- workspace_members: status=200 ok=true planned=2 deleted=2
- workspaces: status=200 ok=true planned=2 deleted=2

## Auth deletes
- openplan-prod-rtp-release-smoke-2026-04-12t23-45-24-830z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
