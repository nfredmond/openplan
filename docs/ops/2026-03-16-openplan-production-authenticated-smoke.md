# OpenPlan Production Authenticated Smoke — 2026-03-16

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-qa-2026-03-16T21-15-44-929Z@natfordplanning.com
- QA user id: unknown
- Workspace id: b2f70e11-84c1-4a97-80d5-2fcfb898138c
- Project id: 4db4c2d3-c556-4887-8efc-148494c1f5f6
- Plan id: a59eaf3e-f45e-4bf2-9b39-325788851943
- Model id: 8669a855-520e-4b5a-9730-906da866d886
- Program id: de7d7d2d-43f7-45e4-b76f-0f4927a4e392

## Pass/Fail Notes
- PASS: Created QA auth user openplan-qa-2026-03-16T21-15-44-929Z@natfordplanning.com.
- PASS: Signed-out redirect continuity passed for /models → /sign-in?redirect=%2Fmodels.
- PASS: Signed-in user landed on live Models workspace surface after redirect.
- PASS: Created project/workspace via production API: QA Continuity Project 2026-03-16T21-15-44-929Z.
- PASS: Created plan QA Corridor Plan 2026-03-16T21-15-44-929Z.
- PASS: Created model QA Accessibility Model 2026-03-16T21-15-44-929Z.
- PASS: Created program QA RTIP Program 2026-03-16T21-15-44-929Z.
- PASS: Projects list loaded and showed the QA project.
- PASS: Models list loaded, showed the QA model, and accepted search input.
- PASS: Model detail loaded and showed linked plan continuity.
- PASS: Plan detail loaded and surfaced Supporting model basis with the linked model.
- PASS: Program detail loaded and surfaced model continuity inherited from linked plan/project context.
- PASS: Billing page loaded in an authenticated, provisioned state.

## Artifacts
- docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-01-signed-out-redirect.png
- docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-02-models-after-login.png
- docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-03-projects-list.png
- docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-04-models-list.png
- docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-05-model-detail.png
- docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-06-plan-detail.png
- docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-07-program-detail.png
- docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-08-billing.png

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
