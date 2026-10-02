import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SynthesisResponseLinkError } from "@/lib/engagement/synthesis-response-links-server";
import { readSynthesisResponseLinkAcknowledgement, synthesisResponseLinkIntentSchema } from "@/lib/engagement/synthesis-response-link";
import { event, fixture, packet, id } from "./fixtures/engagement/synthesis-response-link";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), access: vi.fn(), index: vi.fn(), choices: vi.fn(), context: vi.fn(), history: vi.fn(), retain: vi.fn(), info: vi.fn(), error: vi.fn(), service: { rpc: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }), createServiceRoleClient: () => mocks.service }));
vi.mock("@/lib/engagement/close-loop", async original => ({ ...await original<typeof import("@/lib/engagement/close-loop")>(), loadCloseLoopEntries: (...args: unknown[]) => mocks.choices(...args) }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: (...args: unknown[]) => mocks.access(...args) }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, error: mocks.error }) }));
vi.mock("@/lib/engagement/synthesis-response-index-server", () => ({ loadSynthesisResponseLinkIndex: (...args: unknown[]) => mocks.index(...args) }));
vi.mock("@/lib/engagement/synthesis-response-write-server", () => ({ loadSynthesisResponseLinkHistory: (...args: unknown[]) => mocks.history(...args), retainSynthesisResponseLinkCommand: (...args: unknown[]) => mocks.retain(...args) }));
vi.mock("@/lib/engagement/synthesis-response-links-server", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/engagement/synthesis-response-links-server")>(), loadSynthesisResponseContext: (...args: unknown[]) => mocks.context(...args) }));
import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/response-links/route";
const saved = event(fixture()), intent = synthesisResponseLinkIntentSchema.parse(saved.intent), retained = packet(saved);
const scope = { campaignId: intent.campaignId, workspaceId: intent.workspaceId, reviewId: intent.reviewId };
const address = { ...scope, responseId: intent.responseId, groupId: intent.groupId };
const index = { ...scope, entryCount: 1, entries: [{ responseId: intent.responseId, groupId: intent.groupId }] };
const head = { ...retained, intent, evidence: { privateEnrichment: true } };
const path = `http://localhost/api/engagement/campaigns/${scope.campaignId}/synthesis/response-links`;
const routeContext = { params: Promise.resolve({ campaignId: scope.campaignId }) };
const post = (body: unknown = intent, headers: Record<string, string> = {}) => new NextRequest(path, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (query = `mode=index&reviewId=${scope.reviewId}`, headers: Record<string, string> = {}) => new NextRequest(`${path}?${query}`, { headers });
const selectedQuery = (mode: string) => `mode=${mode}&reviewId=${scope.reviewId}&responseId=${intent.responseId}&groupId=${intent.groupId}`;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: intent.actorId } } });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: scope.workspaceId }, allowed: true, error: null });
  mocks.index.mockResolvedValue(index); mocks.choices.mockResolvedValue({ rows: [JSON.parse(fixture().responseHistory.recordText)], error: null }); mocks.context.mockResolvedValue({ packet: saved.context, evidence: "private enrichment" });
  mocks.history.mockResolvedValue({ scope: address, entries: [head], head });
  mocks.retain.mockResolvedValue({ event: { ...saved, ...retained, evidence: "private enrichment" }, replayed: false });
});

describe("private synthesis response link API", () => {
  it("binds compact commands to current staff and returns exact bytes without internal enrichment", async () => {
    const res = await POST(post(), routeContext); expect(res.status).toBe(201); expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json(); expect(body).toEqual({ event: retained, replayed: false });
    expect((await readSynthesisResponseLinkAcknowledgement(body, intent)).event.intent).toEqual(intent);
    expect(mocks.retain).toHaveBeenCalledExactlyOnceWith(expect.anything(), mocks.service, { campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: intent.actorId }, intent);
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), scope.campaignId, intent.actorId, "engagement.write");
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("synthesis_response_link_retained", { campaignId: scope.campaignId, reviewId: scope.reviewId, responseId: intent.responseId, requestId: intent.requestId, eventSha256: retained.eventSha256, operation: "link", replayed: false });
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain(intent.reason);
    mocks.retain.mockResolvedValueOnce({ event: { ...saved, ...retained }, replayed: true });
    const replay = await POST(post(), routeContext); expect(replay.status).toBe(200); expect(await replay.json()).toEqual({ event: retained, replayed: true });
  });
  it("returns the index and distinguishes missing review from an empty retained index", async () => {
    const res = await GET(get(), routeContext); expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ index }); expect(mocks.index).toHaveBeenCalledExactlyOnceWith(expect.anything(), scope);
    mocks.index.mockResolvedValueOnce({ ...scope, entryCount: 0, entries: [] });
    const empty = await GET(get(), routeContext); expect(empty.status).toBe(200); expect(await empty.json()).toEqual({ index: { ...scope, entryCount: 0, entries: [] } });
    mocks.index.mockResolvedValueOnce(null); expect((await GET(get(), routeContext)).status).toBe(404);
    expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled();
  });
  it("loads current response choices separately from retained addresses and preserves read failures", async () => {
    const request = () => get(`mode=responses&reviewId=${scope.reviewId}`);
    const res = await GET(request(), routeContext); expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ ...scope, responseCount: 1, responses: [JSON.parse(fixture().responseHistory.recordText)] });
    expect(mocks.choices).toHaveBeenCalledExactlyOnceWith(expect.anything(), scope.campaignId);
    mocks.choices.mockResolvedValueOnce({ rows: [], error: { message: "SYNTHETIC private failure" } });
    const failed = await GET(request(), routeContext); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("SYNTHETIC");
    mocks.choices.mockClear(); mocks.index.mockResolvedValueOnce(null);
    expect((await GET(request(), routeContext)).status).toBe(404); expect(mocks.choices).not.toHaveBeenCalled();
    mocks.choices.mockResolvedValueOnce({ rows: [], error: null });
    expect(await (await GET(request(), routeContext)).json()).toEqual({ ...scope, responseCount: 0, responses: [] });
  });
  it("returns exact current context and complete history with no enriched fields", async () => {
    const context = await GET(get(selectedQuery("context")), routeContext);
    expect(context.status).toBe(200); expect(context.headers.get("cache-control")).toBe("private, no-store"); expect(await context.json()).toEqual({ context: saved.context });
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith(expect.anything(), address, expect.objectContaining({ rpc: expect.any(Function) }));
    const history = await GET(get(selectedQuery("history")), routeContext);
    expect(history.status).toBe(200); expect(history.headers.get("cache-control")).toBe("private, no-store");
    expect(await history.json()).toEqual({ history: { ...address, eventCount: 1, headId: intent.requestId, headSha256: retained.eventSha256, entries: [retained] } });
    expect(mocks.history).toHaveBeenCalledExactlyOnceWith(expect.anything(), address);
    mocks.history.mockResolvedValueOnce({ scope: address, entries: [], head: null });
    expect(await (await GET(get(selectedQuery("history")), routeContext)).json()).toEqual({ history: { ...address, eventCount: 0, headId: null, headSha256: null, entries: [] } });
  });
  it("denies missing or changed staff access before private readers or writes", async () => {
    for (const method of [GET, POST]) {
      const request = () => method === GET ? get() : post();
      mocks.getUser.mockResolvedValueOnce({ data: { user: null } }); expect((await method(request(), routeContext)).status).toBe(401);
      mocks.access.mockResolvedValueOnce({ campaign: null, allowed: true }); expect((await method(request(), routeContext)).status).toBe(403);
      mocks.access.mockResolvedValueOnce({ campaign: { workspace_id: scope.workspaceId }, allowed: false }); expect((await method(request(), routeContext)).status).toBe(403);
      mocks.access.mockResolvedValueOnce({ error: new Error("SYNTHETIC private outage") }); expect((await method(request(), routeContext)).status).toBe(503);
      for (const key of ["x-openplan-expected-user", "x-openplan-expected-workspace"]) {
        const req = method === GET ? get(undefined, { [key]: id(90) }) : post(intent, { [key]: id(90) });
        expect((await method(req, routeContext)).status).toBe(403);
      }
    }
    expect(mocks.index).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.retain).not.toHaveBeenCalled();
  });
  it.each(["actorId", "workspaceId", "campaignId"] as const)("binds command %s to authenticated route scope", async field => {
    expect((await POST(post({ ...intent, [field]: id(90) }), routeContext)).status).toBe(403); expect(mocks.retain).not.toHaveBeenCalled();
  });
  it("requires browser origin and refuses each unregistered assistant marker", async () => {
    expect((await POST(post(intent, { origin: "https://foreign.invalid" }), routeContext)).status).toBe(403);
    for (const key of ["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"]) {
      expect((await POST(post(intent, { [key]: "SYNTHETIC" }), routeContext)).status).toBe(403);
    }
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.retain).not.toHaveBeenCalled();
  });
  it("rejects oversized, malformed and extra command content before database access", async () => {
    const huge = await POST(post({ ...intent, padding: "x".repeat(20_000) }), routeContext);
    expect(huge.status).toBe(413); expect(huge.headers.get("cache-control")).toBe("private, no-store");
    for (const body of [{ ...intent, contextText: saved.context.contextText }, { ...intent, requestId: "bad" }, { ...intent, reason: " " }]) expect((await POST(post(body), routeContext)).status).toBe(400);
    const encoded = JSON.stringify({ ...intent, reason: "REPLACE" }), position = encoded.indexOf("REPLACE"), encoder = new TextEncoder();
    const invalidUtf8 = new Uint8Array([...encoder.encode(encoded.slice(0, position)), 255, ...encoder.encode(encoded.slice(position + 7))]);
    for (const body of ["{", invalidUtf8]) expect((await POST(new NextRequest(path, { method: "POST", headers: { origin: "http://localhost" }, body }), routeContext)).status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.retain).not.toHaveBeenCalled();
  });
  it("rejects invalid routes, duplicate keys and unexpected query fields in every read mode", async () => {
    const bad = { params: Promise.resolve({ campaignId: "invalid" }) };
    expect((await GET(get(), bad)).status).toBe(400); expect((await POST(post(), bad)).status).toBe(400);
    for (const query of ["", "mode=other", "mode=index&reviewId=bad", `mode=index&reviewId=${scope.reviewId}&reviewId=${scope.reviewId}`, `mode=index&reviewId=${scope.reviewId}&public=true`, `${selectedQuery("history")}&public=true`, `${selectedQuery("context")}&public=true`, `mode=history&reviewId=${scope.reviewId}`, `mode=context&reviewId=${scope.reviewId}`]) expect((await GET(get(query), routeContext)).status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.index).not.toHaveBeenCalled(); expect(mocks.retain).not.toHaveBeenCalled();
  });
  it.each([["invalid", 400], ["forbidden", 403], ["conflict", 409], ["unavailable", 503]] as const)("preserves %s failures without disclosing private errors", async (kind, status) => {
    for (const mode of ["index", "context", "history", "post"]) {
      ({ index: mocks.index, context: mocks.context, history: mocks.history, post: mocks.retain })[mode]!.mockRejectedValueOnce(new SynthesisResponseLinkError(kind, "SYNTHETIC private details"));
      const res = mode === "post" ? await POST(post(), routeContext) : await GET(mode === "index" ? get() : get(selectedQuery(mode)), routeContext);
      expect(res.status).toBe(status); expect(res.headers.get("cache-control")).toBe("private, no-store"); expect(await res.text()).not.toContain("SYNTHETIC private details");
    }
  });
  it("returns unavailable after unexpected server failures and keeps exception text out of audit", async () => {
    mocks.retain.mockRejectedValueOnce(new Error("SYNTHETIC secret"));
    const res = await POST(post(), routeContext); expect(res.status).toBe(503); expect(await res.text()).not.toContain("SYNTHETIC secret");
    expect(mocks.info).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalledExactlyOnceWith("synthesis_response_link_unconfirmed");
    mocks.index.mockRejectedValueOnce(new Error("SYNTHETIC secret")); expect((await GET(get(), routeContext)).status).toBe(503);
  });
});
