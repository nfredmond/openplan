# OpenPlan Production QA Cleanup — 2026-04-12

- Started: 2026-04-12T06:16:29.537Z
- Mode: apply
- Env path: /home/narford/.openclaw/workspace/openplan/openplan/.env.local
- Created-after filter: 2026-04-12
- QA match rule: /qa|proof|trace|canary|debug|smoke|scenario-compare|managed-run|county-scaffold|layout-audit/i

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-04-12.
- Targeted workspaces: 11
- Targeted county runs: 0
- Targeted auth users: 6

## Stripe checkout sessions
- No Stripe checkout sessions found for targeted workspaces.

## Delete plan
- report_artifacts: planned=3
- report_sections: planned=18
- billing_events: planned=11
- reports: planned=3
- workspace_members: planned=11
- workspaces: planned=11

## Auth plan
- openplan-prod-rtp-release-smoke-2026-04-12t06-11-33-321z@natfordplanning.com
- openplan-prod-rtp-release-smoke-2026-04-12t06-10-12-660z@natfordplanning.com
- openplan-local-rtp-release-smoke-2026-04-12t06-06-38-691z@natfordplanning.com
- openplan-local-rtp-release-smoke-2026-04-12t06-06-10-538z@natfordplanning.com
- openplan-local-rtp-release-smoke-2026-04-12t06-02-36-719z@natfordplanning.com
- openplan-local-rtp-release-smoke-2026-04-12t06-01-08-933z@natfordplanning.com

## Delete results
- report_artifacts: status=200 ok=true planned=3 deleted=3
- report_sections: status=200 ok=true planned=18 deleted=18
- billing_events: status=200 ok=true planned=11 deleted=0
- reports: status=200 ok=true planned=3 deleted=3
- workspace_members: status=200 ok=true planned=11 deleted=11
- workspaces: status=200 ok=true planned=11 deleted=11

## Auth deletes
- openplan-prod-rtp-release-smoke-2026-04-12t06-11-33-321z@natfordplanning.com: status=200 ok=true
- openplan-prod-rtp-release-smoke-2026-04-12t06-10-12-660z@natfordplanning.com: status=200 ok=true
- openplan-local-rtp-release-smoke-2026-04-12t06-06-38-691z@natfordplanning.com: status=200 ok=true
- openplan-local-rtp-release-smoke-2026-04-12t06-06-10-538z@natfordplanning.com: status=200 ok=true
- openplan-local-rtp-release-smoke-2026-04-12t06-02-36-719z@natfordplanning.com: status=200 ok=true
- openplan-local-rtp-release-smoke-2026-04-12t06-01-08-933z@natfordplanning.com: status=200 ok=true

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targets obvious test-only records and QA identities, not user-authored production workspaces.
- Historical repo-side evidence remains even after production rows are removed.
