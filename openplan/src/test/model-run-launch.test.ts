import { describe, expect, it } from "vitest";
import { extractModelLaunchTemplate, mergeScenarioLaunchPayload } from "@/lib/models/run-launch";
import { getManagedRunModeDefinition } from "@/lib/models/run-modes";

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

  it("defines behavioral demand as a prototype/preflight-backed run mode", () => {
    const runMode = getManagedRunModeDefinition("behavioral_demand");

    expect(runMode.label).toBe("Behavioral Demand");
    expect(runMode.availability).toBe("prototype");
    expect(runMode.runtimeExpectation).toContain("tens of minutes to hours");
    expect(runMode.caveatSummary).toContain("prototype/preflight-backed");
  });
});
