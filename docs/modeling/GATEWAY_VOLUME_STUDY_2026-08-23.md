# Gateway-volume candidate: independent holdout result

**Decision: rejected. OpenPlan's model defaults did not change.**

OpenPlan tested one pre-registered correction to external traffic: where a
boundary crossing could be matched defensibly to a published traffic count,
the candidate used measured AADT instead of the flat road-class estimate. It
retained the existing fallback for unmatched crossings and lifted the
eight-gateway cap only for measured crossings.

The 16-county development half did not meet the thresholds. The 16 untouched
holdout counties were then opened once, as registered, to settle the adoption
decision. They also failed:

| Demand method | Counties improved | Required | Median county improvement | Required | Pooled station median APE |
|---|---:|---:|---:|---:|---:|
| AequilibraE | 5 of 16 | 12 of 16 | 0.0 percentage points | 5.0 points | 100.0% to 100.0% |
| ActivitySim | 6 of 16 | 12 of 16 | 0.0 percentage points | 5.0 points | 100.0% to 99.84% |

The conservation, convergence, provenance, zone-resolution, and unchanged
matched-station-set guards all passed. This is therefore a negative result for
the candidate, not a failed test setup. The two methods are reported separately
and were never averaged.

Per the frozen protocol, this result closes the candidate. OpenPlan will not fit
a scalar after seeing the holdout, expand the cap for inferred crossings, or
select another candidate from these holdout results.

## What the observed counts can and cannot establish

The national validation floor is FHWA's 2024 HPMS Spatial All Sections data.
Section-level AADT covers Federal-aid highways nationwide, while rural minor
collectors and local roads may appear only in summary reporting. Missing
section-level AADT means unknown coverage, never zero traffic. Registered state
DOT feeds remain preferred where they are available because they are usually
newer and more locally descriptive.

The exact registry, freeze records, output hashes, and arithmetic result are in
`data/modeling/gateway-volume-study-2026-08-22/`. Large per-link and per-station
artifacts remain in ignored run storage; the committed compact records contain
their SHA-256 hashes.
