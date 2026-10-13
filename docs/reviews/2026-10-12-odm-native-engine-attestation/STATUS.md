# Observe one configured original NodeODM engine

This candidate continues existing M3 and M5b.2 above the frozen combined
[PR263](https://github.com/nfredmond/openplan/pull/263). It adds an explicit Linux
adapter for one cached NodeODM 2.2.4 image and launch profile. It does not change
the default worker, permit processing commit or declare aerial processing ready.

The [design](DESIGN.md) binds the configured full container ID, immutable image,
configuration digest and literal private endpoint to actual observations. The
observer sends only container and network GET requests through the explicitly
selected local Docker socket. It verifies the daemon's Unix peer UID. It reads
the configuration through the inspected process's root, bounds regular-file
bytes, refuses a symlink leaf, compares descriptor metadata and preserves the
PID/start identity. A second daemon/process observation must retain that original.
Mount descriptors sort by their unique destinations before hashing. Environment,
launch metadata and configuration spelling still affect the digest.

The parent supervises one child under the actual shared deadline, strict ownership
callback and parent-lifetime pipe. It bounds input, output and diagnostics,
validates the original receipt and checks ownership/deadline after that receipt.
A refused or unavailable observation has no fallback. Raw launch metadata and
configuration never appear in the child's receipt or error message.

The existing private application authority accepts this adapter through its
explicit attestation seam. Commissioning must retain the independently observed
original engine identity first. For that same supported original, construct
`Attestor(engine, socket_path, daemon_uid)` and pass it to
`Authority(reader, engine, attestor)`. The adapter cannot infer an installation,
select a daemon, adopt another engine or grant permission on behalf of an actor.
The worker must share the daemon's host PID namespace and have permission to
read the actual process root. Unsupported permissions, images and profiles refuse.
No configuration input can select another procfs root in the supervised child.

## Source and native checks

All 31 source tests pass. The final controller runs 65 checks: four baseline,
harmless and restored controls survive; 61 selected broken behaviors fail at
stated assertions. Its eight failure-oracle controls distinguish a zero exit,
wrong test, wrong reason, extra failure and missing error block. Source restoration
matches exactly. Python 3.14 and 3.11 run separately under 512 MiB limits with no
extra swap. See the [source controls](evidence/source314-controls.json),
[bindings](evidence/source314-source-bindings.json) and
[resources](evidence/source314-resources.json).

The socket fixture runs actual HTTP exchanges and supervised child processes.
It supplies a synthetic proc tree through an explicit test wrapper. It proves
those transport, framing, ownership and parser boundaries, not Docker behavior.
Some structural controls verify the particular refusal before another downstream
refusal. Those controls are marked `diagnostic_refusal`; they do not establish an
additional permission boundary. Tests cover file bounds, symlink refusal, process
identity, changed reads and repeated original observations separately.

The new owned Docker fixture passes [17 observations](evidence/native-observations.json)
and [22 result predicates](evidence/native-results.json), including five repeated
original observations. Its [69 classifier controls](evidence/native-oracle-controls.json)
reject missing, changed and wrongly typed results. The fixture verifies the actual
Unix daemon, running original, private bridge membership, endpoint, process-root
bytes, same-container restart and changed remount refusal. Pre-cancelled, expired,
wrong-original, changed-configuration and wrong-endpoint calls refuse.

After host-file replacement, the process still reads the original bytes while
the host path reads replacement bytes. The original attestation remains valid.
Restarting the same container remounts the replacement and refuses the retained
original digest. Restoring the original bytes and restarting passes. No task
initialization, upload, decoding, processing or callback occurs. The task list
stays empty. The [engine stops](evidence/native-stopped.json), with a 512 MiB limit,
no published ports and no reported OOM. The observer unit peaks at 30.5 MiB under
256 MiB. These are serial fixture checks, not production load acceptance.

## Failed archive prototype

The first design reads the configuration through Docker's archive endpoint.
Native checks invalidate that assumption. After a host file is replaced, the
process root retains the original bind-mounted inode, but later archive GETs
return replacement bytes. The [retained summaries](evidence/preceding-failures.json)
show the different hashes and stopped fixtures. The archive-derived prototype
remains unaccepted and is replaced by the process-root implementation.

A mount-enumeration regression also demonstrates that reversing the same unique
mount descriptors changes the preceding fingerprint. Destination sorting corrects
that behavior. The selected broken control removes that sorting and fails its
specific identity assertion. Earlier controller selector, broad-mutation and
ambiguous-anchor failures remain recorded instead of counting as intended kills.

## Hosted schema-first integration

The separate accepted PR263 remains frozen at `6b3561bf0`. Every required GitHub
check, aerial regression and restore passes. At 08:24 UTC on October 12, this lane
applies only `20261017000003_aerial_private_dispatch_custody.sql` to the existing
hosted project after its recorded coordination plan and fresh capture.

The archive has 7,211,788 bytes and 7,490 readable index entries. All 220 observed
Storage objects, totaling 117,871,050 bytes, match independent size/hash checks.
The [capture verifier](evidence/hosted-capture-independent-verification.json)
passes 12 controls. Active writers remain; this is not an atomic cut and the
fresh archive has not been restored. Confidential data and object inventories
remain outside the repository.

[Readback](evidence/hosted-schema-verification.json) verifies the exact migration
history, all four routine bodies, fixed search paths, definer profiles, grants
and RLS metadata. Nine controls pass. [Six live API cases](evidence/hosted-api-verification.json)
and 15 classifiers verify private-schema non-exposure for anonymous/service
requests, anonymous RPC refusals and service null-identity/missing-original
refusals. No real-user fixtures or dispatch records are written. The initial
readback query has a parentheses error; corrected read-only SQL passes. The
initial missing-original HTTP expectation is 404; actual and documented
[PostgREST P0 mapping](https://docs.postgrest.org/en/stable/references/errors.html)
is 500 with `P0002`. Both failed verifier trials remain private.

Migration03 is applied; its dependent code merge and production confirmation
remain separate. Preserve02/05 and all disabled defaults. Main merges deploy
production one at a time. The hosted-review lane's PR249 promotion still occupies
its turn at this checkpoint. This native candidate has no exact-head CI or main
acceptance yet. No release tag is created.

## Limits and continuation

This observation is not a writer fence, atomic remote authorization, draft-content
reconciliation or processing permission. A process or container can change after
inspection. A matching digest does not validate photogrammetry or scientific
output. These checks do not observe practicing planners or public participants.

Other images/profiles, another host or PID namespace, native composition with
current application authority, uncertain effects, processing/results/artifact/
callback custody, clean agency installation, cross-host recovery, useful long
computation and identified-build browser journeys remain open. All30 actual worker workflow run blocks and20 nested documentation tests pass.
The replay runs21 unittest suites with560 cases plus seven scenario programs.
It takes325.29 seconds and peaks at971,636,736 bytes under1 GiB, with zero
max/OOM events. Source hashes match after exact restoration, and the owning
unit stops. See the [workflow evidence](evidence/workflow-results.json) and
[resources](evidence/workflow-resources.json). Direction passes with unchanged
review reminders. Exact-head CI still follows this source/native proof.
Continue the roadmap from those gaps. GPT-6.1 Sol at high reasoning performs this
implementation and verification; no fresh independent review is claimed.
