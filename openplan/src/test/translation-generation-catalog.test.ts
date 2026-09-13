// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), user: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ warn: vi.fn() }) }));
import { GET } from "@/app/api/engagement/campaigns/[campaignId]/translations/generation/route";
import { readTranslationGenerationCatalog, type TranslationGenerationCatalog } from "@/lib/engagement/translation-generation-catalog";
const id = (n: number) => `73000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaignId = id(1), workspaceId = id(2), actorId = id(3);
const scope = { campaignId, workspaceId };
const timestamp = "2026-09-13T12:00:00.123456Z";
function page(length = 20): TranslationGenerationCatalog {
  const requests = Array.from({ length }, (_, i) => ({ id: id(100 - i), actorId, locale: "es" as const,
    createdAt: timestamp, fieldCount: 2, counts: { queued: 1, reserved: 0, running: 0, completed: 1, incomplete: 0, failed: 0, interrupted: 0, cancelled: 0 } }));
  return { schema: 1, ...scope, requests, next: length === 20 ? { createdAt: timestamp, id: requests.at(-1)!.id } : null };
}
const get = (query = "") => GET(new NextRequest(`http://localhost/generation${query}`), { params: Promise.resolve({ campaignId }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: actorId } } });
  mocks.access.mockResolvedValue({ campaign: { id: campaignId, workspace_id: workspaceId }, allowed: true, error: null });
  mocks.rpc.mockResolvedValue({ data: page(), error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, rpc: (name: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => { expect(signal).toBeInstanceOf(AbortSignal); return mocks.rpc(name, args); } }) });
});
describe("generation catalog route", () => {
  it("discovers retained requests without service credentials or browser storage", async () => {
    const response = await get();
    expect(response.status).toBe(200); expect(await response.json()).toEqual(page());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("list_translation_generation_requests", { p_campaign: campaignId, p_before_created_at: null, p_before_id: null });
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("passes all microseconds and UUID tie cursor to the caller's RPC", async () => {
    const result = page(1); result.requests[0].createdAt = "2026-09-13T12:00:00.123455Z";
    mocks.rpc.mockResolvedValueOnce({ data: result, error: null });
    expect((await get(`?beforeCreatedAt=${timestamp}&beforeId=${id(101)}`)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("list_translation_generation_requests", { p_campaign: campaignId, p_before_created_at: timestamp, p_before_id: id(101) });
  });
  it.each([`?beforeId=${id(101)}`, `?beforeCreatedAt=${timestamp}`, `?beforeCreatedAt=2026-09-13T12:00:00.123Z&beforeId=${id(101)}`, `?beforeCreatedAt=${timestamp}&beforeId=bad`, `?requestId=${id(5)}&beforeCreatedAt=${timestamp}&beforeId=${id(101)}`, "?requestId=bad"])("refuses malformed or ambiguous selector %s before authentication", async query => {
    expect((await get(query)).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["anonymous", "lookup_failed", "missing_campaign", "nonstaff"])("refuses %s before listing", async kind => {
    if (kind === "anonymous") mocks.user.mockResolvedValueOnce({ data: { user: null } });
    if (kind === "lookup_failed") mocks.access.mockResolvedValueOnce({ error: new Error("PRIVATE") });
    if (kind === "missing_campaign") mocks.access.mockResolvedValueOnce({ campaign: null, error: null });
    if (kind === "nonstaff") mocks.access.mockResolvedValueOnce({ campaign: { workspace_id: workspaceId }, allowed: false, error: null });
    const response = await get(); expect(response.status).toBe(({ anonymous: 401, lookup_failed: 503, missing_campaign: 404, nonstaff: 403 })[kind]);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["42501", "PT503"])("preserves database refusal %s", async code => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: "PRIVATE" } });
    const response = await get(); expect(response.status).toBe(code === "42501" ? 403 : 503); expect(await response.text()).not.toContain("PRIVATE");
  });
  it("refuses a foreign catalog before exposing request identities", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...page(), workspaceId: id(999) }, error: null });
    const response = await get(); expect(response.status).toBe(503); expect(await response.text()).not.toContain(id(100));
  });
});
describe("generation catalog boundaries", () => {
  it("accepts empty and terminal pages, UTC microseconds and equal-time UUID ties", () => {
    expect(readTranslationGenerationCatalog(page(0), scope).requests).toEqual([]);
    expect(readTranslationGenerationCatalog(page(), scope)).toEqual(page());
    const p = page(2); p.requests[1].createdAt = "2026-09-13T12:00:00.123455Z";
    expect(readTranslationGenerationCatalog(p, scope, { id: id(101), createdAt: timestamp })).toEqual(p);
  });
  it.each(["campaign", "workspace", "duplicate", "counts", "time_order", "uuid_order", "at_cursor", "after_cursor", "short_next", "next_id", "next_time", "extra_private", "overfull", "unknown_state", "millisecond", "unsupported_locale", "empty_fields"])("rejects inconsistent %s", kind => {
    const p = page(); let cursor: { id: string; createdAt: string } | null = null;
    if (kind === "campaign") p.campaignId = id(999);
    if (kind === "workspace") p.workspaceId = id(999);
    if (kind === "duplicate") { p.requests[1].id = p.requests[0].id; p.requests.slice(1).forEach(row => { row.createdAt = "2026-09-13T12:00:00.123455Z"; }); p.next!.createdAt = "2026-09-13T12:00:00.123455Z"; }
    if (kind === "counts") p.requests[0].counts.failed = 1;
    if (kind === "time_order") p.requests[1].createdAt = "2026-09-13T12:00:00.123457Z";
    if (kind === "uuid_order") p.requests[1].id = id(101);
    if (kind === "at_cursor") cursor = { id: p.requests[0].id, createdAt: timestamp };
    if (kind === "after_cursor") cursor = { id: id(101), createdAt: "2026-09-13T12:00:00.123455Z" };
    if (kind === "short_next") { p.requests.pop(); p.next = { id: p.requests.at(-1)!.id, createdAt: timestamp }; }
    if (kind === "next_id") p.next!.id = id(1);
    if (kind === "next_time") p.next!.createdAt = "2026-09-13T12:00:00.123455Z";
    if (kind === "extra_private") Object.assign(p.requests[0], { credential: "PRIVATE" });
    if (kind === "overfull") { p.requests.push({ ...p.requests[0], id: id(79) }); p.next = null; }
    if (kind === "unknown_state") Object.assign(p.requests[0].counts, { made_up: 0 });
    if (kind === "millisecond") { p.requests.forEach(row => { row.createdAt = "2026-09-13T12:00:00.123Z"; }); p.next!.createdAt = "2026-09-13T12:00:00.123Z"; }
    if (kind === "unsupported_locale") Object.assign(p.requests[0], { locale: "made_up" });
    if (kind === "empty_fields") { p.requests[0].fieldCount = 0; p.requests[0].counts.queued = 0; p.requests[0].counts.completed = 0; }
    expect(() => readTranslationGenerationCatalog(p, scope, cursor)).toThrow();
  });
});
