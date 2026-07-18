import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadModelAccessMock = vi.fn();
const authGetUserMock = vi.fn();
const workspaceMaybeSingleMock = vi.fn();
const runMaybeSingleMock = vi.fn();
const runUpdateMock = vi.fn();
const stageSelectEqMock = vi.fn();
const stageUpdateMock = vi.fn();
const artifactDeleteEqMock = vi.fn();
const kpiDeleteEqMock = vi.fn();

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "workspaces") {
    return {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock })) })),
    };
  }
  if (table === "model_runs") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: runMaybeSingleMock })) })),
      })),
      update: (payload: Record<string, unknown>) => ({
        eq: (..._args: unknown[]) => runUpdateMock(payload),
      }),
    };
  }
  if (table === "model_run_stages") {
    return {
      select: vi.fn(() => ({ eq: stageSelectEqMock })),
      update: (payload: Record<string, unknown>) => ({
        eq: (..._args: unknown[]) => stageUpdateMock(payload),
      }),
    };
  }
  if (table === "model_run_artifacts") {
    return { delete: vi.fn(() => ({ eq: artifactDeleteEqMock })) };
  }
  if (table === "model_run_kpis") {
    return { delete: vi.fn(() => ({ eq: kpiDeleteEqMock })) };
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

vi.mock("@/lib/billing/quota", () => ({
  checkMonthlyRunQuota: vi.fn(async () => ({ ok: true })),
  isQuotaLookupError: vi.fn(() => false),
  isQuotaExceeded: vi.fn(() => false),
  QUOTA_WEIGHTS: { MODEL_RUN_LAUNCH: 1 },
}));

vi.mock("@/lib/billing/subscription", () => ({
  isWorkspaceSubscriptionActive: vi.fn(() => true),
  resolveWorkspaceEntitlements: vi.fn(() => ({ plan: "pilot" })),
  subscriptionGateMessage: vi.fn(() => "inactive"),
}));

vi.mock("@/lib/billing/usage-recording", () => ({
  recordUsageEventBestEffort: vi.fn(async () => undefined),
}));

import { POST as relaunchRun } from "@/app/api/models/[modelId]/runs/[modelRunId]/launch/route";

function request() {
  return new NextRequest(
    `http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/launch`,
    { method: "POST" },
  );
}

function routeContext() {
  return { params: Promise.resolve({ modelId: MODEL_ID, modelRunId: MODEL_RUN_ID }) };
}

describe("/api/models/[modelId]/runs/[modelRunId]/launch", () => {
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
    workspaceMaybeSingleMock.mockResolvedValue({
      data: { plan: "pilot", subscription_plan: "pilot", subscription_status: "active" },
      error: null,
    });
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "failed" },
      error: null,
    });
    runUpdateMock.mockResolvedValue({ error: null });
    stageSelectEqMock.mockResolvedValue({ data: [{ id: "stage-1" }], error: null });
    stageUpdateMock.mockResolvedValue({ error: null });
    artifactDeleteEqMock.mockResolvedValue({ error: null });
    kpiDeleteEqMock.mockResolvedValue({ error: null });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
  });

  it("requeues a failed run with a NOT NULL-safe reset payload", async () => {
    const res = await relaunchRun(request(), routeContext());

    expect(res.status).toBe(200);
    expect(runUpdateMock).toHaveBeenCalledTimes(1);
    const payload = runUpdateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("queued");
    // model_runs.result_summary_json is NOT NULL DEFAULT '{}'::jsonb — a null
    // here 500s the relaunch (regression found in the first live worker e2e).
    expect(payload.result_summary_json).toEqual({});
    expect(payload.result_summary_json).not.toBeNull();
    // Existing stages get reset rather than re-inserted.
    expect(stageUpdateMock).toHaveBeenCalledTimes(1);
    expect((stageUpdateMock.mock.calls[0][0] as Record<string, unknown>).status).toBe("queued");
  });

  it("refuses to relaunch a running or succeeded run", async () => {
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "running" },
      error: null,
    });
    const res = await relaunchRun(request(), routeContext());
    expect(res.status).toBe(400);
    expect(runUpdateMock).not.toHaveBeenCalled();
  });

  it("logs and 500s when the requeue update fails", async () => {
    runUpdateMock.mockResolvedValue({ error: { message: "boom", code: "23502" } });
    const res = await relaunchRun(request(), routeContext());
    expect(res.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "model_run_requeue_failed",
      expect.objectContaining({ code: "23502" }),
    );
  });
});
