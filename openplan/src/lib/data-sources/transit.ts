/**
 * Transit accessibility helper (MVP)
 *
 * Uses OpenStreetMap Overpass API to count transit stops and stations
 * within the corridor bounding box. This provides a lightweight proxy
 * for GTFS accessibility until full GTFS feed ingestion lands.
 *
 * NO ESTIMATE TIER. When Overpass does not answer, this returns an unobserved
 * summary and the accessibility score is computed without a transit term —
 * it does not invent one.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The previous fallback manufactured
 * `area x 2.5` stops with a fixed 85/10/5 bus/rail/ferry split, derived an
 * `accessTier` from that constant, and fed `stopsPerSqMile` into
 * `computeAccessibility` — up to 20 of the accessibility score's points — which
 * then flowed into the corridor composite and out into grant-ready reports. A
 * planner in a rural county with no Overpass coverage got a transit density
 * indistinguishable from a measured one. `crashes.ts` refuses exactly this
 * trade, and states why; transit now matches it.
 */

import { fetchJsonWithRetry } from "./http";

export interface TransitAccessSummary {
  /**
   * True when a transit source answered. False means nothing was counted —
   * which is not the same as counting zero stops, and must not read as it.
   */
  observed: boolean;
  /** Null when unobserved. Zero is reserved for "we looked and found none". */
  totalStops: number | null;
  busStops: number | null;
  railStations: number | null;
  ferryStops: number | null;
  stopsPerSqMile: number | null;
  /** Null when unobserved: a tier derived from no measurement is not a finding. */
  accessTier: "high" | "medium" | "low" | null;
  source: "osm-overpass" | "unavailable";
  /** Why nothing was counted, in planner terms. Null when observed. */
  unavailableReason: string | null;
}

export const TRANSIT_UNAVAILABLE_REASON =
  "The OpenStreetMap Overpass service did not respond, so transit stops could not be counted for this area. This is not a finding that the area has no transit.";

interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

function bboxAreaSqMiles(bbox: BBox): number {
  const latMid = (bbox.minLat + bbox.maxLat) / 2;
  const latDist = Math.abs(bbox.maxLat - bbox.minLat) * 69.0;
  const lonDist = Math.abs(bbox.maxLon - bbox.minLon) * 69.0 * Math.cos((latMid * Math.PI) / 180);
  return Math.max(0.01, latDist * lonDist);
}

function classifyTier(stopsPerSqMile: number): "high" | "medium" | "low" {
  if (stopsPerSqMile >= 8) return "high";
  if (stopsPerSqMile >= 3) return "medium";
  return "low";
}

export async function fetchTransitAccessForBbox(bbox: BBox): Promise<TransitAccessSummary> {
  const area = bboxAreaSqMiles(bbox);

  // Overpass QL (bbox ordering: south,west,north,east)
  const query = `
[out:json][timeout:20];
(
  node["highway"="bus_stop"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});
  node["public_transport"="stop_position"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});
  node["railway"="station"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});
  node["amenity"="ferry_terminal"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});
);
out tags center;
`;

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  for (const endpoint of endpoints) {
    const data = await fetchJsonWithRetry<{ elements?: Array<{ id?: number; lat?: number; lon?: number; tags?: Record<string, string> }> }>(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      },
      {
        timeoutMs: 15000,
        retries: 1,
        // Overpass interpreter requests are read-only queries sent via POST.
        // Explicit opt-in keeps transient retry behavior after the idempotency guardrail.
        retryNonIdempotentMethods: true,
        cacheTtlMs: 5 * 60 * 1000,
        cacheKey: `overpass:${endpoint}:${bbox.minLat.toFixed(4)}:${bbox.minLon.toFixed(4)}:${bbox.maxLat.toFixed(4)}:${bbox.maxLon.toFixed(4)}`,
      }
    );

    if (!data?.elements) {
      continue;
    }

    const stopKeys = new Set<string>();
    const busStopKeys = new Set<string>();
    const railStationKeys = new Set<string>();
    const ferryStopKeys = new Set<string>();

    for (const el of data.elements) {
      const tags = el.tags ?? {};
      const key =
        typeof el.id === "number"
          ? `node:${el.id}`
          : `pt:${(el.lat ?? 0).toFixed(6)}:${(el.lon ?? 0).toFixed(6)}`;

      const isBus = tags.highway === "bus_stop" || tags.public_transport === "stop_position";
      const isRail = tags.railway === "station";
      const isFerry = tags.amenity === "ferry_terminal";

      if (!isBus && !isRail && !isFerry) {
        continue;
      }

      stopKeys.add(key);
      if (isBus) busStopKeys.add(key);
      if (isRail) railStationKeys.add(key);
      if (isFerry) ferryStopKeys.add(key);
    }

    const totalStops = stopKeys.size;
    const busStops = busStopKeys.size;
    const railStations = railStationKeys.size;
    const ferryStops = ferryStopKeys.size;
    const stopsPerSqMile = Math.round((totalStops / area) * 10) / 10;

    return {
      observed: true,
      totalStops,
      busStops,
      railStations,
      ferryStops,
      stopsPerSqMile,
      accessTier: classifyTier(stopsPerSqMile),
      source: "osm-overpass",
      unavailableReason: null,
    };
  }

  // No endpoint answered. Say so; do not synthesize a stop inventory.
  return {
    observed: false,
    totalStops: null,
    busStops: null,
    railStations: null,
    ferryStops: null,
    stopsPerSqMile: null,
    accessTier: null,
    source: "unavailable",
    unavailableReason: TRANSIT_UNAVAILABLE_REASON,
  };
}
