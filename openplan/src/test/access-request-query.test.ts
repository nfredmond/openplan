import { describe, expect, it } from "vitest";
import { buildRequestAccessPrefill } from "@/lib/access-request-query";

describe("buildRequestAccessPrefill", () => {
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
    expect(prefill.initialValues.onboardingNeeds).toContain("CTA intent: account, workspace, or access problem.");
    expect(prefill.initialValues.onboardingNeeds).toContain("do not create a workspace or send email");
    expect(prefill.sourceContext).toEqual({ source: "pricing", intent: "managed-hosting-review" });
    expect(prefill.sourcePath).toBe("/contact?source=pricing&intent=managed-hosting-review");
  });

  it("keeps the landing-page OpenPlan review CTA from preselecting the wrong service lane", () => {
    const prefill = buildRequestAccessPrefill("/request-access", {
      product: "openplan",
      source: "landing",
      intent: "open-source-services-review",
    });

    expect(prefill.initialValues.serviceLane).toBeUndefined();
    expect(prefill.initialValues.deploymentPosture).toBeUndefined();
    expect(prefill.initialValues.desiredFirstWorkflow).toBeUndefined();
    expect(prefill.initialValues.onboardingNeeds).toContain("CTA intent: learn about the Apache-2.0 open-source core");
    expect(prefill.sourceContext).toEqual({
      product: "openplan",
      source: "landing",
      intent: "open-source-services-review",
    });
    expect(prefill.sourcePath).toBe("/request-access?product=openplan&source=landing&intent=open-source-services-review");
  });
});
