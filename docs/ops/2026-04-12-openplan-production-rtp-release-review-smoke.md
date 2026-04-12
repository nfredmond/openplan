# OpenPlan Production RTP Release-Review Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-12T23-50-59-050Z@natfordplanning.com
- QA user id: unknown
- Workspace id: b021fd75-1f24-47a0-a75a-c262239801fa
- RTP cycle id: 043f455f-8249-474c-9f69-9115a1f2cee7
- Project id: 0908adbf-2a3c-495f-be8f-2556b6958715
- Opportunity id: 24e0946d-7174-4ee2-93c2-29a1e01a8406
- Award id: 818c9503-3631-4547-8e32-bdf0c2ab0ba3
- Invoice id: 9d343d78-aefd-494c-82da-c9ea14bfd11b
- Report id: 498c34de-8c26-44e5-9c72-e200916abd58

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-12T23-50-59-050Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 23-50-59.
- PASS: Current workspace resolved to b021fd75-1f24-47a0-a75a-c262239801fa instead of the freshly bootstrapped workspace 4dc1241b-b2af-424f-89a8-24b91feb8357; RTP smoke data was aligned to the active workspace selection.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-12.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 23-50-59 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Dashboard quick actions and shared command board copy both surfaced the RTP funding-backed release-review lane.
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
