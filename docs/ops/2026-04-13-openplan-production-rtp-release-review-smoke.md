# OpenPlan Production RTP Release-Review Smoke — 2026-04-13

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-13T00-16-18-070Z@natfordplanning.com
- QA user id: unknown
- Workspace id: deded42e-ce97-42bb-a445-87d8e93f9a2c
- RTP cycle id: ef9d027c-5067-4e5f-bd95-9da7d747dd2a
- Project id: 89db3e89-5ad4-466e-8ab6-b9f11f88d91a
- Opportunity id: 2fda4a0f-0e78-41e1-b661-310c1dfd010c
- Award id: cdcb1d26-4d09-417d-8d2d-8e211e31f49a
- Invoice id: ed7a1c4e-c5b6-4b05-8ac1-89862c99ecb4
- Report id: 665733f5-14c5-4937-a1ec-6b49f0e61856

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-13T00-16-18-070Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 00-16-18.
- PASS: Current workspace resolved to deded42e-ce97-42bb-a445-87d8e93f9a2c instead of the freshly bootstrapped workspace 8b8a9c53-6859-4a81-ba77-a4f907dbeab8; RTP smoke data was aligned to the active workspace selection.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-13.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 00-16-18 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Dashboard quick actions and shared command board copy both surfaced the RTP funding-backed release-review lane.
- PASS: Reports surface showed RTP funding-review queue pressure and the shared runtime cue pointed back to the RTP funding release-review packet before opening detail.
- PASS: Production RTP registry rendered the release-review lane CTA, the row-level current-packet action, and funding-backed release-review cues before opening the packet detail.
- PASS: Production registry current-packet link landed on the packet release-review anchor in report detail.
- PASS: Production RTP release review surfaced funding posture alongside chapter/workflow drift after reimbursement changed post-generation.

## Artifacts
- 2026-04-13-prod-rtp-release-review-dashboard.png
- 2026-04-13-prod-rtp-release-review-02-reports-runtime-cue.png
- 2026-04-13-prod-rtp-release-review-01-registry.png
- 2026-04-13-prod-rtp-release-review-03-report-detail.png
- 2026-04-13-prod-rtp-release-review-04-funding-drift.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
