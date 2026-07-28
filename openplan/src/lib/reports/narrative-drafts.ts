/**
 * Document narrative drafts — the storage/typing layer for AI-drafted,
 * operator-ACCEPTED narrative blocks (document_narrative_drafts, migration
 * 20260727000013).
 *
 * The reports module stays 100% deterministic at generate time: a generated
 * packet includes only rows an operator explicitly accepted, and everything an
 * accepted draft may claim traces to the numbered fact list built HERE, by the
 * same deterministic assembly the packet renderer uses. `factsHash` fingerprints
 * that fact list so generation can detect — and disclose — that the underlying
 * data changed after acceptance.
 *
 * Server-side only where `factsHash` is concerned (node:crypto); client
 * components must import types from this module with `import type`.
 */

import { createHash } from "node:crypto";
import { getManagedRunModeDefinition } from "@/lib/models/run-modes";
import { type ProjectFundingSnapshot } from "@/lib/projects/funding";
import { formatDateTime, titleize } from "@/lib/reports/catalog";
import {
  compactModelRunKpiLine,
  type ReportCitedCountyRun,
  type ReportCitedModelRun,
} from "@/lib/reports/html";
import {
  buildNarrativeFactList,
  type NarrativeFact,
} from "@/lib/grants/narrative-grounding";

export type DocumentNarrativeTargetKind = "report_section" | "rtp_chapter";
export type DocumentNarrativeDraftStatus = "draft" | "accepted" | "dismissed";

export const DOCUMENT_NARRATIVE_TARGET_KINDS: readonly DocumentNarrativeTargetKind[] = [
  "report_section",
  "rtp_chapter",
];

export const DOCUMENT_NARRATIVE_DRAFT_STATUSES: readonly DocumentNarrativeDraftStatus[] = [
  "draft",
  "accepted",
  "dismissed",
];

/** One stored draft row, as read back from document_narrative_drafts. */
export type DocumentNarrativeDraft = {
  id: string;
  workspace_id: string | null;
  target_kind: DocumentNarrativeTargetKind;
  target_id: string;
  section_key: string | null;
  draft_markdown: string;
  model: string;
  /** Raw grounding_json; parse with `parseStoredNarrativeGrounding`. */
  grounding_json: unknown;
  grounded_sentence_count: number;
  total_sentence_count: number;
  facts_hash: string;
  status: DocumentNarrativeDraftStatus;
  accepted_markdown: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  created_by: string | null;
  created_at: string | null;
};

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Defensively parse a stored document_narrative_drafts row. Returns null for
 * anything that does not carry the NOT NULL contract of the migration, so one
 * malformed row can never break a panel or a generation pass.
 */
export function parseStoredDraft(value: unknown): DocumentNarrativeDraft | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string") return null;
  if (
    typeof record.target_kind !== "string" ||
    !(DOCUMENT_NARRATIVE_TARGET_KINDS as readonly string[]).includes(record.target_kind)
  ) {
    return null;
  }
  if (typeof record.target_id !== "string") return null;
  if (typeof record.draft_markdown !== "string") return null;
  if (typeof record.model !== "string") return null;
  if (typeof record.facts_hash !== "string") return null;
  if (
    typeof record.status !== "string" ||
    !(DOCUMENT_NARRATIVE_DRAFT_STATUSES as readonly string[]).includes(record.status)
  ) {
    return null;
  }
  if (typeof record.grounded_sentence_count !== "number") return null;
  if (typeof record.total_sentence_count !== "number") return null;

  return {
    id: record.id,
    workspace_id: asStringOrNull(record.workspace_id),
    target_kind: record.target_kind as DocumentNarrativeTargetKind,
    target_id: record.target_id,
    section_key: asStringOrNull(record.section_key),
    draft_markdown: record.draft_markdown,
    model: record.model,
    grounding_json: record.grounding_json ?? null,
    grounded_sentence_count: record.grounded_sentence_count,
    total_sentence_count: record.total_sentence_count,
    facts_hash: record.facts_hash,
    status: record.status as DocumentNarrativeDraftStatus,
    accepted_markdown: asStringOrNull(record.accepted_markdown),
    accepted_by: asStringOrNull(record.accepted_by),
    accepted_at: asStringOrNull(record.accepted_at),
    created_by: asStringOrNull(record.created_by),
    created_at: asStringOrNull(record.created_at),
  };
}

/**
 * SHA-256 fingerprint of a numbered fact list.
 *
 * Canonical form: the trimmed claim texts, lexicographically SORTED and joined
 * on an unprintable separator. Sorting makes the hash independent of both fact
 * NUMBERING (fact ids are positional, so an unchanged evidence set assembled
 * in a different order still matches) and object key order; only the claims
 * themselves — the values a narrative could assert — move the hash.
 */
export function factsHash(facts: NarrativeFact[]): string {
  const canonical = facts
    .map((fact) => fact.claim_text.trim())
    .sort()
    .join("\u001e");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** A legacy Analysis Studio run row, as the generate route loads it. */
export type ReportSectionFactsRun = {
  id: string;
  title: string | null;
  summary_text: string | null;
  metrics: Record<string, unknown> | null;
  created_at: string | null;
};

/**
 * The deterministic inputs `buildReportSectionFacts` reads — a narrow slice of
 * what the generate route already assembles for `buildReportHtml`, so the fact
 * list and the rendered packet can never disagree about a value.
 */
export type ReportSectionFactsInput = {
  report: {
    title: string;
    summary: string | null;
    report_type: string;
  };
  project: {
    name: string;
    summary: string | null;
    status: string;
    plan_type: string;
    delivery_phase: string;
    updated_at: string | null;
  };
  runs: ReportSectionFactsRun[];
  citedModelRuns: ReportCitedModelRun[];
  citedCountyRuns: ReportCitedCountyRun[];
  projectFundingSnapshot: ProjectFundingSnapshot | null;
};

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function fundingSnapshotClaims(snapshot: ProjectFundingSnapshot, projectName: string): string[] {
  return [
    `${projectName} funding posture at this moment: ${snapshot.label} — ${snapshot.reason}`,
    `${projectName} funding pipeline posture: ${snapshot.pipelineLabel} — ${snapshot.pipelineReason}`,
    `${projectName} reimbursement posture: ${snapshot.reimbursementLabel} — ${snapshot.reimbursementReason}`,
    `${projectName} committed award dollars: ${formatAmount(snapshot.committedFundingAmount)} across ${snapshot.awardCount} award record(s).`,
    snapshot.fundingNeedAmount > 0
      ? `${projectName} recorded funding need: ${formatAmount(snapshot.fundingNeedAmount)}.`
      : null,
    snapshot.unfundedAfterLikelyAmount > 0
      ? `${projectName} remaining gap after committed and pursued dollars: ${formatAmount(snapshot.unfundedAfterLikelyAmount)}.`
      : snapshot.remainingFundingGap > 0
        ? `${projectName} current committed funding gap: ${formatAmount(snapshot.remainingFundingGap)}.`
        : null,
    snapshot.latestSourceUpdatedAt
      ? `Funding source records are current through ${formatDateTime(snapshot.latestSourceUpdatedAt)}.`
      : null,
  ].filter((claim): claim is string => claim !== null);
}

function legacyRunClaims(runs: ReportSectionFactsRun[]): string[] {
  return runs.map((run) => {
    const metrics = run.metrics ?? {};
    const score =
      typeof metrics.overallScore === "number" ? `${metrics.overallScore}/100` : "not recorded";
    const confidence =
      typeof metrics.confidence === "string" ? titleize(metrics.confidence) : "not recorded";
    const summary = run.summary_text?.trim()
      ? ` Saved run summary: ${run.summary_text.trim()}`
      : " No run summary is saved.";
    return `Analysis run "${run.title ?? "Untitled run"}"${
      run.created_at ? ` (created ${formatDateTime(run.created_at)})` : ""
    } has overall score ${score} and confidence ${confidence}.${summary}`;
  });
}

function citedModelRunClaims(citedModelRuns: ReportCitedModelRun[]): string[] {
  return citedModelRuns.map((run) => {
    const runMode = getManagedRunModeDefinition(run.engine_key);
    const kpiLine = compactModelRunKpiLine(run.result_summary_json);
    return `Worker model run "${run.run_title}" (${runMode.engineLabel}) has status "${titleize(run.status)}"${
      kpiLine ? ` with KPIs: ${kpiLine}` : " and no recorded KPI summary"
    }. ${runMode.caveatSummary}`;
  });
}

function citedCountyRunClaims(citedCountyRuns: ReportCitedCountyRun[]): string[] {
  return citedCountyRuns.map((run) => {
    const validation =
      run.validation_summary_json && typeof run.validation_summary_json === "object"
        ? run.validation_summary_json
        : null;
    const parts = [
      typeof validation?.passed === "number" ? `${validation.passed} pass` : null,
      typeof validation?.warned === "number" ? `${validation.warned} warning` : null,
      typeof validation?.failed === "number" ? `${validation.failed} fail` : null,
    ].filter((part): part is string => Boolean(part));
    return `County validation run "${run.run_name?.trim() || "County run"}" is at stage "${titleize(
      run.stage || "unknown"
    )}"${parts.length > 0 ? ` with validation checks: ${parts.join(", ")}` : " with no recorded validation summary"}.`;
  });
}

/**
 * The numbered fact list for one AI-draftable report section — extracted from
 * the generate route's deterministic assembly so every claim a draft may cite
 * is a value the packet itself renders.
 *
 * - `status_snapshot` / `executive_summary` speak to project posture, funding
 *   posture, and attachment COUNTS only — per-run figures belong to the run
 *   section so a summary can never smuggle modeling numbers past its caveats.
 * - `run_summaries` states each attached run with its own recorded values, and
 *   every worker model run fact carries its engine's standing screening caveat
 *   verbatim (the managed run-mode registry), so a sentence citing it inherits
 *   the honest framing.
 *
 * Unknown section keys return [] — callers whitelist first via
 * `sectionSupportsAiNarrative`.
 */
export function buildReportSectionFacts(
  data: ReportSectionFactsInput,
  sectionKey: string
): NarrativeFact[] {
  const projectName = `The ${data.project.name} project`;

  if (sectionKey === "status_snapshot" || sectionKey === "executive_summary") {
    return buildNarrativeFactList([
      `${projectName} is in status "${titleize(data.project.status)}", plan type "${titleize(
        data.project.plan_type
      )}", delivery phase "${titleize(data.project.delivery_phase)}".`,
      data.project.summary?.trim() ? `Project summary on record: ${data.project.summary.trim()}` : null,
      data.report.summary?.trim() ? `Report summary on record: ${data.report.summary.trim()}` : null,
      data.project.updated_at
        ? `The project record was last updated ${formatDateTime(data.project.updated_at)}.`
        : null,
      `${data.runs.length} analysis run(s), ${data.citedModelRuns.length} cited worker model run(s), and ${data.citedCountyRuns.length} cited county validation run(s) are attached to this report.`,
      ...(data.projectFundingSnapshot
        ? fundingSnapshotClaims(data.projectFundingSnapshot, projectName)
        : []),
    ]);
  }

  if (sectionKey === "run_summaries") {
    return buildNarrativeFactList([
      `${data.runs.length} analysis run(s), ${data.citedModelRuns.length} cited worker model run(s), and ${data.citedCountyRuns.length} cited county validation run(s) are attached to this report.`,
      ...legacyRunClaims(data.runs),
      ...citedModelRunClaims(data.citedModelRuns),
      ...citedCountyRunClaims(data.citedCountyRuns),
    ]);
  }

  return [];
}
