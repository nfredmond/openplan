# Decisive observations require supported bounds

Source inspection finds two different evaluation paths. Rules v5 retains
unknown bounds and always reports inconclusive. The older rules-v4 evaluator
can produce a pass: its grade-B definition requires a complete day, while
decisive selection previously required only grade A/B and compatible units
and time. A frozen raw-error rule could therefore pass without observation
bounds. The synthetic reproduction reports a 10 percent raw error, unknown
bounds and `scientific_outcome=pass`.

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

Private reproduction and mutation logs are in
`decisive-observation-bounds-20261007-proof` and
`historical-matcher-20261007-proof/grade-b-no-bounds-reproduction.json`.

These tests protect eligibility and arithmetic on synthetic records. They do
not establish that a named source really supports a submitted interval: the
existing validator checks numeric order, the center, a named method/authority
and a source hash, not the source document's scientific content. Source review,
independent observations, frozen use-specific protocols and separate nationwide
acceptance for both models remain required. No scientific capability is promoted.
