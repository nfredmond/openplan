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
    expect(
      manager.match(
        /run\.artifacts\.some\(\(artifact\) => artifact\.artifact_type === "demand_model_agreement_geojson"\)/g,
      ),
    ).toHaveLength(1);
    expect(manager).toContain("latestBehavioralAgreementRun ?");
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
    expect(map).toContain('maxWidth: "240px"');
    expect(map).toContain('popup.getElement()?.style.setProperty("z-index", "20")');
    expect(map).toContain("flex flex-wrap gap-x-3 gap-y-1");
    expect(map).toContain("Agreement is concurrence, not evidence that either method is correct.");
  });
});
