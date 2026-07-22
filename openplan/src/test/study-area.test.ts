import { describe, expect, it } from "vitest";
import { LARGE_AREA_KM2, summarizeCorridorText } from "@/lib/models/study-area";

describe("summarizeCorridorText", () => {
  it("returns invalid for empty, non-JSON, or non-polygon input", () => {
    expect(summarizeCorridorText("")).toEqual({ valid: false, bbox: null, areaKm2: null });
    expect(summarizeCorridorText("not json")).toEqual({ valid: false, bbox: null, areaKm2: null });
    expect(summarizeCorridorText(JSON.stringify({ type: "Point", coordinates: [0, 0] }))).toEqual({
      valid: false,
      bbox: null,
      areaKm2: null,
    });
  });

  it("computes a bbox and approximate area for a Polygon", () => {
    const polygon = JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [-121.8, 38.5],
          [-121.8, 38.6],
          [-121.7, 38.6],
          [-121.7, 38.5],
          [-121.8, 38.5],
        ],
      ],
    });
    const summary = summarizeCorridorText(polygon);
    expect(summary.valid).toBe(true);
    expect(summary.bbox).toEqual({ minLon: -121.8, minLat: 38.5, maxLon: -121.7, maxLat: 38.6 });
    // ~0.1deg lat (11km) x ~0.1deg lon (~8.7km at 38.5N) ≈ 96 km²; small, not "large".
    expect(summary.areaKm2).toBeGreaterThan(50);
    expect(summary.areaKm2).toBeLessThan(LARGE_AREA_KM2);
  });

  it("walks every ring of a MultiPolygon for the bounding extent", () => {
    const multi = JSON.stringify({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-122, 38],
            [-122, 39],
            [-121, 39],
            [-121, 38],
            [-122, 38],
          ],
        ],
        [
          [
            [-120, 40],
            [-120, 41],
            [-119, 41],
            [-119, 40],
            [-120, 40],
          ],
        ],
      ],
    });
    const summary = summarizeCorridorText(multi);
    expect(summary.bbox).toEqual({ minLon: -122, minLat: 38, maxLon: -119, maxLat: 41 });
    expect(summary.areaKm2).toBeGreaterThan(LARGE_AREA_KM2);
  });
});
