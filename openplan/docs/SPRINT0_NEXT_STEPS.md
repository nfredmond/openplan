# Sprint 0 Next Steps (10-Day Execution Checklist)

## Objective
Create concrete momentum toward a sellable OpenPlan MVP for transportation planning teams.

## Day-by-Day Checklist

1. **Day 1: Route shell and IA lock**
- Checklist:
  - [ ] Finalize public/auth/workspace route map and navigation labels.
  - [ ] Confirm root layout and top nav behavior on desktop/mobile.
- Acceptance criteria:
  - Routes load without runtime errors.
  - Navigation is consistent and all links resolve.

2. **Day 2: Auth baseline**
- Checklist:
  - [ ] Wire sign-in/sign-up screens to Supabase auth actions.
  - [ ] Add form validation and actionable error states.
- Acceptance criteria:
  - User can create account and sign in successfully.
  - Invalid credentials return user-visible validation feedback.

3. **Day 3: Workspace protection and session flow**
- Checklist:
  - [ ] Gate `/dashboard` behind auth middleware/session checks.
  - [ ] Redirect unauthenticated users to `/sign-in`.
- Acceptance criteria:
  - Authenticated user reaches dashboard.
  - Unauthenticated access to workspace routes is blocked.

4. **Day 4: Analysis API foundation**
- Checklist:
  - [ ] Implement `POST /api/analysis` with schema validation.
  - [ ] Return deterministic metrics/layers payload for initial demo mode.
- Acceptance criteria:
  - Valid requests return HTTP 200 with structured analysis payload.
  - Invalid payloads return HTTP 400 with validation details.

5. **Day 5: Run persistence model**
- Checklist:
  - [ ] Create run table access layer using Supabase.
  - [ ] Save each analysis execution with timestamps and workspace ownership.
- Acceptance criteria:
  - New analysis creates persisted run record.
  - Record includes run ID, workspace ID, metrics snapshot, and `created_at`.

6. **Day 6: Run history UX**
- Checklist:
  - [ ] Implement dashboard run history list.
  - [ ] Add search/filter and single-item delete.
- Acceptance criteria:
  - User can find prior runs by query text.
  - Deleting a run updates UI and persistence consistently.

7. **Day 7: Corridor boundary upload**
- Checklist:
  - [ ] Add GeoJSON upload flow in workspace.
  - [ ] Validate geometry type and size constraints.
- Acceptance criteria:
  - Valid `Polygon`/`MultiPolygon` uploads are accepted.
  - Invalid files show clear error messages and are not submitted.

8. **Day 8: Report generation v1**
- Checklist:
  - [ ] Implement `POST /api/report` for one report template.
  - [ ] Persist report metadata and source run linkage.
- Acceptance criteria:
  - User can generate downloadable report from a saved run.
  - Report metadata appears in report history.

9. **Day 9: QA hardening and build gate**
- Checklist:
  - [ ] Add smoke tests for auth redirect, analysis API, and run persistence.
  - [ ] Fix lint/build warnings that block CI confidence.
- Acceptance criteria:
  - `pnpm build` passes.
  - Smoke tests pass locally in repeat runs.

10. **Day 10: MVP pilot readiness package**
- Checklist:
  - [ ] Prepare short pilot demo script and sample dataset path.
  - [ ] Publish sprint outcomes, known gaps, and Sprint 1 backlog.
- Acceptance criteria:
  - Team can run a 10-15 minute live product walkthrough without blockers.
  - Pilot-facing backlog is prioritized with owner + target dates.

## Sprint 0 Exit Criteria
- Authenticated user journey exists from sign-up/sign-in to workspace dashboard.
- At least one analysis run can be executed, persisted, and revisited.
- A basic report export can be generated from saved run data.
- Build passes and the app is stable enough for internal demo/pilot conversations.
