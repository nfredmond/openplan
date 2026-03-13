import { describe, expect, it } from "vitest";
import { flattenMetricsForCsv, serializeMetricsToCsv } from "@/lib/export/download";

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
});
