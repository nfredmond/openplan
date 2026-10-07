import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), history: vi.fn(), plan: vi.fn(), source: vi.fn(), context: vi.fn(), thematic: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-generation-requests-server", async original => ({
  ...await original<typeof import("@/lib/engagement/synthesis-generation-requests-server")>(), readSynthesisGenerationRequest: mocks.request,
}));
vi.mock("@/lib/engagement/synthesis-generation-selected-results-server", () => ({ loadSynthesisGenerationHistory: mocks.history }));
vi.mock("@/lib/engagement/synthesis-progress-plan-server", () => ({ readSynthesisProgressPlan: mocks.plan }));
vi.mock("@/lib/engagement/synthesis-sources-server", () => ({ verifySynthesisSource: mocks.source }));
vi.mock("@/lib/engagement/synthesis-context-requests-server", () => ({ createSynthesisContextRequest: mocks.context }));
vi.mock("@/lib/engagement/synthesis-thematic-requests-server", () => ({ createSynthesisThematicRequest: mocks.thematic }));
import { createSynthesisContinuation, readSynthesisContinuationPage } from "@/lib/engagement/synthesis-continuation-server";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";

const id = (n: number) => `c7700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: id(1), workspaceId: id(2) }, actorId = id(3);
const parent = { parentRequestId: id(4), parentActorId: id(5), parentIntentSha256: "a".repeat(64),
  sourceId: id(6), sourceSha256: "b".repeat(64), throughSequence: 4, segmentResultsManifestSha256: "c".repeat(64) };
const intentText = JSON.stringify({ schemaVersion: 1, sourceId: parent.sourceId, sourceSha256: parent.sourceSha256,
  connectionId: id(7), configurationRevisionId: id(8), configurationHash: "d".repeat(64), modelId: "PRIVATE-model", taskByteLimit: 65536 }, null, 2);
const command = { stage: "context" as const, requestId: id(9), parent, frameByteLimit: 4096, intentText, targetRecordId: `item:${id(20)}` };
const thematic = { stage: "thematic" as const, requestId: id(10), parent, frameByteLimit: 4096, intentText };
const original = { state: { request: { id: parent.parentRequestId, actorId: parent.parentActorId, intentSha256: parent.parentIntentSha256 } },
  intent: { sourceId: parent.sourceId, sourceSha256: parent.sourceSha256 }, cancellation: null };
const ids = Array.from({ length: 27 }, (_, i) => `item:${id(20 + i)}`);
const history = { ...scope, requesterId: parent.parentActorId, selections: { requestId: parent.parentRequestId, throughSequence: 4, plan: { retained: true } },
  inventory: { status: "ready_for_record_consolidation", job: { jobId: parent.parentRequestId },
    source: { requestId: parent.sourceId, sha256: parent.sourceSha256 }, manifestSha256: parent.segmentResultsManifestSha256, contributionIds: ids } };
const saved = { snapshotSha256: parent.sourceSha256, snapshot: { items: ids.map((_, i) => ({ id: id(20 + i), title: `Comment ${i + 1}`,
  body: "PRIVATE contribution ".repeat(30), contact: "PRIVATE OMITTED" })), answers: [] } };
const rpc = vi.fn(), client = { rpc: vi.fn() };
const service = { rpc: vi.fn(), from: vi.fn() };
const binding = { parentRequestId: parent.parentRequestId, selectionSequence: 4, segmentResultsManifestSha256: parent.segmentResultsManifestSha256,
  frameByteLimit: 4096, targetRecordId: command.targetRecordId };
const receipt = { binding, state: { request: { id: command.requestId, actorId, intentText }, replayed: false } };
const page = (offset = 0, signal = new AbortController().signal) => readSynthesisContinuationPage(client, service, scope, parent, offset, signal);
const create = (value: typeof command | typeof thematic = command, signal = new AbortController().signal) =>
  createSynthesisContinuation(client, service, scope, actorId, value, signal);
beforeEach(() => {
  vi.resetAllMocks();
  client.rpc.mockImplementation((name: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => rpc(name, args, signal) }));
  mocks.request.mockResolvedValue(structuredClone(original)); mocks.history.mockResolvedValue(structuredClone(history));
  mocks.plan.mockResolvedValue("sealed"); mocks.source.mockReturnValue(structuredClone(saved)); rpc.mockResolvedValue({ data: { native: true }, error: null });
  mocks.context.mockResolvedValue(structuredClone(receipt));
  mocks.thematic.mockResolvedValue({ binding: { ...binding, targetRecordId: undefined }, state: { ...receipt.state, request: { ...receipt.state.request, id: thematic.requestId } } });
});

describe("continuation from a pinned, complete parent", () => {
  it("pages complete membership with bounded previews and checks access after the final source read", async () => {
    const first = await page();
    expect(first).toMatchObject({ ...scope, parent, offset: 0, total: 27, pageSize: 25, nextOffset: 25, interpretation: "not_assessed" });
    expect(first.entries).toHaveLength(25); expect(first.entries[0]).toEqual({ recordId: ids[0], kind: "item", label: "Comment 1",
      excerpt: saved.snapshot.items[0].body.slice(0, 280), excerptTruncated: true });
    expect(JSON.stringify(first)).not.toContain("PRIVATE OMITTED");
    expect(mocks.history).toHaveBeenCalledExactlyOnceWith(client, service, { ...scope, requestId: parent.parentRequestId, throughSequence: 4 }, expect.any(AbortSignal));
    expect(mocks.plan).toHaveBeenCalledExactlyOnceWith(service, history.selections.plan, expect.any(AbortSignal));
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_synthesis_sources", { p_campaign: scope.campaignId, p_request: parent.sourceId }, expect.any(AbortSignal));
    expect(mocks.source).toHaveBeenCalledExactlyOnceWith({ native: true }, { ...scope, requestId: parent.sourceId });
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(mocks.request.mock.invocationCallOrder[0]).toBeLessThan(mocks.history.mock.invocationCallOrder[0]);
    expect(mocks.request.mock.invocationCallOrder[2]).toBeGreaterThan(mocks.source.mock.invocationCallOrder[0]);
    expect(await page(25)).toMatchObject({ offset: 25, nextOffset: null, entries: expect.any(Array) });
    expect((await page(25)).entries.map(row => row.recordId)).toEqual(ids.slice(25));
    expect(await page(27)).toMatchObject({ offset: 27, nextOffset: null, entries: [] });
    await expect(page(28)).rejects.toMatchObject({ status: 409 });
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.thematic).not.toHaveBeenCalled();
  });
  it.each(["context", "thematic"] as const)("uses current staff actor and exact native %s request, without execution", async stage => {
    const value = stage === "context" ? command : thematic, result = await create(value);
    expect(mocks[stage]).toHaveBeenCalledExactlyOnceWith(client, service, { ...scope, actorId, requestId: value.requestId,
      parentRequestId: parent.parentRequestId, throughSequence: 4, intentText, frameByteLimit: 4096,
      ...(stage === "context" ? { targetRecordId: command.targetRecordId } : {}) }, expect.any(AbortSignal));
    expect(result.request.actorId).toBe(actorId); expect(result.request.actorId).not.toBe(parent.parentActorId);
    expect(result.request.intentText).toBe(intentText); expect(result.replayed).toBe(false);
    expect(rpc).not.toHaveBeenCalled(); expect(service.rpc).not.toHaveBeenCalled(); expect(service.from).not.toHaveBeenCalled();
  });
  it("retains native replay and does not deny a new staff request solely because the parent is cancelled", async () => {
    mocks.request.mockResolvedValue({ ...original, cancellation: { id: id(99) } });
    mocks.context.mockResolvedValue({ ...receipt, state: { ...receipt.state, replayed: true } });
    expect((await create()).replayed).toBe(true); expect((await page()).cancelled).toBe(true);
  });
  it.each(["parentActorId", "parentIntentSha256", "sourceId", "sourceSha256"] as const)("refuses changed parent %s before private replay", async field => {
    const changed = { ...parent, [field]: field.endsWith("Id") ? id(99) : "e".repeat(64) };
    await expect(readSynthesisContinuationPage(client, service, scope, changed, 0, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it.each(["campaign", "workspace", "actor", "request", "sequence", "job", "source", "source-hash", "manifest", "incomplete", "empty", "duplicate"])("refuses substituted or incomplete history: %s", async field => {
    const value = structuredClone(history);
    if (field === "campaign") value.campaignId = id(99);
    if (field === "workspace") value.workspaceId = id(99);
    if (field === "actor") value.requesterId = id(99);
    if (field === "request") value.selections.requestId = id(99);
    if (field === "sequence") value.selections.throughSequence++;
    if (field === "job") value.inventory.job.jobId = id(99);
    if (field === "source") value.inventory.source.requestId = id(99);
    if (field === "source-hash") value.inventory.source.sha256 = "e".repeat(64);
    if (field === "manifest") value.inventory.manifestSha256 = "e".repeat(64);
    if (field === "incomplete") value.inventory.status = "incomplete";
    if (field === "empty") value.inventory.contributionIds = [];
    if (field === "duplicate") value.inventory.contributionIds.push(ids[0]);
    mocks.history.mockResolvedValue(value); await expect(create()).rejects.toMatchObject({ status: 409 });
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each(["not_prepared", "staging"])("refuses unsealed preparation %s", async state => {
    mocks.plan.mockResolvedValue(state); await expect(page()).rejects.toMatchObject({ status: 409 });
    await expect(create()).rejects.toMatchObject({ status: 409 }); expect(mocks.context).not.toHaveBeenCalled();
  });
  it("preserves failure of retained plan verification", async () => {
    mocks.plan.mockRejectedValue(new Error("PRIVATE bad plan")); await expect(create()).rejects.toThrow("bad plan");
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it("refuses a source mismatch or an omitted contribution beyond the visible page", async () => {
    mocks.source.mockReturnValueOnce({ ...saved, snapshotSha256: "e".repeat(64) });
    await expect(page()).rejects.toMatchObject({ status: 409 });
    mocks.source.mockReturnValueOnce({ ...saved, snapshot: { ...saved.snapshot, items: saved.snapshot.items.slice(0, 26) } });
    await expect(page()).rejects.toMatchObject({ status: 409 });
  });
  it("never treats source read failures as an empty selection", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("PRIVATE") }); await expect(page()).rejects.toMatchObject({ status: 503 });
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it("refuses a contribution not retained by this parent", async () => {
    await expect(create({ ...command, targetRecordId: `answer:${id(99)}` })).rejects.toMatchObject({ status: 409 });
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3])("refuses access loss at read %s without returning a page", async read => {
    for (let n = 1; n < read; n++) mocks.request.mockResolvedValueOnce(original);
    mocks.request.mockRejectedValueOnce(new SynthesisGenerationRequestError("forbidden", 403));
    await expect(page()).rejects.toMatchObject({ status: 403 });
    if (read === 1) expect(mocks.history).not.toHaveBeenCalled();
  });
  it("does not write after access is lost at the final preflight", async () => {
    mocks.request.mockResolvedValueOnce(original).mockRejectedValueOnce(new SynthesisGenerationRequestError("forbidden", 403));
    await expect(create()).rejects.toMatchObject({ status: 403 }); expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each(["manifest", "parent", "sequence", "frame", "target", "actor", "request", "intent", "replayed"])("does not confirm a substituted child %s", async field => {
    const value = structuredClone(receipt);
    if (field === "manifest") value.binding.segmentResultsManifestSha256 = "e".repeat(64);
    if (field === "parent") value.binding.parentRequestId = id(99);
    if (field === "sequence") value.binding.selectionSequence++;
    if (field === "frame") value.binding.frameByteLimit++;
    if (field === "target") value.binding.targetRecordId = `item:${id(99)}`;
    if (field === "actor") value.state.request.actorId = id(99);
    if (field === "request") value.state.request.id = id(99);
    if (field === "intent") value.state.request.intentText += " ";
    mocks.context.mockResolvedValue(field === "replayed" ? { ...value, state: { ...value.state, replayed: undefined } } : value);
    await expect(create()).rejects.toMatchObject({ status: 409 });
  });
  it("aborts before private reads and after a retained native reply without confirming it", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(page(0, controller.signal)).rejects.toThrow(); expect(mocks.request).not.toHaveBeenCalled();
    const write = new AbortController(); mocks.context.mockImplementationOnce(async () => { write.abort(); return receipt; });
    await expect(create(command, write.signal)).rejects.toThrow();
  });
});
