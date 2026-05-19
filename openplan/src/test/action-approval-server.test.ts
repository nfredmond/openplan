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

describe("verifyAssistantActionApproval", () => {
  it("requires and consumes one-use approval evidence for approval-required Planner Agent mutations", async () => {
    const action = {
      kind: "create_funding_opportunity" as const,
      projectId: "project-1",
      title: "ATP Cycle 8",
    };
    const inputHash = hashAssistantActionPayload(action);
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: "approval-1",
        workspace_id: "workspace-1",
        user_id: "user-1",
        action_kind: "create_funding_opportunity",
        input_hash: inputHash,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        consumed_at: null,
      },
      error: null,
    });
    const consumeMock = vi.fn().mockResolvedValue({ error: null });
    const serviceSupabase = {
      from: vi.fn((table: string) => {
        if (table !== "assistant_action_approvals") throw new Error(`Unexpected table: ${table}`);
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: maybeSingleMock })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({ is: consumeMock })),
          })),
        };
      }),
    };

    const result = await verifyAssistantActionApproval({
      request: plannerRequest({
        "x-openplan-assistant-execution-source": ASSISTANT_ACTION_EXECUTION_SOURCE,
        "x-openplan-assistant-input-hash": inputHash,
        "x-openplan-assistant-approval-id": "approval-1",
      }),
      serviceSupabase,
      userId: "user-1",
      workspaceId: "workspace-1",
      action,
    });

    expect(result).toEqual({
      approvalId: "approval-1",
      inputHash,
      executionSource: "planner_agent_quick_link",
    });
    expect(consumeMock).toHaveBeenCalledWith("consumed_at", null);
  });

  it("fails closed when an approval-required Planner Agent mutation has no approval id", async () => {
    const action = {
      kind: "create_funding_opportunity" as const,
      projectId: "project-1",
      title: "ATP Cycle 8",
    };

    await expect(
      verifyAssistantActionApproval({
        request: plannerRequest({
          "x-openplan-assistant-execution-source": ASSISTANT_ACTION_EXECUTION_SOURCE,
          "x-openplan-assistant-input-hash": hashAssistantActionPayload(action),
        }),
        serviceSupabase: { from: vi.fn() },
        userId: "user-1",
        workspaceId: "workspace-1",
        action,
      })
    ).rejects.toThrow("approval evidence is missing");
  });

  it("does not require approval evidence for review-only quick links while preserving the client input hash", async () => {
    const result = await verifyAssistantActionApproval({
      request: plannerRequest({
        "x-openplan-assistant-execution-source": ASSISTANT_ACTION_EXECUTION_SOURCE,
        "x-openplan-assistant-input-hash": "client-side-review-hash",
      }),
      serviceSupabase: { from: vi.fn() },
      userId: "user-1",
      workspaceId: "workspace-1",
      action: {
        kind: "create_rtp_packet_record",
        rtpCycleId: "rtp-cycle-1",
      },
    });

    expect(result).toEqual({
      approvalId: null,
      inputHash: "client-side-review-hash",
      executionSource: "planner_agent_quick_link",
    });
  });
});
