# Nationwide validation successor, draft for review

Date: October 23, 2026
Status: **DRAFT. NOT FROZEN. NOT AUTHORIZED FOR OUTCOME ACCESS.**
Proposed artifact: `openplan.nationwide_model_validation_preregistration.v2`
Predecessor: [frozen v1](NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json)

This draft proposes the next acceptance design. It does not supersede the
blocking v1, create a freeze record, open data, select a candidate, or change
production defaults. No digest accompanies this draft. Bracketed items are
unresolved requirements before a successor can be frozen.

The implementation in
[`model_validation_acceptance.py`](../../workers/aequilibrae_worker/model_validation_acceptance.py)
provides supplied-input gate arithmetic. Its tests use invented observations.
It neither proves the following sources decisive nor establishes independence.
The [implementation record](S3_ACCEPTANCE_EVALUATOR_GROUNDWORK_2026-10-23.md)
describes that boundary and the remaining custody integration.

## Claims and decisions

Evaluate AequilibraE and ActivitySim separately for every cell. A cell identifies
jurisdiction, geographic archetype and use. Facility, volume, mode and time
subgroups remain separate gates within the cell. Both methods share geography,
population, network, scenario, comparison basis, source records and pre-output
matching. Their code, coefficients and settings have separate immutable records.
Never average outputs or treat agreement as evidence of accuracy.

Proposed uses are:

1. **Observed-period screening and corridor prioritization.** Evaluate roadway
   quantities in the stated base year and day/period. This is not evidence for
   a forecast, project effect, benefit-cost estimate or environmental finding.
2. **Statutory regional-plan base-year replication.** Apply the relevant
   jurisdiction's reviewed criteria and component/sensitivity requirements.
   California RTPA criteria below are one adapter, not national defaults or a
   finding about MPO requirements.
3. **Project alternatives and forecasts.** Keep blocked pending separate
   temporal, behavioral, policy-response and transfer validation. A base-year
   fit cannot close this use. Sketch VMT cannot drive a CEQA determination.

A gate returns `pass`, `fail` or `inconclusive`, with its metric, threshold,
comparison operator, coverage and reason. A measured gate failure keeps the
cell failed even if another gate is inconclusive. Every required gate must pass
before the cell can pass. Missing cells, observations, supported uncertainty,
comparison bases or independent samples remain inconclusive. All applicable
cells must pass for each method before the declared nationwide claim can pass.
A national summary is descriptive and cannot override a local result.

## Candidate free public observation sources

The October 23 review reads documentation and catalog pages only. It does not
retrieve count archives, station outcomes, model outputs or survey microdata.
The sources below are candidates, not verified coverage or licenses for an
uninspected package. Use only free, authorized public releases. Record the
actual package's terms and attribution before acquisition. An unavailable free
source leaves a gap; it does not authorize a purchase or paid replacement.

| Candidate | Decisive pathway | Limits and source |
|---|---|---|
| FHWA Traffic Monitoring Analysis System (TMAS) continuous volume and classification releases | Repeated hourly/day records can support same-period station estimates, source QA and station-specific intervals. Nationwide source family for every jurisdiction below. | Catalog availability does not prove a station in every required stratum. Preserve missing days, QA flags, direction and class. [FHWA public catalog](https://www.fhwa.dot.gov/policyinformation/tables/tmasdata/) describes state submissions and reviewed releases. |
| State DOT continuous-counter and direct short-count public programs | Supplement TMAS for missing facilities, periods and geography. Require actual collection dates, factors, equipment/QA records and interval evidence. | State and TMAS observations may have the same underlying lineage. Count them once. [FHWA reporting specification](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/federal-data-reporting.cfm) distinguishes direct and derived methods. |
| FHWA HPMS public roadway sections and metadata | A direct-count record may qualify when underlying observation and factor precision are available. Other records support coverage and corroboration. | A published AADT alone is not decisive. Modeled, growthed or imputed values are not independent truth. [HPMS public access description](https://www.fhwa.dot.gov/Policyinformation/hpms.cfm). |
| Caltrans Traffic Census and authorized public local-agency counts | Additional California route/section, vehicle and peak-period checks; direct evidence only after interval and comparability review. | State-highway coverage does not cover local streets. Preserve back/ahead sections; do not choose the larger value. [Caltrans catalog](https://dot.ca.gov/programs/traffic-operations/census). |
| MnDOT public continuous/hourly/raw count products | Candidate independent northern, seasonal and facility coverage after record-level grading. | Distinguish count-based, modeled and factored types. Do not assume a commercial portal's paid API is required or authorized. [MnDOT data products](https://www.dot.state.mn.us/traffic/data/data-products.html). |

[VERIFY BEFORE FREEZE: freely authorized direct observation packages for local
roads, tribal areas, remote areas, border crossings, islands, seasonal roads,
transit and active modes. The listed catalogs do not close these gaps.]

## Geographic partition design

The sampling unit is an independent geographic/source cluster, not a station.
Construct clusters from geography and source metadata without observed or
modeled values. Connected corridors, duplicated state/federal source lineages,
shared count-factor groups and overlapping measurement sections stay together.
A cluster crossing a state boundary belongs to one partition; it still supports
separate state claims only where each state's evidence exists.

Before assignment, exclude every previously exposed or consumed source lineage
and geographic acceptance block from the new acceptance pool. Preserve the
exclusion ledger. In particular, the seven California development counties
Butte, Madera, Merced, Monterey, Nevada, San Benito and Tulare remain development
history. The 57-station calibration-selection set and the closed mandatory-tour
studies remain consumed. An old year, renamed file or new station identifier
cannot erase shared lineage or prior exposure.

Proposed allocation procedure, applied to every jurisdiction/use/applicable
archetype and facility/time subgroup:

1. Build connected components using metadata-only corridor, section, source
   program, factor-group and geographic adjacency relationships. Keep an
   unassigned buffer between independent components where the network dependence
   audit requires it. [VERIFY: quantitative buffer and dependency rule.]
2. Exclude contaminated components before allocating. Keep exclusion reasons and
   the outcome-access history in a separate immutable manifest.
3. Sort eligible components by a seeded deterministic permutation of stable
   metadata identities. Assign whole components to development, selection and
   acceptance. Never split a component to fill a sample-size target. The seed,
   allocation code and exact component memberships must be fixed before opening.
4. Determine each partition's sample size from a written precision/power analysis
   using development-only variability and source design information. Inflate for
   shared factor groups and correlation. Do not treat station count as independent
   sample size or default to three observations.
5. If the required independent components or precision are unavailable, mark the
   affected cell inconclusive. Do not substitute another state or an aggregate.

The proposed manifests are `D/<jurisdiction>`, `S/<jurisdiction>` and
`A/<jurisdiction>` below. These are reserved manifest identities, **not completed
geographic assignments**. Exact polygons, corridors, station memberships,
source lineage clusters, buffers, sample sizes and contamination checks remain
[VERIFY BEFORE FREEZE]. This draft therefore makes no claim that real independent
partitions have already been established.

| Jurisdiction | Development | Selection | Acceptance |
|---|---|---|---|
| Alabama | D/AL | S/AL | A/AL |
| Alaska | D/AK | S/AK | A/AK |
| Arizona | D/AZ | S/AZ | A/AZ |
| Arkansas | D/AR | S/AR | A/AR |
| California | D/CA | S/CA | A/CA |
| Colorado | D/CO | S/CO | A/CO |
| Connecticut | D/CT | S/CT | A/CT |
| Delaware | D/DE | S/DE | A/DE |
| District of Columbia | D/DC | S/DC | A/DC |
| Florida | D/FL | S/FL | A/FL |
| Georgia | D/GA | S/GA | A/GA |
| Hawaii | D/HI | S/HI | A/HI |
| Idaho | D/ID | S/ID | A/ID |
| Illinois | D/IL | S/IL | A/IL |
| Indiana | D/IN | S/IN | A/IN |
| Iowa | D/IA | S/IA | A/IA |
| Kansas | D/KS | S/KS | A/KS |
| Kentucky | D/KY | S/KY | A/KY |
| Louisiana | D/LA | S/LA | A/LA |
| Maine | D/ME | S/ME | A/ME |
| Maryland | D/MD | S/MD | A/MD |
| Massachusetts | D/MA | S/MA | A/MA |
| Michigan | D/MI | S/MI | A/MI |
| Minnesota | D/MN | S/MN | A/MN |
| Mississippi | D/MS | S/MS | A/MS |
| Missouri | D/MO | S/MO | A/MO |
| Montana | D/MT | S/MT | A/MT |
| Nebraska | D/NE | S/NE | A/NE |
| Nevada | D/NV | S/NV | A/NV |
| New Hampshire | D/NH | S/NH | A/NH |
| New Jersey | D/NJ | S/NJ | A/NJ |
| New Mexico | D/NM | S/NM | A/NM |
| New York | D/NY | S/NY | A/NY |
| North Carolina | D/NC | S/NC | A/NC |
| North Dakota | D/ND | S/ND | A/ND |
| Ohio | D/OH | S/OH | A/OH |
| Oklahoma | D/OK | S/OK | A/OK |
| Oregon | D/OR | S/OR | A/OR |
| Pennsylvania | D/PA | S/PA | A/PA |
| Rhode Island | D/RI | S/RI | A/RI |
| South Carolina | D/SC | S/SC | A/SC |
| South Dakota | D/SD | S/SD | A/SD |
| Tennessee | D/TN | S/TN | A/TN |
| Texas | D/TX | S/TX | A/TX |
| Utah | D/UT | S/UT | A/UT |
| Vermont | D/VT | S/VT | A/VT |
| Virginia | D/VA | S/VA | A/VA |
| Washington | D/WA | S/WA | A/WA |
| West Virginia | D/WV | S/WV | A/WV |
| Wisconsin | D/WI | S/WI | A/WI |
| Wyoming | D/WY | S/WY | A/WY |

Required national archetypes remain major metropolitan, suburban, small urban,
rural, remote, tribal, border, island, mountain and coastal. Each applicable
jurisdiction/archetype/use intersection needs a gate, including intersections
within one place. A tribal authority is not inferred from the enclosing state.
Seasonal/recreational, climate, road class, volume, grade, mode, source method,
network coverage and zone resolution are additional strata. An applicability
review must explain genuine absences, such as a rural DC sampling frame, without
substituting those absences for missing observations in an applicable cell.

California additionally requires separate statewide, metropolitan, suburban,
rural, mountain, coastal, border and tribal evidence. These are required cells,
not alternative ways to satisfy one California total. Its deeper manifest must
identify multiple independent settings within each applicable archetype and
agency context. [VERIFY: untouched California components after contamination
exclusion and precision analysis.]

Territories receive a separate explicit applicability/source matrix. They do
not inherit state thresholds. [DECISION: retain the existing unresolved territory
scope question; do not claim territory completeness from this 51-jurisdiction
roster.]

## Proposed numerical gates and exact source excerpts

Each proposal below is independent of candidate performance. These are necessary
checks for their named uses, not sufficient evidence of scientific validity.
Thresholds are not observation intervals. Quoted source text stays short; source
pages contain the qualifications and original context.

| Use and scope | Proposed check | Primary source and quoted threshold | Review boundary |
|---|---|---|---|
| Observed-period roadway screening, screenline | Maximum absolute raw screenline residual at most 5 percent | [FHWA Travel Model Validation and Reasonableness Checking Manual, 2010, printed p. 9-18](https://rosap.ntl.bts.gov/view/dot/55924/dot_55924_DS1.pdf#page=204): “targets of 5 percent and 10 percent for screenlines and cut-lines, respectively” | FHWA reports Michigan examples. Transferring 5 percent to the nationwide screening use is an OpenPlan proposal requiring review, not a federal standard. |
| Observed-period roadway screening, cutline subgroup | Maximum absolute raw cutline residual at most 10 percent | Same FHWA passage, second threshold in the quoted sentence above | Define cutlines before output access. Retain each failed cutline. The evaluator represents these as named groups at the screenline scale. |
| California RTPA base-year replication, links | At least 75 percent of links within the applicable Caltrans volume-group deviation allowances | [2024 RTP Guidelines for RTPAs, printed p. 44, PDF p. 51](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/regional-and-community-planning/sustainable-transportation-planning-grants/adopted-2024-rtp-guidelines-for-rtpas-2-a11y.pdf#page=51): “At Least 75%” | [VERIFY: authoritative allowance curve/table, volume-bin boundaries and applicability. No replacement flat tolerance is proposed.] |
| Same California use, correlation | Pearson correlation at least 0.88 | Same Caltrans table: “At Least 0.88” | Declare Pearson rather than substituting Spearman. A constant series is inconclusive. Confirm the intended coefficient against the complete guidance before freeze. |
| Same California use, link error | Raw percent RMSE strictly below 40 percent | Same Caltrans table: “Below 40%” | The evaluator uses population RMSE with N in the denominator, divided by mean observed volume. [VERIFY: final accepted formula and weighted sampling design.] |

Caltrans describes its table as recommended criteria and calls for documenting
impediments when criteria are unmet. This draft preserves the negative result;
it does not let such documentation become a passing gate. FHWA also cautions
that meeting an example threshold does not establish validity.

[VERIFY BEFORE FREEZE: primary-evidence thresholds for national link, system,
state and archetype checks; local facility/time non-inferiority; minimum decisive
coverage; reference-candidate improvement where claimed; and excess-error
criteria.] No unsupported threshold is filled from a historical residual or
copied from the old 30 percent diagnostic. A missing threshold blocks its claim.
For project/forecast/environmental uses, [VERIFY: independent temporal evidence,
behavioral elasticities, policy sensitivity and stronger use-specific criteria].
No numerical forecast acceptance rule is proposed without that evidence.

## Observation uncertainty and aggregation

Grade observations and freeze matching without model volumes. Grade A needs
same-basis repeated/continuous evidence, QA and supported station intervals.
Grade B needs direct count dates, known factors, QA and supported factor-group
precision. Grade C is corroboration; Grade D is inconclusive coverage. Retain
unmatched, ambiguous, excluded, unavailable and genuinely absent records with
reasons. Retain matched zero model flows as unloaded failures where evidence is
decisive. Missing flow is not zero.

Freeze year, day, period, direction, lanes, vehicle definition, units and quantity
for every observation/model pair. Synthetic expanded peak-hour output cannot be
relabeled AADT. Freeze source, interval evidence and interval-method identities.
Use repeated-day or publisher-supported factor uncertainty, not a generic band.
[FHWA Traffic Monitoring Guide, 2022, methodologies](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/traffic-data-methodologies.cfm)
supports source-specific precision analysis; its illustrative precision targets
are not model-acceptance tolerances.

For observed center O, model M and supported bounds [L,U], report M-O, absolute
percentage error, interval width and excess error `max(L-M, M-U, 0)`. Zero excess
means indistinguishable at that precision. It does not award accuracy.

Freeze group members and positive weights for link, screenline, system, state
and archetype comparisons. A VMT weight requires source-supported segment length
and a stated length unit. A sum of station counts is not automatically system
VMT. The current evaluator computes weighted interval envelopes. These do not
assume independent errors and are not joint 95 percent confidence intervals.
Raw-error gates remain necessary at every scale. [VERIFY: joint uncertainty,
correlated-factor sensitivity and any confidence-based decision procedure before
scientific use.] Raw and excess metrics remain visible together.

## Freeze and one-opening requirements

A successor freeze requires all placeholders above to be resolved and reviewed.
Freeze the candidate code closure, both engine/parameter/settings identities,
shared inputs, source packages, grades, interval method/evidence, match audit,
complete observation manifest, all partitions, contamination exclusions, every
gate and exact comparison operators. Archive the source excerpts and applicability
findings. Record an independently retained freeze identity and digest **then**.
Do not compute one for this draft.

Bind a trusted pre-opening custody snapshot to that exact freeze. The
[sealed execution protocol](SEALED_STUDY_EXECUTION_PROTOCOL.md) must durably
consume the opening before loading outcomes. The evaluator's pre-opening
snapshot does not undo that receipt. No replay, interrupted reopening, fresh
filename or changed caller-supplied status restores independence. An interrupted
opening stays consumed and inconclusive under the sealed runner's recovery rule.

The software test suite must never exercise that boundary with real holdouts.
Only synthetic copies may be mutated or refrozen for software testing. Actual
new data acquisition, freeze approval and outcome access require a later scoped
study instruction. This document authorizes none of them.
