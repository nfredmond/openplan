/**
 * THE SAFETY ACTION PLAN REPORT AND THE SS4A APPLICATION CARRY THE SAME
 * ENGAGEMENT, BENEFIT-COST AND MAP EVIDENCE (rehearsal 2026-11-03, D12 to D18,
 * D21).
 *
 * The rehearsal found the report printed "Engagement and collaboration: Not
 * covered" from a constant, read no benefit-cost analysis and drew no network
 * map, and that the SS4A engagement appendix stated a finding only when an AI
 * synthesis was cached. A workspace with no AI key could never cite its
 * approved staff review.
 *
 * These tests read the staff review through the real custody verifiers with a
 * fake RPC client that serves byte-exact records, so a review that does not
 * verify is not counted. The last block renders both documents to PDF with
 * Chrome and reads them back with poppler.
 *
 * Blind category: live RLS on the staff-review RPCs (CI's RLS job covers the
 * functions, not this read), the hosted Chrome bundle, and how a reader at
 * 390 px sees the export pages. The PDF block is skipped where Chrome or
 * poppler is not installed; the text-tier tests still run there.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { calculateBcaDocument } from "@/lib/bca/workbench/engine";
import type { BcaDocument } from "@/lib/bca/workbench/schema";
import { STAFF_REVIEW_FINDING_CAVEAT } from "@/lib/engagement/staff-review-finding";
import { loadApprovedStaffReview } from "@/lib/engagement/staff-review-finding-server";
import type { SynthesisApprovalIntent, SynthesisApprovalPacket } from "@/lib/engagement/synthesis-approval";
import { applySynthesisReviewChange, createSynthesisReviewContent, type SynthesisReviewIntent } from "@/lib/engagement/synthesis-review";
import type { SynthesisReviewRecord } from "@/lib/engagement/synthesis-review-records";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { engagementEvidenceAppendix, type EvidenceAppendix, type ProjectEngagementRead } from "@/lib/grants/evidence-appendices";
import { buildProjectEngagementEvidenceByProjectId } from "@/lib/grants/engagement-evidence";
import { ENGAGEMENT_COMMENT_COUNT_PROJECTION, loadProjectEngagementRead, type EvidenceQueryClient } from "@/lib/grants/evidence-appendix-reads";
import { SS4A_APPENDIX_KEYS } from "@/lib/grants/ss4a-appendix-keys";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { buildReportHtml, safetyActionPlanMarkup, type ReportGenerationData } from "@/lib/reports/html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { buildSafetyPlanNetworkMap, buildSafetyPlanSupport, safetyPlanEngagementInput } from "@/lib/reports/safety-plan-support";
import { buildProjectStageGateSnapshot, buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { buildSafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { readCrashPublicationEvidence } from "@/lib/safety/publication-evidence";
import { describeCountermeasureSource, getSafetyCountermeasure } from "@/lib/safety/countermeasures";
import { SAFETY_SEED_CAVEAT } from "@/lib/grants/safety-seed-origin";
import { renderSafetyStreetContextSvg } from "@/lib/safety/street-context-svg";
import { findPdfPhrase, letterSpacedRuns } from "../../scripts/lib/pdf-text-match.mjs";
import { makeSourceSnapshot, savedSource, sourceActor, sourceDate, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";
import {
  BCA_VERSION_ROW,
  CAMPAIGN_ROW,
  completeEvidenceRecords,
  EVIDENCE_DATE,
  EVIDENCE_IDS,
  evidenceRoads,
  evidenceSnapshot,
  fixtureNetwork,
  NO_STAFF_REVIEW,
  STUDY_AREA,
} from "./fixtures/grants/ss4a-evidence";

// ---------------------------------------------------------------------------
// A staff review with byte-exact custody records, served by a fake RPC client.
// ---------------------------------------------------------------------------

const campaignId = sourceScope.campaignId;
const workspaceId = sourceScope.workspaceId;
const reviewId = "e5000000-0000-4000-8000-000000000001";
const correctedId = "e5000000-0000-4000-8000-000000000002";
const approvalId = "f5000000-0000-4000-8000-000000000001";
const withdrawalId = "f5000000-0000-4000-8000-000000000002";
const snapshot = makeSourceSnapshot(2);
const source = savedSource(snapshot);
const initial = createSynthesisReviewContent(snapshot, source.snapshotSha256);

function originalRecord(): SynthesisReviewRecord {
  const preparationText = JSON.stringify(initial.preparation);
  const contentText = JSON.stringify(initial.content);
  const intent: SynthesisReviewIntent = { requestId: reviewId, actorId: sourceActor, workspaceId, operation: "create", sourceId: source.requestId, sourceSha256: source.snapshotSha256 };
  return {
    reviewId, campaignId, workspaceId, sourceId: source.requestId, sourceSha256: source.snapshotSha256,
    preparationText, preparationSha256: sourceHash(preparationText), createdAt: sourceDate, createdBy: sourceActor, currentRevisionId: reviewId,
    revision: { requestId: reviewId, revisionNo: 1, parentId: null, parentSha256: null, actorId: sourceActor, reason: null,
      intent, contentText, contentSha256: sourceHash(contentText), createdAt: sourceDate },
  };
}

function correctedRecord(): SynthesisReviewRecord {
  const first = originalRecord();
  const intent: SynthesisReviewIntent = { requestId: correctedId, actorId: sourceActor, workspaceId, operation: "correct", reviewId,
    expectedRevisionId: reviewId, expectedRevisionSha256: first.revision.contentSha256, reason: "SYNTHETIC correction",
    change: { kind: "notes", title: "SYNTHETIC corrected review", notes: "SYNTHETIC note" } };
  const contentText = JSON.stringify(applySynthesisReviewChange(initial.content, intent.change, snapshot, source.snapshotSha256));
  return { ...first, currentRevisionId: correctedId, revision: { requestId: correctedId, revisionNo: 2, parentId: reviewId,
    parentSha256: first.revision.contentSha256, actorId: sourceActor, reason: intent.reason, intent, contentText,
    contentSha256: sourceHash(contentText), createdAt: sourceDate } };
}

const scope = { campaignId, workspaceId, reviewId, sourceId: source.requestId, sourceSha256: source.snapshotSha256, preparationSha256: originalRecord().preparationSha256 };

function approval(operation: "approve" | "withdraw", eventNo: number, predecessor: SynthesisApprovalPacket | null): SynthesisApprovalPacket {
  const intent: SynthesisApprovalIntent = { ...scope, revisionId: reviewId, revisionNo: 1, revisionSha256: originalRecord().revision.contentSha256,
    actorId: sourceActor, requestId: operation === "approve" ? approvalId : withdrawalId, operation, reason: "SYNTHETIC staff approval",
    predecessorId: predecessor ? approvalId : null, predecessorSha256: predecessor?.eventSha256 ?? null };
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo, createdAt: sourceDate, intent });
  return { eventText, eventSha256: sourceHash(eventText) };
}

type ReviewState = "approved" | "unapproved" | "withdrawn" | "corrected_after_approval" | "no_sources" | "list_fails";

/** The RPC client a staff member's session would be: list, then the custody readers. */
function staffReviewRpc(state: ReviewState, calls: Array<[string, unknown]> = []) {
  const head = state === "corrected_after_approval" ? correctedId : reviewId;
  const reviews = new Map([[reviewId, originalRecord()], [correctedId, correctedRecord()]]);
  const first = approval("approve", 1, null);
  const events = state === "unapproved" ? [] : state === "withdrawn" ? [first, approval("withdraw", 2, first)] : [first];
  return async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    if (name === "list_engagement_synthesis_sources") {
      if (state === "list_fails") return { data: null, error: { message: "unavailable", code: "PT503" } };
      return { data: { campaignId, workspaceId, pageSize: 25, nextCursor: null, entries: state === "no_sources" ? [] : [{
        requestId: source.requestId, campaignId, workspaceId, snapshotSha256: source.snapshotSha256, createdAt: sourceDate,
        counts: snapshot.counts, selection: snapshot.selection }] }, error: null };
    }
    if (name === "list_engagement_synthesis_reviews") {
      return { data: { campaignId, workspaceId, sourceId: source.requestId, pageSize: 25, nextCursor: null,
        entries: [{ reviewId, createdAt: sourceDate, revisionNo: head === correctedId ? 2 : 1, revisionSha256: reviews.get(head)!.revision.contentSha256, title: "SYNTHETIC" }] }, error: null };
    }
    if (name === "read_engagement_synthesis_sources") return { data: source, error: null };
    if (name === "read_engagement_synthesis_review") {
      const record = reviews.get((args.p_revision as string | null) ?? head);
      return { data: record ? { ...record, currentRevisionId: head } : null, error: null };
    }
    if (name === "read_engagement_synthesis_approval_history") {
      const last = events.at(-1);
      return { data: { ...scope, headId: last ? (events.length === 2 ? withdrawalId : approvalId) : null, headSha256: last?.eventSha256 ?? null,
        eventCount: events.length, entries: events }, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  };
}

// ---------------------------------------------------------------------------
// The engagement reads: campaigns, comment counts by exact count, staff review.
// ---------------------------------------------------------------------------

const CAMPAIGN = { ...CAMPAIGN_ROW, id: campaignId, ai_synthesis_json: null, ai_synthesized_at: null };
const FIRST_COMMENT = "2026-10-19T15:00:00+00:00";
const LAST_COMMENT = "2026-10-20T16:30:00+00:00";

type Call = { table: string; method: string; args: unknown[] };

function engagementClient(state: ReviewState, calls: Call[] = [], rpcCalls: Array<[string, unknown]> = []): EvidenceQueryClient {
  const rpc = staffReviewRpc(state, rpcCalls);
  return {
    from(table: string) {
      const self: Record<string, unknown> = {};
      const own: Call[] = [];
      for (const method of ["select", "eq", "neq", "in", "order", "limit"]) {
        self[method] = (...args: unknown[]) => {
          const call = { table, method, args };
          own.push(call);
          calls.push(call);
          return self;
        };
      }
      self.maybeSingle = async () => ({ data: null, error: null });
      self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (table === "engagement_campaigns") return Promise.resolve({ data: [CAMPAIGN], error: null, count: 1 }).then(resolve, reject);
        if (table !== "engagement_items") return Promise.reject(new Error(`Unexpected table ${table}`)).then(resolve, reject);
        const approvedOnly = own.some((call) => call.method === "eq" && call.args[0] === "status" && call.args[1] === "approved");
        const ascending = (own.find((call) => call.method === "order")?.args[1] as { ascending?: boolean } | undefined)?.ascending !== false;
        return Promise.resolve({ data: [{ created_at: ascending ? FIRST_COMMENT : LAST_COMMENT }], error: null, count: approvedOnly ? 2 : 4 }).then(resolve, reject);
      };
      return self as never;
    },
    rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args ?? {}),
  };
}

async function engagementRead(state: ReviewState): Promise<ProjectEngagementRead> {
  return loadProjectEngagementRead(engagementClient(state), EVIDENCE_IDS.project, workspaceId);
}

function fact(block: EvidenceAppendix, label: string) {
  return block.facts.find((entry) => entry.label === label)?.value;
}

const STAFF_FINDING = `An approved staff review (revision 1, approved Jan 2, 2026) sorts 3 comment(s) and survey answer(s) from "${CAMPAIGN.title}" into 1 theme(s); 0 are not assigned to a theme. ${STAFF_REVIEW_FINDING_CAVEAT}`;

describe("the approved staff review is read through its custody verifiers (D16, D21)", () => {
  it("finds the approved current revision and reduces it to counts and theme labels", async () => {
    const calls: Array<[string, unknown]> = [];
    const read = await loadApprovedStaffReview(
      { rpc: staffReviewRpc("approved", calls) } as unknown as Pick<SupabaseClient, "rpc">,
      { campaignId, workspaceId }
    );
    expect(read).toMatchObject({ status: "approved", unverifiedReviewCount: 0, finding: {
      reviewId, revisionNo: 1, approvedAt: sourceDate, sourceId: source.requestId, commentCount: 2, surveyAnswerCount: 1,
      assignedCount: 3, unassignedCount: 0, themes: [{ label: "SYNTHETIC retained category", recordCount: 3, sentiment: "not_assessed" }],
    } });
    expect(calls.slice(0, 2)).toEqual([
      ["list_engagement_synthesis_sources", { p_campaign: campaignId, p_before: null }],
      ["list_engagement_synthesis_reviews", { p_campaign: campaignId, p_source: source.requestId, p_before: null }],
    ]);
  });

  it.each([
    ["unapproved", "none"],
    ["withdrawn", "none"],
    // A correction never inherits the approval of the revision before it.
    ["corrected_after_approval", "none"],
    ["no_sources", "none"],
    ["list_fails", "unreadable"],
  ] as const)("reads a %s review as %s, never as approved", async (state, expected) => {
    const read = await loadApprovedStaffReview({ rpc: staffReviewRpc(state) } as unknown as Pick<SupabaseClient, "rpc">, { campaignId, workspaceId });
    expect(read.status).toBe(expected);
  });

  it("does not read a review whose bytes fail verification as unapproved", async () => {
    const rpc = staffReviewRpc("approved");
    const tampered = async (name: string, args: Record<string, unknown>) => {
      const result = await rpc(name, args);
      if (name !== "read_engagement_synthesis_approval_history") return result;
      const data = result.data as { entries: SynthesisApprovalPacket[] };
      return { ...result, data: { ...data, entries: data.entries.map((entry) => ({ ...entry, eventText: `${entry.eventText} ` })) } };
    };
    const read = await loadApprovedStaffReview({ rpc: tampered } as unknown as Pick<SupabaseClient, "rpc">, { campaignId, workspaceId });
    expect(read).toEqual({ status: "unreadable", reason: "1 saved staff review(s) could not be verified, so whether an approved review exists is unknown." });
  });
});

describe("SS4A Appendix E states the staff finding when no AI synthesis exists", () => {
  it("prints counts, dates, method and the labeled staff finding", async () => {
    const calls: Call[] = [];
    const read = await loadProjectEngagementRead(engagementClient("approved", calls), EVIDENCE_IDS.project, workspaceId);
    const appendix = engagementEvidenceAppendix({ key: "engagement", letter: "E", title: "Engagement summary" }, read, "Example safety project");
    expect(appendix.status).toBe("included");
    expect(appendix.statusNote).toBeNull();
    expect(fact(appendix, "Method")).toBe("Map comments");
    expect(fact(appendix, "Comments received")).toBe("4, received from Oct 19, 2026 to Oct 20, 2026");
    expect(fact(appendix, "Comments approved")).toBe("2");
    expect(fact(appendix, "Community-input finding source")).toBe(`Approved staff review ${reviewId}, revision 1, approved Jan 2, 2026`);
    expect(appendix.notes).toContain(STAFF_FINDING);
    expect(appendix.notes).toContain('Themes in that staff review, with the number of comment(s) and survey answer(s) in each: "SYNTHETIC retained category" (3, staff sentiment not assessed).');
    expect(appendix.source).toMatchObject({ dateLabel: "Staff review approved", date: sourceDate });

    // Projections and filters, as literals. Counts come from the exact count
    // header, so a campaign over the 1,000-row cap is still counted whole.
    const items = calls.filter((call) => call.table === "engagement_items");
    expect(items.filter((call) => call.method === "select").map((call) => call.args)).toEqual(Array(3).fill(["created_at", { count: "exact" }]));
    expect(ENGAGEMENT_COMMENT_COUNT_PROJECTION).toBe("created_at");
    expect(items.filter((call) => call.method === "eq").map((call) => call.args)).toEqual([
      ["campaign_id", campaignId], ["campaign_id", campaignId], ["campaign_id", campaignId], ["status", "approved"],
    ]);
    expect(items.filter((call) => call.method === "limit").map((call) => call.args)).toEqual([[1], [1], [1]]);
    expect(calls.find((call) => call.table === "engagement_campaigns" && call.method === "select")?.args).toEqual([
      "id, project_id, title, status, engagement_type, updated_at, ai_synthesis_json, ai_synthesized_at, representativeness_json, representativeness_computed_at",
      { count: "exact" },
    ]);
  });

  it("says no finding is stated when there is neither a synthesis nor an approved review", async () => {
    const appendix = engagementEvidenceAppendix({ key: "engagement", letter: "E", title: "Engagement summary" }, await engagementRead("unapproved"), null);
    expect(appendix.statusNote).toBe("No comment synthesis or approved staff review is saved for the lead campaign, so no community-input finding is stated.");
    expect(fact(appendix, "Community-input finding source")).toBe("None");
    expect(fact(appendix, "Comments approved")).toBe("2");
    expect(appendix.notes.join(" ")).not.toContain("staff review");
  });

  it("keeps a failed staff-review read distinct from no review", async () => {
    const appendix = engagementEvidenceAppendix({ key: "engagement", letter: "E", title: "Engagement summary" }, await engagementRead("list_fails"), null);
    expect(appendix.statusNote).toContain("saved staff reviews could not be checked");
    expect(appendix.statusNote).toContain("That is a failed read, not an absence of review.");
    // "None" would say no approved review exists. The read failed, so that is unknown.
    expect(fact(appendix, "Community-input finding source")).toBe("Unknown. Saved staff reviews could not be checked");
  });

  it("still says the staff-review read failed when a saved synthesis supplies a finding", async () => {
    const failed = await engagementRead("list_fails");
    if (failed.status !== "ready" || failed.staffReview.status !== "unreadable") throw new Error("fixture: expected an unreadable staff review");
    const read: ProjectEngagementRead = {
      ...failed,
      evidence: buildProjectEngagementEvidenceByProjectId([CAMPAIGN_ROW]).get(EVIDENCE_IDS.project)!,
    };
    const appendix = engagementEvidenceAppendix({ key: "engagement", letter: "E", title: "Engagement summary" }, read, null);
    const source = fact(appendix, "Community-input finding source");
    expect(source).toMatch(/^Keyword-based synthesis saved /);
    expect(source).toContain("Saved staff reviews could not be checked, so whether an approved review also exists is unknown");
    expect(appendix.statusNote).toContain("Saved staff reviews could not be checked.");
    expect(appendix.statusNote).toContain(failed.staffReview.reason);

    // The same campaign with a staff-review read that found none says nothing about a failure.
    const none = engagementEvidenceAppendix({ key: "engagement", letter: "E", title: "Engagement summary" }, { ...read, staffReview: NO_STAFF_REVIEW }, null);
    expect(none.statusNote).toBeNull();
    expect(fact(none, "Community-input finding source")).toMatch(/^Keyword-based synthesis saved [^.]*$/);
  });
});

// ---------------------------------------------------------------------------
// The report's safety action plan section.
// ---------------------------------------------------------------------------

const PLAN_NETWORK = fixtureNetwork();
const PLAN = {
  ingestId: EVIDENCE_IDS.ingest,
  attachments: [{ segmentId: PLAN_NETWORK.segments[0].id, segmentLabel: PLAN_NETWORK.segments[0].label, countermeasureIds: ["walkways"] }],
};

function planEvidence() {
  return buildSafetyCrashEvidence({
    id: EVIDENCE_IDS.ingest, projectId: EVIDENCE_IDS.project, status: "ready", severityCompleteness: "fatal_only",
    sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)", attribution: null, crashCount: 4, geocodedCount: 4, storedCount: 4, truncated: false,
    yearsRequested: [2023, 2024], createdAt: EVIDENCE_DATE, dimensionCoverage: null, partyCompleteness: "not_supported", partyCount: null, involvementBasis: null,
  }, { severity: { fatal: 4, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 }, role: null });
}

async function reportSection(withRecords: boolean) {
  const engagement: ProjectEngagementRead = withRecords ? await engagementRead("approved") : { status: "absent" };
  const reads = { engagement, bca: withRecords ? { status: "workbench" as const, row: BCA_VERSION_ROW() } : { status: "absent" as const } };
  const draft = buildSafetyActionPlanSection({ plan: PLAN, evidence: planEvidence(), network: PLAN_NETWORK, engagement: safetyPlanEngagementInput(engagement) });
  const support = buildSafetyPlanSupport({
    reads, projectId: EVIDENCE_IDS.project, projectName: "Example safety project",
    networkMap: buildSafetyPlanNetworkMap({ network: PLAN_NETWORK, roads: evidenceRoads(), projectGeometry: STUDY_AREA }),
  });
  return { draft, support, html: safetyActionPlanMarkup(draft, support) };
}

const HIGHLIGHT = /stroke="#b42318" stroke-width="5"/g;

function text(html: string) {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ");
}

describe("the report's safety action plan carries engagement, BCA and the map (D12, D13)", () => {
  it("states what was received and marks engagement partly covered, never covered", async () => {
    const { draft, html } = await reportSection(true);
    expect(draft.components.find((entry) => entry.component === "Engagement and collaboration")).toEqual({
      component: "Engagement and collaboration", status: "partial",
      gap: `Has 2 approved public comment(s) and an approved staff review of public input from "${CAMPAIGN.title}". Lacks partner and agency collaboration records and a documented engagement process.`,
    });
    const body = text(html);
    expect(body).toContain("Engagement summary");
    expect(body).toContain("Comments received 4, received from Oct 19, 2026 to Oct 20, 2026");
    expect(body).toContain("Comments approved 2");
    expect(body).toContain("Method Map comments");
    expect(body).toContain(STAFF_FINDING);
    expect(body).toContain("Engagement and collaboration: Partly covered.");
  });

  it("summarizes the saved BCA with its input sources and caveats", async () => {
    const { html } = await reportSection(true);
    const doc = BCA_VERSION_ROW().document_json as BcaDocument;
    const ratio = calculateBcaDocument(doc).benefitCostRatio!.toFixed(3);
    const body = text(html);
    expect(body).toContain("Benefit-cost summary");
    expect(body).toContain(`Benefit-cost ratio ${ratio}`);
    expect(body).toContain("Synthetic training assumptions Assumption 3 OpenPlan synthetic example, Training example, no observed data Not a real project. Do not submit.");
    expect(body).toContain("Inputs marked as an assumption, missing or model screening are not documented values.");
    expect(body).toContain("Responsible analyst review and program acceptance are not established by this calculation.");
  });

  it("says Missing for both when the project has neither record", async () => {
    const { draft, html } = await reportSection(false);
    const body = text(html);
    expect(body).toContain("Engagement summary Missing. No public engagement campaign is linked to the project.");
    expect(body).toContain("Benefit-cost summary Missing. No benefit-cost analysis or screening is saved for the linked project.");
    expect(draft.components.find((entry) => entry.component === "Engagement and collaboration")?.status).toBe("not_covered");
  });

  it("draws every ranked segment, and the table, the marks and the caption agree", async () => {
    const { draft, support, html } = await reportSection(true);
    const rows = draft.network.kind === "computed" ? draft.network.rows.length : -1;
    expect(rows).toBe(2);
    expect(support.networkMap).toMatchObject({ kind: "drawn", segmentCount: rows });
    expect(html.match(HIGHLIGHT)).toHaveLength(rows);
    expect(html.match(/<tbody>[\s\S]*?<\/tbody>/)![0].match(/<tr>/g)).toHaveLength(rows);
    expect(text(html)).toContain(`High-injury network map. All ${rows} ranked segments in the table are drawn in red and numbered by rank.`);
    // The study area is drawn as the dashed outline.
    expect(html).toContain('stroke-dasharray="8 5"');
  });
});

describe("SS4A appendices A, C and the crash sentences (D14, D15, D17, D18)", () => {
  it("draws the study-area outline on Appendix A and keeps context roads inside the frame", () => {
    const records = completeEvidenceRecords();
    const hin = buildSs4aEvidenceAppendices(records, new Set(SS4A_APPENDIX_KEYS))[0];
    expect(hin.figureSvg).toContain('stroke-dasharray="8 5"');
    expect(hin.notes).toContain("The dashed green line is the project's current study-area boundary.");
  });

  it("never wraps a context road a full turn of longitude across the figure (D18)", () => {
    const network = fixtureNetwork();
    // A context road that runs west past the highlighted frame.
    const westward = { id: "west", name: "West Road", geometry: { type: "LineString" as const, coordinates: [[-100.0, 40.01], [-100.2, 40.01]] as [number, number][] },
      sourceId: "us-census-tiger-line-cache" as const, sourceLabel: "U.S. Census TIGER/Line roads", vintage: "2024" };
    const svg = renderSafetyStreetContextSvg({ roads: [westward], crashLocations: [], projectGeometry: null,
      highlights: network.segments.map((segment) => ({ rank: segment.rank, geometry: segment.geometry })) })!;
    const xs = [...svg.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
    expect(Math.max(...xs)).toBeLessThan(760 * 2);
  });

  it("prints file updates as calendar dates, not raw stamps (D14)", () => {
    // The dash in the CCRS and FARS attributions stays: those adapters are
    // hash-pinned into every stored report packet's readiness payload.
    const publication = readCrashPublicationEvidence(null, { basis: "resource_updates", resources: [{ year: 2025, lastModified: "2026-11-03T03:06:05.300319" }] });
    expect(publication.resourceUpdateNote).toBe("The source supplied no exact publication cutoff. Source file updates: 2025: 2026-11-03. A file update is not a crash-coverage cutoff.");
    expect(readCrashPublicationEvidence("2026-09-05T08:00:00+00:00", { label: "Last-Modified header" }).resourceUpdateNote).toContain("Recorded file update: 2026-09-05.");
  });

  it("names party records separately from the injured-person records used for severity (D15)", () => {
    const evidence = buildSafetyCrashEvidence({
      id: EVIDENCE_IDS.ingest, projectId: EVIDENCE_IDS.project, status: "ready", severityCompleteness: "kabco_full",
      sourceLabel: "California Crash Reporting System (CCRS)", attribution: null, crashCount: 4, geocodedCount: 4, storedCount: 4, truncated: false,
      yearsRequested: [2024], createdAt: EVIDENCE_DATE, dimensionCoverage: null, partyCompleteness: "not_retrieved", partyCount: null, involvementBasis: null,
    }, { severity: { fatal: 1, severe_injury: 1, injury: 1, pdo: 1, unknown: 0 }, role: null });
    expect(evidence.caveats).toContain("Party records, which name each driver, pedestrian and bicyclist involved, were not retrieved for this acquisition, so nobody is counted by role here. That is missing information, not an absence of people.");
    expect(evidence.caveats.join(" ")).not.toContain("Person-level records were not retrieved");
  });

  it("breaks long URLs, ids and hashes anywhere and words only at spaces or hyphens (D17, KI-2026-11-14-114)", () => {
    const records = completeEvidenceRecords();
    records.safety = { status: "ready", snapshot: evidenceSnapshot({}, LONG_URL_COUNTERMEASURES), otherSeededArtifactCount: 0 };
    const html = buildGrantApplicationHtml({
      opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-01T00:00:00.000Z",
      evidenceAppendices: buildSs4aEvidenceAppendices(records, new Set(SS4A_APPENDIX_KEYS)),
    });
    expect(html).toContain(".appendix th, .appendix td { padding: 6px 8px; overflow-wrap: normal; word-break: normal; }");
    expect(html).not.toMatch(/\.appendix th, \.appendix td \{[^}]*anywhere/);
    expect(html).not.toContain('<td class="wrap-anywhere">');
    expect(html).toContain(`<td><span class="wrap-anywhere">${getSafetyCountermeasure("lighting")!.sourceUrl}</span></td>`);
    expect(html).toContain("<td>Enhanced Delineation for Horizontal Curves</td>");
  });
});

// ---------------------------------------------------------------------------
// Both documents as PDFs, read back with poppler.
// ---------------------------------------------------------------------------

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
/**
 * Poppler's tools, from the folder that holds pdftoppm. Another pdftotext
 * (xpdf, which has no -bbox) can come first on PATH, as it does on Windows
 * with Git installed.
 */
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext", "pdfinfo"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
function tool(name: "pdftoppm" | "pdftotext" | "pdfinfo"): string {
  return path.join(POPPLER!, `${name}${process.platform === "win32" ? ".exe" : ""}`);
}
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const LONG_URL_COUNTERMEASURES = ["enhanced-delineation-horizontal-curves", "medians-and-pedestrian-refuge-islands", "crosswalk-visibility-enhancements", "lighting"];
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-exports-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function pdf(name: string, html: string) {
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  const bytes = await renderHtmlToPdf(html, { footerLabel: name });
  const file = path.join(workDir, `${name}.pdf`);
  writeFileSync(file, bytes);
  // Set OPENPLAN_EXPORT_PDF_DIR to keep copies for a person to read.
  const keep = process.env.OPENPLAN_EXPORT_PDF_DIR;
  if (keep) {
    mkdirSync(keep, { recursive: true });
    writeFileSync(path.join(keep, `${name}.pdf`), bytes);
  }
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync(tool("pdfinfo"), [file]).toString())![1]);
  const pageText = Array.from({ length: pages }, (_, index) =>
    execFileSync(tool("pdftotext"), ["-f", String(index + 1), "-l", String(index + 1), file, "-"]).toString());
  return { file, pages, pageText };
}

/** Pixels of the network's highlight red on one page, from a binary PPM. */
function redPixels(file: string, page: number): number {
  const out = path.join(workDir, `page-${page}`);
  execFileSync(tool("pdftoppm"), ["-f", String(page), "-l", String(page), "-r", "60", "-singlefile", file, out]);
  const ppm = readFileSync(`${out}.ppm`);
  // Header "P6 <w> <h> 255", then width * height RGB triples to the end.
  const header = ppm.subarray(0, 32).toString("latin1").split(/\s+/);
  const [width, height] = [Number(header[1]), Number(header[2])];
  const start = ppm.length - width * height * 3;
  let count = 0;
  for (let index = start; index < ppm.length; index += 3) {
    const [r, g, b] = [ppm[index], ppm[index + 1], ppm[index + 2]];
    if (r > 150 && r < 215 && g < 80 && b < 70) count += 1;
  }
  return count;
}

/** Words that run past the right edge of the page, from pdftotext's bounding boxes. */
function wordsOffPage(file: string): string[] {
  const xml = execFileSync(tool("pdftotext"), ["-bbox", file, "-"]).toString();
  const offPage: string[] = [];
  for (const pageMatch of xml.matchAll(/<page width="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)) {
    const width = Number(pageMatch[1]);
    for (const word of pageMatch[2].matchAll(/<word xMin="([\d.]+)"[^>]*xMax="([\d.]+)"[^>]*>([^<]*)<\/word>/g)) {
      if (Number(word[2]) > width + 0.5) offPage.push(word[3]);
    }
  }
  return offPage;
}

/**
 * Words past the right edge of a section's text column, footer excluded. Both
 * exports print on Letter with a 48 px PDF margin, 24 px main padding, a 1 px
 * section border and 24 px section padding: 97 CSS px, or 72.75 pt, from the
 * page edge. A word past it runs into or over the card's border.
 */
function wordsPastCard(file: string): string[] {
  const xml = execFileSync(tool("pdftotext"), ["-bbox", file, "-"]).toString();
  const past: string[] = [];
  for (const pageMatch of xml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)) {
    const [width, height] = [Number(pageMatch[1]), Number(pageMatch[2])];
    for (const word of pageMatch[3].matchAll(/<word xMin="[\d.]+" yMin="[\d.]+" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      if (Number(word[2]) < height - 36 && Number(word[1]) > width - 72.75 + 1) past.push(word[3]);
    }
  }
  return past;
}

/** Every printed word in reading order, with its height in points. */
function wordBoxes(file: string): { text: string; height: number }[] {
  const xml = execFileSync(tool("pdftotext"), ["-bbox", file, "-"]).toString();
  return [...xml.matchAll(/<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g)]
    .map((word) => ({ text: word[3], height: Number(word[2]) - Number(word[1]) }));
}

/** Every word poppler placed on pages `from` onward, in order, lowercased, without edge punctuation. */
function printedWords(file: string, from = 1): string[] {
  const xml = execFileSync(tool("pdftotext"), ["-bbox", "-f", String(from), file, "-"]).toString();
  return [...xml.matchAll(/<word [^>]*>([^<]*)<\/word>/g)].map((word) => plainWord(word[1]));
}
function wordsFrom(file: string, from: number): Set<string> {
  return new Set(printedWords(file, from));
}
function plainWord(word: string): string {
  return word.toLowerCase().replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

function pageWith(pageText: string[], needle: RegExp): number {
  return pageText.findIndex((page) => needle.test(page.replace(/\s+/g, " "))) + 1;
}

function reportData(draft: ReturnType<typeof buildSafetyActionPlanSection>, support: ReturnType<typeof buildSafetyPlanSupport>): ReportGenerationData {
  return {
    report: { id: "r1", title: "Safety action plan report", summary: null, report_type: "project_status", created_at: "2026-11-03T00:00:00.000Z" },
    workspace: { id: "ws-1", name: "Test Workspace" },
    project: { id: EVIDENCE_IDS.project, name: "Example safety project", summary: null, status: "active", plan_type: "corridor_plan",
      delivery_phase: "analysis", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-11-03T00:00:00.000Z" },
    runs: [], sections: [], deliverables: [], risks: [], issues: [], decisions: [], meetings: [], engagement: null, scenarioSetLinks: [],
    projectFundingSnapshot: null,
    projectRecordsSnapshot: {
      deliverables: { count: 0, latestTitle: null, latestAt: null }, risks: { count: 0, latestTitle: null, latestAt: null },
      issues: { count: 0, latestTitle: null, latestAt: null }, decisions: { count: 0, latestTitle: null, latestAt: null },
      meetings: { count: 0, latestTitle: null, latestAt: null },
    },
    stageGateSnapshot: buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1" })),
    modelingEvidence: [],
    safetyActionPlan: draft,
    safetyActionPlanSupport: support,
  } as unknown as ReportGenerationData;
}

describe.runIf(PDF_TOOLS)("both exports as PDFs, read back with pdftotext and pdftoppm", () => {
  it("the safety action plan report carries engagement, BCA and a drawn map", async () => {
    const { draft, support } = await reportSection(true);
    const doc = await pdf("safety-action-plan-report", buildReportHtml(reportData(draft, support)));
    // The shared matcher (scripts/lib/pdf-text-match.mjs) is the one the proof
    // checker and the journey use: case, wrapped lines and letter spacing aside,
    // each phrase must be whole on one page.
    const ratio = calculateBcaDocument(BCA_VERSION_ROW().document_json as BcaDocument).benefitCostRatio!.toFixed(3);
    for (const phrase of ["Engagement summary", "Comments approved", "sorts 3 comment(s) and survey answer(s)", "Benefit-cost summary", ratio,
      "Synthetic training assumptions", "All 2 ranked segments in the table are drawn in red", "Engagement and collaboration: Partly covered"]) {
      expect(findPdfPhrase(doc.pageText, phrase), phrase).not.toEqual([]);
    }
    // KI-2026-11-14-117: labels read back as words, not as single letters.
    expect(doc.pageText.flatMap(letterSpacedRuns)).toEqual([]);
    const mapPage = pageWith(doc.pageText, /High-injury network map\. All 2 ranked/);
    expect(mapPage).toBeGreaterThan(0);
    // The caption can land on the page after its figure; one of the two holds the drawing.
    expect(Math.max(redPixels(doc.file, mapPage), mapPage > 1 ? redPixels(doc.file, mapPage - 1) : 0)).toBeGreaterThan(50);
    expect(wordsOffPage(doc.file)).toEqual([]);
  }, 120_000);

  it("the SS4A application carries the staff finding, the BCA and a drawn map", async () => {
    const records = completeEvidenceRecords();
    records.engagement = await engagementRead("approved");
    const html = buildGrantApplicationHtml({
      opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-01T00:00:00.000Z",
      evidenceAppendices: buildSs4aEvidenceAppendices(records, new Set(SS4A_APPENDIX_KEYS)),
    });
    const doc = await pdf("ss4a-application", html);
    for (const phrase of ["Appendix E. Engagement summary", "sorts 3 comment(s) and survey answer(s)", "Comments approved", "Appendix D. Benefit-cost summary", "Synthetic training assumptions"]) {
      expect(findPdfPhrase(doc.pageText, phrase), phrase).not.toEqual([]);
    }
    // KI-2026-11-14-117: labels read back as words, not as single letters.
    expect(doc.pageText.flatMap(letterSpacedRuns)).toEqual([]);
    const mapPage = pageWith(doc.pageText, /Appendix A\. High-injury network map/);
    expect(mapPage).toBeGreaterThan(0);
    expect(Math.max(redPixels(doc.file, mapPage), redPixels(doc.file, Math.min(mapPage + 1, doc.pages)))).toBeGreaterThan(50);
    expect(wordsOffPage(doc.file)).toEqual([]);
  }, 120_000);

  // KI-2026-11-14-212: an item FHWA removed printed its list status in large
  // bold type, and the Internet Archive URLs ran to the card edge on the
  // report's countermeasure page and the SS4A Appendix C and seed caveats.
  it("prints the off-list line as a quiet line and wraps archive URLs inside the card", async () => {
    const network = fixtureNetwork();
    const plan = { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: network.segments[0].id, segmentLabel: network.segments[0].label, countermeasureIds: ["bicycle-lanes", "lighting"] }] };
    const draft = buildSafetyActionPlanSection({ plan, evidence: planEvidence(), network, engagement: null });
    const support = buildSafetyPlanSupport({ reads: { engagement: { status: "absent" }, bca: { status: "absent" } }, projectId: EVIDENCE_IDS.project, projectName: "Example safety project", networkMap: null });
    const html = buildReportHtml(reportData(draft, support));
    expect(html).toContain('<span class="list-status">Not on FHWA');
    const report = await pdf("safety-report-off-list", html);
    expect(report.pageText.join("").replace(/\s+/g, "")).toContain(getSafetyCountermeasure("bicycle-lanes")!.sourceUrl.slice(0, 40));
    expect(wordsPastCard(report.file)).toEqual([]);
    // The status line runs from after "Bicycle Lanes." to the "Addresses:"
    // that opens the item's body text; it must print smaller than that body.
    const words = wordBoxes(report.file);
    const start = words.findIndex((word, index) => word.text === "Lanes." && words[index - 1]?.text === "Bicycle" && words[index + 1]?.text === "Not");
    const end = words.findIndex((word, index) => index > start && word.text === "Addresses:");
    expect(start).toBeGreaterThan(0);
    expect(end - start).toBeGreaterThan(20);
    const status = words.slice(start + 1, end).map((word) => word.height);
    expect(Math.max(...status)).toBeLessThan(words[end].height - 1);

    const records = completeEvidenceRecords();
    records.safety = { status: "ready", snapshot: evidenceSnapshot({}, ["bicycle-lanes", "lighting"]), otherSeededArtifactCount: 0 };
    const sourceLine = describeCountermeasureSource({ ids: ["bicycle-lanes"] });
    const application = await pdf("ss4a-off-list", buildGrantApplicationHtml({
      opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-01T00:00:00.000Z",
      evidenceAppendices: buildSs4aEvidenceAppendices(records, new Set(["countermeasures"] as const)),
      safetySeedHistory: [{ kind: "openplan.ss4a-safety-seed.v1", artifactId: EVIDENCE_IDS.ingest, reportId: EVIDENCE_IDS.ingest, acquisitionId: EVIDENCE_IDS.ingest,
        snapshotHash: "a".repeat(64), caveat: SAFETY_SEED_CAVEAT, sourceCaveats: [sourceLine] }],
    }));
    expect(application.pageText.join("").replace(/\s+/g, "")).toContain("https://web.archive.org/web/");
    expect(wordsPastCard(application.file)).toEqual([]);
  }, 120_000);

  it("keeps the countermeasure table inside the page (D17)", async () => {
    // The rehearsal's clipped table held several countermeasures with long
    // source URLs. Only Appendix C is printed, so the table stays on one page
    // and its text reads back in order.
    const records = completeEvidenceRecords();
    records.safety = { status: "ready", snapshot: evidenceSnapshot({}, LONG_URL_COUNTERMEASURES), otherSeededArtifactCount: 0 };
    const html = buildGrantApplicationHtml({
      opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-01T00:00:00.000Z",
      evidenceAppendices: buildSs4aEvidenceAppendices(records, new Set(["countermeasures"] as const)),
    });
    const doc = await pdf("ss4a-countermeasures", html);
    const tablePage = pageWith(doc.pageText, /Appendix C\. Countermeasures/);
    expect(tablePage).toBeGreaterThan(0);
    // Poppler drops glyphs past the page edge, so a clipped column loses
    // characters. Each URL must also read back whole on one page: a table row
    // that split across a page break (KI-2026-11-14-117, seen on Linux) left
    // the end of a URL on the next page. The matcher allows the line breaks of
    // the narrow column and a hyphen Poppler drops at a line end.
    for (const id of LONG_URL_COUNTERMEASURES) {
      const url = getSafetyCountermeasure(id)!.sourceUrl;
      expect(findPdfPhrase(doc.pageText.slice(tablePage - 1), url), url).not.toEqual([]);
    }
    expect(wordsOffPage(doc.file)).toEqual([]);
    // KI-2026-11-14-114: a fixed-width column split "Delineatio n". Words in
    // the headers and the countermeasure text break only at spaces or hyphens.
    const printed = wordsFrom(doc.file, tablePage);
    const table = buildSs4aEvidenceAppendices(records, new Set(["countermeasures"] as const)).find((appendix) => appendix.key === "countermeasures")!.table!;
    const words = [...table.headers, ...table.rows.flatMap((row) => row.slice(0, 5))]
      .flatMap((text) => text.split(/[\s-]+/)).map(plainWord).filter(Boolean);
    expect(words.filter((word) => !printed.has(word))).toEqual([]);
    // The same across the evidence appendices, the index included: a printed
    // word is a word of the source text, or a piece of a long URL, id or hash,
    // which may break anywhere. The check starts at the appendices.
    const text = html.replace(/<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&#39;/g, "'");
    const tokens = text.split(/\s+/);
    const vocabulary = new Set([...tokens, ...tokens.flatMap((token) => token.split("-")), "ss4a-countermeasures", "page", "of"].map(plainWord));
    const longRuns = (text.match(/\S{20,}/g) ?? []).map((run) => run.toLowerCase().replace(/-/g, ""));
    const all = printedWords(doc.file);
    const start = all.findIndex((word, index) => word === "evidence" && all[index + 1] === "appendices");
    const end = all.findIndex((word, index) => word === "provenance" && all[index + 1] === "appendix");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const fragments = all.slice(start, end).filter((word) => word && !vocabulary.has(word)
      && !/^\d+$/.test(word) && !longRuns.some((run) => run.includes(word.replace(/-/g, ""))));
    expect(fragments).toEqual([]);
  }, 120_000);
});
