# OpenPlan Local Grants Flow Smoke — 2026-05-01

- Base URL: http://localhost:3000
- QA user email: openplan-local-grants-flow-2026-05-01T07-34-17-533Z@natfordplanning.com
- QA user id: 54da1a9b-9643-47e4-b570-aa99699cdc16
- Workspace id: 33234952-7bed-4ef3-bb28-033b1ef03107
- Project id: faa890ea-b9f9-488e-ac69-4c2fc5dd3efd
- Program id: fda6f09e-56dc-43d0-8ab2-ad15f8d7ebb4
- Opportunity id: e1463194-89b2-4ad1-a6b7-c7efff52fa02
- Award id: 607a0935-535b-400d-b90d-113fb3a956f3
- Invoice id: 69e88947-5757-40c4-a0cc-04ef272127de
- Obligation milestone id: 575cb0fe-6f30-48c1-846f-3d96e3d45b91
- Closeout milestone id: 38b28d3f-1879-470b-9329-b7a0d209ee29

## Pass/Fail Notes
- PASS: Created QA auth user openplan-local-grants-flow-2026-05-01T07-34-17-533Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Grants Flow Smoke 073417.
- PASS: Saved a project funding profile with a known need and local match.
- PASS: Created the funding program that owns the opportunity and award.
- PASS: Created an awarded funding opportunity linked to the project and program.
- PASS: Converted the awarded opportunity into a committed funding award.
- PASS: Verified the award write-back persisted funded RTP posture on the project.
- PASS: Verified the award emitted a scheduled obligation milestone.
- PASS: Created a paid, award-linked reimbursement invoice covering the full award.
- PASS: Closed out the award after 100% paid invoice coverage.
- PASS: Verified closeout persisted a complete closeout milestone.
- PASS: Verified closeout rebuilt project RTP posture with paid reimbursement status.

## Artifacts
- 2026-05-01-local-grants-flow-01-award-posture.png
- 2026-05-01-local-grants-flow-02-project-closeout.png

## Verdict
- PASS: Local rendered/API smoke confirms the Grants OS flow from project funding need to awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout reconciliation, closeout milestone, and project-detail funded/reimbursed posture.
