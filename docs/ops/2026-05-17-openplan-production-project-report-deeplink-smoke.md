# OpenPlan Production Project Report Deep-Link Smoke — 2026-05-17

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-project-report-link-2026-05-17T20-33-28-888Z@natfordplanning.com
- QA user id: 4abdeb9e-70ce-402d-8b0f-6e717edd288a
- Workspace id: d7b9590f-c137-49db-98be-49c5fb62858f
- Project id: e4435947-7c7b-4192-b244-2f735813f3f0
- Report id: a90d42df-d7c4-4093-bb83-44d3d18be84c
- Verified href: /reports/a90d42df-d7c4-4093-bb83-44d3d18be84c#drift-since-generation
- Verified anchor: #drift-since-generation

## Pass/Fail Notes
- PASS: Created bounded QA auth user openplan-prod-project-report-link-2026-05-17T20-33-28-888Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped isolated QA workspace OpenPlan Prod Project Report Link Smoke 20-33-28.
- PASS: Seeded project Project Detail Report Link Smoke 20-33-28.
- PASS: Created project-linked report Project Detail Supported Report Packet 20-33-28.
- PASS: Generated a real report artifact so the project card is a supported packet path, not a no-packet placeholder.
- PASS: Project detail rendered both the Project packet queue row and recent report card with href /reports/a90d42df-d7c4-4093-bb83-44d3d18be84c#drift-since-generation.
- PASS: Clicking the project report card landed on the supported report detail #drift-since-generation packet-work anchor.

## Artifacts
- 2026-05-17-prod-project-report-deeplink-01-project-detail.png
- 2026-05-17-prod-project-report-deeplink-02-report-detail.png

## Verdict
- PASS: Production authenticated smoke proves the supported project-detail report packet path: project report queue/card links deep-link directly into a report detail packet-work anchor. It does not rely on dashboard or shared runtime-cue assumptions.
