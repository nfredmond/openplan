import type { ExpressionSpecification } from "mapbox-gl";
import { coerceNumber } from "./_helpers";
import type { HoveredTract, TractMetric } from "./_types";

const TRACT_METRIC_PAINT_EXPRESSIONS: Record<TractMetric, ExpressionSpecification> = {
  minority: [
    "interpolate",
    ["linear"],
    ["coalesce", ["to-number", ["get", "pctMinority"]], 0],
    0,
    "#123047",
    30,
    "#1d4ed8",
    55,
    "#2563eb",
    75,
    "#0f766e",
    100,
    "#34d399",
  ],
  poverty: [
    "interpolate",
    ["linear"],
    ["coalesce", ["to-number", ["get", "pctBelowPoverty"]], 0],
    0,
    "#0b3b2e",
    10,
    "#15803d",
    20,
    "#65a30d",
    30,
    "#ca8a04",
    45,
    "#b91c1c",
  ],
  income: [
    "interpolate",
    ["linear"],
    ["coalesce", ["to-number", ["get", "medianIncome"]], 0],
    0,
    "#7f1d1d",
    45000,
    "#b45309",
    70000,
    "#0f766e",
    100000,
    "#0ea5e9",
    150000,
    "#e0f2fe",
  ],
  disadvantaged: [
    "case",
    ["==", ["coalesce", ["to-number", ["get", "isDisadvantaged"]], 0], 1],
    "#ef4444",
    "#1f2937",
  ],
};

export function buildTractMetricPaintExpression(tractMetric: TractMetric): ExpressionSpecification {
  return TRACT_METRIC_PAINT_EXPRESSIONS[tractMetric];
}

export function buildHoveredTract(properties: Record<string, unknown> | null | undefined): HoveredTract | null {
  if (!properties) {
    return null;
  }

  return {
    name: String(properties.name ?? properties.NAME ?? "Census tract"),
    geoid: String(properties.geoid ?? properties.GEOID ?? "Unknown"),
    population: coerceNumber(properties.population),
    medianIncome: coerceNumber(properties.medianIncome),
    pctMinority: coerceNumber(properties.pctMinority),
    pctBelowPoverty: coerceNumber(properties.pctBelowPoverty),
    zeroVehiclePct: coerceNumber(properties.zeroVehiclePct),
    transitCommutePct: coerceNumber(properties.transitCommutePct),
    isDisadvantaged: coerceNumber(properties.isDisadvantaged) === 1,
  };
}
