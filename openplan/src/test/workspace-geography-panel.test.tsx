import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * REACHABILITY GUARD.
 *
 * The home-geography spine — columns, API, map camera, stage-gate jurisdiction,
 * equity tract ingest, Safety prefill — shipped complete except for anything
 * that could WRITE a geography, and no test noticed for a whole wave. These
 * assertions exist so that cannot recur: the panel must reach the API, and the
 * dashboard must render the panel (asserted in dashboard-page.test.tsx).
 */

const placeResolvedHandlers: Array<(place: unknown) => void> = [];

// StudyAreaPicker owns a Mapbox-backed draw mode and a debounced network
// search; stub it down to the one seam this panel uses — `onPlaceResolved`.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({
    onPlaceResolved,
    showRunEngineHint,
  }: {
    onPlaceResolved?: (place: unknown) => void;
    showRunEngineHint?: boolean;
  }) => {
    if (onPlaceResolved) placeResolvedHandlers.push(onPlaceResolved);
    return (
      <div data-testid="study-area-picker" data-run-engine-hint={String(showRunEngineHint)}>
        study area picker
      </div>
    );
  },
}));

import { WorkspaceGeographyPanel } from "@/components/workspaces/workspace-geography-panel";

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";

const FRANKLIN_COUNTY = {
  home_geography_source: "tigerweb",
  home_geography_kind: "county",
  home_geography_ref: "39049",
  home_geography_label: "Franklin County, OH",
  home_country_code: "US",
  home_subdivision_code: "OH",
  home_min_lon: -83.2,
  home_min_lat: 39.8,
  home_max_lon: -82.7,
  home_max_lat: 40.2,
  home_geometry_geojson: null,
  home_geography_set_at: "2026-07-24T00:00:00.000Z",
};

const RESOLVED_PLACE = {
  kind: "county",
  geoid: "39049",
  label: "Franklin County, OH",
  geojson: { type: "Polygon", coordinates: [] },
  bbox: { minLon: -83.2, minLat: 39.8, maxLon: -82.7, maxLat: 40.2 },
};

function mockFetch(responses: Record<string, { ok?: boolean; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    const response = responses[method] ?? { body: {} };
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("WorkspaceGeographyPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    placeResolvedHandlers.length = 0;
  });

  it("reads the current geography from the home-geography API on mount", async () => {
    const calls = mockFetch({ GET: { body: { homeGeography: FRANKLIN_COUNTY } } });

    render(<WorkspaceGeographyPanel workspaceId={WORKSPACE_ID} canManage />);

    await waitFor(() => expect(screen.getAllByText(/Franklin County, OH/).length).toBeGreaterThan(0));
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toContain("/api/workspaces/home-geography");
    expect(calls[0]!.url).toContain(WORKSPACE_ID);
  });

  it("PATCHes the resolved place reference — never a client-supplied extent", async () => {
    const calls = mockFetch({
      GET: { body: { homeGeography: null } },
      PATCH: { body: { homeGeography: FRANKLIN_COUNTY } },
    });

    render(<WorkspaceGeographyPanel workspaceId={WORKSPACE_ID} canManage />);
    await waitFor(() => expect(screen.getByText(/No home geography set/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /set workspace geography/i }));
    // The picker resolved a place.
    act(() => placeResolvedHandlers.forEach((handler) => handler(RESOLVED_PLACE)));

    const save = await screen.findByRole("button", { name: /use franklin county, oh/i });
    fireEvent.click(save);

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    const patch = calls.find((call) => call.method === "PATCH")!;
    expect(patch.url).toBe("/api/workspaces/home-geography");
    expect(patch.body).toEqual({
      workspaceId: WORKSPACE_ID,
      kind: "county",
      geoid: "39049",
      label: "Franklin County, OH",
    });
    // A bbox or geometry in the body would be an unverifiable geography wearing
    // trusted provenance; the server re-resolves from the source of record.
    expect(patch.body).not.toHaveProperty("bbox");
    expect(patch.body).not.toHaveProperty("geojson");
  });

  it("discloses the background tract load for a county, without promising data", async () => {
    mockFetch({
      GET: { body: { homeGeography: null } },
      PATCH: { body: { homeGeography: FRANKLIN_COUNTY } },
    });

    render(<WorkspaceGeographyPanel workspaceId={WORKSPACE_ID} canManage />);
    await waitFor(() => expect(screen.getByText(/No home geography set/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /set workspace geography/i }));
    act(() => placeResolvedHandlers.forEach((handler) => handler(RESOLVED_PLACE)));
    fireEvent.click(await screen.findByRole("button", { name: /use franklin county, oh/i }));

    expect(await screen.findByText(/loading in the background/i)).toBeInTheDocument();
  });

  it("DELETEs to return the workspace to an honest unset state", async () => {
    const calls = mockFetch({
      GET: { body: { homeGeography: FRANKLIN_COUNTY } },
      DELETE: { body: { homeGeography: null } },
    });

    render(<WorkspaceGeographyPanel workspaceId={WORKSPACE_ID} canManage />);
    await waitFor(() => expect(screen.getAllByText(/Franklin County, OH/).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));

    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
    const del = calls.find((call) => call.method === "DELETE")!;
    expect(del.url).toBe("/api/workspaces/home-geography");
    expect(del.body).toEqual({ workspaceId: WORKSPACE_ID });
    expect(await screen.findByText(/No home geography set/)).toBeInTheDocument();
  });

  it("never names a fallback place when unset — it states the consequence instead", async () => {
    mockFetch({ GET: { body: { homeGeography: null } } });

    render(<WorkspaceGeographyPanel workspaceId={WORKSPACE_ID} canManage />);

    await waitFor(() => expect(screen.getByText(/No home geography set/)).toBeInTheDocument());
    expect(screen.getByText(/neutral continental view/i)).toBeInTheDocument();
    // The whole point of the subsystem: an unset workspace is shown no place at
    // all, rather than a plausible-looking wrong one.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/California|Nevada County|Grass Valley|Ohio|Franklin/);
  });

  it("shows a member the state read-only and says who can change it", async () => {
    mockFetch({ GET: { body: { homeGeography: FRANKLIN_COUNTY } } });

    render(<WorkspaceGeographyPanel workspaceId={WORKSPACE_ID} canManage={false} />);

    await waitFor(() => expect(screen.getAllByText(/Franklin County, OH/).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /change geography/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^clear$/i })).not.toBeInTheDocument();
  });

  it("tells an unset member who to ask, rather than hiding the panel", async () => {
    mockFetch({ GET: { body: { homeGeography: null } } });

    render(<WorkspaceGeographyPanel workspaceId={WORKSPACE_ID} canManage={false} />);

    await waitFor(() => expect(screen.getByText(/No home geography set/)).toBeInTheDocument());
    expect(screen.getByText(/ask a workspace owner or admin/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /set workspace geography/i })).not.toBeInTheDocument();
  });

  it("suppresses the model-engine hint — no run follows a configuration choice", async () => {
    mockFetch({ GET: { body: { homeGeography: null } } });

    render(<WorkspaceGeographyPanel workspaceId={WORKSPACE_ID} canManage />);
    await waitFor(() => expect(screen.getByText(/No home geography set/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /set workspace geography/i }));

    expect(screen.getByTestId("study-area-picker")).toHaveAttribute("data-run-engine-hint", "false");
  });

  it("surfaces a server refusal instead of appearing to have saved", async () => {
    mockFetch({
      GET: { body: { homeGeography: null } },
      PATCH: {
        ok: false,
        status: 403,
        body: { error: "Only a workspace owner or admin can set the home geography" },
      },
    });

    render(<WorkspaceGeographyPanel workspaceId={WORKSPACE_ID} canManage />);
    await waitFor(() => expect(screen.getByText(/No home geography set/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /set workspace geography/i }));
    act(() => placeResolvedHandlers.forEach((handler) => handler(RESOLVED_PLACE)));
    fireEvent.click(await screen.findByRole("button", { name: /use franklin county, oh/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/owner or admin/i);
    expect(screen.getByText(/No home geography set/)).toBeInTheDocument();
  });
});
