import {
  findAssistantAction,
  getAssistantActions,
  type AssistantPreview,
  type AssistantResponse,
} from "@/lib/assistant/catalog";
import type {
  AssistantContext,
  ModelAssistantContext,
  ProjectAssistantContext,
  ReportAssistantContext,
  RunAssistantContext,
  ScenarioAssistantContext,
  WorkspaceAssistantContext,
} from "@/lib/assistant/context";
import { buildMetricDeltas } from "@/lib/analysis/compare";

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
  const summary = context.currentRun
    ? `Grounded to ${context.currentRun.title} inside ${context.workspace.name ?? "the current workspace"}. I can brief the run, compare it to baseline, or summarize the surrounding planning context and current queue pressure.`
    : `Grounded to ${context.workspace.name ?? "the current workspace"}. I can summarize recent project and analysis activity, plus the shared workspace command queue, and point you at the next operator move.`;

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
      { label: "Plan", value: context.workspace.plan ?? "Unknown" },
    ],
    facts,
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildProjectPreview(context: ProjectAssistantContext): AssistantPreview {
  const openRisks = context.counts.risks;
  const openIssues = context.counts.issues;
  const blockedGate = context.stageGateSummary.blockedGate?.name ?? "No hold gate";

  return {
    kind: context.kind,
    title: context.project.name,
    summary: `Grounded to the full project record: delivery posture, stage-gate signals, linked datasets, and recent run activity are all in scope for this copilot pass.`,
    stats: [
      { label: "Status", value: context.project.status },
      { label: "Open risks", value: `${openRisks}` },
      { label: "Open issues", value: `${openIssues}` },
      { label: "Blocked gate", value: blockedGate },
    ],
    facts: [
      `${context.counts.deliverables} deliverables, ${context.counts.decisions} decisions, and ${context.counts.meetings} meetings are attached to this project surface.`,
      `${context.counts.linkedDatasets} linked datasets are visible, with ${context.counts.overlayReadyDatasets} already usable as analysis overlays.`,
      `${context.counts.recentRuns} recent analysis runs are visible from the same workspace.` ,
    ],
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
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildReportPreview(context: ReportAssistantContext): AssistantPreview {
  return {
    kind: context.kind,
    title: context.report.title,
    summary: `Grounded to this report packet's composition, linked runs, artifact history, and provenance metadata.`,
    stats: [
      { label: "Status", value: context.report.status },
      { label: "Runs", value: `${context.runs.length}` },
      { label: "Sections", value: `${context.enabledSections}/${context.sectionCount}` },
      { label: "Artifacts", value: `${context.artifactCount}` },
    ],
    facts: [
      context.project ? `Project anchor: ${context.project.name}` : "No project anchor is visible on this report snapshot.",
      context.latestArtifact
        ? `Latest artifact: ${context.latestArtifact.artifactKind} generated ${formatDateTime(context.latestArtifact.generatedAt)}.`
        : "No artifact has been generated yet.",
      context.engagementCampaign
        ? `Engagement linkage: ${context.engagementCampaign.title} (${context.engagementCampaign.status}).`
        : "No engagement campaign linkage is attached through report sections.",
    ],
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
    suggestedActions: getAssistantActions(context.kind),
  };
}

export function buildAssistantPreview(context: AssistantContext): AssistantPreview {
  switch (context.kind) {
    case "project":
      return buildProjectPreview(context);
    case "scenario_set":
      return buildScenarioPreview(context);
    case "model":
      return buildModelPreview(context);
    case "report":
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
    ],
  };
}

function buildProjectResponse(context: ProjectAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Project brief";
  const blockedGate = context.stageGateSummary.blockedGate;

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
      blockedGate
        ? `Gate pressure exists at ${blockedGate.gateId} · ${blockedGate.name}.`
        : `No formal stage gate is currently on hold; next gate cue is ${context.stageGateSummary.nextGate?.gateId ?? "not yet set"}.`,
    ],
    nextSteps: [
      blockedGate ? `Resolve ${blockedGate.gateId} evidence gaps before claiming the project is fully ready.` : "Use the next-gate cue to keep the project moving through the recorded workflow.",
      context.counts.overlayReadyDatasets > 0
        ? "Bring one overlay-ready dataset plus a current run into Analysis Studio for the next decision memo."
        : "Strengthen data linkage before leaning too hard on analytical claims.",
    ],
    evidence: [
      `Plan type: ${context.project.planType}`,
      `Stage-gate pass count: ${context.stageGateSummary.passCount}`,
      `Recent run count: ${context.counts.recentRuns}`,
    ],
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
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Report audit";
  const holdCount = context.runAudit.filter((item) => item.gate.decision !== "PASS").length;

  if (workflowId === "report-release") {
    return {
      workflowId,
      label,
      title: `Release check for ${context.report.title}`,
      summary: context.latestArtifact
        ? `${context.report.title} has a generated ${context.latestArtifact.artifactKind} artifact, but release confidence still depends on the run audit, source context, and any unresolved gate holds attached inside that artifact metadata.`
        : `${context.report.title} is not release-ready yet because no generated artifact exists to review.`,
      findings: [
        context.latestArtifact
          ? `Latest artifact generated ${formatDateTime(context.latestArtifact.generatedAt)}.`
          : "No artifact has been generated yet.",
        `${context.runAudit.length} run-audit entries are attached, with ${holdCount} non-pass gate decision${holdCount === 1 ? "" : "s"}.`,
        context.sourceContext
          ? `Source snapshot includes ${String(context.sourceContext.linkedRunCount ?? context.runs.length)} linked runs and ${String(context.sourceContext.decisionCount ?? 0)} decisions.`
          : "No structured sourceContext payload was captured on the latest artifact.",
      ],
      nextSteps: [
        context.latestArtifact ? "Review the latest artifact rather than the draft record alone before sharing anything." : "Generate an artifact first so there is a stable packet to review.",
        holdCount > 0
          ? "Clear or explicitly acknowledge the held run-audit items before external release."
          : "Verify citations and narrative accuracy even though the current audit trail is materially cleaner.",
      ],
      evidence: [
        `Linked runs: ${context.runs.length}`,
        `Enabled sections: ${context.enabledSections}/${context.sectionCount}`,
        `Artifacts: ${context.artifactCount}`,
      ],
      caution: "A generated packet is not self-certifying; release still requires human verification of claims, citations, and policy-sensitive framing.",
    };
  }

  return {
    workflowId,
    label,
    title: `Report audit: ${context.report.title}`,
    summary: `${context.report.title} is grounded on ${pluralize(context.runs.length, "linked run")}, ${pluralize(context.enabledSections, "enabled section")}, and ${pluralize(context.artifactCount, "generated artifact")}.`,
    findings: [
      context.project ? `Project anchor: ${context.project.name}.` : "No project anchor is visible from this report snapshot.",
      context.runs.length > 0
        ? `Source runs: ${context.runs.slice(0, 3).map((run) => run.title).join(" · ")}.`
        : "No source runs are attached to the report.",
      context.engagementCampaign
        ? `Engagement linkage is active through ${context.engagementCampaign.title}.`
        : "No engagement linkage is visible through the report sections.",
    ],
    nextSteps: [
      context.runs.length > 0 ? "Cross-check the linked run summaries against the packet storyline." : "Attach source runs before treating the report as analytically grounded.",
      context.latestArtifact ? "Audit the latest artifact metadata rather than only the report record fields." : "Generate the first artifact to create a real review object.",
    ],
    evidence: [
      `Report type: ${context.report.reportType}`,
      `Latest artifact kind: ${context.report.latestArtifactKind ?? "None"}`,
      `Run-audit rows: ${context.runAudit.length}`,
    ],
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
  };
}

export function buildAssistantResponse(
  context: AssistantContext,
  workflowId: string,
  question?: string | null
): AssistantResponse {
  switch (context.kind) {
    case "project":
      return buildProjectResponse(context, workflowId);
    case "scenario_set":
      return buildScenarioResponse(context, workflowId);
    case "model":
      return buildModelResponse(context, workflowId);
    case "report":
      return buildReportResponse(context, workflowId);
    case "run":
      return buildRunResponse(context, workflowId);
    case "analysis_studio":
    case "workspace":
    default:
      return buildWorkspaceResponse(context, workflowId, question);
  }
}
