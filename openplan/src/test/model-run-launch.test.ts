import { describe, expect, it } from "vitest";
import { extractModelLaunchTemplate, mergeScenarioLaunchPayload } from "@/lib/models/run-launch";
import { MANAGED_RUN_MODE_KEYS, getManagedRunModeDefinition } from "@/lib/models/run-modes";

describe("model run launch helpers", () => {
  it("extracts launch defaults from model config", () => {
    const template = extractModelLaunchTemplate({
      runTemplate: {
        queryText: "Evaluate protected bike lane alternative",
        corridorGeojson: {
          type: "Polygon",
          coordinates: [
            [
              [-121.5, 39.1],
              [-121.4, 39.1],
              [-121.4, 39.2],
              [-121.5, 39.1],
            ],
          ],
        },
      },
    });

    expect(template.queryText).toBe("Evaluate protected bike lane alternative");
    expect(template.corridorGeojson?.type).toBe("Polygon");
  });

  it("merges scenario assumptions with model defaults and explicit overrides", () => {
    const payload = mergeScenarioLaunchPayload({
      modelTemplate: {
        queryText: "Base query",
        corridorGeojson: {
          type: "Polygon",
          coordinates: [
            [
              [-121.5, 39.1],
              [-121.4, 39.1],
              [-121.4, 39.2],
              [-121.5, 39.1],
            ],
          ],
        },
      },
      scenarioAssumptions: {
        analysisQuerySuffix: "with lower vehicle speeds",
      },
      overrideQueryText: "Test alternative",
    });

    expect(payload.queryText).toBe("Test alternative — with lower vehicle speeds");
    expect(payload.corridorGeojson?.type).toBe("Polygon");
    expect(payload.assumptionSnapshot).toEqual({ analysisQuerySuffix: "with lower vehicle speeds" });
    expect(payload.engineKey).toBe("deterministic_corridor_v1");
  });

  it("defines behavioral demand as a launchable preflight run mode (not a forecast)", () => {
    const runMode = getManagedRunModeDefinition("behavioral_demand");

    expect(runMode.label).toBe("Behavioral Demand");
    // Launchable as a preflight, but honestly badged — never a forecast tier.
    expect(runMode.availability).toBe("preflight");
    expect(runMode.runtimeExpectation).toContain("tens of minutes to hours");
    expect(runMode.caveatSummary).toContain("NOT a behavioral forecast");
  });

  it("says what launching does on BOTH kinds of instance, without softening the caveat", () => {
    // What a launch does depends on whether the operator configured an
    // ActivitySim runtime: with one it runs the activity model, assigns it on
    // the network the trip-based run used, and publishes the agreement map;
    // without one it stops after a readiness check. The copy described only the
    // second case for two days after the first shipped, which is this
    // repository's shipped-invisible defect in its copy form — the capability
    // exists and the product tells a planner it does not.
    const runMode = getManagedRunModeDefinition("behavioral_demand");

    expect(runMode.summaryDetail).toMatch(/runtime set up/i);
    expect(runMode.summaryDetail).toMatch(/same road network/i);
    expect(runMode.summaryDetail).toMatch(/agree/i);
    // …and the degraded path is still described, not dropped in the excitement.
    expect(runMode.summaryDetail).toMatch(/stops after/i);
    // The claim boundary is untouched by any of that.
    expect(runMode.summaryDetail).toMatch(/neither one is a behavioral forecast/i);
  });

  it("registers the managed run modes in order", () => {
    expect(MANAGED_RUN_MODE_KEYS).toEqual([
      "deterministic_corridor_v1",
      "aequilibrae",
      "behavioral_demand",
      "sketch_abm",
      "ite_trip_generation",
    ]);
  });

  it("defines trip generation as a launchable in-process worksheet mode with the claim boundary in its caveat", () => {
    const runMode = getManagedRunModeDefinition("ite_trip_generation");
    expect(runMode.availability).toBe("launchable");
    expect(runMode.caveatSummary).toContain("NOT a traffic impact study");
    expect(runMode.caveatSummary).toContain("NOT a CEQA");
  });

  it("defines the sketch activity model as a launchable screening-grade in-process mode", () => {
    const runMode = getManagedRunModeDefinition("sketch_abm");

    expect(runMode.label).toBe("Sketch Activity Model");
    // Launchable after benchmark validation (sketch-abm-benchmark-validation),
    // but still screening-grade — the caveat must never soften to forecast
    // language even though the UI now offers it directly.
    expect(runMode.availability).toBe("launchable");
    expect(runMode.runtimeExpectation).toContain("inside this app");
    expect(runMode.runtimeExpectation).toContain("seconds");
    expect(runMode.caveatSummary).toContain("Screening-grade");
    expect(runMode.caveatSummary).toContain("Do not treat it as a validated travel model");
  });
});
