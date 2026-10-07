import { describe, expect, it } from "vitest";
import { snapshotPlanDescriptor, readFrozenPlanDescriptor, describeDescriptorCustody } from "@/lib/land-use-plans/descriptor-snapshot";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";

describe("frozen plan descriptor custody", () => {
  it("copies every rule, source and date independently from the registry object", () => {
    const original = structuredClone(getJurisdictionPlanDescriptor("us-ca-general-plan")!);
    const saved = snapshotPlanDescriptor(original, "comprehensive");
    expect(saved).toEqual(original);
    const hash = hashFrozenRecord(saved);
    original.requirements[0].label = "Later wording";
    original.processSteps[0].sourceUrls.push("https://example.test/later-source");
    original.verifiedAt = "2026-10-07";
    expect(hashFrozenRecord(saved)).toBe(hash);
    expect(hashFrozenRecord(original)).not.toBe(hash);
  });

  it("does not claim a descriptor for a plan kind it does not cover", () => {
    expect(() => snapshotPlanDescriptor(getJurisdictionPlanDescriptor("local-unconfigured")!, "absent-kind")).toThrow("does not cover");
  });

  it("distinguishes a legacy omission from a malformed saved record", () => {
    expect(readFrozenPlanDescriptor({}, "local-unconfigured", "community")).toEqual({ status: "legacy" });
    expect(readFrozenPlanDescriptor({ descriptorSnapshot: null }, "local-unconfigured", "community")).toEqual({ status: "invalid" });
  });

  it("refuses unsafe source links and unrecognized descriptor fields", () => {
    const original = getJurisdictionPlanDescriptor("local-unconfigured")!;
    expect(() => snapshotPlanDescriptor({ ...original, sourceUrls: ["javascript:alert(1)"] }, "community")).toThrow();
    const altered = { ...original, unrecordedRule: true };
    expect(() => snapshotPlanDescriptor(altered, "community")).toThrow();
  });

  it("discloses the limits of both retained and legacy editions", () => {
    expect(describeDescriptorCustody("frozen")).toContain("does not establish that the law remains current");
    expect(describeDescriptorCustody("not_retained")).toContain("may differ from what reviewers saw");
  });
});
