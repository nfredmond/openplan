import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ASSISTANT_ACTION_EXECUTION_SOURCE,
  hashAssistantActionPayload,
  verifyAssistantActionApproval,
} from "@/lib/assistant/action-approval-server";

function plannerRequest(headers: Record<string, string>) {
  return new NextRequest("http://localhost/api/probe", {
    method: "POST",
    headers,
  });
}

const APPROVED_ACTION = {
  kind: "create_funding_opportunity" as const,
  projectId: "project-1",
  title: "ATP Cycle 8",
};

/** When consent was granted — distinct from when the action later executes. */
const APPROVAL_CREATED_AT = "2026-07-30T14:02:00.000Z";

function approvalRow(overrides: Partial<{ consumed_at: string | null; expires_at: string }> = {}) {
  return {
    id: "approval-1",
    workspace_id: "workspace-1",
    user_id: "user-1",
    action_kind: "create_funding_opportunity",
    input_hash: hashAssistantActionPayload(APPROVED_ACTION),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed_at: null as string | null,
    created_at: APPROVAL_CREATED_AT,
    ...overrides,
  };
}

/**
 * Stateful fake of the assistant_action_approvals table modelling the two behaviours
 * that make single-use safety observable:
 *  - `.select().eq().maybeSingle()` returns a snapshot of consumed_at captured when the
 *    read is issued, so a stale read inside a TOCTOU window keeps seeing null; and
 *  - `.update().eq().is('consumed_at', null).select('id')` is atomic: only the first
 *    caller that flips the row gets a row back, later callers get an empty array.
 */
function makeApprovalStore(initial = approvalRow()) {
  let consumedAt: string | null = initial.consumed_at ?? null;
  return {
    get consumedAt() {
      return consumedAt;
    },
    from(table: string) {
      if (table !== "assistant_action_approvals") throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => {
            const snapshot = consumedAt;
            return {
              maybeSingle: () => Promise.resolve({ data: { ...initial, consumed_at: snapshot }, error: null }),
            };
          },
        }),
        update: (values: { consumed_at: string }) => ({
          eq: () => ({
            is: (_column: string, _value: unknown) => ({
              select: () => {
                if (consumedAt === null) {
                  consumedAt = values.consumed_at;
                  return Promise.resolve({ data: [{ id: initial.id }], error: null });
                }
                return Promise.resolve({ data: [] as Array<{ id: string }>, error: null });
              },
            }),
          }),
        }),
      };
    },
  };
}

function plannerVerify(serviceSupabase: { from: (table: string) => unknown }) {
  return verifyAssistantActionApproval({
    request: plannerRequest({
      "x-openplan-assistant-execution-source": ASSISTANT_ACTION_EXECUTION_SOURCE,
      "x-openplan-assistant-input-hash": hashAssistantActionPayload(APPROVED_ACTION),
      "x-openplan-assistant-approval-id": "approval-1",
    }),
    serviceSupabase,
    userId: "user-1",
    workspaceId: "workspace-1",
    action: APPROVED_ACTION,
  });
}

/**
 * WHAT THE HASH COVERS IS WHAT WILL BE WRITTEN — nothing more.
 *
 * `/api/assistant/actions/approvals` hashes the quick link's whole
 * `executeAction`; every target route hashes the action it rebuilds from its own
 * parsed BODY. The post-action chaining fields exist only in the first of those,
 * so including them made the two hashes disagree and turned an approved action
 * into a 403. They are excluded for every kind, not just the one that surfaced
 * it — this asserts the invariant per branch so a new action cannot reintroduce
 * it.
 */
describe("post-action chaining fields do not enter the approval hash", () => {
  const CHAINING = {
    postActionWorkflowId: "workspace-funding",
    postActionPrompt: "What should move next?",
    postActionPromptLabel: "Review posture",
  };

  const SAMPLE_ACTIONS: Array<Record<string, unknown>> = [
    { kind: "generate_report_artifact", reportId: "report-1" },
    { kind: "create_rtp_packet_record", rtpCycleId: "cycle-1" },
    { kind: "create_funding_opportunity", title: "ATP Cycle 8" },
    { kind: "create_project_funding_profile", projectId: "project-1" },
    { kind: "update_funding_opportunity_decision", opportunityId: "opp-1", decisionState: "pursue" },
    { kind: "create_project_record", projectId: "project-1", recordType: "submittal", title: "Packet" },
    {
      kind: "record_stage_gate_hold",
      workspaceId: "workspace-1",
      projectId: "project-1",
      gateId: "G01_INITIATION_AUTHORIZATION",
      rationale: "No decision is recorded.",
    },
    { kind: "link_billing_invoice_funding_award", workspaceId: "w", invoiceId: "i", fundingAwardId: "a" },
  ];

  for (const action of SAMPLE_ACTIONS) {
    it(`${action.kind} hashes the same with and without them`, () => {
      expect(hashAssistantActionPayload({ ...action, ...CHAINING })).toBe(
        hashAssistantActionPayload(action)
      );
    });
  }

  it("still distinguishes a payload field that IS written", () => {
    // The exclusion must be narrow. Changing anything the route reconstructs has
    // to change the hash, or the single-use evidence stops meaning anything.
    expect(hashAssistantActionPayload({ kind: "create_funding_opportunity", title: "A" })).not.toBe(
      hashAssistantActionPayload({ kind: "create_funding_opportunity", title: "B" })
    );
  });
});

describe("verifyAssistantActionApproval", () => {
  it("requires and consumes one-use approval evidence for approval-required Planner Agent mutations", async () => {
    const isMock = vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [{ id: "approval-1" }], error: null }),
    }));
    const serviceSupabase = {
      from: vi.fn((table: string) => {
        if (table !== "assistant_action_approvals") throw new Error(`Unexpected table: ${table}`);
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: approvalRow(), error: null }),
            })),
          })),
          update: vi.fn(() => ({ eq: vi.fn(() => ({ is: isMock })) })),
        };
      }),
    };

    const result = await plannerVerify(serviceSupabase);

    expect(result).toEqual({
      approvalId: "approval-1",
      inputHash: hashAssistantActionPayload(APPROVED_ACTION),
      executionSource: "planner_agent_quick_link",
      // The agent authored it; the approver and the moment of consent come off
      // the approval row, not off the session spending it.
      authorship: {
        actorKind: "planner_agent",
        actorAgentId: "openplan.planner_agent",
        approvedByUserId: "user-1",
        approvedAt: APPROVAL_CREATED_AT,
      },
    });
    // The single-use consume must be scoped to the still-unconsumed row.
    expect(isMock).toHaveBeenCalledWith("consumed_at", null);
  });

  it("rejects an approval whose atomic consume affects zero rows (double-spend guard)", async () => {
    // The read still sees consumed_at = null (a stale TOCTOU read), but the atomic
    // UPDATE ... WHERE consumed_at IS NULL affects no rows because a concurrent request
    // already won. Without the rows-affected check this path returned success.
    const serviceSupabase = {
      from: (table: string) => {
        if (table !== "assistant_action_approvals") throw new Error(`Unexpected table: ${table}`);
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: approvalRow(), error: null }) }),
          }),
          update: () => ({
            eq: () => ({
              is: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
            }),
          }),
        };
      },
    };

    await expect(plannerVerify(serviceSupabase)).rejects.toThrow("already consumed");
  });

  it("serializes concurrent consumers of the same approval — exactly one wins", async () => {
    const store = makeApprovalStore();

    const outcomes = await Promise.allSettled([plannerVerify(store), plannerVerify(store)]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser is rejected by single-use enforcement, never allowed to double-spend.
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: expect.stringMatching(/already consumed|invalid or expired/),
    });
    expect(store.consumedAt).not.toBeNull();
  });

  it("fails closed when an approval-required Planner Agent mutation has no approval id", async () => {
    await expect(
      verifyAssistantActionApproval({
        request: plannerRequest({
          "x-openplan-assistant-execution-source": ASSISTANT_ACTION_EXECUTION_SOURCE,
          "x-openplan-assistant-input-hash": hashAssistantActionPayload(APPROVED_ACTION),
        }),
        serviceSupabase: { from: vi.fn() },
        userId: "user-1",
        workspaceId: "workspace-1",
        action: APPROVED_ACTION,
      })
    ).rejects.toThrow("approval evidence is missing");
  });

  it("does not require approval evidence for review-only quick links and records the server-computed hash, ignoring the client header", async () => {
    const action = {
      kind: "create_rtp_packet_record",
      rtpCycleId: "rtp-cycle-1",
    } as const;
    const result = await verifyAssistantActionApproval({
      request: plannerRequest({
        "x-openplan-assistant-execution-source": ASSISTANT_ACTION_EXECUTION_SOURCE,
        "x-openplan-assistant-input-hash": "client-side-spoofed-hash",
      }),
      serviceSupabase: { from: vi.fn() },
      userId: "user-1",
      workspaceId: "workspace-1",
      action,
    });

    expect(result).toEqual({
      approvalId: null,
      inputHash: hashAssistantActionPayload(action),
      executionSource: "planner_agent_quick_link",
      // No approval was required at this tier, so nobody consented — but the
      // agent still authored it, and the ledger has to be able to say so.
      authorship: {
        actorKind: "planner_agent",
        actorAgentId: "openplan.planner_agent",
        approvedByUserId: null,
        approvedAt: null,
      },
    });
  });
});
