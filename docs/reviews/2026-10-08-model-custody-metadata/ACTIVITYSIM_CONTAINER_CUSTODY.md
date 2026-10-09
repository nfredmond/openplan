# ActivitySim container execution: limits and unresolved owner loss

October 8, 2026. This records an observed defect and a bounded resource-policy
change. It does not declare supervised container execution complete.

## Reproduced lifecycle defect

The actual ActivitySim container execution path ran a synthetic Python workload
using the locally installed `python:3.12-slim` image by immutable image ID. A
private proof-only Docker wrapper retained the full container ID outside the
container's writable mount and added a unique label, CPU restriction and
restricted capabilities. No image was downloaded. The workload used no network.

With the owner alive, the workload and runtime completed. In the second case,
the proof runner killed its own runtime owner and the original Docker client
through a pinned process descriptor. The daemon-owned container remained live.
After the proof released its marker, the container wrote its completion file
and exited. No runtime completion summary existed. Both test containers were
observed removed after exit. `docker run --rm` therefore did not stop work when
the owner or client disappeared in this measured case.

The first proof attempt encountered Docker's lowercase `no such object` response
after normal removal. The runner now recognizes that exact missing-ID response;
it does not treat an arbitrary inspection error as absence. The completed
campaign is retained privately in
`~/.local/state/openplan/activitysim-container-custody-20261008c/`.
`prototype/verify_activitysim_container_owner_loss.py` and its JSON report
preserve the procedure, image ID, limits, results and runtime source hash.

## Operator resource limits

The production CLI now accepts `--container-memory-bytes <bytes>` and
`--container-tasks <count>` together. The HTTP operator can set
`ACTIVITYSIM_CONTAINER_MEMORY_BYTES` and `ACTIVITYSIM_CONTAINER_TASKS`.
Request bodies cannot override them. Partial, boolean, noninteger or nonpositive
limits fail; supplying container limits for host execution also fails.

The runtime passes explicit memory, memory-plus-swap equal to memory, and process
limits to Docker and records the requested policy in execution metadata. A live
inspection confirmed 64 MiB memory, 64 MiB memory-plus-swap, and 16 processes for
the test. Thus the test permits no swap allocation. These values size the small
synthetic workload, not native ActivitySim. Omitting both limits preserves the
existing operator configuration; it does not imply bounded resources.

All 60 ActivitySim tests pass with live host scopes enabled, and seven HTTP
boundary tests pass. Five targeted faults fail their named tests, while harmless
and restored controls pass: allowing swap, accepting invalid limits, ignoring
the backend, dropping the operator memory limit, and accepting a request-body
limit. `prototype/container-limit-controls.json` retains source hashes and
outcomes. No memory-exhaustion test or scientific acceptance is claimed.

## Required lifecycle implementation

The remaining controller must own container creation as well as execution.
Wrapping only the Docker client in a host process scope cannot satisfy this
boundary. The next implementation needs these states and evidence:

1. Retain a private execution intent outside writable container mounts, with
   the exact daemon/endpoint identity, immutable image, operator policy and
   unique label. Saved labels alone cannot authorize termination or restart.
2. Create the container through an independently supervised controller. Retain
   and verify its full daemon-issued ID, image, labels, mounts and resource
   policy before allowing it to start. Owner loss during creation must remain
   recoverable, including a lost create response.
3. Check the original live owner before start and observe it throughout work.
   On owner loss, stop only the verified owned container and observe its state.
   A client exit or sent signal is not a termination receipt.
4. Preserve logs, exit/OOM state and exact identity before cleanup. Keep failed
   inspection, daemon unavailability, a different daemon and already-removed
   work distinct. Test controller loss and daemon restart as separate failures.
5. Connect retained local evidence to existing database attempt ownership and
   explicit continuation decisions. Neither an absent container nor a matching
   label grants a new execution admission.

This describes the open execution contract, not a second roadmap or a completed
controller. Native ActivitySim container interruption, remote/rootless daemon
coverage, full-host recovery, independent scientific validation and human
acceptance remain open.

## Prestart identity verifier checkpoint

`workers/activitysim_worker/container_identity.py` introduces an immutable plan
and a verifier for supplied Docker inspection facts. It compares the daemon ID,
full container ID, immutable image ID, unique request label, command/entrypoint,
environment, user, working directory, memory/swap/process limits, network,
restart/removal/privilege flags and exact bind mounts. It requires an unstarted
`created` state. A result contains identity and a policy hash; start, signal and
continuation authorization all remain false. The verifier does not contact
Docker or establish the origin of facts supplied by its caller. It is not yet
connected to normal execution.

A live Docker proof created one disposable container with the retained local
image. Initial verification passed. Changing its actual memory-plus-swap policy
from 64 MiB to 128 MiB was refused. Restoring 64 MiB produced the original
identity result. The container stayed in `created`, its marker command never
ran, and the proof removed it. The source hash and result are retained in
`prototype/created-container-identity.json`; the runner is
`prototype/verify_created_container_identity.py`. Private evidence is under
`~/.local/state/openplan/activitysim-created-container-20261008b/`.

All 65 ActivitySim tests pass with live host tests enabled. Six source faults
are detected with harmless/restored passes: invented start authority, ignored
daemon, ignored image, ignored environment, ignored mounts and mutable command
acceptance. `prototype/container-identity-controls.json` retains the results.
Tests also refuse changed user, working directory, limits, network, automatic
removal, restart, privilege and already-started state. This is a check of named
fields, not an exhaustive Docker security-policy audit.

The controller still must authenticate and freeze its endpoint, retain intent
and exact creation response outside writable mounts, reconcile a lost creation
reply, bind startup to a live owner, and verify termination after owner/controller
loss. Namespace/security-profile policy and remote/rootless variants also need
explicit coverage before claiming complete daemon custody. No saved verifier
result is a capability to start, stop or recreate a container.

## Private creation-intent checkpoint

`container_creation.py` retains an immutable plan and endpoint fingerprint in a
new private directory outside the plan's writable bind mounts. It fsyncs the
parent directory, intent, request reservation and verified creation record.
Files use exclusive creation and mode 0600; the directory uses 0700. A live
object pins directory identity and checks the intent hash before reservation and
receipt retention. Replaced directories, changed intent and unverified container
facts are refused. The creation record retains no start or continuation authority.

The helper permits one creation reservation in that directory. It refuses a
second reservation and refuses to reopen existing records as a new creation.
A missing creation receipt therefore remains unresolved; the helper does not
retry Docker, infer that creation failed, or reconstruct a live execution owner.
This is local retention, not a distributed admission or a complete controller.
A caller could still choose a different directory; database ownership and
controller integration must prevent that from becoming a duplicate execution.

The live Docker proof created two unstarted containers after retaining their
intents and reservations. One reply was verified and recorded; the other reply
was deliberately left unrecorded. Both cases refused repeat reservations and a
fresh open of their existing custody directory. Neither container command ran,
and both containers were removed. The test did not inject a network disconnect
or kill the controller during creation. Its endpoint fingerprint records declared
context metadata; it does not authenticate or freeze a future connection.

All 71 ActivitySim tests pass with live host tests enabled. Six source faults
are detected, with harmless/restored passes: repeated reservation allowed,
custody inside a writable mount, changed intent ignored, directory replacement
ignored, unverified container accepted and false start authority. The runners
and reports are `prototype/verify_container_creation_controls.py`,
`prototype/container-creation-controls.json`,
`prototype/verify_container_creation_custody.py`, and
`prototype/container-creation-custody.json`. Private live evidence remains under
`~/.local/state/openplan/activitysim-container-creation-20261008a/`.

Normal execution still uses its existing container path. This retention helper
has no transport or startup method. Independently supervised creation, lost-reply
reconciliation, live-owner startup, owner/controller-loss termination and
server-side continuation remain required before connecting a supervised
container path.


## Local Docker connection and creation checkpoint

`container_transport.py` creates through one Linux Unix socket connection. It
checks the socket peer's user, the daemon ID and support for the fixed
[Docker Engine API 1.51](https://docs.docker.com/reference/api/engine/version/v1.51/).
The endpoint fingerprint retains those observed facts. A root-owned socket peer
may be systemd socket activation, so the peer PID is not claimed as the daemon
PID. Remote and non-Linux transports remain unsupported by this adapter.

The adapter reserves creation before sending the request. It retains the exact
returned container ID before inspecting and verifying that container. A warning,
changed identity or failed response leaves the request unresolved. It does not
reconnect or repeat creation after a dropped reply. Bounded response parsing
rejects unexpected HTTP status, duplicate fields and non-object JSON. This is
not a complete Docker namespace or security-profile audit.

All 81 ActivitySim tests pass with live host checks enabled. Eleven deliberate
source faults fail their named checks; harmless and restored source passes.
Actual Unix-socket tests inject synthetic Docker replies, including reply loss
after receipt of a create request and connection closure during setup. These
controls establish the adapter's behavior, not Docker daemon crash recovery.
The report is `prototype/container-transport-controls.json`, with runner
`prototype/verify_container_transport_controls.py`.

A separate live Docker proof created exactly one unstarted container through
this adapter, retained all four records, refused repeat creation and refused use
after closing the connection. Its command never ran. The proof removed only its
identified container. The report is `prototype/reserved-container-transport.json`,
with runner `prototype/verify_reserved_container_transport.py`; private records
remain under `~/.local/state/openplan/activitysim-container-transport-20261008a/`.
The production source hash matches both retained reports.

The adapter exposes no start, signal or removal operation and is not connected
to normal execution. An independent controller must still bind startup to the
live owner, stop the exact container after owner loss, reconcile unknown creation
outcomes and integrate database admission. Connection loss does not prove that
the daemon stopped work. Controller/daemon restart behavior, security policy,
native ActivitySim container execution and scientific acceptance remain open.


## Read-only observation after a lost creation reply

`LocalDocker.observe_creation` reads candidates from the original daemon using
an explicit request-label filter, including stopped containers. No candidate
returns `not_observed`; multiple candidates return `ambiguous`. One candidate
requires full-ID inspection and the same immutable-plan verification used at
creation. Changed commands, policies, daemon identity or substituted inspection
IDs fail. An already-started container fails the unstarted-state verifier; this
method does not provide general running-container recovery.

All outcomes deny start, signal, continuation and retry authority. Labels locate
candidates; they do not establish ownership. An empty list is only a current
observation, not proof that a create request never reached Docker. The caller
explicitly opens a separate observation connection after a failed connection.
The original adapter still never reconnects or repeats creation automatically.
Observation does not rewrite original intent, request or creation records.

A private Unix-socket proxy forwarded an actual create request to local Docker
and discarded the successful response. Only intent and request records remained.
A new direct connection to the same daemon found and verified the exact container
ID retained by the proof proxy. There was one creation request, the command never
started, and the original record bytes remained unchanged. The proof removed
its identified unstarted container. This is actual response-loss evidence, not
an owner/controller kill or daemon-restart test.

All 85 ActivitySim tests pass with live host tests enabled. Seventeen deliberate
transport/recovery faults fail their named checks, with harmless/restored passes.
The added faults cover daemon mismatch, invented retry authority, substituted
ID, ignored policy, omitted stopped containers and ignored ambiguity. Reports
are `prototype/container-recovery-controls.json` and
`prototype/container-lost-reply.json`. The runners are
`prototype/verify_container_transport_controls.py` and
`prototype/verify_container_lost_reply.py`; private evidence remains under
`~/.local/state/openplan/activitysim-container-lost-reply-20261008a/`.

This provides read-only reconciliation evidence. It does not adopt a container,
reconstruct a live owner, authorize removal, or satisfy supervised startup.
Independent owner/controller-loss handling, database admission and integration
into the normal execution path remain unfinished.


## Container-internal owner observation experiment

The local Docker daemon uses the systemd cgroup driver and cgroup v2, with live
restore disabled. The host owner guard does not own Docker's workload scope.
A different mechanism was tested before attempting a production controller:
pass original owner and controller process descriptors into a private container
PID namespace, then let its PID 1 observe both throughout the command.

Linux documents [file descriptor transfer over Unix sockets](https://man7.org/linux/man-pages/man7/unix.7.html)
and [termination of a PID namespace's remaining processes when PID 1 exits](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html).
The experiment combines those mechanisms. Its Python bootstrap requires PID 1,
receives exactly two process descriptors over a mounted Unix socket, refuses
already-exited processes, and checks both while a synthetic command runs.
When either descriptor reports exit, the bootstrap exits with status 125.
The kernel then terminates remaining namespace processes. No Docker stop call
is needed for the observed owner/controller-loss cases.

Five live cases use the cached Python image, 64 MiB memory with no swap allowance,
16 processes, 0.25 CPU, no network, no capabilities and no new privileges. Owner
loss and controller loss both produce an exited container with PID zero and
exit code 125. A detached child's heartbeat stops. A harmless source comment and
restored source give the same result. Deliberately omitting the watchdog leaves
the container running and its detached child's heartbeat advancing. The proof
then explicitly kills and removes only that identified test container. All five
containers were removed; a subsequent label query found none remaining.

The first attempt hit the Unix-socket pathname limit. The completed campaign
uses the shorter private path `~/.local/state/openplan/pidfd-20261008b/`.
Individual case reports survive interruption. The retained source, runner and
report are `prototype/container_pidfd_bootstrap.py`,
`prototype/verify_container_pidfd_namespace.py` and
`prototype/container-pidfd-namespace.json`.

This is an executable design experiment, not production supervision. The proof
process supplies both descriptors; the processes designated owner and controller
are synthetic. It does not authenticate the socket peer, bind descriptor delivery
to the verified Docker creation record, or implement database admission. Before
production connection, implement and test that handshake, pre-start owner loss,
bootstrap loss, malformed descriptors, normal command completion, detached-child
completion policy, log/exit retention and native ActivitySim interruption.
Remote/rootless variants and daemon/full-host recovery remain separate checks.


## Live bootstrap peer and startup interruption checks

The prototype now checks the peer before sending any process descriptors. Linux
`SO_PEERPIDFD`, identified in the installed `asm-generic/socket.h`, returns a
process descriptor for the connected peer. The helper compares its live PID and
socket credentials against Docker's inspected bootstrap PID and expected user,
then checks the process's exact container cgroup. A dead peer or an unsupported
socket option fails. This experiment deliberately supports only the observed
local Linux/systemd Docker cgroup layout; it does not claim portable/rootless
coverage or fall back to a PID-only check.

Seven live cases passed their stated expectations. Each verifies the actual
container peer and refuses an unrelated same-user socket connection. Owner and
controller loss stop the workload with exit 125. Owner loss before descriptor
delivery exits the bootstrap with status 1 and creates neither workload marker.
Killing the bootstrap exits the container with status 137 and stops its detached
child. Harmless/restored controls stop normally; omitting the watchdog leaves
work running, as expected for the deliberate defect. All owned containers were
removed after each case. Records remain under
`~/.local/state/openplan/gate-20261008b/`.

A separate source-control campaign repeats the live checks with a harmless
comment, with peer identity/cgroup binding deliberately bypassed, and with the
original source restored. The bypass fails because the unrelated peer is
accepted. Both unchanged-behavior campaigns pass. The original peer-gate bytes
match the retained source hash. Private control logs and files were copied from
the short socket-path workspace to
`~/.local/state/openplan/peer-controls-20261008a/` for retention.

The helper is `prototype/container_peer_gate.py`. Reports are
`prototype/container-peer-gate.json` and `prototype/container-peer-controls.json`;
control runner `prototype/verify_container_peer_controls.py` exercises the
expanded `prototype/verify_container_pidfd_namespace.py` campaign. Earlier
reports remain dated evidence for their earlier source and procedure.

This verifies delivery to a live daemon-identified bootstrap, not complete
execution admission. Production must bind the inspected bootstrap to the
retained immutable creation plan and a live owner/controller, retain the startup
and exit records, and integrate the database attempt. Malformed descriptor,
normal completion, detached-child completion and native ActivitySim tests remain
required before connecting this prototype to normal execution.


## Detached completion and descriptor refusal correction

A live normal-completion check exposed a defect in the experimental bootstrap.
The original command spawned a detached child and exited. The old bootstrap
then exited, causing the kernel to terminate that child before its readiness or
completion marker. The parent-completed marker existed. This reproduced failure
is retained under `~/.local/state/openplan/cb-1008a/`; it was a prototype defect,
not a regression in the unmodified normal execution path.

The bootstrap now reaps all children, including adopted detached descendants,
while continuing to observe both original process descriptors. It returns only
when the kernel reports no children remain and the original command's exit
status has been observed. In the live check, the container remains running after
the original command exits. The proof explicitly releases the detached child;
the child writes its completion marker, and only then does the container exit
with status zero. This demonstrates waiting for this process tree, not model
output correctness or every application-specific child failure policy.

Ten live cases pass with restored source: owner loss, controller loss, owner
loss before startup, bootstrap loss, detached completion, a non-process
descriptor, a missing descriptor, harmless source, deliberately omitted watchdog
and restored behavior. Invalid or missing descriptors refuse before workload
markers appear, with their specific refusal messages. A proof-helper defect
initially omitted Docker's stderr when checking those messages; the helper now
captures both streams. The corrected checks pass.

Four source faults fail for the intended reason: early completion, ignored dead
owner, ignored descriptor kind and ignored descriptor count. Harmless and
restored campaigns pass. Each campaign uses disposable containers; all are
removed after its checks. Reports are `prototype/container-completion.json` and
`prototype/container-completion-controls.json`. The new control runner is
`prototype/verify_container_completion_controls.py`. Private control files and
logs are retained at `~/.local/state/openplan/completion-controls-20261008b/`.

These tests retain the existing synthetic-work and local Linux/systemd boundary.
They do not prove native ActivitySim, record durable production exit receipts or
connect the database attempt. A pre-start liveness check also does not make a
Docker start request and a host process exit one atomic operation; continued
observation and termination are still necessary after command release.


## Recheck the execution plan before bootstrap release

The worker's `container_identity.py` now shares its immutable configuration
verification between created containers and running bootstraps. The new
`verify_bootstrap_container` additionally requires the exact previously created
container ID, a running positive PID, no paused/restarting/dead state, a private
PID namespace, no inserted init process, dropped capabilities and the configured
no-new-privileges restriction. Its result still grants no start, signal or
continuation authority. The created-container verifier retains its requirement
for an unstarted container and its previous result shape.

The live prototype constructs the expected plan before creation. It checks that
plan against the created container, rechecks the same configuration after the
bootstrap starts, and compares the policy hashes before peer verification and
descriptor delivery. Every case also supplies a deliberately different command
and confirms its refusal. This replaces reliance on the bootstrap PID and label
alone for the measured startup path. The private bootstrap script remains a
mounted file; production must retain and verify its exact bytes as part of the
execution artifact, not assume a path proves content.

All ten live interruption/completion/refusal cases pass with this verification.
All 88 ActivitySim tests pass with live host checks enabled. Eleven identity
source faults fail their named tests, with harmless/restored passes. The added
controls detect a substituted bootstrap ID, ignored command, invalid PID,
shared host PID namespace and invented start authority. Reports are
`prototype/bootstrap-plan-live.json` and `prototype/bootstrap-plan-controls.json`.
Private live records remain under `~/.local/state/openplan/plan-1008a/`.

This connects the worker verifier to the executable prototype. The normal
runtime still requires a controller that retains creation/startup/exit records,
delivers the real owner's descriptors, captures logs and reconciles failures
with database attempt ownership. Native ActivitySim and broader scientific and
human acceptance remain unproved by these synthetic cases.


## Bind the live plan to retained intent and creation

Two regression tests reproduced a gap in `ContainerCreation`: although the plan
value is frozen, a caller could replace the object's plan reference. Reservation
and receipt verification then accepted the replacement command while the saved
intent still described the original command. Both tests failed before the fix
with `ValueError not raised`. The failing output is retained privately with the
live evidence, not treated as a passing check.

`verify_intent` now compares the live plan's canonical JSON against the retained
plan as well as verifying the exact intent-file hash. Reservation, receipt
retention and bootstrap observation all call it. Replaced plans fail before
reservation or verified receipt creation. The creation object also retains the
exact created-record hash. Its new `observe_bootstrap` method requires this live
verified creation and unchanged intent/receipt before checking the running
container against the original full ID and policy. Saved records alone do not
construct that object or authorize startup.

The live prototype now reserves intent before its Docker CLI create request,
retains the verified creation, and uses the same live creation object to verify
the running bootstrap before descriptor delivery. All ten live cases pass.
This experiment still creates/starts through the explicit local Docker CLI; it
does not claim those commands use the adapter's frozen HTTP connection or that
the complete production controller is connected.

All 92 ActivitySim tests pass with live host tests enabled. Ten deliberate
creation/receipt faults fail their named tests, with harmless/restored passes.
The added controls cover replaced live plans, changed receipt bytes, missing
live creation state and substituted bootstrap IDs. Reports are
`prototype/live-intent-controls.json` and `prototype/live-intent-startup.json`.
Private records and the failing-before log remain under
`~/.local/state/openplan/intent-1008a/`.

Production startup/exit logging, exact bootstrap-byte retention, native model
interruption and database recovery remain open. This correction prepares their
creation boundary without declaring those workflows complete.


## Worker controller with retained logs and real owner observation

`container_supervision.py` now implements `run_container_command` in the worker
package. It retains the exact `container_bootstrap.py` bytes and hash, refuses
records inside writable model mounts, creates a new private command log, and
starts the independent host owner guard. Creation, inspection, startup and
normal removal use one `LocalDocker` connection. The bootstrap plan adds private
control, read-only bootstrap and command-log mounts, a private PID namespace,
no inserted init process, dropped capabilities and no-new-privileges.

The controller records startup intent before the start request. Before workload
release it checks the live creation receipt, complete plan, actual socket peer,
bootstrap bytes and live guard. It transfers descriptors for the actual Python
owner and its independently observed guard. The bootstrap writes command output
to the mounted log and waits for the whole process tree. On confirmed exit, the
controller hashes and fsyncs the log, retains exit/OOM status and then requests
removal of that exact container. A removal acknowledgment is retained separately.
These records make no database status change. The controller does not retry a
failed Docker connection or reconstruct execution from saved records.

The live campaign calls the actual worker controller with synthetic Python work.
Normal execution retains its log, waits for an explicitly released detached
child, records exit and acknowledges removal. Killing the actual controller
process stops the namespace with exit 125 and preserves the flushed command log.
No completion receipt appears after that owner loss. The proof reconciles and
removes only that exact stopped container. Changed bootstrap bytes and an
unrelated same-user socket connection are both refused before workload release.

Five live source faults fail for their stated reasons: bypassed artifact hash,
bypassed peer binding, omitted owner watch, premature completion and omitted
command-log capture. Harmless/restored campaigns pass. One rerun encountered a
proof-cleanup race when the container exited between inspection and the cleanup
kill. The proof now re-inspects after a failed kill and accepts only the same
identified container in a confirmed exited state. The one leftover exited test
container was separately verified and removed. The corrected campaign passed.

All 98 ActivitySim tests pass with live host checks enabled. Twenty transport
faults and three input-boundary faults fail their named tests, with harmless and
restored source passes. Input checks refuse a different local user, records in a
writable mount and reuse of an existing command log before starting a guard or
contacting Docker. Source hashes match the retained reports:
`prototype/controller-live.json`, `prototype/controller-controls.json`,
`prototype/controller-transport-controls.json` and
`prototype/controller-boundary-controls.json`. Private control evidence is under
`~/.local/state/openplan/controller-controls-20261008c/`.

This controller is implemented and exercised directly, but `runtime.py` and
normal database dispatch do not call it yet. Production integration must resolve
and retain the configured image, map existing engine arguments and mounts,
connect caller-visible cancellation/recovery, and test native ActivitySim. No
ActivitySim-named image was found in the local image inventory during this work;
all container checks use the cached Python image. The separately validated host
ActivitySim environment is not container evidence. Remote/rootless Docker,
Podman, daemon/full-host failure and scientific acceptance remain separate
unproved boundaries. File fsync is implemented; no power-loss experiment is
claimed.


## Runtime CLI and operator HTTP configuration connected

`runtime.py` now calls the worker controller when the operator supplies
`--container-supervision-socket` with an absolute local socket path and explicit
container memory/task limits. The HTTP wrapper accepts the equivalent
`ACTIVITYSIM_CONTAINER_SUPERVISION_SOCKET` operator environment variable. Request
bodies cannot choose it. No socket or limits are inferred from a request.

`container_execution.py` adapts the existing command, mount, working-directory
and HOME mapping. It resolves the already-installed image to an immutable ID,
retains image environment and entrypoint semantics, and refuses engine arguments
that cannot be represented by this explicit local Docker connection. It does
not pull missing images. The controller records live execution outside writable
model mounts, in a sibling `<runtime-directory>.container-custody` directory.
The existing runtime log path receives command output. Reusing either retained
custody or an existing command log fails; `--force` refuses a runtime directory with sibling custody, preserving its linked output and logs.

The actual CLI passed normal and owner-loss cases with a synthetic command.
Normal completion waits for the detached child and records the resolved image
and supervised mode in the runtime manifest. Killing the actual runtime process
stops the container with exit 125, preserves its command log and leaves no
runtime completion summary. The proof removes only its exact stopped container.
No engine wrapper stands in for the new CLI path.

All 103 ActivitySim tests pass with live host tests enabled; seven HTTP boundary
tests pass. Nine adapter/operator faults and two live runtime faults fail their
stated checks, with harmless/restored passes. The live controls detect dropped
CLI socket configuration and bypassed runtime dispatch. Reports are
`prototype/runtime-supervision-controls.json`, `prototype/runtime-live-controls.json`
and `prototype/supervised-runtime-live.json`. Private logs and records are
retained under `~/.local/state/openplan/runtime-controls-20261008b/`.

This remains an explicit local-Linux opt-in. The legacy container path remains
available and still has the reproduced owner-loss defect. No claim extends this
verification to native ActivitySim, the database poller/attempt dispatcher,
remote/rootless Docker, Podman, worker-inside-container deployment, daemon/host
failure, scientific accuracy or human acceptance. Broader coverage is required
before the full v1 execution obligation is satisfied.


## Pipeline parent-directory protection

The behavioral pipeline previously removed its complete output root under
`force=True`, bypassing the runtime guard and deleting retained container
records with their command logs. It now refuses replacement when
`runtime.container-custody` exists, including a dangling symbolic link. The
operator must select a fresh pipeline output root.

All five behavioral pipeline tests pass. A harmless mutation passes; disabling
the parent guard makes the retained-record regression fail with the expected
missing refusal; restored code passes. See `prototype/pipeline-custody-controls.json`
and its executable verifier. This verifies a synthetic filesystem boundary,
not database recovery, native model execution or scientific acceptance.


## Operator settings reach the behavioral pipeline

The poller previously ignored host limits, container limits and the explicit
supervision socket. It now reads those operator environment settings and sends
them through the behavioral pipeline into the runtime. The pipeline CLI exposes
the same five settings. Runtime validation still governs incompatible backends
and incomplete limits; no job payload chooses this policy.

All 106 worker tests pass with live host checks enabled, and five behavioral
pipeline tests pass. Fifteen deliberate omissions, one per setting at the
operator, pipeline CLI and runtime boundaries, fail the intended checks.
Harmless and restored controls pass. The new tests build a synthetic bundle and
stop at a mocked runtime boundary. They do not establish live database dispatch,
managed attempt binding, native container execution or scientific acceptance.
See `prototype/pipeline-policy-controls.json` and its executable verifier.


## Live behavioral pipeline execution

The actual pipeline CLI now has a live synthetic-container check covering bundle
preparation, supervised execution and output ingestion. Normal execution waits
for a detached child to write one synthetic trip row, then verifies that ingestion
reads that row. The controller retains its log and confirms container removal.
Killing the pipeline process stops the owned container with exit 125, leaves no
runtime completion summary and preserves the command log. The proof reconciles
and removes only its recorded, stopped container.

Dropping the explicit socket at either the pipeline CLI or runtime handoff fails
the live check. Harmless and restored controls pass. Source hashes and limits are
in `prototype/supervised-pipeline-live.json` and `prototype/pipeline-live-controls.json`;
private records are under `~/.local/state/openplan/pipeline-live-controls-20261008b/`.
This uses a synthetic bundle and command. It proves neither native ActivitySim
behavior nor live database dispatch, managed attempt publication or scientific
acceptance. Database integration remains a separate open boundary.
