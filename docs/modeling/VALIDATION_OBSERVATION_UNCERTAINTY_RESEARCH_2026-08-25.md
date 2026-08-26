# Traffic-count uncertainty and a defensible nationwide model-validation gate

**Research date:** 2026-08-25
**Scope:** AequilibraE and ActivitySim demand validation against observed roadway volumes
**Status:** Research and proposed method, not a new acceptance standard and not evidence that the model passes

## Decision

OpenPlan should not try to make modeled link volumes equal published AADT exactly. A published AADT is an estimate of average traffic, not error-free truth. Day-to-day traffic variation, seasonal and day-of-week expansion, count equipment, missing-data treatment, growth to another year, imputation, direction conventions, and station-to-model-link matching can all contribute to a model-count residual.

The opposite conclusion would also be wrong: count uncertainty cannot be used as a blanket excuse for model error. OpenPlan needs to preserve the raw residual, estimate observation uncertainty only where the publisher's evidence supports it, and grade the model on the part of the residual outside that interval. A station with unknown measurement quality is `inconclusive` for a high-confidence link-level claim, not automatically accurate and not automatically wrong.

The reported **43.3% median APE should be withdrawn as a current accuracy headline**. It is the metric from the roughly 30% calibration-selection holdout drawn from a 57-station, one-county Caltrans dataset on 2026-08-16. The surviving experiment record says that selection-holdout median APE improved from 62.80% to 43.29%; a later trial that worsened it to 46.25% was rejected. The calibration engine now explicitly says that this holdout selects steps and is not independent accuracy evidence. This is not a sealed nationwide result. Several comparison-rule defects were fixed after that run, and the current validator identifies itself as rules version 3. We cannot determine from the surviving result how much of 43.3% was model error, observation error, temporal mismatch, or matching error.

Could observation uncertainty plausibly explain some of that residual? Yes. FHWA documents every mechanism needed for it to do so. Is there evidence that count uncertainty explains most or all of 43.3%? No. FHWA's illustrative ±10% precision target for a homogeneous factor group is not a universal count-error bound, and it is not directly comparable with a median APE from this run. [FHWA, *Traffic Monitoring Guide*, 2022, “Traffic data methodologies,” section 3.1](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/traffic-data-methodologies.cfm) The repository also records model-side network-coverage and distribution problems. The defensible conclusion is that both sides require measurement, not that either side has been cleared.

This correction does not make the model look better or worse. It means the number does not answer the question it has been asked to answer.

## What authoritative guidance says

FHWA's travel-model validation manual makes four points that should govern OpenPlan's design:

1. Traffic counts come from different collection methods, may be raw or factored, and include day-to-day variation, data-quality limitations, and sampling error. Those limitations must be assessed before using counts for validation. [FHWA, *Travel Model Validation and Reasonableness Checking Manual*, second edition, sections 2.3 and 9.1, pp. 2-9 to 2-10 and 9-3 to 9-5](https://rosap.ntl.bts.gov/view/dot/55924/dot_55924_DS1.pdf)
2. The model and observation must represent the same quantity and time basis. For example, an average-weekday model should be compared with average-weekday data, not silently with a different daily basis. One-day and two-day samples may differ substantially from a true average even after adjustment. [FHWA, *Travel Model Validation and Reasonableness Checking Manual*, section 9.1, pp. 9-3 to 9-5](https://rosap.ntl.bts.gov/view/dot/55924/dot_55924_DS1.pdf)
3. A large link difference can reflect a traffic-count problem rather than a model problem. Aggregate screenline, cutline, and cordon checks help because independent random count errors can offset, while a common directional or systematic bias does not. [FHWA, *Travel Model Validation and Reasonableness Checking Manual*, section 9.3, pp. 9-13 to 9-14](https://rosap.ntl.bts.gov/view/dot/55924/dot_55924_DS1.pdf)
4. Validation guidance is not proof that a model is valid. Fixed targets can induce analysts to manipulate a model to reach the target, and sound methods matter more than making every statistic fit a threshold. Validation should use information not used in estimation and, ideally, independent observed data. [FHWA, *Travel Model Validation and Reasonableness Checking Manual*, sections 1.3 and 9.4, pp. 1-4 to 1-8 and 9-17 to 9-18](https://rosap.ntl.bts.gov/view/dot/55924/dot_55924_DS1.pdf)

The same manual separates model-specification, aggregation, estimation-data, input-data, and validation-data error. It warns that an erroneous observed count can cause an analyst to “correct” an otherwise sound model in the wrong direction. That is why OpenPlan must examine observation evidence before calibration, not merely add a wider tolerance afterward. [FHWA, *Travel Model Validation and Reasonableness Checking Manual*, section 1.5.4, pp. 1-11 to 1-12](https://rosap.ntl.bts.gov/view/dot/55924/dot_55924_DS1.pdf)

FHWA's current traffic-monitoring guidance describes the observation side in more detail:

- Traffic changes by time of day, day of week, month, year, geography, direction, vehicle class, and facility type. Short-duration counts are expanded using factor groups, and the variability of those factors determines the precision and sample size needed. FHWA gives a 95% confidence-interval example and calls for multiple site-specific counts when a factor group cannot meet the desired precision. [FHWA, *Traffic Monitoring Guide*, 2022, “Traffic data methodologies,” sections 3.1, 5.1, and 5.3](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/traffic-data-methodologies.cfm)
- FHWA's reference ranges for short-term-count-derived AADT are much wider than its ±10% factor-group precision example: the 95% traffic-count-estimate error ranges are ±34% for AADT 500 to 4,999 and ±28% for the two higher volume groups. These are planning values for AADT-estimation uncertainty, not model-acceptance allowances and not station-specific bounds. [FHWA, *Traffic Monitoring Guide*, 2022, “Traffic data methodologies,” table 3-3](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/traffic-data-methodologies.cfm)
- Equipment and setup are another error source. FHWA calls for validation and calibration procedures because sensor setup, equipment, and processing algorithms can produce inaccurate statistics, and recommends at least annual equipment calibration. [FHWA, *Traffic Monitoring Guide*, 2022, “Traffic data collection,” sections 4.4.1 to 4.4.3](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/traffic-data-collection.cfm)
- HPMS AADT may be a direct government count, a private count, or a value derived from models, trend analysis, cellular data, or other methods. The HPMS reporting format carries codes A through E to disclose that method. [FHWA, *Traffic Monitoring Guide*, 2022, “Federal data reporting,” section 2.3.1](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/federal-data-reporting.cfm)
- HPMS AADT can include day-of-week, seasonal, axle-correction, and growth factors. Major routes may be counted on a three-year cycle and lower-volume routes on a six-year cycle. The HPMS metadata model includes percent actual, count duration, factor use, and growth adjustment because those facts affect data quality. [FHWA, *Highway Performance Monitoring System Field Manual*, “Data item descriptions,” AADT](https://www.fhwa.dot.gov/policyinformation/hpms/fieldmanual/page05.cfm) and [“Data model and metadata”](https://www.fhwa.dot.gov/policyinformation/hpms/fieldmanual/page03.cfm)
- HPMS is a cooperative federal-state program in which states provide data and estimates. A state feed and HPMS value may therefore share the same underlying observation and should not automatically be treated as independent corroboration. [FHWA, *Highway Performance Monitoring System Field Manual*, “HPMS components”](https://www.fhwa.dot.gov/policyinformation/hpms/fieldmanual/page02.cfm)

FHWA's microsimulation calibration guidance states the underlying measurement principle especially clearly: determine a tolerance from repeated field observations collected on different days, declare the margin of error in advance, and do not require an exact match to one day's traffic because daily demand varies. This is not a static travel-demand-model acceptance standard, but the measurement principle transfers directly. [FHWA, *Guidance on the Level of Effort Required to Conduct Traffic Analysis Using Microsimulation*, chapter 6](https://www.fhwa.dot.gov/publications/research/operations/13026/007.cfm)

California adds use-specific requirements. Its 2024 RTP guidelines recommend static-validation checks including volume-group deviation allowances, at least 75% of links within those allowances, correlation of at least 0.88, and percent RMSE below 40. They also require sensitivity testing and documentation where the criteria cannot be met. These are California RTP expectations, not a nationwide universal standard, and meeting them alone does not prove a model is fit for every use. [Caltrans, *2024 Regional Transportation Plan Guidelines for Regional Transportation Planning Agencies*, pp. 50 to 52](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/regional-and-community-planning/sustainable-transportation-planning-grants/adopted-2024-rtp-guidelines-for-rtpas-2-a11y.pdf)

## The error being measured

For a station (i), the visible residual is:

\[
r_i = \text{modeled daily vehicles}_i - \text{published AADT}_i
\]

That residual can contain all of the following:

\[
r_i = e_{model} + e_{daily\ sample} + e_{season/DOW} + e_{equipment} + e_{imputation/growth} + e_{vintage} + e_{location/direction/unit}
\]

One model-count pair does not identify those terms. A 43% difference cannot be assigned to the model or to the count by inspection. Repeated raw daily counts, publisher metadata, audited spatial matching, and an independent validation design are what make partial attribution possible.

The terms also behave differently:

| Source of difference | What would expose it | Correct treatment |
|---|---|---|
| Day-to-day, day-of-week, and seasonal variation | Raw daily series or repeated short counts across seasons | Estimate a station or factor-group interval |
| Count equipment or processing error | Publisher QA flags, calibration records, independent recount | Exclude failed observations; preserve documented uncertainty |
| Expansion, axle, missing-data, growth, or imputation error | Method code and factors used to produce AADT | Disclose method; lower evidence grade; do not invent precision |
| Count/model year mismatch | Count date, model base year, documented growth method | Normalize with a preregistered method or exclude from the decisive set |
| Location, segment, and direction mismatch | Route and linear-reference section, direction, one-way/two-way basis, audited map match | Fix the match or mark it ambiguous; never pick a link because its volume looks right |
| Model error | Residual that remains across high-quality, same-basis, independently held-out observations | Diagnose demand, network, assignment, and coverage components |

## What OpenPlan handles now

This audit covers the current checkout on 2026-08-25.

| Current behavior | Evidence in the repository | Assessment |
|---|---|---|
| Uses a deterministic 30% station selection holdout and rejects a calibration step that worsens held-out median APE | `workers/aequilibrae_worker/calibration.py` | Keep. Rename every surface that calls it “accuracy.” It is an overfit guard for model selection, not independent validation. |
| Keeps assignment-independent matching | `workers/aequilibrae_worker/count_validation.py`, rules version 3 | Keep. A station is matched from name, type, location, and facility evidence before its modeled volume is read. |
| Sums paired divided-highway carriageways | `count_validation.py` | Keep, with a recorded direction/basis assertion. |
| Excludes known ramps, frontage roads, and connectors from a mainline comparison | `count_validation.py` and `scripts/modeling/count_sources.py` | Keep and audit samples. Exclusion must come from source/facility evidence, never a bad residual. |
| Collapses consistent duplicate stations on one modeled link and excludes inconsistent groups | `count_validation.py` | Keep as a network-resolution safeguard. The current 30% consistency rule is a model threshold reused as an observation rule; replace it with observation evidence or a separately justified duplicate-consistency rule. |
| Keeps matched zero-volume links in the score and discloses unloaded-network coverage | `count_validation.py` | Keep. Removing losses would bias the result. |
| Withholds a passing link-level claim when intrazonal travel is too high | `count_validation.py` | Keep. The current rule still allows a failure to stand, which is appropriately conservative. |
| Distinguishes missing source coverage from model failure | `count_validation.py` and `count_sources.py` | Keep. Unknown coverage must remain unknown, never zero or passed. |
| Reports median, mean, and maximum APE, percent RMSE, GEH, Spearman rank correlation, and matched coverage | `count_validation.py` | Useful diagnostics. They currently treat every accepted AADT as an exact point value with equal evidentiary quality. |
| Records source dataset, vintage, measurement date, route/section identifiers, facility class, state/county, and provenance JSON | `count_sources.py` and `build_expanded_aadt_counts.py` | Good foundation. It is not yet enough to estimate observation uncertainty. |

## What OpenPlan does not handle

1. **No observation interval.** `validate_against_counts` computes APE directly from one `observed_volume`. It has no lower/upper confidence bound, standard error, raw daily series, or factor-group precision.
2. **No AADT method-quality fields.** The ingest contract does not carry HPMS AADT method code, percent actual, count duration, continuous versus short-term status, adjustment factors, growth/imputation status, equipment/QA state, or missing-data method.
3. **No enforced time-basis equivalence.** The model produces “daily vehicle trips,” while validation calls the observation AADT. The inspected demand, assignment, and validator code does not establish that modeled daily demand is an annual-average day, an average weekday, or another defined day. Until that basis is explicit, like-for-like comparison is not proven.
4. **No direction-aware comparison.** Directionality is preserved by count adapters, but `match_station` does not use it and `corridor_volume` assumes a DOT station measures both directions. That is unsafe for directional HPMS records, one-way streets, ramps, or directional state feeds.
5. **No base-year gate.** Vintage is recorded when available, but a count from another year is not normalized under a frozen method or excluded from the decisive set.
6. **No direct/derived distinction.** State-DOT and HPMS AADT values enter the same point-value metric even though FHWA distinguishes direct counts from derived estimates.
7. **No independent acceptance holdout.** The calibration holdout participates in selecting accepted calibration steps. The engine correctly documents that another untouched set is required.
8. **No nationwide acceptance design.** Three matched stations can currently award “bounded screening-ready.” That is a local diagnostic, not evidence for any region in the United States.
9. **No explicit vehicle/PCE comparability guard.** The current assignment profile uses `class_pce = 1`, so today's PCE volume is numerically a vehicle count. The validator would still compare PCE with vehicle AADT if a future profile changed that factor unless it fails closed or converts units.
10. **Hourly metrics do not use observed hourly evidence.** Average-hour GEH divides AADT and modeled daily volume by 24. Peak-hour GEH applies a generic K-factor. Neither establishes agreement with an observed local model period.
11. **State-source normalization can hide section ambiguity.** The current builder turns Caltrans back/ahead section values into `max(back, ahead)` and labels the result two-way AADT. That may be a defensible conservative convention for a specific use, but it is not measurement uncertainty and should not silently stand in for the volume on either adjacent section.

## An uncertainty-aware observation contract

Every count admitted to validation should carry a machine-readable record with these fields:

- source agency, dataset, immutable source artifact hash, retrieval time, license, and original record identifier;
- count location as route plus linear-reference begin/end point where available, geometry, direction, one-way/two-way basis, carriageway, facility class, and vehicle definition;
- observation start/end dates, days and hours observed, count year, and the model day/base year it is intended to represent;
- direct-count or derived-estimate method code, continuous/permanent or short-term status, percent actual, missing-data method, day-of-week/seasonal/axle/growth factors, and their source;
- equipment and QA status where published;
- observed center estimate, lower and upper 95% observation bounds, and the documented calculation method;
- matching method, candidate links, selected section, exclusion reason, and validation-rules version.

Do not fabricate bounds from a generic percentage when the source does not support them. Use evidence grades:

| Grade | Minimum observation evidence | Decisive use |
|---|---|---|
| A | Same-base-year continuous or repeated raw daily observations, documented QA, and a station-specific interval | Independent link, stratum, and aggregate acceptance |
| B | Direct short-term count with known dates, factors, QA, and a documented factor-group precision interval | Link diagnostics and acceptance with sensitivity reported |
| C | Derived, growthed, imputed, or older AADT with method known but no defensible station interval | Aggregate corroboration and diagnostic strata, not sole decisive link evidence |
| D | Unknown method or vintage, incompatible day/direction/unit basis, or ambiguous location match | `inconclusive`; excluded from pass/fail metrics but counted in coverage |

These grades describe the observation, not the agency. An HPMS record can be direct or derived; a state feed can also contain adjusted or estimated values. Duplicate state and HPMS records should be linked by lineage and not counted as independent evidence unless their underlying observations are demonstrably independent.

## The right tolerance

OpenPlan needs two different bands, never one overloaded “margin of error”:

1. **Observation interval:** the range supported by traffic-monitoring evidence for the quantity being estimated. This reflects sampling, factoring, equipment, imputation, and temporal uncertainty that can be quantified.
2. **Model acceptance tolerance:** the maximum remaining discrepancy acceptable for a stated planning use. This is a product and professional-standard decision, preregistered before the acceptance data are opened.

For a station with a supported observation interval \([L_i,U_i]\), report both the original error and an uncertainty-aware excess error:

\[
e^{excess}_i =
\begin{cases}
0 & \text{if } L_i \le M_i \le U_i \\
L_i - M_i & \text{if } M_i < L_i \\
M_i - U_i & \text{if } M_i > U_i
\end{cases}
\]

Also report the raw signed residual, raw APE, the interval width, and the observation grade. A zero excess error means only that the model is indistinguishable from the observation at that station's stated precision. It does not prove that the model is correct.

Do not widen observation intervals until the model passes. Freeze the interval method before calibration, version it, and compute it from raw observations or publisher-supported factor precision. If a bound is unavailable, retain the raw residual and mark uncertainty-aware scoring unavailable.

## A preregistered nationwide gate

The v1 claim is national, so acceptance evidence must be national. The following protocol preserves the existing no-scalar, no-averaging, and holdout rules.

### 1. Declare the use before the threshold

Create separate claim gates for at least:

- exploratory nationwide screening and corridor prioritization;
- statutory regional plan base-year replication;
- project-level alternatives or forecasts.

A screening pass cannot silently become a project-level forecast claim. California statutory RTP use must additionally report the Caltrans 2024 metrics and sensitivity tests. Other state or federal use-specific requirements belong in jurisdiction adapters, not in one national hardcoded threshold.

### 2. Freeze the protocol before opening acceptance data

The preregistration artifact should hash and name:

- model code, coefficients, assignment profile, engine versions, network source, model base year, and day definition;
- count sources and immutable source artifacts;
- observation-grade rules, interval calculation, temporal normalization, matching, duplicate handling, and exclusions;
- geographic and facility strata, split seed, primary and secondary metrics, thresholds, non-inferiority limits, and missing-coverage rule;
- every permissible calibration parameter and stopping rule.

Changing any of these after acceptance results are visible creates a new candidate and requires a new untouched acceptance set.

### 3. Use three disjoint evidence sets

- **Development set:** diagnose and build.
- **Selection holdout:** choose calibration steps. Keep the current deterministic selection-holdout principle.
- **Independent acceptance holdout:** never used to choose parameters, scalars, matching rules, thresholds, or exclusions.

Split by geography, corridor, and source program, not merely by station. Nearby stations on the same corridor share demand, network, and count-program errors. A station-level random split can put the same underlying evidence on both sides.

### 4. Cover the nation without pretending sparse data are a pass

Represent all 50 states and the District of Columbia, and report each jurisdiction's status. Stratify by:

- urban, suburban, rural, and recreational/seasonal context;
- functional class and volume group;
- geography and climate region;
- observation grade and source method;
- network coverage and zone resolution.

Determine sample sizes from the observed variability and desired precision in each stratum, following a written power or confidence-interval calculation. Do not pick an arbitrary count such as three. A jurisdiction or stratum without adequate evidence is `inconclusive`, which blocks a nationwide validated claim while still allowing honestly labeled local screening.

### 5. Grade multiple scales and components

No single median should control the claim. At minimum, publish:

- total and signed bias in regional VMT and volumes;
- observed and modeled screenlines, cordons, and cutlines;
- by-volume-group, facility-class, urban/rural, geography, and observation-grade results;
- raw median APE, percent RMSE, correlation/rank agreement, and GEH on a preregistered time basis;
- uncertainty-aware median excess APE and the share of modeled values inside observation intervals;
- matched, ambiguous, excluded, unsupported, and unloaded-link coverage;
- population, trip generation, trip distribution, mode, time-of-day, external travel, network, and assignment checks so a link residual is not misattributed to demand.

Preserve negative results and all material strata. A good national median cannot hide a failed state, road class, rural stratum, or observation grade.

### 6. Decide without fitting the answer

Accept a candidate only if it improves the preregistered primary objective on the untouched acceptance holdout and does not breach preregistered non-inferiority limits in important strata. Keep these current rules:

- no scalar fitted after any holdout is opened;
- no averaging AequilibraE and ActivitySim outputs;
- no dropping unmatched, zero-volume, or high-error observations because they hurt the score;
- no changing defaults from selection-holdout evidence alone;
- no claim when coverage or observation quality is insufficient.

Agreement between AequilibraE and ActivitySim is useful sensitivity evidence. It is not an observation and cannot establish truth when both models share inputs or assumptions.

The current 30% median-APE threshold can remain as a continuity diagnostic until a replacement is preregistered. It should not be loosened in response to 43.3%, and it should not be presented as the v1 nationwide gate.

## What would settle the 43.3% question

Run a new study rather than trying to rehabilitate the old number:

1. Define the model's day and base year, and require count/model vehicle, direction, temporal, and unit equivalence.
2. Use current validation rules and freeze them before seeing results.
3. Build a reference subset from current-year continuous counters or repeated raw daily observations with QA and station-specific intervals.
4. Audit a stratified sample of matches on a map and against route/linear-reference sections. Report the mismatch rate and adjudication without looking at modeled volume.
5. Reserve an untouched geographic acceptance holdout separate from the calibration-selection holdout.
6. Compare residual distributions by observation grade, interval width, vintage difference, source method, facility type, geography, network coverage, and zone resolution.
7. Re-run the same candidate without post-holdout scalar changes. Publish both raw and excess-error results.

Possible interpretations would then be evidence-based:

- If residuals remain large and systematic on Grade A, same-year, audited stations and on aggregate screenlines, the error is primarily in the model or network representation.
- If errors shrink sharply on Grade A evidence but grow with vintage, derived-method status, or wide factor intervals, the published count process explains a material share.
- If errors shift substantially after location, direction, carriageway, or section corrections, the validator was measuring a matching defect.
- If the evidence is sparse or correlated, the honest result remains inconclusive.

Today, none of those findings has been established nationwide. The repository does contain separate evidence of model-side problems, including large unloaded-link coverage and unresolved distributional bias, so observation uncertainty must not be used to assume the model is sound. It also contains multiple post-2026-08-16 fixes to the count comparison, so the old 43.3% must not be treated as a current measurement of model error.

## Recommended implementation order

1. Correct all active product and roadmap references that describe 43.3% as current held-out or nationwide accuracy.
2. Add the observation contract and fail-closed time/direction/unit comparability checks before changing acceptance thresholds.
3. Ingest FHWA method metadata and raw continuous-counter evidence where authoritative sources expose it. Add state adapters only through the existing registry.
4. Implement observation intervals and raw-plus-excess reporting. Prove by mutation that a missing or fabricated interval cannot award a pass.
5. Build the three-way, geography-blocked split and immutable preregistration artifact.
6. Run a California evidence study first to debug the instrument, without consuming the nationwide acceptance holdout.
7. Freeze the instrument, then run the all-state study. Runtime may be hours or days; scientific independence and accuracy take priority.

This order changes the instrument before spending an untouched holdout. It does not calibrate away the negative result, average the two models, or replace a failed validation with a wider unexplained band.

## Repository evidence reviewed

- calibration experiment commits `30750112` and `3e7cc9bd`
- `scripts/modeling/calibrate_to_counts.py`
- `scripts/modeling/tests/test_calibrate_to_counts.py`
- `workers/aequilibrae_worker/calibration.py`
- `workers/aequilibrae_worker/count_validation.py`
- `workers/aequilibrae_worker/assignment_settings.py`
- `scripts/modeling/count_sources.py`
- `scripts/modeling/hpms_count_source.py`
- `scripts/modeling/build_expanded_aadt_counts.py`
- `scripts/modeling/validate_screening_observed_counts.py`
- `docs/modeling/COUNT_FACILITY_MATCHING_2026-08-20.md`
- `docs/modeling/UNLOADED_LINK_COVERAGE_2026-08-20.md`
- `docs/modeling/WHERE_THE_NUMBER_STANDS_2026-08-20.md`
- `docs/modeling/GATEWAY_VOLUME_STUDY_2026-08-23.md`
