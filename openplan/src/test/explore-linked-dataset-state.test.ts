import { describe, expect, it } from "vitest";

import { buildLinkedDatasetQueueState } from "@/app/(app)/explore/_components/explore-linked-dataset-state";
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
    lastRefreshedAt: null,
    connectorLabel: "Local upload",
    overlayReady: true,
    thematicReady: true,
    ...overrides,
  };
}

describe("buildLinkedDatasetQueueState", () => {
  it("builds active thematic dataset queue state", () => {
    const state = buildLinkedDatasetQueueState({
      datasets: [buildDataset({ lastRefreshedAt: "not-a-date" })],
      activeDatasetOverlayId: "dataset-1",
    });

    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      canRenderCoverage: true,
      isActiveOverlay: true,
      thematicReady: true,
      rowClassName: "module-record-row is-interactive is-selected",
      overlayStatusLabel: "Overlay-ready",
      overlayStatusTone: "success",
      refreshedLabel: "Refreshed not-a-date",
      summary: "Uses real tract geometry + Poverty share.",
      sourceLabel: "Local upload",
      buttonLabel: "Hide thematic",
      buttonVariant: "secondary",
      buttonDisabled: false,
    });
  });

  it("preserves coverage-only copy and manual source fallback", () => {
    const state = buildLinkedDatasetQueueState({
      datasets: [
        buildDataset({
          thematicMetricKey: null,
          thematicMetricLabel: null,
          connectorLabel: null,
          thematicReady: false,
        }),
      ],
      activeDatasetOverlayId: null,
    });

    expect(state.items[0]).toMatchObject({
      rowClassName: "module-record-row is-interactive",
      overlayStatusLabel: "Overlay-ready",
      summary: "Coverage footprint only — dataset values stay honest until a thematic binding exists.",
      sourceLabel: "Manual source",
      buttonLabel: "Show coverage",
      buttonVariant: "outline",
      buttonDisabled: false,
    });
  });

  it("marks registry-only datasets as disabled while keeping existing copy", () => {
    const state = buildLinkedDatasetQueueState({
      datasets: [buildDataset({ overlayReady: false, thematicReady: false })],
      activeDatasetOverlayId: null,
    });

    expect(state.items[0]).toMatchObject({
      canRenderCoverage: false,
      rowClassName: "module-record-row",
      overlayStatusLabel: "Registry-only",
      overlayStatusTone: "neutral",
      summary: "Registry record only for now; geometry attachment is not drawable yet.",
      buttonLabel: "Not drawable",
      buttonDisabled: true,
    });
  });

  it("limits the queue and maps analysis crash point geometry labels", () => {
    const state = buildLinkedDatasetQueueState({
      datasets: [
        buildDataset({
          datasetId: "dataset-1",
          geographyScope: "point",
          geometryAttachment: "analysis_crash_points",
          thematicMetricKey: "fatalCount",
          thematicMetricLabel: null,
        }),
        buildDataset({ datasetId: "dataset-2" }),
      ],
      activeDatasetOverlayId: null,
      limit: 1,
    });

    expect(state.items).toHaveLength(1);
    expect(state.items[0].rowClassName).toBe("module-record-row is-comparison");
    expect(state.items[0].summary).toBe("Uses real crash-point geometry + FatalCount.");
    expect(state.items[0].buttonLabel).toBe("Not drawable");
    expect(state.items[0].buttonDisabled).toBe(true);
  });
});
