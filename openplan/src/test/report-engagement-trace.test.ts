import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import native from "./fixtures/decision-link-native.json";
import { address, makeContext, row } from "./fixtures/engagement/decision-synthesis";
import { chain, history } from "./fixtures/engagement/synthesis-response-link";
import { buildCampaignReviewHtml, buildCampaignReviewWorkbook, parseReviewSnapshot } from "@/lib/engagement/review-export";
import { readDecisionLinkSnapshot } from "@/lib/engagement/decision-links";
import type { CloseLoopEntryRow } from "@/lib/engagement/close-loop";
import { buildReportEngagementSummary } from "@/lib/reports/engagement";
import {
  buildReportEngagementTrace,
  loadReportEngagementTrace,
  type ReportEngagementTrace,
} from "@/lib/reports/engagement-trace";
import { buildCampaignReportHtml } from "@/lib/reports/html";

vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: async () => ({ engine: "chrome", bytes: new Uint8Array([37, 80, 68, 70]) }) }));

/**
 * KI-2026-11-02-010. The project packet must let a reader follow one resident
 * contribution to the staff response that answers it, the staff review theme
 * and the project decision, with counts that match the internal engagement
 * review files for the same records. Fixture records mirror the November 2
 * engagement-case journey: six contributions, five approved, one withheld, one
 * published response answering two of them, and a link plus refresh to one
 * project decision.
 */

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const CROSSING = "d90d2cdc-483f-45c7-83d1-d403c5ba75c6";
const SIDEWALK = "6c08172a-8174-4c75-8501-7e2847dd97f0";
const BILLING = "c0fa4477-9d37-4d75-bccc-1630e2b28ab8";
const item = (id: string, minute: number, title: string, status: string) => ({
  id, campaign_id: address.campaignId, category_id: null, title, status, source_type: "public",
  body: `SYNTHETIC words for ${title}`, submitted_by: "SYNTHETIC Resident Name", moderation_notes: status === "rejected" ? "SYNTHETIC off-topic reason" : null,
  latitude: null, longitude: null, geometry: null, parent_item_id: null, configuration_version_id: null,
  created_at: `2026-11-02T07:0${minute}:00Z`, updated_at: `2026-11-02T07:0${minute}:00Z`,
});
const ITEMS = [
  item(CROSSING, 1, "Near misses crossing Fifth at Cedar", "approved"),
  item(SIDEWALK, 2, "Broken sidewalk, no curb ramp", "approved"),
  item("1b9c3f1e-0000-4000-8000-000000000003", 3, "Bike lane gap on Fifth", "approved"),
  item("1b9c3f1e-0000-4000-8000-000000000004", 4, "Paso peatonal sin luz", "approved"),
  item(BILLING, 5, "Utility billing question", "rejected"),
  item("1b9c3f1e-0000-4000-8000-000000000006", 6, "Speeding near the school", "approved"),
];
const entry = (overrides: Partial<CloseLoopEntryRow>): CloseLoopEntryRow => ({
  id: address.responseId, campaign_id: address.campaignId, category_id: null,
  theme_title: "Walking safety on Fifth Avenue", you_said: "SYNTHETIC crossings and sidewalks feel unsafe",
  we_did: "SYNTHETIC the project proposes a high-visibility crosswalk", status: "published", ai_assisted: false,
  source_item_ids: [CROSSING, SIDEWALK], sort_order: 0, published_at: "2026-11-02T07:24:46Z",
  created_at: "2026-11-02T07:20:00Z", updated_at: "2026-11-02T07:24:46Z", ...overrides,
});
const PUBLISHED = entry({});
const DRAFT = entry({ id: "e0000000-0000-4000-8000-000000000099", theme_title: "SYNTHETIC draft theme", status: "draft", published_at: null, source_item_ids: [] });

/** A decision-link context whose theme link is still in force (link, then refresh; no withdrawal). */
function liveThemeContext() {
  const context = makeContext(), values = chain();
  const live = history([values.first, values.second]) as (typeof context.synthesisHistory.histories)[number];
  context.synthesisHistory = { observation: "retained_at_link_preview", historyCount: 1, eventCount: 2, histories: [live] };
  return context;
}

type SavedLink = Omit<ReturnType<typeof row>, "predecessor_id" | "payload_json"> & { predecessor_id: string | null; payload_json: Record<string, unknown> };

/** An original link and the refresh that follows it, as the decision-link RPC returns them. */
function linkThenRefresh(): SavedLink[] {
  const first: SavedLink = row(liveThemeContext());
  const refresh: SavedLink = row(liveThemeContext());
  refresh.id = "0fa37f20-ef7e-40e8-9772-5317cb468107";
  refresh.operation = "refresh";
  refresh.predecessor_id = first.id;
  refresh.created_at = "2026-11-02T07:40:00.000000+00:00";
  refresh.payload_json = { ...refresh.payload_json, operation: "refresh", predecessorId: first.id };
  refresh.payload_text = JSON.stringify(refresh.payload_json);
  refresh.payload_sha256 = hash(refresh.payload_text);
  return [first, refresh];
}

function decisionPacket(entries = linkThenRefresh()) {
  const leaf = entries.at(-1)!;
  return {
    ...structuredClone(native.initial), campaignId: address.campaignId, workspaceId: address.workspaceId,
    entries, entryCount: entries.length,
    current: [{ linkId: leaf.id, sourceState: "unchanged", currentContextSha256: leaf.context_sha256, unavailableReason: null }], currentCount: 1,
  };
}

async function loadedTrace(responses: CloseLoopEntryRow[] = [PUBLISHED, DRAFT]) {
  const snapshot = await readDecisionLinkSnapshot(decisionPacket(), address);
  return buildReportEngagementTrace({ items: ITEMS, responses: { rows: responses, error: null }, decisionLinks: { snapshot, error: null } });
}

function packetHtml(trace: ReportEngagementTrace) {
  const engagement = buildReportEngagementSummary({
    campaign: { id: address.campaignId, title: "Fifth Avenue listening", summary: null, status: "active", engagement_type: "map_feedback", share_token: null, updated_at: "2026-11-02T08:00:00Z" },
    categories: [], items: ITEMS, trace,
  });
  return buildCampaignReportHtml({
    report: { id: "report-1", title: "Engagement Handoff Packet", summary: null, report_type: "project_status", created_at: "2026-11-02T08:00:00Z" },
    workspace: { id: address.workspaceId, name: "Test Workspace" },
    engagement: engagement!,
    sections: [{ id: "section-1", section_key: "engagement_summary", title: "Engagement summary", enabled: true, sort_order: 0, config_json: {} }],
  });
}

/** Strip markup so assertions read the sentence a board member reads. */
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");

describe("the project packet carries the comment-to-decision trace", () => {
  it("names the response, the contributions it answers, the staff review theme and the decision link", async () => {
    const trace = await loadedTrace();
    const [first, refresh] = linkThenRefresh();
    const text = words(packetHtml(trace));
    const block = text.slice(text.indexOf("From comment to decision"));

    expect(block).toContain("Walking safety on Fifth Avenue");
    expect(block).toContain(`Response ${address.responseId}`);
    expect(block).toContain("You said: SYNTHETIC crossings and sidewalks feel unsafe");
    expect(block).toContain("We did: SYNTHETIC the project proposes a high-visibility crosswalk");
    expect(block).toContain(`Answers 2 contributions Near misses crossing Fifth at Cedar (${CROSSING}) Broken sidewalk, no curb ramp (${SIDEWALK})`);
    expect(block).toContain("SYNTHETIC decision · Proposed · SYNTHETIC linked project");
    expect(block).toContain(`Link record ${refresh.id} · link, refresh`);
    expect(block).not.toContain(`Link record ${first.id}`);
    expect(block).toContain("Staff review theme: SYNTHETIC retained category (approved revision 1)");
    // A draft response is not part of the published record.
    expect(block).not.toContain("SYNTHETIC draft theme");
  });

  it("reports the same contribution, response and decision-link counts as the internal review files", async () => {
    const [first, refresh] = linkThenRefresh();
    const raw = JSON.stringify({
      schema: 2, capturedAt: "2026-11-02T08:00:00Z", scope: "internal", filters: {},
      campaign: { id: address.campaignId, title: "Fifth Avenue listening", summary: null, configurationVersionId: null },
      items: ITEMS, sessions: [], answers: [], responses: [PUBLISHED], definitions: [],
      workspaceId: address.workspaceId, decisionLinkHistoryScope: "campaign", decisionLinkCount: 2, decisionLinks: [first, refresh],
    });
    const review = await parseReviewSnapshot(raw, hash(raw));
    const reviewText = words(buildCampaignReviewHtml(review, hash(raw)));
    const book = XLSX.read(await buildCampaignReviewWorkbook(review, hash(raw)), { type: "buffer" });
    const summary = Object.fromEntries(XLSX.utils.sheet_to_json<{ "Record set": string; Count: number }>(book.Sheets.Summary).map((r) => [r["Record set"], r.Count]));

    const trace = await loadedTrace();
    assert(trace.state === "loaded");
    const packet = words(packetHtml(trace));

    const reviewState = (label: string) => Number(new RegExp(`${label} (\\d+)`).exec(reviewText)?.[1]);
    expect(trace.counts).toEqual({
      contributions: summary.Contributions,
      byState: { approved: reviewState("Approved"), rejected: reviewState("Withheld"), pending: reviewState("pending"), flagged: reviewState("flagged") },
      publishedResponses: summary["Staff responses"],
      decisionLinkActions: summary["Decision history actions"],
    });
    // The numbers themselves, so a shared mistake in both documents still fails here.
    expect(trace.counts).toEqual({ contributions: 6, byState: { approved: 5, rejected: 1, pending: 0, flagged: 0 }, publishedResponses: 1, decisionLinkActions: 2 });
    expect(reviewText).toContain("2 saved actions across the entire consultation");
    expect(packet).toContain("6 contributions: 5 approved, 1 withheld, 0 pending, 0 flagged. 1 published staff response. 2 decision-link actions");
  });

  it("discloses a failed response read as unknown, never as no responses", async () => {
    const snapshot = await readDecisionLinkSnapshot(decisionPacket(), address);
    const trace = buildReportEngagementTrace({ items: ITEMS, responses: { rows: [], error: { message: "permission denied for function read_engagement_response_snapshot" } }, decisionLinks: { snapshot, error: null } });
    const text = words(packetHtml(trace));

    expect(text).toContain("Staff responses could not be read. They are unknown here, not zero. Reported cause: permission denied for function read_engagement_response_snapshot");
    expect(text).toContain("Published staff responses unknown");
    expect(text).not.toContain("No staff response has been published");
    expect(text).not.toContain("0 published staff responses");
  });

  it("discloses a failed decision-link read as unknown, never as no link", async () => {
    const trace = buildReportEngagementTrace({ items: ITEMS, responses: { rows: [PUBLISHED], error: null }, decisionLinks: { snapshot: null, error: { message: "OpenPlan could not confirm this request." } } });
    const text = words(packetHtml(trace));

    expect(text).toContain("Decision links could not be read. They are unknown here, not none. Reported cause: OpenPlan could not confirm this request.");
    expect(text).toContain("decision-link actions unknown");
    expect(text).toContain("Decision links unknown: the read failed.");
    expect(text).not.toContain("No decision link recorded");
  });

  it("leaves out withheld words, names, review notes, actors and decision rationale", async () => {
    // The database refuses to publish a response citing a withheld comment; the
    // packet must still hold the line if one arrives.
    const trace = await loadedTrace([entry({ source_item_ids: [CROSSING, BILLING, "1b9c3f1e-0000-4000-8000-0000000000ff"] })]);
    const html = packetHtml(trace);
    const text = words(html);
    const [, refresh] = linkThenRefresh();

    expect(text).toContain(`A contribution not approved for release (${BILLING}, rejected). Its words are left out of this packet.`);
    expect(text).toContain("A contribution no longer in this campaign's records (1b9c3f1e-0000-4000-8000-0000000000ff)");
    for (const secret of ["Utility billing question", "SYNTHETIC words for", "SYNTHETIC Resident Name", "SYNTHETIC off-topic reason", refresh.actor_id, "SYNTHETIC private rationale"]) {
      expect(html).not.toContain(secret);
    }
  });

  it("prints nothing when the packet path never read the trace", () => {
    expect(packetHtml({ state: "not_loaded" })).not.toContain("From comment to decision");
  });
});

describe("loadReportEngagementTrace", () => {
  it("reads every staff response and the campaign's decision links through the review files' readers", async () => {
    const rpc = vi.fn(async (name: string) => name === "read_engagement_response_snapshot"
      ? { data: { campaignId: address.campaignId, publishedOnly: false, count: 2, entries: [PUBLISHED, DRAFT] }, error: null }
      : { data: decisionPacket(), error: null });
    const trace = await loadReportEngagementTrace({ rpc } as unknown as Pick<SupabaseClient, "rpc">, address, ITEMS);

    expect(rpc).toHaveBeenCalledWith("read_engagement_response_snapshot", { p_campaign: address.campaignId, p_published_only: false });
    expect(rpc).toHaveBeenCalledWith("read_engagement_decision_links", { p_campaign: address.campaignId });
    assert(trace.state === "loaded");
    expect(trace.counts.publishedResponses).toBe(1);
    expect(trace.responses?.[0].decisions?.[0].operations).toEqual(["link", "refresh"]);
  });

  it("turns a decision history that fails its checks into a disclosed failure", async () => {
    const tampered = decisionPacket();
    tampered.entries[1].context_text += " ";
    const rpc = vi.fn(async (name: string) => name === "read_engagement_response_snapshot"
      ? { data: { campaignId: address.campaignId, publishedOnly: false, count: 1, entries: [PUBLISHED] }, error: null }
      : { data: tampered, error: null });
    const trace = await loadReportEngagementTrace({ rpc } as unknown as Pick<SupabaseClient, "rpc">, address, ITEMS);

    assert(trace.state === "loaded");
    expect(trace.decisionReadError).toMatch(/could not confirm/);
    expect(trace.counts.decisionLinkActions).toBeNull();
    expect(trace.responses?.[0].decisions).toBeNull();
  });
});

function assert(condition: boolean): asserts condition {
  if (!condition) throw new Error("assertion failed");
}
