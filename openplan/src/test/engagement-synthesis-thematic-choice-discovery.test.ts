// @vitest-environment node
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ thematic: vi.fn(), context: vi.fn(), parent: vi.fn(), contributions: vi.fn(), choice: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-thematic-requests-server", () => ({ readSynthesisThematicRequest: mocks.thematic }));
vi.mock("@/lib/engagement/synthesis-context-requests-server", () => ({ readSynthesisContextRequest: mocks.context }));
vi.mock("@/lib/engagement/synthesis-generation-requests-server", () => ({ readSynthesisGenerationRequest: mocks.parent }));
vi.mock("@/lib/engagement/synthesis-continuation-server", () => ({ readSynthesisContinuationPage: mocks.contributions }));
vi.mock("@/lib/engagement/synthesis-thematic-choices-server", () => ({ readSynthesisThematicChoice: mocks.choice }));
import { readThematicContributionPage, readThematicContextPage } from "@/lib/engagement/synthesis-thematic-choice-discovery-server";
import { inspectThematicContributionPage, inspectThematicContextPage } from "@/lib/engagement/synthesis-thematic-choice-discovery";

const id = (n: number) => `c7750000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const scope = { campaignId: id(1), workspaceId: id(2), requestId: id(3), actorId: id(4) };
const intent = { sourceId: id(5), sourceSha256: hash("source") };
const binding = { parentRequestId: id(6), selectionSequence: 4, segmentResultsManifestSha256: hash("segment"), contextManifestSha256: hash("context") };
const targetRecordId = `item:${id(7)}`;
const thematic = { intent, binding, state: { request: { actorId: scope.actorId, intentText: "intent", intentSha256: hash("intent") },
  thematic: { thematicText: "thematic", thematicSha256: hash("thematic") } } };
const browserScope = { ...scope, ...intent, requestIntentSha256: hash("intent") };
const entry = { requestId: id(8), actorId: id(9), intentSha256: hash("context-intent"), stage: "context", parentRequestId: binding.parentRequestId,
  createdAt: "2026-10-07T08:00:00.123456Z", cancelled: false };
const context = { intent, binding: { ...binding, targetRecordId }, state: { request: { actorId: entry.actorId, intentSha256: entry.intentSha256 } } };
const history = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, ...intent,
  pageSize: 25, entries: [entry], nextCursor: null };
const parent = { parentRequestId: binding.parentRequestId, parentActorId: id(10), parentIntentSha256: hash("parent-intent"), ...intent,
  throughSequence: binding.selectionSequence, segmentResultsManifestSha256: binding.segmentResultsManifestSha256 };
const contributionPage = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, parent,
  cancelled: false, interpretation: "not_assessed", offset: 0, pageSize: 25, total: 1, nextOffset: null,
  entries: [{ recordId: targetRecordId, kind: "item", label: "SYNTHETIC contribution", excerpt: "Source preview", excerptTruncated: false }] };
const choiceText = JSON.stringify({ schemaVersion: 1, targetRecordId, contextRequestId: entry.requestId, selectionSequence: 13,
  historyManifestSha256: hash("history"), finalCaptureSha256: hash("capture"), finalResultSha256: hash("result") });
const choice = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: scope.requestId, targetRecordId,
  choiceText, choiceSha256: hash(choiceText), createdBy: scope.actorId, createdAt: entry.createdAt };
beforeEach(() => {
  vi.resetAllMocks(); mocks.thematic.mockResolvedValue(structuredClone(thematic)); mocks.context.mockResolvedValue(structuredClone(context));
  mocks.parent.mockResolvedValue({ intent, state: { request: { actorId: parent.parentActorId, intentSha256: parent.parentIntentSha256 } } });
  mocks.contributions.mockResolvedValue(structuredClone(contributionPage)); mocks.choice.mockResolvedValue(null);
});
function fixture(rawHistory: unknown = history) {
  const abort = vi.fn(async (): Promise<{ data: unknown; error: { code: string } | null }> => ({ data: rawHistory, error: null }));
  const rpc = vi.fn(() => ({ abortSignal: abort }));
  const client = { rpc } as unknown as Pick<SupabaseClient, "rpc">, service = {} as Pick<SupabaseClient, "rpc" | "from">;
  const controller = new AbortController();
  return { client, service, rpc, abort, controller,
    contexts: () => readThematicContextPage(client, scope, targetRecordId, null, controller.signal),
    contributions: () => readThematicContributionPage(client, service, scope, 0, controller.signal) };
}

describe("thematic input discovery", () => {
  it("pages the original complete contribution scope and its saved choice without writes", async () => {
    const f = fixture(); mocks.choice.mockResolvedValue({ record: choice });
    const result = await f.contributions();
    expect(result).toEqual({ schemaVersion: 1, ...browserScope, thematicSha256: hash("thematic"), page: contributionPage, choices: [choice] });
    expect(mocks.contributions).toHaveBeenCalledExactlyOnceWith(f.client, f.service,
      { campaignId: scope.campaignId, workspaceId: scope.workspaceId }, parent, 0, f.controller.signal);
    expect(mocks.choice).toHaveBeenCalledExactlyOnceWith(f.client, { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: scope.requestId }, targetRecordId, f.controller.signal);
    expect(mocks.thematic).toHaveBeenCalledTimes(2); expect(f.rpc).not.toHaveBeenCalled();
    expect(await inspectThematicContributionPage(result, browserScope, 0)).toEqual(result);
  });
  it("keeps an absent choice distinct from a failed read", async () => {
    const f = fixture(); expect((await f.contributions()).choices).toEqual([null]);
    mocks.choice.mockRejectedValueOnce(new Error("Unavailable")); await expect(f.contributions()).rejects.toThrow("Unavailable");
  });
  it("discovers matching request metadata without interpreting it as completed output", async () => {
    const f = fixture(), result = await f.contexts();
    expect(result.eligibleRequestIds).toEqual([entry.requestId]); expect(result.history).toEqual(history);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("list_engagement_synthesis_generation_requests", { p_campaign: scope.campaignId, p_source: intent.sourceId, p_before: null });
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith(f.client, { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: entry.requestId }, f.controller.signal);
    expect(mocks.thematic).toHaveBeenCalledTimes(2); expect(mocks.contributions).not.toHaveBeenCalled();
    expect(inspectThematicContextPage(result, browserScope, targetRecordId, null)).toEqual(result);
  });
  it.each(["targetRecordId", "parentRequestId", "selectionSequence", "segmentResultsManifestSha256", "contextManifestSha256"])("excludes context with a different %s", async field => {
    const f = fixture(), changed = structuredClone(context);
    Object.assign(changed.binding, { [field]: field === "selectionSequence" ? 5 : field.endsWith("Sha256") ? hash("different") : field === "targetRecordId" ? `item:${id(90)}` : id(90) });
    mocks.context.mockResolvedValue(changed); expect((await f.contexts()).eligibleRequestIds).toEqual([]);
  });
  it.each(["actorId", "intentSha256", "sourceId", "sourceSha256"])("refuses substituted context %s", async field => {
    const f = fixture(), changed = structuredClone(context);
    Object.assign(field.startsWith("source") ? changed.intent : changed.state.request, { [field]: field.endsWith("Sha256") ? hash("different") : id(90) });
    mocks.context.mockResolvedValue(changed); await expect(f.contexts()).rejects.toThrow("context scope differs");
  });
  it("keeps the native cursor even when a whole page has no eligible contexts", async () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({ ...entry, requestId: id(100 + index), stage: "segment", parentRequestId: null,
      createdAt: new Date(Date.parse("2026-10-07T08:00:00Z") - index * 1000).toISOString() }));
    const last = entries.at(-1)!, nextCursor = { id: last.requestId, createdAt: last.createdAt }, page = { ...history, entries, nextCursor };
    const f = fixture(page), result = await f.contexts();
    expect(result.eligibleRequestIds).toEqual([]); expect(result.history.nextCursor).toEqual(nextCursor); expect(mocks.context).not.toHaveBeenCalled();
    expect(inspectThematicContextPage(result, browserScope, targetRecordId, null).history.entries).toHaveLength(25);
  });
  it("passes the exact microsecond cursor and rejects invalid continuation order", async () => {
    const f = fixture(), before = { id: id(20), createdAt: "2026-10-07T08:00:00.123457Z" };
    await readThematicContextPage(f.client, scope, targetRecordId, before, f.controller.signal);
    expect(f.rpc.mock.calls[0]).toEqual(["list_engagement_synthesis_generation_requests", { p_campaign: scope.campaignId, p_source: intent.sourceId, p_before: before }]);
    await expect(readThematicContextPage(f.client, scope, targetRecordId, { ...before, createdAt: "2026-10-07T08:00:00.123455Z" }, f.controller.signal)).rejects.toThrow("order differs");
  });
  it("refuses another thematic actor before private discovery", async () => {
    const f = fixture(); mocks.thematic.mockResolvedValue({ ...thematic, state: { ...thematic.state, request: { ...thematic.state.request, actorId: id(90) } } });
    await expect(f.contexts()).rejects.toThrow("Only the thematic requester"); await expect(f.contributions()).rejects.toThrow("Only the thematic requester");
    expect(f.rpc).not.toHaveBeenCalled(); expect(mocks.contributions).not.toHaveBeenCalled();
  });
  it("refuses late access loss and changed request bytes on both discovery paths", async () => {
    for (const mode of ["contexts", "contributions"] as const) {
      const f = fixture(); mocks.thematic.mockReset().mockResolvedValueOnce(thematic).mockRejectedValueOnce(new Error("Late denial"));
      await expect(f[mode]()).rejects.toThrow("Late denial");
      mocks.thematic.mockReset().mockResolvedValueOnce(thematic).mockResolvedValueOnce({ ...thematic, state: { ...thematic.state,
        request: { ...thematic.state.request, intentText: "changed" } } });
      await expect(f[mode]()).rejects.toThrow("changed during discovery");
    }
  });
  it("refuses a different parent source and mismatched saved-choice authorship", async () => {
    const f = fixture(); mocks.parent.mockResolvedValueOnce({ intent: { ...intent, sourceSha256: hash("wrong") }, state: { request: {} } });
    await expect(f.contributions()).rejects.toThrow("parent source differs"); expect(mocks.contributions).not.toHaveBeenCalled();
    mocks.choice.mockResolvedValueOnce({ record: { ...choice, createdBy: id(90) } }); await expect(f.contributions()).rejects.toThrow("accounting differs");
  });
  it("does not turn a native discovery failure into an empty page", async () => {
    const f = fixture(); f.abort.mockResolvedValueOnce({ data: null, error: { code: "PT503" } });
    await expect(f.contexts()).rejects.toThrow("discovery unavailable");
  });
  it("browser checks reject substituted scope, page offset, choice hashes and eligible identities", async () => {
    const f = fixture(); mocks.choice.mockResolvedValue({ record: choice }); const contributions = await f.contributions(), contexts = await f.contexts();
    for (const field of Object.keys(browserScope) as Array<keyof typeof browserScope>) {
      const wrong = { ...browserScope, [field]: field.endsWith("Sha256") ? hash("wrong") : id(90) };
      await expect(inspectThematicContributionPage(contributions, wrong, 0)).rejects.toThrow();
      expect(() => inspectThematicContextPage(contexts, wrong, targetRecordId, null)).toThrow();
    }
    await expect(inspectThematicContributionPage(contributions, browserScope, 1)).rejects.toThrow("source differs");
    await expect(inspectThematicContributionPage({ ...contributions, choices: [{ ...choice, choiceSha256: hash("wrong") }] }, browserScope, 0)).rejects.toThrow("choice bytes differ");
    const otherChoice = JSON.stringify({ ...JSON.parse(choice.choiceText), targetRecordId: `item:${id(90)}` });
    await expect(inspectThematicContributionPage({ ...contributions, choices: [{ ...choice, choiceText: otherChoice, choiceSha256: hash(otherChoice) }] }, browserScope, 0)).rejects.toThrow("choice differs");
    for (const ids of [[id(90)], [entry.requestId, entry.requestId]]) expect(() => inspectThematicContextPage({ ...contexts, eligibleRequestIds: ids }, browserScope, targetRecordId, null)).toThrow("discovery differs");
    expect(() => inspectThematicContextPage(contexts, browserScope, `item:${id(90)}`, null)).toThrow("discovery differs");
  });
});
