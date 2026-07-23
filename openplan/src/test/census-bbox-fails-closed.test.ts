import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bboxFromGeojson } from "@/lib/data-sources/census";

/**
 * `bboxFromGeojson` feeds real ACS, LODES, transit, and crash queries — not just
 * a map camera. It previously returned a Northern California bounding box for a
 * geometry with no coordinates, so a user anywhere on Earth with an empty or
 * malformed study area silently received demographics for somewhere they never
 * chose. Silently wrong is worse than empty: nothing downstream could tell.
 */
describe("bboxFromGeojson fails closed", () => {
  it("returns null for a geometry with no coordinates", () => {
    expect(bboxFromGeojson({ type: "Polygon", coordinates: [] })).toBeNull();
    expect(bboxFromGeojson({ type: "Polygon", coordinates: [[]] as never })).toBeNull();
    expect(bboxFromGeojson({ type: "MultiPolygon", coordinates: [] })).toBeNull();
  });

  it("never substitutes a Northern California extent", () => {
    const result = bboxFromGeojson({ type: "Polygon", coordinates: [] });
    // The exact literal that used to be returned.
    expect(result).not.toEqual({ minLon: -124.3, maxLon: -121.8, minLat: 39.0, maxLat: 40.4 });

    const source = readFileSync(
      path.join(process.cwd(), "src/lib/data-sources/census.ts"),
      "utf8"
    );
    expect(source).not.toContain("-124.3");
  });

  it("still computes a real extent for a real geometry, anywhere", () => {
    // Franklin County, Ohio — nowhere near the old fallback.
    const ohio = bboxFromGeojson({
      type: "Polygon",
      coordinates: [
        [
          [-83.2, 39.8],
          [-82.8, 39.8],
          [-82.8, 40.2],
          [-83.2, 40.2],
          [-83.2, 39.8],
        ],
      ],
    });
    expect(ohio).toEqual({ minLon: -83.2, maxLon: -82.8, minLat: 39.8, maxLat: 40.2 });
  });

  it("handles MultiPolygon geometry", () => {
    const bbox = bboxFromGeojson({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-97.8, 30.2],
            [-97.7, 30.2],
            [-97.7, 30.3],
            [-97.8, 30.3],
            [-97.8, 30.2],
          ],
        ],
      ],
    });
    expect(bbox).toEqual({ minLon: -97.8, maxLon: -97.7, minLat: 30.2, maxLat: 30.3 });
  });
});
