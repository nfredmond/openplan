# OpenPlan Production QA Cleanup — 2026-05-17

- Started: 2026-05-17T20:38:21.628Z
- Mode: dry-run
- Env path: /home/narford/.openclaw/workspace/openplan/openplan/.env.production.local
- Created-after filter: 2026-05-17
- QA match rule: /qa|proof|trace|canary|debug|smoke|scenario-compare|managed-run|county-scaffold|layout-audit/i

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-05-17.
- Targeted workspaces: 22
- Targeted county runs: 0
- Targeted auth users: 10

## Stripe checkout sessions
- No Stripe checkout sessions found for targeted workspaces.

## Delete plan
- report_artifacts: planned=12
- report_sections: planned=79
- plans: planned=5
- programs: planned=5
- billing_events: planned=22
- reports: planned=12
- projects: planned=12
- workspace_members: planned=22
- workspaces: planned=22

## Auth plan
- openplan-prod-rtp-release-smoke-2026-05-17t20-21-37-942z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-05-17t20-20-07-832z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-05-17t20-18-11-656z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-05-17t20-17-03-799z@natfordplanning.com
- openplan-prod-debug-2026-05-17t20-16-33-819z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-05-17t20-16-14-851z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-05-17t20-15-22-769z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-05-17t20-15-07-093z@natfordplanning.com
- debug-prod-1779048880023@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-05-17t20-13-15-680z@natfordplanning.com

## Dry-run note
- No production cleanup was executed. Re-run with `--apply` after reviewing the plan above.

## Verification
- Dry-run only. No production rows were deleted and no auth users were removed.
- Remaining matching workspaces: 22
- Remaining matching auth users: 10

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
