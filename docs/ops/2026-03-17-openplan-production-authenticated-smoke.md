# OpenPlan Production Authenticated Smoke — 2026-03-17

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-qa-2026-03-17T05-19-38-902Z@natfordplanning.com
- QA user id: unknown
- Workspace id: 559ba598-851d-4f14-b34f-917b38f9711a
- Project id: 2969a31f-2af1-4215-8ce3-78ea5443e13d
- Plan id: 53d5a90c-9556-426a-9294-b3d5b92c5fd1
- Model id: b0002065-1b88-4f61-b8ce-5bbf6007754c
- Program id: e139a4bb-d568-4dd7-896d-83d7c1ed1ec3

## Pass/Fail Notes
- PASS: Created QA auth user openplan-qa-2026-03-17T05-19-38-902Z@natfordplanning.com.
- PASS: Signed-out redirect continuity passed for /models → /sign-in?redirect=%2Fmodels.
- PASS: Signed-in user landed on live Models workspace surface after redirect.
- PASS: Created project/workspace via production API: QA Continuity Project 2026-03-17T05-19-38-902Z.
- PASS: Created plan QA Corridor Plan 2026-03-17T05-19-38-902Z.
- PASS: Created model QA Accessibility Model 2026-03-17T05-19-38-902Z.
- PASS: Created program QA RTIP Program 2026-03-17T05-19-38-902Z.
- PASS: Projects list loaded and showed the QA project.
- PASS: Models list loaded, showed the QA model, and accepted search input.
- PASS: Model detail loaded and showed linked plan continuity.
- PASS: Plan detail loaded and surfaced Supporting model basis with the linked model.
- PASS: Program detail loaded and surfaced model continuity inherited from linked plan/project context.
- PASS: Billing page loaded in an authenticated, provisioned state.

## Artifacts
- docs/ops/2026-03-17-test-output/2026-03-17-prod-auth-smoke-01-signed-out-redirect.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-auth-smoke-02-models-after-login.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-auth-smoke-03-projects-list.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-auth-smoke-04-models-list.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-auth-smoke-05-model-detail.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-auth-smoke-06-plan-detail.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-auth-smoke-07-program-detail.png
- docs/ops/2026-03-17-test-output/2026-03-17-prod-auth-smoke-08-billing.png

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
