# OpenPlan Production RTP Release-Review Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-12T23-32-52-656Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 1088462f-4536-4d8e-8180-df44e4e82065
- RTP cycle id: 4fb9183f-f320-480a-9fd9-f157e773a4aa
- Project id: 49f45685-9238-4603-8eee-2055d04b51f5
- Opportunity id: 16a6052d-4533-42ee-80c7-c30b1df7b11c
- Award id: c90ed113-4e96-4504-901f-330249afef53
- Invoice id: bd712847-9d39-426a-9db1-e95e93fea1ce
- Report id: f701e93a-3ea7-452e-b133-06a0d4c2a6b7

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-12T23-32-52-656Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 23-32-52.
- PASS: Current workspace resolved to 1088462f-4536-4d8e-8180-df44e4e82065 instead of the freshly bootstrapped workspace ca0f8249-1661-4250-9bae-074884620549; RTP smoke data was aligned to the active workspace selection.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-12.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 23-32-52 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Shared runtime reports cue pointed back to the RTP funding release-review packet before opening detail.
- PASS: Production RTP registry rendered the release-review lane CTA, the row-level current-packet action, and funding-backed release-review cues before opening the packet detail.
- PASS: Production registry current-packet link landed on the packet release-review anchor in report detail.
- PASS: Production RTP release review surfaced funding posture alongside chapter/workflow drift after reimbursement changed post-generation.

## Artifacts
- 2026-04-12-prod-rtp-release-review-02-reports-runtime-cue.png
- 2026-04-12-prod-rtp-release-review-01-registry.png
- 2026-04-12-prod-rtp-release-review-03-report-detail.png
- 2026-04-12-prod-rtp-release-review-04-funding-drift.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
