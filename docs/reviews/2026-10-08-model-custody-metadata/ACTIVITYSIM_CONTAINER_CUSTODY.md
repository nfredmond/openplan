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
