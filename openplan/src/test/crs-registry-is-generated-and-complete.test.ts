/**
 * The CRS registry is generated, complete, and legally redistributable.
 *
 * WHY THE COUNT IS AN EQUALITY AND NOT A FLOOR. The registry is regenerated
 * from whatever PROJ is installed on the machine doing the regenerating, and
 * the failure that matters is not "it got smaller" — it is "it got smaller
 * without anybody noticing". A floor passes a regeneration that drops every
 * Lambert zone because a method name changed upstream; the planner in Ohio then
 * gets "OpenPlan does not carry that coordinate system", which reads like a
 * limitation rather than a bug. An equality forces whoever regenerates to look
 * at the number and say why it moved.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CRS_REGISTRY_SOURCE,
  allCrsEntries,
  crsRegistrySize,
  findCrsByCode,
  findCrsByName,
} from "@/lib/geo/crs/registry";

const GENERATED = resolve(process.cwd(), "src/lib/geo/crs/crs-registry.generated.ts");

/**
 * The number of coordinate systems this build carries.
 *
 * Produced by `scripts/generate-crs-registry.ts` against PROJ 9.7.1 /
 * EPSG v12.029 on 2026-08-12. If a regeneration changes it, change it here in
 * the same commit and say in the message what moved and why.
 */
const EXPECTED_ENTRY_COUNT = 6688;

describe("the CRS registry is generated rather than curated", () => {
  it("carries exactly the number of systems the generator produced", () => {
    expect(crsRegistrySize()).toBe(EXPECTED_ENTRY_COUNT);
  });

  it("names the authority and version it was generated from", () => {
    // Without this a planner cannot tell which EPSG revision decided where
    // their layer landed, and neither can anyone debugging it a year later.
    expect(CRS_REGISTRY_SOURCE).toMatch(/^PROJ \d+\.\d+\.\d+ \/ EPSG v[\d.]+$/);
  });

  it("carries the EPSG attribution its terms of use require", () => {
    // The EPSG Dataset may be extracted and redistributed only if recipients
    // are told the terms and IOGP's ownership is acknowledged. That obligation
    // is discharged by a comment in a generated file, which is exactly the kind
    // of thing a future regeneration drops silently — so it is asserted.
    const source = readFileSync(GENERATED, "utf8");
    expect(source).toContain("International Association of Oil and Gas Producers (IOGP)");
    expect(source).toContain("https://epsg.org/terms-of-use.html");
    expect(source).toContain("GENERATED FILE — DO NOT EDIT BY HAND");
  });

  it("covers the systems a US planning department actually holds", () => {
    // Named individually rather than counted, because a count cannot tell that
    // the survey-foot State Plane zones — the ones legacy shapefiles are in —
    // survived a regeneration that kept the metre ones.
    const wanted = [
      ["EPSG:2226", "NAD83 / California zone 2 (ftUS)"],
      ["EPSG:26943", "NAD83 / California zone 3"],
      ["EPSG:3310", "NAD83 / California Albers"],
      ["EPSG:2260", "NAD83 / New York East (ftUS)"],
      ["EPSG:3435", "NAD83 / Illinois East (ftUS)"],
      ["EPSG:6501", "NAD83(2011) / Minnesota Central (ftUS)"],
      ["EPSG:26731", "NAD27 / Alaska zone 1"],
      ["EPSG:26918", "NAD83 / UTM zone 18N"],
      ["EPSG:3857", "WGS 84 / Pseudo-Mercator"],
      ["EPSG:4326", "WGS 84"],
      ["EPSG:4269", "NAD83"],
      ["EPSG:4267", "NAD27"],
    ];
    for (const [code, name] of wanted) {
      const entry = findCrsByCode(code);
      expect(entry, `${code} is missing from the registry`).not.toBeNull();
      expect(entry?.name).toBe(name);
    }
  });

  it("is not a United States registry — a planner anywhere resolves their own zone", () => {
    // Product rule zero: nothing about a place is baked in. A registry that
    // happened to contain only US systems would satisfy every other test here
    // and would still be a hardcoded country.
    const elsewhere = ["EPSG:27700", "EPSG:2154", "EPSG:28356", "EPSG:31370", "EPSG:32633"];
    for (const code of elsewhere) {
      expect(findCrsByCode(code), `${code} is missing — the registry has become US-only`).not.toBeNull();
    }
  });

  it("finds an ESRI .prj's spelling, which carries no authority code at all", () => {
    // This is the normal shape of a shapefile out of ArcGIS: the name is the
    // only identifier in the file. Without the alias index the registry could
    // only resolve files that ESRI did not write.
    const entry = findCrsByName("NAD_1983_StatePlane_California_II_FIPS_0402_Feet");
    expect(entry).not.toBeNull();
    expect(entry?.unit).toBe("US survey foot");
    expect(entry?.kind).toBe("projected");
  });

  it("absorbs punctuation and case, which vary between the tools that write a .prj", () => {
    // NOT the same assertion as the one above. Looking a name up by its own
    // exact spelling passes whether or not any normalization happens at all —
    // it was doing exactly that until a mutation showed the check was vacuous.
    // These four spellings are the same name written the way different software
    // writes it, and only one of them is the string in the registry.
    const canonical = findCrsByName("NAD_1983_StatePlane_California_II_FIPS_0402_Feet");
    for (const spelling of [
      "nad_1983_stateplane_california_ii_fips_0402_feet",
      "NAD 1983 StatePlane California II FIPS 0402 Feet",
      "NAD-1983-StatePlane-California-II-FIPS-0402-Feet",
      "  NAD_1983_StatePlane_California_II_FIPS_0402_Feet  ",
    ]) {
      expect(findCrsByName(spelling)?.code, `"${spelling}" did not resolve`).toBe(canonical?.code);
    }
  });

  it("still refuses a name that is merely CLOSE to one it carries", () => {
    // The other half of normalization, and the more important half. Collapsing
    // punctuation must not become fuzzy matching: California zone 2 and zone 3
    // are a degree and a half apart, and offering one for the other would put
    // a layer a hundred kilometres out with nothing on screen to say so.
    expect(findCrsByName("NAD_1983_StatePlane_California_FIPS_0402_Feet")).toBeNull();
    expect(findCrsByName("NAD83 / California zone")).toBeNull();
    expect(findCrsByName("California zone 2")).toBeNull();
  });

  it("gives every entry an identity, a datum, a unit and an area of use", () => {
    const broken = allCrsEntries().filter(
      (entry) =>
        entry.authority.length === 0 ||
        entry.code.length === 0 ||
        entry.name.length === 0 ||
        entry.datum.length === 0 ||
        entry.unit.length === 0 ||
        entry.areaOfUse.description.length === 0 ||
        !Number.isFinite(entry.areaOfUse.north) ||
        entry.areaOfUse.north <= entry.areaOfUse.south ||
        !Number.isFinite(entry.unitToMetres) ||
        entry.unitToMetres <= 0
    );
    expect(broken.map((entry) => `${entry.authority}:${entry.code}`)).toEqual([]);
  });

  it("never claims a datum shift of zero for a datum whose shift is unknown", () => {
    // The distinction this asserts is the whole honesty property of the datum
    // column: "measured at 0 m" and "PROJ has no transformation for this at
    // all" are different facts, and collapsing the second into the first would
    // present an unquantified error as no error.
    const wrong = allCrsEntries().filter(
      (entry) => entry.datumShiftMetres === null && !entry.requiresDatumAcknowledgement
    );
    expect(wrong.map((entry) => `${entry.authority}:${entry.code} (${entry.datum})`)).toEqual([]);
  });

  it("attaches a note to every system whose datum needs acknowledging", () => {
    const silent = allCrsEntries().filter(
      (entry) => entry.requiresDatumAcknowledgement && !entry.datumShiftNote
    );
    expect(silent.map((entry) => `${entry.authority}:${entry.code}`)).toEqual([]);
  });

  it("stays out of the browser, so a 1.4 MB table never ships to a planner", () => {
    // ═══ WHY THIS IS A GUARD AND NOT A NOTE ═══
    //
    // The registry is ~1.4 MB and it is server-side for two reasons: sending it
    // to a browser would be a gratuitous download on every page that draws a
    // map, and deciding what coordinate system a file is in is a CLAIM that a
    // tab must not be able to make about its own upload. `reproject.ts`
    // therefore takes an ENTRY rather than a code, so the transformation can
    // happen in the browser without the registry following it.
    //
    // That property survives exactly as long as nobody adds a convenient
    // `findCrsByCode` import to a picker component. This is the mechanism that
    // stops them — and it is checked by reading imports rather than by
    // inspecting a build, because at the time it was written nothing imported
    // the registry at all, which made a bundle scan pass for the wrong reason.
    const roots = ["src/components", "src/app"];
    const offenders: string[] = [];

    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const source = readFileSync(path, "utf8");
        const isClient = /^\s*["']use client["']/m.test(source);
        const importsRegistry = /from\s+["'][^"']*geo\/crs\/(registry|crs-registry\.generated)["']/.test(source);
        // The barrel re-exports the registry, so importing IT from a client
        // component pulls the table in just as surely.
        const importsBarrel = /from\s+["'][^"']*lib\/geo\/crs["']/.test(source);
        if (isClient && (importsRegistry || importsBarrel)) {
          offenders.push(relative(process.cwd(), path));
        }
      }
    };
    for (const root of roots) walk(resolve(process.cwd(), root));

    expect(
      offenders,
      "a client component imports the CRS registry — resolve the system on the server and send the entry instead"
    ).toEqual([]);
  });

  it("measures NAD27 as far from WGS 84 and NAD83 as close to it", () => {
    // The two anchors of the whole datum column. NAD27 is the datum of the
    // "super old shapefiles" this feature exists for, and if its shift ever
    // reads as small the acknowledgement stops appearing.
    const nad27 = findCrsByCode("EPSG:4267");
    expect(nad27?.datumShiftMetres).toBeGreaterThan(50);
    expect(nad27?.requiresDatumAcknowledgement).toBe(true);
    expect(nad27?.datumShiftNote).toMatch(/North American Datum 1927/);

    const nad83 = findCrsByCode("EPSG:4269");
    expect(nad83?.datumShiftMetres).toBeLessThan(5);
    expect(nad83?.requiresDatumAcknowledgement).toBe(false);
  });
});
