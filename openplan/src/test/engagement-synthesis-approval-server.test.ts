import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSynthesisApprovalRequest, loadSynthesisApprovalState, retainSynthesisApproval } from "@/lib/engagement/synthesis-approval-server";
import { synthesisApprovalForRevision, type SynthesisApprovalIntent, type SynthesisApprovalPacket } from "@/lib/engagement/synthesis-approval";
import { applySynthesisReviewChange, createSynthesisReviewContent, type SynthesisReviewIntent } from "@/lib/engagement/synthesis-review";
import type { SynthesisReviewRecord } from "@/lib/engagement/synthesis-review-records";
import { makeSourceSnapshot, savedSource, sourceActor, sourceDate, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

const reviewId = "e3000000-0000-4000-8000-000000000001", correctedId = "e3000000-0000-4000-8000-000000000002";
const requestId = "f3000000-0000-4000-8000-000000000001", nextId = "f3000000-0000-4000-8000-000000000002";
const thirdId = "f3000000-0000-4000-8000-000000000003";
const address = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, reviewId };
const actor = { campaignId: address.campaignId, workspaceId: address.workspaceId, actorId: sourceActor };
const snapshot = makeSourceSnapshot(), source = savedSource(snapshot), initial = createSynthesisReviewContent(snapshot, source.snapshotSha256);
function original(): SynthesisReviewRecord {
  const preparationText = JSON.stringify(initial.preparation), contentText = JSON.stringify(initial.content);
  const intent: SynthesisReviewIntent = { requestId: reviewId, actorId: sourceActor, workspaceId: address.workspaceId,
    operation: "create", sourceId: source.requestId, sourceSha256: source.snapshotSha256 };
  return { ...address, sourceId: source.requestId, sourceSha256: source.snapshotSha256, preparationText, preparationSha256: sourceHash(preparationText),
    createdAt: sourceDate, createdBy: sourceActor, currentRevisionId: reviewId,
    revision: { requestId: reviewId, revisionNo: 1, parentId: null, parentSha256: null, actorId: sourceActor, reason: null,
      intent, contentText, contentSha256: sourceHash(contentText), createdAt: sourceDate } };
}
function corrected(): SynthesisReviewRecord {
  const first = original();
  const intent: SynthesisReviewIntent = { requestId: correctedId, actorId: sourceActor, workspaceId: address.workspaceId,
    operation: "correct", reviewId, expectedRevisionId: reviewId, expectedRevisionSha256: first.revision.contentSha256,
    reason: "SYNTHETIC preserved correction", change: { kind: "notes", title: "SYNTHETIC revised staff draft", notes: "SYNTHETIC full Unicode é 中文 note".repeat(50) } };
  const contentText = JSON.stringify(applySynthesisReviewChange(initial.content, intent.change, snapshot, source.snapshotSha256));
  return { ...first, currentRevisionId: correctedId, revision: { requestId: correctedId, revisionNo: 2, parentId: reviewId,
    parentSha256: first.revision.contentSha256, actorId: sourceActor, reason: intent.reason, intent, contentText, contentSha256: sourceHash(contentText), createdAt: sourceDate } };
}
const baseScope = { ...address, sourceId: source.requestId, sourceSha256: source.snapshotSha256, preparationSha256: original().preparationSha256 };
function command(patch: Partial<SynthesisApprovalIntent> = {}): SynthesisApprovalIntent {
  return { ...baseScope, revisionId: reviewId, revisionNo: 1, revisionSha256: original().revision.contentSha256,
    actorId: sourceActor, requestId, operation: "approve", reason: "SYNTHETIC exact staff review; interpretation remains unassessed.", predecessorId: null, predecessorSha256: null, ...patch };
}
function packet(intent: SynthesisApprovalIntent, eventNo: number): SynthesisApprovalPacket {
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo, createdAt: sourceDate, intent });
  return { eventText, eventSha256: sourceHash(eventText) };
}
const rpc = vi.fn(), persist = vi.fn();
const client = { rpc } as unknown as Pick<SupabaseClient, "rpc">, service = { rpc: persist } as unknown as Pick<SupabaseClient, "rpc">;
let reviews: Map<string, SynthesisReviewRecord>, events: Map<string, SynthesisApprovalPacket>, head: string;
function save(intent = command()) {
  const value = packet(intent, events.size + 1); events.set(intent.requestId, value); return value;
}
function historyPacket() {
  const entries = [...events.values()], last = [...events.entries()].at(-1);
  return { ...baseScope, headId: last?.[0] ?? null, headSha256: last?.[1].eventSha256 ?? null, eventCount: entries.length, entries };
}
async function read(name: string, args: Record<string, string | null>) {
  if (name === "read_engagement_synthesis_sources") {
    expect(args).toEqual({ p_campaign: address.campaignId, p_request: source.requestId });
    return { data: source, error: null };
  }
  if (name === "read_engagement_synthesis_review") {
    expect(args.p_campaign).toBe(address.campaignId); expect(args.p_review).toBe(reviewId);
    const record = reviews.get(args.p_revision ?? head);
    return { data: record ? { ...record, currentRevisionId: head } : null, error: null };
  }
  if (name === "read_engagement_synthesis_approval") {
    expect(args.p_campaign).toBe(address.campaignId);
    return { data: events.get(args.p_request!) ?? null, error: null };
  }
  if (name === "read_engagement_synthesis_approval_history") {
    expect(args).toEqual({ p_campaign: address.campaignId, p_review: reviewId });
    return { data: historyPacket(), error: null };
  }
  throw new Error("Unexpected approval fixture RPC");
}
beforeEach(() => {
  reviews = new Map([[reviewId, original()], [correctedId, corrected()]]); events = new Map(); head = reviewId;
  rpc.mockReset().mockImplementation(read);
  persist.mockReset().mockImplementation(async (name: string, args: { p_campaign: string; p_actor: string; p_workspace: string; p_intent: SynthesisApprovalIntent }) => {
    expect(name).toBe("retain_engagement_synthesis_approval");
    return { data: { event: save(args.p_intent), replayed: false }, error: null };
  });
});

describe("exact approval application server", () => {
  it("verifies every historical approval against one complete review lineage and preserves draft bytes", async () => {
    const first = save(); head = correctedId;
    const before = JSON.stringify([...reviews]);
    const state = await loadSynthesisApprovalState(client, address);
    expect(state?.current).toEqual({ ...baseScope, revisionId: correctedId, revisionNo: 2, revisionSha256: corrected().revision.contentSha256 });
    expect(state?.packet).toEqual(historyPacket());
    expect(state?.history.entries[0].eventText).toBe(first.eventText);
    expect(synthesisApprovalForRevision(state!.history, state!.current).state).toBe("unapproved");
    expect(rpc.mock.calls.filter(([name]) => name === "read_engagement_synthesis_sources")).toHaveLength(1);
    expect(rpc.mock.calls.filter(([name]) => name === "read_engagement_synthesis_review")).toHaveLength(2);
    expect(JSON.stringify([...reviews])).toBe(before);
  });
  it("sends only the exact bound command to the service writer and validates the retained result", async () => {
    const result = await retainSynthesisApproval(client, service, actor, command());
    expect(result).toMatchObject({ replayed: false, event: { eventNo: 1, createdAt: sourceDate, intent: command() } });
    expect(persist).toHaveBeenCalledExactlyOnceWith("retain_engagement_synthesis_approval", {
      p_campaign: address.campaignId, p_actor: sourceActor, p_workspace: address.workspaceId, p_intent: command(),
    });
  });
  it("recovers an exact old acknowledgement after correction and withdrawal without loading current content or writing again", async () => {
    const first = save(); head = correctedId;
    save(command({ requestId: nextId, operation: "withdraw", predecessorId: requestId, predecessorSha256: first.eventSha256 }));
    const result = await retainSynthesisApproval(client, service, actor, command());
    expect(result).toMatchObject({ replayed: true, event: { eventText: first.eventText, eventSha256: first.eventSha256, createdAt: sourceDate } });
    expect(persist).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_synthesis_approval", { p_campaign: address.campaignId, p_request: requestId });
  });
  it("refuses changed retries as conflicts while keeping corrupt receipts and failed access distinct", async () => {
    save();
    for (const patch of [{ reason: "Changed reason" }, { sourceId: correctedId }, { sourceSha256: "0".repeat(64) }, { preparationSha256: "0".repeat(64) },
      { reviewId: correctedId }, { revisionId: correctedId }, { revisionSha256: "0".repeat(64) }, { revisionNo: 2 }]) {
      await expect(retainSynthesisApproval(client, service, actor, command(patch))).rejects.toMatchObject({ kind: "conflict" });
    }
    const nextActor = { ...actor, actorId: correctedId };
    await expect(retainSynthesisApproval(client, service, nextActor, command({ actorId: correctedId }))).rejects.toMatchObject({ kind: "conflict" });
    const stored = events.get(requestId)!; events.set(requestId, { ...stored, eventText: stored.eventText + " " });
    await expect(retainSynthesisApproval(client, service, actor, command())).rejects.toThrow("checksum differs");
    expect(persist).not.toHaveBeenCalled();
  });
  it.each(["actorId", "workspaceId", "campaignId"] as const)("binds authenticated %s before reading or writing", async field => {
    await expect(retainSynthesisApproval(client, service, { ...actor, [field]: correctedId }, command())).rejects.toMatchObject({ kind: "forbidden" });
    expect(rpc).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
  });
  it("rejects invalid commands before a database call", async () => {
    await expect(retainSynthesisApproval(client, service, actor, { ...command(), operation: "publish" })).rejects.toMatchObject({ kind: "invalid" });
    expect(rpc).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
  });
  it("refuses stale revision or history heads and absent reviews without writing", async () => {
    head = correctedId;
    await expect(retainSynthesisApproval(client, service, actor, command())).rejects.toMatchObject({ kind: "conflict" });
    head = reviewId; save();
    await expect(retainSynthesisApproval(client, service, actor, command({ requestId: nextId }))).rejects.toMatchObject({ kind: "conflict" });
    reviews.clear(); events.clear();
    await expect(retainSynthesisApproval(client, service, actor, command())).rejects.toMatchObject({ kind: "conflict" });
    expect(await loadSynthesisApprovalState(client, address)).toBeNull(); expect(persist).not.toHaveBeenCalled();
  });
  it.each(["revisionId", "revisionNo", "revisionSha256"] as const)("refuses rehashed historical %s that does not match a verified revision", async field => {
    save(command({ [field]: field === "revisionNo" ? 2 : field === "revisionSha256" ? "0".repeat(64) : thirdId }));
    await expect(loadSynthesisApprovalState(client, address)).rejects.toMatchObject({ kind: "conflict", message: "Approval history differs from the verified review revisions" });
  });
  it("never approves a corrupted review even if its approval command names the recomputed checksum", async () => {
    const bad = original(); bad.revision.contentText = JSON.stringify({ ...initial.content, notes: "SYNTHETIC uncommanded alteration" });
    bad.revision.contentSha256 = sourceHash(bad.revision.contentText); reviews.set(reviewId, bad);
    await expect(retainSynthesisApproval(client, service, actor, command({ revisionSha256: bad.revision.contentSha256 }))).rejects.toThrow("Saved review content differs from its command");
    expect(persist).not.toHaveBeenCalled();
  });
  it("recovers when a peer commits the same request during the state read", async () => {
    rpc.mockImplementation(async (name: string, args: Record<string, string | null>) => {
      if (name === "read_engagement_synthesis_approval_history" && !events.size) save();
      return read(name, args);
    });
    expect(await retainSynthesisApproval(client, service, actor, command())).toMatchObject({ replayed: true });
    expect(persist).not.toHaveBeenCalled();
  });
  it("recovers the exact event when newer approval history races ahead of the loaded review lineage", async () => {
    rpc.mockImplementation(async (name: string, args: Record<string, string | null>) => {
      if (name === "read_engagement_synthesis_approval_history" && !events.size) {
        const first = save(); head = correctedId;
        save(command({ requestId: nextId, revisionId: correctedId, revisionNo: 2, revisionSha256: corrected().revision.contentSha256,
          predecessorId: requestId, predecessorSha256: first.eventSha256 }));
      }
      return read(name, args);
    });
    expect(await retainSynthesisApproval(client, service, actor, command())).toMatchObject({ replayed: true, event: { intent: { requestId } } });
    expect(persist).not.toHaveBeenCalled();
  });
  it.each(["PT409", "PT503"])("recovers an exact committed request after native %s without submitting another write", async code => {
    persist.mockImplementationOnce(async () => { save(); return { data: null, error: { code } }; });
    expect(await retainSynthesisApproval(client, service, actor, command())).toMatchObject({ replayed: true });
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it.each([["42501", "forbidden"], ["PT503", "unavailable"], ["XX000", "unavailable"]])("refuses failed request lookup %s before persistence", async (code, kind) => {
    rpc.mockResolvedValueOnce({ data: null, error: { code } });
    await expect(retainSynthesisApproval(client, service, actor, command())).rejects.toMatchObject({ kind });
    expect(persist).not.toHaveBeenCalled();
  });
  it.each([["42501", "forbidden"], ["PT409", "conflict"], ["22023", "invalid"], ["PT503", "unavailable"]])("preserves native writer failure %s when there is no committed receipt", async (code, kind) => {
    persist.mockResolvedValueOnce({ data: null, error: { code } });
    await expect(retainSynthesisApproval(client, service, actor, command())).rejects.toMatchObject({ kind });
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it("does not turn missing or failed history into an empty approval state", async () => {
    for (const result of [{ data: null, error: null }, { data: null, error: { code: "42501" } }, { data: null, error: { code: "PT503" } }]) {
      rpc.mockImplementation(async (name: string, args: Record<string, string | null>) => name === "read_engagement_synthesis_approval_history" ? result : read(name, args));
      await expect(loadSynthesisApprovalState(client, address)).rejects.toThrow();
    }
  });
  it("rejects a different returned request and malformed or wrong-sequence write receipts", async () => {
    rpc.mockResolvedValueOnce({ data: packet(command({ requestId: nextId }), 1), error: null });
    await expect(loadSynthesisApprovalRequest(client, baseScope, requestId)).rejects.toThrow("request identity differs");
    for (const result of [{ event: packet(command(), 2), replayed: false }, { event: packet(command({ actorId: thirdId }), 1), replayed: false },
      { event: { ...packet(command(), 1), eventSha256: "0".repeat(64) }, replayed: false }, null]) {
      persist.mockResolvedValueOnce({ data: result, error: null });
      await expect(retainSynthesisApproval(client, service, actor, command())).rejects.toThrow();
    }
  });
});
