# OpenPlan Detail/Admin Local Auth Check

Generated: 2026-04-30T08:01:30.614Z
Base URL: http://localhost:3000
Mutation posture: read-only browser navigation/screenshots only; no database, auth, Supabase cloud, production, email, billing, or credential writes.

## Result

- captured: 8

## Ledger

| Screenshot | Route URL | Final URL | Viewport | HTTP | Status | Expected text | Hard denial terms | Classifier finding | Notes |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| docs/ops/2026-04-29-test-output/ui-ux-settle-detail-admin-check/project-detail--desktop--detail-auth-check.png | /projects/d0000001-0000-4000-8000-000000000003 | /projects/d0000001-0000-4000-8000-000000000003 | 1440x1100 | 200 | captured | NCTC 2045 RTP; proof-of-capability | no | likely required-word false positive | Original capture classifier likely overmatched ordinary "required" copy; hard denial terms absent and expected target text present. |
| docs/ops/2026-04-29-test-output/ui-ux-settle-detail-admin-check/county-run-detail--desktop--detail-auth-check.png | /county-runs/d0000001-0000-4000-8000-000000000005 | /county-runs/d0000001-0000-4000-8000-000000000005 | 1440x1100 | 200 | captured | nevada-county-runtime-norenumber-freeze-20260324; County run | no | likely required-word false positive | Original capture classifier likely overmatched ordinary "required" copy; hard denial terms absent and expected target text present. |
| docs/ops/2026-04-29-test-output/ui-ux-settle-detail-admin-check/rtp-detail--desktop--detail-auth-check.png | /rtp/d0000001-0000-4000-8000-000000000004 | /rtp/d0000001-0000-4000-8000-000000000004 | 1440x1100 | 200 | captured | NCTC 2045 RTP; demo cycle | no | likely required-word false positive | Original capture classifier likely overmatched ordinary "required" copy; hard denial terms absent and expected target text present. |
| docs/ops/2026-04-29-test-output/ui-ux-settle-detail-admin-check/admin-index--desktop--detail-auth-check.png | /admin | /admin | 1440x1100 | 200 | captured | Admin; Readiness | no | - | Captured authenticated local detail/admin state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle-detail-admin-check/project-detail--mobile--detail-auth-check.png | /projects/d0000001-0000-4000-8000-000000000003 | /projects/d0000001-0000-4000-8000-000000000003 | 390x844 | 200 | captured | NCTC 2045 RTP; proof-of-capability | no | likely required-word false positive | Original capture classifier likely overmatched ordinary "required" copy; hard denial terms absent and expected target text present. |
| docs/ops/2026-04-29-test-output/ui-ux-settle-detail-admin-check/county-run-detail--mobile--detail-auth-check.png | /county-runs/d0000001-0000-4000-8000-000000000005 | /county-runs/d0000001-0000-4000-8000-000000000005 | 390x844 | 200 | captured | nevada-county-runtime-norenumber-freeze-20260324; County run | no | likely required-word false positive | Original capture classifier likely overmatched ordinary "required" copy; hard denial terms absent and expected target text present. |
| docs/ops/2026-04-29-test-output/ui-ux-settle-detail-admin-check/rtp-detail--mobile--detail-auth-check.png | /rtp/d0000001-0000-4000-8000-000000000004 | /rtp/d0000001-0000-4000-8000-000000000004 | 390x844 | 200 | captured | NCTC 2045 RTP; demo cycle | no | likely required-word false positive | Original capture classifier likely overmatched ordinary "required" copy; hard denial terms absent and expected target text present. |
| docs/ops/2026-04-29-test-output/ui-ux-settle-detail-admin-check/admin-index--mobile--detail-auth-check.png | /admin | /admin | 390x844 | 200 | captured | Admin; Readiness | no | - | Captured authenticated local detail/admin state. |

## Interpretation

- This check intentionally excludes the broad `required` term from hard-denial classification; the main capture harness has now been narrowed the same way so ordinary readiness copy does not block proof capture.
- Rows marked `captured` here have expected target text present under the same local storage state and no hard denial language.
- These screenshots can be folded into the main proof pack, and the next full capture should classify these routes as `captured` if the same local storage state and demo IDs are available.
