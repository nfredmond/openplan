export type MetricDelta = {
  key: string;
  label: string;
  current: number | null;
  baseline: number | null;
  delta: number | null;
  deltaPct: number | null;
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

export function buildMetricDeltas(
  currentMetrics: Record<string, unknown>,
  baselineMetrics: Record<string, unknown>
): MetricDelta[] {
  return COMPARISON_METRICS.map(({ key, label }) => {
    const current = asNumber(currentMetrics[key]);
    const baseline = asNumber(baselineMetrics[key]);

    if (current === null || baseline === null) {
      return {
        key,
        label,
        current,
        baseline,
        delta: null,
        deltaPct: null,
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
    } satisfies MetricDelta;
  });
}

export function formatDelta(delta: number | null): string {
  if (delta === null) return "N/A";
  if (delta > 0) return `+${delta}`;
  return `${delta}`;
}

export function deltaTone(delta: number | null): "up" | "down" | "flat" | "na" {
  if (delta === null) return "na";
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}
