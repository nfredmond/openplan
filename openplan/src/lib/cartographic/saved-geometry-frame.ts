import type { FitInstruction } from "@/lib/cartographic/geometry-bbox";

type LongitudeSpan = { west: number; east: number };

/**
 * Frame validated saved GeoJSON without changing its coordinates. Each connected
 * line or polygon occupies its full ordinary longitude span, including holes.
 * Only gaps between components may be omitted from the camera's circular range.
 * This respects GeoJSON's Cartesian edges and antimeridian-cut MultiPolygons,
 * while retaining broad and full-world areas that vertex-only minimization crops.
 * The ordinary extent/query validators retain their separate WGS84 contract.
 */
export function fitInstructionFromSavedGeometry(
  collection: GeoJSON.FeatureCollection,
): FitInstruction | null {
  const spans: LongitudeSpan[] = [];
  let south = Infinity;
  let north = -Infinity;

  const addComponent = (positions: GeoJSON.Position[]) => {
    let west = Infinity;
    let east = -Infinity;
    for (const [longitude, latitude] of positions) {
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
    if (west <= east) spans.push({ west, east });
  };
  for (const { geometry } of collection.features) {
    switch (geometry.type) {
      case "Point": addComponent([geometry.coordinates]); break;
      case "LineString": addComponent(geometry.coordinates); break;
      case "Polygon": addComponent(geometry.coordinates.flat()); break;
      case "MultiPolygon":
        for (const polygon of geometry.coordinates) addComponent(polygon.flat());
        break;
    }
  }
  if (spans.length === 0) return null;

  spans.sort((a, b) => a.west - b.west);
  const merged: LongitudeSpan[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && span.west <= previous.east) previous.east = Math.max(previous.east, span.east);
    else merged.push({ ...span });
  }
  let west = merged[0].west;
  let east = merged[merged.length - 1].east;
  let widestGap = west + 360 - east;
  for (let index = 1; index < merged.length; index += 1) {
    const gap = merged[index].west - merged[index - 1].east;
    if (gap > widestGap) {
      widestGap = gap;
      west = merged[index].west;
      // Camera corners may exceed 180; saved/exported coordinates never do.
      east = merged[index - 1].east + 360;
    }
  }
  return west === east && south === north
    ? { kind: "center", center: [west, south] }
    : { kind: "bbox", bbox: [[west, south], [east, north]] };
}
