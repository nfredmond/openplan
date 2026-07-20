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

function approvalRow(overrides: Partial<{ consumed_at: string | null; expires_at: string }> = {}) {
  return {
    id: "approval-1",
    workspace_id: "workspace-1",
    user_id: "user-1",
    action_kind: "create_funding_opportunity",
    input_hash: hashAssistantActionPayload(APPROVED_ACTION),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed_at: null as string | null,
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
    });
  });
});
