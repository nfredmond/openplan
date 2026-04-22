// Pure geometry-to-bbox helpers used by the cartographic backdrop's
// fit-to-selection effect. Covers the three GeoJSON primitive shapes we
// actually render on the backdrop today (Point / Polygon / LineString).
// No MultiPolygon / MultiLineString support — the writer-side validators
// already reject those upstream, so adding them here would just be dead
// paint code.

type Position = [number, number];
type Bbox = [[number, number], [number, number]];

export type FitInstruction =
  | { kind: "center"; center: Position }
  | { kind: "bbox"; bbox: Bbox };

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

  return null;
}
