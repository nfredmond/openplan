# OpenPlan Production Scenario Comparison Smoke — 2026-03-18

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-scenario-compare-2026-03-18T03-21-17-301Z@natfordplanning.com
- Workspace id: dfe648f4-70f5-4217-9151-7e80a5b8a0ad
- Project id: 0c4978ba-74e8-4918-93a3-b87505777a53
- Scenario set id: 520eb0a7-d0fe-485d-a263-737878573140
- Baseline entry id: dfffa8cc-b9f0-4230-b8e9-ccf093505dee
- Alternative entry id: 55d826b3-d3a4-43d9-ab4b-3d2059d12472
- Model id: 80fd8576-3c75-4e30-83b2-0eda1a5e5d06
- Baseline run id: 44c6fcbf-58cc-4cee-8c89-d73530302331
- Alternative run id: ddeae2d7-28eb-43a6-88ef-5e34576544bb

## Pass/Fail Notes
- PASS: Signed into production with dedicated comparison smoke user.
- PASS: Launched and reconciled both baseline and alternative managed runs on production.
- PASS: Scenario comparison board rendered on production with a ready-to-compare card and live headline metric content.

## Assertions proven on production
- Baseline and alternative managed runs can both complete against the same scenario set/model.
- Scenario page renders a live alternative-vs-baseline comparison board when both runs are attached.
- Comparison card exposes ready-to-compare state and headline metric deltas on production.

## Artifacts
- docs/ops/2026-03-18-test-output/2026-03-18-prod-scenario-comparison-01-board.png
