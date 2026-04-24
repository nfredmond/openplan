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
  if (status === "screening_grade") return "Screening-grade";
  return "Prototype-only";
}

export function formatModelingValidationStatusLabel(status: ModelingValidationStatus): string {
  if (status === "pass") return "Pass";
  if (status === "warn") return "Warning";
  return "Fail";
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
  }));
}

export function extractReportModelingEvidenceClaimStatuses(modelingEvidence: ReportModelingEvidence[]) {
  return modelingEvidence
    .map((item) => item.evidence?.claimDecision?.claimStatus ?? null)
    .filter((status): status is ModelingClaimStatus => Boolean(status));
}
