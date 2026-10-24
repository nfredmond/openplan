# 2019 population and tour preparation addendum

October 23, 2026. Implementation base: `ccfd7f77ac0b2dba94de322b46547ac1ad07a546`.
This addendum preserves the frozen preregistration, split, result and consumed
synthetic receipt. It does not reopen the retired attempt.

**The 2019 population compatibility gate now works. The tour constructor works
on synthetic diaries. The public-release-to-tour pipeline remains unadmitted.**
Transit remains in the separate lane. Transit completion alone will not resolve
the source-linkage, tour-weight and modeled-filter questions below. Neither
ActivitySim arm executes here. No AequilibraE output enters this work.

## Population compatibility is explicit

The catalog adds `us_census_acs5_pums_2019`. It admits this exact pair:

- ACS five-year summary: `https://api.census.gov/data/2019/acs/acs5`.
- ACS five-year PUMS: `https://api.census.gov/data/2019/acs/acs5/pums`.
- Sample window: 2015–2019, not a 2019 one-year sample.
- PUMA geography: the single `PUMA` field uses 2010 boundaries.
- Source income: 2019 dollars after the existing `HINCP * ADJINC / 1000000` conversion.
- MTC income: year-2000 dollars using `172.2 / 255.657`.

The [Census 2015–2019 PUMS ReadMe](https://www2.census.gov/programs-surveys/acs/tech_docs/pums/ACS2015_2019_PUMS_README.pdf),
sections III.B and XI.C, documents the PUMA definition and income adjustment.
The [2019 variable metadata](https://api.census.gov/data/2019/acs/acs5/pums/variables.html)
identifies `PUMA`, `ADJINC`, `SCHG` and the other required PUMS fields. The
[BLS historical CPI-U table](https://www.bls.gov/cpi/tables/supplemental-files/historical-cpi-u-202002.pdf)
provides the annual averages. This is dollar denomination, not fitted scaling.

The source audit checks 187 required ACS estimate, margin and enrollment fields
against official metadata. The top-level variables index omits margin fields;
the five group responses supply them. The [audit](preparation-evidence/population-source-audit.json)
retains labels, hashes, window, geography and income basis. The
[manifest](preparation-evidence/source-manifest.json) records exact downloaded
bytes and failed source retrievals. BLS was readable through the web source
reader; direct HTTP downloads returned 403, so no local BLS hash is claimed.
Original source bytes remain in the manifest's local directory.

The existing registry enforces exact field membership, endpoint pairing,
capability selection and source identity. Existing PUMA response-schema and
predicate checks remain in force. The 2019 entry supports explicit production,
retained validation and ActivitySim consumption. It **does not enable new guided
launches**. Existing 2022/2023 entries and defaults remain unchanged. No geography
literal enters the core synthesizer. The source-only forward migration
`20261023224145_population_profile_2019.sql` updates the private SQL catalog
helper without changing callers or grants. No database migration runs here.

This proves technical compatibility. It does not establish a seven-county
population fit, historical zone geometry, control residuals or a real Census
input archive. The five-year estimate is not an exact snapshot of each diary's
date. A successor must preserve that temporal limitation. Explicit endpoints
must reach the bundle builder together; the default remains 2022 in the lower
Census adapter and the app's selected source remains 2023.

## Tour construction preserves the frozen rules

`scripts/modeling/tbi2019_tours.py` contains pure functions. It has no HTTP client,
model invocation, estimator of observed shares, or study-opening command.
`decode_linked_trip` reads publisher identifiers, reported/cleaned detailed mode,
purpose, Central times, driver, occupancy and linked-trip weight. It requires
separate exact-location and quality evidence. Missing evidence stays unknown.
The typed `Diary` input carries an already joined household/person/day identity;
the caller must verify the raw table joins and source custody before real use.
This lane does not claim that raw-table acquisition/join layer exists.

| Rule | Implementation and source |
|---|---|
| Grouping | Exact household, person and day keys; duplicate diary identity refuses. Duplicate trip IDs quarantine the affected days. [TBI codebook](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/appendices/combined_codebook.xlsx), 2019 variable list and unified crosswalk. |
| Time | Order departure, arrival and stable trip ID. Use US/Central, as specified for `depart_time` and `arrive_time` in the codebook. Refuse missing/ambiguous DST times, overnight chains and overlapping intervals. These exclusions implement the frozen contract. |
| Home-based tour | Begin at home and end on the next home return. Require exact endpoint and purpose continuity. Every trip must remain accounted for. A bad record quarantines its day; it cannot disappear and connect two formerly separated trips. [Frozen mapping contract](PREREGISTRATION.md#trip-to-tour-mapping-contract). |
| Primary destination | Work precedes university, which precedes school. Within priority, use longest non-home activity dwell, then earliest arrival, then stable trip ID. Dwell is next departure minus arrival. University needs explicit postsecondary school type. This hierarchy is the preregistered observation rule, not a claim that ActivitySim supplies a universal survey recoder. |
| Work-based subtour | Extract a closed excursion from the parent tour's primary work location. Retain its parent trip IDs. It never becomes an extra home-based tour or extra trip in conservation. [ActivitySim at-work documentation](https://activitysim.github.io/activitysim/develop/dev-guide/components/atwork_subtour_frequency.html). |
| Tour mode | Preserve the frozen homogeneous-family rule. Every linked trip must map to the same family: auto, walk, bicycle, transit or hired travel. Mixed-family tours remain exclusions. No longest-trip or modal-priority substitution occurs. |
| Mode evidence | Use exact codebook detailed labels and explicit unified aliases. Require occupancy/driver evidence for private auto and supported access/egress for transit. School bus, motorcycle, ambiguous other vehicle and unrepresented modes remain unsupported. Unknown labels remain a separate reason. No predicted-mode field is read. |
| Separate categories | Joint-travel tours and at-work subtours have separate inventories. The joint-travel inventory includes any chain with supplied joint-travel evidence; it is not a claim that ActivitySim's fully joint participation rule has been verified. Proxy, derived-child, trace, geography and linkage exclusions remain counted. |

ActivitySim distinguishes tour mode from trip mode. Its
[tour-mode documentation](https://activitysim.github.io/activitysim/develop/dev-guide/components/tour_mode_choice.html)
allows trip modes to vary within a tour. Therefore, the preregistered homogeneous
subset is narrower than native tour-mode output. The current primary-tour
instrument cannot by itself prove that all downstream trips use one family.
An equivalent modeled-tour filter remains required. The retrieved documentation
is the current development documentation, not a pinned 1.5.1 documentation
snapshot; attempted versioned documentation URLs returned 404. No installed
configuration or coefficient changes.

The source-derived crosswalk is `tbi2019_crosswalk.v1.json`. It includes 85 exact
mode labels/aliases and 43 purpose labels/aliases, including unsupported labels.
The workbook hash is embedded. These are metadata entries, not observed category
frequencies. The hosted service uses strings without coded-value domains.
Its actual labels, cleaned-purpose transformation and linked-trip lineage still
need verification under the next authorized preparation/opening protocol.

Public linked-trip metadata includes TAZ, tract and block-group endpoints. Those
fields do not prove exact place identity. The decoder deliberately does not
turn a common zone into a continuous location chain. Trace/derived-child/joint
linkage and transit access/egress are also not inferred from absence of flags.
No unsupported source fact is filled with a plausible default.

## Tour weights have a documented derivation, not publisher certification

The [codebook](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/appendices/combined_codebook.xlsx)
names `hh_weight`, `person_weight`, `day_weight` and `trip_weight` at their
respective record levels. The hosted linked-trip schema separately names
`linked_trip_weight`. The [weighting chapter](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/06_expansion_and_weighting/ch_6_expansion_and_weighting.html)
explains multiday normalization and subsequent day/trip nonresponse adjustments.
Its [user guide](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/appendices/data_users_guide_R.html#variables-in-different-tables)
recommends the lowest appropriate record-level weight. Neither source supplies
a tour-specific expansion weight or authorizes averaging linked-trip weights.

The implemented **derived person-day tour-count estimator** treats each complete
person-day as a sampled unit with an observed tour count. Its expanded count is
`sum_d(day_weight[d] * tour_count[d])`. Assigning the same published day weight
to every constructed tour in that day gives the identical sum. It does not
average, sum or select a trip's weight. It does not divide again by number of
trips or days. Positive household and person weights are eligibility checks,
not factors multiplied into the day weight. Complete zero-trip days remain in
the diary accounting, distinct from absent or incomplete diaries.

This algebra establishes a day-count estimand. It does **not** establish that the
publisher's trip-specific nonresponse corrections carry over to constructed
tours. It also does not settle the relevant weekday/weekend expansion universe.
`scientific_admission` remains `unassessed`. The lead must settle and freeze that
estimand, day universe, source joins and household-cluster variance design before
claiming the preregistered source-supported tour-weight gate is satisfied.
No tour shares, weighted outcomes, effective sample sizes or comparison metrics
are computed here. No household/person weight or trip average silently replaces
a missing day weight.

## Permitted development counts

The only real respondent fields inspected are the original frozen roster's
`hh_id`, `home_county` and `survey_year`. Exact response hashes and the existing
assignment hash match. No new network request retrieves respondent records.
The [roster report](preparation-evidence/development-roster.json) records:

| Development roster category | Households |
|---|---:|
| All development households | 6,019 |
| Retained seven-county scope | 5,041 |
| Excluded: outside frozen study region | 978 |
| Missing county | 0 |

These are unweighted household counts. Trip/tour exclusions by each reason are
**unavailable**, not zero, for real development data because evaluating them
would read prohibited travel outcomes. Held-out outcomes requested/read: zero.
Development outcomes requested/read: zero. Held-out assignment metadata is used
only to reproduce and verify the original split; no held-out respondent outcome
is inspected. The original assignment remains
`d00206802218a92d31dceea4c108c74cab540dadd8c90d9d1f21e8b11b99c392`.

The separate [synthetic report](preparation-evidence/synthetic-accounting.json)
contains 60 fabricated trips: four retained trips, 56 excluded trips, one
retained home-based work tour, one nested work-based subtour, one separate
joint-travel tour and one complete zero-trip day. It exercises each of 28
exclusion reasons with exactly two trips. These deliberately balanced counts
are instrument controls, not a TBI distribution. Nested/subset tour inventories
are not added to the trip-conservation denominator.

## Evidence and remaining gates

[Preparation verification](PREPARATION_VERIFICATION.md) records scoped tests,
mutation failures, surviving controls, exact restoration, setup failures and
skips. Source custody and fixture success do not establish historical inputs,
statistical validity, scientific accuracy, native SQL acceptance or hosted use.

Before the next frozen opening, the lead must join the separate historical
transit lane with the remaining road/period/fare/parking and regional-boundary
admission evidence; assemble the real 2019 population/input archive; resolve
exact survey location, quality, joint and label linkage; freeze the tour-weight
estimand and variance design; and establish equivalent modeled-tour selection
and all required domain crosswalks. The lead owns sequencing and the new lock.
The old `inconclusive / retire_this_attempt` record remains intact.

The late documentation-search exposure to a published regional travel summary
is recorded in [verification](PREPARATION_VERIFICATION.md#controls-and-retained-failures).
No code or mapping rule changed afterward. The lead must retain that distinction
from the unopened respondent partitions.
