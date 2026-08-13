// Pure geometry-to-bbox helpers used by the cartographic backdrop's
// fit-to-selection effect. Covers the four GeoJSON primitive shapes we
// actually render on the backdrop today (Point / LineString / Polygon /
// MultiPolygon). MultiLineString + GeometryCollection are still rejected
// because no current layer emits them.
//
// THIS MODULE IS THE PRODUCT'S ONE CAMERA VOCABULARY. Everything that wants to
// point the map somewhere — a click on a feature, the initial framing of a
// workspace, a "Show on the map" link — produces a `FitInstruction` and hands
// it to `applyFitInstruction`. The alternative, each caller reaching for
// `map.fitBounds` with its own padding and its own maximum zoom, is how two
// ways of arriving at the same layer come to show it at two different scales.

import { isDegenerateBbox, readWgs84Bbox } from "@/lib/geo/wgs84-bounds";

type Position = [number, number];
type Bbox = [[number, number], [number, number]];

export type FitInstruction =
  | { kind: "center"; center: Position }
  | { kind: "bbox"; bbox: Bbox };

// Fit-to-selection viewport targets. maxZoom keeps a tiny feature (single
// small polygon, short corridor) from punching past neighborhood scale on
// fitBounds; padding leaves room for UI chrome on the sides. POINT_FIT_ZOOM
// lands projects at neighborhood scale so the marker has spatial context.
export const FIT_PADDING = 64;
export const FIT_MAX_ZOOM = 15;
export const FIT_DURATION_MS = 400;
export const POINT_FIT_ZOOM = 14;

/**
 * The only two things this module needs from a map.
 *
 * Typing against this rather than `mapboxgl.Map` is what lets the camera rules
 * be tested at all: jsdom has no box model and Mapbox will not initialise in
 * it, so a test that needed a real map could only ever assert that a function
 * was called. Here the rules themselves — which branch, what zoom, what
 * padding — are checked directly, and what remains unproven is only that
 * Mapbox honours its own documented options.
 */
export type FitTarget = {
  easeTo(options: { center: Position; zoom: number; duration: number }): unknown;
  fitBounds(
    bounds: Bbox,
    options: { padding: number; maxZoom: number; duration: number },
  ): unknown;
};

/**
 * Point a map at what an instruction describes.
 *
 * A degenerate extent takes the `center` branch on purpose: `fitBounds` on a
 * rectangle of zero size asks Mapbox for infinite zoom, and what comes back is
 * either the maximum zoom the style allows or nothing at all, depending on
 * version. `POINT_FIT_ZOOM` is a deliberate answer to "how close should one
 * position be?" and the two-corner path never has to answer it.
 */
export function applyFitInstruction(map: FitTarget, instruction: FitInstruction): void {
  if (instruction.kind === "center") {
    map.easeTo({
      center: instruction.center,
      zoom: POINT_FIT_ZOOM,
      duration: FIT_DURATION_MS,
    });
    return;
  }
  map.fitBounds(instruction.bbox, {
    padding: FIT_PADDING,
    maxZoom: FIT_MAX_ZOOM,
    duration: FIT_DURATION_MS,
  });
}

/**
 * Turn a recorded extent — `[west, south, east, north]`, as a workspace GIS
 * version stores it — into a camera instruction.
 *
 * Returns null for an extent that was never recorded and for one that cannot be
 * a place: the caller must then leave the camera alone. That is not a
 * degradation to apologise for. A layer drawn at the continental default is a
 * planner who has to zoom; a camera flown to a bogus extent is a planner
 * looking at empty ocean with no reason to doubt it, and the second is worse.
 *
 * Range and ordering are delegated to `readWgs84Bbox` rather than re-checked
 * here, so the rectangle a camera will accept and the rectangle the feature
 * query will accept cannot drift apart.
 */
export function fitInstructionFromExtent(extent: unknown): FitInstruction | null {
  const bbox = readWgs84Bbox(extent);
  if (!bbox) return null;
  const [west, south, east, north] = bbox;
  if (isDegenerateBbox(bbox)) {
    return { kind: "center", center: [west, south] };
  }
  return { kind: "bbox", bbox: [[west, south], [east, north]] };
}

function isFiniteLngLat(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function expand(bbox: Bbox, position: Position): Bbox {
  return [
    [Math.min(bbox[0][0], position[0]), Math.min(bbox[0][1], position[1])],
    [Math.max(bbox[1][0], position[0]), Math.max(bbox[1][1], position[1])],
  ];
}

function bboxFromPositions(positions: readonly unknown[]): Bbox | null {
  let bbox: Bbox | null = null;
  for (const raw of positions) {
    if (!isFiniteLngLat(raw)) continue;
    const point: Position = [raw[0], raw[1]];
    bbox = bbox ? expand(bbox, point) : [point, point];
  }
  return bbox;
}

/**
 * Compute a viewport instruction from a GeoJSON geometry.
 *
 * Returns `null` for unsupported geometry shapes or malformed coords.
 * Callers should early-return on null rather than guessing a default —
 * a bogus fitBounds() is worse than not fitting at all.
 */
export function fitInstructionFromGeometry(geometry: unknown): FitInstruction | null {
  if (!geometry || typeof geometry !== "object") return null;
  const candidate = geometry as { type?: unknown; coordinates?: unknown };
  const type = candidate.type;
  const coordinates = candidate.coordinates;

  if (type === "Point") {
    if (!isFiniteLngLat(coordinates)) return null;
    return { kind: "center", center: [coordinates[0], coordinates[1]] };
  }

  if (type === "LineString") {
    if (!Array.isArray(coordinates)) return null;
    const bbox = bboxFromPositions(coordinates);
    if (!bbox) return null;
    return { kind: "bbox", bbox };
  }

  if (type === "Polygon") {
    if (!Array.isArray(coordinates)) return null;
    const outerRing = coordinates[0];
    if (!Array.isArray(outerRing)) return null;
    const bbox = bboxFromPositions(outerRing);
    if (!bbox) return null;
    return { kind: "bbox", bbox };
  }

  if (type === "MultiPolygon") {
    if (!Array.isArray(coordinates)) return null;
    let bbox: Bbox | null = null;
    for (const polygon of coordinates) {
      if (!Array.isArray(polygon)) continue;
      const outerRing = polygon[0];
      if (!Array.isArray(outerRing)) continue;
      const polyBbox = bboxFromPositions(outerRing);
      if (!polyBbox) continue;
      if (!bbox) {
        bbox = polyBbox;
      } else {
        bbox = expand(expand(bbox, polyBbox[0]), polyBbox[1]);
      }
    }
    if (!bbox) return null;
    return { kind: "bbox", bbox };
  }

  return null;
}
