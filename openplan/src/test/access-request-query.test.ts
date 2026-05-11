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
      intent: "Open Source Services Review!",
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
      intent: "open-source-services-review",
    });
    expect(prefill.sourcePath).toBe(
      "/contact/openplan-fit?product=openplan&tier=openplan-starter-prelaunch&checkout=disabled&legacyCheckout=1&checkoutDisabled=1&workspaceId=11111111-1111-4111-8111-111111111111&intent=open-source-services-review",
    );
  });

  it("maps service lane aliases, inferred deployment posture, and public CTA intent notes", () => {
    const prefill = buildRequestAccessPrefill("/contact", {
      lane: "managed-hosting",
      workflow: "grants",
      source: "pricing",
      intent: "managed-hosting-review",
    });

    expect(prefill.initialValues).toMatchObject({
      serviceLane: "managed_hosting_admin",
      desiredFirstWorkflow: "grants",
      deploymentPosture: "nat_ford_managed",
    });
    expect(prefill.initialValues.onboardingNeeds).toContain("CTA intent: review Nat Ford managed hosting/admin support");
    expect(prefill.initialValues.onboardingNeeds).toContain("do not create a workspace, send email, start billing");
    expect(prefill.sourceContext).toEqual({ source: "pricing", intent: "managed-hosting-review" });
    expect(prefill.sourcePath).toBe("/contact?source=pricing&intent=managed-hosting-review");
  });
});
