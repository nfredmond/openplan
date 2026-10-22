# Aerial-worker queued admission loss, October 11

The unchanged ODM worker loses acknowledged queued-request identity after
restart. The complete stopped-root snapshot verifies, but it contains no job
record to recover. This is a reproducible M3 defect, not successful worker
recovery or photogrammetry acceptance.

Base commit: `82a3b5a3f4774ca11fa4da9abc26b206dbd802b9`, above PR211.
[The design](DESIGN.md), [native driver](native_reproduction.py) and
[executed source bindings](evidence/executed-source-hashes.json) identify the
isolated test. No worker runtime, deployment, schema or contract file changes.
The relaunch owner retains hosted coordination and the main merge hold.

## Actual native sequence

The wrapper starts unchanged `main.main()` and only selects an ephemeral
loopback server through the existing builder. It does not replace `PIPELINE`
or import worker test modules. Explicit synthetic tokens, private persistent
root, one queued-task ceiling, 1 MiB intake ceiling and disabled proxies keep
the fixture isolated. NodeODM's URL points to an owned refusal endpoint; no
processing engine starts.

The first request reaches the real worker queue and intake. Its owned source
listener withholds response headers and supplies no imagery body. The driver
then submits a second request, which gets HTTP 202 and an original job reference,
callback ID and accepted receipt. Before interruption, exact replay gets 200
with that original receipt. Changing mission metadata under the same request ID
also returns 200 with the old receipt, rather than a conflict. That behavior is
recorded separately; it does not authorize changing the original custody.

The driver terminates only its owned worker. The existing snapshot CLI captures
and verifies the complete stopped root; independent comparison preserves all
ordinary entries, directories and private modes. There are no ordinary files
or SQLite copies at this held pre-body boundary. A populated admission journal
does not exist in the root.

A separate fresh runtime copy starts unchanged worker code. The driver posts
the exact original queued-request bytes. The response is 202 with a different
job reference and callback ID, and the worker starts another intake request.
The contract schema describes `requestId` as an idempotency key that must not
create a second job. Restoring every actual file does not preserve the original
memory-only registry.

Both source requests remain held until the owned workers stop. No imagery body
is sent, and the owned engine-refusal endpoint receives zero requests. This
does not prove imagery input custody, NodeODM task/commit recovery, artifact
publication or reconstruction quality. Original root and immutable package
remain unchanged; all owned children/listener/service stop.

## Controls and evidence

[The counterexample oracle](oracle.py) recognizes this observed failure and
returns `recoveryAccepted: false`. [Its 23 executed controls](evidence/controls.json)
include baseline, harmless key order and restored survivors, plus 20 targeted
broken observations. Concealing the new admission, new job/callback ID, altered
request bytes, premature processing or changed roots fails its named comparison.
The controls mutate observations, not production branches. They do not establish
the behavior of real imagery, an external engine or a live OpenPlan callback.

[The native result](evidence/native-result.json) records 0.467 seconds driver
time, 0.283 seconds CPU and 33,357,824 bytes peak memory under a 512 MiB/no-swap
cap, one CPU and 128 tasks. Invocation `00fcc8187d3444128968f84996edec48` exits
zero because it successfully reproduces and checks the defect. The worker's
recovery outcome is still false. The service is stopped, and
[cleanup evidence](evidence/cleanup.json) retains both owned child exits and the
closed listener. All 20 executed source bindings remain unchanged. Python
parsing and changed-file whitespace checks pass. GitHub CI is separate.

Private evidence:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-restart-reproduction-20261011/native-01/`.
It retains original/repeated receipts, exact request bytes, callbacks, empty
source and retained root package, fresh runtime, executed source copies,
observations, controls, logs and service properties. No private payloads are
published in this note.

## Fix boundary

Persist accepted request and exact admission before 202, atomically bind
repeated request IDs to their original payload, and recover queued admissions
from that journal. Do not connect a half-finished journal that blindly restarts
an already-submitted engine task. Persist source-byte identity, external task
creation/upload/commit intent and returned identity, retained result/callback
and artifact registration before enabling full continuation. Uncertain engine
outcomes require reconciliation, not inferred success or another submission.
Keep original sources until custody and appropriate retention authorize cleanup.

The source also exposes memory-only artifact registration and unretained
NodeODM task UUIDs. Those are source findings here, not newly executed artifact
or task-recovery counterexamples. The existing M5b.2/M3 queue already covers
their durable recovery. No new module, processing-engine default, scientific
claim, capability grade or v1 scope change is justified by this defect.
