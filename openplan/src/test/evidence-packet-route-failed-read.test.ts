import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The evidence-packet route states facts about a run — "No KPIs were extracted
 * for this run", "N stage(s) failed", "No stored evidence artifact was
 * available" — every one derived from the stages/artifacts/KPIs reads. Before
 * this guard, those three query errors were silently discarded (`{ data }`
 * destructuring), so a failed `model_run_kpis` read produced a packet whose
 * caveat confidently asserted the run had no KPIs. A failed read must answer as
 * itself, never as an empty result.
 */

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

import { GET } from "@/app/api/models/[modelId]/runs/[modelRunId]/evidence-packet/route";

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

type TableResult = { data: unknown; error: { message: string; code?: string } | null };

let tableResults: Record<string, TableResult>;

function builder(result: TableResult) {
  const self: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    self[method] = () => self;
  }
  self.maybeSingle = async () => result;
  self.single = async () => result;
  self.then = (resolve: (value: TableResult) => unknown) => resolve(result);
  return self;
}

function supabaseMock() {
  return {
    auth: { getUser: authGetUserMock },
    from: (table: string) => {
      const result = tableResults[table];
      if (!result) throw new Error(`Unexpected table: ${table}`);
      return builder(result);
    },
  };
}

function routeContext() {
  return { params: Promise.resolve({ modelId: MODEL_ID, modelRunId: MODEL_RUN_ID }) };
}

function getRequest() {
  return new NextRequest(
    `http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/evidence-packet`
  );
}

describe("/api/models/[modelId]/runs/[modelRunId]/evidence-packet — failed reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockImplementation(() => supabaseMock());
    tableResults = {
      models: {
        data: {
          id: MODEL_ID,
          workspace_id: WORKSPACE_ID,
          project_id: null,
          scenario_set_id: null,
          title: "Test model",
        },
        error: null,
      },
      workspace_members: {
        data: { workspace_id: WORKSPACE_ID, role: "admin" },
        error: null,
      },
      model_runs: {
        data: {
          id: MODEL_RUN_ID,
          model_id: MODEL_ID,
          engine_key: "aequilibrae",
          status: "succeeded",
          scenario_set_id: null,
          scenario_entry_id: null,
        },
        error: null,
      },
      model_run_stages: { data: [], error: null },
      model_run_artifacts: { data: [], error: null },
      model_run_kpis: { data: [], error: null },
    };
  });

  it("refuses with 500 when the KPI read fails, instead of a packet claiming the run has no KPIs", async () => {
    tableResults.model_run_kpis = {
      data: null,
      error: { message: "permission denied for table model_run_kpis" },
    };

    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toMatch(/KPIs/);
    expect(payload.details).toMatch(/query failed/);
    // The false sentence the discarded error used to produce must not appear.
    expect(JSON.stringify(payload)).not.toMatch(/No KPIs were extracted/);
  });

  it("refuses with 500 when the stages read fails", async () => {
    tableResults.model_run_stages = { data: null, error: { message: "stage read broke" } };
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toMatch(/execution stages/);
  });

  it("refuses with 500 when the artifacts read fails, instead of synthesizing 'no stored evidence artifact'", async () => {
    tableResults.model_run_artifacts = { data: null, error: { message: "artifact read broke" } };
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toMatch(/artifacts/);
    expect(JSON.stringify(payload)).not.toMatch(/No stored evidence artifact was available/);
  });

  it("still answers a packet when all three reads succeed", async () => {
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(200);
    const payload = await response.json();
    // Genuinely-empty KPI rows on a SUCCESSFUL read may honestly say so.
    expect(payload.caveats).toContain("No KPIs were extracted for this run.");
  });
});
