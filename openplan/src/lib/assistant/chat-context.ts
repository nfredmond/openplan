import type {
  AssistantContext,
  ProjectAssistantContext,
  ProgramAssistantContext,
  WorkspaceAssistantContext,
} from "@/lib/assistant/context";

/**
 * Pure serialization of an RLS-scoped AssistantContext into a compact,
 * information-dense system prompt for the streaming chat endpoint.
 *
 * No I/O happens here — the caller loads the context; this module only
 * formats it. Keeping it pure makes the prompt unit-testable.
 */

export const ASSISTANT_CHAT_CONTEXT_MAX_CHARS = 6000;
export const ASSISTANT_CHAT_CONTEXT_TRUNCATION_MARKER =
  "[Additional workspace context omitted to fit the prompt budget.]";

const ASSISTANT_CHAT_INSTRUCTIONS = [
  "You are the OpenPlan Planner Agent, a copilot for city and regional transportation planners.",
  "Ground every answer ONLY in the workspace context below plus general planning knowledge (federal/state programs, RTP practice, modeling methodology).",
  "Never invent workspace data. If a number, record, or status is not in the context, say it is not visible from the current surface instead of guessing.",
  "Model results in OpenPlan are screening-grade. When discussing model or run results, preserve that caveat: they support prioritization and narrative, not final engineering or investment-grade forecasts.",
  "Answer concisely in plain language. Prefer short paragraphs or tight lists over long essays.",
  "You cannot execute actions from chat. When an action would help, point the planner at the existing OpenPlan surface (for example the suggested-action buttons in this panel, or the relevant project, RTP, funding, or report screen).",
].join("\n");

function fmtCurrency(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function compactJson(value: Record<string, unknown>, maxChars: number): string {
  const serialized = JSON.stringify(value);
  if (!serialized || serialized === "{}") return "{}";
  if (serialized.length <= maxChars) return serialized;
  return `${serialized.slice(0, maxChars)}…`;
}

function workspaceLine(workspace: AssistantContext["workspace"]): string {
  const parts = [`Workspace: ${workspace.name ?? "(unnamed workspace)"}`];
  if (workspace.plan) parts.push(`plan tier ${workspace.plan}`);
  if (workspace.role) parts.push(`your role ${workspace.role}`);
  return parts.join(" · ");
}

function fundingSummaryLines(
  fundingSummary: ProjectAssistantContext["fundingSummary"] | ProgramAssistantContext["fundingSummary"]
): string[] {
  const lines: string[] = [];
  lines.push(
    `Funding posture: ${fundingSummary.opportunityCount} opportunities (${fundingSummary.openCount} open, ${fundingSummary.closingSoonCount} closing soon, ${fundingSummary.overdueDecisionCount} overdue decisions, ${fundingSummary.pursueCount} marked pursue) · ${fundingSummary.awardRecordCount} award records`
  );

  const need = fmtCurrency(fundingSummary.fundingNeedAmount);
  const gap = fmtCurrency(fundingSummary.gapAmount);
  const uninvoiced = fmtCurrency(fundingSummary.uninvoicedAwardAmount);
  const amounts: string[] = [];
  if (need) amounts.push(`need ${need}`);
  if (gap) amounts.push(`gap ${gap}`);
  if (uninvoiced) amounts.push(`uninvoiced awards ${uninvoiced}`);
  if (fundingSummary.reimbursementStatus) amounts.push(`reimbursement ${fundingSummary.reimbursementStatus}`);
  if (amounts.length) lines.push(`Funding amounts: ${amounts.join(" · ")}`);

  if (fundingSummary.leadOpportunity) {
    const lead = fundingSummary.leadOpportunity;
    const closes = fmtDate(lead.closesAt);
    lines.push(
      `Lead funding opportunity: "${lead.title}" (status ${lead.status ?? "unknown"}, decision ${lead.decisionState ?? "undecided"}${closes ? `, closes ${closes}` : ""})`
    );
  }
  if (fundingSummary.leadOverdueOpportunity) {
    lines.push(`Overdue decision: "${fundingSummary.leadOverdueOpportunity.title}"`);
  }

  return lines;
}

function operationsSummaryLines(operationsSummary: WorkspaceAssistantContext["operationsSummary"]): string[] {
  const counts = operationsSummary.counts;
  const lines = [
    `Operations posture: ${operationsSummary.posture} — ${operationsSummary.headline}`,
    `Portfolio counts: ${counts.projects} projects (${counts.activeProjects} active) · ${counts.plans} plans (${counts.plansNeedingSetup} needing setup) · ${counts.programs} programs (${counts.activePrograms} active) · ${counts.reports} reports (${counts.reportRefreshRecommended} refresh recommended, ${counts.reportNoPacket} without packets)`,
    `Funding queue: ${counts.fundingOpportunities} opportunities (${counts.openFundingOpportunities} open, ${counts.closingSoonFundingOpportunities} closing soon, ${counts.overdueDecisionFundingOpportunities} overdue decisions) · ${counts.projectFundingGapProjects} projects with funding gaps`,
    `Command queue depth: ${counts.queueDepth} · RTP funding-review packets: ${counts.rtpFundingReviewPackets}`,
  ];

  if (operationsSummary.nextCommand) {
    lines.push(
      `Next queued command: ${operationsSummary.nextCommand.title} — ${operationsSummary.nextCommand.detail}`
    );
  }

  return lines;
}

export function buildAssistantChatContextLines(context: AssistantContext): string[] {
  const lines: string[] = [`Current surface: ${context.kind.replace(/_/g, " ")}`, workspaceLine(context.workspace)];

  switch (context.kind) {
    case "workspace":
    case "analysis_studio": {
      if (context.recentProject) {
        lines.push(
          `Most recent project: "${context.recentProject.name}" (status ${context.recentProject.status}, ${context.recentProject.planType}, phase ${context.recentProject.deliveryPhase}, updated ${fmtDate(context.recentProject.updatedAt) ?? "unknown"})`
        );
      }
      if (context.recentRuns.length) {
        lines.push(
          `Recent analysis runs: ${context.recentRuns
            .slice(0, 3)
            .map((run) => `"${run.title}" (${fmtDate(run.createdAt) ?? "unknown date"})`)
            .join(", ")}`
        );
      }
      if (context.currentRun) {
        lines.push(
          `Current run on surface: "${context.currentRun.title}" — metrics ${compactJson(context.currentRun.metrics, 700)}`
        );
      }
      if (context.baselineRun) {
        lines.push(
          `Baseline run for comparison: "${context.baselineRun.title}" — metrics ${compactJson(context.baselineRun.metrics, 700)}`
        );
      }
      lines.push(...operationsSummaryLines(context.operationsSummary));
      break;
    }

    case "project": {
      lines.push(
        `Project: "${context.project.name}" — status ${context.project.status}, type ${context.project.planType}, phase ${context.project.deliveryPhase}, updated ${fmtDate(context.project.updatedAt) ?? "unknown"}`
      );
      if (context.project.summary) lines.push(`Project summary: ${context.project.summary}`);
      lines.push(
        `Project counts: ${context.counts.deliverables} deliverables · ${context.counts.risks} risks · ${context.counts.issues} issues · ${context.counts.decisions} decisions · ${context.counts.meetings} meetings · ${context.counts.linkedDatasets} linked datasets (${context.counts.overlayReadyDatasets} overlay-ready) · ${context.counts.recentRuns} recent runs`
      );
      lines.push(...fundingSummaryLines(context.fundingSummary));
      if (context.recentRuns.length) {
        lines.push(
          `Recent runs: ${context.recentRuns
            .slice(0, 3)
            .map((run) => `"${run.title}"${run.summaryText ? ` — ${run.summaryText}` : ""}`)
            .join(" | ")}`
        );
      }
      lines.push(
        `Report posture: ${context.reportSummary.linkedReportCount} linked reports (${context.reportSummary.evidenceBackedCount} evidence-backed, ${context.reportSummary.noPacketCount} without packets, ${context.reportSummary.refreshRecommendedCount} refresh recommended)`
      );
      break;
    }

    case "rtp_registry": {
      lines.push(
        `RTP registry: ${context.counts.cycles} cycles (${context.counts.draftCycles} draft, ${context.counts.publicReviewCycles} in public review, ${context.counts.adoptedCycles} adopted, ${context.counts.archivedCycles} archived)`
      );
      lines.push(
        `RTP packet posture: ${context.counts.packetReports} packet reports · ${context.counts.noPacketCount} cycles without packets · ${context.counts.refreshRecommendedCount} refresh recommended`
      );
      if (context.recommendedCycle) {
        lines.push(
          `Recommended cycle: "${context.recommendedCycle.title}" (status ${context.recommendedCycle.status}, packet freshness ${context.recommendedCycle.packetFreshnessLabel}, ${context.recommendedCycle.packetReportCount} packet reports)`
        );
      }
      lines.push(...operationsSummaryLines(context.operationsSummary));
      break;
    }

    case "rtp_cycle": {
      const cycle = context.rtpCycle;
      const horizon =
        cycle.horizonStartYear && cycle.horizonEndYear ? `${cycle.horizonStartYear}–${cycle.horizonEndYear}` : null;
      lines.push(
        `RTP cycle: "${cycle.title}" — status ${cycle.status}${horizon ? `, horizon ${horizon}` : ""}${cycle.geographyLabel ? `, geography ${cycle.geographyLabel}` : ""}${cycle.adoptionTargetDate ? `, adoption target ${fmtDate(cycle.adoptionTargetDate)}` : ""}`
      );
      if (cycle.summary) lines.push(`Cycle summary: ${cycle.summary}`);
      lines.push(
        `Cycle counts: ${context.counts.chapters} chapters (${context.counts.readyForReviewChapters} ready for review, ${context.counts.completeChapters} complete) · ${context.counts.linkedProjects} linked projects · ${context.counts.engagementCampaigns} engagement campaigns · ${context.counts.packetReports} packet reports`
      );
      lines.push(
        `Packet posture: ${context.packetSummary.linkedReportCount} linked reports · ${context.packetSummary.noPacketCount} without packets · ${context.packetSummary.refreshRecommendedCount} refresh recommended`
      );
      lines.push(...operationsSummaryLines(context.operationsSummary));
      break;
    }

    case "plan": {
      lines.push(
        `Plan: "${context.plan.title}" — status ${context.plan.status}, type ${context.plan.planType}${context.plan.horizonYear ? `, horizon ${context.plan.horizonYear}` : ""}${context.plan.geographyLabel ? `, geography ${context.plan.geographyLabel}` : ""}`
      );
      if (context.plan.summary) lines.push(`Plan summary: ${context.plan.summary}`);
      if (context.project) lines.push(`Parent project: "${context.project.name}"`);
      lines.push(
        `Plan linkages: ${context.linkageCounts.scenarios} scenario sets · ${context.linkageCounts.engagementCampaigns} engagement campaigns · ${context.linkageCounts.reports} reports · ${context.linkageCounts.relatedProjects} related projects`
      );
      lines.push(...operationsSummaryLines(context.operationsSummary));
      break;
    }

    case "program": {
      lines.push(
        `Program: "${context.program.title}" — status ${context.program.status}, type ${context.program.programType}, cycle ${context.program.cycleName}${context.program.sponsorAgency ? `, sponsor ${context.program.sponsorAgency}` : ""}`
      );
      if (context.program.summary) lines.push(`Program summary: ${context.program.summary}`);
      if (context.project) lines.push(`Parent project: "${context.project.name}"`);
      lines.push(...fundingSummaryLines(context.fundingSummary));
      lines.push(
        `Program linkages: ${context.linkageCounts.plans} plans · ${context.linkageCounts.reports} reports · ${context.linkageCounts.engagementCampaigns} engagement campaigns`
      );
      lines.push(
        `Packet posture: ${context.packetSummary.linkedReportCount} linked reports · ${context.packetSummary.attentionCount} needing attention · ${context.packetSummary.refreshRecommendedCount} refresh recommended`
      );
      lines.push(...operationsSummaryLines(context.operationsSummary));
      break;
    }

    case "scenario_set": {
      lines.push(
        `Scenario set: "${context.scenarioSet.title}" — status ${context.scenarioSet.status}${context.scenarioSet.planningQuestion ? `, planning question: ${context.scenarioSet.planningQuestion}` : ""}`
      );
      if (context.scenarioSet.summary) lines.push(`Scenario summary: ${context.scenarioSet.summary}`);
      if (context.project) lines.push(`Parent project: "${context.project.name}"`);
      lines.push(
        `Scenario structure: baseline ${context.baselineEntry ? `"${context.baselineEntry.label}"${context.baselineEntry.attachedRunId ? " (run attached)" : " (no run attached)"}` : "not defined"} · ${context.alternativeCount} alternatives · ${context.linkedReports.length} linked reports`
      );
      break;
    }

    case "model": {
      lines.push(
        `Model: "${context.model.title}" — status ${context.model.status}, family ${context.model.modelFamily}${context.schemaPending ? " (schema pending — modeling tables not yet applied)" : ""}`
      );
      if (context.model.summary) lines.push(`Model summary: ${context.model.summary}`);
      if (context.scenarioEntryOptions.length) {
        lines.push(
          `Scenario entries available: ${context.scenarioEntryOptions
            .slice(0, 4)
            .map((entry) => `"${entry.label}" (${entry.entryType}, ${entry.assumptionCount} assumptions)`)
            .join(", ")}`
        );
      }
      if (context.recentModelRuns.length) {
        lines.push(
          `Recent model runs: ${context.recentModelRuns
            .slice(0, 3)
            .map((run) => `"${run.runTitle}" (${run.status})`)
            .join(", ")}`
        );
      }
      break;
    }

    case "report":
    case "rtp_packet_report": {
      lines.push(
        `Report: "${context.report.title}" — status ${context.report.status}, type ${context.report.reportType}, ${context.enabledSections}/${context.sectionCount} sections enabled, ${context.artifactCount} artifacts${context.latestArtifact ? `, latest artifact ${context.latestArtifact.artifactKind} generated ${fmtDate(context.latestArtifact.generatedAt)}` : ", no artifact generated yet"}`
      );
      if (context.report.summary) lines.push(`Report summary: ${context.report.summary}`);
      if (context.project) lines.push(`Linked project: "${context.project.name}"`);
      if (context.rtpCycle) lines.push(`Linked RTP cycle: "${context.rtpCycle.title}" (status ${context.rtpCycle.status})`);
      if (context.runs.length) {
        lines.push(
          `Evidence runs: ${context.runs
            .slice(0, 3)
            .map((run) => `"${run.title}"${run.summaryText ? ` — ${run.summaryText}` : ""}`)
            .join(" | ")}`
        );
      }
      break;
    }

    case "run": {
      lines.push(
        `Analysis run: "${context.run.title}" (created ${fmtDate(context.run.createdAt) ?? "unknown"})${context.run.queryText ? ` — query: ${context.run.queryText}` : ""}`
      );
      if (context.run.summary) lines.push(`Run summary: ${context.run.summary}`);
      lines.push(`Run metrics: ${compactJson(context.run.metrics, 900)}`);
      if (context.baselineRun) {
        lines.push(
          `Baseline run: "${context.baselineRun.title}" — metrics ${compactJson(context.baselineRun.metrics, 900)}`
        );
      }
      break;
    }
  }

  return lines;
}

export function buildAssistantChatSystemPrompt(
  context: AssistantContext,
  options?: { maxContextChars?: number }
): string {
  const maxContextChars = options?.maxContextChars ?? ASSISTANT_CHAT_CONTEXT_MAX_CHARS;
  const lines = buildAssistantChatContextLines(context);

  const kept: string[] = [];
  let used = 0;
  let truncated = false;

  for (const line of lines) {
    const cost = line.length + 1;
    if (used + cost > maxContextChars) {
      truncated = true;
      break;
    }
    kept.push(line);
    used += cost;
  }

  if (truncated) {
    kept.push(ASSISTANT_CHAT_CONTEXT_TRUNCATION_MARKER);
  }

  return [ASSISTANT_CHAT_INSTRUCTIONS, "", "WORKSPACE CONTEXT (RLS-scoped, current surface):", ...kept.map((line) => `- ${line}`)].join(
    "\n"
  );
}
