# Verified GIS data sources for transportation planning maps

Tested from this machine with curl on 2026-10-01 (server clocks read 2026-10-02 UTC).

## How to read this file

- **Test bbox.** lon -121.30 to -121.10, lat 38.75 to 38.90 (Roseville, Rocklin, Lincoln area), sent as `geometry=-121.30,38.75,-121.10,38.90&geometryType=esriGeometryEnvelope&inSR=4326`.
- **Test column.** `200 / n in bbox / geojson ok` means: layer metadata returned HTTP 200, `returnCountOnly` returned n features in the test bbox, and a `resultRecordCount=1&f=geojson&outSR=4326` query returned one feature.
- **maxRec.** `maxRecordCount` reported by the layer. Page past it with `resultOffset` (recipe in the last section).
- **NOT VERIFIED on 2026-10-01** means the endpoint did not return usable data from this machine. The reason is stated. Nothing was dropped.
- Browser-like User-Agent used for all ArcGIS tests. Every ArcGIS layer listed as verified reported `supportedQueryFormats: JSON, geoJSON, PBF` unless noted.
- Vintage is given only where the service or catalog states it. `[VERIFY]` marks a vintage or term the service does not state.

## Findings that change how scripts must be written

1. **Census Data API now requires a key.** Keyless requests return HTTP 302 to `https://api.census.gov/data/missing_key.html`. Census states the requirement took effect 2026-05-12. No key is set on this machine (`CENSUS_API_KEY` is empty).
2. **CARTO raster basemaps now require an API key.** Keyless requests return HTTP 200 with a tile that reads "API KEY REQUIRED carto.com/basemaps/apikey". A script that checks only the status code will print watermarked maps.
3. **Overpass (overpass-api.de) rejects generic User-Agents.** Default curl, an empty UA, and a Chrome-style UA each returned HTTP 406. `GIS2-research/0.1 (email)` returned 200.
4. **USDOT ETC Explorer is gone from USDOT hosting.** No public service covering California was found. CEJST is offline at its federal address and available from a non-federal archive.
5. **CalEnviroScreen 5.0 is final (2026-07-01) and CalEPA issued a final SB 535 designation in September 2026.** CARB's priority populations layer already uses it. The 2022 designation layers remain online.
6. **NHTSA Crash API returns 403** from this machine. FARS points are available from the BTS NTAD feature services and from static CSV zips.
7. **Caltrans publishes no statewide bikeway layer.** The Caltrans open data catalog (83 datasets) has one bikeway layer, Orange County only. Use SACOG for the Sacramento region.

---

## 1. National boundaries and demographics

### Census TIGERweb

Publisher: U.S. Census Bureau. Server version 11.5. maxRec 100000. Copyright text: "Source: U.S. Census Bureau" (public domain). Base: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb`

| Layer | URL (append to base) | Key fields | Test |
|---|---|---|---|
| Incorporated places | `/tigerWMS_Current/MapServer/28` | GEOID, NAME, BASENAME, LSADC, FUNCSTAT, AREALAND | 200 / 5 in bbox / geojson ok |
| Census designated places | `/tigerWMS_Current/MapServer/30` | same as places | 200 / 3 / ok |
| Counties | `/tigerWMS_Current/MapServer/82` | GEOID, STATE, COUNTY, NAME | 200 / 2 / ok |
| Census tracts | `/tigerWMS_Current/MapServer/8` | GEOID, STATE, COUNTY, TRACT, AREALAND | 200 / 46 / ok |
| Block groups | `/tigerWMS_Current/MapServer/10` | GEOID, TRACT, BLKGRP | 200 / 110 / ok |
| Urban areas (2020) | `/tigerWMS_Current/MapServer/88` | GEOID, UA, NAME | 200 / 2 / ok |
| 2020 blocks | `/tigerWMS_Current/MapServer/12` | not query-tested | listed in service on 2026-10-01 |

Same geographies in the thematic services (current vintage group, layer ids 0 to 5), each tested with the bbox count only:

| Layer | URL (append to base) | Test |
|---|---|---|
| Tracts | `/Tracts_Blocks/MapServer/0` | 200 / 46 |
| Block groups | `/Tracts_Blocks/MapServer/1` | 200 / 110 |
| Incorporated places | `/Places_CouSub_ConCity_SubMCD/MapServer/4` | 200 / 5 |
| CDPs | `/Places_CouSub_ConCity_SubMCD/MapServer/5` | 200 / 3 |
| Counties | `/State_County/MapServer/1` | 200 / 2 |
| 2020 urban areas | `/Urban/MapServer/0` | 200 / 2 |

Notes:
- `tigerWMS_Current` labels its legislative layers "120th Congressional Districts" and "2026 State Legislative Districts".
- Vintage-pinned services exist: `tigerWMS_ACS2024`, `tigerWMS_ACS2025`, `tigerWMS_ACS2026`, `tigerWMS_Census2020`. `tigerWMS_ACS2024` uses the same ids for tracts (8), block groups (10), places (28), CDPs (30), counties (82), urban areas (88). Use the vintage that matches the ACS table year.
- In the thematic services, later ids repeat the same geographies for "BAS 2026", "ACS 2025", and "Census 2020" groups (for example `Tracts_Blocks` 4 and 5, 7 and 8, 10 to 12).

### Census ACS 5-year API

- Publisher: U.S. Census Bureau. Base: `https://api.census.gov/data/{year}/acs/acs5`
- **Key required: yes.** Sign up at `https://api.census.gov/data/key_signup.html` (HTTP 200). Append `&key=YOUR_KEY`.
- Dataset metadata `https://api.census.gov/data/2024/acs/acs5.json` returned 200 without a key and reports `c_vintage: 2024` (2020 to 2024 ACS).
- **Data query: NOT VERIFIED on 2026-10-01.** Keyless test returned HTTP 302, header `X-DataWebAPI-KeyError: 1`, location `missing_key.html`, for both 2024 and 2023.

Example query (tract level, Placer County, state 06 county 061), not run successfully here:

```
https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E,B08201_001E,B08201_002E,B17001_001E,B17001_002E,B08301_001E,B08301_003E,B08301_010E,B08301_018E,B08301_019E,B08301_021E&for=tract:*&in=state:06%20county:061&key=YOUR_KEY
```

| Variable | Meaning |
|---|---|
| B01003_001E | Total population |
| B08201_001E, B08201_002E | Households, households with no vehicle available |
| B17001_001E, B17001_002E | Population for whom poverty status is determined, below poverty |
| B08301_001E | Workers 16 and over (commute universe) |
| B08301_003E, _010E, _018E, _019E, _021E | Drove alone, public transportation, bicycle, walked, worked from home |

Variable ids are from the ACS table shells and were not confirmed against a live response. `[VERIFY: run once with a key and check labels at /data/2024/acs/acs5/variables.json]`. Join to TIGERweb on GEOID = state + county + tract.

---

## 2. OpenStreetMap Overpass API

| Endpoint | Test |
|---|---|
| `https://overpass-api.de/api/interpreter` | 200 with descriptive UA, 3 ways returned (cycleways in bbox). 406 with default curl UA, empty UA, and Chrome-style UA |
| `https://overpass-api.de/api/status` | 200. Reported "Rate limit: 2", 2 slots available |
| `https://maps.mail.ru/osm/tools/overpass/api/interpreter` | 200 on first test, 504 on a second test 40 minutes later. Treat as intermittent |
| `https://overpass.kumi.systems/api/interpreter` | NOT VERIFIED on 2026-10-01 (no response, timeout) |
| `https://overpass.private.coffee/api/interpreter` | NOT VERIFIED on 2026-10-01 (no response, timeout) |

- Test query: `[out:json][timeout:25];way["highway"="cycleway"](38.75,-121.30,38.90,-121.10);out ids 3;` sent as POST field `data`. Overpass bbox order is south, west, north, east.
- **User-Agent.** Send a unique one naming the script and a contact, for example `GIS2-maps/0.1 (you@example.org)`. The main instance returned 406 without it.
- **Usage policy** (dev.overpass-api.de commons page): about 10,000 requests per day and under about 1 GB per day on the public instance. Heavier use should run its own instance.
- **Licence.** ODbL. Credit "© OpenStreetMap contributors" on any map that uses the data.

---

## 3. USDOT, BTS, FHWA, NHTSA

### BTS National Transportation Atlas Database (NTAD)

Publisher: USDOT Bureau of Transportation Statistics. Base: `https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services`. maxRec 2000 on every layer below. Licence text on most layers: work of the U.S. government, unrestricted public use. National Transit Map layers state CC-BY-3.0 US.

| Dataset | URL (append to base) | Vintage stated | Key fields | Test |
|---|---|---|---|---|
| National Transit Map stops | `/NTAD_National_Transit_Map_Stops/FeatureServer/0` | `download_date` values 2025-03-19 to 2026-03-09 | ntd_id, stop_id, stop_name, stop_type_text, wheelchair_boarding | 200 / 203 / ok |
| National Transit Map routes | `/NTAD_National_Transit_Map_Routes/FeatureServer/0` | download_date field | ntd_id, route_id, route_short_name, route_long_name, route_type_text, route_color | 200 / 77 / ok |
| North American Rail Network lines | `/NTAD_North_American_Rail_Network_Lines/FeatureServer/0` | not stated | RROWNER1, TRKRGHTS1, SUBDIV, PASSNGR, STRACNET, TRACKS, NET | 200 / 42 / ok |
| Intermodal freight, rail TOFC/COFC | `/NTAD_Intermodal_Freight_Facilities_Rail_TOFC_COFC/FeatureServer/0` | not stated | TERMINAL, CITY, STATE, RAIL_CO, EQUIPMENT | 200 / 0 in bbox, 0 in Sacramento bbox, 241 nationwide / ok |
| Intermodal Passenger Connectivity Database | `/NTAD_Intermodal_Passenger_Connectivity_Database/FeatureServer/0` | DATE_UPDTE field | FAC_NAME, FAC_TYPE, MODES_SERV, MODE_BUS, MODE_RAIL, MODE_BIKE | 200 / 4 / ok |
| National Bridge Inventory | `/NTAD_National_Bridge_Inventory/FeatureServer/0` | not stated | STRUCTURE_NUMBER_008, FACILITY_CARRIED_007, FEATURES_DESC_006A, YEAR_BUILT_027, ADT_029, OWNER_022 | 200 / 78 / ok |
| FRA railroad grade crossings | `/NTAD_Railroad_Grade_Crossings/FeatureServer/0` | not stated | CrossingID, STREET, RailroadCode, CrossingType, CrossingPosition, SignsOrSignals, AnnualAverageDailyTrafficCount, TotalDaylightThruTrains | 200 / 44 / ok |
| National Highway System | `/NTAD_National_Highway_System/FeatureServer/0` | "NHS Version 2025.08.08" | SIGN1, LNAME, NHS, FCLASS, AADT, THROUGH_LA, SPEED_LIMI | 200 / 123 / ok |
| National Highway Freight Network | `/NTAD_National_Highway_Freight_Network/FeatureServer/0` | "NHFN Version 2023.02.08" | SIGN1, NHFN_CODE, LNAME | 200 / 20 / ok |
| MPO boundaries (national) | `/NTAD_Metropolitan_Planning_Organizations/FeatureServer/0` | not stated | MPO_ID, MPO_NAME, STATE | 200. bbox count timed out twice. `where=STATE='CA'` returned 17. Point query at -121.2, 38.8 returned the Sacramento MPO |
| FARS fatal crashes, final release | `/NTAD_Fatality_Analysis_Reporting_System_FinalRelease_Accidents/FeatureServer/0` | YEAR = 2023 only | ST_CASE, YEAR, FATALS, PEDS, LATITUDE, LONGITUD, FUNC_SYSNAME, ROUTENAME, HARM_EVNAME, LGT_CONDNAME | 200 / 10 / ok |
| FARS fatal crashes, initial release | `/NTAD_Fatality_Analysis_Reporting_System_InitialRelease_Accidents/FeatureServer/0` | YEAR = 2024 only | same | 200 / 6 / ok |

The same BTS organization hosts about 190 NTAD services (Amtrak routes and stations, intercity bus, truck parking, alternative fuel corridors, National Network, STRAHNET). List them with `{base}?f=json`.

### FHWA HPMS

| Dataset | URL | Vintage | Key fields | Test |
|---|---|---|---|---|
| HPMS California, full | `https://geo.dot.gov/server/rest/services/Hosted/HPMS_FULL_CA_2024/FeatureServer/0` | 2024 (service name) | f_system, routenumber, routename, nhs, aadt, aadt_single_unit, aadt_combination, through_lanes, speed_limit, ownership, urban_id, iri | 200 / 4822 / ok. maxRec 2000 |
| HPMS national, current | `https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/HPMS_National_Current/FeatureServer/0` | layer name "HPMS_National_2024_FullJoin" | F_SYSTEM, RouteNumber, RouteName, NHS, AADT, THROUGH_LANES, SPEED_LIMIT, OWNERSHIP | 200 / 4822 / ok. maxRec 2000 |

- `geo.dot.gov/server/rest/services/Hosted` also lists `HPMS_FULL_CA_2023`, `_2022`, `_2020` and `HPMS_Full_CA_2019`. Field names are lowercase on geo.dot.gov and uppercase on the BTS copy.
- `F_SYSTEM` codes 1 to 7 are the federal functional classes (1 Interstate to 7 Local).
- Licence: not stated on the layers. Federal work. `[VERIFY]`

### FARS access outside NTAD

| Access | URL | Test |
|---|---|---|
| Static national CSV, 2023 | `https://static.nhtsa.gov/nhtsa/downloads/FARS/2023/National/FARS2023NationalCSV.zip` | HEAD 200, 34.2 MB, last modified 2026-04-01 |
| Static national CSV, 2024 | `https://static.nhtsa.gov/nhtsa/downloads/FARS/2024/National/FARS2024NationalCSV.zip` | HEAD 200, 32.7 MB, last modified 2026-04-01 |
| NHTSA Crash API | `https://crashviewer.nhtsa.dot.gov/CrashAPI/crashes/GetCrashesByLocation?fromCaseYear=2022&toCaseYear=2022&state=6&county=61&format=json` | NOT VERIFIED on 2026-10-01. HTTP 403 "Access Denied" with three different User-Agents |
| NHTSA file browser | `https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/FARS/` | NOT VERIFIED on 2026-10-01. HTTP 403 to curl |

Each NTAD FARS layer holds one year. For a five-year fatal crash map, use the static zips (`accident.csv` has LATITUDE and LONGITUD) or CCRS and TIMS for California.

### USDOT disadvantaged community layers and CEJST

| Item | URL | Status and test |
|---|---|---|
| USDOT ETC Explorer (official) | former app id `0920984aa80a4362b8778d779b090723` on arcgis.com | NOT VERIFIED on 2026-10-01. Item metadata returns 403 "You do not have permissions". `transportation.gov/priorities/equity/justice40/etc-explorer` returns 403. Published reports say USDOT removed the tool in late January 2025 |
| ETC tract data, any public copy covering California | none found | NOT VERIFIED on 2026-10-01. 40 ArcGIS Online services matching ETC were tested. None returned a feature in the Sacramento area. All were state or local extracts (North Carolina, Rhode Island, Florida and others) |
| USDOT interim transportation disadvantaged tracts (April 2022, 2010 tracts) | `https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/DOT_Disadvantage_Layer_Final_April2022/FeatureServer/0` | 200 / 43 / ok. Fields: FIPS, Transpor_1, HealthDis, EconomyDis, EquityDis, Resilien_1, EnviroDis, OverallDis. This is the pre-ETC Justice40 interim definition, not ETC |
| CEJST federal site | `https://screeningtool.geoplatform.gov/` | NOT VERIFIED on 2026-10-01. No response (connection failed) |
| CEJST 2.0 archive (non-federal mirror, Public Environmental Data Partners) | `https://public-environmental-data-partners.github.io/j40-cejst-2/en/` | 200 |
| CEJST 2.0 communities CSV | `https://dblew8dgr6ajz.cloudfront.net/data-versions/2.0/data/score/downloadable/2.0-communities.csv` | HEAD 200, 45.3 MB, last modified 2025-02-12 |
| CEJST 2.0 shapefile and codebook | `https://dblew8dgr6ajz.cloudfront.net/data-versions/2.0/data/score/downloadable/2.0-shapefile-codebook.zip` | HEAD 200, 367.6 MB, last modified 2025-02-12 |
| CEJST tracts on BTS org (2010 tracts, dated 2023-11-14 in name) | `https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/2010_Census_Tracts_Disadvantaged_2023_11_14/FeatureServer/0` | 200 / 2 / ok. Fields: GEOID10, SN_C, SN_T, N_TRN, N_CLT and other CEJST codes. No description on the service. `[VERIFY: whether it holds only disadvantaged tracts]` |
| CEJST beta (April 2022) | `https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/CEJST_Disadvantaged_Area_04262022/FeatureServer/0` | 200 / 43 / ok. Superseded beta version |

Before using any of these in a federal grant application, read the current notice. These tools are archived or withdrawn and the notice vocabulary has changed.

---

## 4. Hazards, elevation, imagery

| Dataset | Publisher | URL | Vintage | Key fields or parameters | Test |
|---|---|---|---|---|---|
| NFHL flood hazard zones | FEMA | `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28` | live NFHL | FLD_ZONE, ZONE_SUBTY, SFHA_TF, STATIC_BFE, DFIRM_ID | 200 / 951 / ok. maxRec 2000 |
| NFHL other layers | FEMA | same MapServer | live | 3 FIRM panels, 1 LOMRs, 34 LOMAs, 23 levees, 27 flood hazard boundaries, 16 base flood elevations | service listing 200 |
| 3DEP elevation (dynamic) | USGS | `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer` | copyright text dated 2026-08-25 | `exportImage` with `bbox`, `bboxSR=4326`, `size`, `imageSR`, `format`, `renderingRule` | 200. Hillshade export returned a 400x300 PNG (65 KB). Raw elevation export returned a 400x300 32-bit TIFF (787 KB) |
| USGS shaded relief tiles | USGS | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}` | "Data refreshed April, 2025" | cached tiles | 200, JPEG tile at z12 |
| NAIP imagery (dynamic) | USGS, USDA | `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer` | copyright text dated 2025-01-09 | `exportImage` | 200. Export returned a 400x300 JPEG |
| NAIP Plus (NAIP and high resolution orthoimagery) | USGS, USDA | `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer` | copyright text dated 2025-03-12 | `exportImage` | 200. Export returned a 400x300 JPEG |
| USDA APFO NAIP | USDA | `https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer` | n/a | n/a | NOT VERIFIED on 2026-10-01 (no response) |
| CDFW NAIP 2022 | CDFW | `https://map.dfg.ca.gov/arcgis/rest/services/Base_Remote_Sensing/NAIP_2022/ImageServer` | n/a | n/a | NOT VERIFIED on 2026-10-01 (returned an HTML page, not service JSON) |

Working export calls:

```
# Hillshade PNG
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-121.30,38.75,-121.10,38.90&bboxSR=4326&size=400,300&imageSR=3857&format=png&f=image&renderingRule={"rasterFunction":"Hillshade Gray"}

# Elevation values as 32-bit float GeoTIFF
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-121.30,38.75,-121.10,38.90&bboxSR=4326&size=400,300&imageSR=4326&format=tiff&pixelType=F32&f=image

# NAIP JPEG
https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=-121.21,38.80,-121.19,38.81&bboxSR=4326&size=400,300&imageSR=3857&format=jpgpng&f=image
```

URL-encode the `renderingRule` JSON. USGS and FEMA products are federal works. The services state no use restriction. Credit "USGS The National Map" or "USDA NAIP".

---

## 5. Raster tile basemaps: attribution and print use

Tile tested: z 12 near Roseville.

| Basemap | URL template | Test | Attribution | Printed client deliverable |
|---|---|---|---|---|
| USGS Topo | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}` | 200, JPEG | "USGS The National Map" | Yes. Public domain. Lowest-risk choice |
| USGS Imagery Only | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` | 200, JPEG. "Data refreshed June, 2024" | "USDA, USGS The National Map: Orthoimagery" | Yes. Public domain |
| USGS Shaded Relief | `.../USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}` | 200, JPEG | "USGS The National Map: 3DEP" | Yes. Public domain |
| OSM standard tiles | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | 200, PNG | "© OpenStreetMap contributors" | The cartography is CC BY-SA 2.0 and the data is ODbL, so print with attribution is allowed. The tile server policy prohibits bulk or pre-emptive downloading and requires a unique User-Agent. A script that pulls many tiles to compose a print map is the use the policy restricts. Render from your own data extract or use another provider for production |
| CARTO Positron, Voyager, Dark Matter | `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png` (also `rastertiles/voyager`, `dark_all`) | NOT VERIFIED on 2026-10-01 for real tiles. HTTP 200 but the image is an "API KEY REQUIRED" watermark | "© OpenStreetMap contributors © CARTO" | Key required. CARTO states free use up to 1 million requests per month for commercial users and 5 million for non-commercial. Its basemap terms allow static images for illustrative, editorial or documentary use with legible attribution and prohibit bulk download. `[VERIFY: read carto.com/legal/basemap-terms before a client print run]` |
| Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | 200, JPEG | Esri and its data providers, as listed in the service | See note below |
| Esri World Topo | `.../World_Topo_Map/MapServer/tile/{z}/{y}/{x}` | 200, JPEG | same | See note below |
| Esri Light Gray Canvas base | `.../Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}` | 200, JPEG | same | See note below |
| Esri World Street Map | `https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}` | 200, JPEG | same | See note below |
| OpenTopoMap | `https://tile.opentopomap.org/{z}/{x}/{y}.png` | 200, PNG | "© OpenStreetMap contributors, SRTM. Map style © OpenTopoMap (CC-BY-SA)" | Share-alike applies to the style. `[VERIFY]` |
| Stadia (Stamen Toner Lite) | `https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png` | NOT VERIFIED on 2026-10-01. HTTP 401 without an account key | Stadia, Stamen, OpenStreetMap | Account required |

Esri note. Esri's static maps page (`https://doc.arcgis.com/en/arcgis-online/reference/static-maps.htm`, fetched 2026-10-01) allows static map images in a report for a client with the credit "Map image is the intellectual property of Esri and is used herein under license. Copyright © [year] Esri and its licensors." Resale of the map itself needs Esri's permission. The tile endpoints answer without a token, but that is not a licence. Use them under an ArcGIS licence. `[VERIFY: confirm Drago Vantage's ArcGIS licence covers scripted tile access]`

Tile row and column order differs: Esri and USGS use `{z}/{y}/{x}`, OSM and CARTO use `{z}/{x}/{y}`.

---

## 6. California: Caltrans

Publisher: California Department of Transportation. Server: `https://caltrans-gis.dot.ca.gov/arcgis/rest/services` (version 11.1, maxRec 2000). Catalog: `https://gisdata-caltrans.opendata.arcgis.com/api/feed/dcat-us/1.1.json` (200, 83 datasets). "Modified" dates below come from that catalog. Layer copyright text reads "California Department of Transportation (Caltrans)" or "Copyright © State of California". The data.ca.gov records for the transit layers state Creative Commons Attribution. Other layers state no licence. `[VERIFY]`

| Dataset | URL (append to server) | Modified | Key fields | Test |
|---|---|---|---|---|
| State Highway Network lines | `/CHhighway/SHN_Lines/FeatureServer/0` | 2025-08-11 | Route, RouteS, County, District, bPM, ePM, RouteType, Direction | 200 / 14 / ok |
| SHN postmiles, tenth mile | `/CHhighway/SHN_Postmiles_Tenth/FeatureServer/0` | 2025-08-11 | Route, County, PM, PMc, Odometer | 200 / 554 / ok |
| Functional classification (CRS) | `/CHhighway/CRS_Functional_Classification/FeatureServer/0` | 2024-07-03 | RouteID, F_System (1 to 7), County_label, Caltrans_District | 200 / 3506 / ok |
| All public roads network | `/CHhighway/All_Roads/FeatureServer/0` | 2026-06-29 | RouteId, LRSFromDate (no name or class) | 200 / 3754 / ok |
| National Highway System (California) | `/CHhighway/National_Highway_System/FeatureServer/0` | LRS export 2023-07-18 | RouteID, NHS_TYPE | 200 / 15 / ok |
| AADT, traffic volumes (points) | `/CHhighway/Traffic_AADT/FeatureServer/0` | 2026-09-29. Count year not stated in the layer `[VERIFY]` | DISTRICT, RTE, CNTY, PM, DESCRIPTION, BACK_AADT, AHEAD_AADT, BACK_PEAK_HOUR, AHEAD_PEAK_HOUR | 200 / 41 / ok |
| Truck AADT (points) | `/CHhighway/Truck_Volumes_AADT/FeatureServer/0` | 2026-02-26. EST_YEAR is a two-digit year per record and ranges from the 1970s to 24 | RTE, POSTMILE, VEHICLE_AADT_TOTAL, TOT_TRK_AADT, TRK_PERCENT_TOT, TRK_5_AXLE, EST_YEAR | 200 / 22 / ok |
| Truck network | `/CHhighway/Truck_Network/FeatureServer/0` | not in catalog | RT, DESIG (A, CL, NN, TA, blank), KPRA, RESTR_TYPE, SP_RESTR | 200 / 2 / ok |
| Caltrans districts | `/CHboundary/District_Tiger_Lines/FeatureServer/0` | 2023-03-22 | DISTRICT, Region | 200 / 1 / ok |
| MPO boundaries | `/CHboundary/MPO_Boundaries/FeatureServer/0` | 2025-08-13. Description says the MPO list is "current as of February 2013" | MPO, ABBREVATION, MPO_ID | 200 / 1 / ok |
| RTPA boundaries | `/CHboundary/RTPA_Boundaries/FeatureServer/0` | 2025-08-13. Feature class named RTPA_2013 in the description | RTPA, LABEL_RTPA | 200 / 2 / ok |
| County boundaries (Caltrans copy) | `/CHboundary/County_Boundaries/FeatureServer/0` | 2026-09-28. 2010 Census fields | NAME10, GEOID10, CO_CODE, DISTRICT | 200 / 2 / ok |
| California transit routes (Cal-ITP) | `/CHrailroad/CA_Transit_Routes/FeatureServer/0` | 2026-08-20 | agency, route_id, route_name, route_type, n_trips, shn_route, district_n | 200 / 51 / ok |
| California transit stops (Cal-ITP) | `/CHrailroad/CA_Transit_Stops/FeatureServer/0` | 2026-08-20 | agency, stop_id, stop_name, n_routes, route_ids_served, n_arrivals, n_hours_in_service | 200 / 164 / ok |
| High quality transit stops | `/CHrailroad/CA_HQ_Transit_Stops/FeatureServer/0` | 2026-08-20 | agency_primary, hqta_type, hqta_details, avg_trips_per_peak_hr, mpo | 200 / 20 / ok |
| High quality transit areas | `/CHrailroad/CA_HQ_Transit_Areas/FeatureServer/0` | 2026-08-20 | not query-tested | listed in catalog |

Also listed and not query-tested: `CHhighway/Express_Lanes`, `HOV`, `Park_and_Ride`, `State_Highway_Bridges`, `Local_Bridges`, `Bottlenecks`, `Regional_Transportation_Grants`, `CHboundary/Adjusted_Urban_Area` (2020), `CHrailroad/California_Rail_Network`, `Highway_Rail_Crossing`, `Speeds_by_Stop_Segments`, `SB1/BuildingCA_Projects`.

Cal-ITP bulk downloads on data.ca.gov (CKAN records `california-transit-routes`, `california-transit-stops`, licence Creative Commons Attribution, modified 2026-10-01):
- Routes GeoJSON: `https://gis.data.ca.gov/api/download/v1/items/dd7cb74665a14859a59b8c31d3bc5a3e/geojson?layers=0`
- Stops GeoJSON: `https://gis.data.ca.gov/api/download/v1/items/900992cc94ab49dbbb906d8f147c2a72/geojson?layers=0`
- The download URLs come from the CKAN record and were not fetched. The REST layers above were tested.

### Caltrans bikeways (Class I to IV)

- **Statewide layer: none found.** NOT VERIFIED on 2026-10-01 because no endpoint exists to test. The Caltrans catalog and the `CHhighway`, `CHhqsafe`, `HQstatewide` folders hold no statewide bikeway class layer.
- Orange County only: `https://caltrans-gis.dot.ca.gov/arcgis/rest/services/D12/D12_Park_and_Ride/FeatureServer/0` ("D12 OC Bikeways", source OCTA, 2023-02-02). Metadata 200, geojson ok. Fields: City, Class_Type, Status, Street.
- Bicycle and pedestrian miles traveled points: `/CHhqsafe/BPMT/FeatureServer/0` (200 / 41119 / ok. Fields: trips_Walk, TRIPS_BIKE, PMT, BMT. No description on the service).
- For the Sacramento region use SACOG Existing Bikeway (section 9).

### Caltrans Transportation Equity Index (EQI)

Publisher: Caltrans. ArcGIS Online org `services1.arcgis.com/8CpMUd3fdw6aXef7`, owner Henry.McKay. Version 1.0, 2020 census blocks. maxRec 1000. No licence stated. `[VERIFY]`

| Layer | URL | Test |
|---|---|---|
| EQI 1.0, all blocks | `https://services1.arcgis.com/8CpMUd3fdw6aXef7/arcgis/rest/services/EQI_VERSION_1_0_BLOCKS/FeatureServer/0` | 200 / 2058 / ok. Item modified 2025-12-11 |
| Transportation-Based Priority Populations screen | `https://services1.arcgis.com/8CpMUd3fdw6aXef7/arcgis/rest/services/EQI_Transportation-Based_Priority_Populations_Screen/FeatureServer/0` | 200 / 76 / ok. Item modified 2026-07-22 |
| Underserved Communities screen | `https://services1.arcgis.com/8CpMUd3fdw6aXef7/arcgis/rest/services/EQI_Underserved_Communities_Screen/FeatureServer/0` | 200 / 268 / ok. Item modified 2026-07-22 |

- Key fields: GEOID20, POP20, TBPP_SCREEN, UNDERSERVED_COMMUNITY_SCREEN, TRAFFIC_EXPOSURE_SCREEN, ACCESS_TO_DESTINATIONS_SCREEN, DEMOGRAPHIC_OVERLAY_SCREEN, LOW_INCOME_INDICATOR, TRIBAL_LAND_INDICATOR, crash_percentile_local, PED_RATIO, BIKE_RATIO, TRANSIT_RATIO_JOBS.
- File geodatabase items: `EQI_VERSION_1_0_BLOCKS_2026` (item `8b1af98da1ad4263857bf458353fd816`, 2026-03-24) and `EQI_VERSION_1_0_SpatialData` (item `f63a37898e8a4a40b2c975bc046a96c3`). Download not tested. The Caltrans FAQ says the download needs an ArcGIS Online sign-in.
- Web map: `https://caltrans.maps.arcgis.com/apps/webappviewer/index.html?id=ab02f124b3f54007a59dadf2165d21fc`
- Do not confuse with `caltrans-gis.dot.ca.gov/.../CHhqcore/Livability/FeatureServer/0` ("EQI Tool Overall Opportunity", tract level, copyright 2022). It responds (200 / 43 / ok) but is an earlier tract-level product.

---

## 7. California: equity and environmental screens

| Dataset | Publisher | URL | Vintage | Key fields | Test |
|---|---|---|---|---|---|
| CalEnviroScreen 4.0 results | OEHHA | `https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/CalEnviroScreen_4_0_Results_/FeatureServer/0` | October 2021, 2010 tracts | tract, CIscore, CIscoreP, PollutionP, PopCharP, trafficP, dieselP, povP, ACS2019TotalPop | 200 / 43 / ok |
| CalEnviroScreen 5.0 results (final) | OEHHA | `https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/calenviroscreen50results_F_070126_gdb/FeatureServer/2` | final released 2026-07-01, 2020 tracts. Layer id is 2, not 0 | tract, county, Population, CIscore, CIscoreP, Pollution_Pctl, PopCharPctl, Traffic_Pctl, Diesel_PM_Pctl, Poverty_Pctl, DiabetesPctl, SmATS_Pctl | 200 / 46 / ok |
| SB 535 DACs, 2026 designation, tracts | OEHHA for CalEPA | `https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/SB_535_Disadvantaged_Communities_2026/FeatureServer/0` | CalEPA final designation, September 2026 | tract, dac_type ("CES 5.0 Top 25%", "CES 5.0 High Pollution/Low Population", "CES 4.0 Carry-Over DAC"), county, CIscoreP, PollutionP, ACS2024Pop | 200 / 0 in test bbox, 79 in Sacramento bbox, 2704 statewide / ok |
| SB 535 2026, tribal layers | same service | layers `/1` (BIA tribal boundaries), `/2` (consultation tribal boundaries), `/3` (BAS tribal boundaries) | same | not query-tested | listed in service |
| SB 535 DACs, 2022 designation, tracts | OEHHA for CalEPA | `https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/SB535_DACupdate20232024/FeatureServer/1` | 2022, tribal update 2024. Layer 0 is federal tribal areas, layer 2 is added tribal areas | Tract, DAC_category, CIscoreP, County, ApproxLoc | 200 / 0 in test bbox, 60 in Sacramento bbox, 2310 statewide / ok |
| CCI Priority Populations 5 (DAC, AB 1550 low-income, half-mile neighbors) | CARB | `https://gis.carb.arb.ca.gov/hosting/rest/services/Hosted/PriorityPopulations5/FeatureServer/0` | uses CalEPA 2026 DAC designation and HCD revised 2026 State Income Limits | tract, designation, designation_detail, ces_dac, tribal_dac, low_income, neighbor, notpp | 200 / 48 / ok |
| CCI Priority Populations 4.0 | CARB | `https://gis.carb.arb.ca.gov/hosting/rest/services/Hosted/CCI_Priority_Populations_4/FeatureServer/0` | CES 4.0 based | tract, designatio, geography | 200 / 43 / ok |
| Healthy Places Index, API | Public Health Alliance of Southern California | `https://api.healthyplacesindex.org/` | API serves 2020 geographies only as of 2026-06-24 (stated on the API page) | key from an account on the HPI map | NOT VERIFIED on 2026-10-01 for data. `/api/hpi` without a key returned HTTP 400 "Missing required query parameters". Documentation page 200 |
| Healthy Places Index 3.0, SACOG region copy | SACOG | `https://services.sacog.org/hosting/rest/services/DAC/Healthy_Places_Index_3_0_SACOG/FeatureServer/0` | HPI 3.0 on 2020 tracts, item modified 2026-05-12 | GEOCODE, hpi, hpi_pctile, hpi_quartile, hpi_least_healthy_25pct, transportation_pctile, automobile_pctile, commute_pctile | 200 / 47 / ok |

- `designation` values in PriorityPopulations5: "Disadvantaged community", "Disadvantaged community, Low-income community", "Low-income community", "DAC 1/2-mile neighbor, Low-income community", "DAC 1/2-mile neighbor, Not a priority population area", "Not a priority population area". Filter on "Low-income community" for AB 1550 low-income communities. Low-income households qualify statewide and are not mapped.
- The test bbox (south Placer County) has no SB 535 tract in either designation. The Sacramento bbox used to confirm the query works was -121.6, 38.4, -121.3, 38.7.
- CalEPA designation page: `https://calepa.ca.gov/programs/dac2026/` (200). It is headed "Final Designation of Disadvantaged Communities, September 2026".
- Check each grant program's guidelines for which designation year applies. Programs adopted before September 2026 may still cite the 2022 designation.
- No licence text on the OEHHA or CARB layers. State agency data. `[VERIFY]`

---

## 8. California: schools, crashes, fire, boundaries, open space

### CDE public schools

| Dataset | URL | Vintage | Key fields | Test |
|---|---|---|---|---|
| California Public Schools | `https://services3.arcgis.com/fdvHcZVgB2QSRNkL/arcgis/rest/services/SchoolSites2425/FeatureServer/0` | 2024-25, item modified 2026-05-19 | CDSCode, SchoolName, DistrictName, SchoolType, SchoolLevel, Status, GradeLow, GradeHigh, Charter, EnrollTotal, FRPMpct, SEDpct, TitleIStatus | 200 / 54 / ok |
| School district areas | `https://services3.arcgis.com/fdvHcZVgB2QSRNkL/arcgis/rest/services/SchoolDistrictAreas2425/FeatureServer` | 2024-25 | not query-tested | found in ArcGIS Online search |

Publisher: California Department of Education. Filter `Status='Active'` before mapping. No licence stated. `[VERIFY]`

### Crash data

| Source | URL | Access | Test |
|---|---|---|---|
| CCRS (CHP), CKAN record | `https://data.ca.gov/api/3/action/package_show?id=ccrs` | Open, no login. Licence "Other (Public Domain)". Years 2016 to 2026. Three tables per year: Crashes, Parties, InjuredWitnessPassengers. 2017 to 2026 files refreshed 2026-10-02 UTC | 200 |
| CCRS Crashes 2024, datastore | `https://data.ca.gov/api/3/action/datastore_search?resource_id=f775df59-b89b-4f82-bd3d-8807fa3a22a0&limit=1` | Open | 200, total 417,158 records |
| CCRS Crashes 2024, SQL | `https://data.ca.gov/api/3/action/datastore_search_sql?sql=SELECT COUNT(*) AS n FROM "f775df59-b89b-4f82-bd3d-8807fa3a22a0" WHERE "Longitude" BETWEEN -121.30 AND -121.10 AND "Latitude" BETWEEN 38.75 AND 38.90` | Open | 200, n = 1,196 in the test bbox |
| CCRS Crashes 2024, CSV | `https://data.ca.gov/dataset/80c6a49d-c6b3-40ba-86d8-379c9741b4be/resource/f775df59-b89b-4f82-bd3d-8807fa3a22a0/download/crashes_2024.csv` | Open | URL from CKAN record, not downloaded |
| TIMS (UC Berkeley SafeTREC) | `https://tims.berkeley.edu/tools/query/` | **Free account login required.** No public API | Home page 200. Query tool returns 302 to `/login.php` |
| SACOG regional collisions (TIMS-geocoded SWITRS) | `https://services.sacog.org/hosting/rest/services/Transportation/Collision_SACOG_Region/FeatureServer/0` | Open | 200 / 7214 / ok |

- CCRS resource ids for other years: Crashes_2025 `9f4fc839-122d-4595-a146-43bc4ed16f46`, Crashes_2023 `436642c0-cd04-4a4c-b45e-564b66437476`, Crashes_2022 `7828780b-117b-455e-9275-986ad3ffde50`, Crashes_2021 `d08692e2-6d36-487e-bca0-28cd127a626f`, Crashes_2020 `a2e0605d-0695-4bce-806d-4d0dda7ace68`, Crashes_2026 `b8ce0ca4-b4e9-490d-b4d1-1f4ec48cbefb`. Parties and injured-person tables have their own ids in the CKAN record.
- CCRS crash fields: Collision Id, Crash Date Time, City Name, County Code, Collision Type Description, NumberInjured, NumberKilled, Latitude, Longitude, PrimaryRoad, SecondaryRoad, Primary Collision Factor Violation, PedestrianActionDesc, MotorVehicleInvolvedWithDesc, LightingDescription, IsFreeway, IsHighwayRelated, Is Preliminary. Field names contain spaces and must be double-quoted in SQL.
- **CCRS has no single severity field on the crash table.** It has NumberKilled and NumberInjured. Injury severity by person is in the InjuredWitnessPassengers table. `[VERIFY: field name for injury extent in that table]`
- SACOG collision layer: SWITRS schema. COLLISION_SEVERITY 1 fatal, 2 severe injury, 3 other visible injury, 4 complaint of pain. Also PEDESTRIAN_ACCIDENT, BICYCLE_ACCIDENT, ACCIDENT_YEAR, PRIMARY_RD, SECONDARY_RD. The service description says 2012 to 2025, with 2024 and 2025 provisional.
- A web search result states iSWITRS public access ended 2025-01-08. Not confirmed against a CHP page. `[VERIFY]`
- CCRS coordinates are as reported by officers. Check for null and zero Latitude and Longitude before mapping.

### CAL FIRE fire hazard severity zones

Publisher: CAL FIRE, Office of the State Fire Marshal. Org `services1.arcgis.com/jUJYIo9tSA7EHvfZ`. URLs taken from CAL FIRE's own "Fire Hazard Severity Zone and Local PIO Viewer Map" (web map `dabc3f6d15864f1b9d3d9ff4b0778f55`).

| Layer | URL | Vintage | Key fields | Test |
|---|---|---|---|---|
| FHSZ in State Responsibility Area | `https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSZSRA_23_3/FeatureServer/0` | effective 2024-04-01 | SRA, FHSZ, FHSZ_Description (Moderate, High, Very High) | 200 / 27 / ok |
| FHSZ in Local Responsibility Area | `https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSALRA25_v1_All/FeatureServer/0` | "as Recommended by the State Fire Marshal, 2025" | SRA, FHSZ, FHSZ_Description | 200 / 24 / ok |
| State Responsibility Area | `https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/State_Responsibility_Area/FeatureServer/0` | not stated | not query-tested | listed in the web map |
| Old statewide service | `https://services.gis.ca.gov/arcgis/rest/services/Environment/Fire_Severity_Zones/MapServer/0` | SRA 2007, LRA 2011. Superseded | HAZ_CLASS | 200 / 6 / ok. Do not use for current maps |

The LRA layer holds the State Fire Marshal's recommended zones. Local agencies adopt by ordinance and may add area. Placer County publishes its own: `https://services9.arcgis.com/NENkjkswKTzMfG3A/arcgis/rest/services/FHSZ_2025_Unincorporated/FeatureServer` (not query-tested).

### City and county boundaries

| Dataset | Publisher | URL | Vintage | Key fields | Test |
|---|---|---|---|---|---|
| City and county boundaries (tax jurisdiction lines) | CDTFA | `https://services6.arcgis.com/snwvZ3EmaoXJiugR/arcgis/rest/services/City_and_County_Boundary_Line_Changes/FeatureServer/0` | item modified 2026-09-25 | COUNTY, CITY, COPRI, CDTFA_ID | 200 / 10 / ok |
| California city boundaries and identifiers | California Department of Technology, from CDTFA | `https://services3.arcgis.com/uknczv4rpevve42E/arcgis/rest/services/California_Cities_and_Identifiers_Blue_Version_view/FeatureServer/2` | item modified 2026-03-26. Description says "PRE-RELEASE". Layer id is 2 | CDTFA_CITY, CDTFA_COUNTY, CENSUS_GEOID, CENSUS_PLACE_TYPE, GNIS_ID, CENSUS_POPULATION | 200 / 5 / ok |
| California county boundaries and identifiers | CDT, from CDTFA | `https://services3.arcgis.com/uknczv4rpevve42E/arcgis/rest/services/California_County_Boundaries_and_Identifiers_Blue_Version_view/FeatureServer/1` | item modified 2026-04-30. "PRE-RELEASE". Layer id is 1 | CDTFA_COUNTY, CENSUS_GEOID, GNIS_ID, CDT_COUNTY_ABBR | 200 / 2 / ok |
| Cal OES or state GIS county service | State of California | `https://services.gis.ca.gov/arcgis/rest/services/Boundaries/CA_Counties/FeatureServer` | not stated | not query-tested | service listed in the folder (200). NOT VERIFIED on 2026-10-01 at layer level |

CDTFA copyright text: "California Department of Tax and Fee Administration, GIS and Data Services Section". The CDTFA layer includes unincorporated county remainders as polygons with CITY = "Unincorporated" `[VERIFY value]`. CDT also publishes versions "with Coastal Buffers" that extend offshore. Use the non-buffered views for land maps.

### California Protected Areas Database (CPAD)

| Layer | Publisher | URL | Vintage | Key fields | Test |
|---|---|---|---|---|---|
| CPAD holdings | GreenInfo Network data, hosted by CDFW | `https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/CPAD_Holdings_wm/FeatureServer/0` | CPAD 2026a, June 2026 | UNIT_NAME, SITE_NAME, AGNCY_NAME, AGNCY_LEV, MNG_AGNCY, ACCESS_TYP, ACRES, COUNTY, YR_EST | 200 / 270 / ok |
| CPAD units | GreenInfo Network | `https://services1.arcgis.com/4ZKi1B1zTblbwgWB/arcgis/rest/services/cpad_2024a_unitsgdb/FeatureServer/0` | CPAD 2024a (older) | UNIT_NAME, AGNCY_NAME, ACCESS_TYP, ACRES, LABEL_NAME | 200 / 96 / ok |

Use terms stated on the service: suitable for planning, assessment, analysis and display. Not a basis for regulatory or legal action. Credit "California Protected Areas Database (CPAD), www.calands.org". A 2026a units service was not found. `[VERIFY: check calands.org for a 2026a units or super units service]`

---

## 9. SACOG

Publisher: Sacramento Area Council of Governments. Server: `https://services.sacog.org/hosting/rest/services` (version 11.5, maxRec 2000). Folders: Transportation, MTP_SCS, DAC, Boundary, Census, LandUse, Hosted and others. No licence text on the layers. `[VERIFY: SACOG open data terms at data.sacog.org]`

| Dataset | URL (append to server) | Vintage stated | Key fields | Test |
|---|---|---|---|---|
| Existing bikeway | `/Transportation/Existing_Bikeway/FeatureServer/0` | "Updated annually". Item modified 2026-06-12 | BIKE_CLASS (1, 2, 3, 4), FULLSTREET, Name, Juris, County, Miles | 200 / 1897 / ok |
| Proposed bikeway | `/Transportation/Proposed_Bikeway/FeatureServer/0` | item modified 2025-10-02 | BIKE_CLASS, Class, Status, Name, Juris, County | 200 / 495 / ok |
| Regional trail network | `/Transportation/Sacramento_Regional_Trail_Network_Pub/FeatureServer/0` | not stated | TRAIL_NAME, STATUS, Complete, MILES, PrimAgency, County | 200 / 106 / ok |
| MTP projects (working layer) | `/Transportation/MTP_Projects/FeatureServer/72` | fields reference 2023 MTP and 2025 MTIP. Layer id is 72 | SACtrak_ID, Nom_2022_Description, DS_2035, DS_2050, F2025_MTIP_Type. Contains staff note fields | 200 / 132 / ok |
| MTP/SCS 2025 project lines | `/MTP_SCS/SACOG_MTP_SCS_Projects_2025/FeatureServer/0` | 2025 | not query-tested | service metadata 200 |
| MTP/SCS 2025 project points | `/MTP_SCS/MTP_SCS_Project_point_2025/FeatureServer/0` | 2025 | not query-tested | service metadata 200 |
| STIP projects 2025 | `/Transportation/SACOG_STIP_Projects_2025_Location/FeatureServer/0` | 2025 | not query-tested | service metadata 200 |
| ATP projects | `/Transportation/Active_Transportation_Program_Project/FeatureServer/0` | not stated | Title, agency, cycle, award, amounts, description | 200 / 2 / ok |
| Regional transit routes | `/Transportation/Regional_Transit_Routes/FeatureServer/0` | source: National Transit Map | agency, route_id, route_name, route_type, n_trips, ServiceDay | 200 / 40 / ok |
| Regional centerline | `/Transportation/SACOG_Regional_Centerline/FeatureServer/0` | "updated yearly" | FULLSTREET, CLASS, ROAD_CLASS, ONEWAY, CITYLEFT, COUNTY_LEFT | 200 / 9260 / ok |
| Collisions | `/Transportation/Collision_SACOG_Region/FeatureServer/0` | 2012 to 2025 | see section 8 | 200 / 7214 / ok |
| Equity Priority Communities | `/DAC/Equity_Priority_Community/FeatureServer/0` | block groups, not dated | GEOID, EPC_SELECTED, EPC_Score, EPC_RankbyCounty, Income, Race, Disability | 200 / 24 / ok |
| Healthy Places Index 3.0 | `/DAC/Healthy_Places_Index_3_0_SACOG/FeatureServer/0` | see section 7 | hpi_pctile | 200 / 47 / ok |

For a published RTP project map, prefer the `MTP_SCS/..._2025` layers. `Transportation/MTP_Projects` layer 72 carries internal review notes. Also listed and not tested: `Transportation/Existing_Major_Transit_Stops`, `Transportation/High_Capacity_Transit`, `Transportation/SACOG_Park_And_Ride`, `Boundary/City_Boundary`, `Boundary/SACOG_Planning_Area`, `Boundary/Transportation_Analysis_Zone_2021`, `Hosted/AADT_2024`.

---

## 10. Placer County

Publisher: Placer County. Open data catalog: `https://gis-placercounty.opendata.arcgis.com/api/feed/dcat-us/1.1.json` (200, 67 datasets). Layers at `https://services6.arcgis.com/PArfeTGcwA9RGNzN/arcgis/rest/services`. Licence text in the catalog is an "as is", no-warranty disclaimer. It states no reuse restriction.

| Dataset | URL (append to services6 base) | Modified | Key fields | Test |
|---|---|---|---|---|
| Roads | `/Roads/FeatureServer/0` | 2026-04-09 | FULLSTREET, ROAD_CLASS, SPEED_LIMIT, ONEWAY, DIVIDED, CITYLEFT | 200 / 9284 / ok |
| City boundaries | `/City_Boundaries/FeatureServer/0` | 2026-10-01 | CITY, CITY_CODE | 200 / 6 / ok |
| Public parcels | `/Public_Parcels/FeatureServer/0` | 2026-09-03 | Apn, Acres, SitusAddressFull | 200 / 65493 / ok |
| Zoning | `/Zoning_OpenData/FeatureServer/0` | 2026-10-01 | ZONING, ZONE_CODE, ZONE_DESC, ZONING_GENERAL, COMMUNITY_PLAN_AREA | 200 / 256 / ok |
| General plan and community plan land use | `/General_Plans_Community_Plans/FeatureServer/0` | 2026-10-01 | LU_DESIGNATION, COMMUNITY_PLAN_AREA, PLAN_DESC | 200 / 132 / ok |
| Transit bus stops | `/TransitBusStops/FeatureServer/0` | 2022-01-19 (old). maxRec 1000 | LOCATION, ROUTE, DIRECTION | 200 / 80 / ok |
| Railroad | `/Railroad/FeatureServer/0` | 2026-05-12. maxRec 1000 | NAME | 200 / 22 / ok |
| County boundary | `/County_Boundary/FeatureServer/0` | 2023-04-18 | not query-tested | listed in catalog |
| Traffic fee boundaries | `/TrafficFeeBoundaries/FeatureServer/0` | 2023-03-02 | not query-tested | listed in catalog |

A second Placer org (`https://services9.arcgis.com/NENkjkswKTzMfG3A/arcgis/rest/services`, 221 services) holds `Placer_County_Maintained_Roads` (200 / 780 / ok, but field names are truncated to `Placer_C_1` and so on), `Placer_County_Transit_Shapefiles_2024`, `Infrastructure_Projects_PUBLIC`, `Placer_City_Boundaries`, and FHSZ layers. Only the maintained roads layer was tested.

The old `maps.placer.ca.gov` and `gis.placer.ca.gov` ArcGIS Server addresses: NOT VERIFIED on 2026-10-01 (no response).

---

## 11. Recipe: query any ArcGIS REST layer with paging

Tested end to end on Placer County Roads: 5 pages (2000, 2000, 2000, 2000, 1284), total 9,284, equal to the `returnCountOnly` result.

**Step 1. Read the layer metadata.**

```
GET {layer}?f=json
```

Read these keys:
- `maxRecordCount`: the most features one response returns (1000, 2000, or 100000 for TIGERweb).
- `supportedQueryFormats`: must contain `geoJSON` to use `f=geojson`. If it lists only `JSON`, request `f=json` and convert Esri JSON yourself (rings to Polygon, paths to LineString).
- `advancedQueryCapabilities.supportsPagination`: must be true to use `resultOffset`. If false, page by object id (step 5).
- `fields`, `geometryType`, `objectIdField` (or the field of type `esriFieldTypeOID`).
- An `error` key with code 499 means a token is required. Code 400 "layer not found" means the layer id is wrong. Read `{service}?f=json` and use the ids in `layers`. Ids are not always 0 (examples above: 2, 1, 72).

**Step 2. Count first.**

```
GET {layer}/query?where=1=1
    &geometry=-121.30,38.75,-121.10,38.90
    &geometryType=esriGeometryEnvelope
    &inSR=4326
    &spatialRel=esriSpatialRelIntersects
    &returnCountOnly=true&f=json
```

`geometry` is xmin,ymin,xmax,ymax in the `inSR` coordinate system. Without `inSR`, the server assumes the layer's own spatial reference (often 3857 or a State Plane zone) and returns zero.

**Step 3. Page.**

```
GET {layer}/query?where=1=1
    &geometry=...&geometryType=esriGeometryEnvelope&inSR=4326
    &spatialRel=esriSpatialRelIntersects
    &outFields=FIELD_A,FIELD_B        (or *)
    &outSR=4326
    &orderByFields=OBJECTID           (stable order across pages)
    &resultOffset=0
    &resultRecordCount=2000           (at most maxRecordCount)
    &f=geojson
```

Loop: add the number of features received to `resultOffset` and repeat. Stop when the response lacks `exceededTransferLimit: true` or returns zero features. In GeoJSON responses the flag appears at the top level on ArcGIS Online and under `properties` on some ArcGIS Server versions. Check both. As a second check, stop when the running total equals the count from step 2.

**Step 4. Python.**

```python
import json, urllib.parse, urllib.request

UA = {"User-Agent": "GIS2-maps/0.1 (contact email)"}

def get(url, params):
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def fetch_layer(layer, bbox=None, where="1=1", out_fields="*"):
    meta = get(layer, {"f": "json"})
    if "error" in meta:
        raise RuntimeError(meta["error"])
    page = meta.get("maxRecordCount", 1000)
    if "geojson" not in meta.get("supportedQueryFormats", "").lower():
        raise RuntimeError("layer does not support f=geojson")
    oid = next(f["name"] for f in meta["fields"] if f["type"] == "esriFieldTypeOID")
    q = {"where": where, "outFields": out_fields, "outSR": 4326,
         "orderByFields": oid, "f": "geojson"}
    if bbox:
        q.update({"geometry": ",".join(map(str, bbox)),
                  "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                  "spatialRel": "esriSpatialRelIntersects"})
    feats, offset = [], 0
    while True:
        d = get(layer + "/query", {**q, "resultOffset": offset, "resultRecordCount": page})
        if "error" in d:
            raise RuntimeError(d["error"])
        got = d.get("features", [])
        feats += got
        more = d.get("exceededTransferLimit") or d.get("properties", {}).get("exceededTransferLimit")
        if not got or not more:
            break
        offset += len(got)
    return {"type": "FeatureCollection", "features": feats}
```

**Step 5. If pagination is not supported.** Request `returnIdsOnly=true&f=json` with the same `where` and `geometry`. Split the returned `objectIds` into chunks of `maxRecordCount` or fewer (100 to 200 keeps the URL short, or send by POST). Query each chunk with `objectIds=1,2,3...&f=geojson&outSR=4326`.

**Other parameters that helped in testing.**
- `returnDistinctValues=true&returnGeometry=false&outFields=FIELD` lists the values of a class field before styling.
- `returnGeometry=false` for attribute-only pulls.
- `geometryPrecision=6` cuts GeoJSON size for 4326 output.
- Large polygon layers (MPO boundaries, urban areas) can time out on bbox queries. Use an attribute `where` (for example `STATE='CA'`) or a point geometry (`geometryType=esriGeometryPoint&geometry=-121.2,38.8`).
- ArcGIS errors arrive with HTTP 200 and an `error` object in the body. Check the body, not the status code.
- MapServer layers (TIGERweb, NFHL) accept the same `/query` parameters as FeatureServer layers.
- ImageServer services (3DEP, NAIP) use `/exportImage` with `bbox`, `bboxSR`, `size`, `imageSR`, `format`, `f=image`.

---

## 12. Keyless ACS tables (Esri Living Atlas)

Added 2026-10-01 after two builds used them. The Census Data API needs a key (section 1). Esri hosts current ACS 5-year tables as public feature layers that need none. Base: `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services`. Layer ids: 0 state, 1 county, 2 tract.

| Table | Service (append `/FeatureServer/2` for tracts) | Fields | Test |
|---|---|---|---|
| Vehicles available (B08201) | `/ACS_Vehicle_Availability_Boundaries` | `B08201_001E` households, `B08201_002E` no vehicle | 200, 6 tracts returned for Winters, CA, 2026-10-01 |
| Median household income (B19049) | `/ACS_Median_Income_by_Race_and_Age_Selp_Emp_Boundaries` | `B19049_001E` | Used in a test build 2026-10-01; not retested here |

- Use as an `arcgis:` source with `fields:` (the layers carry hundreds of columns and time out without it) and `clip: none`.
- The service description and the data vintage can disagree. `[VERIFY]` the vintage against the state value before quoting it, and state the vintage on the figure.
- Terms: Esri Living Atlas terms of use apply in addition to the Census public domain data. `[VERIFY TERMS]` before publishing.
- Other tables follow the same naming pattern; find them by searching ArcGIS Online for "ACS <topic> Boundaries" owned by `esri_demographics`, then run `tgis.py inspect <url> --place "City, ST"`.

## 13. SACOG bikeway field notes

Found during a test build on 2026-10-01: on the Existing Bikeway layer the class is in `BIKE_CLASS` as an integer; on the Proposed Bikeway layer `BIKE_CLASS` is null in places and the class is in `Class` as text. Run `tgis.py inspect` on both before styling. `returnDistinctValues` returns error 400 on these layers.

