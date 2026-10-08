# Retained stage preparation

October 8, 2026. This continues roadmap M3/S1 after the assessment delivery
checkpoint. The V1 contract and scientific acceptance requirements remain intact.

## Remaining restart problem

`stage_artifacts` currently generates a new model-output UUID and performs
multiple artifact and KPI writes before assessment custody. Recovering one
assessment receipt does not make replaying that stage safe. Its original output
identity, source bytes and settings must remain available, and each earlier
write needs its own retained request and checked receipt.

## Preparation component

`model_stage_preparation.prepare` uses the existing private SQLite journal's
WAL/FULL connection and adds a separate `stage_preparations` table. The primary
key binds deployment, run and stage. Within one immediate transaction, first
preparation saves canonical source-file facts, input settings and a generated
output UUID. Repeated exact preparation returns the saved UUID. Changed inputs
are refused rather than assigned a new output identity. Returned values are
detached from the caller's objects. Invalid or corrupted UUIDs and malformed
source byte identities are refused.

The component accepts caller-supplied size/hash facts. It does not read or verify
files, establish current stage ownership, authorize replay, fence another worker
or acknowledge a database artifact. It is not yet called by the normal stage.
Stage replay must also account for cancellation, retained artifact/KPI writes,
assessment records, publication and terminal updates before it is enabled.

## Verification

Five tests pass. They cover exact repeat and changed settings, changed source
facts, distinct deployment scope, four independent Python processes using the
same journal, invalid inputs and a corrupted saved identity. The process test
proves matching results under concurrent launch; it does not observe a database
lock wait or simulate power loss. SQLite durability settings are reused from the
existing journal, not independently re-proved here.

Baseline, harmless and restored controls pass. Omitting input comparison,
generating another UUID on retry, omitting deployment scope, accepting a corrupt
saved UUID and accepting a boolean byte size each fail their targeted tests.
Private results are in
`model-command-client-20261008-proof/stage-preparation-controls.json`.

This work owns `work/model-stage-recovery-20261008`. PR #164's assessment checkout
remains unchanged while its full QA gate runs at `f5ebdf56`. The new preparation
component does not change scientific outputs or claim tiers.

## Reading actual source files

`prepare_files` now computes SHA-256 and byte size from actual regular files
before saving preparation. It streams one MiB chunks and compares descriptor
and path identity, size and modification metadata before and after reading.
It refuses in-place mutation and path replacement observed during that read.
A nonblocking descriptor allows nonregular sources such as FIFOs to be refused
without waiting for a writer. Missing or refused sources do not create a journal.

Three file tests pass, alongside the five preparation tests. They verify exact
hash and size, harmless access-time changes, changed retained contents,
in-place mutation during hashing, path replacement and missing/nonregular files.
Baseline, harmless and restored controls pass. Removing the mutation check,
removing the regular-file check or returning a false digest each fails its
intended assertion. Private evidence is
`model-command-client-20261008-proof/stage-file-controls.json`.

This is a per-file read check. It does not freeze files after closing them,
produce a simultaneous snapshot of several files or establish that caller
scientific gates authorize reading output bytes. Those gates must precede this
helper. A later consumer must recheck the saved byte identity or use an immutable
copy. The normal stage still does not call this preparation component.

## Primary output connection

The normal artifact stage now prepares its primary output identity from measured
link-volume and network database files, plus the supplied setup, assignment and
package inputs. It retains this preparation under
`<work_dir>/stage-journals/<stage_id>/model-commands.sqlite3` before computing
stage outputs. Repeating exact preparation reuses the primary output UUID.
Changed preparation inputs propagate `WorkerStateWriteUnconfirmed`.

Before registering the primary link-volume row, the stage checks its actual
registration hash and size against the saved facts and checks run, stage and
artifact type. It then uses the prepared UUID. Other artifact identities and
KPI writes are unchanged and do not become safe to replay through this change.
The local source reference is not converted into immutable Storage custody.

Three tests pass. They execute the actual `stage_artifacts` preparation prefix
and its registration branch with temporary source files. Engine/profile helpers
are mocked, and the network fixture is synthetic bytes, not a runnable model.
The tests prove stable identity, refusal of changed sources and binding at the
actual primary registration branch. Harmless and restored controls pass. New
UUID generation, missing byte binding, missing scope binding and bypassing the
registration helper each fail a targeted assertion. Results are retained in
`model-command-client-20261008-proof/primary-output-controls.json`.

Full worker regression passed at `46d64d13`: 74 suites passed, none failed or
skipped. The owned `openplan-stage-preparation-workers-20261008.service` finished
on October 8 at 06:47 Pacific, with a 177.3 MiB peak under its 1 GiB limit.
The complete stage, server write recovery, restart ownership and scientific
acceptance remain open.


## Artifact write recovery candidate

The uninstalled `prototype/legacy-artifact-command.sql` candidate gives a
prepared legacy artifact one transaction for its row and recovery receipt.
Exact retries return the original response. Changed requests using the same
artifact identity are refused. An existing legacy row can be adopted only when
its complete submitted fields match and it has no managed attempt identity.
New registration checks workspace, stage, unmanaged ownership and stopped runs.
An exact historical retry remains readable after a run stops.

Rollback-only checks in the named isolated proof database pass. They cover new
registration, exact retry, conflicting requests, exact existing-row adoption,
receipt-insert failure rollback, stopped runs, workspace/stage mismatch, managed
runs and private receipt privileges. Baseline, harmless and restored candidates
pass. Six deliberate faults fail their intended assertions: changed-request
acceptance, wrong retry response, mismatched row adoption, stopped-run bypass,
workspace bypass and direct receipt insertion privilege. The verifier confirms
that the candidate function and table are absent after rollback. Private results
are in `model-command-client-20261008-proof/legacy-artifact-command/`.

This candidate is not installed or connected to a worker. These checks do not
yet cover all input guards, independent-session contention, HTTP role boundaries
or a lost response through the retained client. Those checks precede migration
and adoption. Existing direct legacy writes remain mutable. A saved response is
historical evidence, not proof of current ownership or Storage byte existence.
The ordinary primary artifact POST still needs this recovery integration.
