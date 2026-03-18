# OpenPlan Production Managed Run Smoke — 2026-03-17

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-managed-run-smoke-2026-03-17T22-39-52-683Z@natfordplanning.com
- Workspace id: 46db2d6e-8d82-45ee-91d4-d0c55996dca7
- Project id: 74415076-67a4-423c-b2b4-968391694b34
- Scenario set id: 4450cfe1-a942-4f1e-96af-53292123554c
- Baseline entry id: 20e47ff0-1f4f-46bd-9931-836e80b50a82
- Alternative entry id: 76bf75a2-42b2-40ea-ab91-9742a363835c
- Model id: f7f8870f-110d-4524-b654-0ffe53b2e030
- Managed model run id: fd2e0d2f-4433-4cad-8317-6e820106eb27
- Linked analysis run id: 53c6c1d4-2f64-4d26-ac4b-dcc49a5596b5

## Pass/Fail Notes
- PASS: Signed into production with dedicated smoke user.
- PASS: Created project/workspace via production API.
- PASS: Created scenario set via production API.
- PASS: Created baseline and alternative scenario entries.
- PASS: Created model with embedded run template defaults.
- PASS: Launched managed run via production model detail UI (fd2e0d2f-4433-4cad-8317-6e820106eb27).
- PASS: Scenario entry attachment updated to the launched analysis run.

## Assertions proven on production
- Managed run launcher rendered on model detail page.
- UI launch request returned a real `modelRunId` and linked `runId`.
- `model_runs` row reached `succeeded` on production.
- Scenario entry was automatically updated with the resulting analysis run id.
- Model detail page showed linked run history after refresh.
- Scenario set page showed the scenario entry with run attachment state after launch.

## Artifacts
- docs/ops/2026-03-17-test-output/2026-03-17-prod-managed-run-01-model-launch-ready.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-managed-run-02-model-history.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-managed-run-03-scenario-entry.png
