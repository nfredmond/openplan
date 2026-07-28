import { describe, expect, it } from "vitest";
import {
  EMPTY_STUDY_AREA_PREFILL,
  resolveStudyArea,
  studyAreaPrefillFrom,
  studyAreaPrefillFromHomeGeography,
} from "@/lib/models/study-area";
import { TIGERWEB_GEOGRAPHY_SOURCE } from "@/lib/workspaces/home-geography";
import { DRAWN_PLACE_SOURCE, type PlaceOfRecord } from "@/lib/geographies/place-of-record";

type PolygonGeometry = { type: "Polygon"; coordinates: [number, number][][] };

const POLYGON: PolygonGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-83.1, 39.9],
      [-82.8, 39.9],
      [-82.8, 40.1],
      [-83.1, 40.1],
      [-83.1, 39.9],
    ],
  ],
};

const OTHER_POLYGON: PolygonGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-97.0, 30.1],
      [-96.8, 30.1],
      [-96.8, 30.4],
      [-97.0, 30.4],
      [-97.0, 30.1],
    ],
  ],
};

function place(overrides: Partial<PlaceOfRecord> = {}): PlaceOfRecord {
  return {
    source: TIGERWEB_GEOGRAPHY_SOURCE,
    kind: "county",
    ref: "39049",
    label: "Franklin County, Ohio",
    countryCode: "US",
    subdivisionCode: "OH",
    bbox: { minLon: -83.1, minLat: 39.9, maxLon: -82.8, maxLat: 40.1 },
    geometry: POLYGON,
    ...overrides,
  };
}

describe("studyAreaPrefillFrom", () => {
  it("reconstructs a searched place, identity and all", () => {
    const prefill = studyAreaPrefillFrom(place());

    expect(prefill.geometry).toEqual(POLYGON);
    expect(prefill.label).toBe("Franklin County, Ohio");
    expect(prefill.place).toMatchObject({ kind: "county", geoid: "39049" });
  });

  it("refuses to prefill from a bbox with no boundary", () => {
    // A rectangle drawn around a county is not that county. Analysing the wrong
    // shape silently is worse than asking the planner to pick.
    const prefill = studyAreaPrefillFrom(place({ geometry: null }));
    expect(prefill).toEqual(EMPTY_STUDY_AREA_PREFILL);
  });

  it("keeps a drawn area boundary-only, with no borrowed identity", () => {
    const prefill = studyAreaPrefillFrom(
      place({ source: DRAWN_PLACE_SOURCE, kind: null, ref: null, label: "Main St study area" })
    );

    expect(prefill.geometry).toEqual(POLYGON);
    expect(prefill.label).toBe("Main St study area");
    // No GEOID means no county filter, no jurisdiction rule — and saying so is
    // the point. A drawn shape must not masquerade as a resolved place.
    expect(prefill.place).toBeNull();
  });

  it("does not reconstruct identity for an unknown resolver's ref", () => {
    const prefill = studyAreaPrefillFrom(place({ source: "ordnance-survey" }));
    expect(prefill.geometry).toEqual(POLYGON);
    expect(prefill.place).toBeNull();
  });

  it("still serves the workspace adapter unchanged", () => {
    const prefill = studyAreaPrefillFromHomeGeography({
      home_geography_source: TIGERWEB_GEOGRAPHY_SOURCE,
      home_geography_kind: "county",
      home_geography_ref: "39049",
      home_geography_label: "Franklin County, Ohio",
      home_country_code: "US",
      home_subdivision_code: "OH",
      home_min_lon: -83.1,
      home_min_lat: 39.9,
      home_max_lon: -82.8,
      home_max_lat: 40.1,
      home_geometry_geojson: POLYGON,
      home_geography_set_at: "2026-07-28T00:00:00Z",
    } as never);

    expect(prefill.place).toMatchObject({ geoid: "39049" });
  });
});

describe("resolveStudyArea precedence", () => {
  it("lets the record's own area outrank everything", () => {
    const resolved = resolveStudyArea({
      existing: OTHER_POLYGON,
      project: place(),
      workspaceHome: place(),
      previousRun: POLYGON,
    });

    // A corridor deliberately chosen for THIS record must not be replaced by a
    // project-wide area just because one exists.
    expect(resolved.origin).toBe("existing");
    expect(resolved.geometry).toEqual(OTHER_POLYGON);
  });

  it("prefers the project's area over the workspace's", () => {
    const resolved = resolveStudyArea({
      project: place({ label: "Project area" }),
      workspaceHome: place({ label: "Workspace home", geometry: OTHER_POLYGON }),
    });

    expect(resolved.origin).toBe("project");
    expect(resolved.originLabel).toBe("Project area");
  });

  it("falls back to the workspace home when the project has no area", () => {
    const resolved = resolveStudyArea({
      project: place({ geometry: null }),
      workspaceHome: place({ label: "Workspace home" }),
    });

    expect(resolved.origin).toBe("workspace_home");
    expect(resolved.originLabel).toBe("Workspace home");
  });

  it("treats the previous run as the weakest signal", () => {
    const resolved = resolveStudyArea({ previousRun: POLYGON });

    expect(resolved.origin).toBe("previous_run");
    expect(resolved.originLabel).toBe("the area this surface last used");
  });

  it("inherits nothing when there is nothing to inherit", () => {
    const resolved = resolveStudyArea({});

    expect(resolved.origin).toBe("none");
    expect(resolved.originLabel).toBeNull();
    expect(resolved.geometry).toBeNull();
    expect(resolved.corridorText).toBe("");
  });

  it("never invents a place — no branch can return a geometry it was not given", () => {
    // The guard that matters: a continental default or a remembered county
    // slipping in here would silently analyse the wrong area.
    const inputs = [
      {},
      { project: place({ geometry: null }) },
      { workspaceHome: place({ geometry: null }) },
      { project: place({ geometry: null }), workspaceHome: place({ geometry: null }) },
    ];

    for (const input of inputs) {
      const resolved = resolveStudyArea(input);
      expect(resolved.origin).toBe("none");
      expect(resolved.geometry).toBeNull();
      expect(resolved.place).toBeNull();
    }
  });

  it("always explains an inherited area", () => {
    // An inherited study area that does not say where it came from is a silent
    // assumption about what is being analysed.
    const inherited = [
      resolveStudyArea({ existing: POLYGON }),
      resolveStudyArea({ project: place() }),
      resolveStudyArea({ workspaceHome: place() }),
      resolveStudyArea({ previousRun: POLYGON }),
    ];

    for (const resolved of inherited) {
      expect(resolved.origin).not.toBe("none");
      expect(resolved.originLabel).toBeTruthy();
    }
  });

  it("names an unlabelled project area generically rather than leaving it blank", () => {
    const resolved = resolveStudyArea({ project: place({ label: null }) });
    expect(resolved.originLabel).toBe("this project's study area");
  });
});
