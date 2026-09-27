import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSynthesisResponseContext } from "@/lib/engagement/synthesis-response-links-server";
import type { SynthesisApprovalIntent, SynthesisApprovalPacket } from "@/lib/engagement/synthesis-approval";
import { applySynthesisReviewChange, createSynthesisReviewContent, type SynthesisReviewIntent } from "@/lib/engagement/synthesis-review";
import type { SynthesisReviewRecord } from "@/lib/engagement/synthesis-review-records";
import { makeSourceSnapshot, savedSource, sourceActor, sourceDate, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

const id = (n: number) => `e4000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const address = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, reviewId: id(1), responseId: id(2), groupId: "category-1" };
const snapshot = makeSourceSnapshot(), source = savedSource(snapshot), initial = createSynthesisReviewContent(snapshot, source.snapshotSha256);
function original(): SynthesisReviewRecord {
  const preparationText = JSON.stringify(initial.preparation, null, 1), contentText = JSON.stringify(initial.content, null, 2);
  const intent: SynthesisReviewIntent = { requestId: address.reviewId, actorId: sourceActor, workspaceId: address.workspaceId,
    operation: "create", sourceId: source.requestId, sourceSha256: source.snapshotSha256 };
  return { campaignId: address.campaignId, workspaceId: address.workspaceId, reviewId: address.reviewId,
    sourceId: source.requestId, sourceSha256: source.snapshotSha256, preparationText, preparationSha256: sourceHash(preparationText),
    createdAt: sourceDate, createdBy: sourceActor, currentRevisionId: address.reviewId,
    revision: { requestId: address.reviewId, revisionNo: 1, parentId: null, parentSha256: null,
      actorId: sourceActor, reason: null, intent, contentText, contentSha256: sourceHash(contentText), createdAt: sourceDate } };
}
function corrected(): SynthesisReviewRecord {
  const first = original();
  const intent: SynthesisReviewIntent = { requestId: id(3), actorId: sourceActor, workspaceId: address.workspaceId,
    operation: "correct", reviewId: address.reviewId, expectedRevisionId: first.revision.requestId,
    expectedRevisionSha256: first.revision.contentSha256, reason: "SYNTHETIC correction",
    change: { kind: "notes", title: "SYNTHETIC corrected review", notes: "SYNTHETIC retained minority concern" } };
  const contentText = JSON.stringify(applySynthesisReviewChange(initial.content, intent.change, snapshot, source.snapshotSha256));
  return { ...first, currentRevisionId: id(3), revision: { requestId: id(3), revisionNo: 2, parentId: first.revision.requestId,
    parentSha256: first.revision.contentSha256, actorId: sourceActor, reason: intent.reason, intent,
    contentText, contentSha256: sourceHash(contentText), createdAt: sourceDate } };
}
function response(revision = 1, event = revision === 1 ? "created" : "corrected", responseId = address.responseId) {
  const record_text = JSON.stringify({ id: responseId, campaign_id: address.campaignId, category_id: null,
    theme_title: "SYNTHETIC response", you_said: "SYNTHETIC concern", we_did: `SYNTHETIC answer ${revision} é`,
    status: "draft", ai_assisted: false, source_item_ids: [], sort_order: 0, published_at: null,
    created_at: sourceDate, updated_at: sourceDate, created_by: sourceActor }, null, 3);
  return { id: id(100 + revision), campaign_id: address.campaignId, response_id: responseId, revision,
    actor_id: sourceActor, recorded_at: sourceDate, event, record_text, record_sha256: sourceHash(record_text) };
}
const rpc = vi.fn(), client = { rpc } as unknown as Pick<SupabaseClient, "rpc">;
let reviews: Map<string, SynthesisReviewRecord>, currentId: string, events: SynthesisApprovalPacket[], responses: ReturnType<typeof response>[];
function saveApproval(review = original(), operation: "approve" | "withdraw" = "approve") {
  const previous = events.at(-1), eventNo = events.length + 1;
  const intent: SynthesisApprovalIntent = { campaignId: address.campaignId, workspaceId: address.workspaceId, reviewId: address.reviewId,
    sourceId: source.requestId, sourceSha256: source.snapshotSha256, preparationSha256: review.preparationSha256,
    revisionId: review.revision.requestId, revisionNo: review.revision.revisionNo, revisionSha256: review.revision.contentSha256,
    requestId: id(10 + eventNo), actorId: sourceActor, operation, reason: "SYNTHETIC private approval reason",
    predecessorId: previous ? id(10 + eventNo - 1) : null, predecessorSha256: previous?.eventSha256 ?? null };
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo, createdAt: sourceDate, intent }, null, 1);
  events.push({ eventText, eventSha256: sourceHash(eventText) });
}
async function read(name: string, args: Record<string, string | null>) {
  if (name === "read_engagement_synthesis_review") {
    expect(args).toEqual({ p_campaign: address.campaignId, p_review: address.reviewId, p_revision: args.p_revision });
    const record = reviews.get(args.p_revision ?? currentId);
    return { data: record ? { ...record, currentRevisionId: currentId } : null, error: null };
  }
  if (name === "read_engagement_synthesis_sources") {
    expect(args).toEqual({ p_campaign: address.campaignId, p_request: source.requestId });
    return { data: source, error: null };
  }
  if (name === "read_engagement_synthesis_approval_history") {
    expect(args).toEqual({ p_campaign: address.campaignId, p_review: address.reviewId });
    return { data: { campaignId: address.campaignId, workspaceId: address.workspaceId, reviewId: address.reviewId,
      sourceId: source.requestId, sourceSha256: source.snapshotSha256, preparationSha256: original().preparationSha256,
      headId: events.length ? id(10 + events.length) : null, headSha256: events.at(-1)?.eventSha256 ?? null,
      eventCount: events.length, entries: events }, error: null };
  }
  expect(name).toBe("read_engagement_response_history");
  expect(args).toEqual({ p_campaign: address.campaignId });
  return { data: { campaignId: address.campaignId, count: responses.length, entries: responses }, error: null };
}
beforeEach(() => {
  reviews = new Map([[address.reviewId, original()], [id(3), corrected()]]); currentId = address.reviewId;
  events = []; saveApproval(); responses = [response()]; rpc.mockReset().mockImplementation(read);
});

describe("saved synthesis response context loader", () => {
  it("uses one complete verified review read and preserves source, review, approval and response bytes", async () => {
    const result = await loadSynthesisResponseContext(client, address);
    expect(result.group.sourceIds).toHaveLength(302);
    expect(result.context.responseHistory.recordText).toBe(responses[0].record_text);
    expect(result.context.responseHistory.record_sha256).toBe(responses[0].record_sha256);
    expect(result.response.created_by).toBe(sourceActor);
    expect(result.context.revision.contentText).toBe(original().revision.contentText);
    expect(result.context.preparationText).toBe(original().preparationText);
    expect(result.context.approval).toEqual(events[0]);
    expect(result.context.source).toEqual(source);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["read_engagement_synthesis_review", "read_engagement_synthesis_sources",
      "read_engagement_synthesis_approval_history", "read_engagement_response_history"]);
    expect((await loadSynthesisResponseContext(client, address)).packet).toEqual(result.packet);
  });
  it("selects the latest response version without reserializing or falling back to an earlier copy", async () => {
    responses.push(response(2));
    responses.push({ ...response(1, "created", id(99)), id: id(999) });
    const result = await loadSynthesisResponseContext(client, address);
    expect(result.context.responseHistory.id).toBe(responses[1].id);
    expect(result.context.responseHistory.revision).toBe(2);
    expect(result.context.responseHistory.recordText).toBe(responses[1].record_text);
    expect(result.response.we_did).toBe("SYNTHETIC answer 2 é");
    responses.push(response(3, "removed"));
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "conflict" });
  });
  it("verifies corrected review lineage and requires its own exact current approval", async () => {
    currentId = id(3);
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "conflict" });
    expect(rpc.mock.calls.some(([name]) => name === "read_engagement_response_history")).toBe(false);
    saveApproval(corrected());
    const result = await loadSynthesisResponseContext(client, address);
    expect(result.context.revision).toMatchObject({ id: id(3), number: 2 });
    expect(result.content.notes).toBe("SYNTHETIC retained minority concern");
    expect(result.approval.eventSha256).toBe(events[1].eventSha256);
  });
  it.each(["absent", "withdrawn"])("refuses %s approval before loading response content", async state => {
    if (state === "absent") events = []; else saveApproval(original(), "withdraw");
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "conflict" });
    expect(rpc.mock.calls.some(([name]) => name === "read_engagement_response_history")).toBe(false);
  });
  it("refuses missing reviews, groups and response rows", async () => {
    await expect(loadSynthesisResponseContext(client, { ...address, groupId: "absent" })).rejects.toMatchObject({ kind: "conflict" });
    responses = [];
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "conflict" });
    reviews.clear();
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "conflict" });
  });
  it("refuses malformed or expanded addresses before reading private records", async () => {
    for (const patch of [{ responseId: "bad" }, { workspaceId: "bad" }, { groupId: "bad/path" }, { public: true }]) {
      await expect(loadSynthesisResponseContext(client, { ...address, ...patch })).rejects.toMatchObject({ kind: "invalid" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses an inconsistent observed current revision instead of presenting it as the head", async () => {
    rpc.mockImplementation(async (name: string, args: Record<string, string | null>) => {
      const result = await read(name, args);
      if (name === "read_engagement_synthesis_review") return { data: { ...original(), currentRevisionId: id(3) }, error: null };
      return result;
    });
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "conflict" });
  });
  it("rejects corrupt or incomplete history even when the selected response itself is valid", async () => {
    responses.push({ ...response(1, "created", id(99)), id: id(98), record_sha256: sourceHash("corrupt") });
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "unavailable" });
    responses = [response(2)];
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("replays review commands rather than trusting a rehashed uncommanded correction", async () => {
    const forged = corrected();
    const content = JSON.parse(forged.revision.contentText) as Record<string, unknown>;
    forged.revision.contentText = JSON.stringify({ ...content, notes: "SYNTHETIC uncommanded private change" });
    forged.revision.contentSha256 = sourceHash(forged.revision.contentText);
    reviews.set(id(3), forged); currentId = id(3); saveApproval(forged);
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it.each(["read_engagement_synthesis_review", "read_engagement_synthesis_sources", "read_engagement_synthesis_approval_history", "read_engagement_response_history"])("returns no context after denied %s", async denied => {
    rpc.mockImplementation((name: string, args: Record<string, string | null>) => name === denied
      ? { data: null, error: { code: "42501", message: "SYNTHETIC private diagnostic" } } : read(name, args));
    // The existing source reader intentionally exposes a generic unavailable error.
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({
      kind: denied === "read_engagement_synthesis_sources" ? "unavailable" : "forbidden",
    });
    await expect(loadSynthesisResponseContext(client, address)).rejects.not.toThrow("private diagnostic");
  });
  it("keeps interrupted or failed reads unavailable instead of manufacturing an empty history", async () => {
    for (const mode of ["transport", "database"]) {
      rpc.mockImplementation((name: string, args: Record<string, string | null>) => {
        if (name !== "read_engagement_response_history") return read(name, args);
        if (mode === "transport") throw new Error("SYNTHETIC private transport detail");
        return { data: null, error: { code: "XX000", message: "SYNTHETIC private detail" } };
      });
      await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "unavailable" });
    }
  });
  it("refuses a failed response read even when it carries a valid earlier payload", async () => {
    rpc.mockImplementation(async (name: string, args: Record<string, string | null>) => {
      const result = await read(name, args);
      return name === "read_engagement_response_history" ? { ...result, error: { code: "XX000", message: "SYNTHETIC failed read" } } : result;
    });
    await expect(loadSynthesisResponseContext(client, address)).rejects.toMatchObject({ kind: "unavailable" });
  });
});
