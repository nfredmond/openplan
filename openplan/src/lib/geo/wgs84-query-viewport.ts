/** Canonical WGS84 query window. West > east means crossing the antimeridian. */
export type Wgs84QueryViewport = [west: number, south: number, east: number, north: number];

function readCoordinates(value: unknown): Wgs84QueryViewport | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const entries: unknown[] = [value[0], value[1], value[2], value[3]];
  if (!entries.every(entry => typeof entry === "number" && Number.isFinite(entry))) return null;
  const [west, south, east, north] = entries as number[];
  if (south < -90 || south > 90 || north < -90 || north > 90 || south >= north) return null;
  return [west, south, east, north];
}

/** Read canonical wire coordinates without changing stored-extent semantics. */
export function readWgs84QueryViewport(value: unknown): Wgs84QueryViewport | null {
  const coordinates = readCoordinates(value);
  if (!coordinates) return null;
  const [west, south, east, north] = coordinates;
  if (west < -180 || west > 180 || east < -180 || east > 180
    || west === east || (west === 180 && east === -180)) return null;
  // A seam-touching interval has the same meaning from either world copy.
  return [west === 180 ? -180 : west === 0 ? 0 : west, south === 0 ? 0 : south,
    east === -180 ? 180 : east === 0 ? 0 : east, north === 0 ? 0 : north];
}

/** Blank coordinates are unavailable, not zero. Convert complete numeric tokens. */
export function parseWgs84QueryViewport(raw: string | null): Wgs84QueryViewport | null {
  if (raw === null) return null;
  const parts = raw.split(",");
  if (parts.length !== 4 || parts.some(part => part.trim() === "")) return null;
  return readWgs84QueryViewport(parts.map(part => Number(part.trim())));
}

function canonicalLongitude(longitude: number): number {
  if (longitude >= -180 && longitude <= 180) return longitude;
  const remainder = longitude % 360;
  return remainder < -180 ? remainder + 360 : remainder > 180 ? remainder - 360 : remainder;
}

/** Normalize camera world copies before querying; unreadable bounds stay unavailable. */
export function readCameraWgs84QueryViewport(value: unknown): Wgs84QueryViewport | null {
  const coordinates = readCoordinates(value);
  if (!coordinates) return null;
  const [west, south, east, north] = coordinates;
  if (Math.abs(west) > Number.MAX_SAFE_INTEGER || Math.abs(east) > Number.MAX_SAFE_INTEGER) return null;
  // Reversed canonical endpoints express a crossing; reversed world copies are ambiguous.
  if (west > east) return readWgs84QueryViewport(coordinates);
  const width = east - west;
  if (!Number.isFinite(width) || width <= 0 || width > Number.MAX_SAFE_INTEGER) return null;
  // Preserve a whole world's width before normalizing equivalent longitude endpoints.
  if (width >= 360) return readWgs84QueryViewport([-180, south, 180, north]);
  const viewport = readWgs84QueryViewport([
    canonicalLongitude(west), south, canonicalLongitude(east), north,
  ]);
  // A narrow camera interval must not become a full world through arithmetic collapse.
  if (viewport?.[0] === -180 && viewport[2] === 180) return null;
  return viewport;
}
