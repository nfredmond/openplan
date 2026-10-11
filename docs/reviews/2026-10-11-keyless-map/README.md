# Public engagement map without a Mapbox key (2026-10-11)

Nathaniel approved this on 2026-10-10 as its own branch, one of three
follow-ups to the [engagement map sweep](../2026-10-10-engagement-map-sweep/README.md).

## What changed

- `NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL` names a MapLibre style. With no Mapbox
  key, the participant map (`/engage/<token>`, `/embed/<token>`) is drawn by
  MapLibre GL 6.13 from that style. A Mapbox key, when set, still wins.
- `pmtiles://` is registered, so a style can read a `.pmtiles` extract served
  from `openplan/public/`. No tile server is needed.
- MapLibre's tile worker is emitted by webpack and named with `setWorkerUrl`.
  Without it the map mounted but no tile ever drew.
- 3D buildings read the OpenMapTiles (`render_height`) and Protomaps
  (`buildings`) schemas as well as Mapbox's. A building with no height in the
  data stays flat; no height is invented.
- The buildings layer goes under the first label or the first comment layer,
  whichever comes first. The first local test showed buildings drawn over the
  pins, because a style with no labels put them on top of everything.
- The 3D button sits 14 px below find-my-location on both libraries (Mapbox
  spaces its own groups 10 px apart; under MapLibre the button touched it).
  Nathaniel asked for a little more room on 2026-10-11.
- Pin-group counts use the style's own font. A style with no `glyphs` gets
  the grey group circles without a number, rather than a failed font request.
- Place search and the background picker are Mapbox services and do not
  appear on a MapLibre map. The operator's diagnostic names the style
  setting, not a Mapbox key.
- The content-security policy adds the style's origin and any
  `OPENPLAN_MAP_EXTRA_ORIGINS`. A same-origin style adds nothing.

## Not changed

The other map surfaces (Explore, corridor analysis, staff engagement views,
GIS previews) still require a Mapbox key. Moving them is a separate lane.

## Browser evidence

Dev build of this branch (`next dev --webpack`) on port 3532 with
`NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` empty, the local North State Street demo
campaign (Ukiah), real navigation to `/engage/<token>`.

| Style | Viewport | Observed |
|---|---|---|
| Local Protomaps extract (Ukiah bbox, 1.3 MB, minimal style, no glyphs) | 1360 x 860 | Map drew from `/__keyless-test/ukiah.pmtiles`; resource list held no origin other than the deployment's. Selecting a comment zoomed and opened it beside the map; marking a spot advanced the form; 3D tilted with extruded buildings where the data has heights. |
| OpenFreeMap Liberty | 1360 x 860 | Map, labels, three pins and the "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" attribution. |
| OpenFreeMap Liberty | 390 x 844 | Same; comments button, controls and the bottom sheet clear of each other. Only outside origin: `tiles.openfreemap.org`. No background picker, no place search. |

Console: no errors. Three warnings came from OpenFreeMap's own style
(`highway-shield` filters on null values) and three from Next.js font preloads,
neither from this change. Screenshots stayed local (`.playwright-mcp/keyless-*.png`);
the test extract was not committed.

## Tests

`src/test/public-map-draws-without-a-mapbox-key.test.tsx`: the style setting
and its origin, `mapAvailable` without a key, MapLibre drawn with the style and
pins, no Mapbox picker or search, cluster font from the style or none, a
promise-returning cluster zoom, a library that fails to load, a Mapbox key
winning, and the CSP. MapLibre is replaced by the lifecycle fake; the browser
rows above are the only evidence that MapLibre itself renders.
