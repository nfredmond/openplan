import { describe, expect, it } from "vitest";

import {
  buildHoveredTract,
  buildTractMetricPaintExpression,
} from "@/app/(app)/explore/_components/explore-tract-layer-state";
import type { TractMetric } from "@/app/(app)/explore/_components/_types";

const expectedPaintExpressions: Record<TractMetric, unknown[]> = {
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
});
