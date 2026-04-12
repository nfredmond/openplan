# OpenPlan Production RTP Release-Review Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-12T22-39-31-869Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 106b96d0-77a8-4278-be42-4f172b3e58ed
- RTP cycle id: 81584c30-38f8-413d-a704-e212f2ceb11e
- Project id: 3dd1bb9d-bf99-4463-ac2b-dab1a2405839
- Opportunity id: edb691d2-6b17-4f61-a777-0fd44d4944a7
- Award id: d86bc8ab-5c07-4ea7-8c2d-f69e32d4bc59
- Invoice id: aa22f977-5b19-4f30-9281-a136f2957441
- Report id: 909c9b36-1d0a-42d5-9716-75058e4fbe3b

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-12T22-39-31-869Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 22-39-31.
- PASS: Current workspace resolved to 106b96d0-77a8-4278-be42-4f172b3e58ed instead of the freshly bootstrapped workspace 22325592-7e92-4949-9e35-35d29b8ec5b3; RTP smoke data was aligned to the active workspace selection.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-12.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 22-39-31 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Production RTP registry rendered the release-review lane CTA and the row-level current-packet action.
- PASS: Production registry current-packet link landed on the packet release-review anchor in report detail.
- PASS: Production RTP release review surfaced funding posture alongside chapter/workflow drift after reimbursement changed post-generation.

## Artifacts
- 2026-04-12-prod-rtp-release-review-01-registry.png
- 2026-04-12-prod-rtp-release-review-02-report-detail.png
- 2026-04-12-prod-rtp-release-review-03-funding-drift.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
