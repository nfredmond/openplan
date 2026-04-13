# OpenPlan Production RTP Release-Review Smoke — 2026-04-13

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-13T00-25-37-626Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 26d07114-8b35-4b97-bfc0-0842733c1dd4
- RTP cycle id: 47f997e4-f55d-4408-ad93-3aa8bf4ee7c0
- Project id: bd3f8f23-cfd2-4d36-a691-b8be84a1ab96
- Opportunity id: 1d1b2456-cf0f-41fa-826c-5b8e6bf48b39
- Award id: 0404d2a8-a619-4ed6-a9c8-c0e8e307f560
- Invoice id: 1786291c-6ac5-4661-a2b0-9c09ef066cda
- Report id: ebcafc5b-12b6-435f-bef5-607b4888c08c

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-13T00-25-37-626Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 00-25-37.
- PASS: Current workspace resolved to 26d07114-8b35-4b97-bfc0-0842733c1dd4 instead of the freshly bootstrapped workspace e496b284-ebd1-4c15-be5f-847ec79df706; RTP smoke data was aligned to the active workspace selection.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-13.
- PASS: Seeded linked RTP project RTP Funding Smoke Project 00-25-37 in the active workspace.
- PASS: Linked the smoke project into the RTP cycle portfolio.
- PASS: Seeded funding profile, opportunity, award, and reimbursement packet for the linked RTP project.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Dashboard quick actions and shared command board copy both surfaced the RTP funding-backed release-review lane.
- PASS: Analysis Studio surfaced the shared RTP funding-review runtime cue and inherited the same command-board pressure while keeping the smoke project as the visible project context.
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
