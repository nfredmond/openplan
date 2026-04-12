# OpenPlan Local RTP Release-Review Smoke — 2026-04-12

- Base URL: http://localhost:3000
- QA user email: openplan-local-rtp-release-smoke-2026-04-12T06-06-38-691Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 29d5ce9a-a5e6-466d-a68b-8c519bb9eb78
- RTP cycle id: 8f03ea76-4510-4033-a3b3-3d71a7ce1b00
- Report id: 2635bfb0-8be4-42f1-a947-48bf9560ab66

## Environment Notes
- Linked Supabase project was initially missing the April RTP/funding/scenario migration wave.
- Local smoke was blocked until the duplicate migration version collision was resolved by renaming `20260410000042_reports_metadata_json.sql` to `20260410000047_reports_metadata_json.sql` and then pushing the pending linked migrations.

## Pass/Fail Notes
- PASS: Created QA auth user openplan-local-rtp-release-smoke-2026-04-12T06-06-38-691Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Bootstrapped workspace OpenPlan RTP Release Smoke 06-06-38.
- PASS: Created RTP cycle Nevada County RTP 2026-04-12.
- PASS: Created RTP board-packet record from the local API.
- PASS: Generated the first RTP packet artifact through the existing report generation route.
- PASS: RTP registry rendered the release-review lane CTA and the row-level current-packet action.
- PASS: The registry current-packet link landed on the packet release-review anchor in report detail.

## Artifacts
- 2026-04-12-local-rtp-release-review-01-registry.png
- 2026-04-12-local-rtp-release-review-02-report-detail.png

## Verdict
- PASS: Local rendered smoke confirms the RTP registry now surfaces the release-review lane and current-packet review navigation onto the report release-review anchor.
