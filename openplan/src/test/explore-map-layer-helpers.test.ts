import { describe, expect, it } from "vitest";

import {
  buildPointThematicOverlayColorExpression,
  buildCrashLayerFilter,
  buildRunTitle,
  buildThematicOverlayPaintExpression,
  canRenderDatasetCoverageOverlay,
  canRenderDatasetThematicOverlay,
  coerceNumber,
  formatCurrency,
  formatPercent,
  formatSourceToken,
  getComparisonNarrativeLead,
  prioritizeMapComparisonRows,
} from "@/app/(app)/explore/_components/_helpers";
import type { AnalysisContextResponse } from "@/app/(app)/explore/_components/_types";

type LinkedDataset = AnalysisContextResponse["linkedDatasets"][number];

function buildDataset(overrides: Partial<LinkedDataset> = {}): LinkedDataset {
  return {
    datasetId: "dataset-1",
    name: "Equity screen",
    status: "ready",
    geographyScope: "tract",
    geometryAttachment: "tract",
    thematicMetricKey: "pctBelowPoverty",
    thematicMetricLabel: "Poverty share",
    relationshipType: "project_context",
    vintageLabel: "2022",
    lastRefreshedAt: "2026-04-20T09:00:00.000Z",
    connectorLabel: "Local upload",
    overlayReady: true,
    thematicReady: true,
    ...overrides,
  };
}

describe("explore map layer helpers", () => {
  it("builds crash layer filters for severity and user-type toggles", () => {
    expect(buildCrashLayerFilter("all", "all")).toEqual([
      "all",
      ["==", ["geometry-type"], "Point"],
      ["==", ["get", "kind"], "crash_point"],
    ]);

    expect(buildCrashLayerFilter("fatal", "pedestrian")).toEqual([
      "all",
      ["==", ["geometry-type"], "Point"],
      ["==", ["get", "kind"], "crash_point"],
      ["==", ["get", "severityBucket"], "fatal"],
      ["==", ["get", "pedestrianInvolved"], true],
    ]);

    expect(buildCrashLayerFilter("severe_injury", "bicycle")).toEqual([
      "all",
      ["==", ["geometry-type"], "Point"],
      ["==", ["get", "kind"], "crash_point"],
      ["==", ["get", "severityBucket"], "severe_injury"],
      ["==", ["get", "bicyclistInvolved"], true],
    ]);

    expect(buildCrashLayerFilter("injury", "vru")).toEqual([
      "all",
      ["==", ["geometry-type"], "Point"],
      ["==", ["get", "kind"], "crash_point"],
      ["==", ["get", "severityBucket"], "injury"],
      [
        "any",
        ["==", ["get", "pedestrianInvolved"], true],
        ["==", ["get", "bicyclistInvolved"], true],
      ],
    ]);
  });

  it("keeps run titles usable for saved Explore analyses", () => {
    expect(buildRunTitle("   ")).toBe("Untitled corridor analysis");
    expect(buildRunTitle("  Downtown access check  ")).toBe("Downtown access check");
    expect(buildRunTitle("A".repeat(61))).toBe(`${"A".repeat(57)}...`);
  });

  it("prioritizes changed map comparison rows before unchanged rows", () => {
    const rows = [
      { label: "Overlay mode", current: "Coverage", baseline: "Coverage", changed: false },
      { label: "Alpha", current: "Current", baseline: "Baseline", changed: true },
      { label: "Crash filter", current: "Fatal", baseline: "All", changed: true },
      { label: "Tract theme", current: "Minority", baseline: "Minority", changed: false },
      { label: "Overlay geometry", current: "Tract", baseline: "Corridor", changed: true },
    ];

    const sorted = prioritizeMapComparisonRows(rows);

    expect(sorted.map((row) => row.label)).toEqual([
      "Crash filter",
      "Overlay geometry",
      "Alpha",
      "Tract theme",
      "Overlay mode",
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      "Overlay mode",
      "Alpha",
      "Crash filter",
      "Tract theme",
      "Overlay geometry",
    ]);
  });

  it("selects the comparison narrative lead from metric and map-context movement", () => {
    expect(getComparisonNarrativeLead(2, 0)).toMatchObject({
      title: "Metric movement is supported by aligned map posture.",
      tone: "success",
    });
    expect(getComparisonNarrativeLead(2, 1)).toMatchObject({
      title: "Metric movement is present, but the evidence frame changed.",
      tone: "warning",
    });
    expect(getComparisonNarrativeLead(0, 1)).toMatchObject({
      title: "Scores are flat, but the evidence frame is not.",
      tone: "warning",
    });
    expect(getComparisonNarrativeLead(0, 0)).toMatchObject({
      title: "Both score movement and map posture are stable.",
      tone: "neutral",
    });
  });

  it("formats source tokens and numeric display values for Explore side panels", () => {
    expect(formatSourceToken(undefined)).toBe("Unknown");
    expect(formatSourceToken("switrs-local")).toBe("Switrs Local");
    expect(formatSourceToken("  census__acs---tracts  ")).toBe("Census Acs Tracts");

    expect(formatCurrency(1250000)).toBe("$1,250,000");
    expect(formatCurrency(null)).toBe("N/A");
    expect(formatCurrency(Number.NaN)).toBe("N/A");

    expect(formatPercent(12.5)).toBe("12.5%");
    expect(formatPercent(undefined)).toBe("N/A");

    expect(coerceNumber(42)).toBe(42);
    expect(coerceNumber(" 7.5 ")).toBe(7.5);
    expect(coerceNumber("not-a-number")).toBeNull();
    expect(coerceNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("gates dataset overlay renderability by readiness and geography scope", () => {
    expect(canRenderDatasetCoverageOverlay(buildDataset())).toBe(true);
    expect(canRenderDatasetThematicOverlay(buildDataset())).toBe(true);

    expect(canRenderDatasetCoverageOverlay(buildDataset({ geographyScope: "point" }))).toBe(false);
    expect(canRenderDatasetThematicOverlay(buildDataset({ geographyScope: "point" }))).toBe(true);

    expect(canRenderDatasetCoverageOverlay(buildDataset({ overlayReady: false }))).toBe(false);
    expect(canRenderDatasetThematicOverlay(buildDataset({ thematicReady: false }))).toBe(false);

    expect(canRenderDatasetCoverageOverlay(buildDataset({ geographyScope: "county" }))).toBe(false);
    expect(canRenderDatasetThematicOverlay(buildDataset({ geographyScope: "county" }))).toBe(false);
    expect(canRenderDatasetCoverageOverlay(null)).toBe(false);
    expect(canRenderDatasetThematicOverlay(undefined)).toBe(false);
  });

  it("builds thematic paint expressions for score and point overlay metrics", () => {
    expect(buildThematicOverlayPaintExpression("overallScore")).toEqual([
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", "overallScore"]], 0],
      0,
      "#7f1d1d",
      40,
      "#b45309",
      60,
      "#f59e0b",
      75,
      "#10b981",
      90,
      "#0ea5e9",
    ]);

    expect(buildThematicOverlayPaintExpression(undefined)).toEqual([
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
    ]);

    expect(buildPointThematicOverlayColorExpression("fatalCount")).toEqual([
      "interpolate",
      ["linear"],
      ["coalesce", ["to-number", ["get", "fatalCount"]], 0],
      0,
      "#fbbf24",
      1,
      "#f97316",
      2,
      "#dc2626",
    ]);
    expect(buildPointThematicOverlayColorExpression("pedestrianInvolved")).toEqual([
      "case",
      ["==", ["get", "pedestrianInvolved"], true],
      "#ec4899",
      "#334155",
    ]);
  });
});
