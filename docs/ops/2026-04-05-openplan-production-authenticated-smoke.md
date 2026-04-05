# OpenPlan Production Authenticated Smoke — 2026-04-05

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-qa-2026-04-05T03-48-46-630Z@natfordplanning.com
- QA user id: unknown
- Workspace id: bc338ddd-111e-4c15-a423-d5fd8e896cfd
- Project id: 20345ece-96e3-4360-a6bc-1cc93ac399eb
- Plan id: 7e55d335-292c-4f95-ac44-5df079b3eadc
- Model id: 5b001ef6-299b-416f-a4e0-cb661efd386c
- Program id: 9d08f2c1-dc82-4a87-9444-2a5ab3d4065d

## Pass/Fail Notes
- PASS: Loaded environment from /tmp/openplan-prod.env.
- PASS: Created QA auth user openplan-qa-2026-04-05T03-48-46-630Z@natfordplanning.com.
- PASS: Signed-out redirect continuity passed for /models → /sign-in?redirect=%2Fmodels.
- PASS: Signed-in user landed on live Models workspace surface after redirect.
- PASS: Created project/workspace via production API: QA Continuity Project 2026-04-05T03-48-46-630Z.
- PASS: Created plan QA Corridor Plan 2026-04-05T03-48-46-630Z.
- PASS: Created model QA Accessibility Model 2026-04-05T03-48-46-630Z.
- PASS: Created program QA RTIP Program 2026-04-05T03-48-46-630Z.
- PASS: Projects list loaded and showed the QA project.
- PASS: Models list loaded, showed the QA model, and accepted search input.
- PASS: Model detail loaded and showed linked plan continuity.
- PASS: Plan detail loaded and surfaced Supporting model basis with the linked model.
- PASS: Program detail loaded and surfaced model continuity inherited from linked plan/project context.
- PASS: Billing page loaded in an authenticated, provisioned state.

## Artifacts
- docs/ops/2026-04-05-test-output/2026-04-05-prod-auth-smoke-01-signed-out-redirect.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-auth-smoke-02-models-after-login.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-auth-smoke-03-projects-list.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-auth-smoke-04-models-list.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-auth-smoke-05-model-detail.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-auth-smoke-06-plan-detail.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-auth-smoke-07-program-detail.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-auth-smoke-08-billing.png

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
- QA production records and auth identities created during this pass were subsequently cleaned up; see `docs/ops/2026-04-05-openplan-production-qa-cleanup.md`.
- This rerun was executed against the functioning `natford/openplan` production deployment after `openplan-zeta.vercel.app` was restored to that lane.
