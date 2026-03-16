# OpenPlan Production Edit / Update Smoke — 2026-03-16

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-edit-qa-2026-03-16t22-39-14-596z@natfordplanning.com
- QA user id: unknown
- Workspace id: 2f497e37-efb3-45a7-a7bd-e8fd4ed10215
- Project id: a7d5edb9-077e-4dd2-aa1f-f8966477e560
- Plan id: a74019cb-4c30-4e4d-8835-569d4d0c74d5
- Model id: 57ce3c23-6332-4769-b0df-c630d3d8bf11
- Program id: c1b9ccfa-bebd-43dc-88dd-3382c993fbf2

## Scope
- Compact authenticated production smoke focused only on safe detail-page edit/update persistence.
- No billing mutations, destructive actions, or broad workflow expansion.

## Exact Routes / Records / Fields Tested
- PLAN: `/plans/a74019cb-4c30-4e4d-8835-569d4d0c74d5` — record `a74019cb-4c30-4e4d-8835-569d4d0c74d5` (QA Edit Plan 2026-03-16T22-39-14-596Z) — fields: geography_label, summary
- MODEL: `/models/57ce3c23-6332-4769-b0df-c630d3d8bf11` — record `57ce3c23-6332-4769-b0df-c630d3d8bf11` (QA Edit Model 2026-03-16T22-39-14-596Z) — fields: owner_label, horizon_label, summary
- PROGRAM: `/programs/c1b9ccfa-bebd-43dc-88dd-3382c993fbf2` — record `c1b9ccfa-bebd-43dc-88dd-3382c993fbf2` (QA Edit Program 2026-03-16T22-39-14-596Z) — fields: cycle_name, sponsor_agency, summary

## What Persisted Successfully
- PLAN geography_label: QA edit corridor 223914
- PLAN summary: Production plan edit smoke persisted on reload at 2026-03-16T22-39-14-596Z.
- MODEL owner_label: QA operator 223914
- MODEL horizon_label: 2045 edit window 223914
- MODEL summary: Production model edit smoke persisted on reload at 2026-03-16T22-39-14-596Z.
- PROGRAM cycle_name: QA 2028 RTIP cycle 223914
- PROGRAM sponsor_agency: Nat Ford QA 223914
- PROGRAM summary: Production program edit smoke persisted on reload at 2026-03-16T22-39-14-596Z.

## Verification Performed
- Signed into the live public alias with a fresh QA auth user and created dedicated QA project/workspace records through the production app session.
- Opened each detail route on the live alias, edited only safe metadata/text controls, and clicked the in-page save button.
- Waited for the live PATCH response on the production route to return HTTP 200.
- Forced a full browser reload on the same detail route and re-read the edited form controls from the re-rendered page.
- Counted a pass only when the reloaded page still showed the exact edited values.

## Pass / Fail Notes
- PASS: Created QA auth user openplan-edit-qa-2026-03-16t22-39-14-596z@natfordplanning.com.
- PASS: Authenticated on the live public alias and landed on /models.
- PASS: Created production QA records: project a7d5edb9-077e-4dd2-aa1f-f8966477e560, plan a74019cb-4c30-4e4d-8835-569d4d0c74d5, model 57ce3c23-6332-4769-b0df-c630d3d8bf11, program c1b9ccfa-bebd-43dc-88dd-3382c993fbf2.
- PASS: Plan detail save returned 200 and the edited geography/summary values persisted after full reload.
- PASS: Model detail save returned 200 and the edited operator/horizon/summary values persisted after full reload.
- PASS: Program detail save returned 200 and the edited cycle/sponsor/summary values persisted after full reload.

## Regressions / Blockers Found
- None in this scoped lane. All three core module detail edit paths saved successfully and persisted on reload in current production.

## Evidence
- docs/ops/2026-03-16-test-output/2026-03-16-prod-edit-smoke-01-plan-detail-persisted.png
- docs/ops/2026-03-16-test-output/2026-03-16-prod-edit-smoke-02-model-detail-persisted.png
- docs/ops/2026-03-16-test-output/2026-03-16-prod-edit-smoke-03-program-detail-persisted.png
- docs/ops/2026-03-16-test-output/2026-03-16-prod-edit-smoke-run.log

## Why This Advances Honest v1 Closure
- The previous production proof established create/list/detail continuity. This pass closes the next high-value honesty gap by proving that the current production detail pages also accept safe edits and persist them after reload for Plans, Models, and Programs.
- That materially improves confidence that v1 operators can maintain core planning records in place on the live deployment, not just create or view them.

## Bottom Line
- Live edit/update passed for plan detail, model detail, and program detail on the current production alias using safe metadata/text edits verified after full reload.
- No application code changes were required in this lane.
