import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/actions/approvals/route";
import { hashAssistantActionPayload } from "@/lib/assistant/action-approval-server";
import { executableProjectSubmittalAction } from "@/lib/assistant/project-submittal-receipt";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { chatIds as id } from "./fixtures/provider-chat-fixture";
const f = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), rpc: vi.fn(), role: "owner", queries: [] as Array<{ table: string; select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> }> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: f.client, createServiceRoleClient: f.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
const action = { kind: "create_project_record" as const, projectId: id.project, recordType: "submittal" as const, title: "Synthetic draft", submittalType: "other" as const, status: "draft" as const };
function request(changes: Record<string, unknown> = {}) {
 return new NextRequest("https://app.fixture.invalid/api/assistant/actions/approvals", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.fixture.invalid" },
  body: JSON.stringify({ workspaceId: id.workspace, action, requireApproval: true, chatBinding: { intentId: id.call, approvalRequestId: id.request, expectedExecutableHash: hashAssistantActionPayload(action), expectedGrantDigest: "a".repeat(64) }, ...changes }) });
}
beforeEach(() => {
 vi.clearAllMocks(); f.role = "owner"; f.queries.length = 0;
 f.rpc.mockResolvedValue({ data: { approvalId: id.accept, inputHash: hashAssistantActionPayload(action), expiresAt: "2099-01-01T00:00:00Z", replayed: true }, error: null });
 f.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: id.user } }, error: null }) }, rpc: f.rpc,
  from: (table: string) => { const q = { table, select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }; q.select.mockReturnValue(q); q.eq.mockReturnValue(q);
   q.maybeSingle.mockResolvedValue({ data: table === "workspace_members" ? { workspace_id: id.workspace, role: f.role } : { id: id.project, workspace_id: id.workspace, name: "Synthetic project" }, error: null }); f.queries.push(q); return q; } });
});
describe("chat binding in the normal human approval endpoint", () => {
 it("returns the original atomic association and never uses standalone service insertion", async () => {
  const response = await POST(request()); expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ approvalId: id.accept, replayed: true });
  expect(f.service).not.toHaveBeenCalled(); expect(f.rpc).toHaveBeenCalledOnce();
  expect(f.rpc.mock.calls[0][0]).toBe("assistant_chat_intent");
  expect(f.rpc.mock.calls[0][1]).toMatchObject({ p_operation: "issue", p_intent_id: id.call, p_payload: { canonicalPayload: expect.any(String) } });
  expect(JSON.parse(f.rpc.mock.calls[0][1].p_payload.canonicalPayload)).toMatchObject({ expectedExecutableHash: hashAssistantActionPayload(action), expectedGrantDigest: "a".repeat(64), executableCanonical: canonicalizeActionPayload(executableProjectSubmittalAction(action)), executionContext: { action: executableProjectSubmittalAction(action), project: { id: id.project, workspaceId: id.workspace, name: "Synthetic project" } } });
  expect(f.queries[1].select).toHaveBeenCalledWith("id, workspace_id, name"); expect(f.queries[1].eq.mock.calls).toEqual([["id", id.project], ["workspace_id", id.workspace]]);
 });
 it("requires the complete human sheet and current write role", async () => {
  expect((await POST(request({ requireApproval: false }))).status).toBe(403); expect(f.rpc).not.toHaveBeenCalled();
  f.role = "viewer"; expect((await POST(request())).status).toBe(403); expect(f.rpc).not.toHaveBeenCalled(); expect(f.service).not.toHaveBeenCalled();
 });
 it("preserves the existing non-chat approval path", async () => {
  const insert = vi.fn(async () => ({ error: null })); f.service.mockReturnValue({ from: () => ({ insert }) });
  expect((await POST(request({ chatBinding: undefined }))).status).toBe(201); expect(insert).toHaveBeenCalledOnce(); expect(f.rpc).not.toHaveBeenCalled();
 });
});
