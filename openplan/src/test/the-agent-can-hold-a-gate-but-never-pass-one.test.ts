import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE ONE ACTION THIS WEEK'S WORK EARNED, DRIVEN THROUGH THE REAL ROUTE.
 *
 * `record_stage_gate_hold` lets the Planner Agent draft a HOLD on a stage gate —
 * the recorded judgement that a gate is not clear, with a stated rationale and,
 * optionally, the run the judgement rested on. It is the closest thing in this
 * product to "planning narrative has the shape of code": a claim, its evidence,
 * an approval gate, an append-only log.
 *
 * It may NOT record a PASS, and that exclusion is what these tests are mostly
 * about. A PASS is the affirmative verdict a board or a funder relies on to let a
 * project advance, written under `decided_by = a person`. A HOLD is conservative
 * and supersedable — the board reads the latest decision per gate, so a wrong
 * hold costs a correction and a wrong pass costs a project moving on evidence
 * nobody checked.
 *
 * The exclusion is stated three times, in three places that fail independently:
 * the payload type has no `decision` field, the effect transmits the HOLD
 * literal, and the route refuses an agent-sourced PASS. The first two live in a
 * browser bundle. Only the third is a boundary, so it is the one driven here.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const APPROVAL_ID = "55555555-5555-4555-8555-555555555555";
const GATE_ID = "G01_INITIATION_AUTHORIZATION";
const APPROVED_AT = "2026-07-30T14:02:00.000Z";

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

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

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") return { select: membershipSelectMock };
  if (table === "stage_gate_decisions") return { insert: decisionInsertMock };
  if (table === "projects") return { select: projectSelectMock };
  if (table === "workspaces") return { select: workspaceSelectMock };
  throw new Error(`Unexpected table: ${table}`);
});

// Database transaction behavior is exercised separately in the live receipt suite.
// This stub tests route dispatch, canonical payloads and response validation.
const serviceRpcMock = vi.fn();
const transactionResult: { value: unknown } = { value: undefined };

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postDecision } from "@/app/api/stage-gates/decisions/route";
import { hashAssistantActionPayload } from "@/lib/assistant/action-approval-server";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import { ACTION_REGISTRY, executeAction } from "@/lib/runtime/action-registry";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import { buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";

const RATIONALE = "Authorization packet and charter are not on file, so the gate is not clear.";

function agentRequest(body: unknown, headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/stage-gates/decisions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function armHappyPath() {
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
  createServiceRoleClientMock.mockReturnValue({ rpc: serviceRpcMock });
  transactionResult.value = undefined;
  serviceRpcMock.mockImplementation(async (name: string, args: Record<string, string>) => {
    if (name === "read_assistant_hold_receipt") return { data: null, error: null };
    if (name !== "record_assistant_stage_gate_hold") throw new Error(`Unexpected RPC ${name}`);
    if (transactionResult.value !== undefined) return transactionResult.value;
    const action = JSON.parse(args.p_action_canonical);
    return { data: { replayed: false, receipt: { schemaVersion: 1, decision: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", workspace_id: action.workspaceId,
      project_id: action.projectId, gate_id: action.gateId, decision: "HOLD",
      rationale: action.rationale, missing_artifacts: action.missingArtifacts ?? [],
      decided_by: USER_ID, decided_at: APPROVED_AT, run_id: action.runId ?? null, model_run_id: action.modelRunId ?? null, county_run_id: action.countyRunId ?? null,
    } } }, error: null };
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
  decisionInsertSingleMock.mockResolvedValue({
    data: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", gate_id: GATE_ID, decision: "HOLD" },
    error: null,
  });
}

/** The exact action the route rebuilds, and therefore the exact hash it demands. */
function approvedHash(extra: Record<string, unknown> = {}) {
  return hashAssistantActionPayload({
    kind: "record_stage_gate_hold",
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    gateId: GATE_ID,
    rationale: RATIONALE,
    ...extra,
  });
}

function agentHeaders(hash: string) {
  return {
    "x-openplan-assistant-execution-source": "planner_agent_quick_link",
    "x-openplan-assistant-input-hash": hash,
    "x-openplan-assistant-approval-id": APPROVAL_ID,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  armHappyPath();
});

describe("the registered action itself", () => {
  it("is approval-gated and carries no decision field an agent could set", () => {
    expect(ACTION_METADATA.record_stage_gate_hold.approval).toBe("approval_required");
    // The effect's own source is the second statement of the rule: the only
    // verdict it can transmit is the literal.
    const effectSource = ACTION_REGISTRY.record_stage_gate_hold.effect.toString();
    expect(effectSource).toContain('decision: "HOLD"');
    expect(effectSource).not.toContain("action.decision");
  });
});

describe("an approved agent hold reaches the decision log", () => {
  it("passes the exact approved action to one transaction and validates its returned decision", async () => {
    const hash = approvedHash();

    const response = await postDecision(
      agentRequest(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          gateId: GATE_ID,
          decision: "HOLD",
          rationale: RATIONALE,
        },
        agentHeaders(hash)
      )
    );

    expect(response.status).toBe(201);
    expect(decisionInsertMock).not.toHaveBeenCalled();
    const transaction = serviceRpcMock.mock.calls.find(([name]) => name === "record_assistant_stage_gate_hold");
    expect(transaction?.[1]).toMatchObject({ p_approval_id: APPROVAL_ID, p_user_id: USER_ID, p_workspace_id: WORKSPACE_ID });
    const action = JSON.parse(transaction?.[1].p_action_canonical);
    expect(action).toEqual({ kind: "record_stage_gate_hold", workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, gateId: GATE_ID, rationale: RATIONALE });
    expect(hashAssistantActionPayload(action)).toBe(hash);
    expect(await response.json()).toMatchObject({ decision: { decision: "HOLD", rationale: RATIONALE, decided_by: USER_ID }, recovered: false });
  });

  it.each([
    { data: null, error: { code: "23514", message: "synthetic constraint refusal" } },
    { data: null, error: { code: "PGRST116", message: "singular response rejected", details: "The result contains 0 rows" } },
    { data: null, error: null },
  ])("does not claim success or fall back to a separate write when the transaction is unconfirmed: %j", async (result) => {
    const hash = approvedHash();
    transactionResult.value = result;
    const response = await postDecision(agentRequest({
      workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, gateId: GATE_ID,
      decision: "HOLD", rationale: RATIONALE,
    }, agentHeaders(hash)));
    expect(response.status).toBe(503);
    expect(await response.json()).toHaveProperty("error");
    expect(decisionInsertMock).not.toHaveBeenCalled();
    expect(serviceRpcMock.mock.calls.filter(([name]) => name === "record_assistant_stage_gate_hold")).toHaveLength(1);
  });

  it("refuses when the approved payload is not the payload that arrived", async () => {

    const response = await postDecision(
      agentRequest(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          gateId: GATE_ID,
          decision: "HOLD",
          // A different rationale than the one the planner read and approved.
          rationale: "Everything is fine, proceed.",
        },
        agentHeaders(approvedHash())
      )
    );

    expect(response.status).toBe(403);
    expect(decisionInsertMock).not.toHaveBeenCalled();
  });
});

describe("a retained HOLD receipt is read before new-work checks", () => {
  const savedReceipt = { schemaVersion: 1, decision: {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", workspace_id: WORKSPACE_ID, project_id: PROJECT_ID,
    gate_id: GATE_ID, decision: "HOLD", rationale: RATIONALE, decided_by: USER_ID, decided_at: APPROVED_AT, missing_artifacts: [], run_id: null, model_run_id: null, county_run_id: null,
  } };
  it("recovers completed work after downgrade without reading the new gate binding or inserting again", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { workspace_id: WORKSPACE_ID, role: "viewer" }, error: null });
    serviceRpcMock.mockResolvedValueOnce({ data: savedReceipt, error: null });
    const response = await postDecision(agentRequest({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, gateId: GATE_ID, decision: "HOLD", rationale: RATIONALE }, agentHeaders(approvedHash())));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ decision: savedReceipt.decision, recovered: true });
    expect(projectSelectMock).not.toHaveBeenCalled();
    expect(workspaceSelectMock).not.toHaveBeenCalled();
    expect(decisionInsertMock).not.toHaveBeenCalled();
    expect(serviceRpcMock.mock.calls.map(([name]) => name)).toEqual(["read_assistant_hold_receipt"]);
  });
  it("does not execute when receipt readback fails", async () => {
    serviceRpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "Synthetic readback unavailable" } });
    const response = await postDecision(agentRequest({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, gateId: GATE_ID, decision: "HOLD", rationale: RATIONALE }, agentHeaders(approvedHash())));
    expect(response.status).toBe(503);
    expect(decisionInsertMock).not.toHaveBeenCalled();
    expect(serviceRpcMock.mock.calls.map(([name]) => name)).toEqual(["read_assistant_hold_receipt"]);
  });
});

describe("an agent may not sign a PASS", () => {
  it("refuses an agent-sourced PASS before it touches the database", async () => {

    const response = await postDecision(
      agentRequest(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          gateId: GATE_ID,
          decision: "PASS",
          rationale: RATIONALE,
        },
        agentHeaders(approvedHash())
      )
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "The Planner Agent may not record a gate PASS",
    });
    expect(decisionInsertMock).not.toHaveBeenCalled();
    // Refused on the request alone: no membership read, no project read.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("still lets a PERSON record a PASS on the same endpoint", async () => {
    decisionInsertSingleMock.mockResolvedValue({
      data: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", gate_id: GATE_ID, decision: "PASS" },
      error: null,
    });

    const response = await postDecision(
      agentRequest(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          gateId: GATE_ID,
          decision: "PASS",
          rationale: "Charter and authorization packet are complete and on file.",
        },
        {}
      )
    );

    expect(response.status).toBe(201);
    const written = (decisionInsertMock.mock.calls as unknown as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(written.decision).toBe("PASS");
    expect((written.metadata as Record<string, unknown>).authorship).toMatchObject({
      actorKind: "user",
      agentId: null,
    });
    // A manual decision writes no ledger row: `action_kind` would claim a
    // stage-gate HOLD about a PASS a person signed.
    expect(serviceRpcMock).not.toHaveBeenCalled();
  });
});

/**
 * THE PAYLOAD A PLANNER APPROVED IS THE PAYLOAD THAT EXECUTES — end to end,
 * through the real quick link, the real effect, and the real route.
 *
 * Every other test in this file mints the approval hash from the action the
 * ROUTE rebuilds, which is the one thing that can never disagree with itself.
 * That is exactly the gap that hid a live defect: `/api/assistant/actions/
 * approvals` hashes the quick link's whole `executeAction`, post-action chaining
 * fields included, while every route rebuilds its action from its own parsed
 * body, which never carries them. The two hashes differed, so a planner who
 * approved the sheet got a 403 — on this action and on the four
 * funding/invoicing quick links that predate it.
 *
 * So this drives the actual chain: the offer `buildAssistantOperations` renders,
 * hashed the way the approvals endpoint hashes it, executed by the registry
 * effect, landing on the real POST.
 */
describe("the quick link a planner clicks reaches the route it approved", () => {
  it("executes end to end with the hash the approvals endpoint would mint", async () => {
    const summary = buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1", projectId: PROJECT_ID });
    const link = buildAssistantOperations({
      kind: "project",
      workspace: { id: WORKSPACE_ID, name: "Test Workspace", role: "owner" },
      project: {
        id: PROJECT_ID,
        name: "Corridor plan",
        summary: null,
        status: "active",
        planType: "corridor_study",
        deliveryPhase: "scoping",
        updatedAt: "2026-07-30T18:00:00.000Z",
      },
      counts: {
        deliverables: 0, risks: 0, issues: 0, decisions: 0, meetings: 0,
        linkedDatasets: 0, overlayReadyDatasets: 0, recentRuns: 0,
      },
      fundingSummary: {
        opportunityCount: 0, openCount: 0, closingSoonCount: 0, overdueDecisionCount: 0,
        pursueCount: 0, awardCount: 0, awardRecordCount: 0, fundingNeedAmount: null,
        gapAmount: null, requestedReimbursementAmount: null, uninvoicedAwardAmount: null,
        reimbursementStatus: null, reimbursementPacketCount: 0, exactInvoiceAwardRelink: null,
        leadOpportunity: null, leadOverdueOpportunity: null, leadClosingOpportunity: null,
        leadAwardOpportunity: null,
      },
      stageGateSummary: summary,
      linkedDatasets: [],
      recentRuns: [],
      reportSummary: {
        linkedReportCount: 0, evidenceBackedCount: 0, comparisonBackedCount: 0,
        noPacketCount: 0, refreshRecommendedCount: 0, recommendedReport: null,
      },
    } as never).find((candidate) => candidate.executeAction?.kind === "record_stage_gate_hold");

    expect(link, "the gate-hold offer is not reachable from a real project board").toBeDefined();
    const action = link?.executeAction as Extract<
      AssistantQuickLinkExecuteAction,
      { kind: "record_stage_gate_hold" }
    >;
    // The quick link really does carry the chaining fields — otherwise this test
    // would pass without exercising the thing that broke.
    expect(action.postActionWorkflowId).toBeTruthy();

    // Exactly what POST /api/assistant/actions/approvals stores: the hash of the
    // whole executeAction the planner was shown.
    const mintedHash = hashAssistantActionPayload(action);

    const originalFetch = globalThis.fetch;
    const responses: Response[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new NextRequest(`http://localhost${String(input)}`, {
        method: init?.method ?? "POST",
        headers: init?.headers as HeadersInit,
        body: init?.body as BodyInit,
      });
      const response = await postDecision(request);
      responses.push(response);
      return response;
    }) as typeof fetch;

    try {
      await executeAction(
        action,
        { onCompleted: () => {} },
        {
          approvalEvidence: {
            approvalId: APPROVAL_ID,
            inputHash: mintedHash,
            executionSource: "planner_agent_quick_link",
          },
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(responses[0]?.status).toBe(201);
    const transaction = serviceRpcMock.mock.calls.find(([name]) => name === "record_assistant_stage_gate_hold");
    const submitted = JSON.parse(transaction?.[1].p_action_canonical);
    expect(submitted.kind).toBe("record_stage_gate_hold");
    expect(submitted.missingArtifacts).toEqual(action.missingArtifacts);
    expect(hashAssistantActionPayload(submitted)).toBe(mintedHash);
  });
});

describe("a narrow action may not ride the wide endpoint", () => {
  it("refuses an agent request carrying a field outside the action's payload", async () => {

    const response = await postDecision(
      agentRequest(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          gateId: GATE_ID,
          decision: "HOLD",
          rationale: RATIONALE,
          // Not part of what a planner approved. The hash over the reconstructed
          // action would still have matched.
          templateId: "some_other_template",
        },
        agentHeaders(approvedHash())
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Planner Agent action carried fields outside its own payload",
    });
    expect(decisionInsertMock).not.toHaveBeenCalled();
  });

  it("leaves a manual request free to use the whole endpoint", async () => {
    const response = await postDecision(
      agentRequest(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          gateId: GATE_ID,
          decision: "HOLD",
          rationale: RATIONALE,
          missingArtifacts: ["authorization_packet"],
        },
        {}
      )
    );

    expect(response.status).toBe(201);
  });
});
