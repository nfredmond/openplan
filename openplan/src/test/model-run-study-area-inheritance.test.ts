import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStudyArea } from "@/lib/models/study-area";
import { PROJECT_PLACE_COLUMN_NAMES, placeOfRecordFromProject } from "@/lib/projects/project-place";
import { placeOfRecordFromHomeGeography } from "@/lib/workspaces/home-geography";

/**
 * REACHABILITY GUARD — a model run opens on an area the workspace already
 * stated, and says where it came from.
 *
 * `resolveStudyArea` shipped with a full precedence chain, unit tests, and ZERO
 * product callers: it was correct and unreachable. Meanwhile the model run form
 * mounted its picker empty while Explore, Safety and county runs all opened on
 * something already known — so a planner who had set their workspace county and
 * then set a study area on the project still had to find and re-pick the same
 * boundary to launch a model run.
 *
 * The page is a server component, so this asserts the wiring — which columns it
 * reads, which helper it calls — rather than rendering it. The precedence
 * itself is covered by `study-area-precedence.test.ts`; what is checked here is
 * that the page can actually SUPPLY each candidate.
 */

const pagePath = path.join(process.cwd(), "src/app/(app)/models/[modelId]/page.tsx");
const page = readFileSync(pagePath, "utf8");
const manager = readFileSync(
  path.join(process.cwd(), "src/components/models/model-run-manager.tsx"),
  "utf8"
);

const geometry = {
  type: "Polygon" as const,
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

describe("model run study-area inheritance", () => {
  it("reads every column each candidate needs", () => {
    // The project select is spelled out as a literal rather than interpolating
    // PROJECT_PLACE_COLUMNS, so that the projection guard can read it. That
    // trade only holds if the literal cannot drift from the constant.
    for (const column of PROJECT_PLACE_COLUMN_NAMES) {
      expect(page, `the linked-project select must read ${column}`).toContain(column);
    }

    // Geometry specifically: the bbox alone cannot seed an area, because a
    // rectangle drawn around a county is not that county.
    expect(page).toContain("place_geometry_geojson");

    // The workspace fallback, and the previous run.
    expect(page).toContain("HOME_GEOGRAPHY_COLUMNS");
    expect(page).toContain("corridor_geojson");
  });

  it("resolves the area through the shared chain rather than its own", () => {
    expect(page).toContain("resolveStudyArea");
    expect(page).toContain("placeOfRecordFromProject");
    expect(page).toContain("placeOfRecordFromHomeGeography");
  });

  it("always tells the planner where an inherited area came from", () => {
    // An inherited study area that does not say where it came from is a silent
    // assumption about what is being analysed.
    expect(page).toContain("studyAreaOriginLabel={studyArea.originLabel}");
    expect(manager).toContain("studyAreaOriginLabel");
    expect(manager).toContain("externalLabel=");
  });

  it("lets the model's own configured area outrank everything", () => {
    // A corridor deliberately configured for THIS model must not be replaced by
    // a project-wide area just because a project-wide area exists — otherwise
    // this change would silently alter what existing models run on.
    const resolved = resolveStudyArea({
      existing: geometry,
      project: placeOfRecordFromProject({
        place_source: "tigerweb",
        place_kind: "county",
        place_ref: "39049",
        place_label: "Franklin County",
        place_geometry_geojson: geometry,
      }),
    });

    expect(resolved.origin).toBe("existing");
  });

  it("falls back to the project, then the workspace, then the last run", () => {
    const project = placeOfRecordFromProject({
      place_source: "tigerweb",
      place_kind: "county",
      place_ref: "39049",
      place_label: "Franklin County",
      place_geometry_geojson: geometry,
    });
    const workspaceHome = placeOfRecordFromHomeGeography({
      home_geography_source: "tigerweb",
      home_geography_kind: "county",
      home_geography_ref: "39041",
      home_geography_label: "Delaware County",
      home_geometry_geojson: geometry,
    } as Parameters<typeof placeOfRecordFromHomeGeography>[0]);

    expect(resolveStudyArea({ project, workspaceHome }).origin).toBe("project");
    expect(resolveStudyArea({ workspaceHome }).origin).toBe("workspace_home");
    expect(resolveStudyArea({ previousRun: geometry }).origin).toBe("previous_run");

    // And with nothing to inherit it stays empty — never a continental default,
    // never somebody else's county.
    const empty = resolveStudyArea({});
    expect(empty.origin).toBe("none");
    expect(empty.corridorText).toBe("");
    expect(empty.originLabel).toBeNull();
  });

  it("narrows a workspace home geography the same way a project is narrowed", () => {
    // The two owners must produce the same shape, or `resolveStudyArea` would
    // be comparing different things in the same expression.
    const home = placeOfRecordFromHomeGeography({
      home_geography_source: "tigerweb",
      home_geography_kind: "county",
      home_geography_ref: "39049",
      home_geography_label: "Franklin County",
      home_country_code: "US",
      home_geometry_geojson: geometry,
    } as Parameters<typeof placeOfRecordFromHomeGeography>[0]);

    expect(home).toMatchObject({
      source: "tigerweb",
      kind: "county",
      ref: "39049",
      label: "Franklin County",
      countryCode: "US",
    });
    expect(placeOfRecordFromHomeGeography(null).source).toBeNull();
  });
});
