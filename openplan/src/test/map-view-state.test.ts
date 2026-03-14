import { describe, expect, it } from "vitest";
import {
  formatGeometryAttachmentLabel,
  formatOverlayModeLabel,
  normalizeMapViewState,
  summarizeMapViewState,
} from "@/lib/analysis/map-view-state";

describe("map-view-state helpers", () => {
  it("formats geometry attachments for operator-facing summaries", () => {
    expect(formatGeometryAttachmentLabel("analysis_tracts")).toBe("Analysis tracts");
    expect(formatGeometryAttachmentLabel("analysis_corridor")).toBe("Analysis corridor");
    expect(formatGeometryAttachmentLabel("analysis_crash_points")).toBe("Analysis crash points");
  });

  it("formats overlay modes for operator-facing summaries", () => {
    expect(formatOverlayModeLabel("thematic_overlay")).toBe("Thematic overlay");
    expect(formatOverlayModeLabel("coverage_footprint")).toBe("Coverage footprint");
  });

  it("summarizes active overlay context including mode and geometry", () => {
    const normalized = normalizeMapViewState({
      tractMetric: "poverty",
      showTracts: true,
      showCrashes: true,
      crashSeverityFilter: "fatal",
      crashUserFilter: "pedestrian",
      activeDatasetOverlayId: "11111111-1111-4111-8111-111111111111",
      activeOverlayContext: {
        datasetId: "11111111-1111-4111-8111-111111111111",
        datasetName: "Nevada County SWITRS Severity Layer",
        overlayMode: "thematic_overlay",
        geometryAttachment: "analysis_crash_points",
        thematicMetricKey: "severityBucket",
        thematicMetricLabel: "Crash severity bucket",
        connectorLabel: "SWITRS Local",
      },
    });

    const summary = summarizeMapViewState(normalized);

    expect(summary).toEqual(
      expect.arrayContaining([
        { label: "Project overlay", value: "Nevada County SWITRS Severity Layer · Crash severity bucket" },
        { label: "Overlay mode", value: "Thematic overlay" },
        { label: "Overlay geometry", value: "Analysis crash points" },
      ])
    );
  });
});
