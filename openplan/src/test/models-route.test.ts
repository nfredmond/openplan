import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const SCENARIO_SET_ID = "55555555-5555-4555-8555-555555555555";
const MODEL_ID = "66666666-6666-4666-8666-666666666666";
const CREATED_MODEL_ID = "77777777-7777-4777-8777-777777777777";

const modelsOrderMock = vi.fn();
const modelsSelectMock = vi.fn(() => ({ order: modelsOrderMock }));
const modelsSingleMock = vi.fn();
const modelsInsertSelectMock = vi.fn(() => ({ single: modelsSingleMock }));
const modelsInsertMock = vi.fn(() => ({ select: modelsInsertSelectMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const scenarioMaybeSingleMock = vi.fn();
const scenarioEqMock = vi.fn(() => ({ maybeSingle: scenarioMaybeSingleMock }));
const scenarioSelectMock = vi.fn(() => ({ eq: scenarioEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipLimitMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipSelectMock = vi.fn(() => ({
  eq: vi.fn((column: string) =>
    column === "workspace_id" ? { eq: membershipEqUserMock } : { limit: membershipLimitMock, maybeSingle: membershipMaybeSingleMock }
  ),
}));

const modelLinksInMock = vi.fn();
const modelLinksSelectMock = vi.fn(() => ({ in: modelLinksInMock }));
const modelLinksInsertMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "models") {
    return {
      select: modelsSelectMock,
      insert: modelsInsertMock,
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
  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }
  if (table === "model_links") {
    return {
      select: modelLinksSelectMock,
      insert: modelLinksInsertMock,
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

import { GET as getModels, POST as postModels } from "@/app/api/models/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "22222222-2222-4222-8222-222222222222" },
      },
    });

    modelsOrderMock.mockResolvedValue({
      data: [
        {
          id: MODEL_ID,
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          scenario_set_id: SCENARIO_SET_ID,
          title: "Countywide ABM setup",
          model_family: "activity_based_model",
          status: "configuring",
          config_version: "abm-v1.3",
          owner_label: "Model Ops",
          horizon_label: "2045 RTP",
          assumptions_summary: "Assumptions captured",
          input_summary: "Input posture captured",
          output_summary: "Output posture captured",
          summary: "ABM setup for countywide alternatives",
          last_validated_at: "2026-03-15T08:00:00.000Z",
          last_run_recorded_at: "2026-03-15T09:00:00.000Z",
          projects: { id: PROJECT_ID, name: "Countywide mobility plan" },
          scenario_sets: { id: SCENARIO_SET_ID, title: "Countywide alternatives" },
        },
      ],
      error: null,
    });

    modelLinksInMock.mockResolvedValue({
      data: [
        { model_id: MODEL_ID, link_type: "data_dataset", linked_id: "88888888-8888-4888-8888-888888888888" },
        { model_id: MODEL_ID, link_type: "run", linked_id: "99999999-9999-4999-8999-999999999999" },
      ],
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
        project_id: PROJECT_ID,
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

    modelsSingleMock.mockResolvedValue({
      data: {
        id: CREATED_MODEL_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        scenario_set_id: SCENARIO_SET_ID,
        title: "Countywide ABM setup",
        model_family: "activity_based_model",
        status: "draft",
      },
      error: null,
    });

    modelLinksInsertMock.mockResolvedValue({ error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns the models catalog with readiness metadata", async () => {
    const response = await getModels(new NextRequest("http://localhost/api/models"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      models: [
        expect.objectContaining({
          id: MODEL_ID,
          readiness: expect.objectContaining({
            status: "ready",
          }),
          linkageCounts: expect.objectContaining({
            datasets: 1,
            runs: 1,
          }),
        }),
      ],
    });
  });

  it("POST returns 400 for invalid payload", async () => {
    const response = await postModels(jsonRequest({ title: "Missing anchors", modelFamily: "travel_demand" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid input" });
  });

  it("POST creates a model record", async () => {
    const response = await postModels(
      jsonRequest({
        title: "Countywide ABM setup",
        projectId: PROJECT_ID,
        scenarioSetId: SCENARIO_SET_ID,
        modelFamily: "activity_based_model",
        configVersion: "abm-v1.3",
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      modelId: CREATED_MODEL_ID,
    });
    expect(modelsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        scenario_set_id: SCENARIO_SET_ID,
        created_by: "22222222-2222-4222-8222-222222222222",
      })
    );
  });
});
