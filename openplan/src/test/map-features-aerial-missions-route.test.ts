import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const MISSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const aerialMissionsLimitMock = vi.fn();
const aerialMissionsNotMock = vi.fn(() => ({ limit: aerialMissionsLimitMock }));
const aerialMissionsEqMock = vi.fn(() => ({ not: aerialMissionsNotMock }));
const aerialMissionsSelectMock = vi.fn(() => ({ eq: aerialMissionsEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") {
    return { select: aerialMissionsSelectMock };
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

import { GET as getAerialMissionAois } from "@/app/api/map-features/aerial-missions/route";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/aerial-missions", { method: "GET" });
}

const VALID_POLYGON = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-121.04, 39.25],
      [-121.02, 39.25],
      [-121.02, 39.23],
      [-121.04, 39.23],
      [-121.04, 39.25],
    ],
  ],
};

describe("GET /api/map-features/aerial-missions", () => {
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

    const response = await getAerialMissionAois(bareRequest());

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("returns an empty FeatureCollection when the user has no workspace membership", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getAerialMissionAois(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { type: string; features: unknown[] };
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toEqual([]);
    expect(aerialMissionsSelectMock).not.toHaveBeenCalled();
  });

  it("returns valid mission polygons and filters out rows with malformed aoi_geojson", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    aerialMissionsLimitMock.mockResolvedValue({
      data: [
        {
          id: MISSION_A,
          workspace_id: WORKSPACE_ID,
          project_id: "44444444-4444-4444-8444-444444444444",
          title: "Downtown Grass Valley survey",
          status: "complete",
          mission_type: "aoi_capture",
          aoi_geojson: VALID_POLYGON,
        },
        {
          id: MISSION_B,
          workspace_id: WORKSPACE_ID,
          project_id: null,
          title: "Malformed",
          status: "planned",
          mission_type: "general",
          aoi_geojson: { type: "Polygon", coordinates: [[]] },
        },
      ],
      error: null,
    });

    const response = await getAerialMissionAois(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      type: string;
      features: Array<{ id: string; geometry: unknown; properties: Record<string, unknown> }>;
    };
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toHaveLength(1);
    expect(payload.features[0].id).toBe(MISSION_A);
    expect(payload.features[0].geometry).toEqual(VALID_POLYGON);
    expect(payload.features[0].properties).toMatchObject({
      kind: "aerial_mission",
      missionId: MISSION_A,
      title: "Downtown Grass Valley survey",
      status: "complete",
      missionType: "aoi_capture",
    });
    expect(aerialMissionsEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "aerial_mission_aois_loaded",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, count: 1 })
    );
  });

  it("returns 500 when the aerial_missions lookup fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    aerialMissionsLimitMock.mockResolvedValue({
      data: null,
      error: { message: "boom", code: "42P01" },
    });

    const response = await getAerialMissionAois(bareRequest());

    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "aerial_mission_aoi_query_failed",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, message: "boom" })
    );
  });
});
