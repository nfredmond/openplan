import { describe, expect, it } from "vitest";
import {
  describeCensusTractCoverage,
  MAP_FEATURE_LAYER_LIMIT,
  resolveCensusTractScope,
} from "@/lib/geographies/census-tract-scope";
import { tigerwebCountyFipsFromHomeGeography } from "@/lib/workspaces/home-geography";
import type { WorkspaceHomeGeography } from "@/lib/workspaces/home-geography";

/**
 * `/api/map-features/census-tracts` selected 500 rows from a SHARED, NATIONAL
 * table with no geographic filter at all, while every workspace's home-geography
 * ingest writes into that same table. Past ~500 rows the equity choropleth drew
 * an arbitrary slice — quite possibly none of the viewer's own county — and said
 * nothing about it.
 *
 * These tests pin the two properties that fix requires: tracts are scoped to the
 * workspace's own geography, and every state where they are NOT drawn says so in
 * terms that cannot be read as a finding about the place.
 */

function geography(over: Partial<WorkspaceHomeGeography> = {}): WorkspaceHomeGeography {
  return {
    home_geography_source: "tigerweb",
    home_geography_kind: "county",
    home_geography_ref: "06057",
    home_geography_label: "Nevada County, CA",
    home_country_code: "US",
    home_subdivision_code: "CA",
    home_min_lon: -121.2,
    home_min_lat: 39.1,
    home_max_lon: -120.7,
    home_max_lat: 39.5,
    home_geometry_geojson: null,
    home_geography_set_at: "2026-07-24T00:00:00.000Z",
    ...over,
  };
}

describe("tigerwebCountyFipsFromHomeGeography", () => {
  it("splits a US county GEOID into state and county FIPS", () => {
    expect(tigerwebCountyFipsFromHomeGeography(geography())).toEqual({
      stateFips: "06",
      countyFips: "057",
    });
  });

  it("refuses every non-county kind rather than guessing a state filter", () => {
    for (const kind of ["city", "cdp", "metro", "micro"]) {
      expect(tigerwebCountyFipsFromHomeGeography(geography({ home_geography_kind: kind }))).toBeNull();
    }
  });

  it("refuses another source, another country, and a malformed ref", () => {
    expect(tigerwebCountyFipsFromHomeGeography(geography({ home_geography_source: "osm" }))).toBeNull();
    expect(tigerwebCountyFipsFromHomeGeography(geography({ home_country_code: "CA" }))).toBeNull();
    expect(tigerwebCountyFipsFromHomeGeography(geography({ home_geography_ref: "6057" }))).toBeNull();
    expect(tigerwebCountyFipsFromHomeGeography(geography({ home_geography_ref: null }))).toBeNull();
    expect(tigerwebCountyFipsFromHomeGeography(null)).toBeNull();
  });
});

describe("resolveCensusTractScope", () => {
  it("scopes a county workspace to its own state and county", () => {
    const scope = resolveCensusTractScope(geography(), { hasWorkspace: true });
    expect(scope).toMatchObject({
      scopeState: "home_geography",
      stateFips: "06",
      countyFips: "057",
      scopeLabel: "Nevada County, CA",
    });
  });

  it("reports no workspace, unset geography, and unsupported kind as distinct states", () => {
    expect(resolveCensusTractScope(null, { hasWorkspace: false }).scopeState).toBe("no_workspace");
    expect(resolveCensusTractScope(null, { hasWorkspace: true }).scopeState).toBe("geography_not_set");
    expect(
      resolveCensusTractScope(geography({ home_geography_kind: "metro" }), { hasWorkspace: true }).scopeState
    ).toBe("geography_kind_unsupported");
  });
});

describe("describeCensusTractCoverage", () => {
  const scoped = {
    scopeState: "home_geography" as const,
    scopeLabel: "Nevada County, CA",
    limit: MAP_FEATURE_LAYER_LIMIT,
  };

  it("says a scoped, complete layer is scoped", () => {
    const notes = describeCensusTractCoverage({ ...scoped, matchedCount: 24, returnedCount: 24, droppedCount: 0 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("scoped to Nevada County, CA");
  });

  /**
   * The likely steady state, not an edge case: tract ingest is fire-and-forget
   * and stays empty without a Census API key. Presenting that as a correctly
   * scoped layer is how "my county has no tracts" gets concluded.
   */
  it("explains a scoped county with zero loaded tracts instead of implying it has none", () => {
    const notes = describeCensusTractCoverage({ ...scoped, matchedCount: 0, returnedCount: 0, droppedCount: 0 });
    expect(notes[0]).toContain("none have been loaded for it yet");
    expect(notes[0]).toContain("not a finding that the county has no census tracts");
    expect(notes[0]).toMatch(/Census API key/i);
  });

  it("names the truncation, its ordering, and what it does not mean", () => {
    const notes = describeCensusTractCoverage({
      ...scoped,
      scopeLabel: "Los Angeles County, CA",
      matchedCount: 2498,
      returnedCount: 500,
      droppedCount: 0,
    });
    expect(notes[0]).toContain("Showing 500 of 2,498");
    // A GEOID-ordered cut is a contiguous spatial patch that looks like a real
    // coverage boundary, so it must say which 500.
    expect(notes[0]).toContain("by tract ID, not the tracts nearest you");
    expect(notes[0]).toContain("not a finding that it has no tracts");
  });

  it("reports dropped geometry on a layer that is NOT truncated", () => {
    const notes = describeCensusTractCoverage({ ...scoped, matchedCount: 20, returnedCount: 17, droppedCount: 3 });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("scoped to");
    expect(notes[1]).toContain("3 tracts could not be drawn");
    expect(notes[1]).toContain("missing from the map rather than absent from the county");
  });

  it("refuses to scope a non-county geography and says why, without telling anyone to misstate it", () => {
    const notes = describeCensusTractCoverage({
      scopeState: "geography_kind_unsupported",
      scopeLabel: "Sacramento, CA Metro Area",
      unsupportedKind: "metro",
      matchedCount: 0,
      returnedCount: 0,
      droppedCount: 0,
      limit: MAP_FEATURE_LAYER_LIMIT,
    });
    expect(notes[0]).toContain("loaded county by county");
    expect(notes[0]).toContain("a metro");
    expect(notes[0]).toContain("not a finding that Sacramento, CA Metro Area has no census tracts");
    // Must not instruct an MPO to claim a county it does not represent.
    expect(notes[0]).not.toMatch(/set (?:it|your home geography) to a county/i);
  });

  it("points an unset workspace at the panel that actually exists", () => {
    const notes = describeCensusTractCoverage({
      scopeState: "geography_not_set",
      scopeLabel: null,
      matchedCount: 0,
      returnedCount: 0,
      droppedCount: 0,
      limit: MAP_FEATURE_LAYER_LIMIT,
    });
    expect(notes[0]).toContain("Workspace geography panel on the dashboard");
    // There is no /settings route; a remedy pointing at one is worse than none.
    expect(notes[0]).not.toContain("settings page");
  });

  it("never emits empty quotes when the workspace never labelled its geography", () => {
    for (const scopeState of ["home_geography", "geography_kind_unsupported"] as const) {
      const notes = describeCensusTractCoverage({
        scopeState,
        scopeLabel: null,
        unsupportedKind: "cdp",
        matchedCount: scopeState === "home_geography" ? 12 : 0,
        returnedCount: scopeState === "home_geography" ? 12 : 0,
        droppedCount: 0,
        limit: MAP_FEATURE_LAYER_LIMIT,
      });
      expect(notes.join(" ")).not.toMatch(/\s{2,}/);
      expect(notes.join(" ")).not.toMatch(/to\s+—/);
    }
  });

  it("never presents any unscoped state as a finding about the place", () => {
    for (const scopeState of ["no_workspace", "geography_not_set", "geography_kind_unsupported"] as const) {
      const notes = describeCensusTractCoverage({
        scopeState,
        scopeLabel: "Somewhere, XX",
        unsupportedKind: "city",
        matchedCount: 0,
        returnedCount: 0,
        droppedCount: 0,
        limit: MAP_FEATURE_LAYER_LIMIT,
      });
      const text = notes.join(" ");
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/no (?:disadvantaged|equity|priority) /i);
    }
  });
});
