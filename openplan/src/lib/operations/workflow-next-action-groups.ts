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
  readiness: WorkflowReadinessRollup;
  queuedActionCount: number;
  displayedActionCount: number;
  actions: WorkflowNextActionEntry[];
};

export type WorkflowReadinessRollup = {
  label: string;
  detail: string;
  tone: StatusTone;
  metrics: WorkflowNextActionEntry["badges"];
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
  readiness: (summary: WorkspaceOperationsSummary, queuedActionCount: number) => WorkflowReadinessRollup;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function staleEvidenceCount(summary: WorkspaceOperationsSummary) {
  return safeCount(summary.counts.reportRefreshRecommended) +
    safeCount(summary.grantModelingSummary?.breakdown.refreshRecommended);
}

function rtpReadiness(summary: WorkspaceOperationsSummary): WorkflowReadinessRollup {
  const refreshCount = safeCount(summary.counts.reportRefreshRecommended);
  const missingPacketCount = safeCount(summary.counts.reportNoPacket);
  const currentPacketCount = safeCount(summary.counts.reportPacketCurrent);
  const fundingReviewCount = safeCount(summary.counts.rtpFundingReviewPackets);

  if (refreshCount > 0) {
    return {
      label: "Refresh before release",
      detail: `${pluralize(refreshCount, "packet")} ${refreshCount === 1 ? "has" : "have"} stale source context and should be regenerated before release review or board sharing.`,
      tone: "warning",
      metrics: [
        { label: "Refresh", value: refreshCount },
        { label: "Current", value: currentPacketCount },
      ],
    };
  }

  if (missingPacketCount > 0) {
    return {
      label: "First packet evidence missing",
      detail: `${pluralize(missingPacketCount, "report")} still ${missingPacketCount === 1 ? "needs" : "need"} a generated packet before it can carry review evidence.`,
      tone: "warning",
      metrics: [
        { label: "Generate", value: missingPacketCount },
        { label: "Reports", value: safeCount(summary.counts.reports) },
      ],
    };
  }

  if (fundingReviewCount > 0) {
    return {
      label: "Funding follow-through",
      detail: `${pluralize(fundingReviewCount, "current RTP packet")} still ${fundingReviewCount === 1 ? "carries" : "carry"} linked-project funding follow-through before the packet basis should be treated as settled.`,
      tone: "warning",
      metrics: [
        { label: "Funding review", value: fundingReviewCount },
        { label: "Current", value: currentPacketCount },
      ],
    };
  }

  return {
    label: currentPacketCount > 0 ? "Release-review basis visible" : "Packet basis not started",
    detail: currentPacketCount > 0
      ? `${pluralize(currentPacketCount, "current packet")} can move through supervised release review with normal caveat checks.`
      : "No current RTP packet evidence is visible yet; create or refresh packet output before citing this lane.",
    tone: currentPacketCount > 0 ? "success" : "neutral",
    metrics: [
      { label: "Current", value: currentPacketCount },
      { label: "Reports", value: safeCount(summary.counts.reports) },
    ],
  };
}

function grantsReadiness(summary: WorkspaceOperationsSummary): WorkflowReadinessRollup {
  const gaps = safeCount(summary.counts.projectFundingGapProjects);
  const decisions = safeCount(summary.counts.projectFundingDecisionProjects);
  const staleModeling = safeCount(summary.grantModelingSummary?.breakdown.refreshRecommended);
  const noVisibleSupport = safeCount(summary.grantModelingSummary?.breakdown.noVisibleSupport);
  const open = safeCount(summary.counts.openFundingOpportunities);

  if (gaps > 0 || decisions > 0 || staleModeling > 0 || noVisibleSupport > 0) {
    return {
      label: staleModeling > 0 ? "Stale modeling evidence" : gaps > 0 ? "Funding gap visible" : "Decision evidence review",
      detail: `${pluralize(open, "open opportunity", "open opportunities")} remain visible; ${pluralize(decisions, "project")} need pursue decisions, ${pluralize(gaps, "project")} show funding gaps, and ${pluralize(staleModeling, "opportunity-linked project")} need modeling refresh before strong readiness language.`,
      tone: "warning",
      metrics: [
        { label: "Open", value: open },
        { label: "Decisions", value: decisions },
        { label: "Stale modeling", value: staleModeling },
      ],
    };
  }

  return {
    label: open > 0 ? "Pipeline watch" : "No funding pressure",
    detail: open > 0
      ? `${pluralize(open, "open opportunity", "open opportunities")} are visible without a stale-evidence or funding-gap exception in this snapshot.`
      : "No open funding opportunity pressure is visible from the shared workspace summary.",
    tone: open > 0 ? "info" : "neutral",
    metrics: [
      { label: "Open", value: open },
      { label: "Gaps", value: gaps },
    ],
  };
}

function engagementReadiness(_summary: WorkspaceOperationsSummary, queuedActionCount: number): WorkflowReadinessRollup {
  return {
    label: queuedActionCount > 0 ? "Review loop active" : "Handoff check",
    detail: queuedActionCount > 0
      ? `${pluralize(queuedActionCount, "engagement-linked action")} should be reviewed before closing the public-review handoff.`
      : "No engagement exception is queued; confirm moderation, duplicate review, and report handoff before calling the loop settled.",
    tone: queuedActionCount > 0 ? "warning" : "neutral",
    metrics: [{ label: "Queued", value: queuedActionCount }],
  };
}

function analysisReadiness(summary: WorkspaceOperationsSummary): WorkflowReadinessRollup {
  const comparisonBacked = safeCount(summary.counts.comparisonBackedReports);
  const stale = safeCount(summary.grantModelingSummary?.breakdown.refreshRecommended);
  const thin = safeCount(summary.grantModelingSummary?.breakdown.thin);
  const none = safeCount(summary.grantModelingSummary?.breakdown.noVisibleSupport);
  const decisionReady = safeCount(summary.grantModelingSummary?.breakdown.decisionReady);

  if (stale > 0 || thin > 0 || none > 0) {
    return {
      label: stale > 0 ? "Stale evidence refresh" : "Evidence needs strengthening",
      detail: `${summary.grantModelingSummary?.breakdownSummary ?? `${pluralize(comparisonBacked, "comparison-backed report")} visible.`} Keep analysis language caveated until stale, thin, or unsupported project-linked evidence is resolved.`,
      tone: "warning",
      metrics: [
        { label: "Ready", value: decisionReady },
        { label: "Refresh", value: stale },
        { label: "Thin/none", value: thin + none },
      ],
    };
  }

  return {
    label: comparisonBacked > 0 ? "Comparison support visible" : "No linked analysis evidence",
    detail: comparisonBacked > 0
      ? `${pluralize(comparisonBacked, "comparison-backed report")} can support planning language with caveats; it is not award proof or certified behavioral forecasting.`
      : "No comparison-backed report evidence is visible in the shared summary yet.",
    tone: comparisonBacked > 0 ? "info" : "neutral",
    metrics: [
      { label: "Comparison-backed", value: comparisonBacked },
      { label: "Ready", value: decisionReady },
    ],
  };
}

function aerialReadiness(summary: WorkspaceOperationsSummary): WorkflowReadinessRollup {
  const missions = safeCount(summary.counts.aerialMissions);
  const active = safeCount(summary.counts.aerialActiveMissions);
  const ready = safeCount(summary.counts.aerialReadyPackages);
  const verificationReadiness = summary.aerialPosture?.verificationReadiness ?? "pending";

  if (missions === 0) {
    return {
      label: "No aerial evidence loaded",
      detail: "No mission or evidence-package pressure is visible in this workspace snapshot.",
      tone: "neutral",
      metrics: [{ label: "Missions", value: 0 }],
    };
  }

  if (verificationReadiness === "ready") {
    return {
      label: "Field evidence ready",
      detail: `${pluralize(ready, "evidence package")} ${ready === 1 ? "is" : "are"} ready for supervised field-verification support.`,
      tone: "success",
      metrics: [
        { label: "Missions", value: missions },
        { label: "Ready packages", value: ready },
      ],
    };
  }

  return {
    label: active > 0 ? "Mission evidence in progress" : "Evidence QA pending",
    detail: active > 0
      ? `${pluralize(active, "mission")} ${active === 1 ? "is" : "are"} active; wait for package QA before relying on aerial output downstream.`
      : `${pluralize(missions, "mission")} visible, but field-verification evidence is not fully ready yet.`,
    tone: active > 0 ? "info" : "warning",
    metrics: [
      { label: "Missions", value: missions },
      { label: "Ready packages", value: ready },
    ],
  };
}

function adminReadiness(summary: WorkspaceOperationsSummary, queuedActionCount: number): WorkflowReadinessRollup {
  const totalCommands = safeCount(summary.counts.queueDepth);
  const staleEvidence = staleEvidenceCount(summary);

  return {
    label: staleEvidence > 0 ? "Proof packet has stale inputs" : totalCommands > 0 ? "Proof review needed" : "Proof packet standing check",
    detail: staleEvidence > 0
      ? `${pluralize(staleEvidence, "stale evidence item")} should be refreshed before external demo, pilot-readiness, or sale-motion language.`
      : totalCommands > 0
        ? `${pluralize(totalCommands, "command")} remain in the workspace queue; review proof posture after the lane work is resolved.`
        : "No queue pressure is visible, but readiness proof and caveat checks still need a supervised pass before external use.",
    tone: staleEvidence > 0 ? "warning" : totalCommands > 0 ? "info" : "neutral",
    metrics: [
      { label: "Commands", value: totalCommands },
      { label: "Proof-linked", value: queuedActionCount },
      { label: "Stale evidence", value: staleEvidence },
    ],
  };
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
      `${safeCount(summary.counts.reportRefreshRecommended)} regenerate · ${safeCount(summary.counts.reportNoPacket)} generate · ${safeCount(summary.counts.reportPacketCurrent)} review`,
    readiness: (summary) => rtpReadiness(summary),
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
      `${pluralize(safeCount(summary.counts.openFundingOpportunities), "open opportunity", "open opportunities")} · ${pluralize(queuedActionCount, "queued check")}`,
    readiness: (summary) => grantsReadiness(summary),
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
    readiness: (summary, queuedActionCount) => engagementReadiness(summary, queuedActionCount),
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
      `${pluralize(safeCount(summary.counts.comparisonBackedReports), "comparison-backed report")}`,
    readiness: (summary) => analysisReadiness(summary),
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
      `${pluralize(safeCount(summary.counts.aerialMissions), "mission")} · ${pluralize(safeCount(summary.counts.aerialReadyPackages), "ready package")}`,
    readiness: (summary) => aerialReadiness(summary),
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
      `${pluralize(safeCount(summary.counts.queueDepth), "total command")} · ${pluralize(queuedActionCount, "proof-linked action")}`,
    readiness: (summary, queuedActionCount) => adminReadiness(summary, queuedActionCount),
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
      readiness: definition.readiness(summary, queuedActions.length),
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
