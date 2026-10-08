# Preserve retained outputs during relaunch

October 8, 2026. Candidate source `ce41dc15326ebf10dd00a69d7a59e0b98cc0c216`.
PR #168 remains on hold. This is an implementation checkpoint, not a deployed
migration or completed recovery workflow.

## Reproduced conflict

The existing launch route queues the same run, resets its existing stages, then
deletes artifacts, KPIs and scientific projections. The updated worker retains
stable output identities and command receipts for that same run and stage.
An exact retry returns a historical receipt. It does not recreate a deleted row.

A rollback-only native probe follows the run/stage update and KPI deletion order
with service-role commands in the owned disposable KPI-upgrade database. The
first KPI registration succeeds. After deletion, the same command returns its
original receipt while the KPI count remains zero. This proves the database
interaction, not the authenticated HTTP route or normal dispatcher journey.
Private evidence is `relaunch-receipt-deletion.json` and its executable
`probe-relaunch-receipt-deletion.py` under the existing model-command proof root.
No application database changes were made.

Clearing the journals or changing stable output identities would discard the
recovery evidence. Reclassifying a historical receipt as current existence would
misstate its meaning. Neither is a correction.

## Database prototype

[The proposed guard](prototype/retained-output-protection.sql) preserves legacy
runs that have artifact, KPI or assessment command receipts. It refuses requeue,
input or scope replacement, stage reset, and replacement/deletion of retained
run outputs. Ordinary progress and completion remain allowed. Existing managed
attempt guards remain separate. No trigger or function from this prototype is
installed outside a rolled-back test transaction.

[The native check](prototype/verify_retained_output_protection.py) runs 30
prohibited changes across three independently selected receipt families. The KPI
case uses the real registration RPC. Artifact and assessment receipt-selector
fixtures are synthetic table rows, not claims of completed scientific ingestion.
An unretained run still queues and deletes its synthetic KPI. Retained stages
still log progress and complete; retained runs complete; an unchanged KPI update
succeeds. Output values remain intact.

Baseline, harmless-comment and restored-source runs pass. Eight adverse variants
are detected: absent guard, each missing receipt selector, permitted requeue,
permitted input replacement, permitted deletion and permitted output replacement.
The initial broad deletion control reached an existing foreign-key refusal before
the intended assertion. Reordering the parent deletion after output changes
makes that control fail for an accepted prohibited output deletion. No existing
constraint or expected refusal was removed. All transactions roll back.

## Work required before integration

The route must inspect retained recovery state before failure-history, input,
run, stage or output writes and return a clear scoped refusal. A failed or
incomplete inspection must not mean that no retained work exists. A database
guard remains necessary because a route read is not an execution lease.

Complete native concurrent registration/reset and deletion cases, authenticated
route cases, projection scope and permissions, installed migration/upgrade and
restore checks. Verify the exact relaunch request through T3 at desktop and
390px when preview capture works. Current tests do not prove these boundaries.
The prototype also needs native coverage of its scientific-projection triggers
and cross-run changes before it becomes a migration.

A local computation can be retained before any database output receipt exists.
This prototype does not protect that earlier boundary. Full continuation needs
a durable execution identity before computation, attempt-aware output binding,
complete scientific ingestion and explicit reconciliation after interruption.
Current same-run relaunch and its local scratch reuse cannot be called safe
merely because receipt-backed deletion is refused. Preserve original producing
attempts and consumed scientific evidence. Do not enable full-stage replay.

The V1 contract and roadmap M3 remain unchanged. This checkpoint prevents no
production action yet and closes neither independent scientific acceptance nor
practitioner acceptance.

## Start boundary prototype

A second [prototype](prototype/stage-execution-start.sql) records a new stage's
transition from queued to running in the same database transaction. It also
records a stage inserted directly in running state. The marker records an
observed start boundary, not a worker identity, execution lease, completed
calculation or scientific result. It does not invent historical attempts.

The retained-run guard includes these start records, so a claimed stage needs no
artifact or KPI receipt to refuse destructive reset. Conditional claim retries
and ordinary running-stage log updates do not add another marker. A terminal
stage cannot return to running through this prototype. The marker table is
private and refuses updates and deletion.

[Native checks](prototype/verify_stage_execution_start.py) confirm these cases
with service-role stage writes in the owned disposable database. A deliberately
raised error after marker insertion rolls back both the new running stage and
its marker. Baseline, harmless-comment and restored-source checks pass. Four
adverse variants fail for the expected assertion: missing update-claim trigger,
missing start-record selector, missing running-insert trigger and mutable start
records. The first test invocation had a Python string-delimiter syntax error;
no database command ran. Correcting the delimiter leaves the assertions intact.
All successful and adverse native transactions roll back.

This narrows the computation-before-receipt gap for newly observed claims. It
does not establish safe behavior for an already-running process during upgrade,
historical cleared/requeued stages, concurrent claims and cleanup, or a lost
HTTP acknowledgement through the normal worker. Historical rows are deliberately
not backfilled by this prototype. Those upgrade and reconciliation decisions
remain required before any migration or production adoption. Run/stage scope
mutation, the projection guards and full authenticated launch behavior also
remain open. No browser or scientific acceptance is added by these tests.

## Competing-session claim boundary

The first concurrent reset case exposed another defect in the prototype. The
stage claim commits before the normal worker changes its parent run from queued
to running. A reset that writes queued over queued passed the guard's former
status-change condition even though the stage start was retained. The guard now
refuses writes that leave a retained run queued. The worker's subsequent update
to running remains permitted.

[The contention check](prototype/verify_stage_start_contention.py) creates a
49 MB owned proof clone and uses separate service-role PostgreSQL sessions. It
observes a database lock wait before releasing the first session. A second
conditional claim changes no rows. A reset and KPI deletion after a committed
claim are refused. If the first claim rolls back, the waiting cleanup succeeds
and no execution-start marker remains. These four cases pass for baseline,
harmless-comment and restored sources. Reintroducing the queued-parent condition
or allowing deletion produces the corresponding expected failure.

The original 30 receipt-family checks and atomic-start checks also pass after
the guard correction, including their adverse controls. Private evidence lives
in `stage-start-contention/stage-start-contention.json`,
`retained-output-protection-v2/retained-output-protection.json` and
`stage-execution-start-v2/stage-execution-start.json` under the existing proof
root. The contention clone and synthetic rows remain for investigation; the
prototype functions, triggers and start table are removed after each case.

This covers the stated claim-first races, not every lock order or an actual
worker process. Reset-first input changes, reaper/cancellation interactions,
HTTP loss, historical upgrade reconciliation, scientific projection mutation
and the authenticated route remain required. The launch route still needs an
early refusal before writing history or rebuilding inputs. PR #168 remains held.

## Route inspection checkpoint

The candidate launch route now calls `inspectRelaunchCustody` after route access
and applicable agent approval, before demographic rebuilding, failure-history
writes, requeue, stage reset and output deletion. A retained or unassessed result
returns 409. A missing RPC, query error, transport/configuration failure,
incomplete response or mismatched workspace/run returns 503. These refusals
contain no private exception text. The existing database guards still need to
arbitrate later writes; the inspection is not a lease.

[The RPC prototype](prototype/relaunch-custody-inspection.sql) records all existing
runs as `historical_unassessed` in an immutable private enrollment table. It locks
the run table while enrolling existing rows and installing the new-run trigger.
New inserts receive a separate `new_run` record. An editable creation date cannot
change that distinction. The RPC is service-role only and verifies workspace
and run together. It returns retained for managed/retained work, unassessed for
historical enrollment or evidence of stage execution, and unstarted only for
newly enrolled work without those conditions.

The three focused application suites pass 44 tests. They use the actual route
and inspection helper with mocked database responses. The route tests assert
zero insert/update/delete calls on refusal, exact workspace/run RPC arguments,
and no private inspection before authentication. Helper cases challenge malformed
payloads, wrong scopes and explicit errors. Four adverse controls bypass the
route guard, RPC error, run identity or workspace identity; each fails the stated
assertion. Baseline, harmless-comment and restored-source tests pass. Targeted
ESLint and whitespace checks pass. The first test-edit command used the wrong
working directory, so the subsequent run encountered fixtures without the new
RPC response. Correcting fixture setup preserves their original assertions.

[Native inspection tests](prototype/verify_relaunch_custody_inspection.py) verify
historical rows, an edited historical timestamp, new queued work, a committed
claim, wrong workspace, private permissions and immutable enrollment. Baseline,
harmless-comment and restored checks pass; history, scope and claim bypasses fail.
These run within rolled-back transactions and do not establish authenticated HTTP
behavior. Private evidence is `relaunch-route-controls.json` and
`relaunch-custody-inspection/relaunch-custody-inspection.json` under the proof root.

This branch is not deployable yet. Its route requires a function that still
exists only as a prototype; without installation it deliberately returns 503.
No migration has been added and no application database changed. Historical
polling-worker claims and already-running workers need an explicit installation
and reconciliation boundary. Route inspection alone does not stop such claims.
Do not infer that historical execution is safe from a missing local or database
record. Projection/scope controls, full installed upgrade/restore checks, HTTP
worker recovery and T3 evidence remain open. PR #168 stays on hold.
