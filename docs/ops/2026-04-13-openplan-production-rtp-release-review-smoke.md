# OpenPlan Production RTP Release-Review Smoke — 2026-04-13

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-13T00-20-11-540Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 19172040-204e-4db1-ae81-2b2d096f4284
- RTP cycle id: 3200c155-6c52-4494-b0df-c19da6d4bd08
- Project id: 9b181f52-1a90-445f-95e4-d6d2d0b868e7
- Opportunity id: 816a1973-4702-4c9d-b181-b56ba1e36e86
- Award id: 3d0415a2-6164-4cef-a2a7-7ff6c54c9a71
- Invoice id: b34088cd-fc4e-4a58-9bc3-d4162cdefedd
- Report id: 3ba85a7f-039c-4fbb-b3e0-eab60f9544ad

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-13T00-20-11-540Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 00-20-11.
- PASS: Current workspace resolved to 19172040-204e-4db1-ae81-2b2d096f4284 instead of the freshly bootstrapped workspace 614d7951-3364-4ff4-b161-c3408485cad3; RTP smoke data was aligned to the active workspace selection.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-13.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 00-20-11 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Dashboard quick actions and shared command board copy both surfaced the RTP funding-backed release-review lane.
- PASS: Analysis Studio inherited the shared command-board RTP funding-review pressure while keeping the smoke project as the visible project context.
- PASS: Reports surface showed RTP funding-review queue pressure and the shared runtime cue pointed back to the RTP funding release-review packet before opening detail.
- PASS: Production RTP registry rendered the release-review lane CTA, the row-level current-packet action, and funding-backed release-review cues before opening the packet detail.
- PASS: Production registry current-packet link landed on the packet release-review anchor in report detail.
- PASS: Production RTP release review surfaced funding posture alongside chapter/workflow drift after reimbursement changed post-generation.

## Artifacts
- 2026-04-13-prod-rtp-release-review-dashboard.png
- 2026-04-13-prod-rtp-release-review-analysis-workspace.png
- 2026-04-13-prod-rtp-release-review-02-reports-runtime-cue.png
- 2026-04-13-prod-rtp-release-review-01-registry.png
- 2026-04-13-prod-rtp-release-review-03-report-detail.png
- 2026-04-13-prod-rtp-release-review-04-funding-drift.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
