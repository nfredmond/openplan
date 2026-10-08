# Recovery status candidate, October 8, 2026

The model page previously tried to reap stale historical runs on read. Migration
18 refuses those writes to preserve recovery evidence, while the reaper skips
RPC errors. The page therefore continues displaying the saved active status.
Its status-only relaunch predicate also offers a control the recovery guard will
refuse. This finding comes from source inspection, not a browser journey.

The candidate adds a service-role-only read of workspace-scoped enrollment and
observed stage starts. It does not grant execution ownership or change records.
The server parser checks exact workspace/run identities, provenance, timestamps
and count consistency. Missing, malformed and failed reads become unavailable.
In-process engines retain their existing behavior.

The authorized model page supplies recovery state to its run controls. Historical
runs display a reconciliation warning beside their saved status. Unavailable
records display a distinct read warning. Both states suppress relaunch, reaping
on page read, live progress estimates and automatic polling for those runs.
Saved stages and outputs remain inspectable; their status labels identify them
as saved records. This does not change scientific claim tiers.

## Checks completed

The focused reader and presentation suite passes 18 tests. It covers exact RPC
arguments, both scope identities, database and transport failures, malformed
records, historical status and the existing ActivitySim preflight distinction.
Baseline, harmless comment change and restored baseline pass. Removing the
workspace comparison, ignoring an RPC error and bypassing historical status
presentation each fail assertions. Private control results are retained at
`model-command-client-20261008-proof/recovery-status-controls.json`.

Targeted ESLint passes for all changed TypeScript files. The focused Vitest run
uses one worker, a 512 MB Node heap and a separate cache directory. It reads the
existing dependency installation without changing its package files. The first
invocation used the wrong relative path for the dependency link and did not run
tests; the corrected invocation produced the results above.

## Unfinished evidence and behavior

Migration 19 has not been installed or subjected to native permission, scope,
upgrade or restore tests. The reader tests mock its database response. Component,
page-loader integration and full app checks remain pending. No desktop or 390px
T3 acceptance has been collected for this candidate. Do not merge or release on
the strength of these unit checks.

The notice identifies reconciliation work; it does not perform it. Operator
inspection of database records, worker journals and output files, reviewed
reconciliation decisions, dispatcher recovery, current ownership checks and
whole-installation restoration remain unfinished. Cron reaping still attempts
historical writes and relies on the database refusal. The new-run state records
enrollment, not a current execution lease or a scientific acceptance decision.
