import { describe, expect, it } from "vitest";

import {
  isTractFeatureProperties,
  tractFeatureToSelection,
} from "@/lib/cartographic/tract-feature-to-selection";

const validProps = {
  kind: "census_tract" as const,
  geoid: "06057010100",
  name: "Grass Valley core (demo)",
  popTotal: 4200,
  pctZeroVehicle: 12,
  pctPoverty: 14.2,
  pctNonwhite: 18.5,
};

describe("isTractFeatureProperties", () => {
  it("accepts a well-formed tract payload", () => {
    expect(isTractFeatureProperties(validProps)).toBe(true);
  });

  it("accepts a payload with null numeric fields", () => {
    expect(
      isTractFeatureProperties({
        ...validProps,
        popTotal: null,
        pctZeroVehicle: null,
        pctPoverty: null,
        pctNonwhite: null,
      }),
    ).toBe(true);
  });

  it("accepts a payload with null name", () => {
    expect(isTractFeatureProperties({ ...validProps, name: null })).toBe(true);
  });

  it("rejects a payload whose kind is not census_tract", () => {
    expect(isTractFeatureProperties({ ...validProps, kind: "project" })).toBe(false);
  });

  it("rejects a payload with a blank geoid", () => {
    expect(isTractFeatureProperties({ ...validProps, geoid: "" })).toBe(false);
  });

  it("rejects a payload whose pctZeroVehicle is not number or null", () => {
    expect(
      isTractFeatureProperties({ ...validProps, pctZeroVehicle: "12%" }),
    ).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isTractFeatureProperties(null)).toBe(false);
    expect(isTractFeatureProperties("census_tract")).toBe(false);
    expect(isTractFeatureProperties(undefined)).toBe(false);
  });
});

describe("tractFeatureToSelection", () => {
  it("returns null when the payload fails the type guard", () => {
    expect(tractFeatureToSelection({ kind: "unknown" })).toBeNull();
  });

  it("maps valid properties to a census-tract inspector selection", () => {
    const selection = tractFeatureToSelection(validProps);
    expect(selection).not.toBeNull();
    expect(selection!.kind).toBe("census_tract");
    expect(selection!.title).toBe("Grass Valley core (demo)");
    expect(selection!.kicker).toBe("Census tract");
    expect(selection!.avatarChar).toBe("E");
    expect(selection!.meta).toEqual([
      { label: "population", value: "4,200" },
      { label: "zero-vehicle", value: "12.0%" },
      { label: "poverty", value: "14.2%" },
      { label: "nonwhite", value: "18.5%" },
    ]);
  });

  it("does not attach a primaryAction — tracts have no detail page", () => {
    const selection = tractFeatureToSelection(validProps);
    expect(selection!.primaryAction).toBeUndefined();
    expect(selection!.secondaryAction).toBeUndefined();
  });

  it("omits the nonwhite meta row when pctNonwhite is null", () => {
    const selection = tractFeatureToSelection({
      ...validProps,
      pctNonwhite: null,
    });
    expect(selection!.meta).toEqual([
      { label: "population", value: "4,200" },
      { label: "zero-vehicle", value: "12.0%" },
      { label: "poverty", value: "14.2%" },
    ]);
  });

  it("renders em-dash for null numeric fields", () => {
    const selection = tractFeatureToSelection({
      ...validProps,
      popTotal: null,
      pctZeroVehicle: null,
      pctPoverty: null,
    });
    expect(selection!.meta).toEqual([
      { label: "population", value: "—" },
      { label: "zero-vehicle", value: "—" },
      { label: "poverty", value: "—" },
      { label: "nonwhite", value: "18.5%" },
    ]);
  });

  it("falls back to a geoid-based title when name is null", () => {
    const selection = tractFeatureToSelection({ ...validProps, name: null });
    expect(selection!.title).toBe("Census tract 06057010100");
  });

  it("falls back to a geoid-based title when name is whitespace only", () => {
    const selection = tractFeatureToSelection({ ...validProps, name: "   " });
    expect(selection!.title).toBe("Census tract 06057010100");
  });

  it("omits featureRef when no sourceId is supplied", () => {
    const selection = tractFeatureToSelection(validProps);
    expect(selection!.featureRef).toBeUndefined();
  });

  it("populates featureRef with the injected sourceId and geoid", () => {
    const selection = tractFeatureToSelection(validProps, {
      sourceId: "cartographic-census-tracts",
    });
    expect(selection!.featureRef).toEqual({
      sourceId: "cartographic-census-tracts",
      featureId: "06057010100",
    });
  });
});
