# Transit candidate joins the next UI increment

Candidate `295e34edc61d` joins UI main `f4785429abba` after the earlier reviewed production build. The local checkout fast-forwards after its identified production service stops. This keeps the visible evidence tied to the source that served it.

[The expanded integration checks](map-ui-main-join-checks.json) pass 2,271 tests across 107 files, with 17 live cases skipped and no failures. The selection includes transit and GTFS tests, dashboard/shared-shell checks and the test files changed by the incoming UI increment. Product direction, strict selected-file lint and scoped native TypeScript pass. [Service-equity controls](map-ui-main-join-equity-controls.json) and [planner recovery controls](map-ui-main-join-client-controls.json) pass their baseline, harmless, restored and intended broken cases. Recorded source hashes match after restoration.

The serial service has a 1 GiB limit, no swap and one Vitest worker. Its journal reports a rounded 793.4M memory peak, 358.855 seconds wall time and 346.414 seconds CPU time. This does not establish whole-suite CI, new browser acceptance or a production workload capacity limit.

The [preceding production read](REVIEWED_PRODUCTION_READ.md) remains evidence for `c75fa343d6b0`. A new bounded production build and identified T3 read of this later source are next. Current GitHub live RLS, full restore and whole-suite results remain separate. Managed mode stays disabled by default, migrations 28 through 31 remain unreleased, and this lane does not change hosted services or shared map styles.
