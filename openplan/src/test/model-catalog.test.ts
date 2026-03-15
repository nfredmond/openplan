import { describe, expect, it } from "vitest";
import { buildModelReadiness, buildModelWorkflowSummary } from "@/lib/models/catalog";

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
});
