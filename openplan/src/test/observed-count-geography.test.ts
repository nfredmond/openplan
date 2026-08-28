import { describe, expect, it } from "vitest";

import { buildObservedCountGeographySnapshot } from "@/lib/models/observed-count-geography";

const polygon = {
  type: "Polygon",
  coordinates: [[[-120, 39], [-119, 39], [-119, 40], [-120, 40], [-120, 39]]],
};

describe("observed-count geography snapshot", () => {
  it("freezes one subdivision without a preferred-state field", () => {
    const snapshot = buildObservedCountGeographySnapshot({
      geometry: polygon,
      resolverRow: { state: "resolved", state_fips_json: ["06"], tract_count: 14 },
    });
    expect(snapshot.resolution).toBe("resolved");
    expect(snapshot.subdivisions).toEqual([{ fips: "06", code: "CA" }]);
    expect(JSON.stringify(snapshot)).not.toContain("preferred");
  });

  it("freezes every subdivision for multistate and border polygons", () => {
    const snapshot = buildObservedCountGeographySnapshot({
      geometry: polygon,
      resolverRow: { state: "resolved", state_fips_json: ["41", "06", "41"], tract_count: 8 },
    });
    expect(snapshot.subdivisions).toEqual([
      { fips: "06", code: "CA" },
      { fips: "41", code: "OR" },
    ]);
  });

  it("preserves US territories", () => {
    const snapshot = buildObservedCountGeographySnapshot({
      geometry: polygon,
      resolverRow: { state: "resolved", state_fips_json: ["72", "78"], tract_count: 2 },
    });
    expect(snapshot.subdivisions).toEqual([
      { fips: "72", code: "PR" },
      { fips: "78", code: "VI" },
    ]);
  });

  it("does not guess from antimeridian coordinates", () => {
    const antimeridian = {
      type: "Polygon",
      coordinates: [[[179, 51], [-179, 51], [-179, 53], [179, 53], [179, 51]]],
    };
    const snapshot = buildObservedCountGeographySnapshot({
      geometry: antimeridian,
      resolverRow: { state: "unresolved", state_fips_json: [], tract_count: 0 },
    });
    expect(snapshot.resolution).toBe("unresolved");
    expect(snapshot.subdivisions).toEqual([]);
  });

  it("keeps a failed resolver distinct from unsupported geography", () => {
    const unresolved = buildObservedCountGeographySnapshot({
      geometry: polygon,
      resolverError: "reference layer unavailable",
    });
    const unsupported = buildObservedCountGeographySnapshot({
      geometry: polygon,
      projectCountryCode: "NZ",
    });
    expect(unresolved.resolution).toBe("unresolved");
    expect(unsupported.resolution).toBe("unsupported");
  });
});
