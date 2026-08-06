/**
 * OPENSTREETMAP STOP INVENTORY — the national backstop, unchanged in behaviour.
 *
 * This is the adapter that used to be the whole of `data-sources/transit.ts`.
 * The Overpass query, the de-duplication, the endpoint fallback, the caching key
 * and the density arithmetic are all the same code, moved: a workspace that has
 * ingested no GTFS feed scores today exactly what it scored before the registry
 * existed, and that is a property worth being able to state.
 *
 * WHY IT IS SECOND IN THE REGISTRY AND NOT FIRST. It counts MAPPED OBJECTS, not
 * service. A stop node exists in OpenStreetMap because a volunteer drew it, so
 * the inventory is uneven between places in a way that has nothing to do with
 * transit: a well-mapped town shows platforms, stop positions and both sides of
 * every street, while a poorly-mapped one of identical service shows a third as
 * many. And it says nothing whatsoever about how often anything calls there — a
 * flag stop with two buses a day and a corner with a bus every four minutes are
 * the same node. An agency's own published schedule beats it on both counts,
 * which is why `gtfs-feed` is asked first.
 *
 * NO ESTIMATE TIER. When no endpoint answers, this returns `unavailable` and the
 * accessibility score is computed without a transit term — it does not invent
 * one. See `types.ts` for the fabricated-density defect this posture replaced.
 */

import { fetchJsonWithRetry } from "../http";
import { bboxAreaSquareMiles } from "./bbox";
import { OSM_STOP_INVENTORY_METHOD } from "./method";
import { classifyTransitAccessTier, type TransitFetchContext, type TransitSourceAdapter } from "./types";

export const TRANSIT_UNAVAILABLE_REASON =
  "The OpenStreetMap Overpass service did not respond, so transit stops could not be counted for this area. This is not a finding that the area has no transit.";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

type OverpassElement = { id?: number; lat?: number; lon?: number; tags?: Record<string, string> };

export const osmOverpassAdapter: TransitSourceAdapter = {
  id: "osm-overpass",
  label: "OpenStreetMap stop inventory",
  attribution: "© OpenStreetMap contributors, ODbL.",

  async fetch({ bbox }: TransitFetchContext) {
    const area = bboxAreaSquareMiles(bbox);

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

    for (const endpoint of OVERPASS_ENDPOINTS) {
      const data = await fetchJsonWithRetry<{ elements?: OverpassElement[] }>(
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
      const stopsPerSqMile = Math.round((totalStops / area) * 10) / 10;

      return {
        kind: "answered" as const,
        core: {
          observed: true,
          totalStops,
          busStops: busStopKeys.size,
          railStations: railStationKeys.size,
          ferryStops: ferryStopKeys.size,
          stopsPerSqMile,
          accessTier: classifyTransitAccessTier(stopsPerSqMile),
          source: "osm-overpass" as const,
          unavailableReason: null,
          // OpenStreetMap holds no schedule, so it has no opinion on frequency —
          // not "it could not state one here". That distinction is what keeps
          // this source's runs on the full-density scale they have always been on
          // while a GTFS run that cannot state a share for its area scores that
          // half as zero. See `accessibilityTransitTerm`.
          measuresFrequency: false,
          // Null rather than 0 — see the field's own comment in `types.ts`.
          frequentServiceShare: null,
          frequentServiceStops: null,
          frequentServiceHeadwayMinutes: null,
          // Overpass returns the whole bbox in one response; there is no paging
          // here to stop short, so this can only ever be false.
          truncated: false,
          method: OSM_STOP_INVENTORY_METHOD,
          contributingSources: [{ id: "osm-overpass", label: "OpenStreetMap stop inventory" }],
        },
      };
    }

    // No endpoint answered. Say so; do not synthesize a stop inventory.
    return { kind: "unavailable" as const, reason: TRANSIT_UNAVAILABLE_REASON };
  },
};
