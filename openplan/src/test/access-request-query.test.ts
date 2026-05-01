import { describe, expect, it } from "vitest";
import { buildRequestAccessPrefill } from "@/lib/access-request-query";

describe("buildRequestAccessPrefill", () => {
  it("preserves sanitized OpenPlan fit-review context from legacy checkout redirects", () => {
    const prefill = buildRequestAccessPrefill("/contact/openplan-fit", {
      product: "OpenPlan!",
      tier: "OpenPlan Starter Prelaunch",
      checkout: "disabled",
      legacyCheckout: "1",
      checkoutDisabled: "true",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      ignored: "do-not-keep",
    });

    expect(prefill.initialValues).toMatchObject({
      serviceLane: "implementation_onboarding",
      deploymentPosture: "undecided",
      desiredFirstWorkflow: "other",
    });
    expect(prefill.initialValues.onboardingNeeds).toContain("Legacy tier/reference: openplan-starter-prelaunch");
    expect(prefill.sourceContext).toEqual({
      product: "openplan",
      tier: "openplan-starter-prelaunch",
      checkout: "disabled",
      legacyCheckout: true,
      checkoutDisabled: true,
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    expect(prefill.sourcePath).toBe(
      "/contact/openplan-fit?product=openplan&tier=openplan-starter-prelaunch&checkout=disabled&legacyCheckout=1&checkoutDisabled=1&workspaceId=11111111-1111-4111-8111-111111111111",
    );
  });

  it("maps service lane aliases without pre-filling required OpenPlan fit-review text", () => {
    const prefill = buildRequestAccessPrefill("/contact", {
      lane: "managed-hosting",
      workflow: "grants",
      deployment: "nat_ford_managed",
    });

    expect(prefill.initialValues).toEqual({
      serviceLane: "managed_hosting_admin",
      desiredFirstWorkflow: "grants",
      deploymentPosture: "nat_ford_managed",
    });
    expect(prefill.sourcePath).toBe("/contact");
  });
});
