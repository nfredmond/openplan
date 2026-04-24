# Modeling evidence seed rollout proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Make the NCTC demo seed write the modeling evidence backbone rows so production demo data immediately exercises the county-run evidence reader after the approved migration is applied.

## What shipped

`scripts/seed-nctc-demo.ts` now adapts the frozen NCTC legacy bundle artifacts into the current `openplan.county_onramp_manifest.v1` shape and uses the shared modeling evidence helper to refresh assignment evidence for the deterministic demo county run.

The seed writes, idempotently:

- 4 source manifests: Census TIGER, Census ACS, OSM roadway network, observed count validation.
- 5 validation checks: final gap, count-station matches, median APE, critical-facility APE, facility-ranking Spearman rho.
- 1 assignment claim decision: `screening_grade`.

The claim remains screening-grade because the frozen validation summary records a `237.62%` critical-facility absolute percent error against the `50%` threshold.

## Safety posture

- The seed uses the same `refreshCountyRunModelingEvidence(...)` path as the manifest callback.
- Missing evidence schema is tolerated with a seed warning so older local environments can still seed the rest of the demo.
- Non-schema evidence write errors still fail the seed.
- The seed dry-run builds the evidence bundle without writing to Supabase.

## Files shipped

Modified:

- `openplan/scripts/seed-nctc-demo.ts`
- `openplan/src/test/seed-nctc-demo.test.ts`

## Gates

- `pnpm test src/test/seed-nctc-demo.test.ts src/test/modeling-evidence-backbone.test.ts`: 2 files / 26 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm seed:nctc -- --env-file .env.production.local --dry-run`: clean; builds `screening_grade` evidence with 4 sources and 5 checks.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 207 files / 1054 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean.

## Production steps

Approved production rollout follows this source commit:

1. Apply `20260424000069_modeling_evidence_backbone.sql` to Supabase project `aggphdqkanxsfzzoxlbk`.
2. Run `pnpm seed:nctc -- --env-file .env.production.local`.
3. Verify `modeling_claim_decisions`, `modeling_validation_results`, and `modeling_source_manifests` for county run `d0000001-0000-4000-8000-000000000005`.

This proof doc will be updated with live verification after the production steps complete.
