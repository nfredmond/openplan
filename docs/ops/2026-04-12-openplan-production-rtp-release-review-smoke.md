# OpenPlan Production RTP Release-Review Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-12T22-58-43-892Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 87be55b3-8029-4d25-8f0c-60786f5632b1
- RTP cycle id: f8baba14-30fc-4663-82a8-4aec70c056df
- Project id: 8d533f15-b125-4282-aed7-1ef83943148c
- Opportunity id: 9c14fae1-74f0-416e-9e20-02a9e91c0314
- Award id: 1dea891b-7c90-4719-a061-571380c6fcce
- Invoice id: 3646559f-bfe9-4154-9083-f9917d07b95d
- Report id: 0687e1cd-6078-45c8-88cd-d0f60825596f

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-12T22-58-43-892Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 22-58-43.
- PASS: Current workspace resolved to 87be55b3-8029-4d25-8f0c-60786f5632b1 instead of the freshly bootstrapped workspace f92b12ea-1de1-4b44-bdf5-15ccbe26f759; RTP smoke data was aligned to the active workspace selection.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-12.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 22-58-43 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Production RTP registry rendered the release-review lane CTA, the row-level current-packet action, and funding-backed release-review cues before opening the packet detail.
- PASS: Production registry current-packet link landed on the packet release-review anchor in report detail.
- PASS: Production RTP release review surfaced funding posture alongside chapter/workflow drift after reimbursement changed post-generation.

## Artifacts
- 2026-04-12-prod-rtp-release-review-01-registry.png
- 2026-04-12-prod-rtp-release-review-02-report-detail.png
- 2026-04-12-prod-rtp-release-review-03-funding-drift.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
