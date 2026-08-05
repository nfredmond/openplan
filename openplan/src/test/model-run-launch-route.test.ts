import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE READ THAT DECIDES WHETHER TO CREATE OR RESET THIS RUN'S STAGES.
 *
 * A relaunch either resets the stage rows a run already has or writes a fresh
 * set. `model_run_stages` has no unique key on (run_id, stage_name), so if the
 * read that answers "does this run have stages?" fails and is treated as "no",
 * the route lays a second full set of queued stages over the first — permanently,
 * and with the originals still carrying the previous attempt's statuses.
 *
 * A MOCKED SUPABASE CLIENT HANDS BACK ITS FIXTURE WHATEVER WAS ASKED FOR, which
 * is exactly why this class of defect ships unnoticed. So this harness fails ONE
 * NAMED READ — the `model_run_stages` SELECT — and leaves every other read in the
 * launch working, then asserts both halves: the honest refusal is returned, and
 * the duplicate INSERT never happens.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadModelAccessMock = vi.fn();

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/models/api", () => ({
  loadModelAccess: (...args: unknown[]) => loadModelAccessMock(...args),
}));

import { POST as launchModelRun } from "@/app/api/models/[modelId]/runs/[modelRunId]/launch/route";

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

/** Every call the route made, so a test can assert an insert did NOT happen. */
const dbCalls: Array<{ table: string; method: string }> = [];

const CHAIN_METHODS = ["select", "eq", "in", "order", "limit", "gte", "insert", "update", "delete"];

/**
 * One query chain. `resolve` sees the methods called on THIS chain, which is how
 * a single table serves several different statements — `model_runs` is both the
 * run lookup and the requeue update.
 */
function makeChain(table: string, resolve: (ops: string[]) => QueryResult) {
  const ops: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of CHAIN_METHODS) {
    chain[method] = vi.fn(() => {
      ops.push(method);
      dbCalls.push({ table, method });
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => resolve(ops));
  chain.single = vi.fn(async () => resolve(ops));
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(resolve(ops)).then(onFulfilled, onRejected);
  return chain;
}

const okEmpty: QueryResult = { data: null, error: null };

/** The `model_run_stages` SELECT result — the one read each test varies. */
let stagesRead: QueryResult;

function installClient() {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      if (table === "model_runs") {
        return makeChain(table, (ops) =>
          ops.includes("update")
            ? { data: { id: MODEL_RUN_ID }, error: null }
            : {
                data: {
                  id: MODEL_RUN_ID,
                  status: "failed",
                  engine_key: "aequilibrae",
                  // Null corridor: the demographic rebuild has nothing to resolve
                  // and is skipped, keeping this test on the stage lane.
                  corridor_geojson: null,
                  input_snapshot_json: {},
                },
                error: null,
              }
        );
      }
      if (table === "model_run_stages") {
        return makeChain(table, (ops) => {
          if (ops.includes("insert") || ops.includes("update")) return okEmpty;
          return stagesRead;
        });
      }
      if (
        table === "model_run_artifacts" ||
        table === "model_run_kpis" ||
        table === "modeling_claim_decisions" ||
        table === "modeling_validation_results"
      ) {
        return makeChain(table, () => okEmpty);
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  });
}

function launchRequest() {
  return new NextRequest(
    `http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/launch`,
    { method: "POST" }
  );
}

const routeContext = {
  params: Promise.resolve({ modelId: MODEL_ID, modelRunId: MODEL_RUN_ID }),
};

function stageInsertHappened(): boolean {
  return dbCalls.some((call) => call.table === "model_run_stages" && call.method === "insert");
}

function stageResetHappened(): boolean {
  return dbCalls.some((call) => call.table === "model_run_stages" && call.method === "update");
}

describe("POST /api/models/[modelId]/runs/[modelRunId]/launch — the stage read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbCalls.length = 0;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadModelAccessMock.mockResolvedValue({
      model: { id: MODEL_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "admin" },
      allowed: true,
      error: null,
    });
    stagesRead = { data: [], error: null };
    installClient();
  });

  it("refuses the relaunch when it cannot read the run's stages, and writes no duplicate set", async () => {
    stagesRead = {
      data: null,
      error: { message: "permission denied for table model_run_stages", code: "42501" },
    };

    const response = await launchModelRun(launchRequest(), routeContext);
    const body = await response.json();

    // Asserted FIRST because it is the harm: a failed read used to read as
    // "this run has no stages", so the route wrote a whole second set of them.
    expect(stageInsertHappened()).toBe(false);
    expect(stageResetHappened()).toBe(false);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load model run stages");
    expect(body.hint).toContain("read failure, not an empty result");

    expect(mockAudit.error).toHaveBeenCalledWith(
      "model_run_stage_lookup_failed",
      expect.objectContaining({
        modelRunId: MODEL_RUN_ID,
        message: "permission denied for table model_run_stages",
      })
    );
  });

  it("answers 503 when the stage table is not migrated yet, rather than rebuilding it", async () => {
    stagesRead = {
      data: null,
      error: { message: "Could not find the table 'public.model_run_stages' in the schema cache" },
    };

    const response = await launchModelRun(launchRequest(), routeContext);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("Model run stages schema is not available yet");
    expect(stageInsertHappened()).toBe(false);
  });

  it("still creates the stage set when the read succeeds and the run genuinely has none", async () => {
    stagesRead = { data: [], error: null };

    const response = await launchModelRun(launchRequest(), routeContext);

    expect(response.status).toBe(200);
    expect(stageInsertHappened()).toBe(true);
    expect(stageResetHappened()).toBe(false);
  });

  it("still resets the stage set when the read succeeds and the run already has stages", async () => {
    stagesRead = { data: [{ id: "55555555-5555-4555-8555-555555555555" }], error: null };

    const response = await launchModelRun(launchRequest(), routeContext);

    expect(response.status).toBe(200);
    expect(stageResetHappened()).toBe(true);
    expect(stageInsertHappened()).toBe(false);
  });
});
