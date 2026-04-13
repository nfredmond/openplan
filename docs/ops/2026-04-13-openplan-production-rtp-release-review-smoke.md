# OpenPlan Production RTP Release-Review Smoke — 2026-04-13

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-13T01-28-59-562Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 3943d6ed-ed36-4e5a-a6a8-0716475aeb2f
- RTP cycle id: ff3f25aa-10af-42fc-b110-0ff8c62cbb35
- Project id: 4b2141d7-61c5-4a54-917c-20f8d7059c76
- Plan id: c39d9dc1-65af-4c7f-b05b-f435bb32070c
- Program id: 45359f24-e740-4f38-ac91-c46386a366b9
- Opportunity id: 886bb8b8-ff3a-408a-bcfb-2418521c9fc1
- Award id: 3aae8a40-3636-451e-afcc-3370fa305add
- Invoice id: 9458d846-2651-48c2-a823-8c8f62226caa
- Report id: 2f5a5e1c-d6e1-4cc8-9c23-1ad4cee40dfa

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-13T01-28-59-562Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 01-28-59.
- PASS: Current workspace resolved to the freshly bootstrapped workspace, so production proof stayed on the intended operator path.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-13.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 01-28-59 in the active workspace.
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
