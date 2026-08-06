import {
  resolveTransitMethod,
  transitComparabilityRefusal,
} from "@/lib/data-sources/transit/method";

export type MetricDelta = {
  key: string;
  label: string;
  current: number | null;
  baseline: number | null;
  delta: number | null;
  deltaPct: number | null;
  /**
   * True when both runs carry a number and subtracting them would describe
   * something other than the corridor.
   *
   * A NULL DELTA ALREADY EXISTS AND IS NOT THE SAME THING. A null delta means
   * one of the two runs has no value ("N/A"); this means BOTH have one and the
   * two were produced by different measurements, so the difference between them
   * is an artefact of the method. Rendering it would be worse than rendering
   * nothing, because a reader has no way to tell the two apart.
   */
  incomparable: boolean;
  /** Why, in one sentence a planner can act on. Null when comparable. */
  incomparableReason: string | null;
};

const COMPARISON_METRICS: Array<{ key: string; label: string }> = [
  { key: "overallScore", label: "Overall Score" },
  { key: "accessibilityScore", label: "Accessibility Score" },
  { key: "safetyScore", label: "Safety Score" },
  { key: "equityScore", label: "Equity Score" },
  { key: "totalTransitStops", label: "Transit Stops" },
  { key: "totalFatalCrashes", label: "Fatal Crashes" },
  { key: "pctDisadvantaged", label: "Disadvantaged Tracts (%) — ACS proxy" },
  { key: "pctZeroVehicle", label: "Zero-Vehicle Households (%)" },
];

/**
 * THE METRICS A CHANGE OF TRANSIT MEASUREMENT MAKES INCOMPARABLE.
 *
 * `totalTransitStops` is the obvious one: an OpenStreetMap tally counts mapped
 * objects — platforms, stop positions, both kerbs of a street where somebody
 * traced both — while a GTFS feed counts the stops its own schedule calls at.
 * The gap between the two is a mapping artefact, and "Transit Stops: +412
 * (+38%)" states that service grew.
 *
 * THE TWO SCORES ARE HERE FOR A REASON THAT IS EASY TO ARGUE AWAY AND SHOULD
 * NOT BE. `accessibilityScore` carries the transit term directly, so a change of
 * method moves it by up to nine points with nothing about the corridor having
 * changed; `overallScore` is 35% accessibility, so it moves with it. Leaving
 * them comparable would keep the headline tiles subtractable and put exactly the
 * misleading number back on the most-read part of the card — which is where a
 * planner takes their first read, and the one they screenshot.
 *
 * `safetyScore`, `equityScore` and the census metrics are NOT here, because
 * nothing about them changes with the transit source. Marking them would train a
 * reader to ignore the flag, which is how a caveat stops working.
 */
export const TRANSIT_SENSITIVE_METRIC_KEYS = new Set([
  "totalTransitStops",
  "accessibilityScore",
  "overallScore",
]);

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

type MetricsRecord = Record<string, unknown>;

export function buildMetricDeltas(
  currentMetrics: MetricsRecord,
  baselineMetrics: MetricsRecord
): MetricDelta[] {
  // Read once per comparison rather than once per metric: both runs record their
  // own transit method, and whether the two agree is a property of the PAIR.
  const transitRefusal = transitComparabilityRefusal(
    resolveTransitMethod(currentMetrics),
    resolveTransitMethod(baselineMetrics)
  );

  return COMPARISON_METRICS.map(({ key, label }) => {
    const current = asNumber(currentMetrics[key]);
    const baseline = asNumber(baselineMetrics[key]);
    const incomparableReason =
      transitRefusal !== null && TRANSIT_SENSITIVE_METRIC_KEYS.has(key) ? transitRefusal : null;

    if (current === null || baseline === null || incomparableReason !== null) {
      return {
        key,
        label,
        current,
        baseline,
        delta: null,
        deltaPct: null,
        incomparable: incomparableReason !== null,
        incomparableReason,
      } satisfies MetricDelta;
    }

    const delta = Math.round((current - baseline) * 100) / 100;
    const deltaPct = baseline !== 0 ? Math.round(((current - baseline) / baseline) * 1000) / 10 : null;

    return {
      key,
      label,
      current,
      baseline,
      delta,
      deltaPct,
      incomparable: false,
      incomparableReason: null,
    } satisfies MetricDelta;
  });
}

export function formatDelta(delta: number | null): string {
  if (delta === null) return "N/A";
  if (delta > 0) return `+${delta}`;
  return `${delta}`;
}

/**
 * How a delta reads on the card.
 *
 * `incomparable` is a FOURTH state and not a flavour of `na`. "N/A" means one of
 * the runs had no number; this means both did and they may not be subtracted, so
 * the card owes the reader a sentence rather than two letters.
 */
export function deltaTone(delta: number | null): "up" | "down" | "flat" | "na" {
  if (delta === null) return "na";
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}
