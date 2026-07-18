# OpenPlan 1.1 — Handoff for the Next Agent (modeling quick wins shipped)

Written 2026-07-19, immediately after the four "modeling quick wins" from the
v1 handoff §7.4 landed in a worktree. Read `docs/ops/2026-07-18-v1-handoff-for-next-agent.md`
first (it is still the strategic map); this doc records what changed, what to
watch, and the concrete 1.1 arc.

**Status of the work in this doc:** implemented and verified in a git worktree
(`db reset` + `seed:nctc` clean, full `npm test` = 1827 passed, `lint` + `tsc`
clean, `py_compile` on all touched Python, LODES stdlib test green). **Not yet
committed or merged.** The worker changes were made surgically and are
import-safe but were **not executed against a live AequilibraE assignment**
(Python deps are not installed in the dev box) — validate the worker VMT path
end-to-end the first time a real worker runs.

---

## 1. What shipped

### 1a. VMT KPIs from the AequilibraE worker
`workers/aequilibrae_worker/main.py`
- `compute_daily_vmt(db_path, link_volumes_csv)` — daily VMT = Σ(link assigned
  `PCE_tot` × link length). AequilibraE `links.distance` is **metres**
  (confirmed by the existing travel-time math), converted to miles; virtual
  `centroid_connector` links are excluded.
- `stage_artifacts(...)` now derives `daily_vmt`, `vmt_per_capita`
  (population from the package manifest `total_population`), and `population_total`,
  writes a `vmt` block into the evidence packet, and registers three KPIs in the
  **`general`** category (directly readable; run_id set, county_run_id null).

### 1b. Seeded VMT lights up the CEQA arc (the headline)
`openplan/scripts/seed-nctc-demo.ts`
- `computeNctcInternalResidentVmt(artifactRoot, bundleManifest)` derives a
  **defensible internal resident VMT** from the frozen Nevada County artifacts
  (`package/od_trip_matrix.csv` + `zone_attributes.csv`). Raw network VMT/capita
  is ~194 because the county screening run loads ~266k external through-trips on
  US-20/SR-49/I-80 — that is pass-through, not resident VMT, and CEQA §15064.3
  measures resident/employee-generated VMT. Excluding the 6 external gateway
  zones and using OD × centroid great-circle × 1.30 circuity yields:
  - **`vmt_per_capita` = 25.732 VMT/capita** (avg 10.16 mi over 259,166 internal
    trips), **`daily_vmt` = 2,633,001 veh-mi/day**, population 102,322.
  - 25.7 is near the CA statewide average and the panel's 22.0 reference — with
    the OPR 15%-below cut line (18.7) it produces a real "potentially
    significant" determination.
- `buildNctcCountyOnrampManifest(bundle, validation, vmt?)` writes `daily_vmt` /
  `vmt_per_capita` / `vmt_provenance` into `summary.run`.
- `src/lib/models/behavioral-onramp-kpis.ts` — `BEHAVIORAL_KPI_DEFINITIONS`
  extended with `daily_vmt` + `vmt_per_capita` (each carrying the provenance
  string in `breakdown_json`). The set is now **8 KPIs** (was 6); every count
  assertion in the tests was updated.
- `src/lib/models/county-onramp.ts` — `countyOnrampRunSnapshotSchema` gained
  optional nullable `daily_vmt` / `vmt_per_capita` / `vmt_provenance`.

### 1c. LODES employment (real WAC total jobs)
`workers/aequilibrae_worker/lodes.py` (new, **stdlib-only import** so the
aggregation is unit-testable without numpy/requests) + `data_pipeline.py`
- URL pattern **verified via WebFetch** against `lehd.ces.census.gov`:
  `https://lehd.ces.census.gov/data/lodes/LODES8/<st>/wac/<st>_wac_S000_JT00_<year>.csv.gz`
  (years 2002–2023). Default `LODES_YEAR=2022` (env-overridable) to maximize
  cross-state coverage; latest is 2023.
- Per-state download → aggregate WAC `C000` to 11-digit tract GEOIDs → merged.
  Population-proxy synthesis (`0.47 × pop`, floor 25) kept as an **explicit
  per-tract fallback**; `.csv.gz` cached to `.lodes_cache/` (gitignored).
- `enrich_zone_attributes(tracts, jobs_by_geoid)` uses real jobs where present,
  records a per-tract `jobs_source` column, and the manifest gains a
  `jobs_provenance` block (states used/failed, tract counts, caveat).
- `workers/aequilibrae_worker/test_lodes.py` — 5 dependency-free checks
  (`python3 workers/aequilibrae_worker/test_lodes.py`).

### 1d. Worker safety fixes
`workers/aequilibrae_worker/main.py`
- **Atomic claim:** `sb_claim_stage()` PATCHes `?id=eq.X&status=eq.queued` with
  `return=representation`; an empty result = lost race → skip. Replaces the
  unguarded GET-then-PATCH so two replicas can't double-process.
- **Private artifacts:** volumes GeoJSON is uploaded to the private
  `run-artifacts` bucket and the artifact row stores a **path**
  (`storage://run-artifacts/model-runs/<run-id>/volumes.geojson`), not a public
  URL.

`openplan/src/app/api/models/[modelId]/runs/[modelRunId]/volumes/route.ts`
+ new sibling `artifact-source.ts`
- `storage://<bucket>/<path>` resolves via a **service-role** `.download()`.
- `local://` reads and the run-local filesystem reconstruction fallback are
  gated behind `OPENPLAN_WORKER_LOCAL_ROOT` — hosted deployments never read
  local disk. New test `src/test/model-run-volumes-artifact-source.test.ts`.

### 1e. Polling + stuck-run visibility
- `src/components/models/model-run-manager.tsx` — polls (`router.refresh()`)
  every 5s while a run is queued/running, stops when terminal, pauses on
  `document.hidden`; shows a stuck-run notice when a run has no stage progress
  for >10 min.
- `src/components/county-runs/county-run-detail-client.tsx` — owns its polling
  loop (5s while stage ≠ `validated-screening`, paused when hidden) and shows a
  stuck notice while `enqueueStatus="submitted"` + stage `bootstrap-incomplete`
  for >10 min. `src/lib/hooks/use-county-onramp.ts` intervals now pause when
  hidden.
- `openplan/package.json` — `worker:aequilibrae` script; new
  `workers/aequilibrae_worker/LOCAL.md` (env + pip deps documented, not
  installed).

> **Lint gotcha you will hit too:** this repo runs the React-compiler ESLint
> rules (`react-hooks/purity`, `preserve-manual-memoization`,
> "no setState synchronously in an effect"). `Date.now()` in render/`useMemo`
> and `setState` at the top of an effect body are hard errors. Pattern used
> here: keep a `now` state that is only written inside a timer callback.

---

## 2. The KPI-category bifurcation (understand this before touching VMT)

Migrations `20260416000054` + `20260508000079` split `model_run_kpis` into two
mutually exclusive shapes via `model_run_kpis_source_shape`:

- **`behavioral_onramp` + `county_run_id` (run_id NULL)** — screening-grade
  county-run KPIs. The RLS SELECT policy **excludes** these; they are readable
  only through the consent-requiring RPC `load_behavioral_onramp_kpis_for_workspace`.
- **any other category + `run_id` (county_run_id NULL)** — directly readable via
  RLS.

Consequences for VMT:
- The **county-run CEQA panel** (`src/app/(app)/county-runs/[countyRunId]/page.tsx`
  → `CountyRunCeqaVmtScreen`) reads behavioral KPIs via the RPC, filtered by
  `county_run_id`. So the **seeded** VMT is `behavioral_onramp` (1b) — and it is
  behind the screening-grade consent gate by default (`?includeScreening=1`),
  which is correct for the caveat culture.
- The **worker** writes VMT to `model_runs` where the shape CHECK forces
  non-behavioral → category `general` (1a), directly readable.
- `src/lib/models/ceqa-vmt-screen.ts` matches only on `kpi_name`
  (`vmt_per_capita`, `daily_vmt`, `population_total`), so both paths feed the
  same derivation. **There is no model-run CEQA panel yet** — see §4.

---

## 3. Debts / sharp edges introduced or left

1. **Two VMT methods.** Worker = link volume × network length (naturally
   internal, no externals in the worker's OD). Seed = internal OD × great-circle
   × 1.30 circuity with gateway-zone exclusion (because the county screening
   run's link loads blend in external through-traffic that can't be isolated at
   the link level without a select-link analysis). Both are screening-grade and
   each KPI carries its own provenance, but they are not the same estimator.
   Unify once the worker can do select-link (§4).
2. **`run-artifacts` bucket is not provisioned by any migration.** Only the
   worker references it (upload) and the route reads it. In hosted envs the
   private bucket must exist. Add a migration/setup step (§4).
3. **Worker VMT path not executed live.** `py_compile` clean, logic reviewed,
   but no real assignment was run here. First live run: confirm `daily_vmt`
   is sane and connectors are actually excluded (link_type string match).
4. **LODES year default (2022).** A state missing 2022 → per-state fallback to
   synthetic jobs, recorded in `jobs_provenance.states_failed`. Bump to 2023
   when you want the newest, but check coverage.
5. **`.env.local` was copied into the worktree** to run the seed (gitignored).
   If you keep this worktree, it holds a service-role key; delete it if you
   discard the tree.
6. **County-run polling breadth.** It polls while stage ≠ `validated-screening`.
   The county lane's intermediate stages are effectively single-shot (manifest
   ingest), so this is fine, but revisit if the county worker ever streams
   stages.

---

## 4. The 1.1 roadmap

Carries forward the v1 handoff §7.4 items 5–8, refined by what the quick wins
revealed. Suggested order:

**A. Model-run CEQA panel (small, high payoff).** The worker now writes
`vmt_per_capita`/`daily_vmt`/`population_total` for model runs (directly
readable), but only county runs have a CEQA screen. Add the same
`deriveCeqaVmtScreeningInputs` → `computeCeqaVmt` panel to the model-run detail
surface (`ModelRunManager` / `model-run-evidence-panel.tsx`) so a live worker
run produces a statutory determination too. Reuse `ceqa-vmt-screen.ts` as-is.

**B. Provision the private `run-artifacts` bucket** via migration/setup, with an
RLS/`storage.objects` policy consistent with workspace access, so 1d's
service-role signed download has a bucket to read in every environment.

**C. Port FreeChAMP's sketch ABM as a new "sketch" run mode** (v1 handoff §7.4.5).
`run-modes.ts` already has the `behavioral_demand` surface (currently
preflight-only). Harvest the domain logic from `github.com/nfredmond/FreeChAMP`
(`apps/web/src/lib/abm/`), **fix the `mode-choice.ts:295` income×0.002 bug that
collapses the logit before use**, validate against NHTS/ACS, and gate outputs as
sketch-grade in the caveat system. Note: `engine_key` CHECK
(`20260317000025`) allows `activitysim` but not `behavioral_demand` — add it if
you wire a real launch.

**D. Calibration story** (v1 handoff §7.4.6). Port FreeChAMP's fit-scoring
(`routers/calibration.ts`: VMT %-error, mode-split RMSE, 0–100 fit) into
`evidence-packet.ts`; pair with the county lane's observed-count validation
(`validate_screening_observed_counts.py`) so every run carries "how wrong is
this" numbers. This is the Caltrans-credibility play — do it before chasing more
model sophistication.

**E. Worker select-link → resident VMT.** Add a select-link/subarea analysis so
the worker can report internal (resident) VMT separately from through-traffic —
then the worker and seed VMT estimators converge and per-capita VMT is
resident-only everywhere.

**F. Real LODES OD + mode choice + transit LOS** (v1 handoff §7.4.7). The
`lodes_od` table is dormant and `lodes.py` already has the download/cache
scaffolding to extend from WAC to OD. GTFS schema exists but dormant. Largest
lift — after C–D.

**G. ActivitySim stays roadmap** (v1 handoff §7.4.8). Do not attempt a live run
until there is calibration data; the copy tests enforce screening-grade claims.

---

## 5. Verification commands (run from `openplan/`)

```bash
npm exec supabase db reset          # re-apply migrations to local Supabase
npm run seed:nctc                   # seeds VMT KPIs; logs "internal resident VMT ... 25.732 VMT/capita"
npm test                            # vitest (all suites)
npm run lint                        # eslint (React-compiler rules — strict)
npx tsc --noEmit                    # typecheck
python3 workers/aequilibrae_worker/test_lodes.py                 # stdlib LODES checks
python3 -m py_compile workers/aequilibrae_worker/{main,data_pipeline,lodes,test_lodes}.py
npm run worker:aequilibrae          # runs the worker locally (needs the Python venv from LOCAL.md)
```

Sanity-check the seed landed (service-role bypasses the behavioral-onramp gate):

```
GET {SUPABASE_URL}/rest/v1/model_run_kpis?county_run_id=eq.d0000001-0000-4000-8000-000000000005
    &kpi_name=in.(vmt_per_capita,daily_vmt,population_total)&select=kpi_name,value,breakdown_json
```
Expect `vmt_per_capita ≈ 25.7325`, `daily_vmt ≈ 2,633,000.6`, `population_total = 102322`,
each with a `breakdown_json.provenance` string.

The seed test `src/test/seed-nctc-demo.test.ts` already asserts the CEQA helper
resolves the seeded key set (`deriveCeqaVmtScreeningInputs → status:"per-capita"`).

---

## 6. Files touched (map)

- `workers/aequilibrae_worker/main.py` — atomic claim, VMT, private storage path
- `workers/aequilibrae_worker/data_pipeline.py` — LODES jobs + provenance
- `workers/aequilibrae_worker/lodes.py` — new, stdlib LODES module
- `workers/aequilibrae_worker/test_lodes.py` — new, stdlib tests
- `workers/aequilibrae_worker/LOCAL.md` — new, local run guide
- `openplan/scripts/seed-nctc-demo.ts` — VMT derivation + manifest wiring (+ `ARTIFACT_ROOT` export)
- `openplan/src/lib/models/behavioral-onramp-kpis.ts` — VMT KPI definitions
- `openplan/src/lib/models/county-onramp.ts` — schema VMT fields
- `openplan/src/app/api/models/[modelId]/runs/[modelRunId]/volumes/{route.ts,artifact-source.ts}`
- `openplan/src/components/models/model-run-manager.tsx`
- `openplan/src/components/county-runs/county-run-detail-client.tsx`
- `openplan/src/lib/hooks/use-county-onramp.ts`
- `openplan/package.json` — `worker:aequilibrae`
- `.gitignore` — `.lodes_cache/`
- Tests: `behavioral-onramp-kpis.test.ts`, `seed-nctc-demo.test.ts`,
  `county-run-manifest-route.test.ts`, `model-run-volumes-artifact-source.test.ts`

First move for the next agent: **commit this worktree** (nothing is committed
yet), then start with roadmap item A (model-run CEQA panel) — it is the smallest
change that extends the demo arc the seeded VMT already proves.
