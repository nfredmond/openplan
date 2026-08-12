/**
 * Every registry entry can actually be computed, and every one agrees with PROJ.
 *
 * ═══ THE DEFECT THIS EXISTS AGAINST ═══
 *
 * A registry is a promise: "OpenPlan can place a layer in this system". An
 * entry whose method is unimplemented, or whose method is implemented but whose
 * parameters are missing one the formula needs, breaks that promise at the
 * worst possible moment — after the planner has uploaded a file — and can break
 * it in the worse way, by returning a plausible number computed from a
 * defaulted zero.
 *
 * ═══ WHY CONTROL POINTS AND NOT A ROUND TRIP ═══
 *
 * A forward-then-inverse round trip proves the two directions are consistent
 * with each other. It cannot see a constant that is wrong in BOTH — a
 * transposed standard parallel, a sexagesimal angle read as decimal degrees —
 * because the error cancels. So the fixture holds coordinates produced by PROJ
 * itself, checked against PROJ 9.7.1 on 2026-08-12 for all 5,967 projected
 * entries (worst disagreement 3.5e-4 m); 532 of them, covering every
 * implemented method, are committed here because CI has no PROJ installed.
 *
 * THE FRAME OF REFERENCE IS GREENWICH, and that is load-bearing rather than
 * incidental. These points were regenerated on 2026-08-12 after the discovery
 * that the previous ones were expressed in each system's OWN base geographic
 * CRS — which, for the fifty-two systems on a Paris, Ferro, Oslo or Rome
 * meridian, carried the very offset the registry had dropped, so the fixture
 * agreed with a registry that placed Paris in the English Channel. The 34
 * projected members of that group are now pinned into this fixture
 * unconditionally; `a-prime-meridian-that-is-not-greenwich.test.ts` fails if
 * any of them stops being covered.
 *
 * Regenerate with `scripts/generate-crs-registry.ts` and the sweep described in
 * that file's header if PROJ is upgraded.
 */

import { describe, expect, it } from "vitest";

import controlPoints from "./fixtures/crs-control-points.json";
import { forwardProject, inverseProject } from "@/lib/geo/crs/projections";
import { allCrsEntries, findCrsByCode } from "@/lib/geo/crs/registry";
import { CRS_METHODS } from "@/lib/geo/crs/types";

type ControlPoint = { crs: string; x: number; y: number; lon: number; lat: number };
const CONTROL_POINTS = controlPoints as ControlPoint[];

/** Metres per degree of latitude, for turning an angular error into a distance. */
const METRES_PER_DEGREE = 111_320;

function groundError(lon: number, lat: number, expectedLon: number, expectedLat: number): number {
  return (
    Math.hypot((lon - expectedLon) * Math.cos((expectedLat * Math.PI) / 180), lat - expectedLat) *
    METRES_PER_DEGREE
  );
}

describe("every CRS entry has an implemented method", () => {
  it("uses only methods the projection dispatcher implements", () => {
    const vocabulary = new Set<string>(CRS_METHODS);
    const unknown = new Set(
      allCrsEntries()
        .map((entry) => entry.method)
        .filter((method) => !vocabulary.has(method))
    );
    expect([...unknown]).toEqual([]);
  });

  it("computes a finite position for every entry, at the centre of its own area of use", () => {
    // The parameter-completeness check, done by RUNNING the projection rather
    // than by inspecting the parameter list — a list can agree with itself and
    // still be missing what the formula reads. `required()` throws on a missing
    // parameter precisely so this can catch it.
    const broken: string[] = [];
    for (const entry of allCrsEntries()) {
      const area = entry.areaOfUse;
      const longitude = area.west <= area.east ? (area.west + area.east) / 2 : area.west;
      const latitude = (area.south + area.north) / 2;
      try {
        const [x, y] = forwardProject(entry.method, longitude, latitude, entry.params);
        const [back, backLat] = inverseProject(entry.method, x, y, entry.params);
        if (![x, y, back, backLat].every(Number.isFinite)) {
          broken.push(`${entry.authority}:${entry.code} produced a non-finite coordinate`);
        } else if (groundError(back, backLat, longitude, latitude) > 0.001) {
          broken.push(`${entry.authority}:${entry.code} does not round-trip`);
        }
      } catch (error) {
        broken.push(`${entry.authority}:${entry.code} threw: ${(error as Error).message}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("agrees with PROJ on every committed control point, to within a millimetre", () => {
    const failures: string[] = [];
    for (const point of CONTROL_POINTS) {
      const entry = findCrsByCode(point.crs);
      if (!entry) {
        failures.push(`${point.crs} is no longer in the registry`);
        continue;
      }
      const [longitude, latitude] = inverseProject(
        entry.method,
        point.x * entry.unitToMetres,
        point.y * entry.unitToMetres,
        entry.params
      );
      const error = groundError(longitude, latitude, point.lon, point.lat);
      if (!(error < 0.001)) {
        failures.push(
          `${point.crs} (${entry.method}): ${error.toExponential(2)} m — ` +
            `PROJ says ${point.lon},${point.lat}; OpenPlan says ${longitude},${latitude}`
        );
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("exercises every implemented method against PROJ, not just the common ones", () => {
    // Without this the previous test could pass while covering only Transverse
    // Mercator — 72% of the registry — and the Hotine Oblique Mercator that
    // Alaska zone 1 depends on would be unmeasured.
    const covered = new Set<string>();
    for (const point of CONTROL_POINTS) {
      const entry = findCrsByCode(point.crs);
      if (entry) covered.add(entry.method);
    }
    // `geographic` is the identity and has no control points; everything that
    // actually computes something must be here.
    const computed = CRS_METHODS.filter((method) => method !== "geographic");
    expect([...covered].sort()).toEqual([...computed].sort());
  });

  it("keeps CRS_METHODS in the order the generated table indexes it by", () => {
    // The generated rows store a method as a NUMBER indexing this array.
    // Reordering the vocabulary silently reassigns every entry's method — a
    // Lambert zone becomes a Transverse Mercator and lands a hundred kilometres
    // away — with nothing else in the codebase changing.
    expect([...CRS_METHODS]).toEqual([
      "geographic",
      "lambert_conformal_conic_1sp",
      "lambert_conformal_conic_2sp",
      "transverse_mercator",
      "hotine_oblique_mercator",
      "albers_equal_area",
      "pseudo_mercator",
    ]);
  });

  it("distinguishes the two Hotine variants, which differ only in their false origin", () => {
    // Alaska zone 1 is variant A. Read as variant B the same parameters put it
    // hundreds of kilometres out, and nothing in the parameter VALUES says
    // which it is — only the flag on the entry does.
    const alaska = findCrsByCode("EPSG:26731");
    expect(alaska?.method).toBe("hotine_oblique_mercator");
    expect(alaska?.params.hotineVariant).toBe("A");

    const asA = inverseProject("hotine_oblique_mercator", 1_000_000, 1_000_000, alaska!.params);
    const asB = inverseProject("hotine_oblique_mercator", 1_000_000, 1_000_000, {
      ...alaska!.params,
      hotineVariant: "B",
    });
    expect(groundError(asA[0], asA[1], asB[0], asB[1])).toBeGreaterThan(100_000);
  });
});
