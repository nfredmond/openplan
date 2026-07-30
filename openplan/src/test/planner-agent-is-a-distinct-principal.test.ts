import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  recordAssistantActionExecution,
  withAssistantActionAudit,
} from "@/lib/observability/action-audit";
import {
  verifyAssistantActionApproval,
  hashAssistantActionPayload,
  ASSISTANT_ACTION_EXECUTION_SOURCE,
} from "@/lib/assistant/action-approval-server";
import { PLANNER_AGENT_PRINCIPAL_ID } from "@/lib/assistant/agent-principal";

/**
 * AUTHORIZATION DOES NOT ERASE AUTHORSHIP.
 *
 * Before this, one action execution produced one name in the ledger — `user_id`,
 * the person whose session it ran under — and one hint about transport,
 * `execution_source`. Read back, an action a language model composed was
 * indistinguishable from one a planner typed except by knowing that
 * 'planner_agent_quick_link' implies the former.
 *
 * That mattered in exactly the place it is hardest to fix later. When a grant
 * narrative, a CEQA determination, or a stage-gate verdict is challenged, "who
 * wrote this number" is a question with legal weight, and answering it with a
 * planner's name when a model drafted the sentence is not an incomplete record —
 * it is a wrong one, in the direction that harms the person named.
 *
 * These tests assert the three facts a row must now be able to state separately:
 * who authored it, who approved it, and when.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const APPROVAL_ID = "33333333-3333-4333-8333-333333333333";
const APPROVED_AT = "2026-07-30T14:02:00.000Z";

function capturingClient() {
  const inserts: Array<Record<string, unknown>> = [];
  return {
    inserts,
    from: (table: string) => {
      if (table !== "assistant_action_executions") throw new Error(`Unexpected table: ${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          inserts.push(row);
          return { error: null };
        },
      };
    },
  };
}

function approvalClient(row: Record<string, unknown> | null) {
  const table = {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
    }),
    update: () => ({
      eq: () => ({ is: () => ({ select: async () => ({ data: [{ id: APPROVAL_ID }], error: null }) }) }),
    }),
  };
  return { from: () => table };
}

function agentRequest(inputHash: string): NextRequest {
  return new NextRequest("http://localhost/api/stage-gates/decisions", {
    method: "POST",
    headers: {
      "x-openplan-assistant-execution-source": ASSISTANT_ACTION_EXECUTION_SOURCE,
      "x-openplan-assistant-input-hash": inputHash,
      "x-openplan-assistant-approval-id": APPROVAL_ID,
    },
  });
}

const ACTION = {
  kind: "record_stage_gate_hold" as const,
  workspaceId: WORKSPACE_ID,
  projectId: "44444444-4444-4444-8444-444444444444",
  gateId: "G01_INITIATION_AUTHORIZATION",
  rationale: "Authorization packet is not on file.",
};

describe("the verifier reports authorship, not just transport", () => {
  it("attributes an approved agent action to the agent AND names the approver and the time", async () => {
    const inputHash = hashAssistantActionPayload(ACTION);
    const verification = await verifyAssistantActionApproval({
      request: agentRequest(inputHash),
      serviceSupabase: approvalClient({
        id: APPROVAL_ID,
        workspace_id: WORKSPACE_ID,
        user_id: USER_ID,
        action_kind: "record_stage_gate_hold",
        input_hash: inputHash,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        consumed_at: null,
        created_at: APPROVED_AT,
      }),
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      action: ACTION,
    });

    expect(verification.authorship).toEqual({
      actorKind: "planner_agent",
      actorAgentId: PLANNER_AGENT_PRINCIPAL_ID,
      approvedByUserId: USER_ID,
      approvedAt: APPROVED_AT,
    });
  });

  it("attributes a manual request to the person, with no agent principal attached", async () => {
    const verification = await verifyAssistantActionApproval({
      request: new NextRequest("http://localhost/api/funding-opportunities", { method: "POST" }),
      serviceSupabase: approvalClient(null),
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      action: { kind: "create_funding_opportunity", title: "Typed by a person" },
    });

    expect(verification.authorship.actorKind).toBe("user");
    expect(verification.authorship.actorAgentId).toBeNull();
  });

  it("still names the agent when the tier required no approval — nobody consented, and that shows", async () => {
    // generate_report_artifact is tier `safe`, so no approval row exists. The
    // agent still authored it. Recording this as user-authored would be the
    // exact impersonation the seam exists to end.
    const verification = await verifyAssistantActionApproval({
      request: agentRequest("unused"),
      serviceSupabase: approvalClient(null),
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      action: { kind: "generate_report_artifact", reportId: "report-1" },
    });

    expect(verification.authorship.actorKind).toBe("planner_agent");
    expect(verification.authorship.actorAgentId).toBe(PLANNER_AGENT_PRINCIPAL_ID);
    expect(verification.authorship.approvedByUserId).toBeNull();
    expect(verification.authorship.approvedAt).toBeNull();
  });
});

describe("the ledger row carries both principals", () => {
  it("writes actor, agent id, approver and approval time as separate columns", async () => {
    const client = capturingClient();
    await recordAssistantActionExecution(client as never, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      actionKind: "record_stage_gate_hold",
      auditEvent: "planner_agent.record_stage_gate_hold",
      approval: "approval_required",
      regrounding: "refresh_preview",
      outcome: "succeeded",
      authorship: {
        actorKind: "planner_agent",
        actorAgentId: PLANNER_AGENT_PRINCIPAL_ID,
        approvedByUserId: USER_ID,
        approvedAt: APPROVED_AT,
      },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const row = client.inserts[0];
    expect(row.actor_kind).toBe("planner_agent");
    expect(row.actor_agent_id).toBe(PLANNER_AGENT_PRINCIPAL_ID);
    expect(row.approved_by_user_id).toBe(USER_ID);
    expect(row.approved_at).toBe(APPROVED_AT);
    // The session the write ran under is a THIRD fact, and it is not the author.
    expect(row.user_id).toBe(USER_ID);
  });

  it("defaults an unattributed write to person-authored rather than to an agent", async () => {
    const client = capturingClient();
    await withAssistantActionAudit(
      client as never,
      { actionKind: "create_funding_opportunity", workspaceId: WORKSPACE_ID, userId: USER_ID },
      async () => "written"
    );

    const row = client.inserts[0];
    expect(row.actor_kind).toBe("user");
    expect(row.actor_agent_id).toBeNull();
    expect(row.approved_by_user_id).toBeNull();
    expect(row.approved_at).toBeNull();
  });

  it("records authorship on the FAILED row too — a refused agent write is still an agent write", async () => {
    const client = capturingClient();
    await expect(
      withAssistantActionAudit(
        client as never,
        {
          actionKind: "record_stage_gate_hold",
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          authorship: {
            actorKind: "planner_agent",
            actorAgentId: PLANNER_AGENT_PRINCIPAL_ID,
            approvedByUserId: USER_ID,
            approvedAt: APPROVED_AT,
          },
        },
        async () => {
          throw new Error("insert refused");
        }
      )
    ).rejects.toThrow("insert refused");

    expect(client.inserts[0].outcome).toBe("failed");
    expect(client.inserts[0].actor_kind).toBe("planner_agent");
  });
});

/**
 * The WRITE side of the same deployment window the read side already handles.
 *
 * Between a deploy and 20260730000006, the insert names four columns the table
 * does not have, and PostgREST fails the whole statement. The only consequence
 * was a `console.warn`, so every action in that window executed with NO ledger
 * row at all — a silent hole in the audit trail, which is strictly worse than a
 * row that cannot say who authored it. The row is written without authorship
 * instead, and the read side reports `authorshipAvailable: false` so no surface
 * claims a person wrote it.
 */
describe("the ledger row survives a deployment that has not migrated yet", () => {
  function retryingClient(firstError: { message: string; code?: string }) {
    const attempts: Array<Record<string, unknown>> = [];
    return {
      attempts,
      from: () => ({
        insert: async (row: Record<string, unknown>) => {
          attempts.push(row);
          return attempts.length === 1 ? { error: firstError } : { error: null };
        },
      }),
    };
  }

  const AGENT_INPUT = {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    actionKind: "record_stage_gate_hold",
    auditEvent: "planner_agent.record_stage_gate_hold",
    approval: "approval_required" as const,
    regrounding: "refresh_preview" as const,
    outcome: "succeeded" as const,
    authorship: {
      actorKind: "planner_agent" as const,
      actorAgentId: PLANNER_AGENT_PRINCIPAL_ID,
      approvedByUserId: USER_ID,
      approvedAt: APPROVED_AT,
    },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  it("retries without the authorship columns rather than losing the row", async () => {
    const client = retryingClient({
      message: "Could not find the 'actor_kind' column of 'assistant_action_executions' in the schema cache",
      code: "PGRST204",
    });

    const result = await recordAssistantActionExecution(client as never, AGENT_INPUT);

    expect(result.error).toBeNull();
    expect(client.attempts).toHaveLength(2);
    expect(client.attempts[0]).toHaveProperty("actor_kind");
    expect(client.attempts[1]).not.toHaveProperty("actor_kind");
    // The rest of the row is intact — this is a downgrade of one fact, not of
    // the record.
    expect(client.attempts[1].action_kind).toBe("record_stage_gate_hold");
    expect(client.attempts[1].outcome).toBe("succeeded");
  });

  it("does NOT mistake a real write failure for a pending migration", async () => {
    // A constraint violation, a permission denial, or a dead connection must
    // surface as itself. Retrying those without authorship would quietly strip
    // the agent attribution off a row that could have carried it.
    const client = retryingClient({
      message: 'new row violates row-level security policy for table "assistant_action_executions"',
      code: "42501",
    });

    const result = await recordAssistantActionExecution(client as never, AGENT_INPUT);

    expect(client.attempts).toHaveLength(1);
    expect(result.error?.code).toBe("42501");
  });
});

describe("the ledger read model asks for the authorship columns", () => {
  it("selects them, and degrades honestly when the deployment has not migrated", async () => {
    const { loadAssistantActivityRows } = await import("@/app/api/assistant-activity/summary");

    const attempted: string[] = [];
    const supabase = {
      from: () => ({
        select: (columns: string) => {
          attempted.push(columns);
          return {
            eq: () => ({
              order: () => ({
                limit: async () =>
                  columns.includes("actor_kind")
                    ? { data: null, error: { message: 'column "actor_kind" does not exist' } }
                    : { data: [{ id: "row-1" }], error: null },
              }),
            }),
          };
        },
      }),
    };

    const result = await loadAssistantActivityRows(supabase, { workspaceId: WORKSPACE_ID, limit: 5 });

    expect(attempted[0]).toContain("actor_kind");
    // The rows still come back; what changes is that the surface is TOLD it
    // cannot answer "who wrote this" here, rather than defaulting every row to
    // "a person did it".
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.authorshipAvailable).toBe(false);
  });
});

describe("the migration that makes this storable", () => {
  it("forbids an agent-authored row that cannot name its agent", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(
      "supabase/migrations/20260730000006_assistant_action_agent_principal.sql",
      "utf8"
    );
    expect(sql).toContain("assistant_action_executions_actor_identity");
    expect(sql).toMatch(/actor_kind = 'planner_agent' AND actor_agent_id IS NOT NULL/);
    expect(sql).toMatch(/actor_kind = 'user' AND actor_agent_id IS NULL/);
  });

  it("forbids a half-recorded consent", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(
      "supabase/migrations/20260730000006_assistant_action_agent_principal.sql",
      "utf8"
    );
    expect(sql).toMatch(/\(approved_by_user_id IS NULL\) = \(approved_at IS NULL\)/);
  });
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));
