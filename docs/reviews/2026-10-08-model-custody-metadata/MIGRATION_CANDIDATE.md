# Model attempt schema candidate

October 8, 2026. This prepares the M3/S1 command foundation. It does not activate
attempt-aware workers, relaunch routes or scientific ingestion.

## Change

The additive migration `20261016000014_model_attempt_command_custody.sql` adds
attempt identities, exact command receipts, managed-write guards, retained output
reading and method-specific instrument custody. Existing rows default to
unmanaged status. The reaper preserves that mode for legacy runs. Direct inserts
cannot set an attempt-managed flag; enrollment occurs through the claim command.
No production caller invokes that command yet.

Existing v4/v2 instrument records and meanings remain unchanged. The successor
retains an inconclusive outcome and separate AequilibraE/ActivitySim identities.
Populated-output relaunch remains refused until all consumers and writers can
retain and classify earlier output records. An installed schema is not a
completed worker connection or scientific acceptance result.

## Verification to date

The Supabase CLI generated the new migration. Its timestamp was moved above the
repository's existing `20261016000013` high-water mark so deployed installations
will not skip it. The inventory reports 386 migrations, with no duplicate
versions, invalid names or empty files.

The native rollback runner accepts the migration file as its SQL source. All
54 cases pass: baseline, harmless and restored cases plus 51 adverse controls.
It verifies original-table constraints and prototype command behavior in the
named disposable restore-target stack. Rollback removes the new objects and
preserves the installed reaper definition. This is not a committed migration
upgrade or Supabase migration-history test.

The two new enrollment controls detect direct run and stage insertion with a
managed flag. The deletion-guard fixture uses an explicit administrative trigger
disable around one synthetic managed row, then restores the enrollment trigger.
That isolates the deletion guard from incidental foreign-key refusal without
adding a client enrollment bypass.

## Remaining before landing or activation

- Complete full exact-head CI and application RLS regression. The scoped
  migration-history, v4/v2 preservation and HTTP checkpoints below pass.
- Complete exact-head CI and live permission/upgrade checks for the migration.
- Connect all lifecycle commands, worker journals and output writes, then prove
  normal worker restart and cancellation through both worker entry points.
- Integrate launch/relaunch, Models, Reports, assistant citations and complete
  evidence exports before enabling attempt-managed runs.
- Preserve prepared-instrument ordering and verify actual bytes and complete
  instrument references before registering scientific custody.

The roadmap remains the sole queue. This note records the current migration
boundary; it does not replace or reduce any V1 requirement.

## Committed schema and advisor checkpoint

A separate database in the disposable restore-target container now contains the
committed candidate. Its starting schema was restored from the installed
`20261016000013` database with original object owners and permissions. No source
records were copied. Twelve synthetic legacy records were seeded before the
candidate: one run, one stage, five instrument artifacts, two KPIs (null and
zero), one claim decision, one validation result and one v2 custody row.
Exact before/after JSON agrees for every pre-existing field. The newly added
ownership fields remain false or null.

The initial restore as `postgres` failed on a restricted Realtime function
setting. Following `full_restore.py`, restoring as `supabase_admin` succeeded.
The candidate itself was applied as `postgres`. This proof used a committed SQL
transaction, not Supabase migration-history registration. Historical v4 custody
was not populated in this fixture.

The native command cases also pass against the already-installed candidate, in
a rollback transaction. All 12 new private tables have RLS enabled; service-role
direct INSERT and anonymous/authenticated SELECT privileges are absent.

Supabase advisors initially found five uncovered candidate foreign keys. The
migration now indexes those identities. A repeat advisor run has no new WARN or
ERROR entries compared with the source database. Candidate INFO findings are
12 intentionally policy-free private tables and four unused indexes in the
small fixture. The source and candidate retain a pre-existing PostGIS
`spatial_ref_sys` RLS error and other pre-existing findings. This is a scoped
comparison, not a clean whole-database security report. Schema-only cloning also
changes usage statistics, so unrelated INFO differences are not regressions.

The final migration file, including those indexes, again passes all 54 native
rollback cases. The private archive, before/after snapshots, advisor comparison
and scripts remain under
`~/.local/state/openplan/model-attempt-schema-20261008-proof/`.
The owned database `openplan_attempt_upgrade_77f0677a3947465ea717aa3cee021fa4`
is retained for the remaining proof work. No application server points to it.

At this checkpoint, the Supabase migration-history path, populated v4 custody
and authenticated HTTP checks remained open. The following checkpoint records
those results. Exact-head CI and worker/consumer activation remain open.

## Supabase history and authenticated HTTP checkpoint

A second owned database restored the same baseline schema, original owners and
385 applied migration-history records. The actual `supabase migration up`
command applied the final candidate and recorded one new history row. A second
invocation was a no-op, with that row still unique. All 17 seeded records remain
unchanged, now including one historical rules-v4 assessment and its four bound
artifacts alongside the v2 custody fixture. Legacy ownership fields remain
false/null. Native command cases also pass against this CLI-installed schema.

An isolated PostgREST instance then exposed this proof database. A valid workspace
member reads the legacy run; an authenticated outsider reads zero runs. The
service-only output reader returns all 11 legacy outputs to the service role,
classified as `legacy_unknown`. It returns 403 to the member and outsider and
401 to anonymous and unsigned requests. All 12 private tables return 403 to the
member.

A targeted privilege mutation temporarily granted the reader to authenticated
users in the owned database. The outsider then received the synthetic run,
demonstrating a real authorization bypass. Revoking the grant restored 403.
The PostgREST container was removed and removal checked. Separate scope tests
prove that the helper rejects unowned database/schema targets before contacting
Docker; baseline, harmless and restored cases plus two adverse controls pass.

The CLI and HTTP evidence is retained under the private proof directory's
`cli-upgrade/` subdirectory. The owned database is
`openplan_attempt_cli_dad18e40db104802aa9187f4c05dfd32`. Neither proof database is
an application or preview target. Full CI, broader application RLS regression
and normal worker/consumer activation remain open. These synthetic fixtures do
not establish scientific or practitioner acceptance.

## Integration accounting and timeout follow-up

The full local QA run at `7b727dfb` failed. Six files failed: the unread-column
ledger, relation inventory and migration release note, plus eight timeouts in
three thematic suites. Lint passed; later QA stages did not run. The full run
reported 20,072 passing tests, 11 failures and 1,587 skipped tests.

The installed CLI-upgrade catalog independently reports 299 application tables,
all with RLS enabled, and 14 views, excluding extension-owned relations. The
inventory now accounts for the 12 private tables. The unread-column ledger
explains 21 SQL-read fields and three write-only audit fields. The prior run and
stage snapshots and attempt revocation reason still lack application readers.
The Unreleased changelog names the migration and its enrollment boundary.

All 41 focused accounting tests pass. Harmless comments preserve that result.
Adding an unaccounted column or table triggers its respective guard; removing
the migration filename triggers the release-note guard. Restoring the original
files returns all 41 tests to passing. These lexical guards do not establish SQL
permissions, command semantics or application use. The catalog probe and native
proofs cover separate boundaries.

The three timeout-affected thematic files pass all 169 tests with one worker and
unchanged 20-second timeouts in 170.57 seconds. The earlier full run experienced
memory reclamation, but this targeted rerun does not establish the sole cause
or replace a full QA pass. An initial accounting command used the repository
root and failed to find migrations; the accepted run used the nested app and
its installed Vitest 4.1.11.

GitHub RLS run `37762423910` and restore-drill run `37762323035` both passed at
`7b727dfb`. These results do not cover later changed files or establish normal
worker activation, scientific acceptance or practitioner acceptance.

## Completed local checks and build continuation

At `124f0a69`, local QA passed lint, dead-code checks, 1,511 test files
(20,083 tests), connector checks (387 passed, four skipped), vendor checks
(18 passed), and the dependency audit (zero vulnerabilities). Unit tests skipped
95 files and 1,587 tests. Live RLS proof was explicitly skipped in this local
command; it is not tenant-isolation evidence.

The QA service then reached its 4 GiB memory limit during the production build
and terminated with `oom-kill`. The same unchanged commit passed a build-only
continuation with a 7 GiB limit and a 5.7 GiB peak. The continuation finished
on October 8 at 04:46:44 Pacific. The completed suites were not restarted.
The services are `openplan-model-attempt-schema-qa-124f0a69.service` and
`openplan-model-attempt-schema-build-124f0a69.service`; their journals retain
the separate failure and success. This is not a claim that one uninterrupted
QA command passed.

Main at `b814e453` was then merged normally. That merge changes ancestry but
introduces no file changes relative to `124f0a69`. This evidence note is the
only subsequent content change at this checkpoint. Exact-head GitHub checks
remain required before merge. Normal managed worker activation, complete
consumer integration, scientific acceptance and practitioner acceptance remain
open.
