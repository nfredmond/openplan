import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  descriptorIsOverdue,
  getJurisdictionPlanDescriptor,
  JURISDICTION_PLAN_DESCRIPTORS,
  recommendJurisdictionPlanDescriptor,
  SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS,
} from "@/lib/land-use-plans/registry";

describe("Land Use Plans jurisdiction registry", () => {
  it("keeps jurisdiction terms out of shared contracts", () => {
    const contracts = readFileSync(path.resolve(__dirname, "../lib/land-use-plans/contracts.ts"), "utf8");
    for (const jurisdictionTerm of ["California", "Washington", "Texas", "Navajo", "general plan", "specific plan", "element", "resolution", "FIPS", "county"]) {
      expect(contracts, `${jurisdictionTerm} belongs in a descriptor, not a shared type`).not.toContain(jurisdictionTerm);
    }
  });

  it("ships one selectable sourced California workflow and three unconfigured neutrality fixtures", () => {
    const california = getJurisdictionPlanDescriptor("us-ca-general-plan");
    expect(california?.configured).toBe(true);
    expect(california?.requirements.filter((item) => item.applicability === "required").map((item) => item.key)).toEqual([
      "land_use", "circulation", "housing", "conservation", "open_space", "noise", "safety",
    ]);
    expect(california?.requirements.filter((item) => item.applicability === "conditional").map((item) => item.key)).toEqual(["environmental_justice", "air_quality"]);
    expect(california?.processSteps.find((step) => step.key === "implementation_report")?.deadline).toBe("April 1");
    expect(california?.disclosure).toContain("not a complete statement");

    for (const id of ["us-wa-comprehensive-plan-fixture", "us-tx-comprehensive-plan-fixture", "tribal-sovereign-plan-fixture"]) {
      expect(getJurisdictionPlanDescriptor(id)?.configured, `${id} must not claim a complete legal bundle`).toBe(false);
    }

    const washington = getJurisdictionPlanDescriptor("us-wa-comprehensive-plan-fixture");
    expect(washington?.requirements.some((item) => item.key === "climate_resiliency" && item.applicability === "required")).toBe(true);
    expect(washington?.requirements.some((item) => item.key === "county_rural" && item.applicability === "conditional")).toBe(true);
    expect(washington?.processSteps.find((step) => step.key === "annual_amendment_cycle")?.deadline).toContain("once each year");
    expect(washington?.processSteps.find((step) => step.key === "periodic_review")?.deadline).toContain("Ten-year");

    const texas = getJurisdictionPlanDescriptor("us-tx-comprehensive-plan-fixture");
    expect(texas?.requirements.map((item) => item.applicability)).toEqual(["locally_defined"]);

    const tribal = getJurisdictionPlanDescriptor("tribal-sovereign-plan-fixture");
    expect(tribal?.processSteps.find((step) => step.key === "community_review")?.deadline).toContain("60-day");
    expect(tribal?.processSteps.some((step) => step.key === "sovereign_certification")).toBe(true);
  });

  it("fails when any source review is overdue", () => {
    for (const descriptor of JURISDICTION_PLAN_DESCRIPTORS) {
      expect(descriptorIsOverdue(descriptor, new Date("2026-08-23T12:00:00Z")), `${descriptor.id} source review is overdue`).toBe(false);
      expect(descriptor.sourceUrls.every((url) => url.startsWith("https://"))).toBe(true);
    }
  });

  it("carries the map-is-not-zoning disclosure on the stored designation contract", () => {
    const migration = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20260823000002_land_use_plans.sql"), "utf8");
    expect(migration).toContain("They are not zoning and do not change parcel entitlements.");
  });

  it("recommends the configured bundle only for its registered jurisdiction", () => {
    expect(
      recommendJurisdictionPlanDescriptor({ country: "US", subdivision: "CA" })
    ).toMatchObject({
      kind: "jurisdiction_matched",
      descriptor: { id: "us-ca-general-plan" },
    });

    for (const jurisdiction of [
      { country: "US", subdivision: "OR" },
      { country: "NZ", subdivision: null },
    ]) {
      expect(recommendJurisdictionPlanDescriptor(jurisdiction)).toMatchObject({
        kind: "no_configured_bundle",
        descriptor: { id: "local-unconfigured" },
      });
    }

    expect(recommendJurisdictionPlanDescriptor(null)).toMatchObject({
      kind: "no_workspace_jurisdiction",
      descriptor: { id: "local-unconfigured" },
    });
  });

  it("uses the neutral workflow when configured registrations are ambiguous", () => {
    const california = SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.find(
      (descriptor) => descriptor.id === "us-ca-general-plan"
    );
    const neutral = SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.find(
      (descriptor) => descriptor.id === "local-unconfigured"
    );
    if (!california || !neutral) throw new Error("Expected selectable registry entries");

    const recommendation = recommendJurisdictionPlanDescriptor(
      { country: "US", subdivision: "CA" },
      [california, { ...california, id: "second-configured-pack" }, neutral]
    );

    expect(recommendation).toMatchObject({
      kind: "ambiguous_configured_bundles",
      descriptor: { id: "local-unconfigured" },
    });
  });
});
