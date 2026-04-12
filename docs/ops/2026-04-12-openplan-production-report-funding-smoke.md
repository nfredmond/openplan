# OpenPlan Production Report Funding Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-report-funding-qa-2026-04-12T22-20-35-033Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 2a7beb5e-8485-4a33-bc28-479d9f05370a
- Project id: 60a57c52-0dd7-4854-97b4-503ccc3d2525
- Opportunity id: 3245b00a-87ab-4d1b-84c8-c29932334ed8
- Award id: 8e5538d9-ea31-4287-8a6f-33ac579d5c15
- Invoice id: 6780399f-ecfc-43df-b7c4-85fc5d9e06f9
- Report id: eb37181a-fd5e-47d9-808d-62c9613e9489

## Pass/Fail Notes
- PASS: Created QA auth user openplan-report-funding-qa-2026-04-12T22-20-35-033Z@natfordplanning.com.
- PASS: Signed into production successfully through the reports surface.
- PASS: Created QA project/workspace QA Report Funding Project 2026-04-12T22-20-35-033Z.
- PASS: Seeded project funding profile for report snapshot capture.
- PASS: Created pursued funding opportunity QA Funding Opportunity 2026-04-12T22-20-35-033Z.
- PASS: Created committed funding award QA Funding Award 2026-04-12T22-20-35-033Z.
- PASS: Created submitted reimbursement invoice QA-FUND-222035.
- PASS: Created report record QA Funding Snapshot Report 2026-04-12T22-20-35-033Z.
- PASS: Report detail exposed grants navigation back into /grants?focusProjectId=60a57c52-0dd7-4854-97b4-503ccc3d2525#grants-awards-reimbursement.
- PASS: Generated a live report artifact and verified the preview embeds funding posture at generation.
- PASS: Reports registry rendered the stored funding posture digest instead of the empty funding-snapshot fallback.
- PASS: Changed reimbursement posture after generation by marking the QA invoice paid.
- PASS: Report detail surfaced funding drift after live reimbursement posture changed post-generation.

## Artifacts
- docs/ops/2026-04-12-test-output/2026-04-12-prod-report-funding-01-detail-before-generate.png
- docs/ops/2026-04-12-test-output/2026-04-12-prod-report-funding-02-detail-generated.png
- docs/ops/2026-04-12-test-output/2026-04-12-prod-report-funding-03-reports-registry.png
- docs/ops/2026-04-12-test-output/2026-04-12-prod-report-funding-04-detail-drift.png

## Coverage
- Production report detail rendered funding posture and grants-lane navigation for a live project-backed report
- Production report generation embedded funding posture into the latest HTML artifact preview
- Production reports registry rendered the stored funding snapshot digest for the generated artifact
- Production report detail surfaced live funding drift after reimbursement posture changed post-generation

## Notes
- This smoke used a dedicated QA auth user and real production QA records/workspace for evidence-backed verification.
- Mutations were limited to QA funding profile, opportunity, award, invoice, and report records needed to prove the new Grants → Reports funding seam.
- Cleanup should be run after proof so the QA workspace and auth user do not remain in production.
