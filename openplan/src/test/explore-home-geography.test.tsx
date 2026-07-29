import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExploreStudyArea } from "@/app/(app)/explore/_components/use-explore-study-area";
import type { CorridorGeometry } from "@/app/(app)/explore/_components/_types";
import { placeOfRecordFromProject } from "@/lib/projects/project-place";
import type { PlaceOfRecord } from "@/lib/geographies/place-of-record";
import type { WorkspaceHomeGeography } from "@/lib/workspaces/home-geography";

/**
 * How a place of record reaches a client page — and, just as importantly, what
 * happens when there isn't one. An unset workspace and an unreachable lookup
 * both preselect nothing, and the two must never be reported as the same thing.
 *
 * The hook now decides between TWO candidates rather than reading one: the area
 * of the project this page was opened for, which the loader above resolves from
 * the row, and the workspace's home geography, which is still fetched from here.
 * Precedence between them is `resolveStudyArea`'s and is asserted below, because
 * an agency whose workspace home is a county and whose projects are corridors
 * used to get the county every time with nothing on screen saying so.
 */

const BOUNDARY = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-83.2, 39.8],
      [-82.8, 39.8],
      [-82.8, 40.1],
      [-83.2, 40.1],
      [-83.2, 39.8],
    ],
  ],
};

/** A second, narrower area — what a corridor project studies inside that county. */
const PROJECT_BOUNDARY = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-83.05, 39.92],
      [-82.95, 39.92],
      [-82.95, 39.98],
      [-83.05, 39.98],
      [-83.05, 39.92],
    ],
  ],
};

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

/** Synthetic: no real GEOID, because no place is known to the code. */
function homeGeography(over: Partial<WorkspaceHomeGeography> = {}): WorkspaceHomeGeography {
  return {
    home_geography_source: "tigerweb",
    home_geography_kind: "county",
    home_geography_ref: "99999",
    home_geography_label: "Example County, ZZ",
    home_country_code: "US",
    home_subdivision_code: "ZZ",
    home_min_lon: -83.2,
    home_min_lat: 39.8,
    home_max_lon: -82.8,
    home_max_lat: 40.1,
    home_geometry_geojson: BOUNDARY,
    home_geography_set_at: "2026-07-27T00:00:00.000Z",
    ...over,
  };
}

/** The project's area of record, narrowed the way the loader narrows it. */
function projectPlace(over: Record<string, unknown> = {}): PlaceOfRecord {
  return placeOfRecordFromProject({
    place_source: "tigerweb",
    place_kind: "city",
    place_ref: "9999999",
    place_label: "Example City, ZZ",
    place_country_code: "US",
    place_subdivision_code: "ZZ",
    place_min_lon: -83.05,
    place_min_lat: 39.92,
    place_max_lon: -82.95,
    place_max_lat: 39.98,
    place_geometry_geojson: PROJECT_BOUNDARY,
    place_set_at: "2026-07-28T00:00:00.000Z",
    ...over,
  });
}

function Harness({
  workspaceId = WORKSPACE_ID,
  initialGeometry = null,
  place = null,
}: {
  workspaceId?: string;
  initialGeometry?: CorridorGeometry | null;
  place?: PlaceOfRecord | null;
}) {
  const [corridorGeojson, setCorridorGeojson] = useState<CorridorGeometry | null>(initialGeometry);
  const { studyArea, loadState } = useExploreStudyArea({
    workspaceId,
    projectPlace: place,
    setCorridorGeojson,
  });

  return (
    <div>
      <span data-testid="load-state">{loadState}</span>
      <span data-testid="prefill-label">{studyArea.label ?? ""}</span>
      <span data-testid="origin">{studyArea.origin}</span>
      <span data-testid="origin-label">{studyArea.originLabel ?? ""}</span>
      <span data-testid="study-area">{corridorGeojson ? JSON.stringify(corridorGeojson) : ""}</span>
    </div>
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondWith(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });
}

describe("useExploreStudyArea", () => {
  it("asks the workspace's own home-geography endpoint", async () => {
    respondWith({ workspaceId: WORKSPACE_ID, homeGeography: null });
    render(<Harness />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/workspaces/home-geography?workspaceId=${WORKSPACE_ID}`
    );
  });

  it("prefills the study area with the stated home boundary", async () => {
    respondWith({ workspaceId: WORKSPACE_ID, homeGeography: homeGeography() });
    render(<Harness />);

    await waitFor(() =>
      expect(screen.getByTestId("study-area")).toHaveTextContent(JSON.stringify(BOUNDARY))
    );
    expect(screen.getByTestId("load-state")).toHaveTextContent("loaded");
    expect(screen.getByTestId("prefill-label")).toHaveTextContent("Example County, ZZ");
    expect(screen.getByTestId("origin")).toHaveTextContent("workspace_home");
  });

  it("preselects nothing when the workspace has not stated a home geography", async () => {
    respondWith({ workspaceId: WORKSPACE_ID, homeGeography: null });
    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId("load-state")).toHaveTextContent("loaded"));
    expect(screen.getByTestId("study-area")).toHaveTextContent("");
    expect(screen.getByTestId("prefill-label")).toHaveTextContent("");
    expect(screen.getByTestId("origin")).toHaveTextContent("none");
    expect(screen.getByTestId("origin-label")).toHaveTextContent("");
  });

  it("preselects nothing when the home geography carries no boundary geometry", async () => {
    // A bbox is not a boundary: analyzing a rectangle drawn around a county and
    // calling it the county is worse than asking the planner to pick.
    respondWith({
      workspaceId: WORKSPACE_ID,
      homeGeography: homeGeography({ home_geometry_geojson: null }),
    });
    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId("load-state")).toHaveTextContent("loaded"));
    expect(screen.getByTestId("study-area")).toHaveTextContent("");
  });

  it("never overwrites a study area that is already set", async () => {
    const chosen: CorridorGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [-97.9, 30.1],
          [-97.5, 30.1],
          [-97.5, 30.4],
          [-97.9, 30.4],
          [-97.9, 30.1],
        ],
      ],
    };
    respondWith({ workspaceId: WORKSPACE_ID, homeGeography: homeGeography() });
    render(<Harness initialGeometry={chosen} place={projectPlace()} />);

    await waitFor(() => expect(screen.getByTestId("load-state")).toHaveTextContent("loaded"));
    expect(screen.getByTestId("study-area")).toHaveTextContent(JSON.stringify(chosen));
  });

  it("reports a failed lookup as unavailable rather than as no geography set", async () => {
    respondWith({ error: "Failed to load home geography" }, false);
    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId("load-state")).toHaveTextContent("unavailable"));
    expect(screen.getByTestId("study-area")).toHaveTextContent("");
    expect(screen.getByTestId("prefill-label")).toHaveTextContent("");
  });

  it("asks nothing until a workspace is known", async () => {
    render(<Harness workspaceId="" />);

    await waitFor(() => expect(screen.getByTestId("load-state")).toHaveTextContent("idle"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("analyzes the project's area, not the county the workspace works out of", async () => {
    // THE DEFECT, stated as a result: this workspace's home is a county and the
    // project it was opened for is a city inside it. Before the precedence was
    // shared, Explore opened on the county and said nothing about it.
    respondWith({ workspaceId: WORKSPACE_ID, homeGeography: homeGeography() });
    render(<Harness place={projectPlace()} />);

    await waitFor(() => expect(screen.getByTestId("load-state")).toHaveTextContent("loaded"));
    expect(screen.getByTestId("study-area")).toHaveTextContent(JSON.stringify(PROJECT_BOUNDARY));
    expect(screen.getByTestId("study-area")).not.toHaveTextContent(JSON.stringify(BOUNDARY));
    expect(screen.getByTestId("origin")).toHaveTextContent("project");
    expect(screen.getByTestId("origin-label")).toHaveTextContent("Example City, ZZ");
  });

  it("opens on the project's area without waiting for the workspace lookup to answer", async () => {
    // The project candidate is in hand from the first render and the workspace
    // home arrives later. That ordering is only safe because the project
    // OUTRANKS the home geography — so the area shown while the fetch is in
    // flight is the same one that survives it.
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<Harness place={projectPlace()} />);

    await waitFor(() =>
      expect(screen.getByTestId("study-area")).toHaveTextContent(JSON.stringify(PROJECT_BOUNDARY))
    );
    expect(screen.getByTestId("load-state")).toHaveTextContent("loading");
  });

  it("keeps the project's area when the home-geography lookup fails", async () => {
    respondWith({ error: "Failed to load home geography" }, false);
    render(<Harness place={projectPlace()} />);

    await waitFor(() => expect(screen.getByTestId("load-state")).toHaveTextContent("unavailable"));
    expect(screen.getByTestId("study-area")).toHaveTextContent(JSON.stringify(PROJECT_BOUNDARY));
    expect(screen.getByTestId("origin")).toHaveTextContent("project");
  });

  it("names an inherited project area that has no place label rather than leaving it anonymous", async () => {
    // A hand-drawn project area carries no identity, so there is no name to
    // show — but showing nothing would hide that it was inherited at all.
    respondWith({ workspaceId: WORKSPACE_ID, homeGeography: null });
    render(
      <Harness
        place={projectPlace({
          place_source: "drawn",
          place_kind: null,
          place_ref: null,
          place_label: null,
        })}
      />
    );

    await waitFor(() => expect(screen.getByTestId("origin")).toHaveTextContent("project"));
    expect(screen.getByTestId("origin-label")).toHaveTextContent("this project's study area");
    expect(screen.getByTestId("prefill-label")).toHaveTextContent("");
  });
});
