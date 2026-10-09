# Atomic GTFS cleanup candidate

October 9, 2026. This checkpoint is not ready for release.

Migration `20261016000025` adds a retained abandonment timestamp and a
service-role cleanup function. The function locks the selected version,
rechecks its status, age and current-version relationships, removes derived
rows and changes its status within one transaction. A feed with a current
version keeps its existing status. Repeated or ineligible cleanup returns false.
The TypeScript sweep counts only confirmed cleanup and removes private bytes
only after that confirmation.

Version and derived-write triggers preserve abandonment after cleanup. Late
stage/completion updates and route/stop/tract writes cannot resume that attempt.
The changes do not infer process death from age. The existing fifteen-minute
policy remains; ownership, heartbeat and resumable worker migration remain M3
work. Storage cleanup and database closure are still separate operations.

## Checks at this checkpoint

- Native migration applies in the isolated full-schema clone.
- Ordered native proof preserves a completed/current version, closes a stale
  refresh once, preserves the working feed's status, and refuses late stage and
  route writes. The transaction rolls back.
- Eleven native control runs cover baseline, harmless comment, status and freshness
  checks, version and derived-write fences, stop/tract trigger attachment,
  authenticated-role exclusion and restored definitions. Targeted defects fail
  their named assertions. Definitions are changed inside rolled
  back transactions.
- Thirteen HTTP adapter tests cover exact scan projection and cutoff, exact command
  payload, confirmed cleanup, declined cleanup, malformed results and RPC error.
  Ten mutation runs cover baseline, harmless edit, ignored refusal, wrong version,
  malformed-result acceptance, ignored Storage/acknowledgment errors, skipped
  pending cleanup, malformed acknowledgments and restored source. Targeted defects fail assertions.
- Three existing GTFS files pass 86 tests, with 11 live tests skipped. Scoped
  ESLint passes. These skipped tests do not establish live application acceptance.

## Remaining verification

Four separate-session cases now observe actual PostgreSQL lock waits and pass:
completion wins, cleanup blocks derived writes, cleanup blocks stage writes, and
cleanup rolls back. Six concurrency controls include harmless change and
restoration; omitting the cleanup lock, version fence or derived-write lock fails
an assertion. Synthetic committed fixtures remain only in the isolated clone.
The native ordered proof also covers late stop/tract writes, fresh versions,
noncurrent ready versions and function execution permissions. The existing
write-policy guard and adapter pass thirteen tests together.

Exercise the actual TypeScript/PostgREST path
against the native function, and interrupted Storage cleanup. Confirm route
behavior when a late worker hits the fence, applicable static write-policy
inventory, upgrade/order checks and the complete relevant test gate before
landing. No browser, long-feed capacity, worker restart or V1 acceptance follows
from these bounded controls.

The older counterexample remains historical evidence. Its raw statements do not
call the new function; use `verify-recovery.sql` and
`verify_recovery_controls.py` for the candidate behavior.

## Durable private-file cleanup follow-up

The first actual TypeScript/PostgREST check reproduced an additional interruption
problem: a Storage error was ignored after database closure, and the next sweep
never retried it. `http-interruption-counterexample.json` retains that result.

The cleanup transaction now writes a service-role-only pending object record.
That record survives version deletion and process loss. A sweep also processes
pending objects when it finds no stale versions. It acknowledges removal only
after Storage succeeds. Storage failure or acknowledgment failure surfaces an
error and leaves the record available for retry. No public role can read or
change pending paths.

`verify_http.py` creates fresh synthetic records and a restricted schema in an
explicit owned clone, then uses the production TypeScript through PostgREST.
`http-recovery-result.json` records an injected Storage 503, a subsequent retry
with no stale versions, and a final empty pass. Database calls are native;
Storage responses are simulated. The gateway is loopback-only and removed after
the proof. This does not prove an actual Storage object's removal, full-catalog
PostgREST capacity or browser operation. The native ordered proof checks atomic
pending-record insertion; omitting it fails its named assertion. Adapter checks
also cover lost cleanup acknowledgment and retry.

The write-policy guard initially rejected an acknowledgment delete without a
returned row. The candidate now requests the deleted version ID and validates
its identity and cardinality. An empty result is explicitly permitted when a
concurrent sweep has acknowledged the same request. Adapter tests reject null,
wrong-ID and duplicate acknowledgments; removing this guard fails a mutation
control. The existing write-policy guard passes after the correction.

The complete amended migration also applies to a fresh clone containing one
promoted synthetic feed, one version, one route row and one stop row. Exact
before/after JSON comparison preserves every existing value, excluding only the
new nullable abandonment field, which remains null. `upgrade-result.json`
records that narrow upgrade and the migration digest. It is not a representative
agency-volume upgrade or proof of every intervening migration combination.

## Native private Storage follow-up

The new native Storage controls supersede the simulated-only object-removal
boundary above. A resource-limited Storage service uses the same owned database
clone as the PostgREST proof and its own temporary file directory. The copy had
no GTFS bucket: the initial check stopped, then the harness created and verified
a private test bucket through Storage's API. No shared bucket was used.

The production TypeScript uploads synthetic bytes, downloads and compares them,
then closes the stale ingest. One control injects a 503 before object deletion;
another interrupts the database acknowledgment after real object removal. Both
recover from the retained cleanup request. Repeating deletion of the missing
object succeeds, the acknowledgment clears, and a final sweep performs no
removal. A native authenticated download confirms the object is absent.

Six runs cover baseline, harmless source change, acknowledgment interruption,
omitted object removal, ignored acknowledgment error and restored source. The
two targeted defects fail assertions. `native-storage-controls.json` retains
the outcomes. Each run removes its owned Storage and PostgREST containers; no
service is left running. Source mutations restore in `finally`.

These are small synthetic objects, not a complete parsed feed or capacity test.
The interruptions are injected HTTP responses, not host power loss. Fresh worker
process recovery, late-worker route behavior, final CI and the remaining M3
worker/long-feed work remain separate. This does not establish V1 acceptance.

## Closed-attempt request follow-up

Inspection found that the ingest ignored stage-update failures, and the stage
helper treated a database error as confirmed progress. Stage updates now require
both no error and a returned row. The same rule applies when linking uploaded
bytes to the version. A refused or unconfirmed write returns an ingest failure
before further fetching or parsing. The existing failure path receives the
uploaded object path when one exists.

Five focused tests cover refused fetching, parsing and object records, database
refusal and a missing stage row. Eight mutation runs include harmless change,
restoration, ignoring each of the three refusals, and misreporting the stage or
object database error. All targeted defects fail assertions. The failure handler
is mocked in these tests; they do not prove its independent cleanup behavior.
Four existing route/ingest files pass 64 tests. A separate native HTTP/Storage
run now attempts a stage update after cleanup: PostgreSQL returns `55000` and
the production helper returns false. `native-stage-refusal.json` records it.

Scoped TypeScript and ESLint pass. Migration inventory has no duplicate or
invalid names. The release-ordering check initially found the missing migration
changelog entry; operator instructions now name migration 25. Release ordering,
write-policy and GTFS claim-boundary files pass 69 tests. Old comments that
claimed serverless deadlines prove local process death have been corrected.

These checks cover separate route, orchestration and native persistence layers.
They do not replace an identified-build browser journey. Final current-head CI
and T3 workflow acceptance remain open before landing this visible error-path
change. Long-running workers, actual process termination and complete M3 remain
outside the completed evidence.


## Late failure receipt correction

A native PostgreSQL abandonment fence rejects a late failure update with code 55000. The helper previously returned `recorded: true` despite that error. It now requires an error-free version update before reporting a recorded failure, and an error-free feed update before reporting a changed feed status. Zero-row responses still report false.

`failure-receipt-counterexample.json` retains the original native refusal with the false success receipt. `failure-receipt-fixed.json` retains the same refusal with the corrected false receipt. Run `failure-receipt.py` with the isolated proof configuration path; it creates only synthetic records in the named proof database and removes its temporary gateway. The measurement does not prove normal route authorization, successful cleanup or interruption recovery.

Five adapter cases cover both error and zero-row responses plus a successful feed update, including exact read/write projections. All 23 receipt, reaper and ingest-closure cases pass. The five control runs in `failure-receipt-controls.json` include a harmless comment and separate targeted removal of each error check. Both broken variants fail; restored source passes. Scoped TypeScript and ESLint pass. The existing failure cleanup still uses separate operations and remains outside the atomic reaper guarantee. These receipt checks do not make that cleanup resumable or prevent its other races.


## Normal failure cleanup remains a release boundary

`normal-failure-current-counterexample.json` records a production-helper reproduction at commit `62a618abe`. The BART archive passes parsing, native writes and promotion in a fresh synthetic workspace. Calling the normal failure helper afterward deletes all 95 route rows and 717 stop rows and leaves the version `failed` while `is_current` remains true. The source archive hash matches the retained BART profile. This is a late-call ordering reproduction, not evidence of an observed user incident or a parallel process race. The test affects only the owned proof database.

The reaper repair does not close this separate path. Do not describe all GTFS failure cleanup as atomic or safe for completed versions. The earlier boolean receipt correction reports SQL errors correctly but does not prevent this successful destructive sequence.

`normal-failure-closure-prototype.sql` proposes a locked transaction for unfinished versions only. It preserves current and noncurrent ready versions, queues object removal before closure, removes partial derived rows and fences subsequent stage and derived writes. `verify_normal_failure_prototype.py` applies the prototype and fixtures inside rollback transactions. Seven runs include a harmless comment and targeted removal of ready-version protection, route cleanup, the stage fence and the derived-write fence. Each broken case fails for its stated reason; the restored prototype passes. No production schema changed.

Before wiring this prototype, verify invalid object paths and failure codes roll back all effects, exercise concurrent completion/cleanup with separate connections, define lost-response retry receipts, and test Storage acknowledgment recovery through the normal failure caller. Then add the reviewed migration, replace the TypeScript multi-call cleanup and update its existing live tests without weakening retained-ready behavior. The current live test deliberately fails a ready noncurrent version; that expectation must change because a finalized version can be waiting for human adoption. Unfinished partial-row cleanup still needs its own case. Keep the full T3 workflow and exact-head CI gates open. The prototype does not supply a resumable GTFS worker.


## Candidate integration of normal failure closure

Migration `20261016000026_gtfs_failure_closure.sql` and the production failure helper now connect the proposed transaction. This supersedes the preceding prototype-only status, while retaining its counterexample. The migration stores an immutable request/result receipt with the closed version. Exact retries return the saved receipt; conflicting requests return an unrecorded outcome. Ready versions remain unchanged. Private-object deletion is queued for the existing scheduled sweep, rather than attempted before database closure.

Eight rollback-only migration control runs pass, including targeted removal of exact retry recovery. Six adapter controls pass, including a harmless comment, wrong version identity, false success and discarded confirmed receipts. Forty-seven targeted cases pass, with eleven native-suite cases skipped by that invocation. Separate native HTTP evidence in `normal-failure-current-fixed.json` shows the actual production helper preserving all 95 BART route rows and 717 stop rows, with the version still ready and current. The native migration controls run before applying migration 26; rerunning them requires an owned proof database without migration 26. The native HTTP check requires migration 26. Source hashes identify the measured candidate.

The live persistence test now preserves a finalized noncurrent version on late failure, matching the native ready-version controls. It no longer treats a finalized refresh as partial data. A dedicated unfinished partial-row live case remains needed. Scoped TypeScript and ESLint pass; 63 write-policy and GTFS claim-boundary tests pass. Full checks and T3 acceptance remain pending.

Do not merge yet. Native multi-session contention, invalid-input rollback, normal-failure Storage interruption and lost HTTP response recovery still need direct checks. The receipt replay check is sequential SQL, not a process crash test. The production route still returns the original failure response after a closure refusal; browser recovery of an already-ready version remains unverified. There is still no resumable GTFS worker.


## Normal failure concurrency and rollback evidence

`verify_failure_concurrency.py` uses separate PostgreSQL sessions on the owned migrated proof database. It observes `pg_stat_activity.wait_event_type = Lock` before releasing each holder. Completion wins against waiting cleanup; committed closure rejects waiting derived and stage writes; rolled-back closure permits the waiting derived write. Native readback checks the version state, closure fence and actual route count. Six control runs include a harmless comment and targeted removal of the version lock, stage fence and derived fence. Each targeted change fails and the restored definitions pass. The runner restores the original definitions in `finally`; this is not a power-loss recovery guarantee for the runner itself. The synthetic records remain in the isolated proof database.

`verify_failure_rollback.py` uses rollback transactions to check two boundaries. An object path outside the version's deterministic private key is refused without changing rows or queue state. A temporary trigger then rejects the final version update after observing that partial-row deletion and object-queue insertion have occurred. The transaction restores the partial route, pending feed and parsing version, and leaves no closure receipt or cleanup request. Five control runs include a harmless comment, removed object-scope validation and a removed injected refusal. The latter control proves the rollback check actually depends on exercising the failed update. These checks do not establish validation of every possible failure-code string or every SQL constraint.

This evidence closes the listed lock-contention and tested rollback boundaries. Normal-failure Storage interruption, lost HTTP response recovery, the dedicated unfinished-version live case, final-head CI and T3 workflow acceptance remain open. No browser or full-worker claim follows from these SQL checks.
