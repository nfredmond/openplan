# Grants analytics lane: benefit-cost + TDM screening (shipped 2026-07-17)

## What shipped

A screening-grade benefit-cost analysis engine and a TDM strategy catalog, surfaced as a
"Benefit-cost screening" worksurface on `/grants`. Zero schema changes — everything computes
client-side from operator inputs plus rows the grants page already loads, and the deliverable
is a downloadable markdown memo.

- `src/lib/bca/` — pure BCA engine: NPV/BCR/IRR (Newton + bisection fallback) / discounted
  payback, per-category benefit streams (travel time, safety by crash severity, emissions,
  vehicle-operating, other), cost streams (capital spread, escalating O&M), a **real**
  sensitivity analysis (recomputes, unlike the harvest source), and a **seeded** Monte Carlo
  uncertainty screen (mulberry32; reproducible; sample sd; interpolated percentiles;
  P(BCR ≥ 1) / P(NPV > 0)). CO2 discounts at its own (lower) rate per current federal practice.
  Defaults: 3.1% real discount (revised OMB Circular A-94), 20-year horizon. Every monetization
  default carries a source note; approximate values say so explicitly.
- `src/lib/tdm/` — 14-strategy TDM catalog (keys/percentages harvested from transitscore-3d,
  re-labeled with honest CAPCOA-range source notes; no fabricated measure IDs) with
  multiplicative-dampening combination (no additive inflation, no silent cap — a >30% combined
  reduction sets a review flag instead), VMT application that refuses to estimate a missing
  base (`InsufficientDataError`), and lbs→metric-ton GHG conversion.
- `/grants` panel — `GrantsBcaScreeningSection` + `BcaScreeningBody` (CEQA-screen three-layer
  pattern): project selector prefills capital cost from `project_funding_profiles.
  funding_need_amount` with a provenance note; TDM disclosure derives a VMT reduction and
  writes it into the benefit input only on an explicit operator action; determination block
  with verbatim `BCA_SCREENING_CAVEAT`; memo download stamped with engine version and, when
  run, the Monte Carlo seed.
- Program catalog: optional `bcaNote` on `GrantProgramCatalogEntry`, populated for HSIP /
  BUILD (RAISE) / INFRA, rendered as a "Benefit-cost" row.

## Provenance and deliberate divergences

Re-implemented from formulas, not ported code. The harvest sources and the defects that were
fixed rather than carried:

- **DOT-Dashboard `src/lib/benefit-cost-service.ts`** (Apache-2.0): fake sensitivity analysis
  (scaled BCR by the adjustment factor without recomputing), IRR declared but never computed
  (and NaN on gap years), payback returning null for immediately-profitable projects,
  Monte Carlo reading `param.most` while the type declared `mode`, unseeded `Math.random`,
  population sd, BCR = 0 when costs are 0 (now `null`), input mutation, dead parameter tables.
- **transitscore-3d `lib/tdmCalculations.ts` / `lib/vmtCalculations.ts`**: additive percentage
  summing plus a site-context bonus that double-counted walk/bike, `enabled` UI state baked
  into catalog data, two consumers disagreeing on combination math, uncited "CARB guidelines"
  claims (now labeled screening defaults), silent 60% cap (now a review flag).

## Tests

103 new tests: `bca-engine` (31), `bca-monte-carlo` (11), `bca-render` (12), `tdm-catalog` (9),
`tdm-engine` (22), `grants-bca-screening` (9, incl. a memo-deps regression), plus a `bcaNote`
assertion in `grants-program-catalog`. Provenance headers in each test file name the harvest
source and the fixed defects; goldens are hand-computed with the arithmetic in comments.

## Not done yet (deliberate)

- **No persistence, so no narrative-fact integration**: BCA results cannot feed the
  `[fact:N]` narrative-draft route until they persist somewhere server-readable. When wanted:
  follow the `report_artifacts.metadata_json` pattern (parse defensively like
  `parseStoredComparisonSnapshotAggregate`) and append claims in the narrative route's
  `buildNarrativeFactList` call; `bcaFactBlocks()` in `src/lib/bca/render.ts` already emits
  the blocks. Also worth adding then: a fifth `bca-support` evidence-readiness cue.
- **Parameter refresh cadence**: defaults are labeled with dollar years; when USDOT publishes
  updated BCA guidance values, update `src/lib/bca/parameters.ts` and its source notes in one
  place.
- Freight/reliability benefit categories, KABCO-severity crash breakdown, and Cal-B/C-style
  state-programming outputs are natural v1.2 extensions of the same engine.
