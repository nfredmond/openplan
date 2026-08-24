import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const currentMaybeSingleMock = vi.fn();
const updateMaybeSingleMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/workspaces/membership", () => ({
  checkWorkspaceMembership: async () => ({ ok: true, role: "owner" }),
  looksLikePendingSchema: () => false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: currentMaybeSingleMock }) }),
    }),
  }),
  createServiceRoleClient: () => ({
    from: () => ({
      update: (row: unknown) => {
        updateMock(row);
        return {
          eq: () => ({
            select: () => ({ maybeSingle: updateMaybeSingleMock }),
          }),
        };
      },
    }),
  }),
}));

const { PATCH } = await import("@/app/api/workspaces/stage-gate-template/route");

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/workspaces/stage-gate-template", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/workspaces/stage-gate-template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    currentMaybeSingleMock.mockResolvedValue({
      data: {
        stage_gate_template_id: "us_federal_aid_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
        stage_gate_template_selection: "jurisdiction_matched",
        home_geography_source: "tigerweb",
        home_geography_kind: "county",
        home_geography_ref: "06057",
        home_country_code: "US",
        home_subdivision_code: "CA",
      },
      error: null,
    });
    updateMaybeSingleMock.mockResolvedValue({
      data: {
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
        stage_gate_template_selection: "explicitly_requested",
        home_geography_source: "tigerweb",
        home_geography_kind: "county",
        home_geography_ref: "06057",
        home_country_code: "US",
        home_subdivision_code: "CA",
      },
      error: null,
    });
  });

  it("records the target version and explicit selection with the template id", async () => {
    const response = await PATCH(
      request({
        workspaceId: WORKSPACE_ID,
        templateId: "ca_stage_gates_v0_1",
        expectedCurrentTemplateId: "us_federal_aid_stage_gates_v0_1",
      })
    );

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({
      stage_gate_template_id: "ca_stage_gates_v0_1",
      stage_gate_template_version: "0.1.0",
      stage_gate_template_selection: "explicitly_requested",
      stage_gate_bound_at: expect.any(String),
    });
    const payload = await response.json();
    expect(payload.binding).toMatchObject({
      templateId: "ca_stage_gates_v0_1",
      templateSelection: "explicitly_requested",
    });
  });
});
