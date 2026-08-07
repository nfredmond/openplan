import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const MODEL_RUN_ID = "55555555-5555-4555-8555-555555555555";
const GATE_ID = "G01_INITIATION_AUTHORIZATION";

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const decisionsLimitMock = vi.fn();
const decisionsOrderMock = vi.fn(() => ({ limit: decisionsLimitMock }));
// Re-entrant: the GET chains `.eq()` up to three times (workspace, project, run)
// before ordering, so each link must offer both `eq` and `order`.
const decisionsEqMock = vi.fn(() => ({ eq: decisionsEqMock, order: decisionsOrderMock }));
const decisionsSelectMock = vi.fn(() => ({ eq: decisionsEqMock }));

const decisionInsertSingleMock = vi.fn();
const decisionInsertSelectMock = vi.fn(() => ({ single: decisionInsertSingleMock }));
const decisionInsertMock = vi.fn(() => ({ select: decisionInsertSelectMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqWorkspaceMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectEqIdMock = vi.fn(() => ({ eq: projectEqWorkspaceMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqIdMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const runCitationMaybeSingleMock = vi.fn();
const runCitationEqWorkspaceMock = vi.fn(() => ({ maybeSingle: runCitationMaybeSingleMock }));
const runCitationEqIdMock = vi.fn(() => ({ eq: runCitationEqWorkspaceMock }));
const runCitationSelectMock = vi.fn(() => ({ eq: runCitationEqIdMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }

  if (table === "stage_gate_decisions") {
    return { select: decisionsSelectMock, insert: decisionInsertMock };
  }

  if (table === "projects") {
    return { select: projectSelectMock };
  }

  if (table === "workspaces") {
    return { select: workspaceSelectMock };
  }

  if (table === "runs" || table === "model_runs" || table === "county_runs") {
    return { select: runCitationSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as getDecisions, POST as postDecision } from "@/app/api/stage-gates/decisions/route";

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/stage-gates/decisions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validDecisionBody(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    gateId: GATE_ID,
    decision: "PASS",
    rationale: "Charter and authorization packet are complete and on file.",
    ...overrides,
  };
}

function armHappyPath() {
  createApiAuditLoggerMock.mockReturnValue(mockAudit);

  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });

  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: fromMock,
  });

  membershipMaybeSingleMock.mockResolvedValue({
    data: { workspace_id: WORKSPACE_ID, role: "member" },
    error: null,
  });

  projectMaybeSingleMock.mockResolvedValue({
    data: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Corridor plan" },
    error: null,
  });

  workspaceMaybeSingleMock.mockResolvedValue({
    data: { id: WORKSPACE_ID, stage_gate_template_id: "ca_stage_gates_v0_1" },
    error: null,
  });

  runCitationMaybeSingleMock.mockResolvedValue({ data: { id: MODEL_RUN_ID }, error: null });

  decisionInsertSingleMock.mockResolvedValue({
    data: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", gate_id: GATE_ID, decision: "PASS" },
    error: null,
  });
}

describe("GET /api/stage-gates/decisions auth + role guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    armHappyPath();

    decisionsLimitMock.mockResolvedValue({
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          run_id: RUN_ID,
          gate_id: GATE_ID,
          decision: "PASS",
          rationale: "All required evidence approved.",
          missing_artifacts: [],
          metadata: { source: "api.stage_gates.decisions" },
          decided_by: USER_ID,
          decided_at: "2026-03-05T20:00:00.000Z",
        },
      ],
      error: null,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getDecisions(
      new NextRequest(`http://localhost/api/stage-gates/decisions?workspaceId=${WORKSPACE_ID}`)
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 403 when workspace membership is missing", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await getDecisions(
      new NextRequest(`http://localhost/api/stage-gates/decisions?workspaceId=${WORKSPACE_ID}`)
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("returns 403 for unsupported role (deny-by-default)", async () => {
    // "viewer" became a real read-capable role; an unknown string still denies.
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: WORKSPACE_ID, role: "auditor" },
      error: null,
    });

    const response = await getDecisions(
      new NextRequest(`http://localhost/api/stage-gates/decisions?workspaceId=${WORKSPACE_ID}`)
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("returns 200 with decision rows for workspace member", async () => {
    const response = await getDecisions(
      new NextRequest(`http://localhost/api/stage-gates/decisions?workspaceId=${WORKSPACE_ID}&limit=25`)
    );

    expect(response.status).toBe(200);
    expect(decisionsEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(decisionsOrderMock).toHaveBeenCalledWith("decided_at", { ascending: false });
    expect(decisionsLimitMock).toHaveBeenCalledWith(25);
    expect(await response.json()).toMatchObject({ decisions: expect.any(Array) });
  });

  it("filters by runId when provided", async () => {
    const response = await getDecisions(
      new NextRequest(`http://localhost/api/stage-gates/decisions?workspaceId=${WORKSPACE_ID}&runId=${RUN_ID}`)
    );

    expect(response.status).toBe(200);
    expect(decisionsEqMock).toHaveBeenCalledWith("run_id", RUN_ID);
  });

  it("filters by projectId when provided", async () => {
    const response = await getDecisions(
      new NextRequest(
        `http://localhost/api/stage-gates/decisions?workspaceId=${WORKSPACE_ID}&projectId=${PROJECT_ID}`
      )
    );

    expect(response.status).toBe(200);
    expect(decisionsEqMock).toHaveBeenCalledWith("project_id", PROJECT_ID);
  });

  it("does NOT scope to a project unless asked", async () => {
    // Rows written before 20260728000011 carry no project. Defaulting to a
    // project filter would hide them from the only query that can still see them.
    await getDecisions(
      new NextRequest(`http://localhost/api/stage-gates/decisions?workspaceId=${WORKSPACE_ID}`)
    );

    expect(decisionsEqMock).not.toHaveBeenCalledWith("project_id", expect.anything());
  });
});

/**
 * The write half of the spine's upward edge.
 *
 * Before this, `/api/stage-gates/decisions` exported GET only: the nine-gate
 * cockpit displayed a workflow no human could drive, and the sole writer of the
 * table was the report-export route recording an off-vocabulary gate id that
 * every reader silently discarded.
 */
describe("POST /api/stage-gates/decisions records a human gate decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    armHappyPath();
  });

  it("records the decision against the project and the bound template", async () => {
    const response = await postDecision(jsonRequest(validDecisionBody()));

    expect(response.status).toBe(201);
    expect(decisionInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        gate_id: GATE_ID,
        // The gate id is only interpretable inside its own template, and that
        // association cannot be reconstructed after a workspace rebinds.
        template_id: "ca_stage_gates_v0_1",
        decision: "PASS",
        decided_by: USER_ID,
        run_id: null,
        model_run_id: null,
        county_run_id: null,
      })
    );
  });

  it("refuses a gate id the bound template does not define, and says which gates it does", async () => {
    // This is the defect that made the cockpit read as empty: the only writer
    // wrote `report_artifact_gate`, which is in no template's gate order, so
    // every row it produced was dropped by every reader with nothing on screen
    // to distinguish that from "nobody has decided anything".
    const response = await postDecision(
      jsonRequest(validDecisionBody({ gateId: "report_artifact_gate" }))
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; details: string };
    expect(body.error).toBe("Unknown stage gate");
    expect(body.details).toContain("report_artifact_gate");
    expect(body.details).toContain("G01_INITIATION_AUTHORIZATION");
  });

  it("requires a rationale", async () => {
    const response = await postDecision(jsonRequest(validDecisionBody({ rationale: "   " })));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid stage-gate decision" });
    expect(decisionInsertMock).not.toHaveBeenCalled();
  });

  it("denies the read-only viewer tier", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
    });

    const response = await postDecision(jsonRequest(validDecisionBody()));

    expect(response.status).toBe(403);
    expect(decisionInsertMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postDecision(jsonRequest(validDecisionBody()));

    expect(response.status).toBe(401);
    expect(decisionInsertMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a project outside the workspace instead of confirming it exists", async () => {
    projectMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await postDecision(jsonRequest(validDecisionBody()));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "No such project" });
    expect(decisionInsertMock).not.toHaveBeenCalled();
  });

  it("carries a model-run citation through to the row", async () => {
    // The edge that mattered most and that the schema could not express: "this
    // gate passed BECAUSE of that model run".
    const response = await postDecision(
      jsonRequest(validDecisionBody({ modelRunId: MODEL_RUN_ID }))
    );

    expect(response.status).toBe(201);
    expect(fromMock).toHaveBeenCalledWith("model_runs");
    expect(decisionInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ model_run_id: MODEL_RUN_ID, run_id: null, county_run_id: null })
    );
  });

  it("refuses a run citation from another workspace", async () => {
    runCitationMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await postDecision(
      jsonRequest(validDecisionBody({ modelRunId: MODEL_RUN_ID }))
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "No such model run" });
    expect(decisionInsertMock).not.toHaveBeenCalled();
  });

  /**
   * THE TEST ABOVE PROVES THE REFUSAL AND NOT THE SCOPING, AND THE DIFFERENCE IS
   * THE WHOLE TENANCY BOUNDARY.
   *
   * It stubs `maybeSingle` to null, so the MOCK is what refuses — the query that
   * would have refused is never inspected. Mutation proved the gap: replacing
   * `.eq("workspace_id", workspaceId)` on the citation lookup with a second
   * `.eq("id", citedId)` let a signed gate decision cite ANOTHER AGENCY'S model
   * run as its evidence, and it survived this file plus five sibling guards.
   * A gate decision is the verdict a funder relies on, so the columns the lookup
   * filters on are asserted here rather than simulated.
   */
  it("looks the cited run up by id AND by workspace, not by id alone", async () => {
    const response = await postDecision(
      jsonRequest(validDecisionBody({ modelRunId: MODEL_RUN_ID }))
    );

    expect(response.status).toBe(201);
    expect(runCitationEqIdMock).toHaveBeenCalledWith("id", MODEL_RUN_ID);
    expect(runCitationEqWorkspaceMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
  });

  /** The same hole on the project lookup: `404` there is stubbed, not queried. */
  it("looks the project up by id AND by workspace, not by id alone", async () => {
    const response = await postDecision(jsonRequest(validDecisionBody()));

    expect(response.status).toBe(201);
    expect(projectEqIdMock).toHaveBeenCalledWith("id", PROJECT_ID);
    expect(projectEqWorkspaceMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
  });

  /** And on the membership lookup, which is what makes the role gate mean anything. */
  it("scopes the membership lookup to this workspace AND this user", async () => {
    const response = await postDecision(jsonRequest(validDecisionBody()));

    expect(response.status).toBe(201);
    expect(membershipEqWorkspaceMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(membershipEqUserMock).toHaveBeenCalledWith("user_id", USER_ID);
  });

  it("refuses to cite more than one run, and names the rule", async () => {
    const response = await postDecision(
      jsonRequest(validDecisionBody({ runId: RUN_ID, modelRunId: MODEL_RUN_ID }))
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "A gate decision may cite at most one run",
    });
    expect(decisionInsertMock).not.toHaveBeenCalled();
  });

  it("refuses when the workspace is bound to a template this deployment cannot resolve", async () => {
    workspaceMaybeSingleMock.mockResolvedValueOnce({
      data: { id: WORKSPACE_ID, stage_gate_template_id: "oh_stage_gates_v1" },
      error: null,
    });

    const response = await postDecision(jsonRequest(validDecisionBody()));

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; details: string };
    expect(body.details).toContain("oh_stage_gates_v1");
    expect(decisionInsertMock).not.toHaveBeenCalled();
  });

  it("treats an insert that cannot be read back as created, not as failed", async () => {
    // The row exists; only the `.select()` after it came back empty. Answering an
    // error here would make the client retry and record the decision twice.
    decisionInsertSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await postDecision(jsonRequest(validDecisionBody()));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: true, record: null });
  });

  it("answers 500 when the insert genuinely fails", async () => {
    decisionInsertSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "write failed", code: "XX000" },
    });

    const response = await postDecision(jsonRequest(validDecisionBody()));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "Failed to record the stage-gate decision",
    });
  });
});
