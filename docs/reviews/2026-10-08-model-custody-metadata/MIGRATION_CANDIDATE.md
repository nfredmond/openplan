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

- Apply and inspect the candidate on a separate disposable database, including
  Supabase advisors and populated legacy-record preservation.
- Complete exact-head CI and live permission/upgrade checks for the migration.
- Connect all lifecycle commands, worker journals and output writes, then prove
  normal worker restart and cancellation through both worker entry points.
- Integrate launch/relaunch, Models, Reports, assistant citations and complete
  evidence exports before enabling attempt-managed runs.
- Preserve prepared-instrument ordering and verify actual bytes and complete
  instrument references before registering scientific custody.

The roadmap remains the sole queue. This note records the current migration
boundary; it does not replace or reduce any V1 requirement.
