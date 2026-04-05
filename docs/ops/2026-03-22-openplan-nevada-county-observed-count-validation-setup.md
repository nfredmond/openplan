# OpenPlan Nevada County Pilot — Observed-Count Validation Setup

**Date:** 2026-03-22  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Status:** Validation setup / runbook for the canonical OSM run bundle  
**Canonical run:** `run_id 1de72401-4bb7-4377-a1c0-bbb7381a8f95`

## 1) Scope anchor

This runbook is explicitly tied to the current canonical Nevada County OSM screening run bundle:
- `data/pilot-nevada-county/run_output/evidence_packet.json`
- `data/pilot-nevada-county/run_output/state_1de72401.json`
- `data/pilot-nevada-county/run_output/link_volumes.csv`
- `data/pilot-nevada-county/run_output/top_loaded_links.geojson`
- `data/pilot-nevada-county/run_output/demand.omx`
- `data/pilot-nevada-county/run_output/travel_time_skims.omx`

This is a **bounded screening validation slice only**. It does not expand the lane into ActivitySim or broader calibration work.

## 2) Proposed bounded validation slice

### Recommended slice
**Grass Valley core approach bundle** using named, non-connector links already visible in `top_loaded_links.geojson`.

### Why this is the right first slice
- It matches the fallback smaller geography already identified in the pilot geography decision.
- The top-loaded links cluster in one practical validation area rather than across the full county.
- It uses facilities already surfaced by the canonical run, which keeps the first proof step tight.
- It can likely be validated with a small number of Caltrans/local count points.

### Priority facilities from the canonical run outputs
Use these named facilities first:

1. **Golden Center Freeway**
   - link_ids: `3245`, `3293`, `3446`, `3244`, `3294`
2. **Colfax Highway**
   - link_ids: `5836`, `5837`, `5838`
3. **Eric Rood Memorial Expressway**
   - link_ids: `3454`, `3455`
4. **Optional local supplement:** Sierra College Drive
   - link_ids: `1316`, `1315`, `3539`, `3540`, `3541`

### Exclude from observed-count validation
Do **not** use centroid connectors as validation targets:
- `6336`, `6345`, `6350`, `6338`

These are model-loading devices, not observable count stations.

## 3) Exact observed-count data needed

### Minimum viable request
Provide **3 to 5 observed count locations** in the Grass Valley core bundle above, with one row per count location.

### Required fields
- `station_id` or source identifier
- `facility_name`
- `latitude` and `longitude` **or** route/postmile description precise enough to map
- `count_year`
- `count_type` (`AADT`, `ADT`, `average weekday`, etc.)
- `direction` (`two_way`, `AB`, `BA`, or cardinal direction)
- `observed_volume`
- `source_agency`

### Preferred facility priority
1. Golden Center Freeway
2. Colfax Highway
3. Eric Rood Memorial Expressway
4. Sierra College Drive only if local non-state counts are easy to obtain

### Smallest clean request that is still useful
At minimum, request:
- **one count location on Golden Center Freeway**
- **one count location on Colfax Highway**
- **one count location on Eric Rood Memorial Expressway**

That is enough for a first internal go/no-go read on whether the current run has directional screening value in the Grass Valley core.

## 4) Local observed-count input check

### Present locally
The repo already contains the model-side comparison artifacts needed to receive counts:
- `data/pilot-nevada-county/run_output/link_volumes.csv`
- `data/pilot-nevada-county/run_output/top_loaded_links.geojson`
- `data/pilot-nevada-county/run_output/evidence_packet.json`
- `data/pilot-nevada-county/run_output/state_1de72401.json`

### Missing locally
No usable observed-count inputs were found in the local `openplan/` repo scan (excluding `.venv` and `node_modules`).

Specifically, there is **no local file bundle** of:
- Caltrans counts
- PeMS extracts
- AADT tables
- screenline count CSVs
- validation station shapefiles / GeoJSONs

## 5) Crosswalk method from observed counts to model outputs

### Primary comparison files
- Geometry candidate set: `top_loaded_links.geojson`
- Volume lookup: `link_volumes.csv`

### Crosswalk steps
1. **Filter to named, non-connector facilities** in `top_loaded_links.geojson`.
2. **Map each observed count location** to the nearest modeled facility using the count point coordinates or route/postmile.
3. **Snap rule:**
   - accept direct match if clearly on the same named facility,
   - require manual review if the point is near an interchange or split,
   - reject ambiguous matches instead of forcing them.
4. **Join on `link_id`** from the matched `top_loaded_links.geojson` feature to `link_volumes.csv`.
5. Compare observed counts to:
   - `demand_tot` for two-way daily/average daily comparisons,
   - `demand_ab` or `demand_ba` only if observed direction is known and the link orientation has been verified.
6. If a count location represents a **screenline or split mainline section**, aggregate the small set of matched model links that represent the same observed cross-section.
7. Keep a short manual review note for every accepted match:
   - observed station
   - matched facility name
   - matched `link_id` or link set
   - whether comparison is two-way or directional
   - any interchange/junction caveat

### Practical matching rule
For this first slice, prefer **simple two-way facility comparisons** over directional interchange complexity.

That means:
- prioritize count points on stable mainline segments,
- compare to `demand_tot`,
- and avoid ramp/interchange station geometry unless necessary.

## 6) Interpretation rubric

This is a **screening-grade interpretation rubric**, not a calibration certification standard.

### Stronger bounded screening signal
The slice is directionally encouraging if all of the following hold:
- at least **3 usable count locations** are matched cleanly,
- comparisons are on named non-connector facilities,
- the model gets the **general facility ranking/order** right,
- no major facility shows a clearly implausible result relative to observed counts,
- and error magnitude is in a screening-tolerable range.

### Screening-tolerable range for this first slice
Use these as practical decision thresholds:
- **Encouraging / bounded screening-ready candidate:**
  - at least 3 usable count sites,
  - median absolute percent error roughly **<= 30%**, and
  - no critical facility worse than roughly **50%** without an explained boundary/connectivity reason.
- **Internal prototype only:**
  - fewer than 3 usable sites,
  - or rank/order is materially wrong,
  - or median error is materially above **30%**,
  - or one or more core facilities are off by more than **50%** with no narrow, explainable reason.

These thresholds are for **internal ship/no-ship interpretation only**. They do not justify calling the model calibrated.

## 7) What justifies each status label

### Keep status at `internal prototype only` if:
- observed counts are still missing,
- the count-to-link crosswalk is ambiguous,
- fewer than 3 count sites can be matched cleanly,
- or the Grass Valley core comparisons show weak directional credibility.

### Allow `bounded screening-ready` only if:
- the first validation slice is completed on the canonical run,
- at least 3 matched sites are defensible,
- results are directionally credible under the rubric above,
- and all outward language still preserves:
  - uncalibrated,
  - closed-boundary,
  - screening-only,
  - not behavioral demand.

## 8) Minimum clean data request

If counts must be requested, use this exact request shape:

> Please provide a small validation table (CSV is fine) for 3–5 observed traffic count locations in the Grass Valley core, prioritized on Golden Center Freeway, Colfax Highway, and Eric Rood Memorial Expressway. For each count location, include: station_id, facility_name, latitude/longitude or route/postmile, count_year, count_type (AADT/ADT/weekday), direction, observed_volume, and source_agency. For the first validation slice, one clean count point per facility is sufficient.

## 9) Immediate blocker status

**Current blocker:** observed-count inputs are missing locally.  
**What is not blocked:** the model-side comparison framework is already present in the canonical run bundle.  
**Fastest next move:** obtain the 3–5 count rows above and run the bounded comparison without rerunning the model.

## Bottom line

The first ship-oriented validation slice should stay narrow:
- Grass Valley core,
- named non-connector links only,
- 3–5 clean observed count points,
- two-way daily comparison first,
- then an honest gate decision: `internal prototype only` or `bounded screening-ready`.