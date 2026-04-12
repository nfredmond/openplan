# OpenPlan Production RTP Release-Review Smoke — 2026-04-12

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-prod-rtp-release-smoke-2026-04-12T06-19-58-464Z@natfordplanning.com
- QA user id: unknown
- Workspace id: cf5eaabe-36fe-4f3e-9db4-2466806323f4
- RTP cycle id: a21a4098-2d92-4948-970b-b4e7524a9fca
- Report id: 78b664aa-487a-4e07-aec2-a5646b41d799

## Environment Notes
- This proof run used the canonical alias `https://openplan-natford.vercel.app` successfully.
- The QA harness auto-loaded `OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET` from the secure local file `secrets/openplan_vercel_protection_bypass.env`, so no app env-file copy was required.
- This closes the earlier fallback-only posture where RTP proof had to run against `openplan-zeta.vercel.app` because the canonical alias bypass path was not present in the harness environment.

## Pass/Fail Notes
- PASS: Created QA auth user openplan-prod-rtp-release-smoke-2026-04-12T06-19-58-464Z@natfordplanning.com.
- PASS: Signed into production successfully.
- PASS: Bootstrapped workspace OpenPlan Prod RTP Release Smoke 06-19-58.
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
