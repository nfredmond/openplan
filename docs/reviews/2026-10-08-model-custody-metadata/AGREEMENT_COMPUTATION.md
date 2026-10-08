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
