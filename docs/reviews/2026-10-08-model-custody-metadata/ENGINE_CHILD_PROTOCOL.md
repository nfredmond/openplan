# Engine child protocol decision

Date: 2026-10-08. Inspected implementation: bc753e52.
Status: implementation decision; protocol not connected or accepted.

This develops M3 attempt ownership and recovery within the current roadmap. It
changes no scientific acceptance rule, geography scope or v1 requirement.
`product:direction:check` passes with existing expired-registry and intervening
change reminders. This document does not reset those reviews or create a queue.

## What the current code requires

The subprocess helper proves a launch reservation and observed exit, not a
complete assignment boundary. `main.stage_assignment` still needs the following
operations after the managed predecessor copies have been prepared:

| Operation | Current implementation | Required owner |
| --- | --- | --- |
| Project and package paths | `project_work_directory`, `package_work_directory` consult the bound writer | Parent verifies identities; child receives the declared paths |
| Fresh output directory | `create_assignment_output_directory` calls the writer's exclusive creation method | Parent reserves it once |
| Run configuration | `sb_get_run` performs a direct service-role read | Parent validates same run/workspace and returns the necessary fields |
| Count acquisition | `auto_ingest_counts` starts `build_expanded_aadt_counts.py` with a timeout | Supervised preparation, before count manifest confirmation |
| Count retention | `retain_assignment_counts` copies files and registers `model_count_inputs` through the writer | Parent confirms the manifest before engine computation |
| Progress | `sb_patch_stage` calls `writer.patch_stage`; uncertain writes must propagate | Parent performs the retained command; child waits for its acknowledgement |
| Numerical assignment and diagnostics | AequilibraE project, graphs, matrices, calibration and select-link calculations | Child operates on the declared working copies |
| Result and completed files | Current function returns a dictionary and writes output files | Parent may inspect only after confirmed child termination and file checks |

This table follows direct calls and the count-acquisition/retention helpers. It
is not a complete transitive inventory of every optional provider or library
side effect. That inventory remains necessary before claiming a no-egress or
sandboxed engine profile.

Two source facts rule out shortcut designs. `AttemptWriter` belongs to one
invocation thread and checks its command journal; a background thread must not
receive an unfenced substitute. Importing `main` loads local dotenv files, so
merely deleting credentials from a subprocess environment does not establish
credential isolation. `auto_ingest_counts` also starts another process; observing
only the engine leader's PID is insufficient for completed-file capture.

## Selected implementation boundary

Keep the single authoritative managed writer in the parent invocation. Use one
private, inherited live channel for the admitted child. Do not implement a
saved-request CLI that can reconstruct computation from an exit or claim receipt.
The launch reservation precedes process creation, and a lost parent or broken
channel leaves the attempt requiring reconciliation.

The first channel implementation must permit only assignment-specific operations:
read the claimed run configuration, resolve the already confirmed paths, request
count preparation, and append stage progress. The parent derives run, workspace,
stage and attempt from its bound context, not from identifiers supplied by the
child. It must reject arbitrary table names, URLs, SQL, filesystem paths and
terminal-state updates. Each message needs a bounded frame, protocol version,
monotonic sequence and one matching response. EOF, malformed data, duplicate or
out-of-order messages stop execution. Error responses must not include credentials
or provider response bodies.

Parent processing stays on the writer's owning thread. Engine callbacks wait for
a confirmed response before continuing. The parent stops accepting later child
requests after uncertain delivery. Receipt recovery remains the existing command
recovery operation and never reopens computation. A result message is provisional:
it cannot mark the stage succeeded, register completed output or bypass pending
commands and ownership checks.

Extract the engine entrypoint so it does not load operator dotenv files or call
legacy database transports. Pass explicit resolved numerical settings and retained
inputs. Preserve original source metadata, source availability distinctions,
calibration opt-in, separate demand methods and the same network/settings evidence.
Do not silently disable count acquisition, optional calibration or the ActivitySim
assignment to make the child easier to run.

A private channel is not an operating-system sandbox against same-user code.
Before completed capture, the supervisor also needs an owned containment boundary
covering descendants, including count-fetch processes. A child that creates a new
session must not escape the completion check. The existing process-group probe
cannot establish that. Evaluate the existing Linux service/cgroup supervision
patterns; require explicit owned handles and avoid terminating unrelated work.

## Required evidence before dispatch activation

Use a real child and parent handler to demonstrate ordered requests, exact context,
normal progress, response loss, malformed frames, replay refusal and parent loss.
A database write committed before response loss must retain its command and receipt
recovery path, without a second computation or contradictory terminal write.

Then exercise the actual assignment entrypoint with the channel, retained inputs,
a native synthetic network and separate-process output reopen. Confirm that a
provisional result followed by failed exit cannot publish success. Test surviving
and detached descendants, engine interruption, changed working paths, changed
output bytes and supervisor restart using owned disposable processes.

Finally run setup, assignment, artifact extraction and the separate ActivitySim
handoff against the isolated native stack. Verify both normal dispatch entrypoints,
restart/cancel, long-running liveness and retained local-byte recovery. These checks
remain distinct from untouched scientific acceptance and planner/public-participant
acceptance. No existing green helper test closes those requirements.

## Extraction audit at 145935596

The static symbol inventory in `prototype/assignment-dependencies.json` records
45 reachable functions in `main.py`, including the 849-line assignment function.
The accompanying script parses source without importing `main`, so it does not
load operator configuration. It follows referenced module-level functions through
nested scopes. It includes optional branches and overapproximates actual calls;
it does not inspect imported library internals or establish runtime containment.
The JSON records the exact source hash and line locations for review.

The inventory and direct source inspection change the extraction sequence.
Preparing counts alone does not remove credentialed operations from assignment.
The selected transit-feed branch reaches `resolve_selected_feed_version`,
`download_selected_feed_bytes` and `_feed_version_agency_name`. These read the
workspace feed version, private stored archive and display metadata using parent
credentials. The current run reader and progress adapter also reach legacy HTTP
when unbound. `auto_ingest_counts` starts a subprocess. Imported `gtfs_skim` reads
operator settings, discovers feeds, downloads archives and writes a shared cache.
These operations must not become implicit side effects of importing or invoking
the engine child.

Separate transit preparation from the numerical skim before extracting the full
assignment body. The parent must retain the selected archive bytes and original
version metadata, preserving checksum verification and workspace ownership.
The child should parse those retained bytes and compute the skim from explicit
settings. Keep the existing precedence of a run's chosen feed over operator and
catalog choices. Preserve the distinctions among catalog failure, no covering
feed, selected-feed failure, schedule expiry and modeled service. An unavailable
chosen feed must not trigger substitution. Preserve ingest-authoritative service
windows and the disclosure of excluded frequency-based trips. Parent-side
acquisition also needs an owned deadline and descendant boundary; relocating a
call does not establish those properties.

The existing public-row allowance and private-storage ownership rule have a
boundary worth retaining explicitly: a version with no workspace can pass the
row resolver, but its archive cannot pass the workspace-prefix download rule.
This audit does not broaden either permission or claim such a version is usable.
A representative public-feed journey remains necessary before making that claim.

Resolve numerical settings explicitly across process boundaries, including core
count, transit access/fare/walk and budget settings, passthrough share, assignment
profile, network settings and calibration controls. Do not inherit scientific
settings accidentally through a different process environment. This extends the
implementation detail of the existing extraction decision; it creates no new
product queue and changes no v1 scope or scientific acceptance requirement.

## Detached-descendant scope experiment, October 8

The live Linux experiment at worker revision `d687969da` uses the existing
`EngineProcess` launch and inherited progress channel inside a uniquely named
user scope. A descendant calls `setsid` and remains alive after the leader exits.
The original process group is empty, so the current helper can record its limited
exit receipt. That receipt still has `execution_ready: false`. The owned scope
remains active with `cgroup.events` reporting `populated 1`. Leader and descendant
report the same cgroup, and the descendant reports its own session and group.
The scope disappears after the descendant exits. The probe limits memory to
128 MiB and tasks to 16; those are test limits, not selected model defaults.

The inherited file descriptor remains usable through `systemd-run --user --scope`.
This makes an owned scope a feasible Linux backend for the existing channel.
Baseline, harmless-comment and restored cases pass. Replacing the population
check with the original process-group check fails at the intended assertion.
See `prototype/engine-descendant-scope-controls.json`. Initial fixture setup used an obsolete
predecessor-read stub and failed ownership validation before engine work; restoring
the current invocation read stub allowed the actual scope experiment to proceed.

Kernel documentation defines cgroup inheritance and the recursive `populated`
field. It also permits process migration. Therefore, this experiment establishes
detection of `setsid` descendants, not a sandbox against same-user migration or
privileged code. Source: [Linux cgroup v2 documentation](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html),
“Processes” and “[Un]populated Notification,” checked October 8, 2026.

The production adapter must hold the engine behind a startup acknowledgement
until the parent records the generated scope name, invocation identity, cgroup
identity and resource policy in the owned launch reservation. The actual engine
must not run before that record. Reconciliation must use those identities rather
than a saved PID or an unverified unit name. Completion must inspect the owned
scope, detect replacement, reject live descendants and retain a failed or
uncertain scope outcome. Cancellation may target only that verified owned scope.
Parent failure must not imply model success or authorize a second execution.
Unsupported hosts must expose the missing supervision capability explicitly.

Scope startup fencing, durable identity capture, cancellation, parent-loss
recovery, policy selection, model-native integration and output publication remain
unimplemented. This experiment changes no dispatch or completion authorization.

## Scope startup adapter, October 8

`EngineProcess` now accepts explicit `ScopeLimits` for an optional Linux user
scope. No default model resource limits or dispatch policy are selected. Hosts
without the required systemd tools and cgroup v2 receive an explicit unavailable
error when scoped execution is requested.

A separate inherited startup socket holds a standard-library bootstrap before
engine execution. The parent verifies the bootstrap PID and kernel membership,
unit invocation, cgroup directory identity and configured memory/task limits.
It writes and fsyncs `scope-started.json` under the pinned attempt directory, then
releases the bootstrap to execute the engine. Failure to retain that record
closes the gate and stops the writer. The existing progress descriptor survives
the bootstrap's exec. No raw arguments, environment or credentials enter the
scope record.

Exit observation verifies the owned scope identity and refuses live descendants.
A scope directory removed between the systemd query and filesystem read produces
a retryable observation, not success or a stopped writer. A changed identity or
unconfirmed scope query stops the writer. Scoped receipts still declare
`execution_ready: false`. An observed empty scope does not register completed
outputs or establish scientific acceptance.

Eight focused tests cover startup ordering, inherited progress, detached children,
record failure, identity replacement, the removal race, nonzero exit and policy
availability/validation. The complete related engine suite passes 73 tests. Six
startup controls include harmless and restored cases and detect early release,
ignored population and ignored identity. Four full native controls run the actual
small assignment through this adapter; baseline, harmless and restored runs
converge with modeled transit and 20 local artifacts. Omitting the scope still
computes, but fails its evidence check. Parent database transport is mocked in
these scoped native cases. Reports are `prototype/scope-startup-controls.json`
and `prototype/native-scoped-controls.json`.

This supersedes the preceding experiment's missing startup gate and durable
identity capture. Parent-loss recovery, verified scope cancellation, hostile
cgroup migration, production resource policy, live-database scoped integration,
completed output publication and normal dispatch activation remain open.

## Installed-command scope join, October 8

`prototype/scoped-http-controls.json` now joins the production scope adapter,
full native synthetic assignment and actual installed SQL through isolated
PostgREST. It verifies successful assignment and committed-progress reply loss,
including fresh-process exact receipt recovery, unchanged database state, no
model resumption and an empty original scope. The six controls detect omitted
supervision even when native execution and receipt recovery otherwise work.
This supersedes the preceding missing live-database scope join. Cancellation,
parent-loss reconciliation, final publication and normal dispatch remain open.

## Live owned-scope cancellation, October 8

`EngineProcess.cancel()` now operates only on its live, scoped handle and original
invocation thread. It can stop processes after the writer has stopped, without
restoring database write authority. Unscoped handles and already recorded engine
exits are refused. No saved PID or unit name can construct this operation.

The scope adapter verifies the invocation and cgroup directory identity, opens
the owned `cgroup.kill` file through that directory descriptor, and requires the
caller to retain a cancellation intent before writing the signal. The pinned
file descriptor avoids selecting a different scope through a later unit-name
lookup. This is forced SIGKILL termination, not graceful native checkpointing.
The signal receipt does not claim termination until a later observation confirms
both leader exit and an empty scope. Neither receipt changes database status or
authorizes output publication.

Failure to retain the intent sends no signal. An uncertain signal receipt leaves
the writer stopped and refuses another signal attempt. Confirmed repeated calls
return the existing local receipt. A detached child is terminated even after its
leader exits. The full related suite passes 83 tests, including ten cancellation
tests. Twelve controls detect early signaling, omitted signaling, bypassed
invocation/directory/thread checks, uncertain resend and invalid lifecycle calls.
See `prototype/scope-cancellation-controls.json` for source hashes and outcomes.

These tests use disposable Linux processes and mocked database transport. Actual
native-solver cancellation, fresh-process reconciliation of a lost cancellation
receipt, parent-loss handling, database cancellation decisions, UI cancellation
and normal dispatch remain open. Permission or identity failure does not fall
back to killing a process group or an unverified unit.

## Native cancellation join, October 8

The full native assignment now calls local scope cancellation at a confirmed
iteration before sending its acknowledgement to the child. The installed SQL
state remains identical while the child terminates, the scope empties and final
outputs remain absent. The six controls in
`prototype/native-cancellation-controls.json` include an omitted-cancellation
fault and normal-assignment/receipt-replay regressions. This proves forced
interruption of the small synthetic native case, not graceful checkpointing,
reusable partial files, restart, UI cancellation or a database terminal decision.

## Fresh-process custody inspection, October 8

New scope startup records include the Linux boot ID and supervisor UID.
`model_engine_recovery.py` reads a retained claimed admission, derives the attempt
path from its deployment and identifiers, and verifies the workspace owner,
launch, startup and optional cancellation records. It opens records through the
attempt directory without following child symlinks, rejects hard links and
nonprivate or oversized files, checks stable reads, and retains hashes in its
output. The configured root remains an administrator-selected trust boundary.
This is not a signature scheme against the same user or host administrator.

The fresh CLI reports current scope population or absence only after matching
boot, user, invocation and cgroup directory identity. Another boot is explicitly
unassessed, and an absent startup record remains unconfirmed. Older scope records
without boot identity are refused; they are not rewritten with today's identity.
A missing signal receipt stays missing even if the scope is now absent. The CLI
leaves termination cause unconfirmed, changes no files or database status, sends
no signal, launches no model and grants no continuation authority.

From the repository root, with an existing worker Python environment:

```bash
python3 -B workers/aequilibrae_worker/model_engine_recovery.py \
  --root "$ATTEMPT_ROOT" --journal "$COMMAND_JOURNAL" \
  --base-url "$INSTALLATION_URL" --deployment-id "$DEPLOYMENT_ID" \
  --request-id "$CLAIM_REQUEST_ID"
```

Use the exact retained claim and installation values. No service-role key is
required. A live server ownership check remains a separate operation. These
observations cannot authorize a database terminal decision, new claim or resume.

Fourteen tests exercise actual owned scopes and fresh CLI processes, including
a lost cancellation receipt. The broader engine suite passes 97 tests. Seventeen
controls detect bypassed boot, deployment, claim, record, receipt and scope checks.
Fresh-process audit controls reject signaling or non-systemd subprocess launches.
See `prototype/scope-recovery-controls.json`. Claim history is supplied through the
existing real SQLite fixture with mocked database transport. Joining this reader
to actual native-failure records and installed claims remains necessary, along
with durable reconciliation decisions, parent-loss handling and UI recovery.

## Native cancellation inspection join, October 8

The inspector passes against actual native cancellation files and an installed
claim, both with a confirmed signal receipt and with that receipt deliberately
lost after signaling. Repeated fresh inspections preserve records, command
inventory and database state and make no database transport calls. They retain
scope absence as an observation while leaving the termination cause unconfirmed.
Five native controls pass in `prototype/native-inspection-controls.json`.
The inspection audit now permits only `systemctl --user show`, and an attempted
manager mutation is detected within 18 inspection controls. This closes the
preceding native-record join; it does not persist a reconciliation decision or
restore execution authority.

## Supervisor-loss iteration boundary, October 8

The actual supervising Python process is now terminated after an installed
progress write and before acknowledging the native child. The child closes its
native project and exits on channel loss. Its scope empties, no final assignment
files appear, and fresh inspections preserve the absence of cancellation and
successful-exit receipts. Database rows and command inventory remain unchanged.

`prototype/native-parent-loss-controls.json` retains five cases, including
omitted parent loss and an injected swallowed channel error. The latter produces
final local outputs and is detected. Gateway lifetime belongs to the outer test
process, so terminating the supervisor does not orphan its test database gateway.
This establishes loss handling at one confirmed iteration. It does not establish
continuous parent-loss detection, pre-startup failure handling, durable recovery
or authority to resume or publish a model.

### Startup interruption evidence, October 8

The installed-command supervisor-loss proof now interrupts before and after the
scope startup record, with authorization withheld in both cases. The production
bootstrap exits without entering engine code. Fresh inspection must leave
missing startup custody unconfirmed; a retained verified record permits only a
read-only scope observation. The test owner separately observes cleanup using
its live verified identity. It supplies no recovery or continuation authority.
See `prototype/native-startup-loss-controls.json` for harmless, early-release
fault and restored controls. No database lifecycle reconciliation or model
restart follows from an empty scope.

### Explicit recovery decision prototype, October 8

The database prototype in `prototype/recovery-decision.sql` separates abandonment
of write authority from observed process termination. Its operator decision binds
the exact reviewed parent/stage state, workspace, actor, reason and reported
evidence. The receipt and revocation commit together; exact retries retain the
original result. New writes from the abandoned attempt refuse. Neither that
receipt nor an empty local scope authorizes another model execution.

The command is not installed by an application migration or exposed through a
route. Its seven controls and separate committed-progress race are recorded in
`prototype/recovery-decision-controls.json`. HTTP recovery, authenticated actor
derivation, agent approval, physical termination and visible workflow joins
remain necessary before activation.

### Abandonment receipt recovery, October 8

The command client retains the complete reviewed abandonment payload before
transport and checks the echoed payload when accepting a receipt. A real
PostgREST commit followed by a lost reply now recovers through a fresh existing
command-recovery CLI. The first recovery resends the same bytes; a second recovery
uses the local receipt. Neither retry changes execution state or authorizes a
restart. `prototype/recovery-http-controls.json` records four controls, including
omission of the disconnect. The service-side actor and approval boundaries remain
unconnected; this proof does not grant an agent permission to abandon real work.

### Authenticated operator endpoint, October 8

Migration 23 installs explicit abandonment receipts. The recovery GET/POST route
binds model, run and workspace, derives the actor from the authenticated session,
and requires owner/admin membership. SQL rechecks the complete reviewed state and
current membership. Explicit Planner Agent headers refuse until recovery has its
own approved action. Missing replies remain unconfirmed and require the same
saved request. Mocked route controls and installed SQL/HTTP controls pass, but
real session-cookie, browser and operator-control journeys remain unproved.
