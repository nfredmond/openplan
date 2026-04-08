# OpenPlan Production Authenticated Smoke — 2026-04-07

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-qa-2026-04-07T03-52-02-697Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 8fe97961-9240-45f2-9661-fd84d69f65c4
- Project id: d58f9aee-d6f2-4172-a890-d35fd47c07ff
- Plan id: 98a9057e-2221-4bde-9cd7-6eadd094ac5b
- Model id: d4ce36c7-c891-4b55-9e3b-844b8bb586b6
- Program id: ac73d87a-5098-4271-88b5-bff3cb3af787

## Pass/Fail Notes
- PASS: Loaded environment from /tmp/openplan.smoke.env.
- PASS: Created QA auth user openplan-qa-2026-04-07T03-52-02-697Z@natfordplanning.com.
- PASS: Signed-out redirect continuity passed for /models → /sign-in?redirect=%2Fmodels.
- PASS: Signed-in user landed on live Models workspace surface after redirect.
- PASS: Created project/workspace via production API: QA Continuity Project 2026-04-07T03-52-02-697Z.
- PASS: Created plan QA Corridor Plan 2026-04-07T03-52-02-697Z.
- PASS: Created model QA Accessibility Model 2026-04-07T03-52-02-697Z.
- PASS: Created program QA RTIP Program 2026-04-07T03-52-02-697Z.
- PASS: Projects list loaded and showed the QA project.
- PASS: Models list loaded, showed the QA model, and accepted search input.
- PASS: Model detail loaded and showed linked plan continuity.
- PASS: Plan detail loaded and surfaced Supporting model basis with the linked model.
- PASS: Program detail loaded and surfaced model continuity inherited from linked plan/project context.
- PASS: Billing page loaded in an authenticated, provisioned state.

## Artifacts
- docs/ops/2026-04-07-test-output/2026-04-07-prod-auth-smoke-01-signed-out-redirect.png
- docs/ops/2026-04-07-test-output/2026-04-07-prod-auth-smoke-02-models-after-login.png
- docs/ops/2026-04-07-test-output/2026-04-07-prod-auth-smoke-03-projects-list.png
- docs/ops/2026-04-07-test-output/2026-04-07-prod-auth-smoke-04-models-list.png
- docs/ops/2026-04-07-test-output/2026-04-07-prod-auth-smoke-05-model-detail.png
- docs/ops/2026-04-07-test-output/2026-04-07-prod-auth-smoke-06-plan-detail.png
- docs/ops/2026-04-07-test-output/2026-04-07-prod-auth-smoke-07-program-detail.png
- docs/ops/2026-04-07-test-output/2026-04-07-prod-auth-smoke-08-billing.png

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
