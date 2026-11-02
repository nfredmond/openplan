import type mapboxgl from "mapbox-gl";

/** The one call each library answers differently. */
type ClusterSource = Pick<mapboxgl.GeoJSONSource, "getClusterExpansionZoom">;

/**
 * Zoom to the level at which a clustered group of points breaks apart.
 *
 * Mapbox answers `getClusterExpansionZoom` through a callback. MapLibre 5 and
 * later return a promise and never call the callback, so a caller that passes
 * only a callback never zooms on MapLibre. Both are handled here, so the same
 * click works on either engine. A failure in either form is a no-op: the
 * planner can still zoom by hand.
 */
export function expandCluster(
  map: Pick<mapboxgl.Map, "easeTo">,
  source: ClusterSource,
  clusterId: number,
  center: [number, number],
  options: { duration?: number } = {},
): void {
  const ease = (zoom: unknown) => {
    if (typeof zoom === "number") map.easeTo({ center, zoom, ...options });
  };
  const result = (
    source.getClusterExpansionZoom as unknown as (
      id: number,
      callback: (error: unknown, zoom?: number) => void,
    ) => Promise<number> | void
  )(clusterId, (error, zoom) => {
    if (!error) ease(zoom);
  });
  if (result && typeof (result as Promise<number>).then === "function") {
    (result as Promise<number>).then(ease, () => undefined);
  }
}
