# NodeODM draft retry counterexample

The actual cached NodeODM API accepts repeated uploads as additional files and
allows repeated initialization to overwrite draft metadata under the same UUID.
After stopped-root capture and restoration, those draft bytes remain while task
listing is empty and task lookup reports absence. Task absence therefore cannot
establish that initialization or upload had no effect.

This is evidence for existing M3/M5b.2. No worker, public contract, deployment,
schema, engine default or scientific claim changes. The [source candidate](../2026-10-11-odm-source-custody/STATUS.md)
and admission journal remain disconnected; full worker recovery stays open.

## Identified native fixture

[The driver](native_reconciliation.py) uses the exact cached image
`sha256:cb07d06e21fd6189cfad287c6fedfa0b72568100355635cd9035cb86eed42ee2`.
Its package reports NodeODM 2.2.4. The installed Node wrapper reports Node 14.21.3
and npm 6.14.18. [Image and extracted source bindings](evidence/installed-source-bindings.json)
retain hashes for nine read-only source files. This does not identify the latest
upstream release or accept an engine upgrade.

Two new containers run serially with private owned bind roots, no host ports or
network, a read-only image, 512 MiB memory with no extra swap, one CPU and 64 tasks.
The second container uses a fresh restored copy. Original services, images,
volumes, hosted configuration and other agents' processes remain untouched.
[Container accounting](evidence/container-accounting.json) records both actual
image IDs, isolation settings and clean stopped states. No image is pulled. [Fourteen documentation/direction tests](evidence/focused-checks.json)
pass from the nested application with one Vitest worker.

The server executes engine metadata probes during startup. The fixture uploads
47 synthetic ordinary bytes twice as `synthetic-photo.jpg`. These are not decoded
images. No commit request, reconstruction, callback or application connection
runs. The two upload replies both report success, and two different filenames
retain the same original bytes. Repeated initialization with a changed title
returns the original caller UUID and overwrites `body.json`.

The fixture reads every response. It does not drop a network acknowledgment.
It establishes the actual effect of repeating those requests, which must not be
assumed harmless during future acknowledgment-loss recovery.

## Stopped-root restoration

The first server stops cleanly. The existing worker-root CLI captures and verifies
its complete known draft/data root. An independent observer compares every
ordinary byte, mode and directory. This fixture has no SQLite journal.

A new server starts on a fresh package copy. Its task list is empty and its
original UUID is not found through task info, while the complete draft bytes
remain equal. The restored server also stops cleanly. Original source and package
remain unchanged. This is a same-host API/draft test, not reconstruction recovery,
installation-wide alignment or physical-host acceptance.

All [20 observations](evidence/native-observed.json) pass. [63 observation controls](evidence/native-controls.json)
include three survivors and 60 changed, missing or equal-value wrong-type failures.
These mutate observations, not engine behavior. [Six receipt-parser controls](evidence/wrapper-controls.json)
include harmless JSON spacing, restored bytes and refusals of a missing, changed
or extra stdout prelude. The parser checks the exact installed Node wrapper
banner rather than silently discarding unexpected output.

[Twelve driver controls](evidence/driver-controls.json) test ownership refusal and
client response-size/deadline handling, with nine survivors and three intended
failures. Ownership tests compile fresh function copies; client HTTP events use
a controlled adapter in the exact cached Node runtime. Those adapters do not
establish native stalled-network behavior. Mutations leave repository source
unchanged; [two control bindings](evidence/driver-control-source-bindings.json)
and [control resource receipts](evidence/driver-control-accounting.json) remain retained.

[Four executed repository bindings](evidence/source-bindings.json) stay unchanged.
[The native result](evidence/native.json) records the reproduced counterexample,
94 uploaded bytes, two files, engine metadata probes and no reconstruction.
`workerRecoveryAccepted` remains false.

## Resources and earlier trials

The accepted driver exits 0 in 9.949 seconds, with a 35,373,056-byte peak under a
256 MiB limit, no extra swap, one CPU and 128 tasks. [Driver accounting](evidence/local-accounting.json)
and container receipts remain retained. Both accepted containers stop with exit 0
and no reported OOM. Container peak memory is not measured, and this establishes
no processing or long-job capacity.

[Earlier trials](evidence/earlier-trials.json) remain visible. The first driver
fails before container creation because its private proof parent is missing.
The second reaches successful initialization but its parser fails on the actual
Node wrapper banner. Its container stops cleanly; the original draft and logs
remain retained. The completed third run is superseded by the final fourth run
with the extracted, controlled ownership guard. The final parser accepts that exact banner and rejects altered
or extra output.

## Required recovery behavior

Retain original source/derived-image identity, engine API/image/version,
effective settings and one stable task UUID before initialization. Persist exact
init, individual upload and commit intents before transport, then checked replies
before progressing. A repeated unresolved command does not get permission to
repeat an uncertain external effect.

Reconciliation must inspect the actual original engine custody. Exact existing
draft metadata and each uploaded byte/hash must match their original intents;
missing task info alone is insufficient. Duplicate or mixed drafts need an
explicit supported repair strategy, not silent resubmission. Commit/task-list
durability, active processing, source extraction, output custody, artifact
registration and terminal delivery require their own native checks before runtime
integration. The existing model command journal is a reuse reference, but its
server's idempotent command semantics do not apply automatically to NodeODM.

ODX/NodeODX remains the roadmap's preferred upgrade candidate. Adapter and recovery
proof, permitted matched imagery, quality review, licensing and resource benchmarks
precede any default change. Full M3/M5b.2 and v1 scope remain unchanged. Preserve
the main merge hold; the relaunch owner coordinates its recorded exception.

Private roots, original responses, stopped containers and failed trials remain at
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-draft-reconciliation-20261011/`.
