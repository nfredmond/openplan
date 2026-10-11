# Current-main upgrade and replacement ownership

This October 10 checkpoint gives the native worker proofs a recorded migration
path through current main. It also verifies that a replacement attempt excludes
stale writes in both observed database lock orders. No application behavior or
candidate SQL changes in this checkpoint.

## Recorded migration path

The [upgrade record](worker-current-main-upgrade.json) identifies main commit
`0091e284f8a6d3ba0db7fcffe4ca2dc877a727c4` and every migration file by SHA-256.
The runner clones an owned predecessor with 393 recorded migrations through
`20261016000021`. It confirms that the later recovery and GTFS cleanup tables
are absent before cloning. No source connection is interrupted.

Supabase CLI 2.111.0 applies the exact main files through migration 27. The
resulting ledger contains all 399 main migrations in order. The runner seeds
one feed with five versions: ready/current, pending, fetching, parsing and
failed. The ready version has actual route and stop rows. A second clone then
receives candidate migration 28 through the CLI and records all 400 migrations.
A repeat CLI run makes no change.

The comparison includes every column of every row in six GTFS tables, including
current pointers, generated geometry, historical counts and timestamps. All
existing rows remain identical. No pre-existing import is enrolled into managed
execution. Baseline, harmless-comment and restored controls pass. Three altered
migrations fail the intended assertion by changing the feed name, deleting an
existing route or rewriting an existing version's status. Each control rolls
back. The source main clone remains at 399 migrations with no candidate schema.

This is a populated synthetic GTFS upgrade from a retained recorded predecessor.
It is not an installation from an empty Supabase platform, full archive restore,
or proof for every deployment's existing data. The earlier 393-record fixture
with manually applied GTFS DDL remains a separate historical proof; its evidence
is not relabeled as this run.

## Worker recovery on the main-derived schema

[The repeated native record](worker-current-main-native.json) uses a clone of that
399-migration main database. It applies the unchanged candidate SQL directly in
the disposable clone. Candidate SQL and application hashes match the separate
CLI upgrade and prior implementation.

Both completion-reply and first-batch-reply loss pass again. The processes use
actual PostgREST, Storage, the production parser child and the private journal.
Recovery preserves 95 route-service rows, 717 stop-service rows and nine batch
receipts. The six native HTTP refusals and nine independent SQL observation
controls also pass. See [the original procedure](WORKER_DATABASE.md) for their
scope and failure controls.

The main-derived run completes in 16.5 seconds with a 150.9 MB worker-service
peak. Storage and PostgREST have separate limits, so this is not combined memory
usage or largest-feed capacity. Its private clone and journals remain available;
owned HTTP services and fixture Storage objects are removed.

## Replacement ownership under contention

[The replacement record](worker-replacement-native.json) uses the database with
all 400 CLI-recorded migrations. Commands execute as `service_role` through two
independent PostgreSQL connections. The observer confirms `Lock` waiting and
the expected blocking backend, rather than assuming contention from timing.

When an old batch holds the transaction first, a replacement claim waits. After
the old transaction commits with its synthetic lease explicitly expired, the
replacement receives attempt two and clears the prior derived row before writing
its own. When the replacement claim holds the transaction first, a late old batch
waits and then receives `55000`, naming the ownership refusal.

In both cases, the old token cannot renew. Reading its original claim preserves
attempt one with inactive ownership. The replacement removes exactly one old
route row and retains exactly its own replacement row. Later old writes remain
refused, and transaction write contexts are empty. A harmless observation control
passes; an actual stale-row corruption fails the intended assertion in a rolled
back transaction. Restored rows pass again.

The first fixture omitted required batch fields. The next reused one source URL
for distinct feeds in the same workspace and hit the unique-source constraint.
Both setup defects were corrected before the retained passing run. Neither is
counted as a successful concurrency test or treated as a product defect.

These cases explicitly advance only synthetic lease timestamps. Archive metadata
is synthetic in this SQL test. The cases do not prove real-clock expiry, HTTP
contention, Storage custody or a complete replacement worker journey. Native
Storage and same-claim worker recovery are covered separately above. Installed
function hashes and proof-source hashes accompany the record.

## Next work and remaining boundaries

Legacy promotion, stale reaping and failure closure acquire version locks before
updating or locking the feed. Managed adoption and termination lock the feed
first. Replacement serialization does not close that mixed-path lock-order risk.
Reproduce those interactions and align their locking while preserving readiness,
material-shrinkage review, current-version uniqueness and cleanup receipts.

URL/catalog intake, uncertain and late Storage writes, local orphan cleanup,
adoption/recovery, queue polling, operation budgets, full branch CI, archive
restore and identified T3 desktop/390px journeys remain unfinished. No managed
import route, main merge or release is declared here. The full v1 contract and
scientific and human acceptance requirements remain unchanged.
