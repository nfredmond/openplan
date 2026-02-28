# Council Analytics Pack Spec — OpenPlan GIS v1

- **Updated (PT):** 2026-02-28 02:19
- **Owner:** Priya
- **Status:** Draft v1 (concept-level)
- **Methods Version:** `openplan-gis-methods-v0.1`

## Purpose
Define a repeatable GIS output set for leadership/council briefings and decision packages across U.S. municipalities, counties/county-equivalents, tribal governments, regional commissions, and state DOT contexts.

## Required Maps (minimum)
1. Corridor context + nodes map
2. Crossing exposure heat map
3. ADA continuity / gap map
4. Curb-use conflict map
5. Phase 1 pilot block focus maps (2)

## Required Metrics (minimum)
- Severe conflict exposure index (baseline)
- High-comfort crossing opportunity count
- ADA continuity share by core blocks
- Estimated curb conflict hotspot count
- Phase 1 intervention coverage summary

## Metric definition block (required in packet appendix)
For each published metric, include:
- Formula definition
- Unit
- Input layer list
- Data date range
- Caveat/confidence label

### Baseline metric conventions (v1)
- `severe_conflict_exposure_index`: normalized 0–100 risk indicator (higher = worse baseline risk).
- `high_comfort_crossing_opportunity_count`: count of crossings meeting comfort criteria under methods v0.1.
- `ada_continuity_share_core_blocks`: `%` of frontage segments meeting continuity rule in audited core blocks.
- `curb_conflict_hotspot_count`: count of curb segments exceeding conflict threshold.
- `phase1_intervention_coverage_summary`: share of priority conflict locations covered by Phase 1 pilot treatment footprint.

## Output formats
- PDF slide-ready maps
- PNG embeds for briefs
- CSV metric table (with metadata)

### Runtime traceability requirement
Council-bound exports must include source snapshots from analysis output:
- `metrics.sourceSnapshots.census`
- `metrics.sourceSnapshots.lodes`
- `metrics.sourceSnapshots.transit`
- `metrics.sourceSnapshots.crashes`
- `metrics.sourceSnapshots.equity`

Each snapshot must provide `source` and `fetchedAt` at minimum.


## Metadata block (must include)
- Data date range
- Source layers used
- Methods version
- Assumptions / caveats
- Draft status (concept-level vs field-verified)



## Jurisdiction token standard (national)
Use a normalized jurisdiction token in filenames/metadata:
- `city-<slug>`
- `county-<slug>`
- `county-equivalent-<slug>` (parish/borough/municipio/independent-city)
- `tribal-<slug>`
- `rtpa-commission-<slug>`
- `state-dot-<slug>`

`<jurisdiction>` in naming convention should use one of the tokens above.

## Naming convention
`openplan_<jurisdiction>_<corridor>_<artifact>_v<major>_<YYYYMMDD>`

### Artifact type suffixes (required)
- `map_context_nodes`
- `map_crossing_exposure`
- `map_ada_continuity`
- `map_curb_conflicts`
- `map_phase1_blockA`
- `map_phase1_blockB`
- `metrics_table`
- `methods_appendix`

## Mock output bundle path (replication template)
```
openplan/docs/ops/packs/<YYYYMMDD>_<jurisdiction>_<corridor>/
  01_maps_pdf/
    openplan_<jurisdiction>_<corridor>_map_context_nodes_v1_<YYYYMMDD>.pdf
    openplan_<jurisdiction>_<corridor>_map_crossing_exposure_v1_<YYYYMMDD>.pdf
    ...
  02_maps_png/
    openplan_<jurisdiction>_<corridor>_map_context_nodes_v1_<YYYYMMDD>.png
    ...
  03_metrics_csv/
    openplan_<jurisdiction>_<corridor>_metrics_table_v1_<YYYYMMDD>.csv
  04_methods/
    openplan_<jurisdiction>_<corridor>_methods_appendix_v1_<YYYYMMDD>.md
  05_qa/
    qa_log.md
    caveats.md
```



## National disclosure addendum
When a package includes tribal or county-equivalent context, metadata must explicitly list:
- jurisdiction classification,
- governing data authority/source,
- any data sovereignty/availability limitations,
- any state-specific crash-data adapter used.

## Decision-use disclaimer (standard)
“Concept-level planning analytics for direction-setting; not final engineering or construction documents. Metrics and map outputs are preliminary pending field verification and technical refinement.”

## Release gates (must pass before council-facing packet)
1. Canonical layer registry populated for all metrics used.
2. Metric appendix complete with formulas + caveats.
3. QA log shows no unresolved P0 defects.
4. Required metadata block present in every map/table export.
