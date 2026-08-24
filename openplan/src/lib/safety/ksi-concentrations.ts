import type { SafetyKsiBounds, SafetyKsiConcentration } from "./client-types";

/** Build the union of valid acquisition extents without inventing a study area. */
export function readSafetyKsiBounds(rows: unknown): SafetyKsiBounds | null {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const bounds = rows.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return [];
    }
    const row = candidate as Record<string, unknown>;
    const minLon = Number(row.min_lon);
    const minLat = Number(row.min_lat);
    const maxLon = Number(row.max_lon);
    const maxLat = Number(row.max_lat);
    if (
      ![minLon, minLat, maxLon, maxLat].every(Number.isFinite) ||
      minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90 ||
      minLon >= maxLon || minLat >= maxLat
    ) {
      return [];
    }
    return [{ minLon, minLat, maxLon, maxLat }];
  });

  if (bounds.length === 0) {
    return null;
  }

  return {
    minLon: Math.min(...bounds.map((bound) => bound.minLon)),
    minLat: Math.min(...bounds.map((bound) => bound.minLat)),
    maxLon: Math.max(...bounds.map((bound) => bound.maxLon)),
    maxLat: Math.max(...bounds.map((bound) => bound.maxLat)),
  };
}

/**
 * Read the untyped PostgREST result from `safety_ksi_concentrations`.
 *
 * The Supabase client is intentionally untyped in this repository, so the RPC
 * boundary has to reject partial or impossible rows before they reach the map.
 */
export function readSafetyKsiConcentrations(rows: unknown): SafetyKsiConcentration[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return [];
    }

    const row = candidate as Record<string, unknown>;
    const rank = Number(row.rank);
    const longitude = Number(row.longitude);
    const latitude = Number(row.latitude);
    const crashCount = Number(row.crash_count);
    const fatalCrashCount = Number(row.fatal_crash_count);
    const seriousInjuryCrashCount = Number(row.serious_injury_crash_count);
    const radiusMeters = Number(row.radius_meters);

    const countsAreWholeAndNonnegative = [
      crashCount,
      fatalCrashCount,
      seriousInjuryCrashCount,
    ].every((value) => Number.isInteger(value) && value >= 0);
    if (
      !Number.isInteger(rank) ||
      rank < 1 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !countsAreWholeAndNonnegative ||
      fatalCrashCount + seriousInjuryCrashCount !== crashCount ||
      !Number.isFinite(radiusMeters) ||
      radiusMeters <= 0
    ) {
      return [];
    }

    return [{
      rank,
      longitude,
      latitude,
      crashCount,
      fatalCrashCount,
      seriousInjuryCrashCount,
      radiusMeters,
    }];
  });
}
