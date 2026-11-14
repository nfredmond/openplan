import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The place search front door. Every kind it searches, counties included,
 * reads keyless TIGERweb, so the route passes the query straight to
 * `searchPlaces` and needs neither a workspace lookup nor integration keys.
 *
 * Until 2026-11-02 the county arm read the keyed Census API, and this route
 * wrapped the search in `withWorkspaceIntegrationContext` so a workspace's own
 * Census key applied. These tests pin that the search no longer depends on it:
 * a user with no workspace, or a failed membership lookup, gets the same
 * search as anyone else.
 */

const searchPlacesMock = vi.hoisted(() =>
  vi.fn(async (_q: string, _limit: number) => ({
    items: [{ kind: "county", geoid: "22071", label: "Orleans Parish, LA", description: "County", stateFips: "22" }],
    unavailableKinds: [],
    searchUnavailable: false,
    unavailableReason: null,
  }))
);
const getUserMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ data: { user: { id: string } | null } }> => ({ data: { user: { id: "user-1" } } }))
);

vi.mock("@/lib/geographies/place-resolver", () => ({ searchPlaces: searchPlacesMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

import { GET } from "@/app/api/geographies/places/route";

function placesRequest(q: string, limit?: number): NextRequest {
  const params = new URLSearchParams({ q });
  if (limit !== undefined) params.set("limit", String(limit));
  return new NextRequest(`http://localhost/api/geographies/places?${params.toString()}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("GET /api/geographies/places", () => {
  it("refuses a signed-out caller without searching", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET(placesRequest("Orleans"));
    expect(res.status).toBe(401);
    expect(searchPlacesMock).not.toHaveBeenCalled();
  });

  it("answers a one-character query with an empty, fully shaped result and no search", async () => {
    const res = await GET(placesRequest("O"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [],
      unavailableKinds: [],
      searchUnavailable: false,
      unavailableReason: null,
    });
    expect(searchPlacesMock).not.toHaveBeenCalled();
  });

  it("passes the query and the bounded limit to the search and returns its outcome", async () => {
    const res = await GET(placesRequest("Orleans Parish", 50));
    expect(res.status).toBe(200);
    expect(searchPlacesMock).toHaveBeenCalledWith("Orleans Parish", 20);
    const body = await res.json();
    expect(body.items.map((item: { geoid: string }) => item.geoid)).toEqual(["22071"]);
  });
});
