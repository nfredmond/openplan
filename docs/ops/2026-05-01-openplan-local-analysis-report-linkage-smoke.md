# OpenPlan Local Analysis Report Linkage Smoke — 2026-05-01

- Base URL: http://localhost:3000
- QA user email: openplan-local-analysis-linkage-2026-05-01T07-52-31-281Z@natfordplanning.com
- QA user id: 1a2ade16-320c-499a-9034-93efb60065d9
- Workspace id: 6bbb8296-b20d-4dd9-b779-a187bcfd660a
- Project id: b871fbe6-2012-4d7d-ab0d-9b5512e09e88
- Scenario set id: 2a5745c4-d62d-4585-b542-e952e9db967b
- Baseline entry id: 362da0c7-23d9-43ea-b00c-73af028d8056
- Alternative entry id: cc758558-9790-4960-9a2a-aa5157ac4d34
- Model id: 75cf7395-e2e5-4e87-a199-3bbc6a1ad5e6
- Managed model run id: cf0b01ae-5a2f-4000-9a2b-c2462d52597d
- Source analysis run id: c80ab3b0-70a4-427d-8fd4-a8a8815d8e38
- Source analysis run title: Evaluate the 075231 school access corridor for multimodal...
- Report id: d306a475-be35-4933-a96a-dbabc5d6e1ec
- Report run link id: f59a6ec8-b506-43ed-ab27-64050ab461ee
- Artifact id: 241b49e1-0810-4477-905f-7537d9914e03

## Pass/Fail Notes
- PASS: Created QA auth user openplan-local-analysis-linkage-2026-05-01T07-52-31-281Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Analysis Linkage Smoke 075231.
- PASS: Created scenario set for managed-run attachment.
- PASS: Created baseline and alternative scenario entries.
- PASS: Created model with embedded corridor run-template defaults.
- PASS: Launched a managed deterministic corridor run from the model detail UI.
- PASS: Verified model_runs reached succeeded with source analysis run and result summary.
- PASS: Verified scenario entry was automatically attached to the generated analysis run.
- PASS: Verified source analysis run output persisted as Evaluate the 075231 school access corridor for multimodal....
- PASS: Verified Analysis Studio can deep-link back to the generated run output.
- PASS: Created an analysis summary report linked to the generated run.
- PASS: Verified durable report_runs linkage between the report and source analysis run.
- PASS: Generated an HTML packet and verified the linked run summary/query in the artifact preview.
- PASS: Verified artifact source context preserved linked analysis-run count.

## Artifacts
- 2026-05-01-local-analysis-report-linkage-01-model-launch-ready.png
- 2026-05-01-local-analysis-report-linkage-02-model-history.png
- 2026-05-01-local-analysis-report-linkage-03-analysis-studio-run.png
- 2026-05-01-local-analysis-report-linkage-04-report-detail.png
- 2026-05-01-local-analysis-report-linkage-05-generated-artifact.png

## Verdict
- PASS: Local rendered/API smoke confirms the Analysis flow from corridor run-template model, managed run launch, persisted source analysis output, scenario attachment, Analysis Studio deep link, analysis-summary report linkage, generated HTML artifact, and artifact source-context traceability.
