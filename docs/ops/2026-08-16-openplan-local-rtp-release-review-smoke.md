# OpenPlan Local RTP Release-Review Smoke — 2026-08-16

## Local Targets
- App URL: http://localhost:3200
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local RTP release-review smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.

## Mutation Summary
- Created one local QA auth user, bootstrapped one local workspace, created one RTP cycle, created one board-packet report record, and generated one HTML report artifact.

## Cleanup / Idempotency Posture
- Local-only guard runs before service-role auth mutation and refuses Vercel, Supabase cloud, and arbitrary remote targets.
- This timestamped workflow smoke intentionally creates fresh local proof records on each run. It is safe to rerun against local Supabase, but old local QA users/workspaces/records remain until the local database is reset or cleaned manually.

## Key IDs
- QA user email: openplan-local-rtp-release-smoke-2026-08-16T00-12-12-086Z@natfordplanning.com
- QA user id: d40ede54-c069-486d-80eb-479ba0319b3a
- Workspace id: 76571629-a29d-4aab-a0ca-7901d775d832
- RTP cycle id: eb448b88-9514-403e-93a8-50065e2d0ccd
- Report id: 65e6027e-398b-4fc2-8b59-4e97698418e0

## Pass/Fail Notes
- PASS: Local guard passed for local RTP release-review smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-rtp-release-smoke-2026-08-16T00-12-12-086Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Bootstrapped workspace OpenPlan RTP Release Smoke 00-12-12.
- PASS: Created RTP cycle Nevada County RTP 2026-08-16.
- PASS: Created RTP board-packet record from the local API.
- PASS: Generated the first RTP packet artifact through the existing report generation route.
- PASS: RTP registry rendered the linked packet action for the generated current packet.
- PASS: The registry current-packet link landed on the packet release-review anchor in report detail.

## Artifacts
- 2026-08-16-local-rtp-release-review-01-registry.png
- 2026-08-16-local-rtp-release-review-02-report-detail.png

## Verdict
- PASS: Local rendered smoke confirms RTP cycle creation, board-packet creation, artifact generation, registry linked-packet navigation, and report release-review anchor landing.
