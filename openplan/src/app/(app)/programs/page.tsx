import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarClock, ClipboardList, FolderKanban, ShieldCheck } from "lucide-react";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { FundingOpportunityCreator } from "@/components/programs/funding-opportunity-creator";
import { ProgramCreator } from "@/components/programs/program-creator";
import { ReportPacketCommandQueue } from "@/components/reports/report-packet-command-queue";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";
import {
  formatFundingOpportunityDecisionLabel,
  buildProgramReadiness,
  buildProgramWorkflowSummary,
  formatFundingOpportunityStatusLabel,
  formatFiscalWindow,
  formatProgramFundingClassificationLabel,
  formatProgramDateTime,
  formatProgramStatusLabel,
  formatProgramTypeLabel,
  fundingOpportunityDecisionTone,
  fundingOpportunityStatusTone,
  programStatusTone,
} from "@/lib/programs/catalog";
import {
  getReportNavigationHref,
  getReportPacketFreshness,
  getReportPacketPriority,
} from "@/lib/reports/catalog";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number | string | null | undefined) {
  return currencyFormatter.format(Number(value ?? 0));
}

type ProgramsPageSearchParams = Promise<{
  projectId?: string;
  programType?: string;
  status?: string;
}>;

type ProgramRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  program_type: string;
  status: string;
  cycle_name: string;
  funding_classification: string | null;
  sponsor_agency: string | null;
  owner_label: string | null;
  cadence_label: string | null;
  fiscal_year_start: number | null;
  fiscal_year_end: number | null;
  nomination_due_at: string | null;
  adoption_target_at: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
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

type ProgramLinkRow = {
  program_id: string;
  link_type: string;
  linked_id: string;
};

type ProgramReportRow = {
  id: string;
  project_id: string | null;
  title: string | null;
  report_type: string | null;
  status: string | null;
  generated_at: string | null;
  latest_artifact_kind: string | null;
  updated_at: string | null;
};

type FundingOpportunityRow = {
  id: string;
  workspace_id: string;
  program_id: string | null;
  project_id: string | null;
  title: string;
  opportunity_status: string;
  decision_state: string;
  agency_name: string | null;
  owner_label: string | null;
  cadence_label: string | null;
  expected_award_amount: number | string | null;
  opens_at: string | null;
  closes_at: string | null;
  decision_due_at: string | null;
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

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: ProgramsPageSearchParams;
}) {
  const filters = await searchParams;
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

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Programs"
        title="Programs need a provisioned workspace"
        description="Programming-cycle records are workspace-scoped. This account is authenticated but not provisioned into a workspace yet, so showing an empty catalog here would be misleading."
      />
    );
  }

  const [
    { data: programsData },
    { data: projectsData },
    { data: fundingOpportunitiesData },
    { data: workspacePlansData },
    { data: workspaceReportsData },
    { data: projectFundingProfilesData },
  ] = await Promise.all([
    supabase
      .from("programs")
      .select(
        "id, workspace_id, project_id, title, program_type, status, cycle_name, funding_classification, sponsor_agency, owner_label, cadence_label, fiscal_year_start, fiscal_year_end, nomination_due_at, adoption_target_at, summary, created_at, updated_at, projects(id, name)"
      )
      .order("updated_at", { ascending: false }),
    supabase.from("projects").select("id, workspace_id, name, status, delivery_phase, updated_at").order("updated_at", { ascending: false }),
    supabase
      .from("funding_opportunities")
      .select(
        "id, workspace_id, program_id, project_id, title, opportunity_status, decision_state, agency_name, owner_label, cadence_label, expected_award_amount, opens_at, closes_at, decision_due_at, summary, created_at, updated_at, programs(id, title, funding_classification), projects(id, name)"
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("plans")
      .select("id, title, status, geography_label, horizon_year, project_id, updated_at")
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("reports")
      .select("id, title, status, latest_artifact_kind, generated_at, updated_at, metadata_json")
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("project_funding_profiles")
      .select("project_id, funding_need_amount, local_match_need_amount")
      .eq("workspace_id", membership.workspace_id),
  ]);

  const programs = (programsData ?? []) as ProgramRow[];
  const fundingOpportunities = ((fundingOpportunitiesData ?? []) as FundingOpportunityRow[])
    .map((opportunity) => ({
      ...opportunity,
      program: Array.isArray(opportunity.programs) ? (opportunity.programs[0] ?? null) : opportunity.programs ?? null,
      project: Array.isArray(opportunity.projects) ? (opportunity.projects[0] ?? null) : opportunity.projects ?? null,
    }))
    .sort((left, right) => {
      const priority = (value: string) => {
        if (value === "open") return 0;
        if (value === "upcoming") return 1;
        if (value === "closed") return 2;
        if (value === "awarded") return 3;
        return 4;
      };

      const priorityDelta = priority(left.opportunity_status) - priority(right.opportunity_status);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const leftTime = new Date(left.closes_at ?? left.opens_at ?? left.updated_at).getTime();
      const rightTime = new Date(right.closes_at ?? right.opens_at ?? right.updated_at).getTime();
      return leftTime - rightTime;
    });
  const programIds = programs.map((program) => program.id);
  const projectIds = [...new Set(programs.map((program) => program.project_id).filter((value): value is string => Boolean(value)))];

  const [linksResult, plansResult, projectReportsResult, campaignsResult] = await Promise.all([
    programIds.length
      ? supabase.from("program_links").select("program_id, link_type, linked_id").in("program_id", programIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length ? supabase.from("plans").select("id, project_id").in("project_id", projectIds) : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase
          .from("reports")
          .select(
            "id, project_id, title, report_type, status, generated_at, latest_artifact_kind, updated_at"
          )
          .in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from("engagement_campaigns").select("id, project_id").in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const linksByProgram = new Map<string, ProgramLinkRow[]>();
  for (const link of (linksResult.data ?? []) as ProgramLinkRow[]) {
    const current = linksByProgram.get(link.program_id) ?? [];
    current.push(link);
    linksByProgram.set(link.program_id, current);
  }

  const explicitReportIds = Array.from(
    new Set(
      ((linksResult.data ?? []) as ProgramLinkRow[])
        .filter((link) => link.link_type === "report")
        .map((link) => link.linked_id)
    )
  );

  const explicitReportsResult = explicitReportIds.length
    ? await supabase
        .from("reports")
        .select(
          "id, project_id, title, report_type, status, generated_at, latest_artifact_kind, updated_at"
        )
        .in("id", explicitReportIds)
    : { data: [], error: null };

  const planCountsByProject = new Map<string, number>();
  for (const row of plansResult.data ?? []) {
    if (!row.project_id) continue;
    planCountsByProject.set(row.project_id, (planCountsByProject.get(row.project_id) ?? 0) + 1);
  }

  const reportsByProject = new Map<
    string,
    Array<
      ProgramReportRow & {
        packetFreshness: ReturnType<typeof getReportPacketFreshness>;
      }
    >
  >();
  const explicitReportById = new Map<
    string,
    ProgramReportRow & {
      packetFreshness: ReturnType<typeof getReportPacketFreshness>;
    }
  >();
  const reportCountsByProject = new Map<string, number>();
  const generatedReportCountsByProject = new Map<string, number>();
  for (const row of (projectReportsResult.data ?? []) as ProgramReportRow[]) {
    if (!row.project_id) continue;
    const hydratedRow = {
      ...row,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: row.latest_artifact_kind,
        generatedAt: row.generated_at,
        updatedAt: row.updated_at,
      }),
    };
    const current = reportsByProject.get(row.project_id) ?? [];
    current.push(hydratedRow);
    reportsByProject.set(row.project_id, current);
    reportCountsByProject.set(row.project_id, (reportCountsByProject.get(row.project_id) ?? 0) + 1);
    if (row.status === "generated") {
      generatedReportCountsByProject.set(row.project_id, (generatedReportCountsByProject.get(row.project_id) ?? 0) + 1);
    }
  }

  for (const row of (explicitReportsResult.data ?? []) as ProgramReportRow[]) {
    explicitReportById.set(row.id, {
      ...row,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: row.latest_artifact_kind,
        generatedAt: row.generated_at,
        updatedAt: row.updated_at,
      }),
    });
  }

  const campaignCountsByProject = new Map<string, number>();
  for (const row of campaignsResult.data ?? []) {
    if (!row.project_id) continue;
    campaignCountsByProject.set(row.project_id, (campaignCountsByProject.get(row.project_id) ?? 0) + 1);
  }

  const allTypedPrograms = programs
    .map((program) => {
      const project = Array.isArray(program.projects) ? program.projects[0] ?? null : program.projects ?? null;
      const links = linksByProgram.get(program.id) ?? [];
      const explicitPlanCount = links.filter((link) => link.link_type === "plan").length;
      const explicitReportCount = links.filter((link) => link.link_type === "report").length;
      const explicitCampaignCount = links.filter((link) => link.link_type === "engagement_campaign").length;
      const explicitProjectCount = links.filter((link) => link.link_type === "project_record").length;
      const planCount = explicitPlanCount + (program.project_id ? planCountsByProject.get(program.project_id) ?? 0 : 0);
      const reportCount = explicitReportCount + (program.project_id ? reportCountsByProject.get(program.project_id) ?? 0 : 0);
      const engagementCampaignCount =
        explicitCampaignCount + (program.project_id ? campaignCountsByProject.get(program.project_id) ?? 0 : 0);
      const generatedReportCount =
        explicitReportCount + (program.project_id ? generatedReportCountsByProject.get(program.project_id) ?? 0 : 0);
      const linkedReports = new Map<
        string,
        ProgramReportRow & {
          packetFreshness: ReturnType<typeof getReportPacketFreshness>;
        }
      >();
      for (const report of program.project_id ? reportsByProject.get(program.project_id) ?? [] : []) {
        linkedReports.set(report.id, report);
      }
      for (const link of links.filter((item) => item.link_type === "report")) {
        const explicitReport = explicitReportById.get(link.linked_id);
        if (explicitReport) {
          linkedReports.set(explicitReport.id, explicitReport);
        }
      }
      const sortedLinkedReports = [...linkedReports.values()].sort((left, right) => {
        const freshnessPriority =
          getReportPacketPriority(left.packetFreshness.label) -
          getReportPacketPriority(right.packetFreshness.label);
        if (freshnessPriority !== 0) {
          return freshnessPriority;
        }

        return new Date(right.updated_at ?? 0).getTime() - new Date(left.updated_at ?? 0).getTime();
      });
      const packetAttentionCount = sortedLinkedReports.filter(
        (report) =>
          report.packetFreshness.label === "Refresh recommended" ||
          report.packetFreshness.label === "No packet"
      ).length;
      const recommendedReport = sortedLinkedReports[0] ?? null;
      const readiness = buildProgramReadiness({
        cycleName: program.cycle_name,
        hasProject: Boolean(program.project_id || explicitProjectCount > 0),
        planCount,
        reportCount,
        engagementCampaignCount,
        sponsorAgency: program.sponsor_agency,
        fiscalYearStart: program.fiscal_year_start,
        fiscalYearEnd: program.fiscal_year_end,
        nominationDueAt: program.nomination_due_at,
        adoptionTargetAt: program.adoption_target_at,
      });

      return {
        ...program,
        project,
        readiness,
        linkageCounts: {
          plans: planCount,
          reports: reportCount,
          engagementCampaigns: engagementCampaignCount,
          relatedProjects: explicitProjectCount + (program.project_id ? 1 : 0),
        },
        packetSummary: {
          linkedReportCount: sortedLinkedReports.length,
          attentionCount: packetAttentionCount,
          noPacketCount: sortedLinkedReports.filter(
            (report) => report.packetFreshness.label === "No packet"
          ).length,
          refreshRecommendedCount: sortedLinkedReports.filter(
            (report) => report.packetFreshness.label === "Refresh recommended"
          ).length,
          recommendedReport,
        },
        workflow: buildProgramWorkflowSummary({
          programStatus: program.status,
          readiness,
          planCount,
          reportCount,
          generatedReportCount,
          engagementCampaignCount,
          approvedEngagementItemCount: 0,
          pendingEngagementItemCount: 0,
        }),
      };
    });

  const typedPrograms = allTypedPrograms
    .filter((program) => (filters.projectId ? program.project_id === filters.projectId : true))
    .filter((program) => (filters.programType ? program.program_type === filters.programType : true))
    .filter((program) => (filters.status ? program.status === filters.status : true));

  const packetQueuePrograms = typedPrograms
    .filter(
      (program) =>
        program.packetSummary.attentionCount > 0 ||
        program.packetSummary.linkedReportCount === 0
    )
    .sort((left, right) => {
      const leftPriority = left.packetSummary.attentionCount > 0 ? 0 : 1;
      const rightPriority = right.packetSummary.attentionCount > 0 ? 0 : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });
  const packetSummaryByProgramId = new Map(
    typedPrograms.map((program) => [program.id, program.packetSummary] as const)
  );

  const activeCount = typedPrograms.filter((program) => ["assembling", "submitted", "programmed"].includes(program.status)).length;
  const readyCount = typedPrograms.filter((program) => program.readiness.ready).length;
  const rtipStipCount = typedPrograms.filter((program) => ["rtip", "stip"].includes(program.program_type)).length;
  const packetAttentionProgramCount = typedPrograms.filter(
    (program) => program.packetSummary.attentionCount > 0
  ).length;

  const operationsSummary = buildWorkspaceOperationsSummaryFromSourceRows({
    projects: ((projectsData ?? []) as Array<{
      id: string;
      name: string;
      status: string | null;
      delivery_phase: string | null;
      updated_at: string | null;
    }>),
    plans: ((workspacePlansData ?? []) as Array<{
      id: string;
      title: string;
      status: string | null;
      geography_label: string | null;
      horizon_year: number | null;
      project_id: string | null;
      updated_at: string | null;
    }>),
    programs: allTypedPrograms,
    reports: ((workspaceReportsData ?? []) as Array<{
      id: string;
      title: string | null;
      status: string | null;
      latest_artifact_kind: string | null;
      generated_at: string | null;
      updated_at: string | null;
      metadata_json: Record<string, unknown> | null;
    }>),
    fundingOpportunities: fundingOpportunities,
    projectFundingProfiles: ((projectFundingProfilesData ?? []) as Array<{
      project_id: string;
      funding_need_amount: number | string | null;
      local_match_need_amount?: number | string | null;
    }>),
  });
  const opportunityPacketRiskCount = fundingOpportunities.filter((opportunity) => {
    if (!opportunity.program_id) return true;
    const packetSummary = packetSummaryByProgramId.get(opportunity.program_id);
    return Boolean(
      packetSummary &&
        (packetSummary.attentionCount > 0 || packetSummary.linkedReportCount === 0)
    );
  }).length;
  const opportunityQueueItems = fundingOpportunities
    .filter((opportunity) => {
      if (!opportunity.program_id) return true;
      const packetSummary = packetSummaryByProgramId.get(opportunity.program_id);
      return Boolean(
        packetSummary &&
          (packetSummary.attentionCount > 0 || packetSummary.linkedReportCount === 0)
      );
    })
    .slice(0, 5)
    .map((opportunity) => {
      const packetSummary = opportunity.program_id
        ? packetSummaryByProgramId.get(opportunity.program_id)
        : null;
      const recommendedReport = packetSummary?.recommendedReport ?? null;

      return {
        key: opportunity.id,
        href: recommendedReport
          ? getReportNavigationHref(
              recommendedReport.id,
              recommendedReport.packetFreshness.label
            )
          : opportunity.program_id
            ? `/programs/${opportunity.program_id}`
            : "/programs",
        title: opportunity.title,
        subtitle: opportunity.program
          ? `Program ${opportunity.program.title}`
          : "No linked program",
        detail: recommendedReport
          ? recommendedReport.packetFreshness.detail
          : opportunity.program_id
            ? "Linked program has no packet outputs yet. Open the program record to create or attach the first packet."
            : "Link this opportunity to a program so packet readiness and delivery context are visible in one place.",
        badges: [
          { label: formatFundingOpportunityStatusLabel(opportunity.opportunity_status) },
          { label: formatFundingOpportunityDecisionLabel(opportunity.decision_state) },
          ...(packetSummary
            ? [
                { label: "Program reports", value: packetSummary.linkedReportCount },
                ...(packetSummary.attentionCount > 0
                  ? [{ label: "Packet attention", value: packetSummary.attentionCount }]
                  : []),
              ]
            : []),
        ],
      };
    });
  const openOpportunityCount = fundingOpportunities.filter((opportunity) => opportunity.opportunity_status === "open").length;
  const upcomingOpportunityCount = fundingOpportunities.filter((opportunity) => opportunity.opportunity_status === "upcoming").length;
  const likelyOpportunityAmount = fundingOpportunities.reduce((sum, opportunity) => {
    if (opportunity.decision_state !== "pursue" || opportunity.opportunity_status === "awarded" || opportunity.opportunity_status === "archived") {
      return sum;
    }
    return sum + Number(opportunity.expected_award_amount ?? 0);
  }, 0);

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <ClipboardList className="h-3.5 w-3.5" />
            Programs module live
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Programs</h1>
            <p className="module-intro-description">
              Track funding cycles, submissions, and linked planning work in one place.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Programs</p>
              <p className="module-summary-value">{typedPrograms.length}</p>
              <p className="module-summary-detail">Cycle and package records in the current workspace catalog.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Active programs</p>
              <p className="module-summary-value">{activeCount}</p>
              <p className="module-summary-detail">{rtipStipCount} tied to RTIP or STIP cycles.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Ready to submit</p>
              <p className="module-summary-value">{readyCount}</p>
              <p className="module-summary-detail">Programs with the key information in place for review or submission.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Packet attention</p>
              <p className="module-summary-value">{packetAttentionProgramCount}</p>
              <p className="module-summary-detail">Programs whose linked report packets need first generation or refresh.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Programming</p>
              <h2 className="module-operator-title">Keep funding information clear and easy to review</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Keep cycle timing, sponsor agency, linked plans, and submission materials together in one place.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Primary project links inherit relevant plans, reports, and engagement records.</div>
            <div className="module-operator-item">Additional program links preserve cross-project and cross-record package context.</div>
            <div className="module-operator-item">Missing schedule or packet basis shows up as an explicit gap, never a hidden score.</div>
          </div>
          <div className="mt-4">
            <WorkspaceRuntimeCue summary={operationsSummary} />
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
        <div className="space-y-6">
          <ProgramCreator projects={projectsData ?? []} />
          <WorkspaceCommandBoard
            summary={operationsSummary}
            label="Workspace command board"
            title="What should move before another program revision"
            description="The Programs lane now shares the same workspace command queue used by the dashboard, Plans, and assistant runtime, so packet pressure, funding timing, and setup gaps stay visible while you work package records."
          />
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Catalog</p>
              <h2 className="module-section-title">Programming cycle records</h2>
              <p className="module-section-description">
                Review package posture by status, lane, or linked project and jump straight into the cycle record.
              </p>
            </div>
            <span className="module-inline-item">
              <FolderKanban className="h-3.5 w-3.5" />
              <strong>{typedPrograms.length}</strong> total
            </span>
          </div>

          {typedPrograms.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No programming cycles yet"
                description="Create a program record to track RTIP/STIP package readiness, timing, and supporting records."
              />
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <ReportPacketCommandQueue
                title="Program packet queue"
                description="The highest-priority packet actions across programming cycles, ordered before the full registry below."
                items={packetQueuePrograms.slice(0, 5).map((program) => ({
                  key: program.id,
                  href: program.packetSummary.recommendedReport
                    ? getReportNavigationHref(
                        program.packetSummary.recommendedReport.id,
                        program.packetSummary.recommendedReport.packetFreshness.label
                      )
                    : `/programs/${program.id}`,
                  title: program.title,
                  subtitle: program.packetSummary.recommendedReport
                    ? program.packetSummary.recommendedReport.packetFreshness.label === "Refresh recommended"
                      ? `First action: refresh ${program.packetSummary.recommendedReport.title ?? "report packet"}`
                      : program.packetSummary.recommendedReport.packetFreshness.label === "No packet"
                        ? `First action: generate ${program.packetSummary.recommendedReport.title ?? "report packet"}`
                        : `First action: review ${program.packetSummary.recommendedReport.title ?? "report packet"}`
                    : `First action: create the first packet for ${program.title}`,
                  detail: program.packetSummary.recommendedReport
                    ? program.packetSummary.recommendedReport.packetFreshness.detail
                    : "No packet outputs are linked yet. Open the program record to attach or create the first report packet.",
                  badges: [
                    { label: "Reports", value: program.packetSummary.linkedReportCount },
                    ...(program.packetSummary.attentionCount > 0
                      ? [{ label: "Attention", value: program.packetSummary.attentionCount }]
                      : []),
                  ],
                }))}
                emptyLabel="No program packet work is queued right now."
              />

              <div className="module-record-list">
              {typedPrograms.map((program) => (
                <Link
                  key={program.id}
                  href={`/programs/${program.id}`}
                  className="module-record-row is-interactive group block"
                >
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={programStatusTone(program.status)}>
                          {formatProgramStatusLabel(program.status)}
                        </StatusBadge>
                        <StatusBadge tone="info">{formatProgramTypeLabel(program.program_type)}</StatusBadge>
                        <StatusBadge tone={program.readiness.tone}>{program.readiness.label}</StatusBadge>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">
                            {program.title}
                          </h3>
                          <p className="module-record-stamp">Updated {formatProgramDateTime(program.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {program.summary || program.workflow.reason}
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>

                  <div className="module-record-meta">
                    <span className="module-record-chip">Cycle {program.cycle_name}</span>
                    <span className="module-record-chip">
                      {formatProgramFundingClassificationLabel(program.funding_classification)}
                    </span>
                    <span className="module-record-chip">Window {formatFiscalWindow(program.fiscal_year_start, program.fiscal_year_end)}</span>
                    <span className="module-record-chip">Project {program.project?.name ?? "No primary project"}</span>
                    <span className="module-record-chip">Owner {program.owner_label ?? "Unassigned"}</span>
                    <span className="module-record-chip">Cadence {program.cadence_label ?? "Not set"}</span>
                    <span className="module-record-chip">Plans {program.linkageCounts.plans}</span>
                    <span className="module-record-chip">Reports {program.linkageCounts.reports}</span>
                    <span className="module-record-chip">Campaigns {program.linkageCounts.engagementCampaigns}</span>
                    {program.packetSummary.attentionCount > 0 ? (
                      <span className="module-record-chip">Packet attention {program.packetSummary.attentionCount}</span>
                    ) : null}
                    {program.packetSummary.refreshRecommendedCount > 0 ? (
                      <span className="module-record-chip">Refresh {program.packetSummary.refreshRecommendedCount}</span>
                    ) : null}
                    {program.packetSummary.noPacketCount > 0 ? (
                      <span className="module-record-chip">No packet {program.packetSummary.noPacketCount}</span>
                    ) : null}
                  </div>

                  <div className="mt-3 border-t border-border/70 pt-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Packet command
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {program.packetSummary.recommendedReport
                        ? program.packetSummary.recommendedReport.packetFreshness.label === "Refresh recommended"
                          ? `Refresh ${program.packetSummary.recommendedReport.title ?? "report packet"}`
                          : program.packetSummary.recommendedReport.packetFreshness.label === "No packet"
                            ? `Generate ${program.packetSummary.recommendedReport.title ?? "report packet"}`
                            : `Review ${program.packetSummary.recommendedReport.title ?? "report packet"}`
                        : "Create the first packet trail"}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {program.packetSummary.recommendedReport
                        ? program.packetSummary.recommendedReport.packetFreshness.detail
                        : "No linked report packets yet. Open the program to attach or create the first packet record."}
                    </p>
                  </div>
                </Link>
              ))}
              </div>
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <FundingOpportunityCreator
          programs={typedPrograms.map((program) => ({ id: program.id, title: program.title }))}
          projects={(projectsData ?? []).map((project) => ({ id: project.id, name: project.name }))}
          title="Log a funding opportunity"
          description="Keep open and upcoming opportunities visible even before a full grant workspace exists."
        />

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Funding catalog</p>
              <h2 className="module-section-title">Active and upcoming opportunities</h2>
              <p className="module-section-description">
                Early Grants OS backbone: track calls, timing, ownership, and linked program/project context in the shared catalog.
              </p>
            </div>
            <span className="module-inline-item">
              <CalendarClock className="h-3.5 w-3.5" />
              <strong>{fundingOpportunities.length}</strong> tracked
            </span>
          </div>

          <div className="module-summary-grid cols-4 mt-5">
            <div className="module-summary-card">
              <p className="module-summary-label">Open now</p>
              <p className="module-summary-value">{openOpportunityCount}</p>
              <p className="module-summary-detail">Current calls needing active packaging work.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Upcoming</p>
              <p className="module-summary-value">{upcomingOpportunityCount}</p>
              <p className="module-summary-detail">Expected calls or known windows not yet open.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Program-linked</p>
              <p className="module-summary-value">{fundingOpportunities.filter((item) => item.program_id).length}</p>
              <p className="module-summary-detail">Opportunities already tied to a funding cycle record.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Likely dollars</p>
              <p className="module-summary-value text-base leading-tight">{formatCurrency(likelyOpportunityAmount)}</p>
              <p className="module-summary-detail">Expected dollars attached to pursue decisions in the shared catalog.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Packet-risky opportunities</p>
              <p className="module-summary-value">{opportunityPacketRiskCount}</p>
              <p className="module-summary-detail">Opportunities whose linked program packet basis is missing, stale, or not linked yet.</p>
            </div>
          </div>

          {fundingOpportunities.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No funding opportunities logged yet"
                description="Create the first opportunity so active calls and upcoming cycles can live beside program records."
              />
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <ReportPacketCommandQueue
                title="Opportunity packet queue"
                description="Open or upcoming opportunities whose linked program packet basis still needs attention."
                items={opportunityQueueItems}
                emptyLabel="No packet-risky opportunities right now."
              />

              <div className="module-record-list">
              {fundingOpportunities.map((opportunity) => (
                <div key={opportunity.id} className="module-record-row">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={fundingOpportunityStatusTone(opportunity.opportunity_status)}>
                          {formatFundingOpportunityStatusLabel(opportunity.opportunity_status)}
                        </StatusBadge>
                        <StatusBadge tone={fundingOpportunityDecisionTone(opportunity.decision_state)}>
                          {formatFundingOpportunityDecisionLabel(opportunity.decision_state)}
                        </StatusBadge>
                        {opportunity.program ? (
                          <StatusBadge tone="info">{opportunity.program.title}</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">No linked program</StatusBadge>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem]">{opportunity.title}</h3>
                          <p className="module-record-stamp">Updated {formatProgramDateTime(opportunity.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {opportunity.summary || "No summary on file yet for this funding opportunity."}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="module-record-meta">
                    <span className="module-record-chip">Agency {opportunity.agency_name ?? "Not set"}</span>
                    <span className="module-record-chip">Owner {opportunity.owner_label ?? "Unassigned"}</span>
                    <span className="module-record-chip">Cadence {opportunity.cadence_label ?? "Not set"}</span>
                    <span className="module-record-chip">Likely {formatCurrency(opportunity.expected_award_amount)}</span>
                    <span className="module-record-chip">Opens {formatProgramDateTime(opportunity.opens_at)}</span>
                    <span className="module-record-chip">Closes {formatProgramDateTime(opportunity.closes_at)}</span>
                    <span className="module-record-chip">Decision {formatProgramDateTime(opportunity.decision_due_at)}</span>
                    <span className="module-record-chip">Project {opportunity.project?.name ?? "None"}</span>
                    {opportunity.program_id && packetSummaryByProgramId.get(opportunity.program_id)?.attentionCount ? (
                      <span className="module-record-chip">
                        Packet attention {packetSummaryByProgramId.get(opportunity.program_id)?.attentionCount}
                      </span>
                    ) : null}
                    {opportunity.program_id && packetSummaryByProgramId.get(opportunity.program_id)?.linkedReportCount === 0 ? (
                      <span className="module-record-chip">No program packet</span>
                    ) : null}
                    {!opportunity.program_id ? (
                      <span className="module-record-chip">Program link needed</span>
                    ) : null}
                  </div>
                </div>
              ))}
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
