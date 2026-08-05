import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * ATTACHING A MODEL RUN AS THE EVIDENCE BEHIND AN RTP PORTFOLIO DECISION.
 *
 * PATCH verifies the run belongs to the same workspace before it stores the
 * pointer. That verification read used to discard its error, so a read that
 * FAILED took the same branch a read that found nothing takes and answered
 * 400 "Model run not found in this workspace" — a statement about the
 * workspace's own model runs, made on the strength of a question the database
 * never answered, to a planner who picked the run out of a list of that
 * workspace's runs a moment earlier.
 *
 * The harness fails that ONE read and leaves the project, membership and link
 * reads working, because a mocked client returns its fixture for whatever is
 * asked and an untargeted failure proves nothing about which read was checked.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const LINK_ID = "44444444-4444-4444-8444-444444444444";
const MODEL_RUN_ID = "55555555-5555-4555-8555-555555555555";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { PATCH as patchRtpLink } from "@/app/api/projects/[projectId]/rtp-links/route";

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

const dbCalls: Array<{ table: string; method: string; args: unknown[] }> = [];

const CHAIN_METHODS = ["select", "eq", "in", "order", "limit", "insert", "update", "delete"];

function makeChain(table: string, resolve: (ops: string[]) => QueryResult) {
  const ops: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of CHAIN_METHODS) {
    chain[method] = vi.fn((...args: unknown[]) => {
      ops.push(method);
      dbCalls.push({ table, method, args });
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => resolve(ops));
  chain.single = vi.fn(async () => resolve(ops));
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(resolve(ops)).then(onFulfilled, onRejected);
  return chain;
}

/** The `model_runs` read — the one read each test varies. */
let modelRunRead: QueryResult;

function installClient() {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      if (table === "project_rtp_cycle_links") {
        return makeChain(table, (ops) =>
          ops.includes("update")
            ? {
                data: {
                  id: LINK_ID,
                  project_id: PROJECT_ID,
                  rtp_cycle_id: "66666666-6666-4666-8666-666666666666",
                  portfolio_role: "candidate",
                  priority_rationale: null,
                  priority_scores: {},
                  evidence_model_run_id: MODEL_RUN_ID,
                  created_at: "2026-08-01T00:00:00.000Z",
                },
                error: null,
              }
            : { data: { id: LINK_ID, project_id: PROJECT_ID, workspace_id: WORKSPACE_ID }, error: null }
        );
      }
      if (table === "workspace_members") {
        return makeChain(table, () => ({
          data: { workspace_id: WORKSPACE_ID, role: "admin" },
          error: null,
        }));
      }
      if (table === "model_runs") {
        return makeChain(table, () => modelRunRead);
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  });
}

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/rtp-links`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeContext = { params: Promise.resolve({ projectId: PROJECT_ID }) };

function linkUpdateHappened(): boolean {
  return dbCalls.some((call) => call.table === "project_rtp_cycle_links" && call.method === "update");
}

describe("PATCH /api/projects/[projectId]/rtp-links — the evidence run check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbCalls.length = 0;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    modelRunRead = { data: { id: MODEL_RUN_ID, workspace_id: WORKSPACE_ID }, error: null };
    installClient();
  });

  it("does not claim the run is missing from the workspace when the lookup failed", async () => {
    modelRunRead = {
      data: null,
      error: { message: "permission denied for table model_runs", code: "42501" },
    };

    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, evidenceModelRunId: MODEL_RUN_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load model run");
    expect(body.hint).toContain("read failure, not an empty result");

    // The old false claim, in the planner's own words.
    expect(body.error).not.toBe("Model run not found in this workspace");
    expect(linkUpdateHappened()).toBe(false);

    expect(mockAudit.error).toHaveBeenCalledWith(
      "evidence_model_run_lookup_failed",
      expect.objectContaining({
        modelRunId: MODEL_RUN_ID,
        message: "permission denied for table model_runs",
      })
    );
  });

  it("answers 503 when the model run table is not migrated yet", async () => {
    modelRunRead = {
      data: null,
      error: { message: "Could not find the table 'public.model_runs' in the schema cache" },
    };

    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, evidenceModelRunId: MODEL_RUN_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("Model run schema is not available yet");
    expect(linkUpdateHappened()).toBe(false);
  });

  it("still refuses a run that genuinely is not in this workspace", async () => {
    modelRunRead = { data: null, error: null };

    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, evidenceModelRunId: MODEL_RUN_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Model run not found in this workspace");
    expect(linkUpdateHappened()).toBe(false);
  });

  it("still refuses a run that belongs to another workspace", async () => {
    modelRunRead = {
      data: { id: MODEL_RUN_ID, workspace_id: "99999999-9999-4999-8999-999999999999" },
      error: null,
    };

    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, evidenceModelRunId: MODEL_RUN_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Model run not found in this workspace");
    expect(linkUpdateHappened()).toBe(false);
  });

  it("attaches the evidence run when the lookup succeeds", async () => {
    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, evidenceModelRunId: MODEL_RUN_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.link.evidence_model_run_id).toBe(MODEL_RUN_ID);
    expect(linkUpdateHappened()).toBe(true);
  });
});
