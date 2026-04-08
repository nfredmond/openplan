import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FolderKanban, MessagesSquare, ShieldCheck } from "lucide-react";
import { EngagementCampaignCreator } from "@/components/engagement/engagement-campaign-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { getEngagementHandoffReadiness } from "@/lib/engagement/readiness";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";

type EngagementPageSearchParams = Promise<{
  projectId?: string;
  status?: string;
}>;

type CampaignRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  summary: string | null;
  status: string;
  engagement_type: string;
  created_at: string;
  updated_at: string;
  projects: { id: string; name: string } | Array<{ id: string; name: string }> | null;
};

type CampaignItemSummaryRow = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  status: string;
  source_type: string;
  latitude: number | null;
  longitude: number | null;
  moderation_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type CampaignCategoryRow = {
  id: string;
  campaign_id: string;
  label: string;
  slug: string | null;
  description: string | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default async function EngagementPage({
  searchParams,
}: {
  searchParams: EngagementPageSearchParams;
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
        moduleLabel="Engagement"
        title="Engagement needs a provisioned workspace"
        description="Campaigns, moderation queues, and intake categories only exist inside a real workspace. You are signed in, but this account has not been provisioned into one yet."
      />
    );
  }

  const [{ data: campaignsData }, { data: projectsData }, { data: itemsData }, { data: categoriesData }] = await Promise.all([
    supabase
      .from("engagement_campaigns")
      .select("id, workspace_id, project_id, title, summary, status, engagement_type, created_at, updated_at, projects(id, name)")
      .order("updated_at", { ascending: false }),
    supabase.from("projects").select("id, name").order("updated_at", { ascending: false }),
    supabase.from("engagement_items").select("id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at"),
    supabase.from("engagement_categories").select("id, campaign_id, label, slug, description, sort_order, created_at, updated_at"),
  ]);

  const itemsByCampaign = new Map<string, CampaignItemSummaryRow[]>();
  for (const item of (itemsData ?? []) as CampaignItemSummaryRow[]) {
    const current = itemsByCampaign.get(item.campaign_id) ?? [];
    current.push(item);
    itemsByCampaign.set(item.campaign_id, current);
  }

  const categoriesByCampaign = new Map<string, CampaignCategoryRow[]>();
  for (const category of (categoriesData ?? []) as CampaignCategoryRow[]) {
    const current = categoriesByCampaign.get(category.campaign_id) ?? [];
    current.push(category);
    categoriesByCampaign.set(category.campaign_id, current);
  }

  const campaigns = ((campaignsData ?? []) as CampaignRow[])
    .map((campaign) => {
      const categoryCount = (categoriesByCampaign.get(campaign.id) ?? []).length;
      const counts = summarizeEngagementItems(categoriesByCampaign.get(campaign.id) ?? [], itemsByCampaign.get(campaign.id) ?? []);
      const project = Array.isArray(campaign.projects) ? campaign.projects[0] ?? null : campaign.projects ?? null;

      return {
        ...campaign,
        project,
        categoryCount,
        counts,
        readiness: getEngagementHandoffReadiness({
          campaignStatus: campaign.status,
          projectLinked: Boolean(project),
          categoryCount,
          counts,
        }),
      };
    })
    .filter((campaign) => (filters.projectId ? campaign.project_id === filters.projectId : true))
    .filter((campaign) => (filters.status ? campaign.status === filters.status : true));

  const activeCount = campaigns.filter((campaign) => campaign.status === "active").length;
  const closedCount = campaigns.filter((campaign) => campaign.status === "closed").length;
  const draftCount = campaigns.filter((campaign) => campaign.status === "draft").length;
  const totalItems = campaigns.reduce((sum, campaign) => sum + campaign.counts.totalItems, 0);
  const totalCategories = campaigns.reduce((sum, campaign) => sum + campaign.categoryCount, 0);
  const recentActivityItems = campaigns.reduce((sum, campaign) => sum + campaign.counts.recentActivity.count, 0);

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <MessagesSquare className="h-3.5 w-3.5" />
            Engagement workspace
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Campaigns</h1>
            <p className="module-intro-description">
              Create campaigns, link them to projects when needed, organize public input, and keep moderation and reporting in one place.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Campaigns</p>
              <p className="module-summary-value">{campaigns.length}</p>
              <p className="module-summary-detail">Workspace-scoped engagement containers with auditable ownership.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Status mix</p>
              <p className="module-summary-value">{activeCount}</p>
              <p className="module-summary-detail">
                {draftCount} draft, {closedCount} closed, {campaigns.filter((campaign) => campaign.status === "archived").length} archived.
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Active items</p>
              <p className="module-summary-value">{totalItems}</p>
              <p className="module-summary-detail">
                {totalCategories} categories and {recentActivityItems} recently active items across listed campaigns.
              </p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Engagement</p>
              <h2 className="module-operator-title">Keep public input organized and reviewable</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Organize comments, categories, and campaign status so public input is easy to review and summarize.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Campaigns can stand alone or connect to a project.</div>
            <div className="module-operator-item">Categories keep comments organized for review and reporting.</div>
            <div className="module-operator-item">Items track status, source, map location, and team notes.</div>
            <div className="module-operator-item">Share links stay disabled until a campaign is ready to open.</div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <EngagementCampaignCreator projects={(projectsData ?? []) as Array<{ id: string; name: string }>} />

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Catalog</p>
              <h2 className="module-section-title">Current engagement campaigns</h2>
              <p className="module-section-description">
                Filter in the URL with <code>?projectId=...</code> or <code>?status=...</code> when you need a narrower
                operational view.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5" />
              {campaigns.length} total
            </span>
          </div>

          {campaigns.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No engagement campaigns yet"
                description="Create the first campaign to open a real moderation and public-input registry inside OpenPlan."
              />
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {campaigns.map((campaign) => (
                <Link
                  key={campaign.id}
                  href={`/engagement/${campaign.id}`}
                  className="module-record-row is-interactive group block"
                >
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={engagementStatusTone(campaign.status)}>
                          {titleizeEngagementValue(campaign.status)}
                        </StatusBadge>
                        <StatusBadge tone="info">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge>
                        <StatusBadge tone={campaign.counts.totalItems > 0 ? "success" : "neutral"}>
                          {campaign.counts.totalItems} items
                        </StatusBadge>
                        <StatusBadge tone={campaign.readiness.tone}>{campaign.readiness.label}</StatusBadge>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">
                            {campaign.title}
                          </h3>
                          <p className="module-record-stamp">Updated {fmtDateTime(campaign.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {campaign.summary ||
                            "No summary yet. Open the campaign to define categories, register intake, and review moderation state."}
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>

                  <div className="module-record-meta">
                    <span className="module-record-chip">Project {campaign.project?.name ?? "Unlinked"}</span>
                    <span className="module-record-chip">{campaign.categoryCount} categories</span>
                    <span className="module-record-chip">{campaign.readiness.completeCount}/{campaign.readiness.totalChecks} readiness checks</span>
                    <span className="module-record-chip">{campaign.counts.statusCounts.approved} approved</span>
                    <span className="module-record-chip">{campaign.counts.statusCounts.flagged} flagged</span>
                    <span className="module-record-chip">{campaign.counts.recentActivity.count} recent</span>
                    <span className="module-record-chip">{campaign.counts.geolocatedItems} geolocated</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
