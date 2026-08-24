import { describe, expect, it } from "vitest";

import { adoptionHashMatches, hashFrozenPlanContent, type FrozenPlanContent } from "@/lib/land-use-plans/versioning";

function fixture(): FrozenPlanContent {
  return {
    plan: { id: "p", descriptorId: "d", planKindKey: "k", title: "Plan", authorityLabel: "Authority", geographyLabel: "Area" },
    version: { id: "v", versionNumber: 1, versionKind: "original", basedOnVersionId: null, applicableRequirementKeys: ["required_section"] },
    nodes: [{ title: "Policy", body: "Keep this exact text", id: "n" }],
    relationships: [],
    designations: [{ layerVersionId: "layer-v1", legendMetadata: { b: 2, a: 1 } }],
    implementationActions: [{ title: "Action", status: "not_started" }],
  };
}

describe("Land Use Plans frozen version hashing", () => {
  it("is stable across object key order", () => {
    const first = fixture();
    const second = fixture();
    second.designations = [{ legendMetadata: { a: 1, b: 2 }, layerVersionId: "layer-v1" }];
    expect(hashFrozenPlanContent(first)).toBe(hashFrozenPlanContent(second));
  });

  it("changes when authored content or the selected GIS version changes", () => {
    const baseline = hashFrozenPlanContent(fixture());
    const contentMutation = fixture();
    contentMutation.nodes = [{ title: "Policy", body: "Changed text", id: "n" }];
    const mapMutation = fixture();
    mapMutation.designations = [{ layerVersionId: "layer-v2", legendMetadata: { b: 2, a: 1 } }];
    expect(hashFrozenPlanContent(contentMutation)).not.toBe(baseline);
    expect(hashFrozenPlanContent(mapMutation)).not.toBe(baseline);
  });

  it("accepts adoption only for the exact public-review hash", () => {
    const hash = hashFrozenPlanContent(fixture());
    expect(adoptionHashMatches({ state: "public_review", contentHash: hash }, hash)).toBe(true);
    expect(adoptionHashMatches({ state: "working", contentHash: hash }, hash)).toBe(false);
    expect(adoptionHashMatches({ state: "public_review", contentHash: hash }, "0".repeat(64))).toBe(false);
  });
});
