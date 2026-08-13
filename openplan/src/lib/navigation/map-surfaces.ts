/**
 * Which routes treat the background map as a WORKING SURFACE.
 *
 * The cartographic map is drawn behind every signed-in page on purpose — it is
 * what makes OpenPlan look like a planning workbench rather than a CRUD form,
 * and that is a deliberate aesthetic choice that stays.
 *
 * The map CONTROLS are a different question. The layers panel and the legend
 * were rendered on every page by `cartographic-shell`, so a planner reading the
 * RTP registry got a floating box of checkboxes for project pins, engagement
 * pins and aerial missions — over the top of the Planning System menu card —
 * plus two paragraphs of census-tract and crash-coverage disclosure about a map
 * they were not using. Controls for a surface nobody is working on are not
 * neutral: they cover the surface somebody IS working on.
 *
 * So the rule is: the map is always VISIBLE, and its controls appear only where
 * the map is being READ. Everywhere else the map is background, and background
 * needs no legend.
 *
 * Prefix-matched, so `/aerial/<missionId>` and `/explore?runId=…` count as the
 * same surface as their index. Add a route here when a new page makes the
 * shared map its working canvas.
 *
 * ═══ THIS LIST GAINED A SECOND JOB (2026-08-12) ═══
 *
 * It now also decides where the map can be READ rather than merely looked at.
 * `CartographicMapReadingToggle` mounts inside `MapSurfaceOnly`, and the mode it
 * controls — which takes the route-content panel off the screen — exists only
 * while that control is mounted. So a route added here does not just gain
 * checkboxes; it gains the ability for a planner to hide its own content.
 *
 * That raises the bar for membership rather than lowering it, and the existing
 * test still applies: not "does the map show anything" but "would a planner open
 * this page in order to READ the map". A page whose content a planner would
 * never want out of the way is not a map surface.
 *
 * The FIRST entry is load-bearing in one more place: the layer library's "Show
 * on the map" link sends planners to `MAP_SURFACE_ROUTES[0]`. Reordering this
 * array changes where that link lands.
 */
export const MAP_SURFACE_ROUTES = [
  /** Crash points, filters and coverage disclosure are read on the map. */
  "/safety",
  /** Missions and AOIs are geographic by definition. */
  "/aerial",
] as const;

/*
  `/explore` WAS LISTED HERE AND HAD TO COME OFF (2026-08-12).

  It looks like the strongest candidate on the list — the map IS the corridor
  analysis — and that is exactly why it was wrong. `/explore` does not use the
  SHARED map at all. It builds its own `mapboxgl.Map` in
  `explore/_components/use-explore-map-instance.ts`, inside a stage painted at
  96–98% opacity over a surface that is itself 92–94% opaque, and the shared
  backdrop suppresses itself on this route (`MAP_OWNING_ROUTES`) and never even
  fetches the workspace layer catalog.

  So listing it here mounted a layers panel for a map that is not on the screen.
  CSS then hid the panel again (`body[data-map-owner="true"]`), which left the
  worst of both: a mounted component firing a `/api/map-features/counts` request
  on every visit, rendering nothing — and, because `:has(.op-cart-layers)` sees
  a `display: none` element perfectly well, still holding open the 272px gutter
  the panel would have occupied. The one page in OpenPlan where a map fills the
  working area was ~256px narrower to reserve room for an invisible control.

  The rule this list encodes is "the map is always VISIBLE, and its controls
  appear where the map is READ". `/explore` reads a DIFFERENT map, so the shared
  controls have nothing to control. Drawing workspace GIS layers on Explore's
  own instance is a real and worthwhile piece of work — roughly 700–900 lines
  across the backdrop, a new shared layer-painting module and Explore's own
  hooks, with the blast radius covering every authenticated page — and it is
  what would earn `/explore` its place back. Until then the honest arrangement
  is no control rather than a hidden one, and the Data Hub says where uploaded
  layers actually appear.
*/

/*
  `/dashboard` WAS listed here and should not have been.

  The reasoning was that the overview draws projects and pins, so the map is its
  canvas. Watching it at half a widescreen settled the argument the other way:
  the dashboard is a column of setup cards, team and integration panels, and the
  layers box plus legend take the right ~340px and squeeze the header to 916px —
  which is what makes the search pill wrap and the top cards look wrong. The map
  is decoration there, exactly as it is on the records pages.

  The test that a route belongs here is not "does the map show anything" but
  "would a planner open this page in order to READ the map".
*/

export function isMapSurfaceRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return MAP_SURFACE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}
