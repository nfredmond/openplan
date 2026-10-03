import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/generation/history/route";
import { verifySynthesisRequestHistory } from "@/lib/engagement/synthesis-request-history";

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), access: vi.fn(), rpc: vi.fn(), info: vi.fn(), warn: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
const id = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: id(1), workspaceId: id(2), sourceId: id(3), sourceSha256: "a".repeat(64) };
const actor = id(4), date = "2026-10-02T00:00:00.123456Z";
const row = (n: number) => ({ requestId: id(n), actorId: actor, intentSha256: "b".repeat(64),
  createdAt: date, stage: "segment" as "segment" | "context" | "thematic", parentRequestId: null as string | null, cancelled: false });
const page = (length = 3) => ({ schemaVersion: 1, ...scope, pageSize: 25,
  entries: Array.from({ length }, (_, index) => row(100 - index)), nextCursor: null as null | { id: string; createdAt: string } });
const client = { auth: { getUser: mocks.user }, rpc: (name: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => mocks.rpc(name, args, signal) }) };
const headers = { "x-openplan-expected-user": actor, "x-openplan-expected-workspace": scope.workspaceId };
function request(query: Record<string, string> = {}, extra: Record<string, string> = {}, signal?: AbortSignal) {
  return new NextRequest(`http://localhost/api/engagement/campaigns/${scope.campaignId}/synthesis/generation/history?${new URLSearchParams({ sourceId: scope.sourceId, sourceSha256: scope.sourceSha256, ...query })}`,
    { headers: { ...headers, ...extra }, signal });
}
const context = { params: Promise.resolve({ campaignId: scope.campaignId }) };
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  mocks.client.mockResolvedValue(client);
  mocks.user.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: scope.workspaceId }, allowed: true, error: null });
  mocks.rpc.mockResolvedValue({ data: page(), error: null });
});

describe("retained generation history verification", () => {
  it("accepts all stages and a cancelled request without assigning execution meaning", () => {
    const saved = page(); saved.entries[1].stage = "context"; saved.entries[1].parentRequestId = id(9);
    saved.entries[2].stage = "thematic"; saved.entries[2].parentRequestId = id(9); saved.entries[2].cancelled = true;
    expect(verifySynthesisRequestHistory(saved, scope)).toEqual(saved);
    expect(verifySynthesisRequestHistory(page(0), scope).entries).toEqual([]);
  });
  it("preserves full timestamp precision and timezone equivalence across page boundaries", () => {
    const saved = page(2); saved.entries[0].createdAt = "2026-10-02T01:00:00.123455+01:00";
    saved.entries[1].createdAt = "2026-10-02T00:00:00.123454Z";
    saved.entries[1].requestId = id(999);
    expect(verifySynthesisRequestHistory(saved, scope, { id: id(1), createdAt: date })).toEqual(saved);
  });
  it("accepts a full page with an exact tail cursor", () => {
    const saved = page(25), last = saved.entries.at(-1)!;
    saved.nextCursor = { id: last.requestId, createdAt: last.createdAt };
    expect(verifySynthesisRequestHistory(saved, scope)).toEqual(saved);
  });
  it.each(["campaignId", "workspaceId", "sourceId", "sourceSha256"] as const)("rejects changed %s", field => {
    const saved = page(); saved[field] = field === "sourceSha256" ? "c".repeat(64) : id(900);
    expect(() => verifySynthesisRequestHistory(saved, scope)).toThrow("source differs");
  });
  it.each(["duplicate", "order", "segment-parent", "missing-parent", "self-parent", "short-cursor", "wrong-cursor-id", "wrong-cursor-time", "same-before", "newer-before"])("rejects %s", kind => {
    const saved = page(); let before = null;
    if (kind === "duplicate") { saved.entries[1].requestId = saved.entries[0].requestId; saved.entries[1].createdAt = "2026-10-01T00:00:00Z"; saved.entries.length = 2; }
    if (kind === "order") saved.entries.reverse();
    if (kind === "segment-parent") saved.entries[0].parentRequestId = id(9);
    if (kind === "missing-parent") saved.entries[0].stage = "context";
    if (kind === "self-parent") { saved.entries[0].stage = "thematic"; saved.entries[0].parentRequestId = saved.entries[0].requestId; }
    if (kind.includes("cursor")) {
      if (kind !== "short-cursor") saved.entries = page(25).entries;
      const last = saved.entries.at(-1)!;
      saved.nextCursor = { id: kind === "wrong-cursor-id" ? id(1) : last.requestId,
        createdAt: kind === "wrong-cursor-time" ? "2026-10-01T00:00:00Z" : last.createdAt };
    }
    if (kind.endsWith("before")) before = { id: saved.entries[0].requestId, createdAt: kind === "same-before" ? date : "2026-10-01T00:00:00Z" };
    expect(() => verifySynthesisRequestHistory(saved, scope, before)).toThrow(/Generation history/);
  });
  it.each(["oversized", "unknown-stage", "extra-field", "bad-date", "fraction-overflow"])("refuses malformed %s", kind => {
    const saved: unknown = kind === "oversized" ? page(26) : kind === "extra-field" ? { ...page(), extra: true }
      : { ...page(), entries: [{ ...row(100), ...(kind === "unknown-stage" ? { stage: "complete" } : { createdAt: kind === "bad-date" ? "yesterday" : "2026-10-02T00:00:00.1234567Z" }) }] };
    expect(() => verifySynthesisRequestHistory(saved, scope)).toThrow();
  });
});

describe("generation history HTTP boundary", () => {
  it("uses current staff access, exact source and bounded native reads without service authority", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(page());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(client, scope.campaignId, actor, "engagement.write");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("list_engagement_synthesis_generation_requests", {
      p_campaign: scope.campaignId, p_source: scope.sourceId, p_before: null,
    }, expect.any(AbortSignal));
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("history_listed", { entries: 3, hasMore: false });
  });
  it("forwards both cursor fields without losing microseconds", async () => {
    const before = { id: id(900), createdAt: date };
    const response = await GET(request({ beforeId: before.id, beforeCreatedAt: before.createdAt }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_before).toEqual(before);
  });
  it.each(["anonymous", "auth-error", "access-error", "missing-campaign", "denied", "user-change", "workspace-change", "user-missing", "workspace-missing"])("refuses %s before native access", async kind => {
    const extra: Record<string, string> = {};
    if (kind === "anonymous") mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    if (kind === "auth-error") mocks.user.mockResolvedValue({ data: { user: { id: actor } }, error: new Error("PRIVATE auth") });
    if (kind === "access-error") mocks.access.mockResolvedValue({ campaign: { workspace_id: scope.workspaceId }, allowed: true, error: "PRIVATE access" });
    if (kind === "missing-campaign") mocks.access.mockResolvedValue({ campaign: null, allowed: true, error: null });
    if (kind === "denied") mocks.access.mockResolvedValue({ campaign: { workspace_id: scope.workspaceId }, allowed: false, error: null });
    if (kind.startsWith("user-")) extra["x-openplan-expected-user"] = kind.endsWith("missing") ? "" : id(900);
    if (kind.startsWith("workspace-")) extra["x-openplan-expected-workspace"] = kind.endsWith("missing") ? "" : id(900);
    const response = await GET(request({}, extra), context);
    expect(response.status).toBe(kind === "anonymous" || kind === "auth-error" ? 401 : kind === "access-error" ? 503 : 403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ beforeId: id(9) }, { beforeCreatedAt: date }, { extra: "field" }, { sourceId: "wrong" }, { sourceSha256: "wrong" }, { beforeId: id(9), beforeCreatedAt: "2026-10-02" }])("refuses malformed query %j", async query => {
    const response = await GET(request(query), context); expect(response.status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rejects duplicate query fields and invalid campaign IDs", async () => {
    const original = request();
    expect((await GET(new NextRequest(`${original.url}&sourceId=${scope.sourceId}`, { headers }), context)).status).toBe(400);
    expect((await GET(request(), { params: Promise.resolve({ campaignId: "bad" }) })).status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["22023", 400], ["PT503", 503], ["PRIVATE", 503]] as const)("maps native %s without private details", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE payload" } });
    const response = await GET(request(), context); expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
  it("rejects wrong-source native data", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...page(), sourceSha256: "c".repeat(64) }, error: null });
    const response = await GET(request(), context); expect(response.status).toBe(503); expect(mocks.info).not.toHaveBeenCalled();
  });
  it("does not accept a late response after the caller stops", async () => {
    const controller = new AbortController();
    mocks.rpc.mockImplementation(async (_name, _args, signal: AbortSignal) => {
      controller.abort(); expect(signal.aborted).toBe(true); return { data: page(), error: null };
    });
    expect((await GET(request({}, {}, controller.signal), context)).status).toBe(503);
  });
  it("bounds the native deadline and refuses its late response", async () => {
    const controller = new AbortController(), timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    mocks.rpc.mockImplementation(async (_name, _args, signal: AbortSignal) => {
      controller.abort(); expect(signal.aborted).toBe(true); return { data: page(), error: null };
    });
    expect((await GET(request(), context)).status).toBe(503); expect(timeout).toHaveBeenCalledWith(10_000);
  });
  it("refuses a pre-aborted read before native dispatch", async () => {
    expect((await GET(request({}, {}, AbortSignal.abort()), context)).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
