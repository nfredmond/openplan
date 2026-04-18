---
title: 2026-04-18 Modeling OS runtime design
date: 2026-04-18
phase: Phase E (forward-motion plan)
status: design-only
---

# 2026-04-18 Modeling OS runtime design

## What this is

Phase E of the 2026-04-18 forward-motion plan called for wrapping
Adrian's methodology scripts as OpenPlan runtime actions, plus
building a first geography-autoload / source-manifest flow. This
document records the honest current-state picture before any code
lands, so the plan's assumptions can be corrected where they were
stale.

## Headline finding

**The geography-autoload / source-manifest flow the plan asked for
already exists.** It is called "county onramp" in the product and
lives at `/county-runs`, backed by the `county_runs` table from
migration `20260324000134_county_onramp_runs.sql`. The plan's
instruction to build this from scratch was written against a stale
knowledge of the repo.

Key existing artifacts:

- **Schema** (`supabase/migrations/20260324000134_county_onramp_runs.sql`):
  `county_runs` with `geography_type` ("county_fips"),
  `geography_id`, `geography_label`, `manifest_json`,
  `requested_runtime_json`, `run_summary_json`,
  `validation_summary_json`, and a four-stage progression
  (`bootstrap-incomplete` → `runtime-complete` → `validation-scaffolded` → `validated-screening`).
- **UI** (`src/app/(app)/county-runs/page.tsx` +
  `src/components/county-runs/county-runs-page-client.tsx`, 251 LOC):
  form for county FIPS + label + prefix + run-name, list of active
  runs with stage badges, navigation into run detail.
- **API** (`src/app/api/county-runs/*`): POST creates a staged run,
  PATCH advances stages, manifest + scaffold + enqueue sub-routes.
- **Tests** (15+ files under `src/test/`):
  `county-onramp.test.ts`, `county-runs-route.test.ts`,
  `county-run-manifest-route.test.ts`, etc.

The product already supports: user selects a county FIPS → system
stages a run → manifest JSON accumulates → validation scaffold →
validated-screening. What it does NOT support is automatic TIGER
+ LODES + Census hydration from the user-facing form — the operator
supplies the FIPS and the backend materializes the manifest.

## Why the "wrap Python scripts as runtime actions" step does not fit

The plan proposed three runtime actions wrapping methodology steps:

- `validate_model_run` — would wrap `validate_screening_observed_counts.py`
- `improve_demand_fit` — would wrap `run_behavioral_demand_prototype.py`
- `fix_centroid_connectors` — no matching script exists; the
  closest candidates (`hydrate_assignment_geometry.py`,
  `screening_bundle.py`) handle different concerns.

These scripts are CLI tools operating on local fixture data
(`data/pilot-nevada-county/`, with a dedicated venv at
`data/pilot-nevada-county/.venv`). They are not safe to invoke
from the Next.js runtime because:

1. **No HTTP contract exists.** They read/write local SQLite
   (`project_database.sqlite`), CSVs, and Excel files. Next.js
   server actions cannot reach those paths in production.
2. **No modeling microservice is deployed.** Shelling out to
   Python from Vercel's serverless runtime is not viable and
   no separate modeling worker exists.
3. **No caller-safe output contract.** The scripts emit multi-
   gigabyte artifacts (shapefiles, parquet, geometry tiles) and
   write to local disk. Wrapping them as assistant quick-link
   actions would misrepresent what they do.

The correct architecture for productizing these is a dedicated
modeling worker (separate service) that owns the fixtures, not a
Next.js-resident runtime action. That is a multi-week undertaking
and is not this plan's scope.

## What is actually actionable in Phase E

Given the above, the achievable forward motion is:

### 1. Wire `/models` ↔ `/county-runs` navigation

The two surfaces are currently disconnected. A planner on `/models`
has no path to discover that county-staging exists. Add a link
from the models page to county-runs (and back) so the flow is
discoverable. This is a small UI change, not a new feature.

### 2. Document the county-onramp surface honestly in a visible README

There is no single-file entry point that explains what the county
onramp does, what it does NOT do (the Python methodology step), and
how a user should move from staging → scaffolded → validated. A
module-level README next to `src/app/(app)/county-runs/page.tsx`
would cut cold-start confusion.

### 3. Live proof: walk Nevada County through the existing onramp

Rather than building a new `/models/new` flow, use the existing
county-onramp flow on Nevada County (FIPS 06057) and produce a
proof doc capturing the stage progression, what the operator sees,
and what artifacts accumulate in `manifest_json`. This establishes
the "what can a user actually do today" baseline for future Python-
wrapping work.

## What is deferred

- **Python-methodology wrapping** — requires a dedicated modeling
  worker + deployment target. Not this plan.
- **Automatic TIGER/LODES/Census hydration** — requires the manifest
  builder to understand geographic containment and pull tract
  attributes from Supabase. Out of scope today; could land as a
  single POST sub-route later.
- **Outward modeling claims** — the 2026-03-23 lock still holds:
  "internal prototype only / not ready for outward modeling
  claims." Nothing in this Phase E work changes that.

## Truth-state discipline

This phase does not promote the platform from "internal prototype"
to "outward claim ready." The existing county-onramp is a staging
scaffold, not a validated planning deliverable. Any future
marketing (Phase I's 90% plan examples) that references modeling
outputs must carry the same limitation language as today.

## Pointers

- Forward-motion plan: `.claude/plans/eager-munching-spark.md` (local)
- Existing onramp schema: `supabase/migrations/20260324000134_county_onramp_runs.sql`
- Existing onramp client: `src/components/county-runs/county-runs-page-client.tsx`
- Adrian methodology scripts: `scripts/modeling/` (local-fixture tools)
- Nevada County fixture: `data/pilot-nevada-county/`
