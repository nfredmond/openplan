# OpenPlan Production RTP Release-Review Smoke — 2026-04-13

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-13T04-41-17-091Z@natfordplanning.com
- QA user id: unknown
- Workspace id: de922979-06d1-4ad4-9151-f455312d4f54
- RTP cycle id: 5a8e50e1-8f2b-4730-9726-4000de2dc9fe
- Project id: 195fcdf0-8e97-4b21-bdae-2dd7730626cd
- Plan id: b7ec5eea-1b88-43c0-9325-0e882e31dc6f
- Program id: fb887935-d3a8-4711-91bd-5ecab4a75f88
- Opportunity id: c16e6dac-99f4-410e-a1ca-045642484d78
- Award id: 704755e5-545d-43b2-a081-3c97de81498f
- Invoice id: ad28dd8b-35b3-440d-97cc-d4f56008e46a
- Report id: a3b73ef4-bf0d-4b1d-8a8c-c148cb97df6c

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-13T04-41-17-091Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 04-41-17.
- PASS: Current workspace resolved to the freshly bootstrapped workspace, so production proof stayed on the intended operator path.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-13.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 04-41-17 in the active workspace.
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

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
