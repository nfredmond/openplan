import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";

const h = vi.hoisted(() => ({ client: null as unknown, service: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client, createServiceRoleClient: () => h.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock("@/lib/programs/api", () => ({
  loadProjectAccess: async () => ({ project: { id: "44444444-4444-4444-8444-444444444444", workspace_id: "33333333-3333-4333-8333-333333333333" }, membership: { role: "admin" }, allowed: true }),
  loadFundingOpportunityAccess: async () => ({ opportunity: { id: "55555555-5555-4555-8555-555555555555", workspace_id: "33333333-3333-4333-8333-333333333333" }, membership: { role: "admin" }, allowed: true }),
}));
import { PATCH as profile } from "@/app/api/projects/[projectId]/funding-profile/route";
import { POST as createOpportunity } from "@/app/api/funding-opportunities/route";
import { PATCH as decision } from "@/app/api/funding-opportunities/[opportunityId]/route";
import { PATCH as invoice } from "@/app/api/invoicing/invoices/[invoiceId]/route";
import { hashAssistantActionPayload } from "@/lib/assistant/action-approval-server";
import { executeAction } from "@/lib/runtime/action-registry";

const projectId = "44444444-4444-4444-8444-444444444444", workspaceId = "33333333-3333-4333-8333-333333333333";
const opportunityId = "55555555-5555-4555-8555-555555555555", invoiceId = "66666666-6666-4666-8666-666666666666";
const fundingAwardId = "77777777-7777-4777-8777-777777777777", userId = "22222222-2222-4222-8222-222222222222", approvalId = "11111111-1111-4111-8111-111111111111";
const actions = {
  profile: { kind: "create_project_funding_profile", projectId, notes: "Approved note" },
  opportunity: { kind: "create_funding_opportunity", projectId, title: "Synthetic opportunity" },
  decision: { kind: "update_funding_opportunity_decision", opportunityId, decisionState: "pursue" },
  invoice: { kind: "link_billing_invoice_funding_award", workspaceId, invoiceId, fundingAwardId },
} satisfies Record<string, AssistantQuickLinkExecuteAction>;
type Lane = keyof typeof actions;
const bodies = {
  profile: { notes: "Approved note" }, opportunity: { projectId, title: "Synthetic opportunity" },
  decision: { decisionState: "pursue" }, invoice: { workspaceId, fundingAwardId },
};
function fixture(action: AssistantQuickLinkExecuteAction, existingProfile = false) {
  let consumed = false;
  const writes: { table: string; operation: string; value: Record<string, unknown> }[] = [];
  const audits: Record<string, unknown>[] = [];
  const selects: { table: string; columns: string }[] = [];
  const inputHash = hashAssistantActionPayload(action);
  h.service = { from(table: string) {
    if (table === "assistant_action_executions") return { insert: async (value: Record<string, unknown>) => { audits.push(value); return { error: null }; } };
    if (table !== "assistant_action_approvals") throw new Error(table);
    return {
      select: (columns: string) => { selects.push({ table, columns }); return { eq: () => ({ maybeSingle: async () => ({ data: { id: approvalId, workspace_id: workspaceId, user_id: userId, action_kind: action.kind, input_hash: inputHash, expires_at: new Date(Date.now() + 300000).toISOString(), consumed_at: consumed ? new Date().toISOString() : null, created_at: new Date().toISOString() }, error: null }) }) }; },
      update: () => ({ eq: () => ({ is: () => ({ select: async () => { const data = consumed ? [] : [{ id: approvalId }]; consumed = true; return { data, error: null }; } }) }) }),
    };
  } };
  h.client = { auth: { getUser: async () => ({ data: { user: { id: userId } } }) }, from(table: string) {
    let write: { table: string; operation: string; value: Record<string, unknown> } | undefined;
    const read = () => {
      if (write) {
        if (table === "project_funding_profiles" && write.operation === "insert" && existingProfile) return { data: null, error: { code: "23505", message: "synthetic unique project conflict" } };
        return { data: { id: "saved", ...write.value }, error: null };
      }
      const data = table === "workspace_members" ? { workspace_id: workspaceId, role: "admin" }
        : table === "projects" ? { id: projectId, workspace_id: workspaceId, name: "Synthetic project" }
        : table === "billing_invoice_records" ? { id: invoiceId, workspace_id: workspaceId, project_id: projectId, funding_award_id: null }
        : table === "funding_awards" ? { id: fundingAwardId, workspace_id: workspaceId, project_id: projectId } : null;
      if (!data) throw new Error(`Unexpected read: ${table}`);
      return { data, error: null };
    };
    const mutate = (operation: string, value: Record<string, unknown>) => { write = { table, operation, value }; writes.push(write); return q; };
    const q = {
      select: (columns: string) => { selects.push({ table, columns }); return q; }, eq: () => q,
      insert: (value: Record<string, unknown>) => mutate("insert", value), upsert: (value: Record<string, unknown>) => mutate("upsert", value), update: (value: Record<string, unknown>) => mutate("update", value),
      single: async () => read(), maybeSingle: async () => read(),
    };
    return q;
  } };
  return { writes, audits, selects, inputHash, get consumed() { return consumed; } };
}
function route(lane: Lane, request: NextRequest) {
  if (lane === "profile") return profile(request, { params: Promise.resolve({ projectId }) });
  if (lane === "opportunity") return createOpportunity(request);
  if (lane === "decision") return decision(request, { params: Promise.resolve({ opportunityId }) });
  return invoice(request, { params: Promise.resolve({ invoiceId }) });
}
function request(body: unknown, inputHash: string, manual = false) {
  return new NextRequest("http://localhost/api/synthetic", { method: "PATCH", headers: {
    "content-type": "application/json", ...(manual ? {} : {
      "x-openplan-assistant-execution-source": "planner_agent_quick_link", "x-openplan-assistant-input-hash": inputHash, "x-openplan-assistant-approval-id": approvalId,
    }),
  }, body: JSON.stringify(body) });
}
afterEach(() => vi.unstubAllGlobals());

describe("financial routes bind the complete agent write to the registered action", () => {
  it.each(Object.keys(actions) as Lane[])("executes the real %s registry body through the real route and verifier", async lane => {
    const f = fixture(actions[lane]);
    vi.stubGlobal("fetch", async (_url: string, init: ConstructorParameters<typeof NextRequest>[1]) => route(lane, new NextRequest("http://localhost/api/synthetic", init)));
    await executeAction(actions[lane], { onCompleted() {} }, { approvalEvidence: { approvalId, inputHash: f.inputHash, executionSource: "planner_agent_quick_link" } });
    expect(f.consumed).toBe(true); expect(f.writes).toHaveLength(1);
    expect(f.audits).toMatchObject([{ actor_kind: "planner_agent", outcome: "succeeded", approval_id: approvalId }]);
    expect(f.selects.find(s => s.table === "assistant_action_approvals")?.columns).toBe("id, workspace_id, user_id, action_kind, input_hash, expires_at, consumed_at, created_at");
    if (lane === "profile") expect(f.writes[0]).toMatchObject({ operation: "insert", value: { notes: "Approved note", funding_need_amount: null, local_match_need_amount: null } });
    if (lane === "invoice") expect(f.writes[0].value).toEqual({ project_id: projectId, funding_award_id: fundingAwardId, status: undefined });
    if (lane === "decision") expect(Object.keys(f.writes[0].value).sort()).toEqual(["decided_at", "decision_state"]);
    if (lane === "opportunity") expect(f.writes[0].value).toMatchObject({ opportunity_status: "upcoming", decision_state: "monitor", expected_award_amount: null });
  });
  it("executes a profile action without inventing unsigned fallback notes", async () => {
    const action = { kind: "create_project_funding_profile" as const, projectId };
    const f = fixture(action);
    vi.stubGlobal("fetch", async (_url: string, init: ConstructorParameters<typeof NextRequest>[1]) => {
      expect(JSON.parse(String(init?.body))).toEqual({});
      return route("profile", new NextRequest("http://localhost/api/synthetic", init));
    });
    await executeAction(action, { onCompleted() {} }, { approvalEvidence: { approvalId, inputHash: f.inputHash, executionSource: "planner_agent_quick_link" } });
    expect(f.writes[0].value.notes).toBeNull(); expect(f.consumed).toBe(true);
  });
  it("refuses a changed signed note before consuming consent", async () => {
    const f = fixture(actions.profile);
    expect((await route("profile", request({ notes: "Different note" }, f.inputHash))).status).toBe(403);
    expect(f.consumed).toBe(false); expect(f.writes).toEqual([]);
  });
  const extras: [Lane, Record<string, unknown>][] = [
    ...["fundingNeedAmount", "localMatchNeedAmount"].map(key => ["profile", { [key]: 9999999 }] as [Lane, Record<string, unknown>]),
    ...["status", "decisionState", "agencyName", "ownerLabel", "cadenceLabel", "expectedAwardAmount", "opensAt", "closesAt", "decisionDueAt", "fitNotes", "readinessNotes", "decisionRationale", "decidedAt", "summary", "pursuitKind", "solicitationNumber", "submissionFormatNote", "questionsDueAt"].map(key => ["opportunity", { [key]: key === "expectedAwardAmount" ? 9999999 : "unapproved" }] as [Lane, Record<string, unknown>]),
    ...["title", "status", "agencyName", "ownerLabel", "cadenceLabel", "expectedAwardAmount", "opensAt", "closesAt", "decisionDueAt", "fitNotes", "readinessNotes", "decisionRationale", "decidedAt", "summary"].map(key => ["decision", { [key]: key === "expectedAwardAmount" ? 9999999 : "unapproved" }] as [Lane, Record<string, unknown>]),
    ["invoice", { status: "paid" }],
    ...(["profile", "opportunity", "decision", "invoice"] as Lane[]).map(lane => [lane, { unknownFutureField: "must not be stripped first" }] as [Lane, Record<string, unknown>]),
  ];
  it.each(extras)("refuses %s extra fields %j before approval or write", async (lane, extra) => {
    const f = fixture(actions[lane]);
    const response = await route(lane, request({ ...bodies[lane], ...extra }, f.inputHash));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Planner Agent action carried fields outside its own payload" });
    expect(f.consumed).toBe(false); expect(f.writes).toEqual([]); expect(f.audits).toEqual([]);
  });
  it.each([null, undefined])("refuses agent unlink or missing award %s without falling through to manual update", async fundingAwardId => {
    const f = fixture(actions.invoice);
    expect((await route("invoice", request({ workspaceId, fundingAwardId }, f.inputHash))).status).toBeGreaterThanOrEqual(400);
    expect(f.consumed).toBe(false); expect(f.writes).toEqual([]);
  });
  it("refuses an existing profile using insert uniqueness, leaving the original untouched", async () => {
    const f = fixture(actions.profile, true);
    const response = await route("profile", request(bodies.profile, f.inputHash));
    expect(response.status).toBe(409);
    expect(f.writes).toMatchObject([{ operation: "insert" }]);
    expect(f.audits).toMatchObject([{ outcome: "failed" }]);
  });
  it.each([
    ["profile", { fundingNeedAmount: 500, localMatchNeedAmount: 70, notes: "Human" }, { funding_need_amount: 500, local_match_need_amount: 70 }],
    ["opportunity", { ...bodies.opportunity, expectedAwardAmount: 500, decisionState: "pursue", pursuitKind: "proposal" }, { expected_award_amount: 500, decision_state: "pursue", pursuit_kind: "proposal" }],
    ["decision", { expectedAwardAmount: 500, status: "upcoming" }, { expected_award_amount: 500, opportunity_status: "upcoming" }],
    ["invoice", { workspaceId, fundingAwardId: null, status: "paid" }, { funding_award_id: null, status: "paid" }],
  ] as [Lane, Record<string, unknown>, Record<string, unknown>][])("preserves manual %s fields", async (lane, body, value) => {
    const f = fixture(actions[lane], true);
    expect((await route(lane, request(body, f.inputHash, true))).status).toBe(lane === "opportunity" ? 201 : 200);
    expect(f.consumed).toBe(false); expect(f.writes).toMatchObject([{ value }]);
    if (lane === "profile") expect(f.writes[0].operation).toBe("upsert");
  });
});
