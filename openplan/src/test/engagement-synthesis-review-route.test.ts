import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSynthesisReviewContent } from "@/lib/engagement/synthesis-review";
import { makeSourceSnapshot, savedSource, sourceActor, sourceDate, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), persist: vi.fn(), getUser: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } }), createServiceRoleClient: () => ({ rpc: mocks.persist }) }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: (...args: unknown[]) => mocks.access(...args) }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/reviews/route";
const reviewId = "e0000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ campaignId: sourceScope.campaignId }) };
const path = `http://localhost/api/engagement/campaigns/${sourceScope.campaignId}/synthesis/reviews`;
const source = savedSource(), initial = createSynthesisReviewContent(makeSourceSnapshot(), source.snapshotSha256);
const intent = { operation: "create", requestId: reviewId, actorId: sourceActor, workspaceId: sourceScope.workspaceId, sourceId: sourceScope.requestId, sourceSha256: source.snapshotSha256 };
const preparationText = JSON.stringify(initial.preparation), contentText = JSON.stringify(initial.content);
const record = { reviewId, campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, sourceId: sourceScope.requestId, sourceSha256: source.snapshotSha256,
  preparationText, preparationSha256: sourceHash(preparationText), createdAt: sourceDate, createdBy: sourceActor, currentRevisionId: reviewId,
  revision: { requestId: reviewId, revisionNo: 1, parentId: null, parentSha256: null, actorId: sourceActor, reason: null, intent,
    contentText, contentSha256: sourceHash(contentText), createdAt: sourceDate } };
const receipt = { requestId: reviewId, reviewId, campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, sourceId: sourceScope.requestId,
  sourceSha256: source.snapshotSha256, preparationSha256: sourceHash(preparationText), revisionSha256: sourceHash(contentText), revisionNo: 1, createdAt: sourceDate, replayed: false };
const reviewPage = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, sourceId: sourceScope.requestId, pageSize: 25,
  entries: [{ reviewId, createdAt: sourceDate, revisionNo: 1, revisionSha256: record.revision.contentSha256, title: initial.content.title }], nextCursor: null };
const revisionEntry = { requestId: reviewId, revisionNo: 1, parentId: null, parentSha256: null, revisionSha256: record.revision.contentSha256, actorId: sourceActor, reason: null, createdAt: sourceDate };
const revisionPage = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, reviewId, pageSize: 25, entries: [revisionEntry], nextCursor: null };
function post(body: unknown = intent, headers: Record<string, string> = {}) {
  return new NextRequest(path, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const get = (query = `mode=read&reviewId=${reviewId}`, headers: Record<string, string> = {}) => new NextRequest(`${path}?${query}`, { headers });
beforeEach(() => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: sourceActor } } });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: sourceScope.workspaceId }, allowed: true, error: null });
  mocks.rpc.mockReset(); mocks.persist.mockReset();
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "read_engagement_synthesis_sources" ? source : name === "list_engagement_synthesis_reviews" ? reviewPage : name === "list_engagement_synthesis_review_revisions" ? revisionPage : null, error: null }));
  mocks.persist.mockResolvedValue({ data: receipt, error: null });
});
describe("retained synthesis review API", () => {
  it("creates through real source verification and recovers an exact saved request", async () => {
    const created = await POST(post(), context); expect(created.status).toBe(201); expect(await created.json()).toEqual(receipt);
    expect(created.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.persist).toHaveBeenCalledWith("retain_engagement_synthesis_review", { p_campaign: sourceScope.campaignId, p_actor: sourceActor, p_workspace: sourceScope.workspaceId,
      p_intent: intent, p_source: source.requestId, p_source_sha256: source.snapshotSha256, p_preparation_text: preparationText, p_content_text: contentText });
    mocks.rpc.mockResolvedValueOnce({ data: record, error: null }); mocks.persist.mockClear();
    const retry = await POST(post(), context); expect(retry.status).toBe(200); expect(await retry.json()).toEqual({ ...receipt, replayed: true }); expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), sourceScope.campaignId, sourceActor, "engagement.write");
  });
  it("reads a verified review and distinguishes absent work from failed or corrupt reads", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: record, error: null });
    const read = await GET(get(), context); expect(read.status).toBe(200); expect(read.headers.get("cache-control")).toBe("private, no-store");
    const body = await read.json(); expect(body.content).toEqual(initial.content); expect(body.preparation).toEqual(initial.preparation); expect(body.source).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith("read_engagement_synthesis_review", { p_campaign: sourceScope.campaignId, p_review: reviewId, p_revision: null });
    expect((await GET(get(`mode=read&reviewId=${reviewId}&revisionId=${reviewId}`), context)).status).toBe(404);
    expect(mocks.rpc).toHaveBeenLastCalledWith("read_engagement_synthesis_review", { p_campaign: sourceScope.campaignId, p_review: reviewId, p_revision: reviewId });
    for (const result of [{ data: null, error: { code: "XX000" } }, { data: { ...record, preparationSha256: "a".repeat(64) }, error: null }]) {
      mocks.rpc.mockResolvedValueOnce(result); const response = await GET(get(), context); expect(response.status).toBe(503); expect((await response.json()).content).toBeUndefined();
    }
  });
  it("lists both private histories with complete typed cursors", async () => {
    const reviews = await GET(get(`mode=reviews&sourceId=${source.requestId}&${new URLSearchParams({ beforeId: reviewId, beforeCreatedAt: sourceDate })}`), context);
    expect(reviews.status).toBe(200); expect(await reviews.json()).toEqual(reviewPage);
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_engagement_synthesis_reviews", { p_campaign: sourceScope.campaignId, p_source: source.requestId, p_before: { id: reviewId, createdAt: sourceDate } });
    const revisions = await GET(get(`mode=revisions&reviewId=${reviewId}&before=26`), context);
    expect(revisions.status).toBe(200); expect(await revisions.json()).toEqual(revisionPage);
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_engagement_synthesis_review_revisions", { p_campaign: sourceScope.campaignId, p_review: reviewId, p_before: 26 });
  });
  it("protects both read and write against missing staff access and changed identities", async () => {
    for (const method of [GET, POST]) {
      const request = () => method === GET ? get() : post();
      mocks.getUser.mockResolvedValueOnce({ data: { user: null } }); expect((await method(request(), context)).status).toBe(401);
      mocks.access.mockResolvedValueOnce({ campaign: null, allowed: false }); expect((await method(request(), context)).status).toBe(403);
      mocks.access.mockResolvedValueOnce({ campaign: { workspace_id: sourceScope.workspaceId }, allowed: false }); expect((await method(request(), context)).status).toBe(403);
      mocks.access.mockResolvedValueOnce({ error: { message: "SYNTHETIC outage" } }); expect((await method(request(), context)).status).toBe(503);
      for (const key of ["x-openplan-expected-user", "x-openplan-expected-workspace"]) {
        const req = method === GET ? get(undefined, { [key]: reviewId }) : post(intent, { [key]: reviewId });
        expect((await method(req, context)).status).toBe(403);
      }
    }
    for (const key of ["actorId", "workspaceId"]) expect((await POST(post({ ...intent, [key]: reviewId }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("requires the real browser origin and refuses every unsupported agent write marker", async () => {
    expect((await POST(post(intent, { origin: "https://foreign.invalid" }), context)).status).toBe(403);
    for (const key of ["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"]) expect((await POST(post(intent, { [key]: "SYNTHETIC" }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("bounds commands, rejects machine bytes and malformed input before querying", async () => {
    const huge = await POST(post({ ...intent, padding: "x".repeat(70_000) }), context); expect(huge.status).toBe(413); expect(huge.headers.get("cache-control")).toBe("private, no-store");
    for (const body of [{ ...intent, preparationText }, { ...intent, requestId: "bad" }]) expect((await POST(post(body), context)).status).toBe(400);
    expect((await POST(new NextRequest(path, { method: "POST", headers: { origin: "http://localhost" }, body: "{" }), context)).status).toBe(400);
    const invalid = { params: Promise.resolve({ campaignId: "invalid" }) };
    expect((await POST(post(), invalid)).status).toBe(400); expect((await GET(get(), invalid)).status).toBe(400);
    for (const query of ["mode=read", `mode=read&reviewId=${reviewId}&reviewId=${reviewId}`, `mode=read&reviewId=${reviewId}&before=1`,
      `mode=reviews&sourceId=${source.requestId}&beforeId=${reviewId}`, `mode=reviews&sourceId=${source.requestId}&beforeCreatedAt=${sourceDate}`,
      `mode=revisions&reviewId=${reviewId}&before=0`, `mode=revisions&reviewId=${reviewId}&before=2147483648`, `mode=revisions&reviewId=${reviewId}&before=1.5`]) expect((await GET(get(query), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("does not acknowledge failed, conflicting or corrupt saves", async () => {
    for (const [code, status] of [["PT409", 409], ["22023", 400], ["42501", 403], ["XX000", 503]]) {
      mocks.persist.mockResolvedValueOnce({ data: null, error: { code } }); const response = await POST(post(), context); expect(response.status).toBe(status); expect((await response.json()).revisionSha256).toBeUndefined();
    }
    mocks.persist.mockResolvedValueOnce({ data: { ...receipt, revisionSha256: "a".repeat(64) }, error: null }); expect((await POST(post(), context)).status).toBe(503);
  });
  it("refuses foreign or failed history without presenting it as an empty page", async () => {
    for (const mode of ["reviews", "revisions"]) {
      const page = mode === "reviews" ? reviewPage : revisionPage, query = mode === "reviews" ? `mode=reviews&sourceId=${source.requestId}` : `mode=revisions&reviewId=${reviewId}`;
      for (const patch of [{ campaignId: reviewId }, { workspaceId: reviewId }, mode === "reviews" ? { sourceId: reviewId } : { reviewId: sourceActor }]) {
        mocks.rpc.mockResolvedValueOnce({ data: { ...page, ...patch }, error: null }); expect((await GET(get(query), context)).status).toBe(503);
      }
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } }); expect((await GET(get(query), context)).status).toBe(503);
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } }); expect((await GET(get(query), context)).status).toBe(403);
    }
  });
  it("checks history page identities and continuation while accepting full valid pages", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `e0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    const roots = { ...reviewPage, entries: ids.map(id => ({ ...reviewPage.entries[0], reviewId: id })), nextCursor: { id: ids[24], createdAt: sourceDate } };
    const revisions = { ...revisionPage, entries: ids.map((id, i) => ({ ...revisionEntry, requestId: id, revisionNo: 30 - i })), nextCursor: 6 };
    for (const [query, good, broken] of [
      [`mode=reviews&sourceId=${source.requestId}`, roots, [ { ...roots, entries: [...roots.entries.slice(1), roots.entries[24]] }, { ...roots, nextCursor: { id: reviewId, createdAt: sourceDate } }, { ...roots, nextCursor: { id: ids[24], createdAt: "2026-01-01T00:00:00Z" } }, { ...roots, entries: roots.entries.slice(1) } ]],
      [`mode=revisions&reviewId=${reviewId}`, revisions, [ { ...revisions, entries: revisions.entries.map((row, i) => i === 0 ? { ...row, requestId: ids[1] } : row) }, { ...revisions, entries: revisions.entries.map((row, i) => i === 0 ? { ...row, revisionNo: 29 } : row) }, { ...revisions, nextCursor: 7 }, { ...revisions, entries: revisions.entries.slice(1) } ]],
    ] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: good, error: null }); expect((await GET(get(query), context)).status).toBe(200);
      for (const data of broken) { mocks.rpc.mockResolvedValueOnce({ data, error: null }); expect((await GET(get(query), context)).status).toBe(503); }
    }
  });
});
