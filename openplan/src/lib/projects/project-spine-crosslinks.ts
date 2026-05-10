export type ProjectSpineCrosslinkReadiness = "ready" | "attention" | "missing";

export type ProjectSpineCrosslinkRow = {
  id: "rtp_packets" | "funding_profile" | "engagement_evidence" | "analysis_modeling" | "aerial_evidence";
  lane: string;
  readiness: ProjectSpineCrosslinkReadiness;
  statusLabel: string;
  headline: string;
  detail: string;
  evidence: string;
  href: string;
  actionLabel: string;
};

export type ProjectSpineCrosslinkSummary = {
  readyCount: number;
  attentionCount: number;
  missingCount: number;
  leadAction: ProjectSpineCrosslinkRow;
  rows: ProjectSpineCrosslinkRow[];
};

export type ProjectSpineCrosslinkInput = {
  projectId: string;
  linkedRtpCycleCount: number;
  reportRecordCount: number;
  reportAttentionCount: number;
  evidenceBackedReportCount: number;
  comparisonBackedReportCount: number;
  funding: {
    hasTargetNeed: boolean;
    label: string;
    reason: string;
    awardCount: number;
    opportunityCount: number;
    reimbursementPacketCount: number;
    unfundedAfterLikelyAmount: number;
    awardRiskCount: number;
  };
  engagement: {
    label: string;
    itemCount: number;
    handoffReadyCount: number;
  };
  analysis: {
    recentRunCount: number;
    comparisonBackedReportCount: number;
  };
  aerial: {
    missionCount: number;
    activeMissionCount: number;
    readyPackageCount: number;
    verificationReadiness: "none" | "pending" | "partial" | "ready";
  };
};

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatMoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function byPriority(row: ProjectSpineCrosslinkRow): number {
  if (row.readiness === "attention") return 0;
  if (row.readiness === "missing") return 1;
  return 2;
}

export function buildProjectSpineCrosslinkSummary(
  input: ProjectSpineCrosslinkInput
): ProjectSpineCrosslinkSummary {
  const rtpReadiness: ProjectSpineCrosslinkReadiness =
    input.reportAttentionCount > 0
      ? "attention"
      : input.reportRecordCount > 0 || input.linkedRtpCycleCount > 0
        ? "ready"
        : "missing";

  const fundingReadiness: ProjectSpineCrosslinkReadiness = !input.funding.hasTargetNeed
    ? "missing"
    : input.funding.unfundedAfterLikelyAmount > 0 || input.funding.awardRiskCount > 0
      ? "attention"
      : "ready";

  const engagementReadiness: ProjectSpineCrosslinkReadiness =
    input.engagement.itemCount === 0
      ? "missing"
      : input.engagement.handoffReadyCount < input.engagement.itemCount
        ? "attention"
        : "ready";

  const analysisReadiness: ProjectSpineCrosslinkReadiness =
    input.analysis.comparisonBackedReportCount > 0
      ? "ready"
      : input.analysis.recentRunCount > 0
        ? "attention"
        : "missing";

  const aerialReadiness: ProjectSpineCrosslinkReadiness =
    input.aerial.missionCount === 0
      ? "missing"
      : input.aerial.readyPackageCount > 0 && ["partial", "ready"].includes(input.aerial.verificationReadiness)
        ? "ready"
        : "attention";

  const rows: ProjectSpineCrosslinkRow[] = [
    {
      id: "rtp_packets",
      lane: "RTP / report packets",
      readiness: rtpReadiness,
      statusLabel:
        rtpReadiness === "attention"
          ? "Regeneration needed"
          : rtpReadiness === "ready"
            ? "Packet trail visible"
            : "Not linked yet",
      headline:
        input.reportAttentionCount > 0
          ? `${pluralize(input.reportAttentionCount, "packet")} need refresh or generation before reuse.`
          : input.reportRecordCount > 0
            ? "Report packets are visible from this project spine."
            : "Create or link the first packet before board-ready reuse.",
      detail: `${pluralize(input.linkedRtpCycleCount, "RTP cycle")} · ${pluralize(input.reportRecordCount, "report")} · ${pluralize(input.evidenceBackedReportCount, "evidence-backed packet")}`,
      evidence:
        input.comparisonBackedReportCount > 0
          ? `${pluralize(input.comparisonBackedReportCount, "comparison-backed report")} can inform packet review.`
          : "No comparison-backed report packet is visible yet.",
      href: "#project-reporting",
      actionLabel: "Review packet queue",
    },
    {
      id: "funding_profile",
      lane: "Grants / funding profile",
      readiness: fundingReadiness,
      statusLabel:
        fundingReadiness === "attention"
          ? "Funding scan needs review"
          : fundingReadiness === "ready"
            ? input.funding.label
            : "Funding target missing",
      headline: input.funding.hasTargetNeed
        ? input.funding.reason
        : "Add a funding need before treating the project as grant-ready.",
      detail: `${pluralize(input.funding.awardCount, "award")} · ${pluralize(input.funding.opportunityCount, "opportunity", "opportunities")} · ${pluralize(input.funding.reimbursementPacketCount, "reimbursement packet")}`,
      evidence:
        fundingReadiness === "attention"
          ? `${formatMoney(input.funding.unfundedAfterLikelyAmount)} remains after likely funding, with ${pluralize(input.funding.awardRiskCount, "award risk")}.`
          : "Funding posture remains an operator-reviewed scan, not proof of award likelihood.",
      href: `/grants?focusProjectId=${input.projectId}`,
      actionLabel: "Open Grants OS",
    },
    {
      id: "engagement_evidence",
      lane: "Engagement evidence",
      readiness: engagementReadiness,
      statusLabel:
        engagementReadiness === "attention"
          ? "Moderation/handoff pending"
          : engagementReadiness === "ready"
            ? "Handoff evidence ready"
            : "No engagement evidence",
      headline:
        input.engagement.itemCount > 0
          ? `${input.engagement.label} engagement is represented in the latest source context.`
          : "No engagement item has been surfaced for this project yet.",
      detail: `${input.engagement.handoffReadyCount}/${input.engagement.itemCount} items ready for report handoff`,
      evidence: "Use approved/moderated comments for appendices and public-response proof; do not treat raw intake as final findings.",
      href: `/engagement?projectId=${input.projectId}`,
      actionLabel: "Open engagement",
    },
    {
      id: "analysis_modeling",
      lane: "Analysis / modeling",
      readiness: analysisReadiness,
      statusLabel:
        analysisReadiness === "ready"
          ? "Source context linked"
          : analysisReadiness === "attention"
            ? "Runs need packet linkage"
            : "No analysis link",
      headline:
        input.analysis.comparisonBackedReportCount > 0
          ? "Scenario comparison evidence is visible through linked report packets."
          : input.analysis.recentRunCount > 0
            ? "Runs exist, but no comparison-backed packet is visible yet."
            : "Add a model run or scenario comparison before citing analysis outputs.",
      detail: `${pluralize(input.analysis.recentRunCount, "recent run")} · ${pluralize(input.analysis.comparisonBackedReportCount, "comparison-backed packet")}`,
      evidence: "Screening/source-context posture only; no validated behavioral forecast or autonomous model decision is implied.",
      href: "/models",
      actionLabel: "Open models",
    },
    {
      id: "aerial_evidence",
      lane: "Aerial evidence",
      readiness: aerialReadiness,
      statusLabel:
        aerialReadiness === "ready"
          ? "Attachment path visible"
          : aerialReadiness === "attention"
            ? "Evidence QA needed"
            : "No aerial evidence",
      headline:
        input.aerial.missionCount > 0
          ? `${pluralize(input.aerial.missionCount, "mission")} tied to this project; ${pluralize(input.aerial.readyPackageCount, "package")} ready/shared.`
          : "No aerial mission or package is attached to this project yet.",
      detail: `${pluralize(input.aerial.activeMissionCount, "active mission")} · verification ${input.aerial.verificationReadiness}`,
      evidence: "Aerial outputs remain operator-assisted evidence; attach source context and human review before grant/report/public use.",
      href: "/aerial",
      actionLabel: "Open aerial ops",
    },
  ];

  const readyCount = rows.filter((row) => row.readiness === "ready").length;
  const attentionCount = rows.filter((row) => row.readiness === "attention").length;
  const missingCount = rows.filter((row) => row.readiness === "missing").length;
  const leadAction = [...rows].sort((left, right) => byPriority(left) - byPriority(right))[0] ?? rows[0];

  return {
    readyCount,
    attentionCount,
    missingCount,
    leadAction,
    rows,
  };
}
