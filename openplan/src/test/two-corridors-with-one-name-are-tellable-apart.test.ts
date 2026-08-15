import { describe, expect, it } from "vitest";

import { corridorLengthKm } from "@/lib/cartographic/project-corridor-record";

/**
 * TWO CORRIDORS WITH THE SAME NAME MUST BE TELLABLE APART.
 *
 * WHERE THIS CAME FROM. A tester uploaded a corridor file next to an existing
 * corridor of the same name and was left with two list entries that were
 * character-for-character identical — same label, same type, same sub-line,
 * same delete button — with no way to know which held the real geometry. The
 * delete controls even shared an accessible name, so a screen-reader user was
 * in the same position with fewer options.
 *
 * Length is what actually differs between two shapes, and it is what a planner
 * would use to decide which to keep. This guards the measurement; the component
 * renders it in the row AND in the delete control's accessible name.
 *
 * IT IS NOT A SURVEY. Equirectangular, rendered with ≈, and asked only to tell
 * 0.2 km from 4 km — the job. Its ONE hard requirement is not to answer for a
 * shape it cannot measure.
 */
function line(...coords: Array<[number, number]>) {
  return { type: "LineString", coordinates: coords };
}

describe("two corridors with one name are tellable apart", () => {
  it("measures a line closely enough to distinguish two shapes", () => {
    // ~0.1 degree of latitude ≈ 11 km.
    const km = corridorLengthKm(line([-121.5, 38.5], [-121.5, 38.6]));
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(10);
    expect(km!).toBeLessThan(12);
  });

  it("gives different answers for different shapes, which is the whole point", () => {
    const short = corridorLengthKm(line([-121.5, 38.5], [-121.5, 38.501]));
    const long = corridorLengthKm(line([-121.5, 38.5], [-121.5, 38.9]));
    expect(short).not.toBeNull();
    expect(long).not.toBeNull();
    expect(long!).toBeGreaterThan(short! * 10);
  });

  it("adds up every segment rather than measuring end to end", () => {
    // A dog-leg is longer than the straight line between its ends. Measuring
    // endpoints would make a winding corridor look like a short one.
    const dogleg = corridorLengthKm(line([-121.5, 38.5], [-121.4, 38.5], [-121.4, 38.6]));
    const straight = corridorLengthKm(line([-121.5, 38.5], [-121.4, 38.6]));
    expect(dogleg!).toBeGreaterThan(straight!);
  });

  it("answers null for a shape it cannot measure, rather than zero", () => {
    // Zero would render as "≈ 0.00 km" and read as a real, tiny corridor.
    expect(corridorLengthKm(null)).toBeNull();
    expect(corridorLengthKm({ type: "LineString", coordinates: [] })).toBeNull();
    expect(corridorLengthKm({ type: "LineString", coordinates: [[-121.5, 38.5]] })).toBeNull();
    expect(corridorLengthKm({ type: "Point", coordinates: [-121.5, 38.5] })).toBeNull();
    expect(corridorLengthKm({ type: "LineString", coordinates: [["a", "b"], [1, 2]] })).toBeNull();
  });
});
