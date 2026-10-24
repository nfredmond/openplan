# Integration source custody and remaining input limits

October 23, 2026. The preparation reads public input sources and the previously
captured outcome-free roster summary. It does not request TBI household, person,
day or trip outcomes. Source downloads and failures are retained in
`integration-evidence/source-manifest.*.json`. Original bytes remain under
`data/_screening_cache/tbi2019-integration/` in the integration checkout.

## Fare policy is found; executable coverage remains partial

The Council's [adoption notice](https://metrocouncil.org/News-Events/Transportation/Newsletters/Council-votes-to-increase-regional-transit-fares,.aspx)
sets the effective date at October 1, 2017. The following quotes its new-rate
column for adult regular-route fares, in nominal dollars:

| Fare | New rate |
|---|---:|
| Local (bus/rail) Off-Peak | $2.00 |
| Local (bus/rail) Peak | $2.50 |
| Express bus Off-Peak | $2.50 |
| Express bus Peak | $3.25 |

The [amended adopted schedule](https://metrocouncil.org/Council-Meetings/Committees/Metropolitan-Council/2017/7-26-17/0724_2017_154-SW.aspx),
PDF page 8, also distinguishes reduced fares, Northstar destination fares,
downtown fares and demand-responsive services. Those products are retained as
source information, not replaced with an adult local fare. PDF page 9 preserves
the prior rush-hour and transfer rules. The
[2019 Council performance report](https://www.leg.mn.gov/docs/2020/mandated/201248.pdf),
PDF pages 38 and 39, shows the 2017 rates continuing through 2019. The
[2023 Council fare analysis](https://metrocouncil.org/Council-Meetings/Committees/Transportation-Committee/2023/July-10,-2023/0710_2023_150-attachment.aspx),
PDF pages 9 and 10, identifies weekday peak hours of 6–9 a.m. and 3–6:30 p.m.
and identifies October 1, 2017 as the most recent regional fare change. Together
these support the selected Tuesday, October 8, 2019 service date. This is not a
claim that the 2017 schedule remains current today.

The new generic policy prices only a single boarding with an explicit route
and time-window fare. It binds the exact service date and source hash. It leaves
transfers, missing route classifications, overlapping windows and unsupported
fare products unavailable. The configuration identifies 79 bus routes whose
published GTFS names explicitly say Express and three tram routes. The other
106 route fares remain unknown. A route with unknown fare can have measured
timetable travel time without a usable mode-choice alternative. No default
flat fare or current fare is substituted. Full fare-product and cost-base-year
alignment remains a study admission requirement.

The indexed 2020 Title VI document exposes a historical 2017 peak-hour table,
but its original URL now returns HTTP 404. The failure is retained. It is not
represented as a successfully retained PDF. Reading the 2019 fare chart also
exposed its adjoining public aggregate rail-ridership chart. Those operational
aggregates are not TBI respondent outcomes; this lane does not claim blindness
to every published regional travel statistic. They do not set any rule or fit.

## MVTA remains unavailable, with a bounded geographic exclusion

The [Metro Transit feed source](https://svc.metrotransit.org/) and archived feed
README identify MVTA as a separate feed. The
[Mobility Database record](https://mobilitydatabase.org/feeds/gtfs/mdb-206)
exposes current files and lists a February 8, 2024 catalog creation date in its
retained page data. Its inspected history supplies no 2019 archive. The direct
TransitFeeds provider URL returns HTTP 403. Transitland's
[provider crosswalk](https://www.transit.land/data/id-crosswalks/omd) confirms the
provider slug and states that OpenMobilityData has closed. Its
[feed catalog](https://www.transit.land/feeds/f-9zvw-mvta~metro) identifies prior
MVTA producer URLs but does not supply an inspected, freely downloadable 2019
file. The MVTA developer-path request returns HTTP 403. Searches for the agency,
2019 and archived GTFS do not yield a verifiable 2019 feed. These bounded checks
establish that no historical feed was acquired here, not that none exists.

The [MVTA audited 2020 financial report](https://www.mvta.com/wp-content/uploads/2025/03/2020.pdf)
defines its seven member cities and historical membership: Apple Valley,
Burnsville, Eagan, Prior Lake, Rosemount, Savage and Shakopee. The study overlays
those named municipalities from Census TIGER2019 PLACE with the 704 TIGER2019
tracts. Any positive-area intersection excludes the tract as a transit endpoint.
This conservative mask excludes 66 zones and leaves 638. It preserves the
original ordered 704-zone system and marks excluded endpoint skims unavailable.
It does not assert that every resident of an intersecting tract uses MVTA.

Member-city geography is not the complete route-service footprint. MVTA also
serves destinations outside those cities. Therefore the mask does not resolve
all trip dependence. The frozen roster has only county, household ID and year;
actual MVTA-dependent survey-record counts remain unavailable without prohibited
trip fields. No missing-service record is classified as zero transit. Exact
endpoint/service dependence remains for the lead's future protocol.

## Drive access remains unavailable

The Council's [2019 park-and-ride inventory](https://metrocouncil.org/Transportation/Publications-And-Resources/Transit/Park-and-ride/2019-Park-and-Ride-Report.aspx)
records October 2019 facilities by provider, city, name and facility ID. This
source exists and is retained. A facility name alone does not establish a safe
access road, parking entrance or stop connection. This preparation has no
verified inventory-to-road-node-to-GTFS-stop crosswalk. It supplies zero drive
connectors and explicitly excludes drive-transit alternatives. It does not
create park-and-ride access at arbitrary stops or infer that parking is free.

## Census input transport preserves the admitted profile

The keyless ACS API probe returns HTTP 200 with a Missing Key HTML page. The
existing API adapter also requires a key. No secret is read or requested.
The alternative is Census's public bulk transport for the same 2015–2019
products: [summary sequence files](https://www2.census.gov/programs-surveys/acs/summary_file/2019/data/5_year_seq_by_state/Minnesota/Tracts_Block_Groups_Only/),
[sequence lookup](https://www2.census.gov/programs-surveys/acs/summary_file/2019/documentation/user_tools/ACS_5yr_Seq_Table_Number_Lookup.txt)
and [PUMS CSV files](https://www2.census.gov/programs-surveys/acs/data/pums/2019/5-Year/).
The adapter joins sequence cells using the published table start and cell
position, joins zones by LOGRECNO and full GEOID, preserves estimates and margins,
and joins household/person microdata by SERIALNO and SPORDER. It projects only
fields needed by the existing synthesizer. It requires every selected PUMA,
unique identities and NP person-count conservation.

The existing resolver selects 32 PUMAs, including three in Wisconsin. The
corrected input contains both states, 83,700 household records and 181,876 person
records before the existing seed eligibility rules. The first Minnesota-only
read omitted those Wisconsin areas; its preparation process was stopped before
completion, and its log remains. The correction does not change the fitted
controls, synthesis tolerance, integerization, income conversion or household
split. The profile remains 2015–2019 five-year data, not a one-year 2019 snapshot.

## Employment uses 2019 workplace counts

The [Census 2019 LODES release](https://www.census.gov/programs-surveys/ces/news-and-updates/updates/11022021.html)
and [LODES 7.5 specification](https://lehd.ces.census.gov/data/lodes/LODES7/LODESTechDoc7.5.pdf)
identify the public 2019 workplace product and its 2010-block geography.
The retained Minnesota `mn_wac_S000_JT00_2019.csv.gz` supplies all jobs across
all worker segments. Its SHA-256 is
`325c6a9d36963b6ea79d72ebf6be3281e2411217f57a124dc9593d7f42c44b64`.
The explicit join uses each 15-digit block's 11-digit tract prefix. All 704
selected TIGER2019 tracts occur. The selection includes 18,378 workplace blocks
and 1,813,674 jobs; 1,075,214 jobs remain outside the selected tracts.
The adapter checks all 20 published industry counts against each block total,
refuses duplicate or malformed blocks and refuses absent selected tracts.

These are jobs, not unique employed people or observed travel. The existing
MTC adapter pools the published retail, education, health, accommodation and
other counts into its existing categories. It does not infer a new sector
mapping. School enrollment remains ACS enrollment by residence, not school
seats. Parking costs, terrain, developed acreage, independent walk/bicycle
paths and observed period road speeds remain unresolved input qualifications.

## Additional archive checks

The retained Transitland feed page exposes more than 100 versions; the oldest
visible date in that bounded page is March 22, 2021. Its obsolete v1 API returns
HTTP 404. The current [Feed Archive policy](https://www.transit.land/data/feeds/archive)
reserves downloads for Hobbyist/Academic or Enterprise plans. The ordinary
Explorer plan does not include them. No account application, agreement or paid
service is authorized or attempted here. Historical access through that route
is a Nathaniel decision, not an engineering entitlement. This does not prove
that a 2019 feed is absent from the archive.

An [indexed public Council report](https://www.lrl.mn.gov/docs/2024/mandated/241352.pdf) identifies an MVTA feed published September 3,
2019, obtained from Transitland. That is a lead for a future authorized source
request, not a retrieved feed or proof of October 8 service coverage. This lane
does not open that report's travel tables. The old park-and-ride GIS metadata
URL also returns HTTP 404. Current GIS layers do not by themselves establish
2019 entrance geometry, road access or a stop crosswalk.
