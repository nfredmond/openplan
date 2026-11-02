/**
 * SS4A evidence appendices for the packaged application.
 *
 * Each appendix restates one saved record for the application's linked
 * project: the frozen Safety snapshot an SS4A seed came from (high-injury
 * network, crash summary, countermeasures), the latest saved benefit-cost
 * analysis, and the lead engagement campaign. Code writes every figure from the
 * stored record. Nothing here decides eligibility or restates a notice
 * requirement OpenPlan has not sourced.
 *
 * Honesty rules this module enforces structurally:
 *  - Every appendix renders. A record that does not exist is "missing", a read
 *    that failed or a record that fails its own checks is "unreadable", and an
 *    appendix the planner turned off is "omitted". None silently disappears.
 *  - Stored values render as stored. A count the record does not carry prints
 *    "Not recorded", never zero, and a fatality-census source says so.
 *  - The map is drawn only when recomputing from stored records reproduces the
 *    frozen ranking exactly; otherwise the frozen table stands alone and the
 *    reason is printed.
 *
 * Pure: no I/O. The loader beside it reads the records.
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
import type { SafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import type { HighInjuryNetwork } from "@/lib/safety/high-injury-network";
import type { SafetyRoadContextFeature } from "@/lib/safety/road-context";
import { SS4A_APPENDIX_KEYS, SS4A_APPENDIX_TITLES, type Ss4aAppendixKey } from "@/lib/grants/ss4a-appendix-keys";
import {
  renderSafetyStreetContextSvg,
  SAFETY_STREET_CONTEXT_PROJECTION_NOTE,
} from "@/lib/safety/street-context-svg";

const SS4A_APPENDICES_INTRO =
  "Each appendix restates a saved OpenPlan record for the linked project, with its source record, date and stored hash where one exists. Missing records are listed as missing. These appendices do not establish eligibility, award readiness or that this package meets the current notice.";
const SS4A_APPENDICES_VERIFY =
  "[VERIFY] Confirm the required attachments against the current SS4A notice of funding opportunity.";
const COUNTERMEASURE_CANDIDATE_NOTE =
  "Proposed by staff for review. Attaching a countermeasure is not an engineering finding, and no crash reduction is estimated here.";
const HIN_MAP_DRAWN_NOTE =
  "Drawn at export from the stored crash records and cached road lines for this acquisition. The recomputed ranks and counts match the frozen Safety snapshot for every listed segment. No tile service was used.";
export const HIN_MAP_MISMATCH_REASON =
  "Recomputing from the stored crash records and cached road lines does not reproduce the frozen ranking, so no geometry can be tied to this snapshot. The ranked table is the frozen record.";

type Ss4aAppendixStatus = "included" | "missing" | "unreadable" | "omitted";

type Ss4aAppendixSource = {
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
export type Ss4aAppendix = {
  key: Ss4aAppendixKey;
  letter: string;
  title: string;
  status: Ss4aAppendixStatus;
  /** Why it is missing, unreadable or omitted, or what part of an included appendix is absent. */
  statusNote: string | null;
  source: Ss4aAppendixSource | null;
  facts: Array<{ label: string; value: string }>;
  table: { headers: string[]; rows: string[][] } | null;
  figureSvg: string | null;
  notes: string[];
};

/** The Safety snapshot the SS4A seed came from, as the loader found it. */
export type Ss4aSafetySourceRead =
  | { status: "no_project" }
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | { status: "ready"; snapshot: SafetyPlanSnapshot; otherSeededArtifactCount: number };

/** The export-time recomputation of the network, for the map only. */
export type Ss4aHinRecomputeRead =
  | { status: "not_attempted" }
  | { status: "unreadable"; reason: string }
  | { status: "computed"; network: Extract<HighInjuryNetwork, { status: "computed" }>; roads: SafetyRoadContextFeature[] };

type Ss4aBcaRead =
  | { status: "no_project" }
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | { status: "workbench"; row: { id: string; project_id: string; created_at: string | null; engine_version: string | null; document_json: unknown } }
  | { status: "screening"; screening: ProjectBcaScreeningSummary };

type Ss4aEngagementRead =
  | { status: "no_project" }
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | { status: "ready"; evidence: ProjectEngagementEvidence; truncated: boolean };

export type Ss4aEvidenceRecords = {
  projectId: string | null;
  projectName: string | null;
  safety: Ss4aSafetySourceRead;
  hinRecompute: Ss4aHinRecomputeRead;
  bca: Ss4aBcaRead;
  engagement: Ss4aEngagementRead;
};

const NO_PROJECT_REASON = "This application is not linked to a project, so no project record can be cited.";
const NO_SEED_REASON =
  "No saved Safety plan has been seeded into this application. Seed it from a Safety report to cite its frozen snapshot.";

function shell(key: Ss4aAppendixKey, index: number): Pick<Ss4aAppendix, "key" | "letter" | "title"> {
  return { key, letter: String.fromCharCode(65 + index), title: SS4A_APPENDIX_TITLES[key] };
}

function absentAppendix(
  key: Ss4aAppendixKey,
  index: number,
  status: Exclude<Ss4aAppendixStatus, "included">,
  statusNote: string
): Ss4aAppendix {
  return { ...shell(key, index), status, statusNote, source: null, facts: [], table: null, figureSvg: null, notes: [] };
}

function stored(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "Not recorded";
}

/** Severity coverage as recorded on the acquisition. Fatal-only is named as such; unknown stays unknown. */
function describeSeverityCoverage(severityCompleteness: unknown): string {
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

function safetySource(safety: Extract<Ss4aSafetySourceRead, { status: "ready" }>): Ss4aAppendixSource {
  const { snapshot, otherSeededArtifactCount } = safety;
  const acquisition = snapshot.acquisition;
  return {
    record: "Safety report artifact",
    id: snapshot.artifactId,
    date: snapshot.generatedAt,
    dateLabel: "Generated",
    hash: snapshot.hash,
    hashLabel: "Snapshot SHA-256",
    link: `/reports/${snapshot.reportId}#artifact-${snapshot.artifactId}`,
    details: [
      `Report ${snapshot.reportId}.`,
      `Crash acquisition ${String(acquisition.id)}, retrieved ${String(acquisition.created_at)}.`,
      ...(otherSeededArtifactCount > 0
        ? [`This is the most recently generated of ${otherSeededArtifactCount + 1} seeded Safety artifacts; all are listed under Safety seed sources.`]
        : []),
    ],
  };
}

/** Exact agreement on every listed segment: identity, rank, tie and counts. */
function recomputedNetworkMatchesSnapshot(
  snapshot: SafetyPlanSnapshot,
  network: Extract<HighInjuryNetwork, { status: "computed" }>
): boolean {
  const frozen = snapshot.draft.network;
  if (frozen.kind !== "computed" || frozen.rows.length !== network.segments.length) return false;
  return frozen.rows.every((row, index) => {
    const segment = network.segments[index];
    return (
      segment.id === row.segmentId &&
      segment.rank === row.rank &&
      segment.tied === row.tied &&
      segment.crashCount === row.crashCount &&
      segment.fatalCrashCount === row.fatalCrashCount &&
      segment.seriousInjuryCrashCount === row.seriousInjuryCrashCount
    );
  });
}

function hinAppendix(index: number, records: Ss4aEvidenceRecords): Ss4aAppendix {
  const key = "hin_map" as const;
  const safety = records.safety;
  if (safety.status !== "ready") return safetyNotReady(key, index, safety);
  const network = safety.snapshot.draft.network;
  if (network.kind === "unavailable") return absentAppendix(key, index, "missing", network.reason);

  const table = network.rows.length > 0
    ? {
        headers: ["Rank", "Location", "Miles", "Fatal", "Serious injury", "Per mile"],
        rows: network.rows.map((row) => [
          row.tied ? `${row.rank} (tie)` : String(row.rank),
          row.label,
          row.lengthMiles === null ? "Not a road piece" : row.lengthMiles.toFixed(2),
          row.fatalCrashCount.toLocaleString("en-US"),
          row.seriousInjuryCrashCount === null ? "Not in source (fatal crashes only)" : row.seriousInjuryCrashCount.toLocaleString("en-US"),
          row.crashesPerMile === null ? `${row.crashCount.toLocaleString("en-US")} in square` : row.crashesPerMile.toFixed(1),
        ]),
      }
    : null;

  let figureSvg: string | null = null;
  let statusNote: string | null = null;
  const recompute = records.hinRecompute;
  if (network.rows.length === 0) {
    statusNote = "Map not drawn. No segment is ranked in the frozen snapshot, so there is nothing to map.";
  } else if (recompute.status === "not_attempted") {
    statusNote = "Map not drawn. The acquisition's stored bounds or years could not be read.";
  } else if (recompute.status === "unreadable") {
    statusNote = `Map not drawn. ${recompute.reason}`;
  } else if (!recomputedNetworkMatchesSnapshot(safety.snapshot, recompute.network)) {
    statusNote = `Map not drawn. ${HIN_MAP_MISMATCH_REASON}`;
  } else {
    figureSvg = renderSafetyStreetContextSvg({
      roads: recompute.roads,
      crashLocations: [],
      projectGeometry: null,
      highlights: recompute.network.segments.map((segment) => ({ rank: segment.rank, geometry: segment.geometry })),
      ariaLabel: "Ranked high-injury network segments, numbered by rank",
    });
    if (!figureSvg) statusNote = "Map not drawn. The ranked segments carry no drawable coordinates.";
  }

  return {
    ...shell(key, index),
    status: "included",
    statusNote,
    source: safetySource(safety),
    facts: [
      { label: "Measure", value: network.measureLabel },
      { label: "Years", value: network.years },
      { label: "Method", value: network.method },
      { label: "Coverage", value: network.coverage },
    ],
    table,
    figureSvg,
    notes: [
      ...(figureSvg ? [HIN_MAP_DRAWN_NOTE, SAFETY_STREET_CONTEXT_PROJECTION_NOTE, "Numbered marks are the ranks in the table."] : []),
      network.sourceLine,
    ],
  };
}

function crashAppendix(index: number, records: Ss4aEvidenceRecords): Ss4aAppendix {
  const key = "crash_summary" as const;
  const safety = records.safety;
  if (safety.status !== "ready") return safetyNotReady(key, index, safety);
  const summary = safety.snapshot.draft.crashSummary;
  if (summary.kind === "absent") return absentAppendix(key, index, "unreadable", summary.reason);
  const acquisition = safety.snapshot.acquisition;
  const yearsRequested = Array.isArray(acquisition.years_requested) && acquisition.years_requested.length > 0
    ? acquisition.years_requested.map(String).join(", ")
    : "Not recorded";

  return {
    ...shell(key, index),
    status: "included",
    statusNote: null,
    source: safetySource(safety),
    facts: [
      { label: "Source", value: summary.sourceLabel },
      { label: "Severity coverage", value: describeSeverityCoverage(acquisition.severity_completeness) },
      { label: "Recorded severity coverage", value: typeof acquisition.severity_completeness === "string" && acquisition.severity_completeness ? acquisition.severity_completeness : "Not recorded" },
      { label: "Years requested", value: yearsRequested },
      { label: "Crashes reported", value: stored(acquisition.crash_count) },
      { label: "Crashes geocoded", value: stored(acquisition.geocoded_count) },
      { label: "Crashes stored", value: stored(acquisition.stored_count) },
      { label: "Retrieval truncated", value: acquisition.truncated === true ? "Yes; every count is a floor" : acquisition.truncated === false ? "No" : "Not recorded" },
      { label: "Source publication cutoff", value: typeof acquisition.published_through === "string" && acquisition.published_through ? acquisition.published_through : "Not recorded by the source" },
      ...summary.figures.map((figure) => ({
        label: figure.label,
        value: figure.value === null ? `Not available. ${figure.absentBecause ?? "No reason recorded."}` : figure.value.toLocaleString("en-US"),
      })),
    ],
    table: null,
    figureSvg: null,
    notes: [...summary.caveats, summary.sourceLine],
  };
}

function countermeasureAppendix(index: number, records: Ss4aEvidenceRecords): Ss4aAppendix {
  const key = "countermeasures" as const;
  const safety = records.safety;
  if (safety.status !== "ready") return safetyNotReady(key, index, safety);
  const draft = safety.snapshot.draft;
  if (draft.treatments.length === 0) {
    return absentAppendix(key, index, "missing", "No candidate countermeasures are recorded in this snapshot. This does not establish that the agency has none.");
  }
  return {
    ...shell(key, index),
    status: "included",
    statusNote: null,
    source: safetySource(safety),
    facts: [],
    table: {
      headers: ["Location", "Network rank", "Countermeasure", "Addresses", "Crash types", "Crash modification factor", "Source"],
      rows: draft.treatments.flatMap((treatment) =>
        treatment.countermeasures.map((item) => [
          treatment.segmentLabel,
          treatment.rank === null ? "Not in the frozen ranked list" : String(treatment.rank),
          item.name,
          item.addresses,
          item.crashTypes.join(", "),
          item.cmfNote,
          item.sourceUrl,
        ])
      ),
    },
    figureSvg: null,
    notes: [COUNTERMEASURE_CANDIDATE_NOTE, draft.countermeasureSourceLine],
  };
}

function safetyNotReady(
  key: Ss4aAppendixKey,
  index: number,
  safety: Exclude<Ss4aSafetySourceRead, { status: "ready" }>
): Ss4aAppendix {
  if (safety.status === "no_project") return absentAppendix(key, index, "missing", NO_PROJECT_REASON);
  if (safety.status === "absent") return absentAppendix(key, index, "missing", NO_SEED_REASON);
  return absentAppendix(key, index, "unreadable", safety.reason);
}

function money(value: number | null): string {
  return value === null ? "Not calculated" : formatUsd(value);
}

function bcaAppendix(index: number, records: Ss4aEvidenceRecords): Ss4aAppendix {
  const key = "bca" as const;
  const read = records.bca;
  if (read.status === "no_project") return absentAppendix(key, index, "missing", NO_PROJECT_REASON);
  if (read.status === "absent") return absentAppendix(key, index, "missing", "No benefit-cost analysis or screening is saved for the linked project.");
  if (read.status === "unreadable") return absentAppendix(key, index, "unreadable", read.reason);

  if (read.status === "screening") {
    const s = read.screening;
    return {
      ...shell(key, index),
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
  if (!document.success || document.data.projectId !== records.projectId) {
    return absentAppendix(key, index, "unreadable", "The latest saved benefit-cost analysis does not read as an analysis of the linked project. Open it in the BCA workbench and save it again.");
  }
  const doc = document.data;
  const result = calculateBcaDocument(doc);
  const profile = getBcaProfile(doc.programId);
  const errors = result.issues.filter((issue) => issue.severity === "error").length;
  const reviews = result.issues.length - errors;
  const storedEngine = read.row.engine_version?.trim() || "Not recorded";
  return {
    ...shell(key, index),
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

function engagementAppendix(index: number, records: Ss4aEvidenceRecords): Ss4aAppendix {
  const key = "engagement" as const;
  const read = records.engagement;
  if (read.status === "no_project") return absentAppendix(key, index, "missing", NO_PROJECT_REASON);
  if (read.status === "absent") return absentAppendix(key, index, "missing", "No public engagement campaign is linked to the project.");
  if (read.status === "unreadable") return absentAppendix(key, index, "unreadable", read.reason);
  const lead = read.evidence.leadCampaign;
  return {
    ...shell(key, index),
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
    notes: buildEngagementFactClaims(read.evidence, records.projectName),
  };
}

const BUILDERS: Record<Ss4aAppendixKey, (index: number, records: Ss4aEvidenceRecords) => Ss4aAppendix> = {
  hin_map: hinAppendix,
  crash_summary: crashAppendix,
  countermeasures: countermeasureAppendix,
  bca: bcaAppendix,
  engagement: engagementAppendix,
};

/** Every appendix, in a fixed order, whether included, missing, unreadable or omitted. */
export function buildSs4aEvidenceAppendices(
  records: Ss4aEvidenceRecords,
  selected: ReadonlySet<Ss4aAppendixKey>
): Ss4aAppendix[] {
  return SS4A_APPENDIX_KEYS.map((key, index) =>
    selected.has(key)
      ? BUILDERS[key](index, records)
      : absentAppendix(key, index, "omitted", "Not selected for this export.")
  );
}

/** What the export response and audit record carry about each appendix. */
export function summarizeSs4aAppendices(appendices: readonly Ss4aAppendix[]) {
  return appendices.map((appendix) => ({
    key: appendix.key,
    status: appendix.status,
    sourceId: appendix.source?.id ?? null,
    hash: appendix.source?.hash ?? null,
    mapDrawn: appendix.key === "hin_map" ? appendix.figureSvg !== null : undefined,
  }));
}

const STATUS_LABELS: Record<Ss4aAppendixStatus, string> = {
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

function sourceMarkup(source: Ss4aAppendixSource): string {
  const link = source.link ? ` <a href="${esc(source.link)}">${esc(source.link)}</a>` : "";
  return `<p class="appendix-source"><strong>Source:</strong> ${esc(source.record)} ${esc(source.id)}.${link}
      ${esc(source.dateLabel)}: ${esc(dateText(source.date))}.
      ${source.hash ? `${esc(source.hashLabel)}: ${esc(source.hash)}.` : `${esc(source.hashLabel)}.`}
      ${source.details.map(esc).join(" ")}</p>`;
}

function appendixMarkup(appendix: Ss4aAppendix): string {
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
export function ss4aEvidenceAppendicesMarkup(appendices: readonly Ss4aAppendix[] | undefined): string {
  if (!appendices || appendices.length === 0) return "";
  return `<section id="evidence-appendices">
    <h2 class="section-title">Evidence appendices</h2>
    <p>${esc(SS4A_APPENDICES_INTRO)}</p>
    <p>${esc(SS4A_APPENDICES_VERIFY)}</p>
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
