import { describe, expect, it } from "vitest";
import { getJurisdictionPlanDescriptor, getPlanKindDescriptor, defaultApplicableRequirementKeys } from "@/lib/land-use-plans/registry";
import { planDescriptorSelectionKey, selectPlanKindRules } from "@/lib/land-use-plans/plan-kind-rules";
import { snapshotPlanDescriptor, readFrozenPlanDescriptor } from "@/lib/land-use-plans/descriptor-snapshot";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";

describe("plan-kind rule selection", () => {
  it("keeps the established general-plan content separate from specific-plan content", () => {
    const general = getPlanKindDescriptor("us-ca-general-plan", "comprehensive")!;
    const specific = getPlanKindDescriptor("us-ca-general-plan", "area")!;
    expect(defaultApplicableRequirementKeys(general)).toEqual(["land_use", "circulation", "housing", "conservation", "open_space", "noise", "safety"]);
    expect(defaultApplicableRequirementKeys(specific)).toEqual(["specific_land_use", "specific_facilities", "specific_standards", "specific_implementation", "specific_general_plan_relationship"]);
    expect(specific.requirements.every(item => item.sourceUrls.some(url => url.includes("sectionNum=65451")))).toBe(true);
    expect(specific.planKinds).toEqual([{ key: "area", label: "Specific plan" }]);
    expect(general.planKinds).toEqual([{ key: "comprehensive", label: "General plan" }]);
    expect(specific.terminology).toEqual({ plan: "specific plan", section: "plan part", adoptionInstrument: "resolution or ordinance", implementationReport: "implementation update" });
  });

  it("distinguishes consistency, amendment procedure and agency-defined implementation updates", () => {
    const general = getPlanKindDescriptor("us-ca-general-plan", "comprehensive")!;
    const specific = getPlanKindDescriptor("us-ca-general-plan", "area")!;
    expect(specific.processSteps.find(step => step.key === "general_plan_consistency")).toMatchObject({ required: true, reviewPrerequisite: true, adoptionPrerequisite: true });
    expect(specific.processSteps.some(step => step.key === "amendment_limit")).toBe(false);
    expect(specific.processSteps.find(step => step.key === "specific_amendment_procedure")?.deadline).toContain("as often as");
    expect(specific.processSteps.find(step => step.key === "implementation_report")).toMatchObject({ required: false, sourceUrls: [] });
    expect(specific.processSteps.find(step => step.key === "implementation_report")?.deadline).toBeUndefined();
    expect(general.processSteps.find(step => step.key === "amendment_limit")?.deadline).toContain("four amendments");
    expect(general.processSteps.find(step => step.key === "implementation_report")?.deadline).toBe("April 1");
    expect(specific.disclosure).toContain("not a complete statement");
    expect(specific.disclosure).toContain("agency process choice");
    expect(specific.disclosure).toContain("does not determine legal sufficiency");
    expect(specific.verifiedAt).toBe(general.verifiedAt);
  });

  it("refuses unknown families and kinds", () => {
    expect(getPlanKindDescriptor("absent-family", "area")).toBeNull();
    expect(getPlanKindDescriptor("us-ca-general-plan", "absent-kind")).toBeNull();
    expect(getPlanKindDescriptor("local-unconfigured", "comprehensive")?.configured).toBe(false);
    expect(getPlanKindDescriptor("local-unconfigured", "community")?.requirements[0].applicability).toBe("locally_defined");
  });

  it("resolves arbitrary adapter data without borrowing a different family's rules", () => {
    const neutral = getJurisdictionPlanDescriptor("local-unconfigured")!;
    const family = { ...neutral, id: "synthetic-family", planKinds: [{ key: "synthetic-kind", label: "SYNTHETIC kind" }] };
    const variant = { ...family, terminology: { ...family.terminology, plan: "SYNTHETIC selected wording" } };
    expect(selectPlanKindRules(family, "synthetic-kind", { "synthetic-kind": variant })?.terminology.plan).toBe("SYNTHETIC selected wording");
    expect(selectPlanKindRules(family, "missing", { missing: { ...variant, planKinds: [{ key: "missing", label: "Missing" }] } })).toBeNull();
    expect(selectPlanKindRules(family, "synthetic-kind", { "synthetic-kind": { ...variant, id: "other-family" } })).toBeNull();
    expect(selectPlanKindRules(family, "synthetic-kind", { "synthetic-kind": { ...variant, planKinds: [{ key: "other-kind", label: "Other" }] } })).toBeNull();
  });

  it("returns detached rules and never rewrites an installed family", () => {
    const before = JSON.stringify(getJurisdictionPlanDescriptor("us-ca-general-plan"));
    const selected = getPlanKindDescriptor("us-ca-general-plan", "area")!;
    selected.requirements[0].label = "SYNTHETIC caller edit";
    selected.processSteps[0].label = "SYNTHETIC caller edit";
    selected.planKinds[0].label = "SYNTHETIC caller edit";
    expect(getPlanKindDescriptor("us-ca-general-plan", "area")!.requirements[0].label).toBe("Land uses and open space");
    expect(getPlanKindDescriptor("us-ca-general-plan", "area")!.processSteps[0].label).toBe("Identify the plan area and adopted parent plan");
    expect(JSON.stringify(getJurisdictionPlanDescriptor("us-ca-general-plan"))).toBe(before);
  });

  it("binds snapshots and review hashes to the selected kind", () => {
    const general = snapshotPlanDescriptor(getPlanKindDescriptor("us-ca-general-plan", "comprehensive")!, "comprehensive");
    const specific = snapshotPlanDescriptor(getPlanKindDescriptor("us-ca-general-plan", "area")!, "area");
    expect(hashFrozenRecord(general)).not.toBe(hashFrozenRecord(specific));
    expect(() => snapshotPlanDescriptor(specific, "comprehensive")).toThrow("does not cover");
    expect(readFrozenPlanDescriptor({ descriptorSnapshot: specific }, specific.id, "area")).toEqual({ status: "retained", descriptor: specific });
    expect(readFrozenPlanDescriptor({ descriptorSnapshot: specific }, specific.id, "comprehensive")).toEqual({ status: "invalid" });
    const oldRules = structuredClone(getJurisdictionPlanDescriptor("us-ca-general-plan")!);
    const oldHash = hashFrozenRecord(oldRules);
    const historical = readFrozenPlanDescriptor({ descriptorSnapshot: oldRules }, oldRules.id, "area");
    expect(historical).toEqual({ status: "retained", descriptor: oldRules });
    expect(hashFrozenRecord(oldRules)).toBe(oldHash);
    expect(oldRules.requirements[0].key).toBe("land_use");
  });

  it("encodes both selection identifiers without delimiter collisions", () => {
    expect(planDescriptorSelectionKey("a/b", "c")).not.toBe(planDescriptorSelectionKey("a", "b/c"));
    expect(JSON.parse(planDescriptorSelectionKey("synthetic-family", "synthetic-kind"))).toEqual(["synthetic-family", "synthetic-kind"]);
  });
});
