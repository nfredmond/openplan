# OpenPlan non-web code review: workers, scripts, qa-harness, docs/modeling (origin/main 673099778, 2026-10-11)

**Bottom line.** The AequilibraE model-run lane is careful work. It cannot promote its own claim tier, it never averages the two models, and it records its scientific custody. Three things stand between a planner and a defensible number or a working import:

1. **County runs are graded against the retired 30% gate.** The county on-ramp's evidence label comes from that gate, not from the rules-v4 outcome the Python already computes. A county run that fails the 30% test still shows "Screening-grade", and a passing one is marked "validated-screening".
2. **The county model stack runs a known-bad library combination.** Its requirements file records AequilibraE 1.7 with pandas 3. The hosted image refuses that exact pair because it breaks graph compression.
3. **On the hosted site, an interrupted model stage stays "running" forever.** Every deploy, out-of-memory kill or lost acknowledgement leaves it there. Nothing resumes it; the only recovery is an owner or administrator abandoning the run and starting over.

Also: on the hosted site, uploading a GTFS file through the app cannot exceed Vercel's roughly 4.5 MB request limit, even though the code advertises 200 MiB.

All reading was from the archived tree and `git show`/`git grep` on `refs/remotes/origin/main`. I ran no workers, tests or models, mutated nothing, and touched nothing in `data/`.

---

## 1. Worker inventory

LOC counts are Python or TypeScript source, with tests counted separately.

| Worker | Lang | Source / test LOC | Entry point | Dispatch | State reporting | Tests in CI |
|---|---|---|---|---|---|---|
| aequilibrae_worker | Py | 23,891 / 21,637 (154 suites) | `main.py` (8,402 lines), `run_worker` main.py:8359 | Supabase poll of `model_run_stages` (main.py:7850); optional push trigger | Conditional PATCH claim (main.py:642); 30 s heartbeat (worker_heartbeat.py); journaled KPI writes (main.py:1585) | Yes, ci.yml:201-247 (glob with a floor of 28) |
| activitysim_worker | Py | 3,304 / 2,429 (19) | `supabase_poll.py` (hosted); `main.py` Flask (unused service) | Same table, one stage name (supabase_poll.py:81) | Same claim; byte-identical heartbeat copy; un-journaled inserts (supabase_poll.py:287-336) | Partial: `tests/` and `test_http_security.py` only (worker-security-regression.yml:22-23) |
| county_onramp_worker | Py | 593 / 389 (2) | gunicorn `main:app` | HTTP push from the app | In-memory `_jobs` (main.py:44-45); heartbeat callbacks | Yes (worker-security-regression.yml:24-25) |
| ocr_worker | Py | 1,371 / 1,218 (6) | `main.py` ThreadingHTTPServer | Push plus pull dispatch loop (main.py:375) | Durable SQLite WAL/FULL (durable.py); `/healthz` only | **No** |
| odm_worker | Py | 1,665 / 1,551 (8) | `main.py` | HTTP push, aerial contract | In-memory `JOBS` plus queue (main.py:159-173, 436-447) | **No** |
| hosted-models | Py | 85 / 38 | `supervise.py` | Runs both model pollers on one volume | Exits on any child exit; 20 s grace | Yes (ci.yml:223) |
| hosted-node | Node | about 100 | `supervise.mjs` | Spawns 7 queues (supervise.mjs:5-8) | Exit-to-restart; no heartbeat (known) | Yes (ci.yml:34) |
| Node queues (`openplan/scripts/workers/*.ts`, 11 files, about 420 LOC of wrappers) | TS | Wrappers over `src/lib`; GTFS library alone is 10,852 LOC across 38 files | `npm run worker:*` | Poll and authorization CLIs | Shared connector journal | vitest; 62 GTFS test files |
| planner_agent_connector | Node, plus vendored Python skill | 2,243 mjs / 2,552 test; 7,027 Py (map skill) | `connector.mjs` | Provider-api queue | Connector journal | `test:provider-connector` in qa:gate; the skill's `test_checks.py` is not run |

`gtfs-ingestion` and `synthesis-generation` are not in the hosted queue list (supervise.mjs:5-8). That is consistent with `OPENPLAN_GTFS_MANAGED_INGESTION` being off and with synthesis generation being a per-authorization command-line tool.

## 2. The modeling pipeline end to end

**What is implemented** (AequilibraE stage names at main.py:7795-7801):

1. **Setup.** OSM network through `create_from_osm` on a buffered bounding box (main.py:2903-2913), ACS zone attributes, centroids and connectors, gateways, and a zone budget of 4,000 (main.py:142).
2. **Network Assignment.** LODES-blended gravity demand (data_pipeline.py:69-72, 796), the auto/active/GTFS mode split, bi-conjugate Frank-Wolfe (BFW) assignment, rules-v4 count validation, and optional calibration.
3. **Artifact Extraction.** KPIs, VMT, emissions, equity and GeoJSON.
4. **ActivitySim bundle and execution** (activitysim worker). Synthetic population from Census PUMS (needs `CENSUS_API_KEY`), stock `prototype_mtc` plus digest-verified accepted components (runtime.py:157-197).
5. **ActivitySim Network Assignment.** Must reproduce the same network-settings, profile and state digests (main.py:7194-7250).
6. **Demand Model Agreement.** Sensitivity evidence only; the log says "not averaged" (main.py:7626-7640).

**What is documented but not wired.**
- The managed attempt and engine-supervision stack: `model_engine_process`, `model_engine_channel`, `model_engine_supervision` (systemd user scopes), owner guards, `model_attempt_writer`, and the ActivitySim `container_*` and `host_*` modules. That is about 1,200 + 660 + 880 LOC. I found no production caller; the only `bind` sits at model_engine_channel.py:213, reached only through `model_engine_process`, which nothing imports. Hosted runs use the older direct-write path.
- The frozen acceptance rule. The worker always writes `"acceptance_rule": "unknown"` (main.py:5329), so every rules-v4 assessment is `inconclusive` (model_validation_core.py:383-386). Every worker run is therefore `prototype_only`. That is honest, but it means no tier above prototype exists today.

**What is stubbed.**
- ActivitySim transit skims are all zero, and congestion by time of day is not represented (ACTIVITYSIM_RUNTIME_GAP.md).
- The ActivitySim claim tier is hard-coded `"prototype"` (supabase_poll.py:787). That spelling is not in the app's claim enum.
- The comparison build case is a planner-typed percentage (known).

**Where a California county run stops.** It executes end to end with Caltrans counts. In the worker lane it ends `prototype_only`. In the county on-ramp lane it ends "Screening-grade" or "validated-screening" because of the old gate (defect 1).

**Where a nationwide run stops.**
- Counts fall back to HPMS for states without a registered feed (auto_counts.py:100-105). Only CA, WA, CO and OR have their own feeds (count_sources.py:78-141).
- The LODES and count FIPS table covers the 50 states, DC and Puerto Rico only (lodes.py:35-45). A Guam or other-territory run gets "No U.S. state or territory is recorded for FIPS 66", which reads like a data fault.
- The ActivitySim coefficients are the Bay Area set everywhere.
- The ceiling is the 8 GB host and the $40 hard spend stop (hosted-models/DEPLOY.md).

**Guided traffic-number flow (approved 2026-08-15).** It partly exists as the county-runs on-ramp:
- OSM network, automatic defaults, optional calibration (county_onramp_worker/main.py:182, 336).
- An exportable paper trail with network source and download time (screening_runtime.py:2118-2119; county-run-provenance.ts:694-695).
- "Must not be used for environmental review" text (county-run-provenance.ts:191-198).

The CEQA hard stop is real on the model-run side. VMT determinations accept only `aequilibrae` engine runs, behind a claim-tier firewall (vmt-determination-inputs.ts:126; the vmt-significance route), and county runs do not feed it. However, the on-ramp is **not deployed on the hosted site**. No county worker URL is set, and the app hides the launch (county-onramp-dispatch.ts:39). Hosted planners therefore cannot reach the guided flow.

## 3. Never-average, claim tiers, unknown vs zero, preregistration, scalar fitting

- **Never-average is enforced structurally.** `test_no_blended_volume_appears_anywhere_in_the_output` (test_corridor_agreement.py:876) checks that no blended volume appears, and no averaging code exists in the agreement or comparison modules.
- **Claim tiers in the worker lane only ever lower.** main.py:1640-1740 shows this, and calibration needs an independent untouched set before it can be called calibrated (model_credibility).
- **The county lane bypasses rules-v4** (defect 1).
- **Unknown versus zero:**
  - Transit KPIs publish a numeric 0 when the feed failed or the selected feed was unusable. Only the provenance prose says so (main.py:6772-6774, 2625-2648).
  - Validation KPIs correctly emit nothing when nothing matched (main.py:6776-6789).
- **Preregistration digest.** `28807dc5…454d7e` matches its `.sha256` file. The study runners verify it against the file (run_development_validation_study.py:63-75), and so does the product-direction guard (product-direction-review.mjs:33-37). The worker's rules-v4 core checks only that the field looks like a hash (model_validation_core.py:102-103, 384). This is latent today because the rule is always "unknown".
- **Scalar fitting.** The opt-in calibration fits per-class factors, a demand nudge in the worker, and in the county lane a global demand and external scalar clipped to 0.1–10 (calibrate_to_counts.py:172, 317, 388). Steps are accepted on a selection holdout, and the county lane grades on an outer holdout split first (screening_runtime.py:1314-1340). It is disclosed and never the default.

## 4. Reliability

**Supervision.**
- The pollers are plain `while True` loops. Both supervisors fail fast.
- In poll mode the AequilibraE worker has no SIGTERM handling; only push mode drains (main.py:8319). The hosted supervisor gives 20 s before SIGKILL.

**Ownership renewal.** There is none. The claim is a one-time queued→running PATCH (main.py:642-651). The reaper refuses running or started work (run-reaper.ts:1-8).

**Recovery.**
- Abandonment only, by an owner or administrator (recovery route; migration 20261016000023). There is no resume.
- `WorkerStateWriteUnconfirmed` is caught by the poll loop's generic `except` (main.py:7865; supabase_poll.py:1094). The stage stays running and later stages wait "idle" forever.

**Idempotent writes.**
- AequilibraE KPI, artifact and skip writes go through saved request journals (main.py:1585-1611; model_command_journal.py).
- ActivitySim KPIs and artifacts are plain POSTs with readback (supabase_poll.py:287-336), so a lost acknowledgement leaves nothing to reconcile.

**Copies of the receipts mechanism.** There are at least five independent implementations:
1. OCR SQLite (durable.py).
2. Model command SQLite, which copies the OCR approach (model_command_journal.py:1-5).
3. Readback-receipt helpers duplicated in `main.py:580-617` and `supabase_poll.py:214-306`.
4. The TypeScript connector journal (`connector-worker.mjs`), shared by provider-api, translation, synthesis and GTFS.
5. `response-email-journal.ts`.

The GTFS file-link custody in `managed-admission`, `managed-worker-intake` and `managed-worker-artifact` is a sixth style.

**Unrecoverable today.**
- Any in-flight model stage after process loss (the run must restart from the beginning).
- An uncertain ActivitySim insert.
- County on-ramp and ODM jobs after a restart (both in memory).
- Pre-#169 runs (known).
- Railway volume restore (untested, per HOSTED_LIVE).

## 5. Hosted operation

The three Railway services and settings-only-in-dashboard are confirmed (known). Additions:
- **Version drift.** The model host runs the AequilibraE worker on Python 3.11 (hosted-models/Dockerfile:1); the standalone image uses 3.12 (aequilibrae_worker/Dockerfile:1).
- **Stale deploy configs.** `fly.toml`, `fly.push.toml`, `render.yaml` and `railway.json` sit in aequilibrae_worker, and the unused standalone `activitysim_worker/Dockerfile` is still present.
- **Hung ActivitySim runs are invisible.** Hosted ActivitySim runs `subprocess.run` with no timeout or memory scope (runtime.py:875-881; only `ACTIVITYSIM_CLI` is set). A hang holds the poller indefinitely while the separate heartbeat thread keeps reporting healthy.
- **Missing hosted services.** No county on-ramp, ODM or GTFS worker is hosted.

## 6. GTFS ingestion

- **Managed ingestion.** About 10.9k LOC in TypeScript with thorough custody. It is off on the hosted site, with no worker; migrations 28–31 are unreleased per STATUS.md.
- **Hosted path.** Hosted uses the legacy inline ingest, a 300 s Vercel function with a 15-minute reaper.
- **Upload limit.** The upload claims 200 MiB (body-limit.ts:62). The same file documents that Vercel refuses bodies over about 4.5 MB (body-limit.ts:76). Every agency feed above that size fails with a bare 413 on the hosted site. CTA's 94 MiB feed is the file's own motivating example.
- **Model-side feed choice is sound.** A selected feed never falls back to another feed, and the bundled Nevada County feed is used only when the catalog could not be read (gtfs_skim.py:1077-1097).

## 7. Aerial/ODM and OCR against roadmap M5b

- **OCR.** Durable and hosted, with a fresh job proven on the public site. English is the only installed language, and it refuses others rather than misreading them. Its suites do not run in CI.
- **ODM.** Contract-compatible but in memory only. It has no durable intake, task-handle persistence, resumable transfer or pinned images, all of which M5b.2 (ROADMAP.md:324-330) requires. It is not hosted.
- **M5b.1 and M5b.3–6** (DJI handoff, full reconstruction products, measurement, ODX benchmark) have no worker code on main.

## 8. qa-harness and dead scripts

- **qa-harness.**
  - 40 scripts, last edited between 2026-07-27 and 2026-10-11.
  - The latest committed local smoke reports are dated 2026-08-24 (docs/ops). Mentions in reviews run to 2026-10-01.
  - None of the 12 `openplan-prod-*` smokes has a committed run report anywhere in docs. Most were last edited in July and create QA users in what is now the public site.
  - README lists a nonexistent `openplan-prod-county-scaffold-smoke.js` and gives the wrong directory (`openplan/qa-harness`).
- **Dead or orphan scripts.**
  - Three test suites sit outside the CI glob and never run: `scripts/modeling/test_count_sources.py`, `test_census_key_failure.py` and `test_screening_metrics.py`, 449 lines in total.
  - Unreferenced anywhere:
    - `check_screening_runtime_smoke.py`
    - `prepare_structural_demand_registry.py`
    - `prove_structural_demand_guards.py`
    - `prove_structural_diagnosis_guards.py`
    - `prove_distributed_work_loading_guards.py`
    - `research/mutation_proof_sealed_study.py`
  - `run_nevada_pilot_richer_lane.sh` is April-era and Nevada County only.
  - Keep the frozen-study runners (`run_*_study.py`) for reproducibility.

## 9. Python quality

- **No lint or type configuration** anywhere: no pyproject, mypy or ruff.
- **Return-type annotations** (roughly): aequilibrae worker 300 of 689 functions, scripts/modeling 875 of 1,187, OCR and ODM 0.
- **`main.py` is 8,402 lines.** `stage_artifacts` runs about 1,180 lines (5816-6994) and `stage_assignment` about 830 (4281-5116).
- **Duplication.** The heartbeat file is byte-identical in both workers. There are 45 `sys.path` edits; for example, ActivitySim imports the AequilibraE worker modules (supabase_poll.py:46-48) and cites stale line numbers (supabase_poll.py:212, 409).
- **Validation versions coexist.** `model_validation_core` (v4), `model_validation_core_v5`, `validation_instrument` and `_v2`, and structural diagnosis v3 all live side by side.
- **Some recovery modules are written in compressed one-line style** (for example model_recovery_decision_command.py).
- **Pinning.** ActivitySim is fully pinned. AequilibraE, the modeling scripts, OCR and ODM use version floors only.

## 10. Top 20, ranked by impact on a defensible number or a working import

| # | Finding | Location | Fix direction |
|---|---|---|---|
| 1 | County claim tier uses the retired 30% gate with a 3-station minimum. A failing run shows "Screening-grade", and a passing one gets stage "validated-screening". The rules-v4 `scientific_outcome` the Python computes is ignored. | evidence-backbone.ts:388-390, 304, 580-590; county-onramp-persistence.ts:63-77; validate_screening_observed_counts.py:661-691, 1335-1342 | Derive the county tier from the rules-v4 outcome; make failures `prototype_only`; retire the stage name |
| 2 | County modeling stack unpinned. AequilibraE 1.7 with pandas 3 is recorded as the container stack, the pair the hosted image refuses. | scripts/modeling/requirements.txt:27-28, 36-47; aequilibrae_worker/requirements.txt:1-8; hosted-models/verify_graph_compatibility.py | One shared constraints file; run the compatibility check in the county image |
| 3 | Hosted GTFS (and aerial) uploads are capped near 4.5 MB by Vercel while 200 MiB is advertised. | body-limit.ts:62, 71, 76 | Direct-to-Storage signed upload or batches, as workspace GIS already does |
| 4 | Process loss or a lost acknowledgement leaves a stage running forever; abandon-only recovery. | main.py:7850-7866, 642; supabase_poll.py:1041-1096; hosted-models/supervise.py | Renewable lease tied to the heartbeat; on restart, reconcile owned running stages at stage boundaries; drain on SIGTERM in poll mode |
| 5 | Managed attempt and engine supervision stack (about 2.7k LOC) has no production caller. | model_engine_channel.py:213; model_engine_process.py | Wire it into the poller or retire it; do not count it as recovery |
| 6 | Hosted ActivitySim has no stall detection: no timeout, no memory scope, and the heartbeat reports healthy during a hang. | activitysim_worker/runtime.py:875-881 | Progress-based liveness (log growth) shown to the planner; never auto-kill |
| 7 | Transit KPIs publish 0 for an unavailable or failed feed. | main.py:6772-6774, 2625-2648 | Publish null with a status, or omit the row |
| 8 | ActivitySim KPI and artifact inserts are not journaled. | supabase_poll.py:287-336 | Route through `model_legacy_kpi_command` and the client, as AequilibraE does |
| 9 | County on-ramp: a failed completed-callback is relabeled as a failed run; jobs are in memory. | county_onramp_worker/main.py:466-503, 44-45 | Retry or journal callbacks; never convert a delivery failure into a model failure |
| 10 | OCR (hosted), ODM, three ActivitySim root suites and three modeling suites never run in CI. | ci.yml:201-247; worker-security-regression.yml:22-25 | Add per-worker CI jobs with suite floors |
| 11 | Worker rules-v4 checks only the preregistration hash's shape. | model_validation_core.py:102-103, 384; main.py:5329 | Verify against the file before any frozen rule ships |
| 12 | Worker lane records no OSM retrieval time; the network depends on live Overpass. | main.py:2903-2913, 3651-3705 | Record retrieval time and source; retain the network snapshot hash |
| 13 | Stale "not reachable" calibration docstring; the county calibration block self-labels `calibrated_to_counts`. | calibrate_to_counts.py:33-41; screening_runtime.py:1435 | Correct the doc; drop the tier from the block or use model_credibility |
| 14 | Python version and deploy-config drift (3.11 vs 3.12; Fly, Render and Railway files; unused ActivitySim image). | aequilibrae_worker/Dockerfile:1; hosted-models/Dockerfile:1 | One supported image per role; delete the rest |
| 15 | Duplicated worker infrastructure and `sys.path` coupling. | worker_heartbeat.py ×2; supabase_poll.py:46-48, 214-306 | Shared installable package |
| 16 | `main.py` monolith. | main.py:4281-5116, 5816-6994 | Split by stage |
| 17 | ODM in-memory jobs, against the M5b.2 durable-state requirement. | odm_worker/main.py:159-173, 436-447 | Reuse the OCR durable pattern |
| 18 | Five validation and instrument versions coexist. | workers/aequilibrae_worker/model_validation_core*.py; scripts/modeling/validation_instrument*.py | Mark superseded ones read-only |
| 19 | No committed prod-smoke output; README errors. | qa-harness/README.md | Record run evidence or delete the stale prod smokes |
| 20 | Territories beyond Puerto Rico get misleading count and LODES refusals; the gateway buffer is a fixed 0.03° and shrinks with latitude. | lodes.py:35-45; auto_counts.py:100-105; main.py:162 | Explicit "no federal source for this territory" message; buffer in meters |

## What is good

- Worker-lane claim logic only ever lowers a tier and explains why.
- Never-average is tested on output structure, not only on prose.
- The ActivitySim stock-configuration digest is rechecked before every run.
- A selected GTFS feed never silently falls back to another feed.
- Rules-v4 refuses to invent facts.
- Calibration is opt-in, holdout-gated and namespaced away from CEQA inputs.
- The preregistration digest is verified by the study runners.
- AequilibraE KPI writes are journaled.
- The hosted image rejects a numerically incompatible stack.
- Both supervisors fail fast.
- OCR durability is solid.
- CI test globs have floors so they cannot silently shrink.

## What I could not determine

- Railway watch paths, and therefore whether ordinary merges redeploy the model host mid-run (they live in the dashboard only).
- Whether LODES actually publishes Puerto Rico.
- Whether any stored county manifest lacks `screening_gate.reasons`. If one does, it would reach "Claim-grade passed".
- The hosted ActivitySim memory peak for counties larger than Nevada County.
- Contents of `data/modeling/activitysim-accepted-components.json` (not read, per the `data/` constraint).

Evidence tree used: `/home/nathaniel/.local/state/openplan-review-20261011/code-workers/tree/`. No scratch files were written.