import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const modelMaybeSingleMock = vi.fn();
const modelEqMock = vi.fn(() => ({ maybeSingle: modelMaybeSingleMock }));
const modelSelectMock = vi.fn(() => ({ eq: modelEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "models") {
    return { select: modelSelectMock };
  }
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postModelRun } from "@/app/api/models/[modelId]/runs/route";

describe("/api/models/[modelId]/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "33333333-3333-4333-8333-333333333333" },
      },
    });

    modelMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_ID,
        workspace_id: WORKSPACE_ID,
        scenario_set_id: null,
        title: "County mobility model",
        model_family: "travel_demand",
        config_version: "v1",
        config_json: {
          runTemplate: {
            queryText: "Evaluate county demand shifts",
            corridorGeojson: {
              type: "Polygon",
              coordinates: [
                [
                  [-121.5, 39.1],
                  [-121.4, 39.1],
                  [-121.4, 39.2],
                  [-121.5, 39.1],
                ],
              ],
            },
          },
        },
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

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns an honest prototype message for behavioral demand launch attempts", async () => {
    const response = await postModelRun(
      new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          engineKey: "behavioral_demand",
        }),
      }),
      { params: Promise.resolve({ modelId: MODEL_ID }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("prototype/preflight-backed"),
      runMode: "Behavioral Demand",
      runtimeExpectation: expect.stringContaining("tens of minutes to hours"),
      caveat: expect.stringContaining("prototype/preflight-backed"),
    });
  });
});
