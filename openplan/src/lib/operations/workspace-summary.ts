import { computeNetInvoiceAmount } from "@/lib/billing/invoice-records";
import { buildPlanReadiness } from "@/lib/plans/catalog";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";
import {
  describeComparisonSnapshotAggregate,
  getReportNavigationHref,
  getReportPacketFreshness,
  parseStoredComparisonSnapshotAggregate,
} from "@/lib/reports/catalog";
import type { StatusTone } from "@/lib/ui/status";

type WorkspaceOperationsPostEqChain = {
  order: (column: string, options: { ascending: boolean }) => {
    limit: (count: number) => PromiseLike<{ data: unknown[] | null }>;
  };
  limit: (count: number) => PromiseLike<{ data: unknown[] | null }>;
};

type WorkspaceOperationsSelectChain = {
  eq: (column: string, value: string) => WorkspaceOperationsPostEqChain;
};

export type WorkspaceOperationsSupabaseLike = {
  from: (table: string) => {
    select: (query: string) => WorkspaceOperationsSelectChain;
  };
};

export type WorkspaceOperationsProjectRow = {
  id: string;
  name: string;
  status: string | null;
  deliveryPhase: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsPlanRow = {
  id: string;
  title: string;
  status: string | null;
  geographyLabel: string | null;
  horizonYear: number | null;
  projectId: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsProgramRow = {
  id: string;
  title: string;
  status: string | null;
  nominationDueAt: string | null;
  adoptionTargetAt: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsFundingOpportunityRow = {
  id: string;
  title: string;
  opportunityStatus: string | null;
  decisionState?: string | null;
  expectedAwardAmount?: number | string | null;
  closesAt: string | null;
  decisionDueAt: string | null;
  programId: string | null;
  projectId?: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsFundingAwardRow = {
  id: string;
  projectId: string;
  fundingOpportunityId: string | null;
  title: string;
  awardedAmount: number | string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsBillingInvoiceRow = {
  id: string;
  projectId: string;
  fundingAwardId: string | null;
  status: string | null;
  amount: number | string | null;
  retentionPercent: number | string | null;
  retentionAmount: number | string | null;
  dueDate: string | null;
};

export type WorkspaceOperationsProjectSubmittalRow = {
  id: string;
  projectId: string;
  submittalType: string | null;
  status: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsReportRow = {
  id: string;
  title: string | null;
  status: string | null;
  latestArtifactKind: string | null;
  generatedAt: string | null;
  updatedAt: string | null;
  metadataJson: Record<string, unknown> | null;
};

export type WorkspaceOperationsProjectSourceRow = {
  id: string;
  name: string;
  status: string | null;
  delivery_phase: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsPlanSourceRow = {
  id: string;
  title: string;
  status: string | null;
  geography_label: string | null;
  horizon_year: number | null;
  project_id: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsProgramSourceRow = {
  id: string;
  title: string;
  status: string | null;
  nomination_due_at: string | null;
  adoption_target_at: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsFundingOpportunitySourceRow = {
  id: string;
  title: string;
  opportunity_status: string | null;
  decision_state?: string | null;
  expected_award_amount?: number | string | null;
  closes_at: string | null;
  decision_due_at: string | null;
  program_id: string | null;
  project_id?: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsFundingAwardSourceRow = {
  id: string;
  project_id: string;
  funding_opportunity_id: string | null;
  title: string;
  awarded_amount: number | string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsBillingInvoiceSourceRow = {
  id: string;
  project_id: string;
  funding_award_id: string | null;
  status: string | null;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  due_date: string | null;
};

export type WorkspaceOperationsProjectSubmittalSourceRow = {
  id: string;
  project_id: string;
  submittal_type: string | null;
  status: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsReportSourceRow = {
  id: string;
  title: string | null;
  status: string | null;
  latest_artifact_kind: string | null;
  generated_at: string | null;
  updated_at: string | null;
  metadata_json: Record<string, unknown> | null;
};

export type WorkspaceCommandQueueItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  targetProjectId?: string | null;
  targetProjectName?: string | null;
  targetOpportunityId?: string | null;
  targetInvoiceId?: string | null;
  targetFundingAwardId?: string | null;
  tone: StatusTone;
  priority: number;
  badges: Array<{
    label: string;
    value?: string | number | null;
  }>;
};

export type WorkspaceOperationsProjectFundingProfileSourceRow = {
  project_id: string;
  funding_need_amount: number | string | null;
  local_match_need_amount?: number | string | null;
};

export type WorkspaceOperationsSummary = {
  posture: "stable" | "active" | "attention";
  headline: string;
  detail: string;
  counts: {
    projects: number;
    activeProjects: number;
    plans: number;
    plansNeedingSetup: number;
    programs: number;
    activePrograms: number;
    reports: number;
    reportRefreshRecommended: number;
    reportNoPacket: number;
    reportPacketCurrent: number;
    comparisonBackedReports: number;
    fundingOpportunities: number;
    openFundingOpportunities: number;
    closingSoonFundingOpportunities: number;
    projectFundingNeedAnchorProjects: number;
    projectFundingSourcingProjects: number;
    projectFundingDecisionProjects: number;
    projectFundingAwardRecordProjects: number;
    projectFundingReimbursementStartProjects: number;
    projectFundingReimbursementActiveProjects: number;
    projectFundingGapProjects: number;
    queueDepth: number;
  };
  nextCommand: WorkspaceCommandQueueItem | null;
  commandQueue: WorkspaceCommandQueueItem[];
  fullCommandQueue: WorkspaceCommandQueueItem[];
};

function daysUntil(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed - now.getTime()) / 86400000);
}

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function mapWorkspaceOperationsProjectRows(
  rows: WorkspaceOperationsProjectSourceRow[]
): WorkspaceOperationsProjectRow[] {
  return rows.map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status,
    deliveryPhase: project.delivery_phase,
    updatedAt: project.updated_at,
  }));
}

function mapWorkspaceOperationsPlanRows(rows: WorkspaceOperationsPlanSourceRow[]): WorkspaceOperationsPlanRow[] {
  return rows.map((plan) => ({
    id: plan.id,
    title: plan.title,
    status: plan.status,
    geographyLabel: plan.geography_label,
    horizonYear: plan.horizon_year,
    projectId: plan.project_id,
    updatedAt: plan.updated_at,
  }));
}

function mapWorkspaceOperationsProgramRows(
  rows: WorkspaceOperationsProgramSourceRow[]
): WorkspaceOperationsProgramRow[] {
  return rows.map((program) => ({
    id: program.id,
    title: program.title,
    status: program.status,
    nominationDueAt: program.nomination_due_at,
    adoptionTargetAt: program.adoption_target_at,
    updatedAt: program.updated_at,
  }));
}

function mapWorkspaceOperationsReportRows(rows: WorkspaceOperationsReportSourceRow[]): WorkspaceOperationsReportRow[] {
  return rows.map((report) => ({
    id: report.id,
    title: report.title,
    status: report.status,
    latestArtifactKind: report.latest_artifact_kind,
    generatedAt: report.generated_at,
    updatedAt: report.updated_at,
    metadataJson: report.metadata_json,
  }));
}

function mapWorkspaceOperationsFundingOpportunityRows(
  rows: WorkspaceOperationsFundingOpportunitySourceRow[]
): WorkspaceOperationsFundingOpportunityRow[] {
  return rows.map((opportunity) => ({
    id: opportunity.id,
    title: opportunity.title,
    opportunityStatus: opportunity.opportunity_status,
    decisionState: opportunity.decision_state,
    expectedAwardAmount: opportunity.expected_award_amount,
    closesAt: opportunity.closes_at,
    decisionDueAt: opportunity.decision_due_at,
    programId: opportunity.program_id,
    projectId: opportunity.project_id,
    updatedAt: opportunity.updated_at,
  }));
}

function mapWorkspaceOperationsFundingAwardRows(
  rows: WorkspaceOperationsFundingAwardSourceRow[]
): WorkspaceOperationsFundingAwardRow[] {
  return rows.map((award) => ({
    id: award.id,
    projectId: award.project_id,
    fundingOpportunityId: award.funding_opportunity_id,
    title: award.title,
    awardedAmount: award.awarded_amount,
    updatedAt: award.updated_at,
  }));
}

function mapWorkspaceOperationsBillingInvoiceRows(
  rows: WorkspaceOperationsBillingInvoiceSourceRow[]
): WorkspaceOperationsBillingInvoiceRow[] {
  return rows.map((invoice) => ({
    id: invoice.id,
    projectId: invoice.project_id,
    fundingAwardId: invoice.funding_award_id,
    status: invoice.status,
    amount: invoice.amount,
    retentionPercent: invoice.retention_percent,
    retentionAmount: invoice.retention_amount,
    dueDate: invoice.due_date,
  }));
}

function mapWorkspaceOperationsProjectSubmittalRows(
  rows: WorkspaceOperationsProjectSubmittalSourceRow[]
): WorkspaceOperationsProjectSubmittalRow[] {
  return rows.map((submittal) => ({
    id: submittal.id,
    projectId: submittal.project_id,
    submittalType: submittal.submittal_type,
    status: submittal.status,
    updatedAt: submittal.updated_at,
  }));
}

export function buildWorkspaceOperationsSummaryFromSourceRows({
  projects,
  plans,
  programs,
  reports,
  fundingOpportunities,
  fundingAwards = [],
  fundingInvoices = [],
  projectSubmittals = [],
  projectFundingProfiles = [],
  now,
}: {
  projects: WorkspaceOperationsProjectSourceRow[];
  plans: WorkspaceOperationsPlanSourceRow[];
  programs: WorkspaceOperationsProgramSourceRow[];
  reports: WorkspaceOperationsReportSourceRow[];
  fundingOpportunities: WorkspaceOperationsFundingOpportunitySourceRow[];
  fundingAwards?: WorkspaceOperationsFundingAwardSourceRow[];
  fundingInvoices?: WorkspaceOperationsBillingInvoiceSourceRow[];
  projectSubmittals?: WorkspaceOperationsProjectSubmittalSourceRow[];
  projectFundingProfiles?: WorkspaceOperationsProjectFundingProfileSourceRow[];
  now?: Date;
}) {
  return buildWorkspaceOperationsSummary({
    projects: mapWorkspaceOperationsProjectRows(projects),
    plans: mapWorkspaceOperationsPlanRows(plans),
    programs: mapWorkspaceOperationsProgramRows(programs),
    reports: mapWorkspaceOperationsReportRows(reports),
    fundingOpportunities: mapWorkspaceOperationsFundingOpportunityRows(fundingOpportunities),
    fundingAwards: mapWorkspaceOperationsFundingAwardRows(fundingAwards),
    fundingInvoices: mapWorkspaceOperationsBillingInvoiceRows(fundingInvoices),
    projectSubmittals: mapWorkspaceOperationsProjectSubmittalRows(projectSubmittals),
    projectFundingProfiles,
    now,
  });
}

export async function loadWorkspaceOperationsSummaryForWorkspace(
  supabase: WorkspaceOperationsSupabaseLike,
  workspaceId: string
): Promise<WorkspaceOperationsSummary> {
  const [projectsResult, plansResult, programsResult, reportsResult, fundingOpportunitiesResult, fundingAwardsResult, fundingInvoicesResult, projectSubmittalsResult, projectFundingProfilesResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, delivery_phase, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("plans")
      .select("id, title, status, geography_label, horizon_year, project_id, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("programs")
      .select("id, title, status, nomination_due_at, adoption_target_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("reports")
      .select("id, title, status, latest_artifact_kind, generated_at, updated_at, metadata_json")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("funding_opportunities")
      .select("id, title, opportunity_status, decision_state, expected_award_amount, closes_at, decision_due_at, program_id, project_id, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("funding_awards")
      .select("id, project_id, funding_opportunity_id, title, awarded_amount, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("billing_invoice_records")
      .select("id, project_id, funding_award_id, status, amount, retention_percent, retention_amount, due_date")
      .eq("workspace_id", workspaceId)
      .order("due_date", { ascending: true })
      .limit(200),
    supabase
      .from("project_submittals")
      .select("id, project_id, submittal_type, status, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("project_funding_profiles")
      .select("project_id, funding_need_amount, local_match_need_amount")
      .eq("workspace_id", workspaceId)
      .limit(200),
  ]);

  return buildWorkspaceOperationsSummaryFromSourceRows({
    projects: (projectsResult.data ?? []) as WorkspaceOperationsProjectSourceRow[],
    plans: (plansResult.data ?? []) as WorkspaceOperationsPlanSourceRow[],
    programs: (programsResult.data ?? []) as WorkspaceOperationsProgramSourceRow[],
    reports: (reportsResult.data ?? []) as WorkspaceOperationsReportSourceRow[],
    fundingOpportunities: (fundingOpportunitiesResult.data ?? []) as WorkspaceOperationsFundingOpportunitySourceRow[],
    fundingAwards: (fundingAwardsResult.data ?? []) as WorkspaceOperationsFundingAwardSourceRow[],
    fundingInvoices: (fundingInvoicesResult.data ?? []) as WorkspaceOperationsBillingInvoiceSourceRow[],
    projectSubmittals: (projectSubmittalsResult.data ?? []) as WorkspaceOperationsProjectSubmittalSourceRow[],
    projectFundingProfiles: (projectFundingProfilesResult.data ?? []) as WorkspaceOperationsProjectFundingProfileSourceRow[],
  });
}

export function buildWorkspaceOperationsSummary({
  projects,
  plans,
  programs,
  reports,
  fundingOpportunities,
  fundingAwards = [],
  fundingInvoices = [],
  projectSubmittals = [],
  projectFundingProfiles = [],
  now = new Date(),
}: {
  projects: WorkspaceOperationsProjectRow[];
  plans: WorkspaceOperationsPlanRow[];
  programs: WorkspaceOperationsProgramRow[];
  reports: WorkspaceOperationsReportRow[];
  fundingOpportunities: WorkspaceOperationsFundingOpportunityRow[];
  fundingAwards?: WorkspaceOperationsFundingAwardRow[];
  fundingInvoices?: WorkspaceOperationsBillingInvoiceRow[];
  projectSubmittals?: WorkspaceOperationsProjectSubmittalRow[];
  projectFundingProfiles?: WorkspaceOperationsProjectFundingProfileSourceRow[];
  now?: Date;
}): WorkspaceOperationsSummary {
  const reportRows = reports.map((report) => {
    const freshness = getReportPacketFreshness({
      latestArtifactKind: report.latestArtifactKind,
      generatedAt: report.generatedAt,
      updatedAt: report.updatedAt,
    });
    const comparisonAggregate = parseStoredComparisonSnapshotAggregate(report.metadataJson);
    const comparisonDigest = describeComparisonSnapshotAggregate(comparisonAggregate);

    return {
      ...report,
      freshness,
      comparisonAggregate,
      comparisonDigest,
    };
  });

  const activeProjects = projects.filter((project) => !["complete", "archived", "cancelled"].includes(project.status ?? "")).length;
  const plansNeedingSetup = plans.filter((plan) => {
    const readiness = buildPlanReadiness({
      hasProject: Boolean(plan.projectId),
      scenarioCount: 0,
      engagementCampaignCount: 0,
      reportCount: 0,
      geographyLabel: plan.geographyLabel,
      horizonYear: plan.horizonYear,
    });

    return !readiness.ready;
  }).length;
  const activePrograms = programs.filter((program) => !["adopted", "archived"].includes(program.status ?? "")).length;
  const reportRefreshRecommended = reportRows.filter((report) => report.freshness.label === "Refresh recommended").length;
  const reportNoPacket = reportRows.filter((report) => report.freshness.label === "No packet").length;
  const reportPacketCurrent = reportRows.filter((report) => report.freshness.label === "Packet current").length;
  const comparisonBackedReports = reportRows.filter(
    (report) => (report.comparisonAggregate?.comparisonSnapshotCount ?? 0) > 0
  ).length;
  const openFundingOpportunities = fundingOpportunities.filter((item) => ["open", "upcoming"].includes(item.opportunityStatus ?? "")).length;
  const closingSoonFundingOpportunities = fundingOpportunities.filter((item) => {
    if ((item.opportunityStatus ?? "") !== "open") return false;
    const days = daysUntil(item.closesAt ?? item.decisionDueAt, now);
    return days !== null && days <= 14;
  }).length;

  const fundingOpportunitiesByProjectId = new Map<string, WorkspaceOperationsFundingOpportunityRow[]>();
  fundingOpportunities.forEach((opportunity) => {
    if (!opportunity.projectId) return;
    const current = fundingOpportunitiesByProjectId.get(opportunity.projectId) ?? [];
    current.push(opportunity);
    fundingOpportunitiesByProjectId.set(opportunity.projectId, current);
  });
  const fundingProfileProjectIds = new Set(projectFundingProfiles.map((profile) => profile.project_id));
  const fundingAwardOpportunityIds = new Set(
    fundingAwards.map((award) => award.fundingOpportunityId).filter((value): value is string => Boolean(value))
  );
  const fundingAwardsByProjectId = new Map<string, WorkspaceOperationsFundingAwardRow[]>();
  fundingAwards.forEach((award) => {
    const current = fundingAwardsByProjectId.get(award.projectId) ?? [];
    current.push(award);
    fundingAwardsByProjectId.set(award.projectId, current);
  });
  const fundingInvoicesByProjectId = new Map<string, WorkspaceOperationsBillingInvoiceRow[]>();
  fundingInvoices.forEach((invoice) => {
    const current = fundingInvoicesByProjectId.get(invoice.projectId) ?? [];
    current.push(invoice);
    fundingInvoicesByProjectId.set(invoice.projectId, current);
  });
  const reimbursementSubmittalsByProjectId = new Map<string, WorkspaceOperationsProjectSubmittalRow[]>();
  projectSubmittals
    .filter((submittal) => submittal.submittalType === "reimbursement")
    .forEach((submittal) => {
      const current = reimbursementSubmittalsByProjectId.get(submittal.projectId) ?? [];
      current.push(submittal);
      reimbursementSubmittalsByProjectId.set(submittal.projectId, current);
    });
  const projectFundingNeedAnchorProjects = [...fundingOpportunitiesByProjectId.entries()]
    .map(([projectId, opportunities]) => {
      if (fundingProfileProjectIds.has(projectId)) return null;
      const project = projects.find((item) => item.id === projectId);
      if (!project) return null;
      const closingSoonCount = opportunities.filter((opportunity) => {
        if ((opportunity.opportunityStatus ?? "") !== "open") return false;
        const days = daysUntil(opportunity.closesAt ?? opportunity.decisionDueAt, now);
        return days !== null && days <= 14;
      }).length;
      const openCount = opportunities.filter((opportunity) => ["open", "upcoming"].includes(opportunity.opportunityStatus ?? "")).length;
      return {
        project,
        opportunityCount: opportunities.length,
        openCount,
        closingSoonCount,
      };
    })
    .filter((item): item is { project: WorkspaceOperationsProjectRow; opportunityCount: number; openCount: number; closingSoonCount: number } => Boolean(item))
    .sort((left, right) => {
      if (right.closingSoonCount !== left.closingSoonCount) {
        return right.closingSoonCount - left.closingSoonCount;
      }
      if (right.openCount !== left.openCount) {
        return right.openCount - left.openCount;
      }
      return new Date(right.project.updatedAt ?? 0).getTime() - new Date(left.project.updatedAt ?? 0).getTime();
    });
  const fundingGapProjects = projectFundingProfiles
    .map((profile) => {
      const project = projects.find((item) => item.id === profile.project_id);
      if (!project) return null;
      const opportunities = fundingOpportunitiesByProjectId.get(profile.project_id) ?? [];
      const awards = fundingAwardsByProjectId.get(profile.project_id) ?? [];
      const invoices = (fundingInvoicesByProjectId.get(profile.project_id) ?? []).filter((invoice) =>
        awards.some((award) => award.id === invoice.fundingAwardId)
      );
      const summary = buildProjectFundingStackSummary(
        profile,
        awards.map((award) => ({
          awarded_amount: award.awardedAmount,
        })),
        opportunities.map((opportunity) => ({
          expected_award_amount: opportunity.expectedAwardAmount ?? null,
          decision_state: opportunity.decisionState ?? null,
          opportunity_status: opportunity.opportunityStatus ?? null,
        })),
        invoices.map((invoice) => ({
          funding_award_id: invoice.fundingAwardId,
          status: invoice.status,
          amount: invoice.amount,
          retention_percent: invoice.retentionPercent,
          retention_amount: invoice.retentionAmount,
          due_date: invoice.dueDate,
        }))
      );
      if (!summary.hasTargetNeed || opportunities.length === 0 || summary.unfundedAfterLikelyAmount <= 0) {
        return null;
      }
      return {
        project,
        summary,
      };
    })
    .filter((item): item is { project: WorkspaceOperationsProjectRow; summary: ReturnType<typeof buildProjectFundingStackSummary> } => Boolean(item))
    .sort((left, right) => right.summary.unfundedAfterLikelyAmount - left.summary.unfundedAfterLikelyAmount);
  const fundingSourcingProjects = projectFundingProfiles
    .map((profile) => {
      const project = projects.find((item) => item.id === profile.project_id);
      if (!project) return null;
      const opportunities = fundingOpportunitiesByProjectId.get(profile.project_id) ?? [];
      const awards = fundingAwardsByProjectId.get(profile.project_id) ?? [];
      const summary = buildProjectFundingStackSummary(
        profile,
        awards.map((award) => ({
          awarded_amount: award.awardedAmount,
        })),
        opportunities.map((opportunity) => ({
          expected_award_amount: opportunity.expectedAwardAmount ?? null,
          decision_state: opportunity.decisionState ?? null,
          opportunity_status: opportunity.opportunityStatus ?? null,
        }))
      );
      if (!summary.hasTargetNeed || opportunities.length > 0) {
        return null;
      }
      return {
        project,
        summary,
      };
    })
    .filter((item): item is { project: WorkspaceOperationsProjectRow; summary: ReturnType<typeof buildProjectFundingStackSummary> } => Boolean(item))
    .sort((left, right) => right.summary.fundingNeedAmount - left.summary.fundingNeedAmount);
  const fundingDecisionProjects = projectFundingProfiles
    .map((profile) => {
      const project = projects.find((item) => item.id === profile.project_id);
      if (!project) return null;
      const opportunities = fundingOpportunitiesByProjectId.get(profile.project_id) ?? [];
      const awards = fundingAwardsByProjectId.get(profile.project_id) ?? [];
      const actionableOpportunities = opportunities.filter(
        (opportunity) => !["awarded", "archived"].includes(opportunity.opportunityStatus ?? "")
      );
      const summary = buildProjectFundingStackSummary(
        profile,
        awards.map((award) => ({
          awarded_amount: award.awardedAmount,
        })),
        actionableOpportunities.map((opportunity) => ({
          expected_award_amount: opportunity.expectedAwardAmount ?? null,
          decision_state: opportunity.decisionState ?? null,
          opportunity_status: opportunity.opportunityStatus ?? null,
        }))
      );
      if (!summary.hasTargetNeed || actionableOpportunities.length === 0 || summary.pursuedOpportunityCount > 0) {
        return null;
      }
      const leadOpportunity = [...actionableOpportunities].sort((left, right) => {
        const leftStatusPriority = left.opportunityStatus === "open" ? 0 : left.opportunityStatus === "upcoming" ? 1 : 2;
        const rightStatusPriority = right.opportunityStatus === "open" ? 0 : right.opportunityStatus === "upcoming" ? 1 : 2;
        if (leftStatusPriority !== rightStatusPriority) return leftStatusPriority - rightStatusPriority;
        const leftDueAt = left.closesAt ?? left.decisionDueAt;
        const rightDueAt = right.closesAt ?? right.decisionDueAt;
        if (leftDueAt && rightDueAt) {
          const dueDelta = new Date(leftDueAt).getTime() - new Date(rightDueAt).getTime();
          if (dueDelta !== 0) return dueDelta;
        }
        return new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime();
      })[0] ?? null;
      return {
        project,
        summary,
        leadOpportunity,
      };
    })
    .filter(
      (
        item
      ): item is NonNullable<typeof item> => Boolean(item)
    )
    .sort((left, right) => right.summary.fundingNeedAmount - left.summary.fundingNeedAmount);
  const fundingAwardRecordProjects = projectFundingProfiles
    .map((profile) => {
      const project = projects.find((item) => item.id === profile.project_id);
      if (!project) return null;
      const opportunities = fundingOpportunitiesByProjectId.get(profile.project_id) ?? [];
      const awards = fundingAwardsByProjectId.get(profile.project_id) ?? [];
      const summary = buildProjectFundingStackSummary(
        profile,
        awards.map((award) => ({
          awarded_amount: award.awardedAmount,
        })),
        opportunities.map((opportunity) => ({
          expected_award_amount: opportunity.expectedAwardAmount ?? null,
          decision_state: opportunity.decisionState ?? null,
          opportunity_status: opportunity.opportunityStatus ?? null,
        }))
      );
      const awardedOpportunity = [...opportunities]
        .filter(
          (opportunity) =>
            opportunity.opportunityStatus === "awarded" && !fundingAwardOpportunityIds.has(opportunity.id)
        )
        .sort((left, right) => new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime())[0] ?? null;
      if (!summary.hasTargetNeed || !awardedOpportunity) {
        return null;
      }
      return {
        project,
        summary,
        awardedOpportunity,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      const rightAwardAmount = Number(right.awardedOpportunity.expectedAwardAmount ?? 0);
      const leftAwardAmount = Number(left.awardedOpportunity.expectedAwardAmount ?? 0);
      if (rightAwardAmount !== leftAwardAmount) {
        return rightAwardAmount - leftAwardAmount;
      }
      return new Date(right.project.updatedAt ?? 0).getTime() - new Date(left.project.updatedAt ?? 0).getTime();
    });
  const fundingReimbursementProjects = projectFundingProfiles
    .map((profile) => {
      const project = projects.find((item) => item.id === profile.project_id);
      if (!project) return null;
      const awards = fundingAwardsByProjectId.get(profile.project_id) ?? [];
      if (awards.length === 0) return null;
      const opportunities = fundingOpportunitiesByProjectId.get(profile.project_id) ?? [];
      const invoices = (fundingInvoicesByProjectId.get(profile.project_id) ?? []).filter((invoice) =>
        awards.some((award) => award.id === invoice.fundingAwardId)
      );
      const reimbursementPackets = reimbursementSubmittalsByProjectId.get(profile.project_id) ?? [];
      const summary = buildProjectFundingStackSummary(
        profile,
        awards.map((award) => ({
          awarded_amount: award.awardedAmount,
        })),
        opportunities.map((opportunity) => ({
          expected_award_amount: opportunity.expectedAwardAmount ?? null,
          decision_state: opportunity.decisionState ?? null,
          opportunity_status: opportunity.opportunityStatus ?? null,
        })),
        invoices.map((invoice) => ({
          funding_award_id: invoice.fundingAwardId,
          status: invoice.status,
          amount: invoice.amount,
          retention_percent: invoice.retentionPercent,
          retention_amount: invoice.retentionAmount,
          due_date: invoice.dueDate,
        }))
      );
      if (summary.uninvoicedAwardAmount <= 0) return null;
      return {
        project,
        summary,
        reimbursementPacketCount: reimbursementPackets.length,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.summary.uninvoicedAwardAmount - left.summary.uninvoicedAwardAmount);
  const reimbursementStartProjects = fundingReimbursementProjects.filter(
    (item) => item.reimbursementPacketCount === 0 && item.summary.reimbursementStatus === "not_started"
  );
  const reimbursementAdvanceProjects = fundingReimbursementProjects.filter(
    (item) => !(item.reimbursementPacketCount === 0 && item.summary.reimbursementStatus === "not_started")
  );
  const invoiceAwardRelinkProjects = projects
    .map((project) => {
      const awards = fundingAwardsByProjectId.get(project.id) ?? [];
      const unlinkedInvoices = (fundingInvoicesByProjectId.get(project.id) ?? []).filter(
        (invoice) => !invoice.fundingAwardId && !["paid", "rejected"].includes(invoice.status ?? "draft")
      );
      if (awards.length !== 1 || unlinkedInvoices.length !== 1) {
        return null;
      }
      return {
        project,
        award: awards[0],
        invoice: unlinkedInvoices[0],
        overdue:
          Boolean(unlinkedInvoices[0].dueDate) &&
          !Number.isNaN(new Date(unlinkedInvoices[0].dueDate ?? "").getTime()) &&
          new Date(unlinkedInvoices[0].dueDate ?? "").getTime() < now.getTime(),
        netAmount: computeNetInvoiceAmount(
          unlinkedInvoices[0].amount,
          unlinkedInvoices[0].retentionAmount,
          unlinkedInvoices[0].retentionPercent
        ),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      if (Number(right.overdue) !== Number(left.overdue)) {
        return Number(right.overdue) - Number(left.overdue);
      }
      if (right.netAmount !== left.netAmount) {
        return right.netAmount - left.netAmount;
      }
      return new Date(right.project.updatedAt ?? 0).getTime() - new Date(left.project.updatedAt ?? 0).getTime();
    });

  const firstRefreshReport = reportRows.find((report) => report.freshness.label === "Refresh recommended");
  const firstMissingReport = reportRows.find((report) => report.freshness.label === "No packet");
  const firstCurrentReport = reportRows.find((report) => report.freshness.label === "Packet current");
  const firstComparisonBackedReport = reportRows.find(
    (report) => (report.comparisonAggregate?.comparisonSnapshotCount ?? 0) > 0
  );
  const firstClosingOpportunity = fundingOpportunities.find((item) => {
    if ((item.opportunityStatus ?? "") !== "open") return false;
    const days = daysUntil(item.closesAt ?? item.decisionDueAt, now);
    return days !== null && days <= 14;
  });
  const firstClosingProgram = firstClosingOpportunity?.programId
    ? programs.find((program) => program.id === firstClosingOpportunity.programId) ?? null
    : null;
  const firstClosingProject = firstClosingOpportunity?.projectId
    ? projects.find((project) => project.id === firstClosingOpportunity.projectId) ?? null
    : null;
  const firstPlanNeedingSetup = plans.find((plan) => {
    const readiness = buildPlanReadiness({
      hasProject: Boolean(plan.projectId),
      scenarioCount: 0,
      engagementCampaignCount: 0,
      reportCount: 0,
      geographyLabel: plan.geographyLabel,
      horizonYear: plan.horizonYear,
    });

    return !readiness.ready;
  });
  const firstActiveProgram = programs.find((program) => !["adopted", "archived"].includes(program.status ?? ""));

  const queueCandidates: WorkspaceCommandQueueItem[] = [];

  if (reportRefreshRecommended > 0) {
    queueCandidates.push({
      key: "refresh-report-packets",
      title: "Refresh report packets",
      detail: `${reportRefreshRecommended} report packet${reportRefreshRecommended === 1 ? " needs" : "s need"} regeneration because the underlying record changed after generation.${firstRefreshReport?.title ? ` Start with ${firstRefreshReport.title}.` : ""}`,
      href: firstRefreshReport
        ? getReportNavigationHref(firstRefreshReport.id, firstRefreshReport.freshness.label)
        : "/reports?freshness=refresh",
      tone: "warning",
      priority: 0,
      badges: [
        { label: "Refresh", value: reportRefreshRecommended },
        { label: "Reports", value: reports.length },
      ],
    });
  }

  if (reportNoPacket > 0) {
    queueCandidates.push({
      key: "generate-first-packets",
      title: "Generate first report packets",
      detail: `${reportNoPacket} report record${reportNoPacket === 1 ? " is" : "s are"} still missing a packet artifact.${firstMissingReport?.title ? ` Start with ${firstMissingReport.title}.` : ""}`,
      href: firstMissingReport
        ? getReportNavigationHref(firstMissingReport.id, firstMissingReport.freshness.label)
        : "/reports?freshness=missing",
      tone: "warning",
      priority: 1,
      badges: [
        { label: "Missing", value: reportNoPacket },
        { label: "Reports", value: reports.length },
      ],
    });
  }

  if (reportPacketCurrent > 0) {
    queueCandidates.push({
      key: "review-current-report-packets",
      title: "Run release review on current packets",
      detail: `${reportPacketCurrent} report packet${reportPacketCurrent === 1 ? " is" : "s are"} currently aligned with source state and ready for release review.${firstCurrentReport?.title ? ` Start with ${firstCurrentReport.title}.` : ""}`,
      href: firstCurrentReport
        ? getReportNavigationHref(firstCurrentReport.id, firstCurrentReport.freshness.label)
        : "/reports?freshness=current",
      tone: "info",
      priority: 2.5,
      badges: [
        { label: "Current", value: reportPacketCurrent },
        { label: "Reports", value: reports.length },
      ],
    });
  }

  if (closingSoonFundingOpportunities > 0) {
    queueCandidates.push({
      key: "funding-windows-closing",
      title: "Advance near-term funding windows",
      detail: `${closingSoonFundingOpportunities} open funding opportunit${closingSoonFundingOpportunities === 1 ? "y closes" : "ies close"} within 14 days.${firstClosingOpportunity?.title ? ` ${firstClosingOpportunity.title} is the first deadline to reopen.` : ""}${firstClosingProgram?.title ? ` Reopen ${firstClosingProgram.title} first.` : firstClosingProject?.name ? ` Reopen ${firstClosingProject.name} first.` : ""}`,
      href: firstClosingOpportunity?.programId
        ? `/programs/${firstClosingOpportunity.programId}#program-funding-opportunities`
        : firstClosingOpportunity?.projectId
          ? `/projects/${firstClosingOpportunity.projectId}#project-funding-opportunities`
          : "/programs",
      targetProjectId: firstClosingOpportunity?.projectId ?? null,
      tone: "warning",
      priority: 2,
      badges: [
        { label: "Closing soon", value: closingSoonFundingOpportunities },
        { label: "Open", value: openFundingOpportunities },
      ],
    });
  }

  if (projectFundingNeedAnchorProjects.length > 0) {
    const firstFundingNeedAnchorProject = projectFundingNeedAnchorProjects[0];
    queueCandidates.push({
      key: "anchor-project-funding-needs",
      title: "Anchor project funding needs",
      detail: `${projectFundingNeedAnchorProjects.length} project funding lane${projectFundingNeedAnchorProjects.length === 1 ? " has" : "s have"} linked opportunities but still no recorded funding-need anchor.${firstFundingNeedAnchorProject ? ` Reopen ${firstFundingNeedAnchorProject.project.name} first so the gap can be measured honestly.` : ""}`,
      href: firstFundingNeedAnchorProject
        ? `/projects/${firstFundingNeedAnchorProject.project.id}#project-funding-opportunities`
        : "/projects",
      targetProjectId: firstFundingNeedAnchorProject?.project.id ?? null,
      targetProjectName: firstFundingNeedAnchorProject?.project.name ?? null,
      tone: "warning",
      priority: 3,
      badges: [
        { label: "Missing anchors", value: projectFundingNeedAnchorProjects.length },
        { label: "Open windows", value: firstFundingNeedAnchorProject?.openCount ?? null },
      ],
    });
  }

  if (fundingAwardRecordProjects.length > 0) {
    const firstFundingAwardRecordProject = fundingAwardRecordProjects[0];
    queueCandidates.push({
      key: "record-awarded-funding",
      title: "Record awarded funding",
      detail: `${fundingAwardRecordProjects.length} project funding stack${fundingAwardRecordProjects.length === 1 ? " has" : "s have"} an opportunity already marked awarded but no funding-award record yet.${firstFundingAwardRecordProject ? ` Reopen ${firstFundingAwardRecordProject.project.name} first and convert ${firstFundingAwardRecordProject.awardedOpportunity.title} into a committed award entry.` : ""}`,
      href: firstFundingAwardRecordProject
        ? `/projects/${firstFundingAwardRecordProject.project.id}#project-funding-opportunities`
        : "/projects",
      targetProjectId: firstFundingAwardRecordProject?.project.id ?? null,
      targetProjectName: firstFundingAwardRecordProject?.project.name ?? null,
      targetOpportunityId: firstFundingAwardRecordProject?.awardedOpportunity.id ?? null,
      tone: "warning",
      priority: 6,
      badges: [
        { label: "Award records needed", value: fundingAwardRecordProjects.length },
        {
          label: "Lead awarded",
          value: firstFundingAwardRecordProject
            ? formatCurrency(Number(firstFundingAwardRecordProject.awardedOpportunity.expectedAwardAmount ?? 0))
            : null,
        },
      ],
    });
  }

  if (reimbursementStartProjects.length > 0) {
    const firstReimbursementStartProject = reimbursementStartProjects[0];
    queueCandidates.push({
      key: "start-project-reimbursement-packets",
      title: "Start reimbursement packets",
      detail: `${reimbursementStartProjects.length} project funding stack${reimbursementStartProjects.length === 1 ? " has" : "s have"} committed awards with uninvoiced dollars but no reimbursement packet started yet.${firstReimbursementStartProject ? ` Reopen ${firstReimbursementStartProject.project.name} first and start the packet against ${formatCurrency(firstReimbursementStartProject.summary.uninvoicedAwardAmount)} still uninvoiced.` : ""}`,
      href: firstReimbursementStartProject
        ? `/projects/${firstReimbursementStartProject.project.id}#project-submittals`
        : "/projects",
      targetProjectId: firstReimbursementStartProject?.project.id ?? null,
      targetProjectName: firstReimbursementStartProject?.project.name ?? null,
      tone: "warning",
      priority: 6.2,
      badges: [
        { label: "Packets needed", value: reimbursementStartProjects.length },
        {
          label: "Uninvoiced",
          value: firstReimbursementStartProject
            ? formatCurrency(firstReimbursementStartProject.summary.uninvoicedAwardAmount)
            : null,
        },
      ],
    });
  }

  if (invoiceAwardRelinkProjects.length > 0) {
    const firstInvoiceAwardRelinkProject = invoiceAwardRelinkProjects[0];
    queueCandidates.push({
      key: "relink-project-invoice-awards",
      title: "Relink invoice reimbursement records",
      detail: `${invoiceAwardRelinkProjects.length} project reimbursement lane${invoiceAwardRelinkProjects.length === 1 ? " has" : "s have"} an exact invoice-to-award relink available right now.${firstInvoiceAwardRelinkProject ? ` Reopen ${firstInvoiceAwardRelinkProject.project.name} first and attach ${firstInvoiceAwardRelinkProject.invoice.id} to ${firstInvoiceAwardRelinkProject.award.title}.` : ""}`,
      href: firstInvoiceAwardRelinkProject
        ? `/projects/${firstInvoiceAwardRelinkProject.project.id}#project-invoices`
        : "/projects",
      targetProjectId: firstInvoiceAwardRelinkProject?.project.id ?? null,
      targetProjectName: firstInvoiceAwardRelinkProject?.project.name ?? null,
      targetInvoiceId: firstInvoiceAwardRelinkProject?.invoice.id ?? null,
      targetFundingAwardId: firstInvoiceAwardRelinkProject?.award.id ?? null,
      tone: "warning",
      priority: 6.25,
      badges: [
        { label: "Exact relinks", value: invoiceAwardRelinkProjects.length },
        {
          label: "Lead invoice",
          value: firstInvoiceAwardRelinkProject ? formatCurrency(firstInvoiceAwardRelinkProject.netAmount) : null,
        },
      ],
    });
  }

  if (reimbursementAdvanceProjects.length > 0) {
    const firstReimbursementAdvanceProject = reimbursementAdvanceProjects[0];
    queueCandidates.push({
      key: "advance-project-reimbursement-invoicing",
      title: "Advance reimbursement invoicing",
      detail: `${reimbursementAdvanceProjects.length} project funding stack${reimbursementAdvanceProjects.length === 1 ? " has" : "s have"} reimbursement work underway, but committed award dollars are still not fully reflected in invoicing.${firstReimbursementAdvanceProject ? ` Reopen ${firstReimbursementAdvanceProject.project.name} first and move ${formatCurrency(firstReimbursementAdvanceProject.summary.uninvoicedAwardAmount)} through the invoice lane.` : ""}`,
      href: firstReimbursementAdvanceProject
        ? `/projects/${firstReimbursementAdvanceProject.project.id}#project-invoices`
        : "/projects",
      targetProjectId: firstReimbursementAdvanceProject?.project.id ?? null,
      targetProjectName: firstReimbursementAdvanceProject?.project.name ?? null,
      tone: "warning",
      priority: 6.3,
      badges: [
        { label: "Reimbursement active", value: reimbursementAdvanceProjects.length },
        {
          label: "Uninvoiced",
          value: firstReimbursementAdvanceProject
            ? formatCurrency(firstReimbursementAdvanceProject.summary.uninvoicedAwardAmount)
            : null,
        },
      ],
    });
  }

  if (fundingGapProjects.length > 0) {
    const firstFundingGapProject = fundingGapProjects[0];
    queueCandidates.push({
      key: "close-project-funding-gaps",
      title: "Close project funding gaps",
      detail: `${fundingGapProjects.length} project funding stack${fundingGapProjects.length === 1 ? " still shows" : "s still show"} an uncovered gap after current pursued dollars.${firstFundingGapProject ? ` ${firstFundingGapProject.project.name} still carries ${formatCurrency(firstFundingGapProject.summary.unfundedAfterLikelyAmount)} uncovered.` : ""}`,
      href: firstFundingGapProject ? `/projects/${firstFundingGapProject.project.id}#project-funding-opportunities` : "/projects",
      targetProjectId: firstFundingGapProject?.project.id ?? null,
      targetProjectName: firstFundingGapProject?.project.name ?? null,
      tone: "warning",
      priority: 7,
      badges: [
        { label: "Gap projects", value: fundingGapProjects.length },
        { label: "Largest gap", value: firstFundingGapProject ? formatCurrency(firstFundingGapProject.summary.unfundedAfterLikelyAmount) : null },
      ],
    });
  }

  if (fundingSourcingProjects.length > 0) {
    const firstFundingSourcingProject = fundingSourcingProjects[0];
    queueCandidates.push({
      key: "source-project-funding-opportunities",
      title: "Source project funding opportunities",
      detail: `${fundingSourcingProjects.length} project funding stack${fundingSourcingProjects.length === 1 ? " has" : "s have"} a recorded funding need but still no linked funding opportunities.${firstFundingSourcingProject ? ` Reopen ${firstFundingSourcingProject.project.name} first and source candidate programs.` : ""}`,
      href: firstFundingSourcingProject
        ? `/projects/${firstFundingSourcingProject.project.id}#project-funding-opportunities`
        : "/projects",
      targetProjectId: firstFundingSourcingProject?.project.id ?? null,
      targetProjectName: firstFundingSourcingProject?.project.name ?? null,
      tone: "warning",
      priority: 4,
      badges: [
        { label: "Needs sourcing", value: fundingSourcingProjects.length },
        {
          label: "Largest unfunded need",
          value: firstFundingSourcingProject ? formatCurrency(firstFundingSourcingProject.summary.fundingNeedAmount) : null,
        },
      ],
    });
  }

  if (fundingDecisionProjects.length > 0) {
    const firstFundingDecisionProject = fundingDecisionProjects[0];
    queueCandidates.push({
      key: "advance-project-funding-decisions",
      title: "Advance project funding decisions",
      detail: `${fundingDecisionProjects.length} project funding stack${fundingDecisionProjects.length === 1 ? " has" : "s have"} linked opportunities but nothing marked pursue yet.${firstFundingDecisionProject?.leadOpportunity ? ` ${firstFundingDecisionProject.leadOpportunity.title} is the first grant decision to advance for ${firstFundingDecisionProject.project.name}.` : firstFundingDecisionProject ? ` Reopen ${firstFundingDecisionProject.project.name} first and choose the lead opportunity.` : ""}`,
      href: firstFundingDecisionProject
        ? `/projects/${firstFundingDecisionProject.project.id}#project-funding-opportunities`
        : "/projects",
      targetProjectId: firstFundingDecisionProject?.project.id ?? null,
      targetProjectName: firstFundingDecisionProject?.project.name ?? null,
      targetOpportunityId: firstFundingDecisionProject?.leadOpportunity?.id ?? null,
      tone: "warning",
      priority: 5,
      badges: [
        { label: "Decision gaps", value: fundingDecisionProjects.length },
        { label: "Lead need", value: firstFundingDecisionProject ? formatCurrency(firstFundingDecisionProject.summary.fundingNeedAmount) : null },
      ],
    });
  }

  if (plansNeedingSetup > 0) {
    queueCandidates.push({
      key: "tighten-plan-foundations",
      title: "Tighten plan foundations",
      detail: `${plansNeedingSetup} plan record${plansNeedingSetup === 1 ? " still needs" : "s still need"} core setup around project linkage, geography, or horizon year.${firstPlanNeedingSetup?.title ? ` Reopen ${firstPlanNeedingSetup.title} first.` : ""}`,
      href: "/plans",
      tone: "info",
      priority: 7,
      badges: [
        { label: "Needs setup", value: plansNeedingSetup },
        { label: "Plans", value: plans.length },
      ],
    });
  }

  if (activePrograms > 0) {
    queueCandidates.push({
      key: "advance-program-packages",
      title: "Advance active program packages",
      detail: `${activePrograms} program package${activePrograms === 1 ? " is" : "s are"} still in assembly, submission, or review posture.${firstActiveProgram?.title ? ` ${firstActiveProgram.title} is a good next package anchor.` : ""}`,
      href: "/programs",
      tone: "info",
      priority: 8,
      badges: [
        { label: "Active programs", value: activePrograms },
        { label: "Programs", value: programs.length },
      ],
    });
  }

  if (comparisonBackedReports > 0) {
    queueCandidates.push({
      key: "review-comparison-backed-reports",
      title: "Review comparison-backed packet posture",
      detail: `${comparisonBackedReports} report${comparisonBackedReports === 1 ? " carries" : "s carry"} saved comparison context that can shape refresh and narrative choices.${firstComparisonBackedReport?.comparisonDigest?.detail ? ` ${firstComparisonBackedReport.comparisonDigest.detail}` : ""}`,
      href: "/reports?posture=comparison-backed",
      tone: "info",
      priority: 9,
      badges: [
        { label: "Comparison-backed", value: comparisonBackedReports },
        { label: "Ready comparisons", value: firstComparisonBackedReport?.comparisonAggregate?.readyComparisonSnapshotCount ?? null },
      ],
    });
  }

  const fullCommandQueue = queueCandidates.sort((left, right) => left.priority - right.priority);
  const commandQueue = fullCommandQueue.slice(0, 5);

  const nextCommand = commandQueue[0] ?? null;
  const posture = nextCommand
    ? nextCommand.tone === "warning" || nextCommand.tone === "danger"
      ? "attention"
      : "active"
    : "stable";

  const headline = nextCommand ? nextCommand.title : "Workspace command queue is clear";
  const detail = nextCommand
    ? nextCommand.detail
    : reports.length > 0
      ? `The current workspace has ${reports.length} report record${reports.length === 1 ? "" : "s"}, ${projects.length} project${projects.length === 1 ? "" : "s"}, and no immediate packet or funding-window pressure visible from this snapshot.`
      : "Create the next project, plan, program, or report record so the operations runtime has a real command surface to prioritize.";

  return {
    posture,
    headline,
    detail,
    counts: {
      projects: projects.length,
      activeProjects,
      plans: plans.length,
      plansNeedingSetup,
      programs: programs.length,
      activePrograms,
      reports: reports.length,
      reportRefreshRecommended,
      reportNoPacket,
      reportPacketCurrent,
      comparisonBackedReports,
      fundingOpportunities: fundingOpportunities.length,
      openFundingOpportunities,
      closingSoonFundingOpportunities,
      projectFundingNeedAnchorProjects: projectFundingNeedAnchorProjects.length,
      projectFundingSourcingProjects: fundingSourcingProjects.length,
      projectFundingDecisionProjects: fundingDecisionProjects.length,
      projectFundingAwardRecordProjects: fundingAwardRecordProjects.length,
      projectFundingReimbursementStartProjects: reimbursementStartProjects.length,
      projectFundingReimbursementActiveProjects: reimbursementAdvanceProjects.length,
      projectFundingGapProjects: fundingGapProjects.length,
      queueDepth: fullCommandQueue.length,
    },
    nextCommand,
    commandQueue,
    fullCommandQueue,
  };
}
