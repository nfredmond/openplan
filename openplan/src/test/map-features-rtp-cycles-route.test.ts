import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CYCLE_A = "d0000001-0000-4000-8000-000000000004";
const CYCLE_B = "d0000001-0000-4000-8000-000000000005";
const CYCLE_C = "d0000001-0000-4000-8000-000000000006";

const rtpLimitMock = vi.fn();
const rtpNotLngMock = vi.fn(() => ({ limit: rtpLimitMock }));
const rtpNotLatMock = vi.fn(() => ({ not: rtpNotLngMock }));
const rtpEqMock = vi.fn(() => ({ not: rtpNotLatMock }));
const rtpSelectMock = vi.fn(() => ({ eq: rtpEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "rtp_cycles") {
    return { select: rtpSelectMock };
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

import { GET as getRtpCyclePins } from "@/app/api/map-features/rtp-cycles/route";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/rtp-cycles", { method: "GET" });
}

describe("GET /api/map-features/rtp-cycles", () => {
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

    const response = await getRtpCyclePins(bareRequest());

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("returns an empty FeatureCollection when the user has no workspace membership", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getRtpCyclePins(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { type: string; features: unknown[] };
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toEqual([]);
    expect(rtpSelectMock).not.toHaveBeenCalled();
  });

  it("returns Point features for rows with valid anchors and filters out out-of-range values", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    rtpLimitMock.mockResolvedValue({
      data: [
        {
          id: CYCLE_A,
          workspace_id: WORKSPACE_ID,
          title: "NCTC 2045 RTP — demo cycle",
          status: "draft",
          geography_label: "Nevada County, CA (FIPS 06057)",
          horizon_start_year: 2026,
          horizon_end_year: 2045,
          anchor_latitude: 39.2616,
          anchor_longitude: -121.0161,
        },
        {
          // PostgREST can return NUMERIC as strings — the route must coerce them.
          id: CYCLE_B,
          workspace_id: WORKSPACE_ID,
          title: "String-coded coords",
          status: "draft",
          geography_label: null,
          horizon_start_year: null,
          horizon_end_year: null,
          anchor_latitude: "39.5",
          anchor_longitude: "-121.1",
        },
        {
          // Out-of-range: should be dropped defensively.
          id: CYCLE_C,
          workspace_id: WORKSPACE_ID,
          title: "Bad anchor",
          status: "draft",
          geography_label: null,
          horizon_start_year: null,
          horizon_end_year: null,
          anchor_latitude: 99,
          anchor_longitude: -121,
        },
      ],
      error: null,
    });

    const response = await getRtpCyclePins(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      type: string;
      features: Array<{
        id: string;
        geometry: { type: string; coordinates: [number, number] };
        properties: Record<string, unknown>;
      }>;
    };
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toHaveLength(2);
    expect(payload.features[0]).toMatchObject({
      id: CYCLE_A,
      geometry: { type: "Point", coordinates: [-121.0161, 39.2616] },
      properties: {
        kind: "rtp_cycle",
        rtpCycleId: CYCLE_A,
        title: "NCTC 2045 RTP — demo cycle",
        status: "draft",
        geographyLabel: "Nevada County, CA (FIPS 06057)",
        horizonStartYear: 2026,
        horizonEndYear: 2045,
      },
    });
    expect(payload.features[1]).toMatchObject({
      id: CYCLE_B,
      geometry: { type: "Point", coordinates: [-121.1, 39.5] },
      properties: {
        geographyLabel: null,
        horizonStartYear: null,
        horizonEndYear: null,
      },
    });
    expect(rtpEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(rtpNotLatMock).toHaveBeenCalledWith("anchor_latitude", "is", null);
    expect(rtpNotLngMock).toHaveBeenCalledWith("anchor_longitude", "is", null);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "rtp_cycle_pins_loaded",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, count: 2 })
    );
  });

  it("returns 500 when the rtp_cycles lookup fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    rtpLimitMock.mockResolvedValue({
      data: null,
      error: { message: "boom", code: "42P01" },
    });

    const response = await getRtpCyclePins(bareRequest());

    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "rtp_cycle_pins_query_failed",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, message: "boom" })
    );
  });
});
