/**
 * Seeding a mission AOI from geometry the project already holds.
 *
 * A mission attached to a project usually flies over an area the project has
 * already described: `projects.place_geometry_geojson` (the study area set
 * through the geography front door) or a `project_corridors` LineString.
 * Hand-tracing that same shape in the AOI editor is duplicate work and drifts
 * from the recorded boundary, so the editor offers these as seed shapes.
 *
 * Constraints this module encodes:
 *
 * - The AOI schema is a single outer ring (see the mission PATCH route's
 *   polygon schema and the editor scope note). A MultiPolygon boundary
 *   therefore contributes its LARGEST outer ring, and that reduction is
 *   DISCLOSED via `notes` — never applied silently.
 * - A corridor is a line, not an area. It becomes a polygon by buffering a
 *   stated distance to each side. The distance is a parameter the planner
 *   edits; `DEFAULT_CORRIDOR_BUFFER_METERS` is only the starting value the
 *   UI shows, never a hidden constant applied behind the field.
 * - A TIGERweb county boundary can carry thousands of vertices; loading them
 *   all would make the vertex editor unusable. Seed rings are simplified to
 *   at most `AOI_SEED_MAX_RING_VERTICES`, and that too is disclosed.
 *
 * Everything here is pure and isomorphic: the boundary ring is prepared
 * server-side (so megabytes of raw boundary never ship to the client), while
 * corridor buffering runs client-side because the buffer distance is the
 * planner's input.
 */

import { isCorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";

export type AoiSeedRing = [number, number][];

/** Starting value for the corridor-width field. The planner can change it. */
export const DEFAULT_CORRIDOR_BUFFER_METERS = 100;

/** Seeded rings are simplified to at most this many vertices, with disclosure. */
export const AOI_SEED_MAX_RING_VERTICES = 256;

/**
 * Meters per degree of latitude (WGS84 mean). Used only to convert a
 * planner-entered buffer distance into local degrees around the corridor
 * itself — the corridor's own latitude sets the longitude scale, so this
 * works at any latitude and encodes no place.
 */
const METERS_PER_DEGREE_LAT = 111_132;

/** Matches the editor's own vertex precision (6 decimals ≈ 0.1 m). */
const COORDINATE_DECIMALS = 6;

export type AoiSeedSource =
  | {
      kind: "project_boundary";
      key: string;
      label: string;
      /** Open ring (no closing duplicate), already reduced + disclosed. */
      ring: AoiSeedRing;
      notes: string[];
    }
  | {
      kind: "corridor";
      key: string;
      label: string;
      /** Raw corridor LineString coordinates; buffered client-side. */
      line: [number, number][];
    };

/**
 * Build the seed choices for a mission's AOI editor from the project row and
 * its corridors. Returns [] when nothing seedable exists — the editor then
 * shows no seed affordance at all and behaves exactly as before.
 */
export function buildMissionAoiSeedSources(input: {
  /** place_label if set, else the project name; null falls back to a generic label. */
  projectLabel: string | null;
  placeGeometryGeojson: unknown;
  corridors: { id: string; name: string; geometry_geojson: unknown }[];
}): AoiSeedSource[] {
  const sources: AoiSeedSource[] = [];

  const boundary = prepareBoundarySeedRing(input.placeGeometryGeojson);
  if (boundary) {
    sources.push({
      kind: "project_boundary",
      key: "project-boundary",
      label: input.projectLabel ?? "Project boundary",
      ring: boundary.ring,
      notes: boundary.notes,
    });
  }

  for (const corridor of input.corridors) {
    if (!isCorridorLineGeoJson(corridor.geometry_geojson)) continue;
    sources.push({
      kind: "corridor",
      key: `corridor-${corridor.id}`,
      label: corridor.name,
      line: corridor.geometry_geojson.coordinates,
    });
  }

  return sources;
}

/**
 * Reduce a stored boundary geometry (Polygon or MultiPolygon GeoJSON) to a
 * single editable outer ring. Returns null when the geometry cannot seed an
 * AOI (missing, not a polygon, or degenerate) — the caller then simply omits
 * the choice.
 */
export function prepareBoundarySeedRing(
  geometry: unknown
): { ring: AoiSeedRing; notes: string[] } | null {
  const rings = outerRingsOf(geometry);
  if (rings.length === 0) return null;

  const notes: string[] = [];
  let ring: AoiSeedRing;
  if (rings.length === 1) {
    ring = rings[0];
  } else {
    let bestIndex = 0;
    let bestArea = -Infinity;
    rings.forEach((candidate, index) => {
      const area = approxRingArea(candidate);
      if (area > bestArea) {
        bestArea = area;
        bestIndex = index;
      }
    });
    ring = rings[bestIndex];
    notes.push(
      `This boundary has ${rings.length} separate parts; the largest part was loaded because the AOI supports a single outer ring.`
    );
  }

  ring = dropClosingVertex(ring);
  if (ring.length < 3) return null;

  const simplified = simplifyRingToCap(ring, AOI_SEED_MAX_RING_VERTICES);
  if (simplified.length < ring.length) {
    notes.push(
      `The boundary was simplified from ${ring.length.toLocaleString("en-US")} to ${simplified.length.toLocaleString("en-US")} vertices so it stays editable.`
    );
  }

  return { ring: roundRing(simplified), notes };
}

/**
 * Widen a corridor LineString into an AOI ring covering `bufferMeters` to each
 * side of the line, with square end caps. Returns null for a degenerate line
 * or a non-positive distance.
 *
 * The buffer is a miter-joined ribbon in a local planar frame centred on the
 * corridor (longitude scaled by cos of its mean latitude), which is accurate
 * to well under a meter at corridor scale and assumes nothing about where on
 * Earth the corridor is.
 */
export function bufferCorridorLineToRing(
  line: [number, number][],
  bufferMeters: number
): { ring: AoiSeedRing; notes: string[] } | null {
  if (!Number.isFinite(bufferMeters) || bufferMeters <= 0) return null;
  if (!Array.isArray(line)) return null;

  const deduped: [number, number][] = [];
  for (const position of line) {
    if (
      !Array.isArray(position) ||
      typeof position[0] !== "number" ||
      typeof position[1] !== "number" ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1])
    ) {
      return null;
    }
    const previous = deduped[deduped.length - 1];
    if (previous && previous[0] === position[0] && previous[1] === position[1]) continue;
    deduped.push([position[0], position[1]]);
  }
  if (deduped.length < 2) return null;

  // Local planar frame: meters east/north relative to the corridor itself.
  const meanLat = deduped.reduce((sum, [, lat]) => sum + lat, 0) / deduped.length;
  const metersPerDegLng = METERS_PER_DEGREE_LAT * Math.cos((meanLat * Math.PI) / 180);
  if (metersPerDegLng <= 0) return null; // polar degenerate frame

  const points = deduped.map(([lng, lat]) => ({
    x: lng * metersPerDegLng,
    y: lat * METERS_PER_DEGREE_LAT,
  }));

  // Square caps: extend both ends by the buffer distance along the line.
  const startDir = unit(points[1].x - points[0].x, points[1].y - points[0].y);
  const endDir = unit(
    points[points.length - 1].x - points[points.length - 2].x,
    points[points.length - 1].y - points[points.length - 2].y
  );
  if (!startDir || !endDir) return null;
  const extended = [
    { x: points[0].x - startDir.x * bufferMeters, y: points[0].y - startDir.y * bufferMeters },
    ...points,
    {
      x: points[points.length - 1].x + endDir.x * bufferMeters,
      y: points[points.length - 1].y + endDir.y * bufferMeters,
    },
  ];

  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  const MITER_LIMIT = 3;

  for (let i = 0; i < extended.length; i++) {
    const prev = extended[i - 1];
    const current = extended[i];
    const next = extended[i + 1];
    const inDir = prev ? unit(current.x - prev.x, current.y - prev.y) : null;
    const outDir = next ? unit(next.x - current.x, next.y - current.y) : null;
    const dir = inDir && outDir
      ? unit(inDir.x + outDir.x, inDir.y + outDir.y) ?? inDir
      : inDir ?? outDir;
    if (!dir) continue;
    const normal = { x: -dir.y, y: dir.x };
    // Miter scale so the join keeps the full width, clamped at sharp angles.
    const reference = inDir ?? outDir;
    const cosHalf = reference ? Math.max(normal.x * -reference.y + normal.y * reference.x, 1 / MITER_LIMIT) : 1;
    const offset = bufferMeters / cosHalf;
    left.push({ x: current.x + normal.x * offset, y: current.y + normal.y * offset });
    right.push({ x: current.x - normal.x * offset, y: current.y - normal.y * offset });
  }

  if (left.length < 2 || right.length < 2) return null;

  const planarRing = [...left, ...right.reverse()];
  const ring: AoiSeedRing = planarRing.map(({ x, y }) => [
    x / metersPerDegLng,
    y / METERS_PER_DEGREE_LAT,
  ]);
  if (ring.length < 3) return null;

  const notes: string[] = [];
  const simplified = simplifyRingToCap(ring, AOI_SEED_MAX_RING_VERTICES);
  if (simplified.length < ring.length) {
    notes.push(
      `The widened corridor outline was simplified from ${ring.length.toLocaleString("en-US")} to ${simplified.length.toLocaleString("en-US")} vertices so it stays editable.`
    );
  }

  return { ring: roundRing(simplified), notes };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/** Outer rings of a Polygon or MultiPolygon; [] for anything else. */
function outerRingsOf(geometry: unknown): AoiSeedRing[] {
  if (!geometry || typeof geometry !== "object") return [];
  const candidate = geometry as { type?: unknown; coordinates?: unknown };

  if (candidate.type === "Polygon") {
    const ring = validRing(Array.isArray(candidate.coordinates) ? candidate.coordinates[0] : null);
    return ring ? [ring] : [];
  }

  if (candidate.type === "MultiPolygon") {
    if (!Array.isArray(candidate.coordinates)) return [];
    const rings: AoiSeedRing[] = [];
    for (const polygon of candidate.coordinates) {
      const ring = validRing(Array.isArray(polygon) ? polygon[0] : null);
      if (ring) rings.push(ring);
    }
    return rings;
  }

  return [];
}

function validRing(value: unknown): AoiSeedRing | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const ring: AoiSeedRing = [];
  for (const position of value) {
    if (
      !Array.isArray(position) ||
      typeof position[0] !== "number" ||
      typeof position[1] !== "number" ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1])
    ) {
      return null;
    }
    ring.push([position[0], position[1]]);
  }
  return ring;
}

function dropClosingVertex(ring: AoiSeedRing): AoiSeedRing {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

/**
 * Approximate ring area in a locally-scaled planar frame — only ever used to
 * COMPARE parts of one MultiPolygon, so units cancel and no projection or
 * jurisdictional assumption matters.
 */
function approxRingArea(ring: AoiSeedRing): number {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  let doubled = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    doubled += x1 * cosLat * y2 - x2 * cosLat * y1;
  }
  return Math.abs(doubled / 2);
}

/**
 * Douglas–Peucker simplification to at most `maxVertices`, tolerance found by
 * binary search on the ring's own extent. Falls back to uniform decimation if
 * simplification would collapse the ring below a triangle.
 */
function simplifyRingToCap(ring: AoiSeedRing, maxVertices: number): AoiSeedRing {
  if (ring.length <= maxVertices) return ring;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  const diagonal = Math.hypot(maxLng - minLng, maxLat - minLat);
  if (!Number.isFinite(diagonal) || diagonal === 0) return decimate(ring, maxVertices);

  let low = 0;
  let high = diagonal;
  let best: AoiSeedRing | null = null;
  for (let i = 0; i < 30; i++) {
    const tolerance = (low + high) / 2;
    const candidate = douglasPeucker(ring, tolerance);
    if (candidate.length > maxVertices) {
      low = tolerance;
    } else {
      best = candidate;
      high = tolerance;
    }
  }

  if (!best || best.length < 3) return decimate(ring, maxVertices);
  return best;
}

function decimate(ring: AoiSeedRing, maxVertices: number): AoiSeedRing {
  const stride = Math.ceil(ring.length / maxVertices);
  const result: AoiSeedRing = [];
  for (let i = 0; i < ring.length; i += stride) result.push(ring[i]);
  return result.length >= 3 ? result : ring;
}

/** Iterative Douglas–Peucker on an open ring (endpoints always kept). */
function douglasPeucker(points: AoiSeedRing, tolerance: number): AoiSeedRing {
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;
    let farthest = -1;
    let farthestDistance = 0;
    for (let i = start + 1; i < end; i++) {
      const d = pointToSegmentDistance(points[i], points[start], points[end]);
      if (d > farthestDistance) {
        farthestDistance = d;
        farthest = i;
      }
    }
    if (farthest !== -1 && farthestDistance > tolerance) {
      keep[farthest] = true;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

function pointToSegmentDistance(
  point: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function unit(x: number, y: number): { x: number; y: number } | null {
  const length = Math.hypot(x, y);
  if (length === 0) return null;
  return { x: x / length, y: y / length };
}

function roundRing(ring: AoiSeedRing): AoiSeedRing {
  const factor = 10 ** COORDINATE_DECIMALS;
  return ring.map(([lng, lat]) => [
    Math.round(lng * factor) / factor,
    Math.round(lat * factor) / factor,
  ]);
}
