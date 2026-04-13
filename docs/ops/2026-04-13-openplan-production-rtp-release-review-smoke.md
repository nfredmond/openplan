# OpenPlan Production RTP Release-Review Smoke — 2026-04-13

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-13T05-02-09-658Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 48166f78-6a79-47fb-90ff-1d831ff28023
- RTP cycle id: b2adaa20-a1c3-4247-bda8-88da985fc73d
- Project id: e19e8404-c225-4132-b99b-64614e567b13
- Plan id: 6f591dfe-2829-4b77-a222-47f86d95add4
- Program id: 0a99f643-27e2-4f6a-a224-3713f2de9687
- Opportunity id: 81f521ce-69f5-4b79-825d-76597a98da6c
- Award id: 41a350ed-5486-4513-8fd8-f4e4960f30e3
- Invoice id: 5fb71b4c-3682-4189-91c9-49e58461a6db
- Report id: 49f4e89d-f051-4e3d-8451-b77023251fe7

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-13T05-02-09-658Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 05-02-09.
- PASS: Current workspace resolved to the freshly bootstrapped workspace, so production proof stayed on the intended operator path.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-13.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 05-02-09 in the active workspace.
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
- PASS: Created a second project report with a real packet artifact but a null report-row generated_at so the Projects registry must prefer latest artifact timing to keep packet posture honest.
- PASS: Projects registry preferred latest packet artifact timing over the stale report-row generated_at and kept the seeded artifact-backed report in refresh posture instead of degrading it to no-packet.
- PASS: Reports registry also preferred latest packet artifact timing over the stale report-row generated_at, keeping the seeded report in regenerate posture and routing to the drift anchor.

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
- 2026-04-13-prod-rtp-release-review-projects-registry.png
- 2026-04-13-prod-rtp-release-review-reports-registry-artifact.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
