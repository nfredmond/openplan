import { describe, expect, it } from 'vitest'
import { validateCorridorGeometry, type CorridorGeometry } from '@/lib/geo/corridor-geometry'

describe('corridor geometry validator', () => {
  it('accepts a closed WGS84 polygon ring', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-121.0812, 39.2019] as [number, number],
          [-121.0478, 39.2019] as [number, number],
          [-121.0478, 39.2197] as [number, number],
          [-121.0812, 39.2197] as [number, number],
          [-121.0812, 39.2019] as [number, number],
        ],
      ],
    }

    const result = validateCorridorGeometry(geometry)
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('rejects projected/easting-northing style coordinates', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [630000, 4340000] as [number, number],
          [631000, 4340000] as [number, number],
          [631000, 4341000] as [number, number],
          [630000, 4341000] as [number, number],
          [630000, 4340000] as [number, number],
        ],
      ],
    }

    const result = validateCorridorGeometry(geometry)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.includes('outside WGS84 lon/lat bounds'))).toBe(true)
  })

  it('rejects non-closed polygon rings', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-121.0812, 39.2019] as [number, number],
          [-121.0478, 39.2019] as [number, number],
          [-121.0478, 39.2197] as [number, number],
          [-121.0812, 39.2197] as [number, number],
          [-121.0812, 39.2020] as [number, number],
        ],
      ],
    }

    const result = validateCorridorGeometry(geometry)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.includes('ring must be closed'))).toBe(true)
  })
})

/**
 * THE VALIDATION NOBODY WAS CHECKING.
 *
 * The 2026-08-06 foundation audit ran six mutations against
 * `corridor-geometry.ts` and FIVE survived the whole 7,464-test suite: the
 * longitude bound could be widened 10x, the latitude bound too, the
 * minimum-ring-points check disabled, only the first ring validated, and the
 * geometry-type gate removed entirely — all with the suite green.
 *
 * That matters because this validator is the gate in front of every area,
 * length and density figure downstream. A corridor whose coordinates are not
 * longitudes at all was accepted as valid geometry, and everything computed
 * from it was meaningless rather than absent — the difference between a number
 * a planner can distrust and one they cannot.
 *
 * Each block below moves ONE rule and asserts BOTH sides of it. A bound tested
 * only from the inside can be widened without failing anything, which is
 * exactly how these five survived.
 */

/** A valid closed square, as the baseline every case below perturbs. */
function square(): CorridorGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [-121.0, 39.0],
        [-120.9, 39.0],
        [-120.9, 39.1],
        [-121.0, 39.1],
        [-121.0, 39.0],
      ],
    ],
  } as CorridorGeometry;
}

describe("corridor geometry — the WGS84 bounds are a real gate", () => {
  it("accepts coordinates at the exact bounds and rejects just outside them", () => {
    const at = validateCorridorGeometry({
      type: "Polygon",
      coordinates: [
        [
          [180, 90],
          [179.9, 90],
          [179.9, 89.9],
          [180, 89.9],
          [180, 90],
        ],
      ],
    } as CorridorGeometry);
    expect(at.ok).toBe(true);

    // Longitude: the audit widened this bound 10x and nothing failed.
    const lon = validateCorridorGeometry({
      type: "Polygon",
      coordinates: [
        [
          [180.1, 39.0],
          [-120.9, 39.0],
          [-120.9, 39.1],
          [-121.0, 39.1],
          [180.1, 39.0],
        ],
      ],
    } as CorridorGeometry);
    expect(lon.ok).toBe(false);
    expect(lon.issues.join(" ")).toMatch(/WGS84/i);
  });

  it("rejects a latitude outside the bounds, not only a longitude", () => {
    // The pair matters together: guarding one axis leaves the other free, and
    // both bounds were separately mutable with the suite green.
    const lat = validateCorridorGeometry({
      type: "Polygon",
      coordinates: [
        [
          [-121.0, 90.1],
          [-120.9, 39.0],
          [-120.9, 39.1],
          [-121.0, 39.1],
          [-121.0, 90.1],
        ],
      ],
    } as CorridorGeometry);
    expect(lat.ok).toBe(false);
    expect(lat.issues.join(" ")).toMatch(/WGS84/i);
  });

  it("rejects projected easting/northing values, which is what the bound is for", () => {
    const projected = validateCorridorGeometry({
      type: "Polygon",
      coordinates: [
        [
          [656789.1, 4344567.2],
          [656889.1, 4344567.2],
          [656889.1, 4344667.2],
          [656789.1, 4344667.2],
          [656789.1, 4344567.2],
        ],
      ],
    } as CorridorGeometry);
    expect(projected.ok).toBe(false);
    expect(projected.issues.join(" ")).toMatch(/projected CRS is not accepted/i);
  });
});

describe("corridor geometry — a ring must be a ring, and every ring is checked", () => {
  it("refuses a degenerate ring of fewer than four points", () => {
    // Three points cannot close a polygon, so it encloses no area and every
    // per-area metric derived from it divides by zero or reports zero.
    const degenerate = validateCorridorGeometry({
      type: "Polygon",
      coordinates: [
        [
          [-121.0, 39.0],
          [-120.9, 39.0],
          [-121.0, 39.0],
        ],
      ],
    } as CorridorGeometry);
    expect(degenerate.ok).toBe(false);
    expect(degenerate.issues.join(" ")).toMatch(/at least 4 points/i);

    // And four DOES pass, so the boundary is pinned rather than merely "small
    // rings fail".
    expect(
      validateCorridorGeometry({
        type: "Polygon",
        coordinates: [
          [
            [-121.0, 39.0],
            [-120.9, 39.0],
            [-120.9, 39.1],
            [-121.0, 39.0],
          ],
        ],
      } as CorridorGeometry).ok
    ).toBe(true);
  });

  it("validates EVERY ring, not only the first", () => {
    // The audit changed `rings.forEach` to `rings.slice(0, 1).forEach` and
    // nothing failed. An agency with two disjoint service areas is a
    // multipolygon, and it was being validated on one of its parts.
    const secondRingBad = validateCorridorGeometry({
      type: "Polygon",
      coordinates: [
        square().coordinates[0] as never,
        [
          [-500, 39.0],
          [-120.9, 39.0],
          [-120.9, 39.1],
          [-500, 39.0],
        ] as never,
      ],
    } as CorridorGeometry);
    expect(secondRingBad.ok).toBe(false);
    expect(secondRingBad.issues.join(" ")).toMatch(/ring_1/);
  });

  it("validates every polygon of a MultiPolygon, not only the first", () => {
    const secondPolygonBad = validateCorridorGeometry({
      type: "MultiPolygon",
      coordinates: [
        square().coordinates as never,
        [
          [
            [-121.0, 500],
            [-120.9, 39.0],
            [-120.9, 39.1],
            [-121.0, 500],
          ],
        ] as never,
      ],
    } as CorridorGeometry);
    expect(secondPolygonBad.ok).toBe(false);
    expect(secondPolygonBad.issues.join(" ")).toMatch(/ring_1/);
  });
});

describe("corridor geometry — the type gate is enforced", () => {
  it("refuses a LineString or a Point where a polygon is required", () => {
    // The rest of the geometry code assumes a polygon contract that was
    // enforced nowhere: the audit replaced this gate with `if (false)` and the
    // suite stayed green.
    for (const type of ["LineString", "Point", "GeometryCollection"]) {
      const result = validateCorridorGeometry({
        type,
        coordinates: [
          [-121.0, 39.0],
          [-120.9, 39.1],
        ],
      } as unknown as CorridorGeometry);
      expect(result.ok, type).toBe(false);
      expect(result.issues.join(" "), type).toMatch(/must be Polygon or MultiPolygon/i);
    }
  });

  it("refuses a null or undefined geometry rather than throwing", () => {
    expect(validateCorridorGeometry(null as unknown as CorridorGeometry).ok).toBe(false);
    expect(validateCorridorGeometry(undefined as unknown as CorridorGeometry).ok).toBe(false);
  });

  it("still accepts the valid shapes, so none of the above passes by refusing everything", () => {
    expect(validateCorridorGeometry(square()).ok).toBe(true);
    expect(
      validateCorridorGeometry({
        type: "MultiPolygon",
        coordinates: [square().coordinates as never],
      } as CorridorGeometry).ok
    ).toBe(true);
  });
});
