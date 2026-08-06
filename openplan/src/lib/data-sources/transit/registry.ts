/**
 * Transit-source registry + resolver.
 *
 * Adapters are ordered STRONGEST EVIDENCE FIRST, and the order is the whole
 * policy: an agency's own published schedule beats a community-mapped inventory
 * of stop objects, so `gtfs-feed` is asked before `osm-overpass`. Coverage grows
 * by adding an entry here — a national fare/feed aggregator, a workspace's
 * uploaded stop inventory — and never by editing `/api/analysis`.
 *
 * There is deliberately no estimator and no fallback tier anywhere in this
 * registry. A study area either has an observed transit source or is told
 * plainly that it does not. See `types.ts` for the fabricated stop inventory
 * this posture replaced.
 */

import { gtfsFeedAdapter } from "./gtfs-feed";
import { osmOverpassAdapter } from "./osm-overpass";
import type { TransitSourceAdapter } from "./types";

/**
 * Registered transit adapters, in resolution order.
 *
 * A REGISTRY WITH ONE ENTRY IS A HARDCODED VALUE WITH A NICER NAME, and this
 * repository has been burned by exactly that. Two entries is the minimum at
 * which "the caller does not know which source answered" is a property rather
 * than an aspiration, and the pair here differ in every way that matters — one
 * reads the database, one the network; one knows frequency, one does not; one
 * can decline, one cannot.
 */
export const TRANSIT_SOURCE_ADAPTERS: readonly TransitSourceAdapter[] = [
  gtfsFeedAdapter,
  osmOverpassAdapter,
];

export function getTransitSourceById(id: string): TransitSourceAdapter | null {
  return TRANSIT_SOURCE_ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}
