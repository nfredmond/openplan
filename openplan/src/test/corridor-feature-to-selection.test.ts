import { describe, expect, it, vi } from "vitest";

import {
  isCorridorFeatureProperties,
  corridorFeatureToSelection,
} from "@/lib/cartographic/corridor-feature-to-selection";

const validProps = {
  kind: "corridor" as const,
  corridorId: "c0000001-0000-4000-8000-000000000001",
  projectId: "d0000001-0000-4000-8000-000000000003",
  name: "SR-49 Grass Valley segment",
  corridorType: "arterial",
  losGrade: "D",
};

describe("isCorridorFeatureProperties", () => {
  it("accepts a well-formed corridor feature payload", () => {
    expect(isCorridorFeatureProperties(validProps)).toBe(true);
  });

  it("accepts a null projectId (corridor not linked to a project)", () => {
    expect(
      isCorridorFeatureProperties({ ...validProps, projectId: null }),
    ).toBe(true);
  });

  it("accepts a null losGrade", () => {
    expect(
      isCorridorFeatureProperties({ ...validProps, losGrade: null }),
    ).toBe(true);
  });

  it("rejects a payload whose kind is not corridor", () => {
    expect(
      isCorridorFeatureProperties({ ...validProps, kind: "project" }),
    ).toBe(false);
  });

  it("rejects a payload missing corridorId", () => {
    const { corridorId: _omit, ...rest } = validProps;
    expect(isCorridorFeatureProperties(rest)).toBe(false);
  });

  it("rejects an empty corridorId", () => {
    expect(
      isCorridorFeatureProperties({ ...validProps, corridorId: "" }),
    ).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isCorridorFeatureProperties(null)).toBe(false);
    expect(isCorridorFeatureProperties("corridor")).toBe(false);
    expect(isCorridorFeatureProperties(undefined)).toBe(false);
  });
});

describe("corridorFeatureToSelection", () => {
  it("returns null when the payload fails the type guard", () => {
    const navigate = vi.fn();
    expect(
      corridorFeatureToSelection({ kind: "unknown" }, { navigate }),
    ).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("maps valid properties to a corridor inspector selection", () => {
    const navigate = vi.fn();
    const selection = corridorFeatureToSelection(validProps, { navigate });
    expect(selection).not.toBeNull();
    expect(selection!.kind).toBe("corridor");
    expect(selection!.title).toBe("SR-49 Grass Valley segment");
    expect(selection!.kicker).toBe("Corridor");
    expect(selection!.avatarChar).toBe("C");
    expect(selection!.meta).toEqual([
      { label: "type", value: "arterial" },
      { label: "LOS", value: "D" },
    ]);
  });

  it("primary action navigates to the linked project detail page", () => {
    const navigate = vi.fn();
    const selection = corridorFeatureToSelection(validProps, { navigate });
    selection!.primaryAction!.onClick();
    expect(navigate).toHaveBeenCalledWith(
      "/projects/d0000001-0000-4000-8000-000000000003",
    );
  });

  it("omits the primary action when projectId is null", () => {
    const navigate = vi.fn();
    const selection = corridorFeatureToSelection(
      { ...validProps, projectId: null },
      { navigate },
    );
    expect(selection!.primaryAction).toBeUndefined();
  });

  it("omits the LOS meta row when losGrade is null", () => {
    const navigate = vi.fn();
    const selection = corridorFeatureToSelection(
      { ...validProps, losGrade: null },
      { navigate },
    );
    expect(selection!.meta).toEqual([{ label: "type", value: "arterial" }]);
  });

  it("falls back to a generic title when the incoming name is blank", () => {
    const navigate = vi.fn();
    const selection = corridorFeatureToSelection(
      { ...validProps, name: "   " },
      { navigate },
    );
    expect(selection!.title).toBe("Untitled corridor");
  });

  it("omits featureRef when no sourceId is supplied", () => {
    const navigate = vi.fn();
    const selection = corridorFeatureToSelection(validProps, { navigate });
    expect(selection!.featureRef).toBeUndefined();
  });

  it("populates featureRef with the injected sourceId and corridorId", () => {
    const navigate = vi.fn();
    const selection = corridorFeatureToSelection(validProps, {
      navigate,
      sourceId: "cartographic-corridors",
    });
    expect(selection!.featureRef).toEqual({
      sourceId: "cartographic-corridors",
      featureId: validProps.corridorId,
    });
  });
});
