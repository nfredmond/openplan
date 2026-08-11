import { describe, expect, it } from "vitest";
import {
  AOI_SEED_MAX_RING_VERTICES,
  bufferCorridorLineToRing,
  buildMissionAoiSeedSources,
  DEFAULT_CORRIDOR_BUFFER_METERS,
  prepareBoundarySeedRing,
} from "@/lib/aerial/aoi-seed";

/**
 * Seeding a mission AOI from project geometry (lane E1).
 *
 * These are the pure-geometry guarantees the editor affordance rests on:
 * choices exist only when seedable geometry exists, a MultiPolygon reduces to
 * its LARGEST ring with a disclosure, dense boundaries are simplified with a
 * disclosure, and the corridor buffer distance is a live parameter — not a
 * constant wearing a field's clothes.
 */

const METERS_PER_DEGREE_LAT = 111_132; // for expected-extent bounds only

function squareRing(
  centerLng: number,
  centerLat: number,
  halfSizeDeg: number
): [number, number][] {
  return [
    [centerLng - halfSizeDeg, centerLat - halfSizeDeg],
    [centerLng + halfSizeDeg, centerLat - halfSizeDeg],
    [centerLng + halfSizeDeg, centerLat + halfSizeDeg],
    [centerLng - halfSizeDeg, centerLat + halfSizeDeg],
    [centerLng - halfSizeDeg, centerLat - halfSizeDeg], // closed
  ];
}

function ringBbox(ring: [number, number][]) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return { minLng, minLat, maxLng, maxLat };
}

describe("buildMissionAoiSeedSources", () => {
  it("returns no choices when the project holds no seedable geometry", () => {
    expect(
      buildMissionAoiSeedSources({
        projectLabel: "Somewhere",
        placeGeometryGeojson: null,
        corridors: [],
      })
    ).toEqual([]);

    // A point is not an area; it may not seed a polygon.
    expect(
      buildMissionAoiSeedSources({
        projectLabel: "Somewhere",
        placeGeometryGeojson: { type: "Point", coordinates: [-100, 40] },
        corridors: [],
      })
    ).toEqual([]);
  });

  it("offers the project boundary when a Polygon exists, as an open ring with its label", () => {
    const sources = buildMissionAoiSeedSources({
      projectLabel: "Riverbend",
      placeGeometryGeojson: { type: "Polygon", coordinates: [squareRing(-100, 40, 0.01)] },
      corridors: [],
    });
    expect(sources).toHaveLength(1);
    const boundary = sources[0];
    if (boundary.kind !== "project_boundary") throw new Error("expected boundary source");
    expect(boundary.label).toBe("Riverbend");
    // Open ring: the closing duplicate is dropped so the editor can treat it
    // as editable vertices.
    expect(boundary.ring).toHaveLength(4);
    expect(boundary.ring[0]).not.toEqual(boundary.ring[boundary.ring.length - 1]);
    expect(boundary.notes).toEqual([]);
  });

  it("offers only corridors whose stored geometry is a LineString", () => {
    const sources = buildMissionAoiSeedSources({
      projectLabel: null,
      placeGeometryGeojson: null,
      corridors: [
        {
          id: "c-good",
          name: "Main Street",
          geometry_geojson: { type: "LineString", coordinates: [[-100, 40], [-99.99, 40]] },
        },
        {
          id: "c-bad",
          name: "Broken",
          geometry_geojson: { type: "Polygon", coordinates: [squareRing(-100, 40, 0.01)] },
        },
      ],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: "corridor", key: "corridor-c-good", label: "Main Street" });
  });
});

describe("prepareBoundarySeedRing", () => {
  it("takes the LARGEST part of a MultiPolygon and discloses the reduction", () => {
    // The small part comes FIRST, so an implementation that grabs the first
    // part instead of the largest gives a different answer.
    const small = squareRing(-90, 35, 0.001);
    const large = squareRing(-100, 40, 0.05);
    const prepared = prepareBoundarySeedRing({
      type: "MultiPolygon",
      coordinates: [[small], [large]],
    });
    expect(prepared).not.toBeNull();
    const bbox = ringBbox(prepared!.ring);
    expect(bbox.minLng).toBeCloseTo(-100.05, 5);
    expect(bbox.maxLat).toBeCloseTo(40.05, 5);
    expect(prepared!.notes.join(" ")).toMatch(/2 separate parts.*largest/i);
  });

  it("simplifies a dense boundary to the vertex cap and discloses it", () => {
    // A 2,000-vertex circle — the shape a real TIGERweb boundary approaches.
    const dense: [number, number][] = [];
    for (let i = 0; i < 2000; i++) {
      const angle = (2 * Math.PI * i) / 2000;
      dense.push([-100 + 0.1 * Math.cos(angle), 40 + 0.1 * Math.sin(angle)]);
    }
    dense.push(dense[0]);

    const prepared = prepareBoundarySeedRing({ type: "Polygon", coordinates: [dense] });
    expect(prepared).not.toBeNull();
    expect(prepared!.ring.length).toBeLessThanOrEqual(AOI_SEED_MAX_RING_VERTICES);
    expect(prepared!.ring.length).toBeGreaterThanOrEqual(3);
    expect(prepared!.notes.join(" ")).toMatch(/simplified from 2,000 to/i);
    // The simplified ring still spans the circle's extent.
    const bbox = ringBbox(prepared!.ring);
    expect(bbox.maxLng - bbox.minLng).toBeGreaterThan(0.19);
    expect(bbox.maxLat - bbox.minLat).toBeGreaterThan(0.19);
  });

  it("refuses degenerate geometry", () => {
    expect(prepareBoundarySeedRing(null)).toBeNull();
    expect(prepareBoundarySeedRing({ type: "Polygon", coordinates: [] })).toBeNull();
    // Three identical points "close" onto themselves and leave only 2 vertices.
    expect(
      prepareBoundarySeedRing({ type: "Polygon", coordinates: [[[-100, 40], [-100, 40], [-100, 40]]] })
    ).toBeNull();
  });
});

describe("bufferCorridorLineToRing", () => {
  const equatorLine: [number, number][] = [
    [10, 0],
    [10.01, 0],
  ];

  it("widens a line by the requested distance in real meters", () => {
    const result = bufferCorridorLineToRing(equatorLine, 100);
    expect(result).not.toBeNull();
    const { ring } = result!;
    expect(ring.length).toBeGreaterThanOrEqual(3);
    // Open ring — the editor adds the closing vertex on save.
    expect(ring[0]).not.toEqual(ring[ring.length - 1]);

    const bbox = ringBbox(ring);
    const halfHeightDeg = (bbox.maxLat - bbox.minLat) / 2;
    const expectedDeg = 100 / METERS_PER_DEGREE_LAT;
    // Within 10% of 100 m each side: this fails if "meters" secretly means
    // degrees, feet, or a fudge factor.
    expect(halfHeightDeg).toBeGreaterThan(expectedDeg * 0.9);
    expect(halfHeightDeg).toBeLessThan(expectedDeg * 1.1);
    // Square caps extend past both line ends.
    expect(bbox.minLng).toBeLessThan(10);
    expect(bbox.maxLng).toBeGreaterThan(10.01);
  });

  it("threads the buffer distance — twice the distance is twice the width", () => {
    const at50 = bufferCorridorLineToRing(equatorLine, 50)!;
    const at200 = bufferCorridorLineToRing(equatorLine, 200)!;
    const height50 = ringBbox(at50.ring).maxLat - ringBbox(at50.ring).minLat;
    const height200 = ringBbox(at200.ring).maxLat - ringBbox(at200.ring).minLat;
    // A hardcoded internal distance makes this ratio 1, not 4.
    expect(height200 / height50).toBeGreaterThan(3.9);
    expect(height200 / height50).toBeLessThan(4.1);
    // And neither equals the default's output, so the default is a starting
    // value rather than the only value.
    const atDefault = bufferCorridorLineToRing(equatorLine, DEFAULT_CORRIDOR_BUFFER_METERS)!;
    expect(at50.ring).not.toEqual(atDefault.ring);
    expect(at200.ring).not.toEqual(atDefault.ring);
  });

  it("scales longitude by latitude — the same meters are more degrees at 60°N", () => {
    const northernLine: [number, number][] = [
      [10, 60],
      [10, 60.01], // north-south line, so buffer width shows up in longitude
    ];
    const result = bufferCorridorLineToRing(northernLine, 100)!;
    const bbox = ringBbox(result.ring);
    const halfWidthDeg = (bbox.maxLng - bbox.minLng) / 2;
    const expectedDeg = 100 / (METERS_PER_DEGREE_LAT * Math.cos((60 * Math.PI) / 180));
    expect(halfWidthDeg).toBeGreaterThan(expectedDeg * 0.9);
    expect(halfWidthDeg).toBeLessThan(expectedDeg * 1.1);
  });

  it("refuses degenerate input", () => {
    expect(bufferCorridorLineToRing([[10, 0]], 100)).toBeNull();
    expect(bufferCorridorLineToRing([[10, 0], [10, 0]], 100)).toBeNull(); // duplicate point
    expect(bufferCorridorLineToRing(equatorLine, 0)).toBeNull();
    expect(bufferCorridorLineToRing(equatorLine, -50)).toBeNull();
    expect(bufferCorridorLineToRing(equatorLine, Number.NaN)).toBeNull();
  });
});
