import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileStack, FolderKanban, MessagesSquare, Radar, ScrollText, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
import {
  buildPlanReadiness,
  formatPlanDateTime,
  formatPlanLinkTypeLabel,
  formatPlanStatusLabel,
  formatPlanTypeLabel,
  planStatusTone,
} from "@/lib/plans/catalog";

type LinkedArtifactBase = {
  id: string;
  title: string | null;
  status: string | null;
  project_id: string | null;
  updated_at: string | null;
};

type LinkedArtifact = LinkedArtifactBase & {
  linkBasis: "project" | "plan_link" | "both";
};

type LinkedProjectBase = LinkedArtifactBase & {
  summary?: string | null;
  plan_type?: string | null;
  delivery_phase?: string | null;
};

type LinkedProject = LinkedProjectBase & {
  linkBasis: "project" | "plan_link" | "both";
};

function mergeArtifacts<T extends { id: string }>(
  projectItems: T[],
  explicitItems: T[]
): Array<T & { linkBasis: "project" | "plan_link" | "both" }> {
  const merged = new Map<string, T & { linkBasis: "project" | "plan_link" | "both" }>();

  for (const item of projectItems) {
    merged.set(item.id, { ...item, linkBasis: "project" });
  }

  for (const item of explicitItems) {
    const current = merged.get(item.id);
    if (current) {
      merged.set(item.id, { ...current, ...item, linkBasis: "both" });
      continue;
    }
    merged.set(item.id, { ...item, linkBasis: "plan_link" });
  }

  return [...merged.values()];
}

function linkBasisLabel(value: "project" | "plan_link" | "both"): string {
  if (value === "both") return "Project + plan link";
  if (value === "project") return "From primary project";
  return "Explicit plan link";
}

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: plan } = await supabase
    .from("plans")
    .select(
      "id, workspace_id, project_id, title, plan_type, status, geography_label, horizon_year, summary, created_at, updated_at"
    )
    .eq("id", planId)
    .maybeSingle();

  if (!plan) {
    notFound();
  }

  const [projectResult, planLinksResult, projectScenariosResult, projectCampaignsResult, projectReportsResult] =
    await Promise.all([
      plan.project_id
        ? supabase
            .from("projects")
            .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
            .eq("id", plan.project_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("plan_links")
        .select("id, plan_id, link_type, linked_id, label, created_at, updated_at")
        .eq("plan_id", plan.id),
      plan.project_id
        ? supabase
            .from("scenario_sets")
            .select("id, project_id, title, status, updated_at")
            .eq("project_id", plan.project_id)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      plan.project_id
        ? supabase
            .from("engagement_campaigns")
            .select("id, project_id, title, status, updated_at")
            .eq("project_id", plan.project_id)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      plan.project_id
        ? supabase
            .from("reports")
            .select("id, project_id, title, status, updated_at")
            .eq("project_id", plan.project_id)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

  const planLinks = planLinksResult.data ?? [];
  const scenarioLinkIds = planLinks.filter((link) => link.link_type === "scenario_set").map((link) => link.linked_id);
  const campaignLinkIds = planLinks.filter((link) => link.link_type === "engagement_campaign").map((link) => link.linked_id);
  const reportLinkIds = planLinks.filter((link) => link.link_type === "report").map((link) => link.linked_id);
  const projectLinkIds = planLinks.filter((link) => link.link_type === "project_record").map((link) => link.linked_id);

  const [explicitScenariosResult, explicitCampaignsResult, explicitReportsResult, explicitProjectsResult] = await Promise.all([
    scenarioLinkIds.length
      ? supabase.from("scenario_sets").select("id, project_id, title, status, updated_at").in("id", scenarioLinkIds)
      : Promise.resolve({ data: [], error: null }),
    campaignLinkIds.length
      ? supabase
          .from("engagement_campaigns")
          .select("id, project_id, title, status, updated_at")
          .in("id", campaignLinkIds)
      : Promise.resolve({ data: [], error: null }),
    reportLinkIds.length
      ? supabase.from("reports").select("id, project_id, title, status, updated_at").in("id", reportLinkIds)
      : Promise.resolve({ data: [], error: null }),
    projectLinkIds.length
      ? supabase
          .from("projects")
          .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
          .in("id", projectLinkIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const linkedScenarios = mergeArtifacts<LinkedArtifactBase>(
    (projectScenariosResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      project_id: item.project_id,
      updated_at: item.updated_at,
    })),
    (explicitScenariosResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      project_id: item.project_id,
      updated_at: item.updated_at,
    }))
  );

  const linkedCampaigns = mergeArtifacts<LinkedArtifactBase>(
    (projectCampaignsResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      project_id: item.project_id,
      updated_at: item.updated_at,
    })),
    (explicitCampaignsResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      project_id: item.project_id,
      updated_at: item.updated_at,
    }))
  );

  const linkedReports = mergeArtifacts<LinkedArtifactBase>(
    (projectReportsResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      project_id: item.project_id,
      updated_at: item.updated_at,
    })),
    (explicitReportsResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      project_id: item.project_id,
      updated_at: item.updated_at,
    }))
  );

  const linkedProjects = mergeArtifacts<LinkedProjectBase>(
    projectResult.data
      ? [
          {
            id: projectResult.data.id,
            title: projectResult.data.name,
            status: projectResult.data.status,
            project_id: projectResult.data.id,
            updated_at: projectResult.data.updated_at,
            summary: projectResult.data.summary,
            plan_type: projectResult.data.plan_type,
            delivery_phase: projectResult.data.delivery_phase,
          },
        ]
      : [],
    (explicitProjectsResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.name,
      status: item.status,
      project_id: item.id,
      updated_at: item.updated_at,
      summary: item.summary,
      plan_type: item.plan_type,
      delivery_phase: item.delivery_phase,
    }))
  );

  const readiness = buildPlanReadiness({
    hasProject: linkedProjects.length > 0,
    scenarioCount: linkedScenarios.length,
    engagementCampaignCount: linkedCampaigns.length,
    reportCount: linkedReports.length,
    geographyLabel: plan.geography_label,
    horizonYear: plan.horizon_year,
  });

  return (
    <section className="module-page space-y-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href="/plans" className="inline-flex items-center gap-2 transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to plans
        </Link>
      </div>

      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <FileStack className="h-3.5 w-3.5" />
            Plan detail
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{plan.title}</h1>
            <p className="module-intro-description">
              {plan.summary ||
                "This plan record is intentionally lightweight in pass 1: structured metadata, clear linked inputs and outputs, and an explicit readiness basis."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={planStatusTone(plan.status)}>{formatPlanStatusLabel(plan.status)}</StatusBadge>
            <StatusBadge tone="info">{formatPlanTypeLabel(plan.plan_type)}</StatusBadge>
            <StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Linked scenarios</p>
              <p className="module-summary-value">{linkedScenarios.length}</p>
              <p className="module-summary-detail">Inherited from the project or explicitly linked to the plan.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Engagement campaigns</p>
              <p className="module-summary-value">{linkedCampaigns.length}</p>
              <p className="module-summary-detail">Source campaigns feeding the planning record.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Reports</p>
              <p className="module-summary-value">{linkedReports.length}</p>
              <p className="module-summary-detail">Packets or outputs tied into this plan basis.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Readiness basis</p>
              <h2 className="module-operator-title">{readiness.reason}</h2>
            </div>
          </div>
          <div className="module-operator-list">
            {readiness.checks.map((check) => (
              <div key={check.key} className="module-operator-item">
                <strong>{check.label}:</strong> {check.detail}
              </div>
            ))}
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Metadata</p>
              <h2 className="module-section-title">Plan scope and operating context</h2>
              <p className="module-section-description">What this plan is, where it applies, and how it is currently classified.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Geography</p>
              <p className="mt-2 text-sm">{plan.geography_label ?? "Not set"}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Horizon year</p>
              <p className="mt-2 text-sm">{plan.horizon_year ?? "Not set"}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Created</p>
              <p className="mt-2 text-sm">{formatPlanDateTime(plan.created_at)}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Updated</p>
              <p className="mt-2 text-sm">{formatPlanDateTime(plan.updated_at)}</p>
            </div>
          </div>
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Projects</p>
              <h2 className="module-section-title">Primary and related project records</h2>
              <p className="module-section-description">Plans can inherit planning context from a primary project and carry extra project cross-links.</p>
            </div>
          </div>

          {linkedProjects.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No linked projects" description="Attach a primary project or related project record to anchor this plan." compact />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {linkedProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="block rounded-[22px] border border-border/80 bg-background/80 p-5 transition hover:border-primary/35"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold tracking-tight">{project.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {project.summary || "No project summary captured yet."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone="neutral">{linkBasisLabel(project.linkBasis)}</StatusBadge>
                      {project.status ? <StatusBadge tone="info">{project.status}</StatusBadge> : null}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Scenarios</p>
              <h2 className="module-section-title">Scenario evidence</h2>
            </div>
            <Radar className="h-5 w-5 text-muted-foreground" />
          </div>

          {linkedScenarios.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No scenario sets linked" description="Link scenarios directly or through the primary project." compact />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {linkedScenarios.map((scenario) => (
                <Link key={scenario.id} href={`/scenarios/${scenario.id}`} className="block rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="neutral">{linkBasisLabel(scenario.linkBasis)}</StatusBadge>
                    {scenario.status ? <StatusBadge tone="info">{scenario.status}</StatusBadge> : null}
                  </div>
                  <h3 className="mt-3 font-semibold tracking-tight">{scenario.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">Updated {formatPlanDateTime(scenario.updated_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Engagement</p>
              <h2 className="module-section-title">Input campaigns</h2>
            </div>
            <MessagesSquare className="h-5 w-5 text-muted-foreground" />
          </div>

          {linkedCampaigns.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No campaigns linked" description="Link engagement campaigns to expose intake basis for this plan." compact />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {linkedCampaigns.map((campaign) => (
                <Link key={campaign.id} href={`/engagement/${campaign.id}`} className="block rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="neutral">{linkBasisLabel(campaign.linkBasis)}</StatusBadge>
                    {campaign.status ? <StatusBadge tone="info">{campaign.status}</StatusBadge> : null}
                  </div>
                  <h3 className="mt-3 font-semibold tracking-tight">{campaign.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">Updated {formatPlanDateTime(campaign.updated_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Reports</p>
              <h2 className="module-section-title">Output packets</h2>
            </div>
            <ScrollText className="h-5 w-5 text-muted-foreground" />
          </div>

          {linkedReports.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No reports linked" description="Link reports directly or via the primary project to show what outputs already exist." compact />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {linkedReports.map((report) => (
                <Link key={report.id} href={`/reports/${report.id}`} className="block rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="neutral">{linkBasisLabel(report.linkBasis)}</StatusBadge>
                    {report.status ? <StatusBadge tone="info">{report.status}</StatusBadge> : null}
                  </div>
                  <h3 className="mt-3 font-semibold tracking-tight">{report.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">Updated {formatPlanDateTime(report.updated_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Plan links</p>
            <h2 className="module-section-title">Explicit plan-to-record references</h2>
            <p className="module-section-description">These are the direct links stored on the plan record itself, separate from anything inherited through the primary project.</p>
          </div>
          <FolderKanban className="h-5 w-5 text-muted-foreground" />
        </div>

        {planLinks.length === 0 ? (
          <div className="mt-5">
            <EmptyState title="No explicit links yet" description="Pass 1 already shows project-derived context; explicit plan links can be added through the API." compact />
          </div>
        ) : (
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {planLinks.map((link) => (
              <div key={link.id} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {formatPlanLinkTypeLabel(link.link_type)}
                </p>
                <p className="mt-2 text-sm font-medium">{link.label || link.linked_id}</p>
                <p className="mt-2 text-xs text-muted-foreground">Updated {formatPlanDateTime(link.updated_at)}</p>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
