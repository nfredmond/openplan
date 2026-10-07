import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), user: vi.fn(), access: vi.fn(), rpc: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/preparation/route";

const id = (n: number) => `c7000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaignId = id(1), workspaceId = id(2), requestId = id(3), actorId = id(4);
const date = "2026-10-02T12:00:00.000Z";
const command = { operation: "enqueue", requestId, stage: "segment", intentSha256: "a".repeat(64) };
const retry = { operation: "retry", requestId, attempt: 0 };
const path = `http://localhost/api/engagement/campaigns/${campaignId}/synthesis/preparation`;
const context = { params: Promise.resolve({ campaignId }) };
const browserHeaders = { origin: "http://localhost", "content-type": "application/json",
  "x-openplan-expected-user": actorId, "x-openplan-expected-workspace": workspaceId };
function post(body: unknown = command, headers: Record<string, string> = {}) {
  return new NextRequest(path, { method: "POST", headers: { ...browserHeaders, ...headers }, body: JSON.stringify(body) });
}
function get(query = `requestId=${requestId}`, headers: Record<string, string> = {}) {
  return new NextRequest(`${path}?${query}`, { headers: { ...browserHeaders, ...headers } });
}
function state() {
  return { schemaVersion: 1, campaignId, workspaceId, requestId, actorId, intentSha256: command.intentSha256,
    stage: command.stage, status: "queued", attempts: 0, leaseUntil: null, failureCode: null, sealSha256: null,
    cancelled: false, createdAt: date, updatedAt: date, replayed: false };
}
const client = { auth: { getUser: mocks.user }, rpc: (name: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => mocks.rpc(name, args, signal) }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue(client);
  mocks.user.mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: null });
  mocks.rpc.mockResolvedValue({ data: state(), error: null });
});

describe("staff synthesis preparation HTTP boundary", () => {
  it("enqueues exact scope under authenticated staff with a bounded public audit", async () => {
    const response = await POST(post(), context);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(state());
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(client, campaignId, actorId, "engagement.write");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("enqueue_engagement_synthesis_preparation", {
      p_campaign: campaignId, p_request: requestId, p_stage: "segment", p_intent_sha256: command.intentSha256,
    }, expect.any(AbortSignal));
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("preparation_command_retained", { operation: "enqueue", requestId, status: "queued", attempts: 0 });
  });
  it("recovers an enqueue acknowledgement after later cancellation", async () => {
    const saved = { ...state(), cancelled: true, replayed: true }; mocks.rpc.mockResolvedValue({ data: saved, error: null });
    expect((await POST(post(), context)).status).toBe(200);
    mocks.rpc.mockClear(); mocks.info.mockClear();
    const response = await GET(get(), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(saved);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_synthesis_preparation", { p_campaign: campaignId, p_request: requestId }, expect.any(AbortSignal));
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("preparation_read", { requestId, status: "queued" });
  });
  it("returns null for an unqueued request without creating a job", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const response = await GET(get(), context);
    expect(response.status).toBe(200); expect(await response.json()).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_synthesis_preparation", { p_campaign: campaignId, p_request: requestId }, expect.any(AbortSignal));
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("preparation_read", { requestId, status: "not_queued" });
  });
  it("returns newer failed progress for an old retry without claiming it requeued", async () => {
    const saved = { ...state(), status: "failed", attempts: 2, failureCode: "preparation_failed", replayed: undefined };
    mocks.rpc.mockResolvedValue({ data: saved, error: null });
    const response = await POST(post(retry), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ...saved, replayed: undefined });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("retry_engagement_synthesis_preparation", {
      p_campaign: campaignId, p_request: requestId, p_attempt: 0,
    }, expect.any(AbortSignal));
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
    { ...command, stage: "execute" }, { ...command, intentSha256: "invalid" },
    { ...retry, attempt: -1 }, { ...retry, attempt: 0.5 }, { ...retry, attempt: Number.MAX_SAFE_INTEGER + 1 }])("refuses invalid or forged command %j", async body => {
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
    const response = await POST(new NextRequest(path, { method: "POST", headers: browserHeaders, body: "x".repeat(8 * 1024 + 1) }), context);
    expect(response.status).toBe(413); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed UTF-8 and JSON before native calls", async () => {
    const prefix = new TextEncoder().encode(`{"operation":"enqueue","requestId":"${requestId}","stage":"seg`);
    const malformed = new Uint8Array([...prefix, 0xff, ...new TextEncoder().encode(`ment","intentSha256":"${command.intentSha256}"}`)]);
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
