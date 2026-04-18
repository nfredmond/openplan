---
title: 2026-04-18 Modeling live proof — Nevada County
date: 2026-04-18
phase: Phase E (forward-motion plan)
artifact_source: data/screening-runs/nevada-county-runtime-norenumber-20260324/
status: internal-prototype-only
---

# 2026-04-18 Modeling live proof — Nevada County

## What this proves

**Screening-grade model run exists, with honest validation against
observed counts.** The Nevada County runtime was built on
2026-03-24 by Adrian's Python methodology (`run_nevada_pilot_richer_lane.sh`)
and lives as a directory tree under `data/screening-runs/nevada-county-runtime-norenumber-20260324/`.
It is **not** proof that OpenPlan's `/county-runs` UI surface
executed anything. The two are currently disconnected (see
[2026-04-18-modeling-os-runtime-design.md](2026-04-18-modeling-os-runtime-design.md)).

## What actually ran

**Source:** `scripts/modeling/run_nevada_pilot_richer_lane.sh`
executed locally against `data/pilot-nevada-county/.venv/` and
wrote artifacts to `data/screening-runs/nevada-county-runtime-norenumber-20260324/`.

**Boundary:** Nevada County, California. FIPS 06057. Bounding box
-121.28, 39.01 to -120.00, 39.53. Area 973.8 sq mi.

**Zones:** 26 census-tract fragments, spanning state FIPS 06 (CA)
and 32 (NV — the Lake Tahoe slice that crosses the state line).
Totals: 102,322 population; 41,415 households; 45,064 worker
residents; 48,252 estimated jobs.

**Demand:** 628,262 total daily trips —

| Purpose | Trips |
|---|---|
| HBW (home-based work) | 45,064 |
| HBO (home-based other) | 225,108 |
| NHB (non-home-based) | 92,090 |
| External | 266,000 |

**Network:** 4,829 loaded links. Largest connected component
95.97% of the graph. All 26 zones connected.

**Skims:** 650/650 zone pairs reachable; average impedance 42.2
min; max 93.8 min.

## Validation vs observed counts

Validation script `validate_screening_observed_counts.py` compared
the loaded-link volumes against Caltrans 2023 priority AADT counts.

| Metric | Value |
|---|---|
| Stations matched | 5 of 5 |
| Median absolute percent error | 27.4% |
| Mean absolute percent error | 68.75% |
| Min APE | 4.1% |
| Max APE | 237.62% |
| Spearman rho (facility ranking) | 0.40 |

**Screening gate: `internal prototype only`.** The validator
rejected ready-posture because at least one core facility's APE
(237.62%) exceeds the 50% critical-facility threshold.

## Honest caveats (from validation_summary.json)

> - screening-grade only
> - OSM default speeds/capacities
> - tract fragments are not calibrated TAZs
> - jobs are estimated from tract-scale demographic proxies
> - external gateways are inferred from major boundary-crossing roads

These caveats are persisted in the artifact itself, not just in
commentary.

## Gap: what /county-runs does NOT surface

A user visiting `/county-runs` in OpenPlan today can:

1. Enter FIPS 06057, label "Nevada County, CA", prefix "NEVADA",
   run-name.
2. POST to `/api/county-runs` which inserts a `county_runs` row
   with `stage = 'bootstrap-incomplete'`.
3. Advance stages via the detail page (bootstrap → runtime-complete
   → validation-scaffolded → validated-screening).

What they CANNOT do today:

- Automatically trigger the Python pipeline that produced this
  2026-03-24 run.
- Read the screening-run artifact directory into the
  `manifest_json` column.
- Render the validation metrics above in the UI.
- Link a `county_runs` row to the `models` table.

**Implication.** The geography-first staging surface exists and
is well-tested (`src/test/county-onramp*.test.ts`, 15+ files). The
execution bridge to Adrian's Python methodology is the honest gap.
Wiring that bridge requires either (a) a modeling worker service
that ingests `county_runs.manifest_json` and emits the
screening-run artifact directory, or (b) an import path from the
artifact directory back into `county_runs.manifest_json` for
read-only evidence surfacing. Option (b) is much cheaper.

## Recommended next slice (not this phase)

A single POST route `/api/county-runs/[id]/import-artifact`
that takes a local-or-remote screening-run directory, parses
`run_summary.json` + `validation/validation_summary.json`, and
writes structured fields into `manifest_json` +
`validation_summary_json` on the matching `county_runs` row. The
validation metrics above would then render on `/county-runs/[id]`
as "screening gate: internal prototype only" with the caveats
preserved verbatim. No new Python execution — just artifact-to-DB
import.

That single route is the smallest step from "screening run
exists" (today) to "screening evidence is visible in the
product" (next). It honors the 2026-03-23 truth-state lock.

## What this does NOT prove

- **It does NOT prove the model is ready for outward claims.**
  Screening gate is explicitly `internal prototype only`.
- **It does NOT prove `/county-runs` ran the screening pipeline.**
  The screening ran via CLI, not via the Next.js API.
- **It does NOT prove production-grade calibration.** The zones
  are tract fragments, not calibrated TAZs.
- **It does NOT prove the methodology generalizes to other
  counties yet.** Only Nevada County has real validation evidence
  in the repo today.

Every one of the above is the correct shape of the integration-
discipline posture landed in the 2026-04-17 / 2026-04-18 retros:
state what is proven, state what is not, and do not let the
former imply the latter.

## Artifact pointers

- Screening run summary:
  `data/screening-runs/nevada-county-runtime-norenumber-20260324/run_summary.json`
- Validation summary:
  `data/screening-runs/nevada-county-runtime-norenumber-20260324/validation/validation_summary.json`
- Validation report (human-readable):
  `data/screening-runs/nevada-county-runtime-norenumber-20260324/validation/validation_report.md`
- Loaded-link geometry:
  `data/screening-runs/nevada-county-runtime-norenumber-20260324/run_output/loaded_links.geojson`
- Methodology entry point:
  `scripts/modeling/run_nevada_pilot_richer_lane.sh`
- Validation script:
  `scripts/modeling/validate_screening_observed_counts.py`
- UI counterpart (staging only, no execution):
  `src/app/(app)/county-runs/page.tsx`
- Design doc:
  `docs/ops/2026-04-18-modeling-os-runtime-design.md`
