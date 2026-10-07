# Atomic plan creation backend

October 7, 2026. This checkpoint prepares creation from the plan's own area and
staff-assessed responsible bodies. The existing HTTP route and creator still
use their older path and workspace-home restriction. This record does not claim
that the visible creation workflow has changed or that M1 is complete.

## Behavior

The new server helper accepts one exact command, scoped to the actor and
workspace. A fresh request checks the selected descriptor and reviewed hash,
assesses applicability, and resolves the selected or captured area. Configured
rules require a compatible assessment. The neutral descriptor preserves an
unresolved assessment. Neither path reads the workspace's office location.

The native transaction creates the plan, first working version, descriptor
sections, saved context, active-version pointer and private receipt together.
It rechecks and locks current write membership. A command lock serializes the
same workspace/command key. Exact retries return the original receipt before
another boundary lookup or comparison with newly installed descriptor rules.
Changed bytes, different authors and revoked write access cannot recover it.
The server checks the returned scope, assessment, place and descriptor identity.

The creation journal has RLS and no client policies. Only the service role can
read or insert rows and execute the invoker function. Existing append-only
protection rejects journal changes. An individual plan cannot be deleted while
its retained creation command refers to it, preventing an old retry from
creating the plan again. Deleting the owning workspace still cascades its
records. Archive and retention policy remain separate product work.

## Evidence

- [Unit and integration results](creation/integration-final.log): 64 tests pass
  across creation preparation, migration inventory, unread-column accounting
  and migration release notes. The creation suite contains 24 cases.
- [Installed native results](creation/native-installed.log): four suites pass
  for context persistence, draft revision, freeze and creation. All four now
  appear in `npm run test:rls-live`, which GitHub invokes. These local fixtures
  run inside rolled-back transactions on the isolated verification stack.
- [Initial controls](creation/controls/report.json): a passing application and
  native baseline, passing harmless changes, and 42 detected faults. These cover
  scope/projection, exact bytes, descriptor review, lookup/replay order, receipt
  substitutions, permissions, context, complete sections, activation and journal
  protection. Injected exceptions after each creation write prove rollback.
- [Deletion control](creation/deletion-controls/report.json): changing the plan
  foreign key to cascade lets individual deletion erase the command identity.
  The native assertion detects that fault. Baseline and harmless control pass.
- [Concurrency results](creation/concurrency/report.json): two simultaneous
  native requests produce one plan, one version and one command. One completes
  and the competing request receives a retryable conflict. Both explicit retries
  return the same receipt. Temporary-function controls detect removal of the
  command lock and membership lock. Installed and harmless versions retain them.
- [Accounting controls](creation/accounting-controls/report.json): baseline and
  harmless comment pass. Six faults fail for missing relation/table/RLS counts,
  undocumented and stale column entries, and an omitted migration note. Source
  bytes are restored after each case. Across these four records, 51 deliberate
  faults are detected.

The broader [land-use regression](creation/land-use-regression.log) passes 425
tests with four native suites skipped in that ordinary run. Those four pass
separately against the installed isolated database as recorded above.

TypeScript and changed-file ESLint pass. Knip exits zero with warning-level
unused exports/types, including the new error class that the route will use.
No ignore rule or artificial caller was added. The direction check passes with
its existing review reminders. No new production build or browser journey is
claimed for this backend-only checkpoint.

The [first native run](creation/native-first.log) failed because the fixture
tried to demote the only owner. The fixture now keeps the owner and exercises
revocation through another member. The [first TypeScript run](creation/tsc-first.log)
identified a fixture place type that needed parsing through the saved schema.
The [first integration run](creation/integration-first.log) found the missing
schema counts, three undocumented columns and missing migration note. Their
corrected results and the original failures are preserved.

## Database custody and limits

Migration `20261016000007` is installed only on
`supabase_db_openplan-restore-target-2026091050`, API port 29821 and database
port 29822. CLI 2.111.0 and PostgreSQL 17.6 remain unchanged. The native
[catalog read](creation/catalog.json) confirms 283 application tables, all with
RLS, 14 application views and 758 policies. Extension-owned relations are
excluded from those application counts.

The [post-install advisor](creation/advisor-after.log) reports the existing
PostGIS table without RLS, five functions with mutable search paths and three
extensions in `public`. The earlier advisor capture used an error-only filter;
it is not a comparable warning baseline. None of the listed objects belongs to
this migration. This is not a clean advisor result or a whole-database audit.
Current [function guidance](https://supabase.com/docs/guides/database/functions)
and [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
inform the invoker, grants and journal policy choices.

The saved control sources have `.txt` suffixes because they are historical
evidence. Creation and deletion controls insert the candidate migration inside
a transaction and require a stack where it is not yet installed. Do not rerun
them against this target. Do not set `OPENPLAN_CREATION_MIGRATION_PROBE=1` here.
The completed concurrency producer retains its synthetic fixtures and private
journal. Do not rerun it as a recovery step. The installed native suites are the
repeatable regression path.

Mocks prove server preparation and receipt checks, not database behavior. Native
tests prove the exercised transaction, grants and synthetic concurrency cases,
not HTTP authentication, browser retention, geometry-service availability,
legal sufficiency or practitioner acceptance. Static accounting guards inspect
declared schema and identifier use; they cannot prove runtime reads or policy
correctness. Selected-place replay verifies the original identity without a new
lookup. It does not independently attest external boundary accuracy.

Next, connect the existing creation route and form to this transaction, retain
incomplete drafts and exact requests by actor/workspace, and remove office-based
descriptor filtering. Identified HTTP and desktop/390px recovery journeys remain
necessary. Source-specific plan-kind rules and complete public/export treatment
also remain in M1 in the roadmap.
