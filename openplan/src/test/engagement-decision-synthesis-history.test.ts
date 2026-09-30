import { createHash } from "node:crypto";
import { address, makeContext, packet, row } from "./fixtures/engagement/decision-synthesis";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import native from "./fixtures/decision-link-native.json";
import reviewNative from "./fixtures/engagement-review-decision-history-native.json";
import { chain, packet as eventPacket, id, event } from "./fixtures/engagement/synthesis-response-link";
import { readDecisionContext, readDecisionLink, readDecisionLinkReceipt, type DecisionLinkIntent } from "@/lib/engagement/decision-links";
import { verifyDecisionSynthesisSources } from "@/lib/engagement/decision-synthesis-history-server";
import { loadDecisionContext, loadDecisionLinks, writeDecisionLink } from "@/lib/engagement/decision-links-server";
import { parseReviewSnapshot } from "@/lib/engagement/review-export";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function changeEvent(context: ReturnType<typeof makeContext>, index: number, change: (value: ReturnType<typeof event>) => void) {
  const chain = context.synthesisHistory.histories[0], value = JSON.parse(chain.entries[index].eventText);
  change(value); chain.entries[index] = eventPacket(value);
  if (index === chain.entries.length - 1) { chain.headId = value.intent.requestId; chain.headSha256 = chain.entries[index].eventSha256; }
}
function extraReview(context: ReturnType<typeof makeContext>, mutation: "none" | "event" | "revision" | "response" = "none") {
  const original = JSON.parse(context.synthesisHistory.histories[0].entries[0].eventText);
  const retained = JSON.parse(original.context.contextText), reviewId = id(500);
  retained.reviewId = reviewId;
  if (mutation !== "revision") retained.revision.id = id(501);
  const approval = JSON.parse(retained.approval.eventText);
  approval.intent.reviewId = reviewId; approval.intent.revisionId = retained.revision.id; approval.intent.requestId = id(502);
  retained.approval = eventPacket(approval);
  if (mutation === "response") {
    const record = JSON.parse(retained.responseHistory.recordText); record.we_did = "SYNTHETIC inconsistent older response";
    retained.responseHistory.recordText = JSON.stringify(record); retained.responseHistory.record_sha256 = hash(retained.responseHistory.recordText);
  }
  original.context = packet(retained); original.intent.reviewId = reviewId; original.intent.expectedContextSha256 = original.context.contextSha256;
  if (mutation !== "event") original.intent.requestId = id(503);
  const value = eventPacket(original), added = { ...context.synthesisHistory.histories[0], reviewId, eventCount: 1,
    entries: [value], headId: original.intent.requestId, headSha256: value.eventSha256 };
  context.synthesisHistory.histories.push(added); context.synthesisHistory.historyCount++; context.synthesisHistory.eventCount++;
}

function nestedSourceFault() {
  const context = makeContext();
  // Only the original event changes. Repair the successor hash so the failure is nested evidence, not chain custody.
  changeEvent(context, 0, value => {
    const evidence = JSON.parse(value.context.contextText); evidence.preparationText = "{}"; evidence.preparationSha256 = hash("{}");
    const approval = JSON.parse(evidence.approval.eventText); approval.intent.preparationSha256 = hash("{}");
    evidence.approval = eventPacket(approval); value.context = packet(evidence); value.intent.expectedContextSha256 = value.context.contextSha256;
  });
  // Isolate one captured link so cross-version immutable-identity checks do not hide the source check.
  const h = context.synthesisHistory.histories[0]; h.entries = h.entries.slice(0, 1); h.eventCount = 1;
  h.headId = JSON.parse(h.entries[0].eventText).intent.requestId; h.headSha256 = h.entries[0].eventSha256; context.synthesisHistory.eventCount = 1;
  return context;
}

describe("decision synthesis history", () => {
  it.each([false, true])("retains original, corrected and withdrawn evidence with harmless formatting %s", async formatted => {
    const context = makeContext(), raw = packet(context);
    if (formatted) { raw.contextText = JSON.stringify(context, null, 2); raw.contextSha256 = hash(raw.contextText); }
    const result = await readDecisionContext(raw, address);
    await verifyDecisionSynthesisSources(result.context);
    expect(result.context.schema).toBe(2); expect(result.context).toEqual(context);
    expect(context.synthesisHistory.histories[0].entries[0]).toEqual(chain().first);
  });
  it("distinguishes legacy uncaptured history from new observed zero", async () => {
    const context = makeContext(); context.synthesisHistory = { observation: "retained_at_link_preview", historyCount: 0, eventCount: 0, histories: [] };
    expect((await readDecisionContext(packet(context), address)).context).toMatchObject({ schema: 2, synthesisHistory: { eventCount: 0 } });
    const old = await readDecisionLink(native.initial.entries[0], native.scope);
    expect(old.context.schema).toBe(1); expect(old.context).not.toHaveProperty("synthesisHistory");
  });
  it.each([
    ["history count", (c: ReturnType<typeof makeContext>) => { c.synthesisHistory.historyCount++; }, "inventory is incomplete"],
    ["event count", (c: ReturnType<typeof makeContext>) => { c.synthesisHistory.eventCount++; }, "inventory is incomplete"],
    ["missing event", (c: ReturnType<typeof makeContext>) => { c.synthesisHistory.histories[0].entries.pop(); }, "history is incomplete"],
    ["duplicate address", (c: ReturnType<typeof makeContext>) => {
      const first = JSON.parse(c.synthesisHistory.histories[0].entries[0].eventText); first.intent.requestId = id(700);
      const value = eventPacket(first), duplicate = { ...c.synthesisHistory.histories[0], eventCount: 1, entries: [value], headId: id(700), headSha256: value.eventSha256 };
      c.synthesisHistory.histories.push(duplicate); c.synthesisHistory.historyCount++; c.synthesisHistory.eventCount++;
    }, "Duplicate decision synthesis history"],
    ["foreign response", (c: ReturnType<typeof makeContext>) => { c.synthesisHistory.histories[0].responseId = id(999); }, "another review, group or response"],
    ["future response", (c: ReturnType<typeof makeContext>) => {
      const old = chain().original.responseHistory;
      c.response = JSON.parse(old.recordText); c.responseHistory = { id: old.id, revision: old.revision, event: "created",
        actorId: old.actor_id, recordedAt: old.recorded_at, recordText: old.recordText, recordSha256: old.record_sha256 };
    }, "response version differs"],
    ["replaced response identity", (c: ReturnType<typeof makeContext>) => { c.responseHistory.id = id(999); }, "response version differs"],
    ["replaced response bytes", (c: ReturnType<typeof makeContext>) => { c.responseHistory.recordText += " "; c.responseHistory.recordSha256 = hash(c.responseHistory.recordText); }, "response version differs"],
  ] as const)("refuses %s", async (_name, change, message) => {
    const context = makeContext(); change(context);
    await expect(readDecisionContext(packet(context), address)).rejects.toThrow(message);
  });
  it("keeps independent reviews of the same response", async () => {
    const context = makeContext(); extraReview(context);
    await expect(readDecisionContext(packet(context), address)).resolves.toBeDefined();
    await expect(verifyDecisionSynthesisSources(context)).resolves.toBeUndefined();
  });
  it.each(["event", "revision", "response"] as const)("refuses cross-review %s identity conflicts", async kind => {
    const context = makeContext(); extraReview(context, kind);
    await expect(readDecisionContext(packet(context), address)).rejects.toThrow(kind === "event" ? "Duplicate decision synthesis event" : "retained identity differs");
  });
  it("requires full nested source verification at the server boundary", async () => {
    const context = nestedSourceFault();
    await expect(readDecisionContext(packet(context), address)).resolves.toBeDefined();
    await expect(verifyDecisionSynthesisSources(context)).rejects.toThrow("preparation differs from source");
  });
  it.each([false, true])("checks verified save acknowledgements without rewriting exact bytes %s", async replayed => {
    const saved = row();
    const { campaignId: _campaign, ...payload } = saved.payload_json;
    const intent = { requestId: saved.id, ...payload } as DecisionLinkIntent;
    const checked = await readDecisionLinkReceipt({ link: saved, replayed }, { ...address, actorId: saved.actor_id }, intent);
    expect(checked.receipt.link.context_text).toBe(saved.context_text);
    await verifyDecisionSynthesisSources(checked.link.context);
  });
  it.each([false, true])("server preview, history and save verify nested evidence %s", async broken => {
    const context = broken ? nestedSourceFault() : makeContext(), saved = row(context);
    const rpc = vi.fn(); const client = { rpc } as unknown as Pick<SupabaseClient, "rpc">;
    rpc.mockResolvedValue({ data: packet(context), error: null });
    const preview = await loadDecisionContext(client, address);
    expect(preview.error?.status ?? 200).toBe(broken ? 503 : 200);
    expect(rpc).toHaveBeenLastCalledWith("read_engagement_response_decision_context", { p_campaign: address.campaignId, p_response: address.responseId, p_decision: address.decisionId });
    const snapshot = { ...native.initial, campaignId: address.campaignId, workspaceId: address.workspaceId, entries: [saved],
      current: [{ linkId: saved.id, sourceState: "unchanged", currentContextSha256: saved.context_sha256, unavailableReason: null }] };
    rpc.mockResolvedValue({ data: snapshot, error: null });
    expect((await loadDecisionLinks(client, address)).error?.status ?? 200).toBe(broken ? 503 : 200);
    expect(rpc).toHaveBeenLastCalledWith("read_engagement_decision_links", { p_campaign: address.campaignId });
    rpc.mockResolvedValue({ data: { link: saved, replayed: true }, error: null });
    const { campaignId: _campaign, ...payload } = saved.payload_json;
    const intent = { requestId: saved.id, ...payload } as DecisionLinkIntent;
    expect((await writeDecisionLink(client, { ...address, actorId: saved.actor_id }, intent)).error?.status ?? 200).toBe(broken ? 503 : 200);
    expect(rpc).toHaveBeenLastCalledWith("write_engagement_response_decision_link", { p_campaign: address.campaignId, p_response: address.responseId, p_decision: address.decisionId,
      p_request: intent.requestId, p_operation: intent.operation, p_predecessor: intent.predecessorId, p_expected_context_sha256: intent.expectedContextSha256, p_reason: intent.reason });
  });
  it.each([false, true])("reviewed exports verify nested evidence %s", async broken => {
    const snapshot = JSON.parse(reviewNative.snapshotText);
    snapshot.campaign.id = address.campaignId; snapshot.workspaceId = address.workspaceId;
    snapshot.decisionLinks = [row(broken ? nestedSourceFault() : makeContext())]; snapshot.decisionLinkCount = 1;
    const text = JSON.stringify(snapshot), parsed = parseReviewSnapshot(text, hash(text));
    if (broken) await expect(parsed).rejects.toThrow("preparation differs from source");
    else expect((await parsed).schema).toBe(2);
  });
});
