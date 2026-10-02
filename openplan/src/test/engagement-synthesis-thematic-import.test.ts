import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as readReview, POST as writeReview } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/reviews/route";
import { GET as readApproval } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/approvals/route";
import { GET as readResponseContext } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/response-links/route";
import { createSynthesisReviewContent, type SynthesisReviewIntent } from "@/lib/engagement/synthesis-review";
import { loadSynthesisReview, retainSynthesisReview } from "@/lib/engagement/synthesis-review-server";
import type { SynthesisReviewRecord } from "@/lib/engagement/synthesis-review-records";
import { verifySynthesisSource } from "@/lib/engagement/synthesis-sources-server";
import { loadSynthesisResponseContext } from "@/lib/engagement/synthesis-response-links-server";
import { importSynthesisThematicReview } from "@/lib/engagement/synthesis-thematic-import-server";
import { loadSynthesisApprovalState } from "@/lib/engagement/synthesis-approval-server";
import { synthesisThematicHistoryFixture } from "./fixtures/engagement/synthesis-thematic-history";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

const routeState = vi.hoisted(() => ({ client: undefined as unknown, service: undefined as unknown, campaign: undefined as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => routeState.client, createServiceRoleClient: () => routeState.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: async () => ({ campaign: routeState.campaign, allowed: true, error: null }) }));

async function fixture(grouped = false) {
  const f = await synthesisThematicHistoryFixture();
  if (grouped) {
    const context = f.prepared.input.contexts.find(row => row.notes.length > 0);
    if (!context) throw new Error("SYNTHETIC cited context unavailable");
    const member = { sourceId: context.sourceId, rationale: "SYNTHETIC membership", citations: [{ noteId: context.notes[0].id, quote: context.notes[0].text.slice(0, 3) }] };
    f.final.recapture(JSON.stringify({ ...f.final.output,
      groups: ["one", "two"].map(id => ({ id, label: `SYNTHETIC ${id}`, summary: "Complete Unicode é 中文 wording", sentiment: "mixed", members: [member] })),
      unassigned: f.final.output.unassigned.filter(row => row.sourceId !== context.sourceId),
    }));
  }
  const history = await f.load();
  if (!history.proposal || history.manifest.throughSequence === null) throw new Error("SYNTHETIC proposal unavailable");
  const source = verifySynthesisSource(f.prepared.source, { requestId: f.prepared.source.requestId,
    workspaceId: f.scope.workspaceId, campaignId: f.scope.campaignId });
  const initial = createSynthesisReviewContent(source.snapshot, source.snapshotSha256);
  const scope = { campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId, reviewId: randomUUID() };
  const actorId = randomUUID(), createdAt = source.createdAt;
  const create: SynthesisReviewIntent = { operation: "create", requestId: scope.reviewId, actorId, workspaceId: scope.workspaceId,
    sourceId: source.requestId, sourceSha256: source.snapshotSha256 };
  const contentText = JSON.stringify(initial.content), preparationText = JSON.stringify(initial.preparation);
  const first: SynthesisReviewRecord = { ...scope, sourceId: source.requestId, sourceSha256: source.snapshotSha256,
    preparationText, preparationSha256: hash(preparationText), createdAt, createdBy: actorId, currentRevisionId: scope.reviewId,
    revision: { requestId: scope.reviewId, revisionNo: 1, parentId: null, parentSha256: null, actorId, reason: null,
      intent: create, contentText, contentSha256: hash(contentText), createdAt } };
  const records = new Map<string, SynthesisReviewRecord>([[scope.reviewId, first]]), options = { head: scope.reviewId as string, dropReply: false, error: "" };
  const approvalIntent = { ...scope, sourceId: source.requestId, sourceSha256: source.snapshotSha256,
    preparationSha256: first.preparationSha256, revisionId: first.revision.requestId, revisionNo: 1,
    revisionSha256: first.revision.contentSha256, requestId: randomUUID(), actorId, operation: "approve", reason: "SYNTHETIC prior approval",
    predecessorId: null, predecessorSha256: null };
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo: 1, createdAt, intent: approvalIntent });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    if (name === "read_engagement_synthesis_review") return Promise.resolve({ data: records.has(String(args.p_revision ?? options.head))
      ? { ...structuredClone(records.get(String(args.p_revision ?? options.head))!), currentRevisionId: options.head } : null,
    error: options.error ? { code: options.error } : null });
    if (name === "read_engagement_synthesis_approval_history") return Promise.resolve({ data: {
      ...scope, sourceId: source.requestId, sourceSha256: source.snapshotSha256, preparationSha256: first.preparationSha256,
      headId: approvalIntent.requestId, headSha256: hash(eventText), eventCount: 1, entries: [{ eventText, eventSha256: hash(eventText) }],
    }, error: null });
    return f.client.rpc(name, args);
  });
  const client = { rpc } as unknown as Pick<SupabaseClient, "rpc">;
  const persist = vi.fn(async (name: string, args: Record<string, unknown>) => {
    expect(name).toBe("retain_engagement_synthesis_review");
    const intent = args.p_intent as SynthesisReviewIntent;
    if (intent.operation === "create") throw new Error("SYNTHETIC parent already exists");
    const parent = records.get(options.head)!;
    if (intent.expectedRevisionId !== options.head || intent.expectedRevisionSha256 !== parent.revision.contentSha256) return { data: null, error: { code: "PT409" } };
    const record: SynthesisReviewRecord = { ...first, currentRevisionId: intent.requestId, revision: {
      requestId: intent.requestId, revisionNo: parent.revision.revisionNo + 1, parentId: parent.revision.requestId,
      parentSha256: parent.revision.contentSha256, actorId: intent.actorId, reason: intent.reason, intent,
      contentText: String(args.p_content_text), contentSha256: hash(String(args.p_content_text)), createdAt,
    } };
    records.set(intent.requestId, record); options.head = intent.requestId;
    if (options.dropReply) { options.dropReply = false; throw new Error("SYNTHETIC acknowledgement lost"); }
    return { data: { ...scope, requestId: intent.requestId, sourceId: source.requestId, sourceSha256: source.snapshotSha256,
      preparationSha256: first.preparationSha256, revisionNo: record.revision.revisionNo,
      revisionSha256: record.revision.contentSha256, createdAt, replayed: false }, error: null };
  });
  const service = { from: f.service.from, rpc: persist } as unknown as Pick<SupabaseClient, "rpc" | "from">;
  const intent: Extract<SynthesisReviewIntent, { operation: "import_thematic" }> = {
    operation: "import_thematic", requestId: randomUUID(), actorId, workspaceId: scope.workspaceId, reviewId: scope.reviewId,
    expectedRevisionId: scope.reviewId, expectedRevisionSha256: first.revision.contentSha256, reason: "SYNTHETIC inspect this proposal as a new draft",
    proposal: { requestId: f.scope.requestId, selectionSequence: history.manifest.throughSequence, historyManifestSha256: history.sha256,
      proposalSha256: history.proposal.sha256, finalCaptureSha256: String(f.final.outputRow.capture_sha256) },
  };
  return { f, scope, source, initial, first, records, options, client, service, persist, intent, history, approvalIntent,
    write: (command: SynthesisReviewIntent = intent) => retainSynthesisReview(client, service, scope.campaignId, command),
    read: (revisionId?: string) => loadSynthesisReview(client, { ...scope, ...(revisionId ? { revisionId } : {}) }, undefined, service) };
}

describe("original thematic proposal import", () => {
  it("joins the actual review, approval and response routes to original import replay", async () => {
    const f = await fixture(true);
    routeState.client = { ...f.client, auth: { getUser: async () => ({ data: { user: { id: f.intent.actorId } } }) } };
    routeState.service = f.service; routeState.campaign = { workspace_id: f.scope.workspaceId };
    const base = `http://localhost/api/engagement/campaigns/${f.scope.campaignId}/synthesis`;
    const context = { params: Promise.resolve({ campaignId: f.scope.campaignId }) };
    const post = () => new NextRequest(`${base}/reviews`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(f.intent) });
    expect((await writeReview(post(), context)).status).toBe(201);
    expect((await writeReview(post(), context)).status).toBe(200);
    const saved = await readReview(new NextRequest(`${base}/reviews?mode=read&reviewId=${f.scope.reviewId}`), context);
    expect(saved.status).toBe(200);
    expect((await saved.json()).content.machineOrigin.proposalText).toBe(f.history.proposal!.canonical);
    const approval = await readApproval(new NextRequest(`${base}/approvals?reviewId=${f.scope.reviewId}`), context);
    expect(approval.status).toBe(200); expect((await approval.json()).current.revisionId).toBe(f.intent.requestId);
    const response = await readResponseContext(new NextRequest(`${base}/response-links?mode=context&reviewId=${f.scope.reviewId}&groupId=one&responseId=${randomUUID()}`), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ kind: "conflict" });
  });
  it("imports into an exact new revision, retains full machine evidence through correction and preserves old approval", async () => {
    const f = await fixture(), original = JSON.stringify(f.first), receipt = await f.write(), saved = (await f.read())!;
    expect(receipt).toMatchObject({ revisionNo: 2, replayed: false });
    expect(saved.content.machineOrigin).toEqual({ interpretation: "machine_unreviewed", reference: f.intent.proposal,
      proposalText: f.history.proposal!.canonical, historyText: f.history.canonical });
    expect(JSON.parse(saved.content.machineOrigin!.proposalText).contextEvidence).toEqual(f.history.proposal!.content.contextEvidence);
    expect(saved.content.unassignedSourceIds).toEqual(f.history.proposal!.content.unassignedSourceIds);
    const state = (await loadSynthesisApprovalState(f.client, f.scope, f.service))!;
    expect(state.current.revisionId).toBe(f.intent.requestId);
    expect(state.history.head!.intent.revisionId).toBe(f.scope.reviewId);
    await expect(loadSynthesisResponseContext(f.client, { ...f.scope, responseId: randomUUID(), groupId: "category-1" }, f.service))
      .rejects.toThrow("Approve the current saved review before linking a response");
    const corrected = await f.write({ operation: "correct", requestId: randomUUID(), actorId: f.intent.actorId, workspaceId: f.scope.workspaceId,
      reviewId: f.scope.reviewId, expectedRevisionId: f.intent.requestId, expectedRevisionSha256: receipt.revisionSha256,
      reason: "SYNTHETIC wording review", change: { kind: "notes", title: "Staff wording", notes: "Keep the original uncertainty available." } });
    expect(corrected.revisionNo).toBe(3);
    expect((await f.read())!.content.machineOrigin).toEqual(saved.content.machineOrigin);
    expect((await f.read(f.scope.reviewId))!.content).toEqual(f.initial.content);
    expect(JSON.stringify(f.records.get(f.scope.reviewId))).toBe(original);
  });
  it("imports cited groups with exact unique and overlapping source counts", async () => {
    const f = await fixture(true); await f.write(); const saved = (await f.read())!;
    expect(saved.content.groups).toEqual(f.history.proposal!.content.groups.map(({ id, label, summary, sentiment, sourceIds }) => ({ id, label, summary, sentiment, sourceIds })));
    expect(saved.content.groups).toHaveLength(2);
    expect(saved.content.assignedSourceCount).toBe(1); expect(saved.content.overlappingSourceCount).toBe(1);
    expect(saved.content.unassignedSourceIds).toHaveLength(f.f.prepared.input.contexts.length - 1);
    expect(JSON.parse(saved.content.machineOrigin!.proposalText).groups[0].members[0].citations.length).toBeGreaterThan(0);
  });
  it("recovers the same retained import after lost acknowledgement without another revision", async () => {
    const f = await fixture(); f.options.dropReply = true;
    await expect(f.write()).rejects.toThrow("acknowledgement lost");
    expect(await f.write()).toMatchObject({ revisionNo: 2, replayed: true });
    expect(f.persist).toHaveBeenCalledTimes(1); expect(f.records.size).toBe(2);
    await expect(f.write({ ...f.intent, reason: "SYNTHETIC changed retry" })).rejects.toMatchObject({ kind: "conflict" });
  });
  it("reconstructs imports after original requester cancellation", async () => {
    const f = await fixture(); f.f.cancel();
    await f.write(); expect((await f.read())!.content.machineOrigin!.reference).toEqual(f.intent.proposal);
    expect(f.f.serviceRpc).not.toHaveBeenCalled();
  });
  it.each(["historyManifestSha256", "proposalSha256", "finalCaptureSha256"] as const)("refuses a changed %s without writing", async field => {
    const f = await fixture(); f.intent.proposal[field] = "a".repeat(64);
    await expect(f.write()).rejects.toThrow("Selected thematic proposal differs");
    expect(f.persist).not.toHaveBeenCalled();
  });
  it("refuses an earlier incomplete selection snapshot", async () => {
    const f = await fixture(); f.intent.proposal.selectionSequence--;
    await expect(f.write()).rejects.toThrow("Selected thematic proposal differs"); expect(f.persist).not.toHaveBeenCalled();
  });
  it.each(["expectedRevisionId", "expectedRevisionSha256"] as const)("fences %s before importing", async field => {
    const f = await fixture(); f.intent[field] = field === "expectedRevisionId" ? randomUUID() : "a".repeat(64);
    await expect(f.write()).rejects.toMatchObject({ kind: "conflict" }); expect(f.persist).not.toHaveBeenCalled();
  });
  it("refuses importing a proposal into another valid retained source", async () => {
    const f = await fixture(), snapshot = { ...f.source.snapshot, requestId: randomUUID() };
    const snapshotText = JSON.stringify(snapshot), snapshotSha256 = hash(snapshotText);
    const source = { ...f.source, requestId: snapshot.requestId, snapshot, snapshotText, snapshotSha256 };
    const parent = createSynthesisReviewContent(snapshot, snapshotSha256).content;
    await expect(importSynthesisThematicReview(f.client, f.service, f.scope.campaignId, parent, f.intent, source))
      .rejects.toThrow("Selected thematic proposal differs");
  });
  it("requires original capture access to reopen an imported review", async () => {
    const f = await fixture(); await f.write();
    await expect(loadSynthesisReview(f.client, f.scope)).rejects.toThrow("Original thematic evidence reader is required");
    f.f.final.outputRow.capture_text += " ";
    await expect(f.read()).rejects.toThrow();
  });
  it.each(["proposalText", "historyText"] as const)("rejects self-checksummed tampering with retained %s", async field => {
    const f = await fixture(); await f.write(); const record = f.records.get(f.intent.requestId)!;
    const content = JSON.parse(record.revision.contentText); content.machineOrigin[field] += " ";
    record.revision.contentText = JSON.stringify(content); record.revision.contentSha256 = hash(record.revision.contentText);
    await expect(f.read()).rejects.toThrow("Saved review content differs from its command");
  });
  it("refuses failed authenticated review reads without writing", async () => {
    const f = await fixture(); f.options.error = "42501";
    await expect(f.write()).rejects.toMatchObject({ kind: "forbidden" }); expect(f.persist).not.toHaveBeenCalled();
  });
});
