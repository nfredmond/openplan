# OpenPlan Production RTP Release-Review Smoke — 2026-04-13

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-13T01-18-12-330Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 1116c25a-843d-4f80-92a7-3ee32dada976
- RTP cycle id: 26f84882-3f06-4ad6-bdd5-69a2a17d0343
- Project id: 66d6a41a-7fa2-4d3b-b9f3-6e590e2a74f3
- Plan id: 2cae4c0f-4fc8-41d5-85c0-1cf5ed1048af
- Program id: d49e095c-6ce5-42c8-b6cd-5c84ce6a200d
- Opportunity id: 136cbcd9-2760-4926-b0cf-4da56fa0b78e
- Award id: ac813e14-2d20-467d-829f-bc177d2ad02a
- Invoice id: 6a70fb5a-773e-4401-8218-f88585a83077
- Report id: ebeef55d-dfac-408d-96dc-f2e80a47257f

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-13T01-18-12-330Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 01-18-12.
- PASS: Current workspace resolved to the freshly bootstrapped workspace, so production proof stayed on the intended operator path.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-13.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 01-18-12 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Seeded linked plan and program records so detail-surface runtime cues can be proven on production.
- PASS: Dashboard quick actions and shared command board copy both surfaced the RTP funding-backed release-review lane.
- PASS: Analysis Studio surfaced the shared RTP funding-review runtime cue and inherited the same command-board pressure while keeping the smoke project as the visible project context.
- PASS: Project detail surfaced the shared RTP funding-review runtime cue directly on the canonical project spine.
- PASS: Plans registry inherited the shared RTP funding-review runtime cue from the central workspace loader.
- PASS: Plan detail surfaced the direct RTP funding-review runtime cue on the planning spine, not just the shared command board.
- PASS: Program detail surfaced the direct RTP funding-review runtime cue on the programming spine, not just the shared command board.
- PASS: Data Hub inherited the shared RTP funding-review runtime cue from the central workspace loader.
- PASS: Reports surface showed RTP funding-review queue pressure and the shared runtime cue pointed back to the RTP funding release-review packet before opening detail.
- PASS: Production RTP registry rendered the release-review lane CTA, the row-level current-packet action, and funding-backed release-review cues before opening the packet detail.
- PASS: Production registry current-packet link landed on the packet release-review anchor in report detail.
- PASS: Production RTP release review surfaced funding posture alongside chapter/workflow drift after reimbursement changed post-generation.

## Artifacts
- 2026-04-13-prod-rtp-release-review-dashboard.png
- 2026-04-13-prod-rtp-release-review-analysis-workspace.png
- 2026-04-13-prod-rtp-release-review-project-detail.png
- 2026-04-13-prod-rtp-release-review-plans.png
- 2026-04-13-prod-rtp-release-review-plan-detail.png
- 2026-04-13-prod-rtp-release-review-program-detail.png
- 2026-04-13-prod-rtp-release-review-data-hub.png
- 2026-04-13-prod-rtp-release-review-02-reports-runtime-cue.png
- 2026-04-13-prod-rtp-release-review-01-registry.png
- 2026-04-13-prod-rtp-release-review-03-report-detail.png
- 2026-04-13-prod-rtp-release-review-04-funding-drift.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
