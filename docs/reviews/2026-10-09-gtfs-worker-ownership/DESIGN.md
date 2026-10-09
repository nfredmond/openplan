# Recoverable GTFS ingestion within M3

Status: implementation design at `c2fcb31eb`. No worker is connected by this document. The roadmap remains the queue; this develops its existing M3 requirement. The product-direction check passes with the retained review-age reminders. Full transit planning, scientific acceptance and v1 scope remain unchanged.

## Reuse and separation

Keep the production TypeScript parser, row mapping, caveats, source fetch controls and version/adoption model. The existing `gtfs_feed_versions` row remains the import's business record. Execution metadata and attempt receipts may refer to that version; they must not create a second import identity or silently select a different feed on retry.

Reuse the architecture of `openplan/scripts/workers/synthesis-preparation.ts`, its preparation service/coordinator and migration `20261015000012_engagement_synthesis_preparation_queue.sql`. They demonstrate a bounded Node polling service, target-specific private journals, retained claim tokens, active leases and checked shutdown. GTFS needs its own domain commands and access checks. Copying the synthesis job's campaign and approval assumptions would be wrong. Extract shared mechanical helpers only after a second working caller establishes their common contract.

Keep `workers/aequilibrae_worker/gtfs_skim.py` separate. It computes model transit inputs for a selected service day. It does not replace the application parser's seven-day derived service records. A bounded filename search of the user's code repositories found the existing OpenPlan GTFS implementations, not another ready ingestion worker. No new paid service, general queue platform or dependency is justified by this design.

The [parser and persistence measurements in PR 175](https://github.com/nfredmond/openplan/pull/175) cover BART and TriMet under recorded resource caps. They support reusing the parser. They do not establish the largest-feed, concurrent-worker or full-import capacity limit. The [closure repair](../2026-10-09-gtfs-ingest-recovery/CANDIDATE.md) protects completed records and failed versions, but does not establish live worker ownership.

## Authoritative state and ownership

An execution record is keyed by the existing version ID. It carries a monotonically increasing attempt number, active claim token, lease deadline and bounded step metadata. The version continues to expose pending, fetching, parsing, ready and failed outcomes. Queue and worker state must remain distinguishable from completion without inventing service results.

A worker creates and durably saves a claim token before submitting its claim. The database binds that token permanently to one version and attempt. Repeating the same claim recovers its recorded result. It must not revive an expired attempt or bind the token to another version. A new attempt can claim only eligible queued work or an expired lease. Renewal checks the same version, token, attempt and unexpired lease under the version lock. Server time governs ownership.

Every managed mutation checks ownership inside its database transaction. Checking a lease in JavaScript before a later write leaves a race. Restrict managed stage updates, object-custody updates, derived batches, finalization, promotion and failure closure to guarded commands. Direct legacy writes must be refused for managed versions, including direct service-role table writes through PostgREST. Reuse the transaction-scoped write-context pattern from the model command work only after checking its GTFS row and caller boundaries.

Legacy inline attempts may finish under their existing rules during migration. New managed attempts must be explicitly enrolled. The legacy stale reaper and unowned failure RPC must refuse managed versions. Lease expiry makes a managed attempt reclaimable; it does not authorize deleting its saved archive. Terminal managed failure or cancellation can enqueue object cleanup under the active command. Never use an old worker's error to close a newer attempt.

## Saved bytes and request recovery

Catalog and URL admission can retain the resolved source metadata, create the version and queue fetching. A worker uses the existing SSRF, redirect, archive-size and fetch-time limits. Before any successful parse is adopted, retain the exact archive, byte count and SHA-256. Once retained, recovery reads and verifies those bytes; it does not refetch a mutable URL under the same version identity.

Uploads retain the existing bounded private-object path. The route accepts work only after the object and its custody record are confirmed. A client retry needs a retained submission ID bound to the same source metadata and archive hash. Reusing the ID with different bytes or source arguments must be refused. Existing action-registry approval and route-local authorization remain authoritative where those surfaces invoke the import.

An object write with an uncertain reply is reconciled at the deterministic private key using its actual byte count and hash. An unrelated existing object is not overwritten. A crash between object upload and custody recording needs a recoverable admission record; the worker cannot infer success from a URL or path alone.

The current URL/catalog path can finish with service records even when archive storage fails, while disclosing unavailable model bytes. A managed import cannot promise recovery from that state. Preserve already-published legacy records and their caveats. New managed imports must disclose an unconfirmed artifact and retry storage or report failure; do not silently advertise them as resumable.

## Parsing, batches and publication

Initially, an interrupted parse may restart from the retained archive. Describe that as restarting parsing, not continuing at the interrupted CSV row. Keep the existing parser limits and source distinctions. A supervisor must renew ownership independently enough that a CPU-heavy parse cannot silently keep working after loss of its lease. Stop child work on unconfirmed renewal, while database fencing remains the final protection against stale output.

Derived writes use version, attempt, command ID, batch ordinal and payload hash. A committed batch with a lost reply returns its saved receipt on retry. Changed content under the same command ID fails. A replacement attempt can reset unfinalized derived rows only under its newly acquired ownership, after fencing the prior attempt. Recompute from retained bytes or reuse a verified derived artifact; never mix batches from different attempts.

Before ready, verify the complete expected batch set, actual stored counts and artifact identity. Finalization and its receipt form one transaction. Existing promotion rules and the human decision about material service shrinkage remain. A retry after successful promotion returns the retained outcome rather than closing or promoting a different version. Preserve completed versions that await human adoption.

Do not persist a raw stop-time table or expand the claim tier of schedule-derived results. The retained private archive remains the model input; derived service rows remain the application analysis data. Worker completion does not validate the schedule, geography, real-world service or either demand model.

## Verification required before connection

| Boundary | Required evidence |
| --- | --- |
| Claim response lost | Fresh process recovers the same attempt from its saved token; no second claim is created. |
| Lease expired and replaced | Old renewal and every old mutation fail; new attempt can continue from the retained archive. |
| Parse exceeds lease interval | Observed independent renewal, bounded resources and cancellation; no age-based deletion of healthy work. |
| Batch committed, reply lost | Same command returns its retained receipt and exact counts; changed payload is refused. |
| Replacement overlaps old batch | Observed native lock contention; stale output cannot reach the new attempt. |
| Storage reply or custody write lost | Exact retained object is reconciled; no mutable refetch or overwrite. |
| Finalize or promote reply lost | Retained ready/current version and receipt survive process restart. |
| Cancel or membership revoked | Bound scope is rechecked; stale workers cannot publish and the planner can recover appropriately. |
| Upgrade and restore | Nonempty legacy records remain usable; attempts, receipts and archive bytes survive the documented recovery path. |
| Planner workflow | Identified desktop and 390px T3 journey covers each admission door, progress, failure, retry and retained artifact use. |

Use the existing independent test stacks. Resource limits apply to the worker and its child processes; keep heavy tests serial on this host. Each new guard needs a harmless control and a targeted failure. Separate SQL, HTTP, process-restart, supervisor and browser evidence. Do not substitute one for another.

The next implementation experiment is a rollback-only ownership state machine against an isolated database. It must prove retained claim identity, expiry/replacement and old-token refusal before any route starts queuing work. A prototype remains unshipped until the actual ingestion writes, storage and UI use those boundaries.

## Ownership experiment, October 9

The isolated SQL prototype now passes its baseline, harmless-comment and restored runs. Six deliberately broken variants fail at the intended assertions: null claim receipt, token rebound to another version, expired claim revived, old token renewing a replacement, terminal version renewed, and output written without ownership. The retained [results](ownership-controls.json) identify the exact SQL and assertion hashes.

The first experiment could not run because PostgreSQL refuses a temporary-table foreign key to a permanent table. The corrected runner creates a unique private schema inside one transaction. Foreign keys reference freshly inserted synthetic versions. Each run rolls back, including its fixtures, and a separate connection confirms that its schema no longer exists. No migration or application route changes here.

The checks demonstrate same-transaction replay, live-lease refusal, simulated expiry, replacement and guarded synthetic output. They run as the database owner. They do not prove role isolation, simultaneous claim contention, a committed receipt recovered after process loss, actual derived writes, storage recovery, supervisor heartbeat or browser operation. Expiry uses a controlled lease update rather than waiting for a worker to die. The next experiment must test concurrent transactions and committed claim recovery before connecting the production writer.

Reproduce against the owned proof database described by its private configuration file:

```bash
python3 docs/reviews/2026-10-09-gtfs-worker-ownership/verify_ownership.py \
  /home/nathaniel/.local/state/openplan/gtfs-recovery-http-20261009.json
```

## Committed claims and contention, October 9

The [concurrent runner](verify_ownership_concurrency.py) now tests separate PostgreSQL sessions. It discards a successful claim response, exits that client, and recovers the exact receipt through another process using the retained token. It also observes each waiter blocked by the identified holder PID through `pg_blocking_pids`, then checks the result after commit or rollback:

- A replacement claim commits before the old writer resumes. The old writer receives SQLSTATE 55000 and leaves no output.
- A terminal version update commits before its waiting writer resumes. That writer receives SQLSTATE 55000.
- A competing claim waits for the first claim. After commit it receives no ownership; after rollback it acquires attempt 1. The stored owner and attempt match the outcome.

Baseline, harmless-comment and restored runs pass. Removing the version lock causes the expected lock-wait check to fail. Removing the owner-token predicate lets stale output through and fails the refusal check. [Retained results](ownership-concurrency-controls.json) carry the prototype hash and successful fixture identifiers.

Unlike the earlier rollback suite, this experiment retains small, uniquely named private schemas and synthetic workspaces in the owned proof database. Committed state is necessary to test another process reading the receipt. Deliberately broken variants exist only inside their private experimental schemas. No production function, route, worker or existing fixture is replaced. The runner uses database-owner privileges and controlled lease expiry. It does not prove role isolation, a durable worker journal, HTTP reply-loss handling, actual derived batch writes, storage, supervisor renewal or a planner journey. Those remain required before managed imports are connected.

```bash
python3 docs/reviews/2026-10-09-gtfs-worker-ownership/verify_ownership_concurrency.py \
  /home/nathaniel/.local/state/openplan/gtfs-recovery-http-20261009.json
```
