import type {
  SafetyKsiBounds,
  SafetyKsiConcentration,
  SafetyKsiEquityTract,
} from "./client-types";

function nullableFinite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Read the untyped tract-burden RPC without turning missing demographics into zero. */
export function readSafetyKsiEquityTracts(rows: unknown): SafetyKsiEquityTract[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    const rank = Number(row.rank);
    const geoid = typeof row.geoid === "string" ? row.geoid : null;
    const ksiCrashCount = Number(row.ksi_crash_count);
    const fatalCrashCount = Number(row.fatal_crash_count);
    const seriousInjuryCrashCount = Number(row.serious_injury_crash_count);
    if (
      !Number.isInteger(rank) || rank < 1 || !geoid ||
      ![ksiCrashCount, fatalCrashCount, seriousInjuryCrashCount].every(
        (value) => Number.isInteger(value) && value >= 0
      ) ||
      fatalCrashCount + seriousInjuryCrashCount !== ksiCrashCount
    ) return [];
    return [{
      rank,
      geoid,
      tractName: typeof row.tract_name === "string" ? row.tract_name : null,
      ksiCrashCount,
      fatalCrashCount,
      seriousInjuryCrashCount,
      population: nullableFinite(row.population),
      ksiPer100k: nullableFinite(row.ksi_per_100k),
      pctPoverty: nullableFinite(row.pct_poverty),
      pctNonwhite: nullableFinite(row.pct_nonwhite),
      pctZeroVehicle: nullableFinite(row.pct_zero_vehicle),
      areaMedianPctPoverty: nullableFinite(row.area_median_pct_poverty),
      areaMedianPctNonwhite: nullableFinite(row.area_median_pct_nonwhite),
      areaMedianPctZeroVehicle: nullableFinite(row.area_median_pct_zero_vehicle),
    }];
  });
}

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
