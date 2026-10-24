# TBI 2019 integration readiness

October 23, 2026. **Not ready for the frozen opening.** The integration combines
#379 and #382 and preserves their frozen records. It prepares public inputs
without requesting or reading TBI outcome fields. Missing travel conditions and
survey/model mapping still prevent scientific admission, even if a modeled-only
preparation run completes.

The [decision addendum](INTEGRATION_PREREGISTRATION_ADDENDUM.md) records the
lead's four decisions before outcome access. The [source record](INTEGRATION_SOURCES.md)
contains fare quotations, effective dates, source links and coverage limits.
The [geographic exclusion addendum](INTEGRATION_GEOGRAPHIC_EXCLUSION_ADDENDUM.md)
separates the full 704-zone source archive from the shared 638-zone model domain.
The [verification record](INTEGRATION_VERIFICATION.md) separates synthetic,
source and native evidence.

Raw logs and large diagnostics now reside in the verified private
[evidence archive](EVIDENCE_ARCHIVE.md). Historical links to relocated files
resolve through [EVIDENCE_MANIFEST.json](EVIDENCE_MANIFEST.json); the original
bytes and prior findings remain preserved.

## Input inventory

| Required input | Status and retained boundary |
|---|---|
| Seven-county zone system | Present. 704 ordered TIGER2019 Census tracts, original Census internal points and 2019 place polygons. The order remains unchanged. |
| Survey-period population profile | Present. ACS 2015–2019 summary and PUMS products, 2010 PUMAs, 2019-dollar incomes. Public bulk files replace credential-requiring API transport. |
| Population controls and microdata | Present. Published totals are 3,065,147 people and 1,187,423 households. Four tracts have unavailable median household income; those raw cells remain `.`. Every selected tract and all 32 selected PUMAs, including three Wisconsin PUMAs. 83,700 household and 181,876 person source records precede seed eligibility. |
| Full realized population and fit diagnostics | Present after two retained OOM failures and checkpoint recovery. 1,219,702 households, 3,150,169 persons and 1,496,481 workers. Manifest SHA-256 `27d545f12659345c1f8f3f296cca67010e15bf0f4067c1ab7589defca526bd99`. 677 of 704 fits do not converge; 30 exceed at least one published margin. These are input limitations, not admitted population accuracy. |
| Highway network | Present. October 8, 2019 OSM database snapshot through the existing AequilibraE path. 231,080 pre-centroid nodes, 311,276 links, 704 internal zones and eight external gateways. No demand assignment. |
| Highway skims | Present. Travel time and distance, all 494,912 off-diagonal internal pairs reachable, no missing graph centroids. CPython 3.11.15, AequilibraE 1.6.2, NumPy 2.0.2. |
| Observed period road conditions | Unavailable. The inherited adapter repeats free-flow road impedance across periods. OSM snapshot age does not establish measured congestion or road-opening truth. |
| Independent walk/bicycle networks | Unavailable. Inherited nonmotorized distance derives from the auto network; transit walk access uses centroid distance without pedestrian barriers. |
| MTC matrix package | Present. 826 matrices: 718 transit, 30 time, 33 distance and 45 inherited zero fields. The raw transit NPZ hash matches the independent standalone preparation exactly. |
| Transit schedules | Present for the retained Metro Transit feed, October 8 service: 8,782 active trips, five configured departures. This is one departure per period, not a period average. |
| Transit fares | Partially present. Published 2017 rates remain documented for 2019. Explicit single-boarding pricing covers 79 named express routes and three tram routes. 106 route fares, transfers, concessions, Northstar products and cost-base-year alignment remain unsupported. Unknown fares remain NaN with mode-choice usability false. |
| MVTA | Unavailable. No freely retrievable 2019 feed acquired in the bounded search. Member-city overlap excludes 66 tracts, their resident households and their destinations from both model arms; the full source archive preserves them. This does not establish complete MVTA-dependent trip exclusion. |
| Drive-to-transit | Unavailable, explicitly excluded. Published 2019 inventory retained, but no verified entrance-to-road-node-to-stop crosswalk. Zero supplied connectors. |
| Employment | Present. LODES7 2019 WAC, 18,378 selected blocks and 1,813,674 jobs across all 704 tracts. Existing MTC sector pooling remains disclosed. |
| School destinations | Qualified proxy. ACS enrollment by residence, not observed school capacities or school attendance locations. |
| Parking, tolls, terrain and developed acreage | Unavailable or unassessed as historical inputs. Existing zero parking/toll fields, flat terrain and gross-acreage allocation remain adapter approximations, not measured zero conditions. |
| Coefficients | Present and unchanged. Current tour coefficients `42a98dc65adb64a61de88d92e6fd9939a9a32900140a9fa8c5e3eacedb4a84b2`; SEMCOG candidate `537e54811e4b6ca9fec0662085777e9679a634bd312bb7c64df6e58ff60c7490`, 27 frozen substitutions. Both use the existing accepted auto-ownership component. |
| Complete prepared-input archive | Present. Initial archive: 492 files, 2,898,706,216 bytes, SHA-256 `bd0c35dec94b135f8d16bf001e49a35d70e6ab0ebc7a410051e93d4a71b15935`. It preserves full 704-zone inputs and the 638-zone derivative. The separate runtime archive adds the explicit file-backed skim overlay and pinned allocator runner. It contains 515 inventoried files and 2,898,724,157 bytes; SHA-256 `81fe67cc0ad74454dfd5a94c21d2497e6236c4958e7581e1f6babaff5d1fafd7`. `integration-evidence/archive-custody.runtime.json` retains the inventory hash. The initial archive remains unchanged. |

## Exclusions available without outcome fields

The original household split remains 7,516 total, 6,019 development and 1,497
held out. Development metadata retains 5,041 seven-county households and excludes
978 outside the study region. Missing county: zero. The original assignment
hash remains `d00206802218a92d31dceea4c108c74cab540dadd8c90d9d1f21e8b11b99c392`.

| Reason | Count and denominator |
|---|---|
| Development household outside the frozen region | 978 of 6,019 development households. |
| Missing development home county | 0 of 6,019 development households. |
| MVTA member-city overlap | 66 of 704 zones; 638 remain outside this mask. The runtime derivative removes these zones, resident households and destinations, and slices every matrix by the retained positions. The derivative excludes 118,754 of 1,219,702 synthetic households and 335,573 of 3,150,169 persons, retaining 1,100,948 households and 2,814,596 persons. Original source IDs and the full parent remain preserved. |
| PUMS seed group quarters | 3,520 serial groups excluded by the inherited seed rule, from 79,527 groups with retained person records. |
| PUMS seed nonpositive or missing household weight | 5,027 of those 79,527 groups; zero additional unclassifiable groups. 70,980 seed households remain. These are PUMS source groups, not TBI or realized population counts. |
| No centroid walk access to supplied service after the mask | 245 of 704 zones, including the 66 MVTA-mask zones and 179 other zones; 459 have walk access. This is not a household exclusion count. |
| Missing route-fare classification | 106 of 188 feed routes. Routes and origin-destination pairs are different denominators. |
| AM generic transit path with unknown fare | 128,881 of 129,728 reachable directed pairs. These are path records, not trips, people or choices. |
| Drive-transit alternatives | All unavailable; zero supplied connectors. No observed trip count is inferred. |
| MVTA-dependent, drive-access, mixed-mode and other survey-trip/tour exclusions | Unavailable without prohibited outcome fields. They are not reported as zero. |

## Modeled-only run health

Both arms receive three full-population attempts. The initial attempts exceed
the 6 GiB cap during household/person initialization. File-backed skim retries
pass initialization and university location choice, then exceed the cap during
high-school location logsums. The final allocator retries release unused memory
before that unchanged engine call, but also exceed the cap at the same step.
All attempts retain their logs, configuration hashes and separate directories.

| Final arm | Completion | Scope result | Elapsed | Completed tours / MODELED shares |
|---|---|---|---|---|
| Current coefficients | Failed | OOM kill, 6,442,450,944-byte peak, zero swap | 254.732 seconds | Unavailable, null |
| SEMCOG walk candidate | Failed | OOM kill, 6,442,450,944-byte peak, zero swap | 257.823 seconds | Unavailable, null |

Both final attempts reach 2,315,528 sampled high-school location rows. These
are intermediate model rows, not completed tours or survey observations. The
allocator wrapper passes six native exact fixture comparisons, including next
random draws. A separate batching candidate fails native exact parity by one
floating-point unit and remains unused. No comparison between coefficient arms,
against AequilibraE outputs or against TBI observations runs. **The requested
end-to-end completion is not achieved under the admitted 6 GiB execution path.**

## Exact remaining steps before a lead-owned opening

1. Admit and verify a bounded-memory engine execution path, then complete both
   full-population modeled-only runs under the unchanged 6 GiB/zero-swap limit.
   Retain exact input, implementation, configuration and completed-output hashes.
   The current file-backed/allocator path still fails; the batching candidate
   has not passed native parity and cannot be substituted. The complete source
   population and both zone packages are already retained. Resolve the 677
   nonconverged fits and 30 zones outside published margins without relaxing
   gates. Grade population fit and inherited input approximations independently
   of model results. Runtime completion does not waive any admission below.
2. Resolve or explicitly redesign and preregister the unavailable travel
   conditions. Establish complete transit fare applicability and cost-year
   alignment, MVTA endpoint/service dependence and a defensible analysis
   population. The current member-city mask is not complete trip coverage.
   Resolve drive access or freeze its explicit analysis exclusion. Retain
   unavailable parking, toll, walk/bicycle and period-speed qualifications.
3. Freeze the exact observed and modeled eligibility correspondence, including
   homogeneous linked-trip family filtering on modeled tours, full diary and
   location continuity, university evidence, joint and at-work handling, trace
   quality, all required comparison domains and every exclusion denominator.
   `tbi2019_tours.py` synthetic fixtures alone do not establish hosted joins.
4. Freeze the primary derived day-weight-per-tour estimator and the separate
   trip-weighted sensitivity, exact day universe, publisher source joins,
   household clusters, strata and variance calculation. Keep unsupported
   uncertainty and empty domains unavailable. Do not combine the estimands.
5. The lead reviews admission and freezes the complete input closure and a
   new exclusive opening receipt. Do not reuse a consumed lock or historical
   synthetic receipt. Verify the original split and held-out boundary again.
6. Only after the lead authorizes the opening, restrict server-side outcome
   requests to the frozen in-scope development IDs and approved fields. Apply
   the frozen adapters and exclusion accounting, then evaluate each arm
   independently against the preregistered gates. Held-out outcomes stay closed.

No hosted system, database, production service or Docker stack is touched.
The inherited SQL migration remains unapplied. No default coefficient changes,
scalar fitting or scientific acceptance follow from this preparation.

## October 24, 2026 UTC: population correction and built-in chunking preparation

This addendum supersedes the population-fit status, runtime population and
6 GiB execution limit above. Historical input archives and failed attempts remain
unchanged. The lead authorizes 9 GiB, zero swap and one heavy job at a time.
The frozen opening remains closed. No TBI outcomes are read.

### Population admission

The explicit entropy fitter resolves 673 of the 677 prior nonconverged fits.
All 700 feasible fits pass the unchanged 0.001 tolerance and published margins;
four of those zones have zero population. Twenty-five feasible fits need more
than 200 passes, with a maximum of 827 under the explicit 2,000-pass limit.
The former 30 fractional out-of-margin zones now number zero. No positive
category lacks seed support. The regional 32-PUMA pool remains a disclosed
representativeness limitation.

Zones 439, 443, 444 and 494 remain failed and excluded. Their B11016 household-size
cells imply different resident totals from B09019_002E. They contain 9,722
published households and 14,201 published household residents. The
[population addendum](POPULATION_CHUNKING_ADDENDUM.md) identifies every tract,
source table, arithmetic conflict and retained control diagnosis. These failures
do not become successful fits merely because their residuals lie within ACS
margins.

Whole-household integerization also needs correction. The original population
has 6,462 realized-control margin violations across 700 populated zones; the
first entropy realization has 7,632 across 696. Both remain retained. Controlled
integerization now preserves exact household totals and every published margin
bound, without sampling, a solver time limit or a positive optimality gap.
The corrected parent has 1,177,701 households, 2,921,574 persons and 1,586,722
workers, with zero realized-margin violations. The four failed fits contribute
no retained residents. No default fitting or integerization method changes.

The corrected population manifest SHA-256 is
`141701c432075cc3afa17f54b8cc8f2721e4138ac6e2143c9c06c0385892106e`.
Its native rebuild completes in 2,536.650 seconds at a 7,961,825,280-byte cgroup
peak, with zero swap and no OOM events. The shared runtime derivative contains
634 zones, 1,060,601 households and 2,617,177 persons. It removes the existing
66-zone MVTA mask and the four failed population zones, including destinations.
All 826 matrices use the same retained positions. This is the full retained
runtime population, not a memory-driven sample.

### Successor input archive and verification

The successor archive contains 593 inventoried files and 2,783,118,248 bytes.
SHA-256: `0465298da115a6de40d23c26d7c21de273be2d48266f76f80813780a7c45d6c2`.
All 594 members, including the embedded inventory, pass byte-length and SHA-256
verification. All 516 inherited parent members are verified before reconstruction.
The old fitter's recovery checkpoint is retired from the successor, while its
original archive remains retained. The new archive contains the corrected
population, full and subset zone packages, fixed parity fixture, explicit runtime
configurations and source custody. It contains no survey outcomes or modeled
travel tables. See [archive custody](convergence-evidence/archive-custody.json)
and [member verification](convergence-evidence/archive-verification.json).

Source checks pass 116 tests with zero skips. Thirty-one source mutation controls
contain three harmless survivors and 28 intended assertion failures. Archive
verification adds one harmless ordering control and four intended metadata
failures: 36 controls in total, four harmless and 32 targeted. The original 117
frozen files remain byte-identical. The [verification record](convergence-evidence/VERIFICATION.md)
separates these checks from native behavior and scientific admission.

### Exact chunking parity fails; further model execution stops

ActivitySim 1.5.1's [version-specific documentation](https://github.com/ActivitySim/activitysim/blob/v1.5.1/docs/users-guide/performance/chunking.md)
governs the built-in training/production protocol. The frozen fixture contains
64 whole households and 166 persons, selected by household-ID hash before any
model run. Both executions retain the same 634-zone domain, seed, coefficients,
model sequence and seven final model tables. Training uses a 64 MiB sizing
target, two initial chooser rows and the independent 9 GiB scope cap. Its log
records 414 chunk executions and a maximum chunk ordinal of 21.

The initial controller loses stdout to ActivitySim's output cleanup after the
unchunked engine run completes. Its engine log, scope receipt and final tables
survive. Recovery reuses that completed reference without replay and places
later stdout outside the engine output directory. A second instrument defect
assumes that each CSV's first column is its row identity. The actual exports
place named IDs elsewhere. The corrected comparator uses `zone_id`,
`household_id`, `person_id`, `tour_id`, `trip_id` and `participant_id` as
appropriate, requires uniqueness and retains exact comparison of every column.
It compares the existing outputs without rerunning either model. Both instrument
failures remain retained and do not count as numeric parity results.

**The corrected exact comparison fails in `final_trips.csv`:**

| Trip ID | Field | Unchunked | Training | Difference |
|---|---|---:|---:|---:|
| 39740078 | destination_logsum | 1.5387358811899654 | 1.5387358811899652 | 1 ULP |
| 123196726 | destination_logsum | 3.922305563209965 | 3.9223055632099646 | 1 ULP |

The first six final model tables pass exact value comparison. Two of 628 trip
rows fail in the first differing trip column; subsequent trip columns remain
unassessed after the failure. No rounding tolerance, omitted column or unchanged
tour count rescues this gate. [Failure details](convergence-evidence/parity-failure-detail.json)
retain decimal values, binary float encodings and final-file hashes through the
linked comparison receipt.

| Fixed-subset current-coefficient execution | Completion | Elapsed seconds | Cgroup peak bytes | MODELED tours |
|---|---|---:|---:|---:|
| Unchunked reference | Completed, stdout capture lost | 49.533, surviving child-scope boundary | 1,935,331,328 | 244 |
| Built-in training | Completed, exact parity fails | 644.235 | 1,769,021,440 | 244 |

Both scope receipts show zero swap and no OOM events. These are small-fixture
runs, not full-arm completion. [Subset run health](convergence-evidence/parity-run-health.json)
records MODELED mode counts and shares only. Production and SEMCOG parity runs
remain unexecuted under the lead's stop-on-parity-failure instruction.

| Full-population arm under the new 9 GiB path | Completion | Elapsed / peak | MODELED tours / shares |
|---|---|---|---|
| Current coefficients | Not run, exact parity gate failed | Unavailable | Unavailable, null |
| SEMCOG walk candidate | Not run, exact parity gate failed | Unavailable | Unavailable, null |

The [execution status](convergence-evidence/execution-status.json) and
[full-arm record](convergence-evidence/full-runs.json) preserve these non-runs
as non-runs. The new input archive remains unchanged after model preparation.
It contains the earlier instrument recipes; [execution closure](convergence-evidence/execution-closure.json)
and [comparison closure](convergence-evidence/comparison-closure.json) separately
pin the post-archive capture and comparator corrections. Current repository
recipes and these corrections govern any later reproduction; the archived
instrument failures must not be treated as a clean executable recipe.

### Remaining steps for the frozen opening

1. The lead reviews this stopped result and determines how to resolve the
   built-in chunking discrepancy. No further model run is authorized by this
   failed proof. A later admitted path must pass exact final-table parity,
   including production cache use and both coefficient configurations, before
   completing both full retained-population arms under the 9 GiB/zero-swap cap.
   Preserve this failure and every earlier attempt. Do not reduce population,
   relax tolerances or remove logsum columns to pass.
2. Independently grade the corrected population and the four source-conflict
   exclusions. Freeze their correspondence to the analysis population and
   survey eligibility before opening outcomes. Complete the unresolved travel
   conditions or preregister a defensible redesign: 106 unknown route fares,
   transfers and cost-year alignment, complete MVTA dependence, drive access,
   period road speeds, independent walk/bicycle networks, parking and tolls.
   The current geographic mask does not establish complete trip coverage.
3. Freeze observed/model eligibility correspondence, homogeneous linked-trip
   families, diary and location continuity, university evidence, joint and
   at-work handling, quality rules, required domains and exclusion denominators.
4. Freeze the primary derived day-weight-per-tour estimator separately from
   the trip-weighted sensitivity, including day universe, publisher joins,
   household clusters, strata and variance. Unsupported uncertainty remains
   unavailable.
5. The lead reviews the complete admission closure, verifies the original split
   and held-out boundary, and issues a new exclusive opening receipt. Do not
   reuse a consumed lock or historical synthetic receipt.
6. Only a subsequent lead-authorized opening may request approved outcome
   fields for frozen in-scope development IDs. Evaluate each ActivitySim arm
   independently against its preregistered gates. Keep AequilibraE separate
   and held-out outcomes closed.

The SQL migration remains unapplied. No Docker stack, hosted system, production
service, default coefficient or frozen study record changes. Population and
archive preparation are complete at the stated boundary; full-arm completion
and scientific admission remain unproved.


## October 24, 2026 UTC: choice-level parity criterion, frozen before this check

The lead replaces exact equality of intermediate floating-point logsums with
choice-level parity for this round. The prior exact failure remains retained.
Every final choice, row identity and row count must match exactly in all seven
exported tables. This includes tour purpose, destination, mode, start/end period;
trip destination, mode and departure; and every household/person choice column.
All other fields remain exact except columns explicitly named as logsums or
utilities. For finite values in those columns, the absolute difference must be
at most `max(4 * max(ulp(a), ulp(b)), 1e-12 * max(abs(a), abs(b)))`.
Matching missing values remain missing; unequal missing or infinite values fail.
No rounding, choice omission or tolerance on choice fields is permitted.

The check reuses the existing fixed 64-household current-coefficient reference
and training outputs, with their retained hashes. It adds production-cache use
and both coefficient configurations. The second subset contains 2,000 complete
households selected by the lowest SHA-256 of
`tbi2019-chunk-parity-2000-v1:` followed by household ID from the corrected runtime
population. Membership is fixed before execution, independent of model and survey
outcomes. Model RNG seed remains zero. Both subsets retain all 634 destination
zones. Each arm compares unchunked, training and production outputs, with actual
chooser splitting and no production fallback. Any choice difference stops all
further model execution and retains exact differing records.

Only successful parity on both subsets admits both full retained-population
arms, sequentially under 9 GiB and zero swap. Full arms use production chunking
with frozen training caches; no population sample substitutes for either arm.
This criterion changes numerical execution admission, not scientific accuracy,
observation tolerance, population gates or permission to open TBI outcomes.


### Choice-level check stops on two departure choices

The complete comparison of the existing 64-household current-coefficient outputs
fails. It inspects all seven final tables and all columns, after verifying each
output hash against the retained comparison receipt. The two one-ULP logsum
differences satisfy the new tolerance. Two trip departure choices do not match:

| Trip ID | Household ID | Person ID | Tour ID | Unchunked depart | Training depart |
|---|---|---|---|---:|---:|
| 914860869 | 1128682 | 2789209 | 114357608 | 16 | 18 |
| 914860870 | 1128682 | 2789209 | 114357608 | 18 | 19 |

Both trips are inbound work-tour legs with `DRIVEALONEFREE` mode. Their
intermediate purposes are `othmaint` and `eatout`, respectively. These are
synthetic model records, not TBI respondents. The [exact records](choice-parity-evidence/exact-differing-trips.json)
and [complete comparison](choice-parity-evidence/complete-comparison.json)
retain every differing cell. All other exported values match exactly except
the two admitted logsum differences. Table counts match: 634 land-use zones,
634 accessibility rows, 64 households, 166 persons, 244 tours, 628 trips and
four joint-tour participants. The earlier comparator stopped at the first
logsum column; its record explicitly left later trip columns unassessed.
This check exposes those previously unassessed departure differences.

No engine run occurs in this round. The lead's stop-on-choice-difference rule
blocks production parity, SEMCOG parity, the larger subset and both full arms.
The second fixture is frozen before the check: 2,000 households and 4,971 persons,
RNG seed zero, full 634-zone destination domain. Its selection and hashes are
in [input freeze](choice-parity-evidence/input-freeze.json). A prepared fixture is
not a completed parity result.

| Execution boundary | Status | Elapsed seconds | Peak bytes | Tours / trips |
|---|---|---:|---:|---|
| Existing 64-household unchunked reference | Reused, complete | 49.533 child-scope timing | 1,935,331,328 | 244 / 628 |
| Existing 64-household training | Reused, complete; choice parity fails | 644.235 outer timing | 1,769,021,440 | 244 / 628 |
| 2,000-household subset | Not run, stopped | Unavailable | Unavailable | Unavailable |
| Full current-coefficient arm | Not run, stopped | Unavailable | Unavailable | Unavailable |
| Full SEMCOG candidate arm | Not run, stopped | Unavailable | Unavailable | Unavailable |

The prior subset scope receipts retain 9 GiB maximum, zero swap and no OOM events.
The current round creates no new scope or modeled outputs. Full-arm MODELED mode
shares and strata remain unavailable, not zero. [Full-arm status](choice-parity-evidence/full-runs.json)
records both non-runs explicitly. No TBI outcome field is accessed or compared.

### Hash custody and CI repair

The public input archive is rehashed successfully as
`0465298da115a6de40d23c26d7c21de273be2d48266f76f80813780a7c45d6c2`.
The prior 594-member verification remains applicable to those unchanged bytes.
The unchunked `final_trips.csv` hash is
`bbc3cdeaa6642e696bff344162e9ee6ede08df409b93bb3b0e842312c43feddb`;
the training trip hash is
`1bea2aec0d1578c823ff90d2ffb6e80eee45d2bb12daf08b6d6e8cf578280ebe`.
The complete comparison retains all 14 final-table hashes. Both tour tables hash
as `c6bf0a48627618ab688941c7ffcbe6ebbeda6246a106879397157faf5597dd26`.
There are no full-arm output hashes. All 117 original frozen files remain
byte-identical, including the split and preregistration records.

The memory runner now reads current resident memory from Linux `/proc/self/statm`
using the standard library. It retains allocator reclamation, engine pins and
current-RSS semantics without importing `psutil`. Its three tests pass under
CPython 3.11 with `-S`; `find_spec("psutil")` returns `None` in that environment.
The lead fixes are merged, including the migration changelog entry, `codecs`
and `zoneinfo` import recognition, and 2019 catalog pinning. The merge retains
`bisect` recognition and the existing security changelog entry.

Source verification passes 21 tests with zero skips: eight new choice-comparator
tests, six existing exact-comparator tests, three memory-runner tests, two
population-packaging tests and two scoped import-guard tests. Four harmless
mutation controls survive. Nine targeted controls fail through assertions and
one restored `psutil` import fails with the expected missing-dependency error.
All 14 accepted controls restore their source bytes. An initial comparator
mutation produced an incidental file error and does not count as an accepted
control. The first Vitest attempt lacked local dependencies; the subsequent
scoped run uses the existing local dependency installation. These source checks
do not establish engine parity or scientific acceptance. See the
[verification record](choice-parity-evidence/VERIFICATION.md) for evidence limits.

### Remaining steps for the frozen opening after this stop

1. The lead resolves or separately authorizes investigation of the two departure
   choices. Preserve this failure. A successor execution path must pass the
   adopted choice-level criterion on both fixed subsets, both coefficients and
   production-cache use. Then complete both full retained-population arms under
   9 GiB and zero swap, sequentially, with full output hashes and modeled-only
   health and supported strata. No additional execution follows from this stop.
2. Grade population and travel-input admission independently. Preserve the four
   failed source-conflict zones and unchanged population gates. Resolve or
   preregister the existing fare, cost-year, service-dependence, drive-access,
   period-speed, walk/bicycle, parking and toll limitations.
3. Freeze observed/model eligibility correspondence, homogeneous linked-trip
   family filtering, complete diary and location continuity, university evidence,
   joint and at-work handling, quality rules, domains and exclusion denominators.
4. Freeze the derived day-weight-per-tour primary estimator separately from the
   trip-weighted sensitivity. Fix the day universe, publisher joins, household
   clusters, county/sample-segment strata, Taylor-linearized ratio variance,
   singleton-stratum treatment and simultaneous bounds. Unsupported uncertainty
   remains unavailable.
5. The lead verifies the original split and held-out boundary, reviews the exact
   input and implementation closure, and issues a new exclusive opening receipt.
   No consumed lock or historical synthetic receipt authorizes that opening.
6. Only a later lead-authorized opening may request approved fields for frozen
   in-scope development IDs. Evaluate each ActivitySim arm independently against
   its preregistered gates. Keep AequilibraE separate and held-out outcomes closed.

## October 24, 2026 UTC: retry-cohort cause and hybrid choice parity

The successor investigation explains the departure discrepancy and passes the
adopted choice criterion on both frozen subsets and both coefficient arms. It
preserves the preceding failure record. No TBI outcome field is read, and no
ActivitySim source file changes. The installed engine is ActivitySim 1.5.1 under
CPython 3.11.15, NumPy 1.25.2 and pandas 2.3.3.

### Why chunking changes departure choices

The cause is the membership of failed-leg retry cohorts. ActivitySim retries
within each tour chunk, retaining a failed leg while dropping its successful
opposite-direction leg. If any other outbound leg remains in that retry chunk,
legacy logic version 1 replaces the inbound-only leg's initialized earliest
departure with a missing outbound maximum. The resulting probabilities force
failure and consume another random draw. A smaller chunk can lose its final
outbound leg earlier, allowing the same inbound leg to succeed on an earlier
draw. Seeds still depend on row identity; row order does not change these seeds.

The installed [retry loop, lines 565–629](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/trip_scheduling.py#L565-L629),
[chunk-wide outbound condition, lines 377–406](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/trip_scheduling.py#L377-L406)
and [earliest-bound assignment, lines 158–191](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/trip_scheduling.py#L158-L191)
identify the mechanism. [Source custody](chunk-cause-evidence/source-custody.json)
verifies installed bytes against the upstream v1.5.1 tag.

For household 1128682, person 2789209 and tour 114357608, unchunked retries two
and three have missing earliest bounds and forced failures. Retry four succeeds
with departures 16 and 18. The chunked replay has finite bounds on retry two
and selects 18 and 19. Both paths use the same first and second random draws.
The [native trace and source explanation](chunk-cause-evidence/ROOT_CAUSE.md)
retain seeds, offsets and probabilities. Adaptive diagnostic chunk boundaries
differ from the historical run and also expose departures 568664413 and
568664414. The replay does not claim identical historical chunk boundaries.

Documented `logic_version: 2` completes the setting probe but changes four
departures from the legacy unchunked reference. It is not adopted. The selected
path keeps legacy logic and coefficients: production chunking through
`trip_purpose_and_destination`, a stock checkpoint, then `resume_after` that
checkpoint with chunking disabled for `trip_scheduling` and every later step.

### Frozen-subset proof

The [criterion](chunk-cause-evidence/criterion.json) and
[run admission](chunk-cause-evidence/hybrid-before-run.json) precede the proof:
all seven final tables have identical row identities, counts and non-auxiliary
fields. Finite logsums and utilities may differ only within
`max(4 * max(ulp(a), ulp(b)), 1e-12 * max(abs(a), abs(b)))`.
Missing and nonfinite mismatches fail. Each coefficient arm compares with its
own fully unchunked reference.

| Frozen households / persons | Coefficients | Choice/count parity | Tours / trips | Tolerated auxiliary differences |
|---|---|---|---:|---|
| 64 / 166 | Current | Pass | 244 / 628 | None; every exported value exact |
| 64 / 166 | SEMCOG walk | Pass | 244 / 633 | None; every exported value exact |
| 2,000 / 4,971 | Current | Pass | 6,763 / 17,377 | Two one-ULP destination logsums |
| 2,000 / 4,971 | SEMCOG walk | Pass | 6,764 / 17,464 | None; every exported value exact |

The two tolerated cells are `final_trips.destination_logsum`, trip IDs
333400393 and 462309713. Their absolute differences are
1.7763568394002505e-15 and 8.881784197001252e-16. No departure differs.
All comparisons retain the full 634-zone destination domain. Joint-participant
counts are four for each 64-household arm and 274 for each 2,000-household arm.
[Hybrid summary](chunk-cause-evidence/hybrid-summary.json) and individual
comparison receipts retain the full census and file hashes.

The production prefix uses a 64 MiB target and stock 0.05 minimum chunk ratio
for the proof, with actual chooser splitting. Its frozen sizing cache comes
from a separate 2,000-household training prefix and hashes as
`365ccfdc636f0662108ea8b930407c0163c501afe5057fc641984fad5b6a16eb`.
The disabled suffix uses chunk size zero. Stock checkpoints remain enabled.

| Hybrid proof | Prefix elapsed seconds / peak bytes | Unchunked suffix elapsed seconds / peak bytes |
|---|---:|---:|
| 64 current | 92.980 / 1,806,684,160 | 7.268 / 329,330,688 |
| 64 SEMCOG | 91.736 / 1,798,529,024 | 7.405 / 349,499,392 |
| 2,000 current | 273.638 / 1,897,353,216 | 12.136 / 413,745,152 |
| 2,000 SEMCOG | 273.276 / 1,920,765,952 | 11.923 / 416,735,232 |

These are child-scope elapsed times and cgroup peaks, not forecasts for the full
population. All completed proof scopes retain the 9 GiB cap, zero swap and no
OOM events. [Subset health](chunk-cause-evidence/subset-run-health.json) also
retains fully unchunked reference health and earlier preparation attempts.
The reduced-checkpoint probe error, no-split stop and incomplete-cache stop
remain explicit in the root-cause record. None counts as a parity success.

### Full-population resource result

Both full arms run sequentially with all 1,060,601 households, 2,617,177 persons
and 634 zones. The prefix uses the declared 5,500,000,000-byte production chunk
target and the proven cache. Each process runs under
`systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0`.
No Docker stack is stopped. Full-input hashes and all four retained subset
comparisons pass immediately before execution.

Both arms exceed the 9 GiB cap during
`school_location.i1.logsums.gradeschool`, after constructing 10,717,604 sampled
location rows. These are intermediate model rows, not completed tours or
observations. The checkpoint before trip scheduling is not reached.

| Full arm | Prefix result | Outer elapsed seconds | Systemd prefix peak | Unchunked suffix | Final tours / trips / MODELED shares |
|---|---|---:|---|---|---|
| Current coefficients | OOM kill | 475.673 | 9 GiB | Not run | Unavailable / unavailable / null |
| SEMCOG walk candidate | OOM kill | 485.406 | 9 GiB | Not run | Unavailable / unavailable / null |

Systemd confirms `oom-kill` for both units. The wrappers terminate before writing
terminal health receipts, so the retained systemd journals supply the failure
cause and reported peak. The controllers record exit code -15 and the outer
elapsed times above. Systemd's separate wall times are 476.343 and 486.055
seconds. No terminal memory-event census or process-RSS peak is invented.
The suffix has no full-population elapsed or peak measurement.
[Full health](chunk-cause-evidence/full-run-health.json),
[current journal](chunk-cause-evidence/full-current-prefix.systemd.log) and
[SEMCOG journal](chunk-cause-evidence/full-semcog-prefix.systemd.log) retain the
failure evidence. Final-file hash maps are empty because no final tables exist.

**The hybrid path passes choice parity on both frozen subsets and both arms,
but no full-population completion is demonstrated within 9 GiB.** This result
does not prove that every possible unmodified-engine execution path is
impossible. Neither a full unchunked reference nor full-scale suffix memory is
established. The modeled-health report does not run, so supported strata and
mode shares remain unavailable rather than zero. No observation comparison,
coefficient fitting or comparison against AequilibraE occurs.

### Verification, custody and remaining opening steps

The [verification packet](chunk-cause-evidence/VERIFICATION.md) records 28 passing
scoped Python tests with zero skips. Seventeen accepted mutation controls
comprise three harmless survivors and fourteen intended assertion failures,
with exact source restoration. One initial full-input mutation reaches an
incidental missing fixture file; it remains retained and excluded from that
count. Correcting the fixture yields the intended failure without changing the
guard. These source controls do not prove engine parity or scientific accuracy.

All five inspected installed engine files retain their initial source hashes.
All 117 original frozen records and the public archive retain their recorded
hashes. The split and consumed holdouts remain unchanged. New configuration
snapshots, source, comparisons, logs and receipts live in
`chunk-cause-evidence/`; raw synthetic inputs, checkpoints and outputs stay in
ignored scratch. No hosted system, managed database, engine source or
application code changes. The PR remains a draft.

The frozen opening still requires the following work:

1. Resolve the full-population memory boundary without relaxing choice parity,
   reducing the population, patching ActivitySim or opening outcomes. A successor
   execution change needs its own declared settings, subset proof and full-arm
   resource evidence. Complete both arms and retain final hashes and modeled-only
   health before treating runtime preparation as complete.
2. Grade population and travel-input admission independently. Preserve the four
   source-conflict zones and existing gates. Resolve or preregister fare and
   cost-year applicability, MVTA service dependence, drive access, period speeds,
   walk/bicycle assumptions, parking and toll limitations.
3. Freeze observed/model eligibility correspondence, homogeneous linked-trip
   families, diary and location continuity, university evidence, joint and
   at-work handling, quality rules, domains and exclusion denominators.
4. Freeze the derived day-weight-per-tour primary estimator separately from the
   trip-weighted sensitivity, including the day universe, publisher joins,
   household clusters, strata, Taylor-linearized ratio variance, singleton
   treatment and simultaneous bounds. Unsupported uncertainty stays unavailable.
5. The lead verifies the original split and held-out boundary, reviews input and
   implementation closure, and issues a new exclusive opening receipt. Prior
   synthetic receipts and consumed locks do not authorize an opening.
6. Only a later authorized opening may request approved development-outcome
   fields. Evaluate each ActivitySim arm independently against its preregistered
   gates. Keep AequilibraE separate and held-out outcomes closed.

## October 24, 2026 UTC: smaller chunks and allocator settings retain a pre-chunk memory blocker

**Neither full arm completes under 9 GiB.** This round measures memory on
20,000 whole households, retrains the sizing cache on the frozen 2,000-household
fixture, and proves a 256 MiB production target for both coefficient arms. A
second proof admits process-local allocator settings. All four subsequent full
prefix attempts exceed the cap during grade-school preparation, before the
inner logsum chunker starts. No full-population suffix executes. No TBI outcome
field is requested, read or compared.

The full retained population remains 1,060,601 households and 2,617,177 persons
across 634 zones. The diagnostic and parity subsets do not substitute for either
full arm. All prior attempts, frozen records, coefficients and source exclusions
remain unchanged. [Execution boundary](memory-fit-evidence/EXECUTION_BOUNDARY.md),
[memory diagnosis](memory-fit-evidence/JOIN_BOUNDARY.md) and
[full-run health](memory-fit-evidence/full-run-health.json) retain the limits.

### Measured memory

The diagnostic fixes 20,000 households and 49,094 persons by household-ID hash,
independently of choices or survey outcomes, with all 634 destinations.
[Input freeze](memory-fit-evidence/profile-before-run.json) retains membership
selection and input hashes. The profiler reads allocation metadata without
replacing ActivitySim functions or emitting person records.

| Allocation at the grade-school diagnostic boundary | Measurement |
|---|---:|
| Skim package | 826 float32 matrices, each 634 by 634 |
| File-backed skim cache | 1,328,062,624 bytes |
| Pipeline DataFrames, deep accounting | 37,547,489 bytes |
| Merged persons within that pipeline accounting | 25,898,372 bytes |
| Sampled-location frame at helper entry | 205,048 rows; 4,100,960 deep bytes |
| Joined chooser frame at logsum-helper entry | 15,993,744 deep bytes |
| Prepared chooser frame at helper return | 90,474,318 deep bytes |
| A full inner chunk at the 256 MiB target | 5,194 chooser rows; 934,920 chooser deep bytes; 914,144 utility deep bytes |

Deep table accounting can count shared objects and indexes more than once. It
is not an additional physical allocation to add to RSS or cgroup memory. The
[breakdown](memory-fit-evidence/memory-breakdown.json) retains call/return RSS,
working-table and array sizes, and one-second cgroup samples. Those samples can
miss transient peaks; surviving terminal receipts retain scope lifetime peaks.

`MemMapSkimFactory` uses `JitMemMapSkimData`: all 826 matrices enter the backing
file, and each lookup maps and closes that file. The factory does not retain a
permanent 826-matrix heap array. The inspected v1.5.1 path filters unconfigured
period labels but exposes no configured-model-read matrix selector. This study
uses all five periods. No matrix, dtype, precision or skim value changes.

| 20,000-household diagnostic through school location | Elapsed seconds | Cgroup lifetime peak bytes |
|---|---:|---:|
| Prior 5,500,000,000-byte target | 40.088 | 2,910,703,616 |
| 268,435,456-byte target | 82.399 | 2,140,889,088 |
| Same smaller target with allocator settings | 81.141 | 2,007,269,376 |

The smaller target produces 40 grade-school logsum chunks in the diagnostic.
At full scale, failure still occurs before that inner chunker starts. The
source performs a full sampled-location/person join and then full-table
preprocessing before chunked logsum simulation. The retained logs do not
separate the join from preprocessing: the helper's entry message uses DEBUG,
which the model logger suppresses. The initial join-only inference and its
correction remain in the [diagnosis](memory-fit-evidence/JOIN_BOUNDARY.md).
There is no captured Python stack at the kernel OOM kill.

### Settings and choice parity

The prior cache already came from 2,000 households, rather than 64. This round
still retrains it on the same frozen 2,000 households and 4,971 persons, through
`trip_purpose_and_destination`, with a 536,870,912-byte target and minimum chunk
ratio 1.0. Training completes in 768.046 seconds at a 1,946,472,448-byte cgroup
peak. The fresh cache SHA-256 is
`3258b6ecd69d9a9e73e4d0b411a65a6e63308e7fe797d0f65dcc6634a29d7761`.
The [cache bytes](memory-fit-evidence/trained-chunk-cache.csv) remain retained.

An initial 1 GiB current-arm prefix completes but exercises no chooser split.
The unchanged splitting guard refuses admission, so that probe runs no suffix
or full arm. Its configuration, logs and refusal remain retained. The successor
production target is explicitly 268,435,456 bytes with minimum chunk ratio 0.05.
Both full attempts and their matching proofs use that same target. The suffix
uses `resume_after: trip_purpose_and_destination`, disabled chunking and chunk
size zero, preserving legacy trip scheduling.

The allocator successor additionally sets `MALLOC_MMAP_THRESHOLD_=131072`,
`MALLOC_TRIM_THRESHOLD_=0` and `MALLOC_ARENA_MAX=2` in each owned process. These
[documented GNU C Library settings](https://sourceware.org/glibc/manual/latest/html_node/Malloc-Tunable-Parameters.html)
change allocation and release behavior. They change no host-wide default or
ActivitySim source. The host reports glibc 2.43. Both successor proofs retain the
same fresh cache, inputs, RNG seed, coefficients and model sequence.

| 2,000-household proof | Comparison with its own fully unchunked reference | Tours / trips | Joint participants |
|---|---|---:|---:|
| Smaller target, current | Every exported value exact in all seven tables | 6,763 / 17,377 | 274 |
| Smaller target, SEMCOG | Every exported value exact in all seven tables | 6,764 / 17,464 | 274 |
| Allocator settings, current | Every exported value exact in all seven tables | 6,763 / 17,377 | 274 |
| Allocator settings, SEMCOG | Every exported value exact in all seven tables | 6,764 / 17,464 | 274 |

Each proof contains actual chooser splitting and an unchunked resumed suffix.
The adopted maximum of four ULP or 1e-12 relative error remains available only
for auxiliary logsums/utilities, but none of these four comparisons needs it.
Every row identity, count, choice and auxiliary value matches exactly.
[Parity summary](memory-fit-evidence/parity-summary.json) retains all reference
and candidate final-file hashes. This is subset execution parity, not a
full-population reference or scientific validation.

### Full retained-population resource result

Every prefix runs sequentially under
`systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0`.
All four reach 10,717,604 grade-school sampled-location rows. These intermediate
rows are not completed tours, trips or observed records.

| Full arm and execution setting | Prefix outer elapsed seconds | Systemd result / reported peak | Suffix | Final tours, trips and MODELED shares |
|---|---:|---|---|---|
| Current, 256 MiB target | 764.724 | OOM kill / 9 GiB | Not run | Unavailable |
| SEMCOG, 256 MiB target | 748.851 | OOM kill / 9 GiB | Not run | Unavailable |
| Current, same target plus allocator settings | 846.011 | OOM kill / 9 GiB | Not run | Unavailable |
| SEMCOG, same target plus allocator settings | 816.280 | OOM kill / 9 GiB | Not run | Unavailable |

Last retained samples contain 9,491,968,000 to 9,560,707,072 anonymous bytes,
while file cache falls to 5,533,696 to 13,398,016 bytes. Scope swap use remains
zero in every retained sample. Terminal monitor receipts are absent after the
OOM kills; the journals establish the final `oom-kill` result and reported
9 GiB peak. No missing terminal event census or suffix peak is invented.
[Stage memory summary](memory-fit-evidence/stage-memory-summary.json) separates
one-second sampled stage peaks from exact surviving scope lifetime peaks.

No full-arm final CSV exists, so all full-arm final-output hash maps are empty.
No modeled-share report runs. Overall or preregistered-stratum shares remain
unavailable, not zero. The full-health packet retains hashes of partial pipeline
checkpoints without presenting them as completed travel outputs. Removing skim
file cache cannot explain the anonymous allocation at the observed failures.
The tested smaller-target and allocator paths do not resolve this boundary.
This does not prove that every unmodified-engine configuration is impossible.

### Verification and frozen-opening steps

Scoped verification passes 29 Python tests with zero skips: 14 parity tests,
six inherited controller tests and nine admission/execution tests. Nine accepted
mutation controls contain two harmless comment survivors and seven intended
assertion failures, with exact source restoration. An earlier malformed
failed-proof fixture produces an incidental KeyError; it remains retained and
excluded from that count. Synthetic refusal tests do not prove engine parity,
full-population memory fit or scientific accuracy. The 1 GiB no-split refusal
also remains separate from a numerical parity result.

All ten pinned installed engine files and all 117 original frozen study records
retain their hashes. Runtime versions remain CPython 3.11.15, ActivitySim 1.5.1,
NumPy 1.25.2 and pandas 2.3.3. Raw local logs remain in ignored scratch files;
byte-identical gzip copies and custody hashes enter this packet. Configurations,
commands, source snapshots, corrections, comparisons and failed attempts remain
retained. The product-direction check passes with its dated review reminders.
No Next.js build, Vitest run, Docker change, hosted operation, database operation,
engine patch, coefficient change or default change occurs. The PR stays draft.

The frozen opening still requires these steps:

1. Resolve the measured full-table preparation memory boundary and complete both
   full retained-population arms. Keep the 9 GiB cap, zero swap, full population,
   adopted choice criterion and unchunked suffix unless the lead separately
   authorizes a successor design. Retain final hashes, supported modeled strata
   and stage resource receipts. Neither suffix memory nor full completion is
   established by this round.
2. Grade population and travel inputs independently. Preserve the four
   source-conflict zones and unchanged population gates. Resolve or preregister
   fare and cost-year applicability, MVTA service dependence, drive access,
   period speeds, walk/bicycle assumptions, parking and toll limitations.
3. Freeze observed/model eligibility correspondence, homogeneous linked-trip
   families, diary and location continuity, university evidence, joint and
   at-work handling, quality rules, required domains and exclusion denominators.
4. Freeze the derived day-weight-per-tour primary estimator separately from the
   trip-weighted sensitivity, including the day universe, publisher joins,
   household clusters, strata, Taylor-linearized ratio variance, singleton
   treatment and simultaneous bounds. Unsupported uncertainty stays unavailable.
5. The lead verifies the original split and held-out boundary, reviews the exact
   input and implementation closure, and issues a new exclusive opening receipt.
   Prior synthetic receipts and consumed locks do not authorize that opening.
6. Only a later authorized opening may request approved development-outcome
   fields. Evaluate each ActivitySim arm independently against its preregistered
   gates. Keep AequilibraE separate and held-out outcomes closed.

## October 24, 2026 UTC: full preprocessing vectors exhaust 9 GiB; integer setting rejected

**The full current arm still exceeds 9 GiB. Model execution stops.** The join
completes; full-length preprocessing vectors exhaust the cap before inner
chunking. The SEMCOG full arm and both full suffixes remain unrun in this round.
No TBI outcome field is requested, read or compared. Both frozen coefficient
arms, the full retained population and all prior failures remain unchanged.

The [allocation report](prechunk-evidence/ALLOCATION.md) supplies rows, column
counts, dtypes, bytes and installed ActivitySim 1.5.1 source lines for the
20,000-household diagnostic and the full-population failure. The full attempt
contains 1,060,601 households, 2,617,177 persons and all 634 destination zones.
These are the complete retained inputs, not a memory-driven sample.

| Full allocation before the failure | Rows by columns | Deep bytes, except stated payload |
|---|---|---:|
| Households | 1,060,601 by 24 | 156,846,332 |
| Persons | 2,617,177 by 30 | 331,968,069 |
| Persons merged | 2,617,177 by 92 | 1,391,924,754 |
| Accessibility | 634 by 10, float64 | 55,792 |
| Size-term definitions | 22 by 12 | 5,337 |
| School / workplace destination size | 634 by 3 / 634 by 4, float64 | 36,840 / 41,912 |
| School shadow-price matrix | Disabled, not allocated | Not applicable |
| Sampled grade-school locations | 10,717,604 by 3 | 214,352,080 |
| Joined logsum choosers | 10,717,604 by 12 | 835,973,112 |
| Six batched normal draws | 10,717,604 by 6, float64 | 634,002,440 |
| Retained preprocessing result vectors | 10,717,604 by 46 | 3,065,234,744 payload |

Deep table bytes overlap through shared indexes, buffers and Python objects.
They are not additive physical-memory measurements. `persons.py:79-112` builds
the merged person table. `location_choice.py:558-565` filters and joins the
sampled locations. `logsums.py:247-267` runs full preprocessing before inner
simulation. `assign.py:310-329` draws six full-length random columns and
`assign.py:346-450` retains expression results and temporaries.

The last completed full trace is at `assign.py:349`, immediately before the
`sov_available` target. Its stock expression at preprocessor CSV line 72 is
`(odt_skims['SOV_TIME']>0) & (dot_skims['SOV_TIME']>0)`, evaluated at
`assign.py:397`. Forty-six result vectors and additional temporaries are already
live. Neither the result DataFrame constructor nor the inner logsum chunker
has been reached. The exact native allocation instruction inside the pending
expression is not captured. This record does not claim a malloc-level stack.

### Exact reductions and rejected settings

1. The complete configuration/spec scan finds `land_use.source_geoid` unused.
   The existing `keep_columns` already discards it. Removing it from a derivative
   raw CSV saves 7,621 file bytes and no large persistent table. Both
   2,000-household arms pass exact equality across every field in all seven
   tables. All seven exports also match their own reference hashes. Current
   retains 6,763 tours and 17,377 trips; SEMCOG retains 6,764 and 17,464.
   Both retain 274 joint participants. Original inputs remain untouched.
2. The installed documented `downcast_int: true` setting is tested separately,
   with `downcast_float: false`. It fails the current-arm exact gate: 2,630
   accessibility cells differ across five columns. Their checkpoint dtype
   becomes float32 because narrowed integers change mixed arithmetic promotion
   with the existing float32 skims. The other six tables remain exact, which
   does not rescue the gate. The setting is rejected before full use. The
   SEMCOG integer probe is skipped after that failure, not reported as passing.
3. The installed configuration exposes no automatic categorical conversion or
   single-process setting that defers/chunks this merged-table preprocessing.
   Inner `explicit_chunk` operates later. No engine patch, float downcast,
   reduced destination domain or sampled full arm is introduced. Selective
   dtype declarations and multiprocessing are untested, not ruled out.

[Method and source notes](prechunk-evidence/method-notes.md),
[input scan](prechunk-evidence/input-column-scan.json),
[current exact proof](prechunk-evidence/columns-2000-current.comparison.json),
[SEMCOG exact proof](prechunk-evidence/columns-2000-semcog.comparison.json), and
[integer failure](prechunk-evidence/integer-failure-analysis.json) retain the
measurements and boundaries. The full attempt uses only the proven column
removal, the existing allocator settings and the 256 MiB production target.
The intended suffix remains unchunked. Global defaults do not change.

### Full-arm health and stop

The instrumented current prefix lasts 1,160.959 seconds, then the kernel kills
it under `systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0`.
An outside observer retains `memory.peak: 9663676416`, `oom: 1`, `oom_kill: 1`
and zero swap peak before cgroup removal. The journal independently reports
`oom-kill`. The last one-second sample contains 9,576,824,832 anonymous bytes
and 12,283,904 file-cache bytes. The missing in-scope terminal receipt stays
missing. Instrumentation overhead prevents treating this as an uninstrumented
runtime benchmark.

Sampled stage peaks are 1,714,835,456 bytes for land-use initialization,
5,267,734,528 for household initialization, 3,566,059,520 for accessibility,
and 9,613,721,600 for school location. These are one-second lower bounds,
separate from the kernel lifetime peak. The [resource stop](prechunk-evidence/full-resource-stop.json),
[scope observer](prechunk-evidence/full-current-prefix.external.jsonl), and
[stage health](prechunk-evidence/run-health-summary.json) retain the evidence.

The stop instruction prevents a SEMCOG full attempt after this failure. No
full final travel table exists; counts, MODELED shares, preregistered strata
and final hashes remain unavailable. Partial checkpoints are not completed
outputs. The tested preprocessing path needs more than 9 GiB. Its uncapped
peak and later-stage demand remain unmeasured. No Docker stack is stopped.

### Verification and remaining frozen-opening steps

Source verification passes 25 Python tests with zero skips: 14 inherited
parity tests and 11 successor custody/stop tests. Eleven unique mutation
controls contain one harmless survivor and ten intended assertion failures.
Controls compile isolated namespaces and leave source bytes unchanged. Earlier
nine-control receipts remain retained and are not added again to this total.
These checks do not establish scientific accuracy or full-population parity.
The direction check fails at `spawnSync git ENOBUFS`: its changed-path listing
is 1,070,317 bytes. The checker and review dates remain unchanged.

All 117 original frozen records and the pinned engine files retain their
hashes. No installed ActivitySim source, coefficient, skim value, held-out
boundary, hosted system or database changes. No Next.js build or Vitest run
occurs. The PR remains draft. The remaining opening steps are:

1. The lead supplies more memory or separately admits another exact execution
   design. Complete both full arms with stage resource receipts, final hashes
   and supported modeled strata. This cap failure does not authorize a retry.
2. Grade population and historical travel inputs independently. Preserve the
   four source-conflict exclusions and resolve or preregister the existing fare,
   cost-year, MVTA, drive-access, period-speed, walk/bicycle, parking and toll
   limitations without relaxing gates.
3. Freeze observed/model eligibility, homogeneous trip families, diary/location
   continuity, university, joint/at-work and quality rules, domains and exclusions.
4. Freeze the separate day-weight-per-tour and trip-weighted estimators, publisher
   joins, clusters, strata, variance, singleton treatment and simultaneous bounds.
5. The lead verifies the original split and complete custody, then issues a new
   exclusive opening receipt. Historical synthetic receipts do not authorize it.
6. Only a later authorized opening may access approved development outcomes.
   Keep held-out outcomes closed and AequilibraE separate from ActivitySim.

## October 24, 2026 UTC: 16 GiB clears school preparation but fails at workplace preparation

**The full current arm exceeds the admitted 16 GiB resource envelope. Execution
stops before SEMCOG.** The uninstrumented engine completes school location and
the `work_low` and `work_med` workplace segments. The kernel kills it during
`workplace_location.i1.logsums.work_high`, after sampling 11,287,061 destination
rows and before any retained inner logsum chunk for that segment. These are
intermediate model rows, not completed tours or observed records. Without the
previous Python allocation tracer, the exact failing expression is unmeasured.
The earlier grade-school allocation diagnosis does not identify this new
workplace allocation instruction.

The lead explicitly authorizes this 16 GiB successor to the earlier 9 GiB
attempt. The full retained population remains 1,060,601 households, 2,617,177
persons and 634 zones. The run uses the proven 268,435,456-byte production target,
minimum chunk ratio 0.05, frozen trained cache and process-local allocator
settings. Integer and float downcasting remain false. Configurations match all
four retained 2,000-household exact-parity execution receipts byte for byte.
The intended suffix resumes after `trip_purpose_and_destination` with chunking
disabled; it never starts. No population sample, coefficient change, engine
patch, scalar fitting or default change occurs.

| Full arm | Result | Outer elapsed seconds | Kernel peak bytes | Completed tours / trips / MODELED shares |
|---|---|---:|---:|---|
| Current coefficients | OOM kill during workplace `work_high` logsum preparation | 3,231.999 | 17,179,869,184 | Unavailable / unavailable / null |
| SEMCOG walk candidate | Not run after the current-arm failure | Unavailable | Unavailable | Unavailable / unavailable / null |

The command uses `systemd-run --user --scope -p MemoryMax=16G -p
MemorySwapMax=0`. The external observer retains one OOM event, one OOM kill,
7,781 memory-limit events and a zero-byte swap peak before cgroup removal.
The systemd journal independently reports `oom-kill`, 16G peak and 3,231.886
seconds of scope wall time. The controller reports exit code -15 and stops.
The killed in-scope monitor writes no terminal health receipt. No terminal
process-RSS measurement is invented. Earlier limit-pressure events during
school and `work_med` preparation reclaim memory without an OOM kill; those
successful stage transitions do not establish full-arm completion.

| Current-prefix stage group | One-second sampled cgroup peak bytes |
|---|---:|
| Startup | 404,348,928 |
| Land-use initialization | 1,881,800,704 |
| Household initialization | 6,303,318,016 |
| Accessibility | 3,698,024,448 |
| School location | 17,179,832,320 |
| Workplace location | 17,179,766,784 |

These stage values are sampled lower bounds, separate from the kernel lifetime
peak. [Run health](full16-evidence/run-health.json) retains stage sample counts,
commands, configuration hashes, last engine lines and external terminal
counters. No full-arm final CSV exists. Final-output hash maps remain empty;
tour counts, trip counts, MODELED shares and preregistered strata remain
unavailable, not zero. The modeled-health report does not run after the failure.
Neither ActivitySim arm is compared with observations, with the other arm or
with AequilibraE.

### Private evidence and verification

The [archive manifest](EVIDENCE_MANIFEST.json) replaces 551 raw-log, telemetry
and large-evidence files totaling 35,339,551 bytes. Every archived byte length
and SHA-256 passes verification before and after removal from the working tree.
The archive root is
`/home/nathaniel/.local/state/openplan/tbi2019-evidence-archive-20261024/`.
The final manifest SHA-256 is
`c16b4c53aeec124c211966e615cff99b87944cced92bfcfb72a683a39bb14099`.
Historical commits and reports remain intact. This changes the branch's current
file tree; it does not rewrite Git history or remove historical Git objects.

The new private run root is
`/home/nathaniel/.local/state/openplan/tbi2019-full16-20261024/`.
Its [output manifest](full16-evidence/OUTPUT_MANIFEST.json) inventories 50 files
and 1,508,528,501 bytes, including partial checkpoints, cache, logs and resource
receipts. Every entry passes a second byte-length and SHA-256 verification.
Manifest SHA-256:
`5bbb54f960d15d930331f8ff1adc5c7dd06b63c808618314ff04fafcf1a3fc04`.
These are failed-attempt artifacts, not completed travel outputs.

The direction checker now allows 64 MiB for captured Git output. The command
passes and retains existing advisory review reminders without changing dates.
Scoped verification passes 18 tests with zero skips in the complete test runs.
Fourteen accepted mutation controls contain three harmless survivors and 11
intended assertion failures. Each focused Vitest mutation intentionally leaves
seven unrelated tests unselected. The initial root-directory Vitest invocation
fails on script resolution; the corrected application-directory run passes.
[Verification](full16-evidence/VERIFICATION.md) records restoration, skips and
blind categories. No Next.js build runs.

Native preflight rechecks both retained exact-parity comparisons and input/cache
hashes. All 117 original frozen records and 26 unique installed engine,
configuration and pandas files retain their hashes after execution. The runtime
remains CPython 3.11.15, ActivitySim 1.5.1, NumPy 1.25.2 and pandas 2.3.3. No TBI
outcome field, held-out outcome, Docker container, hosted system, managed
database or secret is accessed. The PR remains draft. No retry follows this
resource failure.

### Exact remaining frozen-opening steps after the 16 GiB stop

1. The lead separately authorizes a successor resource or exact execution
   design. Resolve the measured workplace preparation limit, then complete
   both full retained-population arms and their unchunked suffixes. Preserve
   this failure, existing parity criteria, input exclusions and final-output
   custody. A higher uncapped peak and full-population suffix requirements
   remain unmeasured. Retain completed modeled-only health and supported strata.
2. Grade population and historical travel inputs independently. Preserve the
   four source-conflict exclusions and unchanged population gates. Resolve or
   preregister fare and cost-year applicability, MVTA service dependence,
   drive access, period speeds, walk/bicycle assumptions, parking and toll
   limitations. Runtime completion cannot waive these admissions.
3. Freeze observed/model eligibility correspondence, homogeneous linked-trip
   families, complete diary and location continuity, university evidence,
   joint and at-work handling, quality rules, every required domain and
   exclusion denominator. Keep unsupported domains unavailable.
4. Freeze the derived day-weight-per-tour primary estimator separately from
   the trip-weighted sensitivity. Fix the day universe, publisher joins,
   household clusters, county/sample-segment strata, Taylor-linearized ratio
   variance, singleton treatment and simultaneous bounds.
5. The lead verifies the original split, held-out boundary and complete input,
   implementation and output custody, then issues a new exclusive opening
   receipt. Historical synthetic receipts and consumed locks do not authorize it.
6. Only a later authorized opening may request approved development-outcome
   fields for the frozen in-scope IDs. Evaluate each ActivitySim arm independently
   against its preregistered gates. Keep held-out outcomes closed and AequilibraE
   separate. No scientific acceptance or default change follows from this run.

## October 24, 2026 UTC: four-process exact parity fails on six logsum cells

**The current arm fails the requested exact seven-table gate. Execution stops
before the SEMCOG subset and both full arms.** Six modeled logsum cells differ
by one to three ULP. Every other exported value, row identity, row count and
dtype matches the current arm's retained single-process unchunked reference.
No logsum tolerance is adopted. The older choice-level admission does not
override this round's stricter criterion. No survey outcome is accessed.

### Configuration and custody

The [criterion recorded before execution](multiprocess-evidence/criterion-before-run.json)
fixes the same 2,000 households, 4,971 persons, 634 destinations and RNG seed
zero. The original seven reference-file hashes pass revalidation. Runtime stays
CPython 3.11.15, ActivitySim 1.5.1, NumPy 1.25.2 and pandas 2.3.3. The worker
virtual environment resolves to the installed CPython 3.11 interpreter.

The candidate sets `multiprocess: true`, `num_processes: 4` and `fail_fast: true`.
Its `mp_initialize` group runs land-use initialization, household initialization
and accessibility in one process. `mp_households` starts at `school_location`
and slices `households`, then dependent `persons`, across four processes. It
continues through `trip_purpose_and_destination`. Each group explicitly sets
`chunk_size: 268435456`; the household group therefore keeps a 256 MiB target
per process rather than dividing the global target by four. Production mode,
the frozen cache, 0.05 minimum ratio, file-backed skims and allocator settings
remain explicit. Both downcast settings remain false. Each scope applies
`MemoryMax=16G` and `MemorySwapMax=0` to all descendants.

The [v1.5.1 user guide](https://github.com/ActivitySim/activitysim/blob/v1.5.1/docs/users-guide/performance/multiprocessing.md)
documents process counts and model groups. The
[stock example](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/examples/prototype_mtc/configs_mp/settings.yaml#L77-L94)
provides the household/person slicing pattern. The
[slicing implementation](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/core/mp_tasks.py#L352-L513)
derives dependent-table slices; the
[chunk-size implementation](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/core/mp_tasks.py#L1992-L2001)
honors an explicit group target. Installed multiprocessing source and example
bytes match the upstream tag. [Source custody](multiprocess-evidence/multiprocessing-sources.json)
retains URLs, access date and hashes.

The prefix uses the production cache without a training fallback. Accessibility
runs two chunks. Each 500-household worker runs single chunks within its slice:
240, 244, 246 and 246 logged chunk calls, with maximum chunk ordinal one in
each worker. The inherited global split guard sees the accessibility split; it
does not prove multi-chunk household execution. That household-chunk evidence
remains unproved and cannot be inferred from the configured target.

The suffix uses `multiprocess: false`, disabled chunking and chunk size zero.
It restores `mp_households` and explicitly runs the unchanged model list from
`trip_scheduling` onward. Trip scheduling is neither sliced nor chunked.
The [coalescing implementation](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/core/mp_tasks.py#L752-L870)
concatenates dependent tables in process order. It preserves identity but
changes row order from the single-process reference.

### Setup failures remain separate from numeric parity

The first prefix completes, but the inherited suffix requests the checkpoint
`trip_purpose_and_destination`. Stock multiprocessing saves its final checkpoint
under the group name `mp_households`. The absent-checkpoint restore leaves an
`init`-only inventory, and scheduling fails with
`context['trips'] doesn't exist`. A copied checkpoint therefore also lacks the
expected inventory and produces the same setup failure. Neither attempt reaches
a numerical comparison. Both logs, configurations and failed inventories remain
retained.

The corrected controller repeats the unchanged prefix into a new directory,
checks that `mp_households` exists, then restores that checkpoint with the
explicit suffix list. This prefix and suffix complete. The two failed suffixes
remain setup failures, not successful parity checks. No engine source or
checkpoint contents are patched. [Recovery freeze](multiprocess-evidence/resume-before-run.json)
and [replay freeze](multiprocess-evidence/replay-before-run.json) precede those
attempts and preserve the exact criterion.

### Exact differing records and mechanism boundary

These are synthetic model IDs, not respondent IDs.

| Table and field | ID | Unchunked reference | Four-process candidate | ULP difference |
|---|---:|---:|---:|---:|
| Tours, mode_choice_logsum | 118630948 | 0.5025382481544909 | 0.5025382481544911 | 2 |
| Tours, mode_choice_logsum | 119205787 | 0.6034053884393223 | 0.6034053884393225 | 1 |
| Tours, mode_choice_logsum | 119341311 | -0.4632975893614433 | -0.4632975893614431 | 3 |
| Trips, destination_logsum | 42672878 | 10.561189505765524 | 10.561189505765523 | 1 |
| Trips, destination_logsum | 576278866 | 1.760076682156945 | 1.7600766821569451 | 1 |
| Trips, mode_choice_logsum | 953782221 | -2.0050712464132023 | -2.005071246413203 | 1 |

[Complete differences](multiprocess-evidence/all-table-differences.json) include
hexadecimal float encodings and every differing cell across all seven tables.
Counts remain 6,763 tours, 17,377 trips and 274 joint participants. The five
other tables are exact. All destination, mode and departure choices are exact.
These facts do not rescue the six failed cells.

Read-only [checkpoint comparisons](multiprocess-evidence/checkpoint-differences.json)
locate the first retained tour differences at `tour_mode_choice_simulate` and
the first two trip differences at `trip_destination`. The preceding tour and
trip checkpoints are exact. Trip scheduling adds no differences. Trip mode
choice adds the sixth cell in the single-process suffix. For that trip, row
position changes from 17,284 to 8,597 after coalescing.

The observed execution mechanism changes chooser-array shapes during household
slicing and row layout during coalescence. ActivitySim computes utilities using
[NumPy dot products](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/core/simulate.py#L722-L725)
and logsums using
[nested sums, logarithms and exponentials](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/core/simulate.py#L1094-L1141).
Shape/order-sensitive floating-point arithmetic is the supported explanation
for these ULP differences. The retained checkpoints do not isolate the exact
NumPy instruction that first rounds differently. No additional engine replay
or tolerance change follows the numeric failure.

### Resource result and sizing limit

| Current 2,000-household execution | Outer elapsed seconds | Kernel cgroup peak bytes | Result |
|---|---:|---:|---|
| Initial four-process prefix | 141.247 | 2,868,314,112 | Completed |
| Initial suffix | 2.351 | 218,513,408 | Missing checkpoint, exit 99 |
| Copied-checkpoint suffix | 1.954 | 217,133,056 | Missing inventory, exit 99 |
| Repeated four-process prefix | 140.657 | 2,625,507,328 | Completed |
| Corrected unchunked suffix | 10.778 | 345,870,336 | Completed; exact comparison fails |

Every scope records zero OOM events and a zero swap limit. The repeated prefix's
four worker VmHWM observations are 480,808,960; 476,078,080; 478,429,184; and
480,145,408 bytes. These are kernel process high-water marks observed at
one-second sampling times, not guaranteed terminal maxima. Shared pages can
appear in multiple RSS figures. The cgroup peak governs aggregate accounting.
The monitor misses some `#run_model` stage labels, so this round makes no
stage-group peak claim from those labels. Raw logs and samples remain retained.

Sizing remains unadmitted for the full population. Four slices would contain
at most 265,151 households each. Four times the largest observed subset-worker
VmHWM is 1,923,235,840 bytes, before parent, cache and other scope accounting;
the actual subset cgroup peak is larger. The earlier killed single-process
full run reaches 17,179,869,184 bytes, a censored measurement. Dividing that
figure by four gives 4 GiB per process, and multiplying four concurrent
processes returns 16 GiB before additional process overhead. Slicing alone does
not establish an aggregate saving. Neither these subset measurements nor the
previous OOM yields a defensible full-run upper bound. The parity failure
prevents a full-population sizing attempt at any process count.

SEMCOG subset parity is **not run after the current-arm failure**. Both full
arms are **not run**. Full-arm counts, MODELED shares, supported strata and
final-output hashes remain unavailable. [Run health](multiprocess-evidence/run-health.json)
retains all attempt receipts, per-process measurements and seven completed
current-subset output hashes. Full-output hash maps remain empty. Outputs stay
outside Git under `/home/nathaniel/.local/state/openplan/tbi2019-multiprocess-20261024/`.
The [private-output custody record](multiprocess-evidence/OUTPUT_CUSTODY.json)
pins its inventory.

### Verification and remaining frozen-opening work

Scoped verification passes 32 Python tests with zero skips: 14 inherited exact
and choice comparator tests, 12 controller tests and six recovery tests.
Fourteen accepted source mutation controls contain two harmless survivors and
12 intended assertion failures. Mutation namespaces leave source bytes unchanged.
One earlier cache-guard mutation reaches an incidental missing fixture file;
that attempt remains retained and excluded. Completing its downstream fixture
makes the disabled guard fail through the intended assertion. These tests do
not establish engine parity, full-memory fit, stage-sampler correctness or
scientific accuracy. [Verification](multiprocess-evidence/VERIFICATION.md) records
commands and limits.

All 117 original frozen records and 27 pinned installed engine/configuration/
pandas files retain their hashes. The product-direction check passes with its
existing dated reminders. No Next.js build, Vitest run, Docker change, hosted
operation, database operation, coefficient change or default change occurs.
The PR remains draft.

1. The lead must authorize a successor exact execution design after reviewing
   these six cells. Preserve this failed gate and complete exact parity for both
   arms before any full attempt. Then establish aggregate memory fit and complete
   both full retained-population arms with stage resources and modeled-only health.
2. Grade population and historical inputs independently. Preserve the four
   source-conflict exclusions and resolve or preregister fare/cost-year, MVTA,
   drive-access, period-speed, walk/bicycle, parking and toll limitations.
3. Freeze observed/model eligibility, homogeneous linked-trip families, diary
   continuity, university, joint/at-work and quality rules, domains and exclusions.
4. Freeze separate day-weight-per-tour and trip-weighted estimators, publisher
   joins, clusters, strata, variance, singleton treatment and simultaneous bounds.
5. Verify the split and complete custody, then obtain a new lead-owned exclusive
   opening receipt. Previous synthetic receipts and consumed locks do not apply.
6. Only a later authorized opening may access approved development outcomes.
   Keep held-out outcomes closed and AequilibraE separate from ActivitySim.
