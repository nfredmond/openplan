# TBI 2019 integration readiness

October 23, 2026. **Not ready for the frozen opening.** The integration combines
#379 and #382 and preserves their frozen records. It prepares public inputs
without requesting or reading TBI outcome fields. Missing travel conditions and
survey/model mapping still prevent scientific admission, even if a modeled-only
preparation run completes.

The [decision addendum](INTEGRATION_PREREGISTRATION_ADDENDUM.md) records the
lead's four decisions before outcome access. The [source record](INTEGRATION_SOURCES.md)
contains fare quotations, effective dates, source links and coverage limits.
The [verification record](INTEGRATION_VERIFICATION.md) separates synthetic,
source and native evidence.

## Input inventory

| Required input | Status and retained boundary |
|---|---|
| Seven-county zone system | Present. 704 ordered TIGER2019 Census tracts, original Census internal points and 2019 place polygons. The order remains unchanged. |
| Survey-period population profile | Present. ACS 2015–2019 summary and PUMS products, 2010 PUMAs, 2019-dollar incomes. Public bulk files replace credential-requiring API transport. |
| Population controls and microdata | Present. Published totals are 3,065,147 people and 1,187,423 households. Four tracts have unavailable median household income; those raw cells remain `.`. Every selected tract and all 32 selected PUMAs, including three Wisconsin PUMAs. 83,700 household and 181,876 person source records precede seed eligibility. |
| Full realized population and fit diagnostics | [PENDING native synthesis and retained-package completion.] |
| Highway network | Present. October 8, 2019 OSM database snapshot through the existing AequilibraE path. 231,080 pre-centroid nodes, 311,276 links, 704 internal zones and eight external gateways. No demand assignment. |
| Highway skims | Present. Travel time and distance, all 494,912 off-diagonal internal pairs reachable, no missing graph centroids. CPython 3.11.15, AequilibraE 1.6.2, NumPy 2.0.2. |
| Observed period road conditions | Unavailable. The inherited adapter repeats free-flow road impedance across periods. OSM snapshot age does not establish measured congestion or road-opening truth. |
| Independent walk/bicycle networks | Unavailable. Inherited nonmotorized distance derives from the auto network; transit walk access uses centroid distance without pedestrian barriers. |
| Transit schedules | Present for the retained Metro Transit feed, October 8 service: 8,782 active trips, five configured departures. This is one departure per period, not a period average. |
| Transit fares | Partially present. Published 2017 rates remain documented for 2019. Explicit single-boarding pricing covers 79 named express routes and three tram routes. 106 route fares, transfers, concessions, Northstar products and cost-base-year alignment remain unsupported. Unknown fares remain NaN with mode-choice usability false. |
| MVTA | Unavailable. No freely retrievable 2019 feed acquired in the bounded search. Member-city overlap masks 66 tracts as transit endpoints. This does not establish complete MVTA-dependent trip exclusion. |
| Drive-to-transit | Unavailable, explicitly excluded. Published 2019 inventory retained, but no verified entrance-to-road-node-to-stop crosswalk. Zero supplied connectors. |
| Employment | Present. LODES7 2019 WAC, 18,378 selected blocks and 1,813,674 jobs across all 704 tracts. Existing MTC sector pooling remains disclosed. |
| School destinations | Qualified proxy. ACS enrollment by residence, not observed school capacities or school attendance locations. |
| Parking, tolls, terrain and developed acreage | Unavailable or unassessed as historical inputs. Existing zero parking/toll fields, flat terrain and gross-acreage allocation remain adapter approximations, not measured zero conditions. |
| Coefficients | Present and unchanged. Current tour coefficients `42a98dc65adb64a61de88d92e6fd9939a9a32900140a9fa8c5e3eacedb4a84b2`; SEMCOG candidate `537e54811e4b6ca9fec0662085777e9679a634bd312bb7c64df6e58ff60c7490`, 27 frozen substitutions. Both use the existing accepted auto-ownership component. |
| Complete executable archive | [PENDING bundle completion and final archive custody.] |

## Exclusions available without outcome fields

The original household split remains 7,516 total, 6,019 development and 1,497
held out. Development metadata retains 5,041 seven-county households and excludes
978 outside the study region. Missing county: zero. The original assignment
hash remains `d00206802218a92d31dceea4c108c74cab540dadd8c90d9d1f21e8b11b99c392`.

| Reason | Count and denominator |
|---|---|
| Development household outside the frozen region | 978 of 6,019 development households. |
| Missing development home county | 0 of 6,019 development households. |
| MVTA member-city overlap | 66 of 704 zones; 638 remain outside this mask. The mask retains all original zone IDs and makes affected transit endpoint values unavailable. |
| No centroid walk access to supplied service after the mask | 245 of 704 zones, including the 66 MVTA-mask zones and 179 other zones; 459 have walk access. This is not a household exclusion count. |
| Missing route-fare classification | 106 of 188 feed routes. Routes and origin-destination pairs are different denominators. |
| AM generic transit path with unknown fare | 128,881 of 129,728 reachable directed pairs. These are path records, not trips, people or choices. |
| Drive-transit alternatives | All unavailable; zero supplied connectors. No observed trip count is inferred. |
| MVTA-dependent, drive-access, mixed-mode and other survey-trip/tour exclusions | Unavailable without prohibited outcome fields. They are not reported as zero. |

## Modeled-only run health

[PENDING current-coefficient and SEMCOG-arm execution records. No tour counts or
mode shares are asserted before those records exist. No comparison between
arms, against AequilibraE outputs or against TBI observations is authorized.]

## Exact remaining steps before a lead-owned opening

1. Complete the population, package and both modeled-only runs, retaining every
   failure and exact archive, implementation, configuration and output hashes.
   Grade population fit and every inherited input approximation independently
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
