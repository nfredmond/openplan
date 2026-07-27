---
title: 2026-04-18 /examples evidence catalog — provenance note
date: 2026-04-18
phase: Phase I (forward-motion plan)
status: landed
---

# 2026-04-18 /examples evidence catalog — provenance note

This note pins the exact source data, the exact language, and the AI
disclosure for the public `/examples` page. If anyone edits that page
later, the content on it should still match this note. Drift = bug.

## Why this catalog is honest-first, not glossy

The 2026-03-23 OpenPlan truth-state lock reads: **"internal prototype
only / not ready for outward modeling claims."** The 2026-04-18
forward-motion plan originally scoped Phase I as a glossy "90% plan"
marketing artifact. Given the active screening gate (`internal
prototype only`) and the max APE (237.62%), producing glossy PDFs or
softened framing would violate the Nat Ford covenant.

Phase I pivoted to a transparency-first evidence catalog: one real
run, with its own caveats and screening gate displayed verbatim.

## Artifact used

- Source file: `data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/validation/validation_summary.json`
- Run ID: `nevada-county-runtime-norenumber-freeze-20260324`
- Engine: AequilibraE screening runtime
- Counts source: Caltrans 2023 priority counts (five-station subset)
- Artifact generated at: `2026-03-24T19:42:28Z`

## Numbers shown on the page (sources)

All numbers come directly from `validation_summary.json`:

| Shown on page                       | JSON path                                          |
| ----------------------------------- | -------------------------------------------------- |
| Stations total (5)                  | `stations_total`                                   |
| Stations matched (5)                | `stations_matched`                                 |
| Median APE (27.4%)                  | `metrics.median_absolute_percent_error`            |
| Mean APE (68.75%)                   | `metrics.mean_absolute_percent_error`              |
| Min APE (4.10%)                     | `metrics.min_absolute_percent_error`               |
| Max APE (237.62%)                   | `metrics.max_absolute_percent_error`               |
| Spearman ρ (0.40)                   | `metrics.spearman_rho_facility_ranking`            |
| Facility ranking table              | `facility_ranking[]`                               |
| Screening gate label                | `screening_gate.status_label`                      |
| Screening gate reason               | `screening_gate.reasons[0]`                        |
| Model caveats (5 bullets, verbatim) | `model_caveats[]`                                  |

## Verbatim strings (do not edit without updating this note)

### Screening gate label
`internal prototype only`

### Screening gate reason
`At least one core facility has 237.62% absolute percent error, above the 50.00% critical-facility threshold.`

### Model caveats
1. `screening-grade only`
2. `OSM default speeds/capacities`
3. `tract fragments are not calibrated TAZs`
4. `jobs are estimated from tract-scale demographic proxies`
5. `external gateways are inferred from major boundary-crossing roads`

## AI disclosure language (Nat Ford covenant)

The page carries this disclosure, consistent with the covenant's
"responsible AI use" clause:

> AI accelerates drafting, data cleaning, and QA. Client-critical
> conclusions require qualified human review.

## What the page deliberately does NOT do

- No PDF generation. A PDF invites softening; the page keeps the hard
  numbers in place.
- No "90% plan" framing. The actual artifact is screening-grade, not a
  90% plan, and the page says so.
- No paraphrasing of caveats. Bullets are lifted verbatim from
  `model_caveats`.
- No hiding of the max APE. 237.62% is rendered in the metrics table
  with a note that it is above the 50% critical-facility threshold.
- No outward modeling claim. The gate `internal prototype only` is
  displayed as written.

## Cross-reference

The full internal operator-facing proof doc for this run is:
`docs/ops/2026-04-18-modeling-nevada-county-live-proof.md`.

If the numbers on `/examples` ever conflict with that proof doc or
with `validation_summary.json`, the JSON artifact is the authority —
the page and the proof doc should be corrected to match.

## Page artifact pointers

- Public route: `src/app/(public)/examples/page.tsx`
- Homepage link: `src/app/(public)/page.tsx` (`publicSurfaces[0]`)
- This note: `docs/marketing/2026-04-18-evidence-catalog-provenance.md`
