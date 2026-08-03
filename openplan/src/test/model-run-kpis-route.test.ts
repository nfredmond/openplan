import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadModelAccessMock = vi.fn();
const authGetUserMock = vi.fn();
const runMaybeSingleMock = vi.fn();
const modelRunKpisInsertMock = vi.fn();
const modelRunKpisOrderSecondMock = vi.fn();

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
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            order: modelRunKpisOrderSecondMock,
          })),
        })),
      })),
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

import {
  GET as getModelRunKpis,
  POST as postModelRunKpis,
} from "@/app/api/models/[modelId]/runs/[modelRunId]/kpis/route";

function getRequest() {
  return new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/kpis`);
}

function postRequest(payload: unknown) {
  return new NextRequest(`http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/kpis`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/models/[modelId]/runs/[modelRunId]/kpis", () => {
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
    modelRunKpisOrderSecondMock.mockResolvedValue({ data: [], error: null });
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("summarizes category averages using only populated KPI values", async () => {
    modelRunKpisOrderSecondMock.mockResolvedValue({
      data: [
        {
          run_id: MODEL_RUN_ID,
          kpi_category: "accessibility",
          kpi_name: "jobs_30_min",
          value: 10,
        },
        {
          run_id: MODEL_RUN_ID,
          kpi_category: "accessibility",
          kpi_name: "households_30_min",
          value: null,
        },
        {
          run_id: MODEL_RUN_ID,
          kpi_category: "accessibility",
          kpi_name: "jobs_45_min",
          value: 20,
        },
      ],
      error: null,
    });

    const response = await getModelRunKpis(getRequest(), {
      params: Promise.resolve({ modelId: MODEL_ID, modelRunId: MODEL_RUN_ID }),
    });

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected model-run KPI GET response");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      run_id: MODEL_RUN_ID,
      kpi_count: 3,
      categories: {
        accessibility: {
          count: 3,
          value_count: 2,
          avg_value: 15,
        },
      },
    });
  });

  it("refuses to diff KPIs against a baseline run from a different engine", async () => {
    // Current run: AequilibraE worker (network daily_vmt). Baseline: sketch ABM
    // (synthetic-population daily_vmt, documented as running far below
    // reference). Both publish `daily_vmt`, so a name-matched diff would render
    // an estimator artifact as a scenario finding.
    const BASELINE_RUN_ID = "55555555-5555-4555-8555-555555555555";
    runMaybeSingleMock
      .mockResolvedValueOnce({
        data: { id: MODEL_RUN_ID, model_id: MODEL_ID, engine_key: "aequilibrae", status: "succeeded" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: BASELINE_RUN_ID, engine_key: "sketch_abm", status: "succeeded" },
        error: null,
      });
    modelRunKpisOrderSecondMock.mockResolvedValue({
      data: [
        {
          run_id: MODEL_RUN_ID,
          kpi_category: "general",
          kpi_name: "daily_vmt",
          kpi_label: "Daily VMT",
          value: 300000,
          geometry_ref: null,
        },
      ],
      error: null,
    });

    const response = await getModelRunKpis(
      new NextRequest(
        `http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/kpis?baseline_run_id=${BASELINE_RUN_ID}`
      ),
      { params: Promise.resolve({ modelId: MODEL_ID, modelRunId: MODEL_RUN_ID }) }
    );

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected cross-engine KPI comparison response");

    expect(response.status).toBe(200);
    const payload = await response.json();
    // No delta rows at all — an empty comparison plus a stated refusal, never a
    // name-matched diff between two different estimators.
    expect(payload.comparison).toEqual([]);
    expect(payload.cross_engine_comparison).toMatchObject({
      status: "cross_engine_comparison_blocked",
      current_engine_key: "aequilibrae",
      baseline_engine_key: "sketch_abm",
    });
    expect(payload.cross_engine_comparison.message).toMatch(/estimator/i);
    // The baseline run's KPI rows were never even fetched.
    expect(modelRunKpisOrderSecondMock).toHaveBeenCalledTimes(1);
  });

  it("still diffs KPIs when the baseline run uses the same engine", async () => {
    const BASELINE_RUN_ID = "55555555-5555-4555-8555-555555555555";
    runMaybeSingleMock
      .mockResolvedValueOnce({
        data: { id: MODEL_RUN_ID, model_id: MODEL_ID, engine_key: "aequilibrae", status: "succeeded" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: BASELINE_RUN_ID, engine_key: "aequilibrae", status: "succeeded" },
        error: null,
      });
    modelRunKpisOrderSecondMock
      .mockResolvedValueOnce({
        data: [
          {
            run_id: MODEL_RUN_ID,
            kpi_category: "general",
            kpi_name: "daily_vmt",
            kpi_label: "Daily VMT",
            value: 300000,
            geometry_ref: null,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            run_id: BASELINE_RUN_ID,
            kpi_category: "general",
            kpi_name: "daily_vmt",
            kpi_label: "Daily VMT",
            value: 200000,
            geometry_ref: null,
          },
        ],
        error: null,
      });

    const response = await getModelRunKpis(
      new NextRequest(
        `http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/kpis?baseline_run_id=${BASELINE_RUN_ID}`
      ),
      { params: Promise.resolve({ modelId: MODEL_ID, modelRunId: MODEL_RUN_ID }) }
    );

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected same-engine KPI comparison response");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.cross_engine_comparison).toBeUndefined();
    expect(payload.comparison).toHaveLength(1);
    expect(payload.comparison[0]).toMatchObject({
      kpi_name: "daily_vmt",
      baseline_value: 200000,
      absolute_delta: 100000,
      percent_delta: 50,
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

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected model-run KPI POST rejection response");

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
