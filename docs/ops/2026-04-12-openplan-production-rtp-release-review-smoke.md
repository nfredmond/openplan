# OpenPlan Production RTP Release-Review Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-12T23-45-24-830Z@natfordplanning.com
- QA user id: unknown
- Workspace id: d68d3fd0-8ab5-456f-ab73-dab0b279b86f
- RTP cycle id: 99f30b2a-3951-4b46-b358-1d26928a8d78
- Project id: 0568450a-5625-422c-8f05-9a5e0786f793
- Opportunity id: 4aecfdcf-1f38-47e1-99cc-84c1a3a45d6f
- Award id: fadb0d1e-9144-4074-a539-57ac5a90ed52
- Invoice id: e43ee06d-fa71-4fb8-8fd5-5b60831b66d4
- Report id: 6af74bc6-beaa-4c79-a7c7-fbe1fb28bd27

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-12T23-45-24-830Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 23-45-24.
- PASS: Current workspace resolved to d68d3fd0-8ab5-456f-ab73-dab0b279b86f instead of the freshly bootstrapped workspace 25028390-a31a-4f19-b8e8-6b3dee82261c; RTP smoke data was aligned to the active workspace selection.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-12.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 23-45-24 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Dashboard quick actions and shared command board both surfaced the RTP funding-backed release-review lane.
- PASS: Shared runtime reports cue pointed back to the RTP funding release-review packet before opening detail.
- PASS: Production RTP registry rendered the release-review lane CTA, the row-level current-packet action, and funding-backed release-review cues before opening the packet detail.
- PASS: Production registry current-packet link landed on the packet release-review anchor in report detail.
- PASS: Production RTP release review surfaced funding posture alongside chapter/workflow drift after reimbursement changed post-generation.

## Artifacts
- 2026-04-12-prod-rtp-release-review-dashboard.png
- 2026-04-12-prod-rtp-release-review-02-reports-runtime-cue.png
- 2026-04-12-prod-rtp-release-review-01-registry.png
- 2026-04-12-prod-rtp-release-review-03-report-detail.png
- 2026-04-12-prod-rtp-release-review-04-funding-drift.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
