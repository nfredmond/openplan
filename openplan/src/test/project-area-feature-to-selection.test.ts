import { describe, expect, it, vi } from "vitest";

import {
  isProjectAreaFeatureProperties,
  projectAreaFeatureToSelection,
} from "@/lib/cartographic/project-area-feature-to-selection";

const validProps = {
  kind: "project_area" as const,
  projectId: "d0000001-0000-4000-8000-000000000003",
  projectName: "US-33 corridor study",
  status: "active",
  placeSource: "tigerweb",
  placeKind: "county",
  placeLabel: "Franklin County, OH",
};

describe("isProjectAreaFeatureProperties", () => {
  it("accepts a well-formed project-area payload", () => {
    expect(isProjectAreaFeatureProperties(validProps)).toBe(true);
  });

  it("accepts a drawn area, which has no kind or label of its own", () => {
    expect(
      isProjectAreaFeatureProperties({
        ...validProps,
        placeSource: "drawn",
        placeKind: null,
        placeLabel: null,
      }),
    ).toBe(true);
  });

  it("rejects a payload whose kind is the project marker rather than its area", () => {
    expect(isProjectAreaFeatureProperties({ ...validProps, kind: "project" })).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isProjectAreaFeatureProperties(null)).toBe(false);
    expect(isProjectAreaFeatureProperties(42)).toBe(false);
  });
});

describe("projectAreaFeatureToSelection", () => {
  it("returns null for a payload that is not a project area", () => {
    expect(projectAreaFeatureToSelection({ kind: "corridor" }, { navigate: vi.fn() })).toBeNull();
  });

  it("titles the selection by project and names the area it covers", () => {
    const selection = projectAreaFeatureToSelection(validProps, { navigate: vi.fn() });

    expect(selection?.kind).toBe("project_area");
    expect(selection?.title).toBe("US-33 corridor study");
    expect(selection?.kicker).toBe("Project area");
    expect(selection?.meta).toEqual([
      { label: "area", value: "Franklin County, OH" },
      { label: "status", value: "active" },
      { label: "kind", value: "county" },
    ]);
  });

  /**
   * A drawn shape has no identity by construction — the schema forbids it a ref
   * precisely so nothing downstream guesses which jurisdiction contains it. The
   * inspector must say "drawn area" rather than invent a kind for it.
   */
  it("describes a hand-drawn area as drawn, and gives it no kind", () => {
    const selection = projectAreaFeatureToSelection(
      { ...validProps, placeSource: "drawn", placeKind: null, placeLabel: null },
      { navigate: vi.fn() },
    );

    expect(selection?.meta?.find((item) => item.label === "area")?.value).toBe("drawn area");
    expect(selection?.meta?.some((item) => item.label === "kind")).toBe(false);
  });

  it("says the source did not name the area rather than leaving the row blank", () => {
    const selection = projectAreaFeatureToSelection(
      { ...validProps, placeLabel: null, placeKind: null },
      { navigate: vi.fn() },
    );

    expect(selection?.meta?.find((item) => item.label === "area")?.value).toBe(
      "area not named by its source",
    );
  });

  it("opens the project the area belongs to", () => {
    const navigate = vi.fn();
    projectAreaFeatureToSelection(validProps, { navigate })?.primaryAction?.onClick();
    expect(navigate).toHaveBeenCalledWith("/projects/d0000001-0000-4000-8000-000000000003");
  });

  it("carries a feature reference only when the caller supplies a source id", () => {
    expect(
      projectAreaFeatureToSelection(validProps, { navigate: vi.fn() })?.featureRef,
    ).toBeUndefined();
    expect(
      projectAreaFeatureToSelection(validProps, {
        navigate: vi.fn(),
        sourceId: "cartographic-project-areas",
      })?.featureRef,
    ).toEqual({
      sourceId: "cartographic-project-areas",
      featureId: validProps.projectId,
    });
  });
});
