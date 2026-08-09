import { SAFETY_SCREENING_NARRATIVE_CAVEAT } from "@/lib/safety/caveats";
import type { StatusTone } from "@/lib/ui/status";
import type { WorkspaceCommandQueueItem, WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

export type WorkflowNextActionGroupKey =
  | "rtp"
  | "grants"
  | "engagement"
  | "safety"
  | "analysis-modeling"
  | "data-evidence"
  | "receivables"
  | "aerial";

/**
 * The lanes the Command Center claims to cover, in the order it shows them.
 *
 * This list is the operational meaning of the word "cross-domain" on that page:
 * it started at five while the workspace summary read seven of nineteen nav
 * modules, so Engagement, Safety, Models, Scenarios, County Validation, the
 * Data Hub, the Knowledge Base and the receivable-invoicing lane were all
 * invisible to a page describing itself as a view across domains. Adding a lane
 * here is only honest once the summary actually reads that module — a lane with
 * nothing behind it would state "clear" about something never looked at.
 */
export const COMMAND_CENTER_ROADMAP_WORKFLOW_LANE_KEYS = [
  "rtp",
  "grants",
  "engagement",
  "safety",
  "analysis-modeling",
  "data-evidence",
  "receivables",
  "aerial",
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

/**
 * For the SPINE counts only (`summary.counts`), every one of which is a real
 * number the summary always computes. It exists so a summary built by an older
 * caller, missing a field added later, renders 0 rather than NaN.
 *
 * It must never be pointed at a `summary.moduleObservations` field. Those are
 * `number | null` where null means NOT MEASURED, and coercing that to 0 is
 * precisely the defect the observation contract exists to prevent — use
 * `metricValue` / `describeObservedCount` below instead.
 */
function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** How an unmeasured lane number is written wherever a number would go. */
const UNMEASURED_METRIC_LABEL = "not measured";

/** A metric badge value that cannot turn "not measured" into a number. */
function metricValue(value: number | null | undefined): number | string {
  return typeof value === "number" && Number.isFinite(value) ? value : UNMEASURED_METRIC_LABEL;
}

/**
 * "3 failed model runs", or a phrase that says the count is unknown. Used in
 * lane prose so a sentence never silently drops an unmeasured quantity.
 */
function describeObservedCount(
  value: number | null | undefined,
  singular: string,
  plural = `${singular}s`
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `an unmeasured number of ${plural}`;
  }

  return pluralize(value, singular, plural);
}

/**
 * Readiness for a lane whose module the caller never loaded — a summary built
 * from source rows alone, with no `moduleObservations`.
 *
 * It says the lane was not looked at, which is a different sentence from "the
 * lane is clear" and must stay one.
 */
function unobservedLaneReadiness(moduleLabel: string, surfaceLabel: string): WorkflowReadinessRollup {
  return {
    label: "Not read into this board",
    detail: `This workspace summary did not load ${moduleLabel}, so nothing here is a statement about it either way. Open ${surfaceLabel} to see its real state.`,
    tone: "neutral",
    metrics: [{ label: moduleLabel, value: UNMEASURED_METRIC_LABEL }],
  };
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

  // Money owed BY a client to this workspace, which is the opposite direction
  // from everything the Grants lane tracks (money coming in from a funder, and
  // the reimbursement claims made against it). Both say "invoice", so the
  // receivable reading is decided first and suppresses the grants one — a
  // client invoice showing up under Grants would misfile the whole lane.
  const isReceivable = includesAny(text, ["client invoice", "receivable", "unbilled"]);
  if (isReceivable) {
    groups.add("receivables");
  }

  if (
    !isReceivable &&
    (item.moduleKey === "grants" ||
      includesAny(text, ["grant", "funding", "award", "reimbursement", "invoice", "opportunit"]))
  ) {
    groups.add("grants");
  }

  if (includesAny(text, ["rtp", "plan", "program", "packet", "report", "chapter", "release review"])) {
    groups.add("rtp");
  }

  if (includesAny(text, ["engagement", "comment", "moderation", "public review", "review loop", "handoff"])) {
    groups.add("engagement");
  }

  if (includesAny(text, ["safety", "crash", "collision", "injur"])) {
    groups.add("safety");
  }

  if (includesAny(text, ["model", "modeling", "analysis", "scenario", "comparison", "forecast", "caveat"])) {
    groups.add("analysis-modeling");
  }

  if (
    includesAny(text, [
      "dataset",
      "data hub",
      "knowledge base",
      "citation",
      "grounding",
      "grounded",
      "extraction",
    ])
  ) {
    groups.add("data-evidence");
  }

  if (includesAny(text, ["aerial", "mission", "field verification", "evidence package", "dji", "aoi"])) {
    groups.add("aerial");
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

function engagementReadiness(summary: WorkspaceOperationsSummary, queuedActionCount: number): WorkflowReadinessRollup {
  const engagement = summary.moduleObservations?.engagement;

  if (!engagement) {
    // The reading this lane had before the summary read the engagement module
    // at all: it could only see which queued commands MENTIONED engagement, so
    // it said what it could — check the loop — and claimed nothing about the
    // comments themselves. Kept verbatim for callers that build a summary from
    // source rows without loading module observations.
    return {
      label: queuedActionCount > 0 ? "In review" : "Nothing queued",
      detail: queuedActionCount > 0
        ? `${pluralize(queuedActionCount, "engagement-linked action")} should be reviewed before closing the public-review handoff.`
        : "No engagement exception is queued; confirm moderation, duplicate review, and report handoff before calling the loop settled.",
      tone: queuedActionCount > 0 ? "warning" : "neutral",
      metrics: [{ label: "Queued", value: queuedActionCount }],
    };
  }

  const actionable = engagement.moderationActionableItems;
  const approved = engagement.approvedItems;
  const campaigns = engagement.campaigns;

  if (actionable === null) {
    return {
      label: "Moderation queue not readable",
      detail:
        "This board could not count the comments waiting on moderation, so the lane is unknown rather than clear. Engagement holds the real queue.",
      tone: "neutral",
      metrics: [
        { label: "Awaiting moderation", value: UNMEASURED_METRIC_LABEL },
        { label: "Queued", value: queuedActionCount },
      ],
    };
  }

  if (actionable > 0) {
    return {
      label: "Comments waiting on moderation",
      detail: `${pluralize(actionable, "comment")} ${actionable === 1 ? "is" : "are"} pending or flagged. The rest of the handoff check — categorization, duplicate review, source split, appendix posture — is judged per campaign in Engagement, not here.`,
      tone: "warning",
      metrics: [
        { label: "Awaiting moderation", value: actionable },
        { label: "Approved", value: metricValue(approved) },
        { label: "Campaigns", value: metricValue(campaigns) },
      ],
    };
  }

  if (campaigns === 0) {
    return {
      label: "No campaigns yet",
      detail:
        "This workspace holds no engagement campaign, so there is no public input to moderate or hand off. That is an absence of records, not a reading of community sentiment.",
      tone: "neutral",
      metrics: [{ label: "Campaigns", value: 0 }],
    };
  }

  return {
    label: "Moderation queue clear",
    detail: `Nothing is pending or flagged${approved === null ? "" : `, and ${pluralize(approved, "approved comment")} ${approved === 1 ? "is" : "are"} available to draw from`}. Full handoff readiness is still judged per campaign in Engagement — this board sees the moderation queue only.`,
    tone: "success",
    metrics: [
      { label: "Awaiting moderation", value: 0 },
      { label: "Approved", value: metricValue(approved) },
      { label: "Campaigns", value: metricValue(campaigns) },
    ],
  };
}

function safetyReadiness(summary: WorkspaceOperationsSummary): WorkflowReadinessRollup {
  const safety = summary.moduleObservations?.safety;

  if (!safety) {
    return unobservedLaneReadiness("safety crash data", "Safety");
  }

  const { crashIngests, readyCrashIngests, failedCrashIngests, uncoveredCrashIngests } = safety;

  if (crashIngests === null) {
    return {
      label: "Crash data pulls not readable",
      detail:
        "This board could not read this workspace's crash data pulls. Nothing here says whether crash evidence exists — open Safety to find out.",
      tone: "neutral",
      metrics: [{ label: "Data pulls", value: UNMEASURED_METRIC_LABEL }],
    };
  }

  if (crashIngests === 0) {
    return {
      label: "No crash data pulled yet",
      detail:
        "No crash data has been requested for any study area in this workspace. That is an empty record set, not a statement that collisions did not occur.",
      tone: "neutral",
      metrics: [{ label: "Data pulls", value: 0 }],
    };
  }

  if (failedCrashIngests !== null && failedCrashIngests > 0) {
    return {
      label: "Crash data pull failed",
      detail: `${pluralize(failedCrashIngests, "crash data pull")} did not complete, so the study ${failedCrashIngests === 1 ? "area it covered has" : "areas they covered have"} no observed crash record behind any screening output. ${SAFETY_SCREENING_NARRATIVE_CAVEAT}`,
      tone: "warning",
      metrics: [
        { label: "Failed", value: failedCrashIngests },
        { label: "Ready", value: metricValue(readyCrashIngests) },
      ],
    };
  }

  if (uncoveredCrashIngests !== null && uncoveredCrashIngests > 0) {
    return {
      label: "Coverage gap to disclose",
      detail: `${pluralize(uncoveredCrashIngests, "study area")} returned no registered crash source covering it. Carry that limit into any safety framing for ${uncoveredCrashIngests === 1 ? "it" : "them"} — the empty result is a coverage gap, not a finding.`,
      tone: "warning",
      metrics: [
        { label: "No coverage", value: uncoveredCrashIngests },
        { label: "Ready", value: metricValue(readyCrashIngests) },
      ],
    };
  }

  return {
    label: readyCrashIngests !== null && readyCrashIngests > 0 ? "Crash evidence available" : "Crash pulls in progress",
    detail:
      readyCrashIngests !== null && readyCrashIngests > 0
        ? `${pluralize(readyCrashIngests, "crash data pull")} ${readyCrashIngests === 1 ? "is" : "are"} ready to support screening. ${SAFETY_SCREENING_NARRATIVE_CAVEAT}`
        : `${describeObservedCount(crashIngests, "crash data pull")} exist without a ready, failed, or uncovered result to report yet.`,
    tone: readyCrashIngests !== null && readyCrashIngests > 0 ? "info" : "neutral",
    metrics: [
      { label: "Data pulls", value: crashIngests },
      { label: "Ready", value: metricValue(readyCrashIngests) },
    ],
  };
}

function dataEvidenceReadiness(summary: WorkspaceOperationsSummary): WorkflowReadinessRollup {
  const evidence = summary.moduleObservations?.evidence;

  if (!evidence) {
    return unobservedLaneReadiness("data hub and knowledge base records", "Data Hub");
  }

  const {
    datasets,
    datasetsNeedingAttention,
    knowledgeDocuments,
    readyKnowledgeDocuments,
    failedKnowledgeDocuments,
  } = evidence;

  if (datasetsNeedingAttention !== null && datasetsNeedingAttention > 0) {
    return {
      label: "Dataset refresh outstanding",
      detail: `${pluralize(datasetsNeedingAttention, "dataset")} carries a stale or error status. Analysis and screening built on ${datasetsNeedingAttention === 1 ? "it" : "them"} is running on data this workspace has already flagged.`,
      tone: "warning",
      metrics: [
        { label: "Needs refresh", value: datasetsNeedingAttention },
        { label: "Datasets", value: metricValue(datasets) },
      ],
    };
  }

  if (failedKnowledgeDocuments !== null && failedKnowledgeDocuments > 0) {
    return {
      label: "Document extraction failed",
      detail: `${pluralize(failedKnowledgeDocuments, "uploaded document")} could not be read into text, so ${failedKnowledgeDocuments === 1 ? "it is" : "they are"} silently absent from grounded citations.`,
      tone: "warning",
      metrics: [
        { label: "Extraction failed", value: failedKnowledgeDocuments },
        { label: "Ready documents", value: metricValue(readyKnowledgeDocuments) },
      ],
    };
  }

  if (datasets === null && knowledgeDocuments === null) {
    return {
      label: "Evidence supply not readable",
      detail:
        "This board could not read the Data Hub or the Knowledge Base for this workspace, so it is saying nothing about what evidence is available.",
      tone: "neutral",
      metrics: [{ label: "Datasets", value: UNMEASURED_METRIC_LABEL }],
    };
  }

  const hasEvidence =
    (datasets !== null && datasets > 0) || (knowledgeDocuments !== null && knowledgeDocuments > 0);

  // An "empty lane" reading needs BOTH halves to have been counted. This was
  // `(datasets ?? 0) > 0`, and that coercion is exactly what the observation
  // contract forbids: with the Data Hub read failing and the Knowledge Base
  // legitimately empty, the branch below printed "No dataset or knowledge base
  // document is registered in this workspace yet" — a confident sentence about
  // records nobody counted. The both-null case is caught above; this catches
  // the half-read one, which is the likelier failure because the two tables can
  // fail independently.
  if (!hasEvidence && (datasets === null || knowledgeDocuments === null)) {
    const unreadableHalf = datasets === null ? "the Data Hub" : "the Knowledge Base";
    const readHalf = datasets === null ? "knowledge base document" : "dataset";

    return {
      label: "Evidence supply partly unreadable",
      detail: `This board could not read ${unreadableHalf} for this workspace, and found no ${readHalf} in the half it could read. The evidence supply is therefore unknown, not empty.`,
      tone: "neutral",
      metrics: [
        { label: "Datasets", value: metricValue(datasets) },
        { label: "Documents", value: metricValue(knowledgeDocuments) },
      ],
    };
  }

  return {
    label: hasEvidence ? "Evidence supply visible" : "No evidence loaded yet",
    detail: hasEvidence
      ? `${describeObservedCount(datasets, "dataset")} and ${describeObservedCount(knowledgeDocuments, "document")} are registered, with no stale, errored, or unreadable record among the ones this board could see.`
      : "No dataset or knowledge base document is registered in this workspace yet, so grounded citations and screening inputs have nothing local to draw on.",
    tone: hasEvidence ? "info" : "neutral",
    metrics: [
      { label: "Datasets", value: metricValue(datasets) },
      { label: "Documents", value: metricValue(knowledgeDocuments) },
    ],
  };
}

function receivablesReadiness(summary: WorkspaceOperationsSummary): WorkflowReadinessRollup {
  const receivables = summary.moduleObservations?.receivables;

  if (!receivables) {
    return unobservedLaneReadiness("client invoice records", "Invoicing");
  }

  const { clientInvoices, draftClientInvoices, awaitingPaymentClientInvoices } = receivables;

  if (clientInvoices === null) {
    return {
      label: "Client invoices not readable",
      detail:
        "This board could not read this workspace's client invoices, so it is not reporting an unbilled or outstanding position either way.",
      tone: "neutral",
      metrics: [{ label: "Client invoices", value: UNMEASURED_METRIC_LABEL }],
    };
  }

  if (clientInvoices === 0) {
    return {
      label: "No client invoices",
      detail:
        "This workspace bills no clients through OpenPlan. The lane stays visible so an empty receivable position is never mistaken for one that was never recorded.",
      tone: "neutral",
      metrics: [{ label: "Client invoices", value: 0 }],
    };
  }

  if (draftClientInvoices !== null && draftClientInvoices > 0) {
    return {
      label: "Drafts not yet sent",
      detail: `${pluralize(draftClientInvoices, "client invoice")} ${draftClientInvoices === 1 ? "is" : "are"} still in draft, so the work behind ${draftClientInvoices === 1 ? "it" : "them"} is unbilled.`,
      tone: "warning",
      metrics: [
        { label: "Draft", value: draftClientInvoices },
        { label: "Awaiting payment", value: metricValue(awaitingPaymentClientInvoices) },
      ],
    };
  }

  return {
    label:
      awaitingPaymentClientInvoices !== null && awaitingPaymentClientInvoices > 0
        ? "Sent and awaiting payment"
        : "No unsent receivable work",
    detail:
      awaitingPaymentClientInvoices !== null && awaitingPaymentClientInvoices > 0
        ? `${pluralize(awaitingPaymentClientInvoices, "client invoice")} ${awaitingPaymentClientInvoices === 1 ? "has" : "have"} been sent and not yet marked paid. Payment state is whatever this workspace last recorded — OpenPlan does not observe the payment itself.`
        : "No client invoice is sitting in draft. Payment state is whatever this workspace last recorded.",
    tone: "info",
    metrics: [
      { label: "Client invoices", value: clientInvoices },
      { label: "Awaiting payment", value: metricValue(awaitingPaymentClientInvoices) },
    ],
  };
}

/**
 * One sentence of run state, appended to whatever the evidence-quality reading
 * already says. Empty when the caller never loaded the modeling module, so this
 * lane's older, report-evidence-only copy stays exactly as it was rather than
 * gaining a sentence about runs nobody counted.
 */
function modelingRunStateSuffix(summary: WorkspaceOperationsSummary): string {
  const modeling = summary.moduleObservations?.modeling;
  if (!modeling) return "";

  const inFlight =
    modeling.activeModelRuns !== null && modeling.activeModelRuns > 0
      ? `, ${pluralize(modeling.activeModelRuns, "still in flight", "still in flight")}`
      : "";
  const validated =
    modeling.validatedScreeningCountyRuns !== null && modeling.validatedScreeningCountyRuns > 0
      ? ` ${pluralize(modeling.validatedScreeningCountyRuns, "county validation run")} ${modeling.validatedScreeningCountyRuns === 1 ? "has" : "have"} reached validated screening.`
      : "";

  return ` This workspace holds ${describeObservedCount(modeling.modelRuns, "model run")} and ${describeObservedCount(modeling.scenarioSets, "scenario set")}${inFlight}.${validated}`;
}

function analysisReadiness(summary: WorkspaceOperationsSummary): WorkflowReadinessRollup {
  const comparisonBacked = safeCount(summary.counts.comparisonBackedReports);
  const stale = safeCount(summary.grantModelingSummary?.breakdown.refreshRecommended);
  const thin = safeCount(summary.grantModelingSummary?.breakdown.thin);
  const none = safeCount(summary.grantModelingSummary?.breakdown.noVisibleSupport);
  const decisionReady = safeCount(summary.grantModelingSummary?.breakdown.decisionReady);
  const modeling = summary.moduleObservations?.modeling;
  const failedRuns = modeling?.failedModelRuns ?? null;
  const runStateSuffix = modelingRunStateSuffix(summary);

  // A failed run outranks every evidence-quality reading below it: those grade
  // how good the existing evidence is, and this one says a piece of evidence a
  // planner asked for does not exist at all. Ordered first so the lane cannot
  // read "comparison support visible" while a run that would have changed the
  // comparison has failed.
  if (failedRuns !== null && failedRuns > 0) {
    return {
      label: "Model run failures",
      detail: `${pluralize(failedRuns, "model run")} failed and produced no result, so anything downstream is missing an input rather than showing a low number.${runStateSuffix}`,
      tone: "warning",
      metrics: [
        { label: "Failed runs", value: failedRuns },
        { label: "In flight", value: metricValue(modeling?.activeModelRuns) },
        { label: "Comparison-backed", value: comparisonBacked },
      ],
    };
  }

  if (stale > 0 || thin > 0 || none > 0) {
    return {
      label: stale > 0 ? "Stale evidence refresh" : "Evidence needs strengthening",
      detail: `${summary.grantModelingSummary?.breakdownSummary ?? `${pluralize(comparisonBacked, "comparison-backed report")} visible.`} Keep analysis language caveated until stale, thin, or unsupported project-linked evidence is resolved.${runStateSuffix}`,
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
    detail: `${
      comparisonBacked > 0
        ? `${pluralize(comparisonBacked, "comparison-backed report")} can support planning language with caveats; it is not award proof or certified behavioral forecasting.`
        : "No comparison-backed report evidence is visible in the shared summary yet."
    }${runStateSuffix}`,
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

const WORKFLOW_GROUPS: WorkflowGroupDefinition[] = [
  {
    key: "rtp",
    title: "RTP",
    description: "Packet freshness, cycle setup, and release-review posture.",
    href: "/rtp",
    fallbackTitle: "Check the RTP packets",
    fallbackDetail:
      "Nothing is waiting in RTP. Before you share anything with a board or the public, check the cycle is set up, the packets are current, and someone has reviewed them.",
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
    fallbackTitle: "Check the grants you are tracking",
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
    fallbackTitle: "Check the public comments",
    fallbackDetail:
      "Nothing is waiting for you in engagement. Before you close a comment period, check everything has been reviewed, sorted into topics, and duplicates dealt with.",
    fallbackBadges: (summary) => {
      const engagement = summary.moduleObservations?.engagement;
      // Without observations this is the standing-check badge the lane has
      // always shown: a reminder of what to check, not a count of anything.
      if (!engagement) return [{ label: "Standing check", value: "handoff" }];

      return [
        { label: "Awaiting moderation", value: metricValue(engagement.moderationActionableItems) },
        { label: "Approved", value: metricValue(engagement.approvedItems) },
        { label: "Campaigns", value: metricValue(engagement.campaigns) },
      ];
    },
    cue: (summary, queuedActionCount) => {
      const engagement = summary.moduleObservations?.engagement;
      if (!engagement) {
        return queuedActionCount > 0 ? `${pluralize(queuedActionCount, "review-loop action")}` : "handoff check";
      }

      return `${metricValue(engagement.moderationActionableItems)} awaiting moderation · ${metricValue(engagement.approvedItems)} approved`;
    },
    readiness: (summary, queuedActionCount) => engagementReadiness(summary, queuedActionCount),
  },
  {
    key: "safety",
    title: "Safety",
    description: "Crash data coverage, pull status, and screening evidence limits.",
    href: "/safety",
    fallbackTitle: "Check what crash data you have",
    fallbackDetail:
      "No safety exception is queued. Confirm which study areas have a covered, completed crash data pull before any screening language leaves this workspace — an area with no source coverage is a disclosed gap, not a finding.",
    fallbackBadges: (summary) => {
      const safety = summary.moduleObservations?.safety;
      if (!safety) return [{ label: "Crash data", value: UNMEASURED_METRIC_LABEL }];

      return [
        { label: "Data pulls", value: metricValue(safety.crashIngests) },
        { label: "Ready", value: metricValue(safety.readyCrashIngests) },
        { label: "No coverage", value: metricValue(safety.uncoveredCrashIngests) },
      ];
    },
    cue: (summary) => {
      const safety = summary.moduleObservations?.safety;
      if (!safety) return "not read into this board";

      return `${metricValue(safety.crashIngests)} data pulls · ${metricValue(safety.readyCrashIngests)} ready`;
    },
    readiness: (summary) => safetyReadiness(summary),
  },
  {
    key: "analysis-modeling",
    title: "Analysis / modeling",
    description: "Scenario, model, and comparison evidence with caveat-safe language.",
    href: "/models",
    fallbackTitle: "Check what the model results can be used for",
    fallbackDetail:
      "Nothing is waiting in modeling. Before you quote a result in a grant or a report, check which scenario it came from and what its caveats say it can be used for.",
    fallbackBadges: (summary) => [
      { label: "Comparison-backed", value: summary.counts.comparisonBackedReports },
      ...(summary.moduleObservations?.modeling
        ? [
            { label: "Model runs", value: metricValue(summary.moduleObservations.modeling.modelRuns) },
            { label: "Scenario sets", value: metricValue(summary.moduleObservations.modeling.scenarioSets) },
          ]
        : []),
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
    key: "data-evidence",
    title: "Data & knowledge",
    description: "Dataset freshness and the document corpus grounded citations draw from.",
    href: "/data-hub",
    fallbackTitle: "Check the data behind your work",
    fallbackDetail:
      "No evidence exception is queued. Confirm dataset freshness and which uploaded documents actually extracted before relying on grounded citations or dataset-backed screening.",
    fallbackBadges: (summary) => {
      const evidence = summary.moduleObservations?.evidence;
      if (!evidence) return [{ label: "Evidence supply", value: UNMEASURED_METRIC_LABEL }];

      return [
        { label: "Datasets", value: metricValue(evidence.datasets) },
        { label: "Needs refresh", value: metricValue(evidence.datasetsNeedingAttention) },
        { label: "Ready documents", value: metricValue(evidence.readyKnowledgeDocuments) },
      ];
    },
    cue: (summary) => {
      const evidence = summary.moduleObservations?.evidence;
      if (!evidence) return "not read into this board";

      return `${metricValue(evidence.datasets)} datasets · ${metricValue(evidence.knowledgeDocuments)} documents`;
    },
    readiness: (summary) => dataEvidenceReadiness(summary),
  },
  {
    key: "receivables",
    // Client invoicing is the opposite direction from the grant-reimbursement
    // register the Grants lane covers: this workspace billing ITS OWN clients,
    // not an agency claiming reimbursement from its funder. Neither direction is
    // OpenPlan charging anyone — the product is free and has no checkout.
    title: "Receivables",
    description: "Client invoices this workspace has drafted, sent, and recorded as paid.",
    href: "/invoicing",
    fallbackTitle: "Check where your invoices stand",
    fallbackDetail:
      "No receivable exception is queued. Confirm which client invoices are still in draft and which are sent and unpaid — OpenPlan records what this workspace tells it, and never observes a payment itself.",
    fallbackBadges: (summary) => {
      const receivables = summary.moduleObservations?.receivables;
      if (!receivables) return [{ label: "Client invoices", value: UNMEASURED_METRIC_LABEL }];

      return [
        { label: "Draft", value: metricValue(receivables.draftClientInvoices) },
        { label: "Awaiting payment", value: metricValue(receivables.awaitingPaymentClientInvoices) },
        { label: "Client invoices", value: metricValue(receivables.clientInvoices) },
      ];
    },
    cue: (summary) => {
      const receivables = summary.moduleObservations?.receivables;
      if (!receivables) return "not read into this board";

      return `${metricValue(receivables.draftClientInvoices)} draft · ${metricValue(receivables.awaitingPaymentClientInvoices)} awaiting payment`;
    },
    readiness: (summary) => receivablesReadiness(summary),
  },
  {
    key: "aerial",
    title: "Aerial",
    description: "Mission status, AOI evidence packages, and field-verification readiness.",
    href: "/aerial",
    fallbackTitle: "Check the aerial imagery",
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
