# OpenPlan Production RTP Release-Review Smoke — 2026-04-13

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-13T00-35-58-747Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 1af42926-b873-487f-8869-db05b6f97acc
- RTP cycle id: e8c66764-13c6-4d8a-829d-7a9c8e531acd
- Project id: 6123abbe-653b-44e4-ad9d-b35d6baeab42
- Opportunity id: d99df4c1-c910-4042-92ea-16d8929d3dfa
- Award id: 0dd86e13-baba-48c8-bfc6-cabc3bc5810f
- Invoice id: 712506e9-e3e7-4d85-83bb-c30e888bec05
- Report id: 3f9c211c-1bbd-4a46-9e73-627b82b95d47

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-13T00-35-58-747Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 00-35-58.
- PASS: Current workspace resolved to 1af42926-b873-487f-8869-db05b6f97acc instead of the freshly bootstrapped workspace 4f2347d1-34d9-457e-bcb7-218b26d2ca58; RTP smoke data was aligned to the active workspace selection.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-13.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 00-35-58 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Dashboard quick actions and shared command board copy both surfaced the RTP funding-backed release-review lane.
- PASS: Analysis Studio surfaced the shared RTP funding-review runtime cue and inherited the same command-board pressure while keeping the smoke project as the visible project context.
- PASS: Project detail surfaced the shared RTP funding-review runtime cue directly on the canonical project spine.
- PASS: Reports surface showed RTP funding-review queue pressure and the shared runtime cue pointed back to the RTP funding release-review packet before opening detail.
- PASS: Production RTP registry rendered the release-review lane CTA, the row-level current-packet action, and funding-backed release-review cues before opening the packet detail.
- PASS: Production registry current-packet link landed on the packet release-review anchor in report detail.
- PASS: Production RTP release review surfaced funding posture alongside chapter/workflow drift after reimbursement changed post-generation.

## Artifacts
- 2026-04-13-prod-rtp-release-review-dashboard.png
- 2026-04-13-prod-rtp-release-review-analysis-workspace.png
- 2026-04-13-prod-rtp-release-review-project-detail.png
- 2026-04-13-prod-rtp-release-review-02-reports-runtime-cue.png
- 2026-04-13-prod-rtp-release-review-01-registry.png
- 2026-04-13-prod-rtp-release-review-03-report-detail.png
- 2026-04-13-prod-rtp-release-review-04-funding-drift.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
