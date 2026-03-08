# OP-003 Closure Delta — Canonical Project-Create Template Binding (2026-03-07)

## Objective
Close the OP-003 residual PARTIAL criterion:
- "Minimum CA template pack present and selectable at project creation."

## What shipped
1. Added canonical project creation API route:
   - `openplan/src/app/api/projects/route.ts`
   - `POST /api/projects`
2. Route now binds stage-gate template at creation with canonical source:
   - `stage_gate_binding_source = project_create_v0_2`
3. Extended stage-gate template loader to support explicit binding mode selection:
   - `openplan/src/lib/stage-gates/template-loader.ts`
   - new mode: `project_create_v0_2`
4. Added/updated regression tests:
   - `openplan/src/test/projects-route.test.ts`
   - `openplan/src/test/stage-gate-template-loader.test.ts`

## Verification
- Targeted tests:
  - `npm run test -- src/test/projects-route.test.ts src/test/stage-gate-template-loader.test.ts` ✅
- Full gate:
  - `npm run qa:gate` ✅ (`24 files / 129 tests`, build PASS)
- Build output now includes:
  - `ƒ /api/projects`

## Resulting status impact
- OP-003 criterion for project-create template selection is now implemented on a canonical API path and evidenced by route + tests.
- Previous interim-only dependency on workspace bootstrap path is reduced.

## Residual note
- UI onboarding flow currently still calls `/api/workspaces/bootstrap`; migration of frontend project-creation UX to `/api/projects` remains a separate product-surface step.
