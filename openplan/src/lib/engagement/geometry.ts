import { z } from "zod";

/**
 * GeoJSON geometry support for public engagement comments.
 *
 * Community members can attach a Point, LineString, or Polygon to a comment.
 * The geometry is stored as JSONB on engagement_items.geometry, while
 * latitude/longitude keep holding a representative point (the point itself,
 * or the vertex centroid for lines/polygons) so every legacy lat/lng surface
 * keeps working unchanged.
 *
 * Validation posture mirrors src/lib/geo/corridor-geometry.ts: hard WGS84
 * bounds, explicit ring closure, and a vertex cap so a hostile client cannot
 * stuff megabytes of coordinates into a JSONB column.
 */

export const ENGAGEMENT_GEOMETRY_MAX_VERTICES = 200;

export type EngagementGeometryPosition = [number, number];

export type EngagementPointGeometry = {
  type: "Point";
  coordinates: EngagementGeometryPosition;
};

export type EngagementLineStringGeometry = {
  type: "LineString";
  coordinates: EngagementGeometryPosition[];
};

export type EngagementPolygonGeometry = {
  type: "Polygon";
  coordinates: EngagementGeometryPosition[][];
};

export type EngagementGeometry =
  | EngagementPointGeometry
  | EngagementLineStringGeometry
  | EngagementPolygonGeometry;

export type EngagementGeometryType = EngagementGeometry["type"];

// [lng, lat] with hard WGS84 bounds. Exactly two elements — altitude and
// projected coordinates are rejected.
const positionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const pointSchema = z.object({
  type: z.literal("Point"),
  coordinates: positionSchema,
});

const lineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z
    .array(positionSchema)
    .min(2)
    .max(ENGAGEMENT_GEOMETRY_MAX_VERTICES),
});

// Single outer ring only — the public draw tool cannot author holes, and a
// multi-ring polygon from an anonymous submitter is a red flag, not a need.
// Ring length allows the closing vertex on top of the vertex cap.
const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z
    .array(
      z
        .array(positionSchema)
        .min(4)
        .max(ENGAGEMENT_GEOMETRY_MAX_VERTICES + 1)
    )
    .length(1),
});

export const engagementGeometrySchema = z.union([
  pointSchema,
  lineStringSchema,
  polygonSchema,
]);

export type EngagementGeometryParseResult =
  | { ok: true; geometry: EngagementGeometry }
  | { ok: false; error: string };

export function parseEngagementGeometry(value: unknown): EngagementGeometryParseResult {
  const parsed = engagementGeometrySchema.safeParse(value);

  if (!parsed.success) {
    return {
      ok: false,
      error:
        "Geometry must be a GeoJSON Point, LineString, or Polygon with [longitude, latitude] coordinates inside WGS84 bounds and at most " +
        `${ENGAGEMENT_GEOMETRY_MAX_VERTICES} vertices.`,
    };
  }

  const geometry = parsed.data as EngagementGeometry;

  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return {
        ok: false,
        error: "Polygon ring must be closed: the first and last vertex must match.",
      };
    }
  }

  return { ok: true, geometry };
}

/** Vertices excluding a polygon ring's closing vertex. */
export function countEngagementGeometryVertices(geometry: EngagementGeometry): number {
  if (geometry.type === "Point") return 1;
  if (geometry.type === "LineString") return geometry.coordinates.length;
  return Math.max(geometry.coordinates[0].length - 1, 0);
}

/**
 * Representative point written into latitude/longitude for legacy surfaces.
 * Point → itself; LineString → vertex centroid; Polygon → centroid of the
 * ring vertices excluding the closing vertex (matches the polygonCenter
 * idiom in src/components/aerial/mission-aoi-editor.tsx).
 */
export function computeEngagementGeometryRepresentativePoint(
  geometry: EngagementGeometry
): { latitude: number; longitude: number } {
  if (geometry.type === "Point") {
    return { longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] };
  }

  const positions =
    geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.coordinates[0].slice(0, -1);

  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of positions) {
    sumLng += lng;
    sumLat += lat;
  }

  return {
    longitude: sumLng / positions.length,
    latitude: sumLat / positions.length,
  };
}

const GEOMETRY_TYPE_LABELS: Record<EngagementGeometryType, string> = {
  Point: "Point",
  LineString: "Line",
  Polygon: "Area",
};

export function engagementGeometryTypeLabel(type: EngagementGeometryType): string {
  return GEOMETRY_TYPE_LABELS[type];
}

/**
 * Loose reader for geometry values coming back from the database. Rows
 * written through the API are always valid, but JSONB gives no structural
 * guarantee, so display surfaces re-validate before rendering.
 */
export function readStoredEngagementGeometry(value: unknown): EngagementGeometry | null {
  if (value === null || value === undefined) return null;
  const parsed = parseEngagementGeometry(value);
  return parsed.ok ? parsed.geometry : null;
}
