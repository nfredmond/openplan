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

- Finish the Supabase migration-history upgrade path and populated historical
  v4 custody check; the committed SQL and advisor checkpoint below is partial.
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

Remaining upgrade evidence includes the actual Supabase migration command and
history path, populated historical v4 custody, and full authenticated HTTP
permission checks. Exact-head CI and worker/consumer activation remain open.
