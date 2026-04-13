# OpenPlan Production RTP Release-Review Smoke — 2026-04-13

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-13T01-51-22-542Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 734b2de6-ec21-44cf-9bb9-f34ec8a87fe0
- RTP cycle id: 5f456d65-b4e6-4d72-a36a-c8a6d4b88838
- Project id: c91b377b-8284-47ab-806a-acd9b2a919c1
- Plan id: b83e0e50-625c-4d0b-aa27-cb7bf6d7e8fa
- Program id: 2a69a43f-bc23-4763-a7e5-90a93e2c8850
- Opportunity id: d5030494-8a1a-49a7-8289-ce3aa22ef1a8
- Award id: 0775d0fe-87bd-41a9-9bb7-44c62008b934
- Invoice id: ec8faa20-d254-46e1-9544-9f43fb2c4d8d
- Report id: 16630b7e-7f76-4db0-b203-e84549e87364

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-13T01-51-22-542Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 01-51-22.
- PASS: Current workspace resolved to the freshly bootstrapped workspace, so production proof stayed on the intended operator path.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-13.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 01-51-22 in the active workspace.
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
