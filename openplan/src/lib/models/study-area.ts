/**
 * Pure helpers for the model study-area picker — kept out of the "use client"
 * component so they can be unit-tested without importing Mapbox.
 */

export type StudyAreaBbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

export type CorridorSummary = {
  valid: boolean;
  bbox: StudyAreaBbox | null;
  areaKm2: number | null;
};

// A bbox extent larger than this (km²) is a big study area: the in-process
// sketch ABM caps at 150 tracts and runs synchronously, so large areas belong
// on the async AequilibraE (Fast Screening) engine and take longer.
export const LARGE_AREA_KM2 = 2500;

export const CONTINENTAL_US_CENTER: [number, number] = [-98.5795, 39.8283];

function walkCoordinates(coordinates: unknown, visit: (lon: number, lat: number) => void): void {
  if (!Array.isArray(coordinates)) return;
  if (coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    visit(coordinates[0] as number, coordinates[1] as number);
    return;
  }
  for (const child of coordinates) {
    walkCoordinates(child, visit);
  }
}

/**
 * Best-effort summary of whatever corridor GeoJSON text is currently set —
 * regardless of whether it came from search, drawing, or a raw paste. Returns
 * a bounding box and an approximate bounding-extent area in km².
 */
export function summarizeCorridorText(text: string): CorridorSummary {
  const trimmed = text.trim();
  if (!trimmed) return { valid: false, bbox: null, areaKm2: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { valid: false, bbox: null, areaKm2: null };
  }

  const geometry = parsed as { type?: string; coordinates?: unknown };
  if (geometry?.type !== "Polygon" && geometry?.type !== "MultiPolygon") {
    return { valid: false, bbox: null, areaKm2: null };
  }

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  walkCoordinates(geometry.coordinates, (lon, lat) => {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  });

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) {
    return { valid: false, bbox: null, areaKm2: null };
  }

  const midLat = (minLat + maxLat) / 2;
  const latKm = (maxLat - minLat) * 111;
  const lonKm = (maxLon - minLon) * 111 * Math.cos((midLat * Math.PI) / 180);
  const areaKm2 = Math.max(0, Math.round(latKm * lonKm));

  return { valid: true, bbox: { minLon, minLat, maxLon, maxLat }, areaKm2 };
}
