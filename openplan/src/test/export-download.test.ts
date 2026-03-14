import { describe, expect, it } from "vitest";
import {
  flattenMetricsForCsv,
  serializeMetricsToCsv,
  serializeRecordsToCsv,
} from "@/lib/export/download";

describe("export download utilities", () => {
  it("flattens top-level metrics plus nested dataQuality and mapViewState keys", () => {
    const flattened = flattenMetricsForCsv({
      accessibilityScore: 80,
      safetyScore: 76,
      dataQuality: {
        censusAvailable: true,
        crashDataAvailable: false,
        equitySource: "EPA EJScreen",
      },
      mapViewState: {
        crashSeverityFilter: "fatal",
        crashUserFilter: "pedestrian",
      },
    });

    expect(flattened).toEqual({
      accessibilityScore: "80",
      safetyScore: "76",
      "dataQuality.censusAvailable": "true",
      "dataQuality.crashDataAvailable": "false",
      "dataQuality.equitySource": "EPA EJScreen",
      "mapViewState.crashSeverityFilter": "fatal",
      "mapViewState.crashUserFilter": "pedestrian",
    });
  });

  it("serializes metrics to stable CSV with escaping", () => {
    const csv = serializeMetricsToCsv({
      confidence: "high, verified",
      title6Flags: ["Flag A", "Flag B"],
      dataQuality: {
        lodesSource: "raw",
      },
    });

    expect(csv).toContain("confidence,dataQuality.lodesSource,title6Flags");
    expect(csv).toContain("\"high, verified\",raw,\"[\"\"Flag A\"\",\"\"Flag B\"\"]\"");
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("serializes comparison-style records to multi-row CSV", () => {
    const csv = serializeRecordsToCsv([
      {
        rowType: "metric_delta",
        label: "Overall Score",
        current: 81,
        baseline: 75,
        delta: 6,
      },
      {
        rowType: "map_view",
        label: "Crash filter",
        current: "Fatal · Ped only",
        baseline: "All · All users",
        changed: true,
      },
    ]);

    expect(csv).toContain("baseline,changed,current,delta,label,rowType");
    expect(csv).toContain("75,,81,6,Overall Score,metric_delta");
    expect(csv).toContain("All · All users,true,Fatal · Ped only,,Crash filter,map_view");
    expect(csv.endsWith("\n")).toBe(true);
  });
});
