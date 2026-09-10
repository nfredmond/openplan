import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ASSISTANT_ACTION_EXECUTION_SOURCE,
  hashAssistantActionPayload,
  verifyAssistantActionApproval,
} from "@/lib/assistant/action-approval-server";

const ACTIONS = [
  { kind: "generate_report_artifact", reportId: "report-1" },
  { kind: "create_rtp_packet_record", rtpCycleId: "cycle-1" },
] as const;
const approvedAt = "2026-09-10T08:00:00.000Z";

function fixture(action: (typeof ACTIONS)[number], overrides: Record<string, unknown> = {}) {
  const row = {
    id: "approval-1", workspace_id: "workspace-1", user_id: "user-1",
    action_kind: action.kind, input_hash: hashAssistantActionPayload(action),
    expires_at: new Date(Date.now() + 60_000).toISOString(), consumed_at: null,
    created_at: approvedAt, ...overrides,
  };
  const consumeSelect = vi.fn().mockResolvedValue({ data: [{ id: row.id }], error: null });
  const consumeIs = vi.fn(() => ({ select: consumeSelect }));
  const consumeEq = vi.fn(() => ({ is: consumeIs }));
  const update = vi.fn(() => ({ eq: consumeEq }));
  const readEq = vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }));
  const select = vi.fn(() => ({ eq: readEq }));
  const from = vi.fn(() => ({ select, update }));
  function verify(extraHeaders: Record<string, string> = {}, withApproval = true) {
    return verifyAssistantActionApproval({
      request: new NextRequest("http://localhost/api/probe", { method: "POST", headers: {
        "x-openplan-assistant-execution-source": ASSISTANT_ACTION_EXECUTION_SOURCE,
        "x-openplan-assistant-input-hash": hashAssistantActionPayload(action),
        ...(withApproval ? { "x-openplan-assistant-approval-id": row.id } : {}),
        ...extraHeaders,
      } }), serviceSupabase: { from }, userId: "user-1", workspaceId: "workspace-1", action,
    });
  }
  return { verify, from, select, readEq, update, consumeEq, consumeIs, consumeSelect };
}

for (const action of ACTIONS) {
  describe(`optional consent for ${action.kind}`, () => {
    it("retains verified consent and consumes exactly the supplied approval", async () => {
      const f = fixture(action);
      const result = await f.verify();
      expect(result).toMatchObject({ approvalId: "approval-1", inputHash: hashAssistantActionPayload(action), authorship: {
        actorKind: "planner_agent", approvedByUserId: "user-1", approvedAt,
      } });
      expect(f.from).toHaveBeenCalledWith("assistant_action_approvals");
      expect(f.select).toHaveBeenCalledWith("id, workspace_id, user_id, action_kind, input_hash, expires_at, consumed_at, created_at");
      expect(f.readEq).toHaveBeenCalledWith("id", "approval-1");
      expect(f.update).toHaveBeenCalledOnce();
      expect(f.consumeEq).toHaveBeenCalledWith("id", "approval-1");
      expect(f.consumeIs).toHaveBeenCalledWith("consumed_at", null);
      expect(f.consumeSelect).toHaveBeenCalledWith("id");
    });

    it("permits the existing no-approval path without recording consent", async () => {
      const f = fixture(action);
      expect(await f.verify({ "x-openplan-assistant-input-hash": "untrusted-header" }, false)).toMatchObject({
        approvalId: null, inputHash: hashAssistantActionPayload(action),
        authorship: { approvedByUserId: null, approvedAt: null },
      });
      expect(f.from).not.toHaveBeenCalled();
    });

    it("rejects a supplied approval with a changed header hash before reading consent", async () => {
      const f = fixture(action);
      await expect(f.verify({ "x-openplan-assistant-input-hash": "changed" })).rejects.toThrow("hash mismatch");
      expect(f.from).not.toHaveBeenCalled();
    });

    it.each([
      ["another user", { user_id: "user-2" }],
      ["another workspace", { workspace_id: "workspace-2" }],
      ["another action", { action_kind: "create_funding_opportunity" }],
      ["changed payload", { input_hash: "changed" }],
      ["expired", { expires_at: "2000-01-01T00:00:00.000Z" }],
      ["consumed", { consumed_at: approvedAt }],
    ])("rejects %s evidence without consuming it", async (_label, overrides) => {
      const f = fixture(action, overrides);
      await expect(f.verify()).rejects.toThrow("invalid or expired");
      expect(f.update).not.toHaveBeenCalled();
    });

    it("rejects an approval lost to a concurrent consumer", async () => {
      const f = fixture(action);
      f.consumeSelect.mockResolvedValueOnce({ data: [], error: null });
      await expect(f.verify()).rejects.toThrow("already consumed");
    });
  });
}
