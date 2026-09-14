import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import native from "./fixtures/decision-link-native.json";
import { BODY_LIMITS } from "@/lib/http/body-limit";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), access: vi.fn(), audit: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } }), createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => mocks.audit }));
import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/decision-links/route";
import { GET as PREVIEW } from "@/app/api/engagement/campaigns/[campaignId]/decision-links/context/route";

const row = native.initial.entries[0];
const body = { requestId: row.id, responseId: row.response_id, decisionId: row.decision_id, operation: "link", predecessorId: null, expectedContextSha256: row.context_sha256, reason: row.reason };
const params = () => ({ params: Promise.resolve({ campaignId: native.scope.campaignId }) });
const url = `http://openplan.test/api/engagement/campaigns/${native.scope.campaignId}/decision-links`;
function request(method = "GET", data: unknown = body, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method, headers: { origin: "http://openplan.test", "content-type": "application/json",
    "x-openplan-expected-user": native.scope.actorId, "x-openplan-expected-workspace": native.scope.workspaceId, ...headers }, ...(method === "POST" ? { body: JSON.stringify(data) } : {}) });
}
const previewRequest = () => new NextRequest(`${url}/context?responseId=${row.response_id}&decisionId=${row.decision_id}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: native.scope.actorId } }, error: null });
  mocks.access.mockResolvedValue({ campaign: { id: native.scope.campaignId, workspace_id: native.scope.workspaceId }, allowed: true, error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "read_engagement_decision_links" ? native.initial
    : name === "read_engagement_response_decision_context" ? { contextText: row.context_text, contextSha256: row.context_sha256 }
      : { link: row, replayed: false }, error: null }));
});

describe("private decision-link HTTP boundary", () => {
  it("returns a verified complete snapshot with current actor and no-store", async () => {
    const result = await GET(request(), params());
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ snapshot: native.initial, actorId: native.scope.actorId });
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), native.scope.campaignId, native.scope.actorId, "engagement.write");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_decision_links", { p_campaign: native.scope.campaignId });
  });
  it("previews the exact response and decision from the query", async () => {
    const result = await PREVIEW(previewRequest(), params());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ packet: { contextText: row.context_text, contextSha256: row.context_sha256 }, actorId: native.scope.actorId });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_response_decision_context", { p_campaign: native.scope.campaignId, p_response: row.response_id, p_decision: row.decision_id });
  });
  it("does not turn failed or incomplete reads into an empty history", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "SYNTHETIC private diagnostic" } });
    const failed = await GET(request(), params()); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("private diagnostic");
    mocks.rpc.mockResolvedValueOnce({ data: { ...native.initial, entryCount: 0 }, error: null });
    expect((await GET(request(), params())).status).toBe(503);
    mocks.rpc.mockResolvedValueOnce({ data: { contextText: row.context_text, contextSha256: "0".repeat(64) }, error: null });
    expect((await PREVIEW(previewRequest(), params())).status).toBe(503);
  });
  it("refuses invalid route and preview identifiers before reading", async () => {
    expect((await GET(request(), { params: Promise.resolve({ campaignId: "invalid" }) })).status).toBe(400);
    expect((await PREVIEW(new NextRequest(`${url}/context`), params())).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires signed-in staff for reads and writes", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(request(), params())).status).toBe(401);
    expect((await POST(request("POST"), params())).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { id: native.scope.actorId } }, error: null });
    mocks.access.mockResolvedValue({ campaign: { workspace_id: native.scope.workspaceId }, allowed: false, error: null });
    expect((await GET(request(), params())).status).toBe(403);
    expect((await POST(request("POST"), params())).status).toBe(403);
    mocks.access.mockResolvedValue({ campaign: null, allowed: false, error: { message: "SYNTHETIC lookup failure" } });
    expect((await GET(request(), params())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("sends one exact command and verifies its receipt without rereading source", async () => {
    const saved = await POST(request("POST"), params());
    expect(saved.status).toBe(201); expect(await saved.json()).toEqual({ link: row, replayed: false });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("write_engagement_response_decision_link", {
      p_campaign: native.scope.campaignId, p_response: row.response_id, p_decision: row.decision_id,
      p_request: row.id, p_operation: "link", p_predecessor: null, p_expected_context_sha256: row.context_sha256, p_reason: row.reason,
    });
    mocks.rpc.mockResolvedValue({ data: { link: row, replayed: true }, error: null });
    const retry = await POST(request("POST"), params());
    expect(retry.status).toBe(200); expect(await retry.json()).toEqual({ link: row, replayed: true });
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses unregistered agent marker %s", async header => {
    expect((await POST(request("POST", body, { [header]: "" }), params())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses foreign origin and changed account/workspace expectations", async () => {
    for (const headers of [{ origin: "https://elsewhere.invalid" }, { "sec-fetch-site": "cross-site" },
      { "x-openplan-expected-user": "different" }, { "x-openplan-expected-workspace": "different" }] as Record<string, string>[]) {
      expect((await POST(request("POST", body, headers), params())).status).toBe(403);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses invalid or oversized bodies before writing", async () => {
    expect((await POST(request("POST", { ...body, operation: "refresh" }), params())).status).toBe(400);
    expect((await POST(request("POST", { ...body, unexpected: true }), params())).status).toBe(400);
    expect((await POST(request("POST", { ...body, reason: "x".repeat(BODY_LIMITS.normalJson + 1) }), params())).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["PT409",409],["23505",409],["42501",403],["P0002",404],["22023",400],["22P02",400],["PT503",503]] as const)("preserves native %s outcome without leaking diagnostic text", async (code,status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "SYNTHETIC private diagnostic" } });
    const result = await POST(request("POST"), params());
    expect(result.status).toBe(status); expect(await result.text()).not.toContain("private diagnostic");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });
  it("keeps uncertain saves uncertain rather than issuing another request", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("SYNTHETIC lost acknowledgement"));
    expect((await POST(request("POST"), params())).status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValueOnce({ data: { link: { ...row, actor_id: "40000000-0000-4000-8000-000000000004" }, replayed: false }, error: null });
    expect((await POST(request("POST"), params())).status).toBe(503);
  });
});
