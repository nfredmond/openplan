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


## Artifact input and contention checks

Additional native input cases reject unexpected fields, noncanonical UUIDs,
blank URLs, nonobject metadata, string byte sizes and noncanonical hashes.
Invalid requests leave no artifact or receipt. Disabling each of the four
input guard blocks fails its stated assertion; harmless and restored controls
pass alongside the earlier six faults. These controls cover guard blocks,
not every possible malformed JSON value or each individual predicate.
Private results are in `legacy-artifact-input-controls/` under the proof root.

`prototype/verify_legacy_artifact_contention.py` uses independent PostgreSQL
service-role sessions and observes actual lock waits. It verifies simultaneous
exact retries, conflicting requests, stale-run cleanup committing first and
artifact registration committing first. The first two retain one artifact and
one receipt. Cleanup committing first refuses the new artifact and leaves
neither row. Registration committing first preserves its historical receipt
after cleanup marks the run failed. Each scenario passes with baseline, harmless
and restored candidates. Three fault controls detect changed-request acceptance,
a wrong retry receipt and registration after cleanup.

All 15 contention cases passed. Candidate objects were removed after the proof;
synthetic fixture rows remain in the isolated database. Evidence is retained in
`model-command-client-20261008-proof/legacy-artifact-contention/`. This does not
prove HTTP lost-response recovery, actual worker integration, immutable Storage
bytes, full stage replay or scientific acceptance. The candidate remains
uninstalled in application databases.


## Artifact HTTP permissions

The temporary candidate now has real PostgREST evidence in the named isolated
proof database. The service role registers the artifact and receives the exact
same row on retry. A workspace member and an unrelated authenticated user both
receive 403 from the command. Anonymous and unsigned callers receive 401.
The member can read the synthetic run through ordinary RLS while the outsider
sees no run, establishing the fixture's membership distinction. Denied command
calls create no artifact. Direct receipt-table reads are refused for every
tested role, including the service role.

Baseline, harmless SQL comment and restored candidates pass. In each run, an
intentional EXECUTE grant to authenticated users lets the outsider retrieve the
existing synthetic receipt. Revoking that grant restores 403. This control shows
that the permission check detects real exposure rather than a missing route.
The command and private table are removed afterward; the temporary gateway also
exits. Synthetic artifact and user fixtures remain in the isolated database.

The first invocation refused to start because the explicit disposable-container
selection was missing. Supplying the named proof container resolved that refusal.
No application database was selected. Evidence lives under
`model-command-client-20261008-proof/legacy-artifact-http`, with `-harmless` and
`-restored` companion directories. The executable check is
`prototype/verify_legacy_artifact_http_permissions.py`.

This proves HTTP access boundaries and exact service retries against a temporary
candidate. It does not prove a lost response through the retained worker client,
normal-stage adoption, Storage bytes, full restart recovery or model validity.


## Retained artifact client

The retained-command client now recognizes `record_legacy_model_artifact`.
Preparation keys the command by deployment and the previously prepared artifact
UUID. A changed payload cannot obtain a different request identity for that
artifact, even after the original request resolves. Requests retain workspace,
run, stage and all eight artifact fields. The client requires the matching
returned fields and an explicit null attempt identity before resolving the
journal. Canonical JSON comparison preserves distinctions such as boolean versus
integer metadata. The existing recovery command can inspect and retry this saved
operation without resuming a model stage.

Four new focused tests pass. They cover stable identity, conflicting saved
requests, journal retention before transport, uncertain delivery, exact recovery,
cached responses, changed receipt fields and invalid requests before transport.
All 18 tests across artifact, assessment preparation/delivery and publication
client modules pass. Baseline, harmless and restored controls pass; bypassed
scope validation, bypassed receipt matching, payload-derived request identity
and bypassed size validation each fail a targeted assertion. Private results are
`model-command-client-20261008-proof/legacy-artifact-client-controls.json`.

An initial test command used the wrong relative file path and did not create the
test file. Correcting the working-directory-relative path resolved it. The first
scope mutation reached transport and produced an error rather than the intended
assertion. The invalid-command test now records the exception and explicitly
asserts that transport was never called; the restored and adverse controls pass.

Transport is mocked in these tests. Native committed-write response loss and
fresh-process recovery remain unproved for this artifact operation. The normal
primary artifact registration still uses its existing writer, and the database
candidate remains outside application migrations. Full worker regression after
this client addition remains pending.


## Native artifact response-loss recovery

`prototype/verify_legacy_artifact_recovery_cli.py` now passes against the actual
retained client and a temporary PostgREST gateway in the named isolated database.
A loopback bridge forwards the first request, waits for the database's successful
reply, then closes the TCP connection without returning that reply to the client.
The client leaves one exact request pending. A fresh recovery CLI process lists
and retries it. A second CLI process uses the retained response without sending
a request. The original client also reuses that response.

The proof observes exactly two identical HTTP request bodies, one artifact row
and one command receipt. The local resolved response equals the database receipt.
Baseline, harmless and restored runs pass. Swallowing the transport uncertainty
and returning an empty cached receipt each fail their specific assertions.
Private evidence is retained under
`model-command-client-20261008-proof/legacy-artifact-native-cli/` and the
`legacy-artifact-native-*` control directories and JSON record. Candidate schema
objects, the temporary gateway and the loopback bridge are removed afterward.
Synthetic database rows and local recovery journals remain for inspection.

This is committed-write response-loss evidence for the retained artifact client.
The normal stage does not call this operation yet. Application migration, normal
registration adoption, remaining artifact/KPI side effects, complete restart
ownership, Storage byte custody and scientific acceptance remain open.
