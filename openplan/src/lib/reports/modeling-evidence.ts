import type {
  ModelingClaimStatus,
  ModelingEvidenceSnapshot,
  ModelingValidationStatus,
} from "@/lib/models/evidence-backbone";

export type ReportModelingEvidence = {
  countyRunId: string;
  runName: string | null;
  geographyLabel: string | null;
  stage: string | null;
  updatedAt: string | null;
  evidence: ModelingEvidenceSnapshot | null;
};

export function formatModelingClaimStatusLabel(status: ModelingClaimStatus): string {
  if (status === "claim_grade_passed") return "Claim-grade passed";
  if (status === "calibrated_to_counts") return "Calibrated to counts";
  if (status === "screening_grade") return "Screening-grade";
  return "Prototype-only";
}

export function formatModelingValidationStatusLabel(status: ModelingValidationStatus): string {
  if (status === "pass") return "Pass";
  if (status === "warn") return "Warning";
  return "Fail";
}

export type ReportModelingEvidenceExportProof = {
  sourceContext: string;
  caveatCarryThrough: string[];
  exportReadiness: string;
  exportReady: boolean;
  stalePacketLanguage: string;
};

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    )
  );
}

export function buildReportModelingEvidenceExportProof(
  item: ReportModelingEvidence
): ReportModelingEvidenceExportProof {
  const evidence = item.evidence;
  const claim = evidence?.claimDecision ?? null;
  const sourceCount = evidence?.sourceManifests.length ?? 0;
  const validationCount = evidence ? describeValidationCheckCount(item) : 0;
  const statusLabel = claim ? formatModelingClaimStatusLabel(claim.claimStatus) : "No claim decision";
  const runLabel = firstNonEmpty([item.geographyLabel, item.runName, item.countyRunId]) ?? "county model run";
  const caveatCarryThrough = uniqueNonEmpty([
    "Planning analysis and evidence triage only; not a validated behavioral forecast or certified model calibration.",
    evidence?.reportLanguage,
    claim?.statusReason,
    ...(claim?.reasons ?? []),
    ...(claim?.validationSummary.missingRequiredMetricKeys.map((key) => `Missing required validation metric: ${key}`) ?? []),
    sourceCount === 0 ? "No source manifests were attached to this modeling evidence snapshot." : null,
    validationCount === 0 ? "No validation checks were attached to this modeling evidence snapshot." : null,
  ]).slice(0, 8);

  const hasMinimumSourceContext = sourceCount > 0 && validationCount > 0 && Boolean(claim);
  const exportReady = hasMinimumSourceContext && claim?.claimStatus !== "prototype_only";
  const exportReadiness = exportReady
    ? `${statusLabel} evidence is ready for supervised draft packet citation within the recorded source and validation limits; do not describe it as a validated behavioral forecast or certified calibration.`
    : `Export hold: ${runLabel} needs a claim decision, source manifests, and validation checks before model-backed report language is used.`;
  const stalePacketLanguage = item.updatedAt
    ? `Modeling evidence snapshot updated ${item.updatedAt}; regenerate the packet if county-run evidence, source manifests, validation checks, or comparison snapshots changed afterward.`
    : "Modeling evidence timestamp is missing; treat any exported packet as stale until the county-run evidence is refreshed.";

  return {
    sourceContext: `${runLabel} carries ${sourceCount} source manifest${sourceCount === 1 ? "" : "s"} and ${validationCount} validation check${validationCount === 1 ? "" : "s"} into this report artifact. No raw behavioral-onramp KPI rows are read by export metadata helpers.`,
    caveatCarryThrough,
    exportReadiness,
    exportReady,
    stalePacketLanguage,
  };
}

export function summarizeReportModelingEvidenceForMetadata(modelingEvidence: ReportModelingEvidence[]) {
  return modelingEvidence.map((item) => ({
    countyRunId: item.countyRunId,
    runName: item.runName,
    geographyLabel: item.geographyLabel,
    stage: item.stage,
    updatedAt: item.updatedAt,
    claimStatus: item.evidence?.claimDecision?.claimStatus ?? null,
    statusReason: item.evidence?.claimDecision?.statusReason ?? null,
    reportLanguage: item.evidence?.reportLanguage ?? null,
    sourceManifestCount: item.evidence?.sourceManifests.length ?? 0,
    validationResultCount: item.evidence?.validationResults.length ?? 0,
    validationSummary: item.evidence?.claimDecision?.validationSummary ?? null,
    exportProof: buildReportModelingEvidenceExportProof(item),
  }));
}

export function extractReportModelingEvidenceClaimStatuses(modelingEvidence: ReportModelingEvidence[]) {
  return modelingEvidence
    .map((item) => item.evidence?.claimDecision?.claimStatus ?? null)
    .filter((status): status is ModelingClaimStatus => Boolean(status));
}

export type PlannerReadableModelingEvidenceSummary = {
  label: string;
  tone: "success" | "warning" | "neutral";
  headline: string;
  plannerReadout: string;
  caveats: string[];
};

const MODELING_CLAIM_STATUS_RANK: Record<ModelingClaimStatus, number> = {
  prototype_only: 0,
  screening_grade: 1,
  // Calibrated is stronger than uncalibrated screening; a county-lane
  // claim_grade_passed (full validation-threshold pass) still ranks highest.
  calibrated_to_counts: 2,
  claim_grade_passed: 3,
};

function strongestClaimStatus(statuses: ModelingClaimStatus[]): ModelingClaimStatus | null {
  return statuses.reduce<ModelingClaimStatus | null>((strongest, status) => {
    if (!strongest) return status;
    return MODELING_CLAIM_STATUS_RANK[status] > MODELING_CLAIM_STATUS_RANK[strongest] ? status : strongest;
  }, null);
}

function describeValidationCheckCount(item: ReportModelingEvidence): number {
  const summary = item.evidence?.claimDecision?.validationSummary;
  if (!summary) return item.evidence?.validationResults.length ?? 0;
  return summary.passed + summary.warned + summary.failed + summary.missingRequiredMetricKeys.length;
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

export function buildPlannerReadableModelingEvidenceSummary(
  modelingEvidence: ReportModelingEvidence[]
): PlannerReadableModelingEvidenceSummary {
  if (modelingEvidence.length === 0) {
    return {
      label: "No linked modeling evidence",
      tone: "neutral",
      headline: "No county-run modeling evidence is attached to this report.",
      plannerReadout: "Treat this packet as narrative/reporting material until a county run and evidence snapshot are linked.",
      caveats: ["Do not describe this report as model-backed until source manifests and validation checks are attached."],
    };
  }

  const statuses = extractReportModelingEvidenceClaimStatuses(modelingEvidence);
  const strongestStatus = strongestClaimStatus(statuses);
  const linkedRunCount = modelingEvidence.length;
  const totalSourceCount = modelingEvidence.reduce((count, item) => count + (item.evidence?.sourceManifests.length ?? 0), 0);
  const totalValidationCheckCount = modelingEvidence.reduce((count, item) => count + describeValidationCheckCount(item), 0);
  const leadingEvidence = modelingEvidence.find((item) => item.evidence?.claimDecision?.claimStatus === strongestStatus) ?? modelingEvidence[0];
  const leadingDecision = leadingEvidence.evidence?.claimDecision ?? null;
  const leadingPlace = firstNonEmpty([leadingEvidence.geographyLabel, leadingEvidence.runName, leadingEvidence.countyRunId]);
  const caveats = Array.from(
    new Set(
      modelingEvidence
        .flatMap((item) => [
          item.evidence?.claimDecision?.statusReason,
          ...(item.evidence?.claimDecision?.reasons ?? []),
          ...(item.evidence?.claimDecision?.validationSummary.missingRequiredMetricKeys.map(
            (key) => `Missing required validation metric: ${key}`
          ) ?? []),
        ])
        .filter((value): value is string => Boolean(value?.trim()))
    )
  );

  const fallbackStatusLabel = strongestStatus ? formatModelingClaimStatusLabel(strongestStatus) : "Evidence linked";
  const statusLabel = leadingDecision ? formatModelingClaimStatusLabel(leadingDecision.claimStatus) : fallbackStatusLabel;
  const label = `${linkedRunCount} linked modeling ${linkedRunCount === 1 ? "run" : "runs"} · strongest: ${fallbackStatusLabel}`;
  const tone =
    strongestStatus === "claim_grade_passed" || strongestStatus === "calibrated_to_counts"
      ? "success"
      : strongestStatus
        ? "warning"
        : "neutral";
  const headline =
    strongestStatus === "claim_grade_passed"
      ? "Modeling evidence is ready for supervised planning citation when cited with its validation table."
      : strongestStatus === "calibrated_to_counts"
        ? "Modeling evidence is calibrated to observed traffic counts and reports held-out validation accuracy; calibrated VMT is separate from the screening CEQA input."
        : strongestStatus === "screening_grade"
          ? "Modeling evidence is suitable for planning context only."
          : strongestStatus === "prototype_only"
            ? "Modeling evidence is prototype-only and should not support outward planning claims."
            : "Modeling evidence is linked, but claim status has not been recorded.";
  const plannerReadout = `${statusLabel}${leadingPlace ? ` for ${leadingPlace}` : ""}; ${totalSourceCount} public ${
    totalSourceCount === 1 ? "source" : "sources"
  } and ${totalValidationCheckCount} validation ${totalValidationCheckCount === 1 ? "check" : "checks"} are attached.`;

  return {
    label,
    tone,
    headline,
    plannerReadout,
    caveats: caveats.length > 0 ? caveats : ["No caveats were recorded with the linked modeling evidence."],
  };
}
