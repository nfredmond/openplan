import { describe, expect, it } from "vitest";

import {
  splitStateQualifier,
  stateFipsFromName,
  stateFipsFromUsps,
  stateUspsFromFips,
  STATE_FIPS_TO_USPS,
} from "@/lib/geographies/state-fips";
import { STATE_ABBREVIATIONS } from "@/lib/geographies/county-utils";

/**
 * A typed place query may name a state ("Franklin County, OH"). Before this
 * existed, nothing parsed that form. It appeared to work for counties by pure
 * coincidence — the county catalog ranks against a label that already ends in
 * ", OH", so the comma survived normalization into an exact string match — and
 * it actively broke everything served by TIGERweb, whose LIKE predicate turned
 * the comma into a space and matched nothing at all.
 */
describe("splitStateQualifier", () => {
  it("splits a postal abbreviation off the name", () => {
    expect(splitStateQualifier("Franklin County, OH")).toEqual({ name: "Franklin County", stateFips: "39" });
  });

  it("splits a spelled-out state off the name", () => {
    expect(splitStateQualifier("Franklin County, Ohio")).toEqual({ name: "Franklin County", stateFips: "39" });
  });

  it("is case- and whitespace-insensitive on the qualifier", () => {
    expect(splitStateQualifier("columbus ,  oh")).toEqual({ name: "columbus", stateFips: "39" });
    expect(splitStateQualifier("Columbus, ohio")).toEqual({ name: "Columbus", stateFips: "39" });
  });

  it("leaves a query with no qualifier untouched", () => {
    expect(splitStateQualifier("Franklin County")).toEqual({ name: "Franklin County", stateFips: null });
    expect(splitStateQualifier("Winston-Salem")).toEqual({ name: "Winston-Salem", stateFips: null });
  });

  /**
   * The important negative case: a trailing fragment that is not a state must
   * be kept as searchable text, never silently dropped. Discarding it would
   * turn a search for "Lake, Charles" into a search for "Lake".
   */
  it("keeps a trailing fragment that names no state", () => {
    expect(splitStateQualifier("Lake, Charles")).toEqual({ name: "Lake, Charles", stateFips: null });
    expect(splitStateQualifier("Truckee-Grass Valley, XX")).toEqual({
      name: "Truckee-Grass Valley, XX",
      stateFips: null,
    });
  });

  it("splits on the LAST comma, so a multi-comma name keeps its own commas", () => {
    expect(splitStateQualifier("Winston-Salem, High Point, NC")).toEqual({
      name: "Winston-Salem, High Point",
      stateFips: "37",
    });
  });

  it("leaves a dangling comma alone rather than producing an empty name", () => {
    expect(splitStateQualifier("Columbus,")).toEqual({ name: "Columbus,", stateFips: null });
    expect(splitStateQualifier(", OH")).toEqual({ name: ", OH", stateFips: null });
  });

  it("covers territories and DC, not just the fifty states", () => {
    expect(splitStateQualifier("San Juan, PR").stateFips).toBe("72");
    expect(splitStateQualifier("Washington, District of Columbia").stateFips).toBe("11");
  });
});

describe("state FIPS lookups", () => {
  it("round-trips every FIPS through its abbreviation", () => {
    for (const [fips, usps] of Object.entries(STATE_FIPS_TO_USPS)) {
      expect(stateFipsFromUsps(usps)).toBe(fips);
      expect(stateUspsFromFips(fips)).toBe(usps);
    }
  });

  /**
   * The name table lives in `county-utils` and the FIPS table lives here. They
   * are composed rather than re-typed, so this pins that composition: every
   * state name the app can abbreviate must also resolve to a FIPS.
   */
  it("resolves every state name the abbreviation table knows", () => {
    for (const name of Object.keys(STATE_ABBREVIATIONS)) {
      expect(stateFipsFromName(name), `no FIPS for ${name}`).not.toBeNull();
    }
  });

  it("returns null for unknown or missing input instead of guessing", () => {
    expect(stateFipsFromUsps("ZZ")).toBeNull();
    expect(stateFipsFromUsps(null)).toBeNull();
    expect(stateFipsFromUsps("")).toBeNull();
    expect(stateFipsFromName("Atlantis")).toBeNull();
    expect(stateFipsFromName(undefined)).toBeNull();
  });
});
