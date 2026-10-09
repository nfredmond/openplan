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

### Artifact extraction verifies a separate count-input copy

Artifact extraction now consumes the recorded manifest before preparing output
metadata, validation or credibility evidence. It retains a separate
`artifact_count_inputs` directory and uses a derived assignment dictionary;
the original assignment record and files are unchanged. A bound writer registers
this consumer's manifest under its own artifact slot. Changed inputs stop the
writer before registration. Legacy records without a manifest retain their
previous behavior and gain no custody claim.

Five added cases exercise the actual artifact entry point, independent file
identity, unchanged assignment records, legacy behavior and bound registration
or refusal. Baseline, harmless and restored controls pass. Seven fault controls
include bypasses at assignment, artifact extraction and bound registration.
The combined suite passes 131 tests, including primary-output preparation and
validation-publication custody; all 10 credibility checks pass. An initial
unittest invocation from the repository root failed module discovery and was
rerun from the worker directory. The SQLite ResourceWarning persists.

These checks stop before full evidence generation and engine computation.
They do not close native consumer-manifest recovery, complete package/project
transfer, normal managed dispatch, scientific acceptance or rendered browser
acceptance. Previously recorded native producer-manifest recovery remains
separate evidence. No scientific observation, acceptance grade or holdout changes.

### Native artifact-consumer manifest recovery

The actual artifact-stage entry now has native command evidence for its initial
verified count-input handoff. The proof retains a predecessor count set, enters
the stage under a fresh managed invocation, and drops the reply after the native
artifact command commits. The consumer's CSV and both metadata files have
independent inodes and the expected bytes, hashes and sizes. The registered
manifest URL, hash, size, artifact type and attempt match the retained output.

Baseline, harmless and restored controls each pass one case with six HTTP calls.
A fresh CLI process recovers the exact receipt without changing native records;
its cached retry sends no HTTP. Recovery does not reopen the stopped writer.
A deliberately incorrect consumer manifest hash fails the native file comparison.
Results and exact source hashes are in `prototype/count-consumer-http.json`.
Private `count-consumer-http-v1` records preserve the isolated clones and journals.
The temporary HTTP gateways are removed. No application database is changed.

This proof stops at the first artifact-stage registration. It does not establish
complete evidence generation, full package/project transfer, normal managed
poll/push dispatch, scientific accuracy or practitioner acceptance. Those remain
separate requirements. Disk had 81 GiB available before these small fixture clones.

### Package and project transfer source audit

The [stage input handoff design](STAGE_INPUT_HANDOFF.md) records current consumers,
mutable package outputs, SQLite success-path close points, required caches and
explicit predecessor/path-mapping requirements. A state hash alone does not close
this boundary. The audit found zone-attribute registration using a different
package path from the artifact calculations. Registration now follows the
recorded package directory and cannot substitute a legacy file when that recorded
file is missing. Legacy records without a package directory retain their fallback.
Four real-file registration-block tests pass, including a harmless control and a
wrong-directory fault. The focused suite passes 25 tests. Registration is mocked;
full package/project custody and native project reopening remain unproved.

### Completed-package snapshot foundation

`model_package_inputs.retain` captures the entire package tree into an exclusive
private directory. Its inventory includes original manifests, later generated
matrices, nested metadata and empty directories. It copies through no-follow
file descriptors, records size/hash for each regular file, refuses hardlinks and
special files, and rechecks all source entries before publishing its manifest.
Previously copied files that change during a later copy cannot silently pass.
Source-contained destinations and existing destinations are refused. Partial
captures remain for reconciliation. Parent directories are administrator-owned;
this is not confinement against arbitrary same-user host changes.

The managed writer can retain an owned package and register its inventory as
`model_package_inputs`. Ownership or capture failures stop the writer. Lost
transport replies preserve a pending command and the complete local snapshot.
This method is preparatory and is not yet called by normal stage dispatch.
Consumer verification/mapping and native package-manifest recovery remain open.
The manifest explicitly leaves database consistency and scientific acceptance
unassessed. It must not be used as proof of a coherent SQLite project snapshot.

Nine package cases pass. Baseline, harmless and restored controls pass; five
faults detect omitted generated input, ignored late changes, accepted hardlinks,
incorrect manifest hashes and foreign package sources. The initial bound tests
failed because their fixture omitted its response callback; the corrected fixture
passes. The combined suite passes 144 tests. Docker source-copy declarations
include the new module; no container build is claimed. The existing SQLite
ResourceWarning remains unresolved. Results and source hashes are retained in
`prototype/package-retention-controls.json`.

### Package consumer verification and native registration recovery

The package consumer verifies the recorded manifest hash, size, regular-file
identity, unique JSON keys and inventory schema. It captures an independent copy
and compares the complete copied inventory before returning that package. Changed,
missing or additional files refuse consumption, including a change after manifest
verification but before copying. Empty directories and original manifests remain
part of the inventory. Existing consumer destinations are not adopted. The caller
must separately establish producer, run and attempt authority; local byte checks
are not execution authorization.

Five consumer cases extend the package suite to 14. Eight local fault controls
pass their expected failure checks; baseline, harmless and restored controls pass.
The combined suite passes 149 tests. The existing SQLite ResourceWarning remains.
The native package-registration proof uses the actual owned-package writer method,
independent files and installed artifact command. After a committed reply is lost,
a fresh CLI process recovers the exact receipt without native record changes or
reopening the stopped writer. Cached recovery sends no HTTP. Baseline, harmless
and restored cases each use six HTTP calls. An incorrect manifest hash fails the
native file comparison. `prototype/package-manifest-http.json` retains the result;
private `package-manifest-http-v1` records preserve isolated clones and journals.
Temporary gateways are removed.

The native proof concerns producer registration, not consumer selection or full
stage execution. Explicit predecessor authority, execution-state mapping, coherent
project-database transfer and normal managed dispatch remain unfinished. No engine
or scientific holdout is run, and no acceptance grade changes.

### Explicit predecessor selection

The worker now has a bound predecessor-read adapter for retained state and package
inputs. Network Assignment declares Setup as its producer; Artifact Extraction
and ActivitySim Network Assignment declare Network Assignment. Selection requires
a unique named producer earlier in the same run, successful managed completion,
a current running consumer attempt and a unique artifact with matching producer
attempt ownership. Unrelated newer artifacts cannot supply the input. Duplicate
or inconsistent records require reconciliation rather than guessed selection.

The adapter reads through the bound writer's installation and credential, not an
unrelated global URL. It projects stage names, order, status and attempt fields,
and compares the selected artifact's embedded producer through the existing
completed-producer check. A disagreement stops the writer before file access.
These are read-time checks, not a concurrent revocation fence. Normal dispatcher
activation and the connection from selection to verified file transfer remain open.

Seven tests pass with mocked HTTP. Initial fixture setup indexed past its shared
UUID list; the test now defines its additional identities locally. Baseline,
harmless and restored controls pass. Five faults detect ignored completion,
consumer ownership, artifact ownership, producer ambiguity and an omitted stage
order projection. The combined suite passes 156 tests. Native predecessor reads,
complete consumer mapping, project transfer and scientific acceptance remain
unproved. The SQLite ResourceWarning remains unresolved.

### Native predecessor-read proof

The bound adapter now has native HTTP evidence using a fresh admitted consumer
and two completed managed producers in an isolated clone. Both producers register
the same artifact type; the unrelated stage registers later. Baseline, harmless
and restored controls select the declared Network Assignment producer. A changed
predecessor-name mapping selects the unrelated native artifact, exposing the fault
against the expected producer identity. A locally injected wrong consumer-attempt
context is refused and stops the writer. No native row is rewritten to manufacture
an inconsistent attempt.

The proof makes one claim POST and 11 GET requests, all returning HTTP 200.
Checksums for seven model/receipt tables are unchanged across the read controls.
`prototype/predecessor-http.json` records the results and source hashes. The owned
private `predecessor-http-v1` directory preserves the clone and admission journal;
the temporary gateway is removed. Source application databases are unchanged.

This verifies actual query projections and read-time selection. It does not read
package/state files, exercise complete normal dispatch, establish an exhaustive
RLS matrix, fence concurrent revocation or prove scientific acceptance. The next
join must bind these selected identities to verified local copies and explicit
consumer-state mappings, with separate coherent project-database transfer.

### Selected package joins to an owned consumer copy

`retain_managed_predecessor_package` joins explicit predecessor selection to the
verified package consumer. It requires the registered local manifest at the exact
selected producer's installation/run/stage/attempt path, refuses a resolved path
that differs, and checks the inventory schema. It copies into the current owned
attempt and registers the resulting manifest as `model_package_consumption`,
with original artifact, stage, attempt and manifest-hash provenance. This distinct
artifact type avoids confusing an input receipt with the stage's own completed
package output during later predecessor selection.

Four joined cases pass with real package files and mocked transport. Foreign paths
refuse before consumer file access. Modified producer bytes refuse before
registration. A lost registration reply preserves the complete snapshot and
pending consumer command while stopping the writer. Baseline, harmless and
restored controls pass; four faults detect ignored paths, ignored source changes,
erased producer attempt and registration as a producer output. The combined suite
passes 160 tests. The existing SQLite ResourceWarning persists.

The joined native recovery proof remains open. Earlier native predecessor reads
and producer-manifest registration remain separate evidence. This helper is not
yet called by normal dispatch. Retained original state, execution-state mapping,
coherent project transfer and full scientific acceptance remain unfinished.

### Native selected-package consumption and recovery

The full selected-package helper now has native evidence. A completed managed
producer registers a real package inventory at its owned attempt path. A fresh
consumer reads that declared predecessor through native HTTP, verifies the
recorded package, creates independent copies and registers
`model_package_consumption` with the original producer provenance. The harness
drops the reply after that consumer registration commits.

Baseline, harmless and restored controls each pass one joined case with eight
HTTP calls. Native checks confirm the consumer manifest URL, hash, size, artifact
type, attempt, exact producer provenance, generated CSV bytes, original package
manifest and empty directory. A fresh CLI recovers the exact receipt while the
native records remain unchanged; cached recovery sends no HTTP and the writer
stays stopped. An incorrect consumer manifest hash fails the native comparison.
Results are in `prototype/managed-package-http.json`; the owned private
`managed-package-http-v1` directory retains fixture clones and journals. Temporary
gateways are removed. No application database is changed.

This closes the selected-package registration/recovery proof boundary. It does
not provide execution-state mapping, coherent SQLite project transfer, complete
normal dispatcher execution or scientific acceptance. Original state and project
handoffs remain required before managed dispatch can be enabled.

### Selected original-state transfer and native recovery

`retain_managed_predecessor_state` selects the declared completed producer and
requires its exact owned state path and supported schema. It copies registered
bytes through the existing pinned handoff helper, checks the copied hash/size
again before decoding, and refuses duplicate keys, nonfinite JSON or a non-object
root. The original bytes and all recorded paths remain unchanged. A separate
`model_state_consumption` artifact records the consumer copy and original producer
artifact/stage/attempt/hash. It does not replace the producer's state output or
claim that the original paths are valid in the consumer attempt.

Seven local cases pass. Baseline, harmless and restored controls pass; five faults
detect ignored foreign references, a changed copy before decoding, duplicate keys,
nonfinite values and erased provenance. The combined suite passes 167 tests. The
existing SQLite ResourceWarning persists.

The native joined proof passes baseline, harmless and restored cases with eight
HTTP calls each. It checks independent file identity, original bytes and paths,
native consumption type, hash, size and exact producer provenance. Fresh CLI
recovery of a committed-but-lost reply returns the retained receipt without native
record changes; cached recovery sends no HTTP and the writer remains stopped.
A wrong consumer hash fails the native comparison. The shared harness labels this
artifact-write mode `package_artifact`; its state-consumer branch explicitly checks
`model_state_consumption` and the state bytes. The first harness edit used an
ambiguous text anchor and stopped before applying the change; its subsequent
unsupported-argument failure created no clone. The corrected proof is retained
under private `managed-state-http-v2`, with results in `prototype/managed-state-http.json`.
Temporary gateways are removed.

This preserves original state custody. It does not implement consumer execution
mapping, state/package pairing, coherent project transfer or normal managed
dispatch. Those joins remain required, alongside scientific and human acceptance.

### State/package pairing and explicit package-path mapping

The package consumer now returns its verified original source directory from the
registered manifest. `retain_managed_state_and_package` retains both selected
inputs and requires matching producer stage/attempt identities. The state's
recorded package directory must equal that manifest's original source directory.
A mismatch stops the writer; independently valid files are not sufficient proof
that they belong together.

Mapping creates a deep copy of the original state and changes only
`package.package_dir` to the consumer package directory. Source labels, count
paths, geography and other fields remain unchanged. The original state bytes and
parsed record stay separate. The result explicitly records `execution_ready: false`;
it is not supplied to an engine or called by normal dispatch.

Three paired cases pass through the actual helper with real files and mocked
transport. Baseline, harmless and restored controls pass. Four faults detect an
ignored attempt, an ignored source-directory mismatch, shared nested state and a
false execution-ready flag. The combined suite passes 170 tests. The SQLite
ResourceWarning remains unresolved. Results are in `prototype/paired-input-controls.json`.
Native paired evidence, durable derived-state publication, project/output/count
mapping and coherent project transfer remain open. No scientific claim changes.

### Native paired inputs and returned mapping

The actual paired helper now runs against native stage/artifact commands and real
producer files in an isolated clone. Baseline, harmless and restored controls
return the paired package mapping, preserve original state bytes and records, and
keep execution readiness false. Each consumer registers exactly one
`model_state_consumption` and one `model_package_consumption` record with the
expected producer artifact, stage and attempt identities. Producer artifact
records remain unchanged.

A state naming a contradictory package directory refuses the pairing and stops
the writer. Its two individually retained input records remain available for
reconciliation; they do not imply that the pair is valid. Deliberately removing
the package-path mapping is detected against the expected returned state. All
five controls make eight HTTP calls each, with native HTTP 200 responses. The
proof uses a transport adapter only to remove the hosted `/rest/v1` prefix from
the isolated direct PostgREST URL. Producer fixtures use the installed native
claim, artifact and terminal commands.

`prototype/paired-input-http.json` records source hashes and outcomes; private
`paired-input-http-v1` retains the clone and journals. The temporary gateway is
removed. No application database changes. Durable mapped-state publication,
project/output/count relocation, coherent project transfer, normal dispatch and
scientific acceptance remain open. These successful pair controls do not replace
the separately recorded lost-reply recovery evidence for each consumption write.

### Durable partial input mapping

Paired inputs now produce an exclusive `input_mapping.json` through the owned
workspace's pinned directory descriptor. The file contains the separately derived
state, exact state/package producer references, the explicit mapped field list
and `execution_ready: false`. The writer registers its hash and size as
`model_input_mapping`. It neither overwrites original predecessor state nor
replaces an existing mapping. Capture or registration uncertainty stops the writer.

The paired suite includes saved-content/provenance checks, no-overwrite behavior
and lost mapping-reply preservation. The combined suite passes 172 tests.
Baseline, harmless and restored controls pass; the existing four pairing faults
remain detected, and two new controls detect mapping overwrite and erased input
references. The SQLite ResourceWarning remains unresolved.

Native paired proof now checks three consumer records for valid pairs, including
the mapping file's actual state content, hash, size, mapped fields and input links.
A mismatched pair retains only its two input records. Valid and mapping-fault
controls use nine HTTP calls; source mismatch uses eight. All responses are 200.
Private `paired-input-http-v3` and `prototype/paired-input-http.json` preserve the
latest proof. The earlier v2 run checked mapping identity; v3 adds direct saved
state-content comparison. Producer records stay unchanged and temporary gateways
are removed. Native lost-reply recovery for the mapping write remains separate
and unproved. This checkpoint does not transfer the project, outputs or counts,
enable normal managed dispatch, or change scientific acceptance.

### Native partial mapping recovery

The v4 paired proof drops the mapping response after the native artifact command
commits. The writer stops and retains exactly one pending mapping command. A
fresh recovery CLI process retrieves its receipt. A second process recovers from
the local journal without credentials and with HTTP forbidden. Checksums of
seven native model and receipt tables remain unchanged across recovery, and the
original writer remains stopped. Three consumer artifacts remain registered.

Baseline, harmless and restored pairing controls still pass. Removing the
package mapping remains detectable; contradictory source paths still refuse.
The checked worker and selector hashes match the current source. Private
`paired-input-http-v4` retains the journals and clone; the repository result is
`prototype/paired-input-http.json`. The temporary gateway is removed. CLI HTTP
uses the disclosed direct-PostgREST route-prefix adapter. This evidence covers
receipt reconciliation, not resumption, project transfer, full managed dispatch,
scientific acceptance or browser acceptance.

### Project copy and native reopen foundation

`model_project_inputs.py` reuses complete byte-checked package capture and
consumption. It requires the project database, refuses WAL, shared-memory,
rollback and super-journal sidecars, and checks every SQLite database in the
private copy with read-only immutable `integrity_check`. It rechecks each
database's identity, size and inventory hash afterward. No source database is
opened, checkpointed or repaired. Failed destinations remain for reconciliation.
Individual database integrity is explicit; cross-database consistency and
scientific acceptance remain unassessed. The caller must establish completed
producer ownership and successful engine closure before capture.

Nine new tests cover independent original/consumer bytes and records, harmless
extra files, missing/corrupt databases, sidecars including a real committed WAL,
secondary databases, registered-byte tampering, source changes and an injected
integrity failure. The combined input suite passes 46 tests. Baseline, harmless
and restored controls pass. Four temporary faults detect ignored sidecars,
integrity failure, consumer inventory and secondary databases. Results and exact
source hash are in `prototype/project-input-controls.json`.

The native proof creates a synthetic two-node, one-link spatial project using
installed AequilibraE 1.6.2, closes it, retains five files, consumes them into an
independent directory and reopens that directory with `Project.open()`. Exact
node/link geometry survives. Both project and public-transport SQLite databases
pass integrity checks. Consumer bytes equal source bytes before native open,
and the source remains unchanged afterward. Native open can modify the consumer,
so that later working directory is not represented as immutable retained input.
`prototype/native-project-copy.json` records the result; private
`native-project-copy-v2` retains the files. The first run reached the final report
but failed reading a nonexistent version attribute. The corrected second run
uses installed distribution metadata and completed successfully.

This helper is not yet registered or selected by the managed writer. Producer
closure enforcement, cross-file semantic consistency, remaining output/count
mapping, normal dispatch and scientific acceptance remain open. This small
native reopen is not a network assignment or an independent scientific study.

### Owned project registration and receipt recovery

The managed writer now captures project inputs only from its owned attempt
workspace and verifies ownership again before registration. A separate
`model_project_inputs` artifact records the complete inventory hash/size,
individual database checks and explicit incomplete statuses. Its metadata uses
`openplan.project-inputs.v1` and names the nested inventory schema separately.
Engine closure, cross-database consistency and scientific acceptance remain
unassessed; execution readiness remains false. Any copy or registration failure
stops the writer. Normal dispatch does not call this method.

Four tests exercise real SQLite files with mocked transport, checking exact
registration metadata, foreign-source refusal, journal refusal and pending
payload preservation after response loss. The combined relevant suite passes
66 tests. Baseline, harmless and restored controls pass; erasing database checks
or promoting execution readiness fails at the intended assertion. The initial
test expected run/stage RPC parameters that this command does not accept; it now
checks the actual attempt parameter while the existing command tests protect
run/stage scope. Results are in `prototype/managed-project-capture-controls.json`.

The native project manifest proof passes baseline, harmless and restored cases,
with six HTTP calls per case. It drops the response after native registration,
checks exact retained bytes, independent files and database-check metadata, then
recovers through a fresh CLI. Cached recovery makes no HTTP call, native records
remain unchanged and the stopped writer does not resume. Erasing database checks
fails with the expected metadata assertion. Private `project-manifest-http-v1`
preserves the clones and journals; the temporary gateways are removed.
`prototype/project-manifest-http.json` records outcomes and source identity.
The shared proof labels this branch `package_artifact`, but its project mode
explicitly requires the `model_project_inputs` artifact type and project metadata.

This proof uses a synthetic SQLite project and installed artifact commands, not
an engine assignment. Native AequilibraE reopen remains the separate evidence
above. Consumer selection, closure enforcement and full input/state joins remain
unfinished; no release or scientific claim changes.

### Selected project consumption

The explicit predecessor selector now accepts project inputs under the same
completed-stage, run and active-attempt checks as state and package inputs.
`retain_managed_predecessor_project()` requires the selected producer's exact
installation/run/stage/attempt path and supported project metadata. It verifies
the registered inventory while copying, repeats SQLite integrity checks on the
consumer copy and compares those results with the producer's recorded checks.
An independent `model_project_consumption` artifact retains the producer
artifact/stage/attempt/hash references and the consumer manifest identity.

The helper preserves explicit incomplete statuses and refuses an unsupported
readiness claim instead of treating copied files as permission to compute.
Contradiction or uncertain registration stops the writer. It does not relocate
state paths or run an engine. Cross-database consistency and closure enforcement
remain unfinished.

Six focused tests use real files and the actual selection/copy/registration
helper with mocked HTTP. They cover independent copies and metadata, exact
project-type query, foreign paths, changed producer bytes, pending consumer
registration after response loss, contradictory database checks and promoted
readiness. The combined relevant suite passes 72 tests. Baseline, harmless and
restored controls pass. Five targeted faults detect ignored foreign paths,
ignored database checks, ignored readiness, erased producer attempt and use of
the wrong artifact type. `prototype/managed-project-handoff-controls.json`
records exact source hashes and outcomes. Native joined recovery remains open;
producer registration recovery and native project reopen above are separate
checks and do not close it.

### Native selected-project recovery

The selected-project helper now has native read/copy/registration recovery
evidence. The isolated proof creates and completes a native producer attempt,
registers its real SQLite project inventory, then runs the actual consumer
helper. The helper selects that producer, copies the full inventory and records
`model_project_consumption` with exact producer identity and database-check
metadata. Independent file identities, bytes, sizes and hashes are checked.

Baseline, harmless and restored controls pass with eight HTTP calls each. The
proof loses the consumer registration reply after native commit, recovers its
receipt through a fresh CLI and verifies cached recovery without HTTP. Native
records remain unchanged and the writer stays stopped. A deliberately incorrect
consumer manifest hash fails the recorded-byte assertion. The proof's historical
`package_artifact` label is shared across inventory modes; project mode explicitly
requires project consumption type, schema, database checks and incomplete statuses.
Private `managed-project-http-v1` retains the clone/journals and the temporary
gateways are removed. `prototype/managed-project-http.json` records outcomes.

This is a synthetic SQLite input and native command proof, separate from the
AequilibraE spatial reopen evidence. Stage execution still resolves `aeq_project`
under `work_dir`; a copied project alone does not change that dependency. Explicit
execution-path mapping, remaining output/count joins, closure enforcement and
full managed dispatch remain open. No scientific or human acceptance claim changes.

### Separate project working files

`prepare_project_working_copy()` requires this attempt's exact consumed-project
manifest and makes another exclusive inventory-verified copy. The retained
consumer input stays separate. A `model_project_working_copy` artifact records
the initial manifest identity, original producer references and consumed input
manifest hash. Its metadata explicitly identifies an initial working inventory
with mutable files. It does not claim those files stay equal to their initial
hashes after an engine opens or modifies them. The returned project directory
points to the working files; execution readiness remains false.

Four tests cover an actual SQLite write to the working copy while the retained
input bytes stay unchanged, distinct file identities, exact initial registration,
existing-destination refusal, foreign manifest refusal, changed retained input
and pending registration after a lost reply. The combined relevant suite passes
76 tests. Baseline, harmless and restored controls pass; targeted faults detect
returning the retained input as the working path, erased producer provenance and
ignored source-path ownership. `prototype/project-working-copy-controls.json`
records source identity and results. Transport is mocked for this new method.
Native working-copy registration recovery and native engine use of this method
remain unproved. Explicit stage path selection, closure enforcement and full
managed dispatch remain unfinished.

### Native working-copy registration recovery

The native proof now confirms selected project consumption before preparing its
working copy. It registers both `model_project_consumption` and
`model_project_working_copy` under the same consumer attempt, then loses the
working-copy response after commit. Checks require the initial-inventory role,
mutable-file flag, consumed manifest hash, producer references, database checks
and explicit incomplete statuses. Working and retained database file identities
differ. A real SQLite insert modifies the working file while retained input
bytes remain unchanged. The proof restores only its mutable working database to
its initial bytes for the subsequent inventory assertions; it does not rewrite
retained inputs or native records.

Baseline, harmless and restored controls pass. Fresh CLI receipt recovery leaves
native records unchanged, cached recovery makes no HTTP request and the stopped
writer does not resume. Changing the working-copy role to retained input fails
the boundary assertion. `prototype/project-working-http.json` records exact
source hashes and outcomes. Private `project-working-http-v1` retains clones and
journals; temporary gateways are removed. This combines real local SQLite files
with native commands, not an AequilibraE engine run. Native engine use of the
working-copy helper, stage execution-path selection, closure enforcement and
full managed dispatch remain open.

### Managed stage project-path selection

The writer activates its working-directory reference only after confirmed
working-copy registration. Resolution requires the same owned attempt path and
unchanged working-directory identity, and checks that no command remains pending.
A lost preparation reply leaves the reference unset. Foreign, absent, replaced
or unconfirmed paths stop the writer. This path reference is invocation-local;
a saved receipt does not reconstruct an execution session.

Assignment, artifact extraction, primary-output preparation, volume-map
publication and agreement network reads now use the shared project resolver.
Outside a managed binding, the existing `work_dir/aeq_project` layout remains.
Setup still creates its new project directly. Under a binding, downstream stages
cannot fall back to that path if working-copy preparation is absent. This is path
selection, not permission to skip remaining lifecycle or closure requirements.

Seven focused tests cover legacy layout, refusal before preparation, actual
assignment entry stopped before computation, actual primary-output preparation,
foreign attempt, directory replacement and lost preparation response. Three
temporary faults detect legacy assignment fallback, ignored attempt identity and
ignored directory replacement. Baseline, harmless and restored controls pass.
`prototype/project-execution-controls.json` records exact source hashes. The
broader suite passes 202 tests; the existing unclosed SQLite ResourceWarning
still appears. The first assignment-entry test used a mock wrapper that obscured
the caller frame; replacing that wrapper with a direct function allowed the test
to inspect the actual stage-local selected path.

No full assignment ran in these checks. Native engine use through the writer's
working-copy method, state/package/project pairing, closure enforcement and the
remaining publication/terminal lifecycle still precede normal managed dispatch.

### Native engine reopen through the managed working path

Installed AequilibraE 1.6.2 now reopens a synthetic spatial project through the
actual working-copy writer and managed resolver. The proof creates two nodes
and one link, retains the project, prepares separate working files, resolves
that working path and reads exact geometry after `Project.open()`. Original
source and retained input inventories remain unchanged after native open/close.
This proof creates the consumed inventory fixture directly and mocks artifact
registration. Native database registration/recovery remains separate evidence
above, not an implied part of this native-engine check.

Baseline, harmless and restored controls pass. Substituting retained input for
the working directory fails before native reopen. Private
`native-project-working-controls-v1` retains separate project files per control;
`prototype/native-project-working.json` and
`prototype/native-project-working-controls.json` record geometry, source hashes
and boundaries. The earlier standalone `native-project-working-v1` also passed.
No assignment, interrupted-close recovery or scientific acceptance is claimed.

### Observed SQLite warning resolved in the recovery fixture

A tracemalloc-enabled isolated rerun traced the recurring unclosed-connection
warning to `test_model_command_recovery.py`, where a context manager committed
a deliberate fixture corruption but did not close its SQLite connection. The
test now uses explicit `closing` while retaining the transaction context. Its
mock transport now has a valid possible response, so omitting fixture corruption
fails at the expected identity assertion instead of an unrelated malformed mock
response. The production recovery implementation is unchanged.

Baseline, harmless and restored fixture controls pass without warnings. Removing
closure reproduces the warning. Removing the corruption fails its specific test.
`prototype/recovery-fixture-controls.json` records those controls. The full
202-test suite passes with ResourceWarning output enabled and no such warning.
This supersedes the observed fixture-warning boundary in earlier checkpoints;
it is not evidence that all engine connections close on every exception path.

### Combined state, package and project preparation

The existing paired-input helper now has an explicit project-inclusion mode.
It retains original state and package, verifies their pairing, retains the
selected project and requires its producer stage/attempt to match the state.
Only then does it create the independent working project. The saved mapping
includes all three producer references, the working project path, its initial
manifest hash and the consumed project manifest hash. Project execution paths
remain separate from original state. The only mapped state field remains
`package.package_dir`; source labels, assignment settings and count paths remain
unchanged. Execution readiness stays false.

Three focused tests exercise the real helper with real files and mocked reads
and writes. They verify five ordered artifact registrations, exact saved working
path/hash provenance, unchanged original state, refusal of a differing producer
attempt before working-copy preparation and lost final-mapping response. The
last case retains files and the exact pending mapping command while the stopped
writer refuses project access. The initial fixture used a nonexistent test-ID
index; a distinct canonical fixture UUID corrected that setup error.

Baseline, harmless and restored controls pass. Ignoring project-attempt pairing,
mapping retained project input as the working path, and erasing the initial
manifest hash each fail their targeted assertion. The broader warning-enabled
suite passes 205 tests without the prior fixture warning.
`prototype/execution-input-controls.json` records source identity and outcomes.
Native combined mapping recovery remains open; the separate input, working-copy
and earlier two-input mapping proofs do not substitute for it. Mutable package
preparation, remaining output/count joins, closure enforcement and the full
execution/publication/terminal lifecycle remain unfinished. Normal managed
dispatch stays disabled.

### Native combined input mapping recovery

The combined helper now runs through native selection and artifact commands with
real state, package and SQLite project files. Valid preparation retains five
consumer records: original state consumption, package consumption, project
consumption, initial working-project inventory and the final input mapping.
The proof checks exact project database bytes and independent file identities,
producer references, database checks, incomplete statuses, working-inventory
role and the saved mapping's working path and manifest hashes. Producer records
and original state bytes stay unchanged.

Baseline, harmless and restored cases pass. Deliberately omitting the package
mapping is detected; a contradictory package source still stops before project
preparation and leaves only its two separately retained inputs. Losing the final
mapping reply after native commit preserves all five records and exactly one
pending mapping command. A fresh CLI recovers its receipt through the disclosed
direct-PostgREST route-prefix adapter. Cached recovery forbids HTTP, checksums of
seven native tables stay unchanged and the writer stays stopped.

`prototype/execution-input-http.json` records source identity and all six control
outcomes; private `execution-input-http-v1` retains the clone and journals. The
temporary gateway is removed. These controls use synthetic native SQLite files,
not a network assignment. Mutable package preparation, remaining output/count
mapping, closure enforcement and full dispatch/publication/terminal handling
remain open. Execution readiness remains false and no scientific claim changes.

### Separate package working files and combined mapping

The writer now prepares an exclusive package working copy from the exact owned
consumed package. It verifies the recorded inventory and registers
`model_package_working_copy` as an initial mutable inventory with producer and
consumed-manifest references. Existing destinations, changed inputs and foreign
references refuse preparation. Uncertain registration stops the writer and
retains its pending command. The retained package remains separate from files
that assignment or calibration may change.

Project-inclusive preparation now creates both working copies and maps
`package.package_dir` to the package working directory. The mapping retains
separate package/project initial manifest identities and the original input
references. Source labels, original state and recorded count paths stay
unchanged. The older two-input preparation mode remains partial and does not
activate model dispatch.

Four working-package tests cover real file mutation without retained-byte
changes, no reuse, foreign input, changed input and lost registration response.
The combined-input test checks the new working path and package manifest links.
Baseline, harmless and restored controls pass; retained-input aliasing, erased
provenance and ignored source ownership fail. The combined mapping controls
also pass at current source. The warning-enabled broader suite passes 209 tests.
`prototype/package-working-copy-controls.json` and
`prototype/execution-input-controls.json` preserve results and hashes.

Native combined preparation now retains six consumer records and uses 14 HTTP
calls per valid case. The proof checks independent package working files,
initial-inventory role and exact saved working paths/hashes. Final mapping
lost-reply recovery still passes through a fresh CLI, with seven native tables
unchanged and the writer stopped. Private `execution-input-http-v3` and
`prototype/execution-input-http.json` retain the result. The v2 attempt failed
because its expected returned package path still named the retained input;
the corrected proof checks the explicitly owned working path. Original v2
artifacts remain available, and the failed run is not claimed as passing.

Native loss of the package-working registration response itself remains separate
from final-mapping recovery and is currently covered only by injected transport.
Remaining output/count joins, stage-side package-path enforcement, engine closure
and full managed execution/publication/terminal handling remain open.

### Native package-working receipt loss

The combined proof now drops the `model_package_working_copy` reply after its
native artifact command commits. The handler stops with exactly that command
pending. Five consumer artifacts remain and no final mapping file or mapping
artifact is published. This verifies the earlier interruption boundary rather
than inferring it from final-mapping recovery.

A fresh CLI recovers the exact package-working receipt through the disclosed
route-prefix adapter. Cached recovery forbids HTTP, checksums of seven native
tables remain unchanged and the writer stays stopped. The existing final-mapping
loss case still passes with six records. Baseline, harmless and restored cases
pass; omitted package mapping remains detected and contradictory source paths
still refuse. The report now names the lost artifact type explicitly.

Private `execution-input-http-v4` and `prototype/execution-input-http.json`
retain the seven control outcomes and source identity. The temporary gateway is
removed. No production code changes in this checkpoint. Stage package-path
enforcement, remaining output/count joins, engine closure and full managed
execution/publication/terminal handling remain open. These receipt checks do not
establish scientific accuracy or planner acceptance.

### Managed package-path enforcement

The writer now activates an invocation-local package path only after confirmed
working-package registration. Resolution checks the owning attempt directory,
working-directory identity and pending-command boundary. The stage-side helper
requires the supplied package path to equal that confirmed path. It does not
silently replace a wrong path with a usable one. Outside a managed binding, the
recorded legacy path remains unchanged.

Assignment validates its package before creating outputs. Artifact extraction
validates before count-input writes, and primary-output preparation validates
before retaining source files. Retained-input paths, missing package metadata,
foreign attempt directories and replaced working directories refuse and stop
the writer. Setup's package creation remains separate.

Six new tests enter actual assignment/artifact functions and stop before
scientific computation, or exercise directory refusal directly. Existing
project-path tests now prepare the actual combined inputs so their package
prerequisite is real. Baseline, harmless and restored controls pass. Four faults
detect skipped assignment and artifact checks, ignored attempt identity and
ignored directory replacement. Project-path controls pass again; their mutation
scope now targets the project resolver explicitly because the writer also has a
package resolver. The warning-enabled broader suite passes 215 tests.
`prototype/package-execution-controls.json` and
`prototype/project-execution-controls.json` record source hashes and outcomes.

These are path-selection checks, not full engine execution. Normal managed
dispatch remains disabled pending the remaining output/count joins, engine
closure and complete execution/publication/terminal lifecycle. No scientific,
human or browser acceptance boundary changes.

### Selected assignment-output transfer

The managed writer now captures an owned assignment-output directory as a
complete inventory. The consumer selects the declared completed producer,
checks its exact attempt path and registered manifest, copies all files into
an independent retained directory and registers a separate consumption record.
That record preserves the producer artifact, stage, attempt and manifest hash.
Nested count metadata stays byte-for-byte unchanged, including source labels.
An uncertain registration reply stops the writer with the exact pending command.

Six focused tests cover capture, ownership refusal, independent copying,
changed nested count metadata, producer provenance and reply loss. Baseline,
harmless and restored controls pass. Five deliberate faults fail the intended
tests: ignored producer path, ignored inventory changes, erased producer attempt,
incorrect artifact type and ignored capture ownership. The control report records
package-copy, main-worker and writer source hashes. The warning-enabled broader
suite passes 221 tests. Its completed output is retained locally at
`/tmp/openplan-output-handoff-tests.log`.

Transport is mocked and the skim fixture contains synthetic bytes. These checks
do not validate native output formats, native receipt recovery for this transfer,
mutable output paths, engine closure or scientific accuracy. The helper is not
connected to normal dispatch. Output/state/count pairing and the complete
execution, publication and terminal lifecycle remain open. No browser or human
acceptance is claimed, and normal managed dispatch remains disabled.

### Native assignment-output receipt recovery

Producer capture and selected consumer transfer now pass installed-command
checks against separate owned database clones. Each proof drops the HTTP reply
after the native artifact command commits. A fresh CLI recovers the exact
receipt; cached recovery sends no HTTP. Parent, stage, attempt, start, artifact,
KPI and receipt observations stay unchanged, and the original writer stays
stopped. The consumer selects the completed producer and retains its exact
artifact, stage, attempt and manifest hash.

Both proofs compare manifest hash, size, local path, artifact type, schema,
unassessed statuses and every copied file. Nested count metadata retains its
original source label. Independent inodes confirm separate copies. Baseline,
harmless and restored cases pass; an incorrect manifest hash fails the intended
native-byte comparison. Producer cases make six HTTP calls and consumer cases
make eight. The shared runner retains its historical `package_artifact` mode
label, but explicit assertions require `model_assignment_outputs` or
`model_output_consumption` for these cases.

`prototype/output-manifest-http.json` and `prototype/managed-output-http.json`
retain results. Private proof directories `output-manifest-http-v1` and
`managed-output-http-v1` retain their isolated databases and journals. Temporary
PostgREST gateways are removed. These are synthetic output fixtures, including
synthetic skim bytes, not scientific runs. Native file-format validation,
engine closure, mutable output paths, state/count pairing and normal managed
dispatch remain open. Receipt recovery does not authorize resumed computation.

### Independent assignment-output working files

The writer now prepares a separate mutable output directory from the exact
owned retained consumption manifest. It verifies the complete inventory and
registers an initial working inventory with its input hash and producer identity.
Only a confirmed registration activates the invocation-local path. Resolution
requires the same attempt and unchanged directory identity. Execution readiness
remains false; this helper does not resume or authorize model computation.

Six tests cover independent writes, foreign and changed inputs, uncertain
registration, attempt mismatch and directory replacement. A lost reply retains
the initial manifest and exact pending command but leaves the working path
inactive. Baseline, harmless and restored controls pass. Five targeted faults
detect retained-input aliasing, erased provenance and omitted ownership checks.
The broader warning-enabled worker suite passes 227 tests. Existing package
working-copy controls also pass after narrowing their mutation scope to the
package method. Reports are `prototype/output-working-copy-controls.json` and
`prototype/package-working-copy-controls.json`.

Transport is mocked in these new tests. Native recovery for working-output
registration, stage output-path enforcement, combined state/count mapping,
engine closure and full managed dispatch remain unfinished. Earlier native
producer/consumer receipt evidence remains separate. No scientific, browser or
human acceptance claim changes.

### Native working-output registration recovery

The native proof now confirms output consumption, then drops the reply after
working-copy registration commits. Both consumer records remain present with
the exact producer identity and input manifest link. The initial working
inventory has the mutable role and execution readiness false. The writer has
not activated its output path because registration was unconfirmed.

A fresh CLI recovers the exact receipt, cached recovery sends no HTTP and native
model/receipt observations stay unchanged. The writer remains stopped. A real
write to the proof-owned working CSV leaves its retained input unchanged; the
proof restores only that mutable CSV before comparing its initial inventory.
Baseline, harmless and restored cases pass with nine HTTP calls each. Changing
the working inventory role to retained input fails the intended assertion.
`prototype/output-working-http.json` records results; private
`output-working-http-v1` retains isolated databases and journals. Temporary
PostgREST gateways are removed.

This proof uses synthetic output and skim bytes. It does not establish native
format validity, engine closure, stage output-path enforcement, combined
state/count mapping or full managed execution. Normal managed dispatch remains
disabled. No scientific, browser or human acceptance boundary changes.

### Managed output paths at artifact entry points

Artifact extraction, primary-output preparation, volume-map publication and
evidence-packet materialization now resolve the confirmed working-output path
when a managed writer is bound. An unprepared path refuses; the legacy
`run_output` layout remains for unbound execution. Assignment output creation
is still separate and does not use this consumer resolver.

Six focused tests exercise these entry points with actual prepared output files.
They verify count-consumer destination, primary volume source, evidence-packet
destination and refusal before volume publication reaches project lookup.
Package/project prerequisites are mocked in these focused tests. The existing
project-source test separately mocks the output prerequisite so it continues to
assert its database selection boundary. An initial publication test patched
SQLite globally and intercepted the command journal, not the model database;
its corrected boundary intercepts project lookup instead.

Baseline, harmless and restored controls pass. Four deliberate substitutions
of the legacy output path fail their intended tests. The warning-enabled broader
suite passes 233 tests. `prototype/output-execution-controls.json` records the
worker source hash and fault results. This does not establish complete artifact
extraction or publication. Combined state/count mapping, assignment output
creation under managed dispatch, engine closure and the full lifecycle remain
unfinished. Normal managed dispatch remains disabled, with scientific, browser
and human acceptance still open.

### Assignment count-path mapping

A new mapping helper pairs original assignment state with the selected output
producer. It requires matching nonempty stage and attempt identities, a retained
count record, and exact original count paths beneath the inventoried output
source. It deep-copies state and changes only the count directory, manifest path,
CSV path and top-level assignment count path to the retained consumer output.
Manifest hashes, statuses, original source labels and manifest bytes remain
unchanged. The count consumer still verifies the recorded manifest and file
identities before creating its own input copy.

Six tests use real retained synthetic count and output files, including an
actual subsequent count consumption. They refuse differing attempts, foreign
paths, inconsistent top-level paths, missing count records and changed copied
manifest bytes. Baseline, harmless and restored controls pass; four deliberate
faults detect omitted producer/path checks, original-state mutation and failure
to relocate paths. The warning-enabled broader suite passes 239 tests.
`prototype/assignment-count-mapping-controls.json` records source identity and
control outcomes.

This helper is not yet connected to combined managed-input preparation. Its
caller must supply the already verified state/output records; the helper alone
does not establish native producer authority. Native joined recovery, managed
assignment creation, engine closure and full dispatch remain unfinished.
Scientific, browser and human acceptance remain open.

### Combined output and count input preparation

Combined preparation now accepts an explicit output mode, requiring project
and package working copies. It selects the output producer, maps count execution
paths against the original output source, prepares independent working outputs
and records all four input identities in the final mapping. The mapping retains
working-output initial hash, retained-input hash and execution path. Count reads
point to the retained output copy; artifact writes point to separate working
outputs. Original state and source labels stay unchanged, and execution readiness
remains false. A lost final mapping reply stops all working-path use.

Four tests exercise actual combined helpers with real synthetic files and
mocked HTTP, including subsequent count consumption. The broader warning-enabled
suite passes 243 tests. The first prerequisite test was vacuous because a missing
workspace refused before the intended guard. A deliberate guard removal exposed
that flaw. The corrected fixture prepares valid inputs and asserts the specific
prerequisite refusal. Baseline, harmless and restored controls now pass all four
tests; four targeted faults fail for skipped count mapping, retained-output path
substitution, erased input hash and omitted project prerequisite.
`prototype/output-mapping-controls.json` records the final outcomes.

Native recovery of this complete eight-record preparation remains unverified.
Normal dispatch still does not invoke these helpers. Managed assignment creation,
engine closure and complete publication/terminal handling remain unfinished.
No scientific, browser or human acceptance is claimed.

### Native complete input mapping recovery

The native join now verifies all four selected producer inputs and eight
consumer records, including separate project, package and output working copies.
It checks the saved count paths against independently constructed expectations,
preserves the count manifest bytes and consumes those mapped counts through the
actual count-input reader. Output inventory entries, copied bytes and independent
inodes are compared with the retained producer output. The final mapping retains
all producer IDs, initial working hashes, consumed hashes and execution paths.
Original state and native producer records remain unchanged.

Baseline, harmless and restored cases pass. Deliberately omitted package mapping
and count mapping are detected; a contradictory package source refuses. Lost
replies at final mapping, package-working and output-working registration recover
through a fresh CLI. Seven native tables stay unchanged, cached recovery forbids
HTTP and the original writer stays stopped. Final mapping loss retains eight
consumer records; output-working loss retains seven without a final mapping;
package-working loss retains five before output preparation starts.

`prototype/output-mapping-http.json` records nine controls. Private
`output-mapping-http-v1` retains the initial passing proof; `output-mapping-http-v2`
adds direct count-mapping fault detection. Producer fixtures use native SQL
commands. HTTP calls and fresh recovery use the disclosed direct-PostgREST
route-prefix adapter. Temporary gateways are removed; isolated databases and
journals remain retained.

This establishes combined input preparation and receipt recovery with synthetic
files. It does not establish native engine computation, engine closure, normal
dispatch, complete publication/terminal handling or scientific acceptance.
Normal managed dispatch remains disabled, and browser/human acceptance stays
open.

### Fresh managed assignment output directories

Assignment now creates managed outputs through the pinned attempt directory.
Only the primary and ActivitySim assignment directory names are accepted. The
exclusive mkdir refuses existing outputs, uses mode 0700 and fsyncs the parent;
ownership is rechecked before returning the path. Foreign attempt paths and
traversal names stop the writer. Unbound execution retains its existing layout.
This reserves local files, not a completed output or an execution authorization.

Six tests cover both names, privacy, no adoption, foreign paths, traversal,
legacy reuse and actual assignment refusal before run reads. Existing package
and project path tests intercept the new output-creation boundary before engine
work. Baseline, harmless and restored controls pass; deliberate adoption,
omitted attempt identity and allowed traversal fail. The warning-enabled broader
suite passes 249 tests. `prototype/assignment-output-creation-controls.json`
records the writer hash and control outcomes.

Inspection confirms assignment currently calls Project.close only on its normal
path. Exception-safe cleanup and verified engine quiescence remain required;
this directory change does not claim either. Completed output retention, managed
dispatch integration and full publication/terminal handling remain unfinished.
No scientific, browser or human acceptance boundary changes.

### Project cleanup on exceptional exits

Setup and assignment now use a project scope that attempts close after success,
partial creation/opening, computation failure and BaseException interruption.
A cleanup failure propagates, preserving the earlier error in its exception
context. Any exceptional exit stops a bound managed writer. The numerical
assignment body is only reindented; whitespace-insensitive review confirms no
calculation changes in this checkpoint.

Seven tests cover ordinary closure, partial create/open, interruption, combined
computation/cleanup failure and actual setup/assignment entry points with
injected download or graph failures. An older count-retention project fixture
needed a close method after the lifecycle change; its count-before-open assertion
remains. The warning-enabled broader suite passes 256 tests. Baseline, harmless
and restored controls pass. Four faults detect omitted close, ignored
BaseException, omitted managed stop and swallowed cleanup failure.
`prototype/engine-scope-controls.json` records scope and worker source hashes.

This proves cleanup is attempted and failures are not hidden. It does not prove
that AequilibraE closes every native handle or that engine threads, matrices and
SQLite connections are quiescent. Native cleanup evidence and a boundary before
completed-file capture remain required. Normal managed dispatch, full publication
and terminal handling, scientific acceptance and browser/human acceptance remain
unfinished.

### Native interruption exposed project-log handles

The first native scope check failed. After Project.close cleared the active
project, two descriptors still pointed to its aequilibrae.log. Installed
AequilibraE 1.6.2 creates handlers on a project-specific logger, while its close
method closes the global logger's handlers. Private `native-engine-scope-v1`
retains that failure and its log. The check was not relaxed.

The scope now closes and removes only FileHandlers whose resolved filename is
this project's aequilibrae.log, including when native project closure raises.
It leaves unrelated handlers untouched and propagates cleanup errors. Eight
focused tests and the warning-enabled 257-test broader suite pass. Local
baseline, harmless and restored controls pass; five faults detect omitted engine
or log closure, ignored interruption, missed managed stop and swallowed errors.

Private `native-engine-scope-v2` and `prototype/native-engine-scope.json` record
passing native baseline, harmless and restored cases. Each opens a two-node,
one-link spatial project, injects KeyboardInterrupt after a completed read,
checks the same interruption propagates, verifies active-project deactivation
and scans current-process descriptors for files under that project. No such
descriptors remain. Both copied SQLite databases pass integrity checks, and
native reopen preserves exact node geometry. Omitting engine close leaves the
project active and fails the intended native assertion.

This is bounded native cleanup evidence. It does not exercise assignment
threads or matrices, interruption during SQLite writes, process crashes or
cross-process file use. Full engine quiescence before capture, managed dispatch,
publication/terminal handling and scientific/browser/human acceptance remain
open.

### Owned assignment matrix cleanup

Assignment now registers its initial skim matrix before execution and registers
each demand matrix before initialization, including calibration demand matrices.
A matrix scope retains those objects and attempts close once per object in
reverse acquisition order. ExitStack continues remaining cleanup when one close
raises. Matrix cleanup runs before project cleanup, and any failure stops a bound
managed writer. No demand values or assignment settings change.

Three added tests cover duplicate ownership, reverse order, interrupted cleanup
ordering and continuing after a failed close. The combined scope suite passes
11 tests; the warning-enabled broader suite passes 260 tests. Existing controls
were scoped to the project helper after adding the matrix helper. Baseline,
harmless and restored controls pass, and eight faults now detect project/log and
matrix cleanup defects. `prototype/engine-scope-controls.json` records outcomes.

This covers directly acquired demand and initial skim matrices. Engine-created
assignment result matrices, selected-link results, native memory mappings and
worker threads still require inspection and native evidence. Calling matrix.close
is not proof all mapped views are released. Normal managed dispatch and completed
capture remain disabled pending the remaining lifecycle work. Scientific,
browser and human acceptance remain open.

### Native demand-matrix cleanup and file-format corrections

The native matrix check found two defects. First, the demand factory replaced
the disk-backed index with a NumPy array; AequilibraE.close then raised because
that array has no flush method. The factory now assigns index values in place.
Second, create_empty wrote AequilibraE binary bytes to a filename ending in OMX;
loading it as OMX failed the HDF5 signature check. Working matrices now use AEM
filenames, and the factory explicitly exports valid OMX files under the existing
public filenames. Numeric demand values and zone ordering are preserved.

The proof extracts the actual nested demand factory from stage_assignment,
runs it against AequilibraE 1.6.2 and reopens exported OMX in a separate process.
The two-by-two synthetic values and indices match exactly. Baseline, harmless and
restored cases pass; restoring index replacement fails native close, and
restoring mislabeled binary output fails native OMX reopen. The warning-enabled
broader suite still passes 260 tests. `prototype/native-matrix-scope.json` and
`prototype/native-matrix-controls.json` retain source hashes and observations.
Private matrix-scope v1/v2 preserve the original failures; v3 passes. The first
control-driver run had a quoted-newline syntax defect; controls v2 corrects it
and retains all five outcomes.

Closure alone does not establish released views: the native measurement reports
two descriptors before close, one after scope exit, one after releasing the
matrix owner and zero after releasing its borrowed computational view. The
child exits before the separate reader opens OMX. This is evidence for requiring
resource-release or process-exit custody before completed capture, not a claim
that production already provides that boundary. Engine-created result matrices,
threads, full dispatch and scientific/browser/human acceptance remain open.

### Engine subprocess reservation and observed exit

The new EngineProcess helper reserves an exclusive launch directory and fsyncs
its identity record before starting a child in a new process session. It observes
the original Popen object, refuses a live child or surviving original process
group, and retains the observed exit code. A nonzero exit stops the writer.
Existing launch reservations refuse another launch, including after a supervisor
interruption. Saved exit records provide no restart or capture authority.

Five focused tests use disposable subprocesses. The warning-enabled broader
suite passes 265 tests. Baseline, harmless and restored controls pass; four
intentional defects fail their targeted assertions: ignored nonzero exit,
ignored group members, erased attempt identity and adoption of an existing
reservation directory. See prototype/engine-process-controls.json for the source
hash and outcomes. The group-member probe is mocked; the other child exit tests
observe real processes. Managed registration uses fixtures.

This helper remains disconnected from normal dispatch. It does not contain
children that escape into a different session, transfer attempt authority into
an engine child, resume a lost supervisor or authorize completed output capture.
The native engine protocol and those custody boundaries remain unfinished.
Independent scientific, browser and human acceptance remain open.

### Native child exit with a retained matrix view

The process helper now has a native AequilibraE check. A disposable child creates
a two-by-two disk-backed matrix, exports OMX, closes the matrix scope and holds
its borrowed computational view at a release barrier. The real parent helper
refuses completion while that child is live and writes no exit receipt. After
release and observed exit, a separate native reader verifies the OMX values
and zone indices. Baseline, equivalent-wrapper and restored cases pass. Replacing
the exit check with a premature success response fails the same live-child
assertion. `prototype/native-engine-process.json` records the outcomes and
helper source hash; `prototype/verify_native_engine_process.py` reproduces them.

Registration remains mocked in this check. It does not run full assignment,
contain escaped descendants, recover a lost supervisor, authorize capture or
establish scientific acceptance. Normal managed dispatch remains disabled.

### Pin engine process record directories

Review found that verifying the attempt root did not verify its engine_process
subdirectory before exit-record publication. The helper now records the original
subdirectory device and inode, opens it without following symlinks through the
pinned attempt descriptor, and writes reservation, log and exit files relative
to that descriptor. Log creation uses mode 0600 directly. A replaced directory
or symlink stops the writer instead of receiving an exit record.

Seven process tests pass within the 267-test warning-enabled suite. Baseline,
harmless and restored controls pass; six faults fail their intended tests,
including removed directory-identity checks and symlink following. The native
borrowed-view child check also passes again with the updated helper source hash.
This constrains record publication, not arbitrary same-user engine code or host
administrators. It does not solve descendant containment, child working-directory
races, supervisor loss or capture authorization. Normal dispatch remains disabled.

### Pin the child working directory through launch

The subprocess launch now resolves its working directory through the parent's
open attempt descriptor using Linux procfs. The descriptor remains open until
Popen returns from its exec handshake; the engine inherits no directory descriptor.
If procfs access is unavailable, launch fails and the reservation remains for
reconciliation. There is no fallback to an unverified pathname.

A real-child test replaces the attempt pathname immediately before Popen. The
child writes only into the original pinned directory. Subsequent exit recording
refuses the changed attempt identity and stops the writer. Restoring pathname
resolution makes this test fail because output lands in the replacement.
Baseline, harmless and restored controls pass with seven targeted faults caught.
The warning-enabled broader suite passes 268 tests, and the native borrowed-view
check passes again. This is Linux launch-directory evidence, not a sandbox for
arbitrary absolute paths, containment of descendants or permission to capture
outputs. The child authority protocol and supervisor-loss handling remain open.

### Preserve unconfirmed progress-write failures

Tracing the child protocol found an existing production connection defect:
AssignmentProgress._send swallowed every callback exception, including
WorkerStateWriteUnconfirmed from stage progress writes. The handler now accepts
an explicit fatal exception policy, and the actual assignment context supplies
WorkerStateWriteUnconfirmed. Ordinary display callback failures remain best
effort. Fatal failures propagate with their original exception identity.
Logger detachment and level restoration also complete if the final pending
progress update raises.

The 17 progress tests and the broader warning-enabled 285-test suite pass.
Baseline, harmless and restored controls pass; swallowing custody failures,
omitting level restoration and removing the assignment fatal policy each fail
their targeted test. The assignment-policy test executes the context expression
extracted from the actual stage function, with a synthetic callback failure.
See prototype/progress-custody-controls.json for source hashes and outcomes.
The first edit command used the wrong relative directory and made no changes;
the corrected command and subsequent tests exercise the actual patch.

This verifies Python callback propagation, not native solver interruption or
cross-thread callback ownership. The child still needs explicit authority for
run reads, path resolution, count retention and stage progress. Importing main
also loads operator environment files, so removing credentials from only the
child environment would not establish credential isolation. The engine child
protocol, descendant containment and supervisor-loss reconciliation remain open.

### Native assignment progress logger and interruption

The first native assignment check failed because no callback reached the handler.
Installed AequilibraE 1.6.2 uses a project-specific logger with propagation disabled;
the worker watched its parent logger. The actual assignment context now attaches
to project.logger.name. The unit context check also uses a nonpropagating project
logger. Four progress fault controls now pass, including restoration of the wrong
logger, and the warning-enabled broader suite still passes 285 tests.

The native proof creates two centroid nodes, one bidirectional link and synthetic
demand, then executes the configured TrafficAssignment. It evaluates the progress
context expression extracted from the actual worker stage. Version 2 first proved
interruption on an engine setup warning. Version 3 deliberately waits for an
iteration update and advances the progress clock by six seconds per read so the
tiny network exercises an unthrottled update. The original synthetic callback
failure propagates before execute returns, on the invocation thread. Scope cleanup
deactivates the project and leaves no open project file descriptors. Baseline,
harmless and restored cases pass; swallowing the error or selecting the wrong
logger lets execution continue and fails the targeted assertion.

Private native-progress-failure-v1 retains the original failed experiment; v2
retains the warning case; v3 retains the iteration case and controls. The current
report is prototype/native-progress-failure.json. These are synthetic engine
interruption checks, not database transport evidence, a full stage run, assurance
about larger-network threads, supervisor recovery or scientific acceptance.

### Do not downgrade select-link custody failures to warnings

An audit of assignment try blocks found the select-link diagnostic setup caught
WorkerStateWriteUnconfirmed from its stage-log update and continued. It now
rethrows that exception before the ordinary diagnostic warning handler. SQLite
extension setup also runs inside the existing finally block, so loading failures
close the diagnostic connection.

Three tests execute the actual extracted try block with a real CSV and controlled
database, screenline and transport substitutes. Unconfirmed stage writes escape
with the same exception object; ordinary screenline failures still warn and skip;
extension failures close the database. Baseline, harmless and restored controls
pass. Three targeted faults detect swallowed writes, omitted closure and treating
an ordinary diagnostic failure as fatal. The warning-enabled broader suite passes
288 tests. See prototype/select-link-custody-controls.json for source hash and
outcomes. These checks do not execute full assignment or establish scientific
acceptance. Engine child authority transfer and supervisor recovery remain open.

### Engine child authority decision

[Engine child protocol](ENGINE_CHILD_PROTOCOL.md) records the current assignment
call boundary and the selected parent-owned writer with a private live request
channel. The audit identifies direct run reads, parent-confirmed count manifests,
count-fetch subprocesses and dotenv loading during main import. These prevent
simply copying the writer or clearing a few environment variables from becoming
an accepted execution boundary. The document specifies allowed operations,
provisional results and required crash/replay/descendant evidence. It is a design
decision, not implementation or acceptance. The current direction check passes
with its existing review reminders; the roadmap remains the sole queue.

### Live parent-owned progress channel

The first channel implementation handles only progress updates. It uses bounded
length-prefixed JSON frames, rejects duplicate fields, requires exact version and
sequence, and accepts no child-provided run/stage/attempt identity or terminal
operation. The parent calls its managed writer on the owning thread and responds
only after the retained command confirms. Any protocol, transport or writer
failure closes the channel and stops the parent writer. No error response exposes
provider text or credentials.

Nine focused tests include a real inherited socket and child client performing
two sequential writes through the parent. HTTP is mocked; the command journal is
real. Replayed sequence, extra identity, terminal requests, oversized frame/log,
duplicate JSON and wrong acknowledgement refuse. Lost database response leaves
one pending command. Lost child response after a confirmed command stops the
writer with no pending command and no second write. Five targeted faults detect
sequence, operation, log limit, acknowledgement and stop-policy regressions;
baseline, harmless and restored controls pass. The warning-enabled broader suite
passes 297 tests. See prototype/engine-channel-controls.json.

Initial fixture corrections restored timeout settings on the child's inherited
socket and asserted the actual attempt-id RPC parameter, not a nonexistent stage
parameter. The log-limit control now isolates the channel boundary from the
separate command validator, which also rejects oversized stage text.

This channel remains disconnected from EngineProcess and normal dispatch. The
real-child test launches its own disposable process. Run reads, count preparation,
path resolution, solver integration, launch admission, descendant containment and
supervisor-loss recovery are not established. Frame size bounds memory use, not
wall-clock liveness; the eventual supervisor must own deadlines and interruption.

### Connect the reserved launch to its progress channel

EngineProcess can now create a private socket pair for its reserved child. It
passes only the child endpoint through pass_fds and supplies its descriptor in a
launch-specific environment copy. The parent closes its copy of the child
endpoint after Popen; spawn failure closes both endpoints while retaining the
launch reservation and stopping the writer. A supplied descriptor setting is
rejected before launch. The child consumes that setting once and marks the
endpoint noninheritable. Observed child exit closes the parent channel.

Three new tests exercise the actual reserved launch and parent writer with a
real socket and command journal. HTTP remains mocked. The child waits for the
confirmed progress response, writes its completion marker and cannot reopen the
endpoint from the consumed environment setting. Four targeted controls catch
parent/child endpoint leaks, a foreign descriptor setting and failure to close
the completed channel. Existing process and channel controls pass again, as does
the native borrowed-matrix-view check. The warning-enabled broader suite passes
300 tests. See prototype/engine-launch-channel-controls.json and the refreshed
process/channel/native reports.

This joins launch and progress only. It does not establish native solver use of
the channel, run/path/count operations, provisional result handling, descendant
containment, supervisor restart or full normal dispatch. Consuming an environment
setting prevents accidental reuse; it is not protection against arbitrary
same-user code retaining a descriptor or creating new sockets.

### Native solver progress through the reserved child channel

The joined native proof now runs the two-node, one-link assignment inside an
EngineProcess reservation. The child consumes the inherited channel, and its
native logger callback waits for the parent writer's command acknowledgement.
The progress context comes from the actual assignment source expression; a
synthetic adapter translates channel loss into the worker's fatal-error policy.
It is not yet the full assignment entrypoint or a production child adapter.

Baseline, harmless and restored cases complete after confirmed progress writes.
Every observed progress line matches an ordered journal command with the exact
run/stage/attempt identity. A simulated database-response timeout on an iteration
interrupts the native solver and retains one pending command. A lost child
response after the command confirms also interrupts computation, stops the
parent writer and leaves zero pending commands. The child project closes with
no project descriptors left open in either interrupted case. A control that
acknowledges the iteration without writing its command fails the exact-line
journal comparison even though the earlier warning command exists.

Private native-engine-channel-v1 retains the first joined run. Version 2
strengthens the assertion from a nonzero write count to every observed line and
identity. Synthetic journals, projects and child logs are retained after child
exit. `prototype/native-engine-channel.json` records source hashes, observations
and controls. No production code changed in this checkpoint.

HTTP and initial ownership are mocked. The timeout does not prove a server-side
commit; installed lost-commit recovery requires a separate native database check.
This proof does not supply the run/path/count protocol, result publication,
detached-descendant containment, restored supervisor or scientific acceptance.
Normal managed dispatch remains disabled.

### Parent-owned run configuration read

AttemptWriter.read_run now reads only its claimed run. The existing stage read
can explicitly project the run's scenario, geography, query, engine, title and
input snapshot in the same joined response that checks run/workspace, active
attempt, managed status and running state. Missing projected fields refuse;
explicit null values remain present. The main worker's bound sb_get_run adapter
uses this method and has no legacy-read fallback after failure. Unbound legacy
behavior is unchanged. No database write occurs for a successful read.

Four tests use the real invocation journal and actual worker adapter with mocked
HTTP. They assert the exact query projection and filters, response closure,
foreign-run refusal before transport, revoked-attempt refusal and missing-field
refusal. Baseline, harmless and restored controls pass; four targeted faults
remove requested-run checks, configuration projection, field completeness or
attempt validation and fail their intended tests. The warning-enabled broader
suite passes 304 tests. See prototype/managed-run-read-controls.json. The first
control-run anchor was ambiguous with the workspace guard; it now targets the
run-read guard specifically.

This is a read-time ownership snapshot, not a distributed lease or concurrent
revocation fence. Native RLS and the child run-read channel remain unverified.
The new operation establishes the parent API needed by that channel; it does not
yet provide the full child input protocol or activate normal managed dispatch.

### Run configuration over the inherited channel

The live channel now supports an exact read_run request with no arguments. The
parent derives the run ID from its managed context and calls the checked run
reader. Progress and run reads share one ordered request/response sequence.
The child checks the acknowledgement envelope and requires an object result;
extra child identifiers refuse before any read. Parent read failure closes the
channel and stops the writer without sending configuration.

Four tests include a reserved real child reading run configuration, preserving
the input snapshot and then sending a confirmed progress update. They also cover
extra identifiers, revoked ownership and the exact parent-derived reader argument.
Three targeted mutations detect extra-field acceptance, changed parent identity
and bypassed ownership reads. Earlier progress controls still pass after the
shared client exchange refactor. The warning-enabled broader suite passes 308
tests. Native solver/channel cases also pass again as private
native-engine-channel-v3, including both loss cases and the skipped-write control.
See prototype/engine-run-channel-controls.json and the refreshed native report.

HTTP and ownership remain mocked in these tests. The 64 KiB frame bound applies
to run responses too: oversized configuration refuses instead of being truncated.
Bulk input transfer, path/count operations, production engine adapter, native
read/RLS evidence, descendant containment and supervisor recovery remain open.
Normal managed dispatch remains disabled.

### Verified working paths over the channel

The child now has an argument-free read_paths operation. The parent derives the
attempt root from its owned workspace and invokes the existing project/package
resolvers. The response contains only the working root, verified mutable project
copy and verified mutable package copy. Extra path arguments refuse. Missing
activation or a replaced working directory closes the channel and stops the
writer instead of returning a legacy or retained-input fallback.

Four tests use actual prepared working-copy fixtures and include a reserved child
reading the returned project database and package CSV. Registration remains mocked.
Three mutations detect accepted path overrides, skipped project identity checks
and skipped package activation. Baseline, harmless and restored cases pass; the
warning-enabled broader suite passes 312 tests. See
prototype/engine-path-channel-controls.json. Returned path strings are a checked
read-time view, not pinned subsequent engine opens or a same-user sandbox.

The integration recheck confirms PR 170's exact head 03ba477f has passing GitHub
checks. T3 tab_10 remains automation-capable but hidden, and snapshot capture still
fails on client preview-f07599c0933f53222dd8b3633c13d8cf. Its visual-acceptance hold
therefore remains. PR 171 run 37858832956 was live at its observed head; no check
was cancelled or inferred successful. Count preparation, production child entry,
provisional result handling, containment and supervisor recovery remain open.

### Parent-selected output reservation over the channel

EngineProcess can now configure one supported output-directory name for its
parent channel. The child sends create_outputs without arguments; the parent
calls the writer's existing exclusive directory creator under the owned attempt.
The child cannot supply a name or path. An unconfigured destination refuses,
and an existing destination is not adopted after a repeated request.

Four tests include a reserved child creating and writing the parent-selected
activitysim_assignment_output directory with mode 0700, without creating the
trip-based run_output directory or making an artifact registration. Repetition
preserves existing bytes and stops the writer. Three targeted faults detect
accepted child-name fields, unconfigured creation and adoption of existing files.
Baseline, harmless and restored controls pass. The warning-enabled broader suite
passes 316 tests. See prototype/engine-output-channel-controls.json.

This creates a local destination only. The future stage adapter must derive the
parent's chosen name from the actual stage and preserve the distinct demand
methods; this channel does not itself validate stage-name policy. Completed
output capture/publication, count preparation, engine entry, descriptor-pinned
later opens, descendant containment and supervisor recovery remain open.

### Separate count preparation from native assignment

The actual assignment now calls prepare_assignment_count_inputs before opening
the engine project. This extracts source selection and confirmed retention into
a callable parent-side boundary. Fresh selection still forwards run geography,
calibration choice and explicit source precedence to the existing acquisition
and retention code.

A retained count record now bypasses new acquisition entirely. Previously, a
record supplied without a separate path override could trigger acquisition even
though retention later consumed the original record. An explicit path that
contradicts the retained record now refuses before copying. Missing explicit
sources remain unavailable and do not select a populated default during retention.
No observation, holdout, tolerance or scientific grade is changed.

Four new tests use real count files and manifests with mocked acquisition.
Baseline, harmless and restored controls pass; four faults detect lost calibration
choice, reacquisition, ignored explicit source and conflicting-path acceptance.
The warning-enabled broader suite passes 320 tests, including actual assignment
checks that validate counts before engine opening. The control runner initially
classified callback AssertionError as an error rather than a unittest failure;
its correction retains checks for the exact intended assertion messages. See
prototype/count-preparation-controls.json.

The parent channel still needs to invoke this preparation with its own declared
inputs and output destination. Live provider acquisition, native registration,
full child entry, containment and interruption recovery remain open.

### Parent count preparation over the engine channel

The reserved child now has an argument-free `prepare_counts` request. The parent
accepts a trusted preparation callback at launch, requires its own preceding
output creation, records that directory's device/inode, checks it before and
after preparation, and consumes a one-time preparation flag before invoking the
callback. The callback runs under this invocation's bound writer. A different
bound writer, stopped writer, uncertain registration, repeated request or changed
output directory stops the channel. The child cannot select a source, calibration
choice, output path or invocation identity in this request.

The callback is trusted parent code, not a sandboxed plugin. The integration test
uses the actual `prepare_assignment_count_inputs` helper with parent-declared
inputs, real retained bytes and manifest, and mocked HTTP registration. A reserved
real child receives those bytes only after the helper returns. Lost registration
leaves one pending journal command and no response. Other tests cover requests
before output creation, child-supplied source fields, repeats and replacement of
the output directory. The broader warning-enabled suite passes 326 tests. Baseline,
harmless and restored controls pass; four injected faults fail the intended tests
for source fields, repetition, output identity and omitted writer binding. See
`prototype/engine-count-channel-controls.json`.

This confirms the tested helper-backed callback boundary, not every possible
parent callback. Path identity checks do not establish containment against a
concurrent filesystem attacker. No normal dispatcher entry is enabled. The full
child stage adapter, parent acquisition subprocess custody, native database
registration/recovery, supervisor restart, escaped descendants and scientific
acceptance remain open. Existing GitHub run 37859472244 was still in progress
when polled after the local suite; it was not restarted.

### Fixed parent adapter for assignment count preparation

`main.managed_assignment_count_preparer` supplies the channel's trusted callback
using the actual assignment preparation helper. Configuration requires a bound
writer and copies setup and retained count records. Invocation requires that same
writer, reads the currently owned run through its scoped reader, resolves the
confirmed working project path and derives calibration with the existing per-run
resolver. No child argument chooses these inputs. The generic channel callback
mechanism remains internal; the normal dispatcher is still disabled.

Ten adapter tests include the six channel cases with this fixed callback,
including the reserved real child and lost registration reply. Added cases cover
missing binding, invocation outside the original binding, revoked ownership before
preparation and unchanged setup geography with current calibration. The broad
warning-enabled suite passes 336 tests. Baseline, harmless and restored controls
pass, and four faults detect lost calibration, shared mutable setup, skipped
ownership read and missing invocation binding. The first missing-binding control
reached an unrelated absent output directory; the test now mocks the downstream
helper to isolate the intended refusal. See
`prototype/managed-count-preparer-controls.json`.

The project resolver and acquisition transport are mocked in the adapter test;
separate existing path tests protect confirmed working-copy selection. This is
not native database, live provider, full stage, subprocess containment or scientific
acceptance evidence. The next integration boundary remains the child assignment
entrypoint and its explicit resolved settings, without importing operator dotenv
files or enabling legacy database transport in that child.

### Assignment extraction dependency audit

At 145935596, a reproducible static inventory found 45 reachable `main.py`
functions from `stage_assignment`. Direct inspection confirms that the transit
branch retains credentialed database/private-storage reads and optional catalog
and archive acquisition. The full child extraction therefore requires a retained
transit-preparation boundary as well as count preparation. The protocol decision
now identifies the source ownership, exact bytes, feed precedence, service-window
provenance and explicit settings that must survive that separation. No transit
capability is disabled to simplify extraction.

The inventory records source hashes, function locations, references, attribute
calls and local imports without importing the worker. It is an extraction aid,
not a security or scientific gate. Existing application behavior and test guards
are unchanged. GitHub run 37860237074 remains in progress on live polling. Browser
acceptance and normal managed dispatch activation remain unfinished.

### Separate selected-feed preparation from numerical skimming

`skim_selected_feed_version` now loads the selected version once and delegates
to `skim_prepared_feed_version`. The latter accepts the loaded feed and original
metadata, copies the metadata before adding the numerical summary, and preserves
the existing ingest-authoritative fields, source identity, coverage refusal,
expiry disclosure and deadline. The assignment caller and feed precedence remain
unchanged. No scientific method, observation or acceptance tolerance changes.

Four new tests drive real synthetic GTFS parsing/skimming with mocked metadata and
storage reads. They check that prepared skimming makes no new load/HTTP request,
leaves input metadata unchanged, retains selected-feed coverage refusal and
honors the deadline. The wrapper test checks exact loaded-object and option
forwarding. All 51 existing transit-feed-handoff checks pass. Baseline, harmless
and restored controls pass; four targeted faults are detected for input mutation,
overwritten ingest facts, skipped coverage and dropped deadline. See
`prototype/prepared-feed-skim-controls.json`.

This is a callable separation, not process isolation. Both functions still live
in `main.py`; importing it still loads operator configuration. The prepared feed
object has not yet crossed a retained archive handoff or the engine channel.
Explicit transit settings, immutable archive/metadata custody, acquisition
supervision, child-only imports and full assignment execution remain open.

### Transit numerical module import boundary

The prepared-feed skim, shared feed summary, expiry note and ingest-authoritative
field names now live in `model_transit_skim.py`. The three function ASTs match
the preceding implementation exactly. `main.py` imports those same functions;
selected-feed loading and source transport remain in the parent-facing worker.
No duplicate numerical implementation or changed feed method is introduced.

A fresh process loads the numerical module from its actual path with imports of
`main`, `dotenv` and `requests` refused and a socket-connect audit hook. It parses
a synthetic GTFS archive, produces an available served pair and retains version
and checksum metadata. The environment contains only process path, module path
and single-thread numerical settings. This checks this exercised import/compute
path, not an operating-system sandbox or every optional library behavior.

Both new module checks, the four prepared-feed checks and all 51 existing
transit-handoff checks pass. The expiry call-site guard now inspects the imported
prepared function as well as the worker's ordinary feed path. Six fault controls
fail for input mutation, overwritten ingest facts, skipped coverage, an injected
dotenv import, omitted selected-feed expiry call and a wrong worker export.
Baseline, harmless and restored controls pass. See
`prototype/transit-skim-module-controls.json`.

`gtfs_skim` still reads numerical operator defaults at import. Explicit setting
transfer, retained archive and metadata custody, acquisition supervision and the
full assignment child entrypoint remain unfinished. Normal managed dispatch is
not enabled by this extraction.

### Explicit transit numerical settings

`TransitSkimSettings` carries walk-access miles, transfer penalty minutes, flat
fare and walking speed as an immutable value with an exact serializable record.
It rejects missing/extra fields, booleans, nonfinite or negative values and zero
walking speed. Callers that omit it still capture the current operator defaults.
The prepared-feed path uses one settings value for coverage, stop access, skim
costs and reported assumptions. Its summary includes the complete settings record.
No global mutation is used to transfer values between processes.

Five settings tests use a real synthetic feed and a small constructed transfer
network. A separate process with different access, fare, transfer and walking
defaults reproduces every skim matrix from the explicit parent record. Separate
cases exercise access-driven availability and transfer-driven route choice, exact
record validation and coverage. The existing 16 GTFS skim checks, 51 transit
handoff checks, four prepared-feed checks and two module import checks pass. The
handoff deadline recorder initially rejected the new settings keyword; it now
forwards that keyword while retaining its two-distinct-budget assertions.

Baseline, harmless and restored controls pass. Eight injected faults fail for
boolean acceptance, ignored access, transfer, fare or walk values, missing settings
metadata, ignored coverage settings and a dropped skim deadline. See
`prototype/transit-settings-controls.json`. This does not prove all numerical
parameters across assignment are explicit: parser assumptions, parent acquisition
budgets, mode choice and other assignment settings still need their full boundary
review. The settings have not yet been wired through retained archive custody or
the complete engine child. Scientific acceptance and dispatch activation remain
open. GitHub run 37860789460 remained in progress at the latest live poll.

### Retained transit archive and assumptions

`model_transit_inputs` reuses the existing package inventory for an exclusive
bundle containing `feed.zip` and `transit.json`. The payload records the original
feed metadata and exact numerical settings. Retention checks the archive against
the metadata checksum before creating the bundle. Consumption verifies a separate
package copy, requires the two expected files, and rereads both against their
recorded sizes/hashes and private-file identities before returning in-memory bytes.
The caller still establishes producer/run/attempt authority; this local manifest
is not an execution or registration receipt.

Six new tests cover independent copies and original metadata, checksum mismatch,
archive/metadata tampering, extra inventory entries, changes after package copying
and same-size metadata changes. The accepted copy parses and skims the synthetic
feed using the retained fare. Four targeted faults fail for ignored feed checksum,
ignored inventory, ignored final read hash and substituted process-default settings;
baseline, harmless and restored controls pass. See
`prototype/transit-input-controls.json`. The combined warning-enabled package,
project and transit suite is recorded in the local execution log.

No live feed is fetched and no database is changed by these checks. Parent artifact
registration, lost-reply recovery for that registration, the exact selected-feed
loading adapter, parser-setting custody and the engine channel remain unfinished.
This bundle does not establish operating-system containment or scientific validity.

### Parent confirmation of selected transit inputs

The existing selected-feed loader now delegates to `_prepare_selected_feed_version`,
which preserves the exact downloaded bytes alongside its parsed feed and original
metadata. The public loaded-feed return remains unchanged. The new bound parent
adapter reads the owned run, derives its selected feed from the existing handoff,
uses the writer's workspace for source authorization, retains the archive and
settings under owned outputs, and confirms a `model_transit_inputs` artifact before
returning the manifest. A missing or refused selection does not acquire another
feed. File or registration uncertainty stops the writer and preserves the retained
bundle for reconciliation.

Six tests drive the actual loader and retained artifact adapter with real files
and journals. The feed transport returns only projected fields, and a dedicated
check asserts that the existing projection includes workspace ownership. Cases
cover confirmed metadata/bytes, lost registration reply, foreign workspace,
foreign output and missing selection. The initial fixture changed workspace but
kept the old storage prefix, and the existing storage guard correctly refused it;
the fixture now uses a consistent synthetic owner and prefix. All 51 existing
transit-handoff checks pass. Four targeted faults fail for omitted registration,
foreign output acceptance, wrong workspace and missing ownership projection;
baseline, harmless and restored controls pass. See
`prototype/managed-transit-retention-controls.json`.

Registration transport remains mocked in these tests. Native database lost-reply
recovery, parent channel handoff, parser-setting custody, other feed origins and
acquisition containment remain unfinished. No normal dispatcher is enabled and no
scientific acceptance claim changes.

### Selected transit handoff over the reserved engine channel

The child can request selected transit preparation without supplying a feed id,
source, path or workspace. The parent supplies the fixed adapter, requires its
own output directory and consumes a one-time request flag. Count and transit
preparation now share binding, output-identity and post-callback writer checks.
The selected transit adapter returns a confirmed retained record or an ordinary
selected-feed refusal reason. It catches only `SelectedFeedError`; uncertain
custody remains fatal and never becomes an unavailable-feed response.

A real reserved child requests output creation and transit preparation, consumes
an independent verified archive copy, parses it and computes a synthetic transit
skim using the retained settings. The parent confirms the child's observed exit
with execution readiness still false. Lost registration leaves one pending journal
command, closes the channel and prevents child consumption and result creation.
Other cases cover workspace refusal, repeated requests, child-supplied version
fields and propagation of the original uncertain-write exception.

The warning-enabled broader suite passes 365 tests. Four transit fault controls
fail for child-field acceptance, repeated preparation, skipped parent preparation
and downgraded uncertain writes. Baseline, harmless and restored controls pass.
The four count-channel controls also pass after the shared-helper refactor; their
report now records the current channel hash. See
`prototype/engine-transit-channel-controls.json` and
`prototype/engine-count-channel-controls.json`.

HTTP remains mocked, including registration. The selected-feed path does not
cover operator, discovered or bundled feed preparation. Native registration
recovery, parser settings, acquisition supervision, the complete assignment
entrypoint and operating-system containment remain unfinished. No normal
managed dispatcher is enabled and no scientific acceptance claim changes.

### Exact archive acquisition for the remaining feed origins

`gtfs_skim.acquire_feed_archive` separates existing byte acquisition from parsing
and returns the archive plus resolved source URL/name. `load_feed` delegates to
it before reducing the archive. Supplied bytes still bypass environment lookup
and downloads. URL/cache behavior, URL-over-path precedence, operator path and
bundled fallback are preserved. Local provenance remains a basename rather than
an absolute server path. The new boundary lets parent preparation retain the exact
archive without a second fetch.

Five new tests cover supplied identity, download/cache bytes, local origins,
existing precedence and parser forwarding. The warning-enabled transit suite
passes 34 tests, including the reserved child and confirmed-input tests. All 16
GTFS skim checks, 25 discovery checks and 51 transit-handoff checks pass. Baseline,
harmless and restored controls pass; five faults fail for lost supplied identity,
wrong cache key, exposed local path, ignored URL acquisition and lost parser
identity. See `prototype/transit-acquisition-controls.json`.

This refactor preserves the existing shared-cache and transport behavior. It does
not establish atomic cache publication, live provider reliability, a hard download
deadline or acquisition containment. The parent still needs to retain/register
operator, discovered and bundled inputs and preserve their distinct coverage and
catalog-failure outcomes before joining them to the child channel. Full assignment
execution and scientific acceptance remain open. GitHub run 37862059125 remains
in progress on live polling.

### Parent preparation across transit feed origins

`resolve_transit_feed_plan` now holds the existing selection/discovery join and is
used by the normal assignment path and the new parent adapter. It preserves the
actual centroid extent, selected-feed precedence, operator override behavior and
catalog-failure policy. The parent reads the owned run, resolves the plan, obtains
the selected/operator/discovered/bundled archive and confirms the same retained
artifact format. Shared output validation and registration helpers also serve
the selected-only adapter.

Retained metadata includes feed origin, operator displacement, catalog error and
bundled-fallback disclosure. A catalog answer with no covering feed returns
`no_local_feed` without loading a bundle. A selected-feed failure never substitutes
another origin. Ordinary acquisition/parse failures remain distinct from uncertain
custody; registration sits outside the ordinary-feed error handler. The parent
checks the caller-supplied deadline after preparation. Coverage remains a later
numerical decision and is not inferred from successful retention.

Ten origin tests cover operator path/URL, discovered extent, disabled discovery,
catalog failure, catalog no-match, selected precedence/refusal, deadline and lost
registration. The warning-enabled transit suite passes 44 tests, and all 25
existing discovery checks and 51 handoff checks pass. The handoff source guard
initially rejected the helper's renamed local selection expression; the extracted
helper now preserves the existing expression and variable names without weakening
the guard. Six injected faults fail for omitted registration, wrong extent,
lost fallback disclosure, ignored selection, substituted no-match and lost deadline.
Baseline, harmless and restored controls pass. See
`prototype/transit-origin-controls.json`.

Catalog/download/database transports remain mocked. Coordinates and deadline are
trusted parent inputs in these checks; their derivation from owned package data
still needs integration. General-origin child requests and coverage outcomes,
hard download deadlines, native registration recovery, full assignment execution
and scientific acceptance remain unfinished. Normal managed dispatch stays off.

### Coverage outcomes without false local-feed absence

Inspection found that the normal assignment branch labeled an operator/bundled
archive's coverage miss `no_local_feed` and stated that no GTFS feed covers the
study area. One archive cannot establish that claim. The branch now uses shared
`transit_coverage_refusal`: loaded-archive misses are `feed_unavailable`, with
separate reasons for selected-feed misses and catalog-unavailable fallback misses.
The existing completed-discovery/no-match path remains `no_local_feed`.

`skim_prepared_transit` applies the same origin-aware coverage decision to retained
inputs and delegates covered feeds to the existing numerical implementation with
explicit settings. A miss returns no skim; a covered feed retains its origin and
catalog metadata. Unknown origins refuse rather than acquiring a coverage claim.
No demand, observation, tolerance or numerical fitting changes.

Five new tests cover all six loaded origins, distinct refusal reasons, covered
skims, unknown origins and execution of the actual normal-assignment miss branch
extracted from its AST. The warning-enabled transit suite passes 49 tests. All 25
discovery and 51 transit-handoff checks also pass. Five faults fail for restored
false absence, erased catalog failure, skipped coverage, a covered feed mislabeled
unavailable and accepted unknown origin; baseline, harmless and restored controls
pass. See `prototype/transit-coverage-controls.json`.

The normal branch's status/log correction is tested at its executable branch,
not through the full model run or rendered evidence panel. Browser acceptance
remains open. General child-channel coverage, centroid custody, native registration
recovery, full assignment, provider containment and scientific acceptance remain
unfinished. Normal managed dispatch is still disabled.


## Ordered package geometry checkpoint, October 8

The assignment and parent preparation now share a reader for zone coordinates
and areas from `zone_attributes.csv`. It orders zones by internal centroid node,
checks a stable private regular file, and returns the source byte hash and size.
Identifiers must be integers. Duplicate mappings, missing rows, nonfinite values,
out-of-range longitude or latitude, and negative areas refuse preparation.
The parent helper checks the owned working package before and after reading.

Seven focused tests and the related 60-test transit/package suite pass. Four
fault controls detect reversed order, rounded identifiers, invalid coordinates,
and duplicate centroid nodes; baseline, harmless comment and restored controls
pass. See `prototype/zone-geometry-controls.json` and its verifier.

These fixtures establish ordered reads from an owned mutable package. They do
not establish original producer CSV authority, registered geometry transfer,
child request integration, full native assignment, or scientific acceptance.
The dispatcher remains disabled. Next, bind the shared geometry to general
transit preparation and carry its exact identity into child consumption.


## Parent transit geometry binding, October 8

`managed_assignment_transit_preparer` now freezes the trusted parent setup
mapping and binds preparation to its original writer. Each invocation reads
coordinates from the owned working package, calls general feed preparation with
those coordinates and the parent deadline, and returns the geometry identity
alongside the feed outcome. The child cannot supply coordinates through this
callback. Geometry ownership failures stop before feed preparation.

Four focused tests and 64 related tests pass. Three fault controls detect a
mutable setup mapping, an omitted deadline and substituted longitudes. Baseline,
harmless comment and restored controls pass. Discovery uses a synthetic package
spanning positive and negative coordinates; no external catalog is contacted.
See `prototype/transit-geometry-controls.json`.

This is parent callback integration, not general child-channel integration or
registered geometry transfer. The geometry hash identifies bytes read from the
mutable working package; it does not establish original producer authority.
Complete native assignment, operational recovery, browser and scientific
acceptance remain open. The dispatcher remains disabled.


## General transit channel and retained geometry, October 8

The channel now accepts a parameter-free `prepare_transit` request using the
same one-time parent callback as selected transit. Child coordinates and repeat
requests across either name are refused. The callback registers geometry as a
separate file bundle before returning its reference. The child verifies an
independent copy. Geometry arrays no longer occupy the bounded control frame.

A real child consumes parent geometry after a synthetic catalog no-match.
A lost registration reply prevents child consumption. A 20,000-zone fixture
exceeds the 64 KB control limit as raw JSON, but its file reference fits and its
copied values match. Tampered retained geometry fails verification. The related
suite passes 79 tests. Four parent callback, two file custody, and six channel
fault controls fail their targeted checks; baseline, harmless and restored
controls pass. Reports reside in the prototype directory.

The no-match general child path and the existing selected-feed child skim are
proven separately with mocked database/source transports. General modeled-feed
child consumption using these coordinates is next. Full native assignment,
real registration recovery, original producer geometry authority and scientific
acceptance remain unproved. The dispatcher remains disabled.


## General child transit computation, October 8

`model_transit_execution.consume_and_skim` consumes the parent-confirmed
geometry and feed bundles, applies retained skim settings, and computes against
the retained zone coordinates. The parent response now includes its deadline.
Unavailable outcomes preserve their status and reason without reading a feed.
This helper performs no catalog selection or database operation.

A real reserved child now computes a synthetic operator-feed skim through the
general request. Two confirmed artifact writes precede its response. A lost
geometry-registration reply after successful feed registration prevents child
consumption. No-match and unavailable cases remain separate from modeled output.
The related suite passes 84 tests. Four new numerical-consumer fault controls
catch ignored deadlines, substituted settings, substituted coordinates and false
absence status. The four parent callback controls pass again with their faults
detected. Harmless and restored controls pass.

This demonstrates synthetic transit computation, not full native assignment,
all-origin child acceptance, real database recovery or scientific validity.
No production dispatcher is enabled. Next integrate the consumer with the
assignment mode-choice branch and test retained geometry/feed use there.


## Retained transit joins assignment mode choice, October 8

`stage_assignment` accepts an explicit retained transit preparation record.
When mode choice applies, this path consumes the registered feed and geometry
without rediscovery. It compares the copied geometry against the assignment's
current ordered geometry before computing. The actual mode-choice branch then
uses the resulting skim, status, metadata and log when writing the auto OD file.
An uncertain retained input or mode-choice failure propagates a reconciliation
error instead of silently assigning all person trips to auto.

Three tests execute the actual mode-choice AST branch with a synthetic feed and
real auto OD output. They cover modeled output, changed geometry and corrupt
feed bytes. The related unittest suite passes 87 tests. The separate script
runners pass 51 feed-handoff and 25 discovery checks. Three targeted faults
(ignore geometry identity, erase transit status, swallow custody failure) fail;
baseline, harmless comment and restored controls pass. Pytest is not installed;
these repositories' script runners supplied the separate function checks.

This exercises the assignment branch without native project setup or traffic
assignment. The full reserved child assignment launcher still needs to supply
the retained record. Retained-path numerical exceptions currently stop the
attempt for reconciliation; they do not claim a successful auto-only result.
Dispatcher activation, real recovery, browser and scientific acceptance remain
open. No published claim tier changes.


## Assignment child binding, October 8

A context-bound engine adapter now routes the actual worker run read, stage
progress, project/package paths and output creation through the inherited parent
channel. It checks run, stage and workspace identities, limits stage writes to
progress, checks the returned run identity and rejects a substituted package.
Channel errors become reconciliation failures without direct database or local
output fallback. The binding restores its prior context on exit.

Four focused tests exercise the actual worker adapters with a fake parent
client. The related adapter/channel/transit suite passes 79 tests. Four targeted
faults detect foreign run requests, terminal writes, foreign replies and skipped
parent output creation; baseline, harmless and restored controls pass. See
`prototype/assignment-engine-binding-controls.json`.

This binding is not yet a full assignment launcher. Count preparation must use
a separate child-consumption directory because the parent already owns
`run_output/count_inputs`. Transit requests must enter the retained override
before mode choice. Full native assignment, process containment, real recovery
and scientific acceptance remain open. The dispatcher remains disabled.


## Child count and transit request join, October 8

The bound assignment now requests counts from the parent and verifies them into
`child_count_inputs`, separate from the registered parent count bundle. Child
path/record overrides are refused before requesting inputs. Parent-created
outputs are required. When person-trip mode choice applies, the actual branch
requests parent transit and supplies its returned record to the retained path.
Vehicle-trip assignment does not enter that branch.

Four input-adapter tests plus a bound mode-choice branch test pass. The related
suite passes 91 tests. Four input fault controls, four assignment branch controls
and four existing binding controls detect their targeted faults; harmless and
restored controls pass. Reports record current source hashes.

The parent clients in the new adapter/branch tests are fakes. Earlier real-child
channel cases remain separate evidence. Full native `stage_assignment` with all
adapters together is the next execution boundary; it is not established by this
checkpoint. Dispatcher activation, real interruption recovery, browser review
and scientific acceptance remain open.


## Full native bound assignment, October 8

The complete `stage_assignment` function now runs in a reserved child with all
current parent adapters together. The synthetic fixture uses AequilibraE 1.6.2,
two centroid nodes, one bidirectional link, a 220-person-trip OD matrix and a
scheduled GTFS archive. Project and package working copies pass through the
actual writer preparation methods. Parent callbacks register count, feed and
geometry inputs and confirm progress through the command journal. An audit hook
rejects child network connections. Run reads and database transport are mocked.

Baseline, harmless-comment and restored runs converge in two iterations with
one loaded link. Each writes 20 output files and returns 173 auto, four transit
and 43 active trips. A control that disables mode choice fails the expected
modeled-transit assertion. The report stores worker/helper hashes and output
hashes; native files remain in the evidence directory recorded in
`prototype/native-bound-assignment-controls.json`. The exit receipt explicitly
retains `execution_ready: false`.

The first fixture attempt failed because its predecessor-test read stub did not
provide the active stage row needed for progress. The fixture was corrected to
use its existing ownership row. No production ownership guard was relaxed. The
initial successful run is preserved separately from the controlled runs.

This proves synthetic full-stage integration, not scientific accuracy. The
fixture constructs consumed predecessor inventories directly and mocks parent
transports. Native interruption/recovery, larger networks, calibration, cordons,
long jobs, output publication and normal dispatcher activation remain open.
Full V1 contract and independent scientific acceptance are unchanged.


## Native iteration failure boundaries, October 8

The full native stage fixture now injects two failures during actual solver
iteration progress. A lost database reply yields `DeliveryUnconfirmed` in the
parent and one pending exact command. A lost child acknowledgement occurs after
the parent confirms the write, so it yields `BrokenPipeError` and zero pending
commands. Both children exit with `WorkerStateWriteUnconfirmed`, leave no active
native project and write neither final link volumes nor a successful stage
result. Already-created intermediate matrices remain provisional.

A targeted control removes the progress handler's fatal exception propagation.
The native solver then continues despite the uncertain write, and the proof
fails its stop assertion. The missing-mode-choice control also remains detected.
Baseline, harmless and restored runs again converge with identical synthetic
mode totals. The seven-case report is
`prototype/native-bound-assignment-controls.json`; individual failure reports
preserve the distinction between pending database delivery and lost child reply.

These are mocked transport failures in a real small native assignment. The
pending command is copied as evidence before fixture cleanup, not replayed. No
restart recovery, supervisor loss, escaped descendants, larger-network behavior,
calibration, cordons or scientific accuracy is established. Output publication
and dispatcher activation remain open.


## Fresh-process replay after native failure, October 8

Each full-stage native failure fixture now snapshots its actual SQLite command
journal before cleanup. A separate Python process reads that snapshot and calls
the existing recovery adapter with the saved request ID. It verifies the exact
original RPC arguments and unchanged command inventory. A pending iteration
write sends once and retains the checked receipt; a second recovery uses that
receipt without sending. The lost-child-acknowledgement case sends zero times
because the parent had already retained its receipt.

A wrong-attempt receipt is refused and leaves the pending command unresolved.
A foreign deployment is refused before transport. The recovery process imports
neither the worker nor AequilibraE, and final assignment outputs remain absent.
The full seven-case native control suite passes again, including missing mode
choice and swallowed progress faults. Six existing command recovery tests pass.
Reports include the replay verifier hash and each saved request hash.

The replay uses real native-failure journal snapshots with mocked RPC responses.
It does not test live database idempotency or resume a model. Ownership after
replay, interrupted computation recovery, supervisor loss, output publication,
scientific acceptance and normal dispatcher activation remain open.


## Full native assignment with installed commands, October 8

The native fixture now also runs with actual fresh claims, ownership/run reads,
artifact registrations and progress writes through isolated PostgREST. It clones
the previously owned `prepared-artifact-upgrade-v1` test database, after checking
that migrations 20 and 21 are installed and no source sessions are active. Each
case uses its own clone and loopback gateway limited to 128 MB and half a CPU.
The preview database is not a write target. No schema changes are made.

Baseline, harmless-comment and restored cases converge with modeled transit and
all five expected input artifact types present in the database. The native stage
produces its 20 local output files but remains running in the database; output
publication and completion are not authorized by this test. A fault that skips
geometry registration still completes native computation, but fails the database
inventory check. Gateways close at the end of each case; cloned databases and
private evidence remain identified in the control report.

The proof directly constructs synthetic predecessor inventories. It does not
establish real predecessor selection in this joined test, lost-commit replay,
final publication, model restart, larger-network behavior or scientific accuracy.
Next join the native iteration-disconnect case to installed-command replay.
Normal dispatcher activation and full V1 acceptance remain open.

## Native iteration reply loss with installed SQL, October 8

The full native assignment fixture now joins iteration failure to the installed
command schema. Its HTTP bridge forwards the progress write to PostgREST, waits
for success, then closes the connection before returning the reply. The parent
reports `DeliveryUnconfirmed`. The child exits with
`WorkerStateWriteUnconfirmed`, closes its active native project, and produces
neither the final assignment result nor `link_volumes.csv`.

The test backs up the unresolved SQLite journal and starts the actual recovery
CLI in a fresh process. Recovery sends the original request ID and identical
HTTP payload. PostgreSQL returns its existing receipt. Complete run, stage,
attempt and artifact rows, execution-start count and the selected receipt remain
identical before and after recovery. There is one attempt and one execution
start. A second fresh recovery uses the retained journal receipt without making
an HTTP call. Both CLI responses explicitly report `model_resumed: false`.

`prototype/native-http-replay-controls.json` records baseline, harmless-comment,
missing-disconnect and restored cases. The missing disconnect reaches the
expected failure, `Native interruption did not stop both sides`. The other
three cases retain the committed receipt without changing database state and
leave final assignment outputs absent. Each case uses an identified disposable
database cloned from the owned installed-schema fixture. The preview database
is not a write target. Temporary PostgREST gateways close after each case.

This supersedes the preceding live proof's missing lost-commit join. It does not
establish model continuation, supervisor recovery, escaped-process containment,
final output publication, realistic network performance or scientific validity.
The original journal remains pending; recovery uses a backup to preserve the
failure evidence. The command receipt alone grants no authority to resume the
model. Normal dispatcher activation, browser acceptance and full V1 acceptance
remain open.

The seven existing native assignment controls also pass after adding the live
replay hook, including lost child acknowledgement and swallowed progress faults.
The product-direction check passes with its existing dated review reminders;
this bounded evidence update does not renew those reviews.

## Owned scope feasibility before output capture, October 8

A real detached descendant confirms why the existing process-group exit receipt
cannot authorize completed-output capture. The leader exits and its original
group empties while the owned Linux scope remains populated. The current receipt
correctly retains `execution_ready: false`. A uniquely named user scope also
preserves the inherited progress channel. Its configured test memory and task
limits are observed, and it disappears after the descendant exits.

Four controls pass, including a process-group-only fault detected while the
separate-session descendant remains alive. The experiment uses mocked database
transport and disposable children with independent deadlines. No unrelated unit
is stopped. `ENGINE_CHILD_PROTOCOL.md` records the selected next adapter boundary
and the remaining startup, identity, cancellation and parent-loss requirements.
This is evidence for implementation, not completed supervision or output capture.

## Scoped native launch with retained identity, October 8

The optional production scope adapter now keeps the engine behind a startup
socket until its parent verifies and retains the scope identity and resource
limits. Scoped exit checks refuse detached descendants and identity replacement.
An observed systemd removal race is retryable. The engine cannot run when the
scope record fails to persist. Normal dispatch remains unchanged and disabled
for this managed foundation.

The related engine suite passes 73 tests. Six startup controls detect premature
execution and bypassed scope checks. Four native controls exercise the full
synthetic assignment: baseline, harmless and restored cases converge with modeled
transit and 20 output artifacts. Missing supervision fails despite successful
computation. Native scoped tests use mocked parent database transport; the earlier
installed-command evidence remains separate. No combined live-database scoped
claim is made. Product direction passes with its existing dated reminders.

Retained receipts remain `execution_ready: false`. Cancellation, parent-loss
recovery, production policy, completed publication, human/browser acceptance and
nationwide scientific acceptance are not established by these tests.

## Scoped native assignment with installed commands, October 8

The scoped engine now passes the same full synthetic assignment against actual
installed claims, ownership reads, artifact registration and progress writes in
isolated cloned databases. Scope startup records and empty-scope observations
match unit, invocation, cgroup directory identity and bootstrap PID. Baseline and
harmless cases converge with modeled transit; the database stage remains running
because this test does not publish or complete it.

In the combined failure cases, the bridge drops a progress reply after PostgreSQL
commits it. The native child stops before final assignment outputs, and the writer
stays stopped. A fresh recovery process replays the original request from the
journal backup without changing the committed database state. The next recovery
sends nothing. The original scope is empty after interruption and recovery; this
observation does not reopen the writer or authorize model continuation.

Six controls pass: baseline, harmless, lost reply, harmless lost reply, omitted
scope and restored lost reply. The omitted scope still allows the underlying
native failure and receipt recovery to run, but fails `Live native scope
supervision missing`. `prototype/scoped-http-controls.json` identifies the six
owned databases and private evidence. Temporary PostgREST gateways close after
each case. Source hashes and scope identities are retained in the joined reports.

This closes the preceding separation between scoped execution and installed
command tests. It does not establish cancellation, parent-loss recovery, final
output publication, normal dispatch, realistic network performance or scientific
acceptance. No preview database, holdout or acceptance tolerance changes.

## Retained local scope cancellation, October 8

The scoped handle now verifies its original invocation and cgroup directory,
retains a cancellation intent, then sends SIGKILL through the pinned cgroup file.
A separate local receipt records observed termination only after the leader exits
and the scope empties. The database status remains unchanged, the writer stays
stopped and outputs remain unauthorized. A stopped writer may still stop its own
scope; an unscoped handle, foreign thread or already observed exit cannot cancel.

Ten cancellation tests and the broader 83-test engine suite pass. Twelve fault
controls prove the checks detect omitted/early signaling, changed ownership,
uncertain resend and unsupported lifecycle calls. The detached-child test uses
an actual separate session after leader exit. Database transport is mocked, and
all signaled processes belong to disposable test scopes.

This adds local cancellation machinery, not the full cancellation workflow.
Native-solver interruption, lost-receipt reconciliation, parent-loss recovery,
database status decisions, UI behavior and normal dispatch remain unverified.

## Native solver cancellation with installed SQL, October 8

The full synthetic assignment now exercises the production cancellation helper
while the native solver waits for acknowledgement of a confirmed iteration.
The parent snapshots the installed database state, retains cancellation intent,
signals the verified owned scope and observes termination. The writer stays
stopped. The final assignment result and `link_volumes.csv` do not exist, and the
scope is empty. No pending database command remains because the iteration write
was confirmed before cancellation.

Complete run, stage, attempt, artifact and KPI rows and the execution-start count
remain unchanged from the pre-cancellation snapshot. There is one attempt and
one execution start. The stage remains running; local termination evidence does
not substitute for a database cancellation decision or success publication.
Partial files are not authorized for reuse, and SIGKILL provides no graceful
native checkpoint claim.

Six controls pass: native cancellation, harmless cancellation, omitted
cancellation, restored cancellation, normal assignment and committed-reply
recovery. Omitting cancellation lets the native computation finish but fails
`Native cancellation did not stop engine`. Normal assignment still converges,
and receipt recovery still sends once then uses its retained receipt. See
`prototype/native-cancellation-controls.json` for all six isolated databases,
source hashes and private evidence locations.

This closes the preceding missing native-solver cancellation test. Fresh-process
cancellation reconciliation, parent-loss recovery, database/UI cancellation
semantics, completed output publication, scientific acceptance and normal
dispatch remain open. The preview database and holdouts are unchanged.

## Read-only inspection after uncertain cancellation, October 8

A fresh CLI now checks retained claim/admission and attempt ownership before
reading launch, scope and cancellation custody. New scopes retain boot and user
identity. The reader refuses conflicting identities and malformed records,
reports another boot as unassessed, and distinguishes absent startup evidence
from an observed absent scope.

The lost-receipt case retains cancellation intent but no signal receipt. Fresh
inspection observes that the scope is absent, leaves termination cause
unconfirmed and preserves the original records. Repeating inspection changes
nothing and never signals or resumes the engine. This is an observation for
reconciliation, not a persisted reconciliation decision or database status change.

The full related suite passes 97 tests. Seventeen controls detect unsafe
substitutions and attempted side effects. Tests use real disposable scopes,
actual retained SQLite admissions and mocked database transport. Native/installed
claim inspection, durable parent-loss reconciliation, database/UI decisions and
normal dispatch remain open. Older records lack boot evidence and are refused
rather than silently treated as current-host records.

## Fresh inspection of native cancellation custody, October 8

The fresh-process inspector now reads the actual native assignment's installed
claim, SQLite admission, workspace marker and scope/cancellation records. The
combined test deliberately loses the local signal receipt after the kernel signal
write. The native child terminates and the scope empties, but the missing receipt
remains missing. Two fresh inspections report scope absence with an unconfirmed
termination cause and no continuation authority.

Inspection preserves every retained engine JSON record and the full command
inventory. It makes no HTTP calls, changes no installed database rows and leaves
final assignment outputs absent. No service-role key is supplied to the inspector.
The confirmed-cancellation case separately verifies that the reader recognizes
both retained signal and observed-termination records without rewriting them.

Five native controls pass: lost receipt, harmless lost receipt, omitted receipt
loss, restored lost receipt and confirmed cancellation. Omitting receipt loss
fails `Native cancellation receipt loss was not preserved`. The source hashes,
private evidence and five owned database identities are retained in
`prototype/native-inspection-controls.json`. The independent inspection suite
now has 18 passing controls, including an attempted mutating systemd command that
the fresh-process audit rejects before execution.

This closes the missing native/installed-claim inspection join. It remains a
read-only observation, not a durable reconciliation decision, recovered writer,
database cancellation decision, restart or parent-loss workflow. Model restart,
UI recovery, output publication and scientific acceptance remain open.

## Actual native supervisor loss, October 8

The fixture now runs the supervising worker in a separate owned process while
keeping the installed database gateway in the outer test process. At a confirmed
native iteration, the supervisor withholds its acknowledgement and records a
readiness marker. The outer process sends SIGKILL only to that supervisor's live
process handle. The native child detects the lost channel, raises
`WorkerStateWriteUnconfirmed`, closes its active project and exits. Its scope
empties, and final assignment outputs are absent.

No cancellation or successful-exit receipt is fabricated after parent loss.
Fresh read-only inspections observe scope absence with all cancellation flags
false and no continuation authority. The installed run, stage, attempt, artifact
and KPI rows, execution-start count and retained command inventory remain
unchanged. The stage remains running pending an actual reconciliation decision.
The outer owner closes the temporary PostgREST gateway after each case.

Five controls pass in `prototype/native-parent-loss-controls.json`: baseline,
harmless, omitted supervisor loss, swallowed channel-loss failure and restored.
The no-loss case completes native assignment and then fails the required-parent-
loss assertion. The swallowed-error case produces final local files and fails the
output-absence assertion. Those local files are not database publication or stage
success evidence. Baseline, harmless and restored cases stop before those files.

This is one actual process-loss boundary, not general liveness monitoring during
an arbitrary native computation. Parent loss before admission/startup, other
interruption points, durable reconciliation, restart, UI decisions and full M3/V1
acceptance remain open. Product direction passes with existing dated reminders.
PR #170's GitHub checks pass; its visual acceptance remains open because T3 page
capture still fails after reopening the preview. No alternative browser is used.

### October 8: supervisor loss around startup custody

The installed-command proof now kills its owned supervisor at two additional
boundaries: after scope verification but before saving `scope-started.json`, and
after saving that record but before authorizing the bootstrap. The actual
production bootstrap gates the same native assignment command used by the
iteration-loss proof. A marker at the first engine statement remains absent in
both cases. Neither the native failure handler nor final output creation runs.
The original scope empties without a fabricated cancellation or exit receipt.

Before the startup record exists, a fresh inspection reports
`scope_startup_unconfirmed` and does not claim to know whether the scope is live.
After the record exists, it observes scope absence. Both inspections run twice,
retain identical local records and command inventories, and leave installed run,
stage, attempt, artifact, KPI and execution-start state unchanged. The stage
remains running. Only the two prepared working-copy artifacts exist at startup;
count, transit and assignment geometry registration have not run.

The outer test owner retains the verified scope identity to observe cleanup.
That fixture knowledge does not become recovery authority for a fresh process.
An early-authorization fault explicitly waits for the engine marker before
killing the supervisor. The output-absence proof rejects that fault at the engine
entry assertion, even when no completed assignment outputs exist. The harmless
comment and restored controls exercise the same startup path.

Evidence: `prototype/native-startup-loss-controls.json`. These startup cases do
not establish recovery before claim admission, supervisor loss during arbitrary
computation, durable reconciliation, model restart, ActivitySim supervision,
normal managed dispatch, browser decisions or scientific acceptance. The prior
iteration-loss controls remain a separate regression check. No production worker
behavior or scientific claim changes in this checkpoint.

The final startup suite passes all five controls. The five existing iteration-
loss controls also pass after the shared supervisor and HTTP proof changes,
including omitted loss and swallowed channel-loss faults. `git diff --check`
passes. GitHub restore-drill run 37869706360 remains in progress for the preceding
checkpoint; this local result does not declare that run or the next commit green.

### October 8: timestamp-only reaping cannot revoke started computation

Recovery inspection found that the installed reaper could fail a managed attempt
using only parent and stage timestamps. The earlier prototype intentionally
verified revocation by that path. It did not establish that an old timestamp
means the engine is dead. That behavior conflicts with healthy long computation
and is superseded by migration
`20261016000022_model_reaper_recovery_boundary.sql`.

The reaper still locks the parent and stages and checks for newer progress. It
now returns false for a running parent, attempt-managed work, a retained execution
start, or a stage that is no longer queued. Only unstarted queued work remains
eligible for automatic timeout. Protected runs, stages, attempts and start records
remain byte-equivalent at the JSON row boundary. The caller records no successful
reap when the RPC returns false. No model success, failure, cancellation or
continuation is inferred from missing progress.

`prototype/reaper-recovery-boundary.json` records four installed-SQL controls:
baseline, harmless comment, restored unsafe function and restored correction.
The unsafe function fails the managed-attempt preservation assertion. Positive
cases cover a managed claim, unmanaged running work, a queued parent with a
started stage and an unstarted queue timeout. Calls use the service role; public
roles remain excluded. Installing each function leaves the pre-existing fixture's
execution rows unchanged. Synthetic cases roll back, and the corrected function
remains installed only in the owned proof clone. The preview database is unchanged.

All 14 existing reaper, cron-route and migration unit tests pass; they cover
caller behavior and historical migration structure, not this new database rule.
The separate installed-SQL proof covers the rule. Migration inventory passes with
394 files. This does not run a 45-minute model: a future cutoff exercises the
predicate without waiting or altering a managed timestamp. Explicit durable
reconciliation and restart remain unfinished. A genuinely lost started worker
will therefore retain its nonterminal state pending recovery rather than being
misreported as a proven failure. The operator/browser recovery workflow remains
open, and managed dispatch stays disabled.

### October 8: explicit abandonment decision prototype

`prototype/recovery-decision.sql` adds an isolated database prototype for an
owner or administrator to abandon a run after reviewing its exact current state.
This is a decision to stop accepting execution writes, not a claim that an OS
process terminated. The response and retained receipt explicitly leave process
termination, reported-evidence verification, restart and continuation unconfirmed
or unauthorized. The database uses `cancelled` for the operator's decision; a
future UI must expose that distinction rather than presenting physical shutdown
as verified.

The inspection command returns a jointly locked parent/stage version. The write
command locks the same rows, checks current workspace authority and compares the
whole reviewed state before changing anything. A changed observation requires a
new review. Request identity binds workspace, run, actor, reason, reviewed state
and reported evidence. Exact retries return the first receipt; changed payloads
refuse. Receipt rows retain prior run, stage and attempt records and reject
updates or deletion. Raw reported evidence is private and explicitly unverified.

Abandonment clears active attempt references, records revocation and cancels
unfinished stages in the same transaction as the receipt. It preserves completed
stage content and existing KPI records. Existing attempt commands reject new
completion and KPI writes from the abandoned worker. A failed receipt insert
rolls back the lifecycle changes and revocations. This is compatible with
retaining files and execution history; it neither deletes them nor grants a
new execution start.

Seven controls pass in `prototype/recovery-decision-controls.json`: baseline,
harmless comment, omitted authority, omitted state check, omitted receipt,
omitted revocation and restored. Each adverse case fails its targeted assertion.
A separate committed progress write between inspection and decision invalidates
the original state and leaves no recovery receipt or lifecycle change. The SQL
proof also checks cross-workspace refusal, immutable receipts, exact replay,
completed-stage/output preservation and no leaked write context.

The first fixture attempted to demote a sole owner and hit the installed owner
floor. That was a fixture failure, not acceptance evidence. The corrected fixture
creates a separate synthetic member and leaves existing owners unchanged. All
proof work uses an owned database clone; no production migration, application
route, worker dispatcher or preview database changes here.

Remaining integration work includes retained client requests and uncertain HTTP
reply recovery, authenticated route actor derivation, exact agent approval or
refusal, visible operator decisions and downloads, process cancellation joins,
concurrency races, cross-host recovery and safe restart. A trusted service-role
caller supplies the actor to this prototype. An application route must derive it
from authenticated identity and never trust a client-supplied actor. The broader
M3, ActivitySim and scientific requirements remain open.

### October 8: retained abandonment requests and lost HTTP replies

The shared command client now accepts an explicitly prepared abandonment request.
It validates workspace, run and actor identities, exact reviewed parent/stage
fields, observation timestamps, a nonempty reason and bounded reported evidence.
The existing journal commits the complete request before transport. The SQL
prototype now echoes the complete request payload in its receipt. The client
compares that payload and all outcome fields, refusing changed reasons, evidence,
reviewed state or invented process-termination, evidence-verification or restart
claims. This does not derive actor identity or create operator authorization.

`prototype/recovery-http-controls.json` records four controls through an owned
PostgREST gateway: baseline, harmless fresh-process comment, omitted disconnect
and restored. The bridge forwards the real command, observes PostgreSQL's success
response and closes the connection before returning it to the client. The decision
commits once while the local request remains pending. A fresh instance of the
existing recovery CLI sends the same body, retains the checked original receipt
and leaves installed run, stage, attempt, execution-start and decision rows
unchanged. A second fresh CLI process sends no HTTP request. Both request bodies
have the same SHA-256. The omitted-disconnect fault fails the loss assertion.
An audit hook refuses subprocess launch and connections to another destination
inside the fresh recovery processes.

The related command suites pass 69 tests. Five copied-module controls detect
missing reason validation and omitted receipt matching, with harmless and restored
passes. The seven installed SQL controls rerun against the echoed-request version.
Evidence is in `prototype/recovery-command-controls.json` and
`prototype/recovery-decision-controls.json`. Source hashes match the tested files.
The initial broad run exposed a copied-fixture import dependency; the new helper
is now imported only for this operation. The first new mutation assertion also
expected an exception intentionally wrapped by transport; its corrected assertion
checks whether invalid input reached transport. Neither failed run counted as a
pass. The original command mutation suite now passes unchanged.

This remains an execution-recovery foundation. The SQL command is still a
prototype, without a production migration, authenticated application route,
operator UI or agent approval connection. Tests use an explicit synthetic
operator and private service credential; credentials are not retained in the
journal or evidence reports. Physical termination, safe restart, cross-host
recovery, ActivitySim supervision and scientific acceptance remain separate.

### October 8: installed recovery command and authenticated route

Migration `20261016000023_model_recovery_decisions.sql` now installs the tested
recovery command. The mirrored SQL proof source must match the migration exactly.
Its reviewed state includes `model_id`; the route and database therefore bind
that relationship as well as workspace, run, parent/stage versions and attempts.
The populated-clone proof applies migrations 22 and 23 and confirms unchanged
pre-existing run, stage, attempt, KPI, artifact and execution-start row digests.
It then reruns the seven decision controls and four HTTP recovery controls. No
application or preview database is upgraded by this proof.

`GET /api/models/[modelId]/runs/[modelRunId]/recovery` authenticates the session,
checks model write access and owner/admin membership, and reads the exact scoped
worker run before creating a privileged client. It returns a checked inspection
without process-termination or continuation authority. `POST` takes an explicit
abandonment decision, reviewed state, reason, evidence and retained request ID.
The actor comes from the authenticated session; the workspace comes from the
model. Unknown body fields, including supplied actor/workspace identifiers,
refuse. Canonical request UUIDs prevent an accepted uppercase UUID from becoming
an unrecoverable receipt mismatch after PostgreSQL normalization.

The route refuses explicit Planner Agent execution or approval headers. No
registered action currently authorizes recovery, and launch approval cannot be
borrowed for this decision. This is an executable refusal, not agent approval
support. Manual decisions still receive current SQL membership and state checks.
A changed review returns conflict. An uncertain transport or mismatched receipt
returns `recovery_unconfirmed` and directs the caller to reuse the saved request;
it never reports that no write occurred. Responses do not expose private database
errors, and successful inspection/receipt responses disable caching.

The route suite passes 23 tests with exact run projections and filters asserted.
Seven route controls detect omitted owner/admin checks, agent refusal, model
scope and receipt matching, with harmless and restored passes. The command
validator's five controls and installed SQL/HTTP controls pass with model-bound
state. Targeted ESLint, focused TypeScript checking of the changed route/helper/
test and their imports, and the 395-file migration inventory pass.

Full-project TypeScript checking remains unverified: the 2 GB heap run exited
134, and a separate 4 GB heap run inside a 5 GB scope also exhausted its heap.
The second run disabled core dumps. Neither failure counts as a pass; the focused
check does not replace full-project release validation. The previous private
preview remains unchanged. Real session-cookie journeys, operator controls,
saved browser requests, actual T3 rendering and downloadable decisions remain
open. Process termination, model restart, ActivitySim supervision and scientific
acceptance are still separate requirements. Normal managed dispatch remains off.

### October 8: retained browser recovery decisions

The model run page now supplies the authenticated user and scoped owner/admin
permission to a recovery panel. Membership reads select and check workspace,
user and role; failed reads remain unavailable. Worker run records retain the
panel after becoming terminal so a lost abandonment reply can still be recovered.
The operator reviews the exact current state, provides a reason and acknowledges
that abandonment does not establish process termination or authorize restart.

Before POST, the browser saves a versioned request under its account, workspace,
model and run. Reload and retry use that original decision. Storage failures
prevent a new send; conflicting or unreadable copies remain intact. Exact
receipts are retained with the decision and can be downloaded as JSON. Conflicts
require a new review. This implementation does not yet import or repair unreadable
copies, so that self-service boundary remains open.

GET and POST require expected-user and expected-workspace headers matching the
current authenticated session. POST also requires the same browser origin. A
session switch therefore cannot silently attribute a saved decision to another
operator. These browser checks supplement current route and SQL authorization.
The UI's review and saved-copy state are also scoped to the current account/run.

Four focused suites pass 50 tests. They include real component event handlers,
remount/retry and downloaded JSON, plus mocked page permission reads with exact
projections and filters. Focused TypeScript checks the recovery helper, route,
component and their tests/imports; targeted ESLint passes. The focused type check
includes the test setup's DOM matcher declarations. It does not establish a
whole-project type check or production build.

The browser and route mutation reports record harmless survivors and deliberate
fault detection. An initial expanded browser-control run detected the omitted
permission projection, but its report matcher expected the wrong assertion text.
That run did not count as a passing control report. The runner now checks the
actual projection assertion. Mutations restore original source bytes in finally
blocks; no served checkout or preview database is changed.

T3 opens both the existing tab and a fresh tab and reads the OpenPlan landing
page, but reports the panel hidden and fails snapshots. The frozen preview is an
older build. No desktop/390px rendering, real session-cookie recovery journey,
keyboard/screen-reader acceptance or practitioner observation is claimed here.
Normal managed dispatch remains off. Physical termination, restart, ActivitySim
supervision and independent scientific acceptance remain open.
