# GIS Reliability Smoke Suite — OpenPlan v1

- **Updated (PT):** 2026-02-28 02:20
- **Owner:** Priya
- **Status:** Active draft

## Goal
Catch geospatial failures before demos, council packets, or pilot operations.

## Smoke checks (run in sequence)
1. **Layer availability check**
   - Can all canonical layers be queried?
2. **CRS + geometry sanity check**
   - Any invalid geometries or CRS mismatches?
3. **Core analytics query check**
   - Baseline safety/ADA metrics compute successfully?
4. **Map render check**
   - Standard map set renders without tile/style failures?
5. **Export check**
   - PDF/PNG/CSV export paths complete with no schema errors?
6. **Performance threshold check**
   - Queries/renders stay under agreed response time budget?

## Current v1 implementation mapping
- **Layer availability:** partial (runtime source modules available; canonical GIS layer tables not complete).
- **CRS + geometry sanity:** partial (shape-type validation exists; CRS hard gate missing).
- **Core analytics query:** available via `/api/analysis` + test suite coverage.
- **Map render:** covered by production build pass (Next.js map stack compile).
- **Export:** covered by `export-download` tests; council pack export workflow still partial.
- **Performance:** basic baseline from build/test runtime; query SLOs not fully enforced yet.

## Failure severity
- **P0:** blocker for leadership/client use
- **P1:** degraded quality, usable with caveat
- **P2:** cosmetic/non-blocking

## Required run log
- timestamp
- env (dev/preview/prod-like)
- pass/fail by step
- error snippets
- mitigation owner + ETA

## Baseline thresholds (v1)
- `npm run test` must pass 100% (no failed tests).
- `npm run build` must complete with no errors.
- `npm run lint` may allow warnings, but **0 errors**.
- API smoke route tests must pass (`analysis`, `report`, `runs`).
- Any council packet export with unresolved P0 => automatic **NO-GO**.

## Initial smoke run (kickoff)
- **timestamp:** 2026-02-28 02:15 PT
- **env:** local dev

| Step | Result | Notes |
|---|---|---|
| Layer availability | ⚠️ Partial | Runtime source modules present; canonical pilot layers incomplete |
| CRS + geometry sanity | ⚠️ Partial | Polygon/MultiPolygon gate exists; explicit CRS harmonization missing |
| Core analytics query check | ✅ Pass | API test suite and analysis route validation coverage present |
| Map render check | ✅ Pass | `npm run build` successful |
| Export check | ✅ Pass | export route tests pass |
| Performance threshold check | ⚠️ Partial | No hard SLO gates yet for geospatial query latency |

## Top infra risks + immediate mitigations
1. **Risk:** Missing canonical pilot GIS layers (P0 for council-grade output).
   - **Mitigation:** Define/persist canonical layer registry and quality flags before council analytics release.
2. **Risk:** CRS ambiguity in uploaded geometries.
   - **Mitigation:** Add explicit WGS84 assertion + coordinate range check at ingest.
3. **Risk:** Mixed source fallback behavior can reduce confidence without explicit caveats.
   - **Mitigation:** Require source/confidence metadata in every metric export and map footer.

## Go/No-Go rule
No external decision packet should ship if any P0 remains unresolved.
