import { describe, expect, it } from "vitest";
import { countyRunShowsCeqaScreen } from "@/lib/models/county-run-vmt-framework";

// The CEQA §15064.3 screen follows the run's own geography: a California county,
// city, CDP or county subdivision shows it; anywhere else, or a geography that
// names no state, does not.
describe("county run CEQA screen", () => {
  it.each([
    ["county_fips", "06113", true], // Yolo County, CA
    ["place", "0644000", true], // Los Angeles city, CA
    ["place", "0603526", true], // a California CDP-length GEOID
    ["place", "0611391000", true], // a California county subdivision GEOID
    ["county_fips", "32007", false], // Elko County, NV
    ["place", "3240000", false], // Las Vegas city, NV
    ["place", "4104131000", false], // an Oregon county subdivision GEOID
    ["place", "40900", false], // a CBSA code names no state
    ["place", "2430R", false], // a tribal area names no state
    ["place", "06-44000", false], // malformed
    [null, "06113", false],
  ])("%s %s shows the screen: %s", (geography_type, geography_id, expected) => {
    expect(countyRunShowsCeqaScreen({ geography_type, geography_id })).toBe(expected);
  });

  it("shows nothing for a missing run", () => {
    expect(countyRunShowsCeqaScreen(null)).toBe(false);
  });
});
