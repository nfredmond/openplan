import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_PLACE_SCOPE_COLUMNS,
  derivePortalMapCenter,
  loadPortalPlaceCandidates,
  resolvePortalMapFraming,
  type PortalPlaceCandidate,
} from "@/lib/engagement/public-portal-data";
import { resolveMapPointQuestionView } from "@/lib/engagement/survey";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";

/**
 * The public engagement portal is the resident-facing, embeddable surface — an
 * agency puts it on their own website. It previously fell through to a shared
 * map default of [-121.033982, 39.239137], so residents in Columbus or Austin
 * opened their agency's public-input map on rural California.
 *
 * That hardcoded town is gone, and the guard at the bottom keeps it gone. What
 * replaced it was a map framed from the campaign's already-APPROVED pins, which
 * left the case that matters most still broken: a BRAND-NEW campaign has no
 * pins, so the first resident to scan the QR code on the flyer got the whole
 * country. `resolvePortalMapFraming` is the fix — a stated precedence over the
 * three areas the app already knew about, with the pins as the last resort — and
 * these tests pin both the order and the disclosure that goes with it.
 */

const migrationSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260729000003_engagement_campaign_place_of_record.sql"),
  "utf8"
);

/** A candidate the server read successfully, with an extent. */
function area(label: string | null, bbox: [number, number, number, number]): PortalPlaceCandidate {
  return {
    state: "set",
    label,
    bbox: { minLon: bbox[0], minLat: bbox[1], maxLon: bbox[2], maxLat: bbox[3] },
  };
}

/** Read successfully; no area is on record. */
const UNSET: PortalPlaceCandidate = { state: "unset", label: null, bbox: null };
/** Recorded by an operator, but its extent will not load. NOT the same as unset. */
const SET_BUT_NO_EXTENT: PortalPlaceCandidate = { state: "set", label: null, bbox: null };
/**
 * The READ failed. Not the same as either of the two above — nothing is known,
 * including whether an area exists at all.
 */
const READ_FAILED: PortalPlaceCandidate = { state: "unreadable", label: null, bbox: null };

// Columbus OH, Austin TX, and a Bay Area-sized box. Test data, not product data:
// nothing here reaches src/.
const COLUMBUS: [number, number, number, number] = [-83.2, 39.85, -82.8, 40.1];
const AUSTIN: [number, number, number, number] = [-97.9, 30.15, -97.6, 30.4];
const BAY_AREA: [number, number, number, number] = [-122.6, 37.2, -121.7, 38.1];

describe("public engagement portal map centering", () => {
  it("centers on the campaign's own approved submissions", () => {
    const view = derivePortalMapCenter([
      { latitude: 39.96, longitude: -83.0 }, // Columbus, OH
      { latitude: 40.0, longitude: -82.9 },
    ]);
    expect(view).not.toBeNull();
    expect(view!.center[0]).toBeCloseTo(-82.95, 2);
    expect(view!.center[1]).toBeCloseTo(39.98, 2);
  });

  it("has no pin-derived view for a brand-new campaign, and does not stop there", () => {
    // The pins candidate alone is still empty for a campaign nobody has answered
    // yet — that part is unchanged and correct.
    expect(derivePortalMapCenter([])).toBeNull();
    expect(derivePortalMapCenter([{ latitude: null, longitude: null }])).toBeNull();

    // But a brand-new campaign no longer opens on the continent because of it:
    // the areas the app already knows about are tried first.
    const framing = resolvePortalMapFraming({
      projectPlace: area("Franklin County, Ohio", COLUMBUS),
      approvedItems: [],
    });
    expect(framing.view).not.toBeNull();
    expect(framing.view!.center[0]).toBeCloseTo(-83.0, 1);
    expect(framing.origin).toBe("project_place");
  });

  it("ignores unusable coordinates rather than centering on NaN", () => {
    const view = derivePortalMapCenter([
      { latitude: Number.NaN, longitude: -83.0 },
      { latitude: 30.27, longitude: -97.74 }, // Austin, TX
    ]);
    expect(view!.center).toEqual([-97.74, 30.27]);
  });

  it("scales zoom to the spread of input, from citywide to a single intersection", () => {
    const wide = derivePortalMapCenter([
      { latitude: 33.0, longitude: -118.0 },
      { latitude: 38.0, longitude: -122.0 },
    ]);
    const tight = derivePortalMapCenter([
      { latitude: 39.2391, longitude: -121.034 },
      { latitude: 39.2395, longitude: -121.0335 },
    ]);
    expect(wide!.zoom).toBeLessThan(tight!.zoom);
  });

  it("no longer hardcodes a place as the shared map default", () => {
    // Regression guard on the source itself: the default must be the neutral
    // continental view, not a town.
    const source = readFileSync(
      path.join(process.cwd(), "src/components/engagement/geometry-picker-map.tsx"),
      "utf8"
    );
    expect(source).toContain("initialCenter = CONTINENTAL_US_CENTER");
    expect(source).not.toContain("-121.033982");
    expect(CONTINENTAL_US_CENTER).toEqual([-98.5795, 39.8283]);
  });
});

describe("which area frames a campaign's public map", () => {
  it("prefers the campaign's own area over every other candidate", () => {
    const framing = resolvePortalMapFraming({
      campaignPlace: area("Broad Street corridor", COLUMBUS),
      projectPlace: area("Travis County, Texas", AUSTIN),
      workspaceHome: area("Bay Area", BAY_AREA),
      approvedItems: [{ latitude: 30.27, longitude: -97.74 }],
    });

    expect(framing.origin).toBe("campaign_place");
    expect(framing.originLabel).toBe("Broad Street corridor");
    expect(framing.view!.center[0]).toBeCloseTo(-83.0, 1);
    expect(framing.summary).toContain("Broad Street corridor");
  });

  it("falls to the project, then the workspace, then the pins, then nothing", () => {
    const project = resolvePortalMapFraming({
      campaignPlace: UNSET,
      projectPlace: area("Travis County, Texas", AUSTIN),
      workspaceHome: area("Bay Area", BAY_AREA),
    });
    expect(project.origin).toBe("project_place");
    expect(project.view!.center[0]).toBeCloseTo(-97.75, 1);

    const workspace = resolvePortalMapFraming({
      campaignPlace: UNSET,
      projectPlace: UNSET,
      workspaceHome: area("Bay Area", BAY_AREA),
    });
    expect(workspace.origin).toBe("workspace_home");
    expect(workspace.view!.center[0]).toBeCloseTo(-122.15, 1);

    const pins = resolvePortalMapFraming({
      campaignPlace: UNSET,
      projectPlace: UNSET,
      workspaceHome: UNSET,
      approvedItems: [{ latitude: 30.27, longitude: -97.74 }],
    });
    expect(pins.origin).toBe("approved_pins");
    expect(pins.view!.center).toEqual([-97.74, 30.27]);

    const nothing = resolvePortalMapFraming({});
    expect(nothing.origin).toBe("none");
    expect(nothing.view).toBeNull();
  });

  it("says so when nothing frames the map, instead of showing a continent silently", () => {
    const nothing = resolvePortalMapFraming({});
    // Reworded 2026-08-13: this sentence is rendered to the PUBLIC on the
    // context page, so "no study area has been set for this campaign" — two
    // objects that exist in this software and nowhere in a resident's life —
    // became words both audiences can read. What it asserts is unchanged.
    expect(nothing.summary).toMatch(/no area has been set for this page/i);
    expect(nothing.summary).toMatch(/nobody has marked a place on the map yet/i);
    // A neutral camera is the caller's fallback, never a place this function
    // invented.
    expect(nothing.view).toBeNull();
    expect(nothing.originLabel).toBeNull();
  });

  it("treats an area that is SET but unreadable differently from one never set", () => {
    const broken = resolvePortalMapFraming({
      campaignPlace: SET_BUT_NO_EXTENT,
      projectPlace: area("Travis County, Texas", AUSTIN),
    });

    // It still frames the map from the next candidate — a broken record must not
    // take the portal down.
    expect(broken.origin).toBe("project_place");
    // …but it is reported, because only an operator can fix it. An area IS on
    // record here, so the sentence is allowed to call it one.
    expect(broken.unreadable).toEqual([{ origin: "campaign_place", reason: "extent" }]);
    expect(broken.unreadableNote).toBe(
      "The area set for this campaign could not be read as a map extent, so it did not frame this map."
    );

    const neverSet = resolvePortalMapFraming({
      campaignPlace: UNSET,
      projectPlace: area("Travis County, Texas", AUSTIN),
    });
    expect(neverSet.unreadable).toEqual([]);
    expect(neverSet.unreadableNote).toBeNull();
  });

  /**
   * THE FALSE SENTENCE THIS EXISTS TO KILL.
   *
   * A failed read used to arrive as `{ isSet: true, bbox: null }` — "recorded,
   * but carries no usable extent" — so residents were told "the area set for
   * this campaign could not be read as a map extent". For a campaign that never
   * had an area BOTH halves of that are false, and it fired for every campaign
   * in the window between deploying the `place_*` select and applying
   * 20260729000003.
   */
  it("never tells the public an area was set when the lookup is what failed", () => {
    const failed = resolvePortalMapFraming({
      campaignPlace: READ_FAILED,
      projectPlace: area("Travis County, Texas", AUSTIN),
    });

    expect(failed.origin).toBe("project_place");
    expect(failed.unreadable).toEqual([{ origin: "campaign_place", reason: "read" }]);
    expect(failed.unreadableNote).toBe(
      "This campaign could not be checked for a recorded area, so it did not frame this map."
    );
    // The claim that used to be made about this exact case.
    expect(failed.unreadableNote).not.toMatch(/the area set for this campaign/i);
    expect(failed.unreadableNote).not.toMatch(/as a map extent/i);

    // And the two reasons stay apart in one paragraph rather than being merged
    // into whichever sentence happens to be first.
    const both = resolvePortalMapFraming({
      campaignPlace: READ_FAILED,
      projectPlace: SET_BUT_NO_EXTENT,
    });
    expect(both.unreadable).toEqual([
      { origin: "campaign_place", reason: "read" },
      { origin: "project_place", reason: "extent" },
    ]);
    expect(both.unreadableNote).toBe(
      "The linked project's study area could not be read as a map extent, so it did not frame this map. " +
        "This campaign could not be checked for a recorded area, so it did not frame this map."
    );
  });

  it("does not claim no area was set when it could not check for one", () => {
    // Every candidate unreadable and no pins: the map really does open on the
    // continent, but "no area has been set for this page" is a fact nobody
    // established here.
    const blind = resolvePortalMapFraming({
      campaignPlace: READ_FAILED,
      projectPlace: READ_FAILED,
      workspaceHome: READ_FAILED,
    });

    expect(blind.origin).toBe("none");
    expect(blind.view).toBeNull();
    expect(blind.summary).toBe("This map could not be set to one area, so it starts wide.");
    expect(blind.summary).not.toMatch(/no area has been set/i);
    expect(blind.unreadableNote).toBe(
      "This campaign, the linked project and this workspace could not be checked for a recorded area, so none of them framed this map."
    );
    // Plural, not "none of them did not frame" — a double negative in a public
    // sentence is a sentence that says the opposite of what happened.
    expect(blind.unreadableNote).not.toMatch(/none of them did not/i);

    // When everything WAS checked, the stronger sentence is still the one told —
    // this must not degrade into a permanent hedge.
    expect(resolvePortalMapFraming({}).summary).toMatch(/no area has been set for this page/i);
  });

  it("names the area without letting the name stand in for the explanation", () => {
    const named = resolvePortalMapFraming({ projectPlace: area("Travis County, Texas", AUSTIN) });
    expect(named.summary).toBe("This map opens on Travis County, Texas — the linked project's study area.");

    // A drawn area has no name. The sentence must still say WHY, rather than
    // going silent or inventing a label.
    const unnamed = resolvePortalMapFraming({ projectPlace: area(null, AUSTIN) });
    expect(unnamed.summary).toBe("This map opens on the linked project's study area.");
  });
});

/**
 * THE REACHABILITY SEAM.
 *
 * The recurring defect in this repo is a capability that is complete and
 * unreachable, and the cause here would be a column missing from a `.select()`
 * string: Supabase clients are deliberately untyped, so a wrong name is
 * `undefined` at runtime and silent at build. These drive the real reader with a
 * fake client, assert the column names it asks for, and cross-check every one of
 * them against the migration that defines it.
 */
describe("the portal's place reader asks for the columns that exist", () => {
  type SeenSelects = Record<string, string>;

  function fakeClient(rows: Record<string, unknown>, seen: SeenSelects) {
    return {
      from(table: string) {
        return {
          select(columns: string) {
            seen[table] = columns;
            const builder = {
              eq: () => builder,
              maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
            };
            return builder;
          },
        };
      },
    } as unknown as Parameters<typeof loadPortalPlaceCandidates>[0];
  }

  const campaign = { id: "campaign-1", workspace_id: "workspace-1", project_id: "project-1" };

  it("selects the campaign and project place columns the migrations define", async () => {
    const seen: SeenSelects = {};
    await loadPortalPlaceCandidates(fakeClient({}, seen), campaign);

    for (const column of ["place_source", "place_label", "place_min_lon", "place_min_lat", "place_max_lon", "place_max_lat"]) {
      expect(seen.engagement_campaigns, `the campaign read must name ${column}`).toContain(column);
      expect(seen.projects, `the project read must name ${column}`).toContain(column);
      // The name has to be one the database actually has. 20260729000003 defines
      // it on engagement_campaigns; 20260728000009 already did for projects.
      expect(migrationSql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
    }

    // The boundary polygon must NOT be dragged onto a public page.
    expect(seen.engagement_campaigns).not.toContain("place_geometry_geojson");
    expect(seen.projects).not.toContain("place_geometry_geojson");
    expect(CAMPAIGN_PLACE_SCOPE_COLUMNS).not.toContain("place_geometry_geojson");
  });

  it("selects the workspace home bbox, which the identity-only column set omits", async () => {
    const seen: SeenSelects = {};
    await loadPortalPlaceCandidates(fakeClient({}, seen), campaign);

    for (const column of ["home_min_lon", "home_min_lat", "home_max_lon", "home_max_lat", "home_geography_source", "home_geography_label"]) {
      expect(seen.workspaces, `the workspace read must name ${column}`).toContain(column);
    }
    expect(seen.workspaces).not.toContain("home_geometry_geojson");
  });

  it("turns the rows it read into a framed camera, not into undefined", async () => {
    const seen: SeenSelects = {};
    const candidates = await loadPortalPlaceCandidates(
      fakeClient(
        {
          engagement_campaigns: {
            place_source: "tigerweb",
            place_label: "Broad Street corridor",
            place_min_lon: COLUMBUS[0],
            place_min_lat: COLUMBUS[1],
            place_max_lon: COLUMBUS[2],
            place_max_lat: COLUMBUS[3],
          },
          workspaces: {
            home_geography_source: "tigerweb",
            home_geography_label: "Bay Area",
            home_min_lon: BAY_AREA[0],
            home_min_lat: BAY_AREA[1],
            home_max_lon: BAY_AREA[2],
            home_max_lat: BAY_AREA[3],
          },
        },
        seen
      ),
      campaign
    );

    expect(candidates.campaign).toEqual({
      state: "set",
      label: "Broad Street corridor",
      bbox: { minLon: COLUMBUS[0], minLat: COLUMBUS[1], maxLon: COLUMBUS[2], maxLat: COLUMBUS[3] },
    });
    expect(candidates.workspaceHome.label).toBe("Bay Area");
    // No project row came back, and that is an honest "not set" rather than a
    // failure — the read succeeded and found nothing.
    expect(candidates.project).toEqual({ state: "unset", label: null, bbox: null });

    const framing = resolvePortalMapFraming({
      campaignPlace: candidates.campaign,
      projectPlace: candidates.project,
      workspaceHome: candidates.workspaceHome,
    });
    expect(framing.origin).toBe("campaign_place");
    expect(framing.view!.center[0]).toBeCloseTo(-83.0, 1);
  });

  /**
   * `map_point` survey questions have carried a per-question `center`/`zoom`
   * since the survey builder shipped, with no operator control to set either —
   * so in practice every one of them opened on the continental default. The
   * campaign's framing is what fills them in, and this is the seam where that
   * either happens or the capability stays one level down and unreachable.
   */
  it("hands the campaign's framing to map_point questions that state no camera", () => {
    const framing = resolvePortalMapFraming({ projectPlace: area("Travis County, Texas", AUSTIN) });

    // Filled in when the question says nothing — and it says WHICH area, with
    // the same sentence the portal's own map uses.
    const inherited = resolveMapPointQuestionView({ geometry_types: ["Point"] }, framing);
    expect(inherited.config).toEqual({
      geometry_types: ["Point"],
      center: framing.view!.center,
      zoom: framing.view!.zoom,
    });
    expect(inherited.framingNote).toBe(framing.summary);

    // The question always wins — an operator who framed one question meant it,
    // and nothing was inherited, so there is no inherited assumption to disclose.
    const ownCamera = { geometry_types: ["Point"], center: [-97.74, 30.27], zoom: 14 };
    expect(resolveMapPointQuestionView(ownCamera, framing).config).toBe(ownCamera);
    expect(resolveMapPointQuestionView(ownCamera, framing).framingNote).toBeNull();

    // Nothing to inherit changes nothing, rather than inventing a place.
    const plain = { geometry_types: ["Point"] };
    const unframed = resolveMapPointQuestionView(plain, resolvePortalMapFraming({}));
    expect(unframed.config).toBe(plain);
    // "starts wide" since 2026-08-13, not "the whole country": the same claim in
    // words a resident reads, and one that stays true outside the US.
    expect(unframed.framingNote).toMatch(/starts wide/i);

    // And the wiring: the portal bundle must actually apply it. A helper nobody
    // calls is how the per-question camera became unreachable in the first place.
    const source = readFileSync(path.join(process.cwd(), "src/lib/engagement/public-portal-data.ts"), "utf8");
    expect(source).toMatch(
      /question_type === "map_point"[\s\S]{0,120}resolveMapPointQuestionView\(question\.config_json, mapFraming\)/
    );
    // …and carry the sentence out on the question, which is the only thing that
    // reaches the widget.
    expect(source).toContain("mapFramingNote: mapPoint ? mapPoint.framingNote : null");
  });

  /**
   * THE SILENT CONTINENT, ONE TAB OVER.
   *
   * The portal's own map learned to say when it was showing the whole country.
   * The `map_point` survey question inherited the campaign's camera but not its
   * disclosure, so the survey tab kept opening on the continental United States
   * with nothing said — the same defect, one surface away.
   */
  it("never leaves a map_point question on the whole country without saying so", () => {
    const nothingToInherit = resolvePortalMapFraming({});

    // No camera anywhere: the config is untouched (no invented place) and the
    // participant is told what they are looking at.
    const unframed = resolveMapPointQuestionView({ geometry_types: ["Point"] }, nothingToInherit);
    expect(unframed.config).toEqual({ geometry_types: ["Point"] });
    expect(unframed.framingNote).toBe(nothingToInherit.summary);
    expect(unframed.framingNote).toMatch(/starts wide/i);

    // A HALF-stated camera keeps its own zoom — a centre from the campaign
    // paired with a zoom from the question is a view nobody chose — but that
    // still leaves the map centred on the continental default, so it is
    // disclosed too.
    //
    // AND THE SENTENCE MUST NOT SAY "the whole country". `GeometryPickerMap`
    // defaults only the CENTRE it was not given; the question's zoom of 14
    // survives, so this map opens tightly on the middle of the United States,
    // which is neither the country nor the campaign's area. Claiming the scale
    // would be the same class of false statement as the one this file exists to
    // keep out.
    const framing = resolvePortalMapFraming({ projectPlace: area("Travis County, Texas", AUSTIN) });
    const halfStated = { geometry_types: ["Point"], zoom: 14 };
    const half = resolveMapPointQuestionView(halfStated, framing);
    expect(half.config).toBe(halfStated);
    expect(half.framingNote).toBe(
      "This question sets a zoom level but no location, so this map does not open on the campaign's area."
    );
    expect(half.framingNote).not.toMatch(/whole country/i);
    expect(half.framingNote).not.toContain("Travis County");

    // A config that is not an object at all cannot be merged and cannot carry a
    // camera; the widget falls back to its defaults, so the note names that
    // rather than the campaign's area.
    const corrupt = resolveMapPointQuestionView("not-a-config", framing);
    expect(corrupt.config).toBe("not-a-config");
    expect(corrupt.framingNote).toBe(
      "This question's map settings could not be read, so this map opens on the whole country."
    );
    expect(corrupt.framingNote).not.toContain("Travis County");

    // A null config is an ordinary question that configured nothing, not a
    // corrupt one: it inherits.
    const fromNull = resolveMapPointQuestionView(null, framing);
    expect(fromNull.config).toEqual({ center: framing.view!.center, zoom: framing.view!.zoom });
    expect(fromNull.framingNote).toBe(framing.summary);
  });

  it("reports a read that FAILED as unreadable, never as an area nobody set", async () => {
    const failing = {
      from() {
        return {
          select() {
            const builder = {
              eq: () => builder,
              maybeSingle: async () => ({ data: null, error: { message: "permission denied" } }),
            };
            return builder;
          },
        };
      },
    } as unknown as Parameters<typeof loadPortalPlaceCandidates>[0];

    const candidates = await loadPortalPlaceCandidates(failing, campaign);
    // `unreadable`, not `set` and not `unset` — the query told us nothing, and
    // both of the other two states would be a claim about the world.
    expect(candidates.campaign).toEqual({ state: "unreadable", label: null, bbox: null });
    expect(candidates.project).toEqual({ state: "unreadable", label: null, bbox: null });
    expect(candidates.workspaceHome).toEqual({ state: "unreadable", label: null, bbox: null });

    const framing = resolvePortalMapFraming({
      campaignPlace: candidates.campaign,
      projectPlace: candidates.project,
      workspaceHome: candidates.workspaceHome,
    });
    expect(framing.origin).toBe("none");
    expect(framing.unreadable).toEqual([
      { origin: "campaign_place", reason: "read" },
      { origin: "project_place", reason: "read" },
      { origin: "workspace_home", reason: "read" },
    ]);
    // This is the deploy-window shape: what residents see must not assert that
    // an area exists, nor that none does.
    expect(framing.summary).not.toMatch(/no area has been set/i);
    expect(framing.unreadableNote).not.toMatch(/the area set for this campaign/i);
    expect(framing.unreadableNote).toMatch(/could not be checked for a recorded area/i);
  });
});
