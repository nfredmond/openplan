import { describe, expect, it } from "vitest";
import {
  CALIFORNIA_STATE_FIPS,
  ccrsCountyCodeFromGeoid,
  parseCountyGeoid,
} from "@/lib/safety/county-code";

describe("parseCountyGeoid", () => {
  it("splits a 5-digit county GEOID into state and county FIPS", () => {
    expect(parseCountyGeoid("06057")).toEqual({ stateFips: "06", countyFips: 57 });
    expect(parseCountyGeoid(" 06037 ")).toEqual({ stateFips: "06", countyFips: 37 });
  });

  it("rejects anything that is not a 5-digit county GEOID", () => {
    // Place/CDP GEOIDs are 7 digits; a county filter must not be derived from one.
    for (const value of ["0618100", "6057", "abcde", "", "06_57"]) {
      expect(parseCountyGeoid(value)).toBeNull();
    }
  });
});

describe("ccrsCountyCodeFromGeoid", () => {
  it("derives the CCRS alphabetical code across the full California range", () => {
    // Each pair verified against live CCRS data (the code returns that county's
    // real city list): Alameda is 1st alphabetically, Yuba is 58th.
    const cases: Array<[string, number, string]> = [
      ["06001", 1, "Alameda"],
      ["06037", 19, "Los Angeles"],
      ["06055", 28, "Napa"],
      ["06057", 29, "Nevada"],
      ["06073", 37, "San Diego"],
      ["06115", 58, "Yuba"],
    ];
    for (const [geoid, expected, label] of cases) {
      expect(ccrsCountyCodeFromGeoid(geoid), label).toBe(expected);
    }
  });

  it("returns null outside California instead of inventing a code", () => {
    // A Texas or Ohio county has no CCRS county code; the caller must fall back
    // to a bbox-only query rather than filter on a meaningless number.
    expect(ccrsCountyCodeFromGeoid("48201")).toBeNull(); // Harris County, TX
    expect(ccrsCountyCodeFromGeoid("39049")).toBeNull(); // Franklin County, OH
    expect(CALIFORNIA_STATE_FIPS).toBe("06");
  });

  it("returns null for an even county FIPS, which is never a real CA county", () => {
    // Halving an even code would produce a plausible-looking but wrong county.
    expect(ccrsCountyCodeFromGeoid("06058")).toBeNull();
    expect(ccrsCountyCodeFromGeoid("06002")).toBeNull();
  });

  it("returns null past the last California county rather than extrapolating", () => {
    expect(ccrsCountyCodeFromGeoid("06117")).toBeNull();
    expect(ccrsCountyCodeFromGeoid("06999")).toBeNull();
  });

  it("returns null for missing or non-county selections", () => {
    expect(ccrsCountyCodeFromGeoid(null)).toBeNull();
    expect(ccrsCountyCodeFromGeoid(undefined)).toBeNull();
    expect(ccrsCountyCodeFromGeoid("0618100")).toBeNull(); // Davis city
  });

  it("never returns a code outside 1..58", () => {
    for (let fips = 1; fips <= 115; fips += 2) {
      const code = ccrsCountyCodeFromGeoid(`06${String(fips).padStart(3, "0")}`);
      expect(code).not.toBeNull();
      expect(code!).toBeGreaterThanOrEqual(1);
      expect(code!).toBeLessThanOrEqual(58);
    }
  });
});
