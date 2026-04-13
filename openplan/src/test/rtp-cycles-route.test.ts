import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const SECONDARY_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const RTP_CYCLE_ID = "44444444-4444-4444-8444-444444444444";

const cyclesOrderMock = vi.fn();
const cyclesEqMock = vi.fn(() => ({ order: cyclesOrderMock }));
const cyclesSelectMock = vi.fn(() => ({ order: cyclesOrderMock, eq: cyclesEqMock }));
const cyclesSingleMock = vi.fn();
const cyclesInsertSelectMock = vi.fn(() => ({ single: cyclesSingleMock }));
const cyclesInsertMock = vi.fn(() => ({ select: cyclesInsertSelectMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "rtp_cycles") {
    return {
      select: cyclesSelectMock,
      insert: cyclesInsertMock,
    };
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
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>("@/lib/workspaces/current");
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getRtpCycles, POST as postRtpCycles } from "@/app/api/rtp-cycles/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/rtp-cycles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/rtp-cycles", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
        },
      },
    });

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: {
        workspace_id: SECONDARY_WORKSPACE_ID,
        role: "member",
        workspaces: {
          name: "Secondary workspace",
          plan: "pilot",
          created_at: "2026-04-12T18:00:00.000Z",
        },
      },
      workspace: {
        name: "Secondary workspace",
        plan: "pilot",
        created_at: "2026-04-12T18:00:00.000Z",
      },
    });

    cyclesOrderMock.mockResolvedValue({
      data: [
        {
          id: RTP_CYCLE_ID,
          workspace_id: PRIMARY_WORKSPACE_ID,
          title: "Nevada County RTP 2050",
          status: "draft",
          geography_label: "Nevada County",
          horizon_start_year: 2025,
          horizon_end_year: 2050,
          adoption_target_date: "2026-12-31",
          public_review_open_at: null,
          public_review_close_at: null,
          summary: null,
          created_at: "2026-04-12T18:00:00.000Z",
          updated_at: "2026-04-12T18:00:00.000Z",
        },
      ],
      error: null,
    });

    cyclesSingleMock.mockResolvedValue({
      data: {
        id: RTP_CYCLE_ID,
        workspace_id: SECONDARY_WORKSPACE_ID,
        title: "Nevada County RTP 2050",
        status: "draft",
        geography_label: "Nevada County",
        horizon_start_year: 2025,
        horizon_end_year: 2050,
        adoption_target_date: "2026-12-31",
        public_review_open_at: null,
        public_review_close_at: null,
        summary: null,
        created_at: "2026-04-12T18:00:00.000Z",
        updated_at: "2026-04-12T18:00:00.000Z",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET lists RTP cycles", async () => {
    const response = await getRtpCycles(new NextRequest("http://localhost/api/rtp-cycles"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cycles: [expect.objectContaining({ id: RTP_CYCLE_ID, title: "Nevada County RTP 2050" })],
    });
  });

  it("POST creates an RTP cycle in the helper-selected workspace", async () => {
    const response = await postRtpCycles(
      jsonRequest({
        title: "Nevada County RTP 2050",
        geographyLabel: "Nevada County",
        horizonStartYear: 2025,
        horizonEndYear: 2050,
        adoptionTargetDate: "2026-12-31",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rtpCycleId: RTP_CYCLE_ID,
      cycle: expect.objectContaining({
        workspace_id: SECONDARY_WORKSPACE_ID,
        title: "Nevada County RTP 2050",
      }),
    });
    expect(loadCurrentWorkspaceMembershipMock).toHaveBeenCalledWith(expect.anything(), USER_ID);
    expect(cyclesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: SECONDARY_WORKSPACE_ID,
        title: "Nevada County RTP 2050",
        created_by: USER_ID,
      })
    );
  });

  it("POST returns 403 when the helper-selected membership cannot write plans", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValueOnce({
      membership: {
        workspace_id: SECONDARY_WORKSPACE_ID,
        role: "viewer",
        workspaces: {
          name: "Secondary workspace",
          plan: "pilot",
          created_at: "2026-04-12T18:00:00.000Z",
        },
      },
      workspace: {
        name: "Secondary workspace",
        plan: "pilot",
        created_at: "2026-04-12T18:00:00.000Z",
      },
    });

    const response = await postRtpCycles(
      jsonRequest({
        title: "Nevada County RTP 2050",
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Forbidden" });
  });
});
