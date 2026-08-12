import { describe, expect, it } from "vitest";

import controlPoints from "./fixtures/crs-control-points.json";
import { allCrsEntries, findCrsByCode } from "@/lib/geo/crs/registry";
import { reprojectGeometry, reprojectPosition } from "@/lib/geo/crs/reproject";

/**
 * A COORDINATE SYSTEM WHOSE ZERO MERIDIAN IS NOT GREENWICH.
 *
 * ═══ WHAT WAS WRONG ═══
 *
 * EPSG states a projection's longitude of origin RELATIVE TO THE PRIME MERIDIAN
 * OF ITS OWN DATUM. For all but fifty-two of the systems OpenPlan carries that
 * meridian is Greenwich and the distinction never surfaces. For the French,
 * Austrian, Norwegian, Portuguese, Spanish, Belgian, Italian, Swiss, Greek,
 * Swedish, Colombian and Indonesian systems below it is Paris, Ferro, Oslo,
 * Lisbon, Madrid, Brussels, Rome, Bern, Athens, Stockholm, Bogota or Jakarta.
 *
 * The generator joined the datum but never read `prime_meridian`, so each of
 * these shipped with its longitude of origin measured from a meridian nothing
 * downstream knew about. EPSG:27571 (NTF Paris / Lambert zone I) carried a
 * longitude of origin of exactly 0 — meaning Paris — and every consumer read it
 * as Greenwich, putting real Paris about 170 km west of itself, in the English
 * Channel. The geographic systems were worse: Batavia (Jakarta) was out by
 * 11,890 km, because there the meridian IS the whole transformation.
 *
 * ═══ WHY NOTHING CAUGHT IT ═══
 *
 * Two independent nets both had the same hole.
 *
 * `checkCrsPlacement` asks whether a layer lands inside its system's area of
 * use. 170 km west of Paris is still France, so it answered yes.
 *
 * The generator's own PROJ verification round-tripped each system through ITS
 * OWN BASE GEOGRAPHIC CRS — which carries the same non-Greenwich meridian. Both
 * sides of the comparison were shifted identically and the errors cancelled to
 * within a tenth of a millimetre. A check may not share a frame of reference
 * with the thing it checks; that verification is now anchored to Greenwich.
 *
 * ═══ WHY THIS TEST ASSERTS THE AUTHORITY'S NUMBERS AND NOT THE REGISTRY'S ═══
 *
 * The meridians below are written as EPSG PUBLISHES THEM — sexagesimal DMS, or
 * grads for Paris — and converted here. So this file is an independent
 * restatement of the source of truth rather than a photograph of whatever the
 * generator last emitted, and a regeneration that silently dropped the fold
 * fails here instead of shipping.
 */

/**
 * EPSG unit-of-measure 9110, "sexagesimal DMS": the literal `-17.4` means
 * 17°40′ WEST, not 17.4 degrees. Ferro is the entry that makes the difference
 * obvious — 16 km of it.
 */
function sexagesimal(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const text = Math.abs(value).toFixed(10);
  const [whole, fraction = ""] = text.split(".");
  const minutes = Number(fraction.slice(0, 2).padEnd(2, "0"));
  const secondsDigits = fraction.slice(2);
  const seconds = secondsDigits
    ? Number(`${secondsDigits.slice(0, 2).padEnd(2, "0")}.${secondsDigits.slice(2) || "0"}`)
    : 0;
  return sign * (Number(whole) + minutes / 60 + seconds / 3600);
}

/** EPSG unit-of-measure 9105, grads: 400 to the circle rather than 360. */
function grads(value: number): number {
  return value * 0.9;
}

/**
 * The prime meridians, exactly as the EPSG `prime_meridian` table publishes
 * them, in degrees east of Greenwich.
 */
const MERIDIANS = {
  Bern: sexagesimal(7.26225),
  Bogota: sexagesimal(-74.04513),
  Brussels: sexagesimal(4.220471),
  Ferro: sexagesimal(-17.4),
  Jakarta: sexagesimal(106.482779),
  Lisbon: sexagesimal(-9.0754862),
  Madrid: sexagesimal(-3.411455),
  Oslo: sexagesimal(10.43225),
  Paris: grads(2.5969213),
  "Paris RGS": sexagesimal(2.201395),
  Rome: sexagesimal(12.27084),
  Stockholm: sexagesimal(18.03298),
  Athens: sexagesimal(23.4258815),
} as const;

type NonGreenwich = {
  code: string;
  meridian: keyof typeof MERIDIANS;
  /** The longitude of origin EPSG publishes — measured from `meridian`, not Greenwich. */
  publishedLon0: number;
};

/**
 * Every system in the registry on a non-Greenwich meridian.
 *
 * Written out rather than derived, and the COUNT is asserted as an equality:
 * a regeneration that drops one of these is a system silently misplaced by
 * hundreds of kilometres, and a floor would not notice.
 */
const GEOGRAPHIC: NonGreenwich[] = [
  { code: "EPSG:4801", meridian: "Bern", publishedLon0: 0 }, // CH1903 (Bern)
  { code: "EPSG:4802", meridian: "Bogota", publishedLon0: 0 }, // Bogota 1975 (Bogota)
  { code: "EPSG:4803", meridian: "Lisbon", publishedLon0: 0 }, // Lisbon (Lisbon)
  { code: "EPSG:4804", meridian: "Jakarta", publishedLon0: 0 }, // Makassar (Jakarta)
  { code: "EPSG:4805", meridian: "Ferro", publishedLon0: 0 }, // MGI (Ferro)
  { code: "EPSG:4806", meridian: "Rome", publishedLon0: 0 }, // Monte Mario (Rome)
  { code: "EPSG:4809", meridian: "Brussels", publishedLon0: 0 }, // BD50 (Brussels)
  { code: "EPSG:4813", meridian: "Jakarta", publishedLon0: 0 }, // Batavia (Jakarta)
  { code: "EPSG:4814", meridian: "Stockholm", publishedLon0: 0 }, // RT38 (Stockholm)
  { code: "EPSG:4815", meridian: "Athens", publishedLon0: 0 }, // Greek (Athens)
  { code: "EPSG:4817", meridian: "Oslo", publishedLon0: 0 }, // NGO 1948 (Oslo)
  { code: "EPSG:4818", meridian: "Ferro", publishedLon0: 0 }, // S-JTSK (Ferro)
  { code: "EPSG:4820", meridian: "Jakarta", publishedLon0: 0 }, // Segara (Jakarta)
  { code: "EPSG:4903", meridian: "Madrid", publishedLon0: 0 }, // Madrid 1870 (Madrid)
  { code: "EPSG:4904", meridian: "Lisbon", publishedLon0: 0 }, // Lisbon 1890 (Lisbon)
  { code: "EPSG:5229", meridian: "Ferro", publishedLon0: 0 }, // S-JTSK/05 (Ferro)
  { code: "EPSG:8042", meridian: "Ferro", publishedLon0: 0 }, // Gusterberg (Ferro)
  { code: "EPSG:8043", meridian: "Ferro", publishedLon0: 0 }, // St. Stephen (Ferro)
];

const PROJECTED: NonGreenwich[] = [
  { code: "EPSG:2062", meridian: "Madrid", publishedLon0: 0 }, // Madrid 1870 / Spain LCC
  { code: "EPSG:20790", meridian: "Lisbon", publishedLon0: 1 }, // Portuguese National Grid
  { code: "EPSG:20791", meridian: "Lisbon", publishedLon0: 1 }, // Portuguese Grid
  { code: "EPSG:21500", meridian: "Brussels", publishedLon0: 0 }, // Belge Lambert 50
  { code: "EPSG:27391", meridian: "Oslo", publishedLon0: -4.66666666667 }, // NGO zone I
  { code: "EPSG:27392", meridian: "Oslo", publishedLon0: -2.33333333333 }, // NGO zone II
  { code: "EPSG:27393", meridian: "Oslo", publishedLon0: 0 }, // NGO zone III
  { code: "EPSG:27394", meridian: "Oslo", publishedLon0: 2.5 }, // NGO zone IV
  { code: "EPSG:27395", meridian: "Oslo", publishedLon0: 6.16666666667 }, // NGO zone V
  { code: "EPSG:27396", meridian: "Oslo", publishedLon0: 10.1666666667 }, // NGO zone VI
  { code: "EPSG:27397", meridian: "Oslo", publishedLon0: 14.1666666667 }, // NGO zone VII
  { code: "EPSG:27398", meridian: "Oslo", publishedLon0: 18.3333333333 }, // NGO zone VIII
  { code: "EPSG:27500", meridian: "Paris RGS", publishedLon0: 5.4 }, // ATF / Nord de Guerre
  { code: "EPSG:27561", meridian: "Paris", publishedLon0: 0 }, // NTF / Lambert Nord France
  { code: "EPSG:27562", meridian: "Paris", publishedLon0: 0 }, // NTF / Lambert Centre France
  { code: "EPSG:27563", meridian: "Paris", publishedLon0: 0 }, // NTF / Lambert Sud France
  { code: "EPSG:27564", meridian: "Paris", publishedLon0: 0 }, // NTF / Lambert Corse
  { code: "EPSG:27571", meridian: "Paris", publishedLon0: 0 }, // NTF / Lambert zone I
  { code: "EPSG:27572", meridian: "Paris", publishedLon0: 0 }, // NTF / Lambert zone II
  { code: "EPSG:27573", meridian: "Paris", publishedLon0: 0 }, // NTF / Lambert zone III
  { code: "EPSG:27574", meridian: "Paris", publishedLon0: 0 }, // NTF / Lambert zone IV
  { code: "EPSG:29702", meridian: "Paris", publishedLon0: 44.1 }, // Tananarive / Laborde approx
  { code: "EPSG:31251", meridian: "Ferro", publishedLon0: 28 }, // MGI / Austria GK West
  { code: "EPSG:31252", meridian: "Ferro", publishedLon0: 31 }, // MGI / Austria GK Central
  { code: "EPSG:31253", meridian: "Ferro", publishedLon0: 34 }, // MGI / Austria GK East
  { code: "EPSG:31281", meridian: "Ferro", publishedLon0: 28 }, // MGI / Austria West
  { code: "EPSG:31282", meridian: "Ferro", publishedLon0: 31 }, // MGI / Austria Central
  { code: "EPSG:31283", meridian: "Ferro", publishedLon0: 34 }, // MGI / Austria East
  { code: "EPSG:31288", meridian: "Ferro", publishedLon0: 28 }, // MGI / Austria zone M28
  { code: "EPSG:31289", meridian: "Ferro", publishedLon0: 31 }, // MGI / Austria zone M31
  { code: "EPSG:31290", meridian: "Ferro", publishedLon0: 34 }, // MGI / Austria zone M34
  { code: "ESRI:102450", meridian: "Oslo", publishedLon0: 0 }, // NGO_1948_Oslo_Baerum_Kommune
  { code: "ESRI:102451", meridian: "Oslo", publishedLon0: -4.66666666667 }, // NGO_1948_Oslo_Bergenhalvoen
  { code: "ESRI:102452", meridian: "Oslo", publishedLon0: 0 }, // NGO_1948_Oslo_Oslo_Kommune
];

/** A tenth of a millimetre of arc — far below anything that moves a shape. */
const TOLERANCE_DEGREES = 1e-8;

describe("a coordinate system whose prime meridian is not Greenwich", () => {
  it("folds the meridian into the longitude of origin, for every projected system", () => {
    const wrong: string[] = [];
    for (const system of PROJECTED) {
      const entry = findCrsByCode(system.code);
      if (!entry) {
        wrong.push(`${system.code}: not in the registry at all`);
        continue;
      }
      const expected = system.publishedLon0 + MERIDIANS[system.meridian];
      const actual = entry.params.lon0;
      if (typeof actual !== "number" || Math.abs(actual - expected) > TOLERANCE_DEGREES) {
        wrong.push(
          `${system.code} (${entry.name}): lon0 is ${actual}, but EPSG publishes ` +
            `${system.publishedLon0} from ${system.meridian}, which is ${expected} from Greenwich`
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("carries the meridian itself as the offset, for every geographic system", () => {
    const wrong: string[] = [];
    for (const system of GEOGRAPHIC) {
      const entry = findCrsByCode(system.code);
      if (!entry) {
        wrong.push(`${system.code}: not in the registry at all`);
        continue;
      }
      const expected = MERIDIANS[system.meridian];
      const actual = entry.params.lon0;
      if (typeof actual !== "number" || Math.abs(actual - expected) > TOLERANCE_DEGREES) {
        wrong.push(`${system.code} (${entry.name}): lon0 is ${actual}, expected ${expected}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * AN EQUALITY, NOT A FLOOR. A regeneration that stopped reading
   * `prime_meridian` would leave every one of these on Greenwich and this is
   * the assertion that notices — the individual checks above would too, but
   * this one also catches a NEW non-Greenwich system arriving with a PROJ
   * upgrade and going unexamined.
   */
  it("has exactly the systems this file accounts for, and no others", () => {
    const accounted = new Set([...GEOGRAPHIC, ...PROJECTED].map((system) => system.code));

    const geographicWithOffset = allCrsEntries()
      .filter((entry) => entry.method === "geographic" && typeof entry.params.lon0 === "number")
      .map((entry) => `${entry.authority}:${entry.code}`);

    expect(geographicWithOffset.length).toBe(GEOGRAPHIC.length);
    expect(geographicWithOffset.filter((code) => !accounted.has(code))).toEqual([]);
    expect(PROJECTED.length).toBe(34);
  });

  /**
   * THE FIXTURE MUST CARRY THEM. These control points were produced by PROJ on
   * a machine that has it; CI does not, so the committed fixture is the only
   * place the agreement survives. A regeneration whose sampling dropped these
   * would leave `every-crs-entry-has-an-implemented-method.test.ts` checking
   * everything except the systems that were once wrong by a country's width.
   */
  it("has a PROJ-derived control point committed for every projected system", () => {
    const covered = new Set((controlPoints as { crs: string }[]).map((point) => point.crs));
    const missing = PROJECTED.filter((system) => !covered.has(system.code)).map((s) => s.code);
    expect(missing).toEqual([]);
  });

  /**
   * THE WORKED EXAMPLE, kept concrete on purpose.
   *
   * These are the Lambert zone I coordinates of the Panthéon in Paris, obtained
   * from PROJ 9.7.1 (`cs2cs +proj=longlat +ellps=clrk80ign +no_defs +to
   * EPSG:27571`). Read with the meridian dropped they came back as 0.0150 °E —
   * a point in the English Channel, 170 km from where the file says it is, and
   * still inside the system's declared area of use, so nothing else objected.
   */
  it("puts a point in Paris in Paris", () => {
    const entry = findCrsByCode("EPSG:27571");
    expect(entry).not.toBeNull();

    const [longitude, latitude] = reprojectPosition(entry!, 601098.5715168315, 1128452.6946093387);

    expect(longitude).toBeCloseTo(2.3522, 6);
    expect(latitude).toBeCloseTo(48.8566, 6);
  });

  /**
   * A GEOGRAPHIC SYSTEM IS NOT AN IDENTITY WHEN ITS MERIDIAN IS NOT GREENWICH.
   * Rome is the clearest case: longitude 0 in Monte Mario (Rome) is the
   * Monte Mario observatory, not the Atlantic off Ghana.
   */
  it("shifts a geographic system that is measured from Rome", () => {
    const entry = findCrsByCode("EPSG:4806");
    expect(entry).not.toBeNull();

    const [longitude, latitude] = reprojectPosition(entry!, 0, 41.9);
    expect(longitude).toBeCloseTo(MERIDIANS.Rome, 8);
    expect(latitude).toBe(41.9);

    // And the whole-geometry path must agree with the single-position one — it
    // has a fast path that returns the geometry untouched, which is correct for
    // Greenwich and would have been silently wrong here.
    const shifted = reprojectGeometry(entry!, { type: "Point", coordinates: [0, 41.9] });
    expect(shifted?.type).toBe("Point");
    // Compared with a tolerance rather than exactly: the registry stores every
    // parameter to twelve significant figures, so its Rome is three microns
    // from the one recomputed above. Anything that matters here is kilometres.
    const [shiftedLon, shiftedLat] = (shifted as GeoJSON.Point).coordinates;
    expect(shiftedLon).toBeCloseTo(MERIDIANS.Rome, 8);
    expect(shiftedLat).toBe(41.9);
  });

  /**
   * AND THE FAST PATH SURVIVES FOR EVERYONE ELSE. A NAD83 geographic shapefile
   * — the overwhelming majority — must still pass through untouched, and by
   * IDENTITY rather than by arithmetic that happens to add zero: a county
   * parcels layer is millions of coordinates.
   */
  it("leaves a Greenwich geographic system exactly as it was", () => {
    const entry = findCrsByCode("EPSG:4269");
    expect(entry).not.toBeNull();
    expect(entry!.params.lon0).toBeUndefined();

    expect(reprojectPosition(entry!, -121.0, 39.2)).toEqual([-121.0, 39.2]);

    const geometry: GeoJSON.Geometry = { type: "Point", coordinates: [-121.0, 39.2] };
    expect(reprojectGeometry(entry!, geometry)).toBe(geometry);
  });
});
