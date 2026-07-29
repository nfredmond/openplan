import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The area a project studies, as a map layer.
 *
 * Two things this route must not do, both of which are honesty defects rather
 * than rendering defects: draw the stored BBOX in place of a boundary the
 * workspace never chose, and cap the payload without saying it capped it.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "d0000001-0000-4000-8000-000000000001";
const PROJECT_B = "d0000001-0000-4000-8000-000000000002";
const PROJECT_C = "d0000001-0000-4000-8000-000000000003";

const areaLimitMock = vi.fn();
const areaOrderIdMock = vi.fn(() => ({ limit: areaLimitMock }));
const areaOrderSetAtMock = vi.fn(() => ({ order: areaOrderIdMock }));
const areaNotMock = vi.fn(() => ({ order: areaOrderSetAtMock }));
const areaEqMock = vi.fn(() => ({ not: areaNotMock }));
const areaSelectMock = vi.fn(() => ({ eq: areaEqMock }));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "projects") return { select: areaSelectMock };
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

import { GET as getProjectAreas } from "@/app/api/map-features/project-areas/route";
import { PROJECT_AREA_LAYER_LIMIT } from "@/lib/cartographic/layer-disclosure";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/project-areas", { method: "GET" });
}

function asMember() {
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: WORKSPACE_ID, role: "editor" },
    workspace: { id: WORKSPACE_ID, name: "Any agency" },
  });
}

describe("GET /api/map-features/project-areas", () => {
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

    const response = await getProjectAreas(bareRequest());

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("returns an empty FeatureCollection when the user has no workspace membership", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getProjectAreas(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { features: unknown[]; limit: number };
    expect(payload.features).toEqual([]);
    expect(payload.limit).toBe(PROJECT_AREA_LAYER_LIMIT);
    expect(areaSelectMock).not.toHaveBeenCalled();
  });

  it("draws the stored boundary itself, not a rectangle derived from the bbox", async () => {
    asMember();
    const countyBoundary = {
      type: "MultiPolygon",
      coordinates: [[[[-83.2, 39.8], [-82.8, 39.8], [-82.9, 40.2], [-83.2, 39.8]]]],
    };
    areaLimitMock.mockResolvedValue({
      data: [
        {
          id: PROJECT_A,
          name: "US-33 corridor study",
          status: "active",
          place_source: "tigerweb",
          place_kind: "county",
          place_label: "Franklin County, OH",
          place_geometry_geojson: countyBoundary,
        },
      ],
      error: null,
      count: 1,
    });

    const response = await getProjectAreas(bareRequest());

    const payload = (await response.json()) as {
      features: Array<{ id: string; geometry: unknown; properties: Record<string, unknown> }>;
    };
    expect(payload.features).toHaveLength(1);
    expect(payload.features[0].geometry).toEqual(countyBoundary);
    expect(payload.features[0].properties).toEqual({
      kind: "project_area",
      projectId: PROJECT_A,
      projectName: "US-33 corridor study",
      status: "active",
      placeSource: "tigerweb",
      placeKind: "county",
      placeLabel: "Franklin County, OH",
    });
    // Scoped to the workspace and to projects that actually stated an area.
    expect(areaEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(areaNotMock).toHaveBeenCalledWith("place_geometry_geojson", "is", null);
  });

  /**
   * The polygon is the payload's whole cost, so the cap is real and must be
   * disclosed. A truncated layer that reports `truncated: false` would let a
   * planner conclude every project area is on screen.
   */
  it("discloses truncation against the boundary-specific cap", async () => {
    asMember();
    areaLimitMock.mockResolvedValue({
      data: [
        {
          id: PROJECT_A,
          name: "A",
          status: "active",
          place_source: "drawn",
          place_kind: null,
          place_label: null,
          place_geometry_geojson: {
            type: "Polygon",
            coordinates: [[[-83, 39], [-82, 39], [-82, 40], [-83, 39]]],
          },
        },
      ],
      error: null,
      count: 140,
    });

    const response = await getProjectAreas(bareRequest());

    const payload = (await response.json()) as {
      returnedCount: number;
      matchedCount: number;
      truncated: boolean;
      limit: number;
    };
    expect(payload).toMatchObject({
      returnedCount: 1,
      matchedCount: 140,
      truncated: true,
      limit: PROJECT_AREA_LAYER_LIMIT,
    });
    expect(areaLimitMock).toHaveBeenCalledWith(PROJECT_AREA_LAYER_LIMIT);
  });

  it("counts a stored-but-undrawable boundary as dropped rather than skipping it silently", async () => {
    asMember();
    areaLimitMock.mockResolvedValue({
      data: [
        {
          id: PROJECT_B,
          name: "Has an area",
          status: "active",
          place_source: "tigerweb",
          place_kind: "city",
          place_label: "Columbus, OH",
          place_geometry_geojson: {
            type: "Polygon",
            coordinates: [[[-83, 39], [-82, 39], [-82, 40], [-83, 39]]],
          },
        },
        {
          // A point is not an area. Stored, but not something this layer can draw.
          id: PROJECT_C,
          name: "Malformed area",
          status: "active",
          place_source: "drawn",
          place_kind: null,
          place_label: null,
          place_geometry_geojson: { type: "Point", coordinates: [-83, 40] },
        },
      ],
      error: null,
      count: 2,
    });

    const response = await getProjectAreas(bareRequest());

    const payload = (await response.json()) as {
      features: unknown[];
      returnedCount: number;
      droppedCount: number;
      matchedCount: number;
      truncated: boolean;
    };
    expect(payload.features).toHaveLength(1);
    expect(payload.droppedCount).toBe(1);
    // Dropped rows were still fetched, so the layer is complete-but-lossy rather
    // than truncated — the two say different things and must not be conflated.
    expect(payload.truncated).toBe(false);
  });

  it("answers 500 rather than an empty layer when the query fails", async () => {
    asMember();
    areaLimitMock.mockResolvedValue({
      data: null,
      error: { message: 'column "place_geometry_geojson" does not exist', code: "42703" },
      count: null,
    });

    const response = await getProjectAreas(bareRequest());

    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "project_area_query_failed",
      expect.objectContaining({ workspaceId: WORKSPACE_ID })
    );
  });
});
