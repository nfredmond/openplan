# OpenPlan Production Engagement Smoke — 2026-03-17

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-engagement-qa-2026-03-17T06-55-20-394Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 1c20e430-bcd7-459d-9778-98630e5eae46
- Project id: e84c267f-11c2-436d-87e9-5e9bb38ba1b6
- Campaign id: 7a3bf4f9-de27-4544-b177-f887ec31cdbf

## Pass/Fail Notes
- PASS: Created QA auth user openplan-engagement-qa-2026-03-17T06-55-20-394Z@natfordplanning.com.
- PASS: Signed-out redirect continuity passed for /engagement → /sign-in?redirect=%2Fengagement.
- PASS: Signed-in user landed directly on the live Engagement catalog surface after redirect.
- PASS: Created project/workspace via production API: QA Engagement Project 2026-03-17T06-55-20-394Z.
- PASS: Created engagement campaign QA Downtown Safety Campaign 2026-03-17T06-55-20-394Z from the live catalog UI.
- PASS: Added category Safety 06-55-20 from the live detail UI and confirmed it appeared in the intake selector.
- PASS: Created intake item Unsafe crossing near school pickup 2026-03-17T06-55-20-394Z from the campaign detail UI.
- PASS: Registry search accepted query input and kept the created intake item visible.
- PASS: Moderation quick action updated the created intake item to approved from the live registry UI.
- PASS: Campaign controls saved active status and refreshed the detail surface without error.
- PASS: Engagement catalog listed the created campaign with linked project context after save/refresh.

## Artifacts
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-smoke-01-signed-out-redirect.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-smoke-02-engagement-catalog-after-login.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-smoke-03-campaign-detail.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-smoke-04-category-created.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-smoke-05-item-created.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-smoke-06-item-approved.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-smoke-07-campaign-active.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-engagement-smoke-08-catalog-list.png

## Coverage
- Signed-out redirect continuity for Engagement
- Sign-in return-path behavior into explicit workspace-required or live catalog state
- Workspace bootstrap / project creation via live authenticated session
- Engagement catalog create flow through the browser UI
- Campaign detail load with linked project traceability
- Category creation through the browser UI
- Intake item creation through the browser UI
- Registry search interaction
- Moderation quick-action approval through the browser UI
- Campaign metadata/status update through the browser UI
- Catalog refresh showing the created linked campaign

## Notes
- This smoke used a dedicated QA auth user and created production QA records/workspace for continuity verification.
- Mutations were limited to QA project/campaign/category/item records needed for verification.
- Follow-up cleanup/archival of QA records can be done later if desired.
