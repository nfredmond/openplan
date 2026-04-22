import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CORRIDOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CORRIDOR_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CORRIDOR_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROJECT_ID = "d0000001-0000-4000-8000-000000000003";

// Chain: .select().eq().limit()
const corridorsLimitMock = vi.fn();
const corridorsEqMock = vi.fn(() => ({ limit: corridorsLimitMock }));
const corridorsSelectMock = vi.fn(() => ({ eq: corridorsEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "project_corridors") {
    return { select: corridorsSelectMock };
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

import { GET as getProjectCorridors } from "@/app/api/map-features/corridors/route";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/corridors", { method: "GET" });
}

describe("GET /api/map-features/corridors", () => {
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

    const response = await getProjectCorridors(bareRequest());

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("returns an empty FeatureCollection when the user has no workspace membership", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getProjectCorridors(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { type: string; features: unknown[] };
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toEqual([]);
    expect(corridorsSelectMock).not.toHaveBeenCalled();
  });

  it("returns LineString features for rows with valid geometry and filters malformed rows", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    corridorsLimitMock.mockResolvedValue({
      data: [
        {
          id: CORRIDOR_A,
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          name: "SR-49 Grass Valley segment",
          corridor_type: "arterial",
          los_grade: "D",
          geometry_geojson: {
            type: "LineString",
            coordinates: [
              [-121.05, 39.22],
              [-121.04, 39.23],
              [-121.03, 39.24],
            ],
          },
        },
        {
          id: CORRIDOR_B,
          workspace_id: WORKSPACE_ID,
          project_id: null,
          name: "Detached corridor (no project)",
          corridor_type: "bike",
          los_grade: null,
          geometry_geojson: {
            type: "LineString",
            coordinates: [
              [-121.0, 39.0],
              [-121.1, 39.1],
            ],
          },
        },
        {
          // Malformed geometry — should be dropped defensively even though
          // isCorridorLineGeoJson also guards writes at the application layer.
          id: CORRIDOR_C,
          workspace_id: WORKSPACE_ID,
          project_id: null,
          name: "Bad geometry",
          corridor_type: "custom",
          los_grade: null,
          geometry_geojson: { type: "Polygon", coordinates: [] },
        },
      ],
      error: null,
    });

    const response = await getProjectCorridors(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      type: string;
      features: Array<{
        id: string;
        geometry: { type: string; coordinates: [number, number][] };
        properties: Record<string, unknown>;
      }>;
    };
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toHaveLength(2);
    expect(payload.features[0]).toMatchObject({
      id: CORRIDOR_A,
      geometry: {
        type: "LineString",
        coordinates: [
          [-121.05, 39.22],
          [-121.04, 39.23],
          [-121.03, 39.24],
        ],
      },
      properties: {
        kind: "corridor",
        corridorId: CORRIDOR_A,
        projectId: PROJECT_ID,
        name: "SR-49 Grass Valley segment",
        corridorType: "arterial",
        losGrade: "D",
      },
    });
    expect(payload.features[1]).toMatchObject({
      id: CORRIDOR_B,
      properties: { projectId: null, losGrade: null, corridorType: "bike" },
    });
    expect(corridorsEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(corridorsLimitMock).toHaveBeenCalledWith(500);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "project_corridors_loaded",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, count: 2 })
    );
  });

  it("returns 500 when the corridors lookup fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    corridorsLimitMock.mockResolvedValue({
      data: null,
      error: { message: "boom", code: "42P01" },
    });

    const response = await getProjectCorridors(bareRequest());

    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "project_corridors_query_failed",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, message: "boom" })
    );
  });
});
