import type { ExpressionSpecification } from "mapbox-gl";
import { tractMeasurePaint } from "@/lib/cartographic/tract-measure-classes";
import { coerceNumber } from "./_helpers";
import type { HoveredTract, TractMetric } from "./_types";

const TRACT_METRIC_PAINT_EXPRESSIONS: Record<TractMetric, ExpressionSpecification> = {
  minority: tractMeasurePaint("pctMinority"),
  poverty: tractMeasurePaint("pctBelowPoverty"),
  income: tractMeasurePaint("medianIncome"),
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
