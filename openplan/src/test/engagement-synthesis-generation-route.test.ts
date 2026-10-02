import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), user: vi.fn(), access: vi.fn(), rpc: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/generation/route";

const id = (n: number) => `c7000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaignId = id(1), workspaceId = id(2), requestId = id(3), actorId = id(4), cancellationId = id(5);
const date = "2026-10-02T12:00:00.000Z", hash = (text: string) => createHash("sha256").update(text).digest("hex");
const intentText = JSON.stringify({ schemaVersion: 1, sourceId: id(6), sourceSha256: "a".repeat(64), connectionId: id(7),
  configurationRevisionId: id(8), configurationHash: "b".repeat(64), modelId: "SYNTHETIC-PRIVATE-model", taskByteLimit: 4096 }, null, 2);
const command = { operation: "create", requestId, intentText };
const cancellation = { operation: "cancel", requestId, cancellationId, reason: "SYNTHETIC PRIVATE reason" };
const path = `http://localhost/api/engagement/campaigns/${campaignId}/synthesis/generation`;
const context = { params: Promise.resolve({ campaignId }) };
const browserHeaders = { origin: "http://localhost", "content-type": "application/json",
  "x-openplan-expected-user": actorId, "x-openplan-expected-workspace": workspaceId };
function post(body: unknown = command, headers: Record<string, string> = {}) {
  return new NextRequest(path, { method: "POST", headers: { ...browserHeaders, ...headers }, body: JSON.stringify(body) });
}
function get(query = `requestId=${requestId}`, headers: Record<string, string> = {}) {
  return new NextRequest(`${path}?${query}`, { headers: { ...browserHeaders, ...headers } });
}
function state(cancelled = false) {
  const receiptText = JSON.stringify({ schemaVersion: 1, id: cancellationId, requestId, campaignId, workspaceId, actorId,
    reason: cancellation.reason, requestExisted: true, cancelledAt: date });
  return { schemaVersion: 1, campaignId, workspaceId, request: { id: requestId, actorId, intentText, intentSha256: hash(intentText), createdAt: date },
    cancellation: cancelled ? { id: cancellationId, receiptText, receiptSha256: hash(receiptText), createdAt: date } : null, replayed: false };
}
const client = { auth: { getUser: mocks.user }, rpc: (name: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => mocks.rpc(name, args, signal) }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue(client);
  mocks.user.mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: null });
  mocks.rpc.mockResolvedValue({ data: state(), error: null });
});

describe("staff synthesis request HTTP boundary", () => {
  it("retains exact intent under the authenticated client, without execution or private audit text", async () => {
    const response = await POST(post(), context);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(state());
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(client, campaignId, actorId, "engagement.write");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_engagement_synthesis_generation_request", {
      p_campaign: campaignId, p_request: requestId, p_intent_text: intentText,
    }, expect.any(AbortSignal));
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("request_retained", { operation: "create", requestId, replayed: false });
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("PRIVATE");
  });
  it("recovers a retained creation and reads its exact original state", async () => {
    const saved = { ...state(true), replayed: true }; mocks.rpc.mockResolvedValue({ data: saved, error: null });
    expect((await POST(post(), context)).status).toBe(200);
    mocks.rpc.mockClear(); mocks.info.mockClear();
    const response = await GET(get(), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(saved);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_synthesis_generation_request", { p_campaign: campaignId, p_request: requestId }, expect.any(AbortSignal));
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("request_read", { requestId, cancelled: true });
  });
  it("retains a cancellation reason without putting it in the audit", async () => {
    mocks.rpc.mockResolvedValue({ data: state(true), error: null });
    const response = await POST(post(cancellation), context);
    expect(response.status).toBe(201); expect(await response.json()).toEqual(state(true));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("cancel_engagement_synthesis_generation_request", {
      p_campaign: campaignId, p_request: requestId, p_cancellation: cancellationId, p_reason: cancellation.reason,
    }, expect.any(AbortSignal));
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain(cancellation.reason);
  });
  it.each(["anonymous", "auth-error", "access-error", "missing-campaign", "denied", "user-change", "workspace-change", "user-missing", "workspace-missing"])(
    "refuses read and write for %s without native calls", async kind => {
      const headers: Record<string, string> = {};
      if (kind === "anonymous") mocks.user.mockResolvedValue({ data: { user: null }, error: null });
      if (kind === "auth-error") mocks.user.mockResolvedValue({ data: { user: { id: actorId } }, error: new Error("PRIVATE auth") });
      if (kind === "access-error") mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: new Error("PRIVATE access") });
      if (kind === "missing-campaign") mocks.access.mockResolvedValue({ campaign: null, allowed: true, error: null });
      if (kind === "denied") mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: false, error: null });
      if (kind.startsWith("user-")) headers["x-openplan-expected-user"] = kind.endsWith("missing") ? "" : id(99);
      if (kind.startsWith("workspace-")) headers["x-openplan-expected-workspace"] = kind.endsWith("missing") ? "" : id(99);
      for (const response of [await GET(get(undefined, headers), context), await POST(post(command, headers), context)]) {
        expect(response.status).toBe(kind === "anonymous" || kind === "auth-error" ? 401 : kind === "access-error" ? 503 : 403);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
      }
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses unregistered agent marker %s", async header => {
    expect((await POST(post(command, { [header]: "" }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }])("refuses cross-origin mutation %j", async headers => {
    expect((await POST(post(command, headers), context)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...command, actorId: id(99) }, { ...command, workspaceId: id(99) }, { ...command, operation: "execute" },
    { ...command, intentText: "not JSON" }, { ...cancellation, reason: " " }])("refuses invalid or forged command %j", async body => {
    expect((await POST(post(body), context)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["", `requestId=${requestId}&requestId=${id(99)}`, `requestId=${requestId}&execute=true`, "requestId=invalid", `other=${requestId}`])("refuses invalid read query %s", async query => {
    expect((await GET(get(query), context)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses an invalid campaign on both routes", async () => {
    const invalid = { params: Promise.resolve({ campaignId: "invalid" }) };
    expect((await GET(get(), invalid)).status).toBe(400); expect((await POST(post(), invalid)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("bounds streamed bytes without trusting Content-Length", async () => {
    const response = await POST(new NextRequest(path, { method: "POST", headers: browserHeaders, body: "x".repeat(24 * 1024 + 1) }), context);
    expect(response.status).toBe(413); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed UTF-8 and JSON before native calls", async () => {
    const prefix = new TextEncoder().encode(JSON.stringify(cancellation).slice(0, -2));
    const malformed = new Uint8Array([...prefix, 0xff, ...new TextEncoder().encode('"}')]);
    for (const body of [malformed, "{"]) {
      expect((await POST(new NextRequest(path, { method: "POST", headers: browserHeaders, body }), context)).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["PT409", 409], ["PT503", 503]] as const)("preserves native %s refusal on read and write", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE native error" } });
    for (const response of [await GET(get(), context), await POST(post(), context)]) {
      expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    }
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("PRIVATE");
  });
  it("does not confirm corrupt native output or transport failure", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...state(), workspaceId: id(99) }, error: null });
    expect((await POST(post(), context)).status).toBe(503);
    mocks.rpc.mockRejectedValueOnce(new Error("PRIVATE transport"));
    const response = await GET(get(), context); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
});
