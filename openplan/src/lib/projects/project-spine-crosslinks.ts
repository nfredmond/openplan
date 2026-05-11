import {
  ADMIN_PILOT_READINESS_ROUTE,
  FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
  PHASE1_SHARED_SPINE_PROOF_ARTIFACT,
} from "@/lib/operations/pilot-readiness-proof-paths";

export type ProjectSpineCrosslinkReadiness = "ready" | "attention" | "missing";
export type ProjectSpineCrosslinkSourceState = "linked" | "empty" | "schema_pending";
export type ProjectSpineCrosslinkBoardState = "active" | "empty" | "schema_pending";

export type ProjectSpineCrosslinkRowId =
  | "rtp_packets"
  | "scenario_sets"
  | "funding_profile"
  | "engagement_evidence"
  | "analysis_modeling"
  | "aerial_evidence";

export type ProjectSpineProofReference = {
  label: string;
  artifact: string;
  href: string;
  relevance: string;
};

export type ProjectSpineCrosslinkRow = {
  id: ProjectSpineCrosslinkRowId;
  lane: string;
  readiness: ProjectSpineCrosslinkReadiness;
  sourceState: ProjectSpineCrosslinkSourceState;
  sourceLabel: string;
  sourceDetail: string;
  statusLabel: string;
  headline: string;
  detail: string;
  evidence: string;
  nextAction: string;
  caveat: string;
  proofReference: ProjectSpineProofReference;
  href: string;
  actionLabel: string;
};

export type ProjectSpineCrosslinkSummary = {
  boardState: ProjectSpineCrosslinkBoardState;
  stateHeadline: string;
  stateDetail: string;
  stateNextAction: string;
  stateProofReference: ProjectSpineProofReference;
  readyCount: number;
  attentionCount: number;
  missingCount: number;
  emptyCount: number;
  schemaPendingCount: number;
  schemaPendingLanes: string[];
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
  rtpLinks: {
    constrainedCount: number;
    illustrativeCount: number;
    candidateCount: number;
  };
  scenarios: {
    scenarioSetCount: number;
    activeScenarioSetCount: number;
    baselineCount: number;
    readyAlternativeCount: number;
    attachedRunCount: number;
  };
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
  pendingSchema?: Partial<Record<ProjectSpineCrosslinkRowId, boolean>>;
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
  if (row.sourceState === "schema_pending") return -1;
  if (row.readiness === "attention") return 0;
  if (row.readiness === "missing") return 1;
  return 2;
}

const schemaSetupNextAction: Record<ProjectSpineCrosslinkRowId, string> = {
  rtp_packets: "Apply or verify the RTP link/report packet schema, then reload this project before treating portfolio placement as missing.",
  scenario_sets: "Apply the scenario spine tables and reload; then create the baseline-versus-alternative set this project is allowed to cite.",
  funding_profile: "Apply the funding profile, award, opportunity, and invoice tables before deciding whether this project lacks a funding target.",
  engagement_evidence: "Restore report artifact evidence-chain reads, then confirm which moderated engagement excerpts belong in the packet trail.",
  analysis_modeling: "Restore run/report artifact reads, then bind the usable model run or comparison-backed packet to this project.",
  aerial_evidence: "Apply the aerial mission and evidence package tables, then attach only material aerial context to the project spine.",
};

const proofHref = ADMIN_PILOT_READINESS_ROUTE;

const rowProofReferences: Record<ProjectSpineCrosslinkRowId, ProjectSpineProofReference> = {
  rtp_packets: {
    label: "RTP/report workflow smoke",
    artifact: "docs/ops/2026-05-01-openplan-local-rtp-release-review-smoke.md",
    href: proofHref,
    relevance:
      "Use as the operator checklist for packet creation, artifact generation, and release-review navigation; rerun for this project before external reuse.",
  },
  scenario_sets: {
    label: "Analysis/report linkage smoke",
    artifact: "docs/ops/2026-05-01-openplan-local-analysis-report-linkage-smoke.md",
    href: proofHref,
    relevance:
      "Shows scenario attachment and source-context traceability in the proof packet; it is not a validated forecasting claim.",
  },
  funding_profile: {
    label: "Grants/funding workflow smoke",
    artifact: "docs/ops/2026-05-01-openplan-local-grants-flow-smoke.md",
    href: proofHref,
    relevance:
      "Use as the funding-need, award, reimbursement, and closeout proof map; confirm source documents for this project before citing.",
  },
  engagement_evidence: {
    label: "Engagement handoff smoke",
    artifact: "docs/ops/2026-05-01-openplan-local-engagement-report-handoff-smoke.md",
    href: proofHref,
    relevance:
      "Use as the moderated-intake and report-handoff proof path; raw intake still needs human review and agency response context.",
  },
  analysis_modeling: {
    label: "Modeling caveat gate proof",
    artifact: "docs/ops/2026-05-08-openplan-modeling-caveat-kpi-sql-gate-proof.md",
    href: proofHref,
    relevance:
      "Keeps modeling language source-cited and caveated; project acceptance must stay supervised and non-autonomous.",
  },
  aerial_evidence: {
    label: "Aerial evidence spine smoke",
    artifact: "docs/ops/2026-05-02-openplan-local-aerial-evidence-smoke.md",
    href: proofHref,
    relevance:
      "Use as the mission/package linkage proof map; do not treat aerial output as survey, engineering, or autonomous verification.",
  },
};

const boardProofReferences: Record<ProjectSpineCrosslinkBoardState, ProjectSpineProofReference> = {
  active: {
    label: "Final pilot-readiness checklist",
    artifact: FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
    href: proofHref,
    relevance:
      "Use this operator packet to confirm which proof lanes can be cited and which caveats must travel with them.",
  },
  empty: {
    label: "Phase 1 shared spine proof",
    artifact: PHASE1_SHARED_SPINE_PROOF_ARTIFACT,
    href: proofHref,
    relevance:
      "Use the prior cross-surface proof as the setup checklist; this empty project still needs its own scoped acceptance rerun.",
  },
  schema_pending: {
    label: "Migration inventory preflight proof",
    artifact: "docs/ops/2026-05-10-openplan-migration-inventory-preflight-proof.md",
    href: proofHref,
    relevance:
      "Use this migration/source-read proof before deciding whether a lane is genuinely missing or only unavailable.",
  },
};

function withSourceState(
  row: Omit<ProjectSpineCrosslinkRow, "sourceState" | "sourceLabel" | "sourceDetail">,
  pendingSchema: Partial<Record<ProjectSpineCrosslinkRowId, boolean>>
): ProjectSpineCrosslinkRow {
  if (pendingSchema[row.id]) {
    return {
      ...row,
      readiness: "attention",
      sourceState: "schema_pending",
      sourceLabel: "Schema setup",
      sourceDetail: "This source table or evidence read is unavailable in the current environment.",
      statusLabel: "Schema setup pending",
      headline: `${row.lane} is waiting on schema setup before records can be trusted.`,
      evidence:
        "OpenPlan did not treat this as missing evidence; the lane is unavailable until the schema or source read is restored.",
      nextAction: schemaSetupNextAction[row.id],
      caveat:
        "Do not cite this lane as empty or complete until the migration/read path is available and an operator reloads the project spine.",
    };
  }

  const isEmpty = row.readiness === "missing";

  return {
    ...row,
    sourceState: isEmpty ? "empty" : "linked",
    sourceLabel: isEmpty ? "No evidence yet" : "Evidence visible",
    sourceDetail: isEmpty
      ? "No linked record was found; use the next action as the setup step."
      : "At least one source signal is visible; review caveats before reuse.",
  };
}

function buildBoardState(rows: ProjectSpineCrosslinkRow[]): Pick<
  ProjectSpineCrosslinkSummary,
  "boardState" | "stateHeadline" | "stateDetail" | "stateNextAction" | "stateProofReference" | "schemaPendingLanes"
> {
  const schemaPendingLanes = rows
    .filter((row) => row.sourceState === "schema_pending")
    .map((row) => row.lane);

  if (schemaPendingLanes.length > 0) {
    return {
      boardState: "schema_pending",
      stateHeadline: "Some spine lanes are waiting on schema setup",
      stateDetail: `${schemaPendingLanes.join(", ")} ${schemaPendingLanes.length === 1 ? "is" : "are"} unavailable right now, so the board is showing setup actions instead of pretending those lanes are empty.`,
      stateNextAction: "Apply or verify the missing migration/read path, reload the project, then decide which evidence is genuinely absent.",
      stateProofReference: boardProofReferences.schema_pending,
      schemaPendingLanes,
    };
  }

  if (rows.every((row) => row.readiness === "missing")) {
    return {
      boardState: "empty",
      stateHeadline: "No downstream outputs are linked yet",
      stateDetail:
        "This is a clean setup queue, not a broken board. Each row names the first operator move needed to turn the project record into reusable packet, funding, scenario, engagement, analysis, or aerial evidence.",
      stateNextAction: rows[0]?.nextAction ?? "Attach the first project-linked output, then reload the spine.",
      stateProofReference: boardProofReferences.empty,
      schemaPendingLanes,
    };
  }

  return {
    boardState: "active",
    stateHeadline: "Crosslink queue is live",
    stateDetail:
      "Visible rows distinguish ready evidence, review items, and setup gaps so downstream packet work stays source-cited and supervised.",
    stateNextAction: "Work the first operator move in the inspector before reusing this project downstream.",
    stateProofReference: boardProofReferences.active,
    schemaPendingLanes,
  };
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

  const scenarioReadiness: ProjectSpineCrosslinkReadiness =
    input.scenarios.scenarioSetCount === 0
      ? "missing"
      : input.scenarios.baselineCount === 0 || input.scenarios.readyAlternativeCount === 0
        ? "attention"
        : "ready";

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

  const pendingSchema = input.pendingSchema ?? {};

  const baseRows: Array<Omit<ProjectSpineCrosslinkRow, "sourceState" | "sourceLabel" | "sourceDetail">> = [
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
            ? "Project-linked report packets are visible from this project spine."
            : input.linkedRtpCycleCount > 0
              ? "RTP placement exists, but no project-linked report packet is visible yet."
              : "Create or link the first RTP cycle and packet before board-ready reuse.",
      detail: `${pluralize(input.linkedRtpCycleCount, "RTP cycle")} · ${pluralize(input.reportRecordCount, "project report")} · roles ${input.rtpLinks.constrainedCount} constrained / ${input.rtpLinks.illustrativeCount} illustrative / ${input.rtpLinks.candidateCount} candidate`,
      evidence:
        input.comparisonBackedReportCount > 0
          ? `${pluralize(input.comparisonBackedReportCount, "comparison-backed report")} can inform packet review.`
          : input.evidenceBackedReportCount > 0
            ? `${pluralize(input.evidenceBackedReportCount, "evidence-backed packet")} carry source context, but no saved scenario comparison is visible yet.`
            : "No evidence-backed or comparison-backed report packet is visible yet.",
      nextAction:
        input.reportAttentionCount > 0
          ? "Refresh or generate the lead project report before citing it in board, RTP, or public materials."
          : input.reportRecordCount > 0
            ? "Open the lead report and confirm packet freshness, source context, and release-review posture."
            : input.linkedRtpCycleCount > 0
              ? "Create the first project-linked RTP packet from the visible RTP cycle anchor."
              : "Attach this project to the right RTP cycle, then create the first packet record.",
      caveat: "RTP links show portfolio placement and report reuse paths; they are not adopted policy or board-ready evidence until the packet trail is current and reviewed.",
      proofReference: rowProofReferences.rtp_packets,
      href: "#project-reporting",
      actionLabel: "Review packet queue",
    },
    {
      id: "scenario_sets",
      lane: "Scenario sets",
      readiness: scenarioReadiness,
      statusLabel:
        scenarioReadiness === "attention"
          ? "Scenario basis incomplete"
          : scenarioReadiness === "ready"
            ? "Scenario basis visible"
            : "No scenario set",
      headline:
        input.scenarios.scenarioSetCount === 0
          ? "No project-linked scenario set is attached yet."
          : scenarioReadiness === "attention"
            ? "Scenario sets exist, but the baseline/ready-alternative comparison basis is still thin."
            : "Project-linked scenario sets include baseline and ready alternative evidence.",
      detail: `${pluralize(input.scenarios.scenarioSetCount, "scenario set")} · ${pluralize(input.scenarios.activeScenarioSetCount, "active")} · ${pluralize(input.scenarios.baselineCount, "baseline")} · ${pluralize(input.scenarios.readyAlternativeCount, "ready alternative")}`,
      evidence:
        input.scenarios.attachedRunCount > 0
          ? `${pluralize(input.scenarios.attachedRunCount, "attached run")} keep scenario evidence traceable into reports.`
          : "No attached model runs are visible on scenario entries yet.",
      nextAction:
        input.scenarios.scenarioSetCount === 0
          ? "Create the scenario set that defines the baseline-versus-alternative question for this project."
          : scenarioReadiness === "attention"
            ? "Add or mark the baseline and at least one alternative as ready before using scenario language downstream."
            : "Review the scenario set, then confirm downstream report packets reference the same comparison basis.",
      caveat: "Scenario evidence is planning-support context only; do not treat it as a validated forecast, legal finding, or autonomous prioritization decision.",
      proofReference: rowProofReferences.scenario_sets,
      href: "/scenarios",
      actionLabel: "Review scenarios",
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
      nextAction:
        !input.funding.hasTargetNeed
          ? "Set the funding need and local match target before using this project in RTP or grant tables."
          : fundingReadiness === "attention"
            ? "Resolve the funding gap, award risk, or reimbursement follow-through before reusing the packet funding language."
            : "Confirm source documents and award status before moving funding language into external packets.",
      caveat: "Funding evidence shows current source-context posture only; it is not an award commitment, eligibility opinion, or reimbursement approval.",
      proofReference: rowProofReferences.funding_profile,
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
      nextAction:
        engagementReadiness === "missing"
          ? "Create or attach the engagement campaign that should support this project."
          : engagementReadiness === "attention"
            ? "Moderate or approve enough engagement items for clean packet handoff."
            : "Confirm the approved engagement excerpts are attached to the downstream report packet.",
      caveat: "Engagement rows are evidence of intake and moderation status, not a substitute for adopted outreach findings or public agency response records.",
      proofReference: rowProofReferences.engagement_evidence,
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
      nextAction:
        analysisReadiness === "missing"
          ? "Create or attach the model run and scenario comparison this project is allowed to cite."
          : analysisReadiness === "attention"
            ? "Bind the recent run to a scenario entry or comparison-backed report before citing the output."
            : "Open the comparison-backed packet and verify caveats before reusing analysis language.",
      caveat: "Modeling evidence must stay source-cited and supervised; this board does not certify travel behavior forecasts or prioritization outcomes.",
      proofReference: rowProofReferences.analysis_modeling,
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
      nextAction:
        aerialReadiness === "missing"
          ? "Attach a mission or evidence package only if aerial context is material to this project."
          : aerialReadiness === "attention"
            ? "Finish package QA and verification before citing aerial evidence downstream."
            : "Confirm the ready package is linked to the report or grant evidence trail that needs it.",
      caveat: "Aerial evidence supports documentation and measurement review; it is not a stamped survey, final engineering record, or autonomous verification.",
      proofReference: rowProofReferences.aerial_evidence,
      href: "/aerial",
      actionLabel: "Open aerial ops",
    },
  ];
  const rows = baseRows.map((row) => withSourceState(row, pendingSchema));

  const readyCount = rows.filter((row) => row.readiness === "ready").length;
  const attentionCount = rows.filter((row) => row.readiness === "attention").length;
  const missingCount = rows.filter((row) => row.readiness === "missing").length;
  const emptyCount = rows.filter((row) => row.sourceState === "empty").length;
  const schemaPendingCount = rows.filter((row) => row.sourceState === "schema_pending").length;
  const leadAction = [...rows].sort((left, right) => byPriority(left) - byPriority(right))[0] ?? rows[0];
  const boardState = buildBoardState(rows);

  return {
    ...boardState,
    readyCount,
    attentionCount,
    missingCount,
    emptyCount,
    schemaPendingCount,
    leadAction,
    rows,
  };
}
