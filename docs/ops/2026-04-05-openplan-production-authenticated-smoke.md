# OpenPlan Production Authenticated Smoke — 2026-04-05

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-qa-2026-04-05T00-48-50-442Z@natfordplanning.com
- QA user id: unknown
- Workspace id: d03afe17-52e7-4f72-87d8-08898fb30360
- Project id: e6802eb3-a5fa-474b-9898-d796c7eddae7
- Plan id: e419e785-217c-4e23-be53-b4ae1f18611c
- Model id: b3073aec-6bf1-49b4-bbe1-453b5bd8381b
- Program id: a8fb47d8-1018-45a9-aaaf-65bfa0ede2b6

## Pass/Fail Notes
- PASS: Loaded environment from /tmp/openplan-prod.env.
- PASS: Created QA auth user openplan-qa-2026-04-05T00-48-50-442Z@natfordplanning.com.
- PASS: Signed-out redirect continuity passed for /models → /sign-in?redirect=%2Fmodels.
- PASS: Signed-in user landed on live Models workspace surface after redirect.
- PASS: Created project/workspace via production API: QA Continuity Project 2026-04-05T00-48-50-442Z.
- PASS: Created plan QA Corridor Plan 2026-04-05T00-48-50-442Z.
- PASS: Created model QA Accessibility Model 2026-04-05T00-48-50-442Z.
- PASS: Created program QA RTIP Program 2026-04-05T00-48-50-442Z.
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
