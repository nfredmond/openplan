export type AoiPolygonGeoJson = {
  type: "Polygon";
  coordinates: [number, number][][];
};

export type DjiWaypoint = {
  index: number;
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  speed: number;
};

export type DjiMissionExport = {
  schemaVersion: "natford-dji-1";
  missionId: string;
  missionTitle: string;
  generatedAt: string;
  defaults: {
    altitudeMeters: number;
    speedMetersPerSecond: number;
  };
  waypointCount: number;
  waypoints: DjiWaypoint[];
  source: {
    geometryType: "Polygon";
    ringCount: number;
    note: string;
  };
};

export type BuildDjiMissionExportInput = {
  missionId: string;
  missionTitle: string;
  aoiGeojson: AoiPolygonGeoJson;
  altitudeMeters?: number;
  speedMetersPerSecond?: number;
  now?: Date;
};

const DEFAULT_ALTITUDE_M = 90;
const DEFAULT_SPEED_MPS = 5;

export function isAoiPolygonGeoJson(value: unknown): value is AoiPolygonGeoJson {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== "Polygon") return false;
  if (!Array.isArray(candidate.coordinates) || candidate.coordinates.length === 0) return false;
  for (const ring of candidate.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4) return false;
    for (const position of ring) {
      if (!Array.isArray(position) || position.length < 2) return false;
      const [lng, lat] = position;
      if (typeof lng !== "number" || typeof lat !== "number") return false;
    }
  }
  return true;
}

export function buildDjiMissionExport(input: BuildDjiMissionExportInput): DjiMissionExport {
  if (!isAoiPolygonGeoJson(input.aoiGeojson)) {
    throw new Error("aoiGeojson is not a valid GeoJSON Polygon");
  }

  const altitude = input.altitudeMeters ?? DEFAULT_ALTITUDE_M;
  const speed = input.speedMetersPerSecond ?? DEFAULT_SPEED_MPS;
  const outerRing = input.aoiGeojson.coordinates[0];

  // DJI waypoint order follows the outer ring, dropping the closing
  // duplicate position. Heading is computed by bearing to the next
  // waypoint so the aircraft faces the direction of travel.
  const perimeter = outerRing.slice(0, outerRing.length - 1);

  const waypoints: DjiWaypoint[] = perimeter.map((position, index) => {
    const [longitude, latitude] = position;
    const next = perimeter[(index + 1) % perimeter.length];
    return {
      index,
      latitude,
      longitude,
      altitude,
      heading: bearingDegrees(latitude, longitude, next[1], next[0]),
      speed,
    };
  });

  return {
    schemaVersion: "natford-dji-1",
    missionId: input.missionId,
    missionTitle: input.missionTitle,
    generatedAt: (input.now ?? new Date()).toISOString(),
    defaults: {
      altitudeMeters: altitude,
      speedMetersPerSecond: speed,
    },
    waypointCount: waypoints.length,
    waypoints,
    source: {
      geometryType: "Polygon",
      ringCount: input.aoiGeojson.coordinates.length,
      note: "Nat Ford internal DJI waypoint schema. Not a direct DJI Fly/Pilot 2 import format — a consuming converter must map these fields to the target mission spec.",
    },
  };
}

function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const lambda1 = toRad(lng1);
  const lambda2 = toRad(lng2);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  const theta = Math.atan2(y, x);
  return Math.round(((toDeg(theta) + 360) % 360) * 100) / 100;
}
