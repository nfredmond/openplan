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
import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import { formatUsd } from "@/lib/bca/render";
import { canonicalBcaJson } from "@/lib/bca/workbench/canonical";
import { calculateBcaDocument, WORKBENCH_ENGINE_VERSION } from "@/lib/bca/workbench/engine";
import { getBcaProfile } from "@/lib/bca/workbench/profiles";
import { bcaDocumentSchema } from "@/lib/bca/workbench/schema";
import { formatSavedDate, type ProjectBcaScreeningSummary } from "@/lib/grants/bca-evidence";
import { buildEngagementFactClaims, type ProjectEngagementEvidence } from "@/lib/grants/engagement-evidence";

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

/** Severity coverage as recorded on an acquisition. Fatal-only is named as such; unknown stays unknown. */
export function describeSeverityCoverage(severityCompleteness: unknown): string {
  switch (severityCompleteness) {
    case "fatal_only":
      return "Fatal crashes only. The source records only crashes in which someone was killed; serious-injury, other-injury and property-damage crashes are not in it.";
    case "fatal_injury_only":
      return "Fatal and injury crashes. The source does not separate serious injuries from other injuries.";
    case "kabco_full":
      return "The source records distinct severity categories; classification completeness still requires review.";
    default:
      return "Severity coverage is unknown.";
  }
}

/** The latest saved benefit-cost record for the linked project, as the loader found it. */
export type ProjectBcaRead =
  | { status: "no_project" }
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | { status: "workbench"; row: { id: string; project_id: string; created_at: string | null; engine_version: string | null; document_json: unknown } }
  | { status: "screening"; screening: ProjectBcaScreeningSummary };

/** The linked project's engagement campaigns, as the loader found them. */
export type ProjectEngagementRead =
  | { status: "no_project" }
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | { status: "ready"; evidence: ProjectEngagementEvidence; truncated: boolean };

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
    table: null,
    figureSvg: null,
    notes: [
      `Calculation status: ${result.status}. Responsible analyst review and program acceptance are not established by this calculation.`,
      ...(result.complete ? [] : ["These subtotals omit incomplete streams. They are not a project result."]),
    ],
  };
}

/** The lead engagement campaign linked to the project and its saved comment synthesis. */
export function engagementEvidenceAppendix<K extends string>(
  shell: EvidenceAppendixShell<K>,
  read: ProjectEngagementRead,
  projectName: string | null
): EvidenceAppendix<K> {
  if (read.status === "no_project") return absentEvidenceAppendix(shell, "missing", NO_PROJECT_REASON);
  if (read.status === "absent") return absentEvidenceAppendix(shell, "missing", "No public engagement campaign is linked to the project.");
  if (read.status === "unreadable") return absentEvidenceAppendix(shell, "unreadable", read.reason);
  const lead = read.evidence.leadCampaign;
  return {
    ...shell,
    status: "included",
    statusNote: lead.synthesis ? null : "No comment synthesis is saved for the lead campaign, so no community-input finding is stated.",
    source: {
      record: "Engagement campaign",
      id: lead.id,
      date: lead.synthesizedAt,
      dateLabel: "Synthesis saved",
      hash: null,
      hashLabel: "No content hash is stored for this record",
      link: `/engagement/${lead.id}`,
      details: lead.representativenessComputedAt ? [`Representativeness screening computed ${formatSavedDate(lead.representativenessComputedAt)}.`] : [],
    },
    facts: [
      {
        label: "Campaigns on record",
        value: read.truncated
          ? `${read.evidence.campaignCount.toLocaleString("en-US")} among the most recently updated; more exist and were not read`
          : read.evidence.campaignCount.toLocaleString("en-US"),
      },
      { label: "Lead campaign", value: `${lead.title} (${lead.status})` },
    ],
    table: null,
    figureSvg: null,
    notes: buildEngagementFactClaims(read.evidence, projectName),
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
function dateText(value: string | null): string {
  return value && value.trim() ? value : "Not recorded";
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
