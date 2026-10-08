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
