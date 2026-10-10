# Managed GTFS queue and read checkpoint

The candidate adds three service-only read commands needed by the worker and its
future authenticated status route. It changes no route, worker or public API claim.

`list_gtfs_ingest_candidates` returns at most 100 version IDs in submission order.
It includes queued work and expired running attempts only when the public version
remains unfinished and the original submitter still has write access. Awaiting
uploads, live workers, ready/failed/cancelled executions and revoked submitters
are excluded. The list is a hint. It acquires no claim and grants no authority to
write; the existing claim transaction must recheck eligibility and ownership.

`read_gtfs_ingest_attempt` requires a retained claim for the exact version and
current write access for the original submitter. It returns that claim, current
execution state, immutable submitted source and archive identity, and that
attempt's own preparation, tract and completion records. An old claim can inspect
its retained history without receiving the replacement token or borrowing the
replacement's authority. Conversely, a replacement cannot borrow the prior plan.
The response's active flag comes from the same ownership predicate as writes.
The read does not renew a lease, claim work or change execution state.

`read_gtfs_ingest_status` permits a current workspace member, including a viewer,
to inspect a scoped import. It reports public progress, lease deadline, archive
confirmation, cancellation/failure details and blocked submitter access. It omits
worker tokens, prepared object identity and private submitted source arguments.
The future trusted route must derive the member identity from its session.
Anonymous and authenticated database clients cannot invoke these commands.

## Native evidence

[read-checks.sql](read-checks.sql) creates managed queued, awaiting-archive, live,
expired, completed, failed, cancelled and revoked-submitter cases. Real claims,
batches and completion commands establish the relevant states. Controlled owner
fixture edits simulate expiry, revoked membership and contradictory public state.
The queue filters those contradictions; the claim command remains an independent
protection against starting closed work. No real worker timeout is measured.

The suite verifies the bounded queue and its order, exact worker reads, foreign
claim refusal, completed receipts, viewer status, foreign workspace and nonmember
refusals, blocked submitter visibility, and absence of private fields. It compares
complete execution rows before and after reads. Replacement checks verify that
old history survives, the new token stays private, and a new attempt has no old
preparation plan. Client-role tests call otherwise valid reads so another error
cannot mask a permission regression.

[read-controls.json](read-controls.json) records 120 combined cases. Baseline,
harmless comment and restored source pass. The 117 deliberate changes fail for
the recorded reasons. Twenty new mutations weaken queue bounds or eligibility,
claim/membership scope, attempt history, status privacy or client execution.
Existing adoption-scope mutation matching is narrowed to its exact query now
that the status reader uses a similar predicate; it still detects the original
adoption boundary. No behavior assertion is dropped.

Every case rolls back, and a separate connection confirms candidate-schema
absence. The retained hashes identify the exact migration and combined assertions.
[The advisor comparison](read-advisor-summary.json) has the same 20 informational
new-index and private-table/no-policy notices as the terminal checkpoint, with no
new security warning, error or missing foreign-key index. Historical baseline
findings remain outside this bounded result.

## What remains

This is a database checkpoint outside v0.68, with no enrolled import route.
The TypeScript service must validate response identity and types, use bounded
requests and preserve exact command payloads in durable private journals.
Polling, renewal, parser supervision, retained-object recovery, row mapping and
all three admission routes still need connection.

The worker must settle or reconcile in-flight Storage writes after cancellation.
Cleanup must not acknowledge removal before a late upload recreates the object.
Managed and legacy promotion need a consistent locking path and native contention
proof. Committed restart recovery, upgrade/restore and identified desktop/390px
T3 journeys remain required. Native SQL reads do not prove these boundaries or
scientific, practitioner, public or v1 acceptance.
