# Decisive observations require supported bounds

Source inspection finds two different evaluation paths. Rules v5 retains
unknown bounds and always reports inconclusive. The older rules-v4 evaluator
can produce a pass: its grade-B definition requires a complete day, while
decisive selection previously required only grade A/B and compatible units
and time. A frozen raw-error rule could therefore pass without observation
bounds. The synthetic reproduction reports a 10 percent raw error, unknown
bounds and `scientific_outcome=pass`.

Caller inspection narrows the demonstrated exposure. The screening CLI calls
`uncontracted_v4_assessment`, which stays inconclusive. The development-study
runner calls the reusable evaluator but binds an unknown acceptance rule and
refuses a pass/fail result. Rules v5 also stays inconclusive. This investigation
does not demonstrate a false pass in a published screening workflow. The
correction protects the reusable rules-v4 evaluator and future callers that
supply a frozen rule. Running a new field study or the unchanged screening CLI
would not exercise that failing synthetic condition.

The [nationwide preregistration](../../modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json)
requires source-supported observation intervals for decisive observations.
This correction applies that existing evidence requirement to prospective
rules-v4 evaluation. It does not invent an interval or acceptance tolerance.

Decisive selection now requires an interval accepted by the existing source
interval validator. An observation without bounds retains its grade, raw
residual, raw percent error and coverage record, but cannot count toward the
decisive minimum or a scientific pass/fail result. The assessment explains
that limitation. Grade-C diagnostic summaries retain their original meaning.
Valid synthetic bounded observations still exercise both pass and fail paths
under the unchanged frozen rule.

No archived observation, study result, registry, matcher, model default or
holdout is rewritten. Existing stored assessments keep their historical
contents. This is not a rerun or regrading of the published studies.
New full assessments identify their eligibility policy as
`source-supported-bounds-required.v1`. Historical rules-v4 records without
that marker are not silently relabeled as having used this correction.

## Verification

All 15 core test functions pass. Controls include unknown bounds with exact
agreement and large disagreement, a mixed bounded/unbounded set below the
decisive minimum, and supported bounds on either side of a frozen error limit.
The PCE conversion positive control now supplies synthetic supported bounds
so it still tests conversion rather than failing for missing observation
evidence.

A harmless source comment passes. Accepting unbounded observations as decisive,
rejecting supported bounds, and dropping the specific missing-bounds explanation
each fail targeted assertions. The restored source passes. The TMAS adapter's
four tests and the development-study runner's five tests also pass. The HPMS
adapter's 20 tests and validation instrument's 13 tests pass in the existing
worker environment. Their initial system-Python runs lack Shapely; these failed
environment attempts are preserved rather than counted as passes. No package
installation is needed.

The broader AequilibraE worker run passes all 32 discovered suites at
`c44048bfdd386de1e20f5333df16c2e3131942f5`, including the corrected policy marker.
It uses the existing AequilibraE worker interpreter with the engine installed,
runs suites serially and retains each output. The owned service
`openplan-bounds-worker-c44048bf.service`, invocation
`85870a67aa60402f8aa96129be4bdc57`, exits successfully. This is worker regression
evidence, not a new field study, model-accuracy result or independent acceptance.
The machine-readable result is `worker-suites-result.json` in the private
proof directory below.

Private reproduction and mutation logs are in
`decisive-observation-bounds-20261007-proof` and
`historical-matcher-20261007-proof/grade-b-no-bounds-reproduction.json`.

These tests protect eligibility and arithmetic on synthetic records. They do
not establish that a named source really supports a submitted interval: the
existing validator checks numeric order, the center, a named method/authority
and a source hash, not the source document's scientific content. Source review,
independent observations, frozen use-specific protocols and separate nationwide
acceptance for both models remain required. No scientific capability is promoted.
