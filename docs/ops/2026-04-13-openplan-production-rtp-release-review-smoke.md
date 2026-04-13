# OpenPlan Production RTP Release-Review Smoke — 2026-04-13

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-13T00-47-17-791Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 6972025e-b56e-4fd8-84db-7c5037e95d61
- RTP cycle id: d5cc173d-05f9-4a43-800a-477e5b08f8d3
- Project id: 1a1301fb-d94d-4f94-927f-a838858d5fbc
- Opportunity id: aead3a5c-3e5d-49ff-9338-96359f15f051
- Award id: e649fe46-e671-41c2-ae11-5568718b9477
- Invoice id: 493548e3-f432-4bc6-8e7b-8f139596f94e
- Report id: 95846d55-ca33-45a9-a563-7e3b0d3b1faa

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-13T00-47-17-791Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 00-47-17.
- PASS: Current workspace resolved to 6972025e-b56e-4fd8-84db-7c5037e95d61 instead of the freshly bootstrapped workspace 31fdcb2c-0db1-4671-8156-f05acb6cfc4c; RTP smoke data was aligned to the active workspace selection.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-13.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 00-47-17 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Dashboard quick actions and shared command board copy both surfaced the RTP funding-backed release-review lane.
- PASS: Analysis Studio surfaced the shared RTP funding-review runtime cue and inherited the same command-board pressure while keeping the smoke project as the visible project context.
- PASS: Project detail surfaced the shared RTP funding-review runtime cue directly on the canonical project spine.
- PASS: Plans registry inherited the shared RTP funding-review runtime cue from the central workspace loader.
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
- 2026-04-13-prod-rtp-release-review-data-hub.png
- 2026-04-13-prod-rtp-release-review-02-reports-runtime-cue.png
- 2026-04-13-prod-rtp-release-review-01-registry.png
- 2026-04-13-prod-rtp-release-review-03-report-detail.png
- 2026-04-13-prod-rtp-release-review-04-funding-drift.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane, shows RTP funding posture inside release review, and updates drift when linked-project reimbursement posture changes after generation.
