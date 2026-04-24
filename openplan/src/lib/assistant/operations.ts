import type { AssistantQuickLink } from "@/lib/assistant/catalog";
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
import {
  resolveRtpPacketWorkPostureFromCounts,
  resolveRtpPacketWorkPostureFromFreshnessLabel,
} from "@/lib/assistant/rtp-packet-posture";
import { buildBillingInvoiceTriageHref } from "@/lib/billing/triage-links";
import { resolveWorkspaceCommandHref } from "@/lib/operations/grants-links";
import {
  buildRtpReleaseReviewSummary,
  parseStoredRtpPublicReviewSummary,
} from "@/lib/rtp/catalog";
import { getReportPacketFreshness } from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";

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
    workflowId?: string;
    prompt?: string;
    promptLabel?: string;
    executeAction?: AssistantQuickLink["executeAction"];
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
    workflowId: options.workflowId,
    prompt: options.prompt,
    promptLabel: options.promptLabel,
    executeAction: options.executeAction,
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

function describeWorkspaceNextCommandLink(context: {
  operationsSummary: {
    nextCommand: {
      key: string;
      title: string;
      moduleKey?: string;
      targetOpportunityTitle?: string | null;
    } | null;
    counts: { rtpFundingReviewPackets: number; overdueDecisionFundingOpportunities: number };
    grantModelingSummary?: {
      breakdown: { decisionReady: number };
      leadDecisionDetail: string | null;
    } | null;
  };
}) {
  const nextCommand = context.operationsSummary.nextCommand;
  if (!nextCommand) {
    return null;
  }

  if (
    nextCommand.key === "resolve-overdue-funding-decisions" &&
    context.operationsSummary.counts.overdueDecisionFundingOpportunities > 0
  ) {
    const overdueCount = context.operationsSummary.counts.overdueDecisionFundingOpportunities;
    const leadOpportunityTitle = nextCommand.targetOpportunityTitle ?? null;
    return {
      label: "Open overdue grant decision lane",
      statusLabel: `${overdueCount} overdue decision${overdueCount === 1 ? "" : "s"}`,
      reason: `Monitored funding opportunities are already past their recorded decision deadline while the window is still open, so these pursue or skip calls outrank newer closing-soon timing before less urgent cleanup.${leadOpportunityTitle ? ` ${leadOpportunityTitle} is the lead overdue monitor decision to resolve first.` : ""}`,
      auditNote: `Use the focused grants opportunity lane to resolve the lapsed decision as pursue or skip before acting on newer closing windows.${leadOpportunityTitle ? ` Lead overdue monitor decision: ${leadOpportunityTitle}.` : ""}`,
    };
  }

  if (nextCommand.key === "review-current-report-packets" && context.operationsSummary.counts.rtpFundingReviewPackets > 0) {
    const count = context.operationsSummary.counts.rtpFundingReviewPackets;
    return {
      label: nextCommand.moduleKey === "grants" ? "Open RTP grants follow-through" : "Open RTP funding release review",
      statusLabel: `${count} funding-backed packet${count === 1 ? "" : "s"}`,
      reason:
        nextCommand.moduleKey === "grants"
          ? "Current RTP packets are aligned enough on freshness, but linked-project grant follow-through now outranks local packet polish before those packets are treated as fully settled."
          : "Current RTP packets are aligned enough for release review, but linked-project funding posture still needs verification before those packets are treated as fully settled.",
      auditNote:
        nextCommand.moduleKey === "grants"
          ? "Use the Grants OS follow-through lane to resolve funding gaps, uninvoiced awards, or reimbursement pressure before finalizing packet posture."
          : "Use the release-review packet detail to verify funding gaps, uninvoiced awards, or reimbursement follow-through before finalizing packet posture.",
    };
  }

  if (
    nextCommand.key === "advance-project-funding-decisions" &&
    context.operationsSummary.grantModelingSummary?.leadDecisionDetail
  ) {
    const modelingSummary = context.operationsSummary.grantModelingSummary;
    const decisionReadyCount = modelingSummary.breakdown.decisionReady;
    return {
      label: decisionReadyCount > 0 ? "Open decision-ready grant lane" : "Open lead grant decision lane",
      statusLabel: decisionReadyCount > 0 ? `${decisionReadyCount} decision-ready` : "Modeling context available",
      reason: modelingSummary.leadDecisionDetail ?? undefined,
      auditNote:
        "Review the lead project modeling posture and recommended next move before advancing or adjusting pursue state for any linked opportunity.",
    };
  }

  if (nextCommand.key === "advance-project-funding-decisions") {
    const leadOpportunityTitle = nextCommand.targetOpportunityTitle ?? null;
    return {
      label: "Open lead grant decision lane",
      statusLabel: "Workspace command",
      reason: `The shared workspace queue has a linked funding opportunity that still needs a pursue or skip call before the lane is treated as a true funding stack.${leadOpportunityTitle ? ` ${leadOpportunityTitle} is the lead opportunity decision to advance first.` : ""}`,
      auditNote: `Use the focused grants opportunity lane to advance pursue or skip before changing records.${leadOpportunityTitle ? ` Lead opportunity decision: ${leadOpportunityTitle}.` : ""}`,
    };
  }

  if (nextCommand.key === "funding-windows-closing") {
    const leadOpportunityTitle = nextCommand.targetOpportunityTitle ?? null;
    return {
      label: "Open lead closing funding window",
      statusLabel: "Workspace command",
      reason: `Monitored funding windows are closing within the near-term timing horizon, so reopening the lead opportunity outranks less urgent cleanup before the window locks.${leadOpportunityTitle ? ` ${leadOpportunityTitle} is the lead closing window to reopen first.` : ""}`,
      auditNote: `Use the focused grants opportunity lane to review the closing window before acting on later-dated entries.${leadOpportunityTitle ? ` Lead closing window: ${leadOpportunityTitle}.` : ""}`,
    };
  }

  if (nextCommand.key === "record-awarded-funding") {
    const leadOpportunityTitle = nextCommand.targetOpportunityTitle ?? null;
    return {
      label: "Open lead award conversion lane",
      statusLabel: "Workspace command",
      reason: `An opportunity is already marked awarded but still has no funding-award record, so closing that committed-dollar bookkeeping gap outranks further gap analysis.${leadOpportunityTitle ? ` ${leadOpportunityTitle} is the lead awarded opportunity to convert first.` : ""}`,
      auditNote: `Use the grants award conversion lane to record the committed dollars before the shortfall math is treated as final.${leadOpportunityTitle ? ` Lead awarded opportunity: ${leadOpportunityTitle}.` : ""}`,
    };
  }

  return {
    label: `Open ${nextCommand.title}`,
    statusLabel: "Workspace command",
    reason: "The shared workspace queue currently has the clearest guidance for what should move around this surface.",
    auditNote: "Use the command-board rationale before changing records or regenerating artifacts.",
  };
}

function buildWorkspaceOperations(context: WorkspaceAssistantContext): AssistantQuickLink[] {
  const fundingAnchorCommand = context.operationsSummary.commandQueue.find((item) => item.key === "anchor-project-funding-needs");
  const fundingSourcingCommand = context.operationsSummary.commandQueue.find(
    (item) => item.key === "source-project-funding-opportunities"
  );
  const fundingDecisionCommand = context.operationsSummary.commandQueue.find(
    (item) => item.key === "advance-project-funding-decisions"
  );
  const fundingAwardRecordCommand = context.operationsSummary.commandQueue.find(
    (item) => item.key === "record-awarded-funding"
  );
  const invoiceRelinkCommand = context.operationsSummary.commandQueue.find(
    (item) => item.key === "relink-project-invoice-awards"
  );
  const reimbursementStartCommand = context.operationsSummary.commandQueue.find(
    (item) => item.key === "start-project-reimbursement-packets"
  );
  const reimbursementAdvanceCommand = context.operationsSummary.commandQueue.find(
    (item) => item.key === "advance-project-reimbursement-invoicing"
  );
  const fundingGapCommand = context.operationsSummary.commandQueue.find((item) => item.key === "close-project-funding-gaps");
  const invoiceRelinkCount = typeof invoiceRelinkCommand?.badges[0]?.value === "number" ? invoiceRelinkCommand.badges[0].value : 0;
  const reimbursementStartCount = context.operationsSummary.counts.projectFundingReimbursementStartProjects;
  const reimbursementAdvanceCount = context.operationsSummary.counts.projectFundingReimbursementActiveProjects;
  const nextCommandLink = describeWorkspaceNextCommandLink(context);

  return compactQuickLinks([
    quickLink("workspace-brief-agent", "Generate workspace brief", "/dashboard", {
      targetKind: "workspace",
      actionClass: "review_controls",
      executionMode: "future_agent_action",
      priority: "primary",
      statusLabel: "In-panel action",
      reason: "Runs the grounded workspace brief inside Planner Agent without leaving the current surface.",
      approval: "safe",
      auditEvent: "assistant.operation.workspace.brief_agent",
      auditNote: "This runs a grounded assistant brief only, it does not mutate records.",
      workflowId: "workspace-overview",
      prompt: "Give me the key workspace brief and the next operator move.",
      promptLabel: "Generate workspace brief",
    }),
    context.operationsSummary.nextCommand && nextCommandLink
      ? quickLink("workspace-next-command", nextCommandLink.label, resolveWorkspaceCommandHref(context.operationsSummary.nextCommand), {
          targetKind: "workspace",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: nextCommandLink.statusLabel,
          reason: nextCommandLink.reason,
          approval: "review",
          auditEvent: "assistant.operation.workspace.next_command",
          auditNote: nextCommandLink.auditNote,
        })
      : null,
    context.operationsSummary.counts.projectFundingNeedAnchorProjects > 0 && fundingAnchorCommand?.targetProjectId
      ? quickLink(
          "workspace-create-funding-profile",
          "Create lead funding anchor now",
          resolveWorkspaceCommandHref(fundingAnchorCommand),
          {
            targetKind: "workspace",
            actionClass: "review_controls",
            executionMode: "future_agent_action",
            priority: "primary",
            statusLabel: "Execute action",
            reason: "The workspace already knows the lead project that has grant records but still lacks a funding-need anchor, so Planner Agent can create that anchor directly from the shared queue.",
            approval: "approval_required",
            auditEvent: "assistant.operation.workspace.create_funding_profile",
            auditNote: "Creates the lead project funding-profile anchor through the existing audited route without inventing any funding amounts.",
            executeAction: {
              kind: "create_project_funding_profile",
              projectId: fundingAnchorCommand.targetProjectId,
              notes: "Planner Agent created this funding profile anchor from the workspace funding queue. Add funding need and local match next.",
              postActionWorkflowId: "workspace-funding",
              postActionPrompt: "A lead project funding profile anchor was created from the workspace queue. Which funding lane should move next, and what still needs to be filled in?",
              postActionPromptLabel: "Review workspace funding posture",
            },
          }
        )
      : null,
    context.operationsSummary.counts.projectFundingSourcingProjects > 0 && fundingSourcingCommand?.targetProjectId
      ? quickLink(
          "workspace-create-funding-opportunity",
          "Create lead funding opportunity now",
          resolveWorkspaceCommandHref(fundingSourcingCommand),
          {
            targetKind: "workspace",
            actionClass: "review_controls",
            executionMode: "future_agent_action",
            priority: "primary",
            statusLabel: "Execute action",
            reason: "The workspace queue already knows the lead project that has a grounded need but still no funding opportunity record, so Planner Agent can create that first grant record directly from the sourcing queue.",
            approval: "approval_required",
            auditEvent: "assistant.operation.workspace.create_funding_opportunity",
            auditNote: "Creates the first funding opportunity record for the lead sourcing project through the existing audited route.",
            executeAction: {
              kind: "create_funding_opportunity",
              projectId: fundingSourcingCommand.targetProjectId,
              title: `${fundingSourcingCommand.targetProjectName ?? "Project"} funding opportunity`,
              postActionWorkflowId: "workspace-funding",
              postActionPrompt: "A lead workspace funding opportunity record was created from the sourcing queue. Which grant lane should move next?",
              postActionPromptLabel: "Review workspace funding posture",
            },
          }
        )
      : null,
    context.operationsSummary.counts.projectFundingDecisionProjects > 0 && fundingDecisionCommand?.targetOpportunityId
      ? quickLink(
          "workspace-advance-funding-opportunity",
          "Mark lead opportunity pursue now",
          resolveWorkspaceCommandHref(fundingDecisionCommand),
          {
            targetKind: "workspace",
            actionClass: "review_controls",
            executionMode: "future_agent_action",
            priority: "primary",
            statusLabel: "Execute action",
            reason: "The workspace queue already knows the lead funding opportunity that still needs a pursue decision, so Planner Agent can advance it directly from the shared grants board.",
            approval: "approval_required",
            auditEvent: "assistant.operation.workspace.advance_funding_opportunity",
            auditNote: "Updates the lead funding opportunity decision through the existing audited route so the workspace has a real pursue posture.",
            executeAction: {
              kind: "update_funding_opportunity_decision",
              opportunityId: fundingDecisionCommand.targetOpportunityId,
              decisionState: "pursue",
              postActionWorkflowId: "workspace-funding",
              postActionPrompt: "A lead funding opportunity was marked pursue from the workspace queue. Which grant lane should move next?",
              postActionPromptLabel: "Review workspace funding posture",
            },
          }
        )
      : null,
    invoiceRelinkCommand?.targetInvoiceId && invoiceRelinkCommand?.targetFundingAwardId && context.workspace.id
      ? quickLink(
          "workspace-link-invoice-award",
          "Link lead invoice to award now",
          `/billing?workspaceId=${context.workspace.id}&projectId=${invoiceRelinkCommand.targetProjectId ?? ""}&linkage=unlinked&focusInvoiceId=${invoiceRelinkCommand.targetInvoiceId}`,
          {
            targetKind: "workspace",
            actionClass: "review_controls",
            executionMode: "future_agent_action",
            priority: "primary",
            statusLabel: "Execute action",
            reason: "The workspace queue found an exact one-invoice, one-award reimbursement relink candidate on the same project, so Planner Agent can attach that invoice to the right award without guessing billing values.",
            approval: "approval_required",
            auditEvent: "assistant.operation.workspace.link_invoice_award",
            auditNote: "Updates one existing invoice record to reference one exact funding-award record through the audited billing patch route.",
            executeAction: {
              kind: "link_billing_invoice_funding_award",
              workspaceId: context.workspace.id,
              invoiceId: invoiceRelinkCommand.targetInvoiceId,
              fundingAwardId: invoiceRelinkCommand.targetFundingAwardId,
              postActionWorkflowId: "workspace-funding",
              postActionPrompt: "A lead invoice was relinked to its funding award from the workspace queue. Which reimbursement or billing lane should move next?",
              postActionPromptLabel: "Review workspace reimbursement posture",
            },
          }
        )
      : null,
    reimbursementStartCommand?.targetProjectId
      ? quickLink(
          "workspace-create-reimbursement-record",
          "Create lead reimbursement record now",
          resolveWorkspaceCommandHref(reimbursementStartCommand),
          {
            targetKind: "workspace",
            actionClass: "review_controls",
            executionMode: "future_agent_action",
            priority: "primary",
            statusLabel: "Execute action",
            reason: "The workspace queue already knows the lead project that has committed awards but still no reimbursement packet, so Planner Agent can start that audited record directly from the shared funding board.",
            approval: "approval_required",
            auditEvent: "assistant.operation.workspace.create_reimbursement_record",
            auditNote: "Creates a reimbursement submittal record through the existing audited project-record route without inventing invoice amounts or dates.",
            executeAction: {
              kind: "create_project_record",
              projectId: reimbursementStartCommand.targetProjectId,
              recordType: "submittal",
              title: `${reimbursementStartCommand.targetProjectName ?? "Project"} reimbursement packet`,
              submittalType: "reimbursement",
              status: "draft",
              notes: "Planner Agent created this reimbursement packet starter from the workspace funding queue. Link award-specific backup and invoice chain next.",
              postActionWorkflowId: "workspace-funding",
              postActionPrompt: "A lead reimbursement packet was created from the workspace queue. Which funding or invoicing lane should move next?",
              postActionPromptLabel: "Review workspace reimbursement posture",
            },
          }
        )
      : null,
    reimbursementAdvanceCommand?.targetProjectId
      ? quickLink(
          "workspace-open-reimbursement-lane",
          "Open lead reimbursement lane",
          resolveWorkspaceCommandHref(reimbursementAdvanceCommand),
          {
            targetKind: "workspace",
            actionClass: "review_controls",
            priority: "primary",
            statusLabel: `${reimbursementAdvanceCount} reimbursement active`,
            reason: "The workspace queue already knows the lead project where reimbursement work exists but the invoice lane still trails the committed award stack, so this jump should be one click from the shared board.",
            approval: "review",
            auditEvent: "assistant.operation.workspace.open_reimbursement_lane",
            auditNote: "Navigation only. Use the linked project invoice lane to advance reimbursement follow-through.",
          }
        )
      : null,
    reimbursementAdvanceCommand?.targetProjectId && context.workspace.id
      ? quickLink(
          "workspace-open-billing-reimbursement-triage",
          "Open billing reimbursement triage",
          reimbursementAdvanceCommand.targetInvoiceId
            ? buildBillingInvoiceTriageHref({
                workspaceId: context.workspace.id,
                invoiceId: reimbursementAdvanceCommand.targetInvoiceId,
                linkage: "linked",
                overdue: "all",
                projectId: reimbursementAdvanceCommand.targetProjectId,
              })
            : `/billing?workspaceId=${context.workspace.id}&projectId=${reimbursementAdvanceCommand.targetProjectId}&linkage=linked`,
          {
            targetKind: "workspace",
            actionClass: "review_controls",
            priority: "secondary",
            statusLabel: `${reimbursementAdvanceCount} reimbursement active`,
            reason: "The invoice register is the truthful place to reconcile award-linked reimbursement follow-through once packet work already exists, so the assistant should offer a direct triage jump there too.",
            approval: "review",
            auditEvent: "assistant.operation.workspace.open_billing_reimbursement_triage",
            auditNote: "Navigation only. Opens the billing register narrowed to the lead project and award-linked invoice posture.",
          }
        )
      : null,
    context.operationsSummary.counts.projectFundingNeedAnchorProjects > 0 ||
    context.operationsSummary.counts.projectFundingSourcingProjects > 0 ||
    context.operationsSummary.counts.projectFundingDecisionProjects > 0 ||
    context.operationsSummary.counts.projectFundingAwardRecordProjects > 0 ||
    Boolean(invoiceRelinkCommand) ||
    Boolean(reimbursementStartCommand) ||
    Boolean(reimbursementAdvanceCommand) ||
    context.operationsSummary.counts.projectFundingGapProjects > 0
      ? quickLink(
          "workspace-funding-agent",
          context.operationsSummary.counts.projectFundingNeedAnchorProjects > 0
            ? "Review missing funding anchors in panel"
            : context.operationsSummary.counts.projectFundingSourcingProjects > 0
              ? "Review funding sourcing gaps in panel"
              : context.operationsSummary.counts.projectFundingDecisionProjects > 0
                ? "Review funding decision gaps in panel"
                : context.operationsSummary.counts.projectFundingAwardRecordProjects > 0
                  ? "Review awarded funding records in panel"
                  : invoiceRelinkCommand
                    ? "Review invoice award relinks in panel"
                  : reimbursementStartCommand
                    ? "Review reimbursement packet starts in panel"
                    : reimbursementAdvanceCommand
                      ? "Review reimbursement follow-through in panel"
            : "Review funding gaps in panel",
          (fundingAnchorCommand
            ? resolveWorkspaceCommandHref(fundingAnchorCommand)
            : fundingSourcingCommand
              ? resolveWorkspaceCommandHref(fundingSourcingCommand)
              : fundingDecisionCommand
                ? resolveWorkspaceCommandHref(fundingDecisionCommand)
                : fundingAwardRecordCommand
                  ? resolveWorkspaceCommandHref(fundingAwardRecordCommand)
                  : invoiceRelinkCommand
                    ? resolveWorkspaceCommandHref(invoiceRelinkCommand)
                    : reimbursementStartCommand
                      ? resolveWorkspaceCommandHref(reimbursementStartCommand)
                      : reimbursementAdvanceCommand
                        ? resolveWorkspaceCommandHref(reimbursementAdvanceCommand)
                        : fundingGapCommand
                          ? resolveWorkspaceCommandHref(fundingGapCommand)
                          : "/projects"),
          {
          targetKind: "workspace",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: fundingAnchorCommand || fundingSourcingCommand || fundingDecisionCommand || fundingAwardRecordCommand || invoiceRelinkCommand || reimbursementStartCommand || reimbursementAdvanceCommand || fundingGapCommand ? "primary" : "secondary",
          statusLabel:
            context.operationsSummary.counts.projectFundingNeedAnchorProjects > 0
              ? `${context.operationsSummary.counts.projectFundingNeedAnchorProjects} missing anchor${context.operationsSummary.counts.projectFundingNeedAnchorProjects === 1 ? "" : "s"}`
              : context.operationsSummary.counts.projectFundingSourcingProjects > 0
                ? `${context.operationsSummary.counts.projectFundingSourcingProjects} need sourcing`
                : context.operationsSummary.counts.projectFundingDecisionProjects > 0
                ? `${context.operationsSummary.counts.projectFundingDecisionProjects} need decisions`
                : context.operationsSummary.counts.projectFundingAwardRecordProjects > 0
                  ? `${context.operationsSummary.counts.projectFundingAwardRecordProjects} award record${context.operationsSummary.counts.projectFundingAwardRecordProjects === 1 ? "" : "s"} missing`
                  : invoiceRelinkCommand
                    ? `${invoiceRelinkCount} relink${invoiceRelinkCount === 1 ? "" : "s"} ready`
                  : reimbursementStartCommand
                    ? `${reimbursementStartCount} need packet${reimbursementStartCount === 1 ? "" : "s"}`
                    : reimbursementAdvanceCommand
                      ? `${reimbursementAdvanceCount} reimbursement active`
              : `${context.operationsSummary.counts.projectFundingGapProjects} gap project${context.operationsSummary.counts.projectFundingGapProjects === 1 ? "" : "s"}`,
          reason:
            context.operationsSummary.counts.projectFundingNeedAnchorProjects > 0
              ? "Some projects already have funding opportunities but still lack a funding-need anchor, so the assistant should close that honesty gap before ranking dollars-to-go."
              : context.operationsSummary.counts.projectFundingSourcingProjects > 0
                ? "Some projects already have a grounded funding need but still no linked opportunities, so the assistant should surface sourcing work before it talks about closing gaps."
                : context.operationsSummary.counts.projectFundingDecisionProjects > 0
                ? "Some projects already have linked opportunities but nothing marked pursue yet, so the assistant should surface grant-decision work before it treats the lane as a true funding stack."
                : context.operationsSummary.counts.projectFundingAwardRecordProjects > 0
                  ? "Some projects already have opportunities marked awarded but still no matching funding-award record, so the assistant should close that committed-dollar bookkeeping gap before treating the remaining shortfall as final."
                  : invoiceRelinkCommand
                    ? "Some projects already have an exact invoice-to-award reimbursement relink available, so the assistant should close that bookkeeping seam before it treats reimbursement follow-through as fully trustworthy."
                  : reimbursementStartCommand
                    ? "Some projects already have committed awards logged but still no reimbursement packet started, so the assistant should open that audited reimbursement trail before it only talks about funding gaps."
                    : reimbursementAdvanceCommand
                      ? "Some projects already have reimbursement work started, but the invoice lane still has not caught up to the committed award stack, so follow-through deserves explicit triage."
              : "The workspace now shows real project funding gaps beyond deadline-only grant pressure, so the assistant should help rank which thinly funded project to reopen first.",
          approval: "safe",
          auditEvent: "assistant.operation.workspace.funding_agent",
          auditNote: "This produces a grounded funding-gap brief only, it does not change funding records or project assumptions.",
          workflowId: "workspace-funding",
          prompt:
            context.operationsSummary.counts.projectFundingNeedAnchorProjects > 0
              ? "Which projects have funding opportunities but still lack a funding-need anchor, and where should I start?"
              : context.operationsSummary.counts.projectFundingSourcingProjects > 0
                ? "Which projects already have funding need recorded but still no linked funding opportunities, and where should I start sourcing?"
                : context.operationsSummary.counts.projectFundingDecisionProjects > 0
                ? "Which projects already have linked funding opportunities but still nothing marked pursue, and where should I start deciding?"
                : context.operationsSummary.counts.projectFundingAwardRecordProjects > 0
                  ? "Which projects already have awarded opportunities but still no funding-award record, and where should I start reconciling committed dollars?"
                  : invoiceRelinkCommand
                    ? "Which invoice can be safely relinked to a funding award right now, and what reimbursement lane should move next?"
                  : reimbursementStartCommand
                    ? "Which projects already have committed awards but still need their first reimbursement packet, and where should I start?"
                    : reimbursementAdvanceCommand
                      ? "Which projects already have reimbursement work underway but still need invoice follow-through, and where should I start?"
              : "Which project funding gaps need attention across this workspace, and where should I start?",
          promptLabel:
            context.operationsSummary.counts.projectFundingNeedAnchorProjects > 0
              ? "Review missing funding anchors in panel"
              : context.operationsSummary.counts.projectFundingSourcingProjects > 0
                ? "Review funding sourcing gaps in panel"
                : context.operationsSummary.counts.projectFundingDecisionProjects > 0
                ? "Review funding decision gaps in panel"
                : context.operationsSummary.counts.projectFundingAwardRecordProjects > 0
                  ? "Review awarded funding records in panel"
                  : invoiceRelinkCommand
                    ? "Review invoice award relinks in panel"
                  : reimbursementStartCommand
                    ? "Review reimbursement packet starts in panel"
                    : reimbursementAdvanceCommand
                      ? "Review reimbursement follow-through in panel"
              : "Review funding gaps in panel",
        }
        )
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
  const projectGapAmount = context.fundingSummary.gapAmount;
  const leadFundingOpportunity = context.fundingSummary.leadOpportunity;
  const leadAwardOpportunity = context.fundingSummary.leadAwardOpportunity;
  const awardRecordCount = context.fundingSummary.awardRecordCount;
  const awardCount = context.fundingSummary.awardCount;
  const uninvoicedAwardAmount = context.fundingSummary.uninvoicedAwardAmount;
  const reimbursementPacketCount = context.fundingSummary.reimbursementPacketCount;
  const exactInvoiceAwardRelink = context.fundingSummary.exactInvoiceAwardRelink;
  const comparisonBackedReportCount = context.reportSummary.comparisonBackedCount;
  const recommendedReport = context.reportSummary.recommendedReport;
  const comparisonEvidenceReason =
    comparisonBackedReportCount > 0
      ? ` Saved comparison context from ${recommendedReport?.title ?? "the project reporting lane"} can support grant planning language, but it does not prove award likelihood or replace funding source review.`
      : "";

  return compactQuickLinks([
    context.fundingSummary.opportunityCount === 0
      ? quickLink("project-create-funding-record", "Create first funding opportunity", `/projects/${context.project.id}#project-funding-opportunities`, {
          targetKind: "project",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: context.fundingSummary.fundingNeedAmount !== null ? "Needs sourcing" : "Missing grant record",
          reason:
            context.fundingSummary.fundingNeedAmount !== null
              ? "This project already has a recorded funding need but still no linked funding opportunities, so sourcing candidate programs is the next honest move."
              : "This project still has no linked funding opportunity records, so the grants lane is not anchored at the project level yet.",
          approval: "approval_required",
          auditEvent: "assistant.operation.project.create_funding_opportunity",
          auditNote: "Creates the first funding opportunity record on the project so grant tracking can start from the project control room.",
          executeAction: {
            kind: "create_funding_opportunity",
            projectId: context.project.id,
            title: `${context.project.name} funding opportunity`,
            postActionWorkflowId: "project-funding",
            postActionPrompt: "A funding opportunity record was created on this project. What should be filled in next before the project is truly grant-ready?",
            postActionPromptLabel: "Review project funding posture",
          },
        })
      : null,
    context.fundingSummary.opportunityCount > 0
      && context.fundingSummary.fundingNeedAmount === null
      ? quickLink("project-create-funding-profile", "Create funding need anchor", `/projects/${context.project.id}#project-funding-opportunities`, {
          targetKind: "project",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: "Missing funding need",
          reason: "This project has funding opportunities but no recorded funding-need anchor yet, so Planner Agent cannot measure the gap honestly until that record exists.",
          approval: "approval_required",
          auditEvent: "assistant.operation.project.create_funding_profile",
          auditNote: "Creates the project funding-profile anchor through the existing audited route without inventing funding numbers.",
          executeAction: {
            kind: "create_project_funding_profile",
            projectId: context.project.id,
            notes: "Planner Agent created this funding profile anchor. Add funding need and local match next.",
            postActionWorkflowId: "project-funding",
            postActionPrompt: "A project funding profile anchor was created. What should be filled in next before this funding gap can be measured honestly?",
            postActionPromptLabel: "Review project funding posture",
          },
        })
      : null,
    context.fundingSummary.opportunityCount > 0 && context.fundingSummary.pursueCount === 0 && leadFundingOpportunity
      ? quickLink("project-advance-funding-opportunity", "Mark lead opportunity pursue", `/projects/${context.project.id}#project-funding-opportunities`, {
          targetKind: "project",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: leadFundingOpportunity.status === "open" ? "Decision needed" : "Queue next grant",
          reason: `No linked opportunity is currently marked pursue, so ${leadFundingOpportunity.title} is the cleanest next grant decision to advance from the project lane.`,
          approval: "approval_required",
          auditEvent: "assistant.operation.project.advance_funding_opportunity",
          auditNote: "Updates the lead funding opportunity decision through the existing audited route so the project has a real pursue posture.",
          executeAction: {
            kind: "update_funding_opportunity_decision",
            opportunityId: leadFundingOpportunity.id,
            decisionState: "pursue",
            postActionWorkflowId: "project-funding",
            postActionPrompt: `The lead funding opportunity ${leadFundingOpportunity.title} was marked pursue. What should be reviewed next on this project funding lane?`,
            postActionPromptLabel: "Review project funding posture",
          },
        })
      : null,
    awardRecordCount > 0 && leadAwardOpportunity
      ? quickLink("project-record-awarded-funding", "Record awarded funding", `/projects/${context.project.id}#project-funding-opportunities`, {
          targetKind: "project",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: "Award record needed",
          reason: `${leadAwardOpportunity.title} is already marked awarded, but this project still has no linked funding-award record for it.`,
          approval: "review",
          auditEvent: "assistant.operation.project.record_awarded_funding",
          auditNote: "Use the project funding section to convert awarded opportunities into committed award records before leaning on the remaining gap math.",
        })
      : null,
    awardRecordCount === 0 && awardCount > 0 && exactInvoiceAwardRelink
      ? quickLink("project-link-invoice-award", "Link exact invoice to award", `/projects/${context.project.id}#project-invoices`, {
          targetKind: "project",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: "Execute action",
          reason: "This project has one exact unlinked invoice and one exact funding-award record, so Planner Agent can repair that reimbursement linkage without guessing any billing values.",
          approval: "approval_required",
          auditEvent: "assistant.operation.project.link_invoice_award",
          auditNote: "Updates one existing invoice record to reference one exact funding-award record through the audited billing patch route.",
          executeAction: {
            kind: "link_billing_invoice_funding_award",
            workspaceId: context.workspace.id,
            invoiceId: exactInvoiceAwardRelink.invoiceId,
            fundingAwardId: exactInvoiceAwardRelink.fundingAwardId,
            postActionWorkflowId: "project-funding",
            postActionPrompt: "An exact project invoice-to-award relink was completed. What reimbursement or funding step should move next on this project?",
            postActionPromptLabel: "Review project reimbursement posture",
          },
        })
      : null,
    awardRecordCount === 0 && awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0 && reimbursementPacketCount === 0 && !exactInvoiceAwardRelink
      ? quickLink("project-create-reimbursement-record", "Create reimbursement record", `/projects/${context.project.id}#project-submittals`, {
          targetKind: "project",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: `Uninvoiced ${formatCurrency(uninvoicedAwardAmount ?? 0)}`,
          reason: "Committed award dollars are logged on the project, but no reimbursement packet record has been started yet against part of that award stack.",
          approval: "approval_required",
          auditEvent: "assistant.operation.project.create_reimbursement_record",
          auditNote: "Creates a reimbursement submittal record through the existing audited project-record route without inventing payment dates or invoice amounts.",
          executeAction: {
            kind: "create_project_record",
            projectId: context.project.id,
            recordType: "submittal",
            title: `${context.project.name} reimbursement packet`,
            submittalType: "reimbursement",
            status: "draft",
            notes: "Planner Agent created this reimbursement packet starter from committed award posture. Link award-specific backup and invoice chain next.",
            postActionWorkflowId: "project-funding",
            postActionPrompt: "A reimbursement packet record was created for this project. What funding or reimbursement step should move next?",
            postActionPromptLabel: "Review reimbursement posture",
          },
        })
      : null,
    awardRecordCount === 0 && awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
      ? quickLink("project-reimbursement-lane", reimbursementPacketCount > 0 ? "Open reimbursement lane" : "Open invoice lane", `/projects/${context.project.id}#project-invoices`, {
          targetKind: "project",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: `Uninvoiced ${formatCurrency(uninvoicedAwardAmount ?? 0)}`,
          reason:
            reimbursementPacketCount > 0
              ? "A reimbursement packet record exists, but committed award dollars are still not fully reflected in the invoice chain yet."
              : "Committed award dollars are now logged on the project, but part of that award stack still has no linked invoice request recorded.",
          approval: "review",
          auditEvent: "assistant.operation.project.reimbursement_lane",
          auditNote: "Use the project invoice lane to tie committed awards into reimbursement workflow before closeout posture drifts.",
        })
      : null,
    context.fundingSummary.opportunityCount > 0
      ? quickLink(
          "project-funding-agent",
          context.fundingSummary.closingSoonCount > 0
            ? "Check funding deadline posture in panel"
            : awardRecordCount > 0
              ? "Check awarded funding record posture in panel"
              : exactInvoiceAwardRelink
                ? "Check invoice award relink in panel"
              : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                ? "Check reimbursement posture in panel"
                : "Check funding posture in panel",
          `/projects/${context.project.id}#project-funding-opportunities`,
        {
          targetKind: "project",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority:
            context.fundingSummary.closingSoonCount > 0 ||
            awardRecordCount > 0 ||
            Boolean(exactInvoiceAwardRelink) ||
            (uninvoicedAwardAmount ?? 0) > 0 ||
            (projectGapAmount ?? 0) > 0
              ? "primary"
              : "secondary",
          statusLabel:
            context.fundingSummary.closingSoonCount > 0
              ? `${context.fundingSummary.closingSoonCount} closing soon`
              : awardRecordCount > 0
                ? `${awardRecordCount} award record${awardRecordCount === 1 ? "" : "s"}`
                : exactInvoiceAwardRelink
                  ? "1 exact relink"
                : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                  ? `Uninvoiced ${formatCurrency(uninvoicedAwardAmount ?? 0)}`
                  : (projectGapAmount ?? 0) > 0
                    ? `Gap ${formatCurrency(projectGapAmount)}`
                    : `${context.fundingSummary.opportunityCount} linked`,
          reason:
            context.fundingSummary.closingSoonCount > 0
              ? `This project has near-term funding deadlines, so grant timing should be checked before less urgent cleanup.${comparisonEvidenceReason}`
              : awardRecordCount > 0
                ? `This project already has an awarded opportunity without a matching funding-award record, so committed-dollar bookkeeping should be reconciled before remaining gap claims harden.${comparisonEvidenceReason}`
                : exactInvoiceAwardRelink
                  ? `This project already has an exact invoice-to-award reimbursement relink available, so that bookkeeping seam should be closed before generic reimbursement follow-through.${comparisonEvidenceReason}`
                : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                  ? `Committed awards are recorded, but reimbursement has not yet caught up to the full award stack, so the invoice lane deserves attention before routine cleanup.${comparisonEvidenceReason}`
                  : (projectGapAmount ?? 0) > 0
                    ? `This project still shows uncovered funding need after current pursued dollars, so the grants lane should stay in front of routine cleanup.${comparisonEvidenceReason}`
                    : `Funding opportunities are already linked to this project, so grant posture should stay visible in the control room.${comparisonEvidenceReason}`,
          approval: "review",
          auditEvent: "assistant.operation.project.funding_agent",
          auditNote: "Use the project funding section to verify pursue, monitor, skip, award, reimbursement, and funding-gap posture before changing delivery assumptions.",
          workflowId: "project-funding",
          prompt: "What funding opportunities, award records, reimbursements, or funding gaps need action on this project right now?",
          promptLabel:
            context.fundingSummary.closingSoonCount > 0
              ? "Check funding deadline posture in panel"
              : awardRecordCount > 0
                ? "Check awarded funding record posture in panel"
                : exactInvoiceAwardRelink
                  ? "Check invoice award relink in panel"
                : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                  ? "Check reimbursement posture in panel"
                  : "Check funding posture in panel",
        }
      )
    : null,
    quickLink("project-blockers-agent", "Check blockers in panel", `/projects/${context.project.id}`, {
      targetKind: "project",
      actionClass: "review_controls",
      executionMode: "future_agent_action",
      priority: "primary",
      statusLabel: "In-panel action",
      reason: "Runs the grounded blocker read inside Planner Agent instead of sending you into the project page first.",
      approval: "safe",
      auditEvent: "assistant.operation.project.blockers_agent",
      auditNote: "This produces a grounded assistant read only, it does not change project data.",
      workflowId: "project-blockers",
      prompt: "What is blocking this project right now?",
      promptLabel: "Check blockers in panel",
    }),
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
    context.fundingSummary.opportunityCount > 0
      ? quickLink("project-funding-record", "Open project funding strategy", `/projects/${context.project.id}#project-funding-opportunities`, {
          targetKind: "project",
          actionClass: "review_controls",
          priority: "secondary",
          statusLabel:
            awardRecordCount > 0
              ? `${awardRecordCount} award record${awardRecordCount === 1 ? "" : "s"}`
              : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                ? `Uninvoiced ${formatCurrency(uninvoicedAwardAmount ?? 0)}`
                : (projectGapAmount ?? 0) > 0
                  ? `Gap ${formatCurrency(projectGapAmount)}`
                  : context.fundingSummary.pursueCount > 0
                    ? `${context.fundingSummary.pursueCount} pursue`
                    : "Funding linked",
          reason:
            awardRecordCount > 0
              ? `Use the project funding section to record awarded dollars before relying on remaining gap math.${comparisonEvidenceReason}`
              : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                ? `Use the project invoice lane to move committed awards into reimbursement workflow before delivery posture drifts.${comparisonEvidenceReason}`
                : (projectGapAmount ?? 0) > 0
                  ? `Use the project funding section to close the remaining uncovered gap before delivery scope drifts ahead of funding reality.${comparisonEvidenceReason}`
                  : `Use the project funding section as the canonical grant strategy lane for this project.${comparisonEvidenceReason}`,
          approval: "review",
          auditEvent: "assistant.operation.project.funding_record",
          auditNote: "Confirm funding gap, opportunity posture, award timing, and reimbursement posture before promising delivery scope.",
        })
      : null,
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

function buildRtpRegistryOperations(context: RtpRegistryAssistantContext): AssistantQuickLink[] {
  const nextCommandLink = describeWorkspaceNextCommandLink(context);
  const registryPosture = resolveRtpPacketWorkPostureFromCounts({
    noPacketCount: context.counts.noPacketCount,
    refreshRecommendedCount: context.counts.refreshRecommendedCount,
  });
  const primaryRegistryWorkflow =
    registryPosture === "generate"
      ? {
          label: "Plan first RTP packets in panel",
          reason: "Some RTP cycles still have no generated packet, so first-packet planning outranks refresh or release review.",
          workflowId: "rtp-registry-generate",
          prompt: "Which RTP cycles still need a first board packet, and where should I start?",
          promptLabel: "Plan first RTP packets in panel",
        }
      : registryPosture === "refresh"
        ? {
            label: "Plan RTP refresh queue in panel",
            reason: "The registry has stale RTP packets, so refresh planning outranks release review.",
            workflowId: "rtp-registry-refresh",
            prompt: "Which RTP packets are stale across the registry, and what should I refresh first?",
            promptLabel: "Plan RTP refresh queue in panel",
          }
        : {
            label: "Review RTP release-review queue in panel",
            reason: "The registry packet queue is materially current enough that release review is now the main operator move.",
            workflowId: "rtp-registry-release",
            prompt: "Which RTP packet is most ready for release review right now, and what should I verify before release?",
            promptLabel: "Review RTP release-review queue in panel",
          };
  return compactQuickLinks([
    context.recommendedCycle?.packetFreshnessLabel === PACKET_FRESHNESS_LABELS.NO_PACKET && context.recommendedCycle.packetReportCount === 0
      ? quickLink("rtp-registry-create-first-packet", `Create first packet for ${context.recommendedCycle.title}`, `/rtp/${context.recommendedCycle.id}`, {
          targetKind: "rtp_registry",
          actionClass: "review_packet",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: "Create + generate",
          reason:
            "The registry's lead cycle is still missing its first RTP packet, so creating the record and generating the first artifact now is the highest-leverage direct action.",
          approval: "review",
          auditEvent: "assistant.operation.rtp_registry.create_first_packet",
          auditNote:
            "This creates one RTP board-packet record for the recommended cycle and immediately generates its first artifact through the existing audited report routes.",
          executeAction: {
            kind: "create_rtp_packet_record",
            rtpCycleId: context.recommendedCycle.id,
            modelingCountyRunId: context.defaultModelingCountyRunId,
            generateAfterCreate: true,
            postActionWorkflowId: "rtp-registry-release",
            postActionPrompt: "Which RTP packet is most ready for release review right now, and what should I verify before release?",
            postActionPromptLabel: "Review updated RTP registry",
          },
        })
      : null,
    quickLink("rtp-registry-brief-agent", primaryRegistryWorkflow.label, "/rtp", {
      targetKind: "rtp_registry",
      actionClass: "review_controls",
      executionMode: "future_agent_action",
      priority: "primary",
      statusLabel: "In-panel action",
      reason: primaryRegistryWorkflow.reason,
      approval: "safe",
      auditEvent: "assistant.operation.rtp_registry.brief_agent",
      auditNote: "This runs a grounded RTP registry brief only, it does not mutate cycle or packet records.",
      workflowId: primaryRegistryWorkflow.workflowId,
      prompt: primaryRegistryWorkflow.prompt,
      promptLabel: primaryRegistryWorkflow.promptLabel,
    }),
    context.recommendedCycle
      ? quickLink("rtp-registry-cycle", `Open ${context.recommendedCycle.title}`, `/rtp/${context.recommendedCycle.id}`, {
          targetKind: "rtp_cycle",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: context.recommendedCycle.packetFreshnessLabel,
          reason: "This cycle currently carries the strongest registry-level RTP packet or workflow signal.",
          approval: "review",
          auditEvent: "assistant.operation.rtp_registry.cycle",
          auditNote: "Use the cycle record to verify chapter, engagement, and packet posture before acting.",
        })
      : null,
    context.operationsSummary.nextCommand && nextCommandLink
      ? quickLink("rtp-registry-next-command", nextCommandLink.label, resolveWorkspaceCommandHref(context.operationsSummary.nextCommand), {
          targetKind: "rtp_registry",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: nextCommandLink.statusLabel,
          reason:
            context.operationsSummary.nextCommand.key === "review-current-report-packets" &&
            context.operationsSummary.counts.rtpFundingReviewPackets > 0
              ? nextCommandLink.reason
              : "The shared workspace queue currently has the clearest guidance for what should move around the RTP registry lane.",
          approval: "review",
          auditEvent: "assistant.operation.rtp_registry.next_command",
          auditNote:
            context.operationsSummary.nextCommand.key === "review-current-report-packets" &&
            context.operationsSummary.counts.rtpFundingReviewPackets > 0
              ? nextCommandLink.auditNote
              : "Use the command-board rationale before changing cycle, report, or packet posture.",
        })
      : null,
    quickLink("rtp-registry-surface", "Open RTP registry", "/rtp", {
      targetKind: "rtp_registry",
      actionClass: "open_surface",
      priority: "secondary",
      statusLabel: "Registry open",
      reason: "Use the RTP registry when you need the canonical queue and cycle list rather than a single-cycle drill-down.",
      approval: "safe",
      auditEvent: "assistant.operation.rtp_registry.surface",
      auditNote: "Navigation only. Registry actions still happen inside the destination screen.",
    }),
  ]);
}

function buildRtpOperations(context: RtpAssistantContext): AssistantQuickLink[] {
  const nextCommandLink = describeWorkspaceNextCommandLink(context);
  const cyclePosture = resolveRtpPacketWorkPostureFromCounts({
    linkedReportCount: context.packetSummary.linkedReportCount,
    noPacketCount: context.packetSummary.noPacketCount,
    refreshRecommendedCount: context.packetSummary.refreshRecommendedCount,
  });
  const primaryCycleWorkflow =
    cyclePosture === "generate"
      ? {
          label: "Plan first RTP packet in panel",
          reason: "This cycle still lacks a usable current packet artifact, so first-generation planning outranks refresh or release review.",
          workflowId: "rtp-packet-generate",
          prompt: "What does this RTP cycle need before creating its first board packet?",
          promptLabel: "Plan first RTP packet in panel",
        }
      : cyclePosture === "refresh"
        ? {
            label: "Plan RTP refresh in panel",
            reason: "This cycle's lead RTP packet is stale against current cycle state, so refresh planning outranks release review.",
            workflowId: "rtp-packet-refresh",
            prompt: "What changed in this RTP cycle, and what should I verify before refreshing its board packet?",
            promptLabel: "Plan RTP refresh in panel",
          }
        : {
            label: "Run RTP release review in panel",
            reason: "This cycle's lead RTP packet is current enough that release review is now the main operator move.",
            workflowId: "rtp-packet-release",
            prompt: "Is this RTP cycle's current board packet ready for release review, and what should I verify first?",
            promptLabel: "Run RTP release review in panel",
          };
  return compactQuickLinks([
    cyclePosture === "generate" && context.packetSummary.linkedReportCount === 0
      ? quickLink("rtp-create-first-packet", "Create first RTP packet now", `/rtp/${context.rtpCycle.id}`, {
          targetKind: "rtp_cycle",
          actionClass: "review_packet",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: "Create + generate",
          reason:
            "Creates the first RTP board-packet record through the existing reports.create route, generates its first artifact, and then returns to in-panel review.",
          approval: "review",
          auditEvent: "assistant.operation.rtp.create_first_packet",
          auditNote:
            "This creates one RTP board-packet record for the cycle and immediately runs the existing packet generation route, preserving report auth and artifact provenance.",
          executeAction: {
            kind: "create_rtp_packet_record",
            rtpCycleId: context.rtpCycle.id,
            modelingCountyRunId: context.defaultModelingCountyRunId,
            generateAfterCreate: true,
            postActionWorkflowId: "rtp-packet-release",
            postActionPrompt: "Is this RTP board packet ready for release review, and what still needs verification before release?",
            postActionPromptLabel: "Review generated RTP packet",
          },
        })
      : null,
    quickLink("rtp-brief-agent", primaryCycleWorkflow.label, `/rtp/${context.rtpCycle.id}`, {
      targetKind: "rtp_cycle",
      actionClass: "review_controls",
      executionMode: "future_agent_action",
      priority: "primary",
      statusLabel: "In-panel action",
      reason: primaryCycleWorkflow.reason,
      approval: "safe",
      auditEvent: "assistant.operation.rtp.brief_agent",
      auditNote: "This runs a grounded RTP brief only, it does not change cycle, chapter, or packet records.",
      workflowId: primaryCycleWorkflow.workflowId,
      prompt: primaryCycleWorkflow.prompt,
      promptLabel: primaryCycleWorkflow.promptLabel,
    }),
    context.packetSummary.recommendedReport
      ? quickLink("rtp-recommended-packet", "Open RTP packet", `/reports/${context.packetSummary.recommendedReport.id}`, {
          targetKind: "rtp_packet_report",
          actionClass: "review_packet",
          priority: "primary",
          statusLabel: context.packetSummary.recommendedReport.packetFreshness.label,
          reason: "This RTP packet is the strongest current board/binder review anchor for the cycle.",
          approval: "review",
          auditEvent: "assistant.operation.rtp.packet",
          auditNote: "Verify freshness, source drift, and section posture before release or board use.",
        })
      : null,
    context.operationsSummary.nextCommand && nextCommandLink
      ? quickLink("rtp-next-command", nextCommandLink.label, resolveWorkspaceCommandHref(context.operationsSummary.nextCommand), {
          targetKind: "rtp_cycle",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: nextCommandLink.statusLabel,
          reason:
            context.operationsSummary.nextCommand.key === "review-current-report-packets" &&
            context.operationsSummary.counts.rtpFundingReviewPackets > 0
              ? nextCommandLink.reason
              : "The shared workspace queue currently has the clearest guidance for what should move around this RTP cycle.",
          approval: "review",
          auditEvent: "assistant.operation.rtp.next_command",
          auditNote:
            context.operationsSummary.nextCommand.key === "review-current-report-packets" &&
            context.operationsSummary.counts.rtpFundingReviewPackets > 0
              ? nextCommandLink.auditNote
              : "Use the command-board rationale before changing cycle, chapter, or packet posture.",
        })
      : null,
    quickLink("rtp-record", "Open RTP cycle", `/rtp/${context.rtpCycle.id}`, {
      targetKind: "rtp_cycle",
      actionClass: "open_surface",
      priority: "secondary",
      statusLabel: "Cycle anchor",
      reason: "Use the RTP cycle record for the canonical chapter, portfolio, engagement, and adoption basis.",
      approval: "safe",
      auditEvent: "assistant.operation.rtp.record",
      auditNote: "Navigation only. Cycle edits still happen inside the destination surface.",
    }),
  ]);
}

function buildPlanOperations(context: PlanAssistantContext): AssistantQuickLink[] {
  return compactQuickLinks([
    quickLink("plan-gaps-agent", "Check plan gaps in panel", `/plans/${context.plan.id}`, {
      targetKind: "plan",
      actionClass: "inspect_readiness",
      executionMode: "future_agent_action",
      priority: "primary",
      statusLabel: "In-panel action",
      reason: "Runs the grounded missing-work review inside Planner Agent before you jump into the full plan record.",
      approval: "safe",
      auditEvent: "assistant.operation.plan.gaps_agent",
      auditNote: "This runs a grounded assistant gap review only, it does not modify the plan.",
      workflowId: "plan-gaps",
      prompt: "What is this plan still missing, and what should I fix next?",
      promptLabel: "Check plan gaps in panel",
    }),
    context.operationsSummary.nextCommand
      ? quickLink("plan-next-command", `Open ${context.operationsSummary.nextCommand.title}`, resolveWorkspaceCommandHref(context.operationsSummary.nextCommand), {
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
  const programGapAmount = context.fundingSummary.gapAmount;
  const leadFundingOpportunity = context.fundingSummary.leadOpportunity;
  const leadAwardOpportunity = context.fundingSummary.leadAwardOpportunity;
  const awardRecordCount = context.fundingSummary.awardRecordCount;
  const awardCount = context.fundingSummary.awardCount;
  const uninvoicedAwardAmount = context.fundingSummary.uninvoicedAwardAmount;
  const reimbursementPacketCount = context.fundingSummary.reimbursementPacketCount;
  const exactInvoiceAwardRelink = context.fundingSummary.exactInvoiceAwardRelink;

  return compactQuickLinks([
    context.fundingSummary.opportunityCount === 0
      ? quickLink("program-create-funding-record", "Create first funding opportunity", `/programs/${context.program.id}#program-funding-opportunities`, {
          targetKind: "program",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: context.fundingSummary.fundingNeedAmount !== null ? "Needs sourcing" : "Missing record",
          reason:
            context.fundingSummary.fundingNeedAmount !== null
              ? "This package already carries a linked project funding need but still no funding opportunities, so sourcing candidate programs is the next honest move."
              : "This package still has no linked funding opportunity records, so the grants operating lane is not anchored yet.",
          approval: "approval_required",
          auditEvent: "assistant.operation.program.create_funding_opportunity",
          auditNote: "Creates the first funding opportunity record for this package so grant tracking can start inside OpenPlan.",
          executeAction: {
            kind: "create_funding_opportunity",
            programId: context.program.id,
            projectId: context.project?.id,
            title: `${context.program.title} funding opportunity`,
            postActionWorkflowId: "program-funding",
            postActionPrompt: "A funding opportunity record was created. What fields should be filled next before this package is grant-ready?",
            postActionPromptLabel: "Review funding posture",
          },
        })
      : null,
    context.fundingSummary.opportunityCount > 0
      && context.fundingSummary.fundingNeedAmount === null
      && context.project
      ? quickLink("program-create-funding-profile", "Create funding need anchor", `/programs/${context.program.id}#program-funding-opportunities`, {
          targetKind: "program",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: "Missing funding need",
          reason: "This package has funding opportunities but its linked project still lacks a funding-need anchor, so gap posture cannot be measured honestly yet.",
          approval: "approval_required",
          auditEvent: "assistant.operation.program.create_funding_profile",
          auditNote: "Creates the linked project funding-profile anchor through the existing audited route without inventing funding numbers.",
          executeAction: {
            kind: "create_project_funding_profile",
            projectId: context.project.id,
            notes: `Planner Agent created this funding profile anchor from ${context.program.title}. Add funding need and local match next.`,
            postActionWorkflowId: "program-funding",
            postActionPrompt: "A project funding profile anchor was created for this package. What should be filled in next before the funding gap can be measured honestly?",
            postActionPromptLabel: "Review package funding posture",
          },
        })
      : null,
    context.fundingSummary.opportunityCount > 0 && context.fundingSummary.pursueCount === 0 && leadFundingOpportunity
      ? quickLink("program-advance-funding-opportunity", "Mark lead opportunity pursue", `/programs/${context.program.id}#program-funding-opportunities`, {
          targetKind: "program",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: leadFundingOpportunity.status === "open" ? "Decision needed" : "Queue next grant",
          reason: `No linked package opportunity is currently marked pursue, so ${leadFundingOpportunity.title} is the cleanest next funding decision to advance from this package.`,
          approval: "approval_required",
          auditEvent: "assistant.operation.program.advance_funding_opportunity",
          auditNote: "Updates the lead funding opportunity decision through the existing audited route so this package has a real pursue posture.",
          executeAction: {
            kind: "update_funding_opportunity_decision",
            opportunityId: leadFundingOpportunity.id,
            decisionState: "pursue",
            postActionWorkflowId: "program-funding",
            postActionPrompt: `The lead funding opportunity ${leadFundingOpportunity.title} was marked pursue. What should be reviewed next on this package funding lane?`,
            postActionPromptLabel: "Review package funding posture",
          },
        })
      : null,
    awardRecordCount > 0 && leadAwardOpportunity
      ? quickLink("program-record-awarded-funding", "Record awarded funding", `/programs/${context.program.id}#program-funding-opportunities`, {
          targetKind: "program",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: "Award record needed",
          reason: `${leadAwardOpportunity.title} is already marked awarded, but this package still has no linked funding-award record for it.`,
          approval: "review",
          auditEvent: "assistant.operation.program.record_awarded_funding",
          auditNote: "Use the package funding section to convert awarded opportunities into committed award records before leaning on the remaining gap math.",
        })
      : null,
    awardRecordCount === 0 && awardCount > 0 && exactInvoiceAwardRelink && context.project
      ? quickLink("program-link-invoice-award", "Link exact invoice to award", `/projects/${context.project.id}#project-invoices`, {
          targetKind: "project",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: "Execute action",
          reason: "This package's linked project has one exact unlinked invoice and one exact funding-award record, so Planner Agent can repair that reimbursement linkage without guessing any billing values.",
          approval: "approval_required",
          auditEvent: "assistant.operation.program.link_invoice_award",
          auditNote: "Updates one existing invoice record on the linked project to reference one exact funding-award record through the audited billing patch route.",
          executeAction: {
            kind: "link_billing_invoice_funding_award",
            workspaceId: context.workspace.id,
            invoiceId: exactInvoiceAwardRelink.invoiceId,
            fundingAwardId: exactInvoiceAwardRelink.fundingAwardId,
            postActionWorkflowId: "program-funding",
            postActionPrompt: "An exact package invoice-to-award relink was completed on the linked project. What reimbursement or funding step should move next?",
            postActionPromptLabel: "Review package reimbursement posture",
          },
        })
      : null,
    awardRecordCount === 0 && awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0 && reimbursementPacketCount === 0 && context.project && !exactInvoiceAwardRelink
      ? quickLink("program-create-reimbursement-record", "Create reimbursement record", `/projects/${context.project.id}#project-submittals`, {
          targetKind: "project",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority: "primary",
          statusLabel: `Uninvoiced ${formatCurrency(uninvoicedAwardAmount ?? 0)}`,
          reason: "Committed award dollars are logged for this package's linked project, but no reimbursement packet record has been started yet against part of that award stack.",
          approval: "approval_required",
          auditEvent: "assistant.operation.program.create_reimbursement_record",
          auditNote: "Creates a reimbursement submittal record on the linked project through the existing audited project-record route without inventing payment dates or invoice amounts.",
          executeAction: {
            kind: "create_project_record",
            projectId: context.project.id,
            recordType: "submittal",
            title: `${context.program.title} reimbursement packet`,
            submittalType: "reimbursement",
            status: "draft",
            notes: `Planner Agent created this reimbursement packet starter from ${context.program.title}. Link award-specific backup and invoice chain next.`,
            postActionWorkflowId: "program-funding",
            postActionPrompt: "A reimbursement packet record was created for this package's linked project. What funding or reimbursement step should move next?",
            postActionPromptLabel: "Review package reimbursement posture",
          },
        })
      : null,
    awardRecordCount === 0 && awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0 && context.project
      ? quickLink("program-reimbursement-lane", reimbursementPacketCount > 0 ? "Open reimbursement lane" : "Open invoice lane", `/projects/${context.project.id}#project-invoices`, {
          targetKind: "project",
          actionClass: "review_controls",
          priority: "primary",
          statusLabel: `Uninvoiced ${formatCurrency(uninvoicedAwardAmount ?? 0)}`,
          reason:
            reimbursementPacketCount > 0
              ? "A reimbursement packet record exists on the linked project, but committed award dollars are still not fully reflected in the invoice chain yet."
              : "Committed award dollars are now logged for this package's linked project, but part of that award stack still has no linked invoice request recorded.",
          approval: "review",
          auditEvent: "assistant.operation.program.reimbursement_lane",
          auditNote: "Use the linked project invoice lane to move committed package awards into reimbursement workflow before delivery posture drifts.",
        })
      : null,
    context.fundingSummary.opportunityCount > 0
      ? quickLink(
        "program-funding-agent",
          context.fundingSummary.closingSoonCount > 0
            ? "Check funding deadline posture in panel"
            : awardRecordCount > 0
              ? "Check awarded funding record posture in panel"
              : exactInvoiceAwardRelink
                ? "Check invoice award relink in panel"
              : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                ? "Check reimbursement posture in panel"
                : "Check funding posture in panel",
          `/programs/${context.program.id}#program-funding-opportunities`,
        {
          targetKind: "program",
          actionClass: "review_controls",
          executionMode: "future_agent_action",
          priority:
            context.fundingSummary.closingSoonCount > 0 ||
            awardRecordCount > 0 ||
            Boolean(exactInvoiceAwardRelink) ||
            (uninvoicedAwardAmount ?? 0) > 0 ||
            (programGapAmount ?? 0) > 0
              ? "primary"
              : "secondary",
          statusLabel:
            context.fundingSummary.closingSoonCount > 0
              ? `${context.fundingSummary.closingSoonCount} closing soon`
              : awardRecordCount > 0
                ? `${awardRecordCount} award record${awardRecordCount === 1 ? "" : "s"}`
                : exactInvoiceAwardRelink
                  ? "1 exact relink"
                : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                  ? `Uninvoiced ${formatCurrency(uninvoicedAwardAmount ?? 0)}`
                  : (programGapAmount ?? 0) > 0
                    ? `Gap ${formatCurrency(programGapAmount)}`
                    : `${context.fundingSummary.opportunityCount} linked`,
          reason:
            context.fundingSummary.closingSoonCount > 0
              ? "This package has near-term funding windows, so grant timing and pursue decisions should be checked before less urgent package cleanup."
              : awardRecordCount > 0
                ? "This package already has an awarded opportunity without a matching funding-award record, so committed-dollar bookkeeping should be reconciled before remaining gap claims harden."
                : exactInvoiceAwardRelink
                  ? "This package's linked project already has an exact invoice-to-award reimbursement relink available, so that bookkeeping seam should be closed before generic reimbursement follow-through."
                : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                  ? "Committed awards are recorded for this package's linked project, but reimbursement has not yet caught up to the full award stack, so the invoice lane deserves attention before routine cleanup."
                  : (programGapAmount ?? 0) > 0
                    ? "The linked project still shows uncovered funding need after current pursued dollars, so package funding posture should stay visible alongside packet work."
                    : "Funding opportunities are already linked to this package, so grant posture should stay visible alongside packet and readiness work.",
          approval: "review",
          auditEvent: "assistant.operation.program.funding_agent",
          auditNote: "Use the program funding section to verify pursue, monitor, skip, award, reimbursement, and gap posture before changing linked package strategy.",
          workflowId: "program-funding",
          prompt: "Which funding opportunities, award records, reimbursements, or funding gaps tied to this package need action next, and why?",
          promptLabel:
            context.fundingSummary.closingSoonCount > 0
              ? "Check funding deadline posture in panel"
              : awardRecordCount > 0
                ? "Check awarded funding record posture in panel"
                : exactInvoiceAwardRelink
                  ? "Check invoice award relink in panel"
                : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                  ? "Check reimbursement posture in panel"
                  : "Check funding posture in panel",
        }
      )
      : null,
    quickLink("program-packet-agent", "Check packet posture in panel", `/programs/${context.program.id}`, {
      targetKind: "program",
      actionClass: "review_packet",
      executionMode: "future_agent_action",
      priority: "primary",
      statusLabel: "In-panel action",
      reason: "Runs the grounded packet-posture check inside Planner Agent before you navigate away.",
      approval: "safe",
      auditEvent: "assistant.operation.program.packet_agent",
      auditNote: "This is a grounded assistant read only, it does not mutate packet records.",
      workflowId: "program-packet",
      prompt: "What packet or evidence work does this program need next?",
      promptLabel: "Check packet posture in panel",
    }),
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
      ? quickLink("program-next-command", `Open ${context.operationsSummary.nextCommand.title}`, resolveWorkspaceCommandHref(context.operationsSummary.nextCommand), {
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
    context.fundingSummary.opportunityCount > 0
      ? quickLink("program-funding-record", "Open funding opportunities", `/programs/${context.program.id}#program-funding-opportunities`, {
          targetKind: "program",
          actionClass: "review_controls",
          priority: "secondary",
          statusLabel:
            awardRecordCount > 0
              ? `${awardRecordCount} award record${awardRecordCount === 1 ? "" : "s"}`
              : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                ? `Uninvoiced ${formatCurrency(uninvoicedAwardAmount ?? 0)}`
                : (programGapAmount ?? 0) > 0
                  ? `Gap ${formatCurrency(programGapAmount)}`
                  : context.fundingSummary.pursueCount > 0
                    ? `${context.fundingSummary.pursueCount} pursue`
                    : "Funding linked",
          reason:
            awardRecordCount > 0
              ? "Use the package funding section to record awarded dollars before relying on remaining gap math."
              : awardCount > 0 && (uninvoicedAwardAmount ?? 0) > 0
                ? "Use the linked project invoice lane to move committed package awards into reimbursement workflow before downstream delivery posture drifts."
                : (programGapAmount ?? 0) > 0
                  ? "Use the package funding section to close the linked project funding gap before downstream packet or delivery assumptions harden."
                  : "Use the linked funding-opportunities section as the canonical grant posture lane for this package.",
          approval: "review",
          auditEvent: "assistant.operation.program.funding_record",
          auditNote: "Funding decisions should stay tied to this package before they ripple into broader project or RTP posture.",
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
    quickLink("scenario-compare-agent", "Compare scenarios in panel", `/scenarios/${context.scenarioSet.id}`, {
      targetKind: "scenario_set",
      actionClass: "review_analysis",
      executionMode: "future_agent_action",
      priority: "primary",
      statusLabel: "In-panel action",
      reason: "Runs the grounded scenario comparison read inside Planner Agent without leaving the current surface.",
      approval: "safe",
      auditEvent: "assistant.operation.scenario.compare_agent",
      auditNote: "This produces a grounded comparison summary only, it does not alter scenario data.",
      workflowId: "scenario-compare",
      prompt: "Compare the ready alternatives against baseline and tell me what moved.",
      promptLabel: "Compare scenarios in panel",
    }),
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
    quickLink("model-readiness-agent", "Check model readiness in panel", `/models/${context.model.id}`, {
      targetKind: "model",
      actionClass: "inspect_readiness",
      executionMode: "future_agent_action",
      priority: "primary",
      statusLabel: "In-panel action",
      reason: "Runs the grounded readiness read inside Planner Agent before you move into the full model surface.",
      approval: "safe",
      auditEvent: "assistant.operation.model.readiness_agent",
      auditNote: "This runs a grounded readiness brief only, it does not launch or modify the model.",
      workflowId: "model-readiness",
      prompt: "Is this model ready for serious use, and what still needs work?",
      promptLabel: "Check model readiness in panel",
    }),
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
  const reportTargetKind: AssistantQuickLink["targetKind"] = context.kind === "rtp_packet_report" ? "rtp_packet_report" : "report";
  const packetFreshness = getReportPacketFreshness({
    latestArtifactKind: context.report.latestArtifactKind,
    generatedAt: context.report.generatedAt,
    updatedAt: context.report.updatedAt,
  });
  const packetPosture = resolveRtpPacketWorkPostureFromFreshnessLabel(packetFreshness.label);
  const storedRtpPublicReviewSummary =
    context.kind === "rtp_packet_report"
      ? parseStoredRtpPublicReviewSummary({ sourceContext: context.sourceContext })
      : null;
  const rtpReleaseReviewSummary =
    context.kind === "rtp_packet_report" && storedRtpPublicReviewSummary
      ? buildRtpReleaseReviewSummary({
          packetFreshnessLabel: packetFreshness.label,
          publicReviewSummary: storedRtpPublicReviewSummary,
        })
      : null;
  const primaryPacketWorkflow =
    context.kind === "rtp_packet_report"
      ? packetPosture === "generate"
        ? {
            label: "Plan first RTP packet in panel",
            reason: "This RTP packet record still lacks its first generated artifact, so first-generation planning outranks release review.",
            workflowId: "rtp-packet-generate",
            prompt: "What does this RTP packet need before generating its first board packet artifact?",
            promptLabel: "Plan first RTP packet in panel",
          }
        : packetPosture === "refresh"
          ? {
              label: "Plan RTP packet refresh in panel",
              reason: "The RTP packet is stale against current cycle state, so refresh planning outranks release review.",
              workflowId: "rtp-packet-refresh",
              prompt: "What changed since the last RTP packet generation, and what should I verify before refreshing it?",
              promptLabel: "Plan RTP packet refresh in panel",
            }
          : rtpReleaseReviewSummary?.label === "Review loop still open"
            ? {
                label: "Close RTP review loop in panel",
                reason: rtpReleaseReviewSummary.detail,
                workflowId: "rtp-packet-release",
                prompt: "What is still open in this RTP packet's review loop, and what should close before release review is treated as settled?",
                promptLabel: "Close RTP review loop in panel",
              }
            : rtpReleaseReviewSummary?.label === "Comment basis still forming"
              ? {
                  label: "Check RTP comment basis in panel",
                  reason: rtpReleaseReviewSummary.detail,
                  workflowId: "rtp-packet-release",
                  prompt: "What comment-response basis is still missing from this RTP packet before release review is treated as settled?",
                  promptLabel: "Check RTP comment basis in panel",
                }
              : {
                  label: "Run RTP release check in panel",
                  reason: rtpReleaseReviewSummary?.detail ?? "The RTP packet is current enough that release review is now the main operator move.",
                  workflowId: "rtp-packet-release",
                  prompt: "Is this RTP board packet ready for release review, and what still needs verification before release?",
                  promptLabel: "Run RTP release check in panel",
                }
      : {
          label: "Run release check in panel",
          reason: "Runs the grounded release check inside Planner Agent before you jump into full report detail.",
          workflowId: "report-release",
          prompt: "Is this report ready for release review, and what still needs verification?",
          promptLabel: "Run release check in panel",
        };
  return compactQuickLinks([
    context.kind === "rtp_packet_report" && packetPosture !== "release"
      ? quickLink(
          packetPosture === "generate" ? "report-generate-artifact" : "report-refresh-artifact",
          packetPosture === "generate" ? "Generate RTP packet now" : "Refresh RTP packet now",
          `/reports/${context.report.id}`,
          {
            targetKind: reportTargetKind,
            actionClass: "review_packet",
            executionMode: "future_agent_action",
            priority: "primary",
            statusLabel: packetPosture === "generate" ? "Generate artifact" : "Refresh artifact",
            reason:
              packetPosture === "generate"
                ? "Uses the existing report generation route to create the first RTP packet artifact now, then returns a fresh in-panel review."
                : "Uses the existing report generation route to refresh the stale RTP packet now, then returns a fresh in-panel review.",
            approval: "review",
            auditEvent:
              packetPosture === "generate"
                ? "assistant.operation.report.generate_artifact"
                : "assistant.operation.report.refresh_artifact",
            auditNote:
              "This executes the existing report.generate route and keeps report auth, artifact provenance, and packet audit posture intact.",
            executeAction: {
              kind: "generate_report_artifact",
              reportId: context.report.id,
              postActionWorkflowId: "rtp-packet-release",
              postActionPrompt: "Is this RTP board packet ready for release review, and what still needs verification before release?",
              postActionPromptLabel:
                packetPosture === "generate" ? "Review generated RTP packet" : "Review refreshed RTP packet",
            },
          }
        )
      : null,
    quickLink("report-release-agent", primaryPacketWorkflow.label, `/reports/${context.report.id}`, {
      targetKind: reportTargetKind,
      actionClass: "review_packet",
      executionMode: "future_agent_action",
      priority: "primary",
      statusLabel: "In-panel action",
      reason: primaryPacketWorkflow.reason,
      approval: "safe",
      auditEvent: "assistant.operation.report.release_agent",
      auditNote: "This is a grounded packet review only, it does not publish or mutate the report.",
      workflowId: primaryPacketWorkflow.workflowId,
      prompt: primaryPacketWorkflow.prompt,
      promptLabel: primaryPacketWorkflow.promptLabel,
    }),
    quickLink("report-detail", context.kind === "rtp_packet_report" ? "Open RTP packet detail" : "Open report detail", `/reports/${context.report.id}`, {
      targetKind: reportTargetKind,
      actionClass: "review_packet",
      priority: "primary",
      statusLabel:
        context.kind === "rtp_packet_report"
          ? rtpReleaseReviewSummary?.label ?? packetFreshness.label
          : context.rtpCycle
            ? "RTP packet review"
            : "Packet review",
      reason: context.rtpCycle
        ? "Report detail is the canonical RTP packet audit surface for cycle drift, provenance, and artifact history."
        : "Report detail is the canonical packet audit surface for provenance, drift, and artifact history.",
      approval: "review",
      auditEvent: "assistant.operation.report.detail",
      auditNote: "Use report detail to inspect provenance, drift, and artifact history before sharing.",
    }),
    context.rtpCycle
      ? quickLink("report-rtp-cycle", `Open ${context.rtpCycle.title}`, `/rtp/${context.rtpCycle.id}`, {
          targetKind: "rtp_cycle",
          actionClass: "review_controls",
          priority: "secondary",
          statusLabel: "Cycle anchor",
          reason: "This report is tied to an RTP cycle, so the cycle record is the best cross-check for chapter and packet drift.",
          approval: "review",
          auditEvent: "assistant.operation.report.rtp_cycle",
          auditNote: "Use the RTP cycle as the canonical source for chapter, portfolio, and board-packet context.",
        })
      : null,
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
      "run-brief-agent",
      context.baselineRun ? "Compare run in panel" : "Generate run brief",
      buildAnalysisHref(context.run.id, context.baselineRun?.id ?? null),
      {
        targetKind: "run",
        actionClass: "review_analysis",
        executionMode: "future_agent_action",
        priority: "primary",
        statusLabel: "In-panel action",
        reason: context.baselineRun
          ? "Runs the grounded comparison read inside Planner Agent before you move into full Analysis Studio."
          : "Runs the grounded run brief inside Planner Agent without leaving the current screen.",
        approval: "safe",
        auditEvent: "assistant.operation.run.brief_agent",
        auditNote: "This produces a grounded run summary only, it does not alter analysis state.",
        workflowId: context.baselineRun ? "run-compare" : "run-brief",
        prompt: context.baselineRun
          ? "Compare this run to baseline and tell me what changed."
          : "Give me a concise operator brief for this run.",
        promptLabel: context.baselineRun ? "Compare run in panel" : "Generate run brief",
      }
    ),
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
    case "rtp_registry":
      return buildRtpRegistryOperations(context);
    case "rtp_cycle":
      return buildRtpOperations(context);
    case "plan":
      return buildPlanOperations(context);
    case "program":
      return buildProgramOperations(context);
    case "scenario_set":
      return buildScenarioOperations(context);
    case "model":
      return buildModelOperations(context);
    case "report":
    case "rtp_packet_report":
      return buildReportOperations(context);
    case "run":
      return buildRunOperations(context);
    case "analysis_studio":
    case "workspace":
    default:
      return buildWorkspaceOperations(context);
  }
}
