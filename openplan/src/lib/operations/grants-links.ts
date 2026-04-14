import type { WorkspaceCommandQueueItem } from "@/lib/operations/workspace-summary";

export const GRANTS_COMMAND_MODULE_KEY = "grants" as const;
export const GRANTS_COMMAND_MODULE_LABEL = "Grants OS";

const GRANTS_QUEUE_KEYS = new Set([
  "funding-windows-closing",
  "anchor-project-funding-needs",
  "source-project-funding-opportunities",
  "advance-project-funding-decisions",
  "record-awarded-funding",
  "start-project-reimbursement-packets",
  "relink-project-invoice-awards",
  "advance-project-reimbursement-invoicing",
  "close-project-funding-gaps",
]);

const GRANTS_REIMBURSEMENT_QUEUE_KEYS = new Set([
  "start-project-reimbursement-packets",
  "relink-project-invoice-awards",
  "advance-project-reimbursement-invoicing",
]);

const GRANTS_AWARD_QUEUE_KEYS = new Set(["record-awarded-funding"]);
const GRANTS_DECISION_QUEUE_KEYS = new Set([
  "funding-windows-closing",
  "advance-project-funding-decisions",
]);
const GRANTS_SOURCING_QUEUE_KEYS = new Set([
  "anchor-project-funding-needs",
  "source-project-funding-opportunities",
  "close-project-funding-gaps",
]);

export type GrantsQueueCalloutKind = "sourcing" | "reimbursement" | "award" | "decision";

const GRANTS_QUEUE_CALLOUT_COPY: Record<GrantsQueueCalloutKind, { title: string; actionLabel: string }> = {
  sourcing: {
    title: "Lead sourcing and gap command from workspace queue",
    actionLabel: "Open sourcing lane",
  },
  reimbursement: {
    title: "Lead reimbursement command from workspace queue",
    actionLabel: "Open reimbursement follow-through",
  },
  award: {
    title: "Lead award conversion command from workspace queue",
    actionLabel: "Open award conversion",
  },
  decision: {
    title: "Lead opportunity decision command from workspace queue",
    actionLabel: "Open opportunity decision",
  },
};

function buildFocusedProjectHref(projectId: string | null | undefined, anchor: string) {
  if (!projectId) return `/grants${anchor}`;
  const params = new URLSearchParams({ focusProjectId: projectId });
  return `/grants?${params.toString()}${anchor}`;
}

function buildFocusedOpportunityHref(opportunityId: string | null | undefined) {
  if (!opportunityId) return "/grants";
  const params = new URLSearchParams({ focusOpportunityId: opportunityId });
  return `/grants?${params.toString()}#funding-opportunity-${opportunityId}`;
}

function buildFocusedInvoiceHref(invoiceId: string | null | undefined) {
  if (!invoiceId) return "/grants#grants-reimbursement-triage";
  const params = new URLSearchParams({ focusInvoiceId: invoiceId });
  return `/grants?${params.toString()}#grants-reimbursement-triage`;
}

export function isGrantsQueueItem(item: Pick<WorkspaceCommandQueueItem, "key"> | null | undefined) {
  return Boolean(item && GRANTS_QUEUE_KEYS.has(item.key));
}

export function isGrantsCommand(
  item: Pick<WorkspaceCommandQueueItem, "key" | "moduleKey"> | null | undefined
) {
  return Boolean(item && (item.moduleKey === GRANTS_COMMAND_MODULE_KEY || isGrantsQueueItem(item)));
}

export function isGrantsReimbursementCommand(
  item: Pick<WorkspaceCommandQueueItem, "key" | "moduleKey"> | null | undefined
) {
  return Boolean(item && isGrantsCommand(item) && GRANTS_REIMBURSEMENT_QUEUE_KEYS.has(item.key));
}

export function isGrantsAwardCommand(
  item: Pick<WorkspaceCommandQueueItem, "key" | "moduleKey"> | null | undefined
) {
  return Boolean(item && isGrantsCommand(item) && GRANTS_AWARD_QUEUE_KEYS.has(item.key));
}

export function isGrantsDecisionCommand(
  item: Pick<WorkspaceCommandQueueItem, "key" | "moduleKey"> | null | undefined
) {
  return Boolean(item && isGrantsCommand(item) && GRANTS_DECISION_QUEUE_KEYS.has(item.key));
}

export function isGrantsSourcingCommand(
  item: Pick<WorkspaceCommandQueueItem, "key" | "moduleKey"> | null | undefined
) {
  return Boolean(item && isGrantsCommand(item) && GRANTS_SOURCING_QUEUE_KEYS.has(item.key));
}

export function resolveGrantsQueueCalloutCopy(kind: GrantsQueueCalloutKind, item: Pick<WorkspaceCommandQueueItem, "tone">) {
  return {
    ...GRANTS_QUEUE_CALLOUT_COPY[kind],
    badgeLabel: item.tone === "warning" ? "Next" : "Queue",
  };
}

export function resolveSharedGrantsQueueHref(item: WorkspaceCommandQueueItem): string {
  if (item.key === "anchor-project-funding-needs") {
    return buildFocusedProjectHref(item.targetProjectId, "#grants-funding-need-editor");
  }

  if (item.key === "close-project-funding-gaps") {
    return buildFocusedProjectHref(item.targetProjectId, "#grants-gap-resolution-lane");
  }

  if (item.key === "source-project-funding-opportunities") {
    return buildFocusedProjectHref(item.targetProjectId, "#grants-opportunity-creator");
  }

  if (item.key === "funding-windows-closing" || item.key === "advance-project-funding-decisions") {
    return buildFocusedOpportunityHref(item.targetOpportunityId);
  }

  if (item.key === "record-awarded-funding") {
    if (!item.targetOpportunityId) return "/grants#grants-award-conversion-lane";
    const params = new URLSearchParams({ focusOpportunityId: item.targetOpportunityId });
    return `/grants?${params.toString()}#grants-award-conversion-composer`;
  }

  if (item.key === "start-project-reimbursement-packets") {
    return buildFocusedProjectHref(item.targetProjectId, "#grants-reimbursement-composer");
  }

  if (item.key === "relink-project-invoice-awards" || item.key === "advance-project-reimbursement-invoicing") {
    return buildFocusedInvoiceHref(item.targetInvoiceId);
  }

  return item.href;
}

export function resolveWorkspaceCommandHref(item: WorkspaceCommandQueueItem): string {
  return isGrantsCommand(item) ? resolveSharedGrantsQueueHref(item) : item.href;
}
