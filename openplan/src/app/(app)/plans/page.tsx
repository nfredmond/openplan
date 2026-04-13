import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileStack, FolderKanban, ShieldCheck } from "lucide-react";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { PlanCreator } from "@/components/plans/plan-creator";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";
import {
  buildPlanArtifactCoverage,
  buildPlanReadiness,
  buildPlanWorkflowSummary,
  formatPlanDateTime,
  formatPlanStatusLabel,
  formatPlanTypeLabel,
  PLAN_STATUS_OPTIONS,
  PLAN_TYPE_OPTIONS,
} from "@/lib/plans/catalog";

type PlansPageSearchParams = Promise<{
  projectId?: string;
  planType?: string;
  status?: string;
}>;

type PlanRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  plan_type: string;
  status: string;
  geography_label: string | null;
  horizon_year: number | null;
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

type PlanLinkRow = {
  plan_id: string;
  link_type: string;
};

export default async function PlansPage({
  searchParams,
}: {
  searchParams: PlansPageSearchParams;
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
        moduleLabel="Plans"
        title="Plans need a provisioned workspace"
        description="Plan records only appear inside a real workspace. You are signed in, but no workspace membership was found for this account, so the catalog would otherwise look empty for ambiguous reasons."
      />
    );
  }

  const [{ data: plansData }, { data: projectsData }, { data: programsData }, { data: fundingOpportunitiesData }, { data: workspaceReportsData }, { data: projectFundingProfilesData }] = await Promise.all([
    supabase
      .from("plans")
      .select(
        "id, workspace_id, project_id, title, plan_type, status, geography_label, horizon_year, summary, created_at, updated_at, projects(id, name)"
      )
      .order("updated_at", { ascending: false }),
    supabase.from("projects").select("id, workspace_id, name, status, delivery_phase, updated_at").order("updated_at", { ascending: false }),
    supabase
      .from("programs")
      .select("id, title, status, nomination_due_at, adoption_target_at, updated_at")
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("funding_opportunities")
      .select(
        "id, title, opportunity_status, decision_state, expected_award_amount, closes_at, decision_due_at, program_id, project_id, updated_at"
      )
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

  const plans = (plansData ?? []) as PlanRow[];
  const planIds = plans.map((plan) => plan.id);
  const projectIds = [...new Set(plans.map((plan) => plan.project_id).filter((value): value is string => Boolean(value)))];

  const [planLinksResult, scenarioResult, campaignResult, reportResult] = await Promise.all([
    planIds.length
      ? supabase.from("plan_links").select("plan_id, link_type").in("plan_id", planIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from("scenario_sets").select("id, project_id").in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from("engagement_campaigns").select("id, project_id").in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from("reports").select("id, project_id").in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const linksByPlan = new Map<string, PlanLinkRow[]>();
  for (const link of (planLinksResult.data ?? []) as PlanLinkRow[]) {
    const current = linksByPlan.get(link.plan_id) ?? [];
    current.push(link);
    linksByPlan.set(link.plan_id, current);
  }

  const scenarioCountsByProject = new Map<string, number>();
  for (const row of scenarioResult.data ?? []) {
    if (!row.project_id) continue;
    scenarioCountsByProject.set(row.project_id, (scenarioCountsByProject.get(row.project_id) ?? 0) + 1);
  }

  const campaignCountsByProject = new Map<string, number>();
  for (const row of campaignResult.data ?? []) {
    if (!row.project_id) continue;
    campaignCountsByProject.set(row.project_id, (campaignCountsByProject.get(row.project_id) ?? 0) + 1);
  }

  const reportCountsByProject = new Map<string, number>();
  for (const row of reportResult.data ?? []) {
    if (!row.project_id) continue;
    reportCountsByProject.set(row.project_id, (reportCountsByProject.get(row.project_id) ?? 0) + 1);
  }

  const allTypedPlans = plans
    .map((plan) => {
      const project = Array.isArray(plan.projects) ? plan.projects[0] ?? null : plan.projects ?? null;
      const planLinks = linksByPlan.get(plan.id) ?? [];
      const explicitProjectCount = planLinks.filter((link) => link.link_type === "project_record").length;
      const explicitScenarioCount = planLinks.filter((link) => link.link_type === "scenario_set").length;
      const explicitCampaignCount = planLinks.filter((link) => link.link_type === "engagement_campaign").length;
      const explicitReportCount = planLinks.filter((link) => link.link_type === "report").length;
      const scenarioCount = explicitScenarioCount + (plan.project_id ? scenarioCountsByProject.get(plan.project_id) ?? 0 : 0);
      const engagementCampaignCount =
        explicitCampaignCount + (plan.project_id ? campaignCountsByProject.get(plan.project_id) ?? 0 : 0);
      const reportCount = explicitReportCount + (plan.project_id ? reportCountsByProject.get(plan.project_id) ?? 0 : 0);

      return {
        ...plan,
        project,
        readiness: buildPlanReadiness({
          hasProject: Boolean(plan.project_id || explicitProjectCount > 0),
          scenarioCount,
          engagementCampaignCount,
          reportCount,
          geographyLabel: plan.geography_label,
          horizonYear: plan.horizon_year,
        }),
        artifactCoverage: buildPlanArtifactCoverage({
          scenarioCount,
          engagementCampaignCount,
          reportCount,
        }),
        linkageCounts: {
          scenarios: scenarioCount,
          engagementCampaigns: engagementCampaignCount,
          reports: reportCount,
        },
      };
    })
    .map((plan) => ({
      ...plan,
      workflow: buildPlanWorkflowSummary({
        planStatus: plan.status,
        readiness: plan.readiness,
        linkedProjectCount: plan.project ? 1 : 0,
        explicitLinkCount: (linksByPlan.get(plan.id) ?? []).length,
        relatedProjectCount: plan.project ? 1 : 0,
        scenarioCount: plan.linkageCounts.scenarios,
        readyScenarioCount: 0,
        engagementCampaignCount: plan.linkageCounts.engagementCampaigns,
        pendingEngagementItemCount: 0,
        flaggedEngagementItemCount: 0,
        reportCount: plan.linkageCounts.reports,
        generatedReportCount: 0,
        reportArtifactCount: 0,
      }),
    }));

  const typedPlans = allTypedPlans
    .filter((plan) => (filters.projectId ? plan.project_id === filters.projectId : true))
    .filter((plan) => (filters.planType ? plan.plan_type === filters.planType : true))
    .filter((plan) => (filters.status ? plan.status === filters.status : true));

  const activeCount = typedPlans.filter((plan) => plan.status === "active").length;
  const adoptedCount = typedPlans.filter((plan) => plan.status === "adopted").length;
  const readyFoundationCount = typedPlans.filter((plan) => plan.readiness.ready).length;

  const operationsSummary = await loadWorkspaceOperationsSummaryForWorkspace(
    supabase as unknown as WorkspaceOperationsSupabaseLike,
    membership.workspace_id
  );

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <FileStack className="h-3.5 w-3.5" />
            Plans registry live
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Plans</h1>
            <p className="module-intro-description">
              Organize corridor plans, ATPs, safety plans, and regional plans alongside the rest of your project work.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Plans</p>
              <p className="module-summary-value">{typedPlans.length}</p>
              <p className="module-summary-detail">Formal planning objects tracked in the current workspace catalog.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Active or adopted</p>
              <p className="module-summary-value">{activeCount + adoptedCount}</p>
              <p className="module-summary-detail">{adoptedCount} already marked as adopted.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Foundation ready</p>
              <p className="module-summary-value">{readyFoundationCount}</p>
              <p className="module-summary-detail">Plans with the core information in place for review.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Planning records</p>
              <h2 className="module-operator-title">Keep plan information clear and reviewable</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Keep plan records connected to related projects, scenarios, engagement work, and reports.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Plans can link to one primary project and other related projects.</div>
            <div className="module-operator-item">Scenario, engagement, and report links stay visible from the plan record.</div>
            <div className="module-operator-item">Review status shows what is complete and what still needs attention.</div>
          </div>
          <div className="mt-4">
            <WorkspaceRuntimeCue summary={operationsSummary} />
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
        <div className="space-y-6">
          <PlanCreator projects={projectsData ?? []} />
          <WorkspaceCommandBoard
            summary={operationsSummary}
            label="Workspace command board"
            title="What should move before another plan revision"
            description="The Plans lane now shares the same workspace command queue used by the dashboard and assistant runtime, so packet pressure and setup gaps stay visible while you work the registry."
          />
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Catalog</p>
              <h2 className="module-section-title">Plan records in this workspace</h2>
              <p className="module-section-description">
                Filter by project, type, or status to isolate the plans that are ready for attention.
              </p>
            </div>
            <span className="module-record-chip">
              <FolderKanban className="h-3.5 w-3.5" />
              <span>Total</span>
              <strong>{typedPlans.length}</strong>
            </span>
          </div>

          <form className="mt-5 grid gap-3 border border-border/70 bg-background/70 p-4 md:grid-cols-3">
            <select
              name="projectId"
              defaultValue={filters.projectId ?? ""}
              className="module-select h-10 rounded-none"
            >
              <option value="">All projects</option>
              {(projectsData ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>

            <select
              name="planType"
              defaultValue={filters.planType ?? ""}
              className="module-select h-10 rounded-none"
            >
              <option value="">All plan types</option>
              {PLAN_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <div className="flex gap-3">
              <select
                name="status"
                defaultValue={filters.status ?? ""}
                className="module-select h-10 rounded-none"
              >
                <option value="">All statuses</option>
                {PLAN_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="h-10 shrink-0 border border-border bg-card px-4 text-sm font-medium"
              >
                Apply
              </button>
            </div>
          </form>

          {typedPlans.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No plans yet"
                description="Create the first plan record to organize scope, links, and review status."
              />
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {typedPlans.map((plan) => (
                <Link key={plan.id} href={`/plans/${plan.id}`} className="module-record-row is-interactive group block">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <span className="module-record-chip"><span>Status</span><strong>{formatPlanStatusLabel(plan.status)}</strong></span>
                        <span className="module-record-chip"><span>Type</span><strong>{formatPlanTypeLabel(plan.plan_type)}</strong></span>
                        <span className="module-record-chip"><span>Readiness</span><strong>{plan.readiness.label}</strong></span>
                        <span className="module-record-chip"><span>Workflow</span><strong>{plan.workflow.label}</strong></span>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">
                            {plan.title}
                          </h3>
                          <p className="module-record-stamp">Updated {formatPlanDateTime(plan.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {plan.summary ||
                            "No summary yet. Open the plan to inspect linked scenarios, engagement campaigns, reports, and readiness basis."}
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>

                  <div className="module-record-meta">
                    <span className="module-record-chip"><span>Project</span><strong>{plan.project?.name ?? "Unlinked"}</strong></span>
                    <span className="module-record-chip">
                      <span>Geography</span>
                      <strong>{plan.geography_label ? plan.geography_label : "Pending"}</strong>
                    </span>
                    <span className="module-record-chip">
                      <span>Horizon</span>
                      <strong>{plan.horizon_year ? plan.horizon_year : "Pending"}</strong>
                    </span>
                    <span className="module-record-chip"><span>Coverage</span><strong>{plan.artifactCoverage.label}</strong></span>
                    <span className="module-record-chip"><span>Output</span><strong>{plan.workflow.planningOutputLabel}</strong></span>
                    <span className="module-record-chip">
                      <span>Readiness</span>
                      <strong>{plan.readiness.missingCheckCount > 0 ? `${plan.readiness.missingCheckCount} gaps` : "Clear"}</strong>
                    </span>
                    <span className="module-record-chip"><span>Scenarios</span><strong>{plan.linkageCounts.scenarios}</strong></span>
                    <span className="module-record-chip"><span>Campaigns</span><strong>{plan.linkageCounts.engagementCampaigns}</strong></span>
                    <span className="module-record-chip"><span>Reports</span><strong>{plan.linkageCounts.reports}</strong></span>
                  </div>

                  {plan.readiness.missingCheckLabels.length > 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Missing basis: {plan.readiness.missingCheckLabels.join(", ")}.
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">{plan.workflow.reason}</p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
