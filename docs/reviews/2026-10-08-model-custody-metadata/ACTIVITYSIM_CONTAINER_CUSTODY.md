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
