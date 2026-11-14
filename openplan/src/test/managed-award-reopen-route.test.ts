// Prepared, UNEXECUTED. Real route/helper with mocked access and RPC transport.
// Native SQL fixtures separately cover persisted state, permissions and receipt history.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { handoffId as id } from "./fixtures/grants/award-handoff";
import { CLOSEABLE_FUNDING_AWARD_COLUMNS } from "@/app/api/funding-awards/[awardId]/award-closure";

const mock = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), access: vi.fn(), rpc: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn(), from: vi.fn(), update: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.client, createServiceRoleClient: mock.service }));
vi.mock("@/lib/programs/api", () => ({ loadProjectAccess: mock.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/assistant/action-approval-server", () => ({ readAssistantExecutionSource: (request: NextRequest) => request.headers.get("x-openplan-assistant-execution-source") === "planner_agent_quick_link" ? "planner_agent_quick_link" : "manual" }));
import { PATCH } from "@/app/api/funding-awards/[awardId]/route";
import { POST } from "@/app/api/funding-awards/[awardId]/closeout/route";

const award = { id: id(1), project_id: id(2), workspace_id: id(3), latest_handoff_revision_id: id(4), current_handoff_revision_id: id(4), currency_code: "USD", awarded_amount: "100.01", spending_status: "fully_spent", closure_basis: "earned_coverage" };
const context = { params: Promise.resolve({ awardId: id(1) }) };
const reason = "Source amendment requires reopening";
const body = (spendingStatus: unknown) => ({ expectedCurrentRevisionId: id(4), reopen: { reason, spendingStatus } });
const request = (payload: unknown, agent = false, method = "PATCH") => new NextRequest(`http://localhost/api/funding-awards/${id(1)}`, { method, headers: { "content-type": "application/json", ...(agent ? { "x-openplan-assistant-execution-source": "planner_agent_quick_link" } : {}) }, body: JSON.stringify(payload) });

beforeEach(() => {
  vi.clearAllMocks();
  mock.single.mockResolvedValue({ data: award, error: null });
  mock.eq.mockReturnValue({ maybeSingle: mock.single });
  mock.select.mockReturnValue({ eq: mock.eq });
  mock.from.mockReturnValue({ select: mock.select, update: mock.update });
  mock.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: id(5) } } }) }, from: mock.from });
  mock.access.mockResolvedValue({ project: { id: id(2), workspace_id: id(3) }, membership: { role: "member" }, allowed: true, error: null });
  mock.service.mockReturnValue({ rpc: mock.rpc });
  mock.rpc.mockResolvedValue({ data: { status: "reopened" }, error: null });
});

describe("managed award reopen destination", () => {
  it.each(["delayed", "not_started", "active"])("carries the planner's %s selection through PATCH and helper", async (spendingStatus) => {
    const receipt = { awardId: id(1), revisionId: id(4), status: "reopened", spendingStatus };
    mock.rpc.mockResolvedValue({ data: receipt, error: null });
    const response = await PATCH(request(body(spendingStatus)), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(receipt);
    expect(mock.from).toHaveBeenCalledExactlyOnceWith("funding_awards");
    expect(mock.select).toHaveBeenCalledExactlyOnceWith(CLOSEABLE_FUNDING_AWARD_COLUMNS);
    expect(CLOSEABLE_FUNDING_AWARD_COLUMNS.split(", ")).toEqual(expect.arrayContaining(["id", "project_id", "workspace_id", "latest_handoff_revision_id", "current_handoff_revision_id", "spending_status", "closure_basis"]));
    expect(mock.eq).toHaveBeenCalledExactlyOnceWith("id", id(1));
    expect(mock.access).toHaveBeenCalledWith(expect.anything(), id(2), id(5), "programs.write");
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("managed_award_closeout", { p_actor: id(5), p_award: id(1), p_expected: id(4), p_event: "reopen", p_note: reason, p_reopen_spending_status: spendingStatus });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it.each(["fully_spent", "unknown", "", null, undefined])("refuses invalid or omitted explicit route destination %j before dispatch", async (spendingStatus) => {
    expect((await PATCH(request(body(spendingStatus)), context)).status).toBe(400);
    expect(mock.client).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("retains agent, denied-member, field-edit and conflicting-intent refusals", async () => {
    expect((await PATCH(request(body("delayed"), true), context)).status).toBe(403);
    expect((await PATCH(request({ ...body("delayed"), title: "Unreviewed edit" }), context)).status).toBe(422);
    expect((await PATCH(request({ ...body("delayed"), spendingStatus: "active" }), context)).status).toBe(400);
    mock.access.mockResolvedValue({ project: { id: id(2) }, membership: { role: "viewer" }, allowed: false, error: null });
    expect((await PATCH(request(body("delayed")), context)).status).toBe(403);
    expect(mock.service).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("keeps both earned-closeout routes on the same RPC without a reopen target", async () => {
    mock.rpc.mockResolvedValue({ data: { status: "closed" }, error: null });
    expect((await PATCH(request({ expectedCurrentRevisionId: id(4), spendingStatus: "fully_spent", closeoutNote: "Coverage reviewed" }), context)).status).toBe(200);
    expect((await POST(request({ expectedCurrentRevisionId: id(4), notes: "Coverage reviewed" }, false, "POST"), context)).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    for (const call of mock.rpc.mock.calls) expect(call).toEqual(["managed_award_closeout", { p_actor: id(5), p_award: id(1), p_expected: id(4), p_event: "earned_coverage", p_note: "Coverage reviewed", p_reopen_spending_status: null }]);
    expect(mock.update).not.toHaveBeenCalled();
  });
});
