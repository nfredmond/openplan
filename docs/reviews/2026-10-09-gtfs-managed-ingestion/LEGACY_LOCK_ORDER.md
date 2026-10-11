# Consistent feed locks for legacy and managed GTFS operations

Legacy promotion, stale reaping and failure closure can deadlock with managed
adoption or cancellation. The October 10 native proof reproduces all three
cycles. The unpublished candidate migration now replaces the three legacy
functions so they acquire the feed lock before the version lock, matching the
managed functions. Released migration files remain unchanged.

Each replacement first reads the version's feed identity without locking the
version. It locks that feed, then rereads and locks the version with the same feed
identity. A missing or moved version is refused after the wait. The changes retain
ready-only promotion, current-version uniqueness, cleanup scope, failure receipts,
function security mode and existing execute privileges.

## Native interleavings and controls

[The lock-order record](legacy-lock-native.json) contains 27 cases and identifies
the migration, proof runner and original installed functions by SHA-256. Every
fixture lives in a new owned clone. Operations run as `service_role`; a separate
privileged observer reads PostgreSQL wait state and blocking backend identity.

The proof pauses the managed transaction at its feed lock, then starts the legacy
call. PostgreSQL confirms that the legacy call waits on that exact transaction.
The managed call then proceeds through its actual adoption or cancellation
function. With the original legacy definitions, all three pairs produce native
`40P01` deadlocks. With the replacements, promotion leaves one current ready
version, while cancellation closes the managed attempt and the delayed legacy
cleanup refuses it without changing the closure.

Fixed, harmless-comment and restored definitions pass all three interleavings.
Reversing one function at a time reproduces the cycle and fails the intended
`Mixed lifecycle deadlocked` assertion. Those three deliberate failures are
separate from the three initial counterexamples.

Twelve further cases move an unmanaged fixture version to another feed while
its legacy call waits. Fixed, harmless and restored definitions refuse at the
association recheck and leave the moved version otherwise unchanged. Removing
each function's association predicate fails the intended assertion. For promotion,
a later database constraint may also reject the mutation; the test specifically
requires refusal at the association recheck rather than treating another error
as proof of that guard.

The initial runner needed two corrections: execute parameter-free function DDL
without interpreting PL/pgSQL percent signs as Python placeholders, and observe
backend waits through a connection with sufficient diagnostic visibility. The
retained run repeats the counterexamples and all controls after both corrections.
No interrupted harness run is counted as a pass.

These tests establish the specified interleavings, not every direct SQL caller,
reverse initial schedule or load pattern. They do not measure browser behavior
or large-feed throughput. The final control service completes in 6.8 seconds
with a 23.3 MB peak; that excludes PostgreSQL container memory.

## Regression and upgrade evidence

- [Lifecycle SQL controls](legacy-lock-regression.json): all 121 expected outcomes,
  comprising three passing baseline/harmless/restored runs and 118 intended
  failures. Admission, claims, archive identity, batches, completion, adoption,
  material-shrinkage review, termination and private reads remain covered.
- [Populated CLI upgrade](legacy-lock-upgrade.json): 399 main migrations to the
  400-migration candidate, exact preservation of all existing rows in six GTFS
  tables, unchanged repeat migration and no automatic enrollment. Three data
  mutations fail; baseline, harmless and restored controls pass.
- [Native worker recovery](legacy-lock-recovery.json): actual Storage, parser,
  PostgREST and PostgreSQL still recover completion and first-batch reply loss
  after process-group termination. Stored results remain 95 route rows, 717 stop
  rows and nine receipts, with the native HTTP refusals and SQL observation
  controls retained.
- [Pinned advisor comparison](legacy-lock-advisors.json): no new warning, error or
  missing foreign-key index. Twenty new informational notices concern unused
  indexes or intentionally policy-free private tables. The 1,651 baseline
  findings are not cleared by this comparison. [Advisor controls](legacy-lock-advisor-controls.json)
  confirm a harmless change passes and an unprotected public table causes the
  intended assertion failure; its transaction rolls back before reporting.

All retained records identify the final candidate migration hash. Python
compilation, diff checks and the product-direction check pass. Existing review
reminders remain unchanged. The full application, worker and live RLS gates have
not been rerun for this branch checkpoint; native function privileges and the
specified lifecycle boundaries above are the checked scope. No PR, main merge
or release is declared.

The new cases use the existing bounded proof stack. Reproduction entry points
are [the concurrency runner](verify_legacy_lock_order.py),
[the lifecycle runner](verify_admission.py),
[the upgrade runner](verify_worker_upgrade.py),
[the worker runner](verify_worker_database.py) and
[the advisor runner](verify_migration_advisors.py). Native stack helpers require
`OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER` to name the owned restore-target container.
Each run needs its declared isolated configuration and a fresh private output
directory. The concurrency runner requires the retained pre-fix candidate so it
can reproduce the original definitions; it restores the verified definitions
only in its new private clone.

## Remaining work

Connect source intake, uncertain and late Storage-write reconciliation, local
orphan cleanup, adoption/recovery and queue polling. A complete replacement
worker journey, operating budgets, full branch checks, archive restore and
identified T3 desktop/390px journeys remain open. The managed import routes are
still unenrolled. Scientific and human acceptance and the full v1 contract remain
separate requirements.
