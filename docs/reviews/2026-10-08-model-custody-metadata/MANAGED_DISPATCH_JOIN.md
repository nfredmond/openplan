# Connect normal workers to retained execution attempts

October 8, 2026. Source audit at `f525836acca1403291419009d08c39c59e7bf739`.
This record refines the existing M3/S1 implementation boundary. The roadmap
remains the sole queue. No worker, database or scientific result changes here.

## Decision

Connect both normal dispatchers as one lifecycle change. Do not switch only
`sb_claim_stage` to the managed RPC. A successful managed claim protects the
parent and stage from their existing direct writes. Their next progress or
parent update would then fail. Receipt recovery already exists; it does not
authorize running a stage again after a lost reply.

The direction check passes with registry-age and intervening-change reminders.
The full contract, capability matrix and October 6 direction review still
require operations and separate scientific acceptance alongside everyday
planning work. This audit neither refreshes those review dates nor promotes a
capability grade.

## Verified source inventory

Paths are relative to the repository root. Line references describe the audited
commit; function names are the durable navigation anchors.

| Boundary | Existing implementation | Required join |
| --- | --- | --- |
| AequilibraE entry | `workers/aequilibrae_worker/main.py::_claim_and_run_stage`, lines 6485 onward, claims by conditional REST PATCH and separately marks the parent running. Poll and push share `process_first_actionable_stage`. | Retain the claim request before transport. Resolve its exact receipt before dispatch. Use the claim transaction's parent transition. Exercise both entrypoints. |
| ActivitySim entry | `workers/activitysim_worker/supabase_poll.py::process_stage`, line 887, uses the same separate claim and parent writes. | Use the same command protocol in the packaged worker, with invocation-local attempt context. Confirm its package includes every imported command module. |
| Progress | AequilibraE `stage_setup` has three `sb_patch_stage` call sites; `stage_assignment` has six. ActivitySim `run_bundle_and_preflight_stage` has four. | Retain each intended progress command. Define how a log-only patch becomes a complete command without deleting prior error/log facts or inventing timestamps. |
| Successful completion | AequilibraE dispatcher reads unfinished stages, then PATCHes parent success. ActivitySim calls `maybe_mark_run_succeeded`, also a separate read/write. | Use `write_model_stage_attempt` for the terminal outcome. Its parent lock and complete-stage check own parent completion. Remove the managed path's separate parent PATCH. |
| Failure | Both dispatchers issue a failed-stage write followed by failed-parent PATCH. AequilibraE preserves a real partial log and removes the claim placeholder. | Preserve useful failure evidence in one retained terminal command. Its native transaction revokes sibling ownership and terminalizes outstanding stages. Do not turn delivery uncertainty into computational failure. |
| Blocked predecessor | Both `mark_stage_skipped` functions PATCH an unclaimed queued row after a separate readiness read. | Do not invent a claim for skipped work. Decide this state through a parent-locked lifecycle operation or the existing terminal transaction, and prove the stale-read case. Keep skipped, failed, cancelled and unassessed meanings separate. |
| AequilibraE output | `stage_artifacts`, agreement registration and dispatcher output use retained legacy artifact/KPI/assessment commands. | Bind each output to its actual producing attempt and stable command identity. Retained legacy delivery is not managed ownership. Preserve existing byte hashes and method separation. |
| ActivitySim output | `run_bundle_and_preflight_stage` and `_write_executed_behavioral_kpis` still call direct `sb_post_artifact`/`sb_post_kpi`. | Connect registration to retained attempt commands, including upload confirmation and lost-response recovery. A successful file upload alone is not a registered output. |
| Local files | AequilibraE uses full-run UUID directories and mutable `state.json`; ActivitySim creates separate `execution-*` directories beneath the run UUID. | Bind local state, journals and outputs to installation and attempt, retaining predecessor identity. Neither current naming scheme by itself proves attempt ownership or safe restart. |
| Relaunch and history | The launch route calls the custody boundary; historical/retained executions have restrictions beyond the older relaunch RPC. | Reconcile these restrictions with an explicit recovery workflow. Do not silently reopen retained runs or treat the existence of a relaunch RPC as authorization to use it. |

The call-site counts come from Python AST inspection of these two files, not a
claim that all database writes across the repository were exhaustively found.

## Existing protocol to reuse

Migration `20261016000014_model_attempt_command_custody.sql` supplies managed
claim and stage-write commands. Claim checks the parent, queued stage, active
attempt and lower-order prerequisites while holding the parent lock. Repeating
an identical request returns its retained receipt, including `not_claimed`.
Do not reuse that request for a later scheduling decision and expect a new claim.

The stage-write command and `model_command_client.py::validate_command` accept
only `running`, `succeeded` and `failed`. Adding `skipped` to a Python wrapper
would not define its database semantics. A completed claim receipt also remains
a historical receipt after revocation. The existing ownership inspector is a
point-in-time read, explicitly not a lease or permission to resume computation.

Reuse the command journal and checked receipts. Keep attempt context scoped to
the current invocation, including AequilibraE's process lock and ActivitySim's
handler boundary. Do not create a global run-to-token cache. Resolve pending
commands before later publication, and stop if that reconciliation is uncertain.

## Implementation and evidence order

1. Specify the complete transition table for both workers: fresh claim, lost
   claim, uncertain claim, progress, output, successful completion, computation
   failure, blocked predecessor, cancellation, reaping and restart. Preserve
   retained historical records. Decide blocked-stage semantics before changing
   normal dispatch.
2. Add invocation-scoped command and filesystem ownership to both packages.
   Connect every write in the inventory, including failure and output paths.
   Keep the enforcing database checks active; no legacy fallback on refusal.
3. Exercise actual normal dispatchers against an isolated native database with
   synthetic domain handlers. Include two independent worker processes, push
   versus poll, predecessor completion races, lost acknowledgements at each
   retained boundary, revocation during execution and a fresh recovery process.
   A handler spy must prove uncertain/replayed claims do not execute twice.
4. Verify old workers cannot change managed rows or register outputs, and that
   managed workers do not rewrite historical records. Restore database, journal
   and exact output bytes together into another isolated installation. Confirm
   ownership before any continuation; test wrong installation and wrong attempt.
5. Exercise the resulting recovery controls through real navigation at desktop
   and 390px, with identified build, console inspection and usable artifacts.
   T3 currently reads pages but cannot capture screenshots. That remains an open
   evidence boundary, not a passing visual check.

Each changed test or guard needs its harmless control and a broken behavior that
fails for the stated reason. Synthetic execution proves lifecycle behavior,
not AequilibraE or ActivitySim accuracy. Do not run consumed scientific holdouts
to test this integration. Complete prepared-instrument/assessment custody,
independent scientific acceptance and observed practitioner use remain required.

## Integration custody

PR #170 remains the unchanged main-target candidate at the audited commit while
its CI runs. This follow-on work belongs to
`work/managed-dispatch-integration-20261008`, outside the frozen acceptance
checkout. Do not describe its future implementation as part of PR #170 or as
already released. The earlier attempt-ownership, worker-command and recovery
records remain applicable; this inventory narrows the next code inspection,
not the v1 destination.

## Blocked-stage transaction prototype

`prototype/skip-blocked-stage.sql` defines a separate operation for unclaimed
queued work. It locks the parent and its stages, verifies the named earlier
predecessor and its expected terminal status, and derives the reason from that
record. A stale observation returns a retained `not_skipped` receipt. A changed
payload under an existing request identity is refused. The operation creates
no execution attempt or start record and leaves the parent unchanged.

This operation does not replace the existing managed failure transaction,
which already stops outstanding stages. It addresses the legacy dispatcher's
separate blocked-predecessor path without treating unexecuted work as an attempt.
The complete managed transition table must still reconcile cancellation and
dependent failure semantics before normal dispatch switches over.

`prototype/verify_skip_blocked_stage.py` exercises the actual SQL against the
owned retention fixture database in rollback-only transactions. Baseline,
harmless-comment and restored cases pass. Six broken variants fail their
intended assertions: overwriting running work, ignoring a changed predecessor,
ignoring request identity, ignoring workspace, accepting a later predecessor
and omitting the retained receipt. A synthetic receipt-insert failure rolls back
the stage change; the same request succeeds after that failure is removed.
The verifier confirms the prototype table and function are absent both before
and after every variant. Results are in `prototype/skip-blocked-stage-controls.json`.

Permissions follow the existing service-only command pattern and the
[Supabase function guidance](https://supabase.com/docs/guides/database/functions).
The test checks role grants; it does not invoke the function under each role.
The cases use new unmanaged synthetic rows. Managed-parent cases, simultaneous
processes, HTTP uncertainty, worker packaging, journal delivery, migration and
retention integration remain open. No application database or running worker
was changed. This prototype is not an installed feature or scientific evidence.

### Managed history and actual role follow-up

The verifier now also loads `prototype/skip-blocked-managed-cases.sql`. Real
`anon` and `authenticated` calls fail with insufficient privilege. A real
`service_role` call skips the eligible unmanaged fixture and recovers its exact
receipt; a direct receipt UPDATE under that role is refused. Two added controls
grant anonymous or authenticated execution and fail at their actual invocation
assertions. The original six broken controls still fail; baseline, harmless and
restored cases pass.

Separate fixtures acquire real managed attempts, then terminate through either
`write_model_stage_attempt` failure or the native reaper. The skip operation
returns `not_skipped` and preserves every parent, stage and attempt row in those
terminal histories. The reaper uses an explicit synthetic cutoff to exercise
the transaction, not to establish timeout or heartbeat correctness.

This closes the preceding entry's actual-role and managed-terminal-history
checks. It does not establish concurrent-process ordering, an eligible managed
queued skip, HTTP uncertainty, worker integration, installed migration custody
or scientific acceptance. The updated controls file records eight targeted
broken variants. All synthetic records and prototype objects roll back.

### Concurrent database sessions

`prototype/verify_skip_contention.py` creates a separate owned clone of the
retention fixture database. It does not install anything in the source or the
application database. Separate service-role sessions exercise committed and
rolled-back receipt writes, plus committed and rolled-back predecessor changes.
The verifier observes the contender waiting on the identified owner's database
lock before releasing that owner. It does not infer contention from a sleep.

Baseline, harmless and restored variants pass all four cases. Exact concurrent
retries return the same receipt. An owner rollback allows one later receipt and
one skipped stage. A committed predecessor change leaves the dependent queued
with `not_skipped`; a rolled-back change permits the original skip. Every case
checks that no attempt or execution start was invented.

Removing both prerequisite locks makes the contender use the old predecessor
state after the owner commits. The intended assertion fails. Restoring the
original function makes that same case pass. `prototype/skip-contention.json`
records 13 successful cases and the targeted negative control. The clone retains
synthetic records for inspection; its function is restored to the original
prototype. Source rows and running workers are not changed.

This establishes the tested database ordering. It does not establish HTTP lost
acknowledgements, command-journal recovery, installed migration/retention rules,
normal dispatch or scientific acceptance. Those connections remain next in the
same M3/S1 work, before either worker changes its claim path.

### Retained worker-client delivery

`model_command_client.py` now accepts `skip_blocked_model_stage` through its
existing journal and transport. It validates all request identities, rejects
self-predecessors and nonterminal blocker states, and sends the complete scoped
RPC payload. Receipt checks bind the workspace, run, stage, predecessor and
request. A skipped result must match the prepared predecessor status and carry
a completion time. `not_skipped` remains a distinct retained outcome. Extra
receipt fields, including an invented attempt identity, are refused.

The six new client tests use the real SQLite journal and injected transport.
They verify preparation before sending, pending state after a lost reply,
recovery of the original request, changed-payload refusal, receipt validation and
cached recovery without another send. A fresh CLI process reads the retained
receipt and explicitly reports `model_resumed: false`. The 21 focused tests pass,
followed by all 55 existing command tests. The broader run still emits the
previously observed unclosed-SQLite ResourceWarning; it does not fail.

Harmless and restored controls pass. Five targeted mutations fail on omitted
scope validation, inconsistent successful outcomes, extra receipt fields,
invalid blocker status and an omitted RPC workspace. Invalid cases use separate
journals, so one accepted bad receipt cannot contaminate subsequent cases.
Results are in `prototype/skip-client-controls.json`.

This is client support for the prototype, not activation of normal dispatch.
Native HTTP lost-reply recovery, an installed additive migration, receipt
retention integration and the complete two-worker join remain unproved.

### Native HTTP recovery after a committed lost reply

`prototype/verify_skip_http_recovery.py` clones the owned retention database and
installs the prototype there. A bounded PostgREST container and loopback fault
bridge carry the real worker client's RPC. The bridge waits for a successful
database response, then closes the connection before returning that response to
the client. The original command remains pending locally while its receipt is
confirmed independently in PostgreSQL.

For both `skipped` and `not_skipped`, a fresh recovery CLI process retrieves the
same retained outcome. Parent, stage, attempt, execution-start and receipt rows
remain unchanged by that retry. Another fresh process uses the cached receipt
without HTTP or a credential. Recovery still reports no model resumption.

Baseline, harmless-comment and restored runs pass. Each uses four HTTP calls
across the two cases. Removing receipt insertion causes the expected
`Committed skip receipt missing` failure after the deliberately dropped reply.
The bounded gateway is removed after every variant, including the failed
control. Synthetic clone records and journals remain in the private proof
directory. Results are in `prototype/skip-http-recovery.json`.

This closes the native lost-reply boundary for the proposed skip operation.
It does not install a migration, connect either normal dispatcher or establish
whole-run recovery, browser acceptance or scientific accuracy. Receipt retention
must join the installed lifecycle before deployment.

### Additive migration and retention

Migration `20261016000020_model_blocked_stage_receipts.sql` now installs the
command, private receipt table, foreign-key indexes and immutable-receipt guard
in one transaction. A successful skip joins existing retained-history checks.
A `not_skipped` receipt alone does not count as execution or stop the first
legitimate claim. Neither normal worker changes its dispatch path here.

The CLI generated a migration file with the current date. Its version was moved
after the repository's existing `20261016000019` high-water mark before use.
`verify_skip_upgrade.py` applies and reapplies the actual migration through the
CLI on an owned populated clone. Row counts and canonical-content checksums for
all 32 preexisting model tables remain equal. Installed retention and role cases
pass and roll back; the receipt table remains empty afterward. Source rows and
migration history remain unchanged. `prototype/skip-upgrade.json` records the
actual migration hash and comparison evidence.

The first upgrade invocation stopped before cloning because its old metadata
suggested migration 18 while the database was already at 19. The verifier now
reads and records the actual supported predecessor version. The successful
upgrade starts at 19. An initial JavaScript test invocation also used the wrong
nested dependency path and did not run; correcting that path allows verification.

The schema inventory initially fails at 318 versus 319 relations. The native
catalog confirms one added private table: 305 application tables, all with RLS,
14 application views and no new client policy. Two additional catalog views
belong to PostGIS. The declared counts now match that evidence. All 39 migration
tests pass. Harmless and restored inventory controls pass; removing the new
table's RLS statement fails the intended 305-versus-304 assertion.

`verify_skip_retention.py` passes baseline, harmless and restored native cases.
Four targeted mutations fail: omitting successful skips from retained history,
freezing a no-op run, permitting receipt rewrite and permitting receipt deletion.
The native cases prove a no-op run can still acquire its first managed claim
without manufacturing an earlier start. Results are retained beside the verifier.

The security advisor reports eight findings, identical in source and candidate:
four mutable function search paths, three public-schema extensions and the
PostGIS `spatial_ref_sys` RLS finding. None names the new skip objects. They remain
recorded findings, not a clean whole-database security result. The existing
extension schemas and unrelated functions were not changed by this migration.

Installation in the proof clone does not establish whole-installation restore,
normal-worker recovery, browser acceptance or scientific acceptance. The next
join still includes every normal worker write and explicit continuation
reconciliation; the new migration alone does not authorize replay.

### Normal blocked-stage paths connected

Both workers' `mark_stage_skipped` paths now reread the earlier stages, select a
current terminal predecessor and deliver the retained command. The database
still verifies its scope, order and status under locks. The shared
`model_skip_command.py` derives a stable request from the installation, scope and
observed stage/predecessor `updated_at` values. Repeating an observation recovers
the same request; either changed row version produces a new decision. Missing
timestamps stop delivery instead of silently choosing a new identity.

Both poll projections and prior-stage reads include `updated_at`. No-op receipts
return false; the AequilibraE shared push/poll dispatcher reports a lost decision,
and ActivitySim does not claim it processed a skip. Uncertain writes leave the
original journal request pending and raise the existing uncertainty exception.
Neither path falls back to direct PATCH. Journals live beneath each worker's
full run directory in `skip-commands/<stage-uuid>/`; deployment guidance records
the required migration and installation identity.

The 12 focused skip tests pass, including six new dispatcher tests with actual
journals and injected HTTP. The tests verify pending recovery, no repeated send,
distinct no-op outcomes, row-version identity changes, missing-version refusal,
no direct PATCH and query projections. All 44 ActivitySim tests and 38
AequilibraE push-trigger checks pass. Harmless/restored controls pass. Six
targeted faults fail on false skip outcomes, stale stage/predecessor identities
and omitted observation projections. Results are in `skip-dispatch-controls.json`
beside the other prototype evidence.

These worker-path checks inject the transport. The earlier native SQL/HTTP
checks remain separate evidence; this entry does not claim a combined native
worker journey yet. Normal claims, progress, outputs, terminal outcomes and
filesystem/continuation reconciliation still need the full managed-attempt join.

### Native HTTP check of both connected skip functions

The combined check now invokes each actual `mark_stage_skipped` function against
an owned clone with migration 20 installed. Predecessor and parent reads use
native PostgREST. The target stage input comes from native SQL, so this check
does not establish the complete poll or push loop.

Both workers pass baseline, harmless and restored cases for `skipped` and
`not_skipped`. The latter changes the predecessor after the worker reads it and
before the database evaluates the command. In every case the database commits,
the bridge drops the reply, and the worker preserves its pending request. A
fresh recovery CLI retrieves the exact receipt without changing parent, stage,
receipt, attempt or execution-start records. Cached recovery sends no HTTP.
Each successful control records four worker reads and four RPC calls across
the two outcomes. Removing the predecessor timestamp projection prevents
journal creation and fails the intended assertion for each worker. Temporary
function replacements are restored and bounded gateways are removed.

The first baseline-only run passed. A second run adding controls failed because
the test compiled readers with copied module globals. Those copies did not
receive the owned endpoint overrides. No application write occurred. The
corrected verifier binds the compiled function to the worker's live globals;
all controls then pass. `skip-worker-http.json` retains the corrected results.
The existing direct-client native HTTP checks also pass again after the shared
helper changes, including harmless, missing-receipt and restored controls.
Their refreshed results remain in `skip-http-recovery.json`.

This closes the combined native skip-function check left open above. Normal
managed claims, progress, output publication, terminal outcomes, filesystem
ownership and continuation reconciliation remain unfinished. These synthetic
checks do not establish engine execution, whole-run restart, browser acceptance
or independent scientific acceptance.

### Local execution admission prepared

`model_attempt_invocation.py` prepares the next integration boundary. Its public
entry creates a fresh claim request rather than accepting a recovered request.
It reserves that request and a local admission in one SQLite transaction before
transport. Only a checked claimed receipt and a current ownership snapshot can
reach the handler. The journal consumes admission before callback entry. Saved
requests require reconciliation, including requests whose replies were later
recovered. A declined claim invokes no handler and performs no ownership read.
The callback receives immutable installation, workspace, run, stage, attempt and
claim identities. No global attempt cache is added.

Nine tests use actual local SQLite transactions with injected HTTP. They check
ordering, competing threads, declined claims, ownership revocation/uncertainty,
lost claim recovery, fresh request identities and a fresh process refusing a
saved invocation after simulated callback process loss. They do not simulate a
kernel kill. All 35 focused admission/client/journal/ownership/recovery tests
pass. Harmless and restored controls pass; three targeted changes fail when
saved receipts admit replay, revoked ownership is ignored or durable entry is
omitted. `invocation-controls.json` records source identity and control outcomes.

This is not wired into either normal dispatcher. Database locking across hosts,
filesystem ownership, managed progress/output/terminal commands and explicit
continuation remain required before that switch. The ownership read is a
snapshot, not a lease. Each later write must still use its database attempt
check. Local admission alone does not protect a copied or rolled-back journal;
the fresh public claim and database ownership checks remain distinct boundaries.
No terminal failure is inferred from a transport failure or callback exception.

| Event | Required dispatcher behavior | Current evidence boundary |
| --- | --- | --- |
| Fresh claim | Retain request, accept only checked ownership, consume admission before handler | Local admission helper tested; normal dispatch not connected |
| Lost or uncertain claim reply | Keep original request; recover receipt without invoking handler | Client recovery and local refusal tested separately |
| Declined claim | Return without computation or terminal write | Local helper tested with injected transport |
| Progress | Retain complete log/error intent through the attempt command | Command client exists; normal progress adapters pending |
| Output | Bind bytes and output identity to the producing attempt | Managed commands exist; both normal output adapters pending |
| Successful completion | Let fenced terminal transaction decide parent completion | Native command evidence exists; normal dispatcher join pending |
| Computation failure | Preserve useful log and error in one fenced terminal command | Normal managed failure adapter pending |
| Blocked predecessor | Retain skip/no-op without inventing execution | Both normal skip functions have combined native HTTP evidence |
| Cancellation or reaping | Stop future fenced writes; do not infer renewed ownership from a receipt | Native revocation and reader evidence exists; invocation journey pending |
| Restart | Recover exact receipts, reconcile files and state, require explicit continuation | Receipt recovery exists; full continuation remains pending |

The direction check still passes with registry-age and intervening-change
reminders. This implementation does not change review dates, capability grades,
scientific claim tiers or the full v1 destination.

### Managed stage-write adapter prepared and connected under explicit binding

`model_attempt_writer.py` binds stage writes to one admitted invocation. It
checks the retained claim and consumed local admission, keeps its context local
to the handler, and refuses use from another thread. Both workers' existing
`sb_patch_stage` functions use this adapter when it is explicitly bound. Their
unbound paths remain unchanged. Normal claim dispatch does not bind it yet.

Before expanding a partial patch, the adapter reads the actual claimed stage
with its parent, workspace, active attempt, status, log and error projections.
Missing logs are unreadable state rather than empty text. Subsequent partial
patches preserve the last confirmed log. Each complete stage command enters the
journal before transport. The adapter accepts the database's completion time,
not a legacy caller's wall clock. Confirmed terminal outcomes close the writer.
Pending commands, uncertain delivery and failed ownership reads stop later writes.
Bound parent PATCH calls are refused because the stage transaction owns parent
completion or failure. No managed refusal falls back to direct PATCH.

Nine adapter tests exercise real journals, both actual worker functions and
injected HTTP. All 50 focused writer/admission/client/journal/ownership/recovery/
skip tests pass. The existing SQLite ResourceWarning appears during the combined
suite; it is not reported as repaired. All 44 ActivitySim tests and 38
AequilibraE push-trigger checks pass. The first push-check invocation used
unittest against a script runner and ran zero tests; the direct script command
then runs all 38 checks. The zero-test invocation is not passing evidence.

Harmless and restored adapter controls pass. Seven targeted mutations fail for
log erasure, missing query projection, accepting absent logs, ignoring pending
commands, ignoring terminal closure, cross-stage patches and cross-thread use.
The verifier loads temporary source copies and leaves the checked-out code
unchanged. Results and the source hash are in `writer-controls.json`.

The adapter has not yet been exercised against native PostgREST. Output
registration, attempt-owned working files, explicit continuation and complete
normal dispatcher journeys remain required before switching claims. The current
binding checks do not prove any scientific result or whole-run restart.

At integration head `03ba477f7ed1c5c20277150780628d05f7280912`, PR 170 now passes
all GitHub checks, including live RLS job 113493639537 and full-archive restore
job 113493639216. Its documented T3 acceptance hold remains: a new snapshot
attempt still fails on the connected frozen preview. This does not change the
preview checkout or establish desktop/390px visual acceptance.

### Native HTTP admission and stage-write checks

The installed migration-20 clone now exercises the fresh invocation helper and
both bound worker stage-write adapters through native PostgREST. The handler is
synthetic; normal poll/push dispatch and model computation are not invoked.

For each worker, the proof drops a committed reply at claim, progress, success
and failure. A lost claim calls no handler. The other cases call the handler
once, first confirming a useful partial log, then losing the next command's
reply. Native reads confirm the intended stage and parent statuses, one attempt,
one observed start and the retained receipt. The partial log survives both
status-only progress and terminal writes.

A fresh recovery CLI retrieves each original request without changing parent,
stage, attempt, start or receipt records. A second cached CLI needs no credential
and sends no HTTP. The original writer remains stopped after receipt recovery.
The proof forbids direct PATCH while either actual worker adapter is bound.

Baseline, harmless and restored controls each pass eight cases and 40 HTTP calls.
An intentional adapter change that replaces prior state with an empty log fails
with `Native stage did not retain partial log`. Each bounded gateway is removed;
private clone metadata and command journals remain outside the repository.
`writer-http.json` records sanitized outcomes and the tested writer source hash.

This closes the native writer HTTP boundary recorded above. Complete normal
managed dispatch, attempt-owned output registration and files, cancellation
while computing, cross-process execution competition and explicit continuation
still require integration evidence. No engine, browser, practitioner or
scientific acceptance is inferred from these synthetic cases.

### Prepared artifact identity and bound output adapters

The primary-output preparation path fixes an artifact ID before registration.
The prior managed RPC generated a new ID, so switching that call unchanged would
break the prepared reference. Migration
`20261016000021_model_attempt_prepared_artifact_identity.sql` allows an optional
canonical prepared ID while preserving generated IDs for existing callers.
Collisions refuse registration; they do not replace an existing artifact. The
client validates the optional ID and checks it against the returned receipt.

The actual migration CLI applies and reapplies the migration on an owned clone
of installed migration 20. Counts and content checksums for all 33 preexisting
model tables remain unchanged. Native installed cases check service-role use,
client-role refusal, exact retry, changed-request refusal, collision preservation,
malformed IDs, generated-ID compatibility, receipt-insert rollback and refusal
after completion. The source database and its migration history stay unchanged.
The security-advisor exit code is recorded; it is not a clean-database claim.

Both workers' direct artifact/KPI helpers and AequilibraE's retained helpers now
use the admitted attempt when the managed writer is explicitly bound. Output
scope must match the invocation. Request identity depends on installation,
attempt, operation and stable output name, not mutable bytes or metric values.
Exact repeated payloads reuse receipts. Changed contents for the same slot stop
instead of creating a replacement request. Prepared artifact IDs, byte hashes,
metadata and null KPI values remain intact. Pending or uncertain output delivery
stops later terminal writes. No managed error falls back to an unowned insert.

Seven new output tests and the adjacent suites pass 62 focused checks. All 44
ActivitySim tests pass. The previously observed SQLite ResourceWarning remains.
Three targeted output mutations fail on mutable artifact identity, null-to-zero
replacement and ignored workspace scope. Native harmless/restored controls pass;
discarding the prepared artifact ID fails the expected native assertion. Client
controls fail when malformed IDs are accepted. Results are retained in
`output-controls.json`, `prepared-artifact-controls.json` and
`prepared-artifact-upgrade.json`.

The migration suite initially reports the missing operator changelog entry.
After adding the migration and deployment note, all 39 migration tests pass.
The migration changes no relation or RLS policy inventory. The installed SQL
cases and injected output-adapter checks remain separate evidence: combined
native output HTTP recovery is still required, followed by filesystem ownership,
managed assessment/publication and the complete normal dispatcher switch.

The final direct AequilibraE push-trigger script also passes all 38 checks.

### Native HTTP output registration and recovery

All six bound artifact/KPI paths now pass against an installed migration-21
clone: direct artifact and KPI helpers in both workers, plus AequilibraE's
retained artifact and KPI helpers. The fresh invocation uses native claims and
ownership reads. A synthetic handler confirms a partial log, then registers one
output. The bridge drops the committed output reply before the adapter sees it.
Direct inserts and PATCH fallback are forbidden; worker endpoint settings are
bound to the owned bridge during each case.

Native reads confirm one output owned by the claimed attempt, one execution
start and a running parent/stage. Artifact IDs, hashes and prototype metadata
match the synthetic request. The KPI keeps its explicit null and unassessed
breakdown. A fresh CLI recovers the exact receipt without changing parent,
stage, attempt, start, output or receipt records. Cached recovery sends no HTTP.
The original writer remains stopped after recovery; it does not complete the run.

Baseline, harmless and restored controls each pass six cases and 36 HTTP calls.
Discarding the prepared ID fails `Native artifact lost prepared identity or
evidence`. Replacing null with zero fails `Native KPI lost unassessed null value`.
The proof removes each bounded gateway and preserves private clone/journal
records. Sanitized results are in `output-http.json`.

The shared HTTP helper also reruns the earlier claim/progress/success/failure
cases on installed migration 21. Baseline, harmless and restored controls each
pass eight cases; deliberate log erasure still fails. `writer-http.json` now
records that refreshed result and the current writer source hash.

These checks close the combined native output HTTP boundary. File references
and hashes are synthetic request data; no actual file or byte provenance is
claimed. Attempt-owned working files, assessment/publication, complete normal
poll/push activation and explicit continuation remain unfinished. No scientific
engine or human acceptance case runs in this proof.

### Attempt-owned workspace allocation and state publication

The bound AequilibraE and ActivitySim workspace helpers now allocate an exclusive
attempt directory under the full run UUID. Its path includes an installation
hash, stage UUID and attempt UUID. A durable private `attempt_owner.json` records
installation, workspace, run, stage, attempt and claim request. Existing attempt
directories are refused, including partial directories left by interruption.
No predecessor directory is adopted or deleted. Repeated allocation within the
same live invocation verifies and returns its owned directory.

Creation and verification walk components through directory descriptors with
no-follow flags below the administrator-owned configured root. A different or
linked ownership record is refused. The managed writer checks ownership again
before later database writes. Bound AequilibraE state publication writes and
syncs a private temporary file, replaces `state.json` through the verified
directory descriptor, then syncs the directory. A directory rename cannot send
that state write to the replacement pathname. The bound writer verifies the
canonical path again after publication and stops if ownership changed.

Eight new native filesystem/binding tests cover private records, installation
separation, existing-directory refusal, symlink refusal, changed/hard-linked
owners, rename during publication, two competing processes and both actual
worker allocation hooks. All 75 combined filesystem/state/command checks and
44 ActivitySim tests pass. The previously observed SQLite ResourceWarning
remains recorded, not repaired.

Harmless and restored controls pass. Six targeted controls fail on reuse,
symlink traversal, ignored ownership records, pathname-based state redirection,
cross-run allocation and skipped ownership rechecks. The first attempted rename
control still opened the destination descriptor before the rename and therefore
correctly passed. The corrected fault resolves the destination pathname at
replacement time and fails the intended owned-directory assertion. Results and
source hashes are retained in `workspace-controls.json`.

These primitives operate on the tested Linux/POSIX filesystem. They do not
confine arbitrary engine code or same-user host administrators. Native database
receipt evidence remains separate from this filesystem proof. Predecessor input
copying, path-specific handoff validation, complete engine write isolation,
managed assessment/publication and full normal dispatch remain unfinished.
The normal claim path still does not activate this binding.

The final AequilibraE push-trigger script passes all 38 checks. Local free disk
space is 81 GiB at this checkpoint; no existing worktree or proof clone is deleted.

### ActivitySim predecessor file retention

The actual ActivitySim handoff now copies registered predecessor files through
pinned directory descriptors. Existing producer-stage completion, active-attempt,
run and artifact checks remain in place. The copy checks registered size and
SHA-256, refuses symlink races and non-private regular sources, and checks source
identity again before publishing. A private temporary file becomes the final
input through a no-overwrite link only after those checks pass. A destination
rename cannot redirect publication into the replacement directory. The helper
refuses the changed destination path rather than reporting successful retention.

A bound invocation also requires its owned attempt directory and verifies that
ownership after copying. File-copy failures stop the bound writer. Nine new
native filesystem and actual ActivitySim adapter tests pass. All 84 combined
worker checks and all 44 ActivitySim tests pass. The existing SQLite
ResourceWarning remains unresolved. The first ActivitySim regression run passed
43 tests but failed the expected byte-mismatch diagnostic: the new wrapper hid
the underlying reason. The corrected wrapper retains validation reasons, and the
44-test rerun passes without weakening that expectation.

The saved handoff-file controls pass baseline, harmless and restored cases.
Removing hash verification, final-component no-follow, parent no-follow,
source-replacement detection or hard-link refusal fails the corresponding test.
The leaf-symlink test checks that the foreign file was never opened, not merely
that a later check refused it. Results and implementation hash are retained in
`prototype/handoff-file-controls.json`.

This is Linux/POSIX file-copy evidence, with injected admission HTTP in the bound
adapter tests. It does not establish native producer authorization or confine
arbitrary engines or host administrators. Complete AequilibraE predecessor
scratch/state/package handoff, managed assessment/publication and normal managed
claim activation remain unfinished. No model executes and no scientific claim
advances. T3 still loads the existing acceptance page but fails snapshots in both
the existing and a fresh tab; visual acceptance remains open.

### Agreement predecessor ownership and remaining scratch handoff

Tracing `main.py::_claim_and_run_stage` found that the agreement reader checked
scientific identity and byte hashes but accepted the newest artifact without
checking producer completion or active attempt ownership. The shared artifact
query now projects artifact/run/stage/attempt IDs and the producing stage's run,
status, enrollment and active attempt. `verified_latest_local_artifact` requires
a completed producer in the same run before accessing its file. Managed records
must name the active attempt. Explicitly unmanaged legacy producers remain
usable only with no artifact or stage attempt identity. A failed newest record
is refused; the reader does not silently substitute an older record.

All 30 assignment-handoff tests pass, including the existing scientific-identity
checks and new read-projection, refusal and legacy cases. Baseline, harmless and
restored controls pass. Removing completion, active-attempt or artifact-run
checks fails the actual reader test; omitting the producer projection fails the
HTTP-query assertion. `prototype/agreement-producer-controls.json` records the
source hash and controls. The projection check uses mocked HTTP, not native
PostgREST relationship/authorization evidence. This read-time check is not a
transactional lock against later ownership changes or file mutation. The normal
agreement reader still returns a source pathname after hashing it; descriptor-
based retention remains necessary before claiming immutable consumption.

The same trace establishes the following concrete handoff requirements:

| Consumer | Existing inputs | Required separation |
| --- | --- | --- |
| Network Assignment | Setup state, `package.package_dir`, `aeq_project` | Copy confirmed setup/package/project files into the new attempt; never reopen the producer project for mutation. |
| Artifact Extraction | Setup and assignment state, `run_output`, project database, package CSVs, `assignment.counts_path` | Retain exact assigned outputs and their count source. Counts may be outside scratch; a generic path-prefix rewrite is insufficient. |
| ActivitySim Network Assignment | First assignment state, registered ActivitySim demand package, solver network/settings/profile | Preserve the first assignment and copy its accepted network before a second assignment writes. |
| Demand Model Agreement | Both assignment states and registered volume outputs | Retain both input byte sets independently and preserve matching network/settings/profile checks. Agreement remains sensitivity evidence. |

Setup closes its project and SQLite connection on its successful return path;
assignment closes its project before returning its result. Those calls are not
proof that a snapshot is durable, immutable or free of live SQLite sidecars.
`package.package_dir` and count paths require explicit local-copy mappings.
Frozen network records, original source references and their hashes must remain
unchanged. Stage journals and admission records must never be copied as new
execution authority. Full managed claim activation remains off while these
handoff and assessment/publication boundaries are unfinished.

### Agreement consumes retained volume inputs

Both normal agreement-reader calls now pass the current execution directory.
After confirming producer and scientific identity, the reader copies each volume
file through the existing pinned-descriptor helper. The query includes the
registered byte size as well as its full hash. The returned path names a private
independent copy in the current run, not the producer file. Each side retains its
own filename. Existing copies are refused rather than overwritten or silently
adopted after an interruption. Such a refusal requires reconciliation.

A bound invocation additionally requires its exact owned attempt directory and
rechecks that ownership after retention. A retention failure stops the writer.
Two actual bound-reader tests cover independent copied bytes and refusal of a
different directory within the same run. The existing scientific-identity test
now verifies copied content, a distinct inode, independence after source mutation
and no overwrite. All 30 assignment-handoff tests and 86 combined worker tests
pass. The existing SQLite ResourceWarning remains unresolved.

The agreement controls retain the four previous faults and add returning the
mutable producer path and ignoring the owned destination. All six targeted
faults fail; baseline, harmless and restored checks pass. The file-copy controls
also pass again with their five targeted faults. The first new reader-mutation
runner copied module globals, bypassing the test's HTTP mock and attempting the
reserved `worker-import-only.invalid` host. It failed on name resolution rather
than the intended assertion. The corrected runner binds the mutated function to
live module globals; the intended retained-path assertion then fails. That
initial harness failure is not counted as a successful fault check.

This supersedes the prior note that normal agreement readers return original
source paths. The copies do not prevent a host administrator or arbitrary engine
from changing the consumer directory later. Native PostgREST producer projection,
transactional revocation fencing, complete package/project/state handoff and
managed assessment/publication remain open. The normal dispatcher still does
not activate the managed binding, and no scientific acceptance claim changes.

### Installed native agreement input read

`prototype/verify_agreement_input_http.py` now exercises the actual normal worker
artifact query and retention function through a bounded loopback PostgREST
container. It clones the owned installed migration-21 proof database, creates
synthetic producers using native claim/output/terminal commands, and retains
small real CSV files under full run identities. A separate explicitly unmanaged
completed producer checks the legacy branch. No application database is changed.

Baseline, harmless and restored controls each accept completed managed and
legacy producers and refuse running and failed producers. The completion-check
mutation admits the real running producer, demonstrating that the boundary can
fail. The failed producer remains refused through its independent attempt check.
The actual query completes 17 HTTP reads with status 200, including an empty
result for a different run. Accepted inputs are separate files with matching
bytes and distinct inodes.

Anonymous reads return an empty array. A real member of the fixture workspace
receives the expected artifact and joined producer; an authenticated synthetic
identity with no memberships receives no rows. These are focused read cases,
not an exhaustive role or cross-workspace matrix. Before/after content checksums
match across model runs, stages, attempts, artifacts and all three relevant
claim/stage/artifact receipt tables. The read exercise changes no native model
record. `prototype/agreement-input-http.json` retains the sanitized outcomes and
worker source hash. Private v1 and expanded v2 proof directories retain their
clone identities; each temporary gateway is removed by the existing cleanup.

This supplies the previously missing installed PostgREST projection and focused
read-authorization evidence. Concurrent revocation fencing, complete package/
project/state transfer, managed assessment/publication, full poll/push activation,
scientific acceptance and T3 visual acceptance remain open. No model computation
or scientific holdout runs in this proof.

### Retained original stage state

Bound AequilibraE `write_run_state` now publishes its local state, retains a
separate private `predecessor_state.json` through the owned directory descriptor,
and registers that file through the admitted attempt's artifact command. The
record carries its full hash, byte size and an explicit execution-state role.
Original package paths, count paths and frozen nested records remain unchanged.
The metadata explicitly states that paths are not relocated and no package
inventory is included. This file does not carry claim journals or execution
permission into a consumer.

The retained filename cannot be overwritten, including by a repeated state
publication. A partial or uncertain publication stops the writer and requires
reconciliation. Changing `state.json` afterward leaves the retained original
unchanged. Two additional bound tests confirm exact registration bytes and stop
before a terminal write after a lost registration reply. The workspace tests
also check retained-file overwrite refusal. All 88 combined worker tests pass.
The existing SQLite ResourceWarning remains recorded. Workspace baseline,
harmless and restored controls pass; eight targeted faults fail, including
retained-state overwrite and a wrong registered state hash.

`prototype/verify_state_http.py` extends the existing native writer HTTP fixture
with the actual bound AequilibraE state-publication call. The artifact command
commits, the bridge drops the reply, and the bound handler stops. Native state
contains one attempt-owned artifact matching the real retained file's path,
contents, byte size and hash. A fresh CLI recovers its exact receipt without
changing parent, stage, attempt, start, artifact, KPI or receipt records. Cached
recovery sends no HTTP, and the original writer remains stopped. Baseline,
harmless and restored controls each pass one case and six HTTP calls. Replacing
the registered hash with zeros fails the native byte comparison. Sanitized
results are in `prototype/state-http.json`; private clones and journals remain
in the owned `state-http-v1` proof directory. The temporary gateways are removed.

This supplies original-state custody before completion, not a complete stage
checkpoint. Package/project files, external count inputs, consumer path mapping,
completed-producer selection for state, managed assessment/publication and full
normal dispatcher activation remain unfinished. Native scientific accuracy,
concurrent host-write confinement and human acceptance are not established.

### Missing recorded counts never select a replacement

Tracing external count paths found a separate source-substitution defect in
`_run_count_validation`: a missing assignment count file selected the process's
configured default. Its old comment treated geographic overlap as sufficient
justification. Overlap cannot establish the same observation source or year, so
that fallback is removed. Assignment may still explicitly select and record the
default file; artifact validation uses only its recorded path.

A missing or absent recorded path now produces an explicit unavailable summary.
Station counts, error metrics, geographic coverage and the screening gate remain
null. No coverage matcher runs and no alternative file is opened. This is not
zero matched stations, an out-of-area finding or a measured model failure. The
existing artifact log reports the unavailable reason; KPI collection tolerates
the null count and emits no measured-match KPI. Disabled validation remains
unassessed under its existing behavior. No observation, tolerance, scientific
holdout or historical study result changes.

Five new tests use real synthetic count files and the actual validation entry
point. They check unavailable recorded paths despite an available default,
missing path metadata, original source/year selection, an explicitly recorded
default and disabled validation. The claim-summary check retains unknown matched
stations and refuses a claim upgrade. Baseline, harmless and restored controls
pass. Restoring the default substitution or turning missing station counts into
zero fails the targeted test. Results are retained in
`prototype/count-input-controls.json`.

All 93 combined worker/count-input tests pass, along with 36 count-validation,
10 count-coverage, 10 model-credibility and 30 assignment-handoff checks. Coverage
is injected in the new entry-point tests; they do not prove native network
matching, scientific accuracy or retained count-file transport. The existing
SQLite ResourceWarning remains unresolved. Exact count-byte and source-sidecar
retention before assignment, package/project snapshots and consumer state
mapping remain unfinished. T3 visual acceptance remains open.

### Retain selected count bytes before assignment

The actual `stage_assignment` now retains its selected CSV, optional normalized
source sidecar and acquisition-status record before opening the engine project.
It consumes the retained count path and returns that path plus manifest facts in
its assignment result. Credibility assembly uses the retained acquisition-status
directory when this result carries it; older results retain their existing
recorded-path behavior. The second assignment retains its explicit predecessor
count path instead of resolving a different default.

`model_count_inputs.py` creates an exclusive private directory, streams regular
files through no-follow descriptors, records byte hashes and sizes, and rechecks
all opened sources before writing the manifest. It also rechecks absent sidecars
so an input appearing during capture cannot silently change the described set.
Symlinks, hard links, special files, source replacement and destination changes
refuse completion. Failed or existing directories remain for reconciliation;
there is no automatic adoption or overwrite. Missing counts produce a controlled
missing path inside the retained directory. A later file at the original path
does not become this assignment's input.

Bound retention requires an output directory inside its owned attempt. It
registers the manifest through the admitted artifact command before engine work.
An uncertain registration stops the writer and raises the worker's reconciliation
exception, preserving the pending command. This local adapter test uses injected
HTTP; native lost-reply recovery of this particular manifest remains unverified.
No claim tier changes, and the manifest labels scientific acceptance unassessed.

Nine new tests cover real CSV/sidecar bytes, source mutation, absent inputs,
unsafe file types, multi-file capture changes, the actual assignment entry before
engine opening and the bound adapter. All 102 combined tests pass. Adjacent
checks pass 36 count-validation, 10 count-coverage, 10 model-credibility,
30 assignment-handoff and 38 push-trigger cases. Baseline, harmless and restored
controls pass; six targeted faults fail, including a return of the original
source path and writes outside the bound attempt. Results are in
`prototype/count-retention-controls.json`.

These are local Linux/POSIX captures under administrator-owned source and output
parents. They do not establish publisher accuracy, observation eligibility,
independent scientific validation or protection from arbitrary host writes after
capture. The source metadata remains original acquisition evidence; its display
must continue to distinguish acquisition status from current retained-file
availability. Native manifest recovery, complete package/project copying and
consumer state-path mapping remain open. No scientific model or holdout runs as
part of the new tests.

### Native count-manifest recovery

The installed native HTTP fixture now calls the actual bound count-retention
helper with a real synthetic CSV, source sidecar and acquisition-status record.
The artifact registration commits and the bridge drops its reply. The handler
stops with one attempt-owned manifest artifact, while the retained files remain
on disk. Native assertions compare the artifact path, size and hash to the
manifest, then compare every retained file to its expected original bytes and
manifest entry.

A fresh CLI recovers the exact artifact receipt without changing parent, stage,
attempt, execution-start, artifact, KPI or receipt records. Cached recovery sends
no HTTP. The stopped writer remains closed. Baseline, harmless and restored
controls each pass one case and six HTTP calls. A wrong manifest hash fails the
native file comparison. `prototype/count-manifest-http.json` retains sanitized
results and source hashes; the owned private `count-manifest-http-v2` directory
retains clone and journal records. Temporary gateways are removed.

The first proof attempt failed during its second control because broad module
cleanup removed a newly imported AequilibraE module while leaving ActivitySim's
path first in the import search order. The resulting wrong entry-point import
reported missing Flask. This was a harness isolation error, not evidence that
the target worker required another dependency. The corrected runner restores
only its deliberately replaced count-input module. The failed v1 directory is
preserved; its partial run is not reported as the complete passing proof.

This closes the native registration/recovery boundary for retained count
manifests. It does not complete full assignment, package/project transfer,
consumer path mapping, concurrent host-write protection or normal managed
poll/push activation. Acquisition-status interpretation still needs review
against current retained-file availability. No engine, scientific holdout or
human acceptance test runs in this proof.

### Acquisition history is distinct from current file availability

The count-source summary previously trusted an `available` acquisition record
even when the referenced CSV was absent or could not be read. It now retains the
recorded acquisition status separately from the current file status. Missing or
unreadable files cannot keep an available source label; eligible rows remain
unknown rather than zero. Dataset, vintage and source metadata remain original.
The current error appears in the limitation text consumed by existing evidence
panels and Markdown exports. Source metadata files are not rewritten.

Explicit unavailable, unsupported-geography, no-eligible-section and no-traffic
acquisition outcomes remain distinct. A readable file is not a scientific
validity claim. Invalid encoding is a read failure rather than an uncaught
summary error. This check does not compare retained bytes with the manifest hash;
that consumer-verification boundary remains open.

Six new cases cover missing files, missing paths, injected read denial, invalid
encoding, readable original rows and preserved source outcomes. Baseline,
harmless and restored controls pass. Trusting stale availability, replacing
unknown eligible rows with zero or erasing acquisition status each fails the
targeted test. Results are in `prototype/count-availability-controls.json`.
All 108 combined tests, 10 existing model-credibility checks and 27 existing
TypeScript evidence/export tests pass. The SQLite ResourceWarning remains
unresolved. These checks do not establish a rendered T3 journey, complete
package/project handoff or scientific acceptance.

### Retained count inputs are verified before a subsequent assignment

The second assignment now passes the first assignment's retained count record.
The consumer checks the manifest's recorded hash, size, file identity, schema,
unique JSON keys and fixed input set. It makes an exclusive independent copy,
then compares each copied file's status, size and hash against the original
manifest before returning control to assignment. Changed or missing retained
files and newly appearing sidecars refuse computation. Missing inputs stay
unavailable. Existing consumer directories are not adopted or overwritten.

Seven real-file cases cover these boundaries and the actual assignment entry
point before engine construction. Baseline, harmless and restored controls pass;
five fault controls detect ignored manifest hashes, ignored file identities,
a copy-time change, duplicate keys and bypassed assignment verification. The
first bypass control reached a later SQLite error because its mocked engine
allowed execution to continue. The test now fails explicitly at engine entry,
and the corrected control detects that exact failure. An initial test-file
creation used the wrong working directory and was corrected before testing.
The combined suite passes 115 tests; 30 assignment-handoff checks also pass.
The existing SQLite ResourceWarning remains unresolved.

This change does not yet verify the manifest at artifact extraction. Legacy
assignments without a retained record keep their existing capture behavior;
that is not proof of earlier custody. Source parents remain administrator-owned.
Failed captures remain for reconciliation, and arbitrary subsequent host writes
are outside this check. Full package/project transfer, normal managed dispatch,
rendered T3 acceptance and independent scientific acceptance remain open.
