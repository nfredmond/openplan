import { describe, expect, it } from "vitest";
import { hasGuidedProjectComparisonIntent } from "@/lib/models/project-comparison";

// Detection does not establish a supported version, complete config or evidence.
describe("guided comparison intent admission", () => {
  it.each(["openplan.project_comparison.v1", "openplan.project_comparison.v999", null, false, 0, {}, []])(
    "keeps an explicit marker in the guided lane: %j", (marker) => {
      expect(hasGuidedProjectComparisonIntent({ guidedProjectComparison: marker })).toBe(true);
    },
  );
  it.each(["aequilibrae", "activitysim"])("detects the damaged-marker %s worker contract", (method) => {
    expect(hasGuidedProjectComparisonIntent({ method, networkBasis: { kind: "worker_osm_snapshot" } })).toBe(true);
  });
  it.each([null, [], "guidedProjectComparison", {}, { method: "other" }, { method: "aequilibrae" },
    { networkBasis: { kind: "worker_osm_snapshot" } }, { method: "activitysim", networkBasis: [] }])(
    "preserves generic or malformed non-declarations: %j", (config) => {
      expect(hasGuidedProjectComparisonIntent(config)).toBe(false);
    },
  );
  it("ignores an inherited marker and unrelated metadata", () => {
    expect(hasGuidedProjectComparisonIntent({ note: "harmless" })).toBe(false);
    expect(hasGuidedProjectComparisonIntent(Object.create({ guidedProjectComparison: null }))).toBe(false);
  });
});
