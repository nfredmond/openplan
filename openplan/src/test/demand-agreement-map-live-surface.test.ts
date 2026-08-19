import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const map = readFileSync("src/components/models/demand-agreement-map.tsx", "utf8");
const manager = readFileSync("src/components/models/model-run-manager.tsx", "utf8");
const route = readFileSync(
  "src/app/api/models/[modelId]/runs/[modelRunId]/agreement/route.ts",
  "utf8",
);

describe("behavioral demand agreement map live surface", () => {
  it("is reachable from a completed behavioral run through its authenticated artifact route", () => {
    expect(manager).toContain(
      'modelRuns.some((run) => run.status === "succeeded" && run.engine_key === "behavioral_demand")',
    );
    expect(manager).toContain("<DemandAgreementMap");
    expect(manager).toContain("/agreement`}");
    expect(route).toContain('loadModelAccess(supabase, modelId, user.id, "models.read")');
    expect(route).toContain('"demand_model_agreement_geojson"');
  });

  it("styles all three sensitivity classes and shows both source volumes", () => {
    expect(map).toContain('"agree", "#22c55e"');
    expect(map).toContain('"marginal", "#f59e0b"');
    expect(map).toContain('"diverge", "#ef4444"');
    expect(map).toContain("Trip-based volume:");
    expect(map).toContain("ActivitySim volume:");
    expect(map).toContain("Agreement is concurrence, not evidence that either method is correct.");
  });
});
