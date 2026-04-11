import {
  findAssistantAction,
  getAssistantActions,
  type AssistantPreview,
  type AssistantResponse,
} from "@/lib/assistant/catalog";
import type {
  AssistantContext,
  ModelAssistantContext,
  PlanAssistantContext,
  ProgramAssistantContext,
  ProjectAssistantContext,
  RtpRegistryAssistantContext,
  RtpAssistantContext,
  ReportAssistantContext,
  RunAssistantContext,
  ScenarioAssistantContext,
  WorkspaceAssistantContext,
} from "@/lib/assistant/context";
import { applyLocalConsoleStateToResponse, type AssistantLocalConsoleState } from "@/lib/assistant/local-console-state";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import {
  resolveRtpPacketWorkPostureFromCounts,
  resolveRtpPacketWorkPostureFromFreshnessLabel,
} from "@/lib/assistant/rtp-packet-posture";
import { buildMetricDeltas } from "@/lib/analysis/compare";
import { getReportPacketFreshness } from "@/lib/reports/catalog";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "$0";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function metricLabel(metrics: Record<string, unknown>, key: string): string {
  const value = asNumber(metrics[key]);
  return value === null ? "N/A" : `${value}`;
}

function buildWorkspacePreview(context: WorkspaceAssistantContext): AssistantPreview {
  const title = context.kind === "analysis_studio" ? "Analysis Studio copilot" : context.workspace.name ?? "Workspace copilot";
  const missingFundingAnchorCount = context.operationsSummary.counts.projectFundingNeedAnchorProjects;
  const fundingSourcingCount = context.operationsSummary.counts.projectFundingSourcingProjects;
  const fundingDecisionCount = context.operationsSummary.counts.projectFundingDecisionProjects;
  const gapProjectCount = context.operationsSummary.counts.projectFundingGapProjects;
  const summary = context.currentRun
    ? `Grounded to ${context.currentRun.title} inside ${context.workspace.name ?? "the current workspace"}. I can brief the run, compare it to baseline, or summarize the surrounding planning context and current queue pressure.`
    : `Grounded to ${context.workspace.name ?? "the current workspace"}. I can summarize recent project and analysis activity, plus the shared workspace command queue${missingFundingAnchorCount > 0 ? `, ${missingFundingAnchorCount} missing funding anchor${missingFundingAnchorCount === 1 ? "" : "s"}` : fundingSourcingCount > 0 ? `, ${fundingSourcingCount} funding lane${fundingSourcingCount === 1 ? " still needs" : "s still need"} sourcing` : fundingDecisionCount > 0 ? `, ${fundingDecisionCount} project funding lane${fundingDecisionCount === 1 ? " still needs" : "s still need"} a pursue decision` : gapProjectCount > 0 ? ` and ${gapProjectCount} visible project funding gap${gapProjectCount === 1 ? "" : "s"}` : ""}, and point you at the next operator move.`;

  const facts = [
    context.recentProject
      ? `Latest project: ${context.recentProject.name} · ${context.recentProject.status} · ${context.recentProject.deliveryPhase}`
      : "No recent project is visible from this workspace snapshot yet.",
    context.currentRun
      ? `Current run: ${context.currentRun.title} · overall ${metricLabel(context.currentRun.metrics, "overallScore")}`
      : context.recentRuns[0]
        ? `Latest run: ${context.recentRuns[0].title} · ${formatDateTime(context.recentRuns[0].createdAt)}`
        : "No recent analysis runs are visible yet.",
    context.operationsSummary.nextCommand
      ? `Command queue: ${context.operationsSummary.nextCommand.title}`
      : "Command queue is currently clear from the workspace snapshot.",
    context.baselineRun
      ? `Baseline attached: ${context.baselineRun.title}`
      : "No baseline run is currently attached.",
  ];

  return {
    kind: context.kind,
    title,
    summary,
    stats: [
      { label: "Workspace", value: context.workspace.name ?? "Current" },
      { label: "Queue", value: `${context.operationsSummary.counts.queueDepth}` },
      {
        label: "Packet pressure",
        value: `${context.operationsSummary.counts.reportRefreshRecommended + context.operationsSummary.counts.reportNoPacket}`,
      },
      {
        label: missingFundingAnchorCount > 0 ? "Missing anchors" : fundingSourcingCount > 0 ? "Needs sourcing" : fundingDecisionCount > 0 ? "Needs decisions" : "Gap projects",
        value: `${missingFundingAnchorCount > 0 ? missingFundingAnchorCount : fundingSourcingCount > 0 ? fundingSourcingCount : fundingDecisionCount > 0 ? fundingDecisionCount : gapProjectCount}`,
      },
    ],
    facts,
    operatorCue: context.operationsSummary.nextCommand
      ? {
          label: "Current runtime cue",
          title: context.operationsSummary.nextCommand.title,
          detail: context.operationsSummary.nextCommand.detail,
        }
      : {
          label: "Current runtime cue",
          title: "Workspace command queue is clear",
          detail: context.operationsSummary.detail,
        },
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildProjectPreview(context: ProjectAssistantContext): AssistantPreview {
  const openRisks = context.counts.risks;
  const openIssues = context.counts.issues;
  const blockedGate = context.stageGateSummary.blockedGate?.name ?? "No hold gate";
  const gapAmount = context.fundingSummary.gapAmount;
  const needsFundingSourcing = context.fundingSummary.fundingNeedAmount !== null && context.fundingSummary.opportunityCount === 0;

  return {
    kind: context.kind,
    title: context.project.name,
    summary: `Grounded to the full project record: delivery posture, stage-gate signals, funding strategy, linked datasets, and recent run activity are all in scope for this copilot pass.`,
    stats: [
      { label: "Status", value: context.project.status },
      { label: "Open risks", value: `${openRisks}` },
      { label: "Funding", value: `${context.fundingSummary.opportunityCount}` },
      { label: "Blocked gate", value: blockedGate },
    ],
    facts: [
      `${context.counts.deliverables} deliverables, ${context.counts.decisions} decisions, and ${context.counts.meetings} meetings are attached to this project surface.`,
      context.fundingSummary.opportunityCount > 0
        ? `${context.fundingSummary.opportunityCount} funding opportunit${context.fundingSummary.opportunityCount === 1 ? "y is" : "ies are"} linked, with ${context.fundingSummary.closingSoonCount} closing soon and ${context.fundingSummary.pursueCount} marked pursue.${context.fundingSummary.fundingNeedAmount !== null ? ` Target need: ${formatCurrency(context.fundingSummary.fundingNeedAmount)}.` : ""}${gapAmount !== null && gapAmount > 0 ? ` Remaining uncovered after likely dollars: ${formatCurrency(gapAmount)}.` : ""}`
        : needsFundingSourcing
          ? `No funding opportunities are linked yet, but this project already carries a recorded funding need of ${formatCurrency(context.fundingSummary.fundingNeedAmount)}. Funding sourcing should come before gap-closing claims.`
          : "No funding opportunities are linked to this project yet.",
      context.fundingSummary.opportunityCount > 0 && context.fundingSummary.pursueCount === 0 && context.fundingSummary.leadOpportunity
        ? `No opportunity is marked pursue yet. ${context.fundingSummary.leadOpportunity.title} is the lead grant decision to advance next.`
        : null,
      `${context.counts.linkedDatasets} linked datasets are visible, with ${context.counts.overlayReadyDatasets} already usable as analysis overlays.`,
      `${context.counts.recentRuns} recent analysis runs are visible from the same workspace.`,
    ].filter(Boolean) as string[],
    operatorCue: context.stageGateSummary.blockedGate
      ? {
          label: "Current runtime cue",
          title: `Unblock ${context.stageGateSummary.blockedGate.name}`,
          detail: context.stageGateSummary.blockedGate.rationale || "A stage gate is currently on hold and needs evidence or rationale cleanup.",
        }
      : context.fundingSummary.closingSoonCount > 0
        ? {
            label: "Current runtime cue",
            title: `${context.fundingSummary.closingSoonCount} funding deadline${context.fundingSummary.closingSoonCount === 1 ? "" : "s"} need attention`,
            detail: "Near-term funding windows are active on this project, so grant timing should be reviewed before less urgent control cleanup.",
          }
        : needsFundingSourcing
          ? {
              label: "Current runtime cue",
              title: "Source the first funding opportunity",
              detail: "This project already has a grounded funding need but still no linked opportunities, so sourcing candidate programs comes before true gap triage.",
            }
        : gapAmount !== null && gapAmount > 0
          ? {
              label: "Current runtime cue",
              title: `Close ${formatCurrency(gapAmount)} remaining funding gap`,
              detail: "The project still shows uncovered need after current pursued dollars, so funding strategy should be tightened before scope or delivery assumptions drift.",
            }
        : {
            label: "Current runtime cue",
            title: `${openRisks + openIssues} live project control signal${openRisks + openIssues === 1 ? "" : "s"}`,
            detail: `${openRisks} risk${openRisks === 1 ? "" : "s"}, ${openIssues} issue${openIssues === 1 ? "" : "s"}, and ${context.counts.deliverables} deliverable${context.counts.deliverables === 1 ? "" : "s"} remain in the current project control picture.`,
          },
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildRtpRegistryPreview(context: RtpRegistryAssistantContext): AssistantPreview {
  const registryPacketPosture = resolveRtpPacketWorkPostureFromCounts({
    noPacketCount: context.counts.noPacketCount,
    refreshRecommendedCount: context.counts.refreshRecommendedCount,
  });
  const registryPosture =
    registryPacketPosture === "generate"
      ? {
          title: "First packet queue is live",
          detail: `${context.counts.noPacketCount} RTP cycle${context.counts.noPacketCount === 1 ? " still needs" : "s still need"} a first generated packet, so first-generation work outranks refresh or release review right now.`,
          summary: `Grounded to the RTP cycle registry, with first-packet generation currently outranking refresh and release work across the visible cycles.`,
        }
      : registryPacketPosture === "refresh"
        ? {
            title: "Refresh queue is live",
            detail: `${context.counts.refreshRecommendedCount} RTP cycle packet${context.counts.refreshRecommendedCount === 1 ? " needs" : "s need"} refresh, so stale packet regeneration is the main registry posture right now.`,
            summary: `Grounded to the RTP cycle registry, with stale packet refresh currently outranking first-generation and release review work across the visible cycles.`,
          }
        : {
            title: "Board-ready queue is live",
            detail: context.recommendedCycle
              ? `${context.recommendedCycle.title} is the strongest current cycle anchor for board-ready review from the registry.`
              : "The visible RTP packet queue is materially current enough that board-ready review is now the main registry posture.",
            summary: `Grounded to the RTP cycle registry, with board-ready review currently outranking packet generation and refresh work across the visible cycles.`,
          };

  return {
    kind: context.kind,
    title: `${context.workspace.name ?? "Workspace"} RTP registry`,
    summary: registryPosture.summary,
    stats: [
      { label: "Cycles", value: `${context.counts.cycles}` },
      { label: "Public review", value: `${context.counts.publicReviewCycles}` },
      { label: "Packet refresh", value: `${context.counts.refreshRecommendedCount}` },
      { label: "No packet", value: `${context.counts.noPacketCount}` },
    ],
    facts: [
      `${context.counts.draftCycles} draft, ${context.counts.publicReviewCycles} public-review, ${context.counts.adoptedCycles} adopted, and ${context.counts.archivedCycles} archived cycles are currently visible.`,
      context.recommendedCycle
        ? `Recommended cycle anchor: ${context.recommendedCycle.title} (${context.recommendedCycle.packetFreshnessLabel}).`
        : "No RTP cycle is visible yet from this registry snapshot.",
      context.operationsSummary.nextCommand
        ? `Workspace next command: ${context.operationsSummary.nextCommand.title}.`
        : registryPosture.detail,
    ],
    operatorCue: context.operationsSummary.nextCommand
      ? {
          label: "Current runtime cue",
          title: context.operationsSummary.nextCommand.title,
          detail: context.operationsSummary.nextCommand.detail,
        }
      : {
          label: "Current runtime cue",
          title: registryPosture.title,
          detail: registryPosture.detail,
        },
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildRtpPreview(context: RtpAssistantContext): AssistantPreview {
  const cyclePacketWorkPosture = resolveRtpPacketWorkPostureFromCounts({
    linkedReportCount: context.packetSummary.linkedReportCount,
    noPacketCount: context.packetSummary.noPacketCount,
    refreshRecommendedCount: context.packetSummary.refreshRecommendedCount,
  });
  const recommendedPacketDetail =
    context.packetSummary.recommendedReport?.packetFreshness.detail ??
    "No linked RTP packet is available yet, so packet review still needs to be established.";
  const cyclePacketPosture =
    cyclePacketWorkPosture === "generate"
      ? {
          title: "First packet work comes first",
          detail: "This cycle still lacks a usable current packet artifact, so first-generation planning outranks refresh or release review right now.",
          summary: `Grounded to this RTP cycle's readiness, chapter workflow, project portfolio, and first-packet setup posture before release work begins.`,
        }
      : cyclePacketWorkPosture === "refresh"
        ? {
            title: "Refresh work comes first",
            detail: recommendedPacketDetail,
            summary: `Grounded to this RTP cycle's readiness, chapter workflow, project portfolio, and stale packet refresh posture before release review.`,
          }
        : {
            title: "Release review comes first",
            detail: recommendedPacketDetail,
            summary: `Grounded to this RTP cycle's readiness, chapter workflow, project portfolio, and board-ready packet review posture.`,
          };

  return {
    kind: context.kind,
    title: context.rtpCycle.title,
    summary: cyclePacketPosture.summary,
    stats: [
      { label: "Status", value: context.rtpCycle.status },
      { label: "Chapters", value: `${context.counts.chapters}` },
      { label: "Projects", value: `${context.counts.linkedProjects}` },
      { label: "Packets", value: `${context.counts.packetReports}` },
    ],
    facts: [
      context.rtpCycle.summary || "The RTP cycle does not yet carry a strong summary narrative on the record itself.",
      `${context.counts.readyForReviewChapters} chapters are ready for review and ${context.counts.completeChapters} are complete.`,
      context.packetSummary.recommendedReport
        ? `Recommended packet anchor: ${context.packetSummary.recommendedReport.title ?? "board packet"} (${context.packetSummary.recommendedReport.packetFreshness.label}).`
        : "No RTP board packet is linked yet.",
    ],
    operatorCue: context.operationsSummary.nextCommand
      ? {
          label: "Current runtime cue",
          title: context.operationsSummary.nextCommand.title,
          detail: context.operationsSummary.nextCommand.detail,
        }
      : {
          label: "Current runtime cue",
          title: cyclePacketPosture.title,
          detail: cyclePacketPosture.detail,
        },
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildPlanPreview(context: PlanAssistantContext): AssistantPreview {
  return {
    kind: context.kind,
    title: context.plan.title,
    summary: `Grounded to this plan record's readiness, linked evidence posture, and the shared workspace command queue around it.`,
    stats: [
      { label: "Status", value: context.plan.status },
      { label: "Readiness", value: context.readiness.label },
      { label: "Reports", value: `${context.linkageCounts.reports}` },
      { label: "Queue", value: `${context.operationsSummary.counts.queueDepth}` },
    ],
    facts: [
      context.project ? `Primary project: ${context.project.name}` : "No primary project is attached to this plan yet.",
      `${context.linkageCounts.scenarios} scenarios, ${context.linkageCounts.engagementCampaigns} campaigns, and ${context.linkageCounts.reports} reports are visible in the current plan basis.`,
      context.operationsSummary.nextCommand
        ? `Workspace next command: ${context.operationsSummary.nextCommand.title}`
        : "Workspace command queue is currently clear from this snapshot.",
    ],
    operatorCue: context.operationsSummary.nextCommand
      ? {
          label: "Current runtime cue",
          title: context.operationsSummary.nextCommand.title,
          detail: context.operationsSummary.nextCommand.detail,
        }
      : undefined,
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildProgramPreview(context: ProgramAssistantContext): AssistantPreview {
  const gapAmount = context.fundingSummary.gapAmount;
  const needsFundingSourcing = context.fundingSummary.fundingNeedAmount !== null && context.fundingSummary.opportunityCount === 0;

  return {
    kind: context.kind,
    title: context.program.title,
    summary: `Grounded to this program package's readiness, packet posture, linked funding windows, and the shared workspace command queue around it.`,
    stats: [
      { label: "Status", value: context.program.status },
      { label: "Readiness", value: context.readiness.label },
      { label: "Funding", value: `${context.fundingSummary.opportunityCount}` },
      { label: "Queue", value: `${context.operationsSummary.counts.queueDepth}` },
    ],
    facts: [
      context.project ? `Primary project: ${context.project.name}` : "No primary project is attached to this program yet.",
      `${context.linkageCounts.plans} plans, ${context.linkageCounts.engagementCampaigns} campaigns, and ${context.linkageCounts.reports} reports are visible in the current package basis.`,
      context.fundingSummary.opportunityCount > 0
        ? `${context.fundingSummary.opportunityCount} funding opportunit${context.fundingSummary.opportunityCount === 1 ? "y is" : "ies are"} linked, with ${context.fundingSummary.closingSoonCount} closing soon and ${context.fundingSummary.pursueCount} marked pursue.${context.fundingSummary.fundingNeedAmount !== null ? ` Recorded project need: ${formatCurrency(context.fundingSummary.fundingNeedAmount)}.` : ""}${gapAmount !== null && gapAmount > 0 ? ` Remaining uncovered after likely dollars: ${formatCurrency(gapAmount)}.` : ""}`
        : needsFundingSourcing
          ? `No funding opportunities are linked yet, but the linked project already carries a recorded funding need of ${formatCurrency(context.fundingSummary.fundingNeedAmount)}. Funding sourcing should come before gap-closing claims.`
          : "No funding opportunities are linked to this program yet.",
      context.fundingSummary.opportunityCount > 0 && context.fundingSummary.pursueCount === 0 && context.fundingSummary.leadOpportunity
        ? `No package opportunity is marked pursue yet. ${context.fundingSummary.leadOpportunity.title} is the lead grant decision to advance next.`
        : null,
      context.packetSummary.recommendedReport
        ? `Recommended packet anchor: ${context.packetSummary.recommendedReport.title ?? "report packet"} (${context.packetSummary.recommendedReport.packetFreshness.label}).`
        : "No linked report packet is available yet for this program.",
    ].filter(Boolean) as string[],
    operatorCue: context.operationsSummary.nextCommand
      ? {
          label: "Current runtime cue",
          title: context.operationsSummary.nextCommand.title,
          detail: context.operationsSummary.nextCommand.detail,
        }
      : context.packetSummary.recommendedReport
        ? {
            label: "Current runtime cue",
            title: context.packetSummary.recommendedReport.title ?? "Recommended packet anchor",
            detail: context.packetSummary.recommendedReport.packetFreshness.detail,
          }
        : undefined,
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildScenarioPreview(context: ScenarioAssistantContext): AssistantPreview {
  return {
    kind: context.kind,
    title: context.scenarioSet.title,
    summary: `Grounded to the scenario registry, baseline linkage, run-backed comparison board, and report handoff state for this scenario set.`,
    stats: [
      { label: "Status", value: context.scenarioSet.status },
      { label: "Baseline", value: context.baselineEntry ? context.baselineEntry.label : "Missing" },
      { label: "Ready alts", value: `${context.comparisonSummary.readyAlternatives}/${context.comparisonSummary.totalAlternatives}` },
      { label: "Linked reports", value: `${context.linkedReports.length}` },
    ],
    facts: [
      context.scenarioSet.planningQuestion
        ? `Planning question: ${context.scenarioSet.planningQuestion}`
        : "No explicit planning question is captured on this scenario set yet.",
      `${pluralize(context.alternativeCount, "alternative")} registered in the set.`,
      context.comparisonBoard.length > 0
        ? `${pluralize(context.comparisonBoard.length, "comparison card")} currently have distinct baseline-versus-alternative evidence.`
        : "No comparison card is ready yet because baseline or alternative run attachments are still incomplete.",
    ],
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildModelPreview(context: ModelAssistantContext): AssistantPreview {
  return {
    kind: context.kind,
    title: context.model.title,
    summary: `Grounded to the model record, readiness checks, explicit provenance links, launch template hints, and recent execution history.`,
    stats: [
      { label: "Status", value: context.model.status },
      { label: "Checks", value: `${context.readiness.readyCheckCount}/${context.readiness.totalCheckCount}` },
      { label: "Runs", value: `${context.recentModelRuns.length}` },
      { label: "Links", value: `${context.linkageCounts.runs + context.linkageCounts.reports + context.linkageCounts.datasets + context.linkageCounts.plans}` },
    ],
    facts: [
      context.workflow.reason,
      context.readiness.reason,
      context.schemaPending
        ? "Model-run tables are still pending in this database, so recent execution history is temporarily degraded."
        : `${pluralize(context.recentModelRuns.length, "recent model run")} visible from this record.`,
    ],
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildReportPreview(context: ReportAssistantContext): AssistantPreview {
  const packetFreshness = getReportPacketFreshness({
    latestArtifactKind: context.report.latestArtifactKind,
    generatedAt: context.report.generatedAt,
    updatedAt: context.report.updatedAt,
  });
  const packetPosture = resolveRtpPacketWorkPostureFromFreshnessLabel(packetFreshness.label);
  const rtpPacketPreviewPosture =
    packetPosture === "generate"
      ? {
          summary: `Grounded to this RTP-linked packet's first-generation setup, cycle anchor, artifact history, and provenance metadata before board-ready review begins.`,
          cueTitle: "First packet work comes first",
          cueDetail: "This RTP-linked packet still needs its first usable artifact, so first-generation setup outranks refresh and release review right now.",
        }
      : packetPosture === "refresh"
        ? {
            summary: `Grounded to this RTP-linked packet's stale refresh posture, cycle anchor, artifact history, and provenance metadata before release review.`,
            cueTitle: "Refresh work comes first",
            cueDetail: packetFreshness.detail,
          }
        : {
            summary: `Grounded to this RTP-linked packet's board-ready review posture, cycle anchor, artifact history, and provenance metadata.`,
            cueTitle: "Release review comes first",
            cueDetail: packetFreshness.detail,
          };

  return {
    kind: context.kind,
    title: context.report.title,
    summary: context.rtpCycle
      ? rtpPacketPreviewPosture.summary
      : `Grounded to this report packet's composition, linked runs, artifact history, and provenance metadata.`,
    stats: [
      { label: "Status", value: context.report.status },
      { label: "Runs", value: `${context.runs.length}` },
      { label: "Sections", value: `${context.enabledSections}/${context.sectionCount}` },
      { label: context.rtpCycle ? "Packet" : "Artifacts", value: context.rtpCycle ? packetFreshness.label : `${context.artifactCount}` },
    ],
    facts: [
      context.rtpCycle ? `RTP cycle anchor: ${context.rtpCycle.title} · ${context.rtpCycle.status}.` : null,
      context.rtpCycle ? `Lead packet posture: ${packetFreshness.label}. ${packetFreshness.detail}` : null,
      context.project ? `Project anchor: ${context.project.name}` : "No project anchor is visible on this report snapshot.",
      context.latestArtifact
        ? `Latest artifact: ${context.latestArtifact.artifactKind} generated ${formatDateTime(context.latestArtifact.generatedAt)}.`
        : "No artifact has been generated yet.",
      context.engagementCampaign
        ? `Engagement linkage: ${context.engagementCampaign.title} (${context.engagementCampaign.status}).`
        : "No engagement campaign linkage is attached through report sections.",
    ].filter(Boolean) as string[],
    operatorCue: context.rtpCycle
      ? {
          label: "Current runtime cue",
          title: rtpPacketPreviewPosture.cueTitle,
          detail: rtpPacketPreviewPosture.cueDetail,
        }
      : undefined,
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildRunPreview(context: RunAssistantContext): AssistantPreview {
  return {
    kind: context.kind,
    title: context.run.title,
    summary: `Grounded to the active analysis run metrics, summary narrative, and optional baseline comparison.`,
    stats: [
      { label: "Overall", value: metricLabel(context.run.metrics, "overallScore") },
      { label: "Access", value: metricLabel(context.run.metrics, "accessibilityScore") },
      { label: "Safety", value: metricLabel(context.run.metrics, "safetyScore") },
      { label: "Equity", value: metricLabel(context.run.metrics, "equityScore") },
    ],
    facts: [
      context.run.summary || "This run has no stored summary text yet.",
      asString(context.run.metrics.confidence)
        ? `Confidence: ${String(context.run.metrics.confidence)}`
        : "No explicit confidence label is attached to this run.",
      context.baselineRun
        ? `Baseline attached: ${context.baselineRun.title}`
        : "No baseline run is attached right now.",
    ],
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

export function buildAssistantPreview(context: AssistantContext): AssistantPreview {
  switch (context.kind) {
    case "project":
      return buildProjectPreview(context);
    case "rtp_registry":
      return buildRtpRegistryPreview(context);
    case "rtp_cycle":
      return buildRtpPreview(context);
    case "plan":
      return buildPlanPreview(context);
    case "program":
      return buildProgramPreview(context);
    case "scenario_set":
      return buildScenarioPreview(context);
    case "model":
      return buildModelPreview(context);
    case "report":
    case "rtp_packet_report":
      return buildReportPreview(context);
    case "run":
      return buildRunPreview(context);
    case "analysis_studio":
    case "workspace":
    default:
      return buildWorkspacePreview(context);
  }
}

function buildWorkspaceResponse(
  context: WorkspaceAssistantContext,
  workflowId: string,
  question?: string | null
): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Workspace overview";
  const missingFundingAnchorCount = context.operationsSummary.counts.projectFundingNeedAnchorProjects;
  const fundingSourcingCount = context.operationsSummary.counts.projectFundingSourcingProjects;
  const fundingDecisionCount = context.operationsSummary.counts.projectFundingDecisionProjects;
  const gapProjectCount = context.operationsSummary.counts.projectFundingGapProjects;

  if (workflowId === "analysis-focus" && context.currentRun) {
    return {
      workflowId,
      label,
      title: `Analysis focus: ${context.currentRun.title}`,
      summary: `The live analysis surface is anchored to ${context.currentRun.title}. The most useful next read is the score posture plus any attached baseline before exporting or reporting anything downstream.`,
      findings: [
        `Overall/access/safety/equity: ${metricLabel(context.currentRun.metrics, "overallScore")} / ${metricLabel(context.currentRun.metrics, "accessibilityScore")} / ${metricLabel(context.currentRun.metrics, "safetyScore")} / ${metricLabel(context.currentRun.metrics, "equityScore")}.`,
        context.baselineRun
          ? `A baseline is already attached (${context.baselineRun.title}), so this surface can support a like-for-like comparison pass right now.`
          : "No baseline is attached, so the current run is best treated as a standalone brief until a comparison anchor is pinned.",
        asString(context.currentRun.metrics.confidence)
          ? `Run confidence is labeled ${String(context.currentRun.metrics.confidence)}.`
          : "The run does not expose an explicit confidence label in stored metrics.",
      ],
      nextSteps: [
        context.baselineRun
          ? "Use the compare workflow next to quantify score movement against the pinned baseline."
          : "Pin a baseline run if you need a defendable before/after or alternative-versus-baseline read.",
        "Export metrics or geometry only after checking the run summary and source posture.",
      ],
      evidence: [
        `Workspace: ${context.workspace.name ?? "Current workspace"}`,
        `Current run captured ${formatDateTime(context.currentRun.createdAt)}`,
        question ? `Prompt received: ${question}` : "Prompt used default Analysis Studio brief.",
      ],
      caution: "Analysis outputs are still operator-facing working surfaces and should be human-reviewed before external use.",
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "workspace-funding") {
    return {
      workflowId,
      label,
      title: `${context.workspace.name ?? "Workspace"} funding gap posture`,
        summary:
        missingFundingAnchorCount > 0
          ? `${missingFundingAnchorCount} project funding lane${missingFundingAnchorCount === 1 ? " still lacks" : "s still lack"} a funding-need anchor even though grant records already exist, so the first honest move is anchoring need before ranking dollar gaps.`
          : fundingSourcingCount > 0
          ? `${fundingSourcingCount} project funding stack${fundingSourcingCount === 1 ? " already has" : "s already have"} a grounded need but still no linked funding opportunities, so sourcing candidates comes before gap-closing choreography.`
          : fundingDecisionCount > 0
          ? `${fundingDecisionCount} project funding stack${fundingDecisionCount === 1 ? " already has" : "s already have"} linked opportunities but nothing marked pursue yet, so grant-decision work comes before gap-closing math.`
          : gapProjectCount > 0
          ? `${gapProjectCount} project funding stack${gapProjectCount === 1 ? " still shows" : "s still show"} uncovered need after current pursued dollars, so funding gap closure is now a real workspace-level operating lane.`
          : "No uncovered project funding gaps are currently visible from the workspace command queue.",
      findings: [
        context.operationsSummary.nextCommand
          ? `Current queue lead: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No queue-leading workspace command is currently visible.",
        missingFundingAnchorCount > 0
          ? `Missing funding anchors: ${missingFundingAnchorCount}.`
          : fundingSourcingCount > 0
          ? `Projects needing funding sourcing: ${fundingSourcingCount}.`
          : fundingDecisionCount > 0
          ? `Projects needing pursue decisions: ${fundingDecisionCount}.`
          : gapProjectCount > 0
          ? `Project funding gap count: ${gapProjectCount}.`
          : "The current workspace snapshot does not show any gap-flagged project funding stacks.",
        context.recentProject
          ? `Freshest project anchor: ${context.recentProject.name}.`
          : "No recent project anchor is visible from this workspace snapshot.",
      ],
      nextSteps: [
        missingFundingAnchorCount > 0
          ? `Open ${context.operationsSummary.commandQueue.find((item) => item.key === "anchor-project-funding-needs")?.href ?? "/projects"} and add a funding-need anchor before trying to quantify the gap.`
          : fundingSourcingCount > 0
          ? `Open ${context.operationsSummary.commandQueue.find((item) => item.key === "source-project-funding-opportunities")?.href ?? "/projects"} and source candidate programs before treating the project as a quantified funding gap.`
          : fundingDecisionCount > 0
          ? `Open ${context.operationsSummary.commandQueue.find((item) => item.key === "advance-project-funding-decisions")?.href ?? "/projects"} and mark the lead opportunity pursue before treating the stack as a real funding pipeline.`
          : gapProjectCount > 0
          ? `Open ${context.operationsSummary.commandQueue.find((item) => item.key === "close-project-funding-gaps")?.href ?? "/projects"} and reopen the thinnest-funded project first.`
          : "Keep funding need amounts and pursue decisions current so future gap posture stays trustworthy.",
        "Use the project funding sections, not generic notes, as the canonical place to close uncovered scope-versus-funding gaps.",
      ],
      evidence: [
        `Missing anchors: ${missingFundingAnchorCount}`,
        `Needs sourcing: ${fundingSourcingCount}`,
        `Needs decisions: ${fundingDecisionCount}`,
        `Gap projects: ${gapProjectCount}`,
        `Queue depth: ${context.operationsSummary.counts.queueDepth}`,
        `Plan: ${context.workspace.plan ?? "Unknown"}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `${context.workspace.name ?? "Workspace"} overview`,
    summary: `This workspace currently reads as a planning-control shell with ${pluralize(context.recentRuns.length, "recent run")} visible${context.recentProject ? ` and ${context.recentProject.name} as the freshest project anchor` : ""}. The shared command queue is ${context.operationsSummary.posture}.`,
    findings: [
      context.recentProject
        ? `Most recent project: ${context.recentProject.name} · ${context.recentProject.status} · ${context.recentProject.deliveryPhase}.`
        : "No current project snapshot is visible from this workspace request.",
      context.operationsSummary.nextCommand
        ? `Next command: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
        : "No immediate command-queue pressure is visible from the workspace snapshot.",
      missingFundingAnchorCount > 0
        ? `${missingFundingAnchorCount} project funding lane${missingFundingAnchorCount === 1 ? " still lacks" : "s still lack"} a funding-need anchor even though grant records already exist.`
        : fundingSourcingCount > 0
        ? `${fundingSourcingCount} project funding stack${fundingSourcingCount === 1 ? " already has" : "s already have"} need recorded but still no linked opportunities.`
        : fundingDecisionCount > 0
        ? `${fundingDecisionCount} project funding stack${fundingDecisionCount === 1 ? " already has" : "s already have"} linked opportunities but still nothing marked pursue.`
        : gapProjectCount > 0
        ? `${gapProjectCount} project funding stack${gapProjectCount === 1 ? " still shows" : "s still show"} uncovered need after current pursued dollars.`
        : "No uncovered project funding gaps are currently visible from the shared queue.",
      context.currentRun
        ? `The copilot is also grounded to the current run ${context.currentRun.title}.`
        : context.recentRuns.length > 0
          ? `Recent analysis activity is live: ${context.recentRuns.slice(0, 3).map((run) => run.title).join(" · ")}.`
          : "No recent analysis runs are visible yet.",
    ],
    nextSteps: [
      context.operationsSummary.nextCommand
        ? `Open ${context.operationsSummary.nextCommand.href} to act on ${context.operationsSummary.nextCommand.title.toLowerCase()}.`
        : context.currentRun
          ? "Open the analysis-focus workflow for a run-grounded brief."
          : "Open Analysis Studio or a project detail page to deepen grounding.",
      context.recentProject ? `Use ${context.recentProject.name} as the primary operator anchor for the next drill-down.` : "Create or attach a project record before expecting deeper assistant grounding.",
    ],
    evidence: [
      `Plan: ${context.workspace.plan ?? "Unknown"}`,
      `Role: ${context.workspace.role ?? "Unknown"}`,
      `Queue depth: ${context.operationsSummary.counts.queueDepth}`,
      `Packet pressure: ${context.operationsSummary.counts.reportRefreshRecommended + context.operationsSummary.counts.reportNoPacket}`,
      `Missing anchors: ${missingFundingAnchorCount}`,
      `Needs sourcing: ${fundingSourcingCount}`,
      `Needs decisions: ${fundingDecisionCount}`,
      `Gap projects: ${gapProjectCount}`,
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildProjectResponse(context: ProjectAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Project brief";
  const blockedGate = context.stageGateSummary.blockedGate;
  const gapAmount = context.fundingSummary.gapAmount;
  const needsFundingSourcing = context.fundingSummary.fundingNeedAmount !== null && context.fundingSummary.opportunityCount === 0;

  if (workflowId === "project-blockers") {
    return {
      workflowId,
      label,
      title: `Current blockers for ${context.project.name}`,
      summary: blockedGate
        ? `${context.project.name} is not blocker-free: the main formal control issue is ${blockedGate.name}, and the surrounding project record still shows open risk / issue pressure.`
        : `${context.project.name} does not show a formal held stage gate, but open risk and issue counts still need active review.`,
      findings: [
        blockedGate
          ? `Primary gate hold: ${blockedGate.gateId} · ${blockedGate.name} · ${blockedGate.rationale}`
          : "No stage gate is currently recorded on HOLD.",
        `${pluralize(context.counts.risks, "risk")} and ${pluralize(context.counts.issues, "issue")} are visible on the project record.`,
        blockedGate?.missingArtifacts.length
          ? `Missing artifacts on the blocked gate: ${blockedGate.missingArtifacts.join(", ")}.`
          : "No explicit missing-artifact list is recorded on the current gate surface.",
      ],
      nextSteps: [
        blockedGate
          ? `Close the evidence gap for ${blockedGate.gateId} before treating this project as gate-ready.`
          : "Review risk and issue records directly to confirm whether the current counts are still active blockers.",
        "Use the project control room to tighten rationale, owners, and mitigation notes before external reporting.",
      ],
      evidence: [
        `Stage-gate pass/hold/not-started: ${context.stageGateSummary.passCount}/${context.stageGateSummary.holdCount}/${context.stageGateSummary.notStartedCount}`,
        `Project status: ${context.project.status}`,
        `Updated: ${formatDateTime(context.project.updatedAt)}`,
      ],
      caution: "This blocker summary is only as complete as the recorded risk, issue, and gate-decision data already attached to the project.",
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "project-funding") {
    return {
      workflowId,
      label,
      title: `Funding posture for ${context.project.name}`,
      summary:
        context.fundingSummary.opportunityCount > 0
          ? `${context.project.name} has ${context.fundingSummary.opportunityCount} linked funding opportunit${context.fundingSummary.opportunityCount === 1 ? "y" : "ies"}, with ${context.fundingSummary.closingSoonCount} closing soon and ${context.fundingSummary.pursueCount} marked pursue.${context.fundingSummary.fundingNeedAmount !== null ? ` Target need is ${formatCurrency(context.fundingSummary.fundingNeedAmount)}.` : ""}${gapAmount !== null && gapAmount > 0 ? ` Remaining uncovered after likely dollars is ${formatCurrency(gapAmount)}.` : ""}`
          : needsFundingSourcing
            ? `${context.project.name} already has a recorded funding need of ${formatCurrency(context.fundingSummary.fundingNeedAmount)}, but no linked funding opportunities yet. The next honest move is sourcing candidate programs, not pretending the gap has already been worked.`
          : `${context.project.name} does not yet have linked funding opportunities, so grant posture is still unanchored on the project record.`,
      findings: [
        context.fundingSummary.opportunityCount > 0
          ? `${context.fundingSummary.openCount} open or upcoming funding opportunit${context.fundingSummary.openCount === 1 ? "y is" : "ies are"} visible on this project.`
          : needsFundingSourcing
            ? "No funding opportunities are visible yet even though the project funding need is already recorded."
            : "No open or upcoming funding opportunities are visible on this project yet.",
        context.fundingSummary.opportunityCount > 0 && context.fundingSummary.pursueCount === 0 && context.fundingSummary.leadOpportunity
          ? `Lead decision to advance: ${context.fundingSummary.leadOpportunity.title}.`
          : "At least one linked opportunity is already marked pursue, or no opportunity record exists yet.",
        context.fundingSummary.closingSoonCount > 0
          ? `${context.fundingSummary.closingSoonCount} funding opportunit${context.fundingSummary.closingSoonCount === 1 ? "y closes" : "ies close"} within the next 14 days, so timing pressure is real.`
          : "No near-term funding window is currently closing inside the next 14 days.",
        context.fundingSummary.fundingNeedAmount !== null
          ? `Recorded funding need: ${formatCurrency(context.fundingSummary.fundingNeedAmount)}.`
          : "No project-level funding need amount is recorded yet.",
        gapAmount !== null && gapAmount > 0
          ? `Uncovered after likely dollars: ${formatCurrency(gapAmount)}.`
          : "No uncovered funding gap remains after current pursued dollars, or no target need is recorded yet.",
      ],
      nextSteps: [
        context.fundingSummary.opportunityCount > 0
          ? `Open /projects/${context.project.id}#project-funding-opportunities to confirm pursue, monitor, or skip posture and update the project funding stack.`
          : needsFundingSourcing
            ? `Open /projects/${context.project.id}#project-funding-opportunities and add the first funding opportunity record against the recorded need.`
          : `Open /projects/${context.project.id}#project-funding-opportunities and add the first funding opportunity record for this project.`,
        gapAmount !== null && gapAmount > 0
          ? "Close the remaining uncovered gap before treating current pursue posture as enough to support full delivery scope."
          : needsFundingSourcing
            ? "Source candidate programs before treating this project as a quantified gap-closing lane."
          : context.fundingSummary.fundingNeedAmount !== null
            ? "Keep the target funding need aligned with current pursue and award posture before promising delivery scope."
            : "Set the project funding need so future opportunity and award posture can be measured against a real gap.",
      ],
      evidence: [
        `Funding opportunities: ${context.fundingSummary.opportunityCount}`,
        `Closing soon: ${context.fundingSummary.closingSoonCount}`,
        `Pursue decisions: ${context.fundingSummary.pursueCount}`,
        `Gap after likely dollars: ${gapAmount !== null ? formatCurrency(gapAmount) : "Unknown"}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "project-data") {
    return {
      workflowId,
      label,
      title: `Data readiness for ${context.project.name}`,
      summary: `${context.project.name} has ${pluralize(context.counts.linkedDatasets, "linked dataset")} visible from Data Hub, with ${context.counts.overlayReadyDatasets} already drawable in analysis surfaces.`,
      findings: [
        context.linkedDatasets.length > 0
          ? `Visible datasets: ${context.linkedDatasets.slice(0, 3).map((dataset) => dataset.name).join(" · ")}.`
          : "No linked datasets are visible from this project snapshot.",
        `${context.linkedDatasets.filter((dataset) => dataset.thematicReady).length} datasets are already thematic-ready rather than registry-only.`,
        `${pluralize(context.recentRuns.length, "recent run")} are available to support the project story from Analysis Studio.`,
      ],
      nextSteps: [
        context.linkedDatasets.some((dataset) => dataset.overlayReady)
          ? "Use the overlay-ready datasets in Analysis Studio before inventing any unsupported thematic story."
          : "Link or refresh project datasets so Analysis Studio can ground the project on visible geometry instead of implied source support.",
        context.recentRuns.length > 0
          ? "Cross-check the freshest run summary against the linked datasets before packaging a project brief."
          : "Create a current run in Analysis Studio if you need project-linked analytical evidence.",
      ],
      evidence: [
        `Linked datasets: ${context.counts.linkedDatasets}`,
        `Overlay-ready: ${context.counts.overlayReadyDatasets}`,
        `Recent runs: ${context.counts.recentRuns}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Project brief: ${context.project.name}`,
    summary: `${context.project.name} is currently ${context.project.status} in ${context.project.deliveryPhase}, with stage-gate workflow, project controls, datasets, and run history all visible from one record.`,
    findings: [
      context.project.summary || "The project does not yet carry a strong summary narrative on the record itself.",
      `Project controls attached: ${context.counts.deliverables} deliverables, ${context.counts.decisions} decisions, ${context.counts.meetings} meetings.`,
      context.fundingSummary.opportunityCount > 0
        ? `${context.fundingSummary.opportunityCount} funding opportunit${context.fundingSummary.opportunityCount === 1 ? "y is" : "ies are"} linked to the project, with ${context.fundingSummary.closingSoonCount} closing soon.${gapAmount !== null && gapAmount > 0 ? ` Remaining uncovered after likely dollars: ${formatCurrency(gapAmount)}.` : ""}`
        : "No linked funding opportunities are currently visible on this project.",
      blockedGate
        ? `Gate pressure exists at ${blockedGate.gateId} · ${blockedGate.name}.`
        : `No formal stage gate is currently on hold; next gate cue is ${context.stageGateSummary.nextGate?.gateId ?? "not yet set"}.`,
    ],
    nextSteps: [
      blockedGate ? `Resolve ${blockedGate.gateId} evidence gaps before claiming the project is fully ready.` : context.fundingSummary.closingSoonCount > 0
        ? "Recheck the near-term funding windows before less urgent project cleanup so grant timing does not slip."
        : gapAmount !== null && gapAmount > 0
          ? "Tighten the funding strategy next so uncovered scope does not outrun the current grant pipeline."
        : "Use the next-gate cue to keep the project moving through the recorded workflow.",
      context.counts.overlayReadyDatasets > 0
        ? "Bring one overlay-ready dataset plus a current run into Analysis Studio for the next decision memo."
        : "Strengthen data linkage before leaning too hard on analytical claims.",
    ],
    evidence: [
      `Plan type: ${context.project.planType}`,
      `Stage-gate pass count: ${context.stageGateSummary.passCount}`,
      `Recent run count: ${context.counts.recentRuns}`,
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildRtpRegistryResponse(context: RtpRegistryAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "RTP registry brief";
  const registryPacketPosture = resolveRtpPacketWorkPostureFromCounts({
    noPacketCount: context.counts.noPacketCount,
    refreshRecommendedCount: context.counts.refreshRecommendedCount,
  });

  if (workflowId === "rtp-registry-generate") {
    return {
      workflowId,
      label,
      title: `First RTP packet queue: ${context.workspace.name ?? "Current workspace"}`,
      summary: registryPacketPosture === "generate"
        ? `${context.counts.noPacketCount} RTP cycle${context.counts.noPacketCount === 1 ? " still needs" : "s still need"} a first generated packet, so first-generation work is the top registry queue posture right now.`
        : "The registry does not currently show any RTP cycles missing a first packet.",
      findings: [
        context.recommendedCycle
          ? `Leading cycle anchor: ${context.recommendedCycle.title} (${context.recommendedCycle.packetFreshnessLabel}).`
          : "No RTP cycle is visible yet from the registry snapshot.",
        `${context.counts.packetReports} RTP board-packet record${context.counts.packetReports === 1 ? " is" : "s are"} currently linked across the registry.`,
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking first-packet work in the RTP registry.",
      ],
      nextSteps: [
        context.recommendedCycle
          ? `Open /rtp/${context.recommendedCycle.id} to work the strongest first-packet cycle anchor first.`
          : "Create the first RTP cycle before expecting first-packet queue behavior.",
        "Confirm cycle readiness and packet section posture before generating first artifacts.",
      ],
      evidence: [
        `Cycles: ${context.counts.cycles}`,
        `No-packet cycles: ${context.counts.noPacketCount}`,
        `Packet reports: ${context.counts.packetReports}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "rtp-registry-refresh") {
    return {
      workflowId,
      label,
      title: `RTP refresh queue: ${context.workspace.name ?? "Current workspace"}`,
      summary: registryPacketPosture === "refresh"
        ? `${context.counts.refreshRecommendedCount} RTP cycle packet${context.counts.refreshRecommendedCount === 1 ? " needs" : "s need"} refresh, so stale packet regeneration is the top registry queue posture right now.`
        : "The registry does not currently show stale RTP packets that need refresh.",
      findings: [
        context.recommendedCycle
          ? `Leading cycle anchor: ${context.recommendedCycle.title} (${context.recommendedCycle.packetFreshnessLabel}).`
          : "No RTP cycle is visible yet from the registry snapshot.",
        `${context.counts.packetReports} RTP board-packet record${context.counts.packetReports === 1 ? " is" : "s are"} currently linked across the registry.`,
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking RTP refresh work in the registry.",
      ],
      nextSteps: [
        context.recommendedCycle
          ? `Open /rtp/${context.recommendedCycle.id} to inspect the strongest stale-packet cycle anchor first.`
          : "Create RTP cycle and packet records before expecting refresh queue behavior.",
        "Check cycle drift and packet basis before regenerating stale board packets.",
      ],
      evidence: [
        `Cycles: ${context.counts.cycles}`,
        `Refresh-recommended cycles: ${context.counts.refreshRecommendedCount}`,
        `Packet reports: ${context.counts.packetReports}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "rtp-registry-release") {
    return {
      workflowId,
      label,
      title: `Board-ready RTP queue: ${context.workspace.name ?? "Current workspace"}`,
      summary: context.recommendedCycle
        ? `${context.recommendedCycle.title} is the strongest current cycle anchor for board-ready RTP packet review from the registry.`
        : "No board-ready RTP packet anchor is visible yet from the registry snapshot.",
      findings: [
        `${context.counts.packetReports} RTP board-packet record${context.counts.packetReports === 1 ? " is" : "s are"} currently linked across the registry.`,
        context.recommendedCycle
          ? `Recommended cycle: ${context.recommendedCycle.title} (${context.recommendedCycle.status}, ${context.recommendedCycle.packetFreshnessLabel}).`
          : "No RTP cycle is available yet to anchor release review.",
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking board-ready review in the RTP registry.",
      ],
      nextSteps: [
        context.recommendedCycle
          ? `Open /rtp/${context.recommendedCycle.id} to verify the strongest current board-ready cycle anchor first.`
          : "Create and mature at least one RTP cycle and packet before expecting board-ready review work.",
        "Verify packet freshness, cycle drift, and release posture before externalizing anything.",
      ],
      evidence: [
        `Cycles: ${context.counts.cycles}`,
        `Refresh-recommended cycles: ${context.counts.refreshRecommendedCount}`,
        `No-packet cycles: ${context.counts.noPacketCount}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "rtp-registry-packets") {
    return {
      workflowId,
      label,
      title: `RTP packet queue: ${context.workspace.name ?? "Current workspace"}`,
      summary: context.recommendedCycle
        ? `${context.recommendedCycle.title} is currently the strongest RTP queue anchor, and the registry shows ${context.counts.refreshRecommendedCount} cycle packet${context.counts.refreshRecommendedCount === 1 ? "" : "s"} needing refresh plus ${context.counts.noPacketCount} cycle${context.counts.noPacketCount === 1 ? "" : "s"} still missing a generated packet.`
        : "No RTP packet queue posture is visible yet because there are no cycles in the registry snapshot.",
      findings: [
        `${context.counts.packetReports} RTP board-packet record${context.counts.packetReports === 1 ? " is" : "s are"} currently linked across the registry.`,
        context.recommendedCycle
          ? `${context.recommendedCycle.title} currently reads as ${context.recommendedCycle.packetFreshnessLabel.toLowerCase()}.`
          : "No RTP cycle is available yet to act as a packet anchor.",
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking the RTP registry from the current snapshot.",
      ],
      nextSteps: [
        context.recommendedCycle
          ? `Open /rtp/${context.recommendedCycle.id} to work the strongest current RTP packet or cycle signal first.`
          : "Create the first RTP cycle before expecting packet queue behavior.",
        context.counts.noPacketCount > 0
          ? "Create first packets for missing cycles before spending too long on already-current packet polish."
          : "Refresh the stale packets first, then verify that the registry queue and packet trace stay aligned.",
      ],
      evidence: [
        `Cycles: ${context.counts.cycles}`,
        `Packet reports: ${context.counts.packetReports}`,
        `Workspace queue depth: ${context.operationsSummary.counts.queueDepth}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `RTP registry brief: ${context.workspace.name ?? "Current workspace"}`,
    summary: `The RTP registry currently shows ${context.counts.cycles} cycle${context.counts.cycles === 1 ? "" : "s"}, with packet posture split between ${context.counts.refreshRecommendedCount} needing refresh and ${context.counts.noPacketCount} still missing a generated packet.`,
    findings: [
      `${context.counts.draftCycles} draft, ${context.counts.publicReviewCycles} public-review, ${context.counts.adoptedCycles} adopted, ${context.counts.archivedCycles} archived.`,
      context.recommendedCycle
        ? `Recommended next cycle: ${context.recommendedCycle.title} (${context.recommendedCycle.status}, ${context.recommendedCycle.packetFreshnessLabel}).`
        : "No RTP cycle is visible yet from the registry snapshot.",
      context.operationsSummary.nextCommand
        ? `Workspace next command: ${context.operationsSummary.nextCommand.title}.`
        : "No broader workspace command currently outranks the RTP registry lane.",
    ],
    nextSteps: [
      context.recommendedCycle
        ? `Use ${context.recommendedCycle.title} as the next RTP operator anchor instead of treating the registry as a passive list.`
        : "Create the first RTP cycle so the registry can become a real operating surface.",
      context.counts.refreshRecommendedCount > 0 || context.counts.noPacketCount > 0
        ? "Work packet pressure alongside cycle status so the registry stays honest about board/binder readiness."
        : "Keep chapter, packet, and queue trace posture aligned as cycles advance between draft, public review, and adopted states.",
    ],
    evidence: [
      `Workspace plan: ${context.workspace.plan ?? "Unknown"}`,
      `Workspace role: ${context.workspace.role ?? "Unknown"}`,
      `Queue depth: ${context.operationsSummary.counts.queueDepth}`,
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildRtpResponse(context: RtpAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "RTP brief";
  const cyclePacketWorkPosture = resolveRtpPacketWorkPostureFromCounts({
    linkedReportCount: context.packetSummary.linkedReportCount,
    noPacketCount: context.packetSummary.noPacketCount,
    refreshRecommendedCount: context.packetSummary.refreshRecommendedCount,
  });

  if (workflowId === "rtp-packet-generate") {
    return {
      workflowId,
      label,
      title: `First packet plan: ${context.rtpCycle.title}`,
      summary: `${context.rtpCycle.title} still needs a usable current RTP board packet artifact, so first-generation planning is the top cycle-level packet move right now.`,
      findings: [
        context.packetSummary.linkedReportCount > 0
          ? `${context.packetSummary.linkedReportCount} linked packet${context.packetSummary.linkedReportCount === 1 ? " is" : "s are"} visible, with ${context.packetSummary.noPacketCount} missing a generated artifact.`
          : "No linked packet record exists yet, so the cycle still needs its first RTP board-packet trail.",
        context.packetSummary.recommendedReport
          ? `${context.packetSummary.recommendedReport.title ?? "Lead packet"} currently reads as ${context.packetSummary.recommendedReport.packetFreshness.label.toLowerCase()}.`
          : "Once the first packet record exists, it can be generated and reviewed in the normal RTP packet lane.",
        context.readiness.ready
          ? "Cycle readiness is materially in place for first-packet generation."
          : context.readiness.reason,
      ],
      nextSteps: [
        context.packetSummary.recommendedReport
          ? `Open /reports/${context.packetSummary.recommendedReport.id} to confirm packet sections and first-generation basis.`
          : "Create or attach the first RTP board packet record before expecting artifact generation.",
        context.readiness.ready
          ? "Once packet sections and source basis are confirmed, generate the first board packet artifact."
          : context.readiness.nextSteps[0] ?? "Tighten the missing cycle setup before generating the first board packet.",
      ],
      evidence: [
        `Chapters: ${context.counts.chapters}`,
        `Linked projects: ${context.counts.linkedProjects}`,
        `No-packet count: ${context.packetSummary.noPacketCount}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "rtp-packet-refresh") {
    return {
      workflowId,
      label,
      title: `Refresh plan: ${context.rtpCycle.title}`,
      summary: `${context.rtpCycle.title} has a stale RTP packet basis, so refresh planning is the top cycle-level packet move right now.`,
      findings: [
        `${context.packetSummary.linkedReportCount} linked packet${context.packetSummary.linkedReportCount === 1 ? " is" : "s are"} visible, with ${context.packetSummary.refreshRecommendedCount} needing refresh.`,
        context.packetSummary.recommendedReport
          ? `${context.packetSummary.recommendedReport.title ?? "Lead packet"} currently reads as ${context.packetSummary.recommendedReport.packetFreshness.label.toLowerCase()}.`
          : "No linked packet record is available yet, so refresh is not possible until packet generation exists.",
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking packet refresh for this cycle.",
      ],
      nextSteps: [
        context.packetSummary.recommendedReport
          ? `Open /reports/${context.packetSummary.recommendedReport.id} to inspect drift before regenerating the packet.`
          : "Create or attach a packet record before expecting refresh behavior.",
        "Recheck cycle changes, enabled sections, and packet trace before regenerating the artifact.",
      ],
      evidence: [
        `Chapters: ${context.counts.chapters}`,
        `Linked projects: ${context.counts.linkedProjects}`,
        `Refresh count: ${context.packetSummary.refreshRecommendedCount}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "rtp-packet-release") {
    return {
      workflowId,
      label,
      title: `Release review: ${context.rtpCycle.title}`,
      summary: `${context.rtpCycle.title} has a materially current RTP packet anchor, so board/public release review is the top cycle-level packet move right now.`,
      findings: [
        `${context.packetSummary.linkedReportCount} linked packet${context.packetSummary.linkedReportCount === 1 ? " is" : "s are"} visible.`,
        context.packetSummary.recommendedReport
          ? `${context.packetSummary.recommendedReport.title ?? "Lead packet"} currently reads as ${context.packetSummary.recommendedReport.packetFreshness.label.toLowerCase()}.`
          : "No linked packet record is available yet, so release review is premature.",
        context.readiness.ready
          ? "Cycle readiness is materially in place for board-ready review."
          : context.readiness.reason,
      ],
      nextSteps: [
        context.packetSummary.recommendedReport
          ? `Open /reports/${context.packetSummary.recommendedReport.id} to verify release posture on the lead board packet.`
          : "Create and mature a packet before expecting release review work.",
        "Verify packet freshness, cycle drift, and packet audit posture before board/public use.",
      ],
      evidence: [
        `Chapters: ${context.counts.chapters}`,
        `Linked projects: ${context.counts.linkedProjects}`,
        `Packet reports: ${context.packetSummary.linkedReportCount}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "rtp-packet") {
    return {
      workflowId,
      label,
      title: `Packet posture: ${context.rtpCycle.title}`,
      summary: context.packetSummary.recommendedReport
        ? cyclePacketWorkPosture === "generate"
          ? `${context.rtpCycle.title} currently needs first-packet work before board-ready review, and the lead packet anchor is ${context.packetSummary.recommendedReport.title ?? "its lead board packet"}.`
          : cyclePacketWorkPosture === "refresh"
            ? `${context.rtpCycle.title} currently points first to ${context.packetSummary.recommendedReport.title ?? "its lead board packet"}, which still needs refresh before board-ready review.`
            : `${context.rtpCycle.title} currently points first to ${context.packetSummary.recommendedReport.title ?? "its lead board packet"}, which is materially current for release review.`
        : `${context.rtpCycle.title} does not yet have a linked RTP board packet, so the packet trail still needs to be established.`,
      findings: [
        `${context.packetSummary.linkedReportCount} linked packet${context.packetSummary.linkedReportCount === 1 ? "" : "s"}, ${context.packetSummary.refreshRecommendedCount} needing refresh, ${context.packetSummary.noPacketCount} with no generated artifact.`,
        context.packetSummary.recommendedReport
          ? context.packetSummary.recommendedReport.packetFreshness.detail
          : "No linked packet record is available to refresh or review yet.",
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking this RTP cycle from the current snapshot.",
      ],
      nextSteps: [
        context.packetSummary.recommendedReport
          ? `Open /reports/${context.packetSummary.recommendedReport.id} to act on the current RTP packet posture.`
          : "Create or attach the first RTP board packet before treating this cycle as packet-ready.",
        context.readiness.ready
          ? "Once packet posture is current, keep chapter workflow and project linkage aligned with the current cycle phase."
          : context.readiness.nextSteps[0] ?? "Tighten the missing cycle setup before building more packet surface area.",
      ],
      evidence: [
        `Chapters: ${context.counts.chapters}`,
        `Linked projects: ${context.counts.linkedProjects}`,
        `Engagement campaigns: ${context.counts.engagementCampaigns}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `RTP brief: ${context.rtpCycle.title}`,
    summary: `${context.rtpCycle.title} is currently ${context.rtpCycle.status}, ${context.readiness.label.toLowerCase()}, and ${context.workflow.label.toLowerCase()}.`,
    findings: [
      context.rtpCycle.summary || "The RTP cycle record does not yet carry a strong summary narrative.",
      `${context.counts.chapters} chapters are in scope, with ${context.counts.readyForReviewChapters} ready for review and ${context.counts.completeChapters} complete.`,
      context.operationsSummary.nextCommand
        ? `Workspace next command: ${context.operationsSummary.nextCommand.title}.`
        : context.packetSummary.recommendedReport
          ? `Recommended packet anchor: ${context.packetSummary.recommendedReport.title ?? "board packet"}.`
          : "No immediate queue or packet anchor is visible beyond the cycle record itself.",
    ],
    nextSteps: [
      context.readiness.ready
        ? "Use the current cycle as the anchor for project portfolio, engagement, and packet review work."
        : `Close the remaining ${context.readiness.totalCheckCount - context.readiness.readyCheckCount} setup gap${context.readiness.totalCheckCount - context.readiness.readyCheckCount === 1 ? "" : "s"} before treating this cycle as fully review-ready.`,
      context.packetSummary.linkedReportCount > 0
        ? "Keep RTP packet freshness aligned with chapter and project changes as the cycle moves phases."
        : "Create the first board packet once the cycle basis is clean enough to support it.",
    ],
    evidence: [
      `Geography: ${context.rtpCycle.geographyLabel ?? "Missing"}`,
      `Horizon: ${context.rtpCycle.horizonStartYear ?? "?"}–${context.rtpCycle.horizonEndYear ?? "?"}`,
      `Updated: ${formatDateTime(context.rtpCycle.updatedAt)}`,
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildPlanResponse(context: PlanAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Plan brief";

  if (workflowId === "plan-gaps") {
    return {
      workflowId,
      label,
      title: `Plan gaps: ${context.plan.title}`,
      summary: `${context.plan.title} is currently ${context.readiness.label.toLowerCase()}, with ${context.readiness.missingCheckCount} explicit gap${context.readiness.missingCheckCount === 1 ? "" : "s"} still visible in the record-driven setup check.` ,
      findings: [
        context.readiness.reason,
        context.readiness.missingCheckLabels.length > 0
          ? `Missing basis: ${context.readiness.missingCheckLabels.join(", ")}.`
          : "No explicit setup gaps are currently flagged on this plan.",
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking this plan from the current snapshot.",
      ],
      nextSteps: [
        context.readiness.nextSteps[0] ?? "Tighten the missing plan basis before treating this as handoff-ready.",
        context.linkageCounts.reports > 0 ? "Recheck linked reports after the missing basis is closed." : "Create or attach a report only after the plan basis is less thin.",
      ],
      evidence: [
        `Scenarios: ${context.linkageCounts.scenarios}`,
        `Campaigns: ${context.linkageCounts.engagementCampaigns}`,
        `Reports: ${context.linkageCounts.reports}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Plan brief: ${context.plan.title}`,
    summary: `${context.plan.title} is currently ${context.plan.status}, ${context.readiness.label.toLowerCase()}, and ${context.workflow.label.toLowerCase()}.`,
    findings: [
      context.plan.summary || "The plan record does not yet carry a strong summary narrative.",
      context.artifactCoverage.detail,
      context.operationsSummary.nextCommand
        ? `Workspace next command: ${context.operationsSummary.nextCommand.title}.`
        : "Workspace command queue is currently clear from this snapshot.",
    ],
    nextSteps: [
      context.readiness.missingCheckCount > 0
        ? `Close the remaining ${context.readiness.missingCheckCount} setup gap${context.readiness.missingCheckCount === 1 ? "" : "s"} before treating the plan as review-ready.`
        : "Use the current plan basis to drive the next packet, scenario, or engagement move.",
      context.project ? `Keep ${context.project.name} as the main delivery anchor while this plan evolves.` : "Attach a project anchor if this plan should drive downstream reporting or controls.",
    ],
    evidence: [
      `Plan type: ${context.plan.planType}`,
      `Geography: ${context.plan.geographyLabel ?? "Missing"}`,
      `Horizon year: ${context.plan.horizonYear ?? "Missing"}`,
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildProgramResponse(context: ProgramAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Program brief";
  const gapAmount = context.fundingSummary.gapAmount;
  const needsFundingSourcing = context.fundingSummary.fundingNeedAmount !== null && context.fundingSummary.opportunityCount === 0;

  if (workflowId === "program-funding") {
    return {
      workflowId,
      label,
      title: `Funding posture: ${context.program.title}`,
      summary:
        context.fundingSummary.opportunityCount > 0
          ? `${context.program.title} has ${context.fundingSummary.opportunityCount} linked funding opportunit${context.fundingSummary.opportunityCount === 1 ? "y" : "ies"}, with ${context.fundingSummary.closingSoonCount} closing soon and ${context.fundingSummary.pursueCount} marked pursue.${context.fundingSummary.fundingNeedAmount !== null ? ` Recorded project need is ${formatCurrency(context.fundingSummary.fundingNeedAmount)}.` : ""}${gapAmount !== null && gapAmount > 0 ? ` Remaining uncovered after likely dollars is ${formatCurrency(gapAmount)}.` : ""}`
          : needsFundingSourcing
            ? `${context.program.title} already sits on a linked project funding need of ${formatCurrency(context.fundingSummary.fundingNeedAmount)}, but no funding opportunities are linked yet. The next honest move is sourcing candidate programs before talking about gap closure.`
          : `${context.program.title} does not yet have linked funding opportunities, so grant posture is still thin.`,
      findings: [
        context.fundingSummary.opportunityCount > 0
          ? `${context.fundingSummary.openCount} open or upcoming opportunit${context.fundingSummary.openCount === 1 ? "y is" : "ies are"} visible on this package.`
          : needsFundingSourcing
            ? "No funding opportunities are visible yet even though the linked project funding need is already recorded."
            : "No open or upcoming funding opportunities are visible on this package yet.",
        context.fundingSummary.opportunityCount > 0 && context.fundingSummary.pursueCount === 0 && context.fundingSummary.leadOpportunity
          ? `Lead decision to advance: ${context.fundingSummary.leadOpportunity.title}.`
          : "At least one linked package opportunity is already marked pursue, or no opportunity record exists yet.",
        context.fundingSummary.closingSoonCount > 0
          ? `${context.fundingSummary.closingSoonCount} funding opportunit${context.fundingSummary.closingSoonCount === 1 ? "y closes" : "ies close"} within the next 14 days, so timing pressure is real.`
          : "No near-term funding window is currently closing inside the next 14 days.",
        context.fundingSummary.pursueCount > 0
          ? `${context.fundingSummary.pursueCount} opportunit${context.fundingSummary.pursueCount === 1 ? "y is" : "ies are"} already marked pursue on this package.`
          : "No linked opportunity is currently marked pursue on this package.",
        gapAmount !== null && gapAmount > 0
          ? `The linked project still carries ${formatCurrency(gapAmount)} uncovered after likely dollars.`
          : "No uncovered linked-project funding gap remains after current pursued dollars, or no target need is recorded yet.",
      ],
      nextSteps: [
        context.fundingSummary.opportunityCount > 0
          ? `Open /programs/${context.program.id}#program-funding-opportunities to confirm pursue, monitor, or skip posture on the linked opportunities.`
          : needsFundingSourcing
            ? `Open /programs/${context.program.id}#program-funding-opportunities and add the first funding opportunity tied to the recorded need.`
          : `Open /programs/${context.program.id}#program-funding-opportunities and log the first funding opportunity tied to this package.`,
        gapAmount !== null && gapAmount > 0 && context.project
          ? `Keep ${context.project.name} aligned with this package while you close the remaining uncovered funding gap.`
          : needsFundingSourcing && context.project
          ? `Keep ${context.project.name} aligned with this package while you source candidate funding programs.`
          : context.project
          ? `Keep ${context.project.name} aligned with the package funding posture before shifting RTP or delivery assumptions.`
          : "Attach or confirm the main project anchor so funding posture can flow into the wider control room cleanly.",
      ],
      evidence: [
        `Funding opportunities: ${context.fundingSummary.opportunityCount}`,
        `Closing soon: ${context.fundingSummary.closingSoonCount}`,
        `Pursue decisions: ${context.fundingSummary.pursueCount}`,
        `Gap after likely dollars: ${gapAmount !== null ? formatCurrency(gapAmount) : "Unknown"}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "program-packet") {
    return {
      workflowId,
      label,
      title: `Packet posture: ${context.program.title}`,
      summary: context.packetSummary.recommendedReport
        ? `${context.program.title} currently points first to ${context.packetSummary.recommendedReport.title ?? "its lead report packet"}, which is marked ${context.packetSummary.recommendedReport.packetFreshness.label.toLowerCase()}.`
        : `${context.program.title} does not yet have a linked report packet, so the packet trail still needs to be established.`,
      findings: [
        `${context.packetSummary.linkedReportCount} linked report${context.packetSummary.linkedReportCount === 1 ? "" : "s"}, ${context.packetSummary.attentionCount} with packet attention.`,
        context.packetSummary.recommendedReport
          ? context.packetSummary.recommendedReport.packetFreshness.detail
          : "No linked report packet is available to refresh or review yet.",
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking this package from the current snapshot.",
      ],
      nextSteps: [
        context.packetSummary.recommendedReport
          ? `Open /reports/${context.packetSummary.recommendedReport.id} to act on the current packet posture.`
          : "Create or attach the first report packet before treating this package as packet-ready.",
        context.readiness.missingCheckCount > 0
          ? `Close the remaining ${context.readiness.missingCheckCount} readiness gap${context.readiness.missingCheckCount === 1 ? "" : "s"} so packet work is based on a cleaner package record.`
          : "Once packet posture is current, keep the program narrative aligned with linked plans and engagement evidence.",
      ],
      evidence: [
        `Plans: ${context.linkageCounts.plans}`,
        `Reports: ${context.linkageCounts.reports}`,
        `Campaigns: ${context.linkageCounts.engagementCampaigns}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Program brief: ${context.program.title}`,
    summary: `${context.program.title} is currently ${context.program.status}, ${context.readiness.label.toLowerCase()}, and ${context.workflow.label.toLowerCase()}.`,
    findings: [
      context.program.summary || "The program record does not yet carry a strong package summary narrative.",
      `${context.linkageCounts.plans} plans, ${context.linkageCounts.engagementCampaigns} engagement campaigns, and ${context.linkageCounts.reports} reports are visible in the package basis.`,
      context.fundingSummary.opportunityCount > 0
        ? `${context.fundingSummary.opportunityCount} funding opportunit${context.fundingSummary.opportunityCount === 1 ? "y is" : "ies are"} linked, with ${context.fundingSummary.closingSoonCount} closing soon.${gapAmount !== null && gapAmount > 0 ? ` Remaining uncovered after likely dollars: ${formatCurrency(gapAmount)}.` : ""}`
        : "No linked funding opportunities are currently visible on this package.",
      context.packetSummary.attentionCount > 0
        ? `${context.packetSummary.attentionCount} linked packet${context.packetSummary.attentionCount === 1 ? " needs" : "s need"} attention before this package reads as clean.`
        : "No linked packet attention is currently visible on this package.",
    ],
    nextSteps: [
      context.fundingSummary.closingSoonCount > 0
        ? "Recheck the near-term funding windows first so grant timing does not slip while packet work continues."
        : gapAmount !== null && gapAmount > 0
          ? "Tighten the funding strategy next so the package does not read as more funded than it really is."
        : context.packetSummary.attentionCount > 0
          ? "Work the packet posture first so the package basis stays current."
          : "Use the current package basis to support the next submission or funding move.",
      context.project ? `Keep ${context.project.name} as the main delivery anchor while this package evolves.` : "Attach a project anchor if this package should flow through broader project controls.",
    ],
    evidence: [
      `Cycle: ${context.program.cycleName}`,
      `Sponsor agency: ${context.program.sponsorAgency ?? "Missing"}`,
      `Queue depth: ${context.operationsSummary.counts.queueDepth}`,
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildScenarioResponse(context: ScenarioAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Scenario compare";

  if (workflowId === "scenario-handoff") {
    return {
      workflowId,
      label,
      title: `Scenario handoff posture for ${context.scenarioSet.title}`,
      summary: `${context.comparisonSummary.readyAlternatives} of ${context.comparisonSummary.totalAlternatives} alternatives are currently ready for a serious baseline-linked handoff into Analysis Studio or reporting.`,
      findings: [
        context.baselineEntry
          ? `Baseline registered: ${context.baselineEntry.label}${context.baselineEntry.attachedRunId ? " with attached run evidence" : " but still missing a run attachment"}.`
          : "No baseline entry is registered yet, so handoff posture is inherently incomplete.",
        context.comparisonBoard.length > 0
          ? `${pluralize(context.comparisonBoard.length, "comparison-ready alternative")} can already open with explicit baseline pairing.`
          : "No comparison-ready alternatives are visible yet.",
        context.linkedReports.length > 0
          ? `${pluralize(context.linkedReports.length, "linked report")} already touch this scenario set's evidence chain.`
          : "No linked reports are currently carrying this scenario set forward.",
      ],
      nextSteps: [
        context.comparisonSummary.readyAlternatives > 0
          ? "Open a ready alternative in Analysis Studio and preserve the baseline pairing for the next review cycle."
          : "Attach distinct runs to baseline and at least one alternative before expecting a meaningful handoff.",
        context.linkedReports.some((report) => report.comparisonReady)
          ? "Use the comparison-ready report linkages as the first downstream packet candidates."
          : "Create a report only after the baseline-versus-alternative evidence is explicit and stable.",
      ],
      evidence: [
        `Baseline present: ${context.baselineEntry ? "yes" : "no"}`,
        `Ready alternatives: ${context.comparisonSummary.readyAlternatives}`,
        `Linked reports: ${context.linkedReports.length}`,
      ],
    };
  }

  const topCard = context.comparisonBoard[0] ?? null;
  return {
    workflowId,
    label,
    title: `Scenario comparison brief: ${context.scenarioSet.title}`,
    summary: topCard
      ? `${topCard.candidateLabel} currently reads as the strongest ready comparison against ${topCard.baselineLabel}, with ${topCard.changedMetricCount} headline/supporting metrics moving.`
      : `This scenario set is not comparison-ready yet because baseline or alternative run evidence is still missing or duplicated.`,
    findings: [
      context.scenarioSet.planningQuestion || "No planning question is currently recorded for the scenario set.",
      topCard
        ? `${topCard.candidateLabel} vs ${topCard.baselineLabel}: ${topCard.headlineMetrics.map((metric) => `${metric.label} ${metric.deltaLabel}`).join(" · ")}.`
        : "No comparison card is available to summarize yet.",
      `${context.comparisonSummary.readyAlternatives}/${context.comparisonSummary.totalAlternatives} alternatives are ready for evidence-backed comparison.`,
    ],
    nextSteps: [
      topCard ? `Open ${topCard.candidateLabel} in Analysis Studio to inspect the delta board with the baseline pinned.` : "Attach distinct baseline and alternative runs before trying to interpret scenario movement.",
      "Keep scenario assumptions attached to entries rather than burying them in narrative prose.",
    ],
    evidence: [
      `Baseline entry: ${context.baselineEntry?.label ?? "Missing"}`,
      `Comparison cards: ${context.comparisonBoard.length}`,
      `Linked reports: ${context.linkedReports.length}`,
    ],
  };
}

function buildModelResponse(context: ModelAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Model readiness";

  if (workflowId === "model-launch") {
    return {
      workflowId,
      label,
      title: `Recommended next launch step for ${context.model.title}`,
      summary: `${context.workflow.label}. The safest useful next move is to tighten missing readiness checks first, then launch or validate against the most explicit scenario evidence already linked to the model.`,
      findings: [
        context.workflow.reason,
        context.launchTemplate.queryText
          ? "A default query template already exists in the model configuration."
          : "No default query template is stored in the model configuration yet.",
        context.launchTemplate.corridorGeojson
          ? "A corridor geometry template is already embedded for launch scaffolding."
          : "No corridor geometry template is embedded yet, so launch inputs still need manual assembly.",
      ],
      nextSteps: [
        context.readiness.missingCheckCount > 0
          ? `Close the remaining ${context.readiness.missingCheckCount} readiness gap${context.readiness.missingCheckCount === 1 ? "" : "s"} before treating this as a stable execution surface.`
          : "The readiness board is green enough to move into a controlled validation or pilot run.",
        context.scenarioEntryOptions.length > 0
          ? "Choose a scenario entry with explicit assumptions so the launch has a traceable planning frame."
          : "Attach a scenario set or scenario entries so execution evidence does not float free of planning context.",
      ],
      evidence: [
        `Recent model runs: ${context.recentModelRuns.length}`,
        `Scenario options: ${context.scenarioEntryOptions.length}`,
        `Readiness checks passed: ${context.readiness.readyCheckCount}/${context.readiness.totalCheckCount}`,
      ],
      caution: "A green launch recommendation here is still about operator readiness, not scientific validity or production-grade model certification.",
    };
  }

  return {
    workflowId,
    label,
    title: `Model readiness: ${context.model.title}`,
    summary: `${context.readiness.label}. The model currently passes ${context.readiness.readyCheckCount} of ${context.readiness.totalCheckCount} readiness checks and ${context.workflow.label.toLowerCase()}.`,
    findings: [
      context.readiness.reason,
      context.workflow.reason,
      context.readiness.checks.filter((check) => !check.ready).length > 0
        ? `Missing checks: ${context.readiness.checks.filter((check) => !check.ready).map((check) => check.label).join(", ")}.`
        : "No readiness gaps are currently flagged by the record-driven check set.",
    ],
    nextSteps: [
      context.readiness.missingCheckCount > 0
        ? "Resolve the missing readiness checks before expanding downstream dependence on this model."
        : "Preserve the current readiness posture by recording validation and run evidence as it happens.",
      context.schemaPending
        ? "Apply the pending model-run schema before depending on execution history inside this view."
        : "Use recent model runs plus explicit links to keep provenance tight.",
    ],
    evidence: [
      `Linked plans: ${context.linkageCounts.plans}`,
      `Linked datasets: ${context.linkageCounts.datasets}`,
      `Linked reports: ${context.linkageCounts.reports}`,
    ],
  };
}

function buildReportResponse(context: ReportAssistantContext, workflowId: string): AssistantResponse {
  const label =
    findAssistantAction(context.kind, workflowId)?.label ??
    (context.kind === "rtp_packet_report" ? "RTP packet audit" : "Report audit");
  const holdCount = context.runAudit.filter((item) => item.gate.decision !== "PASS").length;
  const packetFreshness = getReportPacketFreshness({
    latestArtifactKind: context.report.latestArtifactKind,
    generatedAt: context.report.generatedAt,
    updatedAt: context.report.updatedAt,
  });
  const packetPosture = resolveRtpPacketWorkPostureFromFreshnessLabel(packetFreshness.label);

  if (workflowId === "rtp-packet-generate") {
    return {
      workflowId,
      label,
      title: `First packet plan for ${context.report.title}`,
      summary: `${context.report.title} still needs its first usable RTP board packet artifact. The main job now is confirming that the cycle basis, packet sections, and source runs are strong enough to justify generation.`,
      findings: [
        context.rtpCycle ? `RTP cycle anchor: ${context.rtpCycle.title} · ${context.rtpCycle.status}.` : null,
        `Packet freshness: ${packetFreshness.label}. ${packetFreshness.detail}`,
        context.sectionCount > 0
          ? `${context.enabledSections} of ${context.sectionCount} packet sections are enabled on the record.`
          : "No report sections are currently attached to this packet record.",
        context.runs.length > 0
          ? `${context.runs.length} linked run${context.runs.length === 1 ? " is" : "s are"} available to support the first artifact.`
          : "No source runs are attached yet, so first-packet generation would be thinly grounded.",
      ].filter(Boolean) as string[],
      nextSteps: [
        "Confirm the packet layout and section coverage before generating the first artifact.",
        context.runs.length > 0
          ? "Use the linked run summaries and cycle context as the minimum provenance basis for first generation."
          : "Attach at least one defendable source run or equivalent basis before treating first generation as meaningful.",
      ],
      evidence: [
        context.rtpCycle ? `RTP cycle: ${context.rtpCycle.id}` : null,
        `Enabled sections: ${context.enabledSections}/${context.sectionCount}`,
        `Linked runs: ${context.runs.length}`,
        `Artifacts: ${context.artifactCount}`,
      ].filter(Boolean) as string[],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "rtp-packet-refresh") {
    return {
      workflowId,
      label,
      title: `Refresh plan for ${context.report.title}`,
      summary: `${context.report.title} already has a packet trail, but the current cycle or packet record changed after the last generation. Refresh work should verify what drifted before regenerating.`,
      findings: [
        context.rtpCycle ? `RTP cycle anchor: ${context.rtpCycle.title} · ${context.rtpCycle.status}.` : null,
        `Packet freshness: ${packetFreshness.label}. ${packetFreshness.detail}`,
        context.latestArtifact
          ? `Latest artifact generated ${formatDateTime(context.latestArtifact.generatedAt)}.`
          : "No previous artifact is attached, so this behaves more like first-packet generation than a true refresh.",
        `${context.runAudit.length} run-audit entries are attached, with ${holdCount} non-pass gate decision${holdCount === 1 ? "" : "s"}.`,
      ].filter(Boolean) as string[],
      nextSteps: [
        "Review cycle drift, enabled sections, and packet basis before regenerating the artifact.",
        holdCount > 0
          ? "Clear or explicitly acknowledge held audit items before refreshing the packet."
          : "Once drift is understood, regenerate the packet from current cycle state.",
      ],
      evidence: [
        context.rtpCycle ? `RTP cycle updated: ${formatDateTime(context.rtpCycle.updatedAt)}` : null,
        `Latest artifact kind: ${context.report.latestArtifactKind ?? "None"}`,
        `Run-audit rows: ${context.runAudit.length}`,
      ].filter(Boolean) as string[],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "report-release" || workflowId === "rtp-packet-release") {
    return {
      workflowId,
      label,
      title: `Release check for ${context.report.title}`,
      summary: context.latestArtifact
        ? context.rtpCycle
          ? `${context.report.title} is an RTP-linked packet for ${context.rtpCycle.title}, and release confidence still depends on packet freshness, cycle drift, the run audit, and unresolved gate holds attached inside artifact metadata.`
          : `${context.report.title} has a generated ${context.latestArtifact.artifactKind} artifact, but release confidence still depends on the run audit, source context, and any unresolved gate holds attached inside that artifact metadata.`
        : `${context.report.title} is not release-ready yet because no generated artifact exists to review.`,
      findings: [
        context.rtpCycle ? `RTP cycle anchor: ${context.rtpCycle.title} · ${context.rtpCycle.status}.` : null,
        context.rtpCycle ? `Packet freshness: ${packetFreshness.label}. ${packetFreshness.detail}` : null,
        context.latestArtifact
          ? `Latest artifact generated ${formatDateTime(context.latestArtifact.generatedAt)}.`
          : "No artifact has been generated yet.",
        `${context.runAudit.length} run-audit entries are attached, with ${holdCount} non-pass gate decision${holdCount === 1 ? "" : "s"}.`,
        context.sourceContext
          ? `Source snapshot includes ${String(context.sourceContext.linkedRunCount ?? context.runs.length)} linked runs and ${String(context.sourceContext.decisionCount ?? 0)} decisions.`
          : "No structured sourceContext payload was captured on the latest artifact.",
      ].filter(Boolean) as string[],
      nextSteps: [
        context.latestArtifact ? "Review the latest artifact rather than the draft record alone before sharing anything." : "Generate an artifact first so there is a stable packet to review.",
        context.rtpCycle && packetPosture === "refresh"
          ? "Regenerate this RTP packet from current cycle state before treating it as board-ready."
          : null,
        holdCount > 0
          ? "Clear or explicitly acknowledge the held run-audit items before external release."
          : "Verify citations and narrative accuracy even though the current audit trail is materially cleaner.",
      ].filter(Boolean) as string[],
      evidence: [
        context.rtpCycle ? `RTP cycle: ${context.rtpCycle.id}` : null,
        `Linked runs: ${context.runs.length}`,
        `Enabled sections: ${context.enabledSections}/${context.sectionCount}`,
        `Artifacts: ${context.artifactCount}`,
      ].filter(Boolean) as string[],
      caution: "A generated packet is not self-certifying; release still requires human verification of claims, citations, and policy-sensitive framing.",
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `${context.kind === "rtp_packet_report" ? "RTP packet audit" : "Report audit"}: ${context.report.title}`,
    summary: `${context.report.title} is grounded on ${pluralize(context.runs.length, "linked run")}, ${pluralize(context.enabledSections, "enabled section")}, and ${pluralize(context.artifactCount, "generated artifact")}.`,
    findings: [
      context.rtpCycle ? `RTP cycle anchor: ${context.rtpCycle.title} · ${context.rtpCycle.status} · ${packetFreshness.label}.` : null,
      context.project ? `Project anchor: ${context.project.name}.` : "No project anchor is visible from this report snapshot.",
      context.runs.length > 0
        ? `Source runs: ${context.runs.slice(0, 3).map((run) => run.title).join(" · ")}.`
        : "No source runs are attached to the report.",
      context.engagementCampaign
        ? `Engagement linkage is active through ${context.engagementCampaign.title}.`
        : "No engagement linkage is visible through the report sections.",
    ].filter(Boolean) as string[],
    nextSteps: [
      context.rtpCycle && packetPosture !== "release"
        ? "Refresh this RTP packet from current cycle state before externalizing it."
        : null,
      context.runs.length > 0 ? "Cross-check the linked run summaries against the packet storyline." : "Attach source runs before treating the report as analytically grounded.",
      context.latestArtifact ? "Audit the latest artifact metadata rather than only the report record fields." : "Generate the first artifact to create a real review object.",
    ].filter(Boolean) as string[],
    evidence: [
      `Report type: ${context.report.reportType}`,
      context.rtpCycle ? `RTP cycle updated: ${formatDateTime(context.rtpCycle.updatedAt)}` : null,
      `Latest artifact kind: ${context.report.latestArtifactKind ?? "None"}`,
      `Run-audit rows: ${context.runAudit.length}`,
    ].filter(Boolean) as string[],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildRunResponse(context: RunAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Run brief";

  if (workflowId === "run-compare") {
    const deltas = context.baselineRun ? buildMetricDeltas(context.run.metrics, context.baselineRun.metrics) : [];
    const headline = deltas.filter((delta) => ["overallScore", "accessibilityScore", "safetyScore", "equityScore"].includes(delta.key));
    return {
      workflowId,
      label,
      title: `Run comparison: ${context.run.title}`,
      summary: context.baselineRun
        ? `${context.run.title} is paired against ${context.baselineRun.title}. The most useful read is the headline score movement: ${headline.map((item) => `${item.label} ${item.delta === null ? "flat" : item.delta > 0 ? `+${item.delta}` : `${item.delta}`}`).join(" · ")}.`
        : `${context.run.title} does not currently have a baseline attached, so a score-delta comparison is not available yet.`,
      findings: [
        context.baselineRun ? `Baseline: ${context.baselineRun.title} captured ${formatDateTime(context.baselineRun.createdAt)}.` : "No baseline run is attached.",
        context.baselineRun
          ? headline.map((item) => `${item.label}: current ${item.current ?? "N/A"} vs baseline ${item.baseline ?? "N/A"}`).join(" · ")
          : "Pin a baseline run from Analysis Studio or a scenario deep link to light up comparison mode.",
        asString(context.run.metrics.confidence)
          ? `Current run confidence: ${String(context.run.metrics.confidence)}.`
          : "No explicit confidence label is stored on the current run.",
      ],
      nextSteps: [
        context.baselineRun ? "Read the comparison surface together with saved map posture before treating every delta as purely design-driven." : "Attach a baseline if you need a before/after or alternative comparison argument.",
        "Keep exported narratives honest about source limitations and human-review requirements.",
      ],
      evidence: [
        `Current run: ${context.run.id}`,
        `Baseline run: ${context.baselineRun?.id ?? "None"}`,
        `Created: ${formatDateTime(context.run.createdAt)}`,
      ],
      caution: "Score movement alone is not enough; map posture, filter stack, and source quality still matter when interpreting deltas.",
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Run brief: ${context.run.title}`,
    summary: `${context.run.title} currently reads as overall ${metricLabel(context.run.metrics, "overallScore")}, with accessibility ${metricLabel(context.run.metrics, "accessibilityScore")}, safety ${metricLabel(context.run.metrics, "safetyScore")}, and equity ${metricLabel(context.run.metrics, "equityScore")}.`,
    findings: [
      context.run.summary || "No stored summary text is attached to this run.",
      asString(context.run.metrics.confidence)
        ? `Confidence label: ${String(context.run.metrics.confidence)}.`
        : "The run does not expose an explicit confidence label in metrics.",
      asString(context.run.metrics.transitAccessTier)
        ? `Transit access tier: ${String(context.run.metrics.transitAccessTier)}.`
        : "No explicit transit-access tier is stored on this run.",
    ],
    nextSteps: [
      context.baselineRun ? "Use the compare workflow if you need to explain movement against a baseline." : "If this run will support a decision memo, attach a baseline or scenario context next.",
      "Verify the run narrative and source posture before turning it into external-facing language.",
    ],
    evidence: [
      `Created: ${formatDateTime(context.run.createdAt)}`,
      context.run.queryText ? `Query: ${context.run.queryText}` : "No query text stored.",
      `Workspace: ${context.workspace.name ?? "Current workspace"}`,
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

export function buildAssistantResponse(
  context: AssistantContext,
  workflowId: string,
  question?: string | null,
  localConsoleState?: AssistantLocalConsoleState | null
): AssistantResponse {
  const response = (() => {
    switch (context.kind) {
    case "project":
      return buildProjectResponse(context, workflowId);
    case "rtp_registry":
      return buildRtpRegistryResponse(context, workflowId);
    case "rtp_cycle":
      return buildRtpResponse(context, workflowId);
    case "plan":
      return buildPlanResponse(context, workflowId);
    case "program":
      return buildProgramResponse(context, workflowId);
    case "scenario_set":
      return buildScenarioResponse(context, workflowId);
    case "model":
      return buildModelResponse(context, workflowId);
    case "report":
    case "rtp_packet_report":
      return buildReportResponse(context, workflowId);
    case "run":
      return buildRunResponse(context, workflowId);
    case "analysis_studio":
    case "workspace":
    default:
      return buildWorkspaceResponse(context, workflowId, question);
    }
  })();

  return applyLocalConsoleStateToResponse(response, localConsoleState);
}
