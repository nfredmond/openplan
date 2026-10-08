# Evidence publication findings

Reviewed October 8, 2026 at `d4399e5f9c79602da59b31c285e9b81f028d9224`.
This records implementation defects within the existing M3/S1 work. It does not
replace the roadmap or declare managed worker adoption complete.

## Reproduced worker failure sequence

`workers/aequilibrae_worker/main.py::write_model_run_modeling_evidence` sends
a claim upsert, deletes existing metric rows, and optionally inserts new rows.
It ignores each HTTP status and suppresses all exceptions. An isolated execution
of the exact AST-extracted function, with synthetic transport responses, returned
normally after this sequence:

1. Claim upsert returned HTTP 503.
2. Validation metric deletion returned HTTP 204.
3. No exception reached the caller.

The input used a synthetic run/workspace and no validation result. Only transport
and the independent-validation summarizer were injected. No database, full
dispatcher or scientific model ran. This demonstrates the control flow, not a
production loss. Private evidence is retained at
`model-command-client-20261008-proof/legacy-evidence-partial-write.json`.
The inspected worker source SHA-256 is
`8189fe2d16ad19fb7d2707d907cf586f3aa8f5e106f8bcca73cf2f94b89b642d`.

The AequilibraE artifact path calls this writer and then appends a claim-update
success message. The ActivitySim assignment path calls the same writer for the
separate `behavioral_demand` track before completing its stage. A normal return
therefore cannot establish that either projection was stored. This finding does
not authorize promoting or merging their scientific outcomes.

## Related county path

`openplan/src/lib/models/evidence-backbone.ts::refreshCountyRunModelingEvidence`
deletes existing validation and claim rows before upserting sources and inserting
replacements. Unlike the worker, it checks returned errors. Those checks cannot
roll back earlier successful HTTP requests. A later error can leave an incomplete
projection. This is a source inspection finding; a native failure-injection case
for the county path remains required. County and model-run identities must remain
distinct through any shared publication mechanism.

## Current database boundary

Migration `20261016000014_model_attempt_command_custody.sql` installs
`guard_managed_model_projection` on both projection tables. It refuses writes
when either old or new model run is managed. County-only rows and legacy model
runs remain outside that refusal. The guard is intentional protection while
attempt-bound ingestion remains unfinished. Removing it to accommodate these
writers would reopen stale-worker publication.

## Required integration behavior

Publication must bind an exact request to its deployment, run or county identity,
workspace, method/track, source evidence and payload. The server must atomically
retain the prior publication, write its replacement, and save its receipt. A
retry with the same request and payload returns the original receipt; changed
payload reuse is refused. A lost HTTP reply remains unconfirmed until receipt
reconciliation, without deleting or regenerating evidence.

For managed runs, publication also verifies the active producing attempt and
its retained assessment/output identities in the same transaction. Completion,
reaping and publication must have explicit lock ordering and concurrency proof.
Legacy and county publication must not acquire a managed scientific claim by
using a compatibility route. Authorization must be checked at the actual entry
point, including workspace and run relationships.

Preserve prior rows and their source references before changing any current
projection. Retained history must distinguish the last completed publication
from a failed or unconfirmed replacement. Readers and reports need that status;
an old success must not appear as evidence for newly computed, unpublished
results. Source manifests, metrics and claim records form one publication.

The normal dispatchers must propagate publication uncertainty and avoid logging
success before confirmation. Existing rules-v4 and instrument evidence retain
their separate identities and claim limits. No generic publication RPC may turn
a caller-supplied status into independent scientific acceptance.

## Evidence still required for the fix

Native tests must inject failure after each write and establish that previous
records survive intact. They must cover exact retry, changed-payload refusal,
concurrent publishers, cross-workspace requests, stale attempts and both
publication/reaper orderings. A dropped reply after commit must recover through
the normal retained-command path. Harmless controls must pass and targeted
broken behavior must fail for each changed guard.

Worker and county caller tests must establish the actual request projection and
uncertain-result behavior. Report readers must distinguish retained evidence
from current confirmed publication. Browser evidence must identify the build
and cover desktop and 390px rendering through T3. These software checks still
do not establish independent scientific or practitioner acceptance.

## Immediate failure containment

The legacy worker now stops at a rejected claim, metric deletion or metric
insertion response. Lost replies and missing workspace identity raise
`WorkerStateWriteUnconfirmed`. Requests keep their timeout and refuse redirects.
The artifact caller propagates uncertainty before logging an acknowledged update;
the existing dispatcher leaves uncertain state for reconciliation. Scientific
tier calculation and method separation are unchanged.

Five focused tests pass, including 21 rejected-response combinations and three
lost-reply positions. They execute the actual helper with injected transport;
the artifact caller test executes its actual extracted try block. Ten existing
credibility checks and 27 assignment-handoff checks also pass. Baseline, harmless
and restored cases pass. Eight targeted faults are detected: each of the three
response guards, missing workspace, swallowed transport error, swallowed caller
uncertainty, enabled redirects and disabled timeout. Private evidence is
`model-command-client-20261008-proof/evidence-delivery-controls.json`.

An initial test command used an incorrect relative path and failed before the
test file existed. The corrected worker-directory command produced these results.

This contains the reproduced continuation after a rejected upsert. It does not
make multiple HTTP writes atomic, validate a receipt body, undo a committed
delete, retain the previous publication, or provide automatic recovery. The
county path is unchanged. Native transaction/retry and reader evidence described
above remains required before declaring publication recovery complete.

## Native failure and committed-reply evidence

`prototype/verify_evidence_delivery.py` runs the actual worker helper against
the named isolated CLI-upgrade database through a temporary PostgREST gateway.
It creates only a synthetic legacy run. Run
`8cd7ae72-1861-44e7-8df5-d15ec3450aea` recorded a native 201 claim insertion,
204 metric deletion and 201 metric insertion. The stored claim remained
`prototype_only`, with two distinct behavioral-demand metric rows.

A claim using a nonexistent workspace then received native HTTP 409. The helper
stopped after that request, and exact claim and metric snapshots remained
unchanged. A separate replacement claim committed with HTTP 200 before the
transport adapter injected a lost reply. The helper raised uncertainty and
issued no deletion; the original metric rows survived. This is an injected
reply loss after actual HTTP completion, not a socket-level interruption.

The changed claim and original metrics deliberately remain together in that
synthetic fixture. This directly demonstrates why stopping further writes is
not atomic publication or a complete recovery result. No scientific model or
normal stage dispatcher ran. The gateway changes only the Kong URL mount and
is removed after each case; no application or preview database was changed.

The native harmless and restored cases pass. Disabling the claim response guard
causes subsequent requests after rejection and fails the native check. Swallowing
the post-commit transport error reports success and fails the separate check.
All source mutations were restored. Native evidence and controls are retained
under `model-command-client-20261008-proof/native-evidence-delivery/` and
`native-evidence-controls.json`. Atomic publication, retained history, receipt
reconciliation, county replacement and reader integration remain open.

## Prepare the complete payload before delivery

`build_model_run_modeling_evidence` now calculates the claim and complete metric
set before the writer issues any HTTP request. Metric calculation errors and
non-finite JSON values therefore leave stored evidence untouched. The returned
payload copies nested source records; later mutation of the caller's assessment
cannot change that prepared payload. Scientific calculations, thresholds and
separate method tracks remain unchanged. This supplies a complete body for the
retained-command integration, but does not yet journal or atomically publish it.

Eight focused tests and the ten existing credibility checks pass. Baseline,
harmless and restored controls pass, with 12 targeted faults detected. The four
additional faults expose aliased source records, accepted non-finite values,
omitted metrics and a write during preparation. The first non-finite mutation
accidentally targeted an earlier unrelated serializer and survived; correcting
the target to the publication serializer triggered the intended failure.

The native proof passes again with the extracted builder for synthetic run
`79a0ea77-48ab-412f-9a2b-fab0fce7e646`. Evidence is retained under
`model-command-client-20261008-proof/native-evidence-prepared/`. It preserves
the same rejection and reply-loss boundaries, including the still-incomplete
claim/metric atomicity. No native scientific model or browser claim is added.

## Rollback-only atomic server candidate

`prototype/evidence-publication.sql` adds a candidate legacy model publication
command, private receipts and transaction context. It compares an exact expected
snapshot under the model-run lock, retains the prior claim and metric rows,
replaces them together, and records the result in the same transaction. Exact
request retries return the retained receipt; changed payloads and stale snapshots
are refused. After initial command publication, direct projection edits require
the private transaction context. Existing managed-run protection is unchanged.

The candidate currently accepts only `prototype_only` legacy model claims.
This is an unfinished ingestion boundary, not a permanent scientific policy or
a reduction of V1. Higher-tier evidence policy, managed instrument ingestion,
county source/metric publication and their readers still require implementation.
No normal worker calls this command, and it is not an application migration.

The native rollback-only suite uses actual installed application tables and
triggers in the owned proof database. It checks metric-constraint and final
receipt failures, retained prior evidence, exact retry, changed requests, stale
snapshots, workspace scope, duplicate metrics, managed-run refusal, direct-write
refusal and private privileges. New schema objects and synthetic records are
rolled back, and a separate catalog query confirms removal.

Baseline, harmless and restored cases pass. Seven targeted faults are detected
for changed-request checks, stale snapshots, lost history, changed retry receipts,
direct writes, cross-workspace reads and duplicate metrics. The proof runner is
`prototype/verify_evidence_publication.py`; private results are retained under
`model-command-client-20261008-proof/atomic-publication/`. These sequential
owner-session tests do not establish concurrent lock ordering, authenticated
HTTP behavior, complete field validation, durable client adoption, source-file
custody, browser behavior or scientific acceptance. Those remain open.

## Native concurrent publication

`prototype/verify_publication_contention.py` temporarily installs the candidate
objects only in the named owned proof database. Two real PostgreSQL sessions
call the command as `service_role`. The first holds its transaction open after
receiving a result. The proof observes the second waiting on a database lock
before allowing the first to commit.

With the same request, the waiting session returns the exact original receipt.
With different requests sharing one expected snapshot, the waiting replacement
is refused as stale. Each successful case retains one receipt and the first
committed projection. Baseline, harmless and restored cases pass for both modes.
Disabling the stale-snapshot check allows both publishers to commit and is
detected. Returning an empty retry receipt is also detected.

All eight cases finish, and the candidate functions, triggers and private tables
are removed. Synthetic run/projection rows remain in the owned proof database.
Evidence is retained under
`model-command-client-20261008-proof/publication-contention/`. This proves these
two concurrency orders on actual application constraints; it does not prove
publication/reaper ordering, HTTP delivery, worker adoption, county refresh,
higher-tier policy, complete field validation or scientific acceptance.

## Complete replacement and metric text corrections

New native fixtures reproduced two candidate defects before correction. The
claim upsert retained a prior `reasons_json` list even after replacing its current
status reason. A Boolean metric key also reached the table as the text `true`.
Both failed the new assertions on the uncorrected candidate.

The upsert now resets current reasons to the empty default used by the prepared
legacy payload, while retaining the original reason list in the prior-evidence
snapshot. Required metric text fields must be JSON strings with nonblank content.
Thirty type/blank combinations cover five fields against Boolean, numeric, null,
object, array and whitespace values. Existing database enum constraints continue
to reject unsupported string values.

The native rollback suite passes baseline, harmless and restored cases and
detects ten targeted faults, including the three new reason/type/blank faults.
The eight separate-session concurrency cases also pass against the corrected
candidate. Proof objects are removed after both suites. Results are retained
under `model-command-client-20261008-proof/atomic-publication-fields/` and
`publication-contention-fields/`. This does not close the candidate's remaining
installation, HTTP/client, county, managed-ingestion or scientific boundaries.

## Retained publication client preparation

The existing retained-command client now recognizes the uninstalled
`publish_legacy_model_evidence` candidate. It validates the complete prepared
body, saves the exact command before transport, maps its RPC arguments, and
checks receipt identity, claim fields, metric contents and row identities.
Metric order may differ, but missing or duplicated rows are refused. Boolean
and numeric values remain distinct. A replacement keeps the prior claim ID.

The recovery command can list and recover publication requests using run and
track identity, without inventing a stage. Failed or mismatched replies stay
pending; the original checked receipt avoids a second POST. Normal workers do
not call this candidate, and no migration has installed it.

Five publication tests and 20 existing client/journal/recovery tests pass. The
new cases include 13 malformed receipts and eight invalid command variants.
Baseline, harmless and restored controls pass; ten targeted faults in receipt
identity/values, JSON kinds, metric counts/identities, previous claim identity,
command scope/tier and duplicate metrics are detected. Private controls are in
`model-command-client-20261008-proof/publication-client-controls.json`. An initial
command used an incorrect relative output path and failed to create the new
test file; the corrected worker-directory command produced these results.

These tests use injected transport and private SQLite journals. Native command
delivery, socket interruption and process recovery for this new operation remain
unverified. The earlier native legacy-writer proof does not establish those
new-operation boundaries. County and managed publication remain incomplete.

## Native publication TCP interruption and fresh CLI recovery

The existing worker recovery proof now supports `--publication`. It installs
only temporary candidate objects in the named owned database and uses the actual
worker payload builder, retained client and fresh recovery CLI process. A local
HTTP bridge forwards the command to PostgREST, waits for the database response,
and closes the TCP connection before returning the first reply to the client.

Synthetic run `085c2dbb-d443-4300-8f91-8cccf8815eb9`, request
`5b6b4702-7e39-467e-8d27-39b838e4a691`, leaves the exact command pending after
the committed response is lost. The fresh CLI recovers its original receipt.
Two HTTP requests carry identical bodies; a subsequent cached recovery sends
no third request. The database retains one publication receipt, a matching
claim and both prepared metrics. No model is resumed.

Harmless and restored publication cases pass. Replacing the server's retry
receipt with an empty object makes recovery fail and is detected. The original
claim-recovery mode also passes after the shared proof changes. Temporary
publication objects and the HTTP bridge are removed; synthetic run/projection
rows and private journal evidence remain. Results are retained under
`model-command-client-20261008-proof/publication-native-cli/` and
`publication-native-cli-controls.json`.

This establishes the new command's tested HTTP/client recovery boundary. It
does not install an application migration, activate normal stage dispatch,
reconcile model files, publish county evidence or establish scientific validity.

## Existing evidence scope refusal

The native rollback test reproduces a missing prior-row scope check. The
candidate reader checked the parent run's workspace, but accepted a claim whose
own workspace differed. That could let publication carry forward the wrong
claim workspace or replace metrics with ambiguous ownership.

The reader now refuses existing claims or metrics with a workspace different
from the parent or a non-null county-run identity. Publication calls that reader
before changing evidence. Four native cases cover both tables and both scope
fields, verify read and publication refusal, and confirm unchanged prior rows
with no receipt or transaction context left behind. These synthetic cases use
real tables and constraints in the owned proof database, then roll back.

Baseline, harmless and restored variants pass; fourteen targeted faults fail
for their expected reasons, including the four new scope-check bypasses. The
existing parent-scope mutation initially failed at the newly added row check.
An empty-run case now isolates the parent check and detects its bypass directly.
The eight separate-session concurrency cases also pass after this change, and
all temporary proof objects are removed. Records are retained under
`model-command-client-20261008-proof/atomic-publication-scope/` and
`publication-contention-scope/`.

This is refusal of ambiguous legacy model evidence, not county publication or
a migration of prior records. Installation, normal dispatcher adoption, managed
scientific ingestion, lifecycle/reaper ordering and scientific acceptance remain
open. The candidate remains uninstalled in application databases.

## Publication and stale-run reaper ordering

The candidate now refuses a new publication when the locked parent run is
failed or cancelled. An exact retry still returns the original committed receipt
before that check. Receipt recovery records a past write; it does not reactivate
the run or establish a current scientific claim.

Native rollback cases cover failed and cancelled runs, unchanged evidence, and
historical receipt recovery. Baseline, harmless and restored variants pass, and
all fifteen targeted faults are detected. The new guard's bypass permits a
stopped-run publication and fails for that reason.

Separate service-role PostgreSQL sessions exercise both transaction orders
against the installed `reap_model_run_if_stale` function. The test observes an
actual lock wait before releasing the first transaction. Reaper-first refuses
publication with zero receipts. Publication-first retains one receipt and its
evidence, allows the reaper to mark the run failed, and returns the same receipt
on exact retry. Both orders pass in baseline, harmless and restored variants.
The concurrent guard-bypass mutation is detected when publication incorrectly
commits after the reaper. Together with existing retry and competing-publication
cases, all fifteen concurrency cases have their expected outcomes.

Temporary candidate objects are removed. Synthetic rows remain in the owned
proof database. Evidence is retained under
`model-command-client-20261008-proof/atomic-publication-lifecycle/` and
`publication-contention-lifecycle/`. This closes the tested legacy publication
versus stale-reaper ordering boundary only. Cancellation is tested sequentially;
managed ingestion, normal worker adoption, installed migration, county evidence,
reader presentation and scientific acceptance remain open.

## Complete local worker suite

At `38bf5eefad1afceb74ecd4b173c0f8abe5ae464d`, the repository's
`npm run test:workers` runner completed with 64 suites passing, two failing and
none skipped. The ActivitySim screening-handoff test omitted newly required
source-artifact and consumer-stage arguments. The command mutation suite copied
the client into a temporary directory without its new publication dependency.
Adding that helper alone exposed its additional `model_receipt_values` dependency;
both are now included. No production check or assertion was removed.

The handoff fixture repair lives in parent PR #162 at `b2b9d1dc` and is merged
here. The mutation suite now also retains the ten publication command/receipt
fault controls previously run from a private script. Its harmless controls and
seven test groups pass, with faults checked for their named failures and import
or syntax errors explicitly excluded.

The full runner at `fa4301e7` passes all 66 suites, with zero failures and zero
not run. Each worker uses its existing worker-specific interpreter through an
ignored local symlink; no shared dependency environment was modified. The
checkout stayed unchanged during each run. Both runs use a 4 GiB memory limit,
zero swap and two CPUs, with one numerical-library thread. The passing unit is
`openplan-publication-workers-repaired-20261008.service`, invocation
`d14f0447be7e4e2baa8974390e61fbf6`, completed October 8 at 05:39:11 Pacific in
30.264 seconds with a 172.4 MiB peak. The original failed unit remains
`openplan-publication-workers-38bf5eef.service`.

This is worker regression evidence. It does not replace live tenant isolation,
restore checks, identified browser workflows or independent scientific acceptance.

## Rules-v4 claim requires an explicit custody acknowledgement

The normal worker's payload builder previously withheld a rules-v4 pass only
when `validation_evidence_write` exactly equaled the failure string. A missing,
pending or malformed status therefore produced `screening_grade` from an
assessment marked `pass`. The new regression reproduces that behavior for both
assignment and behavioral-demand tracks.

The builder now requires `recorded` before a nonempty rules-v4 assessment can
support its existing higher-tier path. Other write states remain prototype-only
with a message that storage is not confirmed. The scientific outcome and source
assessment remain in the summary. This does not change computed residuals,
thresholds, method separation or the recorded planning-use/partition limit.

The test covers missing, null, empty, pending, explicit failure, boolean, number,
object and array write states, plus the recorded-pass control for each track.
Harmless and restored controls pass. Restoring the old failure-string check is
detected, as is a fault that rejects the recorded pass. Results are retained in
`model-command-client-20261008-proof/rules-v4-publication-custody-controls.json`.

All 66 worker suites pass at `f8800300`, with none skipped. The bounded unit
`openplan-publication-workers-custody-20261008.service`, invocation
`4e38bbbc7f29484d94e3e72ed4ae5f41`, completes October 8 at 05:41:42 Pacific in
30.263 seconds with a 172.8 MiB memory peak. The checkout stays unchanged during
the run. A recorded status is an internal acknowledgement, not independent
scientific acceptance. Atomic server verification of higher-tier evidence and
normal dispatcher integration remain required; the candidate still cannot replace
all existing writer paths.
