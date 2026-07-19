# Modeling Roadmap E–F Shipped — Handoff

Written 2026-07-18, after the transportation-demand-modeling roadmap (items E, F.1,
F.2, F.3) landed. Supersedes the modeling sections of
`2026-07-19-modeling-quick-wins-shipped-handoff-for-1.1.md` (whose "not yet
committed" worktree had, in fact, already merged as PRs #37–#47). Read this for
the current state of the AequilibraE modeling lane.

## What shipped this arc

Five PRs, each **workflow-designed → live-verified (keyless) → adversarial-workflow-
reviewed → findings-fixed → `qa:gate` green → merged `--admin`**:

| PR | Item | Summary |
|----|------|---------|
| #48 | **E — resident VMT + gateways** | Worker downloads a buffered OSM box, detects external gateways (I-80/SR-49…), loads their through-traffic (network `daily_vmt` becomes realistic), and emits a gateway-aware **resident VMT** via the county lane's estimator (`resident_vmt.py`, byte-parity with `scripts/modeling/screening_metrics.py`). CEQA screen prefers resident VMT. |
| #49 | **F.1 — real LODES OD** | `lodes.py` extended from WAC job totals to **OD commute flows** (streamed, bounded by study tracts). `build_daily_od_matrix` blends LODES into the Furness **seed** (`0.19·LODES + 0.81·gravity`) — real commute geography, **marginals unchanged** (no annual→daily magnitude hack; IPF only uses the seed's shape). |
| #50 | **F.2 — mode choice** | Binary **auto-vs-active** logit (`mode_choice.py`, blend of sketch-ABM coeffs) splits the OD before assignment; only auto is assigned, so network + resident VMT are vehicle-based (the §15064.3 basis). |
| #51 | **F.3 — transit LOS** | `gtfs_skim.py` (stdlib) builds a **headway-based transit skim** from a bundled keyless GTFS (`data/gtfs/`); the logit becomes **3-way** auto/transit/active. Transit is available only where real service exists (0 otherwise). |
| #52 | worker launcher fix | `npm run worker:aequilibrae` → `run.sh` (picks the venv; bare `python3` had no deps). |

## The demand pipeline now (workers/aequilibrae_worker/)

1. **Package** (`data_pipeline.generate_package`, needs `CENSUS_API_KEY`): TIGERweb tracts +
   ACS population + **LODES WAC jobs** + **LODES-OD-seeded gravity** OD.
2. **stage_setup** (`main.py`): buffered OSM download → connectors → **gateway detection**.
3. **stage_assignment**: **3-way mode choice** (auto/transit/active) using the auto skim +
   centroid distance + **GTFS transit LOS**; only `auto_float` (+ gateway through-traffic,
   100% auto) is assigned via BFW.
4. **stage_artifacts**: network `daily_vmt` (Σ link×length, connectors excluded), **resident VMT**
   (auto-only, gateway-aware, the CEQA number), mode-split KPIs, evidence packet → private
   `run-artifacts` bucket.

Everything is **screening-grade** and passes the claim-boundary tests. Each KPI carries a
`breakdown_json.provenance` string; nothing claims a calibrated/validated forecast.

## Honest-numbers story (say this to buyers)

- **Network VMT** includes real boundary through-traffic (gateways). **Resident VMT** (the CEQA
  §15064.3 figure) is internal-OD × great-circle × 1.30 circuity, **auto-only**, same estimator
  as the county lane and the NCTC seed (~25.7/capita there).
- **Trip distribution** follows observed LODES commute geography (seeded OD correlates with LODES
  0.82 vs gravity 0.76 on NCTC), with **daily totals unchanged**.
- **Mode shares** are real: rural Nevada County comes out ~92% auto / ~7% active / **~0.02% transit**
  (16 of 650 OD pairs served). Transit is **0 where no service exists** — an honestly-derived 0,
  not a fabricated "transit everywhere". `transit_status` distinguishes "no service" from
  "feed failed to load".

The pilot resident-VMT/capita is modest (~5.6) **only because the frozen pilot uses underscaled
draft demand**; a real dynamic run (needs the Census key) synthesizes fuller demand.

## Operational gotchas (hard-won)

- **`CENSUS_API_KEY` is still empty in `openplan/.env.local`.** A *fresh dynamic* run can't build
  its package keyless (TIGERweb works; ACS rejects). Everything above was verified via the frozen
  Nevada County pilot package (pre-staged at `data/pilot-nevada-county/runs/<run_id[:12]>/package/`,
  which `ensure_dynamic_package` reuses). **Action for Nathaniel:** free key at
  api.census.gov/data/key_signup.html → unblocks live dynamic runs + the El Dorado second-county proof.
- **Stale workers respawn.** Something in the dev env kept leaving/restarting AequilibraE workers
  that grabbed queued stages with old in-memory code. Always
  `pgrep -f "python.*main.py"` and kill stale workers (NOT ComfyUI: `main.py --use-sage-attention`,
  cwd `~/code/ComfyUI`) before a live verify.
- **Run the worker with the venv:** `npm run worker:aequilibrae` (now via `run.sh`) or
  `./.venv311/bin/python -u main.py`. System python3 (3.14) has no deps.
- **GTFS source** (keyless, verified): `https://data.trilliumtransit.com/gtfs/goldcountrystage-ca-us/goldcountrystage-ca-us.zip`.
  Bundled snapshot in `data/gtfs/`; refresh via `refresh_gtfs.py` (off the run path). Service window
  in `PROVENANCE.json` — surfaced in KPI provenance as a currency caveat.
- **`enrich_zone_attributes` renames the tract column `geoid`→`GEOID`** — worker code reading the
  *enriched* frame must use `GEOID` (a review caught this as an F.1 blocker); `tracts[...]`
  (pre-enrich) stays `geoid`.
- **Two LODES paths, don't conflate:** the worker demand OD (substantive) vs
  `openplan/src/lib/data-sources/lodes.ts` (a display/scoring estimate that still returns an
  ACS estimate).

## Verify a live run (from `openplan/`)

```bash
npm exec supabase db reset && npm run seed:nctc     # clean workspace + project + demo user
# create a model + queued aequilibrae run + 3 stages (REST service-role or the app UI),
# pre-stage the frozen package at data/pilot-nevada-county/runs/<run_id[:12]>/package/,
npm run worker:aequilibrae                          # processes the queued stages
# read back model_run_kpis: daily_vmt, resident_vmt(_per_capita), auto/transit/active_mode_share_pct
```
Python unit tests (no Census key, no network):
```bash
python3 workers/aequilibrae_worker/test_lodes.py
./workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_resident_vmt.py
./workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_od_matrix.py
./workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_mode_choice.py
./workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_gtfs_skim.py
```

## What's next (roadmap beyond F)

- **Calibration / fit-scoring** for the AequilibraE lane (the county lane already has %RMSE/GEH via
  `validate_screening_observed_counts.py`; sketch has benchmark-fit). This is the Caltrans-credibility
  play — do it before more model sophistication. Everything stays screening-grade until then.
- **F.1 magnitude refinement:** LODES OD is home-based-work commute counts; F.1 uses them to *shape*
  distribution, not scale it. A purpose/expansion model would let LODES influence magnitude too.
- **F.3 refinements:** near-stop (not just same-stop) transfers; `frequencies.txt` support (currently
  rejected fail-loud); a non-flat fare model.
- **Worker Supabase write-path** (the dormant `lodes_od` table has no writer today) for DB-backed OD.
- **ActivitySim stays roadmap** — do not attempt a live run until there's calibration data; the
  copy tests enforce screening-grade claims.

Continuity memory: `~/.claude/projects/-home-nathaniel-code-openplan/memory/modeling-lane-live-ops.md`.
