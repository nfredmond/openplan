import { describe, expect, it } from "vitest";
import { extractModelLaunchTemplate, mergeScenarioLaunchPayload } from "@/lib/models/run-launch";

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
  });
});
