import { describe, expect, it } from "vitest";

import { checkCrsPlacement } from "@/lib/geo/crs/area-of-use";
import { forwardProject } from "@/lib/geo/crs/projections";
import { allCrsEntries, findCrsByCode } from "@/lib/geo/crs/registry";
import { longitudeExtent, reprojectBbox } from "@/lib/geo/crs/reproject";
import type { CrsRegistryEntry } from "@/lib/geo/crs/types";

/**
 * ALASKA IS A STATE, NOT AN EDGE CASE — and the placement check treated it as
 * one.
 *
 * Longitudes are normalized into (-180, 180], so a layer genuinely spanning the
 * antimeridian yields samples near -179 and near +179. `reprojectBbox` took the
 * min and the max of those, producing a box spanning nearly the whole planet
 * whose centre sits near longitude 0 — the Gulf of Guinea. `checkCrsPlacement`
 * then refused the layer and told the planner it "lands at" that position.
 *
 * Two defects in one sentence. The layer is refused, which is the safe
 * direction and still wrong: the one US region this code was hardened for
 * cannot get its statewide data in. And the refusal states a position the data
 * does not occupy, which sends the planner looking for a problem that is not
 * there. The projection arithmetic was never wrong — `longitudeDelta`'s own
 * comment calls Alaska a state, not an edge case, and the registry already
 * stores the Aleutian areas of use as west > east — but the extent the check
 * was handed could not express a wrapped range at all.
 */

/** Project a longitude/latitude into the entry's own grid, in the entry's units. */
function projectCorner(entry: CrsRegistryEntry, longitude: number, latitude: number): [number, number] {
  const [x, y] = forwardProject(entry.method, longitude, latitude, entry.params);
  return entry.method === "geographic" ? [x, y] : [x / entry.unitToMetres, y / entry.unitToMetres];
}

describe("longitudeExtent", () => {
  /*
    Asserted on plain angles rather than through a projection: the behaviour is
    a property of a set of points on a circle, and proving it through EPSG:3338
    would be proving two things at once and reporting one.
  */
  it("returns an ordinary range for data that does not cross the antimeridian", () => {
    expect(longitudeExtent([-122.5, -121.9, -122.1])).toEqual({ west: -122.5, east: -121.9 });
  });

  it("wraps for data that does cross it, instead of spanning the planet", () => {
    const extent = longitudeExtent([179.2, 179.9, -179.6, -178.4]);

    // west > east IS the wrapped form, the same convention the registry uses
    // for the western Aleutians and `contains` already reads.
    expect(extent.west).toBe(179.2);
    expect(extent.east).toBe(-178.4);
    expect(extent.west).toBeGreaterThan(extent.east);
  });

  it("keeps the wider of two candidate gaps, so a genuinely global set is not wrapped", () => {
    // Points spread over the Pacific and the Atlantic: the biggest gap is NOT
    // at the antimeridian, so the honest answer is the ordinary wide box.
    const extent = longitudeExtent([-170, -100, -20, 40]);
    expect(extent).toEqual({ west: -170, east: 40 });
  });

  it("handles a single sample", () => {
    expect(longitudeExtent([12.5])).toEqual({ west: 12.5, east: 12.5 });
  });
});

describe("an Alaska statewide layer in Alaska Albers", () => {
  const alaskaAlbers = findCrsByCode("EPSG:3338");

  it("is in the registry at all", () => {
    expect(alaskaAlbers, "EPSG:3338 (Alaska Albers) must be in the CRS registry").toBeTruthy();
  });

  it("reports a wrapped extent rather than a box spanning the planet", () => {
    if (!alaskaAlbers) return;

    // A projected extent covering the mainland through the western Aleutians.
    // Built by projecting real corner longitudes FORWARD, so the fixture is the
    // registry's own arithmetic rather than numbers typed from a map.
    const east = projectCorner(alaskaAlbers, -130, 55);
    const west = projectCorner(alaskaAlbers, 172, 52);

    const minX = Math.min(east[0], west[0]);
    const maxX = Math.max(east[0], west[0]);
    const minY = Math.min(east[1], west[1]);
    const maxY = Math.max(east[1], west[1]);

    const bbox = reprojectBbox(alaskaAlbers, minX, minY, maxX, maxY);
    expect(bbox).toBeTruthy();
    if (!bbox) return;

    // The whole point: it wraps instead of claiming to span from -179 to +179.
    expect(bbox.west).toBeGreaterThan(bbox.east);
  });

  it("is not refused for landing at a mid-ocean position it does not occupy", () => {
    if (!alaskaAlbers) return;

    const east = projectCorner(alaskaAlbers, -130, 55);
    const west = projectCorner(alaskaAlbers, 172, 52);

    const bbox = reprojectBbox(
      alaskaAlbers,
      Math.min(east[0], west[0]),
      Math.min(east[1], west[1]),
      Math.max(east[0], west[0]),
      Math.max(east[1], west[1])
    );
    if (!bbox) return;

    const placement = checkCrsPlacement({ entry: alaskaAlbers, bbox });

    // `ok`, not `status`. The first version of this assertion read
    // `placement.status`, which does not exist on the union — so it compared
    // `undefined` to a string and passed no matter what the check decided. The
    // mutation that removed the wrap-aware centre survived and said so.
    const detail = JSON.stringify(placement);
    expect(placement.ok, `Alaska Albers statewide data was refused: ${detail}`).toBe(true);

    // And it must not report the layer as sitting near longitude 0. That
    // sentence — "lands at 0.05°N 179.8°W" — was the visible half of the
    // defect, and it sent a planner looking for a problem that was not there.
    expect(detail).not.toMatch(/lands at 0\.\d+°[NS] 0\.\d+°[EW]/);
  });
});

describe("the generated registry keeps its wrapped areas of use", () => {
  /*
    THE ROOT CAUSE, GUARDED WHERE IT CAN BE SEEN.

    `scripts/generate-crs-registry.ts` needed a sampling longitude for the
    verification pass and wrote `area.east = 180` — where `area` IS
    `entry.areaOfUse`, the object it then emits. A local convenience silently
    rewrote the shipped table: every wrapped area of use lost its eastern half,
    and the registry went out with none at all. NAD83 / Alaska Albers declared
    172.42°E to 180° — the Aleutian tail without the mainland — so the placement
    check refused statewide Alaska data as outside the area its own coordinate
    system covers.

    `contains()` in area-of-use.ts was written for wrapped ranges and had
    nothing to read. This is what notices if that happens again: the count is a
    floor rather than an equality, because regenerating against a newer EPSG
    release may legitimately change how many there are.
  */
  it("carries areas of use that cross the antimeridian", () => {
    const wrapped = allCrsEntries().filter((entry) => entry.areaOfUse.west > entry.areaOfUse.east);

    expect(
      wrapped.length,
      "No area of use in the registry wraps the antimeridian. Every real one was truncated to " +
        "east = 180 once before, by a generator that mutated the object it was about to emit."
    ).toBeGreaterThan(0);
  });

  it("gives Alaska Albers an extent that reaches the mainland", () => {
    const entry = findCrsByCode("EPSG:3338");
    expect(entry).toBeTruthy();
    if (!entry) return;

    // EPSG's own extent for 3338 runs from 172.42°E east across the dateline to
    // about 130°W. Truncated at 180 it covered the Aleutians and nothing else.
    expect(entry.areaOfUse.west).toBeGreaterThan(170);
    expect(entry.areaOfUse.east).toBeLessThan(0);
  });
});
