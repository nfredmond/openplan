# Pilot Geography Decision — Nevada County, California

**Date:** 2026-03-19
**Decision by:** Bartholomew Hale (COO), confirmed by Nathaniel Ford Redmond (CEO)
**Status:** ACCEPTED
**Backlog item:** P0.2 — Pick pilot geography and study type

---

## Selected geography
**Nevada County, California** — unincorporated county + incorporated cities (Grass Valley, Nevada City, Truckee)

## Primary study type
**County/corridor accessibility and assignment package** (first AequilibraE-backed package per P0.3)

## Fallback smaller geography
**Grass Valley–Nevada City core area** (~SR-49/SR-20/SR-174 triangle) if full county network proves too heavy for first iteration

## Selection rationale

### Manageable network size ✅
- ~650 miles of county/city roads
- Key state routes: SR-49, SR-20, SR-174, I-80 (eastern segment)
- Bounded geography with clear edge conditions (county line)
- Population ~102,000 — rural enough to be fast, urban enough to be interesting

### Available observed data ✅
- **Census/ACS:** block group and tract-level socioeconomic data
- **LODES/LEHD:** employment origin-destination flows
- **Caltrans PeMS/counts:** traffic count stations on state routes
- **SWITRS:** crash data with geocoded points
- **TIGER/NTAD:** road centerline network geometry
- **GTFS:** Gold Country Stage transit routes (if applicable)

### Realistic near-term planning value ✅
- Evacuation route analysis (wildfire corridor planning — Caldor, River, North Complex precedents)
- Tourism traffic patterns (Nevada City, Malakoff Diggins, Tahoe corridor access)
- Complete streets / ATP candidate identification on SR-49 and Brunswick/Mill/Main corridors
- Rural accessibility gaps — distance to services, transit coverage
- Genuine utility for Nevada County Transportation Commission (NCTC) and local agencies

### Reasonable corridor/zone definition effort ✅
- ~15–25 TAZs for county-level analysis
- ~3–5 key corridors (SR-49 N/S, SR-20 E/W, SR-174, I-80 segment, Brunswick Road)
- Centroids and connectors are straightforward — mostly arterial/highway network

### No conflict risk ✅
- Nevada County was NOT a Green DOT Transportation Solutions client
- No former employer IP or data entanglements
- Clean-room demonstration asset

### Brand story ✅
- "We built this tool for our own community first."
- Authentic, place-based, consistent with Nat Ford positioning
- Usable as a portfolio piece and client demo without risk

## First package definition (P0.3)

**Package name:** `nevada-county-accessibility-v1`

**Intended use cases:**
1. Corridor-level accessibility screening (drive-time catchments to services)
2. Assignment-based volume estimates on key state routes
3. Evacuation route capacity analysis (corridor LOS under load)
4. ATP/Complete Streets candidate identification via KPI ranking

**Required inputs:**
- Road network (TIGER centerlines, filtered to county + buffer)
- Zone definitions (Census tracts or custom TAZs, ~15–25 zones)
- Centroid/connector assignments
- Trip generation estimates (LODES employment + Census population)
- Caltrans count data for validation

**Expected outputs:**
- Skim matrices (travel time, distance by period)
- Assignment volumes on network links
- Accessibility KPIs (jobs within 15/30/45 min, services within threshold)
- Corridor-level LOS summaries
- Evidence packet with caveats and calibration status

**Known limitations:**
- No transit assignment in v1 (road network only)
- Trip generation is synthetic/gravity-based, not behavioral
- No time-of-day signal timing; free-flow + BPR capacity-constrained
- Calibration status: uncalibrated until validated against Caltrans counts
- All outputs carry explicit "uncalibrated screening" caveat until validation pass

---

## Next steps
1. Source road network geometry (TIGER via Census Bureau)
2. Define zone boundaries (tract-based TAZs)
3. Build centroid/connector assignments
4. Assemble trip generation tables from LODES/Census
5. Create `nevada-county-accessibility-v1` network package in OpenPlan
6. Run first AequilibraE skim + assignment job through orchestration pipeline
7. Generate first evidence packet
