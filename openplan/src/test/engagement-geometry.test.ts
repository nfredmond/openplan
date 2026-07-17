import { describe, expect, it } from "vitest";

import {
  computeEngagementGeometryRepresentativePoint,
  countEngagementGeometryVertices,
  ENGAGEMENT_GEOMETRY_MAX_VERTICES,
  engagementGeometryTypeLabel,
  parseEngagementGeometry,
  readStoredEngagementGeometry,
} from "@/lib/engagement/geometry";

describe("parseEngagementGeometry", () => {
  it("accepts a valid Point", () => {
    const result = parseEngagementGeometry({ type: "Point", coordinates: [-121.06, 39.22] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.geometry.type).toBe("Point");
    }
  });

  it("accepts a valid LineString", () => {
    const result = parseEngagementGeometry({
      type: "LineString",
      coordinates: [
        [-121.06, 39.22],
        [-121.05, 39.21],
        [-121.04, 39.2],
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid closed Polygon", () => {
    const result = parseEngagementGeometry({
      type: "Polygon",
      coordinates: [
        [
          [-121.07, 39.22],
          [-121.06, 39.22],
          [-121.06, 39.21],
          [-121.07, 39.21],
          [-121.07, 39.22],
        ],
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unsupported geometry types", () => {
    expect(parseEngagementGeometry({ type: "MultiPolygon", coordinates: [] }).ok).toBe(false);
    expect(parseEngagementGeometry({ type: "GeometryCollection", geometries: [] }).ok).toBe(false);
    expect(parseEngagementGeometry("Point").ok).toBe(false);
    expect(parseEngagementGeometry(null).ok).toBe(false);
  });

  it("rejects coordinates outside WGS84 bounds", () => {
    expect(parseEngagementGeometry({ type: "Point", coordinates: [-190, 39.22] }).ok).toBe(false);
    expect(parseEngagementGeometry({ type: "Point", coordinates: [-121.06, 95] }).ok).toBe(false);
    expect(
      parseEngagementGeometry({
        type: "LineString",
        coordinates: [
          [-121.06, 39.22],
          [640000, 4340000], // projected easting/northing style values
        ],
      }).ok
    ).toBe(false);
  });

  it("rejects non-finite and non-numeric coordinates", () => {
    expect(parseEngagementGeometry({ type: "Point", coordinates: [Number.NaN, 39.22] }).ok).toBe(false);
    expect(parseEngagementGeometry({ type: "Point", coordinates: ["-121.06", "39.22"] }).ok).toBe(false);
  });

  it("rejects a LineString with fewer than 2 vertices", () => {
    expect(parseEngagementGeometry({ type: "LineString", coordinates: [[-121.06, 39.22]] }).ok).toBe(false);
  });

  it("rejects geometries above the vertex cap", () => {
    const tooManyVertices = Array.from({ length: ENGAGEMENT_GEOMETRY_MAX_VERTICES + 1 }, (_, index) => [
      -121.06 + index * 0.0001,
      39.22,
    ]);
    expect(parseEngagementGeometry({ type: "LineString", coordinates: tooManyVertices }).ok).toBe(false);

    const cappedVertices = tooManyVertices.slice(0, ENGAGEMENT_GEOMETRY_MAX_VERTICES);
    expect(parseEngagementGeometry({ type: "LineString", coordinates: cappedVertices }).ok).toBe(true);
  });

  it("rejects an unclosed polygon ring", () => {
    const result = parseEngagementGeometry({
      type: "Polygon",
      coordinates: [
        [
          [-121.07, 39.22],
          [-121.06, 39.22],
          [-121.06, 39.21],
          [-121.07, 39.21],
        ],
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/closed/i);
    }
  });

  it("rejects multi-ring polygons (no holes from the public draw tool)", () => {
    const ring = [
      [-121.07, 39.22],
      [-121.06, 39.22],
      [-121.06, 39.21],
      [-121.07, 39.22],
    ];
    expect(parseEngagementGeometry({ type: "Polygon", coordinates: [ring, ring] }).ok).toBe(false);
  });

  it("rejects positions with altitude or missing components", () => {
    expect(parseEngagementGeometry({ type: "Point", coordinates: [-121.06, 39.22, 810] }).ok).toBe(false);
    expect(parseEngagementGeometry({ type: "Point", coordinates: [-121.06] }).ok).toBe(false);
  });
});

describe("computeEngagementGeometryRepresentativePoint", () => {
  it("returns the point itself for a Point", () => {
    const representative = computeEngagementGeometryRepresentativePoint({
      type: "Point",
      coordinates: [-121.06, 39.22],
    });
    expect(representative).toEqual({ longitude: -121.06, latitude: 39.22 });
  });

  it("returns the vertex centroid for a LineString", () => {
    const representative = computeEngagementGeometryRepresentativePoint({
      type: "LineString",
      coordinates: [
        [-121.06, 39.2],
        [-121.04, 39.24],
      ],
    });
    expect(representative.longitude).toBeCloseTo(-121.05, 10);
    expect(representative.latitude).toBeCloseTo(39.22, 10);
  });

  it("excludes the closing vertex from a Polygon centroid", () => {
    const representative = computeEngagementGeometryRepresentativePoint({
      type: "Polygon",
      coordinates: [
        [
          [-121.08, 39.2],
          [-121.04, 39.2],
          [-121.04, 39.24],
          [-121.08, 39.24],
          [-121.08, 39.2],
        ],
      ],
    });
    expect(representative.longitude).toBeCloseTo(-121.06, 10);
    expect(representative.latitude).toBeCloseTo(39.22, 10);
  });
});

describe("countEngagementGeometryVertices", () => {
  it("counts vertices excluding the polygon closing vertex", () => {
    expect(countEngagementGeometryVertices({ type: "Point", coordinates: [-121.06, 39.22] })).toBe(1);
    expect(
      countEngagementGeometryVertices({
        type: "LineString",
        coordinates: [
          [-121.06, 39.22],
          [-121.05, 39.21],
        ],
      })
    ).toBe(2);
    expect(
      countEngagementGeometryVertices({
        type: "Polygon",
        coordinates: [
          [
            [-121.07, 39.22],
            [-121.06, 39.22],
            [-121.06, 39.21],
            [-121.07, 39.22],
          ],
        ],
      })
    ).toBe(3);
  });
});

describe("engagementGeometryTypeLabel", () => {
  it("maps geometry types to public-facing labels", () => {
    expect(engagementGeometryTypeLabel("Point")).toBe("Point");
    expect(engagementGeometryTypeLabel("LineString")).toBe("Line");
    expect(engagementGeometryTypeLabel("Polygon")).toBe("Area");
  });
});

describe("readStoredEngagementGeometry", () => {
  it("returns null for null/undefined/invalid stored values", () => {
    expect(readStoredEngagementGeometry(null)).toBeNull();
    expect(readStoredEngagementGeometry(undefined)).toBeNull();
    expect(readStoredEngagementGeometry({ type: "Point" })).toBeNull();
    expect(readStoredEngagementGeometry({ type: "Nonsense", coordinates: [] })).toBeNull();
  });

  it("returns the parsed geometry for valid stored values", () => {
    const geometry = readStoredEngagementGeometry({ type: "Point", coordinates: [-121.06, 39.22] });
    expect(geometry).toEqual({ type: "Point", coordinates: [-121.06, 39.22] });
  });
});
