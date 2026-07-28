import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExploreHomeGeography } from "@/app/(app)/explore/_components/use-explore-home-geography";
import type { CorridorGeometry } from "@/app/(app)/explore/_components/_types";
import type { WorkspaceHomeGeography } from "@/lib/workspaces/home-geography";

/**
 * How the workspace's place of record reaches a client page — and, just as
 * importantly, what happens when there isn't one. An unset workspace and an
 * unreachable lookup both preselect nothing, and the two must never be reported
 * as the same thing.
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

function Harness({
  workspaceId = WORKSPACE_ID,
  initialGeometry = null,
}: {
  workspaceId?: string;
  initialGeometry?: CorridorGeometry | null;
}) {
  const [corridorGeojson, setCorridorGeojson] = useState<CorridorGeometry | null>(initialGeometry);
  const { prefill, loadState } = useExploreHomeGeography({ workspaceId, setCorridorGeojson });

  return (
    <div>
      <span data-testid="load-state">{loadState}</span>
      <span data-testid="prefill-label">{prefill.label ?? ""}</span>
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

describe("useExploreHomeGeography", () => {
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
  });

  it("preselects nothing when the workspace has not stated a home geography", async () => {
    respondWith({ workspaceId: WORKSPACE_ID, homeGeography: null });
    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId("load-state")).toHaveTextContent("loaded"));
    expect(screen.getByTestId("study-area")).toHaveTextContent("");
    expect(screen.getByTestId("prefill-label")).toHaveTextContent("");
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
    render(<Harness initialGeometry={chosen} />);

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
});
