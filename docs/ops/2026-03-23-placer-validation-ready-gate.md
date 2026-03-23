# 2026-03-23 — Placer validation-ready gate

## Topic
Upgrade gate from the accepted **proof-only** Placer County screening/assignment checkpoint to a **validation-ready screening** lane.

## Exact artifact/package/run being referenced
Current proof checkpoint baseline:
- branch: `modeling/placer-proof-checkpoint`
- commit: `20f69a6`
- pilot root: `openplan/data/pilot-placer-county/`
- proof descriptor: `openplan/data/pilot-placer-county/run_output/evidence_packet.json`
- companion proof docs:
  - `openplan/docs/ops/2026-03-22-placer-county-salvage-blockers.md`
  - `openplan/docs/ops/2026-03-22-placer-proof-claim-boundary.md`
  - `openplan/docs/ops/2026-03-22-placer-proof-preservation-plan.md`

Accepted proof-only baseline facts:
- 92 zones
- 92/92 centroids reachable
- 8,372 / 8,372 reachable OD pairs
- 247,512 / 247,512 routable trips
- final relative gap `0.007612708357883145`
- mixed-source lineage explicitly preserved:
  - assignment network = OSM
  - package-generation lineage includes TIGER/Line

## Purpose of this gate
This gate does **not** ask whether Placer is already validated.
It asks whether the lane is ready to perform a meaningful, honest, screening-grade observed-count comparison.

Passing this gate means the lane is ready for validation work.
It does **not** mean the lane has already passed validation.

---

## 1) What must be true to move from proof-only to validation-ready screening

### A. The proof checkpoint must remain reproducible
Required:
- The preserved proof branch must rerun cleanly.
- The same basic proof facts must still be reproducible:
  - full centroid connectivity,
  - finite skims,
  - full routable proof demand,
  - evidence-packet export,
  - link-volume export.

Why:
- If the proof is not stable, validation results will be confounded by implementation drift instead of model behavior.

### B. Source lineage must stay explicit
Required:
- Every validation artifact must preserve the mixed-source truth:
  - assignment network = OSM
  - package-generation lineage includes TIGER/Line
- No validation memo, script, or table may blur those into a false single-source story.

Why:
- Validation credibility depends on honest provenance, not just numerical outputs.

### C. The validation comparison unit must be fixed
Required:
- Use a clearly defined comparison unit, recommended as **daily two-way volumes** for the first gate.
- If directional counts are used, either:
  - aggregate them to a compatible two-way daily figure, or
  - explicitly build and justify a directional comparison method.
- Do not mix daily, peak-hour, seasonal, and annualized counts without explicit normalization logic.

Why:
- The current proof demand is daily screening demand, so the first validation-ready comparison must use a compatible daily count basis.

### D. Count-link mapping must be explicit and reviewable
Required:
- Build a count-station mapping table that records, at minimum:
  - count ID,
  - source agency,
  - count year,
  - count metric type (ADT/AADT/etc.),
  - location metadata (coordinates and/or route/postmile),
  - mapped model link(s),
  - facility class,
  - inclusion/exclusion flag,
  - exclusion reason if dropped.
- Mapping must be manually spot-checked, not only nearest-link automated.

Why:
- Most validation failures in early screening lanes come from bad station-to-link matching rather than from the assignment itself.

### E. Minimum geography and facility coverage must exist
Required minimum posture:
- counts should cover more than one facility type and more than one geography segment of the county.
- at minimum, include a mix of:
  - freeway / major highway,
  - principal arterial / major county road,
  - western urbanized Placer,
  - foothill / rural Placer where available.

Recommended minimum scale:
- enough accepted count locations to avoid a single-corridor vanity check; as a practical floor, target roughly **20+ accepted stations** if the available data supports it.

Why:
- A validation-ready lane needs countywide screening credibility, not a cherry-picked corridor anecdote.

### F. Comparison outputs must be pre-defined before running validation
Required:
- Define the comparison table and summary metrics before looking at results.
- Minimum outputs should include:
  - observed volume,
  - modeled volume,
  - absolute error,
  - percent error,
  - model/observed ratio,
  - facility/geography segment,
  - inclusion/exclusion note.

Why:
- Predefining the comparison format reduces after-the-fact metric shopping.

---

## 2) Required observed-count inputs

For each count location used in the first validation-ready pass, require:
- unique station/count ID
- source agency name
- count year
- count date range or season note if available
- count metric type (`ADT`, `AADT`, short count, directional, etc.)
- count value(s)
- directional flag if directional
- location geometry or route/postmile metadata
- facility/road name
- inclusion/exclusion flag after QA

Preferred sources for the first Placer validation-ready pass:
- Caltrans count data where available on state facilities
- Placer County / local jurisdiction counts where available on county arterials and local major roads
- any local metadata that helps distinguish permanent counts from short-duration counts

Required metadata discipline:
- do not silently combine counts from different vintages or measurement types
- if vintage mismatch exists, disclose it explicitly
- if normalization is impossible, exclude the station rather than pretending comparability

---

## 3) Minimum comparison methodology

### Comparison basis
Use the first proof checkpoint as the fixed baseline and compare:
- modeled **daily** volumes
- against observed **daily-equivalent** counts

### Comparison workflow
1. Freeze the proof branch / package / scripts used for the validation pass.
2. Build a count-station mapping table.
3. Exclude ambiguous or incomparable stations with written reasons.
4. Compare only accepted stations.
5. Report results overall and by subgroup.

### Minimum subgroup reporting
At minimum, stratify by:
- freeway / highway vs arterial / other major roads
- western urbanized Placer vs foothill/rural Placer where the sample allows

### Minimum summary metrics
Recommended minimum summary set:
- count of accepted stations
- median absolute percent error
- weighted absolute percent error (or equivalent volume-weighted summary)
- share of stations within selected error bands (for example ±25% and ±40%)
- model/observed ratio distribution summary

Supplemental metric:
- GEH may be reported as a supplemental indicator, but should **not** be the sole pass/fail criterion for this daily screening gate.

### Manual review requirement
Require manual review of the worst mismatches before interpreting results.
The first question should be:
- bad model behavior,
- bad station mapping,
- incompatible count type,
- or county-edge / external-flow limitation?

---

## 4) Failure conditions

This gate should be considered **not passed** if any of the following remain true:

### A. Reproducibility failure
- the proof branch no longer reruns cleanly, or
- the rerun no longer reproduces the basic proof facts needed for comparison.

### B. Provenance failure
- source lineage is blurred or misstated, especially the OSM-vs-TIGER mixed-source posture.

### C. Count-input failure
- count data lacks enough metadata to establish comparability,
- count dates / types are too mixed to normalize honestly,
- or too few accepted stations remain after QA to support a county-level screening read.

### D. Mapping failure
- station-to-link matching is too ambiguous,
- a material share of stations require guesswork,
- or mapping decisions cannot be manually explained.

### E. Method failure
- no predefined summary table / metric set exists,
- inclusion/exclusion rules are changed opportunistically after seeing results,
- or comparison is reported without subgroup breakdowns or caveats.

### F. Claim-boundary failure
- the validation-ready memo or outputs imply calibration, validation success, behavioral realism, or client-ready forecasting before those are earned.

Important distinction:
- poor fit alone does **not** mean the lane was not validation-ready.
- poor fit means the lane reached validation and then revealed calibration or structural work still needed.

---

## 5) What claim becomes safe after this gate, and what remains unsafe

### Safe claim after passing this gate
If this gate is passed, the following claim becomes safe:

> OpenPlan has a **validation-ready screening assignment lane** for Placer County: a reproducible proof checkpoint, explicit source lineage, a documented observed-count dataset, a defensible count-link mapping process, and a predefined screening-grade comparison methodology.

That is a stronger claim than proof-only, but it is still **not** a validation-success claim.

### Still unsafe after passing this gate
Even after passing this gate, it remains unsafe to claim:
- calibrated assignment validity
- validation success
- behavioral realism
- client-ready forecasting capability
- project-level decision reliability without additional calibration and QA

Those claims require a later gate based on actual comparison results, explicit calibration work, and a client-safe interpretation memo.

---

## Recommended immediate next deliverables after this gate passes
1. Count inventory + mapping table for Placer
2. Validation comparison script / workbook / notebook
3. Validation memo with subgroup summaries and exclusions
4. Calibration-decision memo stating whether the lane is worth calibrating further

## Bottom line
The right next move is **not** more proof sprawl.
The right next move is to make the Placer lane genuinely **validation-ready**:
- stable,
- explicit,
- count-mappable,
- method-defined,
- and still disciplined about what is not yet earned.
