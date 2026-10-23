# S1 count observation intervals remain unavailable for S2

Date: October 23, 2026. Base: `e7e9cd1b43fa25e6ebf82572cc763a09435a2356`.
Branch: `work/s1-count-observation-uncertainty`.

**Result: zero of the 337 retained S2 matched observations receives an interval.**
All 337 lack the collection-process metadata and interval evidence needed to
select a station error model. The implementation now records those refusals
and accepts documented intervals when a new study supplies the required facts.
It changes no default score, evidence grade, frozen study record, or acceptance
threshold. S1 and S3 remain incomplete.

## The implemented models require source evidence

The [primary-source research](COUNT_OBSERVATION_ERROR_MODELS_2026-10-23.md)
separates station intervals, population error distributions, factor-group mean
precision, and acceptance tolerances. Its proposed names are research labels.
The implemented IDs are:

| Error-model ID | Calculation and admission |
|---|---|
| `source-published-aadt-bounds.v1` | Retain a documented 95 percent station-AADT interval. Require exact observation/source bindings, quantity dimensions, count-process metadata, accepted QA, citation/page locator, covered error components, and verified applicability. Supported count types are continuous, short-duration, estimated, and modeled. Derived records also require an estimation method and independence from the evaluated model. |
| `source-calibrated-aadt-relative-error-quantiles.v1` | For short-duration counts, invert source-calibrated 2.5th/97.5th error quantiles: `lower = observed / (1 + q975)`, `upper = observed / (1 + q025)`. Require the source convention `(estimate-reference)/reference`, matching duration, factor-group ID and assignment method, a calibration artifact hash and sampling design. Quantiles must straddle zero and exceed -1 at the lower endpoint. |
| Explicit unavailable state | Return `bounds: null`, a primary reason, and all applicable reasons. Do not substitute a national percentage, a sensor tolerance, a factor-mean confidence interval, or zero uncertainty. |

The quantile arithmetic follows the error definition in `KRILE15-SHORT`,
FHWA-PL-16-008, pp. 8–13. Table 4, p. 19, reports conditional distributions by
duration and factor method. Its national values are **not** installed as
station defaults. Transfer requires separate observation-based evidence.
[Krile, Todt, and Schroeder, 2015](https://www.fhwa.dot.gov/policyinformation/travel_monitoring/pubs/aadt/aadt_task_3_final_report_nov_2015.pdf#page=26)

The published-bounds path implements preservation and validation of a source
interval, not a new statistical estimator. TMG's factor-group mean formula and
Table 3-3 do not supply a station interval. Complete-year temporal census error
can be zero while sensor error remains unknown. Estimated or modeled AADT has
no generic error percentage. See research citation IDs `TMG22-FACTOR-MEAN`,
`TMG22-CONTINUOUS`, `TMG22-REFERENCE-TABLE`, and `TMG22-METHOD-CODES`.

No real station-calibration record is adopted in this change. Numeric available
fixtures are explicitly synthetic. The software verifies record bindings and
arithmetic. A `source_verified` field cannot authenticate a publisher, validate
transfer, establish calibrated coverage, or prove independence by itself.
Those are documented source-review responsibilities before preregistration.
An interval's `error_components` names its scope; it does not imply that all
measurement, processing, expansion, and sensor errors are covered.

## What each supported source actually supplies

This table describes the inspected adapters' output, not every field a publisher
might offer through another service. Existing adapters and frozen records stay
unchanged. New, supported facts must enter a successor observation package.

| Source | Facts carried by the existing pipeline | Missing facts relevant to interval selection |
|---|---|---|
| Caltrans state feed | Back/ahead AADT, route/postmile, description, location; descriptor year 2023. Compatibility rows state two-way AADT. The S2 rows retain the historical `max(back,ahead)` convention. Current v1 preparation leaves conflicting sections ambiguous. | Collection type, dates/duration, count/factor year distinction, factor group and method, station QA, lane/carriageway scope, vehicle-class code, interval evidence. Section-choice uncertainty is not count-sampling uncertainty. |
| WSDOT state feed | AADT, route/milepost, location text and geometry. | The descriptor does not map a count year. Collection type, duration, factors, QA and intervals are also unmapped. |
| CDOT state feed | AADT, route/section identity and count-station description; segment geometry reduced for compatibility matching. | The descriptor does not map a count year. The S2 Colorado CSV rows contain blank years. Collection type, duration, factors, QA and intervals are unmapped. |
| ODOT state feed | AADT, highway/route, milepoint, location and source-specific facility interpretation. | Count year, collection type, duration, factors, QA and interval evidence are unmapped. |
| HPMS 2024 Socrata `42um-tgh5` | `aadt`, `aadt_d`, `year_record`, facility/functional class, route/section, geometry and source update time. `aadt_d` is collection date; record year is a different fact. | The inspected public schema has no AADT A–E source/method code, count duration, factor-group ID/method, or station interval. Lane counts and truck-AADT fields exist upstream but the current normalization does not establish the observed lane/class scope from them. |
| FHWA TMAS 2024 | Station/direction/lane keys, year/date and 24 hourly fields, station `method_volume`, lane counts, and exact archive/member hashes. Monthly normalization retains complete-day count, `method_volume`, optional `sample_type_volume`, and direction/lane values. | The normalized statistic is `available_complete_days_in_month`, not AADT. Monthly completeness is not annual coverage. `complete_days_only` QA is not sensor calibration or missingness validation. No annual error model, station interval, or complete vehicle-class/hemisphere interpretation follows automatically. |
| Retained compatibility CSV | Source agency, statistic label `count_type=AADT`, published year where mapped, direction, point value and matching fields. | `AADT` names the statistic, not continuous versus short-duration collection. The CSV cannot reconstruct omitted process metadata or independent interval evidence. |

Code anchors: `scripts/modeling/count_sources.py`, `hpms_count_source.py`,
`tmas_count_source.py`, `development_validation_sources.py`, and
`validation_instrument.py`. This task reads but does not modify those adapters.

The [HPMS schema audit](../../data/modeling/s1-count-uncertainty-2026-10-23/hpms-metadata-audit.json)
retains the full field-name inventory, selected definitions, retrieval date and
metadata-response hash. Only public schema metadata was fetched, not new count
observations. [Publisher schema](https://data.transportation.gov/api/views/42um-tgh5)

HPMS program metadata includes `AADT_Pct_Actual`, `AADT_24`, `AADT_48`, seasonal,
weekday and growth adjustments, and travel-source/type categories. The duration
items count locations in a reporting group; they are not a station's duration.
Do not attach them to every section as individual facts. `facility_type` names
a roadway configuration, not an AADT collection method.
[FHWA HPMS Field Manual, Chapter 3, metadata table](https://www.fhwa.dot.gov/policyinformation/hpms/fieldmanual/page03.cfm)

TMG reporting codes A/C identify government/private derivations from actual
counts; B/D identify alternative derivations; E identifies other methods.
Neither A nor C distinguishes a complete-year census from a short count.
The inspected Socrata descriptor does not expose these codes. A future adapter
must identify the actual field and code-system edition before mapping them.
[FHWA TMG, section 5.3, pp. 5-8–5-9](https://rosap.ntl.bts.gov/view/dot/74643/dot_74643_DS1.pdf#page=264)

## Opt in before freezing a successor study

`workers/aequilibrae_worker/count_observation_uncertainty.py` exposes two pure
functions. Neither opens files, downloads data, changes an input object, or
reads model outputs:

```python
annotated = attach_observation_interval(observation, evidence_bytes)
result = uncertainty_residual(
    observation, modeled_value, comparison_dimensions,
    evidence_bytes=evidence_bytes,
)
```

`attach_observation_interval` adds `observation_uncertainty` to a copy. It leaves
`estimate.center`, `estimate.source_supported_bounds`, evidence grade and
match lineage unchanged. Existing graders therefore retain their behavior.
It binds the annotation to canonical observation SHA-256, source-artifact
SHA-256, exact evidence-byte SHA-256, error-model ID and citation ID. Existing
annotations are not trusted; the function recalculates them from evidence.

An evidence JSON object uses `openplan.count-interval-evidence.v1`. Required
fields are `observation_sha256`, `source_artifact_sha256`, `dimensions`,
`measurement`, `citation` (`id`, `url`, `title`, `locator`), `review_status`,
`interval_scope`, `coverage_probability`, `applicability`,
`independent_of_evaluated_model`, `error_components`, and `error_model_id`.
The published path adds `bounds`; the quantile path adds
`relative_error_quantiles`, `error_definition`, and `calibration`.
[Executable synthetic examples](../../scripts/modeling/tests/test_count_observation_uncertainty.py)
show the exact fields. They are examples of the contract, not scientific data.

Collection process uses `measurement.count_type`. Continuous and short-duration
records require dated duration consistent with the observation year. Continuous
records name the missing-data method. Short-duration records name seasonal,
weekday and axle treatment plus factor group and assignment method. Estimated
and modeled records name their estimation method. Missing metadata yields an
unavailable state instead of type inference from agency or traffic volume.

Residual analysis requires exact year, day basis, period, direction, lane,
carriageway, vehicle unit and vehicle-class equivalence. There is no year-growth,
PCE, lane, weekday, daily-to-hourly or directional conversion in this module.
Raw signed residual and APE remain separate. Excess error is distance outside
the interval; excess APE uses the original observed center. Zero center keeps
percent error unavailable. Zero modeled traffic stays in the analysis.

`model_validation_core_v5.assess_validation_with_uncertainty` provides the
explicit existing-pipeline entry point. It calls the unchanged rules-v5
assessment and appends `uncertainty_analysis`. Callers pass evidence by
observation ID and frozen `uncertainty_comparison` dimensions in each basis
fact row. All original metrics and outcomes stay identical.

Rules-v5 currently requires `synthetic_expanded_daily_traffic`. The wrapper
therefore refuses AADT residuals with `model_quantity_not_aadt`, even if a caller
claims matching dimensions. This is an intentional boundary, not a substitute
for implementing a genuinely annual-average model basis. A separately authorized
S3 successor may call the pure residual function with its supported quantity
and frozen evidence. No current source or synthetic test proves that successor's
scientific admissibility.

## Retained-input coverage, without rescoring S2

The audit pins PR #375's corrected CPython 3.11 input registry:
`9ad0ff220af4b8c97c8bf9c046196dec738c54dfae02d93f7b7b9380e9e276ab`.
It verifies archive `3fcf016c4ba7604fff07851a274e7af225c6cfc3a879c81002ee1ff580afba95`.
It reads only five `counts/published_counts.csv` and five retained network
members. It never opens assignment CSVs, skims, results, held-out partitions or
consumed partition sources. The authorized inputs are the original five
S2 development counties. The research above accesses no study outcomes.

The input-only selector reproduces the existing station eligibility and shared
link keeper rule, using zero placeholder network volumes. Synthetic parity
checks compare it with the existing scorer at multiple artificial volumes.
The audit itself calls no residual scorer. It does not revise matching or
endorse the historical shared-link 30 percent rule as measurement precision.

| Development county | Retained rows | Matched rows | Available intervals | Primary reason: collection type unavailable | Missing year, additional reason |
|---|---:|---:|---:|---:|---:|
| Merced | 105 | 78 | 0 | 78 | 0 |
| San Benito | 27 | 18 | 0 | 18 | 0 |
| Tulare | 182 | 140 | 0 | 140 | 0 |
| Broomfield | 21 | 21 | 0 | 21 | 21 |
| Pueblo | 85 | 80 | 0 | 80 | 80 |
| Total | 420 | 337 | 0 | 337 | 101 |

Nonexclusive reasons also include interval evidence unavailable, unknown lane,
unknown carriageway, unknown vehicle-class code, and unproved QA, each for all
337 matched rows. Duration and factor-method metadata are absent in every
retained CSV schema; they cannot be selected conditionally until collection type
is known. The 83 remaining rows stay accounted for: 44 ambiguous shared-link
rows, 22 merged rows and 17 unmatched rows. No bad residual determines exclusion.

The [coverage record](../../data/modeling/s1-count-uncertainty-2026-10-23/retained-input-coverage.json)
retains every matched source-row hash, reason, member hash and denominator.
It reports zero output files opened and zero residuals computed. The audit
network copies retain their original hashes after reading.

## Verification and limits

A fresh local CPython 3.11.15 virtual environment installs both repository
requirement files. Resolved numerical versions include AequilibraE 1.6.2,
NumPy 2.0.2, pandas 2.3.3 and SciPy 1.17.1. Installation, the coverage audit,
mutation campaign and scoped suite runner use a systemd user scope with
`MemoryMax=6G` and `MemorySwapMax=0`. No assignment runs.

- All 27 scoped Python suites pass. The 20 unittest-reporting suites run 177
  tests, including 57 new tests. Seven direct-script suites also pass; their
  retained outputs report individual checks or all-test completion. No suite
  reports a skip. This is not a count of the full repository test suite.
- Mutation proof: two harmless full-suite survivors and 56 intended assertion
  failures. No skipped or masked controls. Mutations operate on temporary
  copies; original module, wrapper and audit bytes remain unchanged.
- The first mutation attempt stops before execution because its `SCHEMA`
  anchor matches twice. The second runs one harmless survivor, then stops on a
  temporary-copy import-path error in the coverage test. Neither earns mutation
  credit. The third completes the campaign. Their records remain in the
  [verification directory](../../data/modeling/s1-count-uncertainty-2026-10-23/).
- `npm run product:direction:check` passes with existing review-age reminders.
  It is not a new whole-product review. `git diff --check` passes.

The controls test metadata refusals, evidence/citation bindings, count duration
and year, factor calibration, quantile denominator, raw versus excess arithmetic,
all eight comparison dimensions, grade/default preservation, and audit custody.
Their blind categories are source truth, empirical interval coverage, factor
transfer, model independence, genuine AADT production, and untouched acceptance.
The research retains `[VERIFY]` for unavailable peer-reviewed rendered pages,
equations and station-level supplemental evidence. No unverified number enters
an interval model.

Full app QA, browser, hosted services, live databases and the full worker matrix
are unexecuted. The task forbids `next build`; none runs. Docker stacks,
production, Vercel, Railway and managed Supabase remain untouched. No secrets,
paid source, scalar fitting, model averaging, threshold change or tier promotion
occurs. The draft is not a release or a completed S1/S3 claim.

## Lead decisions

Keep unknown intervals visible. Select an observation-evidence acquisition lane
that can provide station QA, dated count/factor metadata and valid interval
coverage. Do not rehabilitate S2 with national reference ranges. Approve any
local empirical calibration and a genuinely comparable annual model basis as a
separate preregistered study before new outcome access. Bind this evidence
contract into S3's successor protocol before using interval residuals for any
acceptance decision. This change requests no paid data or new study execution.

## Reproduction

Use a new local environment; do not reuse or change a frozen study environment.
The following notation names the environment created for this task:

```bash
S1_STATE=/home/nathaniel/.local/state/openplan/s1-uncertainty-20261023
/home/nathaniel/.local/bin/python3.11 -m venv "$S1_STATE/venv"
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 \
  "$S1_STATE/venv/bin/pip" install -r scripts/modeling/requirements.txt \
  -r workers/aequilibrae_worker/requirements.txt
"$S1_STATE/venv/bin/python" -B scripts/modeling/tests/test_count_observation_uncertainty.py
"$S1_STATE/venv/bin/python" -B scripts/modeling/tests/test_count_interval_coverage.py
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 \
  "$S1_STATE/venv/bin/python" -B scripts/modeling/prove_count_observation_uncertainty.py \
  "$S1_STATE/new-mutation-record.json"
```

The suite record lists all 27 commands as file paths. Execute each with that
same interpreter and `-B`. It also retains exit codes, printed summaries and
source/output hashes. The environment record identifies installed versions.
The six new/edited Python files parse, and the new notes' local links resolve.

For the authorized retained-input audit, first export `inputs.json` from
S2 reference commit `95364142219411810c5b95df22d54fe361f0cfa2` at
`data/modeling/s2-cordon-py311-round5-2026-10-23/inputs.json` to a new local file.
Use its exact hash below. The archive must already exist at the retained path.
This recipe does not download observations or authorize a new partition:

```bash
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 \
  "$S1_STATE/venv/bin/python" -B scripts/modeling/audit_count_interval_coverage.py \
  --registry "$S1_STATE/s2-inputs.json" \
  --registry-sha256 9ad0ff220af4b8c97c8bf9c046196dec738c54dfae02d93f7b7b9380e9e276ab \
  --output "$S1_STATE/new-coverage-record.json"
```

The audit creates its output exclusively and refuses an existing filename.
Do not overwrite the retained result to record a later execution.
