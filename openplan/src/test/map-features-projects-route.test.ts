import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// Chain: .select().eq().not().not().limit()
const projectsLimitMock = vi.fn();
const projectsNotLngMock = vi.fn(() => ({ limit: projectsLimitMock }));
const projectsNotLatMock = vi.fn(() => ({ not: projectsNotLngMock }));
const projectsEqMock = vi.fn(() => ({ not: projectsNotLatMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return { select: projectsSelectMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>(
    "@/lib/workspaces/current"
  );
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) =>
      loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getProjectMarkers } from "@/app/api/map-features/projects/route";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/projects", { method: "GET" });
}

describe("GET /api/map-features/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when the request is anonymous", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getProjectMarkers(bareRequest());

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("returns an empty FeatureCollection when the user has no workspace membership", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getProjectMarkers(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { type: string; features: unknown[] };
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toEqual([]);
    expect(projectsSelectMock).not.toHaveBeenCalled();
  });

  it("returns Point features for rows with valid lat/lng and filters out out-of-range values", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsLimitMock.mockResolvedValue({
      data: [
        {
          id: PROJECT_A,
          workspace_id: WORKSPACE_ID,
          name: "NCTC 2045 RTP",
          status: "active",
          delivery_phase: "analysis",
          plan_type: "regional_transportation_plan",
          latitude: 39.239137,
          longitude: -121.033982,
        },
        {
          // PostgREST can return NUMERIC as strings — the route must coerce them.
          id: PROJECT_B,
          workspace_id: WORKSPACE_ID,
          name: "String-coded coords",
          status: "active",
          delivery_phase: "scoping",
          plan_type: null,
          latitude: "39.5",
          longitude: "-121.1",
        },
        {
          // Out-of-range: should be dropped defensively even though the DB
          // check constraint would reject an out-of-range write.
          id: PROJECT_C,
          workspace_id: WORKSPACE_ID,
          name: "Bad coords",
          status: "active",
          delivery_phase: "analysis",
          plan_type: null,
          latitude: 99,
          longitude: -121,
        },
      ],
      error: null,
    });

    const response = await getProjectMarkers(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      type: string;
      features: Array<{ id: string; geometry: { type: string; coordinates: [number, number] }; properties: Record<string, unknown> }>;
    };
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toHaveLength(2);
    expect(payload.features[0]).toMatchObject({
      id: PROJECT_A,
      geometry: { type: "Point", coordinates: [-121.033982, 39.239137] },
      properties: {
        kind: "project",
        projectId: PROJECT_A,
        name: "NCTC 2045 RTP",
        status: "active",
        deliveryPhase: "analysis",
        planType: "regional_transportation_plan",
      },
    });
    expect(payload.features[1]).toMatchObject({
      id: PROJECT_B,
      geometry: { type: "Point", coordinates: [-121.1, 39.5] },
      properties: { planType: null },
    });
    expect(projectsEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(projectsNotLatMock).toHaveBeenCalledWith("latitude", "is", null);
    expect(projectsNotLngMock).toHaveBeenCalledWith("longitude", "is", null);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "project_markers_loaded",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, count: 2 })
    );
  });

  it("returns 500 when the projects lookup fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsLimitMock.mockResolvedValue({
      data: null,
      error: { message: "boom", code: "42P01" },
    });

    const response = await getProjectMarkers(bareRequest());

    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "project_markers_query_failed",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, message: "boom" })
    );
  });
});
