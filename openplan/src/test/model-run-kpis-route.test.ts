import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadModelAccessMock = vi.fn();
const authGetUserMock = vi.fn();
const runMaybeSingleMock = vi.fn();
const modelRunKpisInsertMock = vi.fn();

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "model_runs") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: runMaybeSingleMock,
          })),
        })),
      })),
    };
  }
  if (table === "model_run_kpis") {
    return {
      insert: modelRunKpisInsertMock,
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

vi.mock("@/lib/models/api", () => ({
  loadModelAccess: (...args: unknown[]) => loadModelAccessMock(...args),
}));

import { POST as postModelRunKpis } from "@/app/api/models/[modelId]/runs/[modelRunId]/kpis/route";

function postRequest(payload: unknown) {
  return new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/kpis`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/models/[modelId]/runs/[modelRunId]/kpis", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
    });
    loadModelAccessMock.mockResolvedValue({
      model: { id: MODEL_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      allowed: true,
      error: null,
    });
    runMaybeSingleMock.mockResolvedValue({
      data: {
        id: MODEL_RUN_ID,
        model_id: MODEL_ID,
        engine_key: "aequilibrae",
        status: "succeeded",
      },
      error: null,
    });
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("rejects behavioral-onramp KPI registration through the model-run write route", async () => {
    const response = await postModelRunKpis(
      postRequest({
        kpi_name: "total_trips",
        kpi_label: "Total trips",
        kpi_category: "behavioral_onramp",
        value: 100,
        unit: "trips",
      }),
      { params: Promise.resolve({ modelId: MODEL_ID, modelRunId: MODEL_RUN_ID }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "behavioral_onramp KPIs must be registered through county-run manifest ingestion.",
    });
    expect(modelRunKpisInsertMock).not.toHaveBeenCalled();
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "behavioral_onramp_model_run_kpi_rejected",
      expect.objectContaining({ modelRunId: MODEL_RUN_ID, attemptedCount: 1 })
    );
  });
});
