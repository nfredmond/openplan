/**
 * "Read as that coordinate system, where does this file actually land?"
 *
 * ═══ WHY THIS EXISTS AT ALL ═══
 *
 * A projection is a total function. Feed California zone 2 a pair of numbers
 * from Ohio and it returns a longitude and a latitude — correctly formatted,
 * inside the valid range, plausible to look at, and wrong by a thousand
 * kilometres. Nothing in the arithmetic can notice, and nothing downstream can
 * either: a shape drawn in the wrong place looks exactly like a shape drawn in
 * the right place.
 *
 * The only thing that CAN notice is the coordinate system's own declared area
 * of use, which every entry in the registry carries because the authority
 * publishes it. So after reprojecting, OpenPlan asks the question the planner
 * cannot: does this land where this system is for?
 *
 * ═══ THE CHECKS, AND WHICH ONE REFUSES ═══
 *
 * Three refuse and one warns, and the split is deliberate. A layer outside its
 * system's area of use is a mistake with no legitimate reading. A layer far
 * from the workspace's home geography is usually a mistake and sometimes a
 * neighbouring county, a statewide dataset, or a regional agency's file — so it
 * is said, loudly, and the planner decides.
 *
 * These apply to a `.prj` that NAMES a projected system exactly as they apply
 * to a planner's assertion. A `.prj` is evidence about what a file was made in,
 * not proof that the file is what its maker thought: a mislabelled export is
 * one of the ways a layer arrives in the wrong place, and it is not rarer than
 * a mis-picked zone.
 */

import type { CrsRefusal, CrsRegistryEntry } from "./types";

/**
 * How far outside its declared area of use a layer may sit before OpenPlan
 * refuses to place it, in degrees.
 *
 * This is a TOLERANCE FOR LEGITIMATE SPILL, not a claim about where anything
 * is. Areas of use are published to the jurisdiction's boundary and real layers
 * cross it — a county's road network follows roads a little way into the next
 * county, and a State Plane zone's published extent is a rectangle around a
 * shape that is not one. One degree absorbs that.
 *
 * It does not need to be tight to do its job. The errors this catches are not
 * marginal: reading survey feet as metres, or metres as survey feet, displaces
 * a layer by hundreds of kilometres, and picking the wrong State Plane zone
 * moves it by one to three degrees at minimum. A tighter tolerance would refuse
 * honest layers without catching anything a loose one misses.
 */
export const AREA_OF_USE_MARGIN_DEGREES = 1;

/**
 * How close to 0°N 0°E a layer has to land to be read as the origin of the
 * world rather than as a position in the Gulf of Guinea.
 *
 * "Null island" is where coordinates go when a false easting was not applied,
 * when a numeric field was empty, or when a projection was skipped entirely. It
 * is caught separately from the area-of-use test because a handful of registry
 * entries legitimately cover that water, and for those the area test would let
 * the classic failure through.
 */
export const NULL_ISLAND_DEGREES = 1;

/**
 * How far a layer's centre may sit from the workspace's home geography before
 * OpenPlan says so. WARNS, NEVER REFUSES — see the header.
 */
export const HOME_GEOGRAPHY_WARNING_DEGREES = 5;

export type CrsPlacementWarningCode =
  | "extends_beyond_area_of_use"
  | "far_from_home_geography"
  | "datum_shift";

export type CrsPlacementWarning = {
  code: CrsPlacementWarningCode;
  /** Shown to the planner, verbatim. */
  message: string;
};

export type Bbox = { west: number; south: number; east: number; north: number };

export type CrsPlacementCheck = { ok: true; warnings: CrsPlacementWarning[] } | CrsRefusal;

export type CrsPlacementInput = {
  /** The system the file was read as. */
  entry: CrsRegistryEntry;
  /** Where the reprojected data actually landed, in WGS 84 degrees. */
  bbox: Bbox;
  /**
   * The same projection on the same datum in other units, from `crsSiblings`.
   * Passed in rather than looked up so this module never reaches the registry —
   * it has to run in the browser, where the registry must not go.
   */
  siblings?: readonly CrsRegistryEntry[];
  /** Reprojects the ORIGINAL coordinates as a sibling entry, for check 2. */
  reprojectAs?: (sibling: CrsRegistryEntry) => Bbox | null;
  /** The workspace's own geography, when it has one. */
  homeGeography?: Bbox | null;
};

function centreOf(bbox: Bbox): { longitude: number; latitude: number } {
  const latitude = (bbox.south + bbox.north) / 2;
  // A WRAPPED box is stored west > east, the same convention `contains` below
  // reads and the same one the registry uses for the western Aleutians. Its
  // midpoint is not (west + east) / 2 — that lands on the far side of the
  // planet, which is how an Alaska statewide layer came to be refused for
  // "landing at" a position in the Gulf of Guinea.
  if (bbox.west <= bbox.east) {
    return { longitude: (bbox.west + bbox.east) / 2, latitude };
  }
  const midpoint = (bbox.west + bbox.east + 360) / 2;
  return { longitude: midpoint > 180 ? midpoint - 360 : midpoint, latitude };
}

function contains(area: CrsRegistryEntry["areaOfUse"], longitude: number, latitude: number, margin: number): boolean {
  if (latitude < area.south - margin || latitude > area.north + margin) return false;
  // An area of use that crosses the antimeridian is stored with west > east and
  // wraps rather than being empty — the western Aleutians are exactly this, and
  // treating the range as inverted would refuse every layer in Alaska's tail.
  return area.west <= area.east
    ? longitude >= area.west - margin && longitude <= area.east + margin
    : longitude >= area.west - margin || longitude <= area.east + margin;
}

function formatPosition(longitude: number, latitude: number): string {
  const northSouth = latitude >= 0 ? "N" : "S";
  const eastWest = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(2)}°${northSouth} ${Math.abs(longitude).toFixed(2)}°${eastWest}`;
}

/**
 * Decide whether a layer, read as `entry`, landed somewhere that system covers.
 *
 * Tested against the CENTRE of the layer rather than requiring the whole layer
 * to fit. A layer legitimately overhangs its zone; a layer whose MIDDLE is
 * outside the zone is not a layer in that zone at all. The distinction matters:
 * requiring containment would refuse a statewide dataset in a State Plane zone,
 * which is a normal thing for a planner to have.
 */
export function checkCrsPlacement(input: CrsPlacementInput): CrsPlacementCheck {
  const { entry, bbox } = input;
  const centre = centreOf(bbox);
  const warnings: CrsPlacementWarning[] = [];

  // ── 3. Null island ─────────────────────────────────────────────────────────
  if (
    Math.abs(bbox.west) <= NULL_ISLAND_DEGREES &&
    Math.abs(bbox.east) <= NULL_ISLAND_DEGREES &&
    Math.abs(bbox.south) <= NULL_ISLAND_DEGREES &&
    Math.abs(bbox.north) <= NULL_ISLAND_DEGREES
  ) {
    return {
      ok: false,
      reason: "crs_null_island",
      message:
        `Read as ${entry.name}, this layer lands at 0°N 0°E — the origin of the coordinate system, in the ocean ` +
        `off West Africa. That is where coordinates end up when a projection was never applied or a false ` +
        `easting is missing, so OpenPlan will not place it. Check that the file really is in ${entry.name}, and ` +
        `that the export completed.`,
    };
  }

  // ── 1 and 2. Area of use, and the unit that would have fitted ──────────────
  if (!contains(entry.areaOfUse, centre.longitude, centre.latitude, AREA_OF_USE_MARGIN_DEGREES)) {
    // THE FEET-FOR-METRES SENTENCE. Reading a file's survey feet as metres, or
    // the reverse, is the commonest legacy mistake there is, and it produces a
    // layer that is wrong by hundreds of kilometres rather than subtly off. It
    // is worth its own message because the planner can act on it immediately —
    // and because OpenPlan can PROVE it: the same projection on the same datum
    // in the other unit is a registry fact, not a guess about what they meant.
    for (const sibling of input.siblings ?? []) {
      if (sibling.unitToMetres === entry.unitToMetres) continue;
      const alternative = input.reprojectAs?.(sibling);
      if (!alternative) continue;
      const alternativeCentre = centreOf(alternative);
      if (contains(sibling.areaOfUse, alternativeCentre.longitude, alternativeCentre.latitude, AREA_OF_USE_MARGIN_DEGREES)) {
        return {
          ok: false,
          reason: "crs_unit_mismatch",
          message:
            `Read as ${entry.name}, this layer lands at ${formatPosition(centre.longitude, centre.latitude)} — ` +
            `outside the area that system covers (${entry.areaOfUse.description}). Read as the same zone in ` +
            `${sibling.unit === "metre" ? "metres" : sibling.unit + "s"} — ${sibling.name} ` +
            `(${sibling.authority}:${sibling.code}) — it lands at ` +
            `${formatPosition(alternativeCentre.longitude, alternativeCentre.latitude)}, which is inside it. ` +
            `The file is almost certainly in ${sibling.unit === "metre" ? "metres" : sibling.unit + "s"}, not ` +
            `${entry.unit === "metre" ? "metres" : entry.unit + "s"}.`,
        };
      }
    }

    return {
      ok: false,
      reason: "crs_outside_area_of_use",
      message:
        `Read as ${entry.name}, this layer lands at ${formatPosition(centre.longitude, centre.latitude)}, which is ` +
        `outside the area that coordinate system covers (${entry.areaOfUse.description}). OpenPlan will not place ` +
        `it there, because a layer in the wrong place looks exactly like a layer in the right one. Either the ` +
        `coordinate system is not the one this file was made in, or the file's coordinates are not what they ` +
        `appear to be.`,
    };
  }

  // ── Warnings ───────────────────────────────────────────────────────────────
  const corners: [number, number][] = [
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.west, bbox.north],
    [bbox.east, bbox.north],
  ];
  if (corners.some(([longitude, latitude]) => !contains(entry.areaOfUse, longitude, latitude, AREA_OF_USE_MARGIN_DEGREES))) {
    warnings.push({
      code: "extends_beyond_area_of_use",
      message:
        `Part of this layer reaches outside the area ${entry.name} covers (${entry.areaOfUse.description}). ` +
        `That is normal for a layer that crosses a zone boundary, and accuracy degrades gradually with distance ` +
        `from the zone rather than failing — but the far edge is the least accurate part of it.`,
    });
  }

  if (entry.requiresDatumAcknowledgement && entry.datumShiftNote) {
    warnings.push({ code: "datum_shift", message: entry.datumShiftNote });
  }

  const home = input.homeGeography;
  if (home) {
    const homeCentre = centreOf(home);
    const distance = Math.hypot(
      (centre.longitude - homeCentre.longitude) * Math.cos((centre.latitude * Math.PI) / 180),
      centre.latitude - homeCentre.latitude
    );
    if (distance > HOME_GEOGRAPHY_WARNING_DEGREES) {
      warnings.push({
        code: "far_from_home_geography",
        message:
          `This layer lands at ${formatPosition(centre.longitude, centre.latitude)}, roughly ` +
          `${Math.round(distance * 111)} km from your workspace's geography. That is expected for a statewide or ` +
          `regional dataset and worth a second look otherwise — nothing is wrong with the file, it is just a long ` +
          `way from where you work.`,
      });
    }
  }

  return { ok: true, warnings };
}
