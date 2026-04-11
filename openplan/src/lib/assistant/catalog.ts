export type AssistantTargetKind =
  | "workspace"
  | "analysis_studio"
  | "project"
  | "plan"
  | "program"
  | "scenario_set"
  | "model"
  | "report"
  | "run";

export type AssistantTarget = {
  kind: AssistantTargetKind;
  id: string | null;
  workspaceId: string | null;
  runId: string | null;
  baselineRunId: string | null;
};

export type AssistantAction = {
  id: string;
  label: string;
  description: string;
  prompt: string;
};

export type AssistantPreviewStat = {
  label: string;
  value: string;
};

export type AssistantQuickLink = {
  id: string;
  label: string;
  href: string;
  targetKind: AssistantTargetKind;
  actionClass: "open_surface" | "review_controls" | "review_analysis" | "review_packet" | "inspect_readiness";
  executionMode: "navigate" | "future_agent_action";
  priority?: "primary" | "secondary" | "supporting";
  statusLabel?: string;
  reason?: string;
  approval?: "safe" | "review" | "approval_required";
  auditEvent?: string;
  auditNote?: string;
};

export type AssistantOperationUrgency = "high" | "medium" | "low";
export type AssistantOperationTone = "danger" | "warning" | "info" | "success" | "neutral";

export type AssistantPreview = {
  kind: AssistantTargetKind;
  title: string;
  summary: string;
  stats: AssistantPreviewStat[];
  facts: string[];
  operatorCue?: {
    label: string;
    title: string;
    detail: string;
  };
  quickLinks?: AssistantQuickLink[];
  suggestedActions: AssistantAction[];
};

export type AssistantResponse = {
  workflowId: string;
  label: string;
  title: string;
  summary: string;
  findings: string[];
  nextSteps: string[];
  evidence: string[];
  caution?: string;
  quickLinks?: AssistantQuickLink[];
};

const ACTIONS_BY_KIND: Record<AssistantTargetKind, AssistantAction[]> = {
  workspace: [
    {
      id: "workspace-overview",
      label: "Workspace overview",
      description: "Summarize the active planning workspace and recent activity.",
      prompt: "Give me the key workspace brief and the next operator move.",
    },
    {
      id: "analysis-focus",
      label: "Analysis focus",
      description: "Call out the most decision-useful analysis or run context.",
      prompt: "What analysis surface should I focus on next and why?",
    },
  ],
  analysis_studio: [
    {
      id: "analysis-focus",
      label: "Studio brief",
      description: "Summarize the current analysis posture and attached run context.",
      prompt: "Summarize the current Analysis Studio posture and what I should review next.",
    },
    {
      id: "run-compare",
      label: "Compare runs",
      description: "Explain current-vs-baseline movement when both runs are present.",
      prompt: "Compare the current run against the baseline and call out the important score shifts.",
    },
  ],
  project: [
    {
      id: "project-brief",
      label: "Project brief",
      description: "Summarize status, controls, and decision-useful context for the project.",
      prompt: "Give me the project brief and the next operator move.",
    },
    {
      id: "project-blockers",
      label: "Blockers",
      description: "Surface open risks, issues, and gate blockers.",
      prompt: "What is blocking this project right now?",
    },
    {
      id: "project-data",
      label: "Data readiness",
      description: "Show linked dataset coverage and run support around this project.",
      prompt: "How strong is the data and analysis support for this project?",
    },
  ],
  plan: [
    {
      id: "plan-brief",
      label: "Plan brief",
      description: "Summarize plan readiness, linked evidence, and the next operator move.",
      prompt: "Give me the plan brief and the next operator move.",
    },
    {
      id: "plan-gaps",
      label: "Plan gaps",
      description: "Surface what this plan is still missing before it is trustworthy for handoff.",
      prompt: "What is this plan still missing, and what should I fix next?",
    },
  ],
  program: [
    {
      id: "program-brief",
      label: "Program brief",
      description: "Summarize package readiness, packet posture, and linked funding context.",
      prompt: "Give me the program brief and the next operator move.",
    },
    {
      id: "program-packet",
      label: "Packet posture",
      description: "Explain packet readiness, stale basis, and what should be refreshed or created next.",
      prompt: "What packet or evidence work does this program need next?",
    },
  ],
  scenario_set: [
    {
      id: "scenario-compare",
      label: "Scenario compare",
      description: "Summarize which alternatives materially move the scorecard.",
      prompt: "Compare the ready alternatives against baseline and tell me what moved.",
    },
    {
      id: "scenario-handoff",
      label: "Handoff path",
      description: "Explain what is ready for Analysis Studio or reporting handoff.",
      prompt: "What scenario evidence is actually ready to hand off into studio or reporting?",
    },
  ],
  model: [
    {
      id: "model-readiness",
      label: "Model readiness",
      description: "Summarize config, linkage, and execution readiness.",
      prompt: "Is this model ready for serious use, and what still needs work?",
    },
    {
      id: "model-launch",
      label: "Launch plan",
      description: "Recommend the next launch or validation step from the current model record.",
      prompt: "What is the safest useful next launch step for this model?",
    },
  ],
  report: [
    {
      id: "report-audit",
      label: "Report audit",
      description: "Summarize source runs, sections, and artifact posture.",
      prompt: "Audit this report for provenance and source posture.",
    },
    {
      id: "report-release",
      label: "Release check",
      description: "Call out what still needs review before sharing the packet.",
      prompt: "Is this report ready to share, and what still needs verification?",
    },
  ],
  run: [
    {
      id: "run-brief",
      label: "Run brief",
      description: "Summarize scores, confidence, and source posture for this run.",
      prompt: "Give me a concise operator brief for this run.",
    },
    {
      id: "run-compare",
      label: "Run compare",
      description: "Compare this run to the attached baseline when available.",
      prompt: "Compare this run to baseline and tell me what changed.",
    },
  ],
};

export function getAssistantActions(kind: AssistantTargetKind): AssistantAction[] {
  return ACTIONS_BY_KIND[kind] ?? ACTIONS_BY_KIND.workspace;
}

export function formatAssistantOperationActionClass(link: AssistantQuickLink): string {
  switch (link.actionClass) {
    case "review_controls":
      return "Review controls";
    case "review_analysis":
      return "Review analysis";
    case "review_packet":
      return "Review packet";
    case "inspect_readiness":
      return "Inspect readiness";
    case "open_surface":
    default:
      return "Open surface";
  }
}

export function resolveAssistantOperationUrgency(link: AssistantQuickLink): AssistantOperationUrgency {
  if (link.approval === "approval_required") return "high";
  if (link.priority === "primary" && (link.actionClass === "review_controls" || link.actionClass === "review_packet")) {
    return "high";
  }
  if (link.priority === "primary" || link.approval === "review" || link.priority === "secondary") {
    return "medium";
  }
  return "low";
}

export function resolveAssistantOperationTone(link: AssistantQuickLink): AssistantOperationTone {
  if (link.approval === "approval_required") return "danger";
  switch (link.actionClass) {
    case "review_controls":
    case "review_packet":
      return "warning";
    case "review_analysis":
    case "inspect_readiness":
      return "info";
    case "open_surface":
      return link.approval === "safe" ? "success" : "neutral";
    default:
      return "neutral";
  }
}

function operationUrgencyRank(urgency: AssistantOperationUrgency): number {
  switch (urgency) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
    default:
      return 2;
  }
}

function operationPriorityRank(priority: AssistantQuickLink["priority"]): number {
  switch (priority) {
    case "primary":
      return 0;
    case "secondary":
      return 1;
    case "supporting":
    default:
      return 2;
  }
}

export function compareAssistantOperations(a: AssistantQuickLink, b: AssistantQuickLink): number {
  const urgencyDelta = operationUrgencyRank(resolveAssistantOperationUrgency(a)) - operationUrgencyRank(resolveAssistantOperationUrgency(b));
  if (urgencyDelta !== 0) return urgencyDelta;

  const priorityDelta = operationPriorityRank(a.priority) - operationPriorityRank(b.priority);
  if (priorityDelta !== 0) return priorityDelta;

  return a.label.localeCompare(b.label);
}

export function resolveAssistantTarget(
  pathname: string,
  searchParams: Pick<URLSearchParams, "get">
): AssistantTarget {
  const segments = pathname.split("/").filter(Boolean);
  const secondSegment = segments[1] ?? null;
  const currentRunId = searchParams.get("runId");
  const baselineRunId = searchParams.get("baselineRunId");
  const workspaceId = searchParams.get("workspaceId");

  if (segments[0] === "projects" && secondSegment) {
    return { kind: "project", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "plans" && secondSegment) {
    return { kind: "plan", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "programs" && secondSegment) {
    return { kind: "program", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "scenarios" && secondSegment) {
    return { kind: "scenario_set", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "models" && secondSegment) {
    return { kind: "model", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "reports" && secondSegment) {
    return { kind: "report", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "explore") {
    return {
      kind: currentRunId ? "run" : "analysis_studio",
      id: currentRunId,
      workspaceId,
      runId: currentRunId,
      baselineRunId,
    };
  }

  return { kind: "workspace", id: null, workspaceId, runId: currentRunId, baselineRunId };
}

function includesAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

export function resolveAssistantWorkflowId(
  kind: AssistantTargetKind,
  requestedWorkflowId?: string | null,
  question?: string | null
): string {
  const validActions = getAssistantActions(kind);
  if (requestedWorkflowId && validActions.some((action) => action.id === requestedWorkflowId)) {
    return requestedWorkflowId;
  }

  const normalized = (question ?? "").trim().toLowerCase();
  if (!normalized) {
    return validActions[0]?.id ?? "workspace-overview";
  }

  if (kind === "project") {
    if (includesAny(normalized, ["block", "risk", "issue", "hold", "gate"])) return "project-blockers";
    if (includesAny(normalized, ["data", "dataset", "source", "coverage", "overlay"])) return "project-data";
    return "project-brief";
  }

  if (kind === "plan") {
    if (includesAny(normalized, ["gap", "missing", "fix", "trust", "ready"])) return "plan-gaps";
    return "plan-brief";
  }

  if (kind === "program") {
    if (includesAny(normalized, ["packet", "report", "refresh", "evidence", "basis"])) return "program-packet";
    return "program-brief";
  }

  if (kind === "scenario_set") {
    if (includesAny(normalized, ["handoff", "report", "studio", "ready"])) return "scenario-handoff";
    return "scenario-compare";
  }

  if (kind === "model") {
    if (includesAny(normalized, ["launch", "run", "validate", "next step"])) return "model-launch";
    return "model-readiness";
  }

  if (kind === "report") {
    if (includesAny(normalized, ["share", "release", "client", "ready", "verify"])) return "report-release";
    return "report-audit";
  }

  if (kind === "run" || kind === "analysis_studio") {
    if (includesAny(normalized, ["compare", "baseline", "delta", "changed"])) return "run-compare";
    return kind === "analysis_studio" ? "analysis-focus" : "run-brief";
  }

  return validActions[0]?.id ?? "workspace-overview";
}

export function findAssistantAction(kind: AssistantTargetKind, workflowId: string): AssistantAction | null {
  return getAssistantActions(kind).find((action) => action.id === workflowId) ?? null;
}
