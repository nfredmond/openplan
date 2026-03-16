# OpenPlan Production Authenticated Smoke — 2026-03-16

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-qa-2026-03-16T08-48-51-480Z@natfordplanning.com
- QA user id: unknown
- Workspace id: ac5ef3e5-25fa-4162-8cb1-d224e6ec4195
- Project id: 0cf98159-c350-4dc7-9320-f1a6bfd66e02
- Plan id: 893f8d5e-3814-4acc-94f8-0be65ed1c167
- Model id: bd2b78df-b340-40a5-b64a-7885d7a66df2
- Program id: bca6d484-dea2-404e-b711-48763eed9147

## Pass/Fail Notes
- PASS: Created QA auth user openplan-qa-2026-03-16T08-48-51-480Z@natfordplanning.com.
- PASS: Signed-out redirect continuity passed for /models → /sign-in?redirect=%2Fmodels.
- PASS: Signed-in user landed on live Models workspace surface after redirect.
- PASS: Created project/workspace via production API: QA Continuity Project 2026-03-16T08-48-51-480Z.
- PASS: Created plan QA Corridor Plan 2026-03-16T08-48-51-480Z.
- PASS: Created model QA Accessibility Model 2026-03-16T08-48-51-480Z.
- PASS: Created program QA RTIP Program 2026-03-16T08-48-51-480Z.
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
- See also: `docs/ops/2026-03-16-openplan-auth-proxy-closure-bundle.md` for the combined fix + evidence + harness trail.
