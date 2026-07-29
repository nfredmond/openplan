# OpenPlan Local Analysis Report Linkage Smoke — 2026-07-28

## Local Targets
- App URL: http://localhost:3001
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Analysis report linkage smoke: app=http://localhost:3001, supabase=http://127.0.0.1:54321.

## Mutation Summary
- Created one local QA auth user and one project workspace, then wrote scenario/model records, launched one managed model run, linked the generated analysis run into a report, and generated one HTML report artifact.

## Cleanup / Idempotency Posture
- Local-only guard runs before service-role auth mutation and refuses Vercel, Supabase cloud, and arbitrary remote targets.
- This timestamped workflow smoke intentionally creates fresh local proof records on each run. It is safe to rerun against local Supabase, but old local QA users/workspaces/records remain until the local database is reset or cleaned manually.

## Key IDs
- QA user email: openplan-local-analysis-linkage-2026-07-28T18-29-26-850Z@natfordplanning.com
- QA user id: 0526822e-a2b9-4fda-b5d1-6ed953ea79a8
- Workspace id: 830f70da-7ff6-421b-b197-3f9ae4910639
- Project id: 8bc8e2e1-a87c-4751-934f-c7f68887feb7
- Scenario set id: 634ef54f-7eda-40f5-b143-03a967d81334
- Baseline entry id: dbbaf7a2-5082-4616-ae1e-85c1ce655c35
- Alternative entry id: c04bba74-35e1-445b-a977-64acc12ec656
- Model id: fb29dee7-e7e8-4e12-b574-e86356688c71
- Managed model run id: aac17115-7ebf-48cb-841c-d6acf2d97541
- Source analysis run id: b1e51def-abce-4e3d-bc0f-1e22289c0653
- Source analysis run title: Evaluate the 182926 school access corridor for multimodal...
- Report id: 3ba6a0cb-3cf7-4c20-accc-f95e26eaa819
- Report run link id: f0485c7d-5476-4139-896f-0e438230fb36
- Artifact id: 6ed9450d-2f74-47eb-a228-a9117d63bc8c

## Pass/Fail Notes
- PASS: Local guard passed for local Analysis report linkage smoke: app=http://localhost:3001, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-analysis-linkage-2026-07-28T18-29-26-850Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Analysis Linkage Smoke 182926.
- PASS: Created scenario set for managed-run attachment.
- PASS: Created baseline and alternative scenario entries.
- PASS: Created model with embedded corridor run-template defaults.
- PASS: Launched a managed deterministic corridor run from the model detail UI.
- PASS: Verified model_runs reached succeeded with source analysis run and result summary.
- PASS: Verified scenario entry was automatically attached to the generated analysis run.
- PASS: Verified source analysis run output persisted as Evaluate the 182926 school access corridor for multimodal....
- PASS: Verified Analysis Studio can deep-link back to the generated run output.
- PASS: Created an analysis summary report linked to the generated run.
- PASS: Verified durable report_runs linkage between the report and source analysis run.
- PASS: Generated an HTML packet and verified the linked run summary/query in the artifact preview.
- PASS: Verified artifact source context preserved linked analysis-run count.

## Artifacts
- 2026-07-28-local-analysis-report-linkage-01-model-launch-ready.png
- 2026-07-28-local-analysis-report-linkage-02-model-history.png
- 2026-07-28-local-analysis-report-linkage-03-analysis-studio-run.png
- 2026-07-28-local-analysis-report-linkage-04-report-detail.png
- 2026-07-28-local-analysis-report-linkage-05-generated-artifact.png

## Verdict
- PASS: Local rendered/API smoke confirms the Analysis flow from corridor run-template model, managed run launch, persisted source analysis output, scenario attachment, Analysis Studio deep link, analysis-summary report linkage, generated HTML artifact, and artifact source-context traceability.
