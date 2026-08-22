import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * THE BOUNDING BOX AROUND A RESIDENT'S PIN MAY BE TOO BIG. IT MAY NEVER BE TOO
 * SMALL.
 *
 * `engagement_items_with_nearby_crashes` narrows candidate crashes with a
 * degree-space `&&` box (so the GIST index is usable) and then decides
 * membership with `ST_DWithin` on the spheroid. That is only correct while the
 * box CONTAINS the true circle. If it ever shrinks inside it, crashes at the
 * edge of the radius stop being counted — with no error, no warning, and a
 * quieter number on a screen a planner is about to put in a grant application.
 *
 * THIS DEFECT WAS REAL, NOT HYPOTHETICAL. The function first shipped in this
 * session dividing by 111320 (the MEAN metres per degree). Probed against live
 * PostGIS on 2026-08-21, that box failed to contain a due-north point at the
 * radius at every latitude up to 51.5 degrees, and a due-east point at the
 * equator. A degree of latitude is SHORTEST at the equator — about 110,574 m on
 * WGS84 — so the divisor has to sit below that minimum, not at the average.
 *
 * The test reads the constant out of the migration and does the arithmetic,
 * rather than matching the text: putting 111320 back fails on the inequality
 * below, and so does any other value that stops covering the circle.
 */

/**
 * The shortest a degree of latitude gets on WGS84 (at the equator), in metres.
 * Anything larger than this as a divisor produces a box shorter than the radius
 * somewhere on earth.
 */
const MIN_METRES_PER_DEGREE_LATITUDE = 110574.4;

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260821000001_engagement_crash_corroboration.sql"
);

function readDivisors(): number[] {
  const sql = readFileSync(MIGRATION, "utf8");
  // The two expansion terms: `/ <divisor>.0 AS dy` and `/ (<divisor>.0 * ...)`.
  const matches = [...sql.matchAll(/FROM radius\)\s*\/\s*\(?\s*(\d+(?:\.\d+)?)/g)];
  return matches.map((match) => Number(match[1]));
}

describe("the crash-proximity box is a superset of the circle it stands in for", () => {
  it("finds the expansion divisors the function actually uses", () => {
    const divisors = readDivisors();
    // Two of them — one for latitude, one for longitude. A change in shape that
    // drops or adds a term should land here rather than pass silently.
    expect(divisors).toHaveLength(2);
    expect(divisors.every((d) => Number.isFinite(d) && d > 0)).toBe(true);
  });

  it("never divides by more than the shortest real degree of latitude", () => {
    for (const divisor of readDivisors()) {
      expect(
        divisor,
        `dividing metres by ${divisor} makes the box narrower than the radius near the equator, ` +
          `so crashes at the edge would be dropped with no error. Use a value at or below ` +
          `${MIN_METRES_PER_DEGREE_LATITUDE}.`
      ).toBeLessThanOrEqual(MIN_METRES_PER_DEGREE_LATITUDE);
    }
  });

  it("covers the radius in the north-south direction at every latitude", () => {
    // The direct arithmetic the SQL performs, checked against the true metres
    // per degree of latitude — which varies with latitude on an ellipsoid.
    const [divisor] = readDivisors();
    for (let lat = -89; lat <= 89; lat += 1) {
      for (const radiusMeters of [10, 50, 100, 250, 500, 1000]) {
        const boxHalfHeightDegrees = radiusMeters / divisor;
        // WGS84 metres per degree of latitude, to the standard series.
        const rad = (lat * Math.PI) / 180;
        const metresPerDegree =
          111132.92 -
          559.82 * Math.cos(2 * rad) +
          1.175 * Math.cos(4 * rad) -
          0.0023 * Math.cos(6 * rad);
        const trueHalfHeightDegrees = radiusMeters / metresPerDegree;
        expect(
          boxHalfHeightDegrees,
          `at ${lat}° with a ${radiusMeters} m radius the box is shorter than the circle`
        ).toBeGreaterThanOrEqual(trueHalfHeightDegrees);
      }
    }
  });

  it("keeps the cosine floor that stops the longitude term exploding at the poles", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    // Without it, cos(90°) is ~0 and the expansion is division by zero — the
    // box becomes infinite or NaN and the index scan stops being an index scan.
    expect(sql).toMatch(/GREATEST\(cos\(radians\([\s\S]{0,80}?\),\s*0\.01\)/);
  });
});
