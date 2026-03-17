# OpenPlan Production Engagement Report Handoff Smoke — 2026-03-17

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-engagement-report-qa-2026-03-17T07-49-10-692Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 0e17a505-7825-43b2-8ecb-6ce55218774b
- Project id: 06b8c475-4e0e-4339-8d3c-22b8f01ea588
- Campaign id: e3f33c75-7b5d-49ef-95d7-39ab718c74dc
- Report id: b0146476-9300-4a94-86ad-1b20f1e4cb9b

## Pass/Fail Notes
- PASS: Created QA auth user openplan-engagement-report-qa-2026-03-17T07-49-10-692Z@natfordplanning.com.
- PASS: Created project/workspace via production API: QA Engagement Report Project 2026-03-17T07-49-10-692Z.
- PASS: Created engagement campaign QA Engagement Report Campaign 2026-03-17T07-49-10-692Z.
- PASS: Created approved engagement item Verified crossing concern 2026-03-17T07-49-10-692Z.
- PASS: Created handoff report from the engagement campaign detail UI.
- PASS: Generated HTML packet and verified the artifact preview included the engagement campaign summary content.

## Artifacts
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-report-handoff-01-campaign-detail.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-report-handoff-02-item-ready.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-report-handoff-03-report-detail.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-report-handoff-04-generated-artifact.png

## Coverage
- Engagement campaign creation on production
- Category + approved intake item creation on production
- Handoff report creation from engagement campaign detail
- Report detail load with engagement section present
- HTML packet generation on production
- Generated artifact preview contains engagement campaign summary content

## Notes
- This smoke used a dedicated QA auth user and created production QA records/workspace for continuity verification.
- Mutations were limited to QA project/campaign/item/report records needed for verification.
