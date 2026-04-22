import { describe, expect, it, vi } from "vitest";

import {
  aerialMissionFeatureToSelection,
  isAerialMissionFeatureProperties,
} from "@/lib/cartographic/mission-feature-to-selection";

const validProps = {
  kind: "aerial_mission" as const,
  missionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  projectId: "44444444-4444-4444-8444-444444444444",
  title: "Downtown Grass Valley survey",
  status: "complete",
  missionType: "aoi_capture",
};

describe("isAerialMissionFeatureProperties", () => {
  it("accepts a well-formed aerial mission feature payload", () => {
    expect(isAerialMissionFeatureProperties(validProps)).toBe(true);
  });

  it("rejects a payload missing missionId", () => {
    const { missionId: _omit, ...rest } = validProps;
    expect(isAerialMissionFeatureProperties(rest)).toBe(false);
  });

  it("rejects a payload whose kind is not aerial_mission", () => {
    expect(
      isAerialMissionFeatureProperties({ ...validProps, kind: "project" }),
    ).toBe(false);
  });

  it("accepts a null projectId", () => {
    expect(
      isAerialMissionFeatureProperties({ ...validProps, projectId: null }),
    ).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isAerialMissionFeatureProperties(null)).toBe(false);
    expect(isAerialMissionFeatureProperties("aerial_mission")).toBe(false);
    expect(isAerialMissionFeatureProperties(undefined)).toBe(false);
  });
});

describe("aerialMissionFeatureToSelection", () => {
  it("returns null when the payload fails the type guard", () => {
    const navigate = vi.fn();
    expect(
      aerialMissionFeatureToSelection({ kind: "unknown" }, { navigate }),
    ).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("maps valid properties to a mission inspector selection", () => {
    const navigate = vi.fn();
    const selection = aerialMissionFeatureToSelection(validProps, { navigate });
    expect(selection).not.toBeNull();
    expect(selection!.kind).toBe("mission");
    expect(selection!.title).toBe("Downtown Grass Valley survey");
    expect(selection!.kicker).toBe("Aerial mission");
    expect(selection!.meta).toEqual([
      { label: "status", value: "complete" },
      { label: "type", value: "aoi_capture" },
    ]);
  });

  it("primary action navigates to the mission detail page", () => {
    const navigate = vi.fn();
    const selection = aerialMissionFeatureToSelection(validProps, { navigate });
    selection!.primaryAction!.onClick();
    expect(navigate).toHaveBeenCalledWith(
      "/aerial/missions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("exposes secondary action when projectId is present", () => {
    const navigate = vi.fn();
    const selection = aerialMissionFeatureToSelection(validProps, { navigate });
    expect(selection!.secondaryAction).toBeDefined();
    selection!.secondaryAction!.onClick();
    expect(navigate).toHaveBeenCalledWith(
      "/projects/44444444-4444-4444-8444-444444444444",
    );
  });

  it("omits secondary action when projectId is null", () => {
    const navigate = vi.fn();
    const selection = aerialMissionFeatureToSelection(
      { ...validProps, projectId: null },
      { navigate },
    );
    expect(selection!.secondaryAction).toBeUndefined();
  });

  it("falls back to a generic title when the incoming title is blank", () => {
    const navigate = vi.fn();
    const selection = aerialMissionFeatureToSelection(
      { ...validProps, title: "   " },
      { navigate },
    );
    expect(selection!.title).toBe("Untitled mission");
  });

  it("omits featureRef when no sourceId is supplied", () => {
    const navigate = vi.fn();
    const selection = aerialMissionFeatureToSelection(validProps, { navigate });
    expect(selection!.featureRef).toBeUndefined();
  });

  it("populates featureRef with the injected sourceId and missionId", () => {
    const navigate = vi.fn();
    const selection = aerialMissionFeatureToSelection(validProps, {
      navigate,
      sourceId: "cartographic-aerial-mission-aois",
    });
    expect(selection!.featureRef).toEqual({
      sourceId: "cartographic-aerial-mission-aois",
      featureId: validProps.missionId,
    });
  });
});
