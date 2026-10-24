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
