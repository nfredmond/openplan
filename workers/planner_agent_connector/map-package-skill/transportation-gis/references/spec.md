# project.yaml reference

One file describes the whole package. `tgis.py build` reads it, fetches and prepares the data, and writes `spec/map_package.json`, which every builder reads. Edit `project.yaml`, never the JSON.

Contents: [project](#project) · [study_area](#study_area) · [layers](#layers) · [sources](#sources) · [style](#style) · [label](#label) · [maps](#maps) · [atlases](#atlases) · [outputs](#outputs) · [extending](#extending)

## project

```yaml
project:
  id: main_st_atp         # lowercase, letters digits underscores; names files and folders
  title: Main Street Active Transportation Plan
  client: Agency Name     # printed on every page; write it the way the agency does
  prepared_by: ""         # optional; empty when the agency is the author
  status: draft           # draft prints "Draft, <month year>"; final prints the date only
  review: ""              # free-text summary of the independent review, printed beside the gate table
  practice: false         # true for practice or hypothetical work: notice on every map, website and README; never a release
  notice: ""              # the practice notice text, for example "Practice exercise. Streets are public data; treatments are hypothetical."
  practice_label: ""      # short text for the stamp on each map face (default "PRACTICE ONLY: includes hypothetical or unverified content")
  date: 2026-10-01
  crs: auto               # auto = State Plane zone at the study area centre, US survey feet; or EPSG:2226
brand:
  accent: "#1f5673"       # title rule, figure label, website accent
basemap:
  buildings: auto         # auto draws building footprints when any map is 1:7,200 or larger; true | false
```

## study_area

Exactly one of `place`, `file`, `bbox`.

```yaml
study_area:
  place: "City, ST"               # city, CDP ("Place Name, ST") or county ("County Name, ST"), from Census TIGERweb
  # file: inputs/corridor.geojson # any GDAL format; optional layer:, where:
  # bbox: [west, south, east, north]        # in degrees
  buffer_mi: 0.25                 # lines and points need this to become an area (default 0.25 when omitted)
  name: Main Street corridor      # label on the regional inset
  legend_label: Study corridor    # legend text for the boundary
```

## layers

A mapping of layer id to definition. The id becomes the table name in `data/project.gpkg`.

```yaml
layers:
  crashes:
    title: Bicycle and pedestrian crashes, 2019 to 2023
    source: {file: inputs/crashes.csv, x: POINT_X, y: POINT_Y, crs: 4326, credit: "Caltrans CCRS, 2019 to 2023"}
    filter: "severity <= 3"                      # expression, see below
    compute: {ksi: "1 if severity <= 2 else 0"}
    fields: [case_id, severity, mode, year]      # keep only these (computed fields are kept too)
    clip: study_area                             # bbox (default) | study_area | none
    geometry: point                              # only needed for mixed-geometry sources
    style: {preset: crash_severity, field: severity}
    label: {field: name}
    opacity: 1.0
    description: "One line for the data dictionary."
    popup: [case_id, severity, year]             # fields shown in the web map pop-up
```

Before writing a `style:`, run `tgis.py inspect <file or layer URL> --place "City, ST"` to see the field names and the values the class field really holds.

`filter` and `compute` take small Python-style expressions over the feature's fields: arithmetic, comparisons, `and`, `or`, `x if cond else y`, and `min max round abs float int str len`. A null input or a divide by zero gives null (the feature is then drawn as "No data"), never zero. Flag fields are often null where you would expect "N"; wrap them: `coalesce(PED_FLAG, 'N') == 'Y'`. Strings concatenate with `+` and conditionals nest. Examples: `"name == 'Grant Avenue'"`, `"aadt >= 10000 and lanes > 2"`, `"no_vehicle / households * 100"`, `"'Pedestrian' if coalesce(ped, 'N') == 'Y' else 'Bicycle'"`.

`clip:` decides how much of the source is kept. `bbox` (default) keeps everything the maps can show, so a regional network continues past the study area as context. `study_area` cuts at the boundary; use it when surrounding data would compete with the subject, and say so in `notes:`. `none` keeps whole features (census tracts).

### sources

| Key | Use | Notes |
|---|---|---|
| `file: path` | Client or agency data in `inputs/` | Any GDAL vector format. CSV points: add `x:`, `y:`, `crs:`. Add `credit:` for the source line, `license:` for the terms, `layer:` and `where:` to pick part of a file |
| `arcgis: url` | Any ArcGIS REST layer (`.../FeatureServer/0`, `.../MapServer/12`) | Fetched for the study area with paging. `where:` server filter, `fields:` to limit columns (faster), `all: true` to ignore the bbox, `credit:`, `license:` |
| `osm: theme` | Draft inventory from OpenStreetMap | `bikeways` (field `bike_class` I to IV), `trails`, `schools`, `hospitals`, `libraries`, `transit_stops`, `signals`, `crossings`, `parks`, `roads` (field `road_class`). The figure notes flag these as unverified |
| `tiger: "Layer name"` | Census boundaries | Layer name as shown in TIGERweb `tigerWMS_Current`, for example `Census Tracts`, `Counties` |
| `acs: {...}` | ACS 5-year table joined to tracts or block groups | `year`, `geography: tract or block group`, `variables: {name: B08201_002E}`. Needs `CENSUS_API_KEY` in the environment. Without a key use an `arcgis` source (see data-sources.md) |
| `gtfs: path or URL` | Transit feed | `gtfs: feed.zip` gives route lines; `gtfs: {feed: feed.zip, part: stops}` gives stops |

Verified endpoints for Caltrans, SACOG, CalEnviroScreen, schools, crashes and more are in `data-sources.md`.

### style

Use a preset, a preset with changes, or a full definition. `tgis.py presets` lists presets.

```yaml
style: {preset: bikeway_class}                                 # as is
style: {preset: bikeway_class, field: CLASS, title: Proposed bikeways,
        override: {dash: [4, 2.5]}, label_suffix: " (proposed)"}   # every class dashed, labels suffixed
style: {preset: choropleth, field: pct_no_vehicle, ramp: purple, classes: 4,
        method: quantile, format: "{:.0f}%", unit_note: "Share of households"}
style: {preset: choropleth, field: ces_pctl, method: manual, breaks: [25, 50, 75], ramp: teal}
style: {preset: flow, field: aadt, format: "{:,.0f}"}          # line width by value
style:                                                         # full definition
  type: categorized
  field: status
  title: Sidewalk condition
  classes:
    - {values: [good, fair], label: "Good or fair", symbol: {color: "#3d8f6b", width: 1.4}}
    - {values: [poor], label: Poor, symbol: {color: "#b0562a", width: 1.8, dash: [3, 1.5]}}
  other_label: Not surveyed
```

Symbol keys, sizes in points at final page size:

| Geometry | Keys |
|---|---|
| line | `color`, `width`, `dash: [on, off, ...]`, `casing`, `casing_width`, `opacity` |
| polygon | `fill` (or `null`), `fill_opacity`, `stroke`, `stroke_width`, `stroke_dash`, `hatch: {angle, spacing, color, width}` |
| point | `marker` (circle, square, triangle, diamond, star, cross, pentagon), `size`, `fill`, `fill_opacity`, `stroke`, `stroke_width` |

Changing part of a preset:
- `class_symbols: {"Class II bike lane": {width: 2.2}}` changes one class, matched by its label or by a data value.
- `override: {...}` changes every class. `class_symbols` is applied after `override`, so the two combine.
- Existing and proposed networks: use `bikeway_class` for existing and `bikeway_class_proposed` for proposed. Each proposed class has its own dash, so the classes separate from each other and from the existing network in grayscale. For other networks, give proposed a dash unlike any existing class.
- Crashes by mode and severity together: the `crash_mode_severity` preset (shape for mode, colour and size for severity). Its comment in `assets/presets/styles.yaml` shows the `compute:` that builds the field.
- A pass or fail test (income below a threshold): `{preset: choropleth, field: mhi, method: manual, breaks: [77067], ramp: ["#7b2d8e", "#efedf5"], format: "${:,.0f}"}` gives two classes, below and at or above.
- `show_counts: true` adds the feature count to each legend label, computed from the data.

Behaviour to know:
- **Draw order inside a layer:** the first class listed is first in the legend and draws on top. List the class that must not be hidden first (fatal crashes, the one qualifying school).
- **Draw order between layers:** polygons draw under lines, lines under points. Within one geometry type the order in the map's `layers:` list decides: first listed is on top. A project line listed first hides a bike lane on the same street; list the corridor last and give it the `corridor_band` preset when the map is about what is on the street.
- Classes with no features are left out of the legend. `keep_empty: true` keeps them.
- Values with no class are drawn gray as "Other or not stated" and listed as a build note. Match the data's values in `values:` or fix the data.
- Graduated classes: `method: quantile | equal`, or `breaks:` for manual. Breaks are rounded to readable numbers. Lower bound included, upper bound excluded.
- Ramps: teal, purple, blue, orange, green, gray, diverging. Red is kept for crash severity.

### label

```yaml
label: name                                   # field name only
label: {field: name, size: 6.8, weight: medium, wrap: 16, color: "#1f2d35", halo: 1.1}
label:                                        # several classes
  - {field: name, where: "\"type\" = 'school'", size: 7}
  - {field: ref, where: "\"type\" = 'stop'", size: 6}
```

Keys: `field`, `size`, `weight` (regular, medium, semibold, bold), `italic`, `color`, `halo`, `upper`, `wrap` (characters), `priority` (0 to 10), `placement` (curved, line, point, polygon; default by geometry), `repeat_in`, `where` (SQL), `min_size_mm`, `only_below_scale`, `number`.

- A layer with a numbered key is clipped to the study area unless you set `clip:` yourself, because the key lists every feature.
- **Numbered key** for crowded points: `label: {field: SchoolName, number: true}` numbers the features north to south, prints the number beside each symbol and lists number and name under the legend (`key_title:` on the layer sets the list heading). The label engine drops names that collide; numbers almost always fit. Use it when more than about six named points share a map.
- **Labels only on detailed maps:** `only_below_scale: 12000` shows the labels on maps and map book sheets at 1:12,000 or larger and hides them on overviews.
- A project or corridor line should carry its own name: `label: {field: name, weight: semibold}`.

## maps

```yaml
maps:
  - id: fig03_crashes            # file name
    figure: Figure 3             # printed label; omit for an unnumbered figure
    title: Bicycle and Pedestrian Crashes
    subtitle: 2019 to 2023
    page: letter-landscape       # letter, legal, tabloid, arch-c, arch-d, arch-e, a4, a3, slide + -landscape or -portrait
                                 # figure-6.5x4.5 = report figure, inches; [w, h] also works
    template: auto               # auto | sidebar | banner | figure
    layers: [crashes, schools, bikeways]   # top layer first, like a legend
    extent: study_area           # or {layer: corridor} | {bbox: [w, s, e, n]} | {center: [lon, lat], scale: 6000}
    scale: 12000                 # optional fixed scale; otherwise the next round scale that fits
    notes: "Text printed beside the legend."
    sources: ["Caltrans CCRS, 2019 to 2023"]   # added to the layers' own credits
    alt: "One sentence that says what the map shows."   # required; QA fails without it
```

Layer entries may be a mapping to change one use: `{id: crashes, where: "\"year\" >= 2021", legend_label: "Crashes since 2021", opacity: 0.8, legend: false, labels: false}`. With `where:`, the legend lists only the classes that pass the filter.

Extent options: `extent: study_area_main` frames the largest part of a study area that has small detached parcels. Figures that sit side by side in a document should share a scale: set the same `scale:` and `extent:` on each.

`render --only id1 id2` rebuilds the named figures only.

Other map keys: `place_labels: false` (hide city and neighbourhood names when they land on the data), `type_scale: 1.3` (enlarge all type and symbols on this page), `inset: false` (no locator), `mask: false` (do not dim outside the study area), `boundary: false`, `quiet_base: true` (thin the base map), `basemap: false` (thematic layers only), `pad: 0.07`, `legend_columns: 3` (banner), `keep_order: true` (draw exactly in listed order), `legend_study_area: false`, `corners: {furniture: br, inset: tl, legend: tr}` (override the automatic placement).

Templates:
- **sidebar** (landscape default): map at left; title, legend, notes and locator inset in a right-hand column.
- **banner** (portrait default): title across the top, legend in columns under the map, inset over an empty corner.
- **figure** (`figure-WxH` pages): map on top, legend in columns under it, then one footer row with the north arrow, scale bar, draft status, `notes:` and the sources. A DRAFT tag sits on the map face while the status is draft. No title block: the report supplies the figure number and caption. Legend rows and footer lines take height from the map, so keep `notes:` short, and give figures that must share a scale the same `scale:` (otherwise a longer footer on one of them changes its scale). `legend_columns:` sets the column count. Do not set `type_scale` below 0.95 on a figure; QA fails type under 5.5 pt.

The north arrow and scale bar sit under the map frame on every template, and legends sit beside or under it. Only the banner template's locator inset overlays the map; it goes to the corner with the least mapped data.

`stamp: "[PROJECT LIMITS TO BE ADDED]"` prints a boxed line on the map face, top left. Use it for placeholders the reader must not miss.

Text that does not fit is cut with "..." and QA fails the figure, so nothing disappears silently. Shorten the text.

Pages of 18 inches or more on the short side (`arch-c`, `arch-d`, `arch-e`) are treated as wall posters: type and symbols grow in full proportion to the page (title about 46 pt on arch-d). Raise it further with `type_scale: 1.2` if the legend still fits. See "Posters" in cartography.md.

## atlases

A map book: one base map repeated over index sheets, exported as one PDF.

```yaml
atlases:
  - id: mapbook_bikeways
    title: Existing Bikeways Map Book
    base_map: fig01_study_area          # layers and styling come from this map
    page: tabloid-landscape
    coverage: {grid: {cols: 3, rows: 2}}          # or {grid: {scale: 6000}}
    # coverage: {layer: districts, name_field: NAME}      # one sheet per feature
    # coverage: {strip: {layer: corridor, length_mi: 0.5}} # sheets along a line, each rotated so the line runs left to right
```

Each sheet has a sheet index inset with the current sheet highlighted, and each sheet is also exported as a layered SVG in `atlas/svg/`.

A map book starts as a copy of its base map. Any map key set on the atlas replaces the base map's: `layers:` (for example to turn labels on for the sheets), `notes:`, `subtitle:` (default is the sheet name; `{page_name}`, `{page_number}` and `{page_count}` are filled in per sheet), `legend_study_area: false`, `template:`, `alt:`.

The legend is the same on every sheet, so list in the atlas only layers that appear on most sheets.

To show the sheet outlines on an overview figure, add the layer id `atlas_<atlas id>_index` to that map's `layers:`.

Strip sheets: `length_mi` is the least corridor length per sheet. The scale is then rounded to a standard scale, so sheets usually cover more and the book has fewer sheets than length divided by `length_mi`. For an exact scale use `strip: {layer: corridor, scale: 2400}`. The legend is the same on every sheet (see above); there are no match lines.

A strip book needs a single line to follow. `tgis.py corridor <project> --street "Main Street" --place "City, ST"` writes `inputs/corridor.geojson` from OpenStreetMap (one line along one carriageway; check it on a map and trim to the study limits). Use it as a `file` source and as `study_area: {file: inputs/corridor.geojson, buffer_mi: 0.5}`.

## Placeholders, review gates and release

Anything not yet known stays visible in square brackets: `[VERIFY: ACS vintage]`, `[CLIENT: project limits]`, `[ALT TEXT NEEDED]`, `[MEETING DATE TO BE ADDED]`. Use them in titles, notes, labels and `stamp:`. They block a release.

Review gates are recorded per project in `review.json` (written by `tgis.py attest`, never by hand): `data`, `cartography`, `qgis`, `arcgis`, `illustrator`, `google_earth`, `browser`. Each record holds the reviewer, date, note, evidence files (copied to `review_evidence/` with their hashes) and a fingerprint of the figures. If a figure changes afterwards, the gate reads "stale" until it is reviewed again. The gate table is printed in the README and on the website.

`tgis.py build <project> --release` writes `RELEASE.txt` only when every gate has passed on the current figures, no placeholder remains, `status: final` and `practice` is false. Otherwise it builds a review package (`REVIEW_PACKAGE.txt` lists what is open).

## Rebuilding from the package

Each package carries `source/` (project.yaml, inputs, every original download with `provenance.json`) and `tools/` (the kit). `python3 tools/transportation-gis/scripts/tgis.py build source --offline` rebuilds it with no network. `tgis.py rebuild-check <package>` does that in a scratch copy and compares every PNG; `tgis.py verify <package>` checks an extracted package against `MANIFEST.sha256`. Supplied files that may not be redistributed must not be in `inputs/` when you build a package for transfer; say so in the report.

## outputs

Default is everything: `[pdf, png, svg, atlas, web, kmz, qgis, arcgis, illustrator, zip]`. List fewer to skip some. `svg` writes two files per figure: live type in `maps/svg` and type converted to outlines in `maps/svg_outlined`. The source archive, kit copy and rebuild check are always included (`--no-rebuild-check` skips the check while iterating).

## extending

- **New preset:** add an entry to `assets/presets/styles.yaml`. It is available to every project at once.
- **New data need the sources do not cover** (a spatial join, a network analysis, a buffer): write the result to a GeoJSON or GeoPackage in `inputs/` with your own script and use a `file` source. Keep the script in the project folder and name it in `description:`. `scripts/tgis/vec.py` has read, clip and write helpers on GDAL; `uv run --with geopandas` works for heavier analysis.
- **New page design:** templates live in `scripts/tgis/layout.py` (`build`). A template returns positions in inches; both GIS builders place from those numbers.
