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
