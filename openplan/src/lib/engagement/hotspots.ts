/**
 * E3 — screening-grade spatial hotspots of engagement sentiment. The PostGIS
 * function `engagement_sentiment_hotspots` (migration 20260719000093) does the
 * spatial clustering (ST_ClusterDBSCAN) and the raw arithmetic of a one-sample
 * proportion z (cluster negative-share vs the workspace/campaign baseline). This
 * module does the HONESTY layer that keeps the claim screening-grade:
 *
 *   - Bonferroni adjustment across the number of clusters actually tested (many
 *     clusters vs one baseline inflates false positives).
 *   - A minimum expected-count gate (n·P ≥ 5) so the normal approximation behind
 *     the z is not applied where it is invalid.
 *   - A single screening caveat stamped on every result.
 *
 * Sentiment is NOT a database column: it is AI-derived from the E1 synthesis
 * (`ai_synthesis_json`) and supplied to the RPC as the negative-item id set. It
 * is a proxy, never ground truth. Nothing here is an inferential or
 * representativeness finding — it is a signal for a planner to investigate.
 *
 * Pure/deterministic (except `loadSentimentHotspots`, which takes an injected
 * Supabase client and is unit-tested with a fake), so the stats are testable.
 */

import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";
import { buildSentimentByItemId } from "@/lib/engagement/corridor-join";

export const HOTSPOT_DEFAULT_EPS_METERS = 250;
export const HOTSPOT_DEFAULT_MIN_POINTS = 5;
export const HOTSPOT_DEFAULT_ALPHA = 0.05;
/** Normal-approximation validity for a proportion: only test clusters where the
 * expected count in BOTH cells under the baseline — n·P (negatives) and n·(1−P)
 * (non-negatives) — is at least this. Checking only n·P would let the normal
 * approximation over-flag in high-baseline-negativity campaigns (where the exact
 * binomial upper tail is not significant). */
export const HOTSPOT_MIN_EXPECTED_NEGATIVE = 5;

export const HOTSPOT_SCREENING_CAVEAT =
  "Screening-grade spatial hotspots: DBSCAN clusters of resident pins, each tested for an elevated share of negative-sentiment comments versus the campaign baseline. Sentiment is AI-derived (a proxy, not ground truth). Significance is Bonferroni-adjusted across the clusters tested and gated to clusters with a large enough expected count — a signal to investigate, NOT an inferential or representativeness finding.";

/** One row as returned by the `engagement_sentiment_hotspots` RPC. Numeric
 * columns may arrive as strings (bigint) depending on the transport, so every
 * consumer coerces with Number(). */
export type RawHotspotCluster = {
  cluster_id: number | string;
  n_items: number | string;
  n_negative: number | string;
  cluster_negative_share: number | string | null;
  global_negative_share: number | string | null;
  z_score: number | string | null;
  centroid_lng: number | string | null;
  centroid_lat: number | string | null;
  footprint_geojson: string | null;
  item_ids: string[] | null;
};

export type HotspotFootprint =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type HotspotCluster = {
  clusterId: number;
  nItems: number;
  nNegative: number;
  /** Cluster's negative share, 0–100 (null when sentiment unavailable). */
  clusterNegativeSharePct: number | null;
  /** Baseline negative share across all approved pins, 0–100. */
  globalNegativeSharePct: number | null;
  /** Raw one-sample proportion z (positive → more negative than baseline). */
  zScore: number | null;
  /** True only when testable AND z ≥ the Bonferroni-adjusted critical z. */
  significant: boolean;
  /** The normal approximation was valid for this cluster (expected count gate). */
  testable: boolean;
  /** [lng, lat] cluster centroid. */
  centroid: [number, number] | null;
  /** Buffered convex hull — an indicative extent, not a precise boundary. */
  footprint: HotspotFootprint | null;
  itemIds: string[];
};

export type HotspotAnalysis = {
  clusters: HotspotCluster[];
  clusterCount: number;
  significantCount: number;
  /** Clusters that cleared the expected-count gate (the multiple-comparison n). */
  testedCount: number;
  epsMeters: number;
  minPoints: number;
  alpha: number;
  /** Bonferroni-adjusted upper-tail critical z used for the significance flag. */
  zCritical: number | null;
  globalNegativeSharePct: number | null;
  /** Whether any AI-derived negative sentiment was supplied (else z is undefined). */
  sentimentAvailable: boolean;
  caveat: string;
};

/**
 * Acklam's rational approximation of the inverse standard-normal CDF
 * (|error| < 1.15e-9). Used to turn a Bonferroni-adjusted significance level
 * into a critical z threshold. This is a fixed statistical constant (a
 * threshold), NOT a per-observation p-value manufactured from a z — we
 * deliberately never do the latter (Postgres has no normal CDF either).
 */
export function inverseStandardNormalCdf(p: number): number {
  if (Number.isNaN(p)) return Number.NaN;
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0,
    4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/** Upper-tail critical z: the value z* with P(Z > z*) = pUpper. */
export function upperTailCriticalZ(pUpper: number): number {
  return inverseStandardNormalCdf(1 - pUpper);
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function parseFootprint(raw: string | null): HotspotFootprint | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "type" in parsed &&
      "coordinates" in parsed &&
      Array.isArray((parsed as { coordinates: unknown }).coordinates)
    ) {
      const type = (parsed as { type: unknown }).type;
      if (type === "Polygon" || type === "MultiPolygon") {
        return parsed as HotspotFootprint;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** The negative-sentiment item ids across one or more campaign syntheses — the
 * set passed to the RPC as `p_negative_item_ids`. */
export function negativeItemIdsFromSyntheses(
  syntheses: Array<EngagementSynthesis | null | undefined>
): string[] {
  const bySentiment = buildSentimentByItemId(syntheses);
  const out: string[] = [];
  for (const [itemId, sentiment] of bySentiment) {
    if (sentiment === "negative") out.push(itemId);
  }
  return out;
}

export function classifyHotspots(
  raw: RawHotspotCluster[],
  options: {
    epsMeters?: number;
    minPoints?: number;
    alpha?: number;
    minExpectedNegative?: number;
    sentimentAvailable: boolean;
  }
): HotspotAnalysis {
  const alpha = options.alpha ?? HOTSPOT_DEFAULT_ALPHA;
  const minExpected = options.minExpectedNegative ?? HOTSPOT_MIN_EXPECTED_NEGATIVE;
  const epsMeters = options.epsMeters ?? HOTSPOT_DEFAULT_EPS_METERS;
  const minPoints = options.minPoints ?? HOTSPOT_DEFAULT_MIN_POINTS;

  const globalShare =
    raw.map((r) => toNumber(r.global_negative_share)).find((v) => v !== null) ?? null;

  const prelim = raw.map((r) => {
    const nItems = toNumber(r.n_items) ?? 0;
    const nNeg = toNumber(r.n_negative) ?? 0;
    const z = toNumber(r.z_score);
    // Both-cell expected-count rule for the normal approximation to a
    // proportion: n·P ≥ 5 AND n·(1−P) ≥ 5.
    const expectedNeg = globalShare === null ? 0 : nItems * globalShare;
    const expectedNonNeg = globalShare === null ? 0 : nItems * (1 - globalShare);
    const testable =
      options.sentimentAvailable &&
      z !== null &&
      globalShare !== null &&
      expectedNeg >= minExpected &&
      expectedNonNeg >= minExpected;
    return { r, nItems, nNeg, z, testable };
  });

  const testedCount = prelim.filter((p) => p.testable).length;
  // One-sided (we flag ELEVATED negativity), Bonferroni-adjusted across the
  // clusters actually tested. No testable clusters → no threshold, no flags.
  const zCritical = testedCount > 0 ? upperTailCriticalZ(alpha / testedCount) : null;

  const clusters: HotspotCluster[] = prelim.map((p) => {
    const clusterShare = toNumber(p.r.cluster_negative_share);
    const significant = Boolean(p.testable && zCritical !== null && p.z !== null && p.z >= zCritical);
    const lng = toNumber(p.r.centroid_lng);
    const lat = toNumber(p.r.centroid_lat);
    return {
      clusterId: toNumber(p.r.cluster_id) ?? 0,
      nItems: p.nItems,
      nNegative: p.nNeg,
      clusterNegativeSharePct:
        options.sentimentAvailable && clusterShare !== null ? Math.round(clusterShare * 100) : null,
      globalNegativeSharePct:
        options.sentimentAvailable && globalShare !== null ? Math.round(globalShare * 100) : null,
      zScore: p.z === null ? null : roundTo(p.z, 2),
      significant,
      testable: p.testable,
      centroid: lng !== null && lat !== null ? [lng, lat] : null,
      footprint: parseFootprint(p.r.footprint_geojson),
      itemIds: Array.isArray(p.r.item_ids) ? p.r.item_ids : [],
    };
  });

  // z desc, nulls last — the most-elevated hotspot first.
  clusters.sort((a, b) => (b.zScore ?? Number.NEGATIVE_INFINITY) - (a.zScore ?? Number.NEGATIVE_INFINITY));

  return {
    clusters,
    clusterCount: clusters.length,
    significantCount: clusters.filter((c) => c.significant).length,
    testedCount,
    epsMeters,
    minPoints,
    alpha,
    zCritical: zCritical === null ? null : roundTo(zCritical, 3),
    globalNegativeSharePct:
      options.sentimentAvailable && globalShare !== null ? Math.round(globalShare * 100) : null,
    sentimentAvailable: options.sentimentAvailable,
    caveat: HOTSPOT_SCREENING_CAVEAT,
  };
}

export type HotspotFeature = {
  type: "Feature";
  geometry: HotspotFootprint;
  properties: {
    clusterId: number;
    zScore: number | null;
    significant: boolean;
    negativeSharePct: number | null;
    nItems: number;
  };
};

export type HotspotFeatureCollection = {
  type: "FeatureCollection";
  features: HotspotFeature[];
};

/** GeoJSON FeatureCollection of cluster footprints for the Mapbox fill layer.
 * Clusters with no parseable footprint are skipped. */
export function hotspotsToFeatureCollection(clusters: HotspotCluster[]): HotspotFeatureCollection {
  return {
    type: "FeatureCollection",
    features: clusters
      .filter((c): c is HotspotCluster & { footprint: HotspotFootprint } => c.footprint !== null)
      .map((c) => ({
        type: "Feature" as const,
        geometry: c.footprint,
        properties: {
          clusterId: c.clusterId,
          zScore: c.zScore,
          significant: c.significant,
          negativeSharePct: c.clusterNegativeSharePct,
          nItems: c.nItems,
        },
      })),
  };
}

function emptyAnalysis(opts: {
  epsMeters: number;
  minPoints: number;
  alpha: number;
  sentimentAvailable: boolean;
}): HotspotAnalysis {
  return {
    clusters: [],
    clusterCount: 0,
    significantCount: 0,
    testedCount: 0,
    epsMeters: opts.epsMeters,
    minPoints: opts.minPoints,
    alpha: opts.alpha,
    zCritical: null,
    globalNegativeSharePct: null,
    sentimentAvailable: opts.sentimentAvailable,
    caveat: HOTSPOT_SCREENING_CAVEAT,
  };
}

type RpcClientLike = {
  rpc: (
    fn: string,
    params: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Call the `engagement_sentiment_hotspots` RPC (SECURITY INVOKER → the caller's
 * RLS scopes it) and classify the rows. Takes an injected Supabase client so it
 * is testable with a fake. On RPC error returns an empty analysis + the message.
 */
export async function loadSentimentHotspots(
  supabase: unknown,
  params: {
    workspaceId: string;
    campaignId?: string | null;
    negativeItemIds: string[];
    epsMeters?: number;
    minPoints?: number;
    alpha?: number;
  }
): Promise<{ analysis: HotspotAnalysis; error: string | null }> {
  const epsMeters = params.epsMeters ?? HOTSPOT_DEFAULT_EPS_METERS;
  const minPoints = params.minPoints ?? HOTSPOT_DEFAULT_MIN_POINTS;
  const alpha = params.alpha ?? HOTSPOT_DEFAULT_ALPHA;
  const sentimentAvailable = params.negativeItemIds.length > 0;

  const client = supabase as RpcClientLike;
  const { data, error } = await client.rpc("engagement_sentiment_hotspots", {
    p_workspace_id: params.workspaceId,
    p_eps_meters: epsMeters,
    p_min_points: minPoints,
    p_negative_item_ids: params.negativeItemIds,
    p_campaign_id: params.campaignId ?? null,
  });

  if (error) {
    return {
      analysis: emptyAnalysis({ epsMeters, minPoints, alpha, sentimentAvailable }),
      error: error.message,
    };
  }

  const rawRows = (Array.isArray(data) ? data : []) as RawHotspotCluster[];
  return {
    analysis: classifyHotspots(rawRows, { epsMeters, minPoints, alpha, sentimentAvailable }),
    error: null,
  };
}
