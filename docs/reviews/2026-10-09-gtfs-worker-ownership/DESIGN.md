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

## Attempt-owned derived batches, October 9

The [batch prototype](batch-prototype.sql) writes the actual public route and stop service tables through a service-role-only function. Its explicit column lists follow the existing TypeScript row mappers, omit generated columns and retain the schedule-derived claim fields. It validates the version/workspace scope, active ownership, bounded array size and allowed fields. A command receipt binds the version, token, kind, ordinal and canonical JSON payload hash. Repeating the exact command returns its saved receipt. Reusing its ID with changed content fails. A unique attempt/kind/ordinal prevents a second command from duplicating a batch.

The [rollback suite](verify_batch.py) passes baseline, harmless and restored runs. Four broken controls fail at the intended assertions: changed payload accepted, wrong owner accepted, authenticated caller allowed, and duplicate ordinal accepted. It writes one synthetic route row and one synthetic stop row, reads their actual counts, and verifies receipt count two. A duplicate ordinal fails while inserting its receipt after a distinct route row was inserted; the final count confirms both actions rolled back together. Anonymous and authenticated execution fail, and the service role cannot forge a receipt directly. [Results](batch-controls.json) retain both implementation hashes and the assertions hash. All schema and fixture changes roll back.

This is a command prototype, not managed ingestion. The existing service role can still bypass it by writing the public derived tables directly. Version lifecycle writes, legacy cleanup, tract computation, finalization and promotion also need guarded commands and transaction-scoped authorization before enrollment. This suite does not test HTTP, real parser output, large batches, every invalid-field case, role membership revocation or browser behavior. Its synthetic single-row records prove the database command mechanics, not feed validity or full mapper parity. The database-owner test switches PostgreSQL roles; it does not establish end-user route authorization.

```bash
python3 docs/reviews/2026-10-09-gtfs-worker-ownership/verify_batch.py \
  /home/nathaniel/.local/state/openplan/gtfs-recovery-http-20261009.json
```

## Direct-write fencing experiment, October 9

The [write-fence prototype](write-fence-prototype.sql) adds transaction-scoped command context and guards to the real route, stop and version tables, within rollback transactions only. An enrolled version is one present in the private execution prototype table. The batch runner installs a context immediately before its derived insert and removes it before recording the receipt. The trigger checks the current transaction, version, kind, token and unexpired lease. Public API roles cannot write the context table. Managed updates and deletes are refused because this prototype has no command authorizing them yet.

The [fence runner](verify_write_fence.py) executes the earlier real-table batch suite plus direct service-role attempts. It refuses a route insert, route update, stop delete, transfer to an unmanaged version, forged context, stage update, legacy failure closure, legacy stale reaping and version deletion. It checks unchanged managed rows/status and an empty context table. An unmanaged version still supports ordinary insert/update/delete and stage changes. Baseline, harmless-comment and restored runs pass. Removing the derived guard, removing the version guard and granting context insertion each fail at their intended assertions. [Results](write-fence-controls.json) record hashes of the guard, context-enabled batch, ownership implementation and combined assertions.

The runner constructs the context-enabled batch definition from the retained batch SQL; that original file remains the prior experiment. All new triggers, context tables and fixtures roll back. These checks establish command fencing for the tested statements, not production enrollment. Tract rows, feed-current pointers, lifecycle commands, truncate privileges, replacement cleanup, role revocation, HTTP and concurrent command context still need review and proof. No finalization or promotion command exists here. The prototype must not enroll application versions until those paths work coherently.

```bash
python3 docs/reviews/2026-10-09-gtfs-worker-ownership/verify_write_fence.py \
  /home/nathaniel/.local/state/openplan/gtfs-recovery-http-20261009.json
```

## Replacement preparation, October 9

The [preparation command](prepare-prototype.sql) prevents a replacement attempt from mixing its batches with prior unfinished output. Under the version/job lock and current lease, it removes prior route, stop and tract rows using private DELETE context, records the removed counts, and marks the token prepared. A batch requires that exact prepared token. A new claim leaves the old preparation marker in place, so it cannot write until its own preparation succeeds. Retrying preparation returns the retained result without deleting newly written rows. Old batch and preparation receipts remain available as history; an expired owner cannot use them to reset its replacement.

The derived guard now distinguishes INSERT from DELETE context and includes the tract table. Ordinary direct deletion still fails. The [preparation runner](verify_prepare.py) exercises a synthetic prior attempt with one route, stop and tract record, replacement, premature-write refusal, preparation, a replacement batch, preparation replay and refusal of the expired owner. It reads actual remaining rows, three batch receipts, two preparation receipts and an empty context table. All database changes roll back.

[Eight controls](prepare-controls.json) cover baseline, a harmless comment, unprepared writes, missing stop cleanup, missing tract cleanup, repeated cleanup, missing owner validation and restored behavior. Every broken variant fails. The repeated-cleanup variant encounters the duplicate receipt key, demonstrating that bypassing replay breaks successful retry; the intact path separately proves the new row survives replay. The earlier six direct-write controls also pass with operation-specific context. SQL and combined assertion hashes are retained.

This does not establish archive retention or parser restart. No archive fields change in this experiment, but stored-byte verification and admission recovery are not connected. Finalization, stage and artifact-custody commands, feed-pointer fencing, truncate restrictions and concurrent replacement/batch tests remain required. The synthetic tract is a cleanup fixture, not measured or computed transit coverage.

```bash
python3 docs/reviews/2026-10-09-gtfs-worker-ownership/verify_prepare.py \
  /home/nathaniel/.local/state/openplan/gtfs-recovery-http-20261009.json
```

## Replacement/batch overlap, October 9

The [overlap runner](verify_replacement_overlap.py) now executes the context-enabled batch and preparation commands against actual route rows in separate PostgreSQL processes. It observes the waiter blocked by the identified holder PID before allowing commit. Both orders pass:

- Old batch first: that transaction writes a row, then the fixture expires its lease before commit. The replacement waits, acquires ownership, prepares and writes its own batch. The final row belongs only to the replacement. Both batch receipts and both preparation receipts remain.
- Replacement first: that transaction claims, prepares and writes before commit. The old service-role batch waits and then receives SQLSTATE 55000. Only the replacement row and its batch receipt exist; both preparation receipts remain.

Baseline, harmless-comment and restored runs cover both orders. A missing-route-cleanup variant fails the actual row/history assertion. [Results](replacement-overlap-controls.json) identify the combined SQL hash, retained synthetic fixtures, observed waits and exact final counts. Every case checks an empty command-context table. The runner removes only its UUID-named triggers from the four public tables after the clients finish, and verifies their absence. Private prototype schemas and synthetic committed fixtures remain for inspection; no pre-existing trigger is replaced.

This is native database concurrency, not concurrent Node workers or HTTP transport. Claim admission uses the database-owner fixture, while the late old batch uses service_role. Expiry is a controlled fixture update. The test does not establish worker heartbeat timing, crash detection, archive recovery, end-user permissions or full ingestion. The same lifecycle and production-enrollment boundaries remain open.

```bash
python3 docs/reviews/2026-10-09-gtfs-worker-ownership/verify_replacement_overlap.py \
  /home/nathaniel/.local/state/openplan/gtfs-recovery-http-20261009.json
```

## Ready completion experiment, October 9

The [completion command](complete-prototype.sql) checks active prepared ownership and parsing status, compares the caller's expected manifest to that attempt's recorded batches, and reconciles actual route/stop counts with receipt totals. It requires a matching nonempty archive path, SHA-256 and byte count already stored on the version. It copies the explicit parser metadata fields, derives stored row counts itself, and writes ready status and a retained completion receipt atomically. A private transaction context permits the version update. Exact command replay returns the saved result even after ready; changed replay fails, and a new completion command cannot complete the terminal version again.

The [rollback suite](verify_complete.py) passes eight controls: baseline, harmless comment, omitted manifest check, changed replay allowed, omitted count check, omitted archive check, authenticated execution granted, and restored behavior. Assertions cover a manifest with an omitted entry, mismatched archive metadata, an extra stored route inside a rolled-back corruption fixture, terminal replay, caller permissions, receipt count and context cleanup. The version becomes ready without becoming current or changing the feed pointer. [Results](completion-controls.json) retain all input SQL and assertion hashes. Every schema and fixture change rolls back.

The archive is synthetic metadata in this test. Matching metadata is not proof that Storage has the object or that its bytes match the hash. The manifest is supplied by the trusted caller; this does not independently validate the parser's expected work or declared source counts. Parser warnings and schedule-derived distinctions remain explicit. Tract computation is unassessed in this experiment and its completion fields remain null. Populated tract computation, stored-object recovery, lifecycle admission/staging, completion over HTTP or after process loss, concurrent completion and human adoption remain open. No application version uses this prototype.

```bash
python3 docs/reviews/2026-10-09-gtfs-worker-ownership/verify_complete.py \
  /home/nathaniel/.local/state/openplan/gtfs-recovery-http-20261009.json
```

## Feed-pointer and truncate boundaries, October 9

The [pointer prototype](pointer-prototype.sql) refuses direct pointer changes involving a managed version, including insertion with that pointer and clearing an existing adopted pointer. It is deliberately closed until an adoption command with the existing collapse-review rules is implemented. The predicate checks both the previous and proposed pointer. It leaves unrelated feed updates and unmanaged pointers under existing behavior.

The prototype also revokes TRUNCATE on feeds, versions and the three derived service tables from PUBLIC, anon, authenticated and service_role. Row triggers cannot enforce a row-level managed boundary on truncation. The [runner](verify_pointer.py) checks PostgreSQL's effective privileges for all three runtime roles on all five tables; it never executes TRUNCATE. The permission changes roll back with the fixture and trigger.

[Six controls](pointer-controls.json) cover baseline, a harmless comment, a missing pointer guard, a guard ignoring the old pointer, a restored service-role TRUNCATE grant, and restored behavior. Each broken control fails for the intended reason. The completed-version fixture comes from the earlier batch/completion suite. A separate already-adopted pointer fixture is synthetic schema state, not a real ingestion or validated transit dataset. The test does not exercise admission concurrent with pointer changes, managed adoption, administrator maintenance, provider credentials or external Storage permissions. Those remain separate boundaries.

```bash
python3 docs/reviews/2026-10-09-gtfs-worker-ownership/verify_pointer.py \
  /home/nathaniel/.local/state/openplan/gtfs-recovery-http-20261009.json
```

## Application archive reader, October 9

`openplan/src/lib/gtfs/retained-archive.ts` adds a bounded reader for the exact private archive recorded for one workspace, feed and version. It validates canonical UUID scope, the existing object-key convention, a positive safe byte count and SHA-256 before I/O. It uses the installed Storage SDK's streaming download, checks every chunk against the declared size, and compares final size and hash. The helper accepts no publisher URL. It uses existing deployment archive/time limits, propagates cancellation and separately bounds stalled reads. It does not authorize the caller or establish lease ownership; the future worker must do both.

Eleven tests use the installed Supabase client with a controlled fetch transport. They cover exact object selection, wrong paths, declared oversize, altered/truncated/oversized bytes, missing objects, cancellation and a stalled-body deadline. Seven source controls pass or fail as intended: baseline, harmless comment, removed checksum comparison, removed path check, removed declared-size cap, wrong timeout classification and restored source. [Results](archive-reader-controls.json) identify the source hash. Scoped TypeScript and ESLint pass.

The SDK source in the installed dependency exposes `download(...).asStream()`. Its documented cancellation option is the third download argument; see the [official download reference](https://supabase.com/docs/reference/javascript/file-buckets-download). Existing model artifact reads use a scoped but fully buffered download, which does not supply this bounded stream/hash contract. The new helper uses the existing GTFS bucket and limits rather than changing the model reader or public-feed fetch policy.

This is application code but remains unconnected to import routes and workers. The controlled transport is not live Storage authorization, real publisher ZIP parsing, recovery after worker exit, or proof of memory bounds at the maximum feed size. Native Storage and worker integration are still required before claiming retained-byte recovery works end to end.

## Interrupted native archive verification, October 9

The interrupted native Storage experiment left the checksum comparison temporarily removed in this isolated checkout. The committed reader was unaffected. Recovery found no live verification process or retained proof container, restored the exact committed comparison, and confirmed that all 11 reader tests pass.

The new `verify_native_archive.py` runner writes each control to a unique disposable TypeScript file beside the reader. Relative imports remain valid, while the tracked reader stays unchanged throughout baseline, harmless-comment, missing-checksum and restored controls. The runner removes its candidate file on normal exit and checks that the tracked source still matches its starting contents. A forced process kill may leave a disposable candidate file, but cannot leave the tracked checksum check disabled.

`verify_native_archive.mts` uploads a real publisher ZIP to a synthetic private object, then starts a separate client to read and parse it. It checks same-size corruption, restoration and missing-object behavior. The runner is syntax-checked, but this native suite has no completed result yet. The isolated database is performing startup file synchronization after the machine restart and rejects connections. Do not interpret this runner or the earlier controlled-transport tests as live Storage acceptance. Identity handoff uses process environment, not a durable worker journal; application enrollment and end-to-end crash recovery remain open.

## Native retained-byte verification completed, October 9

The database finished recovery. The native suite now passes baseline, harmless-comment and restored controls. Removing the checksum comparison fails with `Changed archive was accepted`. [Results](native-archive-controls.json) retain source and runner hashes. A new client process reads the saved 892,312-byte BART archive from private native Storage and the production parser returns 14 routes and 287 stops. Same-size corruption is refused; restored bytes read successfully; a removed object returns unavailable. All four controls leave the tracked application reader unchanged, remove their synthetic objects and remove the owned Storage container.

An earlier full-object assertion attempted to format the returned ZIP bytes when the checksum mutation succeeded. The bounded verification service hit its 1 GB memory limit in that case. Assertions now compare the boolean result before the small error code, avoiding archive-byte diagnostics. The corrected service completes in 11.9 seconds with a journal-reported 172.6M memory peak under the same limit. Native Storage has a separate 512 MB limit. The earlier interrupted test in T3's process group coincided with a system-wide OOM killing a process with about 18.6 GiB resident anonymous memory; the matching checksum-control failure makes the diagnostic formatting the likely cause. No successful result is claimed for either interrupted run.

This proves retained-object reading and integrity checking with a real local Storage server and one publisher archive. It does not prove durable worker-journal recovery, database version enrollment, end-user RLS, largest-feed capacity or a full import journey. The process handoff supplies the identity through environment state. Those remaining boundaries still govern connection to the application worker.

## Independent parser process, October 9

The [parser supervision checkpoint](../2026-10-09-gtfs-parse-supervisor/VERIFICATION.md)
now runs the production parser in a separate Node process while the parent
renews through a bounded callback. It preserves descriptor-bound input/output,
verifies retained hashes, refuses uncertain ownership and waits for child
termination. Native CPU-blocking controls and the retained BART archive pass.
The callback is not yet connected to a database attempt; admission, lifecycle
commands, durable journals, guarded writes, adoption and planner journeys remain
required before the inline import doors move to managed execution.
