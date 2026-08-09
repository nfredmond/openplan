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
 */
export const MAP_SURFACE_ROUTES = [
  /** Corridor study: the map IS the analysis. */
  "/explore",
  /** Crash points, filters and coverage disclosure are read on the map. */
  "/safety",
  /** Missions and AOIs are geographic by definition. */
  "/aerial",
] as const;

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
