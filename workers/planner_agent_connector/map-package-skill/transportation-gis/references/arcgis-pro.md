# ArcGIS Pro builder: design and lessons

Read this before changing `assets/arcgis/build_arcgis_pro.py` or when a build report comes back. API signatures with their Esri documentation URLs are in `arcpy-verified.md`.

## Status

The builder has **not been run in ArcGIS Pro**. It is checked two ways on a computer without Pro: preflight (data, fields and filters against the spec, with a failure probe) and a dry run against `scripts/tgis/mock_arcpy.py`, which executes the builder's Python end to end. Neither proves native rendering. Say so in every report until a build report comes back.

## How it is built

- **Calls with a real build history** (from an earlier kit run on Pro 3.7): `ArcGISProject('CURRENT').saveACopy`, `createMap`, `createLayout`, `createMapFrame`, `createTextElement`, `createGraphicElement`, `addDataFromPath`, `definitionQuery`, `getDefinition('V3')` and `setDefinition`, CIM strokes, fills, hatches, vector markers and dash effects, text halo through `haloSymbol` and `haloSize`, `exportToPDF`, `exportToPNG`, `exportToAIX`, `exportToMAPX`, `exportToPAGX`, `saveACopy` to `.lyrx`.
- **Calls taken from Esri documentation, not yet run here:** `createLabelClass`, unique-value and class-breaks renderers edited through CIM after `updateRenderer`, `createSpatialMapSeries`, `createMapSurroundElement`, `listStyleItems`, `CreateArcGISProject` (Pro 3.7).
- **CIM properties with no Esri sample** are set inside `attempt(...)`, which logs a warning and continues: Maplex placement properties, map series `rotationField`, text `letterSpacing`, frame border and background.
- A failed native renderer falls back to one definition-queried layer per class, which uses only calls with a build history.

## Rules carried from native builds on Pro 3.7

- Read GeoPackages; create the file geodatabase with Pro and copy features in. Pro does not open GDAL-written file geodatabases reliably.
- Every GeoPackage layer has a concrete geometry type. Pro cannot import generic GEOMETRY, and an empty layer becomes an empty feature class of the declared type.
- `arcpy.env.addOutputsToMap = False`. Build into a saved copy; delete the template's maps and layouts from the copy only.
- Retry imports and `addDataFromPath` on file locks; list each retry under warnings.
- Short local paths (`C:\GIS\...`). Synced folders and long paths break exports without a clear error.
- Only ArcPy and the standard library. The person at the Pro computer installs nothing.
- Write the report on failure too. Leave `BUILD_INCOMPLETE.txt` until the end.
- Font style names for Inter in Pro: `Regular`, `Medium`, `Semibold`, `Bold`.

## Known differences from the QGIS figures

- Label positions (each engine places its own). Route shields are plain bold numbers with a halo in Pro.
- Legend, scale bar and north arrow on the page are fixed graphics that match the PDF; dynamic versions sit on the pasteboard right of the page.
- Strip map books: the rotation sign convention for `rotationField` is unverified. If the corridor does not run left to right on the sheets, negate the `rotation` field (Calculate Field) and refresh the series.
- The sheet index inset does not highlight the current sheet.

## Lessons from native builds

Add one dated line per finding when a build report comes back.

- (none yet for this builder)
