import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ queue: vi.fn(), read: vi.fn(), cache: vi.fn(), service: vi.fn(), legacyModel: vi.fn(), legacyLimit: vi.fn(), legacyRecord: vi.fn() }));
const service = { synthetic: "public route service" };
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service, createClient: vi.fn() }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/engagement/public-translation-generation", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/engagement/public-translation-generation")>(),
  queuePublicTranslationGeneration: mocks.queue, readPublicTranslationGeneration: mocks.read, readPublicTranslationCache: mocks.cache,
}));
vi.mock("@/lib/engagement/translation", () => ({ translateEngagementText: mocks.legacyModel }));
vi.mock("@/lib/runtime/ai-rate-limit", () => ({ checkAiUsageRateLimit: mocks.legacyLimit, recordAiUsageEvent: mocks.legacyRecord }));
import { PublicTranslationQueueError } from "@/lib/engagement/public-translation-generation";
import { POST, GET } from "@/app/api/engage/[shareToken]/items/[itemId]/translate/route";
const shareToken = "SYNTHETIC-share-token", itemId = "22222222-2222-4222-8222-222222222222", requestId = "33333333-3333-4333-8333-333333333333";
const base = `http://localhost/api/engage/${shareToken}/items/${itemId}/translate`;
const intent = { language: "es", sourceHash: "a".repeat(64) };
const context = { params: Promise.resolve({ shareToken, itemId }) };
const queued = (state = "queued", translated: string | null = null) => ({ requestId, language: "es", state, translated });
const post = (body: unknown = intent, headers: Record<string, string> = {}) => new NextRequest(base, {
  method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
const get = (query: Record<string, string> = intent) => new NextRequest(base + "?" + new URLSearchParams(query));
function privateReply(response: Response) { expect(response.headers.get("cache-control")).toBe("private, no-store"); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.service.mockReturnValue(service); mocks.cache.mockResolvedValue(null); mocks.read.mockResolvedValue(null);
  mocks.queue.mockResolvedValue({ ...queued(), created: true });
});
afterEach(() => {
  expect(mocks.legacyModel).not.toHaveBeenCalled(); expect(mocks.legacyLimit).not.toHaveBeenCalled(); expect(mocks.legacyRecord).not.toHaveBeenCalled();
});

describe("public durable translation endpoint", () => {
  it("queues the source-bound request without a session or inline model", async () => {
    const request = post(), response = await POST(request, context); expect(response.status).toBe(202); privateReply(response);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.json()).toEqual({ source: "queue", sourceHash: intent.sourceHash, request: queued(), created: true });
    expect(mocks.cache).toHaveBeenCalledWith(service, { shareToken, itemId }, intent, request.signal);
    expect(mocks.queue).toHaveBeenCalledWith(service, { shareToken, itemId }, intent, request.signal);
  });
  it("returns valid legacy cache without creating work", async () => {
    mocks.cache.mockResolvedValue("  SINTÉTICO conservado\n"); const response = await POST(post(), context);
    expect(response.status).toBe(200); privateReply(response); expect(await response.json()).toEqual({ source: "cache", ...intent, translated: "  SINTÉTICO conservado\n" });
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("retries the named attempt without substituting a legacy cache", async () => {
    mocks.cache.mockResolvedValue("SINTÉTICO old cache"); const request = post({ ...intent, retryOf: requestId });
    expect((await POST(request, context)).status).toBe(202); expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.queue).toHaveBeenCalledWith(service, { shareToken, itemId }, { ...intent, retryOf: requestId }, request.signal);
  });
  it.each(["queued", "reserved", "running"])("reports %s as pending rather than missing output", async state => {
    mocks.read.mockResolvedValue(queued(state)); const response = await GET(get({ ...intent, requestId }), context);
    expect(response.status).toBe(202); expect((await response.json()).request.state).toBe(state); expect(mocks.queue).not.toHaveBeenCalled(); privateReply(response);
  });
  it.each(["failed", "interrupted", "incomplete", "cancelled"])("preserves terminal %s with its identity", async state => {
    mocks.read.mockResolvedValue(queued(state)); const response = await GET(get({ ...intent, requestId }), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ source: "queue", sourceHash: intent.sourceHash, request: queued(state) });
  });
  it("recovers completed exact words through GET", async () => {
    mocks.read.mockResolvedValue(queued("completed", "SINTÉTICO final\n")); const request = get({ ...intent, requestId }), response = await GET(request, context);
    expect(response.status).toBe(200); privateReply(response); expect(mocks.read).toHaveBeenCalledWith(service, { shareToken, itemId }, intent, requestId, request.signal);
    expect((await response.json()).request.translated).toBe("SINTÉTICO final\n"); expect(mocks.cache).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("preserves missing as distinct from failed discovery", async () => {
    const response = await GET(get(), context); expect(response.status).toBe(200); privateReply(response);
    expect(await response.json()).toEqual({ source: "missing", ...intent, translated: null }); expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("GET recovers legacy cache after a conclusive missing request", async () => {
    mocks.cache.mockResolvedValue("SINTÉTICO cache"); const response = await GET(get(), context);
    expect(await response.json()).toEqual({ source: "cache", ...intent, translated: "SINTÉTICO cache" }); expect(mocks.queue).not.toHaveBeenCalled();
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses unregistered agent marker %s", async header => {
    const response = await POST(post(intent, { [header]: "" }), context); expect(response.status).toBe(403); privateReply(response); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://foreign.invalid" }, { origin: "" }, { "sec-fetch-site": "cross-site" }])("refuses cross-origin creation %j", async headers => {
    const response = await POST(post(intent, headers), context); expect(response.status).toBe(403); privateReply(response); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([{ language: "es" }, { ...intent, language: "made-up" }, { ...intent, sourceHash: "old" }, { ...intent, retryOf: "bad" }, { ...intent, actorId: requestId }])("refuses invalid intent %j before database use", async body => {
    const response = await POST(post(body), context); expect(response.status).toBe(400); privateReply(response); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("refuses bad route identity", async () => {
    const response = await POST(post(), { params: Promise.resolve({ shareToken: "bad", itemId }) }); expect(response.status).toBe(400); privateReply(response); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("counts streamed bytes despite an understated content length", async () => {
    const request = new NextRequest(base, { method: "POST", headers: { origin: "http://localhost", "content-length": "1" }, body: " ".repeat(2050) + JSON.stringify(intent) });
    const response = await POST(request, context); expect(response.status).toBe(413); privateReply(response); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("refuses malformed UTF-8", async () => {
    const request = new NextRequest(base, { method: "POST", headers: { origin: "http://localhost" }, body: new Uint8Array([0xff]) });
    const response = await POST(request, context); expect(response.status).toBe(400); privateReply(response); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["GET", "POST"])("keeps unsupported machine language unavailable for %s", async method => {
    const response = method === "POST" ? await POST(post({ ...intent, language: "nv" }), context) : await GET(get({ ...intent, language: "nv" }), context);
    expect(response.status).toBe(200); privateReply(response); expect(await response.json()).toMatchObject({ source: "unavailable", language: "nv", translated: null, caveat: expect.stringMatching(/Diné Bizaad|Navajo/) });
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["language=es&language=vi", "language=es&extra=1", "language=es&requestId=bad", "language=es&retryOf=" + requestId])("rejects ambiguous recovery query %s", async query => {
    const response = await GET(new NextRequest(base + "?sourceHash=" + intent.sourceHash + "&" + query), context);
    expect(response.status).toBe(400); privateReply(response); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([["forbidden", 404], ["conflict", 409], ["unavailable", 503], ["credential_unavailable", 503], ["rate_limited", 429]] as const)("preserves queue refusal %s", async (kind, status) => {
    mocks.queue.mockRejectedValue(new PublicTranslationQueueError(kind, status)); const response = await POST(post(), context);
    expect(response.status).toBe(status); privateReply(response); expect(await response.json()).toEqual({ kind, error: expect.any(String) });
    if (status === 429) expect(response.headers.get("retry-after")).toBe("300");
  });
  it("does not fall back to cached words when public recovery access is refused", async () => {
    mocks.read.mockRejectedValue(new PublicTranslationQueueError("forbidden", 404)); mocks.cache.mockResolvedValue("SYNTHETIC private words");
    const response = await GET(get({ ...intent, requestId }), context); expect(response.status).toBe(404); expect(await response.json()).not.toHaveProperty("translated"); expect(mocks.cache).not.toHaveBeenCalled();
  });
  it("refuses a malformed retained response without exposing private fields", async () => {
    mocks.read.mockResolvedValue({ ...queued(), credential: "SYNTHETIC private" }); const response = await GET(get(), context);
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("SYNTHETIC private"); privateReply(response);
  });
  it("does not expose raw provider or database errors", async () => {
    mocks.queue.mockRejectedValue(new Error("SYNTHETIC private key error")); const response = await POST(post(), context);
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private key"); privateReply(response);
  });
});
