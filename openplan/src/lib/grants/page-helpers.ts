import type {
  FundingOpportunityStatus,
  FundingOpportunityDecision,
} from "@/lib/programs/catalog";
import {
  type ProjectGrantModelingEvidence,
  compareProjectGrantModelingEvidenceForQueue,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import type { buildProjectFundingStackSummary } from "@/lib/projects/funding";
import { buildBillingInvoiceTriageHref } from "@/lib/billing/triage-links";

export type GrantsPageSearchParams = Promise<{
  status?: string;
  decision?: string;
  focusProjectId?: string;
  focusOpportunityId?: string;
  focusInvoiceId?: string;
  relinkedInvoiceId?: string;
}>;

export type FundingOpportunityRow = {
  id: string;
  workspace_id: string;
  program_id: string | null;
  project_id: string | null;
  title: string;
  opportunity_status: FundingOpportunityStatus;
  decision_state: FundingOpportunityDecision;
  agency_name: string | null;
  owner_label: string | null;
  cadence_label: string | null;
  expected_award_amount: number | string | null;
  opens_at: string | null;
  closes_at: string | null;
  decision_due_at: string | null;
  fit_notes: string | null;
  readiness_notes: string | null;
  decision_rationale: string | null;
  decided_at: string | null;
  summary: string | null;
  updated_at: string;
  created_at: string;
  programs:
    | {
        id: string;
        title: string;
        funding_classification: string | null;
      }
    | Array<{
        id: string;
        title: string;
        funding_classification: string | null;
      }>
    | null;
  projects:
    | {
        id: string;
        name: string;
      }
    | Array<{
        id: string;
        name: string;
      }>
    | null;
};

export type ProjectOption = {
  id: string;
  name: string;
};

export type ProgramOption = {
  id: string;
  title: string;
};

export type FundingAwardRow = {
  id: string;
  funding_opportunity_id: string | null;
  project_id: string | null;
  program_id: string | null;
  title: string;
  awarded_amount: number | string | null;
  match_amount: number | string | null;
  obligation_due_at: string | null;
  spending_status: string | null;
  risk_flag: string | null;
  notes: string | null;
  updated_at: string;
  created_at: string;
  funding_opportunities:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
  programs:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
  projects:
    | {
        id: string;
        name: string;
      }
    | Array<{
        id: string;
        name: string;
      }>
    | null;
};

export type BillingInvoiceRow = {
  id: string;
  project_id: string | null;
  funding_award_id: string | null;
  invoice_number: string | null;
  status: string;
  due_date: string | null;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
};

export type ProjectFundingProfileRow = {
  project_id: string;
  funding_need_amount: number | string | null;
  local_match_need_amount: number | string | null;
  notes?: string | null;
};

export type ProjectGrantModelingReportRow = {
  id: string;
  project_id: string;
  title: string;
  updated_at: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
};

export type ReportArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

export type StatusFilter = "all" | FundingOpportunityStatus;
export type DecisionFilter = "all" | FundingOpportunityDecision;

export const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "open",
  "upcoming",
  "awarded",
  "closed",
  "archived",
];
export const DECISION_FILTERS: DecisionFilter[] = ["all", "pursue", "monitor", "skip"];

export function normalizeJoinedRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export function normalizeStatusFilter(value: string | undefined): StatusFilter {
  return STATUS_FILTERS.includes(value as StatusFilter) ? (value as StatusFilter) : "all";
}

export function normalizeDecisionFilter(value: string | undefined): DecisionFilter {
  return DECISION_FILTERS.includes(value as DecisionFilter) ? (value as DecisionFilter) : "all";
}

export function normalizeFocusedProjectId(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function normalizeFocusedOpportunityId(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function normalizeFocusedInvoiceId(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function normalizeRelinkedInvoiceId(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function buildGrantsFilterHref(filters: { status: StatusFilter; decision: DecisionFilter }) {
  const params = new URLSearchParams();
  if (filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters.decision !== "all") {
    params.set("decision", filters.decision);
  }

  const query = params.toString();
  return query ? `/grants?${query}` : "/grants";
}

export function formatFilterLabel(value: StatusFilter | DecisionFilter) {
  if (value === "all") return "All";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export type GrantsModelingTriageProject = {
  project: ProjectOption;
  opportunityCount: number;
  leadOpportunityId: string;
  modelingEvidence: ProjectGrantModelingEvidence | null;
  modelingReadiness: ReturnType<typeof describeProjectGrantModelingReadiness>;
};

export function compareGrantModelingTriageProjects(
  left: GrantsModelingTriageProject,
  right: GrantsModelingTriageProject
) {
  const modelingDifference = compareProjectGrantModelingEvidenceForQueue(
    left.modelingEvidence,
    right.modelingEvidence
  );
  if (modelingDifference !== 0) {
    return modelingDifference;
  }

  if (left.opportunityCount !== right.opportunityCount) {
    return right.opportunityCount - left.opportunityCount;
  }

  return left.project.name.localeCompare(right.project.name);
}

export function compareFundingOpportunitiesForGrantsQueue(
  left: FundingOpportunityRow & { project: ProjectOption | null },
  right: FundingOpportunityRow & { project: ProjectOption | null },
  modelingEvidenceByProjectId: Map<string, ProjectGrantModelingEvidence>
) {
  const priorityDifference = getOpportunityPriority(left) - getOpportunityPriority(right);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const leftModelingEvidence = left.project?.id
    ? modelingEvidenceByProjectId.get(left.project.id) ?? null
    : null;
  const rightModelingEvidence = right.project?.id
    ? modelingEvidenceByProjectId.get(right.project.id) ?? null
    : null;
  const modelingDifference = compareProjectGrantModelingEvidenceForQueue(
    leftModelingEvidence,
    rightModelingEvidence
  );
  if (modelingDifference !== 0) {
    return modelingDifference;
  }

  return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
}

export function buildFocusedOpportunityCardHref(opportunityId: string | null | undefined) {
  if (!opportunityId) {
    return "/grants";
  }

  const params = new URLSearchParams({ focusOpportunityId: opportunityId });
  return `/grants?${params.toString()}#funding-opportunity-${opportunityId}`;
}

export function formatCurrency(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function toneForInvoiceStatus(
  status: string
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (status === "submitted" || status === "approved_for_payment") return "info";
  if (status === "internal_review") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

export function isInvoiceOverdue(status: string, dueDate: string | null | undefined): boolean {
  if (!dueDate || status === "paid" || status === "rejected") {
    return false;
  }

  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getTime() < Date.now();
}

export function formatInvoiceQueueReason(reason: string) {
  return reason.replace(/^Exact award relink is ready now:\s*/i, "");
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function isClosingSoon(value: string | null | undefined) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = Date.now();
  const diffMs = parsed.getTime() - now;
  return diffMs >= 0 && diffMs <= 14 * 24 * 60 * 60 * 1000;
}

export function isDecisionSoon(value: string | null | undefined) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = Date.now();
  const diffMs = parsed.getTime() - now;
  return diffMs >= 0 && diffMs <= 14 * 24 * 60 * 60 * 1000;
}

export function getOpportunityPriority(opportunity: {
  opportunity_status: FundingOpportunityStatus;
  decision_state: FundingOpportunityDecision;
  closes_at: string | null;
  decision_due_at: string | null;
}) {
  if (isClosingSoon(opportunity.closes_at)) return 0;
  if (opportunity.opportunity_status === "open" && opportunity.decision_state === "pursue") return 1;
  if (isDecisionSoon(opportunity.decision_due_at) && opportunity.decision_state !== "skip") return 2;
  if (opportunity.opportunity_status === "open") return 3;
  if (opportunity.opportunity_status === "upcoming") return 4;
  if (opportunity.opportunity_status === "awarded") return 5;
  return 6;
}

export function getReimbursementPriority(
  status: ReturnType<typeof buildProjectFundingStackSummary>["reimbursementStatus"]
) {
  switch (status) {
    case "not_started":
      return 0;
    case "drafting":
      return 1;
    case "in_review":
      return 2;
    case "partially_paid":
      return 3;
    case "paid":
      return 4;
    default:
      return 5;
  }
}

export function getReimbursementActionLabel(
  status: ReturnType<typeof buildProjectFundingStackSummary>["reimbursementStatus"]
) {
  switch (status) {
    case "not_started":
      return "Start reimbursement packet";
    case "drafting":
      return "Advance draft reimbursement";
    case "in_review":
      return "Review in-flight reimbursement";
    case "partially_paid":
      return "Close remaining reimbursement";
    case "paid":
      return "Review paid billing record";
    default:
      return "Open billing register";
  }
}

export function resolveProjectExactBillingTriageTarget(invoices: BillingInvoiceRow[]) {
  const actionableInvoices = invoices.filter(
    (invoice) =>
      Boolean(invoice.funding_award_id) && invoice.status !== "paid" && invoice.status !== "rejected"
  );

  if (actionableInvoices.length !== 1) {
    return null;
  }

  return actionableInvoices[0] ?? null;
}

export function buildFocusedGrantsFundingNeedHref(projectId: string | null | undefined) {
  if (!projectId) {
    return "/grants#grants-funding-need-editor";
  }

  const params = new URLSearchParams({ focusProjectId: projectId });
  return `/grants?${params.toString()}#grants-funding-need-editor`;
}

export function buildFocusedGrantsGapResolutionHref(projectId: string | null | undefined) {
  if (!projectId) {
    return "/grants#grants-gap-resolution-lane";
  }

  const params = new URLSearchParams({ focusProjectId: projectId });
  return `/grants?${params.toString()}#grants-gap-resolution-lane`;
}

export function buildFocusedGrantsOpportunityCreationHref(projectId: string | null | undefined) {
  if (!projectId) {
    return "/grants#grants-opportunity-creator";
  }

  const params = new URLSearchParams({ focusProjectId: projectId });
  return `/grants?${params.toString()}#grants-opportunity-creator`;
}

export function buildFocusedGrantsReimbursementHref(projectId: string | null | undefined) {
  if (!projectId) {
    return "/grants#grants-awards-reimbursement";
  }

  const params = new URLSearchParams({ focusProjectId: projectId });
  return `/grants?${params.toString()}#grants-reimbursement-composer`;
}

export function buildFocusedGrantsOpportunityHref(opportunityId: string | null | undefined) {
  if (!opportunityId) {
    return "/grants";
  }

  const params = new URLSearchParams({ focusOpportunityId: opportunityId });
  return `/grants?${params.toString()}#funding-opportunity-${opportunityId}`;
}

export function buildFocusedGrantsAwardConversionHref(opportunityId: string | null | undefined) {
  if (!opportunityId) {
    return "/grants#grants-award-conversion-lane";
  }

  const params = new URLSearchParams({ focusOpportunityId: opportunityId });
  return `/grants?${params.toString()}#grants-award-conversion-composer`;
}

export function resolveGrantsQueueHref(
  item: {
    key: string;
    href: string;
    targetProjectId?: string | null;
    targetOpportunityId?: string | null;
    targetInvoiceId?: string | null;
  },
  workspaceId: string,
  exactBillingTriageInvoiceByProjectId: Map<string, BillingInvoiceRow>,
  invoiceById: Map<string, BillingInvoiceRow>
) {
  if (
    item.key === "relink-project-invoice-awards" &&
    item.targetProjectId &&
    item.targetInvoiceId
  ) {
    const targetInvoice = invoiceById.get(item.targetInvoiceId) ?? null;
    if (targetInvoice) {
      return buildBillingInvoiceTriageHref({
        workspaceId,
        invoiceId: targetInvoice.id,
        linkage: "unlinked",
        overdue: isInvoiceOverdue(targetInvoice.status, targetInvoice.due_date) ? "overdue" : "all",
        projectId: item.targetProjectId,
      });
    }
  }

  if (item.key === "advance-project-reimbursement-invoicing" && item.targetProjectId) {
    const targetInvoice = exactBillingTriageInvoiceByProjectId.get(item.targetProjectId) ?? null;
    if (targetInvoice) {
      return buildBillingInvoiceTriageHref({
        workspaceId,
        invoiceId: targetInvoice.id,
        linkage: "linked",
        overdue: isInvoiceOverdue(targetInvoice.status, targetInvoice.due_date) ? "overdue" : "all",
        projectId: item.targetProjectId,
      });
    }
  }

  if (item.key === "anchor-project-funding-needs") {
    return buildFocusedGrantsFundingNeedHref(item.targetProjectId);
  }

  if (item.key === "close-project-funding-gaps") {
    return buildFocusedGrantsGapResolutionHref(item.targetProjectId);
  }

  if (item.key === "source-project-funding-opportunities") {
    return buildFocusedGrantsOpportunityCreationHref(item.targetProjectId);
  }

  if (item.key === "funding-windows-closing" || item.key === "advance-project-funding-decisions") {
    return buildFocusedGrantsOpportunityHref(item.targetOpportunityId);
  }

  if (item.key === "start-project-reimbursement-packets") {
    return buildFocusedGrantsReimbursementHref(item.targetProjectId);
  }

  if (item.key === "record-awarded-funding") {
    return buildFocusedGrantsAwardConversionHref(item.targetOpportunityId);
  }

  return item.href;
}
