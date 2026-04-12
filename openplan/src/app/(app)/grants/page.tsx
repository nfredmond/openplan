import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarClock, Landmark, ShieldCheck, Sparkles } from "lucide-react";
import { BillingTriageLinkCopy } from "@/components/billing/billing-triage-link-copy";
import { InvoiceFundingAwardLinker } from "@/components/billing/invoice-funding-award-linker";
import { InvoiceRecordComposer } from "@/components/billing/invoice-record-composer";
import { InvoiceStatusAdvanceButton } from "@/components/billing/invoice-status-advance-button";
import { FundingOpportunityCreator } from "@/components/programs/funding-opportunity-creator";
import { FundingOpportunityDecisionControls } from "@/components/programs/funding-opportunity-decision-controls";
import { ProjectFundingAwardCreator } from "@/components/projects/project-funding-award-creator";
import { ProjectFundingProfileEditor } from "@/components/projects/project-funding-profile-editor";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import {
  formatFundingOpportunityDecisionLabel,
  formatFundingOpportunityStatusLabel,
  fundingOpportunityDecisionTone,
  fundingOpportunityStatusTone,
  type FundingOpportunityDecision,
  type FundingOpportunityStatus,
} from "@/lib/programs/catalog";
import {
  buildBillingInvoicePriorityQueue,
  invoiceNeedsAwardRelink,
  resolveExactBillingInvoiceAwardMatch,
  summarizeBillingInvoiceRecords,
} from "@/lib/billing/invoice-records";
import { buildBillingInvoiceTriageHref } from "@/lib/billing/triage-links";
import {
  buildProjectFundingStackSummary,
  projectFundingReimbursementTone,
} from "@/lib/projects/funding";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";

type GrantsPageSearchParams = Promise<{
  status?: string;
  decision?: string;
  focusProjectId?: string;
  focusOpportunityId?: string;
  focusInvoiceId?: string;
  relinkedInvoiceId?: string;
}>;

type FundingOpportunityRow = {
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

type ProjectOption = {
  id: string;
  name: string;
};

type ProgramOption = {
  id: string;
  title: string;
};

type FundingAwardRow = {
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

type BillingInvoiceRow = {
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

type ProjectFundingProfileRow = {
  project_id: string;
  funding_need_amount: number | string | null;
  local_match_need_amount: number | string | null;
  notes?: string | null;
};

type StatusFilter = "all" | FundingOpportunityStatus;
type DecisionFilter = "all" | FundingOpportunityDecision;

const STATUS_FILTERS: StatusFilter[] = ["all", "open", "upcoming", "awarded", "closed", "archived"];
const DECISION_FILTERS: DecisionFilter[] = ["all", "pursue", "monitor", "skip"];
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

function normalizeJoinedRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function normalizeStatusFilter(value: string | undefined): StatusFilter {
  return STATUS_FILTERS.includes(value as StatusFilter) ? (value as StatusFilter) : "all";
}

function normalizeDecisionFilter(value: string | undefined): DecisionFilter {
  return DECISION_FILTERS.includes(value as DecisionFilter) ? (value as DecisionFilter) : "all";
}

function normalizeFocusedProjectId(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeFocusedOpportunityId(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeFocusedInvoiceId(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeRelinkedInvoiceId(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function buildGrantsFilterHref(filters: { status: StatusFilter; decision: DecisionFilter }) {
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

function formatFilterLabel(value: StatusFilter | DecisionFilter) {
  if (value === "all") return "All";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatCurrency(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function toneForInvoiceStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (status === "submitted" || status === "approved_for_payment") return "info";
  if (status === "internal_review") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function isInvoiceOverdue(status: string, dueDate: string | null | undefined): boolean {
  if (!dueDate || status === "paid" || status === "rejected") {
    return false;
  }

  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getTime() < Date.now();
}

function formatInvoiceQueueReason(reason: string) {
  return reason.replace(/^Exact award relink is ready now:\s*/i, "");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function isClosingSoon(value: string | null | undefined) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = Date.now();
  const diffMs = parsed.getTime() - now;
  return diffMs >= 0 && diffMs <= 14 * 24 * 60 * 60 * 1000;
}

function isDecisionSoon(value: string | null | undefined) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = Date.now();
  const diffMs = parsed.getTime() - now;
  return diffMs >= 0 && diffMs <= 14 * 24 * 60 * 60 * 1000;
}

function getOpportunityPriority(opportunity: {
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

function getReimbursementPriority(status: ReturnType<typeof buildProjectFundingStackSummary>["reimbursementStatus"]) {
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

function getReimbursementActionLabel(status: ReturnType<typeof buildProjectFundingStackSummary>["reimbursementStatus"]) {
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

function resolveProjectExactBillingTriageTarget(invoices: BillingInvoiceRow[]) {
  const actionableInvoices = invoices.filter(
    (invoice) => Boolean(invoice.funding_award_id) && invoice.status !== "paid" && invoice.status !== "rejected"
  );

  if (actionableInvoices.length !== 1) {
    return null;
  }

  return actionableInvoices[0] ?? null;
}

function buildFocusedGrantsFundingNeedHref(projectId: string | null | undefined) {
  if (!projectId) {
    return "/grants#grants-funding-need-editor";
  }

  const params = new URLSearchParams({ focusProjectId: projectId });
  return `/grants?${params.toString()}#grants-funding-need-editor`;
}

function buildFocusedGrantsOpportunityCreationHref(projectId: string | null | undefined) {
  if (!projectId) {
    return "/grants#grants-opportunity-creator";
  }

  const params = new URLSearchParams({ focusProjectId: projectId });
  return `/grants?${params.toString()}#grants-opportunity-creator`;
}

function buildFocusedGrantsReimbursementHref(projectId: string | null | undefined) {
  if (!projectId) {
    return "/grants#grants-awards-reimbursement";
  }

  const params = new URLSearchParams({ focusProjectId: projectId });
  return `/grants?${params.toString()}#grants-reimbursement-composer`;
}

function buildFocusedGrantsOpportunityHref(opportunityId: string | null | undefined) {
  if (!opportunityId) {
    return "/grants";
  }

  const params = new URLSearchParams({ focusOpportunityId: opportunityId });
  return `/grants?${params.toString()}#funding-opportunity-${opportunityId}`;
}

function buildFocusedGrantsAwardConversionHref(opportunityId: string | null | undefined) {
  if (!opportunityId) {
    return "/grants#grants-award-conversion-lane";
  }

  const params = new URLSearchParams({ focusOpportunityId: opportunityId });
  return `/grants?${params.toString()}#grants-award-conversion-composer`;
}

function resolveGrantsQueueHref(
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
  if (item.key === "relink-project-invoice-awards" && item.targetProjectId && item.targetInvoiceId) {
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

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: GrantsPageSearchParams;
}) {
  const filters = await searchParams;
  const selectedStatus = normalizeStatusFilter(filters.status);
  const selectedDecision = normalizeDecisionFilter(filters.decision);
  const activeFocusedProjectId = normalizeFocusedProjectId(filters.focusProjectId);
  const activeFocusedOpportunityId = normalizeFocusedOpportunityId(filters.focusOpportunityId);
  const activeFocusedInvoiceId = normalizeFocusedInvoiceId(filters.focusInvoiceId);
  const activeRelinkedInvoiceId = normalizeRelinkedInvoiceId(filters.relinkedInvoiceId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("user_id", user.id)
    .limit(1);

  const membership = memberships?.[0] as WorkspaceMembershipRow | undefined;
  const workspace = unwrapWorkspaceRecord(membership?.workspaces);
  const canWriteInvoices = canAccessWorkspaceAction("billing.invoices.write", membership?.role);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Grants"
        title="Grants need a provisioned workspace"
        description="Funding opportunities, awards, and reimbursement posture only become meaningful when they are attached to a real OpenPlan workspace."
      />
    );
  }

  const [
    { data: opportunitiesData },
    { data: projectsData },
    { data: programsData },
    { data: fundingAwardsData },
    { data: fundingInvoicesData },
    { data: projectFundingProfilesData },
    operationsSummary,
  ] = await Promise.all([
    supabase
      .from("funding_opportunities")
      .select(
        "id, workspace_id, program_id, project_id, title, opportunity_status, decision_state, agency_name, owner_label, cadence_label, expected_award_amount, opens_at, closes_at, decision_due_at, fit_notes, readiness_notes, decision_rationale, decided_at, summary, updated_at, created_at, programs(id, title, funding_classification), projects(id, name)"
      )
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("programs")
      .select("id, title")
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("funding_awards")
      .select(
        "id, funding_opportunity_id, project_id, program_id, title, awarded_amount, match_amount, obligation_due_at, spending_status, risk_flag, notes, updated_at, created_at, funding_opportunities(id, title), programs(id, title), projects(id, name)"
      )
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("billing_invoice_records")
      .select("id, project_id, funding_award_id, invoice_number, status, due_date, amount, retention_percent, retention_amount, net_amount")
      .eq("workspace_id", membership.workspace_id)
      .order("due_date", { ascending: true }),
    supabase
      .from("project_funding_profiles")
      .select("project_id, funding_need_amount, local_match_need_amount, notes")
      .eq("workspace_id", membership.workspace_id),
    loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      membership.workspace_id
    ),
  ]);

  const projectOptions = (projectsData ?? []) as ProjectOption[];
  const programOptions = (programsData ?? []) as ProgramOption[];

  const opportunities = ((opportunitiesData ?? []) as FundingOpportunityRow[])
    .map((opportunity) => ({
      ...opportunity,
      program: normalizeJoinedRecord(opportunity.programs),
      project: normalizeJoinedRecord(opportunity.projects),
    }))
    .sort((left, right) => {
      const priorityDifference = getOpportunityPriority(left) - getOpportunityPriority(right);
      if (priorityDifference !== 0) return priorityDifference;
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });

  const fundingAwards = ((fundingAwardsData ?? []) as FundingAwardRow[]).map((award) => ({
    ...award,
    opportunity: normalizeJoinedRecord(award.funding_opportunities),
    program: normalizeJoinedRecord(award.programs),
    project: normalizeJoinedRecord(award.projects),
  }));
  const fundingInvoices = (fundingInvoicesData ?? []) as BillingInvoiceRow[];
  const projectFundingProfiles = (projectFundingProfilesData ?? []) as ProjectFundingProfileRow[];

  const fundingAwardOpportunityIds = new Set(
    fundingAwards.map((award) => award.funding_opportunity_id).filter((value): value is string => Boolean(value))
  );
  const projectFundingProfileByProjectId = new Map(projectFundingProfiles.map((profile) => [profile.project_id, profile]));
  const opportunitiesByProjectId = new Map<string, typeof opportunities>();
  const fundingAwardsByProjectId = new Map<string, typeof fundingAwards>();
  const awardLinkedInvoicesByProjectId = new Map<string, BillingInvoiceRow[]>();

  for (const opportunity of opportunities) {
    if (!opportunity.project?.id) continue;
    const current = opportunitiesByProjectId.get(opportunity.project.id) ?? [];
    current.push(opportunity);
    opportunitiesByProjectId.set(opportunity.project.id, current);
  }

  for (const award of fundingAwards) {
    const projectId = award.project?.id ?? award.project_id;
    if (!projectId) continue;
    const current = fundingAwardsByProjectId.get(projectId) ?? [];
    current.push(award);
    fundingAwardsByProjectId.set(projectId, current);
  }

  for (const invoice of fundingInvoices) {
    if (!invoice.project_id || !invoice.funding_award_id) continue;
    const current = awardLinkedInvoicesByProjectId.get(invoice.project_id) ?? [];
    current.push(invoice);
    awardLinkedInvoicesByProjectId.set(invoice.project_id, current);
  }

  const fundingProjectStacks = projectOptions
    .map((project) => {
      const awards = fundingAwardsByProjectId.get(project.id) ?? [];
      if (awards.length === 0) return null;

      const summary = buildProjectFundingStackSummary(
        projectFundingProfileByProjectId.get(project.id),
        awards,
        opportunitiesByProjectId.get(project.id) ?? [],
        awardLinkedInvoicesByProjectId.get(project.id) ?? []
      );
      const linkedInvoiceSummary = summarizeBillingInvoiceRecords(awardLinkedInvoicesByProjectId.get(project.id) ?? []);
      const nextObligationAward = awards.find((award) => award.obligation_due_at === summary.nextObligationAt) ?? null;
      const latestAwardUpdatedAt = awards.reduce<string | null>((latest, award) => {
        if (!latest) return award.updated_at;
        return new Date(award.updated_at).getTime() > new Date(latest).getTime() ? award.updated_at : latest;
      }, null);

      return {
        project,
        awards,
        summary,
        linkedInvoices: awardLinkedInvoicesByProjectId.get(project.id) ?? [],
        linkedInvoiceSummary,
        nextObligationAward,
        latestAwardUpdatedAt,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      const reimbursementDifference =
        getReimbursementPriority(left.summary.reimbursementStatus) -
        getReimbursementPriority(right.summary.reimbursementStatus);
      if (reimbursementDifference !== 0) return reimbursementDifference;
      if (left.summary.awardRiskCount !== right.summary.awardRiskCount) {
        return right.summary.awardRiskCount - left.summary.awardRiskCount;
      }
      return new Date(right.latestAwardUpdatedAt ?? 0).getTime() - new Date(left.latestAwardUpdatedAt ?? 0).getTime();
    });

  const exactBillingTriageInvoiceByProjectId = new Map(
    fundingProjectStacks
      .map((item) => {
        const invoice = resolveProjectExactBillingTriageTarget(item.linkedInvoices);
        return invoice ? [item.project.id, invoice] : null;
      })
      .filter((entry): entry is [string, BillingInvoiceRow] => Boolean(entry))
  );
  const invoiceById = new Map(fundingInvoices.map((invoice) => [invoice.id, invoice]));
  const committedAwardAmount = fundingAwards.reduce((sum, award) => sum + Number(award.awarded_amount ?? 0), 0);
  const trackedMatchAmount = fundingAwards.reduce((sum, award) => sum + Number(award.match_amount ?? 0), 0);
  const awardLinkedInvoices = fundingInvoices.filter((invoice) => Boolean(invoice.funding_award_id));
  const linkedInvoiceSummary = summarizeBillingInvoiceRecords(awardLinkedInvoices);
  const uninvoicedCommittedAmount = Math.max(committedAwardAmount - linkedInvoiceSummary.totalNetAmount, 0);
  const awardWatchCount = fundingAwards.filter((award) => award.risk_flag === "watch" || award.risk_flag === "critical").length;
  const fundingNeedAnchorProjects = projectOptions
    .map((project) => {
      const fundingProfile = projectFundingProfileByProjectId.get(project.id) ?? null;
      const fundingNeedAmount = Number(fundingProfile?.funding_need_amount ?? 0);
      const projectOpportunities = opportunitiesByProjectId.get(project.id) ?? [];
      if (projectOpportunities.length === 0) {
        return null;
      }
      if (Number.isFinite(fundingNeedAmount) && fundingNeedAmount > 0) {
        return null;
      }
      return {
        project,
        opportunityCount: projectOpportunities.length,
        localMatchNeedAmount: Number(fundingProfile?.local_match_need_amount ?? 0),
        notes: fundingProfile?.notes ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.opportunityCount - left.opportunityCount);
  const fundingSourcingProjects = projectOptions
    .map((project) => {
      const fundingProfile = projectFundingProfileByProjectId.get(project.id) ?? null;
      const fundingNeedAmount = Number(fundingProfile?.funding_need_amount ?? 0);
      if (!Number.isFinite(fundingNeedAmount) || fundingNeedAmount <= 0) {
        return null;
      }
      if ((opportunitiesByProjectId.get(project.id) ?? []).length > 0) {
        return null;
      }
      return {
        project,
        fundingNeedAmount,
        localMatchNeedAmount: Number(fundingProfile?.local_match_need_amount ?? 0),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.fundingNeedAmount - left.fundingNeedAmount);
  const reimbursementNotStartedCount = fundingProjectStacks.filter(
    (item) => item.summary.reimbursementStatus === "not_started"
  ).length;
  const reimbursementActiveCount = fundingProjectStacks.filter((item) =>
    ["drafting", "in_review", "partially_paid"].includes(item.summary.reimbursementStatus)
  ).length;
  const reimbursementPaidCount = fundingProjectStacks.filter(
    (item) => item.summary.reimbursementStatus === "paid"
  ).length;
  const leadReimbursementStack =
    fundingProjectStacks.find((item) => item.summary.reimbursementStatus === "not_started" && item.awards.length > 0) ?? null;
  const focusedReimbursementStack =
    (activeFocusedProjectId
      ? fundingProjectStacks.find(
          (item) => item.project.id === activeFocusedProjectId && item.summary.reimbursementStatus === "not_started" && item.awards.length > 0
        )
      : null) ?? null;
  const reimbursementComposerStack = focusedReimbursementStack ?? leadReimbursementStack;
  const leadFundingNeedProject = fundingNeedAnchorProjects[0] ?? null;
  const focusedFundingNeedProject =
    (activeFocusedProjectId
      ? fundingNeedAnchorProjects.find((item) => item.project.id === activeFocusedProjectId)
      : null) ?? null;
  const fundingNeedEditorProject = focusedFundingNeedProject ?? leadFundingNeedProject;
  const focusedFundingSourcingProject =
    (activeFocusedProjectId
      ? fundingSourcingProjects.find((item) => item.project.id === activeFocusedProjectId)
      : null) ?? null;
  const fundingOpportunityCreatorProject = focusedFundingSourcingProject?.project ?? null;
  const fundingAwardById = new Map(fundingAwards.map((award) => [award.id, award]));
  const fundingAwardOptions = fundingAwards.map((award) => ({
    id: award.id,
    title: award.title,
    projectId: award.project?.id ?? award.project_id ?? null,
  }));
  const fundingAwardProjectRows = fundingAwards.map((award) => ({
    id: award.id,
    project_id: award.project?.id ?? award.project_id ?? null,
    title: award.title,
  }));
  const projectNameById = new Map(projectOptions.map((project) => [project.id, project.name]));
  const reimbursementPriorityQueue = buildBillingInvoicePriorityQueue(fundingInvoices, {
    limit: 5,
    classifyRecord: (record, records) => {
      const exactMatchFundingAward = resolveExactBillingInvoiceAwardMatch(record, records, fundingAwardProjectRows);
      if (!exactMatchFundingAward) {
        return null;
      }

      const overdue = isInvoiceOverdue(record.status, record.due_date);
      const isOutstanding = ["internal_review", "submitted", "approved_for_payment"].includes(record.status);

      return {
        priorityTier: overdue ? 0.5 : isOutstanding ? 1.5 : 2.5,
        reason: overdue
          ? `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this overdue invoice is the only active unlinked reimbursement record.`
          : isOutstanding
            ? `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this invoice is the only active unlinked reimbursement record still in payment flow.`
            : `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this invoice is the only active unlinked reimbursement record.`,
        isExactRelink: true,
      };
    },
  }).filter((entry) => entry.record.status !== "paid" && entry.record.status !== "rejected");
  const exactRelinkReadyCount = fundingInvoices.filter((invoice) =>
    Boolean(resolveExactBillingInvoiceAwardMatch(invoice, fundingInvoices, fundingAwardProjectRows))
  ).length;
  const overdueLinkedInvoiceCount = awardLinkedInvoices.filter((invoice) => isInvoiceOverdue(invoice.status, invoice.due_date)).length;
  const draftLinkedInvoiceCount = awardLinkedInvoices.filter((invoice) => invoice.status === "draft").length;
  const inFlightLinkedInvoiceCount = awardLinkedInvoices.filter((invoice) =>
    ["internal_review", "submitted", "approved_for_payment"].includes(invoice.status)
  ).length;

  const filteredOpportunities = opportunities.filter((opportunity) => {
    if (selectedStatus !== "all" && opportunity.opportunity_status !== selectedStatus) {
      return false;
    }
    if (selectedDecision !== "all" && opportunity.decision_state !== selectedDecision) {
      return false;
    }
    return true;
  });

  const trackedCount = opportunities.length;
  const openCount = opportunities.filter((opportunity) => opportunity.opportunity_status === "open").length;
  const pursueCount = opportunities.filter((opportunity) => opportunity.decision_state === "pursue").length;
  const monitorCount = opportunities.filter((opportunity) => opportunity.decision_state === "monitor").length;
  const skipCount = opportunities.filter((opportunity) => opportunity.decision_state === "skip").length;
  const closingSoonCount = opportunities.filter((opportunity) => isClosingSoon(opportunity.closes_at)).length;
  const awardedCount = opportunities.filter((opportunity) => opportunity.opportunity_status === "awarded").length;
  const distinctProjectCount = new Set(opportunities.map((opportunity) => opportunity.project?.id).filter(Boolean)).size;
  const distinctProgramCount = new Set(opportunities.map((opportunity) => opportunity.program?.id).filter(Boolean)).size;
  const awardedOpportunitiesMissingRecords = opportunities.filter(
    (opportunity) => opportunity.opportunity_status === "awarded" && !fundingAwardOpportunityIds.has(opportunity.id)
  );
  const leadAwardConversionOpportunity =
    awardedOpportunitiesMissingRecords.find((opportunity) => Boolean(opportunity.project?.id)) ?? null;
  const focusedAwardConversionOpportunity =
    (activeFocusedOpportunityId
      ? awardedOpportunitiesMissingRecords.find(
          (opportunity) => opportunity.id === activeFocusedOpportunityId && Boolean(opportunity.project?.id)
        )
      : null) ?? null;
  const awardConversionOpportunity = focusedAwardConversionOpportunity ?? leadAwardConversionOpportunity;
  const grantsQueue = operationsSummary.fullCommandQueue
    .filter((item) => GRANTS_QUEUE_KEYS.has(item.key))
    .map((item) => ({
      ...item,
      href: resolveGrantsQueueHref(item, membership.workspace_id, exactBillingTriageInvoiceByProjectId, invoiceById),
    }));
  const leadGrantsCommand = grantsQueue[0] ?? null;

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Landmark className="h-3.5 w-3.5" />
            Shared grants operating lane
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Grants</h1>
            <p className="module-intro-description">
              Manage funding opportunities, pursue decisions, award posture, and reimbursement follow-through as one shared operating surface instead of scattered project notes.
            </p>
          </div>

          <div className="module-summary-grid cols-6">
            <div className="module-summary-card">
              <p className="module-summary-label">Tracked</p>
              <p className="module-summary-value">{trackedCount}</p>
              <p className="module-summary-detail">Funding opportunities visible in this workspace.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Open now</p>
              <p className="module-summary-value">{openCount}</p>
              <p className="module-summary-detail">Calls that can move immediately into packaging or decision review.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Pursue</p>
              <p className="module-summary-value">{pursueCount}</p>
              <p className="module-summary-detail">Opportunities already carrying a real pursue posture.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Closing soon</p>
              <p className="module-summary-value">{closingSoonCount}</p>
              <p className="module-summary-detail">Open opportunities whose deadline lands in the next 14 days.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Awarded</p>
              <p className="module-summary-value">{awardedCount}</p>
              <p className="module-summary-detail">Awarded opportunities that should feed awards and reimbursement truth.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked scope</p>
              <p className="module-summary-value">{distinctProjectCount + distinctProgramCount}</p>
              <p className="module-summary-detail">{distinctProjectCount} projects and {distinctProgramCount} programs currently linked.</p>
            </div>
          </div>

          <div className="module-inline-list">
            <span className="module-inline-item"><strong>{monitorCount}</strong> monitor</span>
            <span className="module-inline-item"><strong>{skipCount}</strong> skip</span>
            <span className="module-inline-item"><strong>{operationsSummary.counts.projectFundingDecisionProjects}</strong> decision gap projects</span>
            <span className="module-inline-item"><strong>{operationsSummary.counts.projectFundingAwardRecordProjects}</strong> award records missing</span>
            <span className="module-inline-item"><strong>{fundingAwards.length}</strong> award records recorded</span>
            <span className="module-inline-item"><strong>{operationsSummary.counts.projectFundingReimbursementStartProjects + operationsSummary.counts.projectFundingReimbursementActiveProjects}</strong> reimbursement follow-through</span>
            <span className="module-inline-item"><strong>{operationsSummary.counts.projectFundingGapProjects}</strong> funding gap projects</span>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Grants OS</p>
              <h2 className="module-operator-title">Keep grant posture connected to project and RTP truth</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            OpenPlan already knows funding need anchors, opportunities, awards, and reimbursement state. This page turns those records into one workspace lane planners can actually run.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Use one opportunity registry instead of re-entering grant posture across projects and programs.</div>
            <div className="module-operator-item">Move opportunities from monitor to pursue with explicit fit, readiness, and rationale notes.</div>
            <div className="module-operator-item">Treat awarded dollars and reimbursement follow-through as operational truth, not afterthoughts.</div>
          </div>
          <div className="mt-4">
            <WorkspaceRuntimeCue summary={operationsSummary} className="border-white/10 bg-white/[0.06] text-emerald-50/82" />
          </div>
          {leadGrantsCommand ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-emerald-50/82">
              <p className="font-semibold text-emerald-50">Lead workspace grant command</p>
              <p className="mt-1">{leadGrantsCommand.detail}</p>
              <Link href={leadGrantsCommand.href} className="mt-3 inline-flex items-center gap-2 font-semibold text-emerald-100 transition hover:text-white">
                Open next grants action
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : null}
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          {fundingNeedEditorProject ? (
            <div
              id="grants-funding-need-editor"
              className={activeFocusedProjectId === fundingNeedEditorProject.project.id ? "scroll-mt-24 rounded-[1.7rem] ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]" : "scroll-mt-24"}
            >
              <article className="module-section-surface">
                <div className="module-section-header">
                  <div className="module-section-heading">
                    <p className="module-section-label">Funding need anchor</p>
                    <h2 className="module-section-title">{`Anchor funding need for ${fundingNeedEditorProject.project.name}`}</h2>
                    <p className="module-section-description">
                      Record the target funding need and local match so grant sourcing, gap review, and award coverage can run against honest project math.
                    </p>
                  </div>
                  <StatusBadge tone="warning">{fundingNeedAnchorProjects.length} missing anchor{fundingNeedAnchorProjects.length === 1 ? "" : "s"}</StatusBadge>
                </div>
                <ProjectFundingProfileEditor
                  projectId={fundingNeedEditorProject.project.id}
                  initialFundingNeedAmount={null}
                  initialLocalMatchNeedAmount={fundingNeedEditorProject.localMatchNeedAmount}
                  initialNotes={fundingNeedEditorProject.notes}
                />
                {activeFocusedProjectId === fundingNeedEditorProject.project.id ? (
                  <div className="mt-3 rounded-2xl border border-sky-400/35 bg-sky-400/10 px-4 py-3 text-sm text-sky-950 dark:text-sky-100">
                    <p className="font-semibold">Focused from workspace queue</p>
                    <p className="mt-1">
                      {fundingNeedEditorProject.project.name} already has linked opportunities but still needs a recorded funding-need anchor before gap and award posture can be trusted.
                    </p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-sky-700/80 dark:text-sky-200/80">
                      {fundingNeedEditorProject.opportunityCount} linked opportunit{fundingNeedEditorProject.opportunityCount === 1 ? "y" : "ies"}
                      {fundingNeedEditorProject.localMatchNeedAmount > 0
                        ? ` · Local match ${formatCurrency(fundingNeedEditorProject.localMatchNeedAmount)}`
                        : ""}
                    </p>
                  </div>
                ) : null}
              </article>
            </div>
          ) : null}

          <div
            id="grants-opportunity-creator"
            className={activeFocusedProjectId === fundingOpportunityCreatorProject?.id ? "scroll-mt-24 rounded-[1.7rem] ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]" : "scroll-mt-24"}
          >
            <FundingOpportunityCreator
              programs={programOptions}
              projects={projectOptions}
              defaultProjectId={fundingOpportunityCreatorProject?.id ?? null}
              title={fundingOpportunityCreatorProject ? `Source a funding opportunity for ${fundingOpportunityCreatorProject.name}` : "Log a funding opportunity"}
              description={
                fundingOpportunityCreatorProject
                  ? `Focused from the workspace queue so you can source candidate grants for ${fundingOpportunityCreatorProject.name} without leaving the shared grants lane.`
                  : "Create a shared grant record tied to a project or program so pursue, monitor, skip, award, and reimbursement work all point back to the same workspace truth."
              }
            />
            {activeFocusedProjectId === fundingOpportunityCreatorProject?.id ? (
              <div className="mt-3 rounded-2xl border border-sky-400/35 bg-sky-400/10 px-4 py-3 text-sm text-sky-950 dark:text-sky-100">
                <p className="font-semibold">Focused from workspace queue</p>
                <p className="mt-1">
                  {fundingOpportunityCreatorProject.name} still needs sourced opportunities. Start with the highest-fit grant record here so pursue, award, and reimbursement work can stay on the shared grants spine.
                </p>
                {focusedFundingSourcingProject ? (
                  <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-sky-700/80 dark:text-sky-200/80">
                    Funding need {formatCurrency(focusedFundingSourcingProject.fundingNeedAmount)}
                    {focusedFundingSourcingProject.localMatchNeedAmount > 0
                      ? ` · Local match ${formatCurrency(focusedFundingSourcingProject.localMatchNeedAmount)}`
                      : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <article id="grants-reimbursement-triage" className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Reimbursement triage</p>
                <h2 className="module-section-title">Workspace reimbursement follow-through queue</h2>
                <p className="module-section-description">
                  Keep award-linked invoices moving. This queue surfaces overdue reimbursement risk, in-flight payment posture, and draft packets that still need operator follow-through.
                </p>
              </div>
              <StatusBadge tone={reimbursementPriorityQueue.length > 0 ? "warning" : "success"}>
                {reimbursementPriorityQueue.length > 0 ? `${reimbursementPriorityQueue.length} active follow-ups` : "Queue clear"}
              </StatusBadge>
            </div>

            <div className="module-summary-grid cols-5 mt-5">
              <div className="module-summary-card">
                <p className="module-summary-label">Award-linked records</p>
                <p className="module-summary-value">{awardLinkedInvoices.length}</p>
                <p className="module-summary-detail">Invoice records already tied to committed awards.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Overdue</p>
                <p className="module-summary-value">{overdueLinkedInvoiceCount}</p>
                <p className="module-summary-detail">Linked reimbursement records already past due.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Drafting</p>
                <p className="module-summary-value">{draftLinkedInvoiceCount}</p>
                <p className="module-summary-detail">Started, but not yet in review or payment flow.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">In flight</p>
                <p className="module-summary-value">{inFlightLinkedInvoiceCount}</p>
                <p className="module-summary-detail">Internal review, submitted, or approved for payment.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Exact relink ready</p>
                <p className="module-summary-value">{exactRelinkReadyCount}</p>
                <p className="module-summary-detail">Unlinked invoice records with a single exact funding-award match.</p>
              </div>
            </div>

            {reimbursementPriorityQueue.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  title="No reimbursement triage items right now"
                  description="Once award-linked invoice records exist and need follow-through, this queue will surface the most urgent reimbursement work across the workspace."
                />
              </div>
            ) : (
              <div className="mt-5 module-record-list">
                {reimbursementPriorityQueue.map((entry) => {
                  const invoice = entry.record;
                  const award = invoice.funding_award_id ? fundingAwardById.get(invoice.funding_award_id) ?? null : null;
                  const projectName = invoice.project_id ? projectNameById.get(invoice.project_id) ?? null : null;
                  const overdue = isInvoiceOverdue(invoice.status, invoice.due_date);
                  const exactMatchFundingAward = resolveExactBillingInvoiceAwardMatch(invoice, fundingInvoices, fundingAwardProjectRows);
                  const isFocusedRow = activeFocusedInvoiceId === invoice.id;
                  const isJustRelinkedRow = activeRelinkedInvoiceId === invoice.id;
                  const triageHref = buildBillingInvoiceTriageHref({
                    workspaceId: membership.workspace_id,
                    invoiceId: invoice.id,
                    linkage: invoice.funding_award_id ? "linked" : "unlinked",
                    overdue: overdue ? "overdue" : "all",
                    projectId: invoice.project_id,
                    relinkedInvoiceId: isJustRelinkedRow ? invoice.id : null,
                  });

                  return (
                    <div
                      id={`invoice-record-${invoice.id}`}
                      key={`reimbursement-queue-${invoice.id}`}
                      className={`module-record-row scroll-mt-24 ${isFocusedRow ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]" : ""}`}
                    >
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleize(invoice.status)}</StatusBadge>
                          {overdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : null}
                          {entry.isExactRelink ? <StatusBadge tone="success">Exact relink ready</StatusBadge> : null}
                          {award ? <StatusBadge tone="info">{award.title}</StatusBadge> : null}
                          {isFocusedRow ? <StatusBadge tone="info">Focused from triage</StatusBadge> : null}
                          {isJustRelinkedRow ? <StatusBadge tone="success">Relink just saved</StatusBadge> : null}
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <h3 className="module-record-title">{invoice.invoice_number ?? "Draft reimbursement record"}</h3>
                            <p className="module-record-stamp">{formatCurrency(invoice.net_amount ?? invoice.amount)}</p>
                          </div>
                          <p className="module-record-summary">{formatInvoiceQueueReason(entry.reason)}</p>
                        </div>

                        {isJustRelinkedRow && award ? (
                          <div className="mt-3 border-l-2 border-emerald-300/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-700/60 dark:bg-emerald-950/25 dark:text-emerald-100">
                            <p className="font-semibold tracking-tight">Relink saved in this grants queue</p>
                            <p className="mt-1">This reimbursement record now contributes to workspace award posture through {award.title}.</p>
                          </div>
                        ) : null}

                        <div className="module-record-meta">
                          <span className="module-record-chip">Project {projectName ?? "Not linked"}</span>
                          <span className="module-record-chip">Award {award?.title ?? exactMatchFundingAward?.title ?? "Not linked"}</span>
                          <span className="module-record-chip">Due {formatDateTime(invoice.due_date)}</span>
                          <span className="module-record-chip">Net {formatCurrency(invoice.net_amount ?? invoice.amount)}</span>
                        </div>

                        <div className="mt-4 flex flex-wrap items-start gap-3 text-sm font-semibold">
                          {invoice.project_id && invoiceNeedsAwardRelink(invoice.status, invoice.funding_award_id) ? (
                            <div className="min-w-[280px] flex-1">
                              <InvoiceFundingAwardLinker
                                invoiceId={invoice.id}
                                workspaceId={membership.workspace_id}
                                projectId={invoice.project_id}
                                currentFundingAwardId={invoice.funding_award_id}
                                exactMatchFundingAwardId={exactMatchFundingAward?.id ?? null}
                                autoSelectExactMatch={isFocusedRow}
                                fundingAwards={fundingAwardOptions}
                                canWrite={canWriteInvoices}
                              />
                            </div>
                          ) : (
                            <InvoiceStatusAdvanceButton
                              invoiceId={invoice.id}
                              workspaceId={membership.workspace_id}
                              currentStatus={invoice.status}
                              canWrite={canWriteInvoices}
                            />
                          )}
                          <Link href={triageHref} className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
                            Open billing triage
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                          <BillingTriageLinkCopy href={triageHref} />
                          {invoice.project_id ? (
                            <Link href={`/projects/${invoice.project_id}#project-funding-opportunities`} className="inline-flex items-center gap-2 text-muted-foreground transition hover:text-foreground">
                              Open funding lane
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Workspace queue</p>
                <h2 className="module-section-title">What should move next on the grants lane</h2>
                <p className="module-section-description">
                  These commands come from the same workspace runtime already feeding the assistant and RTP surfaces, but filtered here to the grants operating lane.
                </p>
              </div>
              <StatusBadge tone={grantsQueue.length > 0 ? "warning" : "success"}>
                {grantsQueue.length > 0 ? `${grantsQueue.length} queued` : "Queue clear"}
              </StatusBadge>
            </div>

            <div className="mt-5 grid gap-3">
              {grantsQueue.length > 0 ? (
                grantsQueue.map((item) => (
                  <Link key={item.key} href={item.href} className="module-subpanel block transition-colors hover:border-primary/35">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{item.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                      </div>
                      <StatusBadge tone={item.tone}>{item.tone === "warning" ? "Next" : "Queue"}</StatusBadge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.badges.map((badge) => (
                        <StatusBadge key={`${item.key}-${badge.label}`} tone="neutral">
                          {badge.label}
                          {badge.value !== null && badge.value !== undefined ? `: ${badge.value}` : ""}
                        </StatusBadge>
                      ))}
                    </div>
                  </Link>
                ))
              ) : (
                <div className="module-subpanel text-sm text-muted-foreground">
                  No immediate grants-specific queue pressure is visible from the current workspace snapshot.
                </div>
              )}
            </div>
          </article>

          <article id="grants-award-conversion-lane" className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Award conversion</p>
                <h2 className="module-section-title">Awarded opportunities still missing committed award records</h2>
                <p className="module-section-description">
                  This is the downstream grants seam that closes the gap between an opportunity marked awarded and the actual award record needed for reimbursement and invoice truth.
                </p>
              </div>
              <StatusBadge tone={awardedOpportunitiesMissingRecords.length > 0 ? "warning" : "success"}>
                {awardedOpportunitiesMissingRecords.length > 0 ? `${awardedOpportunitiesMissingRecords.length} missing` : "Award records current"}
              </StatusBadge>
            </div>

            {awardConversionOpportunity ? (
              <div
                id="grants-award-conversion-composer"
                className={`mt-5 scroll-mt-24 rounded-3xl ${
                  activeFocusedOpportunityId === awardConversionOpportunity.id
                    ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
                    : ""
                }`}
              >
                {activeFocusedOpportunityId === awardConversionOpportunity.id ? (
                  <div className="mb-3 rounded-2xl border border-sky-300/70 bg-sky-50/80 px-4 py-3 text-sm text-sky-950 dark:border-sky-700/60 dark:bg-sky-950/25 dark:text-sky-100">
                    <p className="font-semibold tracking-tight">Focused from workspace queue</p>
                    <p className="mt-1">This award conversion creator is pre-targeted to {awardConversionOpportunity.title} so the grants command board can record the exact committed award it flagged next.</p>
                  </div>
                ) : null}
                <ProjectFundingAwardCreator
                  projectId={awardConversionOpportunity.project?.id ?? ""}
                  opportunityOptions={[{ id: awardConversionOpportunity.id, title: awardConversionOpportunity.title }]}
                  defaultOpportunityId={awardConversionOpportunity.id}
                  defaultProgramId={awardConversionOpportunity.program?.id ?? null}
                  defaultTitle={`${awardConversionOpportunity.title} award`}
                  titleLabel="Create the lead award record now"
                  description={`Convert ${awardConversionOpportunity.title} into a committed award record here so reimbursement and invoice truth can start from the shared grants lane.`}
                />
              </div>
            ) : null}

            <div className="mt-5 grid gap-3">
              {awardedOpportunitiesMissingRecords.length > 0 ? (
                awardedOpportunitiesMissingRecords.map((opportunity) => {
                  const projectHref = opportunity.project ? `/projects/${opportunity.project.id}#project-funding-opportunities` : null;
                  const programHref = opportunity.program ? `/programs/${opportunity.program.id}#program-funding-opportunities` : null;

                  return (
                    <div
                      key={`award-gap-${opportunity.id}`}
                      id={`award-opportunity-${opportunity.id}`}
                      className={`module-subpanel scroll-mt-24 ${
                        activeFocusedOpportunityId === opportunity.id
                          ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
                          : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <StatusBadge tone="warning">Award record missing</StatusBadge>
                            {activeFocusedOpportunityId === opportunity.id ? <StatusBadge tone="info">Focused from workspace queue</StatusBadge> : null}
                            {opportunity.project ? <StatusBadge tone="info">{opportunity.project.name}</StatusBadge> : null}
                            {opportunity.program ? <StatusBadge tone="info">{opportunity.program.title}</StatusBadge> : null}
                          </div>
                          <h3 className="mt-3 text-base font-semibold text-foreground">{opportunity.title}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {opportunity.summary || "This opportunity is marked awarded, but the committed award record has not been logged yet."}
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-semibold text-foreground">{formatCurrency(opportunity.expected_award_amount)}</p>
                          <p className="text-muted-foreground">Likely award</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <span className="module-inline-item">Updated {formatDateTime(opportunity.updated_at)}</span>
                        <span className="module-inline-item">Decision {formatFundingOpportunityDecisionLabel(opportunity.decision_state)}</span>
                        <span className="module-inline-item">Agency {opportunity.agency_name ?? "Not set"}</span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
                        {projectHref ? (
                          <Link href={projectHref} className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
                            Open project award lane
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        ) : null}
                        {programHref ? (
                          <Link href={programHref} className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
                            Open program funding lane
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        ) : null}
                        {!projectHref ? (
                          <span className="text-muted-foreground">
                            Link this opportunity to a project before recording the committed award.
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="module-subpanel text-sm text-muted-foreground">
                  No awarded opportunities are currently missing committed award records in this workspace.
                </div>
              )}
            </div>
          </article>

          <article id="grants-awards-reimbursement" className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Committed awards</p>
                <h2 className="module-section-title">Workspace award stack and reimbursement posture</h2>
                <p className="module-section-description">
                  Reuse the same funding-stack truth from project detail, but surface it here as one workspace lane so operators can see where award dollars are still uninvoiced, in flight, or fully reimbursed.
                </p>
              </div>
              <StatusBadge tone={fundingProjectStacks.length > 0 ? "info" : "neutral"}>
                {fundingProjectStacks.length > 0 ? `${fundingProjectStacks.length} project stacks` : "No award stacks yet"}
              </StatusBadge>
            </div>

            <div className="module-summary-grid cols-6 mt-5">
              <div className="module-summary-card">
                <p className="module-summary-label">Award records</p>
                <p className="module-summary-value">{fundingAwards.length}</p>
                <p className="module-summary-detail">Committed awards recorded in the current workspace.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Committed dollars</p>
                <p className="module-summary-value text-base leading-tight">{formatCurrency(committedAwardAmount)}</p>
                <p className="module-summary-detail">Awarded funding already committed to projects.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Match tracked</p>
                <p className="module-summary-value text-base leading-tight">{formatCurrency(trackedMatchAmount)}</p>
                <p className="module-summary-detail">Local or partner match attached to committed awards.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Requested</p>
                <p className="module-summary-value text-base leading-tight">{formatCurrency(linkedInvoiceSummary.totalNetAmount)}</p>
                <p className="module-summary-detail">Award-linked invoice dollars already in reimbursement flow.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Uninvoiced</p>
                <p className="module-summary-value text-base leading-tight">{formatCurrency(uninvoicedCommittedAmount)}</p>
                <p className="module-summary-detail">Committed award dollars not yet reflected in invoice records.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Award risk</p>
                <p className="module-summary-value">{awardWatchCount}</p>
                <p className="module-summary-detail">Award records currently flagged watch or critical.</p>
              </div>
            </div>

            <div className="module-inline-list">
              <span className="module-inline-item"><strong>{reimbursementNotStartedCount}</strong> not started</span>
              <span className="module-inline-item"><strong>{reimbursementActiveCount}</strong> active reimbursement</span>
              <span className="module-inline-item"><strong>{reimbursementPaidCount}</strong> fully reimbursed</span>
              <span className="module-inline-item"><strong>{formatCurrency(linkedInvoiceSummary.paidNetAmount)}</strong> paid</span>
              <span className="module-inline-item"><strong>{formatCurrency(linkedInvoiceSummary.outstandingNetAmount)}</strong> outstanding</span>
            </div>

            {fundingProjectStacks.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  title="No committed award stacks yet"
                  description="Once award records exist, this workspace lane will show which project stacks still need reimbursement starts, invoice follow-through, or obligation attention."
                />
              </div>
            ) : (
              <>
                {reimbursementComposerStack ? (
                  <div
                    id="grants-reimbursement-composer"
                    className={`mt-5 scroll-mt-24 rounded-3xl ${
                      activeFocusedProjectId === reimbursementComposerStack.project.id
                        ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
                        : ""
                    }`}
                  >
                    {activeFocusedProjectId === reimbursementComposerStack.project.id ? (
                      <div className="mb-3 rounded-2xl border border-sky-300/70 bg-sky-50/80 px-4 py-3 text-sm text-sky-950 dark:border-sky-700/60 dark:bg-sky-950/25 dark:text-sky-100">
                        <p className="font-semibold tracking-tight">Focused from workspace queue</p>
                        <p className="mt-1">This reimbursement composer is pre-targeted to {reimbursementComposerStack.project.name} so the grants command board can start the exact packet it flagged next.</p>
                      </div>
                    ) : null}
                    <InvoiceRecordComposer
                      workspaceId={membership.workspace_id}
                      projects={[reimbursementComposerStack.project]}
                      fundingAwards={reimbursementComposerStack.awards.map((award) => ({
                        id: award.id,
                        title: award.title,
                        projectId: reimbursementComposerStack.project.id,
                      }))}
                      canWrite={canWriteInvoices}
                      defaultProjectId={reimbursementComposerStack.project.id}
                      defaultFundingAwardId={reimbursementComposerStack.nextObligationAward?.id ?? reimbursementComposerStack.awards[0]?.id ?? null}
                      defaultInvoiceNumber={`${reimbursementComposerStack.project.name.replace(/\s+/g, " ").trim().slice(0, 32)} reimbursement`}
                      defaultAmount={
                        reimbursementComposerStack.summary.uninvoicedAwardAmount > 0
                          ? String(reimbursementComposerStack.summary.uninvoicedAwardAmount)
                          : undefined
                      }
                      titleLabel="Start the lead reimbursement record now"
                      description="Seed the first award-linked invoice directly from /grants so reimbursement work starts in the shared workspace lane before deeper billing follow-through moves into project detail."
                    />
                  </div>
                ) : null}

                <div className="mt-5 module-record-list">
                {fundingProjectStacks.map((item) => {
                  const exactBillingTriageInvoice = resolveProjectExactBillingTriageTarget(item.linkedInvoices);
                  const exactBillingTriageHref = exactBillingTriageInvoice
                    ? buildBillingInvoiceTriageHref({
                        workspaceId: membership.workspace_id,
                        invoiceId: exactBillingTriageInvoice.id,
                        linkage: "linked",
                        overdue: isInvoiceOverdue(exactBillingTriageInvoice.status, exactBillingTriageInvoice.due_date) ? "overdue" : "all",
                        projectId: item.project.id,
                      })
                    : null;

                  return (
                  <div
                    key={`award-stack-${item.project.id}`}
                    id={`award-stack-${item.project.id}`}
                    className={`module-record-row scroll-mt-24 ${
                      activeFocusedProjectId === item.project.id
                        ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
                        : ""
                    }`}
                  >
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={projectFundingReimbursementTone(item.summary.reimbursementStatus)}>
                          {item.summary.reimbursementLabel}
                        </StatusBadge>
                        {activeFocusedProjectId === item.project.id ? <StatusBadge tone="info">Focused from workspace queue</StatusBadge> : null}
                        <StatusBadge tone="info">{item.awards.length} award{item.awards.length === 1 ? "" : "s"}</StatusBadge>
                        {item.summary.awardRiskCount > 0 ? (
                          <StatusBadge tone="warning">{item.summary.awardRiskCount} at risk</StatusBadge>
                        ) : null}
                        {item.summary.nextObligationAt && isDecisionSoon(item.summary.nextObligationAt) ? (
                          <StatusBadge tone="warning">Obligation soon</StatusBadge>
                        ) : null}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{item.project.name}</h3>
                          <p className="module-record-stamp">Updated {formatDateTime(item.latestAwardUpdatedAt)}</p>
                        </div>
                        <p className="module-record-summary">{item.summary.reimbursementReason}</p>
                      </div>

                      <div className="module-record-meta">
                        <span className="module-record-chip">Committed {formatCurrency(item.summary.committedFundingAmount)}</span>
                        <span className="module-record-chip">Match {formatCurrency(item.summary.committedMatchAmount)}</span>
                        <span className="module-record-chip">Requested {formatCurrency(item.summary.requestedReimbursementAmount)}</span>
                        <span className="module-record-chip">Paid {formatCurrency(item.summary.paidReimbursementAmount)}</span>
                        <span className="module-record-chip">Outstanding {formatCurrency(item.summary.outstandingReimbursementAmount)}</span>
                        <span className="module-record-chip">Uninvoiced {formatCurrency(item.summary.uninvoicedAwardAmount)}</span>
                        <span className="module-record-chip">Next obligation {item.nextObligationAward ? `${item.nextObligationAward.title} · ${formatDateTime(item.summary.nextObligationAt)}` : "Not set"}</span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
                        <Link
                          href={exactBillingTriageHref ?? `/projects/${item.project.id}#project-invoices`}
                          className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
                        >
                          {exactBillingTriageHref
                            ? `${getReimbursementActionLabel(item.summary.reimbursementStatus)} in billing triage`
                            : getReimbursementActionLabel(item.summary.reimbursementStatus)}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                        {exactBillingTriageHref ? <BillingTriageLinkCopy href={exactBillingTriageHref} /> : null}
                        <Link href={`/projects/${item.project.id}#project-funding-opportunities`} className="inline-flex items-center gap-2 text-muted-foreground transition hover:text-foreground">
                          Open project funding lane
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  </div>
                );})}
                </div>
              </>
            )}
          </article>
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
                <CalendarClock className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Registry</p>
                <h2 className="module-section-title">Funding opportunities across the workspace</h2>
                <p className="module-section-description">
                  Review deadlines, decision posture, linked project/program context, and editable decision notes without hopping record-by-record first.
                </p>
              </div>
            </div>
            <span className="module-inline-item">
              <Sparkles className="h-3.5 w-3.5" />
              <strong>{filteredOpportunities.length}</strong> shown
            </span>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((status) => {
                const active = status === selectedStatus;
                return (
                  <Link
                    key={`status-${status}`}
                    href={buildGrantsFilterHref({ status, decision: selectedDecision })}
                    className={[
                      "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                      active
                        ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-[color:var(--pine-deep)]"
                        : "border-border/70 bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
                    ].join(" ")}
                  >
                    Status: {formatFilterLabel(status)}
                  </Link>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {DECISION_FILTERS.map((decision) => {
                const active = decision === selectedDecision;
                return (
                  <Link
                    key={`decision-${decision}`}
                    href={buildGrantsFilterHref({ status: selectedStatus, decision })}
                    className={[
                      "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                      active
                        ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-[color:var(--pine-deep)]"
                        : "border-border/70 bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
                    ].join(" ")}
                  >
                    Decision: {formatFilterLabel(decision)}
                  </Link>
                );
              })}
            </div>
          </div>

          {opportunities.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No funding opportunities yet"
                description="Create the first funding opportunity so OpenPlan can start carrying real pursue, monitor, skip, award, and reimbursement posture in the shared workspace lane."
              />
            </div>
          ) : filteredOpportunities.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No opportunities match these filters"
                description="Try a broader status or decision filter to bring the workspace grants registry back into view."
              />
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {filteredOpportunities.map((opportunity) => {
                const projectHref = opportunity.project ? `/projects/${opportunity.project.id}#project-funding-opportunities` : null;
                const programHref = opportunity.program ? `/programs/${opportunity.program.id}#program-funding-opportunities` : null;
                const closesSoon = isClosingSoon(opportunity.closes_at);
                const decisionSoon = isDecisionSoon(opportunity.decision_due_at);

                return (
                  <div
                    key={opportunity.id}
                    id={`funding-opportunity-${opportunity.id}`}
                    className={`module-record-row scroll-mt-24 ${
                      activeFocusedOpportunityId === opportunity.id && opportunity.opportunity_status !== "awarded"
                        ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
                        : ""
                    }`}
                  >
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={fundingOpportunityStatusTone(opportunity.opportunity_status)}>
                          {formatFundingOpportunityStatusLabel(opportunity.opportunity_status)}
                        </StatusBadge>
                        <StatusBadge tone={fundingOpportunityDecisionTone(opportunity.decision_state)}>
                          {formatFundingOpportunityDecisionLabel(opportunity.decision_state)}
                        </StatusBadge>
                        {activeFocusedOpportunityId === opportunity.id && opportunity.opportunity_status !== "awarded" ? <StatusBadge tone="info">Focused from workspace queue</StatusBadge> : null}
                        {closesSoon ? <StatusBadge tone="warning">Closing soon</StatusBadge> : null}
                        {decisionSoon ? <StatusBadge tone="warning">Decision due soon</StatusBadge> : null}
                        {opportunity.program ? <StatusBadge tone="info">{opportunity.program.title}</StatusBadge> : null}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{opportunity.title}</h3>
                          <p className="module-record-stamp">Updated {formatDateTime(opportunity.updated_at)}</p>
                        </div>
                        <p className="module-record-summary">
                          {opportunity.summary || "No summary recorded yet for this funding opportunity."}
                        </p>
                      </div>

                      <div className="module-record-meta">
                        <span className="module-record-chip">Agency {opportunity.agency_name ?? "Not set"}</span>
                        <span className="module-record-chip">Owner {opportunity.owner_label ?? "Unassigned"}</span>
                        <span className="module-record-chip">Cadence {opportunity.cadence_label ?? "Not set"}</span>
                        <span className="module-record-chip">Likely {formatCurrency(opportunity.expected_award_amount)}</span>
                        <span className="module-record-chip">Opens {formatDateTime(opportunity.opens_at)}</span>
                        <span className="module-record-chip">Closes {formatDateTime(opportunity.closes_at)}</span>
                        <span className="module-record-chip">Decision due {formatDateTime(opportunity.decision_due_at)}</span>
                        <span className="module-record-chip">Project {opportunity.project?.name ?? "Not linked"}</span>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Fit notes</p>
                          <p className="mt-2">{opportunity.fit_notes || "No fit notes recorded yet."}</p>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Readiness notes</p>
                          <p className="mt-2">{opportunity.readiness_notes || "No readiness notes recorded yet."}</p>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Decision rationale</p>
                          <p className="mt-2">{opportunity.decision_rationale || "No decision rationale recorded yet."}</p>
                        </div>
                      </div>

                      {(projectHref || programHref) ? (
                        <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
                          {projectHref ? (
                            <Link href={projectHref} className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
                              Open project funding lane
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          ) : null}
                          {programHref ? (
                            <Link href={programHref} className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
                              Open program funding lane
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-4">
                        <FundingOpportunityDecisionControls
                          opportunityId={opportunity.id}
                          initialDecisionState={opportunity.decision_state}
                          initialExpectedAwardAmount={opportunity.expected_award_amount}
                          initialFitNotes={opportunity.fit_notes}
                          initialReadinessNotes={opportunity.readiness_notes}
                          initialDecisionRationale={opportunity.decision_rationale}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
