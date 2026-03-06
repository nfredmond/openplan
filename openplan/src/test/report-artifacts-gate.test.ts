import { describe, expect, it } from "vitest";
import { evaluateReportArtifactGate } from "@/lib/stage-gates/report-artifacts";

describe("evaluateReportArtifactGate", () => {
  it("returns PASS when all required artifacts are present", () => {
    const result = evaluateReportArtifactGate({
      summary_text: "Analysis summary",
      metrics: {
        overallScore: 71,
        confidence: "high",
        sourceSnapshots: {
          census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
          transit: { fetchedAt: "2025-01-01T00:00:00.000Z" },
          crashes: { fetchedAt: "2025-01-01T00:00:00.000Z" },
        },
      },
    });

    expect(result).toEqual({
      decision: "PASS",
      missingArtifacts: [],
    });
  });

  it("returns HOLD and missing artifacts when required fields are absent", () => {
    const result = evaluateReportArtifactGate({
      summary_text: " ",
      metrics: {
        overallScore: 71,
        sourceSnapshots: {
          census: { fetchedAt: "2025-01-01T00:00:00.000Z" },
        },
      },
    });

    expect(result.decision).toBe("HOLD");
    expect(result.missingArtifacts).toEqual(
      expect.arrayContaining([
        "summary_text",
        "metrics.confidence",
        "metrics.sourceSnapshots.transit.fetchedAt",
        "metrics.sourceSnapshots.crashes.fetchedAt",
      ])
    );
  });
});
