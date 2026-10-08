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

## Historical worker writes and scope transfers

[The historical-execution fence](prototype/historical-execution-fence.sql)
refuses database mutations for unreconciled historical worker-backed runs. It
covers polling claims, late stage/run updates, new or replaced artifacts/KPIs,
and claim/validation projections. It checks both old and new run references so
moving a row cannot evade the historical boundary. This remains a prototype;
operators must stop workers before installation. A database trigger cannot stop
an already-running scientific calculation or revoke its access to local files.

[Combined native cases](prototype/verify_historical_execution_fence.py) challenge
18 historical mutations and confirm original run/stage/KPI state remains. A
newly enrolled synthetic run still claims, writes its first KPI and scientific
projection rows, and completes. Baseline, harmless-comment and restored cases
pass. Bypassing historical enrollment or dropping either side of the run-scope
check fails for the expected accepted mutation. These tests exercise SQL
projections, not a scientific algorithm, normal worker HTTP or scientific
publication recovery.

The adjacent retained-output guard also now locks and checks both the original
and destination runs. Previously, a row from an unretained run could be moved
into a retained run because only its original run was inspected. The expanded
receipt-family suite checks this transfer for each receipt family, for 33
prohibited changes. Nine adverse variants are detected, including omission of
the destination run. Ordinary progress and completion checks remain unchanged.

After the scope correction, atomic-start, contention, inspection and historical
fence suites all pass with their controls. The respective private evidence is
`retained-output-protection-v3`, `stage-execution-start-v3`,
`stage-start-contention`, `relaunch-custody-inspection-v2` and
`historical-execution-fence-v2` under the proof root. The concurrency clone remains
available; rollback-only runs make no lasting schema or fixture changes.

An operator-visible historical reconciliation workflow, installed migration and
populated upgrade/restore verification remain unfinished. The full worker path
must still establish preserved outputs, uncertainty and claim tiers under these
combined guards. Do not install this branch or merge PR #168 based solely on
these bounded native checks. No full continuation or V1 acceptance is claimed.

## Actual worker helper HTTP proof

[The HTTP check](prototype/verify_retention_worker_http.py) creates a separate
owned database clone with the combined prototypes. It uses the existing bounded
private PostgREST gateway without widening its database allowlist. A loopback
bridge forwards requests and can drop one TCP reply after the database commits.
The temporary gateway has a 128 MB memory cap and is removed after each run.
The proof clone, synthetic rows and local journals remain available.

The normal worker helpers claim a new stage, reject a second conditional claim,
set the parent running, retain a synthetic KPI and complete the stage and run.
An exact KPI retry reuses its saved receipt without another HTTP request. An
independent SQL read confirms one start, one KPI and a succeeded parent. These
calls use the normal worker functions; model computation is not invoked.

For another stage, the bridge drops the successful claim response. The worker
reports the write as unconfirmed. SQL still shows one committed start and a
running stage; another conditional claim returns false. The test does not treat
that false result as proof of ownership or permission to resume. A late state
update to an existing historical run is refused.

Baseline, a harmless payload-copy wrapper and restored behavior pass. A faulty
wrapper that swallows the transport uncertainty fails with `Committed claim loss
was hidden`. The first invocation lacked the required disposable-container
selection and refused before doing work; the corrected invocation supplies it
explicitly. Private evidence is `retention-worker-http/retention-worker-http.json`
and the exact prototype hashes are in that directory's `candidate.json`.

This verifies selected actual worker HTTP helpers under the combined guards.
It does not execute the full dispatcher, either modeling engine, Storage uploads,
scientific publication recovery, historical operator reconciliation or the
browser workflow. Those remain required, alongside installed migration/upgrade
and restore checks. The branch remains unreleased and PR #168 remains held.

## Additive migration and populated upgrade candidate

Migration `20261016000018_model_execution_retention.sql` now contains the four
SQL components tested above. Its SHA-256 is
`cd3af11561a57a2928984e21df2b474f031e8cf12cf71e2789daf2bd6fbe4efd`.
This supersedes the earlier statement that the branch has no migration; it does
not authorize deployment or declare the recovery workflow complete.

[The upgrade check](prototype/verify_retention_upgrade.py) clones the owned
migration-17 database and runs the installed Supabase CLI's migration command
twice. Migration history contains exactly one version-18 entry. Exact full-row
snapshots of 19 model, scientific and command-receipt tables are unchanged,
including 111 runs, 52 stages, 243 artifacts, 20 KPIs and both historical
assessment formats. Every existing run receives a separate historical-unassessed
enrollment record. No execution starts are invented. The source database remains
at migration 17.

[Installed rollback cases](prototype/model-retention-installed-cases.sql) check
historical refusal, new-run enrollment, claim retention, the queued-parent reset
refusal and normal completion. They preserve the original table snapshots.
Harmless-comment and restored migration upgrades pass. Relabeling old runs as
new fails the enrollment denominator assertion; allowing the queued-parent reset
fails the installed behavior case. The private SQL error record identifies the
expected failure, rather than treating any database error as a successful control.

The restored upgrade adds no WARN or ERROR database advisor findings. Its three
new INFO findings are the unused new run index and enabled RLS without client
policies on the two deliberately private tables. Those tables remain accessible
through their scoped functions and triggers, not direct client grants.

The schema inventory now records 304 RLS tables and 14 views, or 318 relations.
The six targeted schema suites pass 53 tests with three skips. Baseline,
harmless-comment and restored checks pass; an extra relation and an unread
column each fail the intended inventory assertion. The two observation timestamps
are explicitly recorded as write-only until an operator-facing reader exists.
The Unreleased changelog names the migration, worker-stop prerequisite and
historical write refusal. Private evidence is `retention-cli-upgrade`,
`retention-upgrade-controls` and `retention-schema-controls.json` under the proof
root. No application database has been upgraded.

Full candidate QA, populated restore, historical reconciliation, actual
end-to-end dispatcher behavior and T3 acceptance remain unfinished. In
particular, old run status must not be mistaken for current execution when the
record is held for reconciliation. Do not merge or deploy based solely on the
populated upgrade check. PR #168 remains held.

## Fresh-install transaction correction

PR #169's GitHub live-RLS job failed before its tests during `supabase db reset`.
Migration 18 reached `LOCK TABLE` outside a transaction and PostgreSQL refused
with SQLSTATE 25P01. The earlier populated `migration up` check did not cover
this execution path. This contradicts fresh-install readiness for the original
migration file; it does not establish an RLS-policy failure.

Migration 18 now has an explicit transaction around its entire body, preserving
enrollment locking and trigger installation as one change. Native clones run the
file in statement-autocommit mode. Baseline, harmless-comment and restored cases
install, preserve every existing model-run row, enroll 111 historical runs and
invent no starts. Removing the transaction reproduces the exact CI failure.
A deliberate SQL error before commit rolls back both retention tables and the
retained-command function, with the original model rows unchanged. The partially
applied negative-control clone stays isolated for diagnosis.

The current Supabase CLI also applies the corrected migration and migration 19
on a populated predecessor clone, then reapplies without duplicate history.
Both history versions are present. The original 19 model-table row inventories
remain unchanged, and the installed retention and recovery-reader cases pass.
No application database was reset or upgraded. Private evidence is
`retention-transaction-v1` and `retention-transaction-cli-upgrade-v1` under the
existing proof root. The corrected migration SHA-256 is
`bfb526df6d0ec90b6432dec3c7cc6e3deaf3a658a9991d7e9156a235437f8944`.

A new GitHub database-reset run must still confirm its actual fresh-install path.
Earlier exact-byte migration and full-QA results remain evidence for their
recorded heads; they do not automatically certify this corrected candidate.
