/**
 * E5b — spatial / ecological representativeness SCREENING. Compares the ACS
 * demographics of the tracts engagement respondents came from against the study
 * area's population baseline: "did comments come disproportionately from higher-
 * income / lower-minority *tracts* than the corridor as a whole?"
 *
 * This is ECOLOGICAL — it infers context from geography, NOT from individuals —
 * over a self-selected, small-N, non-probability sample. It is a cue to check
 * outreach reach, never a statistical sample, a representativeness finding, or a
 * civil-rights determination. The pure math lives here (population- vs
 * respondent-weighted tract means + point-in-polygon assignment); the route does
 * the external ACS/TIGERweb fetching and caches the result.
 */

import type { CensusTractData } from "@/lib/data-sources/census";

export const REPRESENTATIVENESS_SCREENING_CAVEAT =
  "Ecological (area-based) screening: compares the ACS demographics of the tracts respondents came from against the study-area population baseline. It infers context from geography, not individuals, over a self-selected, small-N, non-probability sample — a cue to check who outreach reached, NOT a statistical sample, a representativeness finding, or a civil-rights determination.";

export type RepresentativenessMetricKey = "minority" | "belowPoverty" | "zeroVehicle" | "transit";

type MetricConfig = {
  key: RepresentativenessMetricKey;
  label: string;
  /** Per-tract value as a percent (0–100), or null when undefined for the tract. */
  value: (tract: CensusTractData) => number | null;
  /** Per-tract baseline weight (the ACS universe for this metric). */
  weight: (tract: CensusTractData) => number;
};

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

const METRICS: MetricConfig[] = [
  { key: "minority", label: "Residents of color (ACS)", value: (t) => t.pctMinority, weight: (t) => t.population },
  { key: "belowPoverty", label: "Residents below poverty", value: (t) => t.pctBelowPoverty, weight: (t) => t.population },
  {
    key: "zeroVehicle",
    label: "Zero-vehicle households",
    value: (t) => rate(t.zeroVehicleHouseholds, t.totalHouseholds),
    weight: (t) => t.totalHouseholds,
  },
  {
    key: "transit",
    label: "Transit commuters",
    value: (t) => rate(t.transitCommuters, t.totalCommuters),
    weight: (t) => t.totalCommuters,
  },
];

export type RepresentativenessMetric = {
  key: RepresentativenessMetricKey;
  label: string;
  /** Study-area population-weighted baseline (0–100), null if undefined. */
  baselinePct: number | null;
  /** Respondent-weighted implied share (0–100), null if no respondents/undefined. */
  respondentPct: number | null;
  /** respondentPct / baselinePct, null if not computable. <1 → under-represented. */
  representationRatio: number | null;
  status: "over" | "under" | "balanced" | "insufficient";
};

export type RepresentativenessResult = {
  metrics: RepresentativenessMetric[];
  /** Respondents assignable to a study-area tract. */
  respondentCount: number;
  /** Tracts in the study area. */
  tractCount: number;
  underRepresented: RepresentativenessMetricKey[];
  caveat: string;
};

/**
 * Where the study-area bbox came from. `project_corridor` (the corridor(s)
 * linked to the campaign's project) is preferred when available: it baselines
 * against who the project AFFECTS, so a comment cluster from one corner no
 * longer shrinks the study area to itself and masks who was never reached.
 * `respondent_extent` is the fallback (buffered bbox of respondent pins).
 */
export type StudyAreaSource = "respondent_extent" | "project_corridor";

/** Union bbox over corridor LineStrings ([lng, lat] pairs). Null when empty. */
export function bboxOfCorridorLines(lines: Array<[number, number][]>): LngLatBbox | null {
  return bboxOfPoints(lines.flat().map(([lng, lat]) => ({ lng, lat })));
}

/** The cached, campaign-level result persisted to representativeness_json. */
export type CampaignRepresentativeness = RepresentativenessResult & {
  computedAt: string;
  /** Approved, geolocated comments considered. */
  locatedRespondentCount: number;
  /** Of those, how many fell inside a study-area tract (== respondentCount). */
  studyAreaSource: StudyAreaSource;
};

export type LngLatBbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

/** Bounding box of respondent points (the engagement footprint), or null if none. */
export function bboxOfPoints(points: Array<{ lng: number; lat: number }>): LngLatBbox | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let any = false;
  for (const point of points) {
    if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) continue;
    any = true;
    minLon = Math.min(minLon, point.lng);
    maxLon = Math.max(maxLon, point.lng);
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
  }
  return any ? { minLon, minLat, maxLon, maxLat } : null;
}

/** Expand a bbox by a degree buffer (≈2 km at 0.02°) so a tight cluster still
 * yields a study area with surrounding tracts to compare against. */
export function bufferBbox(bbox: LngLatBbox, bufferDeg = 0.02): LngLatBbox {
  return {
    minLon: bbox.minLon - bufferDeg,
    minLat: bbox.minLat - bufferDeg,
    maxLon: bbox.maxLon + bufferDeg,
    maxLat: bbox.maxLat + bufferDeg,
  };
}

/** A bbox as a closed GeoJSON Polygon (for the ACS corridor fetch). */
export function bboxToPolygon(bbox: LngLatBbox): { type: "Polygon"; coordinates: number[][][] } {
  return {
    type: "Polygon",
    coordinates: [
      [
        [bbox.minLon, bbox.minLat],
        [bbox.maxLon, bbox.minLat],
        [bbox.maxLon, bbox.maxLat],
        [bbox.minLon, bbox.maxLat],
        [bbox.minLon, bbox.minLat],
      ],
    ],
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Weighted mean of a per-tract percent, skipping tracts with null value or
 * non-positive weight. */
function weightedMean(
  tracts: CensusTractData[],
  valueFn: (t: CensusTractData) => number | null,
  weightFn: (t: CensusTractData) => number
): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const tract of tracts) {
    const value = valueFn(tract);
    const weight = weightFn(tract);
    if (value === null || !(weight > 0)) continue;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Compare respondent-implied tract demographics to the study-area baseline.
 * `respondentCountByGeoid` maps a tract geoid → how many respondents fell in it.
 * `balancedBandPct` (default 0.2) is the ratio band that counts as "balanced".
 */
export function buildRepresentativeness(
  tracts: CensusTractData[],
  respondentCountByGeoid: Map<string, number>,
  options?: { balancedBandPct?: number }
): RepresentativenessResult {
  const band = options?.balancedBandPct ?? 0.2;
  const respondentWeight = (tract: CensusTractData) => respondentCountByGeoid.get(tract.geoid) ?? 0;
  const respondentTotal = tracts.reduce((sum, tract) => sum + respondentWeight(tract), 0);

  const rawMetrics: RepresentativenessMetric[] = METRICS.map((metric) => {
    const baselinePct = weightedMean(tracts, metric.value, metric.weight);
    const respondentPct = respondentTotal > 0 ? weightedMean(tracts, metric.value, respondentWeight) : null;

    let representationRatio: number | null = null;
    let status: RepresentativenessMetric["status"] = "insufficient";
    if (baselinePct !== null && respondentPct !== null && baselinePct > 0) {
      representationRatio = respondentPct / baselinePct;
      status =
        representationRatio < 1 - band ? "under" : representationRatio > 1 + band ? "over" : "balanced";
    }

    return {
      key: metric.key,
      label: metric.label,
      baselinePct: baselinePct === null ? null : round1(baselinePct),
      respondentPct: respondentPct === null ? null : round1(respondentPct),
      representationRatio: representationRatio === null ? null : round2(representationRatio),
      status,
    };
  });

  // A single study tract is a self-comparison — baseline == respondent by
  // construction, so every ratio is 1.00. That is not "balanced", it is
  // insufficient spatial resolution; force it so nothing reads as reassuring.
  const metrics =
    tracts.length < 2 ? rawMetrics.map((metric) => ({ ...metric, status: "insufficient" as const })) : rawMetrics;

  return {
    metrics,
    respondentCount: respondentTotal,
    tractCount: tracts.length,
    underRepresented: metrics.filter((m) => m.status === "under").map((m) => m.key),
    caveat: REPRESENTATIVENESS_SCREENING_CAVEAT,
  };
}

// ---- Point-in-polygon (ray casting) — assign respondent points to tracts ----

type Ring = number[][];

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

type PolygonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/** True if the point is inside the polygon's outer ring and not inside a hole. */
export function pointInPolygon(lng: number, lat: number, geometry: PolygonGeometry): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    if (polygon.length === 0) continue;
    if (!pointInRing(lng, lat, polygon[0])) continue;
    let inHole = false;
    for (let h = 1; h < polygon.length; h += 1) {
      if (pointInRing(lng, lat, polygon[h])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

export type TractFeature = { geoid: string; geometry: PolygonGeometry | null };

/**
 * Assign each respondent point to the first tract whose polygon contains it and
 * return per-geoid respondent counts. Points outside every tract are dropped
 * (they're outside the study area). Pure — the tract polygons come from the
 * route's TIGERweb fetch.
 */
export function assignRespondentsToTracts(
  respondents: Array<{ lng: number; lat: number }>,
  tractFeatures: TractFeature[]
): Map<string, number> {
  const counts = new Map<string, number>();
  const withGeometry = tractFeatures.filter(
    (t): t is TractFeature & { geometry: PolygonGeometry } => t.geometry !== null
  );
  for (const respondent of respondents) {
    if (!Number.isFinite(respondent.lng) || !Number.isFinite(respondent.lat)) continue;
    for (const tract of withGeometry) {
      if (pointInPolygon(respondent.lng, respondent.lat, tract.geometry)) {
        counts.set(tract.geoid, (counts.get(tract.geoid) ?? 0) + 1);
        break;
      }
    }
  }
  return counts;
}
