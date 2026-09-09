import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { packetFixture } from "./helpers/owp-reimbursement-fixture";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), service: vi.fn(), source: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/programs/work-program/server", () => ({ authorizeWorkProgram: mocks.authorize }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/assistant/action-approval-server", () => ({ readAssistantExecutionSource: mocks.source }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));
import { GET, POST } from "@/app/api/programs/[programId]/work-program/reimbursement/route";
const programId = randomUUID(), workspace = randomUUID(), actor = randomUUID();
const context = { params: Promise.resolve({ programId }) };
const request = (body?: unknown) => new NextRequest("http://localhost/api/example", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
describe("private reimbursement HTTP boundary", () => {
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
 it("reads scoped finance history with every field needed for correction and export", async () => {
  const calls = access(); const response = await GET(request(), context);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).reports).toEqual([{ snapshot: { reimbursement: { title: "Retained packet" } } }]);
  expect(calls).toEqual([
   { table: "workspace_members", columns: "role", filters: [["workspace_id", workspace], ["user_id", actor]] },
   { table: "work_program_reimbursement_claims", columns: "id, version, state, draft, current_report_id", filters: [["program_id", programId]] },
   { table: "work_program_reimbursement_events", columns: "id, claim_id, sequence, kind, report_id, note, actor_id, created_at", filters: [["program_id", programId]] },
   { table: "work_program_period_reports", columns: "id, period_id, version, snapshot, snapshot_hash, issued_at, corrects_report_id", filters: [["program_id", programId]] },
  ]);
 });
 it("refuses agent execution and malformed evidence, then passes the exact actor and command and preserves conflicts", async () => {
  access(); const command = { kind: "save", requestId: randomUUID(), claimId: randomUUID(), expectedVersion: 0, draft: packetFixture().draft };
  mocks.service.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: { version: 1 }, error: null }) });
  mocks.source.mockReturnValue("planner_agent"); expect((await POST(request(command), context)).status).toBe(403);
  mocks.source.mockReturnValue("manual"); expect((await POST(request({ ...command, draft: { ...command.draft, formEvidence: "" } }), context)).status).toBe(400);
  expect(mocks.service).not.toHaveBeenCalled();
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "PT409", message: "Packet changed" } }); mocks.service.mockReturnValue({ rpc });
  expect((await POST(request(command), context)).status).toBe(409);
  expect(rpc).toHaveBeenCalledWith("work_program_reimbursement_command", { p_program_id: programId, p_actor_id: actor, p_command: command });
 });
});
