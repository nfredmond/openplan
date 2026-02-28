# GIS Reliability Smoke Suite — OpenPlan v1

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

## Go/No-Go rule
No external decision packet should ship if any P0 remains unresolved.
