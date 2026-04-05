# OpenPlan Production Scenario Comparison Smoke — 2026-04-05

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-scenario-compare-2026-04-05T02-36-37-964Z@natfordplanning.com
- Workspace id: 94a492ee-90c0-463e-aea4-df21f51846ff
- Project id: 3ac8bef1-9805-4555-82ef-5fdf6d780979
- Scenario set id: 8e3b673f-0df0-47b5-a9db-844cea38d2a1
- Baseline entry id: a5fa9c49-ed6f-4bcc-8406-9f383e57e7ad
- Alternative entry id: 99b1fcfc-4aed-4e03-a804-e19e2ee744d7
- Model id: 16154af0-1779-410e-80ef-db5fb8ba0681
- Baseline run id: ad80ba89-fa58-4ef7-9211-5ea0a09c2bbf
- Alternative run id: 0a59c233-1dcc-460a-9eae-5b287bab9df5

## Pass/Fail Notes
- PASS: Signed into production with dedicated comparison smoke user.
- PASS: Launched and reconciled both baseline and alternative managed runs on production.
- PASS: Scenario comparison board rendered on production with a ready-to-compare card and live headline metric content.

## Assertions proven on production
- Baseline and alternative managed runs can both complete against the same scenario set/model.
- Scenario page renders a live alternative-vs-baseline comparison board when both runs are attached.
- Comparison card exposes ready-to-compare state and headline metric deltas on production.

## Artifacts
- docs/ops/2026-04-05-test-output/2026-04-05-prod-scenario-comparison-01-board.png

## Notes
- This smoke used dedicated production QA identities and records for verification.
- Those QA production records and auth identities were subsequently removed; see `docs/ops/2026-04-05-openplan-production-qa-cleanup.md`.
