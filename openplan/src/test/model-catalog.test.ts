import { describe, expect, it } from "vitest";
import {
  buildModelLinkageCounts,
  buildModelReadiness,
  buildModelWorkflowSummary,
  buildModelWorkspaceSummary,
} from "@/lib/models/catalog";

describe("model readiness helpers", () => {
  it("marks a model record ready when config, provenance, and outputs are present", () => {
    expect(
      buildModelReadiness({
        hasProject: true,
        hasScenario: true,
        configVersion: "abm-v1.3",
        ownerLabel: "Model Ops",
        assumptionsSummary: "Validated 2045 land use and pricing assumptions.",
        inputDatasetCount: 2,
        inputSummary: "Land use, network, and policy levers attached.",
        outputReportCount: 1,
        outputRunCount: 1,
        outputSummary: "Regional metrics packet linked.",
        lastValidatedAt: "2026-03-15T08:00:00.000Z",
      })
    ).toMatchObject({
      ready: true,
      status: "ready",
      label: "Run posture ready",
      readyCheckCount: 8,
      missingCheckCount: 0,
    });
  });

  it("surfaces the first missing setup gap without pretending the model is runnable", () => {
    expect(
      buildModelReadiness({
        hasProject: false,
        hasScenario: false,
        configVersion: null,
        ownerLabel: null,
        assumptionsSummary: null,
        inputDatasetCount: 0,
        inputSummary: null,
        outputReportCount: 0,
        outputRunCount: 0,
        outputSummary: null,
        lastValidatedAt: null,
      })
    ).toMatchObject({
      ready: false,
      status: "incomplete",
      label: "Needs setup",
      reason: "Attach the project this model record is meant to support.",
      missingCheckCount: 8,
    });
  });

  it("builds review workflow cues from readiness and evidence counts", () => {
    const readiness = buildModelReadiness({
      hasProject: true,
      hasScenario: true,
      configVersion: "abm-v1.3",
      ownerLabel: "Model Ops",
      assumptionsSummary: "Validated 2045 land use and pricing assumptions.",
      inputDatasetCount: 2,
      inputSummary: "Land use, network, and policy levers attached.",
      outputReportCount: 0,
      outputRunCount: 1,
      outputSummary: null,
      lastValidatedAt: "2026-03-15T08:00:00.000Z",
    });

    expect(
      buildModelWorkflowSummary({
        modelStatus: "ready_for_review",
        readiness,
        linkedScenarioCount: 1,
        linkedDatasetCount: 2,
        linkedRunCount: 1,
        linkedReportCount: 0,
        lastRunRecordedAt: "2026-03-15T09:00:00.000Z",
      })
    ).toMatchObject({
      label: "Awaiting operator review",
      packageLabel: "Run evidence present",
      packageTone: "info",
    });
  });

  it("counts linkage types with primary project and scenario anchors included", () => {
    expect(
      buildModelLinkageCounts({
        projectId: "project-1",
        scenarioSetId: "scenario-1",
        links: [
          { link_type: "data_dataset" },
          { link_type: "data_dataset" },
          { link_type: "report" },
          { link_type: "run" },
          { link_type: "plan" },
          { link_type: "project_record" },
          { link_type: "scenario_set" },
        ],
      })
    ).toMatchObject({
      scenarios: 2,
      datasets: 2,
      reports: 1,
      runs: 1,
      plans: 1,
      relatedProjects: 2,
    });
  });

  it("builds a reusable workspace summary for list and detail surfaces", () => {
    expect(
      buildModelWorkspaceSummary({
        modelStatus: "configuring",
        projectId: "project-1",
        scenarioSetId: null,
        configVersion: "tdm-v2",
        ownerLabel: "Model Ops",
        assumptionsSummary: "Calibration basis captured.",
        inputSummary: null,
        outputSummary: null,
        lastValidatedAt: null,
        lastRunRecordedAt: null,
        links: [{ link_type: "scenario_set" }, { link_type: "data_dataset" }, { link_type: "plan" }],
      })
    ).toMatchObject({
      readiness: {
        ready: false,
        readyCheckCount: 6,
      },
      workflow: {
        label: "Configuration in progress",
      },
      linkageCounts: {
        scenarios: 1,
        datasets: 1,
        plans: 1,
      },
    });
  });
});
