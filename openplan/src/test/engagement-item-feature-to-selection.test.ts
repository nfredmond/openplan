import { describe, expect, it, vi } from "vitest";

import {
  engagementItemFeatureToSelection,
  isEngagementItemFeatureProperties,
} from "@/lib/cartographic/engagement-item-feature-to-selection";

const validProps = {
  kind: "engagement_item" as const,
  itemId: "e0000001-0000-4000-8000-000000000101",
  campaignId: "e0000001-0000-4000-8000-000000000100",
  title: "Unsafe crossing at Neal + Mill",
  excerpt: "Kids bike to Magnolia Elementary from here and there's no crosswalk.",
  status: "approved",
  sourceType: "public",
  categoryLabel: "Safety concern",
};

describe("isEngagementItemFeatureProperties", () => {
  it("accepts a well-formed payload", () => {
    expect(isEngagementItemFeatureProperties(validProps)).toBe(true);
  });

  it("accepts a payload with null title and categoryLabel", () => {
    expect(
      isEngagementItemFeatureProperties({
        ...validProps,
        title: null,
        categoryLabel: null,
      }),
    ).toBe(true);
  });

  it("rejects a payload whose kind is not engagement_item", () => {
    expect(
      isEngagementItemFeatureProperties({ ...validProps, kind: "project" }),
    ).toBe(false);
  });

  it("rejects a payload with blank itemId", () => {
    expect(
      isEngagementItemFeatureProperties({ ...validProps, itemId: "" }),
    ).toBe(false);
  });

  it("rejects a payload with blank campaignId", () => {
    expect(
      isEngagementItemFeatureProperties({ ...validProps, campaignId: "" }),
    ).toBe(false);
  });

  it("rejects a payload with non-string excerpt", () => {
    expect(
      isEngagementItemFeatureProperties({ ...validProps, excerpt: 42 }),
    ).toBe(false);
  });

  it("rejects a non-object input", () => {
    expect(isEngagementItemFeatureProperties(null)).toBe(false);
    expect(isEngagementItemFeatureProperties("payload")).toBe(false);
  });
});

describe("engagementItemFeatureToSelection", () => {
  it("returns null when properties fail the guard", () => {
    expect(
      engagementItemFeatureToSelection(
        { ...validProps, kind: "project" },
        { navigate: vi.fn() },
      ),
    ).toBeNull();
  });

  it("maps a valid payload to a community-input selection", () => {
    const navigate = vi.fn();
    const result = engagementItemFeatureToSelection(validProps, { navigate });
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("engagement");
    expect(result?.title).toBe("Unsafe crossing at Neal + Mill");
    expect(result?.kicker).toBe("Community input");
    expect(result?.avatarChar).toBe("G");
  });

  it("uses the excerpt as a meta row", () => {
    const result = engagementItemFeatureToSelection(validProps, { navigate: vi.fn() });
    expect(result?.meta).toContainEqual({ label: "excerpt", value: validProps.excerpt });
  });

  it("includes status and source meta rows", () => {
    const result = engagementItemFeatureToSelection(validProps, { navigate: vi.fn() });
    expect(result?.meta).toContainEqual({ label: "status", value: "approved" });
    expect(result?.meta).toContainEqual({ label: "source", value: "public" });
  });

  it("includes the category meta row when categoryLabel is present", () => {
    const result = engagementItemFeatureToSelection(validProps, { navigate: vi.fn() });
    expect(result?.meta).toContainEqual({ label: "category", value: "Safety concern" });
  });

  it("omits the category meta row when categoryLabel is null", () => {
    const result = engagementItemFeatureToSelection(
      { ...validProps, categoryLabel: null },
      { navigate: vi.fn() },
    );
    expect(result?.meta?.some((row) => row.label === "category")).toBe(false);
  });

  it("omits the excerpt meta row when the excerpt is empty", () => {
    const result = engagementItemFeatureToSelection(
      { ...validProps, excerpt: "   " },
      { navigate: vi.fn() },
    );
    expect(result?.meta?.some((row) => row.label === "excerpt")).toBe(false);
  });

  it("falls back to 'Community input' when title is null", () => {
    const result = engagementItemFeatureToSelection(
      { ...validProps, title: null },
      { navigate: vi.fn() },
    );
    expect(result?.title).toBe("Community input");
  });

  it("falls back to 'Community input' when title is blank", () => {
    const result = engagementItemFeatureToSelection(
      { ...validProps, title: "   " },
      { navigate: vi.fn() },
    );
    expect(result?.title).toBe("Community input");
  });

  it("invokes the injected navigate with the campaign path on primaryAction click", () => {
    const navigate = vi.fn();
    const result = engagementItemFeatureToSelection(validProps, { navigate });
    result?.primaryAction?.onClick();
    expect(navigate).toHaveBeenCalledWith(`/engagement/${validProps.campaignId}`);
  });

  it("omits featureRef when sourceId is not supplied", () => {
    const result = engagementItemFeatureToSelection(validProps, { navigate: vi.fn() });
    expect(result?.featureRef).toBeUndefined();
  });

  it("populates featureRef with itemId when sourceId is supplied", () => {
    const result = engagementItemFeatureToSelection(validProps, {
      navigate: vi.fn(),
      sourceId: "engagement-items",
    });
    expect(result?.featureRef).toEqual({
      sourceId: "engagement-items",
      featureId: validProps.itemId,
    });
  });
});
