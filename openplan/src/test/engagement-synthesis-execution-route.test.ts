import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), preview: vi.fn(), user: vi.fn(), access: vi.fn(), rpc: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
vi.mock("@/lib/engagement/synthesis-execution-preview-server", () => ({ readSynthesisExecutionPreview: mocks.preview }));
import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/execution/route";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";
import { z } from "zod";

const id = (n: number) => `c7100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaignId = id(1), workspaceId = id(2), requestId = id(3), actorId = id(4), sourceId = id(5), authorizationId = id(8);
const date = "2026-10-02T12:00:00.000Z", hash = (text: string) => createHash("sha256").update(text).digest("hex");
const sourceSha256 = "a".repeat(64);
const requestText = JSON.stringify({ schemaVersion: 1, sourceId, sourceSha256, connectionId: id(6),
  configurationRevisionId: id(7), configurationHash: "b".repeat(64), modelId: "SYNTHETIC-PRIVATE-model", taskByteLimit: 4096 });
const intentText = JSON.stringify({ schemaVersion: 1, headerSha256: "c".repeat(64), maxAttempts: 2, maxOutputTokens: 2048,
  responseByteLimit: 65536, expiresAt: date, chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null }, null, 2);
const command = { requestId, sourceId, sourceSha256, requestIntentSha256: hash(requestText), stage: "segment", authorizationId, intentText };
const receipt = { schemaVersion: 1, id: authorizationId, requestId, intentText, intentSha256: hash(intentText) };
const path = `http://localhost/api/engagement/campaigns/${campaignId}/synthesis/execution`;
const context = { params: Promise.resolve({ campaignId }) };
const browserHeaders = { origin: "http://localhost", "content-type": "application/json",
  "x-openplan-expected-user": actorId, "x-openplan-expected-workspace": workspaceId };
function post(body: unknown = command, headers: Record<string, string> = {}) {
  return new NextRequest(path, { method: "POST", headers: { ...browserHeaders, ...headers }, body: JSON.stringify(body) });
}
function get(query = `requestId=${requestId}&stage=segment`, headers: Record<string, string> = {}) {
  return new NextRequest(`${path}?${query}`, { headers: { ...browserHeaders, ...headers } });
}
const state = { schemaVersion: 1, campaignId, workspaceId,
  request: { id: requestId, actorId, intentText: requestText, intentSha256: hash(requestText), createdAt: date }, cancellation: null };
const client = { auth: { getUser: mocks.user }, rpc: (name: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => mocks.rpc(name, args, signal) }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue(client);
  mocks.service.mockReturnValue({ syntheticService: true });
  mocks.preview.mockResolvedValue({ schemaVersion: 1, campaignId, workspaceId, requestId, stage: "segment" });
  mocks.user.mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: null });
  mocks.rpc.mockImplementation(async name => ({ data: name === "read_engagement_synthesis_generation_request" ? state : receipt, error: null }));
});

describe("staff execution authorization HTTP boundary", () => {
  it.each(["segment", "context", "thematic"])("retains exact %s authority without service access or provider execution", async stage => {
    const response = await POST(post({ ...command, stage }), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(receipt);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(client, campaignId, actorId, "engagement.write");
    expect(mocks.rpc.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ["read_engagement_synthesis_generation_request", { p_campaign: campaignId, p_request: requestId }],
      [`authorize_engagement_synthesis_${stage === "segment" ? "generation" : stage}`, { p_request: requestId, p_authorization: authorizationId, p_intent_text: intentText }],
      ["read_engagement_synthesis_generation_request", { p_campaign: campaignId, p_request: requestId }],
    ]);
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("authorization_retained", { requestId, authorizationId, stage });
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("PRIVATE");
  });
  it.each(["anonymous", "auth-error", "access-error", "missing-campaign", "denied", "user-change", "workspace-change", "user-missing", "workspace-missing"])(
    "refuses %s before native authorization", async kind => {
      const headers: Record<string, string> = {};
      if (kind === "anonymous") mocks.user.mockResolvedValue({ data: { user: null }, error: null });
      if (kind === "auth-error") mocks.user.mockResolvedValue({ data: { user: { id: actorId } }, error: new Error("PRIVATE auth") });
      if (kind === "access-error") mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: new Error("PRIVATE access") });
      if (kind === "missing-campaign") mocks.access.mockResolvedValue({ campaign: null, allowed: true, error: null });
      if (kind === "denied") mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: false, error: null });
      if (kind.startsWith("user-")) headers["x-openplan-expected-user"] = kind.endsWith("missing") ? "" : id(99);
      if (kind.startsWith("workspace-")) headers["x-openplan-expected-workspace"] = kind.endsWith("missing") ? "" : id(99);
      for (const response of [await POST(post(command, headers), context), await GET(get(undefined, headers), context)]) {
        expect(response.status).toBe(kind === "anonymous" || kind === "auth-error" ? 401 : kind === "access-error" ? 503 : 403);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
      }
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
    });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses unsupported agent authority %s", async header => {
    expect((await POST(post(command, { [header]: "" }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }])("refuses cross-origin authorization %j", async headers => {
    expect((await POST(post(command, headers), context)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...command, actorId: id(99) }, { ...command, workspaceId: id(99) }, { ...command, campaignId: id(99) },
    { ...command, stage: "unknown" }, { ...command, intentText: "not JSON" },
    { ...command, intentText: intentText.replace('"chargesAcknowledged": true', '"chargesAcknowledged": false') }])(
    "refuses invalid or forged authority %j", async body => {
      expect((await POST(post(body), context)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
    });
  it("requires the actual signed-in user to be the original requester", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: id(99) } }, error: null });
    expect((await POST(post(command, { "x-openplan-expected-user": id(99) }), context)).status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][0]).toBe("read_engagement_synthesis_generation_request");
  });
  it("refuses a request moved to another campaign before retaining authority", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...state, campaignId: id(99) }, error: null });
    expect((await POST(post(), context)).status).toBe(503); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("bounds streamed bytes and refuses malformed UTF-8", async () => {
    for (const [body, expected] of [["x".repeat(24 * 1024 + 1), 413], [new Uint8Array([0xff]), 400]] as const) {
      const response = await POST(new NextRequest(path, { method: "POST", headers: browserHeaders, body }), context);
      expect(response.status).toBe(expected); expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses acknowledgement when the post-write access check fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: state, error: null }).mockResolvedValueOnce({ data: receipt, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501", message: "PRIVATE revoked" } });
    const response = await POST(post(), context);
    expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    expect(mocks.info).not.toHaveBeenCalled(); expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
  it.each(["segment", "context", "thematic"])("reads a bounded %s preview under current staff scope", async stage => {
    const response = await GET(get(`requestId=${requestId}&stage=${stage}`), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(client, { syntheticService: true }, { campaignId, workspaceId, requestId, stage }, expect.any(AbortSignal));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["", `requestId=${requestId}`, `requestId=${requestId}&stage=unknown`, `requestId=${requestId}&stage=segment&stage=context`,
    `requestId=${requestId}&stage=segment&extra=true`, `requestId=${requestId}&requestId=${id(99)}`, "requestId=invalid&stage=segment"])(
    "refuses invalid preview query %s", async query => {
      expect((await GET(get(query), context)).status).toBe(400);
      expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
    });
  it("keeps malformed native evidence distinct from invalid input", async () => {
    const invalid = z.string().safeParse(null);
    if (invalid.success) throw new Error("Invalid fixture");
    mocks.preview.mockRejectedValue(invalid.error);
    const response = await GET(get(), context);
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ kind: "unavailable" });
  });
  it.each([["forbidden", 403], ["conflict", 409], ["unavailable", 503]] as const)("preserves preview %s refusal", async (kind, status) => {
    mocks.preview.mockRejectedValue(new SynthesisGenerationRequestError(kind, status));
    expect((await GET(get(), context)).status).toBe(status);
  });
});
