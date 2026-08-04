import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A workspace that self-serves its own Census API key under Integration keys
 * must have that key honored by the live geography front door. The seam is
 * AsyncLocalStorage-shaped: censusApiKey() prefers the workspace key ONLY when
 * the lookup runs inside withWorkspaceIntegrationContext. The one route that
 * carried the seam (/api/geographies/counties) was deleted in the 2026-08-03
 * cleanup, so the study-area picker told key-holding workspaces the deployment
 * had no key (2026-08-03 review, gap-sweep finding S3).
 *
 * These tests assert the WRAPPING, not the import: the context mock records
 * whether it is active at the moment searchPlaces executes, so hoisting the
 * search out of the context (the exact regression) fails the test.
 */

const searchPlacesMock = vi.hoisted(() =>
  vi.fn(async () => ({ items: [], unavailableKinds: [], searchUnavailable: false }))
);
const contextState = vi.hoisted(() => ({ active: false, workspaceId: null as string | null }));
const withWorkspaceIntegrationContextMock = vi.hoisted(() =>
  vi.fn(async (workspaceId: string, fn: () => Promise<unknown>) => {
    contextState.active = true;
    contextState.workspaceId = workspaceId;
    try {
      return await fn();
    } finally {
      contextState.active = false;
    }
  })
);
const loadCurrentWorkspaceMembershipMock = vi.hoisted(() =>
  vi.fn(async () => ({ membership: { workspace_id: "ws-1", role: "editor" } }))
);
const getUserMock = vi.hoisted(() => vi.fn(async () => ({ data: { user: { id: "user-1" } } })));

vi.mock("@/lib/geographies/place-resolver", () => ({ searchPlaces: searchPlacesMock }));
vi.mock("@/lib/integrations/workspace-keys", () => ({
  withWorkspaceIntegrationContext: withWorkspaceIntegrationContextMock,
}));
vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: loadCurrentWorkspaceMembershipMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

import { GET } from "@/app/api/geographies/places/route";

function placesRequest(q: string): NextRequest {
  return new NextRequest(`http://localhost/api/geographies/places?q=${encodeURIComponent(q)}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  contextState.active = false;
  contextState.workspaceId = null;
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: "ws-1", role: "editor" },
  });
});

describe("places route honors the workspace's own Census key", () => {
  it("runs searchPlaces INSIDE the workspace integration context", async () => {
    let activeWhenSearched: boolean | null = null;
    let workspaceWhenSearched: string | null = null;
    searchPlacesMock.mockImplementation(async () => {
      activeWhenSearched = contextState.active;
      workspaceWhenSearched = contextState.workspaceId;
      return { items: [], unavailableKinds: [], searchUnavailable: false };
    });

    const res = await GET(placesRequest("Fresno"));
    expect(res.status).toBe(200);
    expect(searchPlacesMock).toHaveBeenCalledTimes(1);
    // The load-bearing assertion: the search executed while the workspace's
    // integration keys were in context — not before, not after.
    expect(activeWhenSearched).toBe(true);
    expect(workspaceWhenSearched).toBe("ws-1");
  });

  it("degrades to the deployment env key when the user has no workspace", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null });
    const res = await GET(placesRequest("Fresno"));
    expect(res.status).toBe(200);
    expect(searchPlacesMock).toHaveBeenCalledTimes(1);
    expect(withWorkspaceIntegrationContextMock).not.toHaveBeenCalled();
  });

  it("a failed membership lookup still searches (best-effort, never a 500)", async () => {
    loadCurrentWorkspaceMembershipMock.mockRejectedValue(new Error("db down"));
    const res = await GET(placesRequest("Fresno"));
    expect(res.status).toBe(200);
    expect(searchPlacesMock).toHaveBeenCalledTimes(1);
    expect(withWorkspaceIntegrationContextMock).not.toHaveBeenCalled();
  });
});
