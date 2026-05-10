import type { StatusTone } from "@/lib/ui/status";
import type { WorkspaceCommandQueueItem, WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

export type WorkflowNextActionGroupKey =
  | "rtp"
  | "grants"
  | "engagement"
  | "analysis-modeling"
  | "aerial"
  | "admin-release-proof";

export const COMMAND_CENTER_ROADMAP_WORKFLOW_LANE_KEYS = [
  "rtp",
  "grants",
  "engagement",
  "analysis-modeling",
  "aerial",
  "admin-release-proof",
] as const satisfies readonly WorkflowNextActionGroupKey[];

export type WorkflowNextActionEntry = {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: StatusTone;
  source: "queue" | "standing-check";
  badges: Array<{
    label: string;
    value?: string | number | null;
  }>;
  command?: WorkspaceCommandQueueItem;
};

export type WorkflowNextActionGroup = {
  key: WorkflowNextActionGroupKey;
  title: string;
  description: string;
  cue: string;
  href: string;
  tone: StatusTone;
  queuedActionCount: number;
  displayedActionCount: number;
  actions: WorkflowNextActionEntry[];
};

type WorkflowGroupDefinition = {
  key: WorkflowNextActionGroupKey;
  title: string;
  description: string;
  href: string;
  fallbackTitle: string;
  fallbackDetail: string;
  fallbackBadges?: (summary: WorkspaceOperationsSummary) => WorkflowNextActionEntry["badges"];
  cue: (summary: WorkspaceOperationsSummary, queuedActionCount: number) => string;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function includesAny(value: string, fragments: string[]) {
  const normalized = value.toLowerCase();
  return fragments.some((fragment) => normalized.includes(fragment));
}

function badgeText(item: WorkspaceCommandQueueItem) {
  return item.badges.map((badge) => `${badge.label} ${badge.value ?? ""}`).join(" ");
}

function itemSearchText(item: WorkspaceCommandQueueItem) {
  return [item.key, item.title, item.detail, item.moduleLabel ?? "", badgeText(item)].join(" ").toLowerCase();
}

export function classifyWorkflowNextAction(item: WorkspaceCommandQueueItem): WorkflowNextActionGroupKey[] {
  const text = itemSearchText(item);
  const groups = new Set<WorkflowNextActionGroupKey>();

  if (
    item.moduleKey === "grants" ||
    includesAny(text, ["grant", "funding", "award", "reimbursement", "invoice", "opportunit"])
  ) {
    groups.add("grants");
  }

  if (includesAny(text, ["rtp", "plan", "program", "packet", "report", "chapter", "release review"])) {
    groups.add("rtp");
  }

  if (includesAny(text, ["engagement", "comment", "moderation", "public review", "review loop", "handoff"])) {
    groups.add("engagement");
  }

  if (includesAny(text, ["model", "modeling", "analysis", "scenario", "comparison", "forecast", "caveat"])) {
    groups.add("analysis-modeling");
  }

  if (includesAny(text, ["aerial", "mission", "field verification", "evidence package", "dji", "aoi"])) {
    groups.add("aerial");
  }

  if (includesAny(text, ["admin", "proof", "release", "pilot readiness", "packet", "artifact", "regenerate"])) {
    groups.add("admin-release-proof");
  }

  return [...groups];
}

function commandToEntry(command: WorkspaceCommandQueueItem): WorkflowNextActionEntry {
  return {
    key: command.key,
    title: command.title,
    detail: command.detail,
    href: command.href,
    tone: command.tone,
    source: "queue",
    badges: command.badges,
    command,
  };
}

function groupTone(actions: WorkflowNextActionEntry[]): StatusTone {
  if (actions.some((action) => action.tone === "danger")) return "danger";
  if (actions.some((action) => action.tone === "warning")) return "warning";
  if (actions.some((action) => action.source === "queue")) return "info";
  return "neutral";
}

const WORKFLOW_GROUPS: WorkflowGroupDefinition[] = [
  {
    key: "rtp",
    title: "RTP",
    description: "Packet freshness, cycle setup, and release-review posture.",
    href: "/rtp",
    fallbackTitle: "Inspect RTP packet posture",
    fallbackDetail:
      "No RTP queue pressure. Verify cycle setup, packet freshness, and release-review basis before board or public-review sharing.",
    fallbackBadges: (summary) => [
      { label: "Regenerate", value: summary.counts.reportRefreshRecommended },
      { label: "Generate", value: summary.counts.reportNoPacket },
      { label: "Current", value: summary.counts.reportPacketCurrent },
    ],
    cue: (summary) =>
      `${summary.counts.reportRefreshRecommended} regenerate · ${summary.counts.reportNoPacket} generate · ${summary.counts.reportPacketCurrent} review`,
  },
  {
    key: "grants",
    title: "Grants",
    description: "Funding windows, award records, reimbursement, and gap follow-through.",
    href: "/grants",
    fallbackTitle: "Review grants pipeline",
    fallbackDetail:
      "No funding pressure is queued. Confirm open opportunities, decisions, awards, and reimbursement posture before settling funding context.",
    fallbackBadges: (summary) => [
      { label: "Open opportunities", value: summary.counts.openFundingOpportunities },
      { label: "Overdue decisions", value: summary.counts.overdueDecisionFundingOpportunities },
      { label: "Funding gaps", value: summary.counts.projectFundingGapProjects },
    ],
    cue: (summary, queuedActionCount) =>
      `${pluralize(summary.counts.openFundingOpportunities, "open opportunity", "open opportunities")} · ${pluralize(queuedActionCount, "queued check")}`,
  },
  {
    key: "engagement",
    title: "Engagement",
    description: "Comment moderation, categorization, duplicate review, and report handoff.",
    href: "/engagement",
    fallbackTitle: "Inspect engagement handoff readiness",
    fallbackDetail:
      "No engagement exception is queued. Check moderation, categorization, duplicate review, and report handoff before closing public-review loops.",
    fallbackBadges: () => [{ label: "Standing check", value: "handoff" }],
    cue: (_summary, queuedActionCount) =>
      queuedActionCount > 0 ? `${pluralize(queuedActionCount, "review-loop action")}` : "handoff check",
  },
  {
    key: "analysis-modeling",
    title: "Analysis / modeling",
    description: "Scenario, model, and comparison evidence with caveat-safe language.",
    href: "/models",
    fallbackTitle: "Check modeling caveats",
    fallbackDetail:
      "No modeling queue pressure. Check scenario evidence, comparison context, and caveat posture before using analysis language in grants or reports.",
    fallbackBadges: (summary) => [
      { label: "Comparison-backed", value: summary.counts.comparisonBackedReports },
      ...(summary.grantModelingSummary?.breakdownSummary
        ? [{ label: "Modeling triage", value: summary.grantModelingSummary.breakdownSummary }]
        : []),
    ],
    cue: (summary) =>
      summary.grantModelingSummary?.breakdownSummary ??
      `${pluralize(summary.counts.comparisonBackedReports, "comparison-backed report")}`,
  },
  {
    key: "aerial",
    title: "Aerial",
    description: "Mission status, AOI evidence packages, and field-verification readiness.",
    href: "/aerial",
    fallbackTitle: "Check aerial evidence QA",
    fallbackDetail:
      "No aerial exception is queued. Confirm mission packages, AOI evidence, and QA status before using field capture in reports or grants.",
    fallbackBadges: (summary) => [
      { label: "Missions", value: summary.counts.aerialMissions },
      { label: "Ready packages", value: summary.counts.aerialReadyPackages },
    ],
    cue: (summary) =>
      `${pluralize(summary.counts.aerialMissions, "mission")} · ${pluralize(summary.counts.aerialReadyPackages, "ready package")}`,
  },
  {
    key: "admin-release-proof",
    title: "Admin / release proof",
    description: "Pilot readiness, caveat checks, artifacts, and release-proof packet evidence.",
    href: "/admin/pilot-readiness",
    fallbackTitle: "Check release proof packet",
    fallbackDetail:
      "Check release proof, pilot readiness evidence, billing-waiver language, and known caveats before any external demo or sale motion.",
    fallbackBadges: (summary) => [{ label: "Total commands", value: summary.counts.queueDepth }],
    cue: (summary, queuedActionCount) =>
      `${pluralize(summary.counts.queueDepth, "total command")} · ${pluralize(queuedActionCount, "proof-linked action")}`,
  },
];

export function getCommandCenterRoadmapWorkflowLaneKeys(): WorkflowNextActionGroupKey[] {
  return [...COMMAND_CENTER_ROADMAP_WORKFLOW_LANE_KEYS];
}

export function buildWorkflowNextActionGroups(summary: WorkspaceOperationsSummary): WorkflowNextActionGroup[] {
  const groups = new Map<WorkflowNextActionGroupKey, WorkflowNextActionEntry[]>();

  for (const definition of WORKFLOW_GROUPS) {
    groups.set(definition.key, []);
  }

  const fullCommandQueue = summary.fullCommandQueue ?? [];
  const commandQueue = summary.commandQueue ?? [];
  const queue = fullCommandQueue.length > 0 ? fullCommandQueue : commandQueue;

  for (const command of queue) {
    for (const groupKey of classifyWorkflowNextAction(command)) {
      groups.get(groupKey)?.push(commandToEntry(command));
    }
  }

  return WORKFLOW_GROUPS.map((definition) => {
    const queuedActions = groups.get(definition.key) ?? [];
    const actions =
      queuedActions.length > 0
        ? queuedActions.slice(0, 2)
        : [
            {
              key: `${definition.key}-standing-check`,
              title: definition.fallbackTitle,
              detail: definition.fallbackDetail,
              href: definition.href,
              tone: "neutral" as const,
              source: "standing-check" as const,
              badges: definition.fallbackBadges?.(summary) ?? [],
            },
          ];

    return {
      key: definition.key,
      title: definition.title,
      description: definition.description,
      href: definition.href,
      cue: definition.cue(summary, queuedActions.length),
      tone: groupTone(actions),
      queuedActionCount: queuedActions.length,
      displayedActionCount: actions.length,
      actions,
    };
  });
}

export function workflowGroupsCoverCommandCenterRoadmapLanes(groups: Pick<WorkflowNextActionGroup, "key">[]) {
  const expected = getCommandCenterRoadmapWorkflowLaneKeys();
  return groups.length === expected.length && expected.every((key, index) => groups[index]?.key === key);
}

export function workflowGroupsPreserveStandingChecksWhenQueueIsEmpty(
  groups: Pick<WorkflowNextActionGroup, "queuedActionCount" | "actions">[]
) {
  return groups.every((group) => {
    const action = group.actions[0];

    return (
      group.queuedActionCount === 0 &&
      group.actions.length === 1 &&
      action?.source === "standing-check" &&
      action.href.length > 0 &&
      action.title.length > 0
    );
  });
}
