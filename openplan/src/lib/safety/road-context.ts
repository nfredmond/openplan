import {
  isCorridorLineGeoJson,
  type CorridorLineGeoJson,
} from "@/lib/cartographic/corridor-line-geojson";

export type SafetyRoadSourceId = "us-census-tiger-line-cache" | "osm-network-cache";

export type SafetyRoadContextFeature = {
  id: string;
  name: string;
  geometry: CorridorLineGeoJson;
  sourceId: SafetyRoadSourceId;
  sourceLabel: string;
  vintage: string;
  /** When a stored row was frozen. Live adapter results omit this until cached. */
  cachedAt?: string;
};

export type SafetyRoadIdentity =
  | {
      status: "matched";
      name: string;
      sourceId: SafetyRoadSourceId;
      sourceLabel: string;
      vintage: string;
      matchQuality: "high" | "moderate" | "low";
      distanceMeters: number;
    }
  | {
      status: "unavailable";
      reason: "no_registered_road_evidence" | "no_named_road_within_150m";
    };

export type CachedRoadRow = {
  id: string;
  name: string | null;
  geometry_geojson: unknown;
  source: string | null;
  vintage: string | null;
  cached_at?: string | null;
};

const SOURCE_REGISTRY: ReadonlyArray<{
  id: SafetyRoadSourceId;
  label: string;
  matches: (source: string) => boolean;
}> = [
  {
    id: "us-census-tiger-line-cache",
    label: "U.S. Census TIGER/Line roads",
    matches: (source) => /tiger(?:\/line)?|u\.?s\.? census/i.test(source),
  },
  {
    id: "osm-network-cache",
    label: "OpenStreetMap roadway network",
    matches: (source) => /openstreetmap|\bosm\b/i.test(source),
  },
];

/**
 * Resolve only frozen road rows whose provider is in the road-source registry.
 * This deliberately performs no live geocoding and accepts no unlabeled line.
 */
export function readCachedUsRoadContext(rows: unknown): SafetyRoadContextFeature[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as CachedRoadRow;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const source = typeof row.source === "string" ? row.source.trim() : "";
    const vintage = typeof row.vintage === "string" ? row.vintage.trim() : "";
    const registered = SOURCE_REGISTRY.find((entry) => entry.matches(source));
    if (
      typeof row.id !== "string" ||
      !row.id ||
      !name ||
      !vintage ||
      !registered ||
      !isCorridorLineGeoJson(row.geometry_geojson)
    ) {
      return [];
    }

    return [{
      id: row.id,
      name,
      geometry: row.geometry_geojson,
      sourceId: registered.id,
      sourceLabel: registered.label,
      vintage,
      ...(typeof row.cached_at === "string" && row.cached_at.trim()
        ? { cachedAt: row.cached_at }
        : {}),
    }];
  });
}

const EARTH_RADIUS_METERS = 6_371_008.8;

function pointToSegmentMeters(
  longitude: number,
  latitude: number,
  start: [number, number],
  end: [number, number]
): number {
  const referenceLatitude = ((latitude + start[1] + end[1]) / 3) * Math.PI / 180;
  const project = ([lon, lat]: [number, number]) => ({
    x: EARTH_RADIUS_METERS * lon * Math.PI / 180 * Math.cos(referenceLatitude),
    y: EARTH_RADIUS_METERS * lat * Math.PI / 180,
  });
  const point = project([longitude, latitude]);
  const a = project(start);
  const b = project(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const ratio = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator));
  return Math.hypot(point.x - (a.x + ratio * dx), point.y - (a.y + ratio * dy));
}

function distanceToRoadMeters(
  longitude: number,
  latitude: number,
  road: SafetyRoadContextFeature
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < road.geometry.coordinates.length; index += 1) {
    nearest = Math.min(
      nearest,
      pointToSegmentMeters(
        longitude,
        latitude,
        road.geometry.coordinates[index - 1],
        road.geometry.coordinates[index]
      )
    );
  }
  return nearest;
}

/** Match a concentration to the nearest named, registered road without guessing. */
export function matchSafetyRoadIdentity(
  longitude: number,
  latitude: number,
  roads: readonly SafetyRoadContextFeature[]
): SafetyRoadIdentity {
  if (roads.length === 0) {
    return { status: "unavailable", reason: "no_registered_road_evidence" };
  }

  const nearest = roads
    .map((road) => ({ road, distanceMeters: distanceToRoadMeters(longitude, latitude, road) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
  if (!nearest || nearest.distanceMeters > 150) {
    return { status: "unavailable", reason: "no_named_road_within_150m" };
  }

  return {
    status: "matched",
    name: nearest.road.name,
    sourceId: nearest.road.sourceId,
    sourceLabel: nearest.road.sourceLabel,
    vintage: nearest.road.vintage,
    matchQuality: nearest.distanceMeters <= 35
      ? "high"
      : nearest.distanceMeters <= 75
        ? "moderate"
        : "low",
    distanceMeters: Math.round(nearest.distanceMeters),
  };
}
