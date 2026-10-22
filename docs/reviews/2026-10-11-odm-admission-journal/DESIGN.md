# Private aerial admission journal candidate

The native queued-admission counterexample establishes a missing durable
boundary. Add a small SQLite store in the existing ODM worker, with no public
contract, engine-option or hosted configuration changes. Do not wire it into
`main.py` until the remaining source/engine/result/artifact stages are defined.

The journal atomically stores canonical parsed request identity, original job
reference and exact admission payload before a caller can acknowledge new work.
Replays return the original saved admission. Any changed parsed payload, including
changed source URL, conflicts. Signed-URL refresh needs a later checksum-bound
procedure; it is not an exception in this first candidate.

Admission capacity and identity checking share one immediate SQLite transaction.
An existing exact request replays even when the queue is full. Count only records
still in `accepted` for the pending queue. Started work remains retained and is
separately inspectable. Admission factories run only for genuinely new requests;
reject factories whose receipt/request/job identity differs. Return detached
JSON values, so mutating a returned object does not rewrite the journal.

Before processing, atomically record a caller-supplied start context. First start
returns permission to cross that boundary once. Exact replay of that context does
not grant another start. Another context or job reference conflicts. Started
records never appear in the accepted restart queue, and no reset/resubmission API
exists here. This prevents a queue loader from blindly repeating uncertain work;
it does not itself reconcile or complete that work.

Use a dedicated `odm-admissions.sqlite3` in an explicitly private owned root,
without aliases, hardlinks or special files. Require a known schema and reject
unrecognized journals before changing their contents. Use FULL SQLite durability,
native transactions and directory synchronization. Bound lock waiting. Keep all
accepted and started records for later full-root backup and recovery.

Check pre-existing SQLite companions as well as the main file before opening
SQLite. Reject unknown schema objects and non-finite or changed saved encodings.
Synchronize the parent when creating a new root. These checks assume cooperative
owned writers; they do not establish protection against an adversarial same-UID
process replacing paths during an operation or physical power-loss durability.

Verify actual SQLite rows, all projected fields, subprocess interruption,
concurrent admission/start, queue bounds, immutable receipt/request identity,
detached values, privacy and rejected/corrupt schema. Every new guard/test needs
a harmless survivor and targeted broken behavior restored in finally. Execute
serially in an owned bounded service with Python bytecode disabled.

## Remaining integration before worker enablement

1. Retain exact source/archive/photo bytes and complete hashes before engine use.
   Recover prepared input from saved bytes, not a changed URL. Keep originals.
2. Persist engine identity, effective options, stable caller UUID and each external
   init/upload/commit intent before transport. Bind observed receipts to that
   original intent. A UUID/path or missing task alone is not success or absence.
3. Reconcile uncertain uploads and commits against the actual engine. Pinned
   [NodeODM source](https://github.com/OpenDroneMap/NodeODM/blob/d45bc41b0c7a51e7f3796035f3bc238e9e01d0a2/libs/taskNew.js)
   allows `set-uuid`, but repeated init rewrites draft metadata and upload naming
   can create additional files. Never treat that header as idempotent execution.
4. Retain complete verified outputs and artifact registration/token/expiry before
   callback. Save exact result/command identity before delivery; reconcile a lost
   acknowledgment without computation or duplicate publication. Source deletion,
   expired links and interrupted custody need explicit retention/recovery rules.
5. Integrate the existing routes/queue/startup, then replace the native admission
   counterexample with original-identity recovery. Add engine and artifact crash
   windows, live application custody/RLS, actual processing and operator recovery.

These stages stay in M3/M5b.2. The journal is not a new product module or a
scientific/reconstruction acceptance. A disconnected candidate cannot establish
worker recovery. The relaunch owner retains deployment coordination and the main
hold; independent installation, long work and the complete v1 floor remain open.
