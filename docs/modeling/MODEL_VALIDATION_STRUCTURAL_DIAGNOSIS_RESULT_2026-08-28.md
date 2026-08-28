# Frozen model-validation structural diagnosis

Date: 2026-08-28

Release: v0.40.0

Release source Git SHA: `25f024ce1065c88ff0352eebb0ff49e52675e869`

Status: complete; all fourteen scientific assessments remain `inconclusive`

## Decision

The immutable v0.39 seven-county instrument explains several structural limits,
but it does not establish that either demand-model method is accurate enough for
a planning use. OpenPlan did not change a match, calibrate a model, average the
methods, rank them, select a candidate, create an acceptance threshold, or open
an untouched holdout.

## Established findings

- Four counties contain observations without usable point coordinates.
- Every county contains at least one observation whose full-link distance and
  centroid-only distance lead to different radius inclusion. A centroid-only
  diagnosis would therefore discard relevant geometry.
- Where an observation had usable coordinates, the frozen network always had
  geometry within the registered search distance. The diagnosis found no proved
  case of genuine nearby network absence.
- Name and facility evidence, tied candidates, ambiguous lineage, explicit
  exclusions, zero-volume matched links, and output-row absence remain separate
  states. None is silently converted to a successful match or dropped.
- The exact comparison evidence does not prove model year, day basis,
  coefficient package, or population vintage. Those ledger entries remain
  `unknown`.
- AequilibraE and ActivitySim are compared only on identical frozen matched
  links. Each raw value, raw difference, and ratio remains in its own method
  record; there is no combined score or winner.

## Exact record

The canonical result is
`data/modeling/model-validation-structural-diagnosis-2026-08-28/study-result.json`.
Its SHA-256 is
`014b5f6cf5ddf35d1c02d81228734f9669c03bc9184464eca53c3243062283f8`;
the human-readable study report SHA-256 is
`7573a28ccf3c1b90993c39a3468d2bfe9ae92f26dddf9bdb967b76948e073dde`.
It binds fourteen
`openplan.model-validation-structural-diagnosis.v1` artifacts to the exact
diagnosis registry, v0.39 preregistration and readiness record, network,
observation package, pre-volume audit, model output, comparison basis,
assignment profile, existing assessment, source release, v0.40 source commit,
and application version. The sibling `study-report.md` lists the per-county,
per-method hashes and counts.

California and nationwide model-validation capability remain `partial`. The
next scientific step is a new versioned observation-and-match instrument that
resolves these diagnosed gaps without altering the frozen record. An acceptance
rule and untouched holdout remain later checkpoints.
