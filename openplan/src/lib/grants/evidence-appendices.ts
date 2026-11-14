/**
 * Evidence appendices for a packaged grant application, for any program that
 * declares them (`evidence-appendix-keys.ts`).
 *
 * Each appendix restates one saved record for the application's linked
 * project. This module holds what every program shares: the render model, the
 * missing/unreadable/omitted states, the benefit-cost and engagement
 * appendices, and the markup. Each program's own module builds the rest
 * (`ss4a-evidence-appendices.ts`, `atp-evidence-appendices.ts`).
 *
 * Honesty rules this module enforces structurally:
 *  - Every declared appendix renders. A record that does not exist is
 *    "missing", a read that failed or a record that fails its own checks is
 *    "unreadable", and an appendix the planner turned off is "omitted". None
 *    silently disappears.
 *  - Stored values render as stored. A value the record does not carry prints
 *    "Not recorded", never zero.
 *
 * Pure: no I/O.
 */

import { createHash } from "node:crypto";
import { seriousInjuryAvailabilityForRecord, type SeriousInjuryAvailability } from "@/lib/safety/serious-injury-availability";
import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import { formatUsd } from "@/lib/bca/render";
import { canonicalBcaJson } from "@/lib/bca/workbench/canonical";
import { calculateBcaDocument, WORKBENCH_ENGINE_VERSION } from "@/lib/bca/workbench/engine";
import { getBcaProfile } from "@/lib/bca/workbench/profiles";
import { bcaDocumentSchema, type BcaDocument } from "@/lib/bca/workbench/schema";
import { formatSavedDate, type ProjectBcaScreeningSummary } from "@/lib/grants/bca-evidence";
import { buildEngagementFactClaims, type ProjectEngagementEvidence } from "@/lib/grants/engagement-evidence";
import { buildStaffReviewFindingClaims, type StaffReviewRead } from "@/lib/engagement/staff-review-finding";

export type EvidenceAppendixStatus = "included" | "missing" | "unreadable" | "omitted";

export type EvidenceAppendixSource = {
  record: string;
  id: string;
  date: string | null;
  dateLabel: string;
  hash: string | null;
  hashLabel: string;
  link: string | null;
  details: string[];
};

/** The render model of one appendix: plain strings, so tests and the text PDF tier read the same facts. */
export type EvidenceAppendix<K extends string = string> = {
  key: K;
  letter: string;
  title: string;
  status: EvidenceAppendixStatus;
  /** Why it is missing, unreadable or omitted, or what part of an included appendix is absent. */
  statusNote: string | null;
  source: EvidenceAppendixSource | null;
  facts: Array<{ label: string; value: string }>;
  table: { headers: string[]; rows: string[][] } | null;
  figureSvg: string | null;
  notes: string[];
};

/** The two sentences that open a program's appendices: what they are, and what to verify. */
export type EvidenceAppendixFrame = { intro: string; verify: string };

export type EvidenceAppendixShell<K extends string = string> = Pick<EvidenceAppendix<K>, "key" | "letter" | "title">;

export const NO_PROJECT_REASON = "This application is not linked to a project, so no project record can be cited.";

/** Appendix letter by position: A, B, C. */
export function appendixShell<K extends string>(key: K, index: number, titles: Readonly<Record<K, string>>): EvidenceAppendixShell<K> {
  return { key, letter: String.fromCharCode(65 + index), title: titles[key] };
}

export function absentEvidenceAppendix<K extends string>(
  shell: EvidenceAppendixShell<K>,
  status: Exclude<EvidenceAppendixStatus, "included">,
  statusNote: string
): EvidenceAppendix<K> {
  return { ...shell, status, statusNote, source: null, facts: [], table: null, figureSvg: null, notes: [] };
}

/**
 * Serious-injury availability for a frozen acquisition, from its recorded
 * source and completeness through the same function every surface uses.
 */
export function acquisitionSeriousInjury(acquisition: Record<string, unknown>): SeriousInjuryAvailability {
  return seriousInjuryAvailabilityForRecord({
    sourceId: acquisition.source_id,
    severityCompleteness: acquisition.severity_completeness,
  });
}

/** Severity coverage as recorded on the acquisition. Fatal-only is named as such; unknown stays unknown. */
export function describeSeverityCoverage(seriousInjury: SeriousInjuryAvailability): string {
  switch (seriousInjury.effective) {
    case "fatal_only":
      return `Fatal crashes only. ${seriousInjury.statement}`;
    case "fatal_injury_only":
      return `Fatal and injury crashes. ${seriousInjury.statement}`;
    case "kabco_full":
      return `${seriousInjury.statement} Classification completeness still requires review.`;
    default:
      return `Severity coverage is unknown. ${seriousInjury.statement}`;
  }
}

/** The latest saved benefit-cost record for the linked project, as the loader found it. */
export type ProjectBcaRead =
  | { status: "no_project" }
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | { status: "workbench"; row: { id: string; project_id: string; created_at: string | null; engine_version: string | null; document_json: unknown } }
  | { status: "screening"; screening: ProjectBcaScreeningSummary };

/** Comments received and approved for the lead campaign, by exact database count. */
export type CampaignCommentCountsRead =
  | { status: "ready"; received: number; approved: number; firstReceivedAt: string | null; lastReceivedAt: string | null }
  | { status: "unreadable"; reason: string };

/** The linked project's engagement campaigns, as the loader found them. */
export type ProjectEngagementRead =
  | { status: "no_project" }
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | {
      status: "ready";
      evidence: ProjectEngagementEvidence;
      truncated: boolean;
      /** The lead campaign's comment counts. */
      comments: CampaignCommentCountsRead;
      /** The lead campaign's approved staff review, when one exists. */
      staffReview: StaffReviewRead;
    };

function money(value: number | null): string {
  return value === null ? "Not calculated" : formatUsd(value);
}

/** The latest saved benefit-cost analysis (workbench version) or screening for the linked project. */
export function bcaEvidenceAppendix<K extends string>(
  shell: EvidenceAppendixShell<K>,
  read: ProjectBcaRead,
  projectId: string | null
): EvidenceAppendix<K> {
  if (read.status === "no_project") return absentEvidenceAppendix(shell, "missing", NO_PROJECT_REASON);
  if (read.status === "absent") return absentEvidenceAppendix(shell, "missing", "No benefit-cost analysis or screening is saved for the linked project.");
  if (read.status === "unreadable") return absentEvidenceAppendix(shell, "unreadable", read.reason);

  if (read.status === "screening") {
    const s = read.screening;
    return {
      ...shell,
      status: "included",
      statusNote: null,
      source: { record: "Saved benefit-cost screening", id: s.id, date: s.createdAt, dateLabel: "Saved", hash: null, hashLabel: "No content hash is stored for this record", link: `/grants/bca/${s.projectId}`, details: [] },
      facts: [
        { label: "Benefit-cost ratio", value: s.benefitCostRatio === null ? "Not computable; no discounted costs were entered" : s.benefitCostRatio.toFixed(2) },
        { label: "Net present value", value: formatUsd(s.netPresentValue) },
        { label: "Discounted benefits", value: formatUsd(s.presentValueBenefits) },
        { label: "Discounted costs", value: formatUsd(s.presentValueCosts) },
        { label: "Analysis horizon", value: `${s.analysisHorizonYears} years` },
        { label: "Real discount rate", value: `${s.discountRatePct}%` },
        { label: "Base year", value: String(s.baseYear) },
        { label: "Engine", value: s.engineVersion },
      ],
      table: null,
      figureSvg: null,
      notes: [BCA_NARRATIVE_CAVEAT],
    };
  }

  const document = bcaDocumentSchema.safeParse(read.row.document_json);
  if (!document.success || document.data.projectId !== projectId) {
    return absentEvidenceAppendix(shell, "unreadable", "The latest saved benefit-cost analysis does not read as an analysis of the linked project. Open it in the BCA workbench and save it again.");
  }
  const doc = document.data;
  const result = calculateBcaDocument(doc);
  const profile = getBcaProfile(doc.programId);
  const errors = result.issues.filter((issue) => issue.severity === "error").length;
  const reviews = result.issues.length - errors;
  const storedEngine = read.row.engine_version?.trim() || "Not recorded";
  return {
    ...shell,
    status: "included",
    statusNote: null,
    source: {
      record: "Saved benefit-cost analysis version",
      id: read.row.id,
      date: read.row.created_at,
      dateLabel: "Saved",
      hash: createHash("sha256").update(canonicalBcaJson(read.row.document_json)).digest("hex"),
      hashLabel: "Input SHA-256",
      link: `/grants/bca/${read.row.project_id}`,
      details: [],
    },
    facts: [
      { label: "Analysis", value: doc.title },
      { label: "Program profile", value: `${profile?.title ?? doc.programId}, edition ${doc.programVersion}` },
      { label: "Calculation status", value: result.status },
      { label: "Benefit-cost ratio", value: result.benefitCostRatio?.toFixed(3) ?? "Not calculated" },
      { label: "Net present value", value: money(result.netPresentValue) },
      { label: "Present-value numerator", value: money(result.presentValueBenefits) },
      { label: "Present-value denominator", value: money(result.presentValueCosts) },
      { label: "Open checks", value: `${errors} blocking, ${reviews} for review` },
      { label: "Engine", value: storedEngine === WORKBENCH_ENGINE_VERSION ? storedEngine : `Saved with ${storedEngine}; recalculated with ${WORKBENCH_ENGINE_VERSION}` },
    ],
    table: bcaInputSourceTable(doc),
    figureSvg: null,
    notes: [
      `Calculation status: ${result.status}. Responsible analyst review and program acceptance are not established by this calculation.`,
      ...(result.complete ? [] : ["These subtotals omit incomplete streams. They are not a project result."]),
      ...(doc.evidence.some((entry) => entry.status !== "documented")
        ? ["Inputs marked as an assumption, missing or model screening are not documented values. Each needs a source before the analysis is relied on."]
        : []),
      ...(doc.flows.some((flow) => flow.sourceIds.length === 0 && flow.parameterSourceId === null && flow.conversionSourceId === null)
        ? [`${doc.flows.filter((flow) => flow.sourceIds.length === 0 && flow.parameterSourceId === null && flow.conversionSourceId === null).length} stream(s) cite no input source.`]
        : []),
    ],
  };
}

const BCA_EVIDENCE_STATUS_LABELS: Record<string, string> = {
  documented: "Documented",
  assumption: "Assumption",
  missing: "Missing",
  "model-screening": "Model screening",
};

/** Each input source the analysis records, how many streams cite it, and its stated limitation. */
function bcaInputSourceTable(doc: BcaDocument): EvidenceAppendix["table"] {
  if (doc.evidence.length === 0) return null;
  const citations = new Map<string, number>();
  for (const flow of doc.flows) {
    for (const id of new Set([...flow.sourceIds, flow.parameterSourceId, flow.conversionSourceId])) {
      if (id) citations.set(id, (citations.get(id) ?? 0) + 1);
    }
  }
  return {
    headers: ["Input source", "Status", "Streams citing it", "Reference", "Limitation"],
    rows: doc.evidence.map((entry) => [
      entry.title || "Untitled source",
      BCA_EVIDENCE_STATUS_LABELS[entry.status] ?? entry.status,
      String(citations.get(entry.id) ?? 0),
      [entry.reference, entry.locator].filter((part) => part.trim()).join(", ") || "Not recorded",
      entry.limitation.trim() || "None stated",
    ]),
  };
}

const ENGAGEMENT_METHOD_LABELS: Record<string, string> = {
  map_feedback: "Map comments",
  comment_collection: "Comment form",
  meeting_intake: "Meeting intake",
};

function commentsReceivedText(comments: CampaignCommentCountsRead): string {
  if (comments.status === "unreadable") return `Could not be read. ${comments.reason}`;
  if (comments.received === 0) return "0";
  const first = formatSavedDate(comments.firstReceivedAt);
  const last = formatSavedDate(comments.lastReceivedAt);
  const range = first === last ? `on ${first}` : `from ${first} to ${last}`;
  return `${comments.received.toLocaleString("en-US")}, received ${range}`;
}

/**
 * Where the community-input finding comes from. Each source labels itself,
 * and both print when both exist.
 */
function engagementFindingSources(read: Extract<ProjectEngagementRead, { status: "ready" }>): string[] {
  const lead = read.evidence.leadCampaign;
  const sources: string[] = [];
  if (lead.synthesis) {
    sources.push(`${lead.synthesis.source === "ai" ? "AI-assisted synthesis" : "Keyword-based synthesis"} saved ${formatSavedDate(lead.synthesizedAt)}`);
  }
  if (read.staffReview.status === "approved") {
    const finding = read.staffReview.finding;
    sources.push(`Approved staff review ${finding.reviewId}, revision ${finding.revisionNo}, approved ${formatSavedDate(finding.approvedAt)}`);
  }
  return sources;
}

/**
 * A failed staff-review read is unknown, not absent, whether or not another
 * finding source exists. The fact and the note both say so.
 */
function findingSourceText(sources: readonly string[], staffReviewUnreadable: boolean): string {
  if (!staffReviewUnreadable) return sources.length > 0 ? sources.join("; ") : "None";
  return sources.length > 0
    ? `${sources.join("; ")}. Saved staff reviews could not be checked, so whether an approved review also exists is unknown`
    : "Unknown. Saved staff reviews could not be checked";
}

function findingStatusNote(read: Extract<ProjectEngagementRead, { status: "ready" }>, sources: readonly string[]): string | null {
  if (sources.length === 0) return noFindingNote(read);
  if (read.staffReview.status !== "unreadable") return null;
  return `Saved staff reviews could not be checked. ${read.staffReview.reason} The finding stated here does not include a staff review.`;
}

function noFindingNote(read: Extract<ProjectEngagementRead, { status: "ready" }>): string {
  const staff = read.staffReview;
  if (staff.status === "unreadable") {
    return `No comment synthesis is saved for the lead campaign, and saved staff reviews could not be checked. ${staff.reason} No community-input finding is stated.`;
  }
  const limit = staff.status === "none" && staff.limitReached
    ? ` Only the ${staff.checkedReviewCount} newest staff reviews were checked.`
    : "";
  return `No comment synthesis or approved staff review is saved for the lead campaign, so no community-input finding is stated.${limit}`;
}

/**
 * The lead engagement campaign linked to the project: how input was
 * collected, how many comments came in and were approved, and the
 * community-input finding from a saved synthesis or an approved staff review.
 */
export function engagementEvidenceAppendix<K extends string>(
  shell: EvidenceAppendixShell<K>,
  read: ProjectEngagementRead,
  projectName: string | null
): EvidenceAppendix<K> {
  if (read.status === "no_project") return absentEvidenceAppendix(shell, "missing", NO_PROJECT_REASON);
  if (read.status === "absent") return absentEvidenceAppendix(shell, "missing", "No public engagement campaign is linked to the project.");
  if (read.status === "unreadable") return absentEvidenceAppendix(shell, "unreadable", read.reason);
  const lead = read.evidence.leadCampaign;
  const staff = read.staffReview.status === "approved" ? read.staffReview : null;
  const sources = engagementFindingSources(read);
  const method = lead.engagementType ? ENGAGEMENT_METHOD_LABELS[lead.engagementType] ?? lead.engagementType : "Not recorded";
  return {
    ...shell,
    status: "included",
    statusNote: findingStatusNote(read, sources),
    source: {
      record: "Engagement campaign",
      id: lead.id,
      date: lead.synthesis || !staff ? lead.synthesizedAt : staff.finding.approvedAt,
      dateLabel: lead.synthesis || !staff ? "Synthesis saved" : "Staff review approved",
      hash: null,
      hashLabel: "No content hash is stored for this record",
      link: `/engagement/${lead.id}`,
      details: [
        ...(staff ? [`Approved staff review ${staff.finding.reviewId}, revision ${staff.finding.revisionNo}, of source set ${staff.finding.sourceId}.`] : []),
        ...(lead.representativenessComputedAt ? [`Representativeness screening computed ${formatSavedDate(lead.representativenessComputedAt)}.`] : []),
      ],
    },
    facts: [
      {
        label: "Campaigns on record",
        value: read.truncated
          ? `${read.evidence.campaignCount.toLocaleString("en-US")} among the most recently updated; more exist and were not read`
          : read.evidence.campaignCount.toLocaleString("en-US"),
      },
      { label: "Lead campaign", value: `${lead.title} (${lead.status})` },
      { label: "Method", value: method },
      { label: "Comments received", value: commentsReceivedText(read.comments) },
      {
        label: "Comments approved",
        value: read.comments.status === "ready" ? read.comments.approved.toLocaleString("en-US") : "Could not be read",
      },
      { label: "Community-input finding source", value: findingSourceText(sources, read.staffReview.status === "unreadable") },
    ],
    table: null,
    figureSvg: null,
    notes: [
      ...buildEngagementFactClaims(read.evidence, projectName),
      ...(staff ? buildStaffReviewFindingClaims(staff.finding, lead.title) : []),
    ],
  };
}

/** What the export response and audit record carry about each appendix. */
export function summarizeEvidenceAppendices(appendices: readonly EvidenceAppendix[]) {
  return appendices.map((appendix) => ({
    key: appendix.key,
    status: appendix.status,
    sourceId: appendix.source?.id ?? null,
    hash: appendix.source?.hash ?? null,
    mapDrawn: appendix.key === "hin_map" ? appendix.figureSvg !== null : undefined,
  }));
}

const STATUS_LABELS: Record<EvidenceAppendixStatus, string> = {
  included: "Included",
  missing: "Missing",
  unreadable: "Could not be read",
  omitted: "Not selected",
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The stored timestamp as stored, so a reader can match it to the record. */
/**
 * A stored timestamp as a planner reads it: "Nov 3, 2026, 05:42 UTC". A value
 * with no time of day prints as the date alone. A value that is not a date
 * prints as stored, so nothing is invented.
 */
export function formatEvidenceTimestamp(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  if (!text) return "Not recorded";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = new Date(dateOnly ? `${text}T00:00:00Z` : text);
  if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(text)) return text;
  const day = parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (dateOnly) return day;
  const time = parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day}, ${time} UTC`;
}

function dateText(value: string | null): string {
  return formatEvidenceTimestamp(value);
}

function sourceMarkup(source: EvidenceAppendixSource): string {
  const link = source.link ? ` <a href="${esc(source.link)}">${esc(source.link)}</a>` : "";
  return `<p class="appendix-source"><strong>Source:</strong> ${esc(source.record)} ${esc(source.id)}.${link}
      ${esc(source.dateLabel)}: ${esc(dateText(source.date))}.
      ${source.hash ? `${esc(source.hashLabel)}: ${esc(source.hash)}.` : `${esc(source.hashLabel)}.`}
      ${source.details.map(esc).join(" ")}</p>`;
}

function appendixMarkup(appendix: EvidenceAppendix): string {
  const heading = `<h3>Appendix ${esc(appendix.letter)}. ${esc(appendix.title)}</h3>`;
  if (appendix.status !== "included") {
    return `<article id="appendix-${esc(appendix.key)}" class="appendix">${heading}
      <div class="outstanding">${esc(STATUS_LABELS[appendix.status])}. ${esc(appendix.statusNote ?? "")}</div></article>`;
  }
  const facts = appendix.facts.length > 0
    ? `<dl class="appendix-facts">${appendix.facts.map((fact) => `<div><dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd></div>`).join("")}</dl>`
    : "";
  const table = appendix.table
    ? `<div class="table-scroll"><table><thead><tr>${appendix.table.headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead>
      <tbody>${appendix.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : "";
  // The SVG is built by code from numbers only; it is not escaped text.
  const figure = appendix.figureSvg ? `<figure>${appendix.figureSvg}</figure>` : "";
  return `<article id="appendix-${esc(appendix.key)}" class="appendix">${heading}
      ${appendix.source ? sourceMarkup(appendix.source) : ""}
      ${appendix.statusNote ? `<div class="outstanding">${esc(appendix.statusNote)}</div>` : ""}
      ${figure}${facts}${table}
      ${appendix.notes.length > 0 ? `<ul>${appendix.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>` : ""}
    </article>`;
}

/** The evidence index and every appendix, as one document section. */
export function evidenceAppendicesMarkup(
  appendices: readonly EvidenceAppendix[] | undefined,
  frame: EvidenceAppendixFrame
): string {
  if (!appendices || appendices.length === 0) return "";
  return `<section id="evidence-appendices">
    <h2 class="section-title">Evidence appendices</h2>
    <p>${esc(frame.intro)}</p>
    <p>${esc(frame.verify)}</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Appendix</th><th>Status</th><th>Source record</th><th>Date</th><th>Hash</th></tr></thead>
      <tbody>${appendices.map((appendix) => `<tr>
        <td>${esc(appendix.letter)}. ${esc(appendix.title)}</td>
        <td>${esc(STATUS_LABELS[appendix.status])}${appendix.key === "hin_map" && appendix.status === "included" && !appendix.figureSvg ? "; map not drawn" : ""}</td>
        <td class="wrap-anywhere">${esc(appendix.source ? `${appendix.source.record} ${appendix.source.id}` : appendix.statusNote ?? "")}</td>
        <td class="wrap-anywhere">${esc(appendix.source ? dateText(appendix.source.date) : "Not recorded")}</td>
        <td class="wrap-anywhere">${esc(appendix.source?.hash ?? "None stored")}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    ${appendices.map(appendixMarkup).join("\n    ")}
  </section>`;
}
