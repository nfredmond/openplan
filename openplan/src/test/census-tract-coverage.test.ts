import { describe, expect, it } from "vitest";
import {
  coveragePlaceName,
  describeBlockedCoverage,
  describeCountyCoverage,
  describeCoverageLoadFailure,
  describeCoverageLoadOutcome,
  resolveCensusTractCoverageTarget,
  type CensusTractCoverageTarget,
} from "@/lib/geographies/census-tract-coverage";
import { EMPTY_PLACE_OF_RECORD, DRAWN_PLACE_SOURCE, type PlaceOfRecord } from "@/lib/geographies/place-of-record";
import { tigerwebCountyFipsFromProjectPlace } from "@/lib/projects/project-place";

/**
 * The equity layer was the one map layer the README advertises that could not be
 * filled from inside the app: `POST /api/geographies/census-tracts/ingest`
 * worked and had no UI caller anywhere.
 *
 * These pin the two things that make the new control honest — that it never
 * becomes a SECOND opinion about which places are loadable counties, and that
 * every refusal names the real reason rather than presenting an empty layer as
 * "nothing found here".
 */

function place(overrides: Partial<PlaceOfRecord>): PlaceOfRecord {
  return { ...EMPTY_PLACE_OF_RECORD, ...overrides };
}

const FRANKLIN = place({
  source: "tigerweb",
  kind: "county",
  ref: "39049",
  label: "Franklin County, OH",
  countryCode: "US",
});

describe("census tract coverage target", () => {
  it("agrees with the county authority in both directions", () => {
    // The decision "is this a loadable county" belongs to
    // tigerwebCountyFipsFromProjectPlace. This module only EXPLAINS a null. If
    // the two ever disagree, the control would offer to load a county the
    // ingest cannot take, or refuse one it can.
    const cases: PlaceOfRecord[] = [
      FRANKLIN,
      place({ source: "tigerweb", kind: "city", ref: "3918000", countryCode: "US" }),
      place({ source: "tigerweb", kind: "metro", ref: "18140", countryCode: "US" }),
      place({ source: "tigerweb", kind: "cdp", ref: "3918001", countryCode: "US" }),
      place({ source: DRAWN_PLACE_SOURCE, label: "Drawn corridor" }),
      place({ source: "osm", kind: "county", ref: "39049", countryCode: "US" }),
      place({ source: "tigerweb", kind: "county", ref: "39049", countryCode: "CA" }),
      place({ source: "tigerweb", kind: "county", ref: "3904", countryCode: "US" }),
      place({ source: "tigerweb", kind: "county", ref: null, countryCode: "US" }),
      EMPTY_PLACE_OF_RECORD,
    ];

    for (const candidate of cases) {
      const county = tigerwebCountyFipsFromProjectPlace(candidate);
      const target = resolveCensusTractCoverageTarget(candidate);

      expect(target.kind === "county").toBe(county !== null);
      if (county && target.kind === "county") {
        expect(target.stateFips).toBe(county.stateFips);
        expect(target.countyFips).toBe(county.countyFips);
      }
    }
  });

  it("names which guard refused, so the copy can say the real reason", () => {
    const reasonOf = (candidate: PlaceOfRecord | null) => {
      const target = resolveCensusTractCoverageTarget(candidate);
      return target.kind === "blocked" ? target.reason : "county";
    };

    expect(reasonOf(FRANKLIN)).toBe("county");
    expect(reasonOf(null)).toBe("no_place");
    expect(reasonOf(EMPTY_PLACE_OF_RECORD)).toBe("no_place");
    expect(reasonOf(place({ source: DRAWN_PLACE_SOURCE, label: "Drawn corridor" }))).toBe("drawn");
    expect(reasonOf(place({ source: "osm", kind: "county", ref: "39049" }))).toBe("unrecognized_source");
    expect(reasonOf(place({ source: "tigerweb", kind: "county", ref: "39049", countryCode: "CA" }))).toBe("not_us");
    expect(reasonOf(place({ source: "tigerweb", kind: "city", ref: "3918000", countryCode: "US" }))).toBe(
      "kind_unsupported"
    );
    expect(reasonOf(place({ source: "tigerweb", kind: "county", ref: "3904", countryCode: "US" }))).toBe(
      "malformed_ref"
    );
  });
});

describe("census tract coverage copy", () => {
  const blocked = (overrides: Partial<Extract<CensusTractCoverageTarget, { kind: "blocked" }>>) =>
    describeBlockedCoverage(
      { kind: "blocked", reason: "drawn", label: null, placeKind: null, source: null, ...overrides },
      { origin: "project_study_area" }
    );

  it("never lets a refusal read as a finding about the place", () => {
    // An empty layer that says nothing is indistinguishable from a place with
    // no tracts. Every refusal must disclaim that explicitly.
    for (const reason of ["drawn", "kind_unsupported", "unrecognized_source", "malformed_ref"] as const) {
      const notes = blocked({ reason, placeKind: "city", label: "Somewhere" });
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.join(" ")).toMatch(/not a finding/i);
    }

    // "not_us" is a limit of the data source rather than of the request, and
    // says so in those terms.
    expect(blocked({ reason: "not_us" }).join(" ")).toMatch(/limit of the data source/i);
  });

  it("refuses to guess a county for a drawn shape or a multi-county place", () => {
    expect(blocked({ reason: "drawn", label: "Drawn corridor" }).join(" ")).toMatch(
      /will not guess which county contains a drawn shape/i
    );
    expect(blocked({ reason: "kind_unsupported", placeKind: "metro", label: "Columbus" }).join(" ")).toMatch(
      /can sit in more than one/i
    );
  });

  it("uses the stored kind label rather than a raw enum", () => {
    expect(blocked({ reason: "kind_unsupported", placeKind: "cdp" }).join(" ")).toContain(
      "census-designated place"
    );
  });

  it("says nothing about a workspace's unset geography that the panel already says", () => {
    // The panel's own empty state and the first-run checklist both describe it.
    // A third account is a third thing to keep true.
    const target: CensusTractCoverageTarget = {
      kind: "blocked",
      reason: "no_place",
      label: null,
      placeKind: null,
      source: null,
    };
    expect(describeBlockedCoverage(target, { origin: "project_study_area" })[0]).toMatch(/this project/i);
    expect(describeBlockedCoverage(target, { origin: "workspace_home_geography" })[0]).toMatch(
      /this workspace/i
    );
  });

  it("discloses that a project's county does not change this workspace's map", () => {
    // The equity layer is scoped to the WORKSPACE home geography and nothing
    // else, so a project-county load changes shared stored data but not what
    // this map draws. Saying otherwise would be the overclaim.
    const notes = describeCountyCoverage({
      label: "Franklin County, OH",
      storedTractCount: 12,
      affectsWorkspaceLayer: false,
    });
    expect(notes.join(" ")).toMatch(/not this workspace's home geography/i);
    expect(notes.join(" ")).toMatch(/public and shared/i);

    expect(
      describeCountyCoverage({ label: "x", storedTractCount: 12, affectsWorkspaceLayer: true }).join(" ")
    ).not.toMatch(/not this workspace's home geography/i);
  });

  it("distinguishes an unloaded county from a county with no tracts", () => {
    const notes = describeCountyCoverage({
      label: "Franklin County, OH",
      storedTractCount: 0,
      affectsWorkspaceLayer: true,
    });
    expect(notes.join(" ")).toMatch(/not a finding that the county has no census tracts/i);
  });

  it("names the tracts that carry no ACS universe, and what reloading fixes", () => {
    // A tract loaded before migration 20260805000010 has no poverty universe,
    // so the Title VI comparison leaves it out entirely. That refusal is honest
    // but useless unless the one control that can reload the county says so.
    const notes = describeCountyCoverage({
      label: "Franklin County, OH",
      storedTractCount: 328,
      affectsWorkspaceLayer: true,
      staleUniverseTractCount: 41,
    });

    expect(notes.join(" ")).toMatch(/41 of them were loaded before/i);
    expect(notes.join(" ")).toMatch(/Reloading fixes it/i);
    // It must say what is being done INSTEAD, or "no poverty rate" reads as a
    // fact about the county rather than about the stored data.
    expect(notes.join(" ")).toMatch(/left out of the figures rather than counted/i);
  });

  it("says nothing about universes when none are missing, or when the count is unknown", () => {
    for (const staleUniverseTractCount of [0, null, undefined]) {
      expect(
        describeCountyCoverage({
          label: "x",
          storedTractCount: 328,
          affectsWorkspaceLayer: true,
          staleUniverseTractCount,
        }).join(" "),
        // `null` is "we could not count them" — reporting that as "none" would
        // be the same lie in the opposite direction.
        `staleUniverseTractCount=${String(staleUniverseTractCount)}`
      ).not.toMatch(/loaded before OpenPlan recorded/i);
    }
  });

  it("discloses the map draw limit only when it actually bites", () => {
    expect(
      describeCountyCoverage({ label: "x", storedTractCount: 501, affectsWorkspaceLayer: true }).join(" ")
    ).toMatch(/stored but not drawn/i);
    expect(
      describeCountyCoverage({ label: "x", storedTractCount: 12, affectsWorkspaceLayer: true }).join(" ")
    ).not.toMatch(/stored but not drawn/i);
  });

  it("reports a partial load as partial, never as a completed one", () => {
    const partial = describeCoverageLoadOutcome(
      { status: "ingested", tractsUpserted: 40, unmatched: 7, error: null },
      { label: "Franklin County, OH", storedTractCount: 40 }
    ).join(" ");
    expect(partial).toMatch(/7 more had a boundary but no matching ACS demographics/i);
    expect(partial).toMatch(/missing from the equity layer rather than absent from the county/i);

    const failed = describeCoverageLoadOutcome(
      { status: "failed", tractsUpserted: 12, unmatched: 0, error: "rpc timeout" },
      { label: "Franklin County, OH", storedTractCount: 12 }
    ).join(" ");
    expect(failed).toMatch(/partial load, not a complete one/i);
    expect(failed).toContain("rpc timeout");
  });

  it("names both remedies when demographics did not join", () => {
    // The Census key is workspace-configurable AND deployment-configurable, so
    // naming only the env var would send a self-serve user to the wrong place.
    for (const status of ["no_demographics"] as const) {
      const notes = describeCoverageLoadOutcome(
        { status, tractsUpserted: 0, unmatched: 0, error: null },
        { label: "Franklin County, OH", storedTractCount: 0 }
      ).join(" ");
      expect(notes).toMatch(/Integration keys/i);
      expect(notes).toContain("CENSUS_API_KEY");
    }

    const allUnmatched = describeCoverageLoadOutcome(
      { status: "ingested", tractsUpserted: 0, unmatched: 55, error: null },
      { label: "Franklin County, OH", storedTractCount: 0 }
    ).join(" ");
    expect(allUnmatched).toMatch(/the boundaries exist, the demographics did not join/i);
    expect(allUnmatched).toMatch(/Integration keys/i);
  });

  it("treats a source that returned nothing as an answer, not a measurement", () => {
    expect(
      describeCoverageLoadOutcome(
        { status: "no_tracts", tractsUpserted: 0, unmatched: 0, error: null },
        { label: "Franklin County, OH", storedTractCount: 0 }
      ).join(" ")
    ).toMatch(/an answer from the source, not a measurement of the county/i);
  });

  it("says what is stored even when the request itself failed", () => {
    const timedOut = describeCoverageLoadFailure({
      label: "Franklin County, OH",
      message: "The operation was aborted",
      httpStatus: 504,
      storedTractCount: 128,
    }).join(" ");
    expect(timedOut).toMatch(/cut off/i);
    expect(timedOut).toContain("128");
    expect(timedOut).toMatch(/may be a partial load/i);

    expect(
      describeCoverageLoadFailure({
        label: null,
        message: "nope",
        httpStatus: 401,
        storedTractCount: 0,
      }).join(" ")
    ).toMatch(/session expired/i);
  });

  it("substitutes the place name and bakes none in", () => {
    // Place-independence as a property: the same call with two labels must
    // differ ONLY by the substituted label. That proves no place is hardcoded
    // AND that the label is actually used.
    const a = describeCountyCoverage({ label: "Alpha County", storedTractCount: 3, affectsWorkspaceLayer: true });
    const b = describeCountyCoverage({ label: "Beta Parish", storedTractCount: 3, affectsWorkspaceLayer: true });

    expect(a.map((note) => note.replaceAll("Alpha County", "«PLACE»"))).toEqual(
      b.map((note) => note.replaceAll("Beta Parish", "«PLACE»"))
    );

    // And an absent label renders a neutral stand-in, never empty quotes.
    expect(coveragePlaceName(null)).toBe("this area");
    expect(coveragePlaceName("  ")).toBe("this area");
    expect(coveragePlaceName(" Franklin County ")).toBe("Franklin County");
  });
});
