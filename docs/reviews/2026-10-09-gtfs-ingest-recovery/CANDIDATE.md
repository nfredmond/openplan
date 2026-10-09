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
