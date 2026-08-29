import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { getManagedRunModeDefinition } from "@/lib/models/run-modes";
import {
  AGREEMENT_METHOD_SENSITIVITY_STATEMENT,
  AGREEMENT_NO_AVERAGE_STATEMENT,
  type DualDemandAgreementSnapshotV1,
} from "@/lib/models/verified-dual-demand-agreement";
import { evaluateReportArtifactGate } from "@/lib/stage-gates/report-artifacts";
import { type ProjectStageGateSnapshot } from "@/lib/stage-gates/summary";
import { formatDateTime, formatReportTypeLabel, titleize } from "@/lib/reports/catalog";
import {
  extractEngagementHandoffProvenance,
  type ReportEngagementSummary,
} from "@/lib/reports/engagement";
import { DEMOGRAPHIC_DIMENSIONS } from "@/lib/engagement/demographics";
import { JOINT_READING_LABELS } from "@/lib/engagement/joint-representativeness";
import {
  buildEvidenceChainSummary,
  type EvidenceChainSummary,
} from "@/lib/reports/evidence-chain";
import { type ProjectFundingSnapshot } from "@/lib/projects/funding";
import {
  buildPacketSafetyEvidence,
  PROJECT_SAFETY_SECTION_KEY,
} from "@/lib/reports/safety-evidence-section";
import {
  buildPacketGeographyFigure,
  PROJECT_GEOGRAPHY_SECTION_KEY,
  PROJECT_GEOGRAPHY_SECTION_TITLE,
  type PacketGeographyFigure,
  type PacketGeographyInput,
} from "@/lib/reports/geography-figure";
import type { SafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import type { SafetyKsiConcentration, SafetyKsiEquityTract } from "@/lib/safety/client-types";
import type { SafetyRoadContextFeature } from "@/lib/safety/road-context";
import { renderSafetyStreetContextSvg } from "@/lib/safety/street-context-svg";
import { corridorGeojsonSchema } from "@/lib/models/run-launch";
import { type ReportScenarioSetLink } from "@/lib/reports/scenario-provenance";
import { modelingClaimStatusLabel, type ModelingClaimStatus } from "@/lib/models/evidence-backbone";
import {
  buildReportModelingEvidenceExportProof,
  formatModelingValidationStatusLabel,
  type ReportModelingEvidence,
} from "@/lib/reports/modeling-evidence";
// Type-only import: keeps the narrative-drafts <-> html module edge one-way at
// runtime (narrative-drafts imports compactModelRunKpiLine from here).
import type { AcceptedSectionNarrative } from "@/lib/reports/narrative-drafts";
import { formatMoney } from "@/lib/money/format";
import { scoreValueForPresentation } from "@/lib/analysis/score-presentation";
import type { FrozenReportAerialOrthoSnapshotV1 } from "@/lib/reports/aerial-ortho-evidence";
import { buildEvidenceDescriptor, type EvidenceDescriptorV1 } from "@/lib/evidence/evidence-descriptor";
import type { JurisdictionReadinessPayload } from "@/lib/jurisdiction-readiness/payload";

/**
 * The disclosure label rendered over every included AI narrative block.
 * Verbatim, always — an AI-assisted block is never presented as unassisted
 * prose, and the label only ever appears on operator-ACCEPTED drafts.
 */
export const AI_NARRATIVE_ACCEPTED_LABEL = "Drafted with AI assistance — reviewed and accepted";

/**
 * The disclosure rendered when the fact list recomputed at generation time no
 * longer matches the one the accepted draft was grounded against. Disclosed,
 * never silently dropped, never silently regenerated.
 */
export const AI_NARRATIVE_STALE_NOTICE =
  "Underlying data changed since acceptance — the workspace facts this narrative was grounded against no longer match the current records. Re-review or regenerate the draft before relying on this block.";

type ProjectRecord = {
  id: string;
  name: string;
  summary: string | null;
  status: string;
  plan_type: string;
  delivery_phase: string;
  created_at: string;
  updated_at: string;
  estimated_cost_amount?: number | string | null;
  estimated_cost_currency?: string | null;
  estimated_cost_basis_year?: number | null;
  estimated_cost_source_document_id?: string | null;
  estimated_cost_source_title?: string | null;
};

type RunRecord = {
  id: string;
  title: string;
  query_text: string;
  summary_text: string | null;
  ai_interpretation: string | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
};

/** A worker model run cited by the report (report_runs.model_run_id). */
export type ReportCitedModelRun = {
  id: string;
  run_title: string;
  engine_key: string;
  status: string;
  result_summary_json: Record<string, unknown> | null;
  /**
   * The run's recorded claim tier (`modeling_claim_decisions`), resolved by
   * `withCitedModelRunClaimTiers` in src/lib/reports/run-citations.ts.
   *
   * OPTIONAL ONLY FOR CALLERS THAT PREDATE THE LOOKUP. A packet whose cited runs
   * carry no tier renders no tier claim at all — it does NOT say "not recorded",
   * because the packet builder never asked. `null` here is the different, real
   * fact: the lookup ran and no claim decision exists.
   */
  claimStatus?: ModelingClaimStatus | null;
  /** True when the claim-tier read FAILED — distinct from `claimStatus: null`. */
  claimReadFailed?: boolean;
  validationAssessment?: {
    outcome: "pass" | "fail" | "inconclusive";
    reasons: string[];
    partition: Record<string, unknown>;
    planningUse: string;
    rulesVersion: number;
    comparisonBasisSha256: string;
  } | null;
  validationAssessmentReadFailed?: boolean;
  validationStructuralDiagnosis?: {
    assessmentSha256: string;
    diagnosisSha256: string;
    findings: string[];
    unknownFacts: string[];
    artifactUrl: string | null;
  } | null;
  validationStructuralDiagnosisReadFailed?: boolean;
  comparableObservationCustody?: {
    outcome: "inconclusive";
    inputBundleSha256: string;
    matchAuditSha256: string;
    comparisonBasisSha256: string;
    assessmentSha256: string;
    diagnosisSha256: string;
  } | null;
  comparableObservationCustodyReadFailed?: boolean;
};

/** A county validation run cited by the report (report_runs.county_run_id). */
export type ReportCitedCountyRun = {
  id: string;
  run_name: string | null;
  stage: string | null;
  validation_summary_json: Record<string, unknown> | null;
};

type ProjectItem = {
  id: string;
  title: string;
  detail?: string | null;
  status?: string | null;
  at?: string | null;
};

type ProjectRecordSnapshotEntry = {
  count: number;
  latestTitle: string | null;
  latestAt: string | null;
};

type ReportSectionRecord = {
  id: string;
  section_key: string;
  title: string;
  enabled: boolean;
  sort_order: number;
  config_json: Record<string, unknown> | null;
};

export type ReportGenerationData = {
  report: {
    id: string;
    title: string;
    summary: string | null;
    report_type: string;
    created_at: string;
  };
  workspace: {
    id: string;
    name: string;
  } | null;
  project: ProjectRecord;
  runs: RunRecord[];
  sections: ReportSectionRecord[];
  deliverables: ProjectItem[];
  risks: ProjectItem[];
  issues: ProjectItem[];
  decisions: ProjectItem[];
  meetings: ProjectItem[];
  engagement: ReportEngagementSummary | null;
  scenarioSetLinks: ReportScenarioSetLink[];
  projectFundingSnapshot: ProjectFundingSnapshot | null;
  projectRecordsSnapshot: {
    deliverables: ProjectRecordSnapshotEntry;
    risks: ProjectRecordSnapshotEntry;
    issues: ProjectRecordSnapshotEntry;
    decisions: ProjectRecordSnapshotEntry;
    meetings: ProjectRecordSnapshotEntry;
  };
  stageGateSnapshot: ProjectStageGateSnapshot;
  modelingEvidence: ReportModelingEvidence[];
  evidenceDescriptors?: EvidenceDescriptorV1[];
  /** The exact sparse registry reading frozen into this packet. */
  jurisdictionReadiness?: JurisdictionReadinessPayload;
  /**
   * The crash evidence attached to this project, or null when the read FAILED.
   * Optional so existing callers keep working — but `undefined` and `null` mean
   * different things here and the section says so: nothing attached versus
   * could not be read.
   */
  safetyEvidence?: readonly SafetyCrashEvidence[] | null;
  /** Ranked project-linked KSI clusters, or null when the database read failed. */
  safetyKsiConcentrations?: readonly SafetyKsiConcentration[] | null;
  safetyRoadContext?: readonly SafetyRoadContextFeature[] | null;
  safetyKsiEquityTracts?: readonly SafetyKsiEquityTract[] | null;
  safetyKsiEquityDemographicSource?: { label: string; vintage: string };
  /** Optional so pre-typed-evidence callers keep working; absent reads as none. */
  citedModelRuns?: ReportCitedModelRun[];
  dualDemandAgreementSnapshotsV1?: DualDemandAgreementSnapshotV1[];
  aerialOrthoPreview?: {
    snapshot: FrozenReportAerialOrthoSnapshotV1;
    imageSrc: string;
  } | null;
  citedCountyRuns?: ReportCitedCountyRun[];
  /**
   * The project's geometry, for the "Where this project is" figure.
   *
   * OPTIONAL, AND ABSENCE IS SILENCE. A caller that never read the geometry
   * gets no figure and no claim about it — the same rule the cited runs'
   * `claimStatus` follows. `studyArea: null` inside a supplied input is the
   * different, real fact: the read ran and this project has no area.
   */
  geography?: PacketGeographyInput;
  /**
   * Operator-ACCEPTED AI narrative blocks, resolved by the generate route
   * (status='accepted' rows only, staleness recomputed against the live fact
   * list). Absent reads as none — the packet stays fully deterministic.
   */
  acceptedNarratives?: AcceptedSectionNarrative[];
};

function reportEvidenceDescriptorMarkup(data: ReportGenerationData): string {
  const modelingDescriptors = data.modelingEvidence.map((item) => {
    const source = item.evidence?.sourceManifests[0] ?? null;
    return buildEvidenceDescriptor({
      identity: { kind: "report_modeling_evidence", countyRunId: item.countyRunId },
      source: {
        kind: source?.sourceKind ?? null,
        label: source?.sourceLabel ?? item.runName ?? "Modeling evidence",
        citation: source?.citationText ?? null,
      },
      asOfDate: source?.sourceVintage ?? item.updatedAt,
      retrievedAt: item.updatedAt,
      evidenceStatus: "modeled",
      claimTier: item.evidence?.claimDecision?.claimStatus ?? null,
      uncertainty: item.evidence?.claimDecision?.reasons ?? [],
      limits: item.evidence?.reportLanguage ? [item.evidence.reportLanguage] : [],
      revisionToken: item.updatedAt,
      checksumSha256: null,
      numericClaim: true,
    });
  });
  const descriptors = [...(data.evidenceDescriptors ?? []), ...modelingDescriptors];
  if (descriptors.length === 0) return "";
  return `<section aria-labelledby="evidence-descriptor-title">
    <h2 class="section-title" id="evidence-descriptor-title">Point-of-use evidence register</h2>
    <p>Each consequential claim keeps the same source, date, claim tier, uncertainty, revision, and support verdict used by the project handoff.</p>
    <ul>${descriptors.map((descriptor) => `<li>
      <strong>${esc(descriptor.source.label)}</strong> · ${esc(descriptor.evidenceStatus)} · ${esc(descriptor.claimTier ?? "claim tier not recorded")} · ${esc(descriptor.support.status)}
      <br /><span class="muted">Evidence ${esc(descriptor.stableEvidenceId)} · as of ${esc(descriptor.asOfDate ?? "not recorded")} · ${esc(descriptor.source.citation ?? "citation not recorded")}</span>
      ${descriptor.support.reason ? `<br /><span class="muted">${esc(descriptor.support.reason)}</span>` : ""}
    </li>`).join("")}</ul>
  </section>`;
}

/**
 * The slice of report data the engagement markup reads. Narrowed so the
 * campaign packet builder can reuse the exact same rendering as the project
 * packet's engagement section.
 */
type EngagementMarkupContext = Pick<ReportGenerationData, "engagement" | "sections">;

/**
 * A campaign-targeted report (reports.engagement_campaign_id) renders from
 * engagement records and cited typed runs only — there is no project row, so
 * the packet never fabricates project content. Project-scoped sections render
 * a disclosed not-applicable block instead.
 */
export type CampaignReportGenerationData = {
  report: {
    id: string;
    title: string;
    summary: string | null;
    report_type: string;
    created_at: string;
  };
  workspace: {
    id: string;
    name: string;
  } | null;
  /** Always present: the campaign is the report's target, not an attachment. */
  engagement: ReportEngagementSummary;
  sections: ReportSectionRecord[];
  citedModelRuns?: ReportCitedModelRun[];
  citedCountyRuns?: ReportCitedCountyRun[];
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCurrency(value: number | null | undefined): string {
  const numeric = typeof value === "number" ? value : 0;
  return formatMoney(Number.isFinite(numeric) ? numeric : 0, { precision: "whole" });
}

function listMarkup(items: ProjectItem[], emptyMessage: string): string {
  if (items.length === 0) {
    return `<p class="empty">${esc(emptyMessage)}</p>`;
  }

  return `<ul class="record-list">${items
    .map((item) => {
      const meta = [item.status ? titleize(item.status) : null, item.at ? formatDateTime(item.at) : null]
        .filter(Boolean)
        .join(" • ");

      return `<li>
        <strong>${esc(item.title)}</strong>
        ${item.detail ? `<p>${esc(item.detail)}</p>` : ""}
        ${meta ? `<span class="meta">${esc(meta)}</span>` : ""}
      </li>`;
    })
    .join("")}</ul>`;
}

function jurisdictionReadinessMarkup(payload: JurisdictionReadinessPayload | undefined): string {
  if (!payload) return "";

  const reports = payload.reports
    .map((report) => `<article class="run-card">
      <div class="run-head">
        <div>
          <h3>${esc(report.job.label)}</h3>
          <p class="meta">${esc(report.statusLabel)}</p>
        </div>
      </div>
      <p>${esc(report.applicability)}</p>
      <ul class="record-list">${report.limitations.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul>
      ${report.authorities.length > 0
        ? `<div class="transparency-grid">${report.authorities.map((authority) => `<div class="transparency-item">
            <strong>${esc(authority.label)}</strong>
            <span class="meta">${esc(authority.agency)} • ${esc(authority.url)}</span>
          </div>`).join("")}</div>`
        : ""}
      ${report.sources.length > 0
        ? `<div class="transparency-grid">${report.sources.map((source) => `<div class="transparency-item">
            <strong>${esc(source.path)}</strong>
            <span class="meta">sha256:${esc(source.sha256)}</span>
          </div>`).join("")}</div>`
        : `<p class="empty">No evidence-backed claim is registered for this cell.</p>`}
    </article>`)
    .join("");

  return `<section id="jurisdiction-readiness">
    <h2 class="section-title">Jurisdiction readiness</h2>
    <p>Can OpenPlan do this here? This packet records the current evidence-backed answer for ${esc(payload.jurisdiction.label)}. Unassessed work does not inherit another jurisdiction's claim.</p>
    <p class="meta">Registry ${esc(payload.registryVersion ?? "unknown")} • sha256:${esc(payload.registrySha256)}</p>
    <div class="metrics-stack">${reports}</div>
  </section>`;
}

function timelineMarkup(data: ReportGenerationData): string {
  const items = [
    ...data.deliverables.map((item) => ({ ...item, kind: "Deliverable" })),
    ...data.risks.map((item) => ({ ...item, kind: "Risk" })),
    ...data.issues.map((item) => ({ ...item, kind: "Issue" })),
    ...data.decisions.map((item) => ({ ...item, kind: "Decision" })),
    ...data.meetings.map((item) => ({ ...item, kind: "Meeting" })),
  ]
    .sort((left, right) => {
      const leftTime = left.at ? new Date(left.at).getTime() : 0;
      const rightTime = right.at ? new Date(right.at).getTime() : 0;
      return rightTime - leftTime;
    })
    .slice(0, 12);

  if (items.length === 0) {
    return `<p class="empty">No project activity is attached yet.</p>`;
  }

  return `<ol class="timeline">${items
    .map(
      (item) => `<li>
        <span class="meta">${esc(item.kind)} • ${esc(formatDateTime(item.at))}</span>
        <strong>${esc(item.title)}</strong>
        ${item.detail ? `<p>${esc(item.detail)}</p>` : ""}
      </li>`
    )
    .join("")}</ol>`;
}

function runMarkup(run: RunRecord): string {
  const metrics = run.metrics ?? {};
  const gate = evaluateReportArtifactGate(run);
  const transparency = buildSourceTransparency(metrics, typeof run.ai_interpretation === "string" ? "ai" : "fallback");
  const presentedOverall = scoreValueForPresentation(metrics, "overallScore");
  const score = presentedOverall === null ? "Withheld" : `${presentedOverall}/100`;
  const confidence = typeof metrics.confidence === "string" ? titleize(metrics.confidence) : "Unknown";

  return `<article class="run-card">
    <div class="run-head">
      <div>
        <h3>${esc(run.title)}</h3>
        <p class="meta">Run created ${esc(formatDateTime(run.created_at))}</p>
      </div>
      <span class="pill ${gate.decision === "PASS" ? "pill-pass" : "pill-hold"}">${gate.decision}</span>
    </div>
    <p>${esc(run.summary_text || "No run summary is saved yet.")}</p>
    <div class="metrics-grid">
      <div><span class="metric-label">Overall score</span><strong>${esc(score)}</strong></div>
      <div><span class="metric-label">Confidence</span><strong>${esc(confidence)}</strong></div>
    </div>
    <div class="transparency-grid">
      ${transparency
        .map(
          (item) => `<div class="transparency-item">
            <strong>${esc(item.label)}</strong>
            <span class="meta">${esc(item.status)}</span>
            <p>${esc(item.detail)}</p>
          </div>`
        )
        .join("")}
    </div>
    ${
      gate.missingArtifacts.length > 0
        ? `<div class="warning-box"><strong>Audit hold.</strong><p>Missing report artifacts: ${esc(gate.missingArtifacts.join(", "))}</p></div>`
        : ""
    }
    <details>
      <summary>Analysis query</summary>
      <p>${esc(run.query_text)}</p>
    </details>
  </article>`;
}

const MODEL_RUN_SCORECARD_KPI_LABELS: Array<{ key: string; label: string }> = [
  { key: "overallScore", label: "Overall score" },
  { key: "accessibilityScore", label: "Accessibility" },
  { key: "safetyScore", label: "Safety" },
  { key: "equityScore", label: "Equity" },
];

/** Compact KPI line from model_runs.result_summary_json: the managed scorecard
 * keys when present, otherwise the first few finite numeric entries. Exported
 * so the narrative-draft fact builder states the same KPIs the packet renders. */
export function compactModelRunKpiLine(resultSummary: Record<string, unknown> | null): string | null {
  if (!resultSummary) {
    return null;
  }

  const scorecardEntries = MODEL_RUN_SCORECARD_KPI_LABELS.map(({ key, label }) => {
    const value = resultSummary[key];
    return typeof value === "number" && Number.isFinite(value) ? `${label} ${value}/100` : null;
  }).filter((entry): entry is string => Boolean(entry));

  if (scorecardEntries.length > 0) {
    return scorecardEntries.join(" • ");
  }

  const numericEntries: string[] = [];
  for (const [key, value] of Object.entries(resultSummary)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      numericEntries.push(`${titleize(key)} ${Math.round(value * 100) / 100}`);
    }
    if (numericEntries.length >= 4) break;
  }

  return numericEntries.length > 0 ? numericEntries.join(" • ") : null;
}

/**
 * The claim-tier sentence for a cited model run, or null when this packet's
 * builder did not resolve one. Three states, three different facts:
 * read-failed, resolved-and-absent, resolved-to-a-tier. A fourth — "never
 * looked" — renders nothing rather than asserting absence.
 */
function citedModelRunClaimTierLine(run: ReportCitedModelRun): string | null {
  if (run.claimReadFailed) {
    return "Claim tier could not be read — a lookup failure, not evidence that no claim decision exists for this run.";
  }
  if (run.claimStatus === undefined && run.claimReadFailed === undefined) {
    return null;
  }
  return run.claimStatus
    ? `Claim tier: ${modelingClaimStatusLabel(run.claimStatus)}`
    : modelingClaimStatusLabel(null);
}

function citedModelRunMarkup(run: ReportCitedModelRun): string {
  const runMode = getManagedRunModeDefinition(run.engine_key);
  const kpiLine = compactModelRunKpiLine(run.result_summary_json);
  // Engine and status are already on this card; the claim tier is the third
  // thing a reader needs before trusting the figures, and the packet is the
  // artifact an agency hands a funder. The public plan page has disclosed all
  // three beside every citation since the RTP lane settled it.
  const claimTierLine = citedModelRunClaimTierLine(run);
  const assessment = run.validationAssessment;
  const assessmentLine = run.validationAssessmentReadFailed
    ? "Scientific validation assessment could not be read; do not treat that lookup failure as an absent assessment."
    : assessment
      ? `Observed-count assessment: ${assessment.outcome} (rules v${assessment.rulesVersion}; planning use ${assessment.planningUse}; partition ${JSON.stringify(assessment.partition)}; comparison-basis SHA-256 ${assessment.comparisonBasisSha256}).${assessment.reasons.length > 0 ? ` ${assessment.reasons.slice(0, 3).join(" ")}` : ""}`
      : "No rules-v4 observed-count comparability assessment is attached; older point-count diagnostics do not establish same-basis validation.";
  const diagnosis = run.validationStructuralDiagnosis;
  const diagnosisLine = run.validationStructuralDiagnosisReadFailed
    ? "Structural diagnosis could not be read; do not treat that lookup failure as evidence that no diagnosis exists."
    : diagnosis
      ? `Why this is inconclusive: ${diagnosis.findings.length > 0 ? diagnosis.findings.slice(0, 3).join(" ") : "No structural finding sentence was recorded."} Diagnosis SHA-256 ${diagnosis.diagnosisSha256}.${diagnosis.unknownFacts.length > 0 ? ` Unknown basis facts: ${diagnosis.unknownFacts.join(", ")}.` : ""}`
      : "No structural diagnosis is attached to this assessment.";
  const comparable = run.comparableObservationCustody;
  const comparableLine = run.comparableObservationCustodyReadFailed
    ? "Comparable-observation custody could not be read; the run is scientifically unchecked for that instrument."
    : comparable
      ? `Rules-v5 comparable-observation assessment: ${comparable.outcome}. Repaired observation and full-geometry match coverage is not improved model accuracy; modeled quantity is synthetic expanded daily traffic, not AADT. Input ${comparable.inputBundleSha256}; match audit ${comparable.matchAuditSha256}; basis ${comparable.comparisonBasisSha256}; assessment ${comparable.assessmentSha256}; diagnosis ${comparable.diagnosisSha256}.`
      : "No rules-v5 comparable-observation custody is attached to this run.";

  return `<article class="run-card">
    <div class="run-head">
      <div>
        <h3>${esc(run.run_title)}</h3>
        <p class="meta">Worker model run • ${esc(runMode.engineLabel)}</p>
      </div>
      <span class="pill ${run.status === "succeeded" ? "pill-pass" : "pill-hold"}">${esc(titleize(run.status))}</span>
    </div>
    ${kpiLine ? `<p>${esc(kpiLine)}</p>` : `<p class="empty">No KPI summary is recorded for this run.</p>`}
    ${claimTierLine ? `<p class="meta">${esc(claimTierLine)}</p>` : ""}
    <p class="meta">${esc(assessmentLine)}</p>
    <p class="meta">${esc(diagnosisLine)}</p>
    <p class="meta">${esc(comparableLine)}</p>
    <p class="meta">${esc(runMode.caveatSummary)}</p>
  </article>`;
}

function citedCountyRunMarkup(run: ReportCitedCountyRun): string {
  const validation =
    run.validation_summary_json && typeof run.validation_summary_json === "object"
      ? run.validation_summary_json
      : null;
  const validationParts = [
    typeof validation?.passed === "number" ? `${validation.passed} pass` : null,
    typeof validation?.warned === "number" ? `${validation.warned} warning` : null,
    typeof validation?.failed === "number" ? `${validation.failed} fail` : null,
  ].filter((part): part is string => Boolean(part));

  return `<article class="run-card">
    <div class="run-head">
      <div>
        <h3>${esc(run.run_name?.trim() || "County run")}</h3>
        <p class="meta">County validation run</p>
      </div>
      <span class="pill ${run.stage === "validated-screening" ? "pill-pass" : "pill-hold"}">${esc(titleize(run.stage || "unknown"))}</span>
    </div>
    ${
      validationParts.length > 0
        ? `<p>Validation posture: ${esc(validationParts.join(" • "))}</p>`
        : `<p class="empty">No validation summary is recorded for this run.</p>`
    }
  </article>`;
}

function engagementSynthesisMarkup(data: EngagementMarkupContext): string {
  const synthesis = data.engagement?.synthesis;
  if (!synthesis) {
    return "";
  }

  const method =
    synthesis.source === "ai"
      ? "AI-assisted synthesis"
      : "Keyword-based synthesis (computed while AI was offline)";
  const sentiment =
    synthesis.overallSentiment === "mixed"
      ? "mixed"
      : `predominantly ${synthesis.overallSentiment}`;

  // The export gate already ran in buildReportEngagementSynthesis: prose is
  // present only when every sentence is grounded and the faithfulness belt
  // ran. A withheld narrative is stated, never silently dropped.
  const narrativeMarkup = synthesis.narrative
    ? synthesis.narrative
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${esc(paragraph.trim())}</p>`)
        .join("")
    : synthesis.narrativeWithheld
      ? `<p class="meta">The synthesis narrative is withheld from this artifact because not every sentence passed citation-grounding and faithfulness checks; review the flagged sentences on the campaign page before quoting it.</p>`
      : "";

  const themesMarkup =
    synthesis.themes.length > 0
      ? `<ul class="record-list">${synthesis.themes
          .map(
            (theme) => `<li>
          <strong>${esc(theme.label)}</strong>
          <span class="meta">${theme.itemCount} comment${theme.itemCount === 1 ? "" : "s"} • ${esc(theme.sentiment)}</span>
        </li>`
          )
          .join("")}</ul>`
      : "";

  return `<div style="margin-top: 18px;">
    <h3>Community input synthesis (screening)</h3>
    <p>${esc(method)} of ${synthesis.analyzedItemCount} approved comment${synthesis.analyzedItemCount === 1 ? "" : "s"} • ${esc(sentiment)} sentiment.</p>
    ${narrativeMarkup}
    ${themesMarkup}
    <p class="meta">${esc(synthesis.caveat)}</p>
  </div>`;
}

function engagementHotspotsMarkup(data: EngagementMarkupContext): string {
  const hotspots = data.engagement?.hotspots;
  if (!hotspots || hotspots.clusterCount === 0) {
    return "";
  }

  const significant = hotspots.clusters.filter((cluster) => cluster.significant);
  const rows = (significant.length > 0 ? significant : hotspots.clusters).slice(0, 4);
  const heading =
    significant.length > 0
      ? `${significant.length} elevated-concern cluster${significant.length === 1 ? "" : "s"} (screening)`
      : `${hotspots.clusterCount} comment cluster${hotspots.clusterCount === 1 ? "" : "s"}`;
  const baseline =
    hotspots.sentimentAvailable && hotspots.globalNegativeSharePct !== null
      ? ` • baseline ${hotspots.globalNegativeSharePct}% negative`
      : "";

  return `<div style="margin-top: 18px;">
    <h3>Spatial hotspots (screening)</h3>
    <p>${esc(heading)}${esc(baseline)}.</p>
    <ul class="record-list">${rows
      .map((cluster, index) => {
        const share =
          cluster.clusterNegativeSharePct !== null ? ` • ${cluster.clusterNegativeSharePct}% negative` : "";
        const z = cluster.zScore !== null ? ` • z=${cluster.zScore.toFixed(2)}` : "";
        const flag = cluster.significant ? " • elevated (screening)" : "";
        return `<li>
          <strong>Cluster ${index + 1}</strong>
          <span class="meta">${cluster.nItems} comment${cluster.nItems === 1 ? "" : "s"}${esc(share)}${esc(z)}${esc(flag)}</span>
        </li>`;
      })
      .join("")}</ul>
    <p class="meta">${esc(hotspots.caveat)}</p>
  </div>`;
}

function engagementRepresentativenessMarkup(data: EngagementMarkupContext): string {
  const representativeness = data.engagement?.representativeness;
  if (!representativeness || representativeness.respondentCount === 0) {
    return "";
  }

  const rows = representativeness.metrics.filter((metric) => metric.baselinePct !== null);
  const under = representativeness.underRepresented.length;
  const over = representativeness.metrics.filter((metric) => metric.status === "over").length;
  const informative = representativeness.metrics.filter((metric) => metric.status !== "insufficient").length;
  const heading =
    informative === 0
      ? "Not enough spatial spread to screen representativeness (screening)"
      : under > 0
        ? `${under} group${under === 1 ? "" : "s"} under-represented (screening)`
        : over > 0
          ? `${over} group${over === 1 ? "" : "s"} over-represented (screening)`
          : "Respondents broadly mirror the area (screening)";

  return `<div style="margin-top: 18px;">
    <h3>Representativeness (screening)</h3>
    <p>${esc(heading)} • ${representativeness.respondentCount} of ${representativeness.locatedRespondentCount} located respondents across ${representativeness.tractCount} tract${representativeness.tractCount === 1 ? "" : "s"}.</p>
    <ul class="record-list">${rows
      .map((metric) => {
        const ratio = metric.representationRatio !== null ? ` • ${metric.representationRatio.toFixed(2)}×` : "";
        const respondent = metric.respondentPct !== null ? `${metric.respondentPct}%` : "—";
        return `<li>
          <strong>${esc(metric.label)}</strong>
          <span class="meta">respondents ${respondent} vs area ${metric.baselinePct}%${esc(ratio)} • ${esc(metric.status)}</span>
        </li>`;
      })
      .join("")}</ul>
    <p class="meta">${esc(representativeness.caveat)}</p>
  </div>`;
}

/**
 * E5a — the k-anonymized self-reported respondent demographics, as they travel
 * into a report artifact.
 *
 * WHY THE NOTE AND THE COUNTS ARE ONE TEMPLATE. A suppressed aggregate that
 * arrives somewhere without its suppression note reads as a complete census of
 * respondents, and a reader who quotes "8 renters" into a funding narrative has
 * then published a number the data does not support. There is deliberately no
 * branch here that emits a band count without also emitting
 * `suppressionNote` and `caveat` — the note travels with the number or the
 * number does not travel.
 *
 * Silence is the honest output when `selfReported` is null: the builder returns
 * null both for a caller that never loaded the aggregate and for a campaign
 * that collected nothing, and a report may not assert "no demographics were
 * collected" on either. What IS said about a failed read is said by the joint
 * block below, which knows the difference.
 */
function engagementSelfReportedDemographicsMarkup(data: EngagementMarkupContext): string {
  const selfReported = data.engagement?.selfReported;
  if (!selfReported) {
    return "";
  }

  const dimensions = DEMOGRAPHIC_DIMENSIONS.map((dimension) => {
    const bands = selfReported.dimensions[dimension.key];
    if (bands.length === 0) {
      return "";
    }
    return `<li>
      <strong>${esc(dimension.label)}</strong>
      <span class="meta">${bands
        .map((band) => `${esc(band.label)} ${band.count}`)
        .join(" • ")}</span>
    </li>`;
  }).join("");

  return `<div style="margin-top: 18px;">
    <h3>Self-reported respondent demographics (screening)</h3>
    <p>${selfReported.respondentsWithDemographics} respondent${
      selfReported.respondentsWithDemographics === 1 ? "" : "s"
    } shared optional demographics. Counts only — no percentages, because suppression and multi-select answers make a share misleading.</p>
    <ul class="record-list">${dimensions}</ul>
    <p>${esc(selfReported.suppressionNote)}</p>
    <p class="meta">${esc(selfReported.caveat)}</p>
  </div>`;
}

/**
 * E5c — the joint reading across the area-based (ACS) screen and the
 * self-reported floor.
 *
 * WHY THE LIMITS ARE NOT OPTIONAL. The two screens share almost no vocabulary:
 * one speaks minority / poverty / zero-vehicle / transit over tracts, the other
 * age / language / tenure / race over the people who chose to answer. The
 * headline is a sentence about both, and without the population-mismatch
 * disclosure it becomes a comparison the data does not support — the exact
 * over-read the joint module was built to prevent. So the headline and the
 * limits are emitted together, and if a reading ever arrives with no limits at
 * all the block refuses and names why rather than printing the headline bare.
 */
function engagementJointRepresentativenessMarkup(data: EngagementMarkupContext): string {
  const joint = data.engagement?.joint;
  if (!joint) {
    return "";
  }

  if (joint.limits.length === 0) {
    return `<div class="warning-box" style="margin-top: 18px;">
      <strong>Joint representativeness reading withheld</strong>
      <p>This reading arrived without the disclosure of what it cannot say, and the headline is not publishable on its own — the two screenings count different people. Nothing is claimed here either way.</p>
    </div>`;
  }

  const readFailure = joint.readFailureMessage
    ? `<p>Reported cause: ${esc(joint.readFailureMessage)}</p>`
    : "";

  return `<div style="margin-top: 18px;">
    <h3>Joint representativeness reading (screening)</h3>
    <p><strong>${esc(JOINT_READING_LABELS[joint.reading])}</strong></p>
    <p>${esc(joint.headline)}</p>
    ${readFailure}
    <p class="meta">What this cannot say</p>
    <ul class="record-list">${joint.limits.map((limit) => `<li>${esc(limit)}</li>`).join("")}</ul>
    <p>${esc(joint.dimension.rationale)}</p>
    <p class="meta">${esc(joint.caveat)}</p>
  </div>`;
}

function engagementHandoffMarkup(data: EngagementMarkupContext): string {
  const provenance = extractEngagementHandoffProvenance(data.sections);
  if (!provenance) {
    return "";
  }

  const currentCounts = data.engagement?.counts ?? null;

  return `<div class="warning-box" style="margin-top: 18px;">
    <strong>Report origin: ${esc(titleize(provenance.origin))}</strong>
    <p>${esc(provenance.reason)}</p>
    <p>Created from <strong>${esc(provenance.campaign.title)}</strong> and snapshot captured ${esc(
      formatDateTime(provenance.capturedAt)
    )}.</p>
    <p>Handoff snapshot: ${provenance.counts.readyForHandoffCount} ready for handoff • ${provenance.counts.totalItems} total items • ${provenance.counts.actionableCount} actionable review • ${provenance.counts.uncategorizedItems} uncategorized.</p>
    ${
      currentCounts
        ? `<p>Current live campaign counts: ${currentCounts.moderationQueue.readyForHandoffCount} ready for handoff • ${currentCounts.totalItems} total items.</p>`
        : ""
    }
  </div>`;
}

function fundingSnapshotMarkup(snapshot: ProjectFundingSnapshot | null): string {
  if (!snapshot) {
    return "";
  }

  return `<div class="warning-box" style="margin-top: 18px;">
    <strong>Funding posture at generation</strong>
    <p>${esc(snapshot.label)} • ${esc(snapshot.pipelineLabel)} • ${esc(snapshot.reimbursementLabel)}</p>
    <p>${snapshot.awardCount} award${snapshot.awardCount === 1 ? "" : "s"} • ${snapshot.pursuedOpportunityCount} pursued opportunit${snapshot.pursuedOpportunityCount === 1 ? "y" : "ies"} • ${esc(formatCurrency(snapshot.committedFundingAmount))} committed${snapshot.fundingNeedAmount > 0 ? ` • ${esc(formatCurrency(snapshot.fundingNeedAmount))} need` : ""}</p>
    <p>${snapshot.unfundedAfterLikelyAmount > 0 ? `Uncovered after likely dollars: ${esc(formatCurrency(snapshot.unfundedAfterLikelyAmount))}` : snapshot.remainingFundingGap > 0 ? `Current committed gap: ${esc(formatCurrency(snapshot.remainingFundingGap))}` : "No remaining funding gap was recorded in this snapshot."}${snapshot.uninvoicedAwardAmount > 0 ? ` • Uninvoiced awards: ${esc(formatCurrency(snapshot.uninvoicedAwardAmount))}` : ""}</p>
    ${snapshot.latestSourceUpdatedAt ? `<p>Funding source records current through ${esc(formatDateTime(snapshot.latestSourceUpdatedAt))}.</p>` : ""}
  </div>`;
}

function estimatedProjectCostMarkup(project: ProjectRecord): string {
  if (project.estimated_cost_amount == null || !project.estimated_cost_currency) {
    return `<p><strong>Planning-level estimated project cost:</strong> Not recorded.</p>`;
  }
  const source = project.estimated_cost_source_title
    ? ` Source: ${esc(project.estimated_cost_source_title)}.`
    : project.estimated_cost_source_document_id
      ? " A source document is linked, but its title could not be read during generation."
      : " No source document is linked.";
  const priceYear = project.estimated_cost_basis_year
    ? ` Price year ${esc(String(project.estimated_cost_basis_year))}.`
    : " Price year not entered.";
  return `<p><strong>Planning-level estimated project cost:</strong> ${esc(formatMoney(project.estimated_cost_amount, { precision: "whole", currency: project.estimated_cost_currency, currencyDisplay: "code" }))}.${priceYear}${source} This is separate from the project-management budget, funding need, and awards.</p>`;
}

function projectRecordsProvenanceMarkup(data: ReportGenerationData): string {
  const entries: Array<{
    label: string;
    anchor: string;
    value: ProjectRecordSnapshotEntry;
  }> = [
    { label: "Deliverables", anchor: "project-deliverables", value: data.projectRecordsSnapshot.deliverables },
    { label: "Risks", anchor: "project-risks", value: data.projectRecordsSnapshot.risks },
    { label: "Issues", anchor: "project-issues", value: data.projectRecordsSnapshot.issues },
    { label: "Decisions", anchor: "project-decisions", value: data.projectRecordsSnapshot.decisions },
    { label: "Meetings", anchor: "project-meetings", value: data.projectRecordsSnapshot.meetings },
  ];

  return `<section>
    <h2 class="section-title">Project records provenance</h2>
    <p>This artifact includes a compact snapshot of attached project records captured at generation time so reviewers can see the latest named evidence behind the packet.</p>
    <div class="metrics-stack">
      ${entries
        .map(
          ({ label, anchor, value }) => `<article class="metric-card">
            <span class="metric-label">${esc(label)}</span>
            <strong>${value.count}</strong>
            <p>${
              value.latestTitle
                ? `Latest: ${esc(value.latestTitle)}${
                    value.latestAt ? ` • ${esc(formatDateTime(value.latestAt))}` : ""
                  }`
                : "No attached records in this snapshot."
            }</p>
            <p><a href="/projects/${esc(data.project.id)}#${esc(anchor)}">Open ${esc(label.toLowerCase())}</a></p>
          </article>`
        )
        .join("")}
    </div>
  </section>`;
}

/**
 * The drawing itself.
 *
 * Everything here is inline: no `<img>`, no tile request, no token. See
 * `geography-figure.ts` for why. The picture is the SECOND copy of what this
 * block says — `figcaption` and the lists beside it carry the same facts as
 * text, because the built-in PDF typesetter discards `<svg>` wholesale and a
 * board reading that tier must not lose the content along with the picture.
 */
function packetGeographySvg(figure: PacketGeographyFigure): string {
  const width = figure.widthUnits;
  const height = figure.heightUnits;

  const areaPaths = figure.shapes
    .filter((shape) => shape.kind === "area")
    .map((shape) => `<path class="geo-area" d="${esc(shape.d ?? "")}" fill-rule="evenodd" />`)
    .join("");

  const extentPaths = figure.shapes
    .filter((shape) => shape.kind === "extent-box")
    .map((shape) => `<path class="geo-extent-box" d="${esc(shape.d ?? "")}" />`)
    .join("");

  const corridorPaths = figure.shapes
    .filter((shape) => shape.kind === "corridor")
    .map(
      (shape) =>
        `<path class="geo-corridor-halo" d="${esc(shape.d ?? "")}" /><path class="geo-corridor" d="${esc(shape.d ?? "")}" />`
    )
    .join("");

  const markerGlyphs = figure.shapes
    .filter((shape) => shape.kind === "marker" && shape.point)
    .map(
      (shape) =>
        `<circle class="geo-marker-halo" cx="${shape.point!.x.toFixed(1)}" cy="${shape.point!.y.toFixed(1)}" r="9" /><circle class="geo-marker" cx="${shape.point!.x.toFixed(1)}" cy="${shape.point!.y.toFixed(1)}" r="4.5" />`
    )
    .join("");

  const badges = figure.shapes
    .filter((shape) => shape.badge)
    .map(
      (shape) =>
        `<circle class="geo-badge-disc" cx="${shape.badge!.x.toFixed(1)}" cy="${shape.badge!.y.toFixed(1)}" r="9" /><text class="geo-badge-text" x="${shape.badge!.x.toFixed(1)}" y="${(shape.badge!.y + 3.6).toFixed(1)}">${esc(shape.badge!.text)}</text>`
    )
    .join("");

  // North is up by construction — the projection negates latitude and does
  // nothing else — so the arrow states a fact rather than decorating one.
  const northArrow = `<g class="geo-north">
      <rect x="${(width - 54).toFixed(1)}" y="14" width="40" height="52" rx="10" class="geo-chrome-plate" />
      <path class="geo-north-arrow" d="M${(width - 34).toFixed(1)} 22 L${(width - 27).toFixed(1)} 42 L${(width - 34).toFixed(1)} 37 L${(width - 41).toFixed(1)} 42 Z" />
      <text class="geo-chrome-text" x="${(width - 34).toFixed(1)}" y="60" text-anchor="middle">N</text>
    </g>`;

  const scaleBar = figure.scaleBar
    ? `<g class="geo-scale">
      <rect x="14" y="${(height - 48).toFixed(1)}" width="${(figure.scaleBar.lengthUnits + 28).toFixed(1)}" height="36" rx="10" class="geo-chrome-plate" />
      <line class="geo-scale-line" x1="28" y1="${(height - 20).toFixed(1)}" x2="${(28 + figure.scaleBar.lengthUnits).toFixed(1)}" y2="${(height - 20).toFixed(1)}" />
      <line class="geo-scale-line" x1="28" y1="${(height - 26).toFixed(1)}" x2="28" y2="${(height - 14).toFixed(1)}" />
      <line class="geo-scale-line" x1="${(28 + figure.scaleBar.lengthUnits).toFixed(1)}" y1="${(height - 26).toFixed(1)}" x2="${(28 + figure.scaleBar.lengthUnits).toFixed(1)}" y2="${(height - 14).toFixed(1)}" />
      <text class="geo-chrome-text" x="28" y="${(height - 31).toFixed(1)}">${esc(figure.scaleBar.label)}</text>
    </g>`
    : "";

  const description = [
    "Shape drawing of this project's geography.",
    ...figure.contents,
    figure.extentStatement ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<svg class="geo-svg" viewBox="0 0 ${width} ${height.toFixed(0)}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(description)}">
      <rect x="0.5" y="0.5" width="${(width - 1).toFixed(1)}" height="${(height - 1).toFixed(1)}" rx="16" class="geo-plate" />
      ${areaPaths}${extentPaths}${corridorPaths}${markerGlyphs}${badges}
      ${northArrow}${scaleBar}
    </svg>`;
}

function packetGeographyBodyMarkup(data: ReportGenerationData): string {
  // Never read: the packet builder was not given the geometry, so it states
  // nothing about it — the same silence the cited-run claim tier keeps.
  if (!data.geography) {
    return `<p class="empty">This packet was assembled without reading the project's geometry, so nothing is drawn here. It does not mean the project has none.</p>`;
  }

  const figure = buildPacketGeographyFigure(data.geography);
  const projectHref = `/projects/${esc(data.project.id)}#project-identity`;

  if (!figure.hasDrawing) {
    return `<div class="warning-box">
      <strong>Nothing to draw</strong>
      <p>${esc(figure.emptyStatement ?? "")}</p>
      <p>${esc(figure.emptyNextStep ?? "")}</p>
      ${figure.caveats.map((caveat) => `<p>${esc(caveat)}</p>`).join("")}
      <p><a href="${projectHref}">Open the project record</a></p>
    </div>`;
  }

  return `<figure class="geo-figure">
      ${packetGeographySvg(figure)}
      <figcaption>
        <p><strong>What this drawing is.</strong> ${esc(figure.caveats[0] ?? "")}</p>
        <p>${esc(figure.orientationStatement ?? "")} ${esc(figure.scaleStatement ?? "")}</p>
        <p>${esc(figure.extentStatement ?? "")}</p>
      </figcaption>
    </figure>
    <div class="two-col" style="margin-top: 16px;">
      <div>
        <h3>What is drawn</h3>
        <ul class="record-list">
          ${figure.legend
            .map(
              (entry) =>
                `<li><strong>${esc(entry.label)}</strong><br /><span class="meta">${esc(entry.kind === "area" ? "Study area" : entry.kind === "extent-box" ? "Recorded extent" : entry.kind === "corridor" ? "Corridor" : "Project point")}</span> ${esc(entry.detail)}</li>`
            )
            .join("")}
        </ul>
      </div>
      <div>
        <h3>Read it with these in mind</h3>
        <ul class="record-list">
          ${figure.caveats.map((caveat) => `<li>${esc(caveat)}</li>`).join("")}
        </ul>
        <p><a href="${projectHref}">Open the project record</a></p>
      </div>
    </div>`;
}

/**
 * The figure in the always-on band, for a packet whose section list predates
 * the geography section.
 *
 * WHY THIS EXISTS AS WELL AS THE SECTION. Sections are rows in
 * `report_sections`, written once when the report is created. Adding the
 * section to the templates therefore reaches NEW packets only — every report an
 * agency already has would regenerate without a map forever, which is the exact
 * defect this work was opened for. So the figure also rides the unconditional
 * band beside the evidence chain and the stage-gate snapshot, and stands down
 * the moment a real section carries it, so no packet prints it twice.
 */
/**
 * The packet's crash evidence.
 *
 * Every figure renders with the sentences that qualify it, and an absent figure
 * renders its REASON rather than a zero — a board reading "0 killed or
 * seriously injured" because a source cannot separate serious injuries has been
 * told the opposite of the truth.
 */
function packetSafetyBodyMarkup(data: ReportGenerationData): string {
  // `??` would collapse null into [] and render a FAILED READ as "no crash
  // data attached" — the two sentences this section exists to keep apart.
  // undefined means a caller that predates this field; null means the read failed.
  const built = buildPacketSafetyEvidence(
    data.safetyEvidence === undefined ? [] : data.safetyEvidence
  );

  if (built.kind === "unreadable") {
    return `<p>The crash evidence attached to this project could not be read while this packet was generated. That is a failed read, not a finding: it does not mean no crash data is attached. Regenerate the packet, and until it succeeds this section must not be read as evidence that there were no collisions.</p>`;
  }

  if (built.kind === "none") {
    return `<p>No crash data is attached to this project. That is not a statement that no collisions happened here — it is a statement that none have been retrieved into OpenPlan for this project.</p>`;
  }

  const acquisitionMarkup = built.acquisitions
    .map(
      (acquisition) => `<div class="packet-safety-acquisition">
      <h3>${esc(acquisition.sourceLabel)}</h3>
      <p>Years requested: ${esc(acquisition.years)}</p>
      <p>${acquisition.publishedThrough
        ? `Source publication cutoff: ${esc(acquisition.publishedThrough)}${acquisition.publishedThroughSourceUrl ? ` — <a href="${esc(acquisition.publishedThroughSourceUrl)}">${esc(acquisition.publishedThroughSourceLabel ?? "source publication metadata")}</a>` : ""}.`
        : "The source supplied no exact publication cutoff; requested and returned years are not substitutes."}</p>
      <dl class="detail-grid">
        ${acquisition.figures
          .map(
            (figure) => `<div><dt>${esc(figure.label)}</dt><dd>${
              figure.value === null
                ? `Not available — ${esc(figure.absentBecause ?? "no reason recorded")}`
                : esc(figure.value.toLocaleString())
            }</dd></div>`
          )
          .join("")}
      </dl>
      <ul>
        ${acquisition.caveats.map((caveat) => `<li>${esc(caveat)}</li>`).join("")}
      </ul>
      <p>${esc(acquisition.citation)}</p>
    </div>`
    )
    .join("");

  const concentrations = data.safetyKsiConcentrations;
  const concentrationMarkup = concentrations === undefined
    ? ""
    : concentrations === null
    ? `<h3>Highest observed KSI concentrations</h3><p>The project-linked severe-crash concentration ranking could not be read while this packet was generated. That is a failed calculation, not a finding that no concentration exists.</p>`
    : concentrations.length > 0
      ? `<h3>Highest observed KSI concentrations</h3>
        <p>These ranks use every mapped fatal and serious-injury crash in the project-linked acquisitions. A concentration is two or more records within 150 meters. These are screening locations, not named intersections, corridors, rates, causal findings, or a High Injury Network.</p>
        <ol>${concentrations.map((item) => `<li><strong>${esc(item.crashCount.toLocaleString())} KSI crashes</strong> (${esc(item.fatalCrashCount.toLocaleString())} fatal; ${esc(item.seriousInjuryCrashCount.toLocaleString())} serious injury) near ${esc(item.latitude.toFixed(5))}, ${esc(item.longitude.toFixed(5))}. ${item.roadIdentity?.status === "matched" ? `Nearest named road: <strong>${esc(item.roadIdentity.name)}</strong>; ${esc(item.roadIdentity.matchQuality)} match at ${esc(item.roadIdentity.distanceMeters.toLocaleString())} m; ${esc(item.roadIdentity.sourceLabel)} ${esc(item.roadIdentity.vintage)}.` : "Road identity unavailable; the coordinates remain the source location."}</li>`).join("")}</ol>`
      : `<h3>Highest observed KSI concentrations</h3><p>No pair of mapped fatal or serious-injury crash records fell within the 150-meter screening radius. That is not a finding that the project area is safe.</p>`;

  const equityTracts = data.safetyKsiEquityTracts;
  const equitySource = data.safetyKsiEquityDemographicSource;
  const equityMarkup = equityTracts === undefined
    ? ""
    : equityTracts === null
      ? `<h3>Community burden screen</h3><p>The mapped KSI-to-Census-tract comparison could not be read. That is a failed calculation, not a finding that harm is evenly distributed.</p>`
      : equityTracts.length === 0
        ? `<h3>Community burden screen</h3><p>No loaded Census tract demographics overlap the mapped KSI records, so community burden is not determined in this packet.</p>`
        : `<h3>Community burden screen</h3>
          <p>Mapped KSI records are grouped by Census tract and ranked by observed count. Demographics come from ${esc(equitySource?.label ?? "the loaded demographic source")} ${esc(equitySource?.vintage ?? "vintage not recorded")}. Counts per 100,000 residents are not adjusted for roadway exposure, travel, or time. This is screening context, not a causal, protected-class, or legal disparity finding.</p>
          <ol>${equityTracts.slice(0, 5).map((tract) => `<li><strong>${esc(tract.tractName ?? `Census tract ${tract.geoid}`)}: ${esc(tract.ksiCrashCount.toLocaleString())} KSI crashes</strong>; poverty ${tract.pctPoverty === null ? "not available" : `${esc(tract.pctPoverty.toFixed(1))}%`}${tract.areaMedianPctPoverty === null ? "" : ` vs area median ${esc(tract.areaMedianPctPoverty.toFixed(1))}%`}; nonwhite population ${tract.pctNonwhite === null ? "not available" : `${esc(tract.pctNonwhite.toFixed(1))}%`}; zero-vehicle households ${tract.pctZeroVehicle === null ? "not available" : `${esc(tract.pctZeroVehicle.toFixed(1))}%`}.</li>`).join("")}</ol>`;

  const roadContext = data.safetyRoadContext;
  const parsedProjectGeometry = corridorGeojsonSchema.safeParse(data.geography?.studyArea?.geometry);
  const streetContextSvg = concentrations && roadContext
    ? renderSafetyStreetContextSvg({
        roads: roadContext,
        crashLocations: concentrations.map(
          (item) => [item.longitude, item.latitude] as [number, number]
        ),
        projectGeometry: parsedProjectGeometry.success ? parsedProjectGeometry.data : null,
      })
    : null;
  const roadSources = roadContext
    ? Array.from(new Set(roadContext.map((road) => `${road.sourceLabel} ${road.vintage}`)))
    : [];
  const streetContextMarkup = roadContext === null
    ? `<h3>Printable street context</h3><p>Cached road evidence could not be read. Road identity and street context are unavailable, not absent.</p>`
    : streetContextSvg
      ? `<h3>Printable street context</h3>${streetContextSvg}<p><strong>Road source:</strong> ${roadSources.length > 0 ? roadSources.map(esc).join("; ") : "Road identity unavailable"}. Red points are ranked KSI concentration centers; the dashed green line is the project area when available. North arrow and scale are derived from the frozen vector extent. Coverage is limited to cached named TIGER/Line or OpenStreetMap roads attached to this project; no paid or live tile service was used.</p>`
      : `<h3>Printable street context</h3><p>No project-linked crash location and registered cached road geometry were available to draw. Road identity is unavailable; coordinates above remain the source locations.</p>`;

  return acquisitionMarkup + concentrationMarkup + streetContextMarkup + equityMarkup;
}

function projectGeographyMarkup(data: ReportGenerationData, sectionListCarriesIt: boolean): string {
  // `sectionListCarriesIt` counts a DISABLED section too. A report whose
  // section list names geography has already been asked the question, and an
  // operator who switched it off must not have it reinstated from underneath.
  // Only a report that never heard of the section gets it from the band.
  if (sectionListCarriesIt || !data.geography) return "";

  return `<section id="${esc(PROJECT_GEOGRAPHY_SECTION_KEY)}">
    <h2 class="section-title">${esc(PROJECT_GEOGRAPHY_SECTION_TITLE)}</h2>
    ${packetGeographyBodyMarkup(data)}
  </section>`;
}

function stageGateProvenanceMarkup(data: ReportGenerationData): string {
  const { stageGateSnapshot } = data;
  const blockedGate = stageGateSnapshot.blockedGate;
  const nextGate = stageGateSnapshot.nextGate;

  return `<section>
    <h2 class="section-title">Governance and stage-gate provenance</h2>
    <p>This artifact includes a compact stage-gate snapshot captured at generation time using the active OpenPlan stage-gate summary.</p>
    <div class="metrics-stack">
      <article class="metric-card">
        <span class="metric-label">Template</span>
        <strong>${esc(stageGateSnapshot.templateId)}</strong>
        <p>Version ${esc(stageGateSnapshot.templateVersion)} • ${stageGateSnapshot.passCount} pass • ${stageGateSnapshot.holdCount} hold • ${stageGateSnapshot.notStartedCount} not started</p>
        <p><a href="/projects/${esc(data.project.id)}#project-governance">Open governance</a></p>
      </article>
      <article class="metric-card">
        <span class="metric-label">Blocked gate</span>
        <strong>${esc(blockedGate ? `${blockedGate.gateId} · ${blockedGate.name}` : "No gate on hold")}</strong>
        <p>${
          blockedGate
            ? `${esc(blockedGate.rationale)}${
                blockedGate.missingArtifacts.length > 0
                  ? ` Missing artifacts: ${esc(blockedGate.missingArtifacts.join(", "))}.`
                  : ""
              }`
            : "No formal HOLD decision is recorded in this snapshot."
        }</p>
      </article>
      <article class="metric-card">
        <span class="metric-label">Next gate</span>
        <strong>${esc(nextGate ? `${nextGate.gateId} · ${nextGate.name}` : "Gate sequence complete")}</strong>
        <p>${
          nextGate
            ? `${nextGate.requiredEvidenceCount} required evidence item${
                nextGate.requiredEvidenceCount === 1 ? "" : "s"
              } • ${nextGate.operatorControlEvidenceCount} operator control profile${
                nextGate.operatorControlEvidenceCount === 1 ? "" : "s"
              }`
            : "Every gate in the active template currently has a recorded PASS decision."
        }</p>
      </article>
      <article class="metric-card">
        <span class="metric-label">Control health</span>
        <strong>${stageGateSnapshot.controlHealth.totalOperatorControlEvidenceCount}</strong>
        <p>${stageGateSnapshot.controlHealth.gatesWithOperatorControlsCount} gate${
          stageGateSnapshot.controlHealth.gatesWithOperatorControlsCount === 1 ? "" : "s"
        } in this template include operator control evidence.</p>
      </article>
    </div>
  </section>`;
}

function latestScenarioTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function buildScenarioSpineAggregate(data: ReportGenerationData) {
  const assumptionSetCount = data.scenarioSetLinks.reduce(
    (sum, link) => sum + (link.sharedSpine?.assumptionSetCount ?? 0),
    0
  );
  const dataPackageCount = data.scenarioSetLinks.reduce(
    (sum, link) => sum + (link.sharedSpine?.dataPackageCount ?? 0),
    0
  );
  const indicatorSnapshotCount = data.scenarioSetLinks.reduce(
    (sum, link) => sum + (link.sharedSpine?.indicatorSnapshotCount ?? 0),
    0
  );
  const pendingCount = data.scenarioSetLinks.filter(
    (link) => link.sharedSpine?.schemaPending
  ).length;

  return {
    assumptionSetCount,
    dataPackageCount,
    indicatorSnapshotCount,
    pendingCount,
    latestAssumptionSetUpdatedAt: latestScenarioTimestamp(
      data.scenarioSetLinks.map((link) => link.sharedSpine?.latestAssumptionSetUpdatedAt ?? null)
    ),
    latestDataPackageUpdatedAt: latestScenarioTimestamp(
      data.scenarioSetLinks.map((link) => link.sharedSpine?.latestDataPackageUpdatedAt ?? null)
    ),
    latestIndicatorSnapshotAt: latestScenarioTimestamp(
      data.scenarioSetLinks.map((link) => link.sharedSpine?.latestIndicatorSnapshotAt ?? null)
    ),
  };
}

function evidenceChainMarkup(summary: EvidenceChainSummary): string {
  return `<section>
    <h2 class="section-title">Evidence chain summary</h2>
    <p>This packet summarizes the current planning evidence chain captured at generation time so reviewers can quickly see what source surfaces support the artifact.</p>
    <div class="metrics-grid">
      <div><span class="metric-label">Linked runs</span><strong>${summary.linkedRunCount}</strong></div>
      <div><span class="metric-label">Scenario sets</span><strong>${summary.scenarioSetLinkCount}</strong></div>
      <div><span class="metric-label">Scenario assumptions</span><strong>${summary.scenarioAssumptionSetCount}</strong></div>
      <div><span class="metric-label">Scenario data packages</span><strong>${summary.scenarioDataPackageCount}</strong></div>
      <div><span class="metric-label">Indicator snapshots</span><strong>${summary.scenarioIndicatorSnapshotCount}</strong></div>
      <div><span class="metric-label">Project record groups</span><strong>${summary.projectRecordGroupCount}</strong></div>
      <div><span class="metric-label">Project records</span><strong>${summary.totalProjectRecordCount}</strong></div>
      <div><span class="metric-label">Engagement posture</span><strong>${esc(summary.engagementLabel)}</strong></div>
      <div><span class="metric-label">Handoff-ready input</span><strong>${summary.engagementReadyForHandoffCount}/${summary.engagementItemCount}</strong></div>
      <div><span class="metric-label">Stage-gate posture</span><strong>${esc(summary.stageGateLabel)}</strong></div>
      <div><span class="metric-label">Governance counts</span><strong>${summary.stageGatePassCount} pass • ${summary.stageGateHoldCount} hold</strong></div>
      <div><span class="metric-label">Modeling evidence</span><strong>${summary.modelingEvidenceCount ?? 0}</strong></div>
      <div><span class="metric-label">Modeling claim posture</span><strong>${esc(summary.modelingEvidenceClaimLabel ?? "Not linked")}</strong></div>
      <div><span class="metric-label">Crash acquisitions</span><strong>${summary.safetyAcquisitionCount ?? 0}</strong></div>
    </div>
    ${
      summary.scenarioSharedSpinePendingCount > 0
        ? `<p class="meta" style="margin-top: 14px;">Scenario shared-spine schema was pending for ${summary.scenarioSharedSpinePendingCount} linked set${summary.scenarioSharedSpinePendingCount === 1 ? "" : "s"} at generation.</p>`
        : ""
    }
    ${
      summary.stageGateBlockedGateLabel
        ? `<p class="meta" style="margin-top: 14px;">Blocked gate at generation: ${esc(summary.stageGateBlockedGateLabel)}</p>`
        : ""
    }
  </section>`;
}

function modelingEvidenceMarkup(modelingEvidence: ReportModelingEvidence[]): string {
  if (modelingEvidence.length === 0) {
    return "";
  }

  return `<section>
    <h2 class="section-title">Modeling evidence and claim posture</h2>
    <p>This packet includes structured assignment-model evidence captured from county-run records so model-backed project claims carry explicit source and validation context.</p>
    <div class="metrics-stack">
      ${modelingEvidence
        .map((item) => {
          const evidence = item.evidence;
          const claim = evidence?.claimDecision ?? null;
          const validationSummary = claim?.validationSummary ?? null;
          const validationRows = evidence?.validationResults ?? [];
          const sourceRows = evidence?.sourceManifests ?? [];
          const exportProof = buildReportModelingEvidenceExportProof(item);
          const validationSummaryText = validationSummary
            ? `${validationSummary.passed} pass • ${validationSummary.warned} warning • ${validationSummary.failed} fail`
            : `${validationRows.length} validation checks`;

          return `<article class="metric-card modeling-evidence-card">
            <h3>${esc(item.geographyLabel?.trim() || item.runName?.trim() || "County model run")}</h3>
            <p class="meta">${esc(item.runName?.trim() || "County run")} • ${esc(titleize(item.stage || "unknown"))} • updated ${esc(formatDateTime(item.updatedAt))}</p>
            ${
              claim
                ? `<p><strong>${esc(modelingClaimStatusLabel(claim.claimStatus))}:</strong> ${esc(
                    evidence?.reportLanguage ??
                      "Structured modeling evidence exists, but no report-language rule was recorded."
                  )}</p>
            <p>${esc(claim.statusReason)}</p>
            ${
              claim.reasons.length > 0
                ? `<ul class="record-list">${claim.reasons
                    .slice(0, 4)
                    .map((reason) => `<li>${esc(reason)}</li>`)
                    .join("")}</ul>`
                : ""
            }`
                : `<p><strong>Prototype-only:</strong> No structured claim decision is recorded for this county run, so model-backed language should not be used as an outward planning claim.</p>`
            }
            <div class="metrics-grid" style="margin-top: 14px;">
              <div><span class="metric-label">Source manifests</span><strong>${sourceRows.length}</strong></div>
              <div><span class="metric-label">Validation checks</span><strong>${esc(validationSummaryText)}</strong></div>
              <div><span class="metric-label">Export readiness</span><strong>${exportProof.exportReady ? "Ready with caveats" : "Hold"}</strong></div>
            </div>
            <p class="meta" style="margin-top: 14px;">${esc(exportProof.sourceContext)}</p>
            <p class="meta" style="margin-top: 8px;">${esc(exportProof.exportReadiness)}</p>
            <p class="meta" style="margin-top: 8px;">${esc(exportProof.stalePacketLanguage)}</p>
            ${
              validationRows.length > 0
                ? `<ul class="record-list" style="margin-top: 14px;">${validationRows
                    .map(
                      (result) =>
                        `<li><strong>${esc(result.metricLabel)}</strong><p>${esc(
                          formatModelingValidationStatusLabel(result.status)
                        )} • ${esc(result.detail)}</p></li>`
                    )
                    .join("")}</ul>`
                : `<p class="empty">No validation checks recorded.</p>`
            }
            ${
              sourceRows.length > 0
                ? `<p class="meta" style="margin-top: 14px;">Sources: ${esc(
                    sourceRows
                      .map((source) => source.sourceLabel)
                      .filter(Boolean)
                      .join("; ")
                  )}</p>`
                : `<p class="empty">No source manifests recorded.</p>`
            }
          </article>`;
        })
        .join("")}
    </div>
  </section>`;
}

function dualDemandAgreementMarkup(snapshots: readonly DualDemandAgreementSnapshotV1[]): string {
  if (snapshots.length === 0) return "";
  const format = (value: number | null, percent = false) =>
    value === null
      ? "Not available"
      : percent
        ? new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 }).format(value)
        : new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value);
  return `<section id="dual-demand-agreement">
    <h2 class="section-title">Dual-model agreement evidence</h2>
    <div class="warning-box">
      <strong>Methodological sensitivity, not accuracy</strong>
      <p>${esc(AGREEMENT_METHOD_SENSITIVITY_STATEMENT)} ${esc(AGREEMENT_NO_AVERAGE_STATEMENT)}</p>
    </div>
    ${snapshots.map((snapshot) => `<article class="metric-card">
      <h3>${esc(snapshot.methods.first)} compared with ${esc(snapshot.methods.second)}</h3>
      <p class="meta">Source run ${esc(snapshot.modelRunId)} · ${esc(snapshot.permittedAttributionScale)}-level attribution · evidence-file SHA-256 ${esc(snapshot.artifactSha256)}</p>
      <dl class="facts">
        <div><dt>Links compared</dt><dd>${snapshot.aggregate.linksCompared}</dd></div>
        <div><dt>Meaningful links</dt><dd>${snapshot.aggregate.linksCarryingMeaningfulTraffic}</dd></div>
        <div><dt>Agreement share, meaningful links</dt><dd>${esc(format(snapshot.aggregate.agreeShareMeaningfulLinks, true))}</dd></div>
        <div><dt>Median GEH, meaningful links</dt><dd>${esc(format(snapshot.aggregate.medianGehMeaningfulLinks))}</dd></div>
      </dl>
      ${snapshot.selectedCorridors.length > 0 ? `<table>
        <thead><tr><th>Named corridor</th><th>${esc(snapshot.methods.first)} volume</th><th>${esc(snapshot.methods.second)} volume</th><th>GEH</th><th>Classification</th></tr></thead>
        <tbody>${snapshot.selectedCorridors.map((row) => `<tr><td>${esc(row.corridor)}</td><td>${esc(format(row.firstVolume))}</td><td>${esc(format(row.secondVolume))}</td><td>${esc(format(row.geh))}</td><td>${esc(titleize(row.classification))}</td></tr>`).join("")}</tbody>
      </table>` : `<p class="empty">No named corridors were selected by the planner. Aggregate agreement evidence remains included.</p>`}
      <p class="meta">Assignment profile ${esc(snapshot.assignmentProfileSha256)} · network settings ${esc(snapshot.networkSettingsSha256)} · network state ${esc(snapshot.networkStateSha256)}</p>
      <ul>${snapshot.mandatoryCaveats.map((caveat) => `<li>${esc(caveat)}</li>`).join("")}</ul>
    </article>`).join("")}
  </section>`;
}

function aerialOrthoMarkup(preview: ReportGenerationData["aerialOrthoPreview"]): string {
  if (!preview) return "";
  const { snapshot } = preview;
  const [west, south, east, north] = snapshot.bounds;
  return `<section id="held-orthophoto-evidence">
    <h2 class="section-title">Held orthophoto evidence</h2>
    <figure class="geo-figure">
      <img src="${esc(preview.imageSrc)}" alt="Frozen orthophoto preview from ${esc(snapshot.missionTitle)}" style="display:block;width:100%;height:auto;max-height:620px;object-fit:contain;border-radius:18px;background:#eef2f3" />
      <figcaption><p><strong>${esc(snapshot.missionTitle)}</strong></p><p>${esc(snapshot.caveat)}</p></figcaption>
    </figure>
    <dl class="facts" style="margin-top:16px">
      <div><dt>Mission</dt><dd>${esc(snapshot.missionTitle)}</dd></div>
      <div><dt>Captured</dt><dd>${esc(snapshot.collectedAt ? formatDateTime(snapshot.collectedAt) : "Not recorded")}</dd></div>
      <div><dt>Held</dt><dd>${esc(snapshot.heldAt ? formatDateTime(snapshot.heldAt) : "Not recorded")}</dd></div>
      <div><dt>Frozen into packet</dt><dd>${esc(formatDateTime(snapshot.frozenAt))}</dd></div>
      <div><dt>Resolution</dt><dd>${snapshot.pixelSizeM === null ? "Not recorded" : `${esc(snapshot.pixelSizeM.toLocaleString())} m/pixel`}</dd></div>
      <div><dt>Map placement</dt><dd>${esc(`${west}, ${south}, ${east}, ${north}`)}</dd></div>
      <div><dt>Native CRS</dt><dd>${esc(snapshot.nativeCrs ?? "Not recorded")}</dd></div>
      <div><dt>Source SHA-256</dt><dd style="overflow-wrap:anywhere;font-size:12px">${esc(snapshot.sourceChecksumSha256)}</dd></div>
      <div><dt>Frozen SHA-256</dt><dd style="overflow-wrap:anywhere;font-size:12px">${esc(snapshot.frozenChecksumSha256)}</dd></div>
    </dl>
  </section>`;
}

function scenarioBasisMarkup(data: ReportGenerationData): string {
  if (data.scenarioSetLinks.length === 0) {
    return "";
  }

  return `<section>
    <h2 class="section-title">Scenario basis</h2>
    <p>This packet includes scenario provenance derived from report-linked runs and scenario entries.</p>
    <div class="metrics-stack">
      ${data.scenarioSetLinks
        .map((link) => {
          const matchedEntries = link.matchedEntries
            .map((entry) => {
              const runMeta = [entry.attachedRunTitle, entry.runCreatedAt ? `Run ${formatDateTime(entry.runCreatedAt)}` : null]
                .filter(Boolean)
                .join(" • ");

              return `<li>
                <strong>${esc(entry.label)}</strong>
                <p>${esc(titleize(entry.entryType))} • ${esc(entry.comparisonLabel)}</p>
                ${runMeta ? `<span class="meta">${esc(runMeta)}</span>` : ""}
              </li>`;
            })
            .join("");

          const snapshotMeta = [
            link.scenarioSetUpdatedAt ? `Scenario set updated ${formatDateTime(link.scenarioSetUpdatedAt)}` : null,
            link.latestMatchedEntryUpdatedAt ? `Matched entries updated ${formatDateTime(link.latestMatchedEntryUpdatedAt)}` : null,
            link.sharedSpine?.latestIndicatorSnapshotAt
              ? `Indicators updated ${formatDateTime(link.sharedSpine.latestIndicatorSnapshotAt)}`
              : null,
            link.sharedSpine?.latestComparisonSnapshotUpdatedAt
              ? `Comparisons updated ${formatDateTime(link.sharedSpine.latestComparisonSnapshotUpdatedAt)}`
              : null,
          ]
            .filter(Boolean)
            .join(" • ");

          const sharedSpineMeta = link.sharedSpine
            ? link.sharedSpine.schemaPending
              ? "Shared scenario spine schema pending at generation"
              : `${link.sharedSpine.assumptionSetCount} assumption set${link.sharedSpine.assumptionSetCount === 1 ? "" : "s"} • ${link.sharedSpine.dataPackageCount} data package${link.sharedSpine.dataPackageCount === 1 ? "" : "s"} • ${link.sharedSpine.indicatorSnapshotCount} indicator snapshot${link.sharedSpine.indicatorSnapshotCount === 1 ? "" : "s"} • ${link.sharedSpine.comparisonSnapshotCount} comparison snapshot${link.sharedSpine.comparisonSnapshotCount === 1 ? "" : "s"}`
            : null;

          const comparisonSnapshotsMarkup = (link.comparisonSnapshots ?? []).length > 0
            ? `<ul class="record-list" style="margin-top: 12px;">
                ${(link.comparisonSnapshots ?? [])
                  .slice(0, 3)
                  .map(
                    (snapshot) => {
                      const sourceContext = snapshot.sourceContext;
                      return `<li>
                        <strong>${esc(snapshot.label)}</strong>
                        <p>${esc(titleize(snapshot.status))} • ${sourceContext?.pairingLabel ? esc(sourceContext.pairingLabel) : snapshot.candidateEntryLabel ? `${esc(snapshot.candidateEntryLabel)} vs ${esc(link.baselineLabel ?? "Baseline")}` : "Saved comparison"}</p>
                        <span class="meta">${snapshot.indicatorDeltaCount} indicator delta${snapshot.indicatorDeltaCount === 1 ? "" : "s"}${snapshot.updatedAt ? ` • Updated ${esc(formatDateTime(snapshot.updatedAt))}` : ""}</span>
                        ${sourceContext?.caveatSummary ? `<p class="meta">${esc(sourceContext.caveatSummary)}</p>` : ""}
                        ${sourceContext?.exportReadiness ? `<p class="meta">${esc(sourceContext.exportReadiness)}</p>` : ""}
                      </li>`;
                    }
                  )
                  .join("")}
              </ul>`
            : "";

          return `<article class="metric-card">
            <h3>${esc(link.scenarioSetTitle)}</h3>
            <p>Comparison posture: <strong>${esc(link.comparisonSummary.label)}</strong></p>
            <p>Baseline: <strong>${esc(link.baselineLabel ?? "Not set")}</strong>${
              link.baselineRunTitle ? ` • ${esc(link.baselineRunTitle)}` : ""
            }</p>
            ${snapshotMeta ? `<p class="meta">${esc(snapshotMeta)}</p>` : ""}
            ${sharedSpineMeta ? `<p class="meta">${esc(sharedSpineMeta)}</p>` : ""}
            ${comparisonSnapshotsMarkup}
            <p><a href="/scenarios/${esc(link.scenarioSetId)}">Open scenario set</a></p>
            <ul class="record-list" style="margin-top: 12px;">${matchedEntries}</ul>
          </article>`;
        })
        .join("")}
    </div>
  </section>`;
}

/** Grounding-stats line for one accepted narrative block. */
function acceptedNarrativeStatsLine(narrative: AcceptedSectionNarrative): string {
  return [
    `${narrative.groundedSentenceCount} of ${narrative.totalSentenceCount} draft sentences cited verifiable workspace facts`,
    narrative.operatorEdited ? "operator-edited before acceptance" : null,
    `model ${narrative.model}`,
    narrative.acceptedAt ? `accepted ${formatDateTime(narrative.acceptedAt)}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" • ");
}

/**
 * The rendered form of one operator-accepted AI narrative block: the
 * disclosure label, a VISIBLE staleness notice when the underlying facts
 * moved after acceptance, the token-stripped prose, and the grounding stats.
 */
function acceptedNarrativeMarkup(narrative: AcceptedSectionNarrative): string {
  const paragraphs = narrative.bodyMarkdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${esc(paragraph)}</p>`)
    .join("");

  return `<div class="ai-narrative" style="margin-top: 18px;">
    <p class="meta">${esc(AI_NARRATIVE_ACCEPTED_LABEL)}</p>
    ${
      narrative.stale
        ? `<div class="warning-box"><strong>Underlying data changed since acceptance.</strong><p>${esc(AI_NARRATIVE_STALE_NOTICE)}</p></div>`
        : ""
    }
    ${paragraphs}
    <p class="meta">${esc(acceptedNarrativeStatsLine(narrative))}</p>
  </div>`;
}

/**
 * The provenance/methods entry disclosing every AI-assisted block in the
 * packet with its grounding stats — reviewers see at a glance which sections
 * carry accepted narrative and how grounded each draft was.
 */
function acceptedNarrativeProvenanceMarkup(narratives: AcceptedSectionNarrative[]): string {
  if (narratives.length === 0) {
    return "";
  }

  return `<div style="margin-top: 14px;">
    <strong>AI-assisted narrative blocks</strong>
    <p>${esc(AI_NARRATIVE_ACCEPTED_LABEL)} applies to ${narratives.length} section${narratives.length === 1 ? "" : "s"} in this packet. Each block was drafted against a numbered workspace fact list, validated sentence-by-sentence, and included only after operator acceptance.</p>
    <ul class="record-list">${narratives
      .map(
        (narrative) => `<li>
          <strong>${esc(titleize(narrative.sectionKey))}</strong>
          <p>${esc(acceptedNarrativeStatsLine(narrative))}${narrative.stale ? " • UNDERLYING DATA CHANGED SINCE ACCEPTANCE" : ""}</p>
        </li>`
      )
      .join("")}</ul>
  </div>`;
}

function sectionMarkup(sectionKey: string, data: ReportGenerationData): string {
  const scenarioSpineAggregate = buildScenarioSpineAggregate(data);

  if (sectionKey === "project_overview" || sectionKey === "cover_page") {
    return `<div class="two-col">
      <div>
        <h3>${esc(data.project.name)}</h3>
        <p>${esc(data.project.summary || "No project summary recorded yet.")}</p>
        ${fundingSnapshotMarkup(data.projectFundingSnapshot)}
      </div>
      <dl class="facts">
        <div><dt>Report type</dt><dd>${esc(formatReportTypeLabel(data.report.report_type))}</dd></div>
        <div><dt>Workspace</dt><dd>${esc(data.workspace?.name ?? "Unknown")}</dd></div>
        <div><dt>Generated basis</dt><dd>Project records + linked runs</dd></div>
        <div><dt>Scenario basis</dt><dd>${data.scenarioSetLinks.length > 0 ? `${data.scenarioSetLinks.length} linked set${data.scenarioSetLinks.length === 1 ? "" : "s"}` : "Not linked"}</dd></div>
        <div><dt>Scenario spine</dt><dd>${data.scenarioSetLinks.length > 0 ? (scenarioSpineAggregate.pendingCount > 0 ? `${scenarioSpineAggregate.pendingCount} pending` : `${scenarioSpineAggregate.assumptionSetCount} assumptions • ${scenarioSpineAggregate.dataPackageCount} packages • ${scenarioSpineAggregate.indicatorSnapshotCount} indicators`) : "No scenario spine captured"}</dd></div>
      </dl>
    </div>`;
  }

  if (sectionKey === "status_snapshot" || sectionKey === "executive_summary") {
    return `<div class="metrics-grid">
      <div><span class="metric-label">Project status</span><strong>${esc(titleize(data.project.status))}</strong></div>
      <div><span class="metric-label">Plan type</span><strong>${esc(titleize(data.project.plan_type))}</strong></div>
      <div><span class="metric-label">Delivery phase</span><strong>${esc(titleize(data.project.delivery_phase))}</strong></div>
      <div><span class="metric-label">Linked runs</span><strong>${data.runs.length}</strong></div>
    </div>
    ${data.projectFundingSnapshot ? `<div class="metrics-grid" style="margin-top: 14px;">
      <div><span class="metric-label">Funding posture</span><strong>${esc(data.projectFundingSnapshot.label)}</strong></div>
      <div><span class="metric-label">Committed awards</span><strong>${esc(formatCurrency(data.projectFundingSnapshot.committedFundingAmount))}</strong></div>
      <div><span class="metric-label">Pipeline posture</span><strong>${esc(data.projectFundingSnapshot.pipelineLabel)}</strong></div>
      <div><span class="metric-label">Reimbursement</span><strong>${esc(data.projectFundingSnapshot.reimbursementLabel)}</strong></div>
    </div>` : ""}
    <p>${esc(data.report.summary || data.project.summary || "No executive summary has been authored yet. This packet reflects current structured records and linked run evidence only.")}</p>
    ${engagementHandoffMarkup(data)}`;
  }

  if (sectionKey === PROJECT_GEOGRAPHY_SECTION_KEY) {
    return packetGeographyBodyMarkup(data);
  }

  if (sectionKey === PROJECT_SAFETY_SECTION_KEY) {
    return packetSafetyBodyMarkup(data);
  }




  if (sectionKey === "deliverables") {
    return listMarkup(data.deliverables, "No deliverables are attached yet.");
  }

  if (sectionKey === "risks_issues") {
    return `<div class="two-col">
      <div>
        <h3>Risks</h3>
        ${listMarkup(data.risks, "No project risks recorded.")}
      </div>
      <div>
        <h3>Issues</h3>
        ${listMarkup(data.issues, "No project issues recorded.")}
      </div>
    </div>`;
  }

  if (sectionKey === "decisions_meetings" || sectionKey === "project_records_digest") {
    return `<div class="two-col">
      <div>
        <h3>Decisions</h3>
        ${listMarkup(data.decisions, "No project decisions recorded.")}
      </div>
      <div>
        <h3>Meetings</h3>
        ${listMarkup(data.meetings, "No project meetings recorded.")}
      </div>
    </div>`;
  }

  if (sectionKey === "activity_timeline") {
    return timelineMarkup(data);
  }

  if (sectionKey === "run_summaries" || sectionKey === "analysis_summaries") {
    const citedModelRuns = data.citedModelRuns ?? [];
    const citedCountyRuns = data.citedCountyRuns ?? [];
    const runCards = [
      ...data.runs.map((run) => runMarkup(run)),
      ...citedModelRuns.map((run) => citedModelRunMarkup(run)),
      ...citedCountyRuns.map((run) => citedCountyRunMarkup(run)),
    ];

    return runCards.length > 0
      ? runCards.join("")
      : `<p class="empty">No analysis runs are attached to this report yet.</p>`;
  }

  if (sectionKey === "key_metrics" || sectionKey === "artifacts_context") {
    return data.runs.length > 0
      ? `<div class="metrics-stack">${data.runs
          .map((run) => {
            const metrics = run.metrics ?? {};
            const metricsRows = [
              ["Overall score", scoreValueForPresentation(metrics, "overallScore") === null ? "Withheld" : `${scoreValueForPresentation(metrics, "overallScore")}/100`],
              ["Accessibility", scoreValueForPresentation(metrics, "accessibilityScore") === null ? "Withheld" : `${scoreValueForPresentation(metrics, "accessibilityScore")}/100`],
              ["Safety", scoreValueForPresentation(metrics, "safetyScore") === null ? "Withheld" : `${scoreValueForPresentation(metrics, "safetyScore")}/100`],
              ["Equity", scoreValueForPresentation(metrics, "equityScore") === null ? "Withheld" : `${scoreValueForPresentation(metrics, "equityScore")}/100`],
            ];

            return `<article class="metric-card">
              <h3>${esc(run.title)}</h3>
              <dl class="facts">
                ${metricsRows
                  .map(
                    ([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`
                  )
                  .join("")}
              </dl>
            </article>`;
          })
          .join("")}</div>`
      : `<p class="empty">No linked analysis metrics are available.</p>`;
  }

  if (sectionKey === "methods_assumptions" || sectionKey === "assumptions_provenance" || sectionKey === "appendix_references") {
    const hasEvidence =
      data.runs.length > 0 ||
      data.scenarioSetLinks.length > 0 ||
      data.modelingEvidence.length > 0 ||
      (data.safetyEvidence?.length ?? 0) > 0 ||
      (data.engagement?.counts.totalItems ?? 0) > 0 ||
      Object.values(data.projectRecordsSnapshot).some((entry) => entry.count > 0) ||
      data.stageGateSnapshot.passCount > 0 ||
      data.stageGateSnapshot.holdCount > 0;
    return `<div class="warning-box">
      <strong>Auditability posture</strong>
      <p>${hasEvidence
        ? "This report is a structured packet assembled from current OpenPlan evidence. Reviewers should treat its cited records as evidence-backed output, not freeform narrative copy."
        : "This report has a structured evidence-chain record, but every supported evidence count is zero. It is a draft shell, not evidence-backed or release-ready output."}</p>
      <p>Generated on ${esc(formatDateTime(new Date().toISOString()))}. Project last updated ${esc(formatDateTime(data.project.updated_at))}. Review run-level transparency notes before external release.</p>
      ${data.scenarioSetLinks.length > 0 ? `<p>Scenario basis at generation: ${data.scenarioSetLinks.length} linked set${data.scenarioSetLinks.length === 1 ? "" : "s"} • ${scenarioSpineAggregate.pendingCount > 0 ? `${scenarioSpineAggregate.pendingCount} shared-spine pending` : `${scenarioSpineAggregate.assumptionSetCount} assumption set${scenarioSpineAggregate.assumptionSetCount === 1 ? "" : "s"} • ${scenarioSpineAggregate.dataPackageCount} data package${scenarioSpineAggregate.dataPackageCount === 1 ? "" : "s"} • ${scenarioSpineAggregate.indicatorSnapshotCount} indicator snapshot${scenarioSpineAggregate.indicatorSnapshotCount === 1 ? "" : "s"}`}</p>` : ""}
      ${(scenarioSpineAggregate.latestAssumptionSetUpdatedAt || scenarioSpineAggregate.latestDataPackageUpdatedAt || scenarioSpineAggregate.latestIndicatorSnapshotAt) ? `<p>Latest scenario spine timing: ${scenarioSpineAggregate.latestAssumptionSetUpdatedAt ? `assumptions ${esc(formatDateTime(scenarioSpineAggregate.latestAssumptionSetUpdatedAt))}` : "assumptions unavailable"}${scenarioSpineAggregate.latestDataPackageUpdatedAt ? ` • packages ${esc(formatDateTime(scenarioSpineAggregate.latestDataPackageUpdatedAt))}` : ""}${scenarioSpineAggregate.latestIndicatorSnapshotAt ? ` • indicators ${esc(formatDateTime(scenarioSpineAggregate.latestIndicatorSnapshotAt))}` : ""}</p>` : ""}
      ${acceptedNarrativeProvenanceMarkup(data.acceptedNarratives ?? [])}
    </div>`;
  }

  if (sectionKey === "engagement_summary") {
    return engagementSummaryMarkup(data);
  }

  return `<p class="empty">No renderer is available for section key ${esc(sectionKey)}.</p>`;
}

/**
 * The full engagement-summary section body. Shared verbatim between the
 * project packet (its `engagement_summary` section) and the campaign packet,
 * where the campaign is the report's target rather than an attachment.
 */
function engagementSummaryMarkup(data: EngagementMarkupContext): string {
    if (!data.engagement) {
      return `<p class="empty">No engagement campaign is configured for this report section.</p>`;
    }

    const { campaign, counts } = data.engagement;
    const topCategories = counts.categoryCounts
      .filter((category) => category.categoryId !== null && category.count > 0)
      .slice(0, 4);
    const topSources = [...counts.sourceSummaries]
      .filter((source) => source.count > 0)
      .sort((left, right) => right.count - left.count)
      .slice(0, 4);

    return `<div class="two-col">
      <div>
        <h3>${esc(campaign.title)}</h3>
        <p>${esc(campaign.summary || "No campaign summary recorded yet.")}</p>
        <p><a href="/engagement/${esc(campaign.id)}">Open engagement campaign</a>${
          campaign.share_token ? ` • <a href="/engage/${esc(campaign.share_token)}">Open public engagement page</a>` : ""
        }</p>
        <div class="metrics-grid" style="margin-top: 14px;">
          <div><span class="metric-label">Campaign status</span><strong>${esc(titleize(campaign.status))}</strong></div>
          <div><span class="metric-label">Engagement type</span><strong>${esc(titleize(campaign.engagement_type))}</strong></div>
          <div><span class="metric-label">Total items</span><strong>${counts.totalItems}</strong></div>
          <div><span class="metric-label">Handoff-ready</span><strong>${counts.moderationQueue.readyForHandoffCount}</strong></div>
        </div>
      </div>
      <div>
        <h3>Moderation and coverage</h3>
        <div class="metrics-grid">
          <div><span class="metric-label">Actionable review</span><strong>${counts.moderationQueue.actionableCount}</strong></div>
          <div><span class="metric-label">Uncategorized</span><strong>${counts.uncategorizedItems}</strong></div>
          <div><span class="metric-label">Geolocated share</span><strong>${Math.round(
            counts.geographyCoverage.geolocatedShare * 100
          )}%</strong></div>
          <div><span class="metric-label">Recent activity</span><strong>${counts.recentActivity.count}</strong></div>
        </div>
        <p>${
          counts.moderationQueue.readyForHandoffCount > 0
            ? esc(
                `${counts.moderationQueue.readyForHandoffCount} approved and categorized items are ready for planning review.`
              )
            : "No items are currently both approved and categorized."
        }</p>
      </div>
    </div>
    ${engagementSynthesisMarkup(data)}
    ${engagementHotspotsMarkup(data)}
    ${engagementRepresentativenessMarkup(data)}
    ${engagementSelfReportedDemographicsMarkup(data)}
    ${engagementJointRepresentativenessMarkup(data)}
    ${engagementHandoffMarkup(data)}
    <div class="two-col" style="margin-top: 18px;">
      <div>
        <h3>Top categories</h3>
        ${
          topCategories.length > 0
            ? `<ul class="record-list">${topCategories
                .map(
                  (category) => `<li>
                    <strong>${esc(category.label)}</strong>
                    <p>${category.description ? esc(category.description) : "No description recorded."}</p>
                    <span class="meta">${category.count} items • ${category.flaggedCount} flagged • ${category.pendingCount} pending</span>
                  </li>`
                )
                .join("")}</ul>`
            : `<p class="empty">No categorized engagement items are attached yet.</p>`
        }
      </div>
      <div>
        <h3>Source mix</h3>
        ${
          topSources.length > 0
            ? `<ul class="record-list">${topSources
                .map(
                  (source) => `<li>
                    <strong>${esc(titleize(source.sourceType))}</strong>
                    <span class="meta">${source.count} items • ${source.geolocatedCount} geolocated • ${source.flaggedCount} flagged</span>
                  </li>`
                )
                .join("")}</ul>`
            : `<p class="empty">No engagement items are attached yet.</p>`
        }
      </div>
    </div>`;
}

/** The one report stylesheet, shared by the project and campaign builders so
 * both packet families stay visually coherent. */
const REPORT_DOCUMENT_STYLES = `
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f3f0e8; color: #13222b; font-family: Georgia, "Times New Roman", serif; }
      main { max-width: 1040px; margin: 0 auto; padding: 40px 24px 80px; }
      .hero { border: 1px solid rgba(19, 34, 43, 0.12); border-radius: 28px; padding: 32px; background: linear-gradient(180deg, #fefcf7, #f5efe3); box-shadow: 0 30px 70px rgba(19, 34, 43, 0.08); }
      .eyebrow { font: 600 11px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: #965c2a; }
      h1, h2, h3 { margin: 0; }
      h1 { margin-top: 12px; font-size: 42px; line-height: 1.05; }
      .hero p { max-width: 760px; font-size: 17px; line-height: 1.6; }
      section { margin-top: 24px; border: 1px solid rgba(19, 34, 43, 0.12); border-radius: 24px; padding: 24px; background: rgba(255, 255, 255, 0.8); }
      .section-title { margin-bottom: 16px; font-size: 24px; }
      .two-col { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .facts, .metrics-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
      .facts div, .metrics-grid div, .transparency-item, .metric-card { border: 1px solid rgba(19, 34, 43, 0.1); border-radius: 18px; padding: 14px; background: #fffdf8; }
      dt, .metric-label, .meta { display: block; font: 600 11px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #6d7479; }
      dd, strong { margin: 6px 0 0; font-size: 18px; }
      .record-list, .timeline { margin: 0; padding-left: 20px; display: grid; gap: 12px; }
      .record-list li, .timeline li { padding-left: 4px; }
      .run-card { border: 1px solid rgba(19, 34, 43, 0.12); border-radius: 22px; padding: 18px; background: #fffdf8; }
      .run-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
      .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 10px; font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; }
      .pill-pass { background: #d8f3df; color: #15653a; }
      .pill-hold { background: #fde2d2; color: #9a3412; }
      .warning-box { border-radius: 18px; padding: 14px 16px; background: #fff3df; border: 1px solid rgba(150, 92, 42, 0.2); }
      .transparency-grid, .metrics-stack { display: grid; gap: 12px; margin-top: 14px; }
      .empty { color: #6d7479; font-style: italic; }
      .geo-figure { margin: 0; }
      .geo-svg { display: block; width: 100%; height: auto; border-radius: 18px; }
      .geo-plate { fill: #fbf7ee; stroke: rgba(19, 34, 43, 0.16); stroke-width: 1; }
      .geo-area { fill: rgba(21, 101, 58, 0.14); stroke: #15653a; stroke-width: 2; stroke-linejoin: round; }
      .geo-extent-box { fill: none; stroke: #15653a; stroke-width: 2; stroke-dasharray: 9 7; stroke-linejoin: round; }
      .geo-corridor-halo { fill: none; stroke: #fbf7ee; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
      .geo-corridor { fill: none; stroke: #9a3412; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
      .geo-marker-halo { fill: #fbf7ee; stroke: #13222b; stroke-width: 1.5; }
      .geo-marker { fill: #13222b; }
      .geo-badge-disc { fill: #9a3412; stroke: #fbf7ee; stroke-width: 1.5; }
      .geo-badge-text { fill: #fffdf8; font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; text-anchor: middle; }
      .geo-chrome-plate { fill: rgba(251, 247, 238, 0.88); stroke: rgba(19, 34, 43, 0.14); stroke-width: 1; }
      .geo-chrome-text { fill: #13222b; font: 600 11px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.08em; }
      .geo-north-arrow { fill: #13222b; }
      .geo-scale-line { stroke: #13222b; stroke-width: 2; }
      .geo-figure figcaption { margin-top: 12px; font-size: 14px; line-height: 1.55; color: #3b4952; }
      .geo-figure figcaption p { margin: 6px 0 0; }
      @media (max-width: 700px) { main { padding: 20px 14px 56px; } h1 { font-size: 34px; } }`;

export function buildReportHtml(data: ReportGenerationData): string {
  const enabledSections = data.sections
    .filter((section) => section.enabled)
    .sort((left, right) => left.sort_order - right.sort_order);
  const acceptedNarrativeBySection = new Map(
    (data.acceptedNarratives ?? []).map((narrative) => [
      narrative.sectionKey,
      acceptedNarrativeMarkup(narrative),
    ])
  );
  const evidenceChainSummary = buildEvidenceChainSummary({
    linkedRunCount: data.runs.length,
    scenarioSetLinks: data.scenarioSetLinks,
    projectRecordsSnapshot: data.projectRecordsSnapshot,
    engagementCampaignCurrent: data.engagement
      ? {
          status: data.engagement.campaign.status,
        }
      : null,
    engagementItemCount: data.engagement?.counts.totalItems ?? 0,
    engagementReadyForHandoffCount:
      data.engagement?.counts.moderationQueue.readyForHandoffCount ?? 0,
    stageGateSnapshot: data.stageGateSnapshot,
    modelingEvidenceCount: data.modelingEvidence.length,
    modelingEvidenceClaimStatuses: data.modelingEvidence
      .map((item) => item.evidence?.claimDecision?.claimStatus ?? null)
      .filter((status): status is NonNullable<typeof status> => Boolean(status)),
    safetyAcquisitionCount: data.safetyEvidence?.length ?? 0,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(data.report.title)}</title>
    <style>${REPORT_DOCUMENT_STYLES}
    </style>
  </head>
  <body>
    <main>
      <header class="hero">
        <span class="eyebrow">OpenPlan Reports</span>
        <h1>${esc(data.report.title)}</h1>
        <p>${esc(data.report.summary || "Structured report packet with explicit provenance and source transparency.")}</p>
        <div class="facts" style="margin-top: 18px;">
          <div><dt>Project</dt><dd>${esc(data.project.name)}</dd></div>
          <div><dt>Report Type</dt><dd>${esc(formatReportTypeLabel(data.report.report_type))}</dd></div>
          <div><dt>Created</dt><dd>${esc(formatDateTime(data.report.created_at))}</dd></div>
          <div><dt>Linked Runs</dt><dd>${data.runs.length}</dd></div>
        </div>
        ${estimatedProjectCostMarkup(data.project)}
      </header>
      ${projectGeographyMarkup(
        data,
        data.sections.some((section) => section.section_key === PROJECT_GEOGRAPHY_SECTION_KEY)
      )}
      ${evidenceChainMarkup(evidenceChainSummary)}
      ${jurisdictionReadinessMarkup(data.jurisdictionReadiness)}
      ${modelingEvidenceMarkup(data.modelingEvidence)}
      ${reportEvidenceDescriptorMarkup(data)}
      ${dualDemandAgreementMarkup(data.dualDemandAgreementSnapshotsV1 ?? [])}
      ${aerialOrthoMarkup(data.aerialOrthoPreview)}
      ${stageGateProvenanceMarkup(data)}
      ${projectRecordsProvenanceMarkup(data)}
      ${scenarioBasisMarkup(data)}
      ${enabledSections
        .map(
          (section) => `<section id="${esc(section.section_key)}">
            <h2 class="section-title">${esc(section.title)}</h2>
            ${sectionMarkup(section.section_key, data)}
            ${acceptedNarrativeBySection.get(section.section_key) ?? ""}
          </section>`
        )
        .join("")}
    </main>
  </body>
</html>`;
}

/**
 * Section keys whose content lives on a project record, mapped to the subject
 * named in the disclosure. A campaign packet renders these as disclosed
 * not-applicable blocks; the generate route records the same keys in artifact
 * metadata so the record can answer "why is this section a notice".
 */
const CAMPAIGN_PROJECT_SCOPED_SECTION_SUBJECTS: Record<string, string> = {
  // A campaign has no project row and therefore no study area, no corridors and
  // no site point. Drawing the campaign's own comment pins here would answer a
  // different question than the one the section asks.
  [PROJECT_GEOGRAPHY_SECTION_KEY]: "A project's study area, corridors and map point",
  [PROJECT_SAFETY_SECTION_KEY]:
    "Reported collisions attached to this project, with the caveats that qualify them",
  deliverables: "Deliverables",
  risks_issues: "Project risks and issues",
  decisions_meetings: "Project decisions and meetings",
  project_records_digest: "Project decisions and meetings",
  activity_timeline: "Project activity records",
};

export const CAMPAIGN_NOT_APPLICABLE_SECTION_KEYS: ReadonlySet<string> = new Set(
  Object.keys(CAMPAIGN_PROJECT_SCOPED_SECTION_SUBJECTS)
);

/**
 * A disclosed gap for a campaign packet: project-scoped content that a
 * campaign-targeted report genuinely cannot carry is stated as not applicable
 * — never a fabricated stand-in, never a silent omission, never a 500.
 */
function campaignNotApplicableMarkup(subject: string): string {
  return `<div class="warning-box">
      <strong>Not applicable to a campaign-scoped report</strong>
      <p>${esc(subject)} live on a project record. This packet targets an engagement campaign directly and has no linked project, so this section is disclosed as empty rather than filled with placeholder content.</p>
    </div>`;
}

function campaignSectionMarkup(sectionKey: string, data: CampaignReportGenerationData): string {
  const { campaign, counts } = data.engagement;
  const citedModelRuns = data.citedModelRuns ?? [];
  const citedCountyRuns = data.citedCountyRuns ?? [];

  if (sectionKey === "project_overview" || sectionKey === "cover_page") {
    return `<div class="two-col">
      <div>
        <h3>${esc(campaign.title)}</h3>
        <p>${esc(campaign.summary || "No campaign summary recorded yet.")}</p>
        <p class="meta">This packet targets the engagement campaign directly; no project is attached.</p>
      </div>
      <dl class="facts">
        <div><dt>Report type</dt><dd>${esc(formatReportTypeLabel(data.report.report_type))}</dd></div>
        <div><dt>Workspace</dt><dd>${esc(data.workspace?.name ?? "Unknown")}</dd></div>
        <div><dt>Campaign status</dt><dd>${esc(titleize(campaign.status))}</dd></div>
        <div><dt>Engagement type</dt><dd>${esc(titleize(campaign.engagement_type))}</dd></div>
        <div><dt>Generated basis</dt><dd>Engagement records + cited runs</dd></div>
      </dl>
    </div>`;
  }

  if (sectionKey === "status_snapshot" || sectionKey === "executive_summary") {
    return `<div class="metrics-grid">
      <div><span class="metric-label">Campaign status</span><strong>${esc(titleize(campaign.status))}</strong></div>
      <div><span class="metric-label">Engagement type</span><strong>${esc(titleize(campaign.engagement_type))}</strong></div>
      <div><span class="metric-label">Total items</span><strong>${counts.totalItems}</strong></div>
      <div><span class="metric-label">Handoff-ready</span><strong>${counts.moderationQueue.readyForHandoffCount}</strong></div>
    </div>
    <p>${esc(data.report.summary || campaign.summary || "No executive summary has been authored yet. This packet reflects current engagement records and cited run evidence only.")}</p>
    ${engagementHandoffMarkup(data)}`;
  }

  if (sectionKey === "engagement_summary") {
    return engagementSummaryMarkup(data);
  }

  const projectScopedSubject = CAMPAIGN_PROJECT_SCOPED_SECTION_SUBJECTS[sectionKey];
  if (projectScopedSubject) {
    return campaignNotApplicableMarkup(projectScopedSubject);
  }

  if (sectionKey === "run_summaries" || sectionKey === "analysis_summaries") {
    const runCards = [
      ...citedModelRuns.map((run) => citedModelRunMarkup(run)),
      ...citedCountyRuns.map((run) => citedCountyRunMarkup(run)),
    ];

    return runCards.length > 0
      ? runCards.join("")
      : `<p class="empty">No run citations are attached to this report. Legacy Analysis Studio runs are project-scoped and cannot attach to a campaign-scoped report.</p>`;
  }

  if (sectionKey === "key_metrics" || sectionKey === "artifacts_context") {
    const kpiCards = citedModelRuns
      .map((run) => {
        const kpiLine = compactModelRunKpiLine(run.result_summary_json);
        return kpiLine
          ? `<article class="metric-card">
              <h3>${esc(run.run_title)}</h3>
              <p>${esc(kpiLine)}</p>
            </article>`
          : null;
      })
      .filter((card): card is string => Boolean(card));

    return kpiCards.length > 0
      ? `<div class="metrics-stack">${kpiCards.join("")}</div>`
      : `<p class="empty">No cited model-run metrics are available on this campaign-scoped report.</p>`;
  }

  if (sectionKey === "methods_assumptions" || sectionKey === "assumptions_provenance" || sectionKey === "appendix_references") {
    return `<div class="warning-box">
      <strong>Auditability posture</strong>
      <p>This report is a structured packet assembled from a single engagement campaign's current OpenPlan records and cited run evidence. Reviewers should treat it as evidence-backed output, not freeform narrative copy.</p>
      <p>Generated on ${esc(formatDateTime(new Date().toISOString()))}. Campaign last updated ${esc(formatDateTime(campaign.updated_at))}. Review the moderation and synthesis caveats before external release.</p>
    </div>`;
  }

  return `<p class="empty">No renderer is available for section key ${esc(sectionKey)}.</p>`;
}

/**
 * The packet for a campaign-targeted report. Mirrors `buildReportHtml`'s
 * document shell and styling, but everything it renders is engagement-scoped:
 * campaign records, moderation counts, screening syntheses, and cited typed
 * runs. Sections that require a project render a disclosed not-applicable
 * block via `campaignSectionMarkup`.
 */
export function buildCampaignReportHtml(data: CampaignReportGenerationData): string {
  const enabledSections = data.sections
    .filter((section) => section.enabled)
    .sort((left, right) => left.sort_order - right.sort_order);
  const citedRunCount = (data.citedModelRuns?.length ?? 0) + (data.citedCountyRuns?.length ?? 0);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(data.report.title)}</title>
    <style>${REPORT_DOCUMENT_STYLES}
    </style>
  </head>
  <body>
    <main>
      <header class="hero">
        <span class="eyebrow">OpenPlan Reports</span>
        <h1>${esc(data.report.title)}</h1>
        <p>${esc(data.report.summary || "Structured engagement packet with explicit provenance and source transparency.")}</p>
        <div class="facts" style="margin-top: 18px;">
          <div><dt>Engagement Campaign</dt><dd>${esc(data.engagement.campaign.title)}</dd></div>
          <div><dt>Report Type</dt><dd>${esc(formatReportTypeLabel(data.report.report_type))}</dd></div>
          <div><dt>Created</dt><dd>${esc(formatDateTime(data.report.created_at))}</dd></div>
          <div><dt>Cited Runs</dt><dd>${citedRunCount}</dd></div>
        </div>
      </header>
      ${enabledSections
        .map(
          (section) => `<section id="${esc(section.section_key)}">
            <h2 class="section-title">${esc(section.title)}</h2>
            ${campaignSectionMarkup(section.section_key, data)}
          </section>`
        )
        .join("")}
    </main>
  </body>
</html>`;
}
