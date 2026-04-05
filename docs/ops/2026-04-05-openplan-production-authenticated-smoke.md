# OpenPlan Production Authenticated Smoke — 2026-04-05

- Base URL: https://openplan-natford.vercel.app
- QA user email: openplan-qa-2026-04-05T04-48-09-371Z@natfordplanning.com
- QA user id: unknown
- Workspace id: d11ef7e4-3d4b-4d36-b048-0958f173f46c
- Project id: d880d83f-05f9-4df8-80c5-8f95d39c85c3
- Plan id: e69d4c5b-80ff-4590-b859-7616b3a220b8
- Model id: f1d94fa3-c8eb-48f3-8f32-4f5cb51953ca
- Program id: ade4760b-606c-4f84-9726-9f37a3fd5e73

## Pass/Fail Notes
- PASS: Loaded environment from /tmp/openplan-prod.env.
- PASS: Created QA auth user openplan-qa-2026-04-05T04-48-09-371Z@natfordplanning.com.
- PASS: Signed-out redirect continuity passed for /models → /sign-in?redirect=%2Fmodels.
- PASS: Signed-in user landed on live Models workspace surface after redirect.
- PASS: Created project/workspace via production API: QA Continuity Project 2026-04-05T04-48-09-371Z.
- PASS: Created plan QA Corridor Plan 2026-04-05T04-48-09-371Z.
- PASS: Created model QA Accessibility Model 2026-04-05T04-48-09-371Z.
- PASS: Created program QA RTIP Program 2026-04-05T04-48-09-371Z.
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
- This pass intentionally used the canonical Nat Ford production alias `openplan-natford.vercel.app` as the active tooling default.
