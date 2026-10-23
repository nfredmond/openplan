import { describe, expect, it, vi } from "vitest";
import { CHAT_PROJECTION, canonicalChat } from "@/lib/assistant/provider-chat-task";
import { prepareChatProjection, type ChatSession } from "@/lib/assistant/provider-chat-projection";
import { invokeReservedChatTool, retainChatToolReservation } from "@/lib/assistant/chat-tools";
import { chatFixture, chatIds as id } from "./fixtures/provider-chat-fixture";
function sessionFixture(options: { missing?: boolean; unavailable?: boolean; index?: boolean } = {}) {
 const queries: Array<{ table: string; select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; order: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn> }> = [];
 const from = vi.fn((table: string) => {
  const q = { table, select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() };
  for (const key of ["select", "eq", "order", "limit"] as const) q[key].mockReturnValue(q);
  const output = () => {
   let data: unknown = table === "workspace_members" ? { workspace_id: id.workspace, user_id: id.user, role: "owner" } : table === "workspaces" ? { id: id.workspace, name: "Synthetic workspace" } : null;
   if (table === "projects" && !options.missing) {
    const columns = q.select.mock.calls[0][0];
    data = columns === CHAT_PROJECTION.reference ? { id: id.project, workspace_id: id.workspace } : { id: id.project, workspace_id: id.workspace, name: "Synthetic project", status: "active", delivery_phase: "planning", updated_at: null,
     ...(columns === CHAT_PROJECTION.project ? { summary: "Synthetic permitted summary", plan_type: "other" } : {}) };
    if (options.index) data = [data];
   }
   return { data, error: options.unavailable ? { message: "Synthetic query failure" } : null };
  };
  q.maybeSingle.mockImplementation(async () => output()); q.then.mockImplementation((resolve, reject) => Promise.resolve(output()).then(resolve, reject));
  queries.push(q); return q;
 });
 return { queries, from, session: { from, auth: { getUser: async () => ({ data: { user: { id: id.user } }, error: null }) } } as unknown as ChatSession };
}
describe("closed session projection and reserved tools", () => {
 it("reads only literal permitted columns and both equalities, with complete anchors", async () => {
  const f = sessionFixture(), grant = chatFixture();
  const envelopes = await prepareChatProjection(f.session, id.user, { target: grant.scope.target, selectedProjectIds: grant.scope.selectedProjectIds, includeWorkspaceIndex: false }, id.turn);
  expect(f.from.mock.calls.map(c => c[0])).toEqual(["workspace_members", "workspaces", "projects"]);
  expect(f.queries[0].select).toHaveBeenCalledWith("workspace_id, user_id, role");
  expect(f.queries[1].select).toHaveBeenCalledWith("id, name");
  expect(f.queries[2].select).toHaveBeenCalledWith("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at");
  expect(f.queries[2].eq.mock.calls).toEqual([["id", id.project], ["workspace_id", id.workspace]]);
  expect(JSON.parse(envelopes[1].canonicalProjectedContent)).toEqual({ id: id.project, name: "Synthetic project", summary: "Synthetic permitted summary", status: "active", planType: "other", deliveryPhase: "planning", updatedAt: null, href: `/projects/${id.project}` });
  expect(envelopes[1].accessAnchors.map(a => [a.kind, a.primaryKey, a.workspaceId])).toEqual([["membership", `${id.workspace}:${id.user}`, id.workspace], ["workspace", id.workspace, id.workspace], ["project", id.project, id.workspace]]);
 });
 it("requires separate index consent and records every row anchor without selecting it", async () => {
  const f = sessionFixture({ index: true }), grant = chatFixture(true), scope = { target: grant.scope.target, selectedProjectIds: [], includeWorkspaceIndex: true };
  // A workspace may list an index without selecting any of its project rows.
  scope.target = { kind: "workspace", id: null, workspaceId: id.workspace };
  const [result] = await prepareChatProjection(f.session, id.user, scope, id.turn, id.step, "index");
  const q = f.queries[2]; expect(q.select).toHaveBeenCalledWith(CHAT_PROJECTION.index);
  expect(q.order.mock.calls).toEqual([["updated_at", { ascending: false }], ["id", { ascending: true }]]); expect(q.limit).toHaveBeenCalledWith(25);
  expect(result.queryDependency?.returnedProjectIds).toEqual([id.project]); expect(scope.selectedProjectIds).toEqual([]);
  await expect(prepareChatProjection(f.session, id.user, { ...scope, includeWorkspaceIndex: false }, id.turn, id.step, "index")).rejects.toThrow("chat_index_not_accepted");
 });
 it("distinguishes missing access and query failure from empty data", async () => {
  const grant = chatFixture(), scope = { target: grant.scope.target, selectedProjectIds: grant.scope.selectedProjectIds, includeWorkspaceIndex: false };
  await expect(prepareChatProjection(sessionFixture({ missing: true }).session, id.user, scope, id.turn)).rejects.toMatchObject({ state: "access_lost" });
  await expect(prepareChatProjection(sessionFixture({ unavailable: true }).session, id.user, scope, id.turn)).rejects.toMatchObject({ state: "unavailable" });
 });
 it("executes a counted twelfth tool once without hydrating or incrementing the old guard", async () => {
  const f = sessionFixture(), grant = chatFixture();
  const claim = retainChatToolReservation({ released: true, cached: false, handle: id.handle, callId: id.call, stepId: id.step, toolCallId: "call_12", name: "propose_create_project_record",
   input: { projectId: id.project, title: "  Synthetic draft  ", submittalType: "other", notes: "" }, usedCalls: 12 });
  const completed = await invokeReservedChatTool({ session: f.session, userId: id.user, grant, reservation: claim });
  expect(completed.result).toMatchObject({ status: "proposed" });
  expect("executableCanonical" in completed && JSON.parse(completed.executableCanonical!)).toEqual({ kind: "create_project_record", recordType: "submittal", projectId: id.project, title: "Synthetic draft" });
  expect(f.queries[0].select).toHaveBeenCalledWith("id, workspace_id"); expect(f.queries[0].eq.mock.calls).toEqual([["id", id.project], ["workspace_id", id.workspace]]);
  await expect(invokeReservedChatTool({ session: f.session, userId: id.user, grant, reservation: claim })).rejects.toThrow("chat_tool_reservation_invalid");
  expect(() => retainChatToolReservation({ ...claim, usedCalls: 13 })).toThrow();
  expect(canonicalChat(completed.envelopes)).toBe("[]");
 });
});
