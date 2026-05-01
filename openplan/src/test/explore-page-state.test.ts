import { describe, expect, it } from "vitest";

import {
  buildCurrentMapViewState,
  getCrashPointFeatures,
  getLinkedDatasetPreview,
  hasSwitrsPointLayer,
  resolveActiveDatasetOverlay,
  resolveWorkspaceHelperText,
  resolveWorkspaceStatusLabel,
} from "@/app/(app)/explore/_components/explore-page-state";
import type {
  AnalysisContextResponse,
  AnalysisResult,
  WorkspaceLoadState,
} from "@/app/(app)/explore/_components/_types";

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

function buildAnalysisContext(datasets: LinkedDataset[] = []): AnalysisContextResponse {
  return {
    workspaceId: "workspace-1",
    project: null,
    linkedDatasets: datasets,
    migrationPending: false,
    counts: {
      deliverables: 0,
      risks: 0,
      issues: 0,
      decisions: 0,
      meetings: 0,
      linkedDatasets: datasets.length,
      overlayReadyDatasets: datasets.filter((dataset) => dataset.overlayReady).length,
      recentRuns: 0,
    },
    recentRuns: [],
    operationsSummary: {} as AnalysisContextResponse["operationsSummary"],
  };
}

function buildAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    runId: "run-1",
    title: "Corridor screen",
    createdAt: "2026-04-20T10:00:00.000Z",
    summary: "Summary",
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [-121.05, 39.15],
          },
          properties: {
            kind: "crash_point",
            severityBucket: "fatal",
          },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [-121.05, 39.15],
              [-121.04, 39.16],
            ],
          },
          properties: {
            kind: "crash_point",
          },
        },
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [-121.03, 39.17],
          },
          properties: {
            kind: "transit_stop",
          },
        },
      ],
    },
    metrics: {
      accessibilityScore: 81,
      safetyScore: 72,
      equityScore: 78,
    },
    ...overrides,
  };
}

describe("explore page state helpers", () => {
  it("resolves the selected dataset overlay and preview list without mutating context", () => {
    const datasets = [
      buildDataset({ datasetId: "dataset-1", name: "First dataset" }),
      buildDataset({ datasetId: "dataset-2", name: "Selected dataset" }),
      buildDataset({ datasetId: "dataset-3", name: "Third dataset" }),
      buildDataset({ datasetId: "dataset-4", name: "Fourth dataset" }),
      buildDataset({ datasetId: "dataset-5", name: "Fifth dataset" }),
    ];
    const context = buildAnalysisContext(datasets);

    expect(resolveActiveDatasetOverlay(context, "dataset-2")?.name).toBe("Selected dataset");
    expect(resolveActiveDatasetOverlay(context, "missing")).toBeNull();
    expect(resolveActiveDatasetOverlay(null, "dataset-2")).toBeNull();
    expect(getLinkedDatasetPreview(context).map((dataset) => dataset.datasetId)).toEqual([
      "dataset-1",
      "dataset-2",
      "dataset-3",
      "dataset-4",
    ]);
    expect(getLinkedDatasetPreview(context, 2).map((dataset) => dataset.datasetId)).toEqual([
      "dataset-1",
      "dataset-2",
    ]);
    expect(getLinkedDatasetPreview(null)).toEqual([]);
  });

  it("builds map view state with the active thematic overlay context", () => {
    const activeDatasetOverlay = buildDataset({
      datasetId: "dataset-2",
      name: "Crash severity",
      geometryAttachment: "analysis_crash_points",
      thematicMetricKey: "fatalCount",
      thematicMetricLabel: "Fatal crashes",
      connectorLabel: "SWITRS",
    });

    expect(
      buildCurrentMapViewState({
        tractMetric: "poverty",
        showTracts: true,
        showCrashes: false,
        crashSeverityFilter: "fatal",
        crashUserFilter: "vru",
        activeDatasetOverlayId: "dataset-2",
        activeDatasetOverlay,
      })
    ).toEqual({
      tractMetric: "poverty",
      showTracts: true,
      showCrashes: false,
      crashSeverityFilter: "fatal",
      crashUserFilter: "vru",
      activeDatasetOverlayId: "dataset-2",
      activeOverlayContext: {
        datasetId: "dataset-2",
        datasetName: "Crash severity",
        overlayMode: "thematic_overlay",
        geometryAttachment: "analysis_crash_points",
        thematicMetricKey: "fatalCount",
        thematicMetricLabel: "Fatal crashes",
        connectorLabel: "SWITRS",
      },
    });
  });

  it("builds coverage map view state when the active overlay is not thematic-ready", () => {
    expect(
      buildCurrentMapViewState({
        tractMetric: "minority",
        showTracts: false,
        showCrashes: true,
        crashSeverityFilter: "all",
        crashUserFilter: "all",
        activeDatasetOverlayId: "dataset-1",
        activeDatasetOverlay: buildDataset({ thematicReady: false }),
      }).activeOverlayContext
    ).toMatchObject({
      datasetId: "dataset-1",
      overlayMode: "coverage_footprint",
    });
  });

  it("returns stable workspace helper copy and status labels for every load state", () => {
    const expected: Record<WorkspaceLoadState, { helperText: string; statusLabel: string }> = {
      loading: {
        helperText: "Checking your default workspace and permissions...",
        statusLabel: "Loading",
      },
      loaded: {
        helperText: "Connected to Nevada County (owner).",
        statusLabel: "Workspace loaded",
      },
      signedOut: {
        helperText: "You are signed out. Enter a workspace ID manually, or sign in to continue.",
        statusLabel: "Signed out",
      },
      noMembership: {
        helperText: "Signed in, but no workspace membership was detected. Enter a workspace ID manually.",
        statusLabel: "No membership",
      },
      error: {
        helperText: "Unable to auto-load a workspace right now. Enter a workspace ID manually.",
        statusLabel: "Connection issue",
      },
    };

    for (const [workspaceLoadState, values] of Object.entries(expected) as Array<
      [WorkspaceLoadState, { helperText: string; statusLabel: string }]
    >) {
      expect(
        resolveWorkspaceHelperText({
          workspaceLoadState,
          workspaceName: "Nevada County",
          workspaceRole: "owner",
        })
      ).toBe(values.helperText);
      expect(resolveWorkspaceStatusLabel(workspaceLoadState)).toBe(values.statusLabel);
    }

    expect(
      resolveWorkspaceHelperText({
        workspaceLoadState: "loaded",
        workspaceName: null,
        workspaceRole: null,
      })
    ).toBe("Connected to workspace (member).");
  });

  it("filters crash point features and gates SWITRS point-layer availability", () => {
    const result = buildAnalysisResult({
      metrics: {
        accessibilityScore: 81,
        safetyScore: 72,
        equityScore: 78,
        sourceSnapshots: {
          crashes: { source: "switrs-local" },
        },
      },
    });
    const crashPointFeatures = getCrashPointFeatures(result);

    expect(crashPointFeatures).toHaveLength(1);
    expect(crashPointFeatures[0].properties).toMatchObject({ kind: "crash_point" });
    expect(getCrashPointFeatures(null)).toEqual([]);
    expect(hasSwitrsPointLayer(result, crashPointFeatures.length)).toBe(true);
    expect(hasSwitrsPointLayer(result, 0)).toBe(false);
    expect(
      hasSwitrsPointLayer(
        buildAnalysisResult({
          metrics: {
            accessibilityScore: 81,
            safetyScore: 72,
            equityScore: 78,
            sourceSnapshots: {
              crashes: { source: "osm-overpass" },
            },
          },
        }),
        1
      )
    ).toBe(false);
  });
});
