/**
 * Shared ArcGIS REST query paging for state crash layers.
 *
 * Several state DOTs publish crash points as an ArcGIS FeatureServer or
 * MapServer layer. Each one becomes its own adapter with its own descriptor;
 * this file only holds the transport they share: an envelope query in
 * longitude/latitude, an explicit field list, and paging by `resultOffset`.
 *
 * TWO FAILURE SHAPES, ONE ANSWER. ArcGIS answers a broken query with HTTP 200
 * and an `{ "error": … }` body, and a stopped service the same way. A body
 * without `features` (or without `count`) is therefore never read as "no
 * crashes": it throws `CrashSourceUnavailableError`, exactly like a network
 * failure. Only a well-formed empty `features` array is a finding.
 *
 * NO `outFields=*`. The field list is the contract, as for CCRS: a field that
 * is not requested cannot reach a cache, a retry log or an error message.
 */

import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import { CrashSourceUnavailableError } from "./types";

type ArcgisErrorBody = { error?: { code?: unknown; message?: unknown } };

type ArcgisCountBody = ArcgisErrorBody & { count?: unknown };

type ArcgisFeatureBody = ArcgisErrorBody & {
  features?: Array<{ attributes?: Record<string, unknown>; geometry?: { x?: unknown; y?: unknown } | null }>;
  exceededTransferLimit?: unknown;
};

export type ArcgisCrashFeature = {
  attributes: Record<string, unknown>;
  /** Point geometry in EPSG:4326, or null when the feature has none. */
  longitude: number | null;
  latitude: number | null;
};

export type ArcgisCrashQuery = {
  sourceId: string;
  /** Layer URL ending in `/FeatureServer/<n>` or `/MapServer/<n>`. */
  layerUrl: string;
  /** SQL-92 WHERE clause; must already be safe (no caller-supplied text). */
  where: string;
  bbox: StudyAreaBbox;
  signal?: AbortSignal;
};

const REQUEST_TIMEOUT_MS = 30_000;

function describeError(body: ArcgisErrorBody | null): string | null {
  if (body === null) return "no response";
  if (body.error) {
    const message = typeof body.error.message === "string" ? body.error.message : "unspecified error";
    return `ArcGIS error: ${message}`;
  }
  return null;
}

function envelopeParams(bbox: StudyAreaBbox): Record<string, string> {
  return {
    geometry: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
  };
}

function queryUrl(layerUrl: string, params: Record<string, string>): string {
  return `${layerUrl}/query?${new URLSearchParams({ ...params, f: "json" }).toString()}`;
}

/** How many features in the envelope satisfy `where`. Throws when the layer does not answer. */
export async function countArcgisCrashes(query: ArcgisCrashQuery): Promise<number> {
  const body = await fetchJsonWithRetry<ArcgisCountBody>(
    queryUrl(query.layerUrl, { where: query.where, ...envelopeParams(query.bbox), returnCountOnly: "true" }),
    query.signal ? { signal: query.signal } : undefined,
    { timeoutMs: REQUEST_TIMEOUT_MS, retries: 1 }
  );
  const problem = describeError(body);
  if (problem) throw new CrashSourceUnavailableError(query.sourceId, `Crash layer count failed: ${problem}`);
  const count = body?.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw new CrashSourceUnavailableError(query.sourceId, "Crash layer count answered without a count");
  }
  return count;
}

function toCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Page through every matching feature, up to `limit`, ordered by `orderBy`.
 *
 * `pageSize` must not exceed the layer's own `maxRecordCount`; a layer that
 * returns fewer rows than asked while setting `exceededTransferLimit` is still
 * paged on, so a smaller server cap cannot truncate silently.
 */
export async function fetchArcgisCrashFeatures(
  query: ArcgisCrashQuery & { outFields: readonly string[]; orderBy: string; pageSize: number; limit: number }
): Promise<{ features: ArcgisCrashFeature[]; truncated: boolean }> {
  const features: ArcgisCrashFeature[] = [];
  let offset = 0;

  while (features.length < query.limit) {
    const want = Math.min(query.pageSize, query.limit - features.length);
    const body = await fetchJsonWithRetry<ArcgisFeatureBody>(
      queryUrl(query.layerUrl, {
        where: query.where,
        ...envelopeParams(query.bbox),
        outFields: query.outFields.join(","),
        returnGeometry: "true",
        outSR: "4326",
        orderByFields: query.orderBy,
        resultOffset: String(offset),
        resultRecordCount: String(want),
      }),
      query.signal ? { signal: query.signal } : undefined,
      { timeoutMs: REQUEST_TIMEOUT_MS, retries: 1 }
    );
    const problem = describeError(body);
    if (problem) throw new CrashSourceUnavailableError(query.sourceId, `Crash layer query failed: ${problem}`);
    if (!Array.isArray(body?.features)) {
      throw new CrashSourceUnavailableError(query.sourceId, "Crash layer query answered without features");
    }

    for (const feature of body.features) {
      features.push({
        attributes: feature.attributes ?? {},
        longitude: toCoordinate(feature.geometry?.x),
        latitude: toCoordinate(feature.geometry?.y),
      });
    }

    const more = body.exceededTransferLimit === true || body.features.length === want;
    if (body.features.length === 0 || !more) return { features, truncated: false };
    offset += body.features.length;
  }

  return { features, truncated: true };
}
