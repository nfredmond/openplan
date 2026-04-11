import type { AssistantQuickLink } from "@/lib/assistant/catalog";
import type {
  AssistantContext,
  ModelAssistantContext,
  PlanAssistantContext,
  ProgramAssistantContext,
  ProjectAssistantContext,
  ReportAssistantContext,
  RunAssistantContext,
  ScenarioAssistantContext,
  WorkspaceAssistantContext,
} from "@/lib/assistant/context";

function buildAnalysisHref(runId: string, baselineRunId?: string | null): string {
  const params = new URLSearchParams({ runId });
  if (baselineRunId) params.set("baselineRunId", baselineRunId);
  return `/explore?${params.toString()}`;
}

function quickLink(
  id: string,
  label: string,
  href: string,
  options: {
    targetKind: AssistantQuickLink["targetKind"];
    actionClass: AssistantQuickLink["actionClass"];
    executionMode?: AssistantQuickLink["executionMode"];
    priority?: AssistantQuickLink["priority"];
    statusLabel?: string;
    reason?: string;
    approval?: AssistantQuickLink["approval"];
    auditEvent?: string;
    auditNote?: string;
  }
): AssistantQuickLink {
  return {
    id,
    label,
    href,
    targetKind: options.targetKind,
    actionClass: options.actionClass,
    executionMode: options.executionMode ?? "navigate",
    priority: options.priority,
    statusLabel: options.statusLabel,
    reason: options.reason,
    approval: options.approval,
    auditEvent: options.auditEvent,
    auditNote: options.auditNote,
  };
}

function compactQuickLinks(links: Array<AssistantQuickLink | null | undefined>): AssistantQuickLink[] {
  const seen = new Set<string>();
  const results: AssistantQuickLink[] = [];

  for (const link of links) {
    if (!link) continue;
    const key = `${link.id}::${link.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(link);
  }

  return results;
}

function buildWorkspaceOperations(context: WorkspaceAssistantContext): AssistantQuickLink[] {
  return compactQuickLinks([
    context.operationsSummary.nextCommand
      ? quickLink("workspace-next-command", `Open ${context.operationsSummary.nextCommand.title}`, context.operationsSummary.nextCommand.href, {
          targetKind: "workspace",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: "Queue pressure live",
          reason: "The shared command board currently outranks other visible work in this workspace.",
          approval: "review",
          auditEvent: "assistant.operation.workspace.next_command",
          auditNote: "Review the command-board rationale before changing records or regenerating artifacts.",
        })
      : null,
    context.currentRun
      ? quickLink(
          "workspace-analysis",
          context.baselineRun ? "Open Analysis Studio compare" : "Open Analysis Studio",
          buildAnalysisHref(context.currentRun.id, context.baselineRun?.id ?? null),
          {
            targetKind: "analysis_studio",
            actionClass: "review_analysis",
            priority: "primary",
            statusLabel: context.baselineRun ? "Comparison ready" : "Run ready",
            reason: context.baselineRun
              ? "A baseline is attached, so this is the strongest evidence-backed analysis read available now."
              : "A live run is present, but it still needs operator interpretation before downstream use.",
            approval: "review",
            auditEvent: "assistant.operation.workspace.analysis",
            auditNote: "Inspect map posture, filters, and source quality before treating deltas as decision-ready.",
          }
        )
      : null,
    context.recentProject
      ? quickLink("workspace-project", `Open ${context.recentProject.name}`, `/projects/${context.recentProject.id}`, {
          targetKind: "project",
          actionClass: "open_surface",
          priority: "secondary",
          statusLabel: "Freshest anchor",
          reason: "This is the latest visible project anchor from the current workspace snapshot.",
          approval: "safe",
          auditEvent: "assistant.operation.workspace.project",
          auditNote: "Navigation only. Record changes still happen inside the target surface.",
        })
      : null,
  ]);
}

function buildProjectOperations(context: ProjectAssistantContext): AssistantQuickLink[] {
  return compactQuickLinks([
    context.stageGateSummary.blockedGate
      ? quickLink("project-governance", "Open governance controls", `/projects/${context.project.id}#project-governance`, {
          targetKind: "project",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: "Gate attention",
          reason: "A blocked governance gate is the clearest recorded project control issue right now.",
          approval: "review",
          auditEvent: "assistant.operation.project.governance",
          auditNote: "Governance updates should preserve rationale, owners, and evidence trail integrity.",
        })
      : quickLink("project-controls", "Open project controls", `/projects/${context.project.id}#project-milestones`, {
          targetKind: "project",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: "Control queue live",
          reason: "Milestone, submittal, or invoice posture is the main next operator surface when no gate is blocked.",
          approval: "review",
          auditEvent: "assistant.operation.project.controls",
          auditNote: "Review milestone, submittal, and invoice posture before making downstream commitments.",
        }),
    context.counts.overlayReadyDatasets > 0 || context.counts.recentRuns > 0
      ? quickLink("project-reporting", "Open reporting and analysis context", `/projects/${context.project.id}#project-reporting`, {
          targetKind: "project",
          actionClass: "review_analysis",
          priority: "secondary",
          statusLabel: "Evidence lane ready",
          reason: "This project already has enough data or run context to support a stronger reporting review pass.",
          approval: "review",
          auditEvent: "assistant.operation.project.reporting",
          auditNote: "Cross-check packet provenance and run basis before externalizing any narrative.",
        })
      : null,
  ]);
}

function buildPlanOperations(context: PlanAssistantContext): AssistantQuickLink[] {
  return compactQuickLinks([
    context.operationsSummary.nextCommand
      ? quickLink("plan-next-command", `Open ${context.operationsSummary.nextCommand.title}`, context.operationsSummary.nextCommand.href, {
          targetKind: "plan",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: "Workspace command",
          reason: "The shared workspace queue is currently the strongest guide for what should happen around this plan.",
          approval: "review",
          auditEvent: "assistant.operation.plan.next_command",
          auditNote: "Use the workspace command rationale before changing packet or plan posture.",
        })
      : null,
    quickLink("plan-record", "Open plan record", `/plans/${context.plan.id}`, {
      targetKind: "plan",
      actionClass: "open_surface",
      priority: "secondary",
      statusLabel: "Record open",
      reason: "Use the plan record when you need the canonical basis before downstream packet or engagement work.",
      approval: "safe",
      auditEvent: "assistant.operation.plan.record",
      auditNote: "Navigation only. Plan edits still require action in the destination screen.",
    }),
    context.project
      ? quickLink("plan-project", `Open ${context.project.name}`, `/projects/${context.project.id}`, {
          targetKind: "project",
          actionClass: "open_surface",
          priority: "supporting",
          statusLabel: "Delivery anchor",
          reason: "This linked project is the best place to keep plan work tied to actual delivery posture.",
          approval: "safe",
          auditEvent: "assistant.operation.plan.project_anchor",
          auditNote: "Use the linked project as the delivery anchor before widening scope.",
        })
      : null,
  ]);
}

function buildProgramOperations(context: ProgramAssistantContext): AssistantQuickLink[] {
  return compactQuickLinks([
    context.packetSummary.recommendedReport
      ? quickLink("program-recommended-packet", "Open recommended packet", `/reports/${context.packetSummary.recommendedReport.id}`, {
          targetKind: "report",
          actionClass: "review_packet",
          priority: "primary",
          statusLabel: "Packet attention",
          reason: "This recommended packet is the strongest current package-level evidence surface.",
          approval: "review",
          auditEvent: "assistant.operation.program.packet",
          auditNote: "Verify freshness, source drift, and packet audit posture before release decisions.",
        })
      : null,
    context.operationsSummary.nextCommand
      ? quickLink("program-next-command", `Open ${context.operationsSummary.nextCommand.title}`, context.operationsSummary.nextCommand.href, {
          targetKind: "program",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: "Workspace command",
          reason: "The shared workspace queue currently has the clearest guidance for what should move around this package.",
          approval: "review",
          auditEvent: "assistant.operation.program.next_command",
          auditNote: "Keep program/package actions aligned with the shared workspace queue before changing records.",
        })
      : null,
    quickLink("program-record", "Open program record", `/programs/${context.program.id}`, {
      targetKind: "program",
      actionClass: "open_surface",
      priority: "secondary",
      statusLabel: "Record open",
      reason: "Use the program record for the canonical package basis before changing funding or packet posture.",
      approval: "safe",
      auditEvent: "assistant.operation.program.record",
      auditNote: "Navigation only. Funding and packet changes still happen inside the destination screen.",
    }),
  ]);
}

function buildScenarioOperations(context: ScenarioAssistantContext): AssistantQuickLink[] {
  return compactQuickLinks([
    quickLink("scenario-record", "Open scenario set", `/scenarios/${context.scenarioSet.id}`, {
      targetKind: "scenario_set",
      actionClass: "review_analysis",
      priority: "primary",
      statusLabel: "Comparison review",
      reason: "Scenario assumptions and baseline pairing still need operator review before they drive downstream claims.",
      approval: "review",
      auditEvent: "assistant.operation.scenario.record",
      auditNote: "Check baseline pairing and assumptions before pushing scenario claims downstream.",
    }),
  ]);
}

function buildModelOperations(context: ModelAssistantContext): AssistantQuickLink[] {
  return compactQuickLinks([
    quickLink("model-record", "Open model record", `/models/${context.model.id}`, {
      targetKind: "model",
      actionClass: "inspect_readiness",
      priority: "primary",
      statusLabel: "Readiness review",
      reason: "Model reuse or launch decisions should follow an explicit readiness and validation check.",
      approval: "review",
      auditEvent: "assistant.operation.model.record",
      auditNote: "Readiness and validation posture should be reviewed before launch or reuse.",
    }),
  ]);
}

function buildReportOperations(context: ReportAssistantContext): AssistantQuickLink[] {
  return compactQuickLinks([
    quickLink("report-detail", "Open report detail", `/reports/${context.report.id}`, {
      targetKind: "report",
      actionClass: "review_packet",
      priority: "primary",
      statusLabel: "Packet review",
      reason: "Report detail is the canonical packet audit surface for provenance, drift, and artifact history.",
      approval: "review",
      auditEvent: "assistant.operation.report.detail",
      auditNote: "Use report detail to inspect provenance, drift, and artifact history before sharing.",
    }),
    context.project
      ? quickLink("report-project", `Open ${context.project.name}`, `/projects/${context.project.id}#project-reporting`, {
          targetKind: "project",
          actionClass: "review_controls",
          priority: "secondary",
          statusLabel: "Control-room trace",
          reason: "Project reporting remains the best cross-check when packet work needs delivery context.",
          approval: "review",
          auditEvent: "assistant.operation.report.project_anchor",
          auditNote: "Keep packet work tied back to the project control room and reporting lane.",
        })
      : null,
  ]);
}

function buildRunOperations(context: RunAssistantContext): AssistantQuickLink[] {
  return compactQuickLinks([
    quickLink(
      "run-analysis",
      context.baselineRun ? "Open Analysis Studio compare" : "Open Analysis Studio",
      buildAnalysisHref(context.run.id, context.baselineRun?.id ?? null),
      {
        targetKind: "analysis_studio",
        actionClass: "review_analysis",
        priority: "primary",
        statusLabel: context.baselineRun ? "Comparison ready" : "Run ready",
        reason: context.baselineRun
          ? "This run already has a baseline pair, so it is ready for a more defensible comparison read."
          : "This run is visible, but it still needs operator interpretation before it should shape decisions.",
        approval: "review",
        auditEvent: "assistant.operation.run.analysis",
        auditNote: "Inspect map posture, filters, and source quality before using the run in decisions.",
      }
    ),
  ]);
}

export function buildAssistantOperations(context: AssistantContext): AssistantQuickLink[] {
  switch (context.kind) {
    case "project":
      return buildProjectOperations(context);
    case "plan":
      return buildPlanOperations(context);
    case "program":
      return buildProgramOperations(context);
    case "scenario_set":
      return buildScenarioOperations(context);
    case "model":
      return buildModelOperations(context);
    case "report":
      return buildReportOperations(context);
    case "run":
      return buildRunOperations(context);
    case "analysis_studio":
    case "workspace":
    default:
      return buildWorkspaceOperations(context);
  }
}
