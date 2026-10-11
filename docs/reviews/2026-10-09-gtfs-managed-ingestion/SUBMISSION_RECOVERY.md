# Transit submission custody and paginated discovery

October 10 candidate checkpoint. Routes remain synchronous and unenrolled.
Migration 28 remains unreleased. This work does not establish planner, browser,
full restore, capacity, CI or release acceptance.

`managed-admission.ts` binds the exact request intent to installation, database,
workspace, original actor and request UUID before catalog resolution. It retains
the resolved feed/source choice for later replay. ZIP bytes reach a private,
exclusive file with file and parent-directory synchronization before admission.
Replay verifies actual local size and SHA-256, current SQL authorization and the
exact original receipt. Immutable upload uses explicit transport cancellation,
`upsert: false`, and actual remote size/hash reconciliation before confirmation.
An uncertain reply preserves its request identity instead of creating a second
version or declaring completion.

The queue now uses a service-only UUID cursor scan. Discovery wraps in UUID order
and advances over considered candidates independently of retained-job recovery.
A persistent refusal on the first page does not prevent later candidates from
being considered. Older root journals retain their jobs and acquire a null
initial discovery cursor. The original candidate-list API remains available.

## Evidence

- [Submission controls](submission-controls.json): four positive runs and 30
  intended assertion failures. Baseline, harmless comment, harmless removal of
  a redundant relative-path check, and restored source pass. A normalized
  relative-path bypass fails. Controls restore source in `finally`.
- [Native submission recovery](submission-native.json): six process interruption
  cases use actual PostgreSQL, PostgREST and Storage. ZIP recovery needs no client
  resupply and publishes 95 route rows, 717 stop rows and one completion without
  adoption. URL/catalog recovery preserves original metadata and remains queued.
  Each case rejects original-actor replay after a real downgrade to viewer.
- [Paginated queue controls](paginated-queue-controls.json): three positive runs
  and 31 intended failures. [Client controls](scan-client-controls.json): three
  positive runs and five intended failures. Each restored source passes.
- [Native scan controls](queue-scan-native.json): three positive runs and six
  intended failures cover ordering, cursor wrap, membership, lease, archive-state,
  row bounds and service-only grants. Three eligible records remain distinct from
  revoked, live-lease and unconfirmed archive records.
- [Repeated native queue recovery](paginated-queue-native.json): live-attempt
  recovery and actual server-clock expiry replacement pass on the revised scan.
  The stale token cannot renew or stage during its successor. Neither case
  refetches the publisher or adopts its version.
- [Existing lifecycle controls](paginated-lifecycle-controls.json): all 121
  expected outcomes remain, including three positive controls and 118 intended
  failures. The runner isolates duplicated scan predicates when mutating the
  original list function; it does not weaken either predicate.
- [Scoped regression](submission-tests.json): 52 files, 1,292 tests, 1,275 pass,
  17 live-database tests skipped, zero fail. One worker takes 67.5 seconds and
  peaks at 417.1 MiB within a 1 GiB service. Scoped TypeScript takes 4.9 seconds,
  peaks at 409.1 MiB and passes. Changed-file lint passes separately.

Earlier proof attempts exposed harness problems rather than passing evidence:
scan creation occurred after the gateway schema cache started; a constant SQL
ORDER BY mutation used invalid syntax; the original lifecycle runner matched a
now-duplicated scan predicate; a viewer fixture violated the last-owner floor.
The final runners correct those setup faults and preserve the corresponding
policy checks. A local-file synchronization observation now checks the parent
sync after linking, so an earlier sync cannot satisfy it.

The native fixtures use a retained main-derived database with 399 recorded
migrations and candidate DDL applied separately. They are not an official fresh
installation or a complete backup restore. Local Storage and HTTP do not prove
public DNS/TLS. Admission recovery still requires retained local ZIP bytes; a
missing local copy is a visible refusal. Polling retained submissions, route
progress/cancellation/retry/review/adoption, cleanup, full upgrade/restore,
capacity, live roles, T3 desktop and 390px journeys, and GitHub CI remain open.
Draft route helpers and migration 29 are excluded from this checkpoint.
