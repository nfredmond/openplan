# OpenPlan Local Analysis Report Linkage Smoke — 2026-08-16

## Local Targets
- App URL: http://localhost:3200
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Analysis report linkage smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.

## Mutation Summary
- Created one local QA auth user and one project workspace, then wrote scenario/model records, launched one managed model run, linked the generated analysis run into a report, and generated one HTML report artifact.

## Cleanup / Idempotency Posture
- Local-only guard runs before service-role auth mutation and refuses Vercel, Supabase cloud, and arbitrary remote targets.
- This timestamped workflow smoke intentionally creates fresh local proof records on each run. It is safe to rerun against local Supabase, but old local QA users/workspaces/records remain until the local database is reset or cleaned manually.

## Key IDs
- QA user email: openplan-local-analysis-linkage-2026-08-16T00-13-05-449Z@natfordplanning.com
- QA user id: 7de73ac2-41aa-4eac-9f37-e7e066f912ce
- Workspace id: ca819b02-f46f-427d-90ee-b407d2d73518
- Project id: 585caa24-87f2-4edb-9ed0-0ca0f5402720
- Scenario set id: ce931251-fcf8-4cfc-899f-cd49be0a288b
- Baseline entry id: 7bc8b2be-d2a3-4283-ac28-f98e42743fc3
- Alternative entry id: 7fc3837b-6f5f-4d9d-8ae4-f1b219314a73
- Model id: 6fd5b92a-f4b6-4b71-a4a8-cad74389edbe
- Managed model run id: 5d53689a-7db9-4aba-9daf-8dd09bf969f1
- Source analysis run id: 6cc82626-90d9-4537-80f2-19a1dd8cc53d
- Source analysis run title: Evaluate the 001305 school access corridor for multimodal...
- Report id: 1aec49b3-c55a-48d1-bd42-9e04956c5dc1
- Report run link id: 58d6f425-63e2-4f9a-922d-8f14657e28fd
- Artifact id: b3a89585-2462-4d63-93c7-e894f4a23c8d

## Pass/Fail Notes
- PASS: Local guard passed for local Analysis report linkage smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-analysis-linkage-2026-08-16T00-13-05-449Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Analysis Linkage Smoke 001305.
- PASS: Created scenario set for managed-run attachment.
- PASS: Created baseline and alternative scenario entries.
- PASS: Created model with embedded corridor run-template defaults.
- PASS: Launched a managed deterministic corridor run from the model detail UI.
- PASS: Verified model_runs reached succeeded with source analysis run and result summary.
- PASS: Verified scenario entry was automatically attached to the generated analysis run.
- PASS: Verified source analysis run output persisted as Evaluate the 001305 school access corridor for multimodal....
- PASS: Verified Analysis Studio can deep-link back to the generated run output.
- PASS: Created an analysis summary report linked to the generated run.
- PASS: Verified durable report_runs linkage between the report and source analysis run.
- PASS: Generated an HTML packet and verified the linked run summary/query in the artifact preview.
- PASS: Verified artifact source context preserved linked analysis-run count.

## Artifacts
- 2026-08-16-local-analysis-report-linkage-01-model-launch-ready.png
- 2026-08-16-local-analysis-report-linkage-02-model-history.png
- 2026-08-16-local-analysis-report-linkage-03-analysis-studio-run.png
- 2026-08-16-local-analysis-report-linkage-04-report-detail.png
- 2026-08-16-local-analysis-report-linkage-05-generated-artifact.png

## Verdict
- PASS: Local rendered/API smoke confirms the Analysis flow from corridor run-template model, managed run launch, persisted source analysis output, scenario attachment, Analysis Studio deep link, analysis-summary report linkage, generated HTML artifact, and artifact source-context traceability.
