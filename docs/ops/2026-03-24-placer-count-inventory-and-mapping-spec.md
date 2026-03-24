# 2026-03-24 — Placer count inventory and mapping spec

## Topic
Canonical spec for the first Placer County observed-count inventory and station-to-model-link mapping table used to move the preserved proof checkpoint toward **validation-ready screening**.

## Exact artifact/package/run being referenced
Validation baseline:
- branch: `modeling/placer-proof-checkpoint`
- commit: `20f69a6`
- upgrade gate branch: `modeling/placer-validation-gate`
- gate memo: `openplan/docs/ops/2026-03-23-placer-validation-ready-gate.md`
- proof package root: `openplan/data/pilot-placer-county/`

This spec creates the canonical first-pass inventory template at:
- `openplan/data/pilot-placer-county/validation/placer_count_inventory_template.csv`

## Purpose
This file spec is designed to do two things at once:
1. inventory candidate observed-count stations for Placer County, and
2. preserve a reviewable mapping path from each accepted station to one or more modeled assignment links.

The goal is not to make validation look easy.
The goal is to make the first screening-grade comparison **auditable**.

## Modeling truth posture
This inventory exists for a **screening assignment** lane, not a behavioral-model lane.
It should therefore preserve enough metadata to answer the following questions honestly:
- Is this count actually comparable to the proof run?
- Is this station mapped to the right modeled facility?
- If the comparison looks bad, is the problem model behavior, station mapping, metric mismatch, or data quality?

## Required columns

### A. Count identity and provenance
- `count_id`
  - stable local identifier for the row
- `source_agency`
  - e.g. `Caltrans`, `Placer County`, `City of Roseville`, `City of Rocklin`
- `source_dataset`
  - human-readable dataset name or workbook/table name
- `source_year`
  - count year used for comparison
- `source_file`
  - local filename / URL slug / workbook sheet identifier
- `source_notes`
  - any provenance detail needed to explain the row later

### B. Count measurement definition
- `count_metric_type`
  - e.g. `AADT`, `ADT`, `short_count`, `directional_daily`, `peak_hour`
- `count_value`
  - numeric observed value as stored for the chosen comparison basis
- `count_value_units`
  - e.g. `vehicles_per_day`
- `directionality`
  - `two_way`, `ab_only`, `ba_only`, `unknown`
- `normalization_status`
  - `native_daily`, `converted_to_daily`, `not_normalized`, `unknown`
- `normalization_method`
  - brief method note if conversion was required
- `season_note`
  - optional season / date-range note

### C. Station location and facility description
- `facility_name`
  - canonical road/facility name
- `cross_street_or_desc`
  - cross street, junction, or count description
- `route_number`
  - route number where applicable
- `postmile_or_ref`
  - postmile / milepost / engineering ref if available
- `longitude`
- `latitude`
- `geometry_confidence`
  - `exact`, `approximate`, `route_postmile_only`, `unknown`
- `facility_class`
  - `freeway`, `highway`, `arterial`, `collector`, `other`
- `geography_segment`
  - recommended values: `western_urban`, `foothill_rural`, `north_county`, `south_county`, `other`

### D. Model-link mapping fields
- `mapping_status`
  - `unmapped`, `candidate`, `accepted`, `excluded`
- `mapping_method`
  - e.g. `nearest_link`, `manual_bbox_name`, `route_postmile_manual`, `multi_link_sum`
- `candidate_model_names`
  - pipe-delimited candidate road/link names used in matching
- `bbox_min_lon`
- `bbox_min_lat`
- `bbox_max_lon`
- `bbox_max_lat`
- `mapped_link_ids`
  - pipe-delimited model link IDs if accepted
- `mapped_link_count`
  - number of modeled links used for the comparison
- `mapping_confidence`
  - `high`, `medium`, `low`
- `mapping_notes`
  - why the mapping is believed to be acceptable

### E. QA / inclusion fields
- `include_in_validation`
  - `yes`, `no`, `tentative`
- `exclude_reason`
  - required when excluded
- `comparison_priority`
  - `priority`, `secondary`, `reserve`
- `reviewed_by`
  - initials or name
- `review_status`
  - `unreviewed`, `reviewed`, `needs_followup`

## Minimum inventory rules

### Rule 1 — no silent comparability assumptions
If the count is not obviously daily and two-way comparable, fill:
- `normalization_status`
- `normalization_method`

If you cannot explain the normalization honestly, exclude the station.

### Rule 2 — no silent mapping guesses
If a link match requires guesswork, mark:
- `mapping_confidence = low`
- `include_in_validation = tentative` or `no`

### Rule 3 — preserve county coverage intentionally
Try to inventory stations that support a useful county screening read:
- state highway / freeway facilities
- major arterials / county roads where available
- western urbanized Placer
- foothill/rural Placer

### Rule 4 — keep exclusion decisions reversible
Do not delete weak stations from the inventory.
Keep them in the table and exclude them with a reason.

## Recommended first-pass source order
1. Caltrans state-facility counts for Placer County
2. Placer County counts on major county roads
3. major city counts (Roseville, Rocklin, Lincoln, Auburn) if accessible and mappable

## Recommended first-pass workflow
1. Load candidate counts into the inventory template.
2. Standardize measurement types and mark normalization status.
3. Geocode / confirm coordinates or route references.
4. Add candidate model names + loose bounding boxes for first mapping pass.
5. Accept / exclude stations with written reasons.
6. Freeze the accepted subset before computing metrics.

## Safe use of this inventory
Safe to say after populating this template well:
- OpenPlan has a documented count inventory and mapping structure for Placer validation work.

Not safe to say from the inventory alone:
- Placer is validated
- model fit is acceptable
- calibration is complete
- forecasting claims are client-ready

## Bottom line
This file is the control surface for moving from **proof-only** to **validation-ready**.
If it is sloppy, the validation result will not mean much.
If it is disciplined, even a bad fit result will still be methodologically useful.
