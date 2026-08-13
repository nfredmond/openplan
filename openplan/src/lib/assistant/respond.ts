import {
  findAssistantAction,
  getAssistantActions,
  type AssistantPreview,
  type AssistantResponse,
} from "@/lib/assistant/catalog";
import { ASSISTANT_READ_SUBJECTS, type AssistantContextReadFailure } from "@/lib/assistant/context";
import type {
  AssistantContext,
  AssistantModuleLaneSummary,
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
import { MANAGED_RUN_MODE_DEFINITIONS } from "@/lib/models/run-modes";
import { LINK_VALIDATION_NOT_SUPPORTED_CAVEAT } from "@/lib/models/zone-resolution";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import {
  resolveRtpPacketWorkPostureFromCounts,
  resolveRtpPacketWorkPostureFromFreshnessLabel,
} from "@/lib/assistant/rtp-packet-posture";
import { buildMetricDeltas } from "@/lib/analysis/compare";
import { resolveWorkspaceCommandHref } from "@/lib/operations/grants-links";
import { FUNDING_CLOSING_SOON_WINDOW_DAYS } from "@/lib/operations/funding-decision-status";
import { describeRtpFiscalConstraint } from "@/lib/rtp/fiscal-constraint";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";
import { getReportPacketFreshness } from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { formatMoney } from "@/lib/money/format";

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
  return formatMoney(value, { precision: "whole" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatRtpFundingBackedReleaseReviewPressure(count: number): string {
  return `${count} current RTP packet${count === 1 ? "" : "s"} still ${count === 1 ? "carries" : "carry"} funding-backed release-review pressure that must be resolved before the packets can be treated as settled.`;
}

function formatRtpGrantsFollowThroughPressure(count: number): string {
  return `${count} current RTP packet${count === 1 ? " still needs" : "s still need"} grants follow-through before the packets can be treated as settled.`;
}

function isRtpFundingReviewRoutedThroughGrants(context: {
  operationsSummary: {
    nextCommand: { key: string; moduleKey?: string | null } | null;
    counts: { rtpFundingReviewPackets: number };
  };
}): boolean {
  return (
    context.operationsSummary.counts.rtpFundingReviewPackets > 0 &&
    context.operationsSummary.nextCommand?.key === "review-current-report-packets" &&
    context.operationsSummary.nextCommand.moduleKey === "grants"
  );
}

function hasRtpFundingBackedReleaseReviewPressure(context: { operationsSummary: WorkspaceOperationsSummary }): boolean {
  return context.operationsSummary.counts.rtpFundingReviewPackets > 0;
}

type StageGateSummary = ProjectAssistantContext["stageGateSummary"];

/**
 * The gate counts, in the words the rest of the lane uses.
 *
 * "not-started" was a claim about the PROJECT — that its gates had not been
 * begun. The board never knew that. It knows whether a DECISION was recorded,
 * and a gate can be well under way with no verdict logged, which is why
 * `src/lib/stage-gates/summary.ts` labels it "No decision recorded". The
 * assistant speaks to the same planner about the same board and may not use a
 * stronger word for it than the board does.
 */
function describeStageGateCounts(summary: StageGateSummary): string {
  if (!summary.decisionsRead.readable) {
    return `Stage-gate decisions could not be read (${summary.decisionsRead.reason}), so pass, hold, and no-decision counts are unknown here.`;
  }

  return `Stage-gate pass / hold / no decision recorded: ${summary.passCount}/${summary.holdCount}/${summary.notStartedCount}`;
}

/**
 * What to say when `blockedGate` is null.
 *
 * Null means one of two entirely different things: the log was read and holds
 * no HOLD, or the log did not load and nothing about holds is established. The
 * assistant is the surface most likely to have that restated in a meeting, so
 * the second one may never borrow the first one's sentence.
 */
function describeAbsentStageGateHold(summary: StageGateSummary, absentSentence: string): string {
  if (!summary.decisionsRead.readable) {
    return `Whether any stage gate is on hold is unknown for this project: the decision log could not be read (${summary.decisionsRead.reason}).`;
  }

  return absentSentence;
}

// ---------------------------------------------------------------------------
// A COUNT DERIVED FROM A FAILED READ MAY NOT BE SPOKEN
// ---------------------------------------------------------------------------

/**
 * Any context, seen only through the reads that failed while it loaded.
 *
 * `context.ts` collects those by name (`ASSISTANT_READ_SUBJECTS`) because a
 * Supabase read answers `null` for both "there is nothing here" and "this query
 * failed", and everything below turns those values into sentences a planner
 * repeats in a meeting: "0 chapters are ready for review", "No funding
 * opportunities are linked to this project yet", "Linked projects: 0". Said
 * over a dropped connection or a revoked grant, each of those is a false
 * statement about an agency's own work — and this surface is the one that then
 * feeds a grant narrative or an RTP chapter.
 */
type ContextWithReadFailures = { unreadable?: AssistantContextReadFailure[] };

/** The failure for any of these lanes, or null when they all answered. */
function readFailure(
  context: ContextWithReadFailures,
  ...subjects: string[]
): AssistantContextReadFailure | null {
  for (const failure of context.unreadable ?? []) {
    if (subjects.includes(failure.label)) return failure;
  }
  return null;
}

/**
 * A stat tile's value, or "Unknown".
 *
 * A tile has room for a word, not a caveat — the same call
 * `buildProjectPreview` already makes for an unreadable stage-gate board.
 */
function statCount(context: ContextWithReadFailures, value: number, ...subjects: string[]): string {
  return readFailure(context, ...subjects) ? "Unknown" : `${value}`;
}

/**
 * What to say INSTEAD of a count, when the count's read failed.
 *
 * `what` names the thing in the sentence's own words and in lower case, because
 * it lands mid-sentence: "chapter progress for this cycle", "the funding picture
 * for this project". The lead word is "Unknown" so a reader skimming a fact list
 * cannot mistake the line for a finding.
 */
function unknownBecauseUnread(failure: AssistantContextReadFailure, what: string): string {
  return `Unknown: ${what}. The read of ${failure.label} failed (${failure.message}), so an empty count here would not mean the records are absent.`;
}

/**
 * The disclosure every preview and response carries when any read failed.
 *
 * WHY A BLANKET LINE AS WELL AS THE PER-SENTENCE FIXES BELOW. The per-sentence
 * work is finite and this file is not: there are roughly a hundred count
 * sentences across ten surfaces, and the lanes fixed by name below are the ones
 * whose reads this pass audited. For every other lane the honest minimum is to
 * tell the reader — and the model reading this as grounding — which reads did
 * not land, so an empty value elsewhere is not taken as a finding. It leads the
 * facts and the findings because a caveat nobody reaches is not a caveat.
 *
 * It is deliberately NOT `ReadFailureLog.describe()`, which is written in a
 * page's voice ("This page could not read…"). The audience here is a planner
 * reading a copilot panel and a model being grounded, and the model needs the
 * instruction, not just the disclosure.
 */
function describeReadFailures(context: ContextWithReadFailures): string | null {
  const failures = context.unreadable ?? [];
  if (failures.length === 0) return null;

  const labels = failures.map((failure) => failure.label);
  const listed =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

  return (
    `Read failure — this copilot could not read ${listed}, so anything depending on ${labels.length === 1 ? "it" : "them"} is unknown rather than zero. ` +
    "Do not state a count, a total, or an absence for those, and say so if asked. " +
    `Reported by the database: ${failures.map((failure) => `${failure.label}: ${failure.message}`).join("; ")}.`
  );
}

function withPreviewReadFailureDisclosure(
  context: ContextWithReadFailures,
  preview: AssistantPreview
): AssistantPreview {
  const disclosure = describeReadFailures(context);
  return disclosure ? { ...preview, facts: [disclosure, ...preview.facts] } : preview;
}

function withResponseReadFailureDisclosure(
  context: ContextWithReadFailures,
  response: AssistantResponse
): AssistantResponse {
  const disclosure = describeReadFailures(context);
  if (!disclosure) return response;

  return {
    ...response,
    findings: [disclosure, ...response.findings],
    caution: response.caution ? `${disclosure} ${response.caution}` : disclosure,
  };
}

function metricLabel(metrics: Record<string, unknown>, key: string): string {
  const value = asNumber(metrics[key]);
  return value === null ? "N/A" : `${value}`;
}

function buildWorkspacePreview(context: WorkspaceAssistantContext): AssistantPreview {
  const title = context.kind === "analysis_studio" ? "Analysis Studio copilot" : context.workspace.name ?? "Workspace copilot";
  const rtpFundingReviewCount = context.operationsSummary.counts.rtpFundingReviewPackets;
  const grantsRoutedRtpFundingReview = isRtpFundingReviewRoutedThroughGrants(context);
  const rtpFundingReviewPressure = grantsRoutedRtpFundingReview
    ? formatRtpGrantsFollowThroughPressure(rtpFundingReviewCount)
    : formatRtpFundingBackedReleaseReviewPressure(rtpFundingReviewCount);
  const missingFundingAnchorCount = context.operationsSummary.counts.projectFundingNeedAnchorProjects;
  const fundingSourcingCount = context.operationsSummary.counts.projectFundingSourcingProjects;
  const fundingDecisionCount = context.operationsSummary.counts.projectFundingDecisionProjects;
  const fundingAwardRecordCount = context.operationsSummary.counts.projectFundingAwardRecordProjects;
  const reimbursementStartCount = context.operationsSummary.counts.projectFundingReimbursementStartProjects;
  const reimbursementAdvanceCount = context.operationsSummary.counts.projectFundingReimbursementActiveProjects;
  const gapProjectCount = context.operationsSummary.counts.projectFundingGapProjects;
  const invoiceRelinkCommand = context.operationsSummary.commandQueue.find((item) => item.key === "relink-project-invoice-awards");
  const invoiceRelinkCount = typeof invoiceRelinkCommand?.badges[0]?.value === "number" ? invoiceRelinkCommand.badges[0].value : 0;
  const leadFundingDecisionDetail = context.operationsSummary.grantModelingSummary?.leadDecisionDetail ?? null;
  const summary = context.currentRun
    ? `Working from ${context.currentRun.title} inside ${context.workspace.name ?? "the current workspace"}. I can brief the run, compare it to baseline, or summarize the surrounding planning context and current queue pressure.`
    : `Working from ${context.workspace.name ?? "the current workspace"}. I can summarize recent project and analysis activity, plus the shared workspace command queue${rtpFundingReviewCount > 0 ? `, ${rtpFundingReviewPressure}` : missingFundingAnchorCount > 0 ? `, ${missingFundingAnchorCount} missing a funding target${missingFundingAnchorCount === 1 ? "" : "s"}` : fundingSourcingCount > 0 ? `, ${fundingSourcingCount} funding lane${fundingSourcingCount === 1 ? " still needs" : "s still need"} sourcing` : fundingDecisionCount > 0 ? leadFundingDecisionDetail ? `, lead grant decision cue: ${leadFundingDecisionDetail}` : `, ${fundingDecisionCount} project funding lane${fundingDecisionCount === 1 ? " still needs" : "s still need"} a pursue decision` : fundingAwardRecordCount > 0 ? `, ${fundingAwardRecordCount} awarded opportunit${fundingAwardRecordCount === 1 ? "y still needs" : "ies still need"} an award record` : invoiceRelinkCount > 0 ? `, ${invoiceRelinkCount} invoice-to-award relink${invoiceRelinkCount === 1 ? " is" : "s are"} exact and ready` : reimbursementStartCount > 0 ? `, ${reimbursementStartCount} project${reimbursementStartCount === 1 ? " still needs" : "s still need"} a first reimbursement packet` : reimbursementAdvanceCount > 0 ? `, ${reimbursementAdvanceCount} project reimbursement lane${reimbursementAdvanceCount === 1 ? " is" : "s are"} active` : gapProjectCount > 0 ? ` and ${gapProjectCount} visible project funding gap${gapProjectCount === 1 ? "" : "s"}` : ""}, and point you at what to do next.`;

  const facts = [
    context.recentProject
      ? `Latest project: ${context.recentProject.name} · ${context.recentProject.status} · ${context.recentProject.deliveryPhase}`
      : "No recent project is visible from this workspace snapshot yet.",
    context.currentRun
      ? `Current run: ${context.currentRun.title} · overall ${metricLabel(context.currentRun.metrics, "overallScore")}`
      : context.recentRuns[0]
        ? `Latest run: ${context.recentRuns[0].title} · ${formatDateTime(context.recentRuns[0].createdAt)}`
        : "No recent analysis runs are visible yet.",
    rtpFundingReviewCount > 0
      ? `${grantsRoutedRtpFundingReview ? "RTP grants follow-through" : "RTP funding review"}: ${rtpFundingReviewPressure}`
      : context.operationsSummary.nextCommand
      ? `Command queue: ${context.operationsSummary.nextCommand.title}.${fundingDecisionCount > 0 && leadFundingDecisionDetail ? ` ${leadFundingDecisionDetail}` : ""}`
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
        label: rtpFundingReviewCount > 0 ? "RTP funding review" : missingFundingAnchorCount > 0 ? "Missing funding targets" : fundingSourcingCount > 0 ? "Needs sourcing" : fundingDecisionCount > 0 ? "Needs decisions" : fundingAwardRecordCount > 0 ? "Award records" : invoiceRelinkCount > 0 ? "Invoice relinks" : reimbursementStartCount > 0 ? "Need packets" : reimbursementAdvanceCount > 0 ? "Reimbursement" : "Gap projects",
        value: `${rtpFundingReviewCount > 0 ? rtpFundingReviewCount : missingFundingAnchorCount > 0 ? missingFundingAnchorCount : fundingSourcingCount > 0 ? fundingSourcingCount : fundingDecisionCount > 0 ? fundingDecisionCount : fundingAwardRecordCount > 0 ? fundingAwardRecordCount : invoiceRelinkCount > 0 ? invoiceRelinkCount : reimbursementStartCount > 0 ? reimbursementStartCount : reimbursementAdvanceCount > 0 ? reimbursementAdvanceCount : gapProjectCount}`,
      },
    ],
    facts,
    operatorCue: context.operationsSummary.nextCommand
      ? {
          label: "What to do next",
          title:
            grantsRoutedRtpFundingReview && context.operationsSummary.nextCommand.key === "review-current-report-packets"
              ? "Open RTP grants follow-through"
              : context.operationsSummary.nextCommand.title,
          detail:
            rtpFundingReviewCount > 0
              ? rtpFundingReviewPressure
              : fundingDecisionCount > 0 && leadFundingDecisionDetail
                ? leadFundingDecisionDetail
                : context.operationsSummary.nextCommand.detail,
        }
      : {
          label: "What to do next",
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
  // A stat tile has room for a label, not a caveat, so the unreadable case gets
  // its own word rather than borrowing "No hold gate" — which would report a
  // failed read as a clean gate board.
  const blockedGate =
    context.stageGateSummary.blockedGate?.name ??
    (context.stageGateSummary.decisionsRead.readable ? "No hold gate" : "Gate log not readable");
  const gapAmount = context.fundingSummary.gapAmount;
  const needsFundingSourcing = context.fundingSummary.fundingNeedAmount !== null && context.fundingSummary.opportunityCount === 0;
  const awardRecordCount = context.fundingSummary.awardRecordCount;
  const awardCount = context.fundingSummary.awardCount;
  const uninvoicedAwardAmount = context.fundingSummary.uninvoicedAwardAmount;
  const reimbursementPacketCount = context.fundingSummary.reimbursementPacketCount;
  const exactInvoiceAwardRelink = context.fundingSummary.exactInvoiceAwardRelink;
  const overdueDecisionCount = context.fundingSummary.overdueDecisionCount;
  const leadOverdueOpportunity = context.fundingSummary.leadOverdueOpportunity;
  const leadClosingOpportunity = context.fundingSummary.leadClosingOpportunity;
  const leadAwardOpportunity = context.fundingSummary.leadAwardOpportunity;
  // Three lanes whose ZERO is a sentence rather than a number: "0 deliverables,
  // 0 decisions and 0 meetings are attached", "No funding opportunities are
  // linked to this project yet", "0 linked datasets are visible". Each is a
  // claim about the agency's own record, and none of them may be made from a
  // read that failed.
  const projectControlCountsFailure = readFailure(
    context,
    ASSISTANT_READ_SUBJECTS.projectDeliverables,
    ASSISTANT_READ_SUBJECTS.projectDecisions,
    ASSISTANT_READ_SUBJECTS.projectMeetings
  );
  const fundingOpportunitiesFailure = readFailure(context, ASSISTANT_READ_SUBJECTS.fundingOpportunities);
  const linkedDatasetsFailure = readFailure(context, ASSISTANT_READ_SUBJECTS.linkedDatasets);
  const recentRunsFailure = readFailure(context, ASSISTANT_READ_SUBJECTS.recentRuns);
  const riskCountsFailure = readFailure(
    context,
    ASSISTANT_READ_SUBJECTS.projectRisks,
    ASSISTANT_READ_SUBJECTS.projectIssues
  );

  return {
    kind: context.kind,
    title: context.project.name,
    summary: `Working from the full project record: delivery status, stage gates, funding, linked datasets, and recent run activity are all in scope for this copilot pass.`,
    stats: [
      { label: "Status", value: context.project.status },
      { label: "Open risks", value: statCount(context, openRisks, ASSISTANT_READ_SUBJECTS.projectRisks) },
      {
        label: "Funding",
        value: statCount(context, context.fundingSummary.opportunityCount, ASSISTANT_READ_SUBJECTS.fundingOpportunities),
      },
      { label: "Blocked gate", value: blockedGate },
    ],
    facts: [
      projectControlCountsFailure
        ? unknownBecauseUnread(projectControlCountsFailure, "the project control counts")
        : `${context.counts.deliverables} deliverables, ${context.counts.decisions} decisions, and ${context.counts.meetings} meetings are attached to this project surface.`,
      fundingOpportunitiesFailure
        ? unknownBecauseUnread(fundingOpportunitiesFailure, "the funding picture for this project")
        : context.fundingSummary.opportunityCount > 0
        ? `${context.fundingSummary.opportunityCount} funding opportunit${context.fundingSummary.opportunityCount === 1 ? "y is" : "ies are"} linked, with ${context.fundingSummary.closingSoonCount} closing soon and ${context.fundingSummary.pursueCount} marked pursue.${awardRecordCount > 0 ? ` ${awardRecordCount} awarded opportunit${awardRecordCount === 1 ? "y still needs" : "ies still need"} an award record.` : ""}${context.fundingSummary.fundingNeedAmount !== null ? ` Target need: ${formatCurrency(context.fundingSummary.fundingNeedAmount)}.` : ""}${gapAmount !== null && gapAmount > 0 ? ` Remaining uncovered after likely dollars: ${formatCurrency(gapAmount)}.` : ""}`
        : needsFundingSourcing
          ? `No funding opportunities are linked yet, but this project already carries a recorded funding need of ${formatCurrency(context.fundingSummary.fundingNeedAmount)}. Funding sourcing should come before gap-closing claims.`
          : "No funding opportunities are linked to this project yet.",
      overdueDecisionCount > 0
        ? `${overdueDecisionCount} monitored funding decision${overdueDecisionCount === 1 ? " has" : "s have"} lapsed the recorded decision deadline while the window is still open, so these pursue or skip calls outrank newer closing-soon timing.${leadOverdueOpportunity ? ` ${leadOverdueOpportunity.title} is the lead overdue monitor decision to resolve first.` : ""}`
        : null,
      context.fundingSummary.closingSoonCount > 0 && leadClosingOpportunity
        ? `${context.fundingSummary.closingSoonCount} funding opportunit${context.fundingSummary.closingSoonCount === 1 ? "y closes" : "ies close"} within the next 14 days. ${leadClosingOpportunity.title} is the first deadline to reopen.`
        : null,
      context.fundingSummary.opportunityCount > 0 && context.fundingSummary.pursueCount === 0 && context.fundingSummary.leadOpportunity
        ? `No opportunity is marked pursue yet. ${context.fundingSummary.leadOpportunity.title} is the lead grant decision to advance next.`
        : null,
      awardRecordCount > 0 && leadAwardOpportunity
        ? `Award record still needed for ${leadAwardOpportunity.title}.`
        : null,
      exactInvoiceAwardRelink
        ? "One exact invoice-to-award relink is ready on this project, so reimbursement bookkeeping can be repaired without guessing any billing values."
        : null,
      awardRecordCount === 0 && awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
        ? `${awardCount} committed award${awardCount === 1 ? " is" : "s are"} logged, with ${formatCurrency(uninvoicedAwardAmount ?? 0)} not yet invoiced.${reimbursementPacketCount > 0 ? ` ${reimbursementPacketCount} reimbursement packet${reimbursementPacketCount === 1 ? " is" : "s are"} already started.` : ""}`
        : null,
      linkedDatasetsFailure
        ? unknownBecauseUnread(linkedDatasetsFailure, "dataset linkage for this project")
        : `${context.counts.linkedDatasets} linked datasets are visible, with ${context.counts.overlayReadyDatasets} already usable as analysis overlays.`,
      recentRunsFailure
        ? unknownBecauseUnread(recentRunsFailure, "recent analysis activity")
        : `${context.counts.recentRuns} recent analysis runs are visible from the same workspace.`,
    ].filter(Boolean) as string[],
    operatorCue: context.stageGateSummary.blockedGate
      ? {
          label: "What to do next",
          title: `Unblock ${context.stageGateSummary.blockedGate.name}`,
          detail: context.stageGateSummary.blockedGate.rationale || "A stage gate is currently on hold and needs evidence or rationale cleanup.",
        }
      : overdueDecisionCount > 0
        ? {
            label: "What to do next",
            title: `${overdueDecisionCount} overdue funding decision${overdueDecisionCount === 1 ? " needs" : "s need"} a pursue or skip call`,
            detail: `Monitored funding opportunities have already lapsed their recorded decision deadline while the window is still open, so these lapsed calls outrank newer closing-soon timing.${leadOverdueOpportunity ? ` Lead overdue monitor decision: ${leadOverdueOpportunity.title}.` : ""}`,
          }
      : context.fundingSummary.closingSoonCount > 0
        ? {
            label: "What to do next",
            title: `${context.fundingSummary.closingSoonCount} funding deadline${context.fundingSummary.closingSoonCount === 1 ? "" : "s"} need attention`,
            detail: `Near-term funding windows are active on this project, so grant timing should be reviewed before less urgent control cleanup.${leadClosingOpportunity ? ` ${leadClosingOpportunity.title} is the first deadline to reopen.` : ""}`,
          }
        : awardRecordCount > 0
          ? {
              label: "What to do next",
              title: `${awardRecordCount} awarded opportunit${awardRecordCount === 1 ? "y needs" : "ies need"} a record`,
              detail: `An opportunity is already marked awarded, but the committed funding record has not been logged yet.${leadAwardOpportunity ? ` Convert ${leadAwardOpportunity.title} into a committed award entry.` : ""}`,
            }
          : exactInvoiceAwardRelink
            ? {
                label: "What to do next",
                title: "Link exact invoice to award",
                detail: "One unlinked invoice and one funding-award record are an exact match on this project, so reimbursement linkage can be repaired directly.",
              }
          : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
            ? {
                label: "What to do next",
                title: `Still uninvoiced: ${formatCurrency(uninvoicedAwardAmount ?? 0)} uninvoiced`,
                detail: reimbursementPacketCount > 0
                  ? "A reimbursement packet is already started, but the invoices do not yet cover everything you have been awarded."
                  : "Committed awards are recorded, but the invoices do not yet cover everything you have been awarded.",
              }
            : needsFundingSourcing
              ? {
                  label: "What to do next",
                  title: "Source the first funding opportunity",
                  detail: "This project already has a recorded funding target but no grants attached, so sourcing candidate programs comes before true gap triage.",
                }
              : gapAmount !== null && gapAmount > 0
                ? {
                    label: "What to do next",
                    title: `Close ${formatCurrency(gapAmount)} remaining funding gap`,
                    detail: "The project still shows uncovered need after current pursued dollars, so funding strategy should be tightened before scope or delivery assumptions drift.",
                  }
                : riskCountsFailure || projectControlCountsFailure
                  ? {
                      label: "What to do next",
                      title: "Project control counts could not be read",
                      detail: unknownBecauseUnread(
                        riskCountsFailure ?? (projectControlCountsFailure as AssistantContextReadFailure),
                        "the live risk, issue, and deliverable picture"
                      ),
                    }
                : {
                    label: "What to do next",
                    title: `${openRisks + openIssues} live project control signal${openRisks + openIssues === 1 ? "" : "s"}`,
                    detail: `${openRisks} risk${openRisks === 1 ? "" : "s"}, ${openIssues} issue${openIssues === 1 ? "" : "s"}, and ${context.counts.deliverables} deliverable${context.counts.deliverables === 1 ? "" : "s"} remain in the current project control picture.`,
                  },
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

function buildRtpRegistryPreview(context: RtpRegistryAssistantContext): AssistantPreview {
  const rtpFundingReviewCount = context.operationsSummary.counts.rtpFundingReviewPackets;
  const grantsRoutedRtpFundingReview = isRtpFundingReviewRoutedThroughGrants(context);
  const rtpFundingReviewPressure = grantsRoutedRtpFundingReview
    ? formatRtpGrantsFollowThroughPressure(rtpFundingReviewCount)
    : formatRtpFundingBackedReleaseReviewPressure(rtpFundingReviewCount);
  const registryPacketPosture = resolveRtpPacketWorkPostureFromCounts({
    noPacketCount: context.counts.noPacketCount,
    refreshRecommendedCount: context.counts.refreshRecommendedCount,
  });
  const registryPosture =
    registryPacketPosture === "generate"
      ? {
          title: "First packet queue is live",
          detail: `${context.counts.noPacketCount} RTP cycle${context.counts.noPacketCount === 1 ? " still needs" : "s still need"} a first generated packet, so generate work outranks refresh or release-review work right now.`,
          summary: `Working from the RTP cycle registry, with generate work currently outranking refresh and release-review work across the visible cycles.`,
        }
      : registryPacketPosture === "refresh"
        ? {
            title: "Refresh queue is live",
            detail: `${context.counts.refreshRecommendedCount} RTP cycle packet${context.counts.refreshRecommendedCount === 1 ? " needs" : "s need"} refresh, so refreshing stale packets is the main work right now.`,
            summary: `Working from the RTP cycle registry, with refresh work currently outranking generate and release-review work across the visible cycles.`,
          }
        : {
            title: "Release-review queue is live",
            detail: hasRtpFundingBackedReleaseReviewPressure(context)
              ? rtpFundingReviewPressure
              : context.recommendedCycle
              ? `${context.recommendedCycle.title} is the cycle that most needs a release review.`
              : "The visible RTP packet queue is materially current enough that release review is now the main work across the registry.",
            summary: `Working from the RTP cycle registry, with release-review work currently outranking generate and refresh work across the visible cycles.`,
          };

  return {
    kind: context.kind,
    title: `${context.workspace.name ?? "Workspace"} RTP registry`,
    summary: registryPosture.summary,
    stats: [
      { label: "Cycles", value: `${context.counts.cycles}` },
      { label: "Public review", value: `${context.counts.publicReviewCycles}` },
      { label: "Packet refresh", value: `${context.counts.refreshRecommendedCount}` },
      { label: PACKET_FRESHNESS_LABELS.NO_PACKET, value: `${context.counts.noPacketCount}` },
    ],
    facts: [
      `${context.counts.draftCycles} draft, ${context.counts.publicReviewCycles} public-review, ${context.counts.adoptedCycles} adopted, and ${context.counts.archivedCycles} archived cycles are currently visible.`,
      context.recommendedCycle
        ? `Suggested cycle: ${context.recommendedCycle.title} (${context.recommendedCycle.packetFreshnessLabel}).`
        : "No RTP cycle is visible yet from this registry snapshot.",
      rtpFundingReviewCount > 0
        ? rtpFundingReviewPressure
        : null,
      context.operationsSummary.nextCommand
        ? `Workspace next command: ${grantsRoutedRtpFundingReview && context.operationsSummary.nextCommand.key === "review-current-report-packets" ? "Open RTP grants follow-through" : context.operationsSummary.nextCommand.title}.`
        : registryPosture.detail,
    ].filter(Boolean) as string[],
    operatorCue: context.operationsSummary.nextCommand
      ? {
          label: "What to do next",
          title:
            grantsRoutedRtpFundingReview && context.operationsSummary.nextCommand.key === "review-current-report-packets"
              ? "Open RTP grants follow-through"
              : context.operationsSummary.nextCommand.title,
          detail: rtpFundingReviewCount > 0 ? rtpFundingReviewPressure : context.operationsSummary.nextCommand.detail,
        }
      : {
          label: "What to do next",
          title: registryPosture.title,
          detail: registryPosture.detail,
        },
    quickLinks: buildAssistantOperations(context),
    suggestedActions: getAssistantActions(context.kind),
  };
}

/**
 * Chapter progress, or the reason it is unknown.
 *
 * The chapter list is the load-bearing one on this surface: `context.ts` may
 * legitimately substitute the TEMPLATE chapters when the deployment has not run
 * the chapter migration (a table that does not exist cannot hold a chapter), but
 * every other failure used to arrive here as an empty list and be spoken as "0
 * chapters are ready for review and 0 are complete" about a cycle that may be
 * nearly adopted.
 */
function describeRtpChapterProgress(context: RtpAssistantContext): string {
  const failure = readFailure(context, ASSISTANT_READ_SUBJECTS.rtpChapters);
  if (failure) {
    return unknownBecauseUnread(failure, "chapter progress for this cycle");
  }

  return `${context.counts.readyForReviewChapters} chapters are ready for review and ${context.counts.completeChapters} are complete.`;
}

/** The same rule for the "N chapters are in scope" phrasing the response uses. */
function describeRtpChapterScope(context: RtpAssistantContext): string {
  const failure = readFailure(context, ASSISTANT_READ_SUBJECTS.rtpChapters);
  if (failure) {
    return unknownBecauseUnread(failure, "chapter scope for this cycle");
  }

  return `${context.counts.chapters} chapters are in scope, with ${context.counts.readyForReviewChapters} ready for review and ${context.counts.completeChapters} complete.`;
}

/**
 * The three lanes the fiscal verdict is computed from. A failure in ANY of them
 * suppresses the verdict — see `RtpAssistantContext.fiscal`.
 */
const RTP_FISCAL_READ_SUBJECTS = [
  ASSISTANT_READ_SUBJECTS.rtpHorizonBands,
  ASSISTANT_READ_SUBJECTS.rtpFinancialAssumptions,
  ASSISTANT_READ_SUBJECTS.rtpLinkedProjects,
] as const;

/**
 * WHETHER THIS PLAN CAN BE PAID FOR — the one sentence a board votes on.
 *
 * THREE RULES, EACH OF WHICH IS THE WHOLE POINT OF THE SENTENCE:
 *
 * 1. A DETERMINED VERDICT IS QUOTED VERBATIM from
 *    `describeRtpFiscalConstraint`. That sentence carries the dollar basis with
 *    the figures because a constant-dollar total presented as
 *    year-of-expenditure is exactly the misstatement 23 CFR 450.324(f)(11)(iv)
 *    exists to prevent. Paraphrasing it here would be a second implementation
 *    of a regulated sentence, free to drift from the one on the page, the
 *    export and the public draft document.
 *
 * 2. `not_determined` SAYS SO AND NAMES THE FIRST BLOCKER. It may not degrade
 *    to "no fiscal issues found", and it may not report the balance: the whole
 *    reason the engine refuses to answer is that the balance it could compute
 *    is missing a cost it knows about. "Not determined, because 4 constrained
 *    projects have no cost recorded" is work a planner can do; a number is a
 *    plan that looks affordable and is not.
 *
 * 3. A READ FAILURE OUTRANKS BOTH. When the bands, the ledger or the linked
 *    projects could not be read there is no verdict at all, and the sentence
 *    says the read failed rather than reporting an absence of findings. An
 *    unreadable financial element is the case where a confident answer does the
 *    most damage.
 *
 * Returns null only for a context built without a financial element at all
 * (`fiscal` is optional on the type — see its doc block); `loadRtpContext`
 * always sets it.
 */
function describeRtpFiscalPosture(context: RtpAssistantContext): string | null {
  const fiscal = context.fiscal;
  if (!fiscal) return null;

  const failure = readFailure(context, ...RTP_FISCAL_READ_SUBJECTS);
  if (failure || !fiscal.summary) {
    const lead = failure
      ? unknownBecauseUnread(failure, "whether this plan is fiscally constrained")
      : "Unknown: whether this plan is fiscally constrained. Its financial element could not be assembled.";
    return `${lead} That is a read failure, not a finding that this plan is unconstrained.`;
  }

  if (fiscal.summary.verdict === "not_determined") {
    const blocker = fiscal.summary.blockers[0];
    return blocker
      ? `Fiscal constraint: not determined. ${blocker.detail}`
      : "Fiscal constraint: not determined.";
  }

  return describeRtpFiscalConstraint(fiscal.summary);
}

/**
 * The performance measures, counted — or disclosed as unread.
 *
 * A count rather than the measures themselves, because the point is that the
 * copilot READS the table it was previously blind to. Reading a table and
 * rendering nothing from it is the shipped-invisible defect class this repo
 * counts; one honest fact is the floor, not the ceiling.
 */
function describeRtpPerformanceMeasures(context: RtpAssistantContext): string | null {
  const fiscal = context.fiscal;
  if (!fiscal) return null;

  const failure = readFailure(context, ASSISTANT_READ_SUBJECTS.rtpPerformanceMeasures);
  if (failure) {
    return unknownBecauseUnread(failure, "the performance measures of this plan");
  }

  return `${fiscal.performanceMeasureCount} performance ${
    fiscal.performanceMeasureCount === 1 ? "measure is" : "measures are"
  } recorded for this plan.`;
}

/** The fiscal lines that are available, in the order they should be read. */
function rtpFinancialElementLines(context: RtpAssistantContext): string[] {
  return [describeRtpFiscalPosture(context), describeRtpPerformanceMeasures(context)].filter(
    (line): line is string => line !== null
  );
}

/** An evidence line naming a count, or the same line saying the read failed. */
function rtpEvidenceLine(context: RtpAssistantContext, label: string, value: number, subject: string): string {
  const failure = readFailure(context, subject);
  return failure ? `${label}: unknown — ${failure.label} could not be read (${failure.message})` : `${label}: ${value}`;
}

function buildRtpPreview(context: RtpAssistantContext): AssistantPreview {
  const rtpFundingReviewCount = context.operationsSummary.counts.rtpFundingReviewPackets;
  const grantsRoutedRtpFundingReview = isRtpFundingReviewRoutedThroughGrants(context);
  const rtpFundingReviewPressure = grantsRoutedRtpFundingReview
    ? formatRtpGrantsFollowThroughPressure(rtpFundingReviewCount)
    : formatRtpFundingBackedReleaseReviewPressure(rtpFundingReviewCount);
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
          detail: "This cycle still lacks a usable current packet artifact, so generate planning outranks refresh or release-review work right now.",
          summary: `Working from this RTP cycle's readiness, chapter workflow, project list, and what still needs generating, before release review begins.`,
        }
      : cyclePacketWorkPosture === "refresh"
        ? {
            title: "Refresh work comes first",
            detail: recommendedPacketDetail,
            summary: `Working from this RTP cycle's readiness, chapter workflow, project list, and how fresh its packets are, before release review.`,
          }
        : {
            title: "Release review comes first",
            detail: hasRtpFundingBackedReleaseReviewPressure(context) ? rtpFundingReviewPressure : recommendedPacketDetail,
            summary: `Working from this RTP cycle's readiness, chapter workflow, project list, and which packets are ready to release.`,
          };

  return {
    kind: context.kind,
    title: context.rtpCycle.title,
    summary: cyclePacketPosture.summary,
    stats: [
      { label: "Status", value: context.rtpCycle.status },
      { label: "Chapters", value: statCount(context, context.counts.chapters, ASSISTANT_READ_SUBJECTS.rtpChapters) },
      {
        label: "Projects",
        value: statCount(context, context.counts.linkedProjects, ASSISTANT_READ_SUBJECTS.rtpLinkedProjects),
      },
      { label: "Packets", value: statCount(context, context.counts.packetReports, ASSISTANT_READ_SUBJECTS.packetReports) },
    ],
    facts: [
      context.rtpCycle.summary || "The RTP cycle does not yet carry a strong summary narrative on the record itself.",
      describeRtpChapterProgress(context),
      // The financial element sits in the FACTS, never in a stat tile: a tile
      // reading "Not determined" beside three counts is read as a fourth count,
      // and the verdict's whole meaning is the caveat that comes with it.
      ...rtpFinancialElementLines(context),
      context.packetSummary.recommendedReport
        ? hasRtpFundingBackedReleaseReviewPressure(context)
          ? `Suggested packet: ${context.packetSummary.recommendedReport.title ?? "board packet"} (${context.packetSummary.recommendedReport.packetFreshness.label}), with ${grantsRoutedRtpFundingReview ? "grants follow-through" : "funding-backed release-review pressure"} still open.`
          : `Suggested packet: ${context.packetSummary.recommendedReport.title ?? "board packet"} (${context.packetSummary.recommendedReport.packetFreshness.label}).`
        : "No RTP board packet is linked yet.",
    ],
    operatorCue: context.operationsSummary.nextCommand
      ? {
          label: "What to do next",
          title:
            grantsRoutedRtpFundingReview && context.operationsSummary.nextCommand.key === "review-current-report-packets"
              ? "Open RTP grants follow-through"
              : context.operationsSummary.nextCommand.title,
          detail: rtpFundingReviewCount > 0 ? rtpFundingReviewPressure : context.operationsSummary.nextCommand.detail,
        }
      : {
          label: "What to do next",
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
    summary: `Working from this plan record's readiness, the evidence linked to it, and the workspace queue around it.`,
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
          label: "What to do next",
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
  const awardRecordCount = context.fundingSummary.awardRecordCount;
  const awardCount = context.fundingSummary.awardCount;
  const uninvoicedAwardAmount = context.fundingSummary.uninvoicedAwardAmount;
  const reimbursementPacketCount = context.fundingSummary.reimbursementPacketCount;
  const exactInvoiceAwardRelink = context.fundingSummary.exactInvoiceAwardRelink;
  const overdueDecisionCount = context.fundingSummary.overdueDecisionCount;
  const leadOverdueOpportunity = context.fundingSummary.leadOverdueOpportunity;
  const leadClosingOpportunity = context.fundingSummary.leadClosingOpportunity;
  const leadAwardOpportunity = context.fundingSummary.leadAwardOpportunity;

  return {
    kind: context.kind,
    title: context.program.title,
    summary: `Working from this program package's readiness, its report packets, funding windows, and the workspace queue around it.`,
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
        ? `${context.fundingSummary.opportunityCount} funding opportunit${context.fundingSummary.opportunityCount === 1 ? "y is" : "ies are"} linked, with ${context.fundingSummary.closingSoonCount} closing soon and ${context.fundingSummary.pursueCount} marked pursue.${awardRecordCount > 0 ? ` ${awardRecordCount} awarded opportunit${awardRecordCount === 1 ? "y still needs" : "ies still need"} an award record.` : ""}${context.fundingSummary.fundingNeedAmount !== null ? ` Recorded project need: ${formatCurrency(context.fundingSummary.fundingNeedAmount)}.` : ""}${gapAmount !== null && gapAmount > 0 ? ` Remaining uncovered after likely dollars: ${formatCurrency(gapAmount)}.` : ""}`
        : needsFundingSourcing
          ? `No funding opportunities are linked yet, but the linked project already carries a recorded funding need of ${formatCurrency(context.fundingSummary.fundingNeedAmount)}. Funding sourcing should come before gap-closing claims.`
          : "No funding opportunities are linked to this program yet.",
      overdueDecisionCount > 0
        ? `${overdueDecisionCount} monitored funding decision${overdueDecisionCount === 1 ? " has" : "s have"} lapsed the recorded decision deadline while the window is still open, so these pursue or skip calls outrank newer closing-soon timing.${leadOverdueOpportunity ? ` ${leadOverdueOpportunity.title} is the lead overdue monitor decision to resolve first.` : ""}`
        : null,
      context.fundingSummary.closingSoonCount > 0 && leadClosingOpportunity
        ? `${context.fundingSummary.closingSoonCount} package funding opportunit${context.fundingSummary.closingSoonCount === 1 ? "y closes" : "ies close"} within the next 14 days. ${leadClosingOpportunity.title} is the first deadline to reopen.`
        : null,
      context.fundingSummary.opportunityCount > 0 && context.fundingSummary.pursueCount === 0 && context.fundingSummary.leadOpportunity
        ? `No package opportunity is marked pursue yet. ${context.fundingSummary.leadOpportunity.title} is the lead grant decision to advance next.`
        : null,
      awardRecordCount > 0 && leadAwardOpportunity
        ? `Award record still needed for ${leadAwardOpportunity.title}.`
        : null,
      exactInvoiceAwardRelink
        ? "One exact invoice-to-award relink is ready on the linked project, so reimbursement bookkeeping can be repaired without guessing any billing values."
        : null,
      awardRecordCount === 0 && awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
        ? `${awardCount} committed award${awardCount === 1 ? " is" : "s are"} logged against the linked project, with ${formatCurrency(uninvoicedAwardAmount ?? 0)} not yet invoiced.${reimbursementPacketCount > 0 ? ` ${reimbursementPacketCount} reimbursement packet${reimbursementPacketCount === 1 ? " is" : "s are"} already started.` : ""}`
        : null,
      context.packetSummary.recommendedReport
        ? `Suggested packet: ${context.packetSummary.recommendedReport.title ?? "report packet"} (${context.packetSummary.recommendedReport.packetFreshness.label}).`
        : "No linked report packet is available yet for this program.",
    ].filter(Boolean) as string[],
    operatorCue: context.operationsSummary.nextCommand
      ? {
          label: "What to do next",
          title: context.operationsSummary.nextCommand.title,
          detail: context.operationsSummary.nextCommand.detail,
        }
      : context.packetSummary.recommendedReport
        ? {
            label: "What to do next",
            title: context.packetSummary.recommendedReport.title ?? "Suggested packet",
            detail: context.packetSummary.recommendedReport.packetFreshness.detail,
          }
        : awardRecordCount > 0
          ? {
              label: "What to do next",
              title: `${awardRecordCount} awarded opportunit${awardRecordCount === 1 ? "y needs" : "ies need"} a record`,
              detail: `An opportunity is already marked awarded on this package, but the committed funding record has not been logged yet.${leadAwardOpportunity ? ` Convert ${leadAwardOpportunity.title} into a committed award entry.` : ""}`,
            }
          : exactInvoiceAwardRelink
            ? {
                label: "What to do next",
                title: "Link exact invoice to award",
                detail: "The linked project has one unlinked invoice and one funding-award record as an exact match, so reimbursement linkage can be repaired directly.",
              }
          : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
            ? {
                label: "What to do next",
                title: `Still uninvoiced: ${formatCurrency(uninvoicedAwardAmount ?? 0)} uninvoiced`,
                detail: reimbursementPacketCount > 0
                  ? "A reimbursement packet is already started on the linked project, but the invoices do not yet cover everything you have been awarded."
                  : "Committed awards are recorded for the linked project, but the invoices do not yet cover everything you have been awarded.",
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
    summary: `Working from the scenario registry, baseline linkage, run-backed comparison board, and report handoff state for this scenario set.`,
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
    summary: `Working from the model record, readiness checks, explicit provenance links, launch template hints, and recent execution history.`,
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
          summary: `Working from this RTP-linked packet's generate setup, its cycle, artifact history, and provenance before release-review work begins.`,
          cueTitle: "First packet work comes first",
          cueDetail: "This RTP-linked packet still needs its first usable artifact, so generate setup outranks refresh and release-review work right now.",
        }
      : packetPosture === "refresh"
        ? {
            summary: `Working from this RTP-linked packet's how fresh it is, its cycle, artifact history, and provenance before release review.`,
            cueTitle: "Refresh work comes first",
            cueDetail: packetFreshness.detail,
          }
        : {
            summary: `Working from this RTP-linked packet's release readiness, its cycle, artifact history, and provenance metadata.`,
            cueTitle: "Release review comes first",
            cueDetail: packetFreshness.detail,
          };

  return {
    kind: context.kind,
    title: context.report.title,
    summary: context.rtpCycle
      ? rtpPacketPreviewPosture.summary
      : `Working from this report packet's composition, linked runs, artifact history, and provenance metadata.`,
    stats: [
      { label: "Status", value: context.report.status },
      { label: "Runs", value: `${context.runs.length}` },
      { label: "Sections", value: `${context.enabledSections}/${context.sectionCount}` },
      { label: context.rtpCycle ? "Packet" : "Artifacts", value: context.rtpCycle ? packetFreshness.label : `${context.artifactCount}` },
    ],
    facts: [
      context.rtpCycle ? `RTP cycle: ${context.rtpCycle.title} · ${context.rtpCycle.status}.` : null,
      context.rtpCycle ? `Lead packet: ${packetFreshness.label}. ${packetFreshness.detail}` : null,
      context.project ? `Project: ${context.project.name}` : "No project is attached to this report.",
      context.latestArtifact
        ? `Latest artifact: ${context.latestArtifact.artifactKind} generated ${formatDateTime(context.latestArtifact.generatedAt)}.`
        : "No artifact has been generated yet.",
      context.engagementCampaign
        ? `Engagement linkage: ${context.engagementCampaign.title} (${context.engagementCampaign.status}).`
        : "No engagement campaign linkage is attached through report sections.",
    ].filter(Boolean) as string[],
    operatorCue: context.rtpCycle
      ? {
          label: "What to do next",
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
    summary: `Working from the active analysis run metrics, summary narrative, and optional baseline comparison.`,
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
  const preview = (() => {
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
  })();

  return withPreviewReadFailureDisclosure(context, preview);
}

function buildWorkspaceResponse(
  context: WorkspaceAssistantContext,
  workflowId: string,
  question?: string | null
): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Workspace overview";
  const rtpFundingReviewCount = context.operationsSummary.counts.rtpFundingReviewPackets;
  const grantsRoutedRtpFundingReview = isRtpFundingReviewRoutedThroughGrants(context);
  const rtpFundingReviewPressure = grantsRoutedRtpFundingReview
    ? formatRtpGrantsFollowThroughPressure(rtpFundingReviewCount)
    : formatRtpFundingBackedReleaseReviewPressure(rtpFundingReviewCount);
  const missingFundingAnchorCount = context.operationsSummary.counts.projectFundingNeedAnchorProjects;
  const fundingSourcingCount = context.operationsSummary.counts.projectFundingSourcingProjects;
  const fundingDecisionCount = context.operationsSummary.counts.projectFundingDecisionProjects;
  const fundingAwardRecordCount = context.operationsSummary.counts.projectFundingAwardRecordProjects;
  const reimbursementStartCount = context.operationsSummary.counts.projectFundingReimbursementStartProjects;
  const reimbursementAdvanceCount = context.operationsSummary.counts.projectFundingReimbursementActiveProjects;
  const gapProjectCount = context.operationsSummary.counts.projectFundingGapProjects;
  const invoiceRelinkCommand = context.operationsSummary.commandQueue.find((item) => item.key === "relink-project-invoice-awards");
  const invoiceRelinkCount = typeof invoiceRelinkCommand?.badges[0]?.value === "number" ? invoiceRelinkCommand.badges[0].value : 0;
  const reimbursementStartCommand = context.operationsSummary.commandQueue.find((item) => item.key === "start-project-reimbursement-packets");
  const reimbursementAdvanceCommand = context.operationsSummary.commandQueue.find((item) => item.key === "advance-project-reimbursement-invoicing");
  const fundingDecisionCommand = context.operationsSummary.commandQueue.find((item) => item.key === "advance-project-funding-decisions");
  const leadFundingDecisionDetail = context.operationsSummary.grantModelingSummary?.leadDecisionDetail ?? null;

  if (workflowId === "analysis-focus" && context.currentRun) {
    return {
      workflowId,
      label,
      title: `Analysis focus: ${context.currentRun.title}`,
      summary: `This analysis is looking at ${context.currentRun.title}. The most useful next read is the score plus any attached baseline before exporting or reporting anything downstream.`,
      findings: [
        `Overall/access/safety/equity: ${metricLabel(context.currentRun.metrics, "overallScore")} / ${metricLabel(context.currentRun.metrics, "accessibilityScore")} / ${metricLabel(context.currentRun.metrics, "safetyScore")} / ${metricLabel(context.currentRun.metrics, "equityScore")}.`,
        context.baselineRun
          ? `A baseline is already attached (${context.baselineRun.title}), so this surface can support a like-for-like comparison pass right now.`
          : "No baseline is attached, so the current run is best treated as a standalone brief until a baseline is pinned to compare against.",
        asString(context.currentRun.metrics.confidence)
          ? `Run confidence is labeled ${String(context.currentRun.metrics.confidence)}.`
          : "The run does not expose an explicit confidence label in stored metrics.",
      ],
      nextSteps: [
        context.baselineRun
          ? "Use the compare workflow next to quantify score movement against the pinned baseline."
          : "Pin a baseline run if you need a defendable before/after or alternative-versus-baseline read.",
        "Export metrics or geometry only after reading the run summary and checking its sources.",
      ],
      evidence: [
        `Workspace: ${context.workspace.name ?? "Current workspace"}`,
        `Current run captured ${formatDateTime(context.currentRun.createdAt)}`,
        question ? `Prompt received: ${question}` : "Prompt used default Analysis Studio brief.",
      ],
      caution: "Analysis output is working material and should be human-reviewed before external use.",
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "workspace-funding") {
    return {
      workflowId,
      label,
      title: `Funding gaps in ${context.workspace.name ?? "this workspace"}`,
        summary:
        missingFundingAnchorCount > 0
          ? `${missingFundingAnchorCount} project funding lane${missingFundingAnchorCount === 1 ? " still lacks" : "s still lack"} a funding target even though grant records already exist, so the first honest move is recording what each needs before ranking the gaps.`
          : fundingSourcingCount > 0
          ? `${fundingSourcingCount} project funding stack${fundingSourcingCount === 1 ? " already has" : "s already have"} a recorded funding target but no grants attached, so sourcing candidates comes before gap-closing choreography.`
          : fundingDecisionCount > 0
          ? leadFundingDecisionDetail
            ? `${leadFundingDecisionDetail} Grant-decision work still comes before gap-closing math.`
            : `${fundingDecisionCount} project funding stack${fundingDecisionCount === 1 ? " already has" : "s already have"} linked opportunities but nothing marked pursue yet, so grant-decision work comes before gap-closing math.`
          : fundingAwardRecordCount > 0
          ? `${fundingAwardRecordCount} project funding stack${fundingAwardRecordCount === 1 ? " already has" : "s already have"} an opportunity marked awarded but still no funding-award record, so committed-dollar reconciliation comes before final gap math.`
          : invoiceRelinkCount > 0
          ? `${invoiceRelinkCount} project reimbursement lane${invoiceRelinkCount === 1 ? " has" : "s have"} an exact invoice-to-award relink ready, so reimbursement bookkeeping can move forward without inventing any billing values.`
          : reimbursementStartCount > 0
          ? `${reimbursementStartCount} project funding stack${reimbursementStartCount === 1 ? " has" : "s have"} committed awards but still no reimbursement packet started, so the next honest move is opening the audited reimbursement trail before only talking about gap closure.`
          : reimbursementAdvanceCount > 0
          ? `${reimbursementAdvanceCount} project funding stack${reimbursementAdvanceCount === 1 ? " already has" : "s already have"} reimbursement work underway, but invoicing still trails committed awards, so follow-through now deserves explicit workspace attention.`
          : gapProjectCount > 0
          ? `${gapProjectCount} project funding stack${gapProjectCount === 1 ? " still shows" : "s still show"} uncovered need after current pursued dollars, so closing funding gaps is now real work across the workspace.`
          : "No uncovered project funding gaps are currently visible from the workspace command queue.",
      findings: [
        context.operationsSummary.nextCommand
          ? `Current queue lead: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No queue-leading workspace command is currently visible.",
        missingFundingAnchorCount > 0
          ? `Missing funding targets: ${missingFundingAnchorCount}.`
          : fundingSourcingCount > 0
          ? `Projects needing funding sourcing: ${fundingSourcingCount}.`
          : fundingDecisionCount > 0
          ? leadFundingDecisionDetail
            ? `Lead grant decision cue: ${leadFundingDecisionDetail}`
            : `Projects needing pursue decisions: ${fundingDecisionCount}.`
          : fundingAwardRecordCount > 0
          ? `Awarded opportunities still missing funding-award records: ${fundingAwardRecordCount}.`
          : invoiceRelinkCount > 0
          ? `Exact invoice-to-award relinks ready: ${invoiceRelinkCount}.`
          : reimbursementStartCount > 0
          ? `Projects still needing a first reimbursement packet: ${reimbursementStartCount}.`
          : reimbursementAdvanceCount > 0
          ? `Projects with reimbursement follow-through still active: ${reimbursementAdvanceCount}.`
          : gapProjectCount > 0
          ? `Project funding gap count: ${gapProjectCount}.`
          : "The current workspace snapshot does not show any project with a flagged funding gap.",
        context.recentProject
          ? `Most recent project: ${context.recentProject.name}.`
          : "No recent project is visible in this workspace.",
      ],
      nextSteps: [
        missingFundingAnchorCount > 0
          ? `Open ${resolveWorkspaceCommandHref(context.operationsSummary.commandQueue.find((item) => item.key === "anchor-project-funding-needs") ?? { key: "", title: "", detail: "", href: "/projects", tone: "neutral", priority: 0, badges: [] })} and record a funding target before trying to size the gap.`
          : fundingSourcingCount > 0
          ? `Open ${resolveWorkspaceCommandHref(context.operationsSummary.commandQueue.find((item) => item.key === "source-project-funding-opportunities") ?? { key: "", title: "", detail: "", href: "/projects", tone: "neutral", priority: 0, badges: [] })} and source candidate programs before treating the project as a quantified funding gap.`
          : fundingDecisionCount > 0
          ? leadFundingDecisionDetail
            ? `Open ${resolveWorkspaceCommandHref(fundingDecisionCommand ?? { key: "", title: "", detail: "", href: "/projects", tone: "neutral", priority: 0, badges: [] })} and use this lead grant cue before treating this as real money: ${leadFundingDecisionDetail}`
            : `Open ${resolveWorkspaceCommandHref(context.operationsSummary.commandQueue.find((item) => item.key === "advance-project-funding-decisions") ?? { key: "", title: "", detail: "", href: "/projects", tone: "neutral", priority: 0, badges: [] })} and mark the lead opportunity pursue before treating this as real money.`
          : fundingAwardRecordCount > 0
          ? `Open ${resolveWorkspaceCommandHref(context.operationsSummary.commandQueue.find((item) => item.key === "record-awarded-funding") ?? { key: "", title: "", detail: "", href: "/projects", tone: "neutral", priority: 0, badges: [] })} and convert the awarded opportunity into a funding-award record before trusting the remaining gap math.`
          : invoiceRelinkCount > 0
          ? `Open ${invoiceRelinkCommand ? resolveWorkspaceCommandHref(invoiceRelinkCommand) : "/projects"} and attach the exact unlinked invoice to its funding award before advancing reimbursement closeout.`
          : reimbursementStartCount > 0
          ? `Open ${reimbursementStartCommand ? resolveWorkspaceCommandHref(reimbursementStartCommand) : "/projects"} and start the first reimbursement packet before routine funding-gap cleanup.`
          : reimbursementAdvanceCount > 0
          ? `Open ${reimbursementAdvanceCommand ? resolveWorkspaceCommandHref(reimbursementAdvanceCommand) : "/projects"} and invoice the reimbursement work already started, before the closeout record falls behind.`
          : gapProjectCount > 0
          ? `Open ${resolveWorkspaceCommandHref(context.operationsSummary.commandQueue.find((item) => item.key === "close-project-funding-gaps") ?? { key: "", title: "", detail: "", href: "/projects", tone: "neutral", priority: 0, badges: [] })} and reopen the thinnest-funded project first.`
          : "Keep funding need amounts, pursue decisions, and awarded funding records current so the gap stays trustworthy.",
        "Close the gap between scope and funding in the project's funding section, not in a note somewhere.",
      ],
      evidence: [
        `Missing funding targets: ${missingFundingAnchorCount}`,
        `Needs sourcing: ${fundingSourcingCount}`,
        `Needs decisions: ${fundingDecisionCount}`,
        `Award records needed: ${fundingAwardRecordCount}`,
        `Exact invoice relinks: ${invoiceRelinkCount}`,
        `Need reimbursement packets: ${reimbursementStartCount}`,
        `Reimbursement follow-through active: ${reimbursementAdvanceCount}`,
        `Gap projects: ${gapProjectCount}`,
        `Queue depth: ${context.operationsSummary.counts.queueDepth}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `${context.workspace.name ?? "Workspace"} overview`,
    summary: `This workspace currently reads as a planning-control shell with ${pluralize(context.recentRuns.length, "recent run")} visible${context.recentProject ? ` and ${context.recentProject.name} as the most recent project` : ""}.${rtpFundingReviewCount > 0 ? ` ${rtpFundingReviewPressure}` : fundingDecisionCount > 0 && leadFundingDecisionDetail ? ` Lead grant decision cue: ${leadFundingDecisionDetail}` : ""} Across the workspace: ${context.operationsSummary.posture}.`,
    findings: [
      context.recentProject
        ? `Most recent project: ${context.recentProject.name} · ${context.recentProject.status} · ${context.recentProject.deliveryPhase}.`
        : "No current project snapshot is visible from this workspace request.",
      context.operationsSummary.nextCommand
        ? `Next command: ${grantsRoutedRtpFundingReview && context.operationsSummary.nextCommand.key === "review-current-report-packets" ? "Open RTP grants follow-through" : context.operationsSummary.nextCommand.title}. ${rtpFundingReviewCount > 0 ? rtpFundingReviewPressure : fundingDecisionCount > 0 && leadFundingDecisionDetail ? leadFundingDecisionDetail : context.operationsSummary.nextCommand.detail}`
        : "No immediate command-queue pressure is visible from the workspace snapshot.",
      rtpFundingReviewCount > 0
        ? rtpFundingReviewPressure
        : missingFundingAnchorCount > 0
        ? `${missingFundingAnchorCount} project funding lane${missingFundingAnchorCount === 1 ? " still lacks" : "s still lack"} a funding target even though grant records already exist.`
        : fundingSourcingCount > 0
        ? `${fundingSourcingCount} project funding stack${fundingSourcingCount === 1 ? " already has" : "s already have"} need recorded but still no linked opportunities.`
        : fundingDecisionCount > 0
        ? leadFundingDecisionDetail
          ? leadFundingDecisionDetail
          : `${fundingDecisionCount} project funding stack${fundingDecisionCount === 1 ? " already has" : "s already have"} linked opportunities but still nothing marked pursue.`
        : fundingAwardRecordCount > 0
        ? `${fundingAwardRecordCount} project funding stack${fundingAwardRecordCount === 1 ? " has" : "s have"} an awarded opportunity but still no committed funding-award record.`
        : invoiceRelinkCount > 0
        ? `${invoiceRelinkCount} project reimbursement lane${invoiceRelinkCount === 1 ? " has" : "s have"} an exact invoice-to-award relink ready.`
        : reimbursementStartCount > 0
        ? "At least one project already has committed awards but still no reimbursement packet started."
        : reimbursementAdvanceCount > 0
        ? "At least one project already has reimbursement work started, but the invoices still trail the awards."
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
        ? grantsRoutedRtpFundingReview && context.operationsSummary.nextCommand.key === "review-current-report-packets"
          ? `Open ${resolveWorkspaceCommandHref(context.operationsSummary.nextCommand)} to resolve RTP-linked grants follow-through before treating current packet freshness as settled.`
          : `Open ${resolveWorkspaceCommandHref(context.operationsSummary.nextCommand)} to act on ${context.operationsSummary.nextCommand.title.toLowerCase()}.`
        : context.currentRun
          ? "Open the analysis-focus workflow for a brief built on this run."
          : "Open Analysis Studio or a project detail page to deepen grounding.",
      context.recentProject ? `Use ${context.recentProject.name} as the place to start.` : "Create or attach a project record before expecting deeper assistant grounding.",
    ],
    evidence: [
      `Role: ${context.workspace.role ?? "Unknown"}`,
      `Queue depth: ${context.operationsSummary.counts.queueDepth}`,
      `Packet pressure: ${context.operationsSummary.counts.reportRefreshRecommended + context.operationsSummary.counts.reportNoPacket}`,
      `RTP funding review packets: ${rtpFundingReviewCount}`,
      `Missing funding targets: ${missingFundingAnchorCount}`,
      `Needs sourcing: ${fundingSourcingCount}`,
      `Needs decisions: ${fundingDecisionCount}`,
      `Award records needed: ${fundingAwardRecordCount}`,
      `Exact invoice relinks: ${invoiceRelinkCount}`,
      `Need reimbursement packets: ${reimbursementStartCount}`,
      `Reimbursement follow-through active: ${reimbursementAdvanceCount}`,
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
        : describeAbsentStageGateHold(
            context.stageGateSummary,
            `${context.project.name} does not show a formal held stage gate, but open risk and issue counts still need active review.`
          ),
      findings: [
        blockedGate
          ? `Primary gate hold: ${blockedGate.gateId} · ${blockedGate.name} · ${blockedGate.rationale}`
          : describeAbsentStageGateHold(
              context.stageGateSummary,
              "No stage gate is currently recorded on HOLD."
            ),
        `${pluralize(context.counts.risks, "risk")} and ${pluralize(context.counts.issues, "issue")} are visible on the project record.`,
        blockedGate?.missingArtifacts.length
          ? `Missing artifacts on the blocked gate: ${blockedGate.missingArtifacts.join(", ")}.`
          // Same rule as the two findings above: with the log unread there is no
          // blocked gate to carry a missing-artifact list, so reporting the list
          // as absent would state an outage as a fact about the gate record.
          : context.stageGateSummary.decisionsRead.readable
            ? "No explicit missing-artifact list is recorded on the current gate surface."
            : "Whether any missing-artifact list is recorded is unknown for the same reason: the gate decision log did not load.",
      ],
      nextSteps: [
        blockedGate
          ? `Close the evidence gap for ${blockedGate.gateId} before treating this project as gate-ready.`
          : "Review risk and issue records directly to confirm whether the current counts are still active blockers.",
        "Use the project control room to tighten rationale, owners, and mitigation notes before external reporting.",
      ],
      evidence: [
        describeStageGateCounts(context.stageGateSummary),
        `Project status: ${context.project.status}`,
        `Updated: ${formatDateTime(context.project.updatedAt)}`,
      ],
      caution: "This blocker summary is only as complete as the recorded risk, issue, and gate-decision data already attached to the project.",
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "project-funding") {
    const awardRecordCount = context.fundingSummary.awardRecordCount;
    const awardCount = context.fundingSummary.awardCount;
    const uninvoicedAwardAmount = context.fundingSummary.uninvoicedAwardAmount;
    const reimbursementPacketCount = context.fundingSummary.reimbursementPacketCount;
    const exactInvoiceAwardRelink = context.fundingSummary.exactInvoiceAwardRelink;
    const overdueDecisionCount = context.fundingSummary.overdueDecisionCount;
    const leadOverdueOpportunity = context.fundingSummary.leadOverdueOpportunity;
    const leadClosingOpportunity = context.fundingSummary.leadClosingOpportunity;
    const leadAwardOpportunity = context.fundingSummary.leadAwardOpportunity;
    return {
      workflowId,
      label,
      title: `Funding for ${context.project.name}`,
      summary:
        context.fundingSummary.opportunityCount > 0
          ? `${context.project.name} has ${context.fundingSummary.opportunityCount} linked funding opportunit${context.fundingSummary.opportunityCount === 1 ? "y" : "ies"}, with ${context.fundingSummary.closingSoonCount} closing soon and ${context.fundingSummary.pursueCount} marked pursue.${overdueDecisionCount > 0 ? ` ${overdueDecisionCount} monitored funding decision${overdueDecisionCount === 1 ? " has" : "s have"} already lapsed the recorded decision deadline, so those lapsed calls outrank newer closing-soon timing.${leadOverdueOpportunity ? ` ${leadOverdueOpportunity.title} is the lead overdue monitor decision to resolve first.` : ""}` : ""}${awardRecordCount > 0 ? ` ${awardRecordCount} awarded opportunit${awardRecordCount === 1 ? "y still needs" : "ies still need"} an award record.` : ""}${exactInvoiceAwardRelink ? " One exact invoice-to-award relink is ready now." : ""}${awardRecordCount === 0 && awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0 ? ` ${formatCurrency(uninvoicedAwardAmount ?? 0)} of committed awards is still uninvoiced.${reimbursementPacketCount > 0 ? ` ${reimbursementPacketCount} reimbursement packet${reimbursementPacketCount === 1 ? " is" : "s are"} already open.` : ""}` : ""}${context.fundingSummary.fundingNeedAmount !== null ? ` Target need is ${formatCurrency(context.fundingSummary.fundingNeedAmount)}.` : ""}${gapAmount !== null && gapAmount > 0 ? ` Remaining uncovered after likely dollars is ${formatCurrency(gapAmount)}.` : ""}`
          : needsFundingSourcing
            ? `${context.project.name} already has a recorded funding need of ${formatCurrency(context.fundingSummary.fundingNeedAmount)}, but no linked funding opportunities yet. The next honest move is sourcing candidate programs, not pretending the gap has already been worked.`
            : `${context.project.name} does not yet have linked funding opportunities, so nothing on the project record points at money yet.`,
      findings: [
        context.fundingSummary.opportunityCount > 0
          ? `${context.fundingSummary.openCount} open or upcoming funding opportunit${context.fundingSummary.openCount === 1 ? "y is" : "ies are"} visible on this project.`
          : needsFundingSourcing
            ? "No funding opportunities are visible yet even though the project funding need is already recorded."
            : "No open or upcoming funding opportunities are visible on this project yet.",
        context.fundingSummary.opportunityCount > 0 && context.fundingSummary.pursueCount === 0 && context.fundingSummary.leadOpportunity
          ? `Lead decision to advance: ${context.fundingSummary.leadOpportunity.title}.`
          : "At least one linked opportunity is already marked pursue, or no opportunity record exists yet.",
        awardRecordCount > 0 && leadAwardOpportunity
          ? `Award record still needed for ${leadAwardOpportunity.title}.`
          : "No awarded opportunity is currently waiting on a project award record.",
        exactInvoiceAwardRelink
          ? "One exact invoice-to-award relink is ready on this project."
          : "No exact invoice-to-award relink is currently safe enough to auto-execute from this project surface.",
        awardRecordCount === 0 && awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
          ? `Committed award dollars are logged, but ${formatCurrency(uninvoicedAwardAmount ?? 0)} is still uninvoiced.${reimbursementPacketCount > 0 ? ` ${reimbursementPacketCount} reimbursement packet${reimbursementPacketCount === 1 ? " is" : "s are"} already on the project.` : ""}`
          : "No committed award reimbursement gap is visible from the linked invoice records.",
        overdueDecisionCount > 0
          ? `${overdueDecisionCount} monitored funding decision${overdueDecisionCount === 1 ? " has" : "s have"} lapsed the recorded decision deadline while the window is still open, so the pursue or skip call is already late.${leadOverdueOpportunity ? ` Lead overdue monitor decision: ${leadOverdueOpportunity.title}.` : ""}`
          : "No monitored funding decision has lapsed the recorded decision deadline on this project.",
        context.fundingSummary.closingSoonCount > 0
          ? `${context.fundingSummary.closingSoonCount} funding opportunit${context.fundingSummary.closingSoonCount === 1 ? "y closes" : "ies close"} within the next 14 days, so timing pressure is real.${leadClosingOpportunity ? ` ${leadClosingOpportunity.title} is the first deadline to reopen.` : ""}`
          : "No near-term funding window is currently closing inside the next 14 days.",
        context.fundingSummary.fundingNeedAmount !== null
          ? `Recorded funding need: ${formatCurrency(context.fundingSummary.fundingNeedAmount)}.`
          : "No project-level funding need amount is recorded yet.",
        gapAmount !== null && gapAmount > 0
          ? `Uncovered after likely dollars: ${formatCurrency(gapAmount)}.`
          : "No uncovered funding gap remains after current pursued dollars, or no target need is recorded yet.",
      ],
      nextSteps: [
        overdueDecisionCount > 0
          ? `Open /projects/${context.project.id}#project-funding-opportunities and resolve the lapsed monitor decision as pursue or skip before newer closing-soon timing is treated as more urgent.${leadOverdueOpportunity ? ` Lead overdue monitor decision: ${leadOverdueOpportunity.title}.` : ""}`
          : awardRecordCount > 0
          ? `Open /projects/${context.project.id}#project-funding-opportunities to convert the awarded opportunity into a funding-award record before trusting the remaining gap math.${leadAwardOpportunity ? ` Convert ${leadAwardOpportunity.title} into a committed award entry.` : ""}`
          : exactInvoiceAwardRelink
            ? `Open /projects/${context.project.id}#project-invoices and attach the exact unlinked invoice to its funding award before broader reimbursement cleanup.`
          : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
            ? reimbursementPacketCount > 0
              ? `Open /projects/${context.project.id}#project-invoices to carry the existing reimbursement packet into the invoice chain before the closeout record falls behind.`
              : `Open /projects/${context.project.id}#project-invoices to move committed awards into reimbursement workflow before the closeout record falls behind.`
            : context.fundingSummary.opportunityCount > 0
              ? `Open /projects/${context.project.id}#project-funding-opportunities to confirm pursue, monitor, or skip, and update what the project has lined up.`
              : needsFundingSourcing
                ? `Open /projects/${context.project.id}#project-funding-opportunities and add the first funding opportunity record against the recorded need.`
                : `Open /projects/${context.project.id}#project-funding-opportunities and add the first funding opportunity record for this project.`,
        awardRecordCount > 0
          ? "Record the committed award first so the remaining uncovered gap reflects real booked dollars instead of only likely dollars."
          : exactInvoiceAwardRelink
            ? "Repair the exact invoice-to-award linkage first so reimbursement bookkeeping becomes trustworthy before generic follow-through work."
          : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
            ? reimbursementPacketCount > 0
              ? "Advoice the existing reimbursement packet so claims catch up with the awards already committed before routine cleanup."
              : "Get the invoices out so claims catch up with the awards already committed before routine cleanup."
            : gapAmount !== null && gapAmount > 0
              ? "Close the remaining uncovered gap before treating what you are pursuing as enough to deliver the full scope."
              : needsFundingSourcing
                ? "Source candidate programs before treating this project's gap as a measured number."
                : context.fundingSummary.fundingNeedAmount !== null
                  ? "Keep the funding target in step with what you are pursuing and what you have won, before promising scope."
                  : "Set the project funding need so grants and awards can be measured against a real gap.",
      ],
      evidence: [
        `Funding opportunities: ${context.fundingSummary.opportunityCount}`,
        `Closing soon: ${context.fundingSummary.closingSoonCount}`,
        `Overdue monitor decisions: ${overdueDecisionCount}`,
        `Pursue decisions: ${context.fundingSummary.pursueCount}`,
        `Award records needed: ${awardRecordCount}`,
        `Exact invoice relink ready: ${exactInvoiceAwardRelink ? "Yes" : "No"}`,
        `Reimbursement packets: ${reimbursementPacketCount}`,
        `Uninvoiced awards: ${awardCount > 0 ? formatCurrency(uninvoicedAwardAmount ?? 0) : "None"}`,
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
        : describeAbsentStageGateHold(
            context.stageGateSummary,
            `No formal stage gate is currently on hold; next gate cue is ${context.stageGateSummary.nextGate?.gateId ?? "not yet set"}.`
          ),
    ],
    nextSteps: [
      blockedGate
        ? `Resolve ${blockedGate.gateId} evidence gaps before claiming the project is fully ready.`
        : context.fundingSummary.overdueDecisionCount > 0
        ? "Resolve the lapsed monitor decision as pursue or skip first so it does not slip behind grants that close sooner."
        : context.fundingSummary.closingSoonCount > 0
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
      context.stageGateSummary.decisionsRead.readable
        ? `Stage-gate pass count: ${context.stageGateSummary.passCount}`
        : `Stage-gate pass count: unknown — the decision log could not be read (${context.stageGateSummary.decisionsRead.reason}).`,
      `Recent run count: ${context.counts.recentRuns}`,
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildRtpRegistryResponse(context: RtpRegistryAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "RTP registry brief";
  const rtpFundingReviewCount = context.operationsSummary.counts.rtpFundingReviewPackets;
  const grantsRoutedRtpFundingReview = isRtpFundingReviewRoutedThroughGrants(context);
  const rtpFundingReviewPressure = grantsRoutedRtpFundingReview
    ? formatRtpGrantsFollowThroughPressure(rtpFundingReviewCount)
    : formatRtpFundingBackedReleaseReviewPressure(rtpFundingReviewCount);
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
        ? `${context.counts.noPacketCount} RTP cycle${context.counts.noPacketCount === 1 ? " still needs" : "s still need"} a first generated packet, so generating them is the top of the queue right now.`
        : "The registry does not currently show any RTP cycles missing a first packet.",
      findings: [
        context.recommendedCycle
          ? `Lead cycle: ${context.recommendedCycle.title} (${context.recommendedCycle.packetFreshnessLabel}).`
          : "No RTP cycle is visible yet from the registry snapshot.",
        `${context.counts.packetReports} RTP board-packet record${context.counts.packetReports === 1 ? " is" : "s are"} currently linked across the registry.`,
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking first-packet work in the RTP registry.",
      ],
      nextSteps: [
        context.recommendedCycle
          ? `Open /rtp/${context.recommendedCycle.id} to start with the cycle that most needs a first packet.`
          : "Create the first RTP cycle before expecting first-packet queue behavior.",
        "Confirm the cycle is ready and its sections are in place before generating anything.",
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
        ? `${context.counts.refreshRecommendedCount} RTP cycle packet${context.counts.refreshRecommendedCount === 1 ? " needs" : "s need"} refresh, so refreshing stale packets is the top of the queue right now.`
        : "The registry does not currently show stale RTP packets that need refresh.",
      findings: [
        context.recommendedCycle
          ? `Lead cycle: ${context.recommendedCycle.title} (${context.recommendedCycle.packetFreshnessLabel}).`
          : "No RTP cycle is visible yet from the registry snapshot.",
        `${context.counts.packetReports} RTP board-packet record${context.counts.packetReports === 1 ? " is" : "s are"} currently linked across the registry.`,
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking RTP refresh work in the registry.",
      ],
      nextSteps: [
        context.recommendedCycle
          ? `Open /rtp/${context.recommendedCycle.id} to start with the cycle whose packet is most out of date.`
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
      title: `Release-review RTP queue: ${context.workspace.name ?? "Current workspace"}`,
      summary: hasRtpFundingBackedReleaseReviewPressure(context)
        ? rtpFundingReviewPressure
        : context.recommendedCycle
        ? `${context.recommendedCycle.title} is the cycle whose RTP packet most needs a release review.`
        : "No RTP packet is ready for a release review yet.",
      findings: [
        `${context.counts.packetReports} RTP board-packet record${context.counts.packetReports === 1 ? " is" : "s are"} currently linked across the registry.`,
        hasRtpFundingBackedReleaseReviewPressure(context)
          ? rtpFundingReviewPressure
          : context.recommendedCycle
          ? `Recommended cycle: ${context.recommendedCycle.title} (${context.recommendedCycle.status}, ${context.recommendedCycle.packetFreshnessLabel}).`
          : "No RTP cycle exists yet to review for release.",
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking release-review work in the RTP registry.",
      ],
      nextSteps: [
        context.recommendedCycle
          ? `Open /rtp/${context.recommendedCycle.id} to start with the cycle most ready for a release review.`
          : "Create and mature at least one RTP cycle and packet before expecting release-review work.",
        "Check packet freshness, cycle drift, and release readiness before this leaves the agency.",
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
      summary: hasRtpFundingBackedReleaseReviewPressure(context)
        ? `${context.recommendedCycle ? `${context.recommendedCycle.title} is the RTP cycle to work next. ` : ""}${rtpFundingReviewPressure}`
        : context.recommendedCycle
        ? `${context.recommendedCycle.title} is the RTP cycle to work next, and the registry shows ${context.counts.refreshRecommendedCount} cycle packet${context.counts.refreshRecommendedCount === 1 ? "" : "s"} needing refresh plus ${context.counts.noPacketCount} cycle${context.counts.noPacketCount === 1 ? "" : "s"} still missing a generated packet.`
        : "Nothing can be said about the RTP packet queue yet, because there are no cycles in the registry snapshot.",
      findings: [
        `${context.counts.packetReports} RTP board-packet record${context.counts.packetReports === 1 ? " is" : "s are"} currently linked across the registry.`,
        hasRtpFundingBackedReleaseReviewPressure(context)
          ? rtpFundingReviewPressure
          : context.recommendedCycle
          ? `${context.recommendedCycle.title} is in ${context.recommendedCycle.packetFreshnessLabel.toLowerCase()}.`
          : "No RTP cycle exists yet to hang a packet on.",
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${grantsRoutedRtpFundingReview && context.operationsSummary.nextCommand.key === "review-current-report-packets" ? "Open RTP grants follow-through" : context.operationsSummary.nextCommand.title}. ${rtpFundingReviewCount > 0 ? rtpFundingReviewPressure : context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking the RTP registry from the current snapshot.",
      ],
      nextSteps: [
        context.recommendedCycle
          ? `Open /rtp/${context.recommendedCycle.id} to work the strongest current RTP packet or cycle signal first.`
          : "Create the first RTP cycle before expecting packet queue behavior.",
        hasRtpFundingBackedReleaseReviewPressure(context)
          ? grantsRoutedRtpFundingReview
            ? "Work the grants follow-through before treating this packet as settled."
            : "Work the funding side of the release review before treating this packet as settled."
          : context.counts.noPacketCount > 0
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
    summary: hasRtpFundingBackedReleaseReviewPressure(context)
      ? `The RTP registry currently shows ${context.counts.cycles} cycle${context.counts.cycles === 1 ? "" : "s"}. ${rtpFundingReviewPressure}`
      : `The RTP registry currently shows ${context.counts.cycles} cycle${context.counts.cycles === 1 ? "" : "s"}, with packets split between ${context.counts.refreshRecommendedCount} needing refresh and ${context.counts.noPacketCount} still missing a generated packet.`,
    findings: [
      `${context.counts.draftCycles} draft, ${context.counts.publicReviewCycles} public-review, ${context.counts.adoptedCycles} adopted, ${context.counts.archivedCycles} archived.`,
      context.recommendedCycle
        ? `Recommended next cycle: ${context.recommendedCycle.title} (${context.recommendedCycle.status}, ${context.recommendedCycle.packetFreshnessLabel}).`
        : "No RTP cycle is visible yet from the registry snapshot.",
      context.operationsSummary.nextCommand
        ? `Workspace next command: ${context.operationsSummary.nextCommand.title}.`
        : "No broader workspace queue currently outranks the RTP registry.",
    ],
    nextSteps: [
      context.recommendedCycle
        ? `Use ${context.recommendedCycle.title} as the next RTP cycle to work, rather than reading the registry as a list.`
        : "Create the first RTP cycle so the registry can become a real operating surface.",
      context.counts.refreshRecommendedCount > 0 || context.counts.noPacketCount > 0
        ? "Work packet pressure alongside cycle status so the registry stays honest about board/binder readiness."
        : "Keep chapters, packets, and the queue in step as cycles advance between draft, public review, and adopted states.",
    ],
    evidence: [
      `Workspace role: ${context.workspace.role ?? "Unknown"}`,
      `Queue depth: ${context.operationsSummary.counts.queueDepth}`,
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildRtpResponse(context: RtpAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "RTP brief";
  const rtpFundingReviewCount = context.operationsSummary.counts.rtpFundingReviewPackets;
  const grantsRoutedRtpFundingReview = isRtpFundingReviewRoutedThroughGrants(context);
  const rtpFundingReviewPressure = grantsRoutedRtpFundingReview
    ? formatRtpGrantsFollowThroughPressure(rtpFundingReviewCount)
    : formatRtpFundingBackedReleaseReviewPressure(rtpFundingReviewCount);
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
      summary: `${context.rtpCycle.title} still needs a usable current RTP board packet artifact, so generate planning is the top cycle-level packet move right now.`,
      findings: [
        context.packetSummary.linkedReportCount > 0
          ? `${context.packetSummary.linkedReportCount} linked packet${context.packetSummary.linkedReportCount === 1 ? " is" : "s are"} visible, with ${context.packetSummary.noPacketCount} missing a generated artifact.`
          : "No linked packet record exists yet, so the cycle still needs its first RTP board-packet trail.",
        context.packetSummary.recommendedReport
          ? `${context.packetSummary.recommendedReport.title ?? "Lead packet"} is in ${context.packetSummary.recommendedReport.packetFreshness.label.toLowerCase()}.`
          : "Once the first packet record exists, it can be generated and reviewed like any other RTP packet.",
        context.readiness.ready
          ? "Cycle readiness is materially in place for first-packet generation."
          : context.readiness.reason,
      ],
      nextSteps: [
        context.packetSummary.recommendedReport
          ? `Open /reports/${context.packetSummary.recommendedReport.id} to confirm packet sections and generate basis.`
          : "Create or attach the first RTP board packet record before expecting artifact generation.",
        context.readiness.ready
          ? "Once packet sections and source basis are confirmed, generate the first board packet artifact."
          : context.readiness.nextSteps[0] ?? "Tighten the missing cycle setup before generating the first board packet.",
      ],
      evidence: [
        rtpEvidenceLine(context, "Chapters", context.counts.chapters, ASSISTANT_READ_SUBJECTS.rtpChapters),
        rtpEvidenceLine(context, "Linked projects", context.counts.linkedProjects, ASSISTANT_READ_SUBJECTS.rtpLinkedProjects),
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
          ? `${context.packetSummary.recommendedReport.title ?? "Lead packet"} is in ${context.packetSummary.recommendedReport.packetFreshness.label.toLowerCase()}.`
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
        rtpEvidenceLine(context, "Chapters", context.counts.chapters, ASSISTANT_READ_SUBJECTS.rtpChapters),
        rtpEvidenceLine(context, "Linked projects", context.counts.linkedProjects, ASSISTANT_READ_SUBJECTS.rtpLinkedProjects),
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
      summary: hasRtpFundingBackedReleaseReviewPressure(context)
        ? `${context.rtpCycle.title} has a current RTP packet, but ${rtpFundingReviewPressure}`
        : `${context.rtpCycle.title} has a current RTP packet, so a release review is the next step for this cycle right now.`,
      findings: [
        `${context.packetSummary.linkedReportCount} linked packet${context.packetSummary.linkedReportCount === 1 ? " is" : "s are"} visible.`,
        context.packetSummary.recommendedReport
          ? hasRtpFundingBackedReleaseReviewPressure(context)
            ? `${context.packetSummary.recommendedReport.title ?? "Lead packet"} is current, but ${grantsRoutedRtpFundingReview ? "grants follow-through is" : "funding-backed release-review pressure is"} still open.`
            : `${context.packetSummary.recommendedReport.title ?? "Lead packet"} is in ${context.packetSummary.recommendedReport.packetFreshness.label.toLowerCase()}.`
          : "No linked packet record is available yet, so release-review work is premature.",
        context.readiness.ready
          ? "Cycle readiness is materially in place for release-review work."
          : context.readiness.reason,
      ],
      nextSteps: [
        hasRtpFundingBackedReleaseReviewPressure(context)
          ? grantsRoutedRtpFundingReview
            ? "Resolve the grants follow-through before treating the current packet as settled."
            : "Resolve the funding-backed release-review pressure before treating the current packet as settled."
          : context.packetSummary.recommendedReport
          ? `Open /reports/${context.packetSummary.recommendedReport.id} to check whether the lead board packet is ready to release.`
          : "Create and mature a packet before expecting release-review work.",
        "Check packet freshness, cycle drift, and where each figure came from before board or public use.",
      ],
      evidence: [
        rtpEvidenceLine(context, "Chapters", context.counts.chapters, ASSISTANT_READ_SUBJECTS.rtpChapters),
        rtpEvidenceLine(context, "Linked projects", context.counts.linkedProjects, ASSISTANT_READ_SUBJECTS.rtpLinkedProjects),
        `Packet reports: ${context.packetSummary.linkedReportCount}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "rtp-packet") {
    return {
      workflowId,
      label,
      title: `Report packet for ${context.rtpCycle.title}`,
      summary: context.packetSummary.recommendedReport
        ? cyclePacketWorkPosture === "generate"
          ? `${context.rtpCycle.title} currently needs generate work before release-review work, and the lead packet is ${context.packetSummary.recommendedReport.title ?? "its lead board packet"}.`
          : cyclePacketWorkPosture === "refresh"
            ? `${context.rtpCycle.title} currently points first to ${context.packetSummary.recommendedReport.title ?? "its lead board packet"}, which still needs refresh before release-review work.`
            : hasRtpFundingBackedReleaseReviewPressure(context)
              ? `${context.rtpCycle.title} currently points first to ${context.packetSummary.recommendedReport.title ?? "its lead board packet"}, which is current but still under ${grantsRoutedRtpFundingReview ? "grants follow-through" : "funding-backed release-review pressure"}.`
              : `${context.rtpCycle.title} currently points first to ${context.packetSummary.recommendedReport.title ?? "its lead board packet"}, which is materially current for release-review work.`
        : `${context.rtpCycle.title} does not yet have a linked RTP board packet, so the packet trail still needs to be established.`,
      findings: [
        `${context.packetSummary.linkedReportCount} linked packet${context.packetSummary.linkedReportCount === 1 ? "" : "s"}, ${context.packetSummary.refreshRecommendedCount} needing refresh, ${context.packetSummary.noPacketCount} with no generated artifact.`,
        hasRtpFundingBackedReleaseReviewPressure(context)
          ? rtpFundingReviewPressure
          : context.packetSummary.recommendedReport
          ? context.packetSummary.recommendedReport.packetFreshness.detail
          : "No linked packet record is available to refresh or review yet.",
        context.operationsSummary.nextCommand
          ? `Workspace queue pressure: ${context.operationsSummary.nextCommand.title}. ${context.operationsSummary.nextCommand.detail}`
          : "No broader workspace queue pressure is currently outranking this RTP cycle from the current snapshot.",
      ],
      nextSteps: [
        hasRtpFundingBackedReleaseReviewPressure(context)
          ? grantsRoutedRtpFundingReview
            ? "Work the grants follow-through before treating this packet as settled."
            : "Work the funding side of the release review before treating this packet as settled."
          : context.packetSummary.recommendedReport
          ? `Open /reports/${context.packetSummary.recommendedReport.id} to act on this RTP packet.`
          : "Create or attach the first RTP board packet before treating this cycle as packet-ready.",
        context.readiness.ready
          ? "Once the packets are current, keep chapter workflow and project linkage aligned with the current cycle phase."
          : context.readiness.nextSteps[0] ?? "Tighten the missing cycle setup before building more packet surface area.",
      ],
      evidence: [
        rtpEvidenceLine(context, "Chapters", context.counts.chapters, ASSISTANT_READ_SUBJECTS.rtpChapters),
        rtpEvidenceLine(context, "Linked projects", context.counts.linkedProjects, ASSISTANT_READ_SUBJECTS.rtpLinkedProjects),
        rtpEvidenceLine(context, "Engagement campaigns", context.counts.engagementCampaigns, ASSISTANT_READ_SUBJECTS.engagementCampaigns),
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
      describeRtpChapterScope(context),
      ...rtpFinancialElementLines(context),
      context.operationsSummary.nextCommand
        ? `Workspace next command: ${context.operationsSummary.nextCommand.title}.`
        : context.packetSummary.recommendedReport
          ? `Suggested packet: ${context.packetSummary.recommendedReport.title ?? "board packet"}.`
          : "Nothing in the queue and no packet to work on beyond the cycle record itself.",
    ],
    nextSteps: [
      context.readiness.ready
        ? "Work the project list, engagement, and packet review from this cycle."
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
      context.project ? `Keep ${context.project.name} as the project that actually delivers this plan.` : "Attach a project if this plan should drive reporting or delivery controls.",
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
  const awardRecordCount = context.fundingSummary.awardRecordCount;
  const awardCount = context.fundingSummary.awardCount;
  const uninvoicedAwardAmount = context.fundingSummary.uninvoicedAwardAmount;
  const reimbursementPacketCount = context.fundingSummary.reimbursementPacketCount;
  const overdueDecisionCount = context.fundingSummary.overdueDecisionCount;
  const leadOverdueOpportunity = context.fundingSummary.leadOverdueOpportunity;
  const leadClosingOpportunity = context.fundingSummary.leadClosingOpportunity;
  const leadAwardOpportunity = context.fundingSummary.leadAwardOpportunity;

  if (workflowId === "program-funding") {
    const exactInvoiceAwardRelink = context.fundingSummary.exactInvoiceAwardRelink;
    return {
      workflowId,
      label,
      title: `Funding for ${context.program.title}`,
      summary:
        context.fundingSummary.opportunityCount > 0
          ? `${context.program.title} has ${context.fundingSummary.opportunityCount} linked funding opportunit${context.fundingSummary.opportunityCount === 1 ? "y" : "ies"}, with ${context.fundingSummary.closingSoonCount} closing soon and ${context.fundingSummary.pursueCount} marked pursue.${overdueDecisionCount > 0 ? ` ${overdueDecisionCount} monitored funding decision${overdueDecisionCount === 1 ? " has" : "s have"} already lapsed the recorded decision deadline, so those lapsed calls outrank newer closing-soon timing.${leadOverdueOpportunity ? ` ${leadOverdueOpportunity.title} is the lead overdue monitor decision to resolve first.` : ""}` : ""}${awardRecordCount > 0 ? ` ${awardRecordCount} awarded opportunit${awardRecordCount === 1 ? "y still needs" : "ies still need"} an award record.` : ""}${exactInvoiceAwardRelink ? " One exact invoice-to-award relink is ready on the linked project now." : ""}${awardRecordCount === 0 && awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0 ? ` ${formatCurrency(uninvoicedAwardAmount ?? 0)} of committed awards is still uninvoiced.${reimbursementPacketCount > 0 ? ` ${reimbursementPacketCount} reimbursement packet${reimbursementPacketCount === 1 ? " is" : "s are"} already open on the linked project.` : ""}` : ""}${context.fundingSummary.fundingNeedAmount !== null ? ` Recorded project need is ${formatCurrency(context.fundingSummary.fundingNeedAmount)}.` : ""}${gapAmount !== null && gapAmount > 0 ? ` Remaining uncovered after likely dollars is ${formatCurrency(gapAmount)}.` : ""}`
          : needsFundingSourcing
            ? `${context.program.title} already sits on a linked project funding need of ${formatCurrency(context.fundingSummary.fundingNeedAmount)}, but no funding opportunities are linked yet. The next honest move is sourcing candidate programs before talking about gap closure.`
            : `${context.program.title} does not yet have linked funding opportunities, so there is little to go on yet.`,
      findings: [
        context.fundingSummary.opportunityCount > 0
          ? `${context.fundingSummary.openCount} open or upcoming opportunit${context.fundingSummary.openCount === 1 ? "y is" : "ies are"} visible on this package.`
          : needsFundingSourcing
            ? "No funding opportunities are visible yet even though the linked project funding need is already recorded."
            : "No open or upcoming funding opportunities are visible on this package yet.",
        context.fundingSummary.opportunityCount > 0 && context.fundingSummary.pursueCount === 0 && context.fundingSummary.leadOpportunity
          ? `Lead decision to advance: ${context.fundingSummary.leadOpportunity.title}.`
          : "At least one linked package opportunity is already marked pursue, or no opportunity record exists yet.",
        awardRecordCount > 0 && leadAwardOpportunity
          ? `Award record still needed for ${leadAwardOpportunity.title}.`
          : "No awarded opportunity is currently waiting on a package award record.",
        exactInvoiceAwardRelink
          ? "One exact invoice-to-award relink is ready on the linked project."
          : "No exact invoice-to-award relink is currently safe enough to auto-execute from this package surface.",
        awardRecordCount === 0 && awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
          ? `Committed award dollars are logged for the linked project, but ${formatCurrency(uninvoicedAwardAmount ?? 0)} is still uninvoiced.${reimbursementPacketCount > 0 ? ` ${reimbursementPacketCount} reimbursement packet${reimbursementPacketCount === 1 ? " is" : "s are"} already open there.` : ""}`
          : "No committed award reimbursement gap is visible from the linked invoice records.",
        overdueDecisionCount > 0
          ? `${overdueDecisionCount} monitored funding decision${overdueDecisionCount === 1 ? " has" : "s have"} lapsed the recorded decision deadline while the window is still open, so the pursue or skip call on this package is already late.${leadOverdueOpportunity ? ` Lead overdue monitor decision: ${leadOverdueOpportunity.title}.` : ""}`
          : "No monitored funding decision has lapsed the recorded decision deadline on this package.",
        context.fundingSummary.closingSoonCount > 0
          ? `${context.fundingSummary.closingSoonCount} funding opportunit${context.fundingSummary.closingSoonCount === 1 ? "y closes" : "ies close"} within the next 14 days, so timing pressure is real.${leadClosingOpportunity ? ` ${leadClosingOpportunity.title} is the first deadline to reopen.` : ""}`
          : "No near-term funding window is currently closing inside the next 14 days.",
        context.fundingSummary.pursueCount > 0
          ? `${context.fundingSummary.pursueCount} opportunit${context.fundingSummary.pursueCount === 1 ? "y is" : "ies are"} already marked pursue on this package.`
          : "No linked opportunity is currently marked pursue on this package.",
        gapAmount !== null && gapAmount > 0
          ? `The linked project still carries ${formatCurrency(gapAmount)} uncovered after likely dollars.`
          : "No uncovered linked-project funding gap remains after current pursued dollars, or no target need is recorded yet.",
      ],
      nextSteps: [
        overdueDecisionCount > 0
          ? `Open /programs/${context.program.id}#program-funding-opportunities and resolve the lapsed monitor decision as pursue or skip before newer closing-soon timing is treated as more urgent.${leadOverdueOpportunity ? ` Lead overdue monitor decision: ${leadOverdueOpportunity.title}.` : ""}`
          : awardRecordCount > 0
          ? `Open /programs/${context.program.id}#program-funding-opportunities and convert the awarded opportunity into a funding-award record before trusting the remaining gap math.${leadAwardOpportunity ? ` Convert ${leadAwardOpportunity.title} into a committed award entry.` : ""}`
          : exactInvoiceAwardRelink && context.project
            ? `Open /projects/${context.project.id}#project-invoices and attach the exact unlinked invoice to its funding award before broader reimbursement cleanup.`
          : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0 && context.project
            ? reimbursementPacketCount > 0
              ? `Open /projects/${context.project.id}#project-invoices to carry the existing reimbursement packet into the invoice chain before the closeout record falls behind.`
              : `Open /projects/${context.project.id}#project-invoices to move committed package awards into reimbursement workflow before the closeout record falls behind.`
            : context.fundingSummary.opportunityCount > 0
              ? `Open /programs/${context.program.id}#program-funding-opportunities to confirm pursue, monitor, or skip on the linked opportunities.`
            : needsFundingSourcing
              ? `Open /programs/${context.program.id}#program-funding-opportunities and add the first funding opportunity tied to the recorded need.`
              : `Open /programs/${context.program.id}#program-funding-opportunities and log the first funding opportunity tied to this package.`,
        awardRecordCount > 0 && context.project
          ? `Keep ${context.project.name} aligned with this package while you reconcile the awarded dollars into a committed funding record.`
          : exactInvoiceAwardRelink && context.project
            ? `Keep ${context.project.name} aligned with this package while you repair the exact invoice-to-award linkage already visible on the linked project.`
          : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0 && context.project
            ? reimbursementPacketCount > 0
              ? `Keep ${context.project.name} aligned with this package while you invoice the existing reimbursement packet against the awards already committed.`
              : `Keep ${context.project.name} aligned with this package while you invoice against the awards already committed.`
            : gapAmount !== null && gapAmount > 0 && context.project
              ? `Keep ${context.project.name} aligned with this package while you close the remaining uncovered funding gap.`
            : needsFundingSourcing && context.project
              ? `Keep ${context.project.name} aligned with this package while you source candidate funding programs.`
              : context.project
                ? `Keep ${context.project.name} aligned with the package's funding before changing RTP or delivery assumptions.`
                : "Attach or confirm the main project so its funding shows up everywhere else it should.",
      ],
      evidence: [
        `Funding opportunities: ${context.fundingSummary.opportunityCount}`,
        `Closing soon: ${context.fundingSummary.closingSoonCount}`,
        `Overdue monitor decisions: ${overdueDecisionCount}`,
        `Pursue decisions: ${context.fundingSummary.pursueCount}`,
        `Award records needed: ${awardRecordCount}`,
        `Exact invoice relink ready: ${exactInvoiceAwardRelink ? "Yes" : "No"}`,
        `Reimbursement packets: ${reimbursementPacketCount}`,
        `Uninvoiced awards: ${awardCount > 0 ? formatCurrency(uninvoicedAwardAmount ?? 0) : "None"}`,
        `Gap after likely dollars: ${gapAmount !== null ? formatCurrency(gapAmount) : "Unknown"}`,
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "program-packet") {
    return {
      workflowId,
      label,
      title: `Report packet for ${context.program.title}`,
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
          ? `Open /reports/${context.packetSummary.recommendedReport.id} to act on this packet.`
          : "Create or attach the first report packet before treating this package as packet-ready.",
        context.readiness.missingCheckCount > 0
          ? `Close the remaining ${context.readiness.missingCheckCount} readiness gap${context.readiness.missingCheckCount === 1 ? "" : "s"} so packet work is based on a cleaner package record.`
          : "Once the packets are current, keep the program narrative aligned with linked plans and engagement evidence.",
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
      overdueDecisionCount > 0
        ? "Resolve the lapsed monitor decision as pursue or skip first so it does not slip behind grants that close sooner."
        : context.fundingSummary.closingSoonCount > 0
        ? "Recheck the near-term funding windows first so grant timing does not slip while packet work continues."
        : gapAmount !== null && gapAmount > 0
          ? "Tighten the funding strategy next so the package does not read as more funded than it really is."
        : context.packetSummary.attentionCount > 0
          ? "Deal with the packets first so the package stays current."
          : "Use the current package basis to support the next submission or funding move.",
      context.project ? `Keep ${context.project.name} as the project that actually delivers this package.` : "Attach a project if this package should flow through the wider project controlss.",
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
      title: `Handoff readiness for ${context.scenarioSet.title}`,
      summary: `${context.comparisonSummary.readyAlternatives} of ${context.comparisonSummary.totalAlternatives} alternatives are currently ready for a serious baseline-linked handoff into Analysis Studio or reporting.`,
      findings: [
        context.baselineEntry
          ? `Baseline registered: ${context.baselineEntry.label}${context.baselineEntry.attachedRunId ? " with attached run evidence" : " but still missing a run attachment"}.`
          : "No baseline entry is registered yet, so the handoff cannot be complete.",
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

/**
 * THE GUIDED FIRST RUN — the launch workflow's answer when a model has never
 * run: it walks the planner through the three launcher choices, in the
 * launcher's own words, and points at the launcher. It GUIDES; IT NEVER
 * CREATES A RUN.
 *
 * CREATION IS A RECORDED REFUSAL, restated here because this is the seam an
 * agent would push on. The registered `launch_model_run` action re-queues an
 * EXISTING run precisely because the planner supplied the study area, the
 * engine, and the zone geography when they created it; creating a NEW run
 * (`POST /runs`) takes all three in its body, and the catalog's registration
 * note refuses that shape deliberately — every argument for the relaunch
 * action depends on the agent supplying none of those. So this workflow's
 * whole output is explanation plus a navigation link, and it must never grow
 * an `executeAction`.
 *
 * QUOTED, NOT INVENTED. The engine descriptions, runtime expectations, and
 * caveats are read verbatim from `MANAGED_RUN_MODE_DEFINITIONS` — the same
 * registry the launcher renders — and the zone-resolution consequence quotes
 * `LINK_VALIDATION_NOT_SUPPORTED_CAVEAT` from the zone-resolution vocabulary.
 * A paraphrase here would be a second implementation of the launcher's own
 * words, free to drift from what the planner actually sees on the screen.
 *
 * Reachability: the quick link `model-first-run-guide` (operations.ts) carries
 * the catalog-listed `model-launch` workflow id, and this branch also answers
 * a workflowId of `model-first-run` directly so a future catalog entry for the
 * guided flow lands on a builder that already exists. (`model-first-run` is
 * not in the catalog today; adding it is `catalog.ts`'s owner's decision.)
 */
function buildModelFirstRunResponse(context: ModelAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Launch plan";
  const launcherHref = `/models/${context.model.id}`;
  const offeredEngines = MANAGED_RUN_MODE_DEFINITIONS.filter(
    (definition) => definition.availability !== "prototype"
  );

  return {
    workflowId,
    label,
    title: `Plan the first run of ${context.model.title}`,
    summary:
      "This model has no recorded runs yet. A first run is three choices — where (the study area), how (the engine), and at what resolution (the zone geography) — and every one of them is yours to make on the launcher. This walkthrough explains each choice in the launcher's own words; it creates and launches nothing.",
    findings: [
      "STUDY AREA — where the run looks. OpenPlan never assumes your geography: you pick your own county, city, or region through the study area picker on the launcher, and the analysis covers exactly what you picked. A study area inherited from a project says where it came from on the launcher itself.",
      ...offeredEngines.map(
        (definition) =>
          `ENGINE — ${definition.label}: ${definition.summaryDetail} ${definition.runtimeExpectation} Caveat: ${definition.caveatSummary}`
      ),
      `ZONE GEOGRAPHY — how finely the study area is divided (census tracts by default, block groups about three times finer, offered for Fast Screening runs). Resolution decides what a run's results can later be tested against: ${LINK_VALIDATION_NOT_SUPPORTED_CAVEAT}`,
      context.readiness.reason,
    ],
    nextSteps: [
      `Open the launcher at ${launcherHref}, pick the study area, choose an engine, and press launch yourself — the copilot does not create runs, so nothing happens until you do.`,
      context.scenarioEntryOptions.length > 0
        ? "Choose a scenario entry with explicit assumptions so the first run has a traceable planning frame."
        : "A scenario set is optional for a first run; you can attach one later so execution evidence does not float free of planning context.",
    ],
    evidence: [
      `Recorded runs: ${context.recentModelRuns.length}`,
      `Readiness checks passed: ${context.readiness.readyCheckCount}/${context.readiness.totalCheckCount}`,
      `Engines offered by the launcher registry: ${offeredEngines.map((definition) => definition.label).join(", ")}`,
    ],
    caution:
      "Every engine's caveat above is quoted from the launcher itself — repeat it with any result. A completed first run is working material for screening, not a calibrated forecast.",
    quickLinks: buildAssistantOperations(context),
  };
}

function buildModelResponse(context: ModelAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Model readiness";

  if (
    workflowId === "model-first-run" ||
    (workflowId === "model-launch" && context.recentModelRuns.length === 0 && !context.schemaPending)
  ) {
    return buildModelFirstRunResponse(context, workflowId);
  }

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
      caution: "A green light here means you are ready to launch, not that the result is scientifically valid or production-grade model certification.",
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
        : "Keep the current readiness by recording validation and run evidence as it happens.",
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
      summary: `${context.report.title} still needs its first usable RTP board packet artifact. The main job now is confirming that the cycle basis, packet sections, and source runs are strong enough to justify generate work.`,
      findings: [
        context.rtpCycle ? `RTP cycle: ${context.rtpCycle.title} · ${context.rtpCycle.status}.` : null,
        `Packet freshness: ${packetFreshness.label}. ${packetFreshness.detail}`,
        context.sectionCount > 0
          ? `${context.enabledSections} of ${context.sectionCount} packet sections are enabled on the record.`
          : "No report sections are currently attached to this packet record.",
        context.runs.length > 0
          ? `${context.runs.length} linked run${context.runs.length === 1 ? " is" : "s are"} available to support the first artifact.`
          : "No source runs are attached yet, so a first packet would have little behind it.",
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
        context.rtpCycle ? `RTP cycle: ${context.rtpCycle.title} · ${context.rtpCycle.status}.` : null,
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
        context.rtpCycle ? `RTP cycle: ${context.rtpCycle.title} · ${context.rtpCycle.status}.` : null,
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
          ? "Refresh this RTP packet from current cycle state before treating it as ready for release-review work."
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
      context.rtpCycle ? `RTP cycle: ${context.rtpCycle.title} · ${context.rtpCycle.status} · ${packetFreshness.label}.` : null,
      context.project ? `Project: ${context.project.name}.` : "No project is attached to this report.",
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
      context.runs.length > 0 ? "Cross-check the linked run summaries against the packet storyline." : "Attach source runs before treating the report as backed by analysis.",
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
        // "flat" IS A CLAIM, and it must not be made for a pair that cannot be
        // subtracted. A delta is null either because one run has no value or
        // because the two runs measured the same thing differently (a corridor
        // screened against an ingested GTFS feed versus an OpenStreetMap stop
        // tally), and reporting the second as "flat" tells a planner the
        // opposite of the truth.
        ? `${context.run.title} is paired against ${context.baselineRun.title}. The most useful read is the headline score movement: ${headline.map((item) => `${item.label} ${item.incomparable ? "not comparable" : item.delta === null ? "not measured" : item.delta > 0 ? `+${item.delta}` : `${item.delta}`}`).join(" · ")}.`
        : `${context.run.title} does not currently have a baseline attached, so a score-delta comparison is not available yet.`,
      findings: [
        context.baselineRun ? `Baseline: ${context.baselineRun.title} captured ${formatDateTime(context.baselineRun.createdAt)}.` : "No baseline run is attached.",
        context.baselineRun
          ? headline.map((item) => `${item.label}: current ${item.current ?? "N/A"} vs baseline ${item.baseline ?? "N/A"}`).join(" · ")
          : "Pin a baseline run from Analysis Studio or a scenario deep link to light up comparison mode.",
        // The refusal is a property of the PAIR, so the first reason covers all
        // of them. Spread rather than defaulted to "", because a caveat shown on
        // every comparison is a caveat nobody reads — and an empty finding is a
        // blank bullet.
        ...(deltas
          .map((delta) => delta.incomparableReason)
          .filter((reason): reason is string => Boolean(reason))
          .slice(0, 1)),
        asString(context.run.metrics.confidence)
          ? `Current run confidence: ${String(context.run.metrics.confidence)}.`
          : "No explicit confidence label is stored on the current run.",
      ],
      nextSteps: [
        context.baselineRun ? "Read the comparison alongside the saved map settings before treating every difference as a design effect." : "Attach a baseline if you need a before/after or alternative comparison argument.",
        "Keep exported narratives honest about source limitations and human-review requirements.",
      ],
      evidence: [
        `Current run: ${context.run.id}`,
        `Baseline run: ${context.baselineRun?.id ?? "None"}`,
        `Created: ${formatDateTime(context.run.createdAt)}`,
      ],
      caution: "Score movement alone is not enough; the map settings, the filters applied, and source quality still matter when interpreting deltas.",
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
      "Read the run narrative and check its sources before turning it into public-facing language.",
    ],
    evidence: [
      `Created: ${formatDateTime(context.run.createdAt)}`,
      context.run.queryText ? `Query: ${context.run.queryText}` : "No query text stored.",
      `Workspace: ${context.workspace.name ?? "Current workspace"}`,
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * MODULE-LANE WORKFLOWS — deterministic, grounded answers for the seven module
 * surfaces, per the `ACTIONS_BY_KIND` contract in `catalog.ts`.
 *
 * FAILURE ≠ EMPTY IS THE WHOLE DISCIPLINE HERE. Every sub-summary on
 * `context.moduleLane` is `null` exactly when its read FAILED, so a null lane
 * gets a sentence saying the read failed — never a zero, never "no records".
 * The blanket read-failure disclosure is applied by `buildAssistantResponse`
 * on top of these per-sentence refusals.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The sentence spoken INSTEAD of counts when a lane's read failed. */
function laneUnknown(context: ContextWithReadFailures, what: string, ...subjects: string[]): string {
  const failure = readFailure(context, ...subjects);
  return failure
    ? unknownBecauseUnread(failure, what)
    : `Unknown: ${what}. That read did not land, so an empty count here would not mean the records are absent.`;
}

function moduleLaneOf<M extends AssistantModuleLaneSummary["module"]>(
  context: WorkspaceAssistantContext,
  module: M
): Extract<AssistantModuleLaneSummary, { module: M }> | null {
  const lane = context.moduleLane;
  if (lane && lane.module === module) {
    return lane as Extract<AssistantModuleLaneSummary, { module: M }>;
  }
  return null;
}

function buildGrantsLaneResponse(context: WorkspaceAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Grants brief";
  const lane = moduleLaneOf(context, "grants");
  const opportunities = lane?.opportunities ?? null;
  const awards = lane?.awards ?? null;
  const opportunityLine = opportunities
    ? `${pluralize(opportunities.total, "funding opportunity", "funding opportunities")} on record: ${opportunities.monitor} monitor, ${opportunities.pursue} pursue, ${opportunities.skip} skip; ${opportunities.awaitingDecision} still awaiting a pursue-or-skip call.`
    : laneUnknown(context, "the funding opportunity queue", ASSISTANT_READ_SUBJECTS.fundingOpportunities);
  const deadlineLine = opportunities
    ? opportunities.closingSoon > 0 || opportunities.overdueDecision > 0
      ? `${opportunities.closingSoon} ${opportunities.closingSoon === 1 ? "window closes" : "windows close"} within ${FUNDING_CLOSING_SOON_WINDOW_DAYS} days and ${opportunities.overdueDecision} ${opportunities.overdueDecision === 1 ? "decision has" : "decisions have"} lapsed the recorded deadline.${opportunities.lead ? ` ${opportunities.lead.title} is the first deadline to reopen${opportunities.lead.closesAt ? ` (closes ${formatDateTime(opportunities.lead.closesAt)})` : ""}.` : ""}`
      : `No visible opportunity is closing within ${FUNDING_CLOSING_SOON_WINDOW_DAYS} days or past its decision deadline.`
    : laneUnknown(context, "grant deadline pressure", ASSISTANT_READ_SUBJECTS.fundingOpportunities);
  const awardLine = awards
    ? awards.total > 0
      ? `${pluralize(awards.total, "funding award")} recorded${awards.awardedAmount !== null ? ` totalling ${formatCurrency(awards.awardedAmount)}` : ""}, ${awards.activeSpending} actively spending, ${awards.riskFlagged} risk-flagged.`
      : "No funding award is recorded yet, so nothing here is committed dollars."
    : laneUnknown(context, "the funding award record", ASSISTANT_READ_SUBJECTS.fundingAwards);

  if (workflowId === "grants-decision-queue") {
    return {
      workflowId,
      label,
      title: "Grant decisions due",
      summary: opportunities
        ? opportunities.closingSoon > 0 || opportunities.overdueDecision > 0
          ? `${opportunities.closingSoon + opportunities.overdueDecision} ${opportunities.closingSoon + opportunities.overdueDecision === 1 ? "opportunity needs" : "opportunities need"} a timing-driven decision: ${opportunities.overdueDecision} already overdue, ${opportunities.closingSoon} closing within ${FUNDING_CLOSING_SOON_WINDOW_DAYS} days.`
          : "No opportunity is currently under deadline pressure, so decision work can follow the ordinary queue."
        : "Whether any grant decision is due is unknown — the opportunity read failed, and an empty queue over a failed read is not a clear queue.",
      findings: [deadlineLine, opportunityLine, awardLine],
      nextSteps: [
        opportunities && opportunities.overdueDecision > 0
          ? "Resolve the lapsed decisions first — record pursue or skip on each so the queue reflects a real call, not silence."
          : "Review the closing-soon windows on the grants register and record pursue, monitor, or skip before the timing decides for you.",
        "Record a decision on the register itself so the shared queue and this panel stay in agreement.",
      ],
      evidence: [
        opportunities ? `Opportunities: ${opportunities.total}` : "Opportunities: unknown (read failed)",
        opportunities ? `Closing within ${FUNDING_CLOSING_SOON_WINDOW_DAYS} days: ${opportunities.closingSoon}` : "Closing soon: unknown (read failed)",
        opportunities ? `Overdue decisions: ${opportunities.overdueDecision}` : "Overdue decisions: unknown (read failed)",
        awards ? `Awards recorded: ${awards.total}` : "Awards: unknown (read failed)",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "grants-awards") {
    return {
      workflowId,
      label,
      title: "Funding award posture",
      summary: awards
        ? awards.total > 0
          ? `${pluralize(awards.total, "award")} recorded${awards.awardedAmount !== null ? ` totalling ${formatCurrency(awards.awardedAmount)}` : ""} — ${awards.activeSpending} actively spending and ${awards.riskFlagged} carrying a risk flag.`
          : "No funding award is recorded in this workspace yet — grant work here is still opportunities, not committed dollars."
        : "The award posture is unknown: the funding award read failed, and an empty award list over a failed read is not an award-free workspace.",
      findings: [
        awardLine,
        awards && awards.riskFlagged > 0
          ? `${awards.riskFlagged} award${awards.riskFlagged === 1 ? " carries" : "s carry"} a risk flag and should be read before any spend-down claim.`
          : awards
            ? "No award currently carries a risk flag."
            : laneUnknown(context, "award risk flags", ASSISTANT_READ_SUBJECTS.fundingAwards),
        opportunityLine,
      ],
      nextSteps: [
        "Check that every opportunity marked awarded has a matching funding-award record — committed dollars that exist only as an opportunity status are invisible to reimbursement.",
        "Open the invoicing register for awards whose reimbursement trail has not started.",
      ],
      evidence: [
        awards ? `Awards: ${awards.total}` : "Awards: unknown (read failed)",
        awards && awards.awardedAmount !== null ? `Awarded amount: ${formatCurrency(awards.awardedAmount)}` : "Awarded amount: not measured",
        awards ? `Risk-flagged: ${awards.riskFlagged}` : "Risk-flagged: unknown (read failed)",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Grants in ${context.workspace.name ?? "this workspace"}`,
    summary: opportunities
      ? `${pluralize(opportunities.total, "funding opportunity", "funding opportunities")} and ${awards ? pluralize(awards.total, "recorded award") : "an unreadable award lane"} are visible from this register.`
      : "The grants register could not be fully read, so this brief reports what failed rather than inventing a quiet queue.",
    findings: [opportunityLine, deadlineLine, awardLine],
    nextSteps: [
      opportunities && opportunities.awaitingDecision + opportunities.overdueDecision > 0
        ? `Decide the ${pluralize(opportunities.awaitingDecision + opportunities.overdueDecision, "monitored opportunity", "monitored opportunities")} still awaiting a call — pursue or skip — so gap math stops counting maybes.`
        : "Keep decision states current so the workspace funding queue stays trustworthy.",
      "Use the grants register itself for any change; this panel reads and explains only.",
    ],
    evidence: [
      opportunities ? `Opportunities: ${opportunities.total}` : "Opportunities: unknown (read failed)",
      opportunities ? `Awaiting decision: ${opportunities.awaitingDecision}` : "Awaiting decision: unknown (read failed)",
      awards ? `Awards: ${awards.total}` : "Awards: unknown (read failed)",
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildInvoicingLaneResponse(context: WorkspaceAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Invoicing brief";
  const lane = moduleLaneOf(context, "invoicing");
  const reimbursements = lane?.reimbursements ?? null;
  const receivables = lane?.receivables ?? null;
  const unlinkedCount = reimbursements ? reimbursements.invoiceCount - reimbursements.linkedToAwardCount : null;
  const reimbursementLine = reimbursements
    ? `${pluralize(reimbursements.invoiceCount, "reimbursement invoice")} across ${pluralize(reimbursements.awardsWithInvoices, "funding award")}: ${reimbursements.draft} draft, ${reimbursements.internalReview} in internal review, ${reimbursements.submitted} submitted, ${reimbursements.approvedForPayment} approved for payment, ${reimbursements.paid} paid, ${reimbursements.rejected} rejected.`
    : laneUnknown(context, "the funder reimbursement register", ASSISTANT_READ_SUBJECTS.reimbursementInvoices);
  const unlinkedLine =
    reimbursements && unlinkedCount !== null
      ? unlinkedCount > 0
        ? `${pluralize(unlinkedCount, "invoice")} carr${unlinkedCount === 1 ? "ies" : "y"} no funding-award link, so ${unlinkedCount === 1 ? "it" : "they"} cannot be reconciled against committed dollars.`
        : "Every reimbursement invoice is linked to a funding award."
      : laneUnknown(context, "invoice-to-award linkage", ASSISTANT_READ_SUBJECTS.reimbursementInvoices);
  const receivableLine = receivables
    ? `${pluralize(receivables.invoiceCount, "client invoice")}: ${receivables.draft} draft, ${receivables.sent} sent, ${receivables.paid} paid, ${receivables.voided} voided${receivables.outstandingAmount !== null ? `, with ${formatCurrency(receivables.outstandingAmount)} sent and unpaid` : ""}.`
    : laneUnknown(context, "the client receivables register", ASSISTANT_READ_SUBJECTS.clientInvoices);

  if (workflowId === "invoicing-reimbursements") {
    return {
      workflowId,
      label,
      title: "Outstanding funder reimbursements",
      summary: reimbursements
        ? reimbursements.outstandingNetAmount !== null
          ? `${formatCurrency(reimbursements.outstandingNetAmount)} net is submitted or approved and not yet paid across ${pluralize(reimbursements.submitted + reimbursements.approvedForPayment, "invoice")}.`
          : "No reimbursement invoice is currently sitting between submission and payment."
        : "The outstanding reimbursement picture is unknown — the invoice read failed, and a quiet register over a failed read is not a settled one.",
      findings: [reimbursementLine, unlinkedLine, receivableLine],
      nextSteps: [
        unlinkedCount !== null && unlinkedCount > 0
          ? "Link the unlinked invoices to their funding awards first — reimbursement follow-through cannot be measured around them."
          : "Advance draft and internal-review invoices toward submission so committed dollars start coming back.",
        "Any linkage or status change happens on the invoicing register; this panel reads and explains only.",
      ],
      evidence: [
        reimbursements ? `Reimbursement invoices: ${reimbursements.invoiceCount}` : "Reimbursement invoices: unknown (read failed)",
        reimbursements && reimbursements.outstandingNetAmount !== null
          ? `Outstanding net: ${formatCurrency(reimbursements.outstandingNetAmount)}`
          : "Outstanding net: not measured",
        unlinkedCount !== null ? `Unlinked invoices: ${unlinkedCount}` : "Unlinked invoices: unknown (read failed)",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "invoicing-receivables") {
    return {
      workflowId,
      label,
      title: "Client receivables",
      summary: receivables
        ? receivables.outstandingAmount !== null
          ? `${formatCurrency(receivables.outstandingAmount)} is sent and unpaid across ${pluralize(receivables.sent, "client invoice")}.`
          : receivables.invoiceCount > 0
            ? "Client invoices exist but nothing is currently sent and awaiting payment."
            : "No client invoice is recorded yet."
        : "The receivables picture is unknown — the client invoice read failed, and an empty register over a failed read is not a paid-up client list.",
      findings: [receivableLine, reimbursementLine],
      nextSteps: [
        "Follow up sent-and-unpaid invoices before drafting new ones.",
        "Any invoice change happens on the invoicing register; this panel reads and explains only.",
      ],
      evidence: [
        receivables ? `Client invoices: ${receivables.invoiceCount}` : "Client invoices: unknown (read failed)",
        receivables && receivables.outstandingAmount !== null
          ? `Sent and unpaid: ${formatCurrency(receivables.outstandingAmount)}`
          : "Sent and unpaid: not measured",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Invoicing in ${context.workspace.name ?? "this workspace"}`,
    summary:
      "Two registers live here: funder reimbursements (the agency invoicing its funder for committed grant dollars) and client receivables (a consultancy invoicing its own clients). They are different money and are reported separately.",
    findings: [reimbursementLine, unlinkedLine, receivableLine],
    nextSteps: [
      unlinkedCount !== null && unlinkedCount > 0
        ? "Start with the unlinked reimbursement invoices — nothing downstream reconciles until they name their award."
        : "Advance whichever register holds the oldest outstanding invoice.",
      "Any invoice change happens on the invoicing register; this panel reads and explains only.",
    ],
    evidence: [
      reimbursements ? `Reimbursement invoices: ${reimbursements.invoiceCount}` : "Reimbursement invoices: unknown (read failed)",
      receivables ? `Client invoices: ${receivables.invoiceCount}` : "Client invoices: unknown (read failed)",
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildEngagementLaneResponse(context: WorkspaceAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Engagement brief";
  const lane = moduleLaneOf(context, "engagement");
  const campaigns = lane?.campaigns ?? null;
  const moderation = lane?.moderation ?? null;
  const moderationCount = moderation ? moderation.pending + moderation.flagged : null;
  const campaignLine = campaigns
    ? `${pluralize(campaigns.total, "campaign")}: ${campaigns.draft} draft, ${campaigns.active} active, ${campaigns.closed} closed, ${campaigns.archived} archived — ${campaigns.publicOpen} collecting public input right now.`
    : laneUnknown(context, "the campaign register", ASSISTANT_READ_SUBJECTS.engagementCampaigns);
  const moderationLine =
    moderation && moderationCount !== null
      ? moderationCount > 0
        ? `${moderation.pending} submission${moderation.pending === 1 ? "" : "s"} pending review and ${moderation.flagged} flagged. These are counts only — submission text is never loaded into this panel.`
        : "The moderation queue is clear."
      : laneUnknown(
          context,
          "the moderation queue",
          ASSISTANT_READ_SUBJECTS.engagementModerationQueue,
          ASSISTANT_READ_SUBJECTS.engagementCampaigns
        );

  if (workflowId === "engagement-moderation") {
    return {
      workflowId,
      label,
      title: "Moderation queue",
      summary:
        moderation && moderationCount !== null
          ? moderationCount > 0
            ? `${pluralize(moderationCount, "public submission")} ${moderationCount === 1 ? "waits" : "wait"} on moderation across this workspace's campaigns.`
            : "Nothing is waiting on moderation."
          : "The moderation queue is unknown — its read failed, and a quiet queue over a failed read is not a clear one.",
      findings: [moderationLine, campaignLine],
      nextSteps: [
        "Review pending submissions in the campaign console — a public window that collects input nobody reads erodes the trust the window was meant to build.",
        "Approving, flagging, or hiding a submission happens in the console; this panel carries counts only.",
      ],
      evidence: [
        moderation ? `Pending: ${moderation.pending} · Flagged: ${moderation.flagged}` : "Moderation queue: unknown (read failed)",
        campaigns ? `Campaigns collecting input: ${campaigns.publicOpen}` : "Campaigns: unknown (read failed)",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "engagement-publication") {
    return {
      workflowId,
      label,
      title: "Campaign publication state",
      summary: campaigns
        ? `${campaigns.active} campaign${campaigns.active === 1 ? " is" : "s are"} live and ${campaigns.draft} ${campaigns.draft === 1 ? "is" : "are"} staged as ${campaigns.draft === 1 ? "a draft" : "drafts"} — ${campaigns.publicOpen} ${campaigns.publicOpen === 1 ? "has" : "have"} an open public submission window.`
        : "The publication state is unknown — the campaign read failed, and an empty register over a failed read is not a workspace with no campaigns.",
      findings: [
        campaignLine,
        campaigns && campaigns.draft > 0
          ? `${campaigns.draft} staged campaign${campaigns.draft === 1 ? "" : "s"} can go public through the guided publish flow on ${campaigns.draft === 1 ? "its" : "each"} campaign page — publishing is a person's decision there, never this panel's.`
          : campaigns
            ? "No campaign is currently staged as a draft."
            : laneUnknown(context, "staged campaigns", ASSISTANT_READ_SUBJECTS.engagementCampaigns),
        moderationLine,
      ],
      nextSteps: [
        campaigns && campaigns.draft > 0
          ? "Open a staged campaign and run its publish flow when it is ready for residents."
          : "Keep live campaigns' moderation current so published feedback stays representative.",
        "Publication and closure decisions happen on each campaign's own page.",
      ],
      evidence: [
        campaigns ? `Live: ${campaigns.active} · Draft: ${campaigns.draft} · Public windows open: ${campaigns.publicOpen}` : "Campaigns: unknown (read failed)",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Engagement in ${context.workspace.name ?? "this workspace"}`,
    summary: campaigns
      ? `${pluralize(campaigns.total, "campaign")} on record, ${campaigns.publicOpen} collecting public input right now.`
      : "The engagement register could not be fully read, so this brief reports what failed rather than inventing a quiet register.",
    findings: [campaignLine, moderationLine],
    nextSteps: [
      moderationCount !== null && moderationCount > 0
        ? "Work the moderation queue before publication questions — waiting residents come first."
        : "Review which campaigns should open or close their public windows next.",
      "Any campaign change happens on the engagement pages; this panel reads counts only.",
    ],
    evidence: [
      campaigns ? `Campaigns: ${campaigns.total}` : "Campaigns: unknown (read failed)",
      moderation ? `Moderation queue: ${moderation.pending + moderation.flagged}` : "Moderation queue: unknown (read failed)",
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildSafetyLaneResponse(context: WorkspaceAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Safety brief";
  const lane = moduleLaneOf(context, "safety");
  const ingests = lane?.ingests ?? null;
  const severityMix = lane?.severityMix ?? null;
  const latest = ingests?.latest ?? null;
  const ingestLine = ingests
    ? ingests.recentCount > 0
      ? `${pluralize(ingests.recentCount, "recent crash import")}: ${ingests.ready} ready, ${ingests.failed} failed, ${ingests.noCoverage} with no source coverage, ${ingests.inFlight} in flight.`
      : "No crash data has been imported into this workspace yet."
    : laneUnknown(context, "this workspace's crash imports", ASSISTANT_READ_SUBJECTS.crashImports);
  const latestLine = latest
    ? `Latest import${latest.sourceLabel ? ` (${latest.sourceLabel})` : ""}: status ${latest.status}, coverage ${latest.coverageState}, ${latest.crashCount} crashes (${latest.geocodedCount} geocoded)${latest.yearsRequested.length > 0 ? `, years ${latest.yearsRequested.join(", ")}` : ""}${latest.truncated ? " — TRUNCATED: the source returned more rows than were stored" : ""}${latest.fetchError ? `. The source reported: ${latest.fetchError}` : ""}.`
    : null;
  const severityLine = severityMix
    ? `Severity mix of the latest ready import: ${severityMix.fatal} fatal, ${severityMix.severeInjury} severe injury, ${severityMix.injury} other injury, ${severityMix.pdo} property damage only.`
    : ingests && ingests.ready === 0
      ? "No ready import exists yet, so there is no severity mix to count."
      : laneUnknown(context, "the severity mix of the latest ready crash import", ASSISTANT_READ_SUBJECTS.crashSeverityMix, ASSISTANT_READ_SUBJECTS.crashImports);
  const completenessCaution = latest
    ? `Severity completeness of the latest import is recorded as "${latest.severityCompleteness}" — repeat that caveat with any severity claim, and treat coverage as "${latest.coverageState}" only, never as everywhere.`
    : "Crash data claims must carry their import's own coverage and severity-completeness caveats.";

  if (workflowId === "safety-coverage") {
    return {
      workflowId,
      label,
      title: "Crash data coverage",
      summary: ingests
        ? latest
          ? `Coverage is exactly what the imports establish: the latest import answers for coverage state ${latest.coverageState}${latest.yearsRequested.length > 0 ? ` and years ${latest.yearsRequested.join(", ")}` : ""} — everywhere else the crash data is silent, which is a limit, not an absence of crashes.`
          : "No import exists yet, so the crash data currently answers for nowhere — that is a limit, not a finding of zero crashes."
        : "Coverage is unknown — the import read failed, so nothing can be said about where the crash data answers.",
      findings: [
        ingestLine,
        ...(latestLine ? [latestLine] : []),
        ingests && ingests.noCoverage > 0
          ? `${ingests.noCoverage} import${ingests.noCoverage === 1 ? "" : "s"} found no source coverage for the requested area — a disclosed limit of the source, not an empty result.`
          : ingests
            ? "No import has been refused for lack of source coverage."
            : laneUnknown(context, "coverage refusals", ASSISTANT_READ_SUBJECTS.crashImports),
      ],
      nextSteps: [
        "Read the coverage state and years on the safety page before quoting any crash number outside them.",
        ingests && ingests.failed > 0 ? "Retry the failed imports from the safety page once their cause is fixed." : "Import additional years from the safety page if the analysis window needs them.",
      ],
      evidence: [
        ingests ? `Recent imports: ${ingests.recentCount} (${ingests.ready} ready)` : "Imports: unknown (read failed)",
        latest ? `Latest coverage: ${latest.coverageState}` : "Latest coverage: no import yet",
      ],
      caution: completenessCaution,
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "safety-severity") {
    return {
      workflowId,
      label,
      title: "Severity mix",
      summary: severityMix
        ? `The latest ready import counts ${severityMix.fatal} fatal, ${severityMix.severeInjury} severe injury, ${severityMix.injury} other injury, and ${severityMix.pdo} property-damage-only crashes.`
        : ingests && ingests.ready === 0
          ? "There is no ready import to count a severity mix from yet."
          : "The severity mix is unknown — its count failed, and an empty mix over a failed read is not a crash-free record.",
      findings: [severityLine, ingestLine, ...(latestLine ? [latestLine] : [])],
      nextSteps: [
        "Quote the severity completeness caveat with any severity figure — a mix from partial severity data understates the serious end.",
        "Use the safety page for per-crash detail; this panel carries counts only.",
      ],
      evidence: [
        severityMix
          ? `Mix: ${severityMix.fatal}/${severityMix.severeInjury}/${severityMix.injury}/${severityMix.pdo} (fatal/severe/injury/PDO)`
          : "Severity mix: not countable",
      ],
      caution: completenessCaution,
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Safety data in ${context.workspace.name ?? "this workspace"}`,
    summary: ingests
      ? ingests.recentCount > 0
        ? `${pluralize(ingests.recentCount, "recent crash import")} ground this workspace's safety picture — ${ingests.ready} ready to analyse, ${ingests.failed} failed.`
        : "No crash data has been imported yet, so the safety lane has nothing to answer from."
      : "The crash import register could not be read, so this brief reports the failure rather than inventing an empty safety record.",
    findings: [ingestLine, ...(latestLine ? [latestLine] : []), severityLine],
    nextSteps: [
      ingests && ingests.failed > 0
        ? "Review the failed imports on the safety page — until they are retried, coverage claims stop at the last ready import."
        : "Check that the imported years and coverage match the analysis you are about to make.",
      "Any import or retry happens on the safety page; this panel reads and explains only.",
    ],
    evidence: [
      ingests ? `Recent imports: ${ingests.recentCount}` : "Imports: unknown (read failed)",
      ingests ? `Ready: ${ingests.ready} · Failed: ${ingests.failed}` : "States: unknown (read failed)",
    ],
    caution: completenessCaution,
    quickLinks: buildAssistantOperations(context),
  };
}

function buildAerialLaneResponse(context: WorkspaceAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Aerial brief";
  const lane = moduleLaneOf(context, "aerial");
  const missions = lane?.missions ?? null;
  const processing = lane?.processing ?? null;
  const packages = lane?.packages ?? null;
  const custodyPendingCount = processing ? processing.custodyPartial + processing.custodyNone : null;
  const missionLine = missions
    ? `${pluralize(missions.total, "mission")}: ${missions.planned} planned, ${missions.active} active, ${missions.complete} complete, ${missions.cancelled} cancelled.`
    : laneUnknown(context, "this workspace's aerial missions", ASSISTANT_READ_SUBJECTS.aerialMissions);
  const processingLine = processing
    ? `${pluralize(processing.total, "processing job")}: ${processing.active} active, ${processing.failed} failed, ${processing.succeeded} succeeded — artifact custody complete on ${processing.custodyComplete}, partial on ${processing.custodyPartial}, none on ${processing.custodyNone}.`
    : laneUnknown(context, "aerial processing jobs", ASSISTANT_READ_SUBJECTS.aerialProcessingJobs);
  const packageLine = packages
    ? `${pluralize(packages.total, "evidence package")}: ${packages.processing} processing, ${packages.qaPending} in QA, ${packages.ready} ready, ${packages.shared} shared — ${packages.verificationReady} verification-ready.`
    : laneUnknown(context, "aerial evidence packages", ASSISTANT_READ_SUBJECTS.aerialEvidencePackages);

  if (workflowId === "aerial-jobs") {
    return {
      workflowId,
      label,
      title: "Aerial processing jobs",
      summary: processing
        ? processing.failed > 0 || (custodyPendingCount ?? 0) > 0
          ? `${processing.failed} job${processing.failed === 1 ? "" : "s"} failed and ${custodyPendingCount} hold${custodyPendingCount === 1 ? "s" : ""} incomplete artifact custody — evidence those jobs produced is not fully in OpenPlan's keeping yet.`
          : `${processing.active} job${processing.active === 1 ? " is" : "s are"} active and custody is complete on everything finished.`
        : "The processing job picture is unknown — its read failed, and a quiet queue over a failed read is not a healthy one.",
      findings: [processingLine, missionLine, packageLine],
      nextSteps: [
        (custodyPendingCount ?? 0) > 0
          ? "Open the affected missions and resolve artifact custody — evidence that is not in custody cannot back a submittal."
          : "Review active jobs from their mission records as they finish.",
        "Job retries and custody fixes happen on the mission records; this panel reads and explains only.",
      ],
      evidence: [
        processing ? `Jobs: ${processing.total} (${processing.failed} failed)` : "Jobs: unknown (read failed)",
        processing ? `Custody complete/partial/none: ${processing.custodyComplete}/${processing.custodyPartial}/${processing.custodyNone}` : "Custody: unknown (read failed)",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "aerial-packages") {
    return {
      workflowId,
      label,
      title: "Evidence package readiness",
      summary: packages
        ? packages.ready > 0
          ? `${packages.ready} package${packages.ready === 1 ? " is" : "s are"} ready to use as evidence, ${packages.verificationReady} of them verification-ready.`
          : `No package is ready yet — ${packages.processing} still processing, ${packages.qaPending} awaiting QA.`
        : "Package readiness is unknown — the package read failed, and an empty shelf over a failed read is not an empty shelf.",
      findings: [packageLine, processingLine, missionLine],
      nextSteps: [
        packages && packages.qaPending > 0
          ? "Clear the QA queue — packages sitting in QA are finished flying but unusable as evidence."
          : "Attach ready packages where the delivery record needs them, from the mission records.",
        "QA decisions and sharing happen on the mission records; this panel reads and explains only.",
      ],
      evidence: [
        packages ? `Packages: ${packages.total} (${packages.ready} ready, ${packages.qaPending} in QA)` : "Packages: unknown (read failed)",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Aerial operations in ${context.workspace.name ?? "this workspace"}`,
    summary: missions
      ? `${pluralize(missions.total, "mission")} on record with ${processing ? pluralize(processing.total, "processing job") : "an unreadable job lane"} and ${packages ? pluralize(packages.total, "evidence package") : "an unreadable package lane"} behind them.`
      : "The aerial register could not be fully read, so this brief reports what failed rather than inventing an idle program.",
    findings: [missionLine, processingLine, packageLine],
    nextSteps: [
      processing && processing.failed > 0
        ? "Start with the failed processing jobs — they hold up every package downstream."
        : "Review mission status and package readiness before the next flight window.",
      "Any mission, job, or package change happens on the aerial pages; this panel reads and explains only.",
    ],
    evidence: [
      missions ? `Missions: ${missions.total}` : "Missions: unknown (read failed)",
      processing ? `Jobs: ${processing.total}` : "Jobs: unknown (read failed)",
      packages ? `Packages: ${packages.total}` : "Packages: unknown (read failed)",
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildKnowledgeBaseLaneResponse(context: WorkspaceAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Knowledge base brief";
  const lane = moduleLaneOf(context, "knowledge_base");
  const documents = lane?.documents ?? null;
  const documentLine = documents
    ? `${pluralize(documents.total, "document")}: ${documents.ready} ready, ${documents.inFlight} still extracting, ${documents.extractionFailed} failed extraction, ${pluralize(documents.stored, "stored file")} that cannot be cited yet, ${documents.archived} archived — ${documents.linkedToProject} linked across ${pluralize(documents.projectCount, "project")}.`
    : laneUnknown(context, "the knowledge base corpus", ASSISTANT_READ_SUBJECTS.knowledgeBaseDocuments);
  const failureLine = documents
    ? documents.extractionFailed > 0
      ? `${documents.extractionFailed} document${documents.extractionFailed === 1 ? "" : "s"} failed text extraction — ${documents.extractionFailed === 1 ? "it is" : "they are"} invisible to retrieval until re-uploaded or re-extracted, so answers drawing on this corpus silently omit ${documents.extractionFailed === 1 ? "it" : "them"}.`
      : documents.stored > 0
        ? `No extraction failed, but OpenPlan did not index text from ${pluralize(documents.stored, "stored file")} — stored by design, not a failure — so retrieval sees the indexed corpus and cannot cite the stored ${documents.stored === 1 ? "file" : "files"}.`
        : "Every non-archived document extracted cleanly, so retrieval sees the whole corpus."
    : laneUnknown(context, "extraction failures", ASSISTANT_READ_SUBJECTS.knowledgeBaseDocuments);

  if (workflowId === "knowledge-base-extraction") {
    return {
      workflowId,
      label,
      title: "Extraction failures",
      summary: documents
        ? documents.extractionFailed > 0
          ? `${pluralize(documents.extractionFailed, "document")} failed extraction and cannot be retrieved from.`
          : "No document is currently failing extraction."
        : "Extraction health is unknown — the document read failed, and a clean sheet over a failed read is not a clean sheet.",
      findings: [failureLine, documentLine],
      nextSteps: [
        "Re-upload or re-extract the failed documents from the knowledge base page — a corpus with silent holes answers confidently and incompletely.",
        "Document changes happen on the knowledge base page; this panel reads and explains only.",
      ],
      evidence: [
        documents ? `Failed extraction: ${documents.extractionFailed} of ${documents.total}` : "Extraction failures: unknown (read failed)",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Knowledge base in ${context.workspace.name ?? "this workspace"}`,
    summary: documents
      ? `${pluralize(documents.total, "document")} in the corpus, ${documents.ready} of them ready for retrieval.`
      : "The knowledge base could not be read, so this brief reports the failure rather than inventing an empty corpus.",
    findings: [documentLine, failureLine],
    nextSteps: [
      documents && documents.extractionFailed > 0
        ? "Fix the extraction failures first — they are the corpus's silent holes."
        : "Link unlinked documents to their projects so retrieval can scope to the work at hand.",
      "Document changes happen on the knowledge base page; this panel reads and explains only.",
    ],
    evidence: [
      documents ? `Documents: ${documents.total} (${documents.ready} ready)` : "Documents: unknown (read failed)",
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildDataHubLaneResponse(context: WorkspaceAssistantContext, workflowId: string): AssistantResponse {
  const label = findAssistantAction(context.kind, workflowId)?.label ?? "Data hub brief";
  const lane = moduleLaneOf(context, "data_hub");
  const datasets = lane?.datasets ?? null;
  const connectors = lane?.connectors ?? null;
  const refreshJobs = lane?.refreshJobs ?? null;
  const datasetLine = datasets
    ? `${pluralize(datasets.total, "dataset")}: ${datasets.ready} ready, ${datasets.stale} stale, ${datasets.error} erroring, ${datasets.other} in other states.`
    : laneUnknown(context, "data hub datasets", ASSISTANT_READ_SUBJECTS.dataHubDatasets);
  const connectorLine = connectors
    ? `${pluralize(connectors.total, "connector")}: ${connectors.active} active, ${connectors.degraded} degraded, ${connectors.offline} offline — ${connectors.withLastError} carrying a recorded last error.`
    : laneUnknown(context, "data hub connectors", ASSISTANT_READ_SUBJECTS.dataHubConnectors);
  const refreshLine = refreshJobs
    ? refreshJobs.recentCount > 0
      ? `${pluralize(refreshJobs.recentCount, "recent refresh job")}, ${refreshJobs.failed} failed${refreshJobs.latest ? ` — latest ${refreshJobs.latest.jobName ?? "job"} is ${refreshJobs.latest.status}${refreshJobs.latest.errorSummary ? ` (${refreshJobs.latest.errorSummary})` : ""}` : ""}.`
      : "No refresh job has run recently."
    : laneUnknown(context, "data refresh jobs", ASSISTANT_READ_SUBJECTS.dataRefreshJobs);

  if (workflowId === "data-hub-feeds") {
    return {
      workflowId,
      label,
      title: "Connector and feed states",
      summary: connectors
        ? connectors.degraded + connectors.offline > 0
          ? `${connectors.degraded + connectors.offline} connector${connectors.degraded + connectors.offline === 1 ? " is" : "s are"} degraded or offline, so the data they feed is aging while they are down.`
          : "Every connector is currently active."
        : "Connector state is unknown — its read failed, and a quiet register over a failed read is not a healthy one.",
      findings: [connectorLine, datasetLine, refreshLine],
      nextSteps: [
        "Open the data hub for each degraded or offline connector's last error before trusting downstream freshness.",
        "Connector fixes and feed changes happen on the data hub page; this panel reads and explains only.",
      ],
      evidence: [
        connectors ? `Connectors: ${connectors.total} (${connectors.degraded} degraded, ${connectors.offline} offline)` : "Connectors: unknown (read failed)",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  if (workflowId === "data-hub-refresh") {
    return {
      workflowId,
      label,
      title: "Refresh job posture",
      summary: refreshJobs
        ? refreshJobs.failed > 0
          ? `${pluralize(refreshJobs.failed, "recent refresh job")} failed${refreshJobs.latest?.errorSummary ? ` — the latest reported: ${refreshJobs.latest.errorSummary}` : ""}.`
          : "No recent refresh job has failed."
        : "Refresh health is unknown — the job read failed, and a quiet log over a failed read is not a clean log.",
      findings: [refreshLine, datasetLine, connectorLine],
      nextSteps: [
        refreshJobs && refreshJobs.failed > 0
          ? "Re-run the failed refreshes from the data hub once their cause is fixed — a dataset served from a failed refresh is silently stale."
          : "Keep an eye on stale datasets; they are the refreshes that never got scheduled.",
        "Re-runs happen on the data hub page; this panel reads and explains only.",
      ],
      evidence: [
        refreshJobs ? `Recent jobs: ${refreshJobs.recentCount} (${refreshJobs.failed} failed)` : "Refresh jobs: unknown (read failed)",
      ],
      quickLinks: buildAssistantOperations(context),
    };
  }

  return {
    workflowId,
    label,
    title: `Data hub in ${context.workspace.name ?? "this workspace"}`,
    summary: datasets
      ? `${pluralize(datasets.total, "dataset")} registered, with ${connectors ? pluralize(connectors.total, "connector") : "an unreadable connector lane"} feeding them.`
      : "The data hub could not be fully read, so this brief reports what failed rather than inventing an empty catalog.",
    findings: [datasetLine, connectorLine, refreshLine],
    nextSteps: [
      datasets && datasets.stale + datasets.error > 0
        ? `Refresh the ${datasets.stale + datasets.error} dataset${datasets.stale + datasets.error === 1 ? "" : "s"} whose own status says stale or error — analyses drawing on them are working from data the hub no longer stands behind.`
        : "Keep connectors healthy so dataset freshness holds without manual refreshes.",
      "Dataset and connector changes happen on the data hub page; this panel reads and explains only.",
    ],
    evidence: [
      datasets ? `Datasets: ${datasets.total} (${datasets.stale} stale, ${datasets.error} error)` : "Datasets: unknown (read failed)",
      connectors ? `Connectors: ${connectors.total}` : "Connectors: unknown (read failed)",
    ],
    quickLinks: buildAssistantOperations(context),
  };
}

function buildModuleLaneResponse(context: WorkspaceAssistantContext, workflowId: string): AssistantResponse {
  switch (context.kind) {
    case "grants":
      return buildGrantsLaneResponse(context, workflowId);
    case "invoicing":
      return buildInvoicingLaneResponse(context, workflowId);
    case "engagement":
      return buildEngagementLaneResponse(context, workflowId);
    case "safety":
      return buildSafetyLaneResponse(context, workflowId);
    case "aerial":
      return buildAerialLaneResponse(context, workflowId);
    case "knowledge_base":
      return buildKnowledgeBaseLaneResponse(context, workflowId);
    case "data_hub":
      return buildDataHubLaneResponse(context, workflowId);
    default:
      return buildWorkspaceResponse(context, workflowId);
  }
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
    case "grants":
    case "invoicing":
    case "engagement":
    case "safety":
    case "aerial":
    case "knowledge_base":
    case "data_hub":
      return buildModuleLaneResponse(context, workflowId);
    case "analysis_studio":
    case "workspace":
    default:
      return buildWorkspaceResponse(context, workflowId, question);
    }
  })();

  // The disclosure is applied OUTSIDE the local-console pass so it stays the
  // first finding a planner and a model both see, whatever the console added.
  return withResponseReadFailureDisclosure(
    context,
    applyLocalConsoleStateToResponse(response, localConsoleState)
  );
}
