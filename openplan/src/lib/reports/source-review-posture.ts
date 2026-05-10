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
};

export type ReportEvidenceSummary = {
  headline: string;
  detail: string;
  blockedGateDetail?: string | null;
} | null;

export type ReportSourceReviewPosture = {
  state: "ready" | "needs-review" | "missing";
  label: string;
  headline: string;
  detail: string;
  changedSourceText: string | null;
};

export function describeReportSourceReviewPosture({
  hasGeneratedArtifact,
  evidenceSummary,
  driftSummary,
}: {
  hasGeneratedArtifact: boolean;
  evidenceSummary?: ReportEvidenceSummary;
  driftSummary?: ReportDriftSummary;
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

  return {
    state: "ready",
    label: "Current / ready",
    headline: "Evidence chain current",
    detail:
      "A structured evidence-chain snapshot is linked and no live source drift is currently visible. Keep normal human review and caveat checks in place before external use.",
    changedSourceText: null,
  };
}
