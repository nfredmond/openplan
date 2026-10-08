# Atomic model run-state publication

October 8, 2026. This addresses local handoff durability under roadmap M3.
It does not complete model restart ownership or scientific acceptance.

## Finding and correction

Setup, network assignment and ActivitySim assignment each opened `state.json`
with write mode before serializing their next state. That truncates the previous
file immediately. An exception or process loss could leave incomplete JSON for
the following stage. The existing journal and retained artifact files do not
protect this separate local handoff.

All three writers now call `write_run_state`. It serializes a complete object
with nonfinite values refused, writes a private temporary file in the same
directory, flushes and syncs that file, atomically replaces `state.json`, then
syncs the directory. Ordinary failures clean up the temporary file. Process
loss may leave a private temporary file, but the published state remains a
complete old or new record.

Any publication exception becomes `WorkerStateWriteUnconfirmed`. Existing stage
handling stops without sending a compensating failure update. A failure before
replacement preserves the old state. A directory-sync failure after replacement
leaves the complete new state and reports uncertainty. The helper does not guess
that the rename is durable, undo it, or overwrite it with an error record.

## Verification

Five focused tests pass. They verify the file-sync/replace/directory-sync order,
complete JSON, temporary-file cleanup, invalid inputs, failures before and after
replacement, and each of the three actual stage call expressions. Fresh Python
processes exit immediately before replacement and immediately before directory
sync after replacement. The parent reads complete old and new state respectively.
This is process-interruption evidence on this filesystem, not a power-loss test.

Baseline, harmless and restored controls pass. Seven faults fail: accepting a
non-object, accepting nonfinite JSON, missing file sync, missing directory sync,
writing the target before replacement, swallowing a publication error and
bypassing the setup caller. Private evidence is
`model-command-client-20261008-proof/run-state-controls.json`.

All 84 worker suites pass with none failed or omitted. Unit
`openplan-run-state-workers-20261008.service`, invocation
`0ae60660126d4e60b8e7e6bc536800b7`, finished at 08:51:13 Pacific. Peak memory was
170.5 MiB under a 1 GiB cap. Worker sources stayed unchanged during regression.
Full application QA and GitHub integration checks remain separate.

## Remaining boundaries

The caller must own the run directory. This change does not retain earlier
versions, prevent stale competing writers, establish attempt ownership or make
an interrupted stage safe to rerun. It does not repair an already truncated
legacy state file. Preserve existing state, temporary files and command journals
when reconciling an interrupted run. Whole-stage replay remains disabled.
