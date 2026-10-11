# Managed GTFS failure and cancellation checkpoint

A service-only worker command now records terminal failure under current attempt
ownership. A separate service-only cancellation command requires a current
workspace writer. Another authorized writer can cancel after the original
submitter loses access. Neither command can close a ready or current version.
The future route must derive the cancelling actor from its authenticated session.
No route or worker calls these commands yet.

Both commands retain exact request receipts and recheck current membership before
replay. A changed command fails. An exact replay returns the saved decision without
repeating deletion or closure, including after individual feed deletion. Workspace
deletion removes terminal receipts. Worker failure resolves the original actor
from the retained submission rather than accepting a caller-supplied actor.

The commands reuse the existing atomic failure closure. It deletes partial route,
stop and tract records, records failed status and closure time, and queues the
version's deterministic private archive for removal. Prepared uploads are included
before archive confirmation, since an object write may have succeeded without its
reply. An unprepared URL import creates no fabricated object path. A ready current
feed and its loaded timestamp remain unchanged. The execution releases its token,
lease and preparation marker, so the closed import cannot be claimed again.

Cancellation remains distinct in execution state and its receipt. The existing
public version status is `failed` with failure code `abandoned` and the supplied
reason. No new public failure-code vocabulary is introduced. The future UI must
read and display the cancellation outcome explicitly. The receipt's cleanup flag
records the decision at closure, not current Storage state.

Private transaction context authorizes only deletion of this version's derived
rows during termination. It does not require a live worker lease for a person's
cancellation. Context requires the exact transaction, version, kind and DELETE
operation; it cannot authorize an UPDATE. Runtime roles cannot write that context.
Every statement remains inside the enclosing command transaction.

## Native verification

[terminal-checks.sql](terminal-checks.sql) adds actual PostgreSQL role calls to the
combined admission, batching, completion and adoption suite. Synthetic unfinished
imports use the real managed commands and real route, stop and spatial tract rows.
The proof covers worker failure after replacement, current-worker cancellation,
unconfirmed-upload cancellation, queued-URL cancellation, exact/changed retries,
viewer and foreign-workspace refusals, membership revocation, ready-version
protection, retained cleanup paths, zero remaining partial rows, preserved current
feed, closed execution fields, client-role denial and receipt recovery after feed
deletion. Expiry and revocation are controlled fixture changes, not a killed worker.

[terminal-controls.json](terminal-controls.json) records 100 cases. Baseline,
harmless comment and restored source pass; 97 targeted changes fail at their
recorded boundary. New controls remove scope, permission, ownership, payload and
failure-code checks; change reason bounds; omit prepared archive cleanup; fail to
close execution state; weaken each deletion-context predicate; grant client
execution; or accept a refused underlying closure.

The readiness control reaches the older closure's independent refusal when its
new early guard is removed. It tests the exact refusal boundary rather than
claiming that guard removal alone destroys a ready version. The closure-result
check temporarily substitutes a synthetic refusal, tests the command, then restores
the original function inside the same rollback transaction. Context controls use
database-owner fixture writes, then make the actual attempted mutation as
service_role. This isolates predicates that runtime clients cannot ordinarily
forge. Client-role controls use valid matching receipts for each operation so a
changed-payload guard does not mask an unintended execution grant.

All cases roll back candidate schema and fixtures. A separate connection checks
schema absence after every run. The hashes in the final record identify the source
and combined assertions. Earlier checkpoint records remain historical.
[The advisor comparison](terminal-advisor-summary.json) adds 20 informational
unused-index or private-table/no-policy notices against the retained baseline.
It adds no security warning, error or missing foreign-key index. Existing baseline
findings are not cleared by this result.

## Unfinished integration

These are database commands, not process cancellation or confirmed object removal.
A Storage upload already in flight may finish after database cancellation. Before
route enrollment, the worker must stop and join its child, settle or reconcile
external writes, and prove that cleanup cannot acknowledge removal before a late
write recreates the object. The existing cleanup queue alone does not prove this.
No process, network or browser interruption is simulated by these SQL controls.

Queue/read commands, durable worker journals, actual lease renewal, worker and
route integration, unified locking with legacy promotion, committed contention
and restart recovery, upgrade/restore, and desktop/390px T3 journeys remain open.
This candidate stays outside v0.68 and has no merge-ready PR. Scientific,
practitioner, public and full v1 acceptance are unchanged.
