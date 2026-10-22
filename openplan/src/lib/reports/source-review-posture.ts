export function formatDriftLabelList(labels: string[]) {
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

export type ReportDriftSummary = {
  changedCount: number;
  totalCount: number;
  labels: string[];
  unassessedLabels?: string[];
};

export type ReportEvidenceSummary = {
  headline: string;
  detail: string;
  blockedGateDetail?: string | null;
  hasEvidence?: boolean;
} | null;

export type ReportSourceReviewPosture = {
  state: "ready" | "needs-review" | "missing" | "unassessed";
  label: string;
  headline: string;
  detail: string;
  changedSourceText: string | null;
};

export function describeReportSourceReviewPosture({
  hasGeneratedArtifact,
  evidenceSummary,
  driftSummary,
  guidedComparison,
}: {
  hasGeneratedArtifact: boolean;
  evidenceSummary?: ReportEvidenceSummary;
  driftSummary?: ReportDriftSummary;
  guidedComparison?: { liveEvidenceStatus?: "unassessed"; problem: string | null };
}): ReportSourceReviewPosture {
  const changedCount = driftSummary?.changedCount ?? 0;
  const changedSourceText =
    driftSummary && driftSummary.labels.length > 0
      ? formatDriftLabelList(driftSummary.labels)
      : null;

  if (!hasGeneratedArtifact) {
    return {
      state: "missing",
      label: "Missing evidence",
      headline: "No generated packet yet",
      detail:
        "Generate the first packet before treating this report as release-review evidence. The generation step captures the compact source context that reviewers need.",
      changedSourceText,
    };
  }

  if (!evidenceSummary) {
    return {
      state: "missing",
      label: "Missing evidence",
      headline: "No evidence chain captured",
      detail:
        "This packet does not expose a structured evidence-chain snapshot yet. Regenerate it before citing the packet externally or using it for grant triage.",
      changedSourceText,
    };
  }

  if (evidenceSummary.hasEvidence === false) {
    return {
      state: "missing",
      label: "Empty evidence chain",
      headline: "No evidence is linked yet",
      detail:
        "The packet captured an evidence-chain record, but every supported evidence count is zero. Link project, safety, engagement, scenario, or model evidence before calling it evidence-backed or release-ready.",
      changedSourceText,
    };
  }

  if (guidedComparison?.problem) {
    return {
      state: "needs-review",
      label: "Saved comparison binding is invalid",
      headline: "Selected comparison needs review",
      detail: `${guidedComparison.problem} Review and save the exact comparison again, or clear the selection. Historical artifacts retain their original evidence limits.`,
      changedSourceText,
    };
  }

  if (changedCount > 0) {
    return {
      state: "needs-review",
      label: "Changed source context",
      headline: `${changedCount} source ${changedCount === 1 ? "area needs" : "areas need"} review`,
      detail:
        "The packet still has linked evidence, but live source context has changed since generation. Review the changed source areas and regenerate before relying on this packet outside supervised draft review.",
      changedSourceText,
    };
  }

  // Stored integrity does not establish current worker bytes or custody.
  if (guidedComparison?.liveEvidenceStatus === "unassessed") {
    return {
      state: "unassessed",
      label: "Comparison evidence unassessed",
      headline: "Selected comparison live evidence is unassessed",
      detail:
        "The saved comparison binding is checked. Live artifact bytes and custody remain unassessed on this page. Save and generation verify them before accepting the comparison. Review the scientific caveats before release use.",
      changedSourceText: null,
    };
  }

  if (driftSummary?.unassessedLabels?.length) {
    return { state: "unassessed", label: "Source evidence unassessed",
      headline: "Historical source baselines are incomplete",
      detail: `${formatDriftLabelList(driftSummary.unassessedLabels)} cannot be fully compared with the retained packet. Missing baseline fields do not establish zero, a change or unchanged evidence.`,
      changedSourceText: null };
  }

  return {
    state: "ready",
    label: "Current / ready",
    headline: "Evidence chain current",
    detail:
      "A structured evidence-chain snapshot is linked and no live source drift is currently visible. Keep normal human review and caveat checks in place before external use.",
    changedSourceText: null,
  };
}
