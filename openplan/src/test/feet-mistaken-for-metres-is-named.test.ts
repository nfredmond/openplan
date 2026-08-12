/**
 * The commonest legacy mistake gets its own sentence, and the sentence is proved.
 *
 * ═══ WHY THIS DESERVES ITS OWN REFUSAL ═══
 *
 * A planning department's shelf of shapefiles is full of State Plane data, and
 * State Plane exists in two units: metres and US survey feet. The two are the
 * same zone with the same origin, so a file in one read as the other converts
 * without any error at all — it just lands about a thousand kilometres away.
 * Nobody typing a zone into a picker is thinking about units, and "NAD83 /
 * California zone 2" and "NAD83 / California zone 2 (ftUS)" are adjacent lines
 * in every list they will ever see.
 *
 * The generic "this landed outside the area of use" message is TRUE for this
 * case and useless: it tells a planner their file is wrong without telling them
 * what to change. This one names the other unit, names the system, and says
 * where the file lands read that way — and OpenPlan can prove all of it,
 * because "the same projection on the same datum in a different unit" is a fact
 * in the registry rather than a guess about what somebody meant.
 */

import { describe, expect, it } from "vitest";

import { checkCrsPlacement } from "@/lib/geo/crs/area-of-use";
import { forwardProject } from "@/lib/geo/crs/projections";
import { crsSiblings, findCrsByCode } from "@/lib/geo/crs/registry";
import { reprojectBbox } from "@/lib/geo/crs/reproject";
import type { CrsRegistryEntry } from "@/lib/geo/crs/types";

const SACRAMENTO: [number, number] = [-121.4944, 38.5816];

/** The extent a file in `sourceCode` occupies, read as `readAs`. */
function landedAs(sourceCode: string, readAs: CrsRegistryEntry, position: [number, number]) {
  const source = findCrsByCode(sourceCode)!;
  const [x, y] = forwardProject(source.method, position[0], position[1], source.params);
  // The FILE's numbers, in the source system's own units — which is all a
  // shapefile carries. Reading them as another system means feeding exactly
  // these numbers to a different projection.
  const fileX = x / source.unitToMetres;
  const fileY = y / source.unitToMetres;
  return reprojectBbox(readAs, fileX, fileY, fileX, fileY);
}

describe("feet mistaken for metres is named, not just refused", () => {
  it("names the metre form of the same zone when a metre file is read as survey feet", () => {
    const asFeet = findCrsByCode("EPSG:2226")!; // NAD83 / California zone 2 (ftUS)
    const inMetres = findCrsByCode("EPSG:26942")!; // NAD83 / California zone 2

    const bbox = landedAs("EPSG:26942", asFeet, SACRAMENTO)!;
    const check = checkCrsPlacement({
      entry: asFeet,
      bbox,
      siblings: crsSiblings(asFeet),
      reprojectAs: (sibling) => landedAs("EPSG:26942", sibling, SACRAMENTO),
    });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("crs_unit_mismatch");
    // Names the system to switch to, by name AND by code, so the planner can
    // find it in the picker without translating anything.
    expect(check.message).toContain(inMetres.name);
    expect(check.message).toContain("EPSG:26942");
    expect(check.message).toContain("metres");
  });

  it("names the survey-foot form when a survey-foot file is read as metres", () => {
    // The mistake runs both ways and the message has to as well; a test of one
    // direction only would pass with the sibling search hardcoded to metres.
    const asMetres = findCrsByCode("EPSG:26942")!;
    const bbox = landedAs("EPSG:2226", asMetres, SACRAMENTO)!;
    const check = checkCrsPlacement({
      entry: asMetres,
      bbox,
      siblings: crsSiblings(asMetres),
      reprojectAs: (sibling) => landedAs("EPSG:2226", sibling, SACRAMENTO),
    });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("crs_unit_mismatch");
    expect(check.message).toContain("EPSG:2226");
    expect(check.message).toContain("US survey foot");
  });

  it("falls back to the general refusal when the other unit does not fit either", () => {
    // Ohio's numbers read as a California zone are wrong in a way no unit
    // change fixes. Claiming a unit mismatch here would send the planner off to
    // try the metre version of a zone that was never right, so the distinction
    // between the two messages has to be earned rather than assumed.
    const california = findCrsByCode("EPSG:2226")!;
    const bbox = landedAs("EPSG:3734", california, [-82.99, 39.96])!;
    const check = checkCrsPlacement({
      entry: california,
      bbox,
      siblings: crsSiblings(california),
      reprojectAs: (sibling) => landedAs("EPSG:3734", sibling, [-82.99, 39.96]),
    });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe("crs_outside_area_of_use");
    expect(check.message).not.toContain("almost certainly in");
  });

  it("says nothing about units when the file is in the unit it was read as", () => {
    const california = findCrsByCode("EPSG:2226")!;
    const bbox = landedAs("EPSG:2226", california, SACRAMENTO)!;
    const check = checkCrsPlacement({
      entry: california,
      bbox,
      siblings: crsSiblings(california),
      reprojectAs: (sibling) => landedAs("EPSG:2226", sibling, SACRAMENTO),
    });
    expect(check.ok).toBe(true);
  });

  it("finds the sibling from the projection's geometry, not from the names", () => {
    // EPSG publishes the survey-foot false easting as a ROUNDED value —
    // 6,561,666.667 ft, which converts to 2,000,000.0001 m against the metre
    // form's exact 2,000,000. Matched exactly the two are different systems and
    // the message above can never fire; matched on names it would fire on
    // anything that reads similarly. This asserts the middle road works.
    const feet = findCrsByCode("EPSG:2226")!;
    const metres = findCrsByCode("EPSG:26942")!;
    expect(feet.siblingKey).toBe(metres.siblingKey);
    expect(feet.params.x0).not.toBe(metres.params.x0);

    // And a genuinely different zone must NOT share the key, or every refusal
    // would offer a neighbouring zone as the fix.
    const zone3 = findCrsByCode("EPSG:26943")!;
    expect(zone3.siblingKey).not.toBe(metres.siblingKey);
  });
});
