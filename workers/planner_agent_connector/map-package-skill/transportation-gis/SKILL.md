---
name: transportation-gis
description: Build a client-ready map and GIS package for a transportation planning project from one spec file. Use when the user asks to make, redo, improve or package maps, figures or GIS for a plan, grant application, corridor study or safety plan ("make the maps for this project", "figures for the ATP application", "GIS package", "map book", "strip maps", "set this up for ArcGIS Pro or QGIS", "maps I can edit in Illustrator"), even if they name only the project. Delivers each figure as PDF, PNG and layered SVG, map books, an offline website, Google Earth KMZ, a QGIS project, an ArcGIS Pro builder with agent instructions, an Illustrator kit, QA and a transfer ZIP.
---

# Transportation GIS package

One file, `project.yaml`, describes the study area, data layers, figures and map books. The kit in this skill folder turns it into the whole deliverable, so every output agrees with every other.

`KIT` below means this skill's folder (the one holding this file). Run the kit with the system Python that has the QGIS bindings: `python3 KIT/scripts/tgis.py <command>`. QGIS is the rendering engine; ArcGIS Pro is not needed on this computer.

## Steps

1. **Read first.** The project brief, scope or scoring criteria, the workspace `CLAUDE.md` (voice, client, confidentiality), and any data or earlier maps the user supplied. Decide the figure list from `references/cartography.md` ("Which figures a deliverable needs"). Ask the user only for what cannot be found: which figures, if no criteria or outline says; client-only data; whose voice the pages speak in. State other assumptions and keep going. With nothing to go on: the pages speak as the client agency, status is draft, a corridor study area is one-half mile either side of the street, and anything the user has not supplied (project limits, meeting date) is a visible bracketed placeholder on the page.
   Done when you can name each figure, the layers on it, and where each layer's data comes from.

2. **Set up.** Run `tgis.py doctor`. Work in a `gis/` folder inside the user's project folder: `tgis.py init <project>/gis --place "City, ST"`. Put client files in `gis/inputs/`.
   Done when `doctor` prints "Ready to build" and `project.yaml` exists.

3. **Write `project.yaml`.** Follow `references/spec.md`. Find data in `references/data-sources.md` (read its section list and open only the sections you need; endpoints were tested on the date in that file, so retest one that fails before replacing it). Run `tgis.py inspect <url or file> --place "City, ST"` on each source to see its fields and class values before styling it. `tgis.py presets` lists the symbol presets; prefer a preset over custom symbols so figures stay consistent across projects. A corridor study needs a corridor line: `tgis.py corridor`. Give every map an `alt:` sentence. Use agency data over OpenStreetMap themes whenever it exists; an `osm:` layer is a draft inventory and the map must say so in `notes:`.
   Done when every figure from step 1 is a map entry and every layer has a real source.

4. **Render and look, in a tight loop.** `tgis.py render <project>/gis` builds the data, the QGIS project and the figures. The first run downloads data and can take a few minutes; later runs take well under a minute. Read every PNG in `build/<package>/maps/png/` and every sheet in `atlas/sheets/` with the Read tool and work through the table in `references/review.md`. Change `project.yaml`, rerun with `--only <id> [<id> ...]`, look again. Render the densest figure first; it exposes most problems.
   Done when you have looked at every figure after its last change and none shows a fault from the review table.

5. **Build the package.** `tgis.py build <project>/gis` writes `build/<id>_maps_<date>/` and its ZIP: figures (PDF, PNG, live-type SVG, outlined SVG), map books, a combined figures PDF, website, KMZ, QGIS project, ArcGIS Pro builder, Illustrator kit, documents, QA, plus `source/` (every original download with provenance, `project.yaml`, inputs) and `tools/` (this kit). The build then copies `source/` and `tools/` to a scratch folder, rebuilds there with the network switched off, and compares every PNG. Fix every `FAIL`. Each `NOTE` is a decision for the user (licence terms, values with no class); resolve it (add `license:` to the source once you have read the terms) or carry it into your report. The checks cover files, page sizes, fonts, text, data and reproducibility. They say nothing about whether a map reads well; that is steps 4 and 6.
   Done when the build prints all checks passed, the rebuild check says every PNG is bit-identical, and the ZIP line says "extracted and verified".

6. **Independent review.** Follow "Independent review" in `references/review.md`: a fresh subagent that did not make the maps scores each figure; fix blocking and major items; rebuild. When a round ends with every figure at 85 or more and no blocking or major item open, save the reviewer's report in the project folder and record the gate: `tgis.py attest <project>/gis cartography --reviewer "<who>" --note "<round, scores>" --evidence <report file>`, then rebuild. Otherwise leave the gate pending and report the scores as given, or say the review was not performed. Record only gates whose review actually happened; `arcgis`, `illustrator` and `google_earth` stay pending on this computer.

7. **Hand off and report.** Bottom line first: where the package, `index.html` and the ZIP are; what each figure shows; QA result; review scores; open decisions. State plainly what was not done: the native ArcGIS Pro build (never performed on this computer), the Illustrator script run, a printed proof, client acceptance. For the ArcGIS Pro build, tell the user to move the ZIP to the computer with ArcGIS Pro and give `arcgis/AGENT_PROMPT.md` to the agent or person there. Stop here; do not commit, upload or send the package unless asked.

## When the build report comes back from ArcGIS Pro

Follow "Acceptance of the native ArcGIS Pro build" in `references/review.md`, and read `references/arcgis-pro.md` before editing the builder. Fixes go into `assets/arcgis/build_arcgis_pro.py` in this skill, so the next package ships with them.

## Rules

- `project.yaml` is the source of truth. A change to a map goes there and is rebuilt, so the figures, the QGIS project, the ArcGIS Pro builder and the website stay in agreement. Hand edits inside `build/` are lost on the next build.
- When the kit cannot do something a project needs, extend the kit (a preset in `assets/presets/styles.yaml`, a template in `scripts/tgis/layout.py`, a source in `scripts/tgis/data.py`) and keep the dry run and QA passing. One-off analysis (joins, buffers, scoring) is a script in the project folder that writes a file into `inputs/`.
- Honesty on the page: unverified inventories are labelled, missing values are "No data", schematic lines are labelled schematic, placeholders stay visible (`[ALT TEXT NEEDED]`, `[VERIFY TERMS]`). Details in `references/cartography.md`.
- All text on maps and in documents follows the planner-writing skill when it is installed. Without it: plain words, present tense, the client agency as author, numbers with their source and year, no marketing tone, no rhetorical questions, and no em dashes (QA checks for them).
- Write only inside the project folder. Data that may not be redistributed stays out of the package; say so in the report.
- Every package is a review package until its gates pass. `build --release` labels a release only when all seven gates (data, cartography, qgis, arcgis, illustrator, google_earth, browser) have recorded evidence on the current figures, no bracketed placeholder remains, `status` is final and the project is not marked `practice`. Do not work around the refusal.
- Practice or hypothetical work: set `project.practice: true` and write `project.notice`. Every map face, the website and the README then carry the notice, and the package can never be a release.
- Report the ArcGIS Pro builder as "checked by preflight and a logic dry run, not built in ArcGIS Pro" until a build report from a Pro computer says otherwise.

## Kit map

| Path | What it is |
|---|---|
| `scripts/tgis.py` | Commands: `doctor`, `init`, `inspect`, `corridor`, `render`, `build` (`--offline`, `--release`), `attest`, `verify`, `rebuild-check`, `qa`, `presets` |
| `scripts/tests/test_checks.py` | Breaks a copy of a built package one way at a time and requires the matching check to fail. Run after changing `qa.py`, `review.py` or `package.py` |
| `scripts/tgis/` | Pipeline modules: `resolve` (spec), `data` and `fetch` (sources), `styles`, `layout` (page templates), `qgis_builder`, `web`, `kml`, `illustrator`, `docs`, `qa`, `package`, `review` (gates), `tools` (corridor, inspect), `mock_arcpy` (dry-run stand-in) |
| `assets/arcgis/` | `build_arcgis_pro.py` and `Build_Maps.pyt`, copied into every package |
| `assets/presets/styles.yaml` | Symbol presets: bikeway class, level of traffic stress, crash severity, transit, project lines, choropleths, flows |
| `assets/templates/` | `project.yaml` starter and the package documents, including the agent prompts |
| `references/spec.md` | Every `project.yaml` key, with examples |
| `references/cartography.md` | Figure programme by deliverable, design rules, honesty rules |
| `references/review.md` | Self-review table, independent reviewer brief, native build acceptance |
| `references/data-sources.md` | Tested public endpoints: Census, Caltrans, SACOG, CalEnviroScreen, crashes, schools, transit and more |
| `references/arcgis-pro.md`, `references/arcpy-verified.md` | Builder design, lessons, and ArcPy facts with Esri documentation links |
