import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), service: vi.fn(), source: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/programs/work-program/server", () => ({ authorizeWorkProgram: mocks.authorize }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/assistant/action-approval-server", () => ({ readAssistantExecutionSource: mocks.source }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));
import { GET, POST } from "@/app/api/programs/[programId]/work-program/closeout/route";
const reportId = randomUUID();
const programId = randomUUID(), workspace = randomUUID(), actor = randomUUID();
const context = { params: Promise.resolve({ programId }) };
const request = (body?: unknown) => new NextRequest(`http://localhost/api/example?reportId=${reportId}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
describe("private closeout HTTP boundary", () => {
 beforeEach(() => { vi.clearAllMocks(); mocks.source.mockReturnValue("manual"); });
 function access(role = "owner", failure = false) {
  const calls: { table: string; columns: string; filters: [string, unknown][] }[] = [];
  const client = { from: (table: string) => {
   const call = { table, columns: "", filters: [] as [string, unknown][] }; calls.push(call);
   const data = table === "workspace_members" ? { role } : table === "work_program_period_reports" ? [{ snapshot: {} }, { snapshot: { reimbursement: { title: "Retained packet" } } }] : [];
   const result = { data, error: failure ? { message: "Synthetic query failure" } : null };
   const query = { select: (columns: string) => { call.columns = columns; return query; }, eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; }, order: () => query, range: () => query, single: async () => result, then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
   return query;
  } };
  mocks.authorize.mockResolvedValue({ supabase: client, user: { id: actor }, program: { workspace_id: workspace } });
  return calls;
 }
 it("returns authentication and finance-role failures without calling the privileged writer", async () => {
  for (const handler of [GET, POST]) {
   const refusal = NextResponse.json({ error: "Synthetic refusal" }, { status: 401 });
   mocks.authorize.mockResolvedValueOnce({ response: refusal });
   expect(await handler(request(), context)).toBe(refusal);
   access("member"); expect((await handler(request(), context)).status).toBe(403);
   access("owner", true); expect((await handler(request(), context)).status).toBe(503);
  }
  expect(mocks.service).not.toHaveBeenCalled();
 });
 it("uses authenticated scope, private caching and exact read arguments", async () => {
  const calls = access(); const rpc = vi.fn().mockResolvedValue({ data: { records: [] }, error: null }); mocks.service.mockReturnValue({ rpc });
  const response = await GET(request(), context);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ records: [] });
  expect(calls).toEqual([{ table: "workspace_members", columns: "role", filters: [["workspace_id", workspace], ["user_id", actor]] }]);
  expect(rpc).toHaveBeenCalledWith("read_work_program_closeout", { p_program_id: programId, p_actor_id: actor, p_report_id: reportId });
  expect((await GET(new NextRequest("http://localhost/api/example?reportId=bad"), context)).status).toBe(400);
 });
 it("refuses unregistered agent writes and malformed approval, preserving actor, command and conflicts", async () => {
  access(); const command = { kind: "approve", requestId: randomUUID(), reportId, expectedVersion: 1, sourceHash: "a".repeat(64), note: "Synthetic approval" };
  mocks.source.mockReturnValue("planner_agent"); expect((await POST(request(command), context)).status).toBe(403);
  mocks.source.mockReturnValue("manual"); expect((await POST(request({ ...command, note: "" }), context)).status).toBe(400);
  expect(mocks.service).not.toHaveBeenCalled();
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "PT409", message: "Closeout sources changed" } }); mocks.service.mockReturnValue({ rpc });
  expect((await POST(request(command), context)).status).toBe(409);
  expect(rpc).toHaveBeenCalledWith("work_program_closeout_command", { p_program_id: programId, p_actor_id: actor, p_command: command });
  rpc.mockResolvedValue({ data: { version: 2 }, error: null });
  const response = await POST(request(command), context); expect(response.status).toBe(200); expect(await response.json()).toEqual({ version: 2 });
 });
});
