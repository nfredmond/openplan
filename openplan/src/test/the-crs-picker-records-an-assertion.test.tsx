import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CrsPicker } from "@/components/workspace-gis/crs-picker";
import { crsFor } from "@/components/workspace-gis/crs-client";
import { LayerPlacementPreview } from "@/components/workspace-gis/layer-placement-preview";
import { crsPickerOptionFor } from "@/lib/cartographic/crs-http-types";
import { spatialFileCrsFor } from "@/lib/geo/crs";
import { crsSiblings, findCrsByCode, listCrsForRegion } from "@/lib/geo/crs/registry";
import type { CrsRegistryEntry } from "@/lib/geo/crs/types";
import type { SpatialFileImport } from "@/lib/geo/spatial-file-import";

/**
 * ═══ A COORDINATE SYSTEM A PERSON CHOSE IS A CLAIM, NOT EVIDENCE ═══
 *
 * A shapefile with no `.prj` is the common case in a planning department, and
 * OpenPlan's answer is to ASK rather than guess. That turns the coordinate
 * system into something a named person stated — `planner_asserted` — and this
 * file guards the two things that keeps honest:
 *
 *   1. NOTHING IS PRESELECTED. A picker with a plausible-looking default is a
 *      guess with a person's name attached to it, which is strictly worse than
 *      a guess: it is a guess that has been laundered into a statement.
 *   2. THE PLANNER IS TOLD, IN SO MANY WORDS, that this reading is theirs and
 *      not the file's, before anything is stored. `describeWorkspaceLayerVersion`
 *      then repeats it everywhere the layer appears afterwards.
 *
 * It also pins the ONE piece of deliberate duplication in this lane: the browser
 * cannot import the CRS barrel (it drags a megabyte of registry into the
 * bundle), so `crsFor` re-implements `spatialFileCrsFor`. Two functions that
 * must agree, and nothing but a test can make them.
 */

const ORIGINAL_FETCH = global.fetch;

/** A real registry entry, not a fixture — the projection maths has to be real. */
const CALIFORNIA_ZONE_2_FTUS = findCrsByCode("EPSG:2226") as CrsRegistryEntry;

/** A real workspace window in the California foothills, used as the region. */
const REGION: [number, number, number, number] = [-121.1, 39.1, -120.9, 39.3];

function mockCrsEndpoints() {
  global.fetch = vi.fn((input: unknown) => {
    const url = String(input);

    if (url.startsWith("/api/geo/crs?code=")) {
      const code = decodeURIComponent(url.split("code=")[1]);
      const entry = findCrsByCode(code);
      if (!entry) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ ok: false, reason: "crs_not_in_registry", message: "not carried" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          entry,
          basis: "planner_asserted",
          siblings: crsSiblings(entry).filter((sibling) => sibling.code !== entry.code),
        }),
      });
    }

    if (url.startsWith("/api/geo/crs")) {
      // The REAL region query, so the list under test is the list a planner in
      // this county would actually be shown.
      const options = listCrsForRegion({
        west: REGION[0],
        south: REGION[1],
        east: REGION[2],
        north: REGION[3],
        limit: 200,
      }).map(crsPickerOptionFor);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ options, matchedCount: options.length, unscoped: false }),
      });
    }

    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  }) as unknown as typeof fetch;
}

function importedFixture(basis: SpatialFileImport["srs"]["basis"]): SpatialFileImport {
  return {
    ok: true,
    format: "shapefile_zip",
    srs: {
      authority: "EPSG",
      code: "4326",
      name: "WGS 84",
      basis,
      reprojectedFrom: {
        authority: "EPSG",
        code: "2226",
        name: CALIFORNIA_ZONE_2_FTUS.name,
        unit: CALIFORNIA_ZONE_2_FTUS.unit,
      },
      datumNote: null,
    },
    featureCollection: { type: "FeatureCollection", features: [] },
    geometryKinds: ["Polygon"],
    featureCount: 12,
    sourceFeatureCount: 12,
    droppedFeatureCount: 0,
    truncated: false,
    bbox: [-121.05, 39.15, -120.95, 39.25],
    attributeFields: [{ name: "APN", type: "text" }],
    attributeEncoding: { label: "utf-8", basis: "cpg_file" },
    attributesUnavailableReason: null,
  };
}

describe("the coordinate-system picker records an assertion, and says so", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCrsEndpoints();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("has a real registry entry to test against", () => {
    // A guard on the guard: if the generated registry ever loses this zone,
    // every assertion below would pass vacuously against `undefined`.
    expect(CALIFORNIA_ZONE_2_FTUS).toBeTruthy();
    expect(CALIFORNIA_ZONE_2_FTUS.kind).toBe("projected");
    expect(CALIFORNIA_ZONE_2_FTUS.unit).toBe("US survey foot");
  });

  /**
   * The browser's `crsFor` and the server barrel's `spatialFileCrsFor` bind the
   * same entry to the same importer contract. They are two functions because the
   * barrel re-exports the registry and a client bundle must not carry it — which
   * makes drift between them invisible until a layer lands wrong.
   */
  it("reprojects identically to the server-side binding it duplicates", () => {
    const browser = crsFor(CALIFORNIA_ZONE_2_FTUS);
    const server = spatialFileCrsFor(CALIFORNIA_ZONE_2_FTUS);

    expect(browser.name).toBe(server.name);
    expect(browser.unit).toBe(server.unit);
    expect(browser.kind).toBe(server.kind);
    expect(browser.authority).toBe(server.authority);
    expect(browser.code).toBe(server.code);

    // A real easting/northing in California zone 2 survey feet.
    const [browserLng, browserLat] = browser.toLngLat(6_800_000, 2_100_000);
    const [serverLng, serverLat] = server.toLngLat(6_800_000, 2_100_000);
    expect(browserLng).toBeCloseTo(serverLng, 12);
    expect(browserLat).toBeCloseTo(serverLat, 12);
    // And it is a real place in California, not a formatting coincidence.
    expect(browserLat).toBeGreaterThan(32);
    expect(browserLat).toBeLessThan(43);
    expect(browserLng).toBeGreaterThan(-125);
    expect(browserLng).toBeLessThan(-114);
  });

  it("lists the systems that cover the planner's region and preselects none", async () => {
    render(<CrsPicker region={REGION} onChoose={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(CALIFORNIA_ZONE_2_FTUS.name)).toBeInTheDocument();
    });

    // Every row is a button the planner must press. Nothing is checked, chosen
    // or highlighted on arrival.
    expect(document.querySelector("input[checked]")).toBeNull();
    expect(document.querySelector("[aria-selected='true']")).toBeNull();
    expect(document.querySelector(".op-crs-picker__option[disabled]")).toBeNull();

    // And it says the list is narrowed by AREA OF USE, not by likelihood.
    expect(screen.getByText(/defined to cover your workspace's area/)).toBeInTheDocument();
    expect(screen.getByText(/does not pick one for you/)).toBeInTheDocument();
  });

  /**
   * "Could not read your geography" and "you have not set one" are different
   * facts, and only one of them is about the planner's configuration. Collapsing
   * them sends somebody hunting for a setting that is already set — at the exact
   * moment they are being asked to state where their data belongs.
   */
  it("distinguishes a geography that could not be READ from one never stated", async () => {
    const { unmount } = render(
      <CrsPicker region={null} regionUnreadable onChoose={vi.fn()} onCancel={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText(/could not read this workspace's geography/)).toBeInTheDocument();
    });
    expect(screen.getByText(/not a finding that your workspace has no geography set/)).toBeInTheDocument();
    // The other sentence must NOT also be on screen.
    expect(screen.queryByText(/has not stated a geography/)).toBeNull();
    unmount();

    // And the negative control: with no geography and no failure, it says the
    // other thing, and only the other thing.
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ options: [], matchedCount: 0, unscoped: true }),
      })
    ) as unknown as typeof fetch;
    render(<CrsPicker region={null} onChoose={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/has not stated a geography/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/could not read this workspace's geography/)).toBeNull();
  });

  it("hands back the full entry, with its unit siblings, when a system is chosen", async () => {
    const onChoose = vi.fn();
    render(<CrsPicker region={REGION} onChoose={onChoose} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(CALIFORNIA_ZONE_2_FTUS.name)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(CALIFORNIA_ZONE_2_FTUS.name));

    await waitFor(() => {
      expect(onChoose).toHaveBeenCalled();
    });

    const [entry, siblings] = onChoose.mock.calls[0] as [CrsRegistryEntry, CrsRegistryEntry[]];
    expect(entry.code).toBe("2226");
    // The PARAMETERS have to come back, or the browser cannot reproject at all.
    expect(entry.method).toBe("lambert_conformal_conic_2sp");
    expect(entry.params.a).toBeGreaterThan(6_000_000);
    // The metre twin of the same zone: without it the feet-for-metres check —
    // the commonest legacy mistake there is — cannot run.
    expect(siblings.length).toBeGreaterThan(0);
    expect(siblings.some((sibling) => sibling.unit === "metre")).toBe(true);
    expect(siblings.every((sibling) => sibling.siblingKey === entry.siblingKey)).toBe(true);
  });

  /**
   * The sentence itself. This is what stops a planner reading an asserted
   * coordinate system as something OpenPlan worked out from their file.
   */
  it("tells the planner the reading is theirs, before anything is stored", () => {
    render(
      <LayerPlacementPreview
        imported={importedFixture("planner_asserted")}
        entry={CALIFORNIA_ZONE_2_FTUS}
        basis="planner_asserted"
        warnings={[]}
        bbox={{ west: -121.05, south: 39.15, east: -120.95, north: 39.25 }}
        homeGeography={REGION}
      />
    );

    expect(screen.getByText(/This is your statement, not something read from the file/)).toBeInTheDocument();
    expect(screen.getByText(/nothing in this file says/)).toBeInTheDocument();
  });

  it("does NOT claim an assertion when the file's own .prj said it", () => {
    render(
      <LayerPlacementPreview
        imported={importedFixture("prj_file")}
        entry={CALIFORNIA_ZONE_2_FTUS}
        basis="prj_file"
        warnings={[]}
        bbox={{ west: -121.05, south: 39.15, east: -120.95, north: 39.25 }}
        homeGeography={REGION}
      />
    );

    // The negative control. A preview that showed this sentence for every upload
    // would prove nothing about the assertion path — and would teach planners to
    // ignore it, which is worse than not showing it at all.
    expect(screen.queryByText(/This is your statement/)).toBeNull();
  });

  it("shows where the layer landed, so a wrong-but-plausible reading is visible", () => {
    render(
      <LayerPlacementPreview
        imported={importedFixture("planner_asserted")}
        entry={CALIFORNIA_ZONE_2_FTUS}
        basis="planner_asserted"
        warnings={[]}
        bbox={{ west: -121.05, south: 39.15, east: -120.95, north: 39.25 }}
        homeGeography={REGION}
      />
    );

    // The area-of-use test cannot catch a file that lands in the right state and
    // the wrong county. Only the planner can, and only if shown the coordinates.
    expect(screen.getByText(/39.1500°N/)).toBeInTheDocument();
    expect(screen.getByText(/121.0500°W/)).toBeInTheDocument();
  });
});
