# OpenPlan Production Report Traceability Smoke — 2026-04-08

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-report-traceability-qa-2026-04-08T04-35-03-325Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 93efb051-4cd9-4e04-bc09-1e0c575cbe0c
- Project id: e17381a0-f4db-4182-bd47-322308e41383
- Campaign id: dd746e90-b2e0-4309-8380-6a8eab3b5540
- Report id: 169efbbb-2074-455c-bc9b-67b974772e17

## Pass/Fail Notes
- PASS: Created QA auth user openplan-report-traceability-qa-2026-04-08T04-35-03-325Z@natfordplanning.com.
- PASS: Created project/workspace via production API: QA Report Traceability Project 2026-04-08T04-35-03-325Z.
- PASS: Created engagement campaign QA Report Traceability Campaign 2026-04-08T04-35-03-325Z.
- PASS: Created approved engagement item Traceability testimony 2026-04-08T04-35-03-325Z.
- PASS: Created handoff report from the engagement campaign detail UI.
- PASS: Report detail rendered engagement source card and backlink to /engagement/dd746e90-b2e0-4309-8380-6a8eab3b5540.
- PASS: Open engagement campaign backlink navigated back to the originating engagement detail surface on production.

## Artifacts
- docs/ops/2026-04-08-test-output/2026-04-08-prod-report-traceability-01-campaign-detail.png
- docs/ops/2026-04-08-test-output/2026-04-08-prod-report-traceability-02-report-detail.png
- docs/ops/2026-04-08-test-output/2026-04-08-prod-report-traceability-03-backlink-target.png

## Coverage
- Production report detail rendered engagement source provenance card
- Production report detail rendered the Open engagement campaign navigation link
- Production backlink target matched the originating engagement campaign id
- Production backlink click navigated back to the originating engagement campaign detail page

## Notes
- This smoke used a dedicated QA auth user and created production QA records/workspace for continuity verification.
- Mutations were limited to QA project/campaign/item/report records needed for verification.
- This complements the earlier production engagement-to-report handoff smoke by proving reversible navigation from report detail back to engagement source.
