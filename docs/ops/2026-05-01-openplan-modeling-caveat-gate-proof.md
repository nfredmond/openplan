---
title: OpenPlan modeling caveat-gate proof slice
date: 2026-05-01
branch: codex/modeling-caveat-proof
head_sha: 8fbedd49d576dd2918c6b7fcb87a372a9d974a30
status: proof-only — no behavior change
related_docs:
  - docs/ops/2026-04-16-caveat-gate-audit.md
  - docs/ops/2026-04-19-phase-s1-t16-reader-proof.md
  - docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md
  - docs/ops/2026-05-01-openplan-full-os-roadmap.md
---

# OpenPlan modeling caveat-gate proof slice

This slice locks in the existing screening-grade caveat-gate boundary
around behavioral-onramp KPIs. It is **proof-only** — no source code
under `src/` is modified, no migrations are added, no SECURITY DEFINER
helpers are introduced, no copy claims are widened.

The mission was to prove that OpenPlan stores behavioral / county-run
modeling evidence while keeping screening-grade outputs gated unless a
caller explicitly opts in with `acceptScreeningGrade`. After
inspecting the active read paths, **the safety boundary is intact in
code today** — but several invariants that make it safe were not
covered by tests. This slice closes those gaps.

## Current model-safety boundary

### Write side

`POST /api/county-runs/[countyRunId]/manifest` (the only writer) calls:

- `persistBehavioralOnrampKpis()` in `src/lib/models/behavioral-onramp-kpis.ts:106-148`
  - stamps every row with `kpi_category: "behavioral_onramp"`,
    `county_run_id: <id>`, **`run_id: null`**.
- `refreshCountyRunModelingEvidence()` in `src/lib/models/evidence-backbone.ts:486-614`
  - records `modeling_source_manifests`, `modeling_validation_results`,
    and a `modeling_claim_decisions` row whose `claim_status` defaults
    to `prototype_only` for screening-grade NCTC-style runs.

The `run_id: null` stamp is structurally important — see "Reader
census" below.

### Read side (the only one)

`GET /county-runs/[countyRunId]` (`src/app/(app)/county-runs/[countyRunId]/page.tsx`)
parses `?includeScreening=1` into `acceptScreeningGrade: boolean` and
passes it to `loadBehavioralOnrampKpisForWorkspace`. That helper
(`src/lib/models/behavioral-onramp-kpis.ts:163-233`) routes every
candidate `county_runs` row through `partitionScreeningGradeRows`
before it can fetch KPIs.

Consent is **per-URL, per-visit only**. There is no durable
"always include screening" workspace flag, by design (Phase S.1 proof
doc, 2026-04-19).

### Reader census

| Reader | Path | Outcome |
|---|---|---|
| County-run detail page | `src/app/(app)/county-runs/[countyRunId]/page.tsx:40-44` | Routes through `loadBehavioralOnrampKpisForWorkspace` with `acceptScreeningGrade` from `?includeScreening=1` |
| `loadBehavioralOnrampKpisForWorkspace` helper | `src/lib/models/behavioral-onramp-kpis.ts:163-233` | Calls `partitionScreeningGradeRows` for every row (`:191-195`) |
| `/api/models/[modelId]/runs/[modelRunId]/kpis` | `src/app/api/models/.../kpis/route.ts:144,214` | Filters by `.eq("run_id", modelRunId)`. Behavioral-onramp rows have `run_id=null` → cannot leak |
| `/api/models/[modelId]/runs/[modelRunId]/evidence-packet` | `src/app/api/models/.../evidence-packet/route.ts:286` | Same `.eq("run_id", modelRunId)` filter — same exclusion |
| `/api/models/[modelId]/runs/[modelRunId]/launch` | `src/app/api/models/.../launch/route.ts:189` | Write-side `.delete()` filtered by `run_id`; not a reader |
| `scenario_comparison_summary` view | `supabase/migrations/20260416000055_scenario_comparison_summary_view.sql` | Aggregates `scenario_comparison_indicator_deltas` joined to `scenario_comparison_snapshots`. Never references `model_run_kpis` or `behavioral_onramp` |
| `loadScenarioComparisonSummary*` helpers | `src/lib/scenarios/comparison-summary.ts` | Read only the view above; cannot reach behavioral-onramp rows |

Every behavioral-onramp KPI write path either passes through the
caveat gate (`page.tsx → loader`) or is excluded by the `run_id=null`
predicate (everything else). No reader bypasses both.

### Per-row caveat-gate write (independent)

Even when consent is granted, the modeling claim decision written by
`refreshCountyRunModelingEvidence` for an NCTC-style screening run is
`prototype_only` (the `validated-screening` posture is screening-grade
by construction; required validation evidence is missing). RTP and
project-status report exports therefore render screening-grade
language regardless of whether the page-level toggle is set.

## Files / tests inspected

### Source

- `src/lib/models/caveat-gate.ts` (gate definition)
- `src/lib/models/behavioral-onramp-kpis.ts` (writer + only consumer)
- `src/lib/models/county-onramp.ts` (`countyRunStageSchema`)
- `src/lib/models/evidence-backbone.ts` (per-track claim decisions)
- `src/app/(app)/county-runs/[countyRunId]/page.tsx` (consent wiring)
- `src/app/(app)/county-runs/[countyRunId]/_components/county-run-behavioral-kpis.tsx` (banner + toggle)
- `src/app/api/county-runs/[countyRunId]/manifest/route.ts` (writer)
- `src/app/api/models/[modelId]/runs/[modelRunId]/{kpis,evidence-packet,launch}/route.ts` (other `model_run_kpis` callers)
- `src/lib/scenarios/comparison-summary.ts` (cross-reads the view)
- `supabase/migrations/20260416000055_scenario_comparison_summary_view.sql`

### Pre-existing tests (re-run, all passing)

- `src/test/caveat-gate.test.ts` — 8 tests
- `src/test/behavioral-onramp-kpis.test.ts` — 6 tests
- `src/test/county-run-manifest-route.test.ts` — 3 tests
- `src/test/scenario-comparison-summary.test.ts` — 8 tests

### New tests added

- `src/test/modeling-caveat-gate-stages.test.ts` — 3 tests
- `src/test/modeling-caveat-page-consent.test.tsx` — 4 tests
- `src/test/modeling-caveat-section-copy.test.tsx` — 4 tests
- `src/test/modeling-caveat-scenario-summary-isolation.test.ts` — 3 tests

## Exact PASS checks

### Pre-existing scoped tests (25/25)

```
✓ src/test/caveat-gate.test.ts (8 tests)
✓ src/test/behavioral-onramp-kpis.test.ts (6 tests)
✓ src/test/scenario-comparison-summary.test.ts (8 tests)
✓ src/test/county-run-manifest-route.test.ts (3 tests)
Test Files  4 passed (4)
     Tests  25 passed (25)
```

### New tests (14/14)

```
✓ src/test/modeling-caveat-scenario-summary-isolation.test.ts (3 tests)
✓ src/test/modeling-caveat-gate-stages.test.ts                (3 tests)
✓ src/test/modeling-caveat-page-consent.test.tsx              (4 tests)
✓ src/test/modeling-caveat-section-copy.test.tsx              (4 tests)
Test Files  4 passed (4)
     Tests  14 passed (14)
```

Individual test names:

`modeling-caveat-gate-stages.test.ts`

- treats every documented `CountyRunStage` as screening-grade
- does not silently widen — a synthetic certified stage is not gated
- fails closed when stage is null or undefined

`modeling-caveat-page-consent.test.tsx`

- passes `acceptScreeningGrade=false` when `?includeScreening` is absent
- passes `acceptScreeningGrade=true` when `?includeScreening=1`
- fails closed for any value other than the literal string `"1"` (covers `"true"`, `"yes"`, `"on"`, `"0"`, `""`, `" 1"`, `"1 "`)
- redirects to `/sign-in` when there is no authenticated user

`modeling-caveat-section-copy.test.tsx`

- renders the screening-grade refusal banner when this run is rejected and consent is absent (and rejects forecasting language: `forecast`, `calibrated`, `predicted`, `production-ready`)
- hides the warm banner and offers a revert link when screening-grade consent is accepted
- renders the empty-state message when no KPIs exist and nothing is rejected
- renders the load-error banner when the loader returned an error

`modeling-caveat-scenario-summary-isolation.test.ts`

- never references `model_run_kpis`
- never references `behavioral_onramp`
- aggregates only from the scenario comparison spine (positive control: references `scenario_comparison_indicator_deltas`, `scenario_comparison_snapshots`, `CREATE OR REPLACE VIEW scenario_comparison_summary`, and `security_invoker = true`)

### Lint

`pnpm lint` exits cleanly (eslint reports no findings).

## What is proven

1. Every documented `CountyRunStage` literal is in `SCREENING_GRADE_STAGES` — a future migration that adds a stage without updating the gate fails the structural test before merge.
2. The county-run detail page wires `?includeScreening=1` to `acceptScreeningGrade: true` and treats every other value (truthy or falsy) as `false`. Consent is fail-closed against typos and well-meaning variants.
3. The screening-grade refusal banner renders only when the current run is held back AND consent is absent; banner copy stays in screening-grade, "held back" language and is **forbidden** from drifting into "forecast / calibrated / predicted / production-ready" claims.
4. The include-link / revert-link hrefs are exactly `${basePathname}?includeScreening=1` and `${basePathname}` — no double-encoding, no extra query params.
5. The `scenario_comparison_summary` view does not silently consume `model_run_kpis` or behavioral-onramp KPIs. Anyone who edits the migration to "join in behavioral KPIs as a convenience" trips the regression test.
6. Empty-state and load-error paths render planner-legible copy without leaking forecasting claims.

## What is not proven

1. **Live evidence.** No production screenshot of `?includeScreening=1` against a real NCTC county run. The proof is helper-boundary, not browser-end-to-end.
2. **RLS-level isolation.** The caveat gate is a TypeScript boundary, not a Postgres RLS policy. A non-React caller (a future raw-SQL job, a Supabase trigger, a service-role script) can still read `model_run_kpis` rows directly. Closing that requires either narrowing RLS on `model_run_kpis` by `kpi_category` or moving behavioral-onramp into a separate table — out of scope here.
3. **Other modeling tracks.** The caveat gate today only governs behavioral-onramp KPIs (`model_run_kpis.kpi_category = 'behavioral_onramp'`). The evidence-backbone tables (`modeling_source_manifests`, `modeling_validation_results`, `modeling_claim_decisions`) have their own separate gating posture (`modelingClaimAllowsOutwardPlanningLanguage`), which is exercised by `report-generate-route.test.ts` and `rtp-export.test.ts` — but not by this slice.
4. **Other model_run_kpis readers.** `/api/models/[modelId]/runs/[modelRunId]/{kpis,evidence-packet}` are safe today only because they `.eq("run_id", modelRunId)` and behavioral-onramp rows have `run_id=null`. There is no test in this slice that locks that property; the writer test (`county-run-manifest-route.test.ts`) does verify `run_id=null` on insert but does not lock that the reader routes filter by `run_id`. This is acceptable, since touching those route tests would expand scope beyond proof-only — but it remains a latent dependency.

## Commands run

From `openplan/`:

```bash
pnpm vitest run src/test/modeling-caveat-gate-stages.test.ts \
                 src/test/modeling-caveat-page-consent.test.tsx \
                 src/test/modeling-caveat-section-copy.test.tsx \
                 src/test/modeling-caveat-scenario-summary-isolation.test.ts
# Test Files  4 passed (4)
#      Tests  14 passed (14)

pnpm vitest run src/test/caveat-gate.test.ts \
                 src/test/behavioral-onramp-kpis.test.ts \
                 src/test/county-run-manifest-route.test.ts \
                 src/test/scenario-comparison-summary.test.ts
# Test Files  4 passed (4)
#      Tests  25 passed (25)

pnpm lint
# clean (eslint reports no findings)
```

`pnpm build` was not run because no `.ts`/`.tsx` source under `src/`
was modified. The slice is test-and-doc only.

## Remaining product gap

The largest gap, called out so it is not lost:

- **The caveat gate enforces consent at the helper boundary, not at the SQL/RLS boundary.** Any future non-React caller that issues `supabase.from("model_run_kpis").select(...).eq("kpi_category", "behavioral_onramp")` (or no kpi_category filter) would bypass the gate. Today no such caller exists. Tomorrow's caller will not be caught by this test suite.

  Two options to actually close this:

  - Narrow RLS on `model_run_kpis` so a `WHERE kpi_category = 'behavioral_onramp'` row is invisible to reads from sessions whose JWT does not carry an explicit `acceptScreeningGrade` claim. This is the strongest enforcement, but no Supabase pattern for "consent-aware RLS" exists in the codebase yet.
  - Move behavioral-onramp KPIs to a separate table (`county_run_behavioral_kpis`) and grant `SELECT` only to the helper's service identity. Cleaner, but requires a migration + reader rewrite.

  Either is a design call beyond proof-only scope. Until then, this slice's `modeling-caveat-page-consent.test.tsx` is the only thing standing between a hand-rolled raw query and a screening-grade leak.

- **`isScreeningGradeStage` defaults unknown strings to `false`.** That is intentional — it lets `"certified-modeling"` pass through. But it also means that if a future schema change inserts a string into `county_runs.stage` that was never added to `countyRunStageSchema`, the gate will treat it as **non**-screening and let it through. The structural lock-in test (`modeling-caveat-gate-stages.test.ts`) catches one direction (a schema literal not added to `SCREENING_GRADE_STAGES`) but not the other (a row stage value not added to the schema). The robust fix would be to make `county_runs.stage` a Postgres `ENUM` type aligned with the Zod schema, or to harden `isScreeningGradeStage` to fail closed on unknown strings — both are out of scope.

## Acceptance summary

- **Branch:** `codex/modeling-caveat-proof` (forked off `8fbedd4` — current `main` tip, "after" `ee29492`)
- **Files changed:** 4 new tests, this proof doc, one row added to `docs/ops/README.md`
- **Behavior change:** **None.** All `.ts`/`.tsx` source under `src/` and all migrations are unchanged.
- **Validation:** lint clean, 14 new tests pass, 25 pre-existing scoped tests pass, no other tests touched
- **Remaining modeling-safety risks:** documented in "What is not proven" and "Remaining product gap" above; the most consequential is the helper-vs-RLS boundary
