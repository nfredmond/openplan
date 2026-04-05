# OpenPlan Production Managed Run Smoke — 2026-04-05

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-managed-run-smoke-2026-04-05T02-35-47-910Z@natfordplanning.com
- Workspace id: 3876e78b-e361-441f-aa8d-f2d589a8b344
- Project id: e4bd17d1-747c-49a5-bc77-8b1576299946
- Scenario set id: 1111539b-849c-4075-800b-559581f70faf
- Baseline entry id: 1cac4489-4e0f-4991-91e7-bfb1c6a9b5f4
- Alternative entry id: c10b5b51-e067-4837-9a61-8a6bfc57ff51
- Model id: b527728d-891d-493a-b46d-a0f693b5c228
- Managed model run id: 4d76afb0-f5cb-413c-afd4-4b409d63d49b
- Linked analysis run id: 6ba90def-0f59-48e7-ae4a-d96faafe4def

## Pass/Fail Notes
- PASS: Signed into production with dedicated smoke user.
- PASS: Created project/workspace via production API.
- PASS: Created scenario set via production API.
- PASS: Created baseline and alternative scenario entries.
- PASS: Created model with embedded run template defaults.
- PASS: Launched managed run via production model detail UI (4d76afb0-f5cb-413c-afd4-4b409d63d49b).
- PASS: Scenario entry attachment updated to the launched analysis run.

## Assertions proven on production
- Managed run launcher rendered on model detail page.
- UI launch request returned a real `modelRunId` and linked `runId`.
- `model_runs` row reached `succeeded` on production.
- Scenario entry was automatically updated with the resulting analysis run id.
- Model detail page showed linked run history after refresh.
- Scenario set page showed the scenario entry with run attachment state after launch.

## Artifacts
- docs/ops/2026-04-05-test-output/2026-04-05-prod-managed-run-01-model-launch-ready.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-managed-run-02-model-history.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-managed-run-03-scenario-entry.png

## Notes
- This smoke used dedicated production QA identities and records for verification.
- Those QA production records and auth identities were subsequently removed; see `docs/ops/2026-04-05-openplan-production-qa-cleanup.md`.
