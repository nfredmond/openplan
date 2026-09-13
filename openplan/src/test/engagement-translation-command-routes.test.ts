import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/engagement/campaigns/[campaignId]/translations/commands/route";
import { GET } from "@/app/api/engagement/campaigns/[campaignId]/translations/snapshot/route";
import { TRANSLATION_WRITE_BODY_LIMIT, type TranslationWriteIntent, type TranslationWriteResult } from "@/lib/engagement/translation-write";
import type { TranslationSnapshot } from "@/lib/engagement/translation-snapshot";

const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), user: vi.fn(), access: vi.fn(), rpc: vi.fn(), from: vi.fn(),
  audit: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: mocks.audit }));

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaignId = id(1), workspaceId = id(2), userId = id(3), requestId = id(4);
const context = { params: Promise.resolve({ campaignId }) };
const client = { auth: { getUser: mocks.user }, rpc: mocks.rpc, from: mocks.from };
function intent(operation: "save" | "accept" | "withdraw" = "save"): TranslationWriteIntent {
  const entry = { entityType: "campaign" as const, entityId: campaignId, field: "title",
    expectedSource: { text: "\u00a0PRIVATE source\ufeff", sourceLocale: null, available: true }, expectedTranslation: { id: id(5), revision: 7 } };
  const common = { requestId, locale: "es", reason: "\u00a0PRIVATE reason\ufeff" };
  return operation === "save" ? { ...common, operation, entries: [{ ...entry, text: "\u00a0PRIVATE proposed words\ufeff" }] }
    : { ...common, operation, entries: [entry] };
}
function receipt(operation: "save" | "accept" | "withdraw" = "save"): TranslationWriteResult {
  return { campaignId, requestId, operation, locale: "es", replayed: false, entries: [{ entry: {
    id: id(5), workspace_id: workspaceId, campaign_id: campaignId, entity_type: "campaign", entity_id: campaignId,
    field: "title", locale: "es", translated_text: "\u00a0PRIVATE proposed words\ufeff", source: "operator", machine_model: null,
    source_text_hash: null, created_by: userId, updated_at: "2026-09-13T00:00:00Z",
  }, revision: 8, removed: operation === "withdraw" }] };
}
function snapshot(): TranslationSnapshot {
  return { schema: 1, campaignId, campaign: { id: campaignId, title: "\u00a0PRIVATE source\ufeff", summary: null,
    public_description: null, default_content_locale: null }, categories: [], questions: [], options: [], responses: [], translations: [],
    counts: { categories: 0, questions: 0, options: 0, responses: 0, translations: 0 } };
}
function request(body: unknown = intent()) {
  return new NextRequest("http://localhost/api/engagement/translation-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.audit.mockReturnValue({ info: mocks.info, warn: mocks.warn, error: mocks.error });
  mocks.client.mockResolvedValue(client);
  mocks.user.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.access.mockResolvedValue({ campaign: { id: campaignId, workspace_id: workspaceId }, allowed: true, error: null });
  mocks.from.mockImplementation(() => { throw new Error("No legacy table access is allowed here"); });
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === "write_engagement_translations") return { data: receipt(args.p_operation), error: null };
    if (name === "read_engagement_translation_snapshot") return { data: snapshot(), error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
});

describe("translation command routes", () => {
  it.each(["save", "accept", "withdraw"] as const)("sends the exact %s intent once through the caller's transaction", async operation => {
    const body = intent(operation);
    const response = await POST(request(body), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(receipt(operation));
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(client, campaignId, userId, "engagement.write");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("write_engagement_translations", {
      p_campaign: campaignId, p_request: requestId, p_operation: operation, p_locale: "es", p_reason: body.reason, p_entries: body.entries,
    });
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
    expect(JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls])).not.toContain("PRIVATE");
  });

  it("accepts a valid Unicode batch larger than the legacy transport cap", async () => {
    const body = intent(); if (body.operation !== "save") throw new Error("Fixture mismatch");
    body.entries = Array.from({ length: 200 }, (_, index) => ({ ...body.entries[0], entityType: "category", entityId: id(100 + index),
      field: "label", expectedTranslation: null, text: "😀".repeat(8000) }));
    const result = receipt();
    result.entries = body.entries.map((entry, index) => ({ entry: { ...result.entries[0].entry, id: id(500 + index),
      entity_type: entry.entityType, entity_id: entry.entityId, field: entry.field, translated_text: entry.text }, revision: 1, removed: false }));
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    expect((await POST(request(body), context)).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_entries).toEqual(body.entries);
  });

  it("cancels an oversize streamed body without reading the tail or touching the database", async () => {
    let reads = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      reads++;
      if (reads === 1) controller.enqueue(new Uint8Array(TRANSLATION_WRITE_BODY_LIMIT + 1));
      else controller.error(new Error("The oversize tail must not be read"));
    }, cancel }, { highWaterMark: 0 });
    const init = { method: "POST", body: stream, duplex: "half" as const };
    const response = await POST(new NextRequest("http://localhost/upload", init), context);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ maxBytes: 8 * 1024 * 1024 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(reads).toBe(1); expect(cancel).toHaveBeenCalledTimes(1); expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["json", "utf8", "intent"])("rejects malformed %s before database access", async bad => {
    const invalidUtf8 = new TextEncoder().encode(JSON.stringify({ ...intent(), reason: "~" }));
    invalidUtf8[invalidUtf8.indexOf(0x7e)] = 0xff;
    const bytes = bad === "utf8" ? invalidUtf8 : bad === "json" ? "{" : JSON.stringify({ ...intent(), requestId: undefined });
    const response = await POST(new NextRequest("http://localhost/upload", { method: "POST", body: bytes }), context);
    expect(response.status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([["PT409", 409, "conflict"], ["42501", 403, "forbidden"], ["22023", 400, "invalid"], ["PT503", 503, "unavailable"]] as const)
  ("preserves %s refusal without returning a saved receipt", async (code, status, kind) => {
    mocks.rpc.mockResolvedValue({ data: receipt(), error: { code, message: "PRIVATE database detail" } });
    const response = await POST(request(), context);
    expect(response.status).toBe(status);
    const body = await response.json(); expect(body.kind).toBe(kind); expect(body).not.toHaveProperty("entries");
    expect(JSON.stringify(body)).not.toContain("PRIVATE"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns the original replay without rereading a later source or creating another identity", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("PRIVATE lost acknowledgement"));
    expect((await POST(request(), context)).status).toBe(503);
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt(), replayed: true }, error: null });
    const response = await POST(request(), context);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ requestId, replayed: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not confirm a reply belonging to a different workspace", async () => {
    const result = receipt(); result.entries[0].entry.workspace_id = id(99);
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    const response = await POST(request(), context);
    expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty("entries");
  });
});

describe.each(["write", "snapshot"] as const)("%s translation access", mode => {
  const handle = mode === "write" ? POST : GET;
  it("validates campaign identity before creating a client", async () => {
    expect((await handle(request(), { params: Promise.resolve({ campaignId: "bad" }) })).status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([["unauthenticated", 401], ["denied", 403], ["missing", 404], ["unreadable", 503], ["throws", 503]] as const)
  ("refuses %s before the RPC", async (state, status) => {
    if (state === "unauthenticated") mocks.user.mockResolvedValue({ data: { user: null } });
    else if (state === "throws") mocks.client.mockRejectedValue(new Error("PRIVATE unavailable client"));
    else mocks.access.mockResolvedValue({ campaign: state === "missing" ? null : { id: campaignId, workspace_id: workspaceId },
      allowed: state !== "denied", error: state === "unreadable" ? { message: "PRIVATE access failure" } : null });
    const response = await handle(request(), context);
    expect(response.status).toBe(status); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
});

describe("translation snapshot route", () => {
  it("returns the complete raw snapshot with viewer permission through one RPC", async () => {
    const response = await GET(new NextRequest("http://localhost/snapshot"), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ snapshot: snapshot() });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(client, campaignId, userId, "engagement.read");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_translation_snapshot", { p_campaign: campaignId });
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(["partial", "error", "throws"])("withholds a %s snapshot instead of claiming no translations", async failure => {
    if (failure === "throws") mocks.rpc.mockRejectedValue(new Error("PRIVATE read failed"));
    else {
      const data = snapshot(); if (failure === "partial") data.counts.translations = 1;
      mocks.rpc.mockResolvedValue({ data, error: failure === "error" ? { code: "42501", message: "PRIVATE" } : null });
    }
    const response = await GET(new NextRequest("http://localhost/snapshot"), context);
    expect(response.status).toBe(503);
    const body = await response.json(); expect(body).not.toHaveProperty("snapshot");
    expect(JSON.stringify(body)).not.toContain("PRIVATE"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
