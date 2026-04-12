# OpenPlan Production RTP Release-Review Smoke — 2026-04-12

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-12T06-11-33-321Z@natfordplanning.com
- QA user id: unknown
- Workspace id: b17e1ad1-8e0e-453a-86d8-81e40374d5ec
- RTP cycle id: b8036bd0-0fa7-4a62-be26-8d421e5701a3
- Report id: aab99549-6b77-4b7a-9a36-fdbca5a4fa15

## Environment Notes
- This proof run targeted `https://openplan-zeta.vercel.app` because the canonical alias `https://openplan-natford.vercel.app` is still behind Vercel protection in this environment and no bypass secret is currently present in the harness env.
- The shipped RTP behavior was still validated on a live production alias, but canonical-alias proof for this exact lane still requires the bypass-secret path to be restored.

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-12T06-11-33-321Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 06-11-33.
- PASS: Created production RTP cycle Production RTP Release Smoke 2026-04-12.
- PASS: Created RTP board-packet record from the production API.
- PASS: Generated the first RTP packet artifact on production through the existing report generation route.
- PASS: Production RTP registry rendered the release-review lane CTA and the row-level current-packet action.
- PASS: Production registry current-packet link landed on the packet release-review anchor in report detail.

## Artifacts
- 2026-04-12-prod-rtp-release-review-01-registry.png
- 2026-04-12-prod-rtp-release-review-02-report-detail.png

## Verdict
- PASS: Production rendered smoke confirms the RTP registry surfaces the release-review lane and current-packet review navigation onto the report release-review anchor.
