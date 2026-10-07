import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { inspectSynthesisContinuation } from "@/lib/engagement/synthesis-continuation-browser";
import { readPendingSynthesisGeneration, retainPendingSynthesisGeneration, sendPendingSynthesisGeneration,
  preservePendingSynthesisGeneration, listPreservedSynthesisGeneration, type PendingSynthesisGenerationCommand } from "@/lib/engagement/synthesis-generation-request-recovery";
import type { SynthesisContinuationProposal } from "@/lib/engagement/synthesis-continuation-records";

const id = (n: number) => `c7730000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { userId: id(1), workspaceId: id(2), campaignId: id(3), sourceId: id(4), sourceSha256: "a".repeat(64) };
const parent = { parentRequestId: id(5), parentActorId: id(6), parentIntentSha256: "b".repeat(64),
  sourceId: scope.sourceId, sourceSha256: scope.sourceSha256, throughSequence: 4, segmentResultsManifestSha256: "c".repeat(64) };
const intentText = JSON.stringify({ schemaVersion: 1, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256,
  connectionId: id(7), configurationRevisionId: id(8), configurationHash: "d".repeat(64), modelId: "synthetic-日本語", taskByteLimit: 65536 }, null, 2) + "\n";
const digest = (text: string) => createHash("sha256").update(text).digest("hex"), date = "2026-10-07T00:00:00Z";
const proposal: SynthesisContinuationProposal = { stage: "context", parent, frameByteLimit: 65536, targetRecordId: `item:${id(10)}` };
const theme: SynthesisContinuationProposal = { stage: "thematic", parent, frameByteLimit: 65536 };
function fixture(next: SynthesisContinuationProposal = proposal) {
  const command = { operation: "continue" as const, requestId: id(9), intentText, continuation: next };
  const pending: PendingSynthesisGenerationCommand = { version: 1, ...scope, intentText, command };
  const nativeCommand = { ...next, requestId: command.requestId, intentText };
  const base = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    request: { id: command.requestId, actorId: scope.userId, intentText, intentSha256: digest(intentText), createdAt: date }, cancellation: null, replayed: true };
  const binding = { schemaVersion: 1, parentRequestId: parent.parentRequestId, selectionSequence: 4,
    segmentResultsManifestSha256: parent.segmentResultsManifestSha256, contextManifestSha256: "e".repeat(64), frameByteLimit: 65536 };
  const text = JSON.stringify(next.stage === "context" ? { ...binding, contentManifestSha256: "f".repeat(64), targetRecordId: next.targetRecordId } : binding);
  const state = next.stage === "context" ? { ...base, context: { parentRequestId: parent.parentRequestId, contextText: text, contextSha256: digest(text), createdAt: date } }
    : { ...base, thematic: { parentRequestId: parent.parentRequestId, thematicText: text, thematicSha256: digest(text), createdAt: date } };
  return { pending, nativeCommand, state };
}
class Store {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem = vi.fn((key: string) => this.data.get(key) ?? null);
  setItem = vi.fn((key: string, value: string) => { this.data.set(key, value); });
  removeItem = vi.fn((key: string) => { this.data.delete(key); });
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const read = (storage: Store, next: SynthesisContinuationProposal = proposal) => readPendingSynthesisGeneration(storage, scope, "continue", next);

describe("context and thematic browser custody", () => {
  it.each([proposal, theme])("keeps exact $stage commands after a lost reply and retries only those saved bytes", async next => {
    const f = fixture(next), storage = new Store(); retainPendingSynthesisGeneration(storage, f.pending);
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("SYNTHETIC lost reply")).mockResolvedValueOnce(response(f.state));
    await expect(sendPendingSynthesisGeneration(storage, f.pending, transport)).rejects.toThrow("lost reply");
    expect(read(storage, next)).toEqual(f.pending);
    const result = await sendPendingSynthesisGeneration(storage, f.pending, transport);
    expect(result.state.replayed).toBe(true); expect(result.cleanupError).toBeNull(); expect(read(storage, next)).toBeNull();
    for (const [url, init] of transport.mock.calls) {
      expect(url).toBe(`/api/engagement/campaigns/${scope.campaignId}/synthesis/continuation`);
      expect(init).toMatchObject({ method: "POST", cache: "no-store", headers: { "x-openplan-expected-user": scope.userId, "x-openplan-expected-workspace": scope.workspaceId } });
      expect(JSON.parse(String(init?.body))).toEqual(f.nativeCommand);
      expect(JSON.parse(String(init?.body)).intentText).toBe(intentText);
    }
  });
  it("separates parents, contributions, thematic, root creation and cancellation", () => {
    const storage = new Store(), f = fixture(); retainPendingSynthesisGeneration(storage, f.pending);
    for (const next of [theme, { ...proposal, targetRecordId: `answer:${id(99)}` }, { ...proposal, parent: { ...parent, parentRequestId: id(99) } }] as SynthesisContinuationProposal[]) {
      expect(read(storage, next)).toBeNull(); retainPendingSynthesisGeneration(storage, fixture(next).pending);
    }
    expect(read(storage)).toEqual(f.pending); expect(readPendingSynthesisGeneration(storage, scope, "create")).toBeNull();
    expect(readPendingSynthesisGeneration(storage, scope, "cancel")).toBeNull();
    for (const key of ["userId", "workspaceId", "campaignId"] as const) expect(readPendingSynthesisGeneration(storage, { ...scope, [key]: id(99) }, "continue", proposal)).toBeNull();
    expect(storage.length).toBe(4);
  });
  it("recovers original pins after a newer selection and preserves them before allowing a replacement", () => {
    const storage = new Store(), f = fixture(); retainPendingSynthesisGeneration(storage, f.pending);
    const old = storage.getItem(storage.key(0)!)!;
    const changed = { ...proposal, parent: { ...parent, throughSequence: 5 } };
    expect(read(storage, changed)).toEqual(f.pending);
    expect(() => retainPendingSynthesisGeneration(storage, fixture(changed).pending)).toThrow();
    preservePendingSynthesisGeneration(storage, scope, "continue", undefined, changed);
    expect(read(storage, changed)).toBeNull();
    const copies = listPreservedSynthesisGeneration(storage, scope, "continue", changed);
    expect(copies).toHaveLength(1); expect(copies[0].raw).toBe(old); expect(copies[0].value).toEqual(f.pending);
  });
  it("accepts harmless proposal property order without changing original intent whitespace", () => {
    const storage = new Store(), f = fixture(); retainPendingSynthesisGeneration(storage, f.pending);
    const reordered = { frameByteLimit: proposal.frameByteLimit, parent: { ...parent }, targetRecordId: proposal.targetRecordId, stage: "context" as const };
    expect(read(storage, reordered)).toEqual(f.pending);
  });
  it.each(["sourceId", "sourceSha256", "parentIntentSha256", "parentActorId"] as const)("does not substitute a different saved parent %s", field => {
    const storage = new Store(); retainPendingSynthesisGeneration(storage, fixture().pending);
    const changed = { ...proposal, parent: { ...parent, [field]: field.endsWith("Id") ? id(99) : "f".repeat(64) } };
    expect(() => read(storage, changed)).toThrow();
  });
  it("does not send when custody is missing, unreadable or cannot be retained", async () => {
    const storage = new Store(), f = fixture(), transport = vi.fn<typeof fetch>();
    await expect(sendPendingSynthesisGeneration(storage, f.pending, transport)).rejects.toThrow();
    retainPendingSynthesisGeneration(storage, f.pending); storage.setItem.mockImplementationOnce(() => { throw new Error("SYNTHETIC quota"); });
    await expect(sendPendingSynthesisGeneration(storage, f.pending, transport)).rejects.toThrow("quota");
    storage.data.set(storage.key(0)!, "{"); await expect(sendPendingSynthesisGeneration(storage, f.pending, transport)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 409, 503])("retains the exact command after HTTP %s", async status => {
    const storage = new Store(), f = fixture(); retainPendingSynthesisGeneration(storage, f.pending);
    await expect(sendPendingSynthesisGeneration(storage, f.pending, vi.fn<typeof fetch>().mockResolvedValue(response({}, status)))).rejects.toMatchObject({ status });
    expect(read(storage)).toEqual(f.pending);
  });
  it.each(["parent", "sequence", "manifest", "frame", "target", "checksum", "actor", "intent", "scope", "replayed", "extra"])("keeps custody after altered child %s", async field => {
    const storage = new Store(), f = fixture(); retainPendingSynthesisGeneration(storage, f.pending);
    if (!("context" in f.state)) throw new Error("Expected context fixture");
    const value = structuredClone(f.state), binding = JSON.parse(value.context.contextText);
    if (field === "parent") binding.parentRequestId = id(99);
    if (field === "sequence") binding.selectionSequence++;
    if (field === "manifest") binding.segmentResultsManifestSha256 = "f".repeat(64);
    if (field === "frame") binding.frameByteLimit++;
    if (field === "target") binding.targetRecordId = `item:${id(99)}`;
    value.context.contextText = JSON.stringify(binding); value.context.contextSha256 = digest(value.context.contextText);
    if (field === "checksum") value.context.contextSha256 = "a".repeat(64);
    if (field === "actor") value.request.actorId = id(99);
    if (field === "intent") { value.request.intentText += " "; value.request.intentSha256 = digest(value.request.intentText); }
    if (field === "scope") value.workspaceId = id(99);
    const raw = field === "replayed" ? { ...value, replayed: undefined } : field === "extra" ? { ...value, thematic: {} } : value;
    await expect(sendPendingSynthesisGeneration(storage, f.pending, vi.fn<typeof fetch>().mockResolvedValue(response(raw)))).rejects.toThrow();
    expect(read(storage)).toEqual(f.pending);
  });
  it("checks thematic binding hashes and the parent sequence", async () => {
    const f = fixture(theme); if (!("thematic" in f.state)) throw new Error("Expected thematic fixture");
    const bound = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: id(9) };
    expect((await inspectSynthesisContinuation(f.state, bound, f.nativeCommand)).state.request?.id).toBe(id(9));
    await expect(inspectSynthesisContinuation({ ...f.state, thematic: { ...f.state.thematic, thematicSha256: "a".repeat(64) } }, bound, f.nativeCommand)).rejects.toThrow("bytes differ");
    await expect(inspectSynthesisContinuation(f.state, bound, { ...f.nativeCommand, parent: { ...parent, throughSequence: 5 } })).rejects.toThrow("parent differs");
  });
  it("keeps confirmed receipt separate from failed cleanup and never clears a newer pending request", async () => {
    const storage = new Store(), f = fixture(); retainPendingSynthesisGeneration(storage, f.pending);
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      storage.data.set(storage.key(0)!, JSON.stringify({ ...f.pending, command: { ...f.pending.command, requestId: id(99) } }));
      return response(f.state);
    });
    const result = await sendPendingSynthesisGeneration(storage, f.pending, transport);
    expect(result.cleanupError).toContain("cleanup failed"); expect(read(storage)?.command.requestId).toBe(id(99));
  });
});
