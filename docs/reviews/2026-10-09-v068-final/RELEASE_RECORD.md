# v0.68 release evidence

This record prepares the v0.68.0 development release on October 9, 2026.
Publication remains pending at this documentation checkpoint. The GitHub release
and tag identify the final published commit; a dated changelog and package version
alone do not establish publication. The full v1 contract remains unfinished.

## Verified application and integration

Application candidate `283c206991bd205ae5284adfa81d14e85e02a1dc` passes:

- [Full CI](https://github.com/nfredmond/openplan/actions/runs/37999548121),
  including QA, shuffled tests and the three Python suites. The QA test run
  reports 20,285 passing and 1,595 skipped tests across 1,526 passing and 96
  skipped files. The production build and dependency audit pass. Skipped tests
  do not count as acceptance.
- [Native RLS isolation](https://github.com/nfredmond/openplan/actions/runs/37999548324).
- [Full-archive restore](https://github.com/nfredmond/openplan/actions/runs/37999548040).
- [Worker security and cancellation](https://github.com/nfredmond/openplan/actions/runs/37999548077).

[PR 177](https://github.com/nfredmond/openplan/pull/177) merges that candidate
to main as `2ad229f42d7d1c42d19af0480b6016927072f620`. The merge has an identical
tree. The application, worker and operational source also matches rendered
acceptance build `f76b0516d2d263dc08892d742ce245a2e792ae8d`; subsequent changes
are tests and evidence or operator documentation. This documentation branch
changes no application behavior or migration. Its own required GitHub checks
still govern landing, and main's checks govern publication.

The [populated upgrade on main](https://github.com/nfredmond/openplan/actions/runs/38004500238)
passes after seeding the previous release, applying the current migrations and
checking retained rows and operational fixtures. The earlier
[v0.67 upgrade rehearsal](https://github.com/nfredmond/openplan/actions/runs/37998677389)
also passes at `5b4b5e09ec4e18adf1a2c0bfe5259194b2ef22de`. Its migration and upgrade
workflow files are unchanged in candidate `283c20699`. The release contains 399
migrations through `20261016000027_run_project_workspace_foreign_keys.sql`,
including 26 additions since v0.67.0. These representative fixtures do not prove
every agency installation's data or configuration.

## Archive recovery scope

The final restore run records 360 tables and 9,254 rows, with the bootstrap
preserved. One 38-byte private Storage object is recovered and checked by hash.
Source and target OWP records match, including overlapping cycles, a closed
prior period, retained claims, commitments and adjusted carryover. Three harmless
controls pass and 42 targeted failures are detected. The
[redacted summary](final-restore-summary.json) retains artifact identities,
counts and hashes.

The declared scope is the default local CLI database and Storage. External
workers, custom roles and scheduled SQL jobs are excluded. The downloaded CI
artifact contains custody manifests and comparison evidence, not the complete
database and Storage backup itself. This evidence is distinct from the earlier
966-row, 340-table model-record restore fixture. Neither establishes complete
independent agency commissioning or recovery of external worker files.

## Rendered workflow evidence

The dated reports retain identified source builds, desktop and 390px journeys,
console observations, artifact hashes and original partial results:

- [Combined recovery and GTFS integration](../2026-10-09-recovery-integration/VERIFICATION.md).
- [Recovery request restoration and explicit retry](../2026-10-09-recovery-mobile/VERIFICATION.md).
- [Short-window navigation](../2026-10-09-short-rail/VERIFICATION.md).
- [My Work's project relationship correction](../2026-10-09-my-work-project-relation/VERIFICATION.md).
- [Award reopening and the accumulated release inventory](VERIFICATION.md).

The [changelog](../../../CHANGELOG.md) links the remaining land-use, engagement
and earlier bounded workflow evidence. These agent journeys do not establish
observed practitioner or public outcomes. Failed historical capture attempts
remain recorded; later evidence does not rewrite their result.

## Installation and remaining work

Follow the [upgrade and recovery guide](../../../openplan/docs/ops/V068_UPGRADE.md).
Preserve backups, worker journals and installation identity. Stop model workers
before applying migrations and allow a maintenance window for validated
relationship changes. Abandonment revokes database writes; it does not terminate
a process or authorize resumed computation.

GTFS imports still run in their existing HTTP requests. The follow-on parser
supervisor in [PR 184](https://github.com/nfredmond/openplan/pull/184) and the
unfinished managed-ingestion migration 28 are excluded from this release.
Full managed model continuation, resumable GTFS ingestion, complete installation
recovery and the remaining geography and authority requirements stay open.
AequilibraE and ActivitySim remain separate and scientifically inconclusive.
No nationwide accuracy, agency acceptance or complete v1 claim is made.

The earlier integration audit accounts for 100 registered worktree heads and
116 recent branch heads through the application candidate. Later operator,
parser and managed-ingestion work is separately retained and is not covered by
that historical all-merged statement. No worktree is discarded by this release.
