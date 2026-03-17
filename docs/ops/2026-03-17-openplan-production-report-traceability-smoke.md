# OpenPlan Production Report Traceability Smoke — 2026-03-17

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-report-traceability-qa-2026-03-17T20-07-28-979Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 058d668b-9963-47a2-bfd8-fdabbde89c3b
- Project id: 5b371b40-0be9-4930-97b7-b059b30100e9
- Campaign id: eab39543-3ba3-4734-b486-6d8225f36672
- Report id: c18a22f2-99a2-4d8c-af0f-65a0dcdbd4e5

## Pass/Fail Notes
- PASS: Created QA auth user openplan-report-traceability-qa-2026-03-17T20-07-28-979Z@natfordplanning.com.
- PASS: Created project/workspace via production API: QA Report Traceability Project 2026-03-17T20-07-28-979Z.
- PASS: Created engagement campaign QA Report Traceability Campaign 2026-03-17T20-07-28-979Z.
- PASS: Created approved engagement item Traceability testimony 2026-03-17T20-07-28-979Z.
- PASS: Created handoff report from the engagement campaign detail UI.
- PASS: Report detail rendered engagement source card and backlink to /engagement/eab39543-3ba3-4734-b486-6d8225f36672.
- PASS: Open engagement campaign backlink navigated back to the originating engagement detail surface on production.

## Artifacts
- docs/ops/2026-03-17-test-output/2026-03-17-prod-report-traceability-01-campaign-detail.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-report-traceability-02-report-detail.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-report-traceability-03-backlink-target.png

## Coverage
- Production report detail rendered engagement source provenance card
- Production report detail rendered the Open engagement campaign navigation link
- Production backlink target matched the originating engagement campaign id
- Production backlink click navigated back to the originating engagement campaign detail page

## Notes
- This smoke used a dedicated QA auth user and created production QA records/workspace for continuity verification.
- Mutations were limited to QA project/campaign/item/report records needed for verification.
- This complements the earlier production engagement-to-report handoff smoke by proving reversible navigation from report detail back to engagement source.
