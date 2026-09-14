import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSourceSnapshot, savedSource, sourceActor, sourceReceipt, sourceScope } from "./fixtures/engagement/synthesis-source";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: (...args: unknown[]) => mocks.access(...args) }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/sources/route";
const context = { params: Promise.resolve({ campaignId: sourceScope.campaignId }) };
const path = `http://localhost/api/engagement/campaigns/${sourceScope.campaignId}/synthesis/sources`;
function request(extra: Record<string, string> = {}, body: unknown = { requestId: sourceScope.requestId, selection: makeSourceSnapshot().selection }) {
  return new NextRequest(path, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
}
beforeEach(() => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: sourceActor } } });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: sourceScope.workspaceId }, allowed: true, error: null });
  mocks.rpc.mockReset();
});
describe("synthesis source API", () => {
  it("confirms a new retained source and an exact replay with the complete count", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: sourceReceipt(), error: null }).mockResolvedValueOnce({ data: sourceReceipt(true), error: null });
    const first = await POST(request(), context); const retry = await POST(request(), context);
    expect(first.status).toBe(201); expect(retry.status).toBe(200);
    expect(await first.json()).toEqual(sourceReceipt()); expect(await retry.json()).toEqual(sourceReceipt(true));
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), sourceScope.campaignId, sourceActor, "engagement.write");
    expect(mocks.rpc).toHaveBeenCalledWith("capture_engagement_synthesis_sources", { p_campaign: sourceScope.campaignId, p_request: sourceScope.requestId, p_selection: makeSourceSnapshot().selection });
  });
  it.each([["PT409", 409], ["42501", 403], ["22023", 400], ["XX000", 503], ["PT503", 503]])("refuses %s without a successful source receipt", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    const result = await POST(request(), context);
    expect(result.status).toBe(status); expect((await result.json()).snapshotSha256).toBeUndefined();
  });
  it.each([null, { ...sourceReceipt(), workspaceId: sourceScope.requestId }])("refuses a missing or foreign receipt", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request(), context)).status).toBe(503);
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses unsupported agent write header %s", async header => {
    expect((await POST(request({ [header]: "SYNTHETIC" }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses the real origin guard before reading or saving source selections", async () => {
    expect((await POST(request({ origin: "https://foreign.invalid" }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses malformed selections before writes", async () => {
    expect((await POST(request({}, { requestId: sourceScope.requestId, selection: { statuses: [] } }), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([GET, POST])("protects both source reads and captures from anonymous and disallowed users", async method => {
    const req = () => method === GET ? new NextRequest(`${path}?requestId=${sourceScope.requestId}`) : request();
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await method(req(), context)).status).toBe(401);
    mocks.access.mockResolvedValueOnce({ campaign: { workspace_id: sourceScope.workspaceId }, allowed: false });
    expect((await method(req(), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([GET, POST])("keeps failed access reads unavailable", async method => {
    mocks.access.mockResolvedValue({ campaign: null, error: { message: "SYNTHETIC outage" } });
    const req = method === GET ? new NextRequest(`${path}?requestId=${sourceScope.requestId}`) : request();
    expect((await method(req, context)).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses invalid route identifiers, missing read identity and malformed request bytes", async () => {
    expect((await POST(request(), { params: Promise.resolve({ campaignId: "invalid" }) })).status).toBe(400);
    expect((await GET(new NextRequest(path), context)).status).toBe(400);
    expect((await POST(new NextRequest(path, { method: "POST", headers: { origin: "http://localhost" }, body: "{" }), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("bounds the selection request without truncating the selected corpus", async () => {
    const result = await POST(request({}, { padding: "x".repeat(70_000) }), context);
    expect(result.status).toBe(413); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reads and verifies saved source bytes without re-reading current comments", async () => {
    mocks.rpc.mockResolvedValue({ data: savedSource(), error: null });
    const result = await GET(new NextRequest(`${path}?requestId=${sourceScope.requestId}`), context);
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
    const body = await result.json(); expect(body.snapshot.items).toHaveLength(301); expect(body.snapshotText).toBe(savedSource().snapshotText);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("read_engagement_synthesis_sources", { p_campaign: sourceScope.campaignId, p_request: sourceScope.requestId });
  });
  it.each([{ data: null, error: { code: "XX000" } }, { data: { ...savedSource(), snapshotSha256: "f".repeat(64) }, error: null }])("keeps failed or corrupt reads unavailable", async response => {
    mocks.rpc.mockResolvedValue(response);
    const result = await GET(new NextRequest(`${path}?requestId=${sourceScope.requestId}`), context);
    expect(result.status).toBe(503); expect((await result.json()).snapshot).toBeUndefined();
  });
});
