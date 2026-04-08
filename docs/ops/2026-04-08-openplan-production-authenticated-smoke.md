# OpenPlan Production Authenticated Smoke — 2026-04-08

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-qa-2026-04-08T04-35-03-328Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 76c51dfa-6490-4b81-9e68-b1ac4e06b858
- Project id: 12cd66d2-8d82-4285-a064-33260fb90e13
- Plan id: 346b92e0-bf45-4a29-841d-14e551f871d5
- Model id: e974cb25-a168-46ef-b69b-da208a410cc5
- Program id: b0978af4-ec66-4e70-a2f4-1f037b9b5d59

## Pass/Fail Notes
- PASS: Loaded environment from /home/narford/.openclaw/workspace/openplan/openplan/.env.local.
- PASS: Created QA auth user openplan-qa-2026-04-08T04-35-03-328Z@natfordplanning.com.
- PASS: Signed-out redirect continuity passed for /models → /sign-in?redirect=%2Fmodels.
- PASS: Signed-in user landed on live Models workspace surface after redirect.
- PASS: Created project/workspace via production API: QA Continuity Project 2026-04-08T04-35-03-328Z.
- PASS: Created plan QA Corridor Plan 2026-04-08T04-35-03-328Z.
- PASS: Created model QA Accessibility Model 2026-04-08T04-35-03-328Z.
- PASS: Created program QA RTIP Program 2026-04-08T04-35-03-328Z.
- PASS: Projects list loaded and showed the QA project.
- PASS: Models list loaded, showed the QA model, and accepted search input.
- PASS: Model detail loaded and showed linked plan continuity.
- PASS: Plan detail loaded and surfaced Supporting model basis with the linked model.
- PASS: Program detail loaded and surfaced model continuity inherited from linked plan/project context.
- PASS: Billing page loaded in an authenticated, provisioned state.

## Artifacts
- docs/ops/2026-04-08-test-output/2026-04-08-prod-auth-smoke-01-signed-out-redirect.png
- docs/ops/2026-04-08-test-output/2026-04-08-prod-auth-smoke-02-models-after-login.png
- docs/ops/2026-04-08-test-output/2026-04-08-prod-auth-smoke-03-projects-list.png
- docs/ops/2026-04-08-test-output/2026-04-08-prod-auth-smoke-04-models-list.png
- docs/ops/2026-04-08-test-output/2026-04-08-prod-auth-smoke-05-model-detail.png
- docs/ops/2026-04-08-test-output/2026-04-08-prod-auth-smoke-06-plan-detail.png
- docs/ops/2026-04-08-test-output/2026-04-08-prod-auth-smoke-07-program-detail.png
- docs/ops/2026-04-08-test-output/2026-04-08-prod-auth-smoke-08-billing.png

## Coverage
- Signed-out redirect continuity
- Sign-in return-path behavior
- Signed-in unprovisioned UX
- Authenticated project creation via production API/session
- Project → Plan → Model → Program continuity on deployed production routes
- Billing page authenticated load

## Notes
- This smoke used a dedicated QA auth user and created production QA records/workspace for continuity verification.
- No destructive mutations were performed beyond creating QA data needed for verification.
- Follow-up cleanup/archival of QA records can be done later if desired.
