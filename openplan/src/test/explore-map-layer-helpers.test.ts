import { describe, expect, it } from "vitest";

import {
  buildCrashLayerFilter,
  buildRunTitle,
  getComparisonNarrativeLead,
  prioritizeMapComparisonRows,
} from "@/app/(app)/explore/_components/_helpers";

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
});
