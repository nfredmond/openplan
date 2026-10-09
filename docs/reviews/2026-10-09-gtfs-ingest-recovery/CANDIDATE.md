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
- Ten native control runs cover baseline, harmless comment, status and freshness
  checks, version and derived-write fences, stop/tract trigger attachment,
  authenticated-role exclusion and restored definitions. Targeted defects fail
  their named assertions. Definitions are changed inside rolled
  back transactions.
- Seven HTTP adapter tests cover exact scan projection and cutoff, exact command
  payload, confirmed cleanup, declined cleanup, malformed results and RPC error.
  Six mutation runs cover baseline, harmless edit, ignored refusal, wrong version,
  malformed-result acceptance and restored source. Targeted defects fail assertions.
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
