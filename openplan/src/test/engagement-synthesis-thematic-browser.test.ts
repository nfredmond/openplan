import { randomUUID, webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/proposals/route";
import { inspectThematicPreview } from "@/lib/engagement/synthesis-thematic-browser";
import { synthesisThematicHistoryFixture } from "./fixtures/engagement/synthesis-thematic-history";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";
import { verifySynthesisSource } from "@/lib/engagement/synthesis-sources-server";

const state = vi.hoisted(() => ({ client: undefined as unknown, service: undefined as unknown, campaign: undefined as unknown,
  allowed: true, accessError: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client, createServiceRoleClient: () => state.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: async () => ({ campaign: state.campaign, allowed: state.allowed, error: state.accessError }) }));
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); state.allowed = true; state.accessError = null; });
async function fixture() {
  const f = await synthesisThematicHistoryFixture(), userId = randomUUID();
  const source = verifySynthesisSource(f.prepared.source, { requestId: f.prepared.source.requestId, campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId });
  const scope = { campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId, sourceId: source.requestId, sourceSha256: source.snapshotSha256 };
  const page = { schemaVersion: 1, ...scope, pageSize: 25, entries: [{ requestId: f.scope.requestId, createdAt: source.createdAt,
    actorId: f.request.request.actorId, parentRequestId: f.request.thematic.parentRequestId, cancelled: false }], nextCursor: null };
  const options = { page: page as unknown, error: null as null | { code: string }, signedIn: true };
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    if (name !== "list_engagement_synthesis_thematic_requests") return f.client.rpc(name, args);
    const result = Promise.resolve({ data: options.page, error: options.error });
    return Object.assign(result, { abortSignal: (_signal: AbortSignal) => result });
  });
  state.client = { rpc, auth: { getUser: async () => ({ data: { user: options.signedIn ? { id: userId } : null } }) } };
  state.service = f.service; state.campaign = { id: scope.campaignId, workspace_id: scope.workspaceId };
  const query = (patch: Record<string, string> = {}) => new URLSearchParams({ mode: "preview", sourceId: scope.sourceId, sourceSha256: scope.sourceSha256, requestId: f.scope.requestId, ...patch });
  const call = (params: URLSearchParams = query(), headers: Record<string, string> = {}, campaignId = scope.campaignId) => GET(new NextRequest(`http://localhost/api/engagement/campaigns/${campaignId}/synthesis/proposals?${params}`, {
    headers: { "x-openplan-expected-user": userId, "x-openplan-expected-workspace": scope.workspaceId, ...headers },
  }), { params: Promise.resolve({ campaignId }) });
  return { f, scope, source, userId, page, options, rpc, query, call,
    list: () => new URLSearchParams({ mode: "list", sourceId: scope.sourceId, sourceSha256: scope.sourceSha256 }) };
}

describe("thematic proposal browsing and transport checks", () => {
  it("joins the actual preview route to original history and browser byte inspection", async () => {
    const x = await fixture(); x.f.cancel();
    const result = await x.call(); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
    const raw = await result.json(), read = await inspectThematicPreview(raw, x.scope, x.f.scope.requestId, x.source.snapshot);
    expect(read.preview.status).toBe("proposal_complete"); expect(read.preview.cancelled).toBe(true);
    expect(read.proposal?.contextEvidence).toEqual(x.f.prepared.input.contexts.toSorted((a,b) => a.sourceId < b.sourceId ? -1 : 1));
    expect(read.proposal?.thematicUncertainties).toEqual(x.f.final.output.uncertainties);
    expect(read.preview.origin?.proposalText).toBe((await x.f.load()).proposal?.canonical);
    expect(x.f.serviceRpc).not.toHaveBeenCalled();
  });
  it("returns incomplete and unsealed states without manufacturing an importable proposal", async () => {
    const x = await fixture();
    const partial = await x.call(x.query({ throughSequence: "0" }));
    expect(partial.status).toBe(200); const raw = await partial.json();
    expect(raw).toMatchObject({ status: "incomplete", selectionSequence: 0, origin: null });
    expect((await inspectThematicPreview(raw, x.scope, x.f.scope.requestId, x.source.snapshot)).proposal).toBeNull();
    x.f.historyOptions.missingSeal = true;
    const unsealed = await x.call(); expect(unsealed.status).toBe(200);
    expect(await unsealed.json()).toMatchObject({ status: "inputs_not_sealed", selectionSequence: null, origin: null });
  });
  it("reads bounded native discovery and carries the exact continuation cursor", async () => {
    const x = await fixture(), query = x.list();
    query.set("beforeId", randomUUID()); query.set("beforeCreatedAt", x.source.createdAt);
    const response = await x.call(query); expect(response.status).toBe(200); expect(await response.json()).toEqual(x.page);
    expect(x.rpc).toHaveBeenCalledWith("list_engagement_synthesis_thematic_requests", { p_campaign: x.scope.campaignId, p_source: x.scope.sourceId,
      p_before: { id: query.get("beforeId"), createdAt: x.source.createdAt } });
    expect(x.f.serviceRpc).not.toHaveBeenCalled(); expect(x.f.calls).toHaveLength(0);
  });
  it("refuses foreign, duplicated and mismatched discovery responses", async () => {
    const x = await fixture();
    for (const key of Object.keys(x.scope) as Array<keyof typeof x.scope>) {
      x.options.page = { ...x.page, [key]: key === "sourceSha256" ? "0".repeat(64) : randomUUID() };
      expect((await x.call(x.list())).status).toBe(503);
    }
    x.options.page = { ...x.page, entries: [x.page.entries[0], x.page.entries[0]] };
    expect((await x.call(x.list())).status).toBe(503);
    x.options.page = { ...x.page, nextCursor: { id: randomUUID(), createdAt: x.source.createdAt } };
    expect((await x.call(x.list())).status).toBe(503);
    const fullEntries = Array.from({ length: 25 }, () => ({ ...x.page.entries[0], requestId: randomUUID() }));
    const full = { ...x.page, entries: fullEntries, nextCursor: { id: fullEntries.at(-1)!.requestId, createdAt: x.source.createdAt } };
    x.options.page = full; expect((await x.call(x.list())).status).toBe(200);
    x.options.page = { ...full, nextCursor: { ...full.nextCursor, id: randomUUID() } }; expect((await x.call(x.list())).status).toBe(503);
    x.options.page = { ...full, nextCursor: { ...full.nextCursor, createdAt: "2026-09-29T00:00:00Z" } }; expect((await x.call(x.list())).status).toBe(503);
    x.options.page = x.page; x.options.error = { code: "42501" }; expect((await x.call(x.list())).status).toBe(403);
    x.options.error = { code: "other" }; expect((await x.call(x.list())).status).toBe(503);
  });
  it("checks authentication, staff access and expected account before reading private history", async () => {
    const x = await fixture(); x.options.signedIn = false; expect((await x.call()).status).toBe(401);
    x.options.signedIn = true; state.allowed = false; expect((await x.call()).status).toBe(403);
    state.allowed = true; state.accessError = "SYNTHETIC unavailable"; expect((await x.call()).status).toBe(503);
    state.accessError = null; state.campaign = null; expect((await x.call()).status).toBe(403);
    state.campaign = { id: x.scope.campaignId, workspace_id: x.scope.workspaceId };
    expect((await x.call(x.query(), { "x-openplan-expected-user": randomUUID() })).status).toBe(403);
    expect((await x.call(x.query(), { "x-openplan-expected-workspace": randomUUID() })).status).toBe(403);
    expect(x.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed, duplicate and incomplete query identities", async () => {
    const x = await fixture();
    const invalidQueries: Array<Record<string, string>> = [{ mode: "unknown" }, { throughSequence: "-1" }, { throughSequence: "1.5" }, { throughSequence: "9007199254740992" }, { requestId: "bad" }, { extra: "value" }];
    for (const patch of invalidQueries) {
      expect((await x.call(x.query(patch))).status).toBe(400);
    }
    const duplicate = x.query(); duplicate.append("requestId", x.f.scope.requestId); expect((await x.call(duplicate)).status).toBe(400);
    const cursor = x.list(); cursor.set("beforeId", randomUUID()); expect((await x.call(cursor)).status).toBe(400);
    cursor.delete("beforeId"); cursor.set("beforeCreatedAt", x.source.createdAt); expect((await x.call(cursor)).status).toBe(400);
    expect((await x.call(x.query(), {}, "invalid")).status).toBe(400); expect(x.rpc).not.toHaveBeenCalled();
  });
  it("refuses different source selection, corrupt originals and lost final native access", async () => {
    const x = await fixture();
    expect((await x.call(x.query({ sourceId: randomUUID() }))).status).toBe(503);
    expect((await x.call(x.query({ sourceSha256: "0".repeat(64) }))).status).toBe(503);
    const text = x.f.final.outputRow.capture_text; x.f.final.outputRow.capture_text = "{}";
    expect((await x.call()).status).toBe(503); x.f.final.outputRow.capture_text = text;
    x.f.historyOptions.before = name => {
      if (name === "read_engagement_synthesis_generation_selection_history") x.f.historyOptions.denyRequestRead = x.f.historyOptions.requestReads + 1;
    };
    expect((await x.call()).status).toBe(503);
    expect(x.f.serviceRpc).not.toHaveBeenCalled();
  });
  it("refuses altered preview scope, status, request and original bytes in the browser", async () => {
    const x = await fixture(), raw = await (await x.call()).json();
    for (const key of Object.keys(x.scope) as Array<keyof typeof x.scope>) {
      await expect(inspectThematicPreview({ ...raw, [key]: key === "sourceSha256" ? "0".repeat(64) : randomUUID() }, x.scope, x.f.scope.requestId, x.source.snapshot)).rejects.toThrow("another source");
    }
    for (const patch of [{ requestId: randomUUID() }, { status: "incomplete" }, { origin: null }]) await expect(inspectThematicPreview({ ...raw, ...patch }, x.scope, x.f.scope.requestId, x.source.snapshot)).rejects.toThrow("status or request");
    for (const field of ["proposalText", "historyText"] as const) {
      const changed = structuredClone(raw); changed.origin[field] += " ";
      await expect(inspectThematicPreview(changed, x.scope, x.f.scope.requestId, x.source.snapshot)).rejects.toThrow("bytes differ");
    }
    for (const patch of [{ requestId: randomUUID() }, { selectionSequence: 0 }]) {
      const changed = structuredClone(raw); Object.assign(changed.origin.reference, patch);
      await expect(inspectThematicPreview(changed, x.scope, x.f.scope.requestId, x.source.snapshot)).rejects.toThrow("bytes differ");
    }
  });
  it("checks self-checksummed history identity and final capture before displaying", async () => {
    const x = await fixture(), raw = await (await x.call()).json();
    for (const field of ["campaignId", "workspaceId", "requestId", "throughSequence", "finalCapture"] as const) {
      const changed = structuredClone(raw), history = JSON.parse(changed.origin.historyText);
      if (field === "finalCapture") history.entries.at(-1).captureSha256 = "0".repeat(64);
      else history[field] = field === "throughSequence" ? 0 : randomUUID();
      changed.origin.historyText = JSON.stringify(history); changed.origin.reference.historyManifestSha256 = hash(changed.origin.historyText);
      await expect(inspectThematicPreview(changed, x.scope, x.f.scope.requestId, x.source.snapshot)).rejects.toThrow("history differs");
    }
    const changed = structuredClone(raw), proposal = JSON.parse(changed.origin.proposalText); proposal.sourceId = randomUUID();
    changed.origin.proposalText = JSON.stringify(proposal); changed.origin.reference.proposalSha256 = hash(changed.origin.proposalText);
    await expect(inspectThematicPreview(changed, x.scope, x.f.scope.requestId, x.source.snapshot)).rejects.toThrow("Review source identity differs");
    const otherScope = { ...x.scope, sourceId: randomUUID() };
    await expect(inspectThematicPreview({ ...raw, sourceId: otherScope.sourceId }, otherScope, x.f.scope.requestId, x.source.snapshot)).rejects.toThrow("Thematic proposal source differs");
  });
});
