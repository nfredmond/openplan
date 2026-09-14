// @vitest-environment node
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), user: vi.fn(), access: vi.fn(), audit: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: mocks.audit }));
import { POST } from "@/app/api/engagement/campaigns/[campaignId]/translations/generation/resolutions/route";
import { GENERATION_RESOLUTION_BODY_LIMIT } from "@/lib/engagement/translation-generation-resolution";

const id = (n: number) => `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: id(1), workspaceId: id(2), actorId: id(3) };
const intent = { resolutionId: id(4), requestId: id(5), copyJson: JSON.stringify("PRIVATE damaged\0\ud800 copy"), reason: "PRIVATE resolution reason" };
const context = { params: Promise.resolve({ campaignId: scope.campaignId }) };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const url = "http://localhost/api/engagement/campaigns/" + scope.campaignId + "/translations/generation/resolutions";
function packet(replayed = false) {
  const payloadText = JSON.stringify({ schema: 1, ...scope, ...intent });
  const resultText = JSON.stringify({ schema: 1, ...scope, resolutionId: intent.resolutionId, requestId: intent.requestId, requestExisted: false, fields: [], resolvedAt: "2026-09-13T12:00:00.000Z" });
  return { payloadText, payloadSha256: hash(payloadText), resultText, resultSha256: hash(resultText), replayed };
}
function request(body: unknown = intent, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "x-openplan-expected-user": scope.actorId, "x-openplan-expected-workspace": scope.workspaceId, ...headers }, body: JSON.stringify(body) });
}
function fixture() {
  const result = vi.fn(async (): Promise<{ data: unknown; error: { code: string } | null }> => ({ data: packet(), error: null }));
  const rpc = vi.fn((_name: string, _args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => { signal.throwIfAborted(); return result(); } }));
  const client = { auth: { getUser: mocks.user }, rpc };
  mocks.client.mockResolvedValue(client);
  return { result, rpc, client };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.audit.mockReturnValue({ info: mocks.info, warn: mocks.warn });
  mocks.user.mockResolvedValue({ data: { user: { id: scope.actorId } } });
  mocks.access.mockResolvedValue({ campaign: { id: scope.campaignId, workspace_id: scope.workspaceId }, allowed: true, error: null });
});
describe("generation resolution HTTP route", () => {
  it("binds authenticated scope and returns verified private receipts without logging copied words", async () => {
    const f = fixture(); const response = await POST(request(), context);
    expect(response.status).toBe(201); expect(await response.json()).toEqual(packet());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledWith(f.client, scope.campaignId, scope.actorId, "engagement.write");
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("resolve_translation_generation_request", { p_resolution: intent.resolutionId, p_request: intent.requestId, p_campaign: scope.campaignId, p_copy_json: intent.copyJson, p_reason: intent.reason });
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith("translation_generation_resolved", { campaignId: scope.campaignId, actorId: scope.actorId, requestId: intent.requestId, resolutionId: intent.resolutionId, replayed: false });
    expect(JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls])).not.toContain("PRIVATE");
  });
  it.each(["x-openplan-expected-user", "x-openplan-expected-workspace"])("refuses a changed or missing browser scope header %s before resolution", async key => {
    const f = fixture();
    for (const replacement of [id(99), null]) {
      const req = request();
      if (replacement === null) req.headers.delete(key); else req.headers.set(key, replacement);
      const response = await POST(req, context);
      expect(response.status).toBe(403); expect(f.rpc).not.toHaveBeenCalled();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
  it("retries the exact resolution after acknowledgement loss without inventing another identity", async () => {
    const f = fixture(); f.result.mockRejectedValueOnce(new Error("PRIVATE synthetic acknowledgement loss"));
    const lost = await POST(request(), context); expect(lost.status).toBe(503); expect(await lost.json()).toMatchObject({ kind: "unavailable" });
    f.result.mockResolvedValueOnce({ data: packet(true), error: null });
    const replay = await POST(request(), context); expect(replay.status).toBe(200); expect(await replay.json()).toEqual(packet(true));
    expect(f.rpc.mock.calls[1]).toEqual(f.rpc.mock.calls[0]); expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("PRIVATE");
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses unregistered agent marker %s before authentication", async key => {
    const f = fixture(); expect((await POST(request(intent, { [key]: "synthetic" }), context)).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each(["origin", "sec-fetch-site"])("refuses cross-origin request through %s before authentication", async key => {
    fixture(); expect((await POST(request(intent, { [key]: key === "origin" ? "https://synthetic.invalid" : "cross-site" }), context)).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["unauthenticated", "denied", "missing", "error"])("refuses %s before resolution", async kind => {
    const f = fixture();
    if (kind === "unauthenticated") mocks.user.mockResolvedValue({ data: { user: null } });
    else mocks.access.mockResolvedValue({ campaign: kind === "missing" ? null : { id: scope.campaignId, workspace_id: scope.workspaceId }, allowed: kind !== "denied", error: kind === "error" ? {} : null });
    const response = await POST(request(), context);
    expect(response.status).toBe({ unauthenticated: 401, denied: 403, missing: 404, error: 503 }[kind]);
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each(["actorId", "workspaceId", "campaignId", "credential"])("refuses caller supplied %s", async key => {
    fixture(); expect((await POST(request({ ...intent, [key]: id(99) }), context)).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("refuses a malformed campaign before reading the body", async () => {
    fixture(); expect((await POST(request(), { params: Promise.resolve({ campaignId: "invalid" }) })).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["copy", "reason", "identity"])("refuses invalid %s before authentication", async kind => {
    fixture(); const body = { ...intent, ...(kind === "copy" ? { copyJson: "{}" } : kind === "reason" ? { reason: "  " } : { resolutionId: "invalid" }) };
    expect((await POST(request(body), context)).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("refuses malformed UTF-8 without replacing the retained bytes", async () => {
    fixture(); const prefix = new TextEncoder().encode(JSON.stringify(intent).replace(/}$/, "").replace(/\"reason\":.*$/, '"reason":"'));
    const body = new Uint8Array([...prefix, 255, 34, 125]);
    const response = await POST(new NextRequest(url, { method: "POST", headers: { host: "localhost", origin: "http://localhost" }, body }), context);
    expect(response.status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("cancels an oversized body without reading its tail or authenticating", async () => {
    fixture(); let reads = 0; const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { reads++; if (reads === 1) controller.enqueue(new Uint8Array(GENERATION_RESOLUTION_BODY_LIMIT + 1)); else controller.error(new Error("Tail must not be read")); }, cancel }, { highWaterMark: 0 });
    const response = await POST(new NextRequest(url, { method: "POST", headers: { host: "localhost", origin: "http://localhost" }, body: stream, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]), context);
    expect(response.status).toBe(413); expect(reads).toBe(1); expect(cancel).toHaveBeenCalledOnce(); expect(mocks.client).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each([["42501", 403], ["PT409", 409], ["22023", 400], ["PT503", 503]] as const)("retains database refusal %s", async (code, status) => {
    const f = fixture(); f.result.mockResolvedValueOnce({ data: null, error: { code } });
    const response = await POST(request(), context); expect(response.status).toBe(status); expect(mocks.info).not.toHaveBeenCalled();
  });
  it("does not acknowledge or log success for corrupt database receipts", async () => {
    const f = fixture(); f.result.mockResolvedValueOnce({ data: { ...packet(), payloadSha256: "a".repeat(64) }, error: null });
    expect((await POST(request(), context)).status).toBe(503); expect(mocks.info).not.toHaveBeenCalled();
  });
});
