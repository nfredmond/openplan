# Public observed travel choices: PSRC, Metropolitan Council, CMAP, Oregon

**Source-check appendix.** The [combined assessment](../PUBLIC_OBSERVED_TRAVEL_CHOICE_SOURCES_2026-10-23.md) governs the final recommendation and study boundary. This note retains the independent source check and its receipts. References to writing only this note describe the checker session; the combined task also creates the assessment and draft PR.

Research date and access date: **2026-10-23**. Primary official sources only. Research supports development source selection, not scientific validation or a legal opinion. `[VERIFY]` identifies a fact, inference, or prerequisite this review does not establish.

## Recommendation

**Use Metropolitan Council Travel Behavior Inventory (TBI) 2019 as the first development-only candidate.** Its official dataset metadata expressly declares public-domain status. The current public service contains person-level linked trips with origin and destination Census block groups and TAZs, departure/arrival times, reported-mode classifications, and weights. Small server-side aggregate requests confirm populated geography and identify **124,865 linked-trip records** with both TAZ IDs greater than zero, a non-null departure time, a non-null mode, and positive linked-trip weight. No individual survey records were retrieved for that screen. The 2023 wave offers a separate, more recent candidate with **36,954** records meeting the same preliminary screen. These counts are not admitted estimation samples. See TBI sources and receipts below.

PSRC is a useful second candidate for tract-level development. Its current public trip service exposes tract endpoints and time of day, but its item metadata does not supply an affirmative reuse license. CMAP expressly permits reuse with attribution; its official 2019 analysis code documents tract-centroid location masking, usable trip timing, and a historical weight correction. Its newer 2024–2025 release needs a separate public-schema inspection. Oregon OHAS has valuable observed diaries, but this review does **not** establish an authorized, currently downloadable public microdata release with the needed endpoint geography.

A linked trip is not a tour. None of the inspected public releases establishes a ready-made ActivitySim tour mode choice estimation table. Deriving home-return tours, identifying main destinations and modes, and preserving trip chains remain `[VERIFY]`. The surveys observe chosen behavior. They do not themselves establish travel times, costs, or availability for every unchosen alternative. Matching network/GTFS vintages, zone definitions, and alternative-specific skims remain `[VERIFY]` for every source. Development use cannot establish independent geographic or nationwide accuracy.

## Comparison

| Source | Public geography actually established | Time and choice | Access and reuse | Development disposition |
|---|---|---|---|---|
| Metropolitan Council TBI 2019/2021/2023 | Public linked-trip schemas contain 2010/2020 Census block-group IDs, tract IDs, and TAZ IDs for both endpoints. Populated TAZ/block-group fields confirmed by aggregates. No point coordinates in inspected 2023 trip/linked-trip/location schemas. | Reported-mode fields, linked trips, departure/arrival times, weights. | Anonymous official REST services and FGDB links. Dataset metadata expressly declares public domain. | First choice, particularly larger pre-pandemic 2019 wave. |
| PSRC 2017/2019/2021/2023/2025 combined public release | Both endpoints at 2010 and 2020 Census tract resolution. No endpoint block group, TAZ, latitude, or longitude in inspected public trip schema. | Person trips; precise time components; detailed and grouped modes; trip weights. | Anonymous public service and portal downloads. Item `licenseInfo` is null. Public availability does not establish an open reuse grant. | Tract-level backup; resolve reuse terms before redistribution. |
| CMAP My Daily Travel 2018–2019 | Agency analysis source documents public location coordinates typically replaced by tract centroids, with state/county/tract FIPS. Not true observed point coordinates. | Person/place diary sequence; chosen trip mode; arrival/departure times; person/household weights. | Anonymous public archive; catalog explicitly permits use with attribution. | Promising tract-level backup, subject to current weight/version reconciliation. |
| CMAP My Daily Travel 2024–2025 Phase 1 | `[VERIFY]` public data schema not reached within small-metadata-only boundary. Weighting-zone shapefile is not evidence of public trip-end geography. | Release README establishes detailed travel inventories and weighted/expanded data. Exact public fields `[VERIFY]`. | Same public archive and catalog reuse terms. | Do not assume 2019 masking or field names carry forward. |
| Oregon OHAS 2009–2011; newer OTS 2023–2024 | `[VERIFY]` no current public row-level OD geography established. Survey-collected addresses/GPS do not establish public coordinates. | Historical observed 24-hour weekday diaries; newer OTS includes app reporting. Public fields/weights `[VERIFY]`. | Reports and study descriptions public; public microdata authorization, license, fee, and agreement requirements `[VERIFY]`. | Do not admit for this no-agreement development lane yet. |

## 1. PSRC regional household travel surveys

Accessed **2026-10-23**.

Official entry points:

- [PSRC household travel survey program](https://www.psrc.org/our-work/household-travel-survey-program).
- [Official household travel survey portal](https://household-travel-survey-psregcncl.hub.arcgis.com/).
- [Current public Trips item](https://www.arcgis.com/home/item.html?id=7e24938cbfd84d1e8c94ae3e9a40f02e).
- [Trips item metadata](https://www.arcgis.com/sharing/rest/content/items/7e24938cbfd84d1e8c94ae3e9a40f02e?f=pjson).
- [Public Trips schema](https://services6.arcgis.com/GWxg6t7KXELn1thE/arcgis/rest/services/Household_Travel_Survey_Trips/FeatureServer/0?f=pjson).
- [2023 XLSX codebook](https://www.psrc.org/sites/default/files/2024-12/PSRC-HTS-Codebook-2023-v2.xlsx), [2023 final report](https://www.psrc.org/sites/default/files/2024-05/2023-Puget-Sound-Regional-Travel-Study-Final-Report.pdf), and [2025 data user's guide](https://www.psrc.org/depts/data/website_data/hts/index.html).

**Access and terms.** Follow the agency program link to the portal, select Trips and the related household/person/day tables, and inspect/export the public service. The metadata and schema requests succeeded anonymously, without payment, an account, or agreement acceptance. Bulk export was not attempted. The ArcGIS item page states: “No special restrictions or limitations on using the item's content have been provided.” Its underlying `licenseInfo` is null. This is absence of item restrictions, not an affirmative open license. Permission for redistribution and derivative public releases is `[VERIFY]`. No restricted coordinates or access agreement were sought.

**Public geography.** The current public schema contains `origin_tract_2010`, `origin_tract_2020`, `dest_tract_2010`, and `dest_tract_2020`, plus county, jurisdiction, growth-center geography and destination ZIP. It does not contain trip-end latitude/longitude, block-group IDs, or TAZ IDs. The separate 2023 codebook lists `origin_lat`, `origin_lng`, `dest_lat`, and `dest_lng`; that is documentation of a richer survey structure, not proof those fields are released publicly. Likewise, the 2025 guide's home block-group examples do not establish public trip-end block groups. A tract-centroid skim would be an analyst approximation, with within-tract transit/walk access unresolved `[VERIFY]`.

**Years and sample.** The current Trips item identifies version 2026.1 and survey years 2017, 2019, 2021, 2023, and 2025. Anonymous grouped count requests against the public Household, Person, and Trip services returned the following release record counts:

| Survey year | Household rows | Person rows | Person-trip rows |
|---|---:|---:|---:|
| 2017 | 3,275 | 6,229 | 51,661 |
| 2019 | 3,044 | 5,711 | 72,855 |
| 2021 | 1,929 | 4,149 | 10,013 |
| 2023 | 3,870 | 7,532 | 55,744 |
| 2025 | 2,772 | 5,558 | 38,980 |

These are public table rows, not a claim that every row has a complete, positive-weight diary. The 2023 final report's Table 10, printed page 33, separately reports **3,650 completed households**. The difference from 3,870 released household rows needs reconciliation `[VERIFY]`; do not silently equate the two denominators. The 2025 guide reports 2,772 households, 5,558 persons, 10,868 person-days, and 38,980 trips, with travel from March 4 through June 8, 2025. The program page also links 2014 and 2015 releases; their public schemas, sample counts and reuse terms were not assessed `[VERIFY]`.

**Unit, choice, timing, weights.** The guide identifies the trip table as person trips. Public fields include household/person/day/trip identifiers, origin and destination purposes, `mode_1` through `mode_4`, `mode_class`, `mode_class_5`, access/egress modes, departure/arrival timestamps and hour/minute/second components, and `trip_weight`. The 2023 codebook's broad mode grouping covers motor vehicle, transit, walking, cycling, and residual modes. Fine distinctions required for ActivitySim, including occupancy and transit access mode, need explicit version-specific mapping `[VERIFY]`. The guide describes household, person, day and trip weights and weekday-oriented inference. A supplied tour table was not established. Reconstruct tours and audit incomplete chains before using tour mode choice `[VERIFY]`.

Count-source endpoints, accessed 2026-10-23:

- `https://services6.arcgis.com/GWxg6t7KXELn1thE/arcgis/rest/services/Household_Travel_Survey_Households/FeatureServer/0/query`
- `https://services6.arcgis.com/GWxg6t7KXELn1thE/arcgis/rest/services/Household_Travel_Survey_Persons/FeatureServer/0/query`
- `https://services6.arcgis.com/GWxg6t7KXELn1thE/arcgis/rest/services/Household_Travel_Survey_Trips/FeatureServer/0/query`

Each used `f=json`, `where=1=1`, `groupByFieldsForStatistics=survey_year`, `returnGeometry=false`, and `outStatistics=[{"statisticType":"count","onStatisticField":"OBJECTID","outStatisticFieldName":"n_records"}]`.

## 2. Metropolitan Council Travel Behavior Inventory

Accessed **2026-10-23**.

Official entry points and documentation:

- [Agency data and research results](https://metrocouncil.org/Transportation/Performance/Travel-Behavior-Inventory/Data.aspx), which directs users to Minnesota Geospatial Commons.
- [2019 official catalog metadata](https://www.arcgis.com/sharing/rest/content/items/15cdcdd4d7684ac0a091cd4ca65fe838?f=pjson), [2021 official catalog metadata](https://www.arcgis.com/sharing/rest/content/items/574f06a992d44dbb9decb4f0bcf594e5?f=pjson), [2023 official catalog metadata](https://www.arcgis.com/sharing/rest/content/items/6ec41bb88359493c9439232e99e74f29?f=pjson).
- [2023 FGDC metadata XML](https://www.arcgis.com/sharing/rest/content/items/6ec41bb88359493c9439232e99e74f29/info/metadata/metadata.xml).
- [Official 2018–2024 synthesis report](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/index.html), [data preparation](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/05_dataset_preparation/ch_5_dataset_preparation.html), [weighting](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/06_expansion_and_weighting/ch_6_expansion_and_weighting.html), [data user's guide](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/appendices/data_users_guide_R.html), and [combined XLSX codebook](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/appendices/combined_codebook.xlsx).

**Access and reuse.** The catalog states: “None. This dataset is public domain under the Minnesota Government Data Practices Act (Minnesota Statutes Chapter 13).” This is an affirmative agency reuse statement, stronger than a public download button. The metadata recommends retaining its disclaimer and metadata when passing data to others and disclaims accuracy/currentness warranties. Anonymous metadata and aggregate REST requests succeeded without a login, charge, or agreement. The catalog recommends the feature service and also supplies the following FGDB ZIP URLs; none was downloaded:

- `https://gisdata.metc.state.mn.us/gisdata/Society/tbi_home_interview2019.zip`
- `https://gisdata.metc.state.mn.us/gisdata/Society/tbi_home_interview2021.zip`
- `https://gisdata.metc.state.mn.us/gisdata/Society/tbi_home_interview2023.zip`

Old `gisdata.mn.gov` links redirect to the modern Commons. Use current catalog item identifiers rather than assuming the old CKAN API remains available.

**Public geography.** Current public services are `https://arcgis.metc.state.mn.us/data1/rest/services/society/TBI_2019/FeatureServer`, `.../TBI_2021/FeatureServer`, and `.../TBI_2023/FeatureServer`. All three have linked trips at table **2**, trips at **5**, household at **1**, and person at **4**. The inspected linked-trip schemas expose:

- `trip_o_cbg_2010`, `trip_o_cbg_2020`, `trip_o_taz`, `trip_o_tract`.
- Corresponding destination fields `trip_d_cbg_2010`, `trip_d_cbg_2020`, `trip_d_taz`, `trip_d_tract`.

The 2023 public metadata-variable table **9** explicitly defines these as trip-origin/destination block groups, TAZs, and tracts. The 2023 Locations table **3** contains identifiers, collection time and Census tract ID, without x/y or latitude/longitude. Do not call it a public GPS trace. The FGDC metadata references the official **3,030-zone TAZ system**. Exact zone-boundary release, field crosswalk, and skim matrix ID compatibility are `[VERIFY]`; a TAZ label alone does not prove a compatible matrix. No public point coordinates were established.

**Years and sample.** Synthesis executive-summary Table 1 gives the following unweighted counts:

| Wave | Travel dates | Households | Persons | Person-days | Unlinked trips |
|---|---|---:|---:|---:|---:|
| 2019 | 2018-10-05 to 2019-09-29 | 7,516 | 15,434 | 79,556 | 335,284 |
| 2021 | 2021-06-22 to 2022-02-05 | 7,907 | 15,031 | 49,567 | 180,242 |
| 2023 | 2023-01-12 to 2024-01-16 | 3,749 | 7,280 | 28,838 | 108,413 |

**Preserve discrepancies.** The current 2021 catalog item instead says 3,749 households and 7,907 people. This conflicts with the synthesis and needs publisher reconciliation `[VERIFY]`. The synthesis user guide also displays a person-table count of 38,693, while executive-summary Table 1 totals 37,745 persons. Treat both as source claims with different or unresolved denominators `[VERIFY]`. The three public linked-trip services returned 329,022, 176,093 and 104,611 records, respectively. These are linked-trip release counts, not the report's unlinked-trip counts or positive-weight sample counts.

**Unit, modes, and timing.** Public schema fields include `mode_1` through `mode_4`, `mode_type`, `mode_type_detailed`, `mode_type_broad`, departure/arrival dates, times and time components, household/person/day/trip identifiers, and linked-trip weights. The codebook documents Central time. Its mode classes distinguish rail, school and public buses, other buses, intercity travel, ride hail, hired/household/other vehicles, micromobility, walking, and residual choices. Detailed values distinguish local/express/BRT service and bicycle variants. The hosted schema types `mode_type` as a **string**, whereas the downloadable combined codebook documents numeric categorical codes. Verify the hosted value labels before constructing an integer mapping `[VERIFY]`.

Use reported/cleaned choice fields, not `mode_type_predicted` or prediction-probability fields, as observed choices. Data preparation describes derivation of some children's records and transit access legs and provides a `trace_quality_flag` for suspect iOS trace data. Thus a delivered record is not automatically an unmodified respondent-reported trip. Preserve derivation, quality, and proxy-reporting distinctions. Linked trips connect trip segments; tours still require separate construction `[VERIFY]`.

**Weights.** Documentation describes household, person, day, and trip weights, with the lowest appropriate hierarchy level used for joined summaries. The public linked table has `linked_trip_weight`. Earlier waves were reweighted with the 2023 wave. The weighting chapter says the 2024 procedure includes a transit-boardings target, so weighted transit shares are not independent validation of those boarding totals. Follow current weights, completion filters and trace-quality guidance. Exact correspondence between all released weights and the latest reweighting memo remains `[VERIFY]`.

**Small public aggregate evidence.** Counts of non-null fields in 2023 linked trips were 102,743 origin block groups, 102,670 destination block groups, 98,726 origin TAZs, 98,601 destination TAZs, and 104,532 departure times, out of 104,611 records. Non-null counts alone do not establish valid codes. A stricter preliminary screen returned 36,954 records in 2023 and 124,865 in 2019. It requires `trip_o_taz > 0 AND trip_d_taz > 0 AND depart_time IS NOT NULL AND linked_trip_weight > 0 AND mode_type IS NOT NULL`. This does not validate mode labels, complete chains, exact timestamps, network access, occupancy, or the joint completeness of every covariate.

Reproduce the strict count with `GET https://arcgis.metc.state.mn.us/data1/rest/services/society/TBI_2019/FeatureServer/2/query` or the corresponding 2023 URL, with `f=json`, `returnCountOnly=true`, and the preceding SQL `where`. An initial exploratory query incorrectly compared the string mode field numerically and returned HTTP-service error 400, `Query with count request failed.` Correcting the predicate produced the reported counts. No failed request is counted as successful evidence.

## 3. CMAP My Daily Travel

Accessed **2026-10-23**.

Official sources:

- [CMAP household travel survey program](https://cmap.illinois.gov/data/transportation/travel-survey/).
- [Current Travel Survey Data Collection catalog](https://datahub.cmap.illinois.gov/documents/2e0719dce2c34eeea81039eca35def80/about) and [item metadata](https://www.arcgis.com/sharing/rest/content/items/2e0719dce2c34eeea81039eca35def80?f=pjson).
- [Public survey archive](https://stargishub01.blob.core.windows.net/cmap-arcgis-hub01-blob/Open_Data/TravelSurveys_PublicData_CMAP.zip).
- Agency [analysis repository](https://github.com/CMAP-REPOS/mydailytravel), [data preparation source](https://raw.githubusercontent.com/CMAP-REPOS/mydailytravel/main/R/data_cleaning.R), and [mode recoding source](https://raw.githubusercontent.com/CMAP-REPOS/mydailytravel/main/R/recoding.R).

**Access and reuse.** The catalog's complete short terms are: “Not restricted. Users are expected to cite the Chicago Metropolitan Agency for Planning (CMAP) as the source of these data.” The archive responds anonymously without a login, fee, or agreement. Its server reports **111,717,301 bytes**. Do not download it merely to discover metadata. Explicit byte-range requests allowed inspection of ZIP directories and two small README PDFs in memory. The full archive and survey data ZIPs were not saved. The analysis repository's GPL applies to its code; the catalog's separate statement governs the data. Do not substitute a software license for the dataset's terms.

**2018–2019 public structure.** Agency code reads `place.csv`, `person.csv`, `household.csv`, and a location table. It identifies `sampno`, `perno`, `locno`, `placeno`, `placeGroup`, chosen `mode`, trip purpose, travel time and distance. The location fields contain state/county/tract FIPS and coordinates described by the agency as typically anonymized to tract centroids. This supports **tract-scale OD development**, not true observed point routing. Finer public TAZ/block-group endpoints were not established `[VERIFY]`. The precise current archive schema still needs confirmation `[VERIFY]` because the 2019 nested archive is itself compressed and was not fetched wholesale.

`arrtime` is arrival at the current place. `deptime` is departure from that place for the **next** trip. Reconstruct each trip's origin and departure from the preceding place, following the agency's sequence and `placeGroup` logic. Treating same-row arrival and departure as a trip's start/end would be wrong. `placeGroup` merges continuous trips split among records; it is not a home-based tour ID. Tour construction remains `[VERIFY]`.

The agency mode mapping distinguishes walking, owned/shared bicycles, motorcycle, auto driver/passenger, carpool, school bus, rail/bus transit, paratransit, shuttles, taxi/hired cars, ride hail including shared rides, air travel, residual modes and missing codes. `wmode` and `smode` describe usual work/school behavior and must not replace the diary's chosen trip mode. The agency README says 2019 travel reporting covers household members age five and older. Its 2020 committee minutes describe more than 12,000 households; the exact completion count for the current release is `[VERIFY]`. The agency program identifies the release as 2019; the archive names it 2018–2019.

**Weights and custody issue.** Agency analysis code uses person `wtperfin` and household `wthhfin`, and explicitly replaces earlier posted person weights with a supplemental final-weight file. It also warns that the then-posted weights were inaccurate. This is a historical code warning, not proof the 2026 archive remains wrong. Reconcile the current archive against the correction before estimation `[VERIFY]`. Do not assume the analysis repository's exclusion rules are a preregistered acceptance design.

**2024–2025 Phase 1.** The agency program and inspected release README identify main collection from September 2024 through June 2025. The README reports **3,522 completed households including three pilot tests**, detailed household-member travel inventories, and weights/expansion for the study area. It says future phases will be combined and reweighted. The archive contains `MyDailyTravel_2024_2025Phase1.zip`, with `Documents.zip`, `MyDailyTravelData.zip`, and `_readme_MyDailyTravel_2024_2025Phase1.pdf`. The README says a dataset guide and codebook are inside the data ZIP, along with a weighting-zone shapefile. Because these nested ZIP members require approximately 18.3 MB of compressed data or 21.5 MB of documents, neither was fetched. Exact public endpoint geography, mode fields, time resolution/time zone, weight names, person/trip counts and tour products are `[VERIFY]` for this wave. The older survey's resolution must not be carried forward by assumption.

Additional official source for historical sample description, accessed 2026-10-23: [CMAP Environment and Natural Resources Committee minutes, September 3, 2020](https://cmap.illinois.gov/wp-content/uploads/2020-11-05-ENR-3.0-Minutes-2020-09-03.pdf), agenda item 5.

## 4. Oregon OHAS and the newer Oregon Travel Study

Accessed **2026-10-23**.

Official sources:

- [ODOT technical tools](https://www.oregon.gov/odot/Planning/Pages/Technical-Tools.aspx), which links [Personal Travel in Oregon, August 2019](https://www.oregon.gov/ODOT/Planning/Documents/OHAS-Daily-Travel-In-Oregon-Report.pdf).
- [OMSC travel survey subcommittee](https://www.oregonmodels.org/travel-survey), its [Oregon Travel Study page](https://www.oregonmodels.org/oregon-travel-study), and [project privacy policy](https://www.oregonmodels.org/copy-of-oregon-travel-study-faq-s).
- [Portland State University research archive, Wider Dissemination of Household Travel Survey Data Using Geographical Perturbation Methods](https://pdxscholar.library.pdx.edu/cengin_fac/143/), a first-party project report description, not a current microdata download.

**OHAS years and sample.** ODOT's 2019 report, Introduction page 1, describes the **2009–2011** study and **17,941 Oregon households**, with all household members recording a designated 24-hour weekday when school is in session. Its Portland-region Oregon subtotal is 4,516 households. Do not replace this denominator with Portland/Vancouver or other combined study counts. The report defines both trips and home-return tours, summarizes chosen modes and time of day, and describes Census-based statistical weighting. This establishes the historical observed survey and reported analyses. It does not establish a public row-level trip or tour table, exact weight names, or a downloadable codebook `[VERIFY]`.

**Public geography and permission.** The official ODOT tools page provides the report but no row-level download or license in the inspected content. PSU's historical project description discusses protected participant locations and developing geographic masking to support wider dissemination. Its proposal to release masked data is not evidence of a completed, currently accessible public release. Public OD resolution, availability of coordinates/tracts/block groups/TAZs, masking distances and method, price, no-agreement eligibility, and derivative redistribution rights all remain `[VERIFY]`. This review found no qualifying public microdata endpoint. It does not establish that every OHAS version is restricted or unavailable.

**Newer OTS is a separate wave.** The OMSC page describes an April 2023 pilot and main survey from September 2023 through June 2024, with approximately **21,000 households**. It identifies app, web and telephone participation. Its page still anticipates a late-2025 summary report, so that page's delivery timetable is stale. Current microdata release status remains `[VERIFY]`; the date has passed, but that does not prove publication.

The OTS privacy policy states: “We will not disclose or share personal information we collect from you”. It then describes exceptions and authorized sharing with named study partners. This is a participant privacy commitment, **not** a public reuse license. Precise trip locations collected by RSG do not establish precise public trip locations. No partner access, restricted data, user agreement, request submission, or contact with agency staff occurred. The next authorized research step would be locating a public release/codebook and publisher reuse statement. An agreement-dependent route is outside this task.

## Metadata and retrieval receipts

All dates below are **2026-10-23**. Bytes and SHA-256 describe the exact response/file body inspected, not a claim that it remains immutable. Metadata and PDF bytes were inspected in memory. Only this Markdown note is written to disk. No models, tests, builds, hosted OpenPlan systems, secrets, branch changes, or PR operations were used. No further agents were delegated.

### Decisive schema and codebook files

| Metadata URL | Bytes | SHA-256 |
|---|---:|---|
| https://www.arcgis.com/sharing/rest/content/items/7e24938cbfd84d1e8c94ae3e9a40f02e?f=pjson | 1,745 | `a89bf441d1ecc8ed7da2ec3f61b183856107b94ab07f99639516f7768983f9a6` |
| https://services6.arcgis.com/GWxg6t7KXELn1thE/arcgis/rest/services/Household_Travel_Survey_Trips/FeatureServer/0?f=pjson | 33,715 | `dca0350e65502efff6677967877d217bb2bb2d7254c6b984ede34d8e87a0b0c4` |
| https://www.psrc.org/sites/default/files/2024-12/PSRC-HTS-Codebook-2023-v2.xlsx | 105,903 | `9aa17e3d1aefaa3903d55dfb3cdda7585d7d7e01b2135a57cdf4ec47032bcb40` |
| https://www.arcgis.com/sharing/rest/content/items/15cdcdd4d7684ac0a091cd4ca65fe838?f=pjson | 4,375 | `a1f558c22f17d8519981d2b7241abebe3ce94675e704b312bbba8327c54fe4c2` |
| https://www.arcgis.com/sharing/rest/content/items/574f06a992d44dbb9decb4f0bcf594e5?f=pjson | 4,374 | `43e915a254ac57b8b3545eb74054fe710a3edd4b5a50a8b0e44c8daa1ff088e8` |
| https://www.arcgis.com/sharing/rest/content/items/6ec41bb88359493c9439232e99e74f29?f=pjson | 4,369 | `b9bbd436b10dbd44ad4f6669f00ccb90c3785bd494e09bfece045dce94e7dc1c` |
| https://www.arcgis.com/sharing/rest/content/items/6ec41bb88359493c9439232e99e74f29/info/metadata/metadata.xml | 297,574 | `0967d9312a530761f41a79946af963099731d91fc4bdbfc3d49cc6577d0df877` |
| https://arcgis.metc.state.mn.us/data1/rest/services/society/TBI_2019/FeatureServer/2?f=pjson | 35,237 | `3d2486b06e0d9005d78696d8c74df33c5e4142d5819140466810d06c64c012a2` |
| https://arcgis.metc.state.mn.us/data1/rest/services/society/TBI_2021/FeatureServer/2?f=pjson | 35,168 | `87a9cdd1b7cd51d2f68608c1e18307fe59be4f41b0548ea8fbc57ac34e07658e` |
| https://arcgis.metc.state.mn.us/data1/rest/services/society/TBI_2023/FeatureServer/2?f=pjson | 35,093 | `d8de7b9ad96b5a9d4e3eb07a4cf842792fe556764224fcfe6ace37172cb07545` |
| https://arcgis.metc.state.mn.us/data1/rest/services/society/TBI_2023/FeatureServer/5?f=pjson | 45,658 | `c9f85c7a28a9b51283686e3dfac1b8d4dc970d6c3b8e213f0e7892076036ce23` |
| https://arcgis.metc.state.mn.us/data1/rest/services/society/TBI_2023/FeatureServer/3?f=pjson | 5,407 | `d45029188bdc366788d818ce1038d1baf33bb2569cc413e0fd1c31977373b025` |
| https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/appendices/combined_codebook.xlsx | 702,081 | `62371369fbffd1cace453802888afc1ddb1bf12307ce35898a0117a7ea4ef7f3` |
| https://www.arcgis.com/sharing/rest/content/items/2e0719dce2c34eeea81039eca35def80?f=pjson | 4,262 | `a0ec715e4364c2a6b53ad16d353c120049da225de721348405ab2836ee440acf` |
| https://raw.githubusercontent.com/CMAP-REPOS/mydailytravel/main/R/data_cleaning.R | 41,114 | `eba5dd86e55728a155c5af7ddc87d4dba21fc314ea202504d7b0bcbcfd2b3473` |
| https://raw.githubusercontent.com/CMAP-REPOS/mydailytravel/main/R/recoding.R | 11,251 | `1ac3cbb19db32152d3609c2edf23a2c248cd25d415a5e005ff8de20364ccaca3` |

The public TBI metadata-variable query uses table 9 with `f=json`, `where=variable LIKE 'trip_o_%' OR variable LIKE 'trip_d_%' OR variable LIKE '%weight%' OR variable LIKE '%suspect%' OR variable LIKE '%trace%'`, `outFields=variable,description,logic`, and `returnGeometry=false`. Endpoint: `https://arcgis.metc.state.mn.us/data1/rest/services/society/TBI_2023/FeatureServer/9/query`. Response: **4,583 bytes**, SHA-256 `f2f10bf74e72ab78aa9f4c055b698ab5c642df4f0517df0dbdd82d6e8825f918`.

### Report and guide receipts

| Official document URL | Bytes | SHA-256 |
|---|---:|---|
| https://www.psrc.org/sites/default/files/2024-05/2023-Puget-Sound-Regional-Travel-Study-Final-Report.pdf | 1,661,398 | `ecd37e0180516b202a0e0b5a1ac3d45603758f6734f75cff9865967f5a5d2aa2` |
| https://www.psrc.org/depts/data/website_data/hts/index.html | 27,321,788 | `eae8e3ae108f2608937bca7825fb4919eb1ac6438ae34f2b7dc96e68ef2feda5` |
| https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/index.html | 160,797 | `d3a786f814b08fca4648c780c1627d380849f4b8ab6cfd47b9a8735f2cbfc1c7` |
| https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/appendices/data_users_guide_R.html | 659,914 | `09301b0f55b1f1bafc1c77e4072e130191e07ddf8c11faa8290c2616dd7336b6` |
| https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/05_dataset_preparation/ch_5_dataset_preparation.html | 203,491 | `0dcc363ee7b81bad10475873740a0ce237e042663edc862ea9ec5376e99d632a` |
| https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/06_expansion_and_weighting/ch_6_expansion_and_weighting.html | 48,990 | `15410edc8f7389c23c1d6fffb7c101bdef675eba83a4abe57bfc9c810cf1d3d6` |
| https://www.oregon.gov/ODOT/Planning/Documents/OHAS-Daily-Travel-In-Oregon-Report.pdf | 4,777,832 | `a219ebedc3d09df06d9cee78daa1a906d993b1f37248d7f3fd9442b0129407f5` |
| https://www.oregon.gov/odot/Planning/Pages/Technical-Tools.aspx | 114,148 | `06fb187d28b30bf1dc81572597e369493abdb8ae5baf50b54a3eb6ee9095785e` |
| https://pdxscholar.library.pdx.edu/cengin_fac/143/ | 46,860 | `09342234da503a564e6fad74a109e7def2cffe73c69c8043f637d0c814f076e5` |
| https://www.oregonmodels.org/travel-survey | 537,275 | `52a8c9522ddcf468d518c4d82d3c6baf2c97c7a9529bf1b3ab30efc5e0122a4c` |
| https://www.oregonmodels.org/oregon-travel-study | 543,520 | `82c25a15a911966208c207363f5cff2ddd6a7dd390999cd1f7577e4e41910acb` |
| https://www.oregonmodels.org/copy-of-oregon-travel-study-faq-s | 547,929 | `079c567bd2befec0afe6219f7498a7d8a3f61bdd7061ca111602b4478bd634cd` |

The PSRC 2025 HTML guide unexpectedly weighs 27.3 MB. It was read as documentation, with no separate survey archive retrieved. Large metadata bundles were not pursued further.

### CMAP archive member receipts

Parent URL for both members: `https://stargishub01.blob.core.windows.net/cmap-arcgis-hub01-blob/Open_Data/TravelSurveys_PublicData_CMAP.zip`.

| Member path | Uncompressed bytes inspected | SHA-256 |
|---|---:|---|
| `_readme_travelSurveyData.pdf` | 69,542 | `e3f3d2b78e60936646651384a23786561e209bffe501b45b8ebc63f900551285` |
| `MyDailyTravel_2024_2025Phase1.zip` then `_readme_MyDailyTravel_2024_2025Phase1.pdf` | 39,990 | `34461f42eec897bac318fcaf13fee634d085688b12684ef154bfcced4a8657f3` |

The parent archive's explicit final 65,536-byte range, bytes `111651765-111717300`, has SHA-256 `65d0a4a7bfe08525431fbb5ffefab03560b1400bca03c937083131545e3ac13e`. The Phase 1 nested ZIP is a stored member beginning at parent byte 56,201,559 with length 39,811,788, permitting a second directory lookup and extraction of just its README. The 2018–2019 member is deflated, so this approach does not offer direct random access to its internal codebook. An initial suffix-range request did not complete cleanly and was interrupted; all reported member receipts use successful explicit bounded ranges. No full archive is retained.

### Aggregate response receipts

PSRC requests are specified in section 1. Response receipts: Household **676 bytes**, SHA-256 `1294cb542ad5159fc7ff9adb2de0c1b3fff15dc1fb04ac7dd65c73f042723e0e`; Person **676 bytes**, SHA-256 `ec5d32ddc7c28b4fe022db121e0693cab3294784440487315c7ca33d1621fd42`; Trip **681 bytes**, SHA-256 `2f76bac3a68333f0da79b3face76f06d254226c7f868039f1a9a0e6caed0625d`.

TBI strict count requests are specified in section 2. The 2019 response is **16 bytes**, SHA-256 `73869b6554927c6358f8ba9fd914c43c99b71dcc2862e1820dd984db49e451c8`; the 2023 response is **15 bytes**, SHA-256 `9d9f9c9e3b827b4f945acc2880477e468e88fd1a6c5866b8f065b2d22face9b0`.

Remaining admission work is limited to source/metadata and later authorized data preparation: reconcile release denominators and weights; verify current mode labels and missing codes; bind the TBI 3,030-zone geography; confirm licensing for PSRC; inspect CMAP Phase 1 public schema; and locate an actual Oregon public release. No model fit, coefficient transfer, accuracy claim, or independent holdout decision follows from this research.
