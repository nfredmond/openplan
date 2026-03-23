import { describe, expect, it } from "vitest";
import { buildManagedRunLaunchPlan, buildManagedRunManifest } from "@/lib/models/orchestration";

const CORRIDOR = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-121.5, 39.1],
      [-121.4, 39.1],
      [-121.4, 39.2],
      [-121.5, 39.1],
    ],
  ],
};

describe("managed run orchestration helpers", () => {
  it("builds an ActivitySim handoff launch plan with explicit staged limits", () => {
    const plan = buildManagedRunLaunchPlan("activitysim");

    expect(plan).toMatchObject({
      engineKey: "activitysim",
      pipelineKey: "aequilibrae_activitysim_handoff_v1",
      launchMode: "queued_handoff",
      defaultRunStatus: "queued",
      honestCapability: expect.stringContaining("does not execute the ActivitySim engine yet"),
    });
    expect(plan.stagePlan.map((stage) => stage.stageName)).toEqual([
      "AequilibraE Setup",
      "Network Assignment",
      "Artifact Extraction",
      "ActivitySim Handoff Package",
    ]);
  });

  it("captures a stable manifest with hashed corridor lineage", () => {
    const plan = buildManagedRunLaunchPlan("aequilibrae");
    const manifest = buildManagedRunManifest({
      plan,
      launchedAt: "2026-03-21T23:15:00.000Z",
      model: {
        id: "model-123",
        title: "Nevada County baseline",
        family: "travel_demand",
        configVersion: "tdm-v1",
      },
      scenario: {
        id: "scenario-123",
        label: "Baseline",
        status: "ready",
      },
      queryText: "Evaluate baseline countywide network",
      corridorGeojson: CORRIDOR,
      assumptionSnapshot: { pricing: "baseline" },
    });

    expect(manifest).toMatchObject({
      schemaVersion: "openplan-managed-run-manifest.v1",
      pipelineKey: "aequilibrae_screening_v1",
      model: {
        id: "model-123",
        title: "Nevada County baseline",
      },
      scenario: {
        id: "scenario-123",
        label: "Baseline",
      },
      inputs: {
        queryText: "Evaluate baseline countywide network",
        assumptionSnapshot: { pricing: "baseline" },
      },
    });
    expect(manifest.inputs.corridorGeojsonHash).toMatch(/^[a-f0-9]{16}$/);
    expect(manifest.stagePlan).toHaveLength(3);
  });
});
