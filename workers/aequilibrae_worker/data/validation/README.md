# AequilibraE worker — observed-count validation datasets

Count files consumed by `count_validation` (via `VALIDATION_COUNTS_PATH`, default
`nevada_county_priority_counts.csv`). Each station is matched to an assigned model
link by name / link-type / bbox, and modeled daily PCE volume is compared to the
observed AADT. This is a **screening-grade diagnostic** — a sanity check against
observed counts, never a calibration or a validated forecast.

## Files

| File | Stations | Purpose |
|---|---|---|
| `nevada_county_priority_counts.csv` | 5 (3 in the Grass Valley corridor) | The original hand-picked priority validation points. **Unchanged** — the current screening baseline. |
| `nevada_county_aadt_2023_expanded.csv` | 24 | Full corridor AADT set for **calibration work** (a defensible calibration needs many independent counts + a holdout, not 3 points). Not wired into any default run. |
| `nevada_county_aadt_2023_caltrans_raw.geojson` | 26 raw points | The unmodified Caltrans FeatureServer response, as provenance. |
| `el_dorado_aadt_2023.csv` | 27 | **Second-area (non-Nevada) count set**, El Dorado County / Placerville (US-50, SR-49/153/193). Evidence that the whole stack is geo-general: a real dynamic run there calibrated held-out median APE 62.2% → 51.2% with zero code change. Produced via the multi-state count-source registry. |

## Multi-state count sourcing

The screening model is geo-general (any US corridor). Counts come from state DOT
AADT FeatureServers via a small registry — `scripts/modeling/count_sources.py`.
Caltrans (region `CA`) is wired; **adding a state is one registry entry** (its
FeatureServer `/query` URL + a field map), then it fetches automatically:

```bash
workers/aequilibrae_worker/.venv311/bin/python scripts/modeling/build_expanded_aadt_counts.py \
  --fetch-bbox "<minlon,minlat,maxlon,maxlat>" --region CA \
  --db <a built runs/<id>/aeq_project/project_database.sqlite> \
  --out <counts.csv>
```

A single national source (FHWA HPMS) is NOT included — HPMS ships as bulk
per-state shapefiles / functional-system linework, not a clean bbox API, so a
national ingest is a larger follow-up. The per-state FeatureServer path covers
any state that publishes one (most do).

## Source (100% real — nothing synthesized)

Caltrans **Traffic_Volumes_AADT** FeatureServer (2023), the authoritative public
AADT dataset for the state highway network:

```
https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0
```

Every `observed_volume` and coordinate is a real Caltrans count; the raw response
is retained alongside for audit.

## How the expanded set was built

`scripts/modeling/build_expanded_aadt_counts.py` (documented, reproducible):

1. **Fetch** the corridor bbox from the FeatureServer as GeoJSON (query in the
   script header). Deduplicate to unique (route, postmile, description) points.
2. **`observed_volume = max(BACK_AADT, AHEAD_AADT)`** — the mainline (higher-volume)
   segment at each postmile. This rule reproduces all three original hand-picked
   station values exactly (SR-20@Jct49 = 45,500; SR-20@Brunswick = 35,500;
   SR-174@Brunswick = 10,300), validating it against the prior baseline.
   (AADT fields arrive as strings — they are coerced to int before `max`, or
   `"4450" > "13500"` lexicographically.)
3. **Network-derived matching:** for each point the route link is the nearest link
   of the highest road class *plausible for that route* in a built project network
   (SR-20/49 up to motorway; SR-174 is a 2-lane secondary highway, never a freeway
   — a small factual prior that disambiguates SR-174 counts near the SR-20
   junction). Its real OSM name/type become the station's candidate; the
   cross-street from the description is excluded.

Regenerate:

```bash
workers/aequilibrae_worker/.venv311/bin/python scripts/modeling/build_expanded_aadt_counts.py \
  --geojson workers/aequilibrae_worker/data/validation/nevada_county_aadt_2023_caltrans_raw.geojson \
  --db <a built runs/<id>/aeq_project/project_database.sqlite> \
  --out /tmp/regen.csv
```

## Honest baseline (why this matters for calibration)

Validated against run `a4cd08cd`'s assigned volumes (the current **uncalibrated**
block-group model), the expanded set gives a very different — and more honest —
picture than the 3-station priority subset:

| Set | Stations | Median APE | Mean APE | %RMSE | Spearman ρ |
|---|---|---|---|---|---|
| priority (matched) | 3 | 17.3% | — | 29.0 | — |
| expanded (matched) | 24 | ~25–30% | ~30% | ~49 | 0.77 |

Individual mainline links run 50–66% off. So the corridor-wide fit is materially
worse than the cherry-picked 3 suggested, and sits at/above the screening
boundary — which both justifies calibration (real per-link error) and shows there
is signal to calibrate against (ρ 0.77).

## Caveats

- 2 of 26 Caltrans points (Scotts Flat Rd, Newtown/Indian Flat Rds) are rural and
  have no route link within 160 m of the count in the modeled network — excluded,
  not mismatched.
- At multi-route junctions the "correct" model link is genuinely ambiguous on a
  coarse OSM network without route refs; the median APE wobbles a few points with
  the matching rule. Precise count→link assignment is part of the calibration
  harness, not this dataset.
- Candidate names/types were derived against one network snapshot; OSM names are
  stable and `count_validation` re-matches against each run's fresh network.
