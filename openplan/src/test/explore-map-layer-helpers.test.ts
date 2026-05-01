import { describe, expect, it } from "vitest";

import { buildCrashLayerFilter } from "@/app/(app)/explore/_components/_helpers";

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
});
