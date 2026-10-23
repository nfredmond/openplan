# Public station metadata does not yet support S2 observation intervals

Date: October 23, 2026. Parent: draft PR [#380](https://github.com/nfredmond/openplan/pull/380),
commit `b4f1e25ee3c642dbbdb2dce3f2c14f644550244c`.
Branch: `work/s1-count-station-evidence`. The draft targets `main` and includes
#380's commits. This note supplements, rather than replaces, the
[uncertainty lane](S1_COUNT_OBSERVATION_UNCERTAINTY_2026-10-23.md).

**Zero of 337 retained observations has an admissible interval after this audit.**
Public metadata establishes 239 state-source station associations and the
all-vehicle definition for 137 California observations. Current CDOT records
identify four continuous and 97 short-duration stations. Their AADT year is
2025; the retained Colorado observations have no year. Matching station IDs or
unchanged traffic totals cannot establish that missing historical year.

The audit reads five development count CSV members and no assignment outputs.
It does not rescore a study, change frozen records, consult held-out or consumed
study partitions, fit scalars, change thresholds, or promote scientific claims.
It preserves all 337 input-only match selections from #380. The 83 other retained
rows remain 44 ambiguous shared-link rows, 22 merged rows, and 17 unmatched rows.

## Access and terms

All access checks below date to October 23, 2026. A public website's general
conditions are distinct from an account application or signed data agreement.
No application, agreement acceptance, payment, or message to an agency occurs.
The [access audit](../../data/modeling/s1-station-evidence-2026-10-23/source-access-audit.json)
retains exact URLs, short quotations, inspected schema inventories, and schema
response hashes. Terms-page quotations come from the indexed publisher pages;
their exact response-byte hashes remain unavailable. A supplemental direct
request for the Caltrans terms page returned HTTP 403. That request did not
prevent the public data downloads.

| Source and exact entry point | Quoted terms or access statement | Access steps and limits |
|---|---|---|
| [Caltrans Traffic Census](https://dot.ca.gov/programs/traffic-operations/census), [2023 AADT workbook](https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/census/2023/2023-traffic-volumes-ca-a11y.xlsx), [GIS layer](https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0) | “In general, information presented on this website, unless otherwise indicated, is considered in the public domain.” [Conditions](https://dot.ca.gov/conditions-of-use) | Select a year and download its workbook; query the GIS layer by county code. Anonymous GET succeeds. No registration or separate agreement appears. Preserve Caltrans attribution and the stated accuracy limitations. |
| [Caltrans PeMS](https://pems.dot.ca.gov/), [application and terms](https://pems.dot.ca.gov/?dnode=apply) | “Registration is free and takes only a few minutes.” [Caltrans source page](https://dot.ca.gov/programs/traffic-operations/mpr/pems-source). The application says, “Before your account is finalized, please read and agree to the following terms of use for PeMS.” | Nathaniel must decide whether to apply and accept the terms. The application requests name, email, institution, and reason for use. Approval normally takes one to two business days. This task reads public documentation only and downloads no account-gated data. |
| [CDOT OTIS Traffic Data Explorer](https://dtdapps.codot.gov/otis/trafficdata), [public AADT layer](https://dtdapps.codot.gov/server/rest/services/Webapps/open_data_sde/FeatureServer/13) | “Traffic count data is provided as a public service.” [CDOT disclaimer](https://www.codot.gov/topcontent/cora/faq) | Search county or station, select station, then inspect daily/monthly/annual data or export. The underlying station, date-list and AADT endpoints accept anonymous GETs. CDOT disclaims data warranties. No registration or agreement appears for these endpoints. |
| [FHWA released TMAS files](https://www.fhwa.dot.gov/policyinformation/tables/tmasdata/), [2023 station archive](https://www.fhwa.dot.gov/policyinformation/tables/tmasdata/2023/2023_station_data.zip) | Released data are “quality reviewed and used in the Traffic Volume Trends (TVT) process.” | Download the published station ZIP without registration. Only the CA and CO station members supply selected county rows. No monthly volume archive is downloaded. The [internal-system catalog](https://catalog.data.gov/dataset/travel-monitoring-analysis-system-tmas) labels its access “restricted public”; that describes the internal system, not permission to access it. This task uses the separately published files only. |
| [FHWA HPMS 2024](https://data.transportation.gov/resource/42um-tgh5.json), [schema and license](https://data.transportation.gov/api/views/42um-tgh5) | “Public Domain U.S. Government”; metadata rights are `public`. | Anonymous Socrata queries select state and county, retain source fields, and page in stable row-ID order. No account, token, agreement, or paid data service is used. The adapter stops at a bounded pagination limit rather than claiming incomplete results are complete. |

CDOT's [traffic analysis guidance](https://www.codot.gov/safety/traffic-safety/assets/traffic_analysis_forecasting_guidelines/traffic_analysis_forecasting_guidelines/%40%40download/file/traffic_analysis_forecasting_guidelines.pdf)
identifies OTIS and the [public MS2 system](https://cdot.public.ms2soft.com/tcds/tsearch.asp?loc=Cdot&mod=TCDS)
as traffic sources. OTIS remains operational in this inspection. This task does
not access MS2, COGNOS, OpenTMS, or an agency-restricted successor. Their terms
and exports remain **[VERIFY before use]**. No CORA request is submitted; such
requests can incur charges and do not meet this task's free-data boundary.

## Fields and county coverage

The following inventory describes inspected responses, not fields inferred from
an agency's general practices. “Unknown” does not mean zero coverage.

| Source | Station/location and year | Type and duration | Direction, lanes, vehicle class and QA |
|---|---|---|---|
| Caltrans annual workbook plus GIS | Route, route suffix, county, postmile prefix/value/suffix, description, GIS coordinates and object IDs; workbook sheet names 2023. No publisher count-station ID appears. | No per-row continuous/short-duration field, dated duration, factor group, or interval. Report year is not a collection date. | Back/ahead are adjacent sections, not opposite travel directions. The program defines AADT as all vehicles and both directions. Neither source supplies explicit lane/carriageway scope or station QA flags. |
| CDOT station API, AADT layer and date API | `stationId`, route, begin/end reference points, description, county/city; `AADTYR`, `COUNTYEAR`, `CALYR`, `UPDATEYR`. All 101 associated current AADTs have `AADTYR=2025`. | Boolean `continuous`; date availability lists; `AADTDERIV` and `SEASONALGROUPID` retained as raw codes. No decoder invents their meaning. Date lists do not prove complete hours. Three stations return empty lists. One includes `19960800`, retained with an incomplete-date flag. | `ISRAMP` establishes mainline versus ramp for the inspected associations. Daily explorer labels primary, secondary and combined direction. Truck AADT fields exist. No inspected station response proves the retained observation's lane/class scope or accepted QA. |
| TMAS 2023 station records | Station ID, state/county, route/LRS, coordinates, record year, direction and lane form the station record identity. | `method_volume=3` identifies permanent continuous equipment. Other method codes remain unmapped to collection type. No date span or complete-year coverage follows from the station file. | Raw direction/lane, number of lanes, monitored lanes, classification algorithm/group counts, sensor and calibration codes remain available. Weighing-system calibration is not an AADT interval. The release's quality review does not establish station-specific interval QA. |
| HPMS 2024 section records | Route/section begin/end, geometry, sample ID, `year_record`, `aadt_d` collection date. There is no count-station ID crosswalk in the selected schema. | No per-station count type, duration, factor method, or interval. Null AADT may be omitted from JSON; it remains absent. | Roadway lane counts, facility type and truck AADT exist. They do not establish lanes or classes actually counted. No per-record accepted count-QA flag appears. |
| PeMS | Public documentation describes continuous detectors and historical traffic, census, classification and WIM data. | Account-gated station inventories and dated raw downloads remain uninspected. | Exact station ID/location/type/lane fields, observed-versus-imputed flags, vehicle-class scope and usable QA fields remain **[VERIFY after authorized access]**. No public aggregate claim substitutes for them. |

Caltrans's [FAQ](https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/census/f0017711-traffic-data-faq.pdf)
describes continuous, quarterly-control, profile, ramp and classification count
programs. Typical sampling durations in that document do not identify any one
row's actual count duration. Its back/ahead definitions and the separate ramp
program support the adapter's section handling. The [TMG station format](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2013/traffic-monitoring-formats.cfm)
supplies the method-volume code definition. The [HPMS metadata model](https://www.fhwa.dot.gov/policyinformation/hpms/fieldmanual/page03.cfm)
contains grouped duration statistics; they are not individual section durations.

| Development county | Caltrans GIS records after exact-duplicate consolidation | CDOT retained-ID station records | TMAS 2023 unique station IDs / direction-lane rows | HPMS 2024 section rows |
|---|---:|---:|---:|---:|
| Merced | 156 | Not applicable | 2 / 6 | 6,320 |
| San Benito | 32 | Not applicable | 0 / 0 | 1,749 |
| Tulare | 256 | Not applicable | 8 / 48 | 7,822 |
| Broomfield | Not applicable | 21: 2 continuous, 19 short-duration | 1 / 2 | 2,012 |
| Pueblo | Not applicable | 80: 2 continuous, 78 short-duration | 4 / 8 | 8,307 |

These counts are source coverage, not independently usable observations. The
Caltrans GIS responses initially contain 211, 51 and 346 objects, respectively.
The CDOT query targets retained station IDs; it is not a countywide census.
A retained station can sit across a county boundary while its section crosses
the development county. The TMAS zero for San Benito applies only to the 2023
released station file. HPMS rows can overlap and repeat source sections.

PeMS availability for Merced, San Benito and Tulare remains **[VERIFY by station
and year after authorized registration]**. Public descriptions of statewide or
district coverage do not establish county-specific continuous data completeness.
PeMS is a California source and does not cover the two Colorado counties.

## Association and transfer rules

The [registry](../../scripts/modeling/development/s2_station_evidence.v1.json)
contains the five county IDs, source codes, edition, URLs, access states, and
30-metre location tolerance. Core logic contains no county list. The tolerance
is an identity-screening choice, not a measurement-precision or acceptance gate.

The [adapters](../../scripts/modeling/station_evidence.py) implement these rules:

1. CDOT uses the publisher station ID retained in `source_description`, plus
   exact route and the three-decimal retained begin reference point. It requires
   mainline scope from `ISRAMP=0`. A numeric ID from another namespace cannot
   match. Multiple eligible station/section records remain ambiguous.
2. Caltrans uses route, postmile, full description, mainline scope, and a GIS
   point within 30 metres of the retained bounding-box center. It retains route
   and postmile suffixes in the annual-row crosswalk. Postmiles normalize to six
   decimal places for workbook floating-point representation. Only GIS objects
   whose substantive attributes and coordinates are exactly identical collapse;
   every object ID stays in custody. Different coordinates or attributes remain
   separate candidates. This is not a nearest-point tie breaker.
3. The dated California annual row must be unique, match the retained year,
   and reproduce the retained `max(back,ahead)` value before its all-vehicle
   definition enters an audit-only copy. That check establishes source-row
   identity; it does not justify the old maximum convention. Differing section
   values remain a named unresolved scope issue. Lane and carriageway stay unknown.
4. HPMS location candidates require the same route number, compatible mainline
   and two-way scope, and a point-to-section distance within 30 metres. They have
   `low_location_only` confidence and require a publisher crosswalk. Route signing
   and count lineage remain unresolved. Multiple candidates remain ambiguous.
   TMAS uses route/location with the same scope gate. Its inspected directional
   station records do not establish the retained two-way facility scope. Neither
   national adapter transfers process facts to the retained AADT.
5. Successful state associations have `high_identity_only` confidence. CDOT's
   current station type does not become the frozen count's historical type.
   Neither source-wide review statements nor metadata completeness become
   `qa.status=accepted`. No adapter creates bounds, quantiles, complete hours,
   factor applicability, or an interval evidence record.

The [audit](../../scripts/modeling/audit_station_evidence.py) pins the input
registry, archive, each CSV member, baseline eligibility report, and every
matched source-row hash. It invokes #380's `attach_observation_interval` on the
successor copy. It never invokes a residual scorer. Exact URLs, UTC retrieval
timestamps, byte lengths and SHA-256 values accompany 225 successful data
response receipts. A retrieval journal allows a stopped collection to resume
from verified bytes. Redirects and gated source descriptors require review.
Offline replay requires the complete normalized bundle's file hash and verifies
all retained response objects again.

## Recomputed availability

| County | Matched denominator | State metadata associated | Unmatched association | All-vehicle scope established | Available intervals | Primary refusal |
|---|---:|---:|---:|---:|---:|---|
| Merced | 78 | 55 | 23 | 55 | 0 | Collection type not bound: 78 |
| San Benito | 18 | 9 | 9 | 9 | 0 | Collection type not bound: 18 |
| Tulare | 140 | 74 | 66 | 73 | 0 | Collection type not bound: 140 |
| Broomfield | 21 | 21 | 0 | 0 | 0 | Collection type not bound: 21 |
| Pueblo | 80 | 80 | 0 | 0 | 0 | Collection type not bound: 80 |
| Total | 337 | 239 | 98 | 137 | 0 | Collection type not bound: 337 |

All 337 also lack accepted QA, explicit lane and carriageway scope, and interval
evidence. Vehicle-class scope remains missing for 23 Merced, nine San Benito,
67 Tulare, 21 Broomfield and 80 Pueblo observations, totaling 200. All 101
Colorado observations still lack an AADT year. Of the California associations,
110 also retain differing back/ahead section values: 48 Merced, seven San Benito,
and 55 Tulare. One Tulare association lacks a unique dated annual row.

The 98 unmatched state associations comprise 79 ambiguous candidates and 19
route/section/location refusals. HPMS produces one unique location candidate in
Merced, five in Tulare, 11 in Broomfield and 36 in Pueblo; all require a publisher
crosswalk. Other nearby HPMS sections remain ambiguous or incompatible. No TMAS
row passes the complete facility/direction association gate.

The [coverage record](../../data/modeling/s1-station-evidence-2026-10-23/coverage.json)
retains each association, candidate hash, refusal and recalculated interval.
The [source evidence](../../data/modeling/s1-station-evidence-2026-10-23/source-evidence.json)
retains all selected state/TMAS metadata and candidate HPMS excerpts, plus the
complete receipt manifest. Full raw responses and the 64,492,253-byte normalized
bundle remain in local content-addressed storage at the paths in that record.
The repository excerpt is not a replacement for those raw bytes. No private
records or account data enter either artifact.

## Verification, failures and limits

The [scoped test record](../../data/modeling/s1-station-evidence-2026-10-23/scoped-tests.json)
reports 95 passing tests: 38 new adapter/audit tests, 48 existing uncertainty
tests and nine existing input-only coverage tests. No test reports a skip.
The interpreter is CPython 3.11.15. The existing uncertainty environment remains
unchanged. New adapters use the standard library; this task performs no NumPy
array work outside the CPython 3.11 environment.

The final [mutation campaign](../../data/modeling/s1-station-evidence-2026-10-23/mutations-final-v2.json)
records 54 intended assertion failures, two harmless full-suite survivors, and
a passing baseline. Every mutation runs in a temporary copy. The original
source bytes match their pre-campaign hashes. No skipped or masked control earns
credit. Blind categories are publisher truth, empirical interval coverage,
historical process transfer, live-service completeness, and scientific acceptance.

Earlier failures remain visible:

- Collection attempt one stops on CDOT date `19960800`. The adapter now preserves
  and flags invalid/incomplete calendar dates; it does not count them as hours.
- Collection attempt two stops on a nullable HPMS AADT omitted from JSON. The
  metadata adapter now preserves absence and does not manufacture a value.
- The first mutation attempt stops when a refusal test's stub rejects the
  `timeout` keyword before reaching its intended assertion. The corrected stub
  fails explicitly if gated data reaches the network. The earlier attempt earns
  no completed-campaign credit. Attempt two passes 40 broken controls; the final
  43-control campaign adds GIS duplicate and member-custody controls. The final
  54-control campaign covers every new test with a targeted assertion failure.
- The supplemental Caltrans terms-page HTTP 403 remains in the access audit.
  Indexed official-page text supports the quotation, without a response hash.

Collection, replay, scoped regression tests and mutation campaigns use systemd
user scopes with `MemoryMax=6G` and `MemorySwapMax=0`. Product direction checking
passes with existing review-age reminders. Full application QA, browser journeys,
scientific validation and hosted tests remain unexecuted. No `next build`,
Docker operation, deployment, managed database access or secret access occurs.

## Reproduce without new outcome access

Use the exact pinned input registry exported from S2 commit
`95364142219411810c5b95df22d54fe361f0cfa2`, path
`data/modeling/s2-cordon-py311-round5-2026-10-23/inputs.json`.
Its SHA-256 is
`9ad0ff220af4b8c97c8bf9c046196dec738c54dfae02d93f7b7b9380e9e276ab`.
The [execution record](../../data/modeling/s1-station-evidence-2026-10-23/coverage-execution.json)
contains the exact successful offline command, interpreter, bundle hash, and
local paths. Outputs use exclusive creation and refuse an existing filename.

For a fresh authorized metadata collection, use the same command with a new
`--bundle` and `--output`, replace `--bundle-sha256 HASH` with `--fetch`, and
supply a new source directory. The sources can change; new bytes constitute a
new audit, not reproduction of this dated result. To resume a stopped collection,
retain its source directory and retrieval journal. Do not alter the input
registry or select another partition through this recipe.

Run the new suite with CPython 3.11:

```bash
/home/nathaniel/.local/bin/python3.11 -B -m unittest discover \
  -s scripts/modeling/tests -p 'test_station_evidence*.py'
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 \
  /home/nathaniel/.local/bin/python3.11 -B scripts/modeling/prove_station_evidence.py \
  /absolute/new-mutation-record.json
```

## Nathaniel's remaining decision

PeMS requires Nathaniel's registration and explicit agreement acceptance before
account-gated station data can be inspected. No authorization is assumed here.
A separately authorized acquisition lane must obtain historical source-row
crosswalks, dates and complete hours, actual count/factor methods, observed
lane/class scope, QA evidence, and source-supported bounds or local calibration
before any observation qualifies. S1/S3 and nationwide scientific acceptance
remain incomplete. This draft does not authorize a new study or holdout access.
