import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const SCENARIO_SET_ID = "55555555-5555-4555-8555-555555555555";

const modelMaybeSingleMock = vi.fn();
const modelEqMock = vi.fn(() => ({ maybeSingle: modelMaybeSingleMock }));
const modelSelectMock = vi.fn(() => ({ eq: modelEqMock }));
const modelUpdateSingleMock = vi.fn();
const modelUpdateSelectMock = vi.fn(() => ({ single: modelUpdateSingleMock }));
const modelUpdateEqMock = vi.fn(() => ({ select: modelUpdateSelectMock }));
const modelUpdateMock = vi.fn(() => ({ eq: modelUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqIdMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectEqWorkspaceMock = vi.fn(() => ({ eq: projectEqIdMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqWorkspaceMock }));

const scenarioMaybeSingleMock = vi.fn();
const scenarioEqIdMock = vi.fn(() => ({ maybeSingle: scenarioMaybeSingleMock }));
const scenarioEqWorkspaceMock = vi.fn(() => ({ eq: scenarioEqIdMock }));
const scenarioSelectMock = vi.fn(() => ({ eq: scenarioEqWorkspaceMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "models") {
    return {
      select: modelSelectMock,
      update: modelUpdateMock,
    };
  }
  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }
  if (table === "projects") {
    return {
      select: projectSelectMock,
    };
  }
  if (table === "scenario_sets") {
    return {
      select: scenarioSelectMock,
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

import { PATCH as patchModelDetail } from "@/app/api/models/[modelId]/route";

describe("/api/models/[modelId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "22222222-2222-4222-8222-222222222222" },
      },
    });

    modelMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        scenario_set_id: SCENARIO_SET_ID,
        title: "Countywide ABM setup",
        model_family: "activity_based_model",
        status: "draft",
        config_version: "abm-v1.3",
        owner_label: "Model Ops",
        horizon_label: "2045 RTP",
        assumptions_summary: "Assumptions captured",
        input_summary: "Input posture captured",
        output_summary: "Output posture captured",
        summary: "ABM setup",
        config_json: {},
        last_validated_at: null,
        last_run_recorded_at: null,
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: WORKSPACE_ID,
        role: "member",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
      },
      error: null,
    });

    scenarioMaybeSingleMock.mockResolvedValue({
      data: {
        id: SCENARIO_SET_ID,
        workspace_id: WORKSPACE_ID,
      },
      error: null,
    });

    modelUpdateSingleMock.mockResolvedValue({
      data: {
        id: MODEL_ID,
        title: "Countywide ABM setup v2",
        status: "configuring",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("PATCH updates a model record", async () => {
    const response = await patchModelDetail(
      new NextRequest(`http://localhost/api/models/${MODEL_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Countywide ABM setup v2",
          status: "configuring",
        }),
      }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      model: expect.objectContaining({
        id: MODEL_ID,
        title: "Countywide ABM setup v2",
      }),
    });
    expect(modelUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Countywide ABM setup v2",
        status: "configuring",
      })
    );
  });
});
