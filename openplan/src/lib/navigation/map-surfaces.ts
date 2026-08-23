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
 * Prefix-matched for surface-hood, so an Aerial mission remains a geographic
 * page. Ownership below is more specific: mission pages build their own map,
 * while the Aerial index reads the shell map.
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
 *
 * That link keeps working on a route that also appears in `MAP_OWNING_ROUTES`
 * below, but only because such a route mounts its OWN `?layer=` handler — the
 * shell's `CartographicLayerDeepLink` rides inside `MapSurfaceOnly` and no
 * longer mounts there. `/safety` mounts `SafetyLayerDeepLink`. A route added to
 * both lists without one would leave "Show on the map" landing on a page that
 * silently ignores the parameter.
 */
export const MAP_SURFACE_ROUTES = [
  /** Crash points, filters and coverage disclosure are read on the map. */
  "/safety",
  /** Missions and AOIs are geographic by definition. */
  "/aerial",
] as const;

/**
 * Routes that BUILD THEIR OWN `mapboxgl.Map` and therefore suppress the shell
 * backdrop.
 *
 * ═══ WHY THIS MOVED HERE (2026-08-13) ═══
 *
 * It lived as a private `const` inside `cartographic-map-backdrop.tsx`, which
 * meant the two halves of one rule sat in two files that could not see each
 * other — and they drifted, exactly as split rules do. `/safety` was listed as
 * a map SURFACE and was not listed as a map OWNER, while
 * `safety-crash-map.tsx` had been building its own Mapbox instance all along.
 * The result, measured in a real browser at 1600×900:
 *
 *   - TWO Mapbox instances on one screen — a 1600×900 backdrop behind the page
 *     panel, and a 558×457 crash map inside it;
 *   - the shell's layers panel (240×458) and legend (240×258) docked at x=1344,
 *     both driving the BACKDROP, which is the map the planner is not reading;
 *   - so every layer a planner switched on drew underneath an opaque panel, and
 *     the legend explained symbols the crash map never painted.
 *
 * Controls that point at the wrong map are worse than absent controls: they
 * report success and change nothing visible. Keeping ownership beside
 * surface-hood makes "owns its map" and "shows the shell's map controls" one
 * decision, taken in one place, and `MapSurfaceOnly` now reads both.
 *
 * A route here does NOT lose its map controls — it takes responsibility for
 * mounting its own, against the map it actually draws. `/safety` does that in
 * `safety-workspace.tsx` (background picker, workspace-layer panel, severity
 * key); `/explore` does it in `explore-workspace-layers-panel.tsx`.
 */
export const MAP_OWNING_ROUTES = [
  /** Corridor Analysis builds its map in `explore/_components/use-explore-map-instance`. */
  "/explore",
  /** Safety builds its map in `components/safety/safety-crash-map.tsx`. */
  "/safety",
  /** Mission detail/edit pages build the mission evidence or AOI map. */
  "/aerial/missions",
] as const;

/**
 * True when this route draws its own map and the shell backdrop must stand down.
 *
 * Prefix-matched on the same rule as `isMapSurfaceRoute`, so a detail route
 * under a map-owning index owns its map too — and so `/explorer` cannot match
 * `/explore`.
 */
export function routeOwnsMap(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return MAP_OWNING_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/**
 * True when the SHELL's map controls belong on this route.
 *
 * Both halves, and the conjunction is the point: the shell's dock may only
 * appear where the shell's map is both drawn and worked on. `/safety` satisfies
 * the first test and fails the second, which is precisely the case that shipped
 * a layers panel driving an invisible map.
 */
export function showsSharedMapControls(pathname: string | null | undefined): boolean {
  return isMapSurfaceRoute(pathname) && !routeOwnsMap(pathname);
}

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
