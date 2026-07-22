# Wave 2 — Pilot Hardening: live smoke + verification log

Date: 2026-07-22 · Session 2b53df13 · Branch: `main`

Wave 2 makes the any-place modeling path reliable for one real agency. This log
records what was verified **live** (against the local Supabase + a running
AequilibraE worker), complementing the unit/integration suite.

## What shipped (all on `main`, each independently gated)

| Slice | Commit | Summary |
|---|---|---|
| 2.4 | `e29351d8` | Oversized sketch runs auto-route to the AequilibraE worker instead of a hard 422 (non-silent, stamped). |
| 2.3 | `d4bb1a81` | Server-side stale-run reaper: stuck runs → truthful `failed`. Atomic `reap_model_run_if_stale` RPC + reconcile-on-read + cron. |
| 2.2 | `10a3b42d` | Run honesty & reproducibility header on the run-detail evidence panel (claim tier, transit_status, repro snapshot). |
| 2.5 | `b73eaead` | Worker metro-scale: BFS `deque` fix + fail-fast zone-count guardrail. |
| 2.6a | `214e539c` | Two any-place launch footguns (query-text prefill, hero expectation). |
| 2.6-sec | (this) | Reaper RPC lockdown: revoke EXECUTE from anon/authenticated (Supabase default-privilege grant). |

## Live environment

- Local Supabase `supabase_db_openplan` on :54321; `npm exec supabase db reset`
  applied all migrations incl. `20260722000004_reap_model_run_rpc` +
  `20260722000005_reap_rpc_lock_down`. `run-artifacts` bucket present.
- Worker: `.venv311/bin/python -u main.py` with SUPABASE_URL=local +
  SERVICE_ROLE + CENSUS_API_KEY from `openplan/.env.local`. (Run.sh relies on
  those env vars being exported; a wrapper that sources `.env.local` was used.)

## 2.3 reaper — verified live against real Postgres + triggers

Inserted three synthetic runs (triggers temporarily disabled to backdate
`updated_at`), called `reap_model_run_if_stale` as the app does
(`p_stale_before` = freshest progress at snapshot), then cleaned up:

- **(A) stale queued run, no progress 20 min** → `reaped=true`; run + stage
  flipped to `failed` with the actionable message. ✓
- **(B) fresh run (updated 1 min ago)** → `reaped=false`, stays `running` — the
  optimistic guard protects a progressing run. ✓
- **(C) race: run row old but a stage streamed a fresh `log_tail` 30s ago** →
  `reaped=false`, stays `running` — the `NOT EXISTS (stage.updated_at >
  p_stale_before)` clause catches the live worker. This is the exact TOCTOU an
  adversarial review flagged; **proven closed live.** ✓

## 2.6-sec — anon lockdown, caught live

`db reset` showed the reaper RPC still granted EXECUTE to `anon` +
`authenticated` (Supabase default privileges add them directly; `REVOKE … FROM
PUBLIC` doesn't remove them). An anon caller could have forced any run to
`failed`. Migration `20260722000005` revokes those roles; verified live:
`anon=false, authenticated=false, service_role=true`.

## 2.6 — Davis, CA end-to-end worker run (non-Nevada)

Real Davis city boundary fetched from TIGERweb (place GEOID 0618100, Yolo
County, bbox lon[-121.79,-121.68] lat[38.53,38.58] — **not** Nevada County).
Queued as an `aequilibrae` run; the worker claimed it and:

- Fetched Census tracts for the **Davis bbox** (no silent Nevada fallback):
  **18 candidate tracts across 1 county**, 18 populated retained.
- Employment: **18 tracts from LODES8 WAC 2022** (real data), 0 synthetic
  fallback.

Progressed setup → Network Assignment → **succeeded** (all three stages). KPIs:

| KPI | Value |
|---|---|
| population_total | 71,393 persons (real ACS) |
| daily_vmt (network) | 1,469,497 vmt/day |
| vmt_per_capita (network) | 20.58 |
| resident_vmt_per_capita | 5.45 |
| auto_mode_share_pct | 81.23 |
| transit_mode_share_pct | 0 |

**Honest labels (the never-overclaim mandate, live):**

- `transit_status = no_local_feed` — transit 0% is correctly a feed gap, not
  "no transit demand" (the bundled GTFS is Nevada County's; it doesn't cover
  Davis). This is exactly what the 2.2 run-honesty header now surfaces.
- Evidence-packet caveats: `Uncalibrated · OSM default speeds/capacities ·
  Through-traffic loaded at 7 boundary gateways (screening-grade) · Auto-only
  assignment; … transit 0 (GTFS feed no_local_feed) · Screening-grade`.
- No calibrated/claim-grade assertion (Davis has no local counts →
  `unvalidated`); the 2.2 header derives `screening_grade` from the engine.
- The 2.5 deque fix + zone guardrail did not affect correctness (18 tracts, far
  under the 4000-zone bound).

**Negative check — no silent Nevada fallback:** a corridor-less aequilibrae run
was claimed and failed honestly: `RuntimeError: This run has no study area. Set
a study area in the launch form (search or draw any US place, or paste corridor
GeoJSON)…` — never a default region.

Env left clean: worker killed, synthetic smoke rows deleted. (ComfyUI/
sage-attention PID untouched.)

## Not run autonomously (recommended manual check)

- The full **browser** flow (fresh email signup → dashboard first-run hero →
  create model → study-area search "Davis" → launch) — the any-place front door
  was already browser-verified live in Wave 1 (PR #99); this smoke drove the
  worker via the same run contract. A one-pass browser run is still worth doing
  before a real pilot.

## Ops follow-ups (non-blocking)

- Set `CRON_SECRET` in the Vercel project env so `/api/cron/reap-model-runs`
  authenticates (reconcile-on-read covers the viewer case regardless).
- The `20260722000004`/`…005` migrations deploy with the next `supabase db
  push` to any hosted DB.
