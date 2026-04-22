import { describe, expect, it, vi } from "vitest";

import {
  isProjectFeatureProperties,
  projectFeatureToSelection,
} from "@/lib/cartographic/project-feature-to-selection";

const validProps = {
  kind: "project" as const,
  projectId: "d0000001-0000-4000-8000-000000000003",
  name: "NCTC 2045 RTP (proof-of-capability)",
  status: "active",
  deliveryPhase: "analysis",
  planType: "regional_transportation_plan",
};

describe("isProjectFeatureProperties", () => {
  it("accepts a well-formed project feature payload", () => {
    expect(isProjectFeatureProperties(validProps)).toBe(true);
  });

  it("rejects a payload missing projectId", () => {
    const { projectId: _omit, ...rest } = validProps;
    expect(isProjectFeatureProperties(rest)).toBe(false);
  });

  it("rejects a payload whose kind is not project", () => {
    expect(
      isProjectFeatureProperties({ ...validProps, kind: "aerial_mission" }),
    ).toBe(false);
  });

  it("accepts a null planType", () => {
    expect(
      isProjectFeatureProperties({ ...validProps, planType: null }),
    ).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isProjectFeatureProperties(null)).toBe(false);
    expect(isProjectFeatureProperties("project")).toBe(false);
    expect(isProjectFeatureProperties(undefined)).toBe(false);
  });
});

describe("projectFeatureToSelection", () => {
  it("returns null when the payload fails the type guard", () => {
    const navigate = vi.fn();
    expect(
      projectFeatureToSelection({ kind: "unknown" }, { navigate }),
    ).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("maps valid properties to a project inspector selection", () => {
    const navigate = vi.fn();
    const selection = projectFeatureToSelection(validProps, { navigate });
    expect(selection).not.toBeNull();
    expect(selection!.kind).toBe("project");
    expect(selection!.title).toBe("NCTC 2045 RTP (proof-of-capability)");
    expect(selection!.kicker).toBe("Project");
    expect(selection!.meta).toEqual([
      { label: "status", value: "active" },
      { label: "phase", value: "analysis" },
      { label: "type", value: "regional_transportation_plan" },
    ]);
  });

  it("primary action navigates to the project detail page", () => {
    const navigate = vi.fn();
    const selection = projectFeatureToSelection(validProps, { navigate });
    selection!.primaryAction!.onClick();
    expect(navigate).toHaveBeenCalledWith(
      "/projects/d0000001-0000-4000-8000-000000000003",
    );
  });

  it("omits the plan-type meta row when planType is null", () => {
    const navigate = vi.fn();
    const selection = projectFeatureToSelection(
      { ...validProps, planType: null },
      { navigate },
    );
    expect(selection!.meta).toEqual([
      { label: "status", value: "active" },
      { label: "phase", value: "analysis" },
    ]);
  });

  it("falls back to a generic title when the incoming name is blank", () => {
    const navigate = vi.fn();
    const selection = projectFeatureToSelection(
      { ...validProps, name: "   " },
      { navigate },
    );
    expect(selection!.title).toBe("Untitled project");
  });

  it("omits featureRef when no sourceId is supplied", () => {
    const navigate = vi.fn();
    const selection = projectFeatureToSelection(validProps, { navigate });
    expect(selection!.featureRef).toBeUndefined();
  });

  it("populates featureRef with the injected sourceId and projectId", () => {
    const navigate = vi.fn();
    const selection = projectFeatureToSelection(validProps, {
      navigate,
      sourceId: "cartographic-projects",
    });
    expect(selection!.featureRef).toEqual({
      sourceId: "cartographic-projects",
      featureId: validProps.projectId,
    });
  });
});
