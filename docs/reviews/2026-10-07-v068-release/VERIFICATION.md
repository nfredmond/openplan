# Version 0.68.0 development candidate

This record prepares an accumulated development release, not version 1.0.
The candidate combines main's engagement and land-use changes with project
engagement evidence, synthesis resource assessments, published model evidence
verification, conflicting award deadlines and calendar-date display corrections.
The V1 contract, roadmap scope and historical review grades are unchanged.

## Release records

The package, lockfile and four current-version metadata fields identify 0.68.0
for the candidate. The changelog explicitly says it is not released. There are
385 migration files, through `20261016000013_synthesis_execution_queue.sql`.
The candidate changelog names all twelve additions since 0.67.0. No SQL changes
are introduced by this release-record checkpoint.

The six release-ordering tests pass. A harmless comment passes; changing the
candidate inventory to 384 fails the count assertion. The restored source passes
again. Product direction validation passes with existing review-age and
intervening-change reminders. Historical review dates and capability grades are
not changed. An initial command from the repository root fails before loading
package.json; the corrected command runs from `openplan/`.

These checks cover record alignment and migration ordering. They do not prove
an upgrade, database restoration, permissions, workflow completion or accuracy.
Private logs are in the local `v068-release-20261007-proof` state directory.

## Combined checks and remaining release work

[Combined acceptance](COMBINED_ACCEPTANCE.md) records local full QA, production
build, GitHub normal and shuffled tests, worker checks, the populated upgrade,
and T3 desktop/mobile journeys on exact application commit `10c3bc0c`.
Candidate live RLS run 37719603999 and full-archive restore run 37719725094
both pass on that application commit. The combined record retains the restore
manifest scope and excluded external services. Final integration checks remain
separate from these application-commit results.

The integration adds evidence and current main/calendar merge ancestry without
changing application files relative to `10c3bc0c`. Final GitHub checks remain
attributable to the integration head. No tag or release is published. The
changelog remains explicitly a development candidate until the remaining
checks and final release disposition are recorded.

Full V1 remains open. This release does not establish independent nationwide
scientific acceptance, native date entry or every download's native save,
complete geography and authority coverage, or observed practitioner outcomes.
Both modeling methods retain their separate evidence and inconclusive limits.

## Follow-up integration checkpoint

PR #143 lands as `565cd983c7e101910eba3da091334a3e5c7bd350`.
Its main CI 37727484828, live isolation 37727484869 and worker checks
37727484871 pass. Isolation reports 1,462 passing tests in 101 files,
with 125 skipped. The full-archive restore completion and its local scope are
recorded in [combined acceptance](COMBINED_ACCEPTANCE.md#restore-completion-and-main-ci-follow-up).
The earlier pending statements remain dated checkpoints, not current failures.

The award follow-up and historical matcher verifier in PR #147 at `8e39667b`
pass full QA, shuffled tests, modeling/operations Python and worker checks.
QA reports 20,053 passing tests in 1,509 files, with 1,565 tests in 94 files
skipped. Live isolation run 37729778533 remains active at this checkpoint.

PR #148 includes that complete ancestry, the
[observation-bounds correction](../2026-10-07-observation-bounds/VERIFICATION.md)
and PR #149's workflow-evidence mapping. It now targets main for combined checks;
the preceding head's results do not substitute for its own final verification.
No migration changes in these follow-ups. No tag is published.

The [award browser record](../2026-10-07-award-reopen-mobile/VERIFICATION.md)
retains identified desktop/390px form evidence and native reopen/readback checks.
T3 later reconnects through a fresh preview tab, but screenshot capture still
fails, including on a new blank page. Its desktop log reports a capture timeout.
Post-submit captures and final console review remain incomplete. No alternate
browser is used, and no completed visual acceptance claim replaces this gap.
