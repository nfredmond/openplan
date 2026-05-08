---
title: OpenPlan modeling caveat KPI SQL gate proof
date: 2026-05-08
status: implementation proof
related_docs:
  - docs/ops/2026-05-01-openplan-modeling-caveat-gate-proof.md
  - docs/ops/2026-05-01-openplan-known-issues-register.md
  - docs/ops/2026-04-16-caveat-gate-audit.md
---

# OpenPlan modeling caveat KPI SQL gate proof

This slice closes the two May 1 modeling caveat issues:

- KI-M1: behavioral-onramp KPI consent was enforced only in TypeScript helper code.
- KI-M2: unknown county-run stage strings defaulted to non-screening.

Behavioral-onramp KPIs are now hidden from direct authenticated `model_run_kpis`
reads. The only normal read path is a fixed RPC that checks workspace membership
and requires explicit screening-grade consent until a future migration registers
a known non-screening county-run stage.

## Implementation

### SQL/RLS

New migration:

- `openplan/supabase/migrations/20260508000079_modeling_caveat_kpi_sql_gate.sql`

It adds:

- `model_run_kpis_source_shape`
  - `behavioral_onramp`: `county_run_id IS NOT NULL`, `run_id IS NULL`
  - all other KPI categories: `run_id IS NOT NULL`, `county_run_id IS NULL`
- a narrowed `model_run_kpis_select` policy that excludes
  `kpi_category = 'behavioral_onramp'` from direct authenticated `SELECT`
- `public.load_behavioral_onramp_kpis_for_workspace(p_workspace_id uuid, p_accept_screening_grade boolean)`
  - fixed return columns only
  - `SECURITY DEFINER`
  - `SET search_path = public, pg_catalog`
  - explicit `workspace_members` / `auth.uid()` membership check
  - returns behavioral KPIs only when consent is true or a future known
    non-screening stage is intentionally registered

The RPC intentionally uses an empty `v_allowed_non_screening_stages` list today.
Every current `county_runs.stage` value remains screening-grade.

### App Code

- `openplan/src/lib/models/caveat-gate.ts`
  - added `NON_SCREENING_GRADE_STAGES`
  - unknown, empty, whitespace-only, and unregistered stage strings now fail closed
- `openplan/src/lib/models/behavioral-onramp-kpis.ts`
  - loader still reads `county_runs` for rejected-run banner metadata
  - KPI rows are loaded only through `load_behavioral_onramp_kpis_for_workspace`
- `openplan/src/app/api/models/[modelId]/runs/[modelRunId]/kpis/route.ts`
  - rejects `kpi_category: "behavioral_onramp"` on the model-run KPI POST route
  - county-run manifest ingest remains the behavioral-onramp writer
- `openplan/scripts/seed-nctc-demo.ts`
  - now refreshes the same behavioral-onramp KPI cache as manifest ingest, so
    the seeded local NCTC demo exercises the consent UI with real KPI rows

## Tests Added / Updated

- `openplan/src/test/modeling-caveat-kpi-sql-gate-migration.test.ts`
  - locks direct-select RLS exclusion
  - locks source-shape constraint
  - locks RPC membership, consent, `SECURITY DEFINER`, grants, and pinned search path
- `openplan/src/test/model-run-kpis-route.test.ts`
  - proves model-run KPI POST rejects behavioral-onramp categories
- `openplan/src/test/caveat-gate.test.ts`
  - proves unknown/blank stage values fail closed
- `openplan/src/test/modeling-caveat-gate-stages.test.ts`
  - proves current county-run stages are screening-grade and synthetic certified stages require explicit registration
- `openplan/src/test/behavioral-onramp-kpis.test.ts`
  - proves the loader calls the RPC and preserves consent/rejection behavior
- `openplan/src/test/model-run-kpis-reader-inventory.test.ts`
  - inventories every app-side `model_run_kpis` caller
  - allows only run-id-scoped model-run reads, run-id cleanup, model-run writes,
    and the behavioral manifest writer
  - fails if a new direct behavioral-onramp reader appears outside the RPC path
- `openplan/src/test/seed-nctc-demo.test.ts`
  - proves the NCTC county-onramp manifest produces the six behavioral KPI rows
    used by the local demo seed

## Verification

From `openplan/`:

```bash
pnpm vitest run src/test/caveat-gate.test.ts \
  src/test/modeling-caveat-gate-stages.test.ts \
  src/test/behavioral-onramp-kpis.test.ts \
  src/test/modeling-caveat-kpi-sql-gate-migration.test.ts \
  src/test/model-run-kpis-route.test.ts \
  src/test/modeling-caveat-page-consent.test.tsx \
  src/test/modeling-caveat-section-copy.test.tsx
# Test Files  7 passed (7)
#      Tests  31 passed (31)

pnpm lint
# clean

pnpm test
# Test Files  261 passed (261)
#      Tests  1300 passed | 4 skipped (1304)

pnpm build
# passed
```

Follow-up guardrail checks:

```bash
pnpm vitest run src/test/model-run-kpis-reader-inventory.test.ts \
  src/test/seed-nctc-demo.test.ts \
  src/test/behavioral-onramp-kpis.test.ts
# Test Files  3 passed (3)
#      Tests  35 passed (35)
```

### Local Supabase Reset + Live Probe

```bash
pnpm supabase db reset
# Finished supabase db reset on branch main.
```

The reset applied `20260508000079_modeling_caveat_kpi_sql_gate.sql` cleanly.
Then a live Supabase probe seeded one workspace member, one county run, one
model run, one behavioral-onramp KPI, and one non-behavioral assignment KPI.

Authenticated member results:

```json
{
  "status": "passed",
  "checks": {
    "directAllCount": 1,
    "directAllCategories": ["assignment"],
    "directBehavioralCount": 0,
    "rpcNoConsentCount": 0,
    "rpcWithConsentCount": 1,
    "rpcWithConsentCategories": ["behavioral_onramp"],
    "rpcWithConsentNames": ["total_trips"]
  }
}
```

This proves the migration-level behavior, not only the static migration shape:

- direct authenticated `model_run_kpis` reads do not expose behavioral-onramp rows
- direct authenticated `kpi_category = 'behavioral_onramp'` reads return no rows
- the RPC returns no behavioral rows without consent
- the RPC returns behavioral rows with explicit consent
- non-behavioral KPI reads still work through the existing model-run RLS path

### Local Demo Seed + Browser Smoke

After the reset:

```bash
pnpm seed:nctc
# [seed:nctc] refreshed behavioral-onramp KPIs (6)
```

Then a headless Chrome smoke signed in as the local NCTC demo owner and loaded:

- `/county-runs/d0000001-0000-4000-8000-000000000005`
- `/county-runs/d0000001-0000-4000-8000-000000000005?includeScreening=1`

Observed result:

```json
{
  "status": "passed",
  "noConsent": {
    "behavioralSection": true,
    "refusalBanner": true,
    "productionOnly": true,
    "totalTripsVisible": false
  },
  "consent": {
    "behavioralSection": true,
    "includingScreening": true,
    "totalTripsVisible": true,
    "revertVisible": true,
    "emptyKpiState": false
  }
}
```

The consent view rendered six seeded KPI rows:

- Assignment final gap
- Jobs coverage
- Loaded links
- Population coverage
- Total trips (behavioral)
- Zones with activity

## Remaining Boundaries

- This proof does not introduce a production-grade behavioral modeling stage.
  Future non-screening stages must be added deliberately to both schema and gate
  logic.
- Service-role code remains trusted by design. The SQL gate is for authenticated
  client/app sessions and future normal app readers, not for bypassing service
  role.
