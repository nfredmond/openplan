// Caller/query mocks cannot establish live RLS or native SQL behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { createClientMock, serviceMock } = vi.hoisted(() => ({ createClientMock: vi.fn(), serviceMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock, createServiceRoleClient: serviceMock }));

import { GET } from "@/app/api/funding-awards/[awardId]/closure-history/route";
import { readAwardClosureHistory, readClosureBasis } from "@/lib/grants/award-closure-history";

const AWARD = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";
const REVISION = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const receipt = {
  id: "77777777-7777-4777-8777-777777777777", award_id: AWARD, workspace_id: WORKSPACE,
  revision_id: REVISION, actor_id: ACTOR, event: "earned_coverage" as const,
  created_at: "2026-10-19T11:01:41.150334+00:00",
  basis: { previousClosure: { basis: null, closedAt: null, note: null }, expectedCurrent: REVISION, note: "Retained source note", ceiling: "100.01", paid: "100.01", currency: "USD", invoices: [] },
};
type Result = { data: unknown; error: { code: string; message: string } | null; count?: number | null };
let results: Record<string, Result>;
let user: { id: string } | null;
let authError: { message: string } | null;
let calls: Array<{ table: string; method: string; args: unknown[] }>;

function client() {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: authError })) },
    from: vi.fn((table: string) => {
      calls.push({ table, method: "from", args: [] });
      const query = {
        select: vi.fn((...args: unknown[]) => { calls.push({ table, method: "select", args }); return query; }),
        eq: vi.fn((...args: unknown[]) => { calls.push({ table, method: "eq", args }); return query; }),
        order: vi.fn((...args: unknown[]) => { calls.push({ table, method: "order", args }); return query; }),
        limit: vi.fn(async (...args: unknown[]) => { calls.push({ table, method: "limit", args }); return results[table]; }),
        maybeSingle: vi.fn(async () => results[table]),
      };
      return query;
    }),
  };
}
const request = () => GET(new Request(`http://localhost/api/funding-awards/${AWARD}/closure-history`), { params: Promise.resolve({ awardId: AWARD }) });

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  user = { id: ACTOR };
  authError = null;
  results = {
    funding_awards: { data: { id: AWARD, workspace_id: WORKSPACE, project_id: PROJECT }, error: null },
    projects: { data: { id: PROJECT, workspace_id: WORKSPACE }, error: null },
    workspace_members: { data: { workspace_id: WORKSPACE, role: "viewer" }, error: null },
    funding_award_closure_receipts: { data: [receipt], count: 1, error: null },
  };
  createClientMock.mockResolvedValue(client());
  serviceMock.mockImplementation(() => { throw new Error("Service read forbidden"); });
});

describe("caller-scoped award closure history", () => {
  it("allows a current viewer and asserts exact projection, count, both filters and deterministic order after access reads", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ state: "available", awardId: AWARD, workspaceId: WORKSPACE, limit: 500, receipts: [receipt] });
    expect(calls.filter((call) => call.table === "funding_award_closure_receipts")).toEqual([
      { table: "funding_award_closure_receipts", method: "from", args: [] },
      { table: "funding_award_closure_receipts", method: "select", args: ["id, award_id, workspace_id, revision_id, event, basis, actor_id, created_at", { count: "exact" }] },
      { table: "funding_award_closure_receipts", method: "eq", args: ["workspace_id", WORKSPACE] },
      { table: "funding_award_closure_receipts", method: "eq", args: ["award_id", AWARD] },
      { table: "funding_award_closure_receipts", method: "order", args: ["created_at", { ascending: true }] },
      { table: "funding_award_closure_receipts", method: "order", args: ["id", { ascending: true }] },
      { table: "funding_award_closure_receipts", method: "limit", args: [500] },
    ]);
    expect(calls.filter((call) => call.method === "from").map((call) => call.table)).toEqual(["funding_awards", "projects", "workspace_members", "funding_award_closure_receipts"]);
    expect(calls.filter((call) => call.table === "funding_awards" && call.method !== "from")).toEqual([
      { table: "funding_awards", method: "select", args: ["id, workspace_id, project_id"] },
      { table: "funding_awards", method: "eq", args: ["id", AWARD] },
    ]);
    expect(calls.filter((call) => call.table === "workspace_members" && call.method === "eq").map((call) => call.args)).toEqual([["workspace_id", WORKSPACE], ["user_id", ACTOR]]);
    expect(calls.filter((call) => call.table === "projects" && call.method === "eq").map((call) => call.args)).toEqual([["id", PROJECT]]);
    expect(calls.filter((call) => call.table === "workspace_members" && call.method === "select").map((call) => call.args)).toEqual([["workspace_id, role"]]);
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it.each([
    { name: "signed out", status: 401, change: () => { user = null; } },
    { name: "auth failure", status: 401, change: () => { authError = { message: "Unavailable" }; } },
    { name: "nonexistent or RLS-hidden award", status: 404, change: () => { results.funding_awards.data = null; } },
    { name: "removed current membership", status: 403, change: () => { results.workspace_members.data = null; } },
    { name: "foreign project workspace", status: 403, change: () => { results.projects.data = { id: PROJECT, workspace_id: OTHER }; } },
    { name: "foreign membership workspace", status: 403, change: () => { results.workspace_members.data = { workspace_id: OTHER, role: "viewer" }; } },
    { name: "unknown role", status: 403, change: () => { results.workspace_members.data = { workspace_id: WORKSPACE, role: "unknown" }; } },
    { name: "membership read failure", status: 503, change: () => { results.workspace_members.error = { code: "XX000", message: "Unavailable" }; } },
    { name: "award read failure", status: 503, change: () => { results.funding_awards.error = { code: "XX000", message: "Unavailable" }; } },
    { name: "wrong award row", status: 503, change: () => { results.funding_awards.data = { id: OTHER, workspace_id: WORKSPACE, project_id: PROJECT }; } },
  ])("refuses $name before any history read", async ({ change, status }) => {
    change();
    const response = await request();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(calls.some((call) => call.table === "funding_award_closure_receipts")).toBe(false);
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it("refuses invalid award IDs without creating a client", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ awardId: "bad" }) });
    expect(response.status).toBe(400);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("distinguishes counted empty history on a legacy award from unavailable data", async () => {
    results.funding_award_closure_receipts = { data: [], count: 0, error: null };
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "available", receipts: [] });
  });

  it.each([
    { data: [receipt], count: 2, error: null },
    { data: [receipt], count: 501, error: null },
    { data: [receipt], count: null, error: null },
    { data: [receipt], error: null },
    { data: null, count: 0, error: null },
    { data: [receipt], count: 0, error: null },
    { data: [receipt, receipt], count: 2, error: null },
    { data: [{ ...receipt, award_id: OTHER }], count: 1, error: null },
    { data: [{ ...receipt, workspace_id: OTHER }], count: 1, error: null },
    { data: [{ ...receipt, actor_id: null }], count: 1, error: null },
    { data: [{ ...receipt, created_at: "not a timestamp" }], count: 1, error: null },
    { data: [{ ...receipt, event: "unknown" }], count: 1, error: null },
    { data: [{ ...receipt, basis: undefined }], count: 1, error: null },
    { data: null, count: null, error: { code: "PGRST205", message: "Missing table" } },
    { data: null, count: null, error: { code: "XX000", message: "Private database detail" } },
  ])("refuses partial, extra, malformed or unavailable reads %#", async (result) => {
    results.funding_award_closure_receipts = result;
    const response = await request();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: expect.stringContaining("no partial history is shown") });
    expect(body.error).toContain("500");
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it("refuses a counted response exceeding the local cap, even if its count matches", async () => {
    results.funding_award_closure_receipts = { data: Array.from({ length: 501 }, (_, index) => ({ ...receipt, id: `77777777-7777-4777-8777-${index.toString(16).padStart(12, "0")}` })), count: 501, error: null };
    expect((await request()).status).toBe(503);
  });

  it("accepts every counted row at the disclosed bound without truncating it", async () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({ ...receipt, id: `77777777-7777-4777-8777-${index.toString(16).padStart(12, "0")}` }));
    results.funding_award_closure_receipts = { data: rows, count: 500, error: null };
    const response = await request();
    expect(response.status).toBe(200);
    expect((await response.json()).receipts).toEqual(rows);
  });

  it("keeps receipt permission failure explicit without service fallback", async () => {
    results.funding_award_closure_receipts = { data: null, error: { code: "42501", message: "Permission denied" } };
    const response = await request();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Award transition history access denied" });
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it("handles a rejected client read without leaking details", async () => {
    createClientMock.mockRejectedValue(new Error("Private transport detail"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("Private transport detail");
  });
});

describe("typed history and retained basis", () => {
  it("rejects another award response and preserves exact retained decimal strings", () => {
    const value = { state: "available", awardId: AWARD, workspaceId: WORKSPACE, limit: 500, receipts: [receipt] };
    expect(readAwardClosureHistory(value, OTHER)).toBeNull();
    expect(readClosureBasis(receipt)).toMatchObject({ kind: "earned_coverage", paid: "100.01", ceiling: "100.01", currency: "USD" });
    expect(readClosureBasis({ ...receipt, basis: { ...receipt.basis, paid: 100.01 } })).toEqual({ kind: "unassessed" });
    expect(readClosureBasis({ ...receipt, basis: { ...receipt.basis, expectedCurrent: OTHER } })).toEqual({ kind: "unassessed" });
  });
  it.each([null, [], "legacy", 1, { note: "partial" }])("retains JSON shape %j as unassessed, rather than inventing a basis", (basis) => {
    const history = readAwardClosureHistory({ state: "available", awardId: AWARD, workspaceId: WORKSPACE, limit: 500, receipts: [{ ...receipt, basis }] }, AWARD);
    expect(history?.receipts[0].basis).toEqual(basis);
    expect(history && readClosureBasis(history.receipts[0])).toEqual({ kind: "unassessed" });
  });
  it("keeps the legacy reopen destination absent and the selected destination exact", () => {
    const basis = { previousClosure: { basis: "earned_coverage", closedAt: receipt.created_at, note: "Closed earlier" }, expectedCurrent: REVISION, note: "Reopen reason" };
    expect(readClosureBasis({ ...receipt, event: "reopen", basis })).toMatchObject({ kind: "reopen", note: "Reopen reason" });
    expect(readClosureBasis({ ...receipt, event: "reopen", basis })).not.toHaveProperty("reopenSpendingStatus");
    expect(readClosureBasis({ ...receipt, event: "reopen", basis: { ...basis, reopenSpendingStatus: "delayed" } })).toMatchObject({ kind: "reopen", reopenSpendingStatus: "delayed" });
  });
});
