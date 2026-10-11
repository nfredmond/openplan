# Recurring transit archive cleanup

October 10, 2026. Unreleased candidate migration 28 and application sweep.

Cancelling or deleting a transit import must not leave its late-arriving upload
behind. The [previous native counterexample](LATE_STORAGE_UPLOAD.md) showed why
one successful deletion response cannot finish that job. The application now
retains authorized deletion keys and revisits them in bounded batches.

The private `openplan_gtfs.retired_archives` ledger survives queue acknowledgment,
version deletion and workspace deletion. It stores the version ID, canonical
object key and scheduling timestamps. Cleanup requests, closed versions and
version deletion retain keys. Deterministic keys also cover legacy uploads that
have not yet recorded `storage_path`. Migration backfill retains existing cleanup
requests and closed versions. Historical deleted versions with no surviving key
cannot be reconstructed from this evidence.

`reconcile_gtfs_storage_cleanup` selects at most 200 ledger entries, using an
index on their last selection time. It requeues known files found in Storage
metadata or an existing request, and excludes live, ready and current versions.
Selection advances before API work so repeated failures do not monopolize the
first page. A worker lost after selection retries that key on a later rotation.
The app deletes bytes through the Storage API, acknowledges individual requests,
continues the remaining selected files after a failure and then reports the
failure. Acknowledgment does not erase the ledger. Unknown keys stay untouched.

## Verification

The [native runner](verify_archive_reconciliation.py) calls the actual application
sweeper through fresh Node processes, PostgREST and Storage 1.67.20. Four uploads
pause after bytes reach the file backend, then finish after cancellation, feed
deletion, workspace deletion or legacy abandonment. Each late object downloads
with the publisher fixture's original hash before the next sweep removes it.
Subsequent sweeps make no unnecessary removal calls for the absent objects.
Three additional cases preserve the exact bytes of pending, ready and unrelated
files. The ready fixture is synthetic legacy metadata, not a parsed or adopted
planning result. The legacy abandonment cutoff is advanced explicitly.

The final native run takes 14.6 seconds with a service-reported 94.8 MB memory
peak. Its Storage and PostgREST containers have separate limits. Temporary
containers and files are removed before the runner publishes success. Owned
database clones remain available for inspection. See [native results](archive-reconciliation-native.json).

The [SQL controls](archive-reconciliation-sql-controls.json) cover key identity,
scope, lifecycle protection, deletion custody and rotation through 205 retained
keys. Baseline, harmless-comment and restored runs pass; 11 changed behaviors
fail their intended assertions. These checks roll back on the isolated main
schema and independently confirm candidate-schema removal after each case.

The [application controls](archive-reconciliation-app-controls.json) exercise
the installed SDK transport and strict response decoding. Baseline, harmless
comment and restored runs pass; six changes to path, version, page-size,
duplicate, extra-field and continue-after-failure behavior fail. A first path-shape test also triggered
the version-suffix check, so it was corrected to isolate the stated condition.
These transport fixtures do not substitute for the native object checks.

The existing [121 lifecycle controls](archive-reconciliation-regression.json)
still pass or reject their targeted changes as intended. The official CLI
[populated upgrade](archive-reconciliation-upgrade.json) moves exact main from
399 to 400 migrations, preserves every recorded row in six GTFS tables, leaves
old imports unenrolled and makes no changes on a repeated migration command.
This fixture does not cover every historical installation or an empty install.
The pinned [advisor comparison](archive-reconciliation-advisors.json) adds 22
informational findings and no warnings, errors or missing foreign-key indexes.
Existing findings are not cleared by this comparison.

The broader GTFS run found an older source guard treating the private parser
decoder as a request schema. The guard now permits only that private `level`
schema, verifies that it is not exported, and restricts the decoder's current
consumer to the publication worker. [Controls](parser-schema-controls.json)
keep baseline/comment/restored cases passing while rejecting a new request
shape, an exported level schema and an API import of the decoder. This remains
a literal source check, not complete runtime data-flow analysis.

The final [GTFS and related guard run](archive-reconciliation-tests.json) covers
37 files: 969 tests pass and 17 live-database opt-in tests remain skipped. The
separate native checks above cover their stated cases only. Scoped TypeScript,
ESLint, Python compilation, product-direction and diff checks pass. The final
serial application check service peaks at 394 MB under a 1 GiB cap. Full branch
CI, live RLS, worker and archive-restore release checks remain separate.

## Remaining workflow

This fixes recurring cleanup for recorded deletion keys. It does not prove
provider-internal orphan recovery, an unbounded bucket's operating capacity,
real-clock abandonment, browser usability or practitioner acceptance. The ledger
is intentionally retained and must travel with database backups. Selection time
is not a claim that deletion succeeded or that a file can never reappear.

Source fetching and upload reconciliation still need to connect all existing
import doors to the managed worker. The next planner journey is a transit feed
import, intelligible progress/failure/retry, retained source, service coverage
and project-geography review. Managed routes remain disabled pending that work
and the remaining branch, restore and T3 acceptance checks.
