# S3 acceptance evaluator groundwork

Date: October 23, 2026
Base: `57be0eed1cbcf4e41dd6459a3bd6ed4df2517797`
Branch: `work/s3-acceptance-evaluator`

This checkpoint implements supplied-input acceptance arithmetic and drafts a
successor design. S3 remains open. No scientific result, frozen successor,
new holdout access, production integration or default change is claimed.
The required historical study reports were read. No observation packages,
model-output files, survey archives or other outcome datasets were read.

## What changes

- `workers/aequilibrae_worker/model_validation_acceptance.py` sits beside the
  unchanged `model_validation_core_v5.py`. It has no file or network reader and
  imports no engine. Both methods remain separate through gate, cell, use and
  overall results.
- `test_model_validation_acceptance.py` builds synthetic protocol bytes,
  observations, model values and custody snapshots in memory. It exercises all
  six supported metrics, all three outcomes, all five scales, missing evidence,
  local failure, use/method separation, comparison bases and custody refusals.
- `scripts/modeling/prove_acceptance_evaluator.py` mutates disposable copies.
  It never edits the working evaluator or reads scientific inputs.
- The [successor draft](NATIONWIDE_VALIDATION_SUCCESSOR_DRAFT_2026-10-23.md)
  proposes free public sources, a complete state/DC roster, partition design,
  required archetypes and source-cited numerical proposals. It has no digest or
  freeze record. Exact geographic assignments and unresolved gates stay visible.

## Calling contract

`evaluate_acceptance(preregistration_bytes, frozen_record, preopening_custody,
observations, model_outputs)` returns a JSON-compatible assessment.
`FrozenRecord` is a separate, trusted caller input containing the study identity,
exact-byte SHA-256 and freeze time. The protocol uses
`openplan.acceptance-protocol.v1`, distinct from the historical blocking v1.
Passing historical preregistration bytes to the new API does not enable them.

The synthetic `fixture()` in the test file is the complete executable example.
Its thresholds and dates are invented for tests and carry no scientific weight.
The required protocol fields are:

| Field | Meaning |
|---|---|
| `schema`, `status`, `study_id`, `frozen_at` | Exact protocol identity. Status must be frozen. |
| `methods` | Both supported demand methods, kept separate. |
| `shared_context` | Digests for network, population, scenario, pre-output match audit and interval method. |
| `method_context` | Separate digest per method covering its code, coefficients, engine and settings closure. |
| `jurisdictions`, `archetypes`, `uses`, `cells` | Explicit required scope, including applicable intersection cells. Every listed jurisdiction/use and archetype/use must have a cell. |
| `blocks` | Geographic/source clusters and development, selection or acceptance roles. Cluster identity cannot overlap blocks. |
| `observations` | Expected identifiers, source lineage, acceptance block/cluster, jurisdiction/archetypes, source digest and full comparison basis. |
| `interval_aggregation` | `weighted_envelope`. No statistical independence assumption. |
| `gates` | Cell/scale, metric, comparison operator, threshold, source quote, sample-size basis, independent-cluster minimum and fixed comparison groups. |

Each group names members and positive weights, its quantity and weight basis.
Link groups retain one observation with weight one. Raw link gates must account
for registered observations. Partial raw link selection is refused. Missing
scales or raw-error gates leave the cell inconclusive. A state/archetype scale
refers to the explicit group within that cell, not an automatically constructed
statewide census or national archetype sample. The freeze review must establish
that the selected groups support the named geography and quantity.

Observation inputs carry center, bounds, source and interval-evidence digests,
interval-method identity, grade, QA status, match status and comparison basis.
Model inputs carry their separate method/context identities, shared context,
per-observation bases and values. Missing values remain missing. A supplied
zero model value remains a zero and can fail against a decisive observation.
All eight basis dimensions must match: year, day, period, direction, lanes,
vehicle definition, units and measured quantity.

Supported metrics are maximum raw APE, raw percent RMSE, Pearson correlation,
share within separately frozen group tolerances, maximum excess APE and excess
percent RMSE. RMSE uses N, normalized by mean observed quantity. Threshold
operators are explicit `lt`, `le` or `ge`, with direction and domain checks.
Every computed group retains raw signed residual, raw APE, weighted lower/upper
envelope, interval width, excess error and excess APE. An undefined denominator
or degenerate correlation is inconclusive. Weighted envelopes are not joint
confidence intervals. An uncertainty-only gate cannot award a cell pass.

The output retains every gate, reasons, residuals and expected-observation and
independent-cluster counts. One fail prevents a cell/use/method/overall pass.
An inconclusive gate blocks its claim. A passing aggregate cannot erase a
failed link or another failed jurisdiction/archetype/use cell.

## Custody boundary

The function refuses a hash or freeze-identity mismatch and consumed, exposed,
unsealed or differently bound acceptance custody before iterating observations.
It refuses partition/source-lineage duplication, cross-stratum borrowing and
method/input substitutions. These are supplied-record checks.

A caller can fabricate a digest and status record. This pure function cannot
establish who froze it, whether another process opened a holdout, whether source
bytes match a declared source hash, whether a quoted threshold is applicable,
or whether purported independent clusters actually are independent. It does
not authenticate numeric observations against source archives. A trusted runner
must verify those facts and exact artifacts before invoking it.

The runner must supply a retained **pre-opening** snapshot, then consume the
actual opening durably before loading outcomes. A receipt from that authorized
first opening is not a second-use authorization. The sealed runner's existing
lease, receipt and recovery rules remain controlling. This checkpoint does not
connect the module to that runner or to worker dispatch, the database, UI,
exports or claim promotion. It does not claim a real acceptance run is enabled.

## Verification record

Commands run from the repository root unless a working directory is shown:

| Exact command | Result |
|---|---|
| `npm run product:direction:check` in `openplan/` | Pass. Review reminders remain for older registry/matrix dates and the review's v0.66.0 versus package v0.72.0. No review was redated. |
| `python3 -B -m unittest discover -s workers/aequilibrae_worker -p test_model_validation_acceptance.py -q` | Intermediate 79 and 86 case runs passed after the initial corrections described below. |
| `python3 -B scripts/modeling/prove_acceptance_evaluator.py > /tmp/s3-acceptance-mutations.json` | Python 3.14: final 105 baseline and 105 restored cases pass, zero failures/errors/skips. 69 targeted mutants killed; one harmless comment survives. |
| `python3.11 -B -m unittest discover -s workers/aequilibrae_worker -p test_model_validation_acceptance.py -q` | Python 3.11.15: 105 pass, zero failures/errors/skips. |
| `python3.11 -B scripts/modeling/prove_acceptance_evaluator.py > /tmp/s3-acceptance-mutations-py311.json` | Same 105/105 baseline/restored passes, 69 targeted kills and one harmless survivor. |
| `sha256sum -c NATIONWIDE_VALIDATION_PREREGISTRATION_V1.sha256` in `docs/modeling/` | One original frozen artifact checked, one pass. |
| `git diff --check` | Pass. |

The [retained mutation record](../reviews/2026-10-23-s3-acceptance-evaluator/synthetic-mutations.json)
names every changed condition and the exact failing tests. It binds the evaluator
source digest, with no digest of the draft. The harness rejects import errors,
syntax errors, empty suites, skips and test errors as proof. All final kills
come from assertion failures. Targeted interval and method mutations run their
named tests; the remaining mutants run the full focused suite. The repository
source remains unchanged throughout, and the restored suite passes afterward.

The initial 79-case run had two failures: the RMSE example's expected outcome
was wrong, and a timezone-specific refusal was masked by its enclosing exception
handler. Both were corrected. The first completed mutation attempt found two
survivors. The invalid-output mutant caused downstream errors, which did not
count as a kill; its replacement injects a fabricated observed value and fails
the intended output-evidence assertion. The share-comparison mutant produced the
same 50 percent under reversed comparisons; a boundary case now catches it.
Intermediate harness attempts rejected downstream errors rather than counting
them as successful kills. These were software-proof defects, not observations
about either demand method.

These standard-library checks run independently of an engine environment. This
checkout has no configured AequilibraE virtualenv. No worker-native suite or
engine run was attempted. No Vitest test, full suite, `qa:gate`, `next build`,
database, browser, Docker or hosted check ran. Those are unexecuted tiers, not
skipped cases hidden inside the 105-test count.

## Decisions before freezing or claiming S3 acceptance

The lead must resolve actual uncontaminated cluster memberships, statistical
sample-size/precision design, complete source authorization and artifacts,
source-supported intervals, applicable threshold transfers, all missing
link/system/state/archetype and forecast gates, and the final comparison formulas.
The five source-backed numerical proposals do not fill every required gate.
The 51 reserved partition identities do not prove real geographic independence.

Then integrate and independently exercise one-opening custody with synthetic
artifacts, audit consumer claim boundaries, and obtain a separately authorized
study instruction before actual outcome access. No new product decision or
approval is needed to review this draft PR. Any change in claimed planning use,
territory scope, paid data acquisition or scientific acceptance requires its own
explicit decision. S1/S2 and the full S3 definition remain in force.
