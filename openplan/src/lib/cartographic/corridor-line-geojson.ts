export type CorridorLineGeoJson = {
  type: "LineString";
  coordinates: [number, number][];
};

export function isCorridorLineGeoJson(value: unknown): value is CorridorLineGeoJson {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== "LineString") return false;
  if (!Array.isArray(candidate.coordinates) || candidate.coordinates.length < 2) return false;
  for (const position of candidate.coordinates) {
    if (!Array.isArray(position) || position.length < 2) return false;
    const [lng, lat] = position;
    if (typeof lng !== "number" || typeof lat !== "number") return false;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
  }
  return true;
}
