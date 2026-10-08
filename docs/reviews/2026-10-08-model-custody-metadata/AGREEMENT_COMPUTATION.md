# Retained demand-model agreement computation

October 8, 2026. This continues the model recovery work in roadmap M3/S1.
The full V1 contract and scientific acceptance requirements remain unchanged.

## Finding and change

The normal agreement stage called the comparison writer again on each attempt.
That writer generated a new timestamp and overwrote JSON, Markdown and GeoJSON
before artifact registration. A retained registration request could therefore
meet changed bytes on retry. The geometry writer also replaced its existing file.

The normal dispatcher now calls `retain_agreement_comparison`. Its existing
SQLite stage journal records both assignment paths and hashes, geometry and any
optional manifest/noise-floor sources, separate convergence records, other
comparison settings and the output directory. The existing `compute_once`
checkpoint commits the start before calling the comparator. A missing result
requires reconciliation rather than automatic recalculation.

The comparator writes only into a new private temporary directory. The helper
reads the exact output bytes and saves them with the result, preserving the
original timestamp and original source paths. It checks source hashes again
before saving. Exact retries reuse the result and create missing local files
without replacing existing bytes. Altered files or inputs refuse continuation.
Network geometry uses the same non-replacing materialization, including exact
roadway-set checks already present in the exporter. JSON, GeoJSON and Markdown
are allowed file types; path traversal and unexpected extensions remain refused.

## Evidence

Eight focused tests pass. They cover exact retry, missing-file repair, altered
files, changed source bytes and convergence records, interrupted computation,
changes during computation, forced replacement, missing geometry, escaped output
paths and incomplete retained results. One test uses the real comparison writer
with synthetic link volumes and retained network evidence. It checks the original
timestamp, all three byte sequences, original source paths and separate method
labels after retry. It does not run either scientific engine.

The 27 existing ActivitySim handoff checks pass. The two agreement dispatcher
fixtures assert that the retained helper is called. The actual geometry exporter
preserves its inode on exact retry and refuses to overwrite altered bytes.
Baseline, harmless and restored controls pass. Nine deliberate faults fail:
forced replacement, missing geometry, escaped output, source mutation, incomplete
saved result, changed inputs, geometry overwrite, dispatcher bypass and unsafe
filenames. Private results are in
`model-command-client-20261008-proof/agreement-computation-controls.json`.

All 82 worker suites pass with no failures or omitted suites. Unit
`openplan-agreement-computation-workers-20261008.service`, invocation
`1eb14ac8f9e349fdade10b9f49fda100`, finished at 08:32:56 Pacific. Peak memory was
171.7 MiB under a 1 GiB cap. The checkout stayed unchanged during regression.
The first fixture adaptation expected two identical mock declarations but found
one named and one unnamed declaration; the assertion stopped that adaptation.
The corrected change targets their shared comparator-module fixture. The first
real-comparator fixture supplied geometry-only evidence arguments; it failed
without publication. Filtering through the existing assignment-evidence helper
corrected the fixture without changing production guards.

## Remaining boundaries

Before/after hashing does not freeze source files or rule out a transient change
restored between reads. The stage still requires exclusive ownership and source
custody. Geometry generation itself is not checkpointed; its exact local bytes
are protected from replacement. Interrupted comparisons remain pending for
reconciliation. Storage registration and current database ownership remain
separate obligations. Whole-stage replay stays disabled.

Full application QA and GitHub checks are pending for this branch. T3 screenshot
acceptance remains unavailable. No scientific accuracy, independent nationwide
validation, practitioner acceptance or v1 completion is claimed.

## Verified private source copies

The earlier before/after-only source boundary is superseded. The helper now
copies each source into its private temporary directory and verifies the copied
SHA-256 and size against the recorded facts before comparison. The comparator
reads these copies. Transient changes to an original cannot alter its input.
Original source paths remain explicit labels in the output; labels alone do not
establish byte custody. After-comparison checks still refuse persistent changes
to originals. Copies are temporary, and an interrupted computation still needs
reconciliation rather than automatic restart.

Eleven focused tests pass, including a transient original-file change during
comparison, a deliberately corrupted copy and incomplete source-label refusal.
The real comparator preserves its original source labels and output bytes.
All 21 comparison-script tests pass. Baseline, harmless and restored controls
pass; twelve adverse variants now fail, adding copy-digest omission, snapshot
bypass and source-label guard removal. Results are in
`model-command-client-20261008-proof/agreement-source-snapshot-controls.json`.
The first snapshot-bypass control exposed an assertion inside the callback that
was intentionally converted to the helper's generic error. The corrected test
collects observed input facts and asserts them outside the callback, so the
adverse result identifies the actual input boundary.

All 82 worker suites pass again with none failed or omitted. Unit
`openplan-agreement-source-workers-20261008.service`, invocation
`da140dd84025402d866e44458e22ff60`, finished at 08:38:01 Pacific with a 169.9 MiB
peak under a 1 GiB cap. Worker source files stayed unchanged during regression.
Stage ownership, interrupted-computation reconciliation and scientific acceptance
remain separate obligations. Whole-stage replay remains disabled.

## Inspect interrupted calculations

The recovery CLI now accepts `--list-computations`. It opens an existing journal
read-only and filters records by the configured deployment identity and URL.
Each summary names the run, stage and calculation, with either `result_retained`
or `started_without_result`. It checks canonical inputs, result hashes and UUIDs
before reporting them. Damaged records refuse the listing. An older journal
without a computation table returns an empty list. A missing journal is not
created. Inputs and result payloads are not printed.

This makes the interrupted-start condition visible without rerunning a
calculation, creating a request, contacting the server or claiming ownership.
`started_without_result` remains a reconciliation requirement, not permission
to delete the start or recompute consumed observations. A retained result does
not prove current source availability, local file custody or scientific validity.

Three focused tests pass, including a fresh CLI process, scoped saved/interrupted
states, no payload output, unchanged database bytes, missing/older journals and
damaged fields. Baseline, harmless and restored controls pass. Eight faults fail
at read-only mode, deployment scope, run/stage identity, name, input shape,
partial receipt and result integrity. Evidence is
`model-command-client-20261008-proof/computation-inspection-controls.json`.
The initial test used SQLite transaction contexts without closing connections;
the test now closes them explicitly and passes without that resource warning.

All 83 worker suites pass with none failed or omitted. Unit
`openplan-computation-inspection-workers-20261008.service`, invocation
`795b9371945b40b8b8a0bf6930a99a5f`, finished at 08:44:05 Pacific with a 170 MiB
peak under a 1 GiB cap. Worker source stayed unchanged during the run.
