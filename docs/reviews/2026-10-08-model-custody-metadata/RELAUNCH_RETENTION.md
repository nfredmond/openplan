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

## October 22, 2026 source checkpoint for output-preserving retry

This checkpoint advances existing roadmap M3/S1. It does not close recovery,
scientific preparation, Reports R16 acceptance or full v1. The isolated source
is `/home/nathaniel/.t3/worktrees/openplan/t3-69f56da6`, branch
`t3/model-output-preserving-relaunch`, HEAD
`e1eb798775caa19648264680f0027976f5d6d2f7`. The clean prepared parent was
`05dd3e8da4a4572437f06e771b0a2477873e681f`. The first local fetch used that exact
HEAD from `t3-1ae80e46`, followed by an ordinary fast-forward-only merge. The
application tree at this binding is `57d7a1740579299c6e63dbe66e2666b46b090e39`.
The retained 31-path delta was reconciled after context compaction. No foreign
source change was adopted. Codex selection is GPT-6.1 Sol, high, priority.

The proposed additive migration is
`20261022050000_model_output_preserving_relaunch.sql`. All 434 existing SQL
files, including the 429 released files and five Reports migrations, remain
byte-identical to the bound HEAD. The proposed timestamp is unused elsewhere
in the registered worktrees and follows their observed highwater,
`20261021215752`. No released SQL or release version changes.

The existing recovery route and panel retain a fresh request identity, exact
replay, reviewed expected state, existing owner/admin authority and audit. The
new six-argument overload of `relaunch_model_run_attempts` snapshots the original
run, stages and attempts, revokes previous ownership, and queues the same run.
It does not delete outputs, rewrite scientific rows or change recorded inputs.
The immutable receipt authorizes the retained-output guard within its own
transaction. First-start records remain original; subsequent starts require a
new owned attempt and the retained retry decision. The old launch route and
five-argument refusal remain unchanged.

The existing native output projection retains its shape and privileges. Named
result KPIs and primary output artifacts with the wrong producer classify as
invalid bindings. Frontend result readers additionally require a completed
parent. Literal projections remain scoped to their original caller; incomplete
current row sets refuse rather than become zero. The assistant tool uses only
its user session, filters successful active attempts before its disclosed cap,
and rechecks the parent and detached stage identities after reading KPIs. This
is an optimistic recheck, not an atomic native projection. It depends on
nonreused attempt identities and existing command ownership rules. No private
attempt SELECT or hidden service read was added to the assistant.

Models, Projects/RTP and current scenario consumers select current completed
outputs. Recorded files preserve their original artifact IDs and hashes, with
separate inactive, legacy-unassessed and in-progress labels. A saved comparison
keeps its original pinned output; an unpinned public citation refuses across
retained attempts instead of redirecting to new results. Original published,
attested, evidence-bundle and artifact-download records remain historical reads.
The original public authorization boundaries remain in place. Reports pages,
readiness and guided-comparison verification remain unchanged.

Normal worker entrypoints now join the existing fresh admission and bound
writer. Queued versions retain separate command journals; uncertainty within a
version blocks a new claim. Managed dispatch checks actual scope, stage label
and queued version. AequilibraE keeps process serialization, retained predecessor
state/package/project/output handoffs and fenced terminal commands. Current
worker predecessor reads select native current IDs before a table cap and
refuse an incomplete projection. Managed failures do not fall back to legacy
claims or parent PATCH operations. This is source integration, not proof of an
executed prepared retry. In particular, the general AequilibraE prepared
instrument and the full assignment/extraction/second-assignment/agreement
lifecycle remain unfinished or unexecuted here. No general scientific preparation
service was added. Legacy unbound scientific records and registered population
replacement publications remain explicit M3/S1 holds, not completed recovery.

Ordinary checks use one worker, a 6 GiB Node heap and no test cache. The final
16-file run records 379 passing, two failing and zero pending tests. Both failures
are inherited Projects/Reports posture assumptions, reproduced with the original
Projects source restored. Root assigns their repair to Reports R26. This lane
does not duplicate it. Eight injected-transport/AST worker unit cases pass;
they exercise a real local command journal and synthetic handlers, not models.
Scoped lint and diff checks accompany the private source packet. Direction
checks pass with the original expired-registry/matrix and version reminders.
No authority date or capability grade was renewed.

Harmless controls survive. Targeted ordinary faults expose retained output
selection, unfinished parents, changed projected values, incomplete current
sets, assistant cap ordering, state rechecks, wrong producers, the scoped retry
RPC, acknowledgement, page projection, file ownership labels, guided recency,
worker scope/version/pending admission, writer binding, managed entry, retained
package handoff and capped predecessor reads. Each temporary edit is restored
byte-exactly. The first worker entry fault hit a missing extraction-fixture
helper; that result gets no credit. The corrected control reaches and fails the
forbidden legacy claim. Native SQL guard mutations, real role/concurrency
behavior, byte custody and full lifecycle execution remain blind categories.
Earlier wrong-directory ordinary invocations and the two inherited failures
remain recorded in the private packet; none is relabeled as a passing check.

Maintained native cases are authored for failed/cancelled same-run retained and
current outputs, exact replay/concurrency, late old writes, unchanged inputs,
user-session versus service selection, wrong producers and an authority change
during the user's stage recheck. They have not executed. No database install,
SQL/native command, model run, runtime stack, browser, compiler, build, worker
process, PR, CI, commit or push is admitted by this checkpoint. R16 Save/Generate
and actual Reports verification remain zero. Root owns independent review,
separate types/native admission, identified visible acceptance, join and release.
The unrelated release remains independent of this unfinished product work.


### Response checkpoint and configured types, October 22

The normal fast-forward to Reports fixture checkpoint
`bae2748d1d32af4a2e118295f9fd6eabd62fbd4b` resolves the inherited posture
fixture failures without changing the model production delta. Independent
review identifies two source defects: initial working-state preparation seals
the outgoing handoff too early, and the assistant omits five native KPI
producer names. The response separates mutable working-state materialization
from the existing immutable final handoff and applies all nine native producer
rules through the original user session. The nonreplacement hard-link guard
and service-only native projection authority stay intact. A fresh bounded
independent response review accepts both fixes at source tier.

The restored ordinary cohort records 401 passing tests with zero skips or todo.
Twelve selected worker tests use the actual writer, journal and temporary
filesystem with injected stage handlers. Harmless controls survive; the original
double-publication call causes actual FileExistsError, omitted producer rules
fail their named refusals, and foreign working directories refuse. All
temporary source edits restore exactly. These checks do not execute a model.

The first configured compiler fails on three possibly-undefined test responses.
Explicit fixture guards resolve those diagnostics. The single admitted repeat
passes with empty stdout and stderr at 2026-10-22T05:40:39.186043Z. Actual Next
declarations remain absent. This establishes configured checking, not a fresh
Next build. Original failures and source-review objections remain retained in
the dated private response, review and compiler records.

Installed 434-to-435 upgrade, native retry and current-projection parity,
concurrency, late writes, actual worker execution and identified desktop/390px
acceptance remain unproved. General AequilibraE prepared scientific inputs and
the full second-assignment/agreement lifecycle remain unfinished M3/S1 scope.
This source checkpoint does not declare completed recovery or model accuracy.


### Native protocol failure and bounded source response, October 22

Owned native round08 installs the populated 429-migration release, applies the
five existing migrations and then the sole model migration once. All 434
predecessor history rows and original representative seed rows remain exact.
Installed candidate function bodies and scoped ACLs match source. The single
maintained model-truth baseline records five passes, one failed-run retry
timeout at the unchanged 20-second limit, and 20 bail-unreached cases. No native
producer-parity or completed retry acceptance follows from that run.

The failed case reaches the deliberate stale expected-state refusal. Custom
SQLSTATE 40001 causes PostgREST 14.15 to retry it indefinitely after the runner
exits, matching the official Supabase KB. The exact owned residual backend is
terminated and its absence verified after cancellation alone does not stop it.
The running isolated 435 target, original rows/history, failure, cancellation
and stop receipts remain retained in native08. No source correction is applied
to that historical target.

The separately admitted source09 response changes only the six-argument
relaunch stale refusal code to PT409. Its predicate, exact message, request
identity/replay, locks, authorization and retained-output decisions stay as
before. The existing route returns the same HTTP 409 review-again response for PT409 while
retaining genuine and historical 40001 handling. Unknown errors stay unconfirmed,
and an error never becomes a successful receipt. The native fixture now
asserts PT409, actual HTTP 409, exact message and unchanged persisted rows,
including KPIs and retry receipts. Those new native assertions are unexecuted.

The five-file ordinary recovery cohort records 153 passes with zero failed,
skipped/pending or todo cases. A harmless comment survives. Reverting the code,
reversing the stale predicate, removing either conflict mapping, or accepting
an unknown error with a success-shaped payload fails the named ordinary
assertions. Every temporary edit restores exactly. An initial source-guard
file-URL error remains recorded; the corrected guard uses the maintained
app-relative path. Source guards and mocked route results do not prove an
installed PostgreSQL body, PostgREST response or live RLS.

Other deliberate 40001 sites remain separately scoped. Population replacement
uses another recovery decision branch and is not called by retry_execution.
Reports/Safety writeback and access-request conflicts are outside this response.
Their historical migrations remain byte-exact. General prepared science,
second assignment/agreement, full same-run recovery, native selector parity
and identified visible acceptance remain unfinished or unproved M3/S1 work.
Compiler and all runtime/native admissions remain closed for source09.

Reference: https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions

The separately admitted configured compiler10 runs once and exits zero at
2026-10-22T06:02:14.223846Z with empty stdout and stderr. Source, raw index
and the absent Next declarations remain unchanged. This adds configured type
evidence only. The corrected migration still requires a new isolated
installation and native HTTP-conflict/state-preservation acceptance.


### 2026-10-22 native race fixture precondition response13

Native12 remains a failed checkpoint: 25 pass, one mandatory race-hook
assertion fails, and no case skips. Its installed 435 functions, migration
history, fixture rows and complete private packet remain unchanged. The
queued agreement stage was unclaimed, so the user reader correctly refused
mixed-stage custody before reaching the intended third stage query.

This test-only response claims the agreement stage through the existing
claim_model_stage_attempt command after its predecessor succeeds. Before
injecting cancellation, the fixture asserts the actual running parent,
managed stage identities, owned unrevoked second attempt, native output
record and successful user read with no completed-run KPIs. The third-query
hook still invokes the real abandon command. Its execution, exact changed
execution refusal, cancelled parent and original retained KPI remain mandatory.
A separate native case preserves the legitimate mixed-stage early refusal
and asserts that reading changes no persisted row. All 26 original cases
remain, with this separate case bringing the authored native count to 27.

The focused ordinary cohort passes 68 assertions and explicitly skips all
27 native cases with both live gates disabled. Scoped lint passes. A harmless
comment survives; six faults fail named source guards for a missing real
claim, accepted early refusal, premature transition, optional hook, missing
real cancellation or accepted mixed-stage custody. Every fault restores
exactly. These source guards do not execute the native commands or establish
RLS, installed behavior or cancellation. The repaired native cases and
configured compiler remain unexecuted in this response.

The race fixture addresses a nonterminal cancellation recheck. It does not
prove current-KPI availability on an unfinished parent, a completed-parent
authority transition, worker execution, general prepared science, full M3/S1
or Reports acceptance. Reports accepting KPI handler and Save/Generate counts
remain zero. Root owns any later types, review and native admission.


### October 22, 2026 configured types14 checkpoint

The single configured TypeScript check for the real second-stage race fixture
passes at 06:40:30.668787 UTC with no diagnostics. Next declarations remain
absent. The private absent-next-env preflight copy failure remains recorded.
This adds typecheck evidence only. Native12 remains 25 passes and one failed
hook assertion; the corrected 27-case cohort remains unrun at this checkpoint.
General prepared science, actual worker and Reports accepting-route evidence
remain open.


### October 22, 2026 native16 retained retry checkpoint

The maintained 27-case native cohort passes on the unchanged installed435
target. It covers failed and cancelled retained-output retry, original replay,
late-write refusal, PT409 with HTTP409 and exact persisted state, all nine
user/native producer policies, mixed-stage refusal and a real nonterminal
cancellation recheck. The harmless focused control survives. Omitting the real
cancellation and ignoring the user recheck refusal each fail the named race
assertion. Restored focus passes two cases with 25 explicit selector skips.

All prior history, authorities and rows remain retained. New fixture records
remain on the isolated target. Raw index bytes change in cached timestamps
during the round; staged blobs/modes and source stay exact. The failed custody
assertion remains preserved. Root later restores the captured raw preimage
after confirming identical staged entries and clean source. The actor remains
unassessed. Neither restoration nor these tests establishes complete worker
recovery, prepared science, completed-parent races or Reports accepting routes.

Native12 retains its earlier 25-pass/one-failure result. The separate additive
managed-readiness bridge is unreviewed and uninstalled at this checkpoint.


### October 22, 2026 source-only forward allocation after the pending A0 high-water

The pending A0 candidate adds `20261021215752_assistant_chat_turns.sql`.
Before that candidate joins, the five unreleased population/Reports migrations
receive the ordered names below. Each new version sorts after that A0
high-water and before `20261022050000_model_output_preserving_relaunch.sql`.
This changes pending filenames and active test locators. It does not repair
installed history or change SQL contents, modes, authorities or scientific gates.

Old filename | New filename | Unchanged SQL SHA-256
--- | --- | ---
`20261019000003_model_common_population_comparisons.sql` | `20261022010000_model_common_population_comparisons.sql` | `259baaf52c6e0d5f16e0f92d569670026cc2946e8cdf18c4f2d65efe4f382337`
`20261019051430_model_population_replacement.sql` | `20261022010001_model_population_replacement.sql` | `956b3f6665272c2c7cad2e1311e25f2e330d61b7b3cc33086d24b6b9b8ff6765`
`20261019070000_guided_comparison_report_evidence.sql` | `20261022010002_guided_comparison_report_evidence.sql` | `efc8ddee8680386bf251842815034ac494d90709a49fed0b997e5c6cb39140e5`
`20261021000001_model_common_population_admission.sql` | `20261022010003_model_common_population_admission.sql` | `c39287e185cd3e344a368345cc4459aae815d4ee67523dfb6942b7dd812e0799`
`20261021000002_model_common_population_profiles.sql` | `20261022010004_model_common_population_profiles.sql` | `0718e14ae0bc69bf753e63aca57435db8f9318ac114ab6b6877ea34805be91f1`

All five retain Git mode `100644` and their prior filesystem modes. The model
relaunch SQL retains its existing name, bytes and modes. The current source
contains 435 migrations, without A0 or the separate readiness bridge. All 429
released paths and SQL remain exact to `945a78b`; the v0.70 ledger remains 429.
Released changelog entries and earlier review records remain unchanged.

The future join would contain A0's 430 plus these five, then the model relaunch
as 436, then the separate `20261022070000` readiness migration as 437. These
are future source counts, not installed or released claims. Root owns that join,
including the separate bridge's setup/test hunks. Prior native results bind the
old source and installed history; this allocation adds no native evidence.
No database, compiler/build, HTTP, browser, provider, worker or model runs here.
Private source/check handback: `reports-model-forward-allocation-20261022-34`.


### 2026-10-22 R69 bounded ordinary CI source repair

R68 retains four actual PR366 CI failures at head 3a11cf9. This response
changes three existing source files. The unread-column ledger individually
accounts for relaunch prior_attempts as an audit snapshot with no current
application reader, and retry_transaction_id as the transaction identity read
by guard_retained_model_outputs in migration 20261022050000. Strict unread and
stale-entry assertions remain. The agreement route test expects the existing
literal run_id and attempt_id projection, with byte, hash, scope and header
assertions unchanged. Model file copy says Saved files outside current results
in both visible and accessible labels, and states that current results could
not be verified while saved files remain available. Original file identities,
links, hashes and the distinction from current completed results remain.

The four affected test files pass 40 assertions. After exact restoration of
all controls, the final seven-file ordinary cohort passes 76 assertions with
zero skips, pending cases or todo. It includes retained-download, current-result
custody and mounted elapsed-clock checks. Scoped lint and diff checks pass.
A harmless comment change survives all four affected files. Removing either
new ledger entry, omitting either custody field from the exact expected
projection, restoring the counted original copy or restoring the old custody
alert each fails its named assertion. Every edit restores exact bytes and modes.
A private result-reader error expected column diff text absent from the Vitest
JSON. It is preserved and corrected using retained results, without repeating
the harmless or first fault subject. No product assertion is relaxed.

These checks establish ordinary source compatibility only. Ledger accounting
does not prove SQL execution or audit usefulness. The agreement fixture uses
the legacy/unmanaged branch; its strict query check does not establish managed
custody, live RLS or Storage behavior. Copy guards do not prove rendered
usability. No compiler, native, browser, model or worker runs occur. Earlier
CI failures and native12/native16 evidence remain retained at their own tiers.
Full M3/S1, general prepared science and Reports accepting-handler evidence
remain open. Reports accepting KPI handler and Save/Generate counts stay zero.


### Exact worker publication census, October 22, 2026 UTC

PR367's worker job119854381100 tests the same retained worker source and
fails the old three-call census. Managed Artifact Extraction adds a fourth
write_run_state call. The test now requires the four named stage owners,
checks full retained setup/package/assignment records, and keeps the
Artifact Extraction call inside its managed-only guard. Production main.py
is byte-identical to R126's admitted preimage.

This exact test backport passes all five unit cases on the Model parent.
R126 separately records a harmless survivor, four named census/scope/payload
faults and exact restoration against identical test/production bodies.
The wider R126 unit cohort passes35 tests across three files. Those are
ordinary source/local-publication checks, with no new engine, scientific,
SQL/native/HTTP, compiler, build or browser execution. Existing native
results retain their dated scope. The full prepared scientific lifecycle,
worker acceptance and M3/S1 remain unfinished. Current-head CI is pending.
