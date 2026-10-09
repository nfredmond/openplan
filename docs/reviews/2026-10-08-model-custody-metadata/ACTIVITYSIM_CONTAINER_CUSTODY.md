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
