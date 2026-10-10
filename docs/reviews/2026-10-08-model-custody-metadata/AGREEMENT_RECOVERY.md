# Demand-model agreement registration recovery

The normal agreement dispatcher now supplies explicit workspace scope and the
stage command-journal directory to its existing publisher. JSON, Markdown and
GeoJSON agreement outputs each use a distinct retained artifact command keyed by
artifact type. Exact retries return the original receipt; changed bytes or
metadata require reconciliation. Storage verification and the local fallback
remain visible in the metadata. Both engines' full convergence records remain
separate, and `is_average` remains false. Agreement is sensitivity evidence, not
independent model accuracy.

## Verification

The existing 27 handoff checks pass. A new test enters the actual publisher and
retained client with mocked HTTP, exercises all three output slots twice,
verifies three distinct identities and three requests, and refuses changed bytes
before another registration request. The dispatcher test asserts workspace and
journal scope. Harmless and restored controls pass both suites. Restoring direct
insertion fails both; changing workspace scope fails the dispatcher assertion.
Private controls are in
`model-command-client-20261008-proof/agreement-artifact-controls.json`.

All 79 worker suites pass. Unit
`openplan-agreement-artifact-workers-20261008.service`, invocation
`d0dfb1b539dd45c393c72cd9d501b3cb`, completed at 07:54:38 Pacific on October 8,
with a 180.2 MiB peak under a 1 GiB cap. No checkout edits occurred during the
run. Each worker reused its existing environment through a local ignored symlink;
no dependencies were installed or changed. Product direction check passed with
its existing review reminders.

## Remaining boundaries

The HTTP and agreement inputs in these tests are synthetic. Native command
transaction and lost-response proofs belong to the parent recovery evidence.
This change does not retain the comparison computation, make local files
immutable, prove Storage durability, or authorize whole-stage replay. KPI writes,
comparison and geometry computation recovery, current ownership fencing, and
scientific, human and browser acceptance remain open. Full application QA and
GitHub integration checks for this follow-up remain pending.

## Preserve the existing volume-map file

The volume-map publisher now uses atomic, non-replacing file materialization.
The shared filename guard accepts `.geojson` alongside `.json`, with the same
basename restriction. Serialization retains the prior JSON formatting and
rejects non-finite numbers. Existing exact bytes preserve their inode; altered
bytes stop publication with an unconfirmed-write error before Storage or
registration. The file helper's missing-file and interruption checks also cover
GeoJSON. This supersedes the parent note that volume-map publication rewrites its
local file, but does not retain the spatial computation itself.

Harmless and restored controls pass. Restoring an overwriting write fails the
actual publisher test; bypassing the safe-name guard fails the file helper test.
Private evidence is `map-file-controls.json` under the proof root. All 79 worker
suites pass. Unit `openplan-map-materialization-workers-20261008.service`,
invocation `7dc6d58546924754a5c2acf709afbe6b`, completed at 07:58:21 Pacific on
October 8 with a 171.8 MiB peak under a 1 GiB cap. No checkout edits occurred
during regression. Mocked geometry and HTTP do not establish native spatial
correctness or Storage durability. Parent application QA remains running.
