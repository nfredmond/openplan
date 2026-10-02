import { tractMeasurePaint } from "@/lib/cartographic/tract-measure-classes";
import { describe, expect, it } from "vitest";

import {
  buildHoveredTract,
  buildTractMetricPaintExpression,
} from "@/app/(app)/explore/_components/explore-tract-layer-state";
import type { TractMetric } from "@/app/(app)/explore/_components/_types";

const expectedPaintExpressions: Record<TractMetric, unknown[]> = {
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

describe("explore tract layer state", () => {
  it("returns the existing Mapbox paint expression for each tract metric", () => {
    for (const metric of Object.keys(expectedPaintExpressions) as TractMetric[]) {
      expect(buildTractMetricPaintExpression(metric)).toEqual(expectedPaintExpressions[metric]);
    }
  });

  it("builds hovered tract state from feature properties", () => {
    expect(
      buildHoveredTract({
        name: "Downtown tract",
        geoid: "06061000100",
        population: "1200",
        medianIncome: "72500",
        pctMinority: "35",
        pctBelowPoverty: "12",
        zeroVehiclePct: "8",
        transitCommutePct: "4",
        isDisadvantaged: "1",
      })
    ).toEqual({
      name: "Downtown tract",
      geoid: "06061000100",
      population: 1200,
      medianIncome: 72500,
      pctMinority: 35,
      pctBelowPoverty: 12,
      zeroVehiclePct: 8,
      transitCommutePct: 4,
      isDisadvantaged: true,
    });
  });

  it("falls back for missing tract feature properties", () => {
    expect(buildHoveredTract({ NAME: "Fallback tract", GEOID: "06061000200" })).toEqual({
      name: "Fallback tract",
      geoid: "06061000200",
      population: null,
      medianIncome: null,
      pctMinority: null,
      pctBelowPoverty: null,
      zeroVehiclePct: null,
      transitCommutePct: null,
      isDisadvantaged: false,
    });
    expect(buildHoveredTract(null)).toBeNull();
  });

  it("paints a tract with no value in the no-data grey, never as the lowest class", () => {
    for (const metric of ["minority", "poverty", "income"] as const) {
      const expression = buildTractMetricPaintExpression(metric) as unknown[];
      expect(expression[0]).toBe("case");
      expect(expression.at(-1)).toBe("#64748b");
      // `coalesce(..., 0)` is how a missing value became a zero.
      expect(JSON.stringify(expression)).not.toContain('"coalesce"');
    }
  });
});
