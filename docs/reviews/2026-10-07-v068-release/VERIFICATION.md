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
