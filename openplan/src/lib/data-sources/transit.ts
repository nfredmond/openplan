/**
 * Transit accessibility helper (MVP)
 *
 * Uses OpenStreetMap Overpass API to count transit stops and stations
 * within the corridor bounding box. This provides a lightweight proxy
 * for GTFS accessibility until full GTFS feed ingestion lands.
 */

import { fetchJsonWithRetry } from "./http";

export interface TransitAccessSummary {
  totalStops: number;
  busStops: number;
  railStations: number;
  ferryStops: number;
  stopsPerSqMile: number;
  accessTier: "high" | "medium" | "low";
  source: "osm-overpass" | "estimate";
}

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
      totalStops,
      busStops,
      railStations,
      ferryStops,
      stopsPerSqMile,
      accessTier: classifyTier(stopsPerSqMile),
      source: "osm-overpass",
    };
  }

  // Fallback estimate for resilience
  const estStops = Math.max(1, Math.round(area * 2.5));
  const stopsPerSqMile = Math.round((estStops / area) * 10) / 10;

  return {
    totalStops: estStops,
    busStops: Math.round(estStops * 0.85),
    railStations: Math.round(estStops * 0.1),
    ferryStops: Math.round(estStops * 0.05),
    stopsPerSqMile,
    accessTier: classifyTier(stopsPerSqMile),
    source: "estimate",
  };
}
