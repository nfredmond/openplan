import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FolderKanban, MessagesSquare, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { CartographicSelectionLink } from "@/components/cartographic/cartographic-selection-link";

const ENGAGEMENT_STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
] as const;
import { EngagementCampaignCreator } from "@/components/engagement/engagement-campaign-creator";
import { EngagementPortalStatusChip } from "@/components/engagement/portal-status-chip";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { getEngagementHandoffReadiness } from "@/lib/engagement/readiness";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";

/**
 * `?projectId=` is how this catalog is TOLD which project it was opened for.
 *
 * THE DEFECT IT ARRIVED WITH. The project spine board and the workflow handoff
 * both link here with a project id attached. This page applied the filter and
 * then said nothing about it: a filtered zero rendered "No engagement campaigns
 * yet — create the first campaign", which is a claim about a workspace this
 * render never queried, and the status tabs reported workspace-wide counts over
 * a project-scoped list. A filtered list has to name its filter, or its
 * emptiness gets read as the world's.
 */
type EngagementPageSearchParams = Promise<{
  projectId?: string;
  status?: string;
}>;

/**
 * A status-tab href that carries the filters already in effect.
 *
 * Each tab used to rebuild its href from scratch (`/engagement?status=active`),
 * so a planner who arrived from a project board on `/engagement?projectId=…` and
 * then picked a status silently widened from one project back to the whole
 * workspace, with nothing on screen saying the scope had changed. Choosing a
 * status is a request to narrow; it must never widen behind the reader's back.
 * Widening stays deliberate — that is what "Clear filters" is for.
 */
function engagementTabHref(projectId: string | null, status: string | null): string {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  const query = params.toString();
  return query ? `/engagement?${query}` : "/engagement";
}

type CampaignRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  summary: string | null;
  status: string;
  engagement_type: string;
  // Public-portal columns (migration 20260321000032_engagement_public_share):
  // exactly what getPublicPortalState needs to place each campaign on the
  // Private / Staged / Live spectrum without duplicating any rules here.
  share_token: string | null;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
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

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Engagement"
        title="Engagement needs a provisioned workspace"
        description="Campaigns, moderation queues, and intake categories only exist inside a real workspace. You are signed in, but this account has not been provisioned into one yet."
      />
    );
  }

  const [{ data: campaignsData }, { data: projectsData, error: projectsError }, { data: itemsData }, { data: categoriesData }] = await Promise.all([
    supabase
      .from("engagement_campaigns")
      .select("id, workspace_id, project_id, title, summary, status, engagement_type, share_token, allow_public_submissions, submissions_closed_at, created_at, updated_at, projects(id, name)")
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

  const projectFilterId = filters.projectId?.trim() || null;
  const statusFilter = filters.status?.trim() || null;
  const hasActiveFilters = Boolean(projectFilterId || statusFilter);

  const campaignsInScope = ((campaignsData ?? []) as CampaignRow[])
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
    .filter((campaign) => (projectFilterId ? campaign.project_id === projectFilterId : true));

  const campaigns = campaignsInScope.filter((campaign) =>
    statusFilter ? campaign.status === statusFilter : true
  );

  // The status tabs count within the project scope but BEFORE the status filter.
  // They used to count every campaign in the workspace, so a project-scoped list
  // of two rows sat under an "All (37)" tab — a workspace total offered as the
  // total of the list being shown.
  const scopedCampaignCount = campaignsInScope.length;
  const statusCountsInScope = campaignsInScope.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  // The project is named from the list this page already reads for the creator
  // panel rather than a second query. A name is a courtesy that list may not be
  // able to supply; the id is the filter, and is disclosed instead when the name
  // is missing, so the reader can still tell WHICH project is in scope.
  const projectFilterName = projectFilterId
    ? ((projectsData ?? []) as Array<{ id: string; name: string | null }>)
        .find((project) => project.id === projectFilterId)
        ?.name?.trim() || null
    : null;

  // Named in the reader's terms so the empty state can say what it is filtered
  // TO, not merely that it is filtered.
  const activeFilterLabels = [
    projectFilterId ? `project ${projectFilterName ?? projectFilterId}` : null,
    statusFilter ? `status ${titleizeEngagementValue(statusFilter)}` : null,
  ].filter((label): label is string => Boolean(label));

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
            {projectFilterId ? (
              // Every tile and every row below belongs to one project, so the
              // scope has to be stated where the reader cannot miss it and be
              // reversible in one click. Without this the totals read as the
              // workspace's.
              <p className="module-intro-description">
                Showing only campaigns linked to {projectFilterName ?? `the project with id ${projectFilterId}`}.{" "}
                <Link href="/engagement" className="underline underline-offset-2 hover:text-foreground">
                  Show every campaign in this workspace
                </Link>
                .
              </p>
            ) : null}
            {projectFilterId && !projectFilterName ? (
              // Why the project could not be named. A failed read and a project
              // this workspace does not have produce the same empty catalog, and
              // only one of them is a statement about the project.
              <p className="module-intro-description">
                {projectsError
                  ? "This workspace's project list could not be read, so the filter above is named by id. An empty catalog below would not mean that project has no campaigns."
                  : "No project with that id appears in this workspace's project list, so this filter may match nothing."}
              </p>
            ) : null}
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Campaigns</p>
              <p className="module-summary-value">{campaigns.length}</p>
              <p className="module-summary-detail">
                {hasActiveFilters
                  ? "Matching the current filters."
                  : "Workspace-scoped engagement containers with auditable ownership."}
              </p>
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
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
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
              <h2 className="module-section-title">
                {/* The heading may not imply workspace scope over a project-scoped list. */}
                {projectFilterId ? "Campaigns linked to this project" : "Current engagement campaigns"}
              </h2>
            </div>
            <span className="module-record-chip">
              <FolderKanban className="h-3.5 w-3.5" />
              <span>Total</span>
              <strong>{campaigns.length}</strong>
            </span>
          </div>

          {/* Status filter bar */}
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-3 text-[0.78rem]">
            <Link
              href={engagementTabHref(projectFilterId, null)}
              className={cn("rounded px-2 py-0.5 transition-colors", !statusFilter ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:text-foreground")}
            >
              All ({scopedCampaignCount})
            </Link>
            {ENGAGEMENT_STATUS_FILTER_OPTIONS.map((option) => (
              <Link
                key={option.value}
                href={engagementTabHref(projectFilterId, option.value)}
                className={cn("rounded px-2 py-0.5 transition-colors", statusFilter === option.value ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:text-foreground")}
              >
                {option.label} ({statusCountsInScope[option.value] ?? 0})
              </Link>
            ))}
            {hasActiveFilters ? (
              // The one deliberate way to widen. Every tab above narrows within
              // the scope the page was opened for; only this leaves it.
              <Link href="/engagement" className="ml-auto rounded px-2 py-0.5 text-muted-foreground/70 hover:text-foreground">
                Clear filters ×
              </Link>
            ) : null}
          </div>

          {campaigns.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title={hasActiveFilters ? "No campaigns match these filters" : "No engagement campaigns yet"}
                description={
                  hasActiveFilters
                    ? `This catalog is filtered to ${activeFilterLabels.join(", ")}. Clear the filters to see every campaign in this workspace — an empty filtered list is not a statement that none exist.`
                    : "Create the first campaign to open a real moderation and public-input registry inside OpenPlan."
                }
              />
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {campaigns.map((campaign) => (
                <CartographicSelectionLink
                  key={campaign.id}
                  href={`/engagement/${campaign.id}`}
                  className="module-record-row is-interactive group block"
                  selection={{
                    kind: "mission",
                    title: campaign.title,
                    kicker: `${titleizeEngagementValue(campaign.engagement_type)} · ${titleizeEngagementValue(campaign.status)}`,
                    avatarChar: campaign.title[0],
                    meta: [
                      ...(campaign.project?.name ? [{ label: "project", value: campaign.project.name }] : []),
                      ...(campaign.categoryCount > 0 ? [{ label: "categories", value: String(campaign.categoryCount) }] : []),
                    ],
                  }}
                >
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={engagementStatusTone(campaign.status)}>
                          {titleizeEngagementValue(campaign.status)}
                        </StatusBadge>
                        <EngagementPortalStatusChip campaign={campaign} />
                        <span className="module-record-chip"><span>Type</span><strong>{titleizeEngagementValue(campaign.engagement_type)}</strong></span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title transition group-hover:text-primary">
                            {campaign.title}
                          </h3>
                          <p className="module-record-stamp shrink-0">Updated {fmtDateTime(campaign.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {campaign.summary || "No summary yet."}
                        </p>
                        <p className="text-[0.73rem] text-muted-foreground">
                          {campaign.project?.name ?? "No project linked"}
                          {campaign.categoryCount > 0 ? ` · ${campaign.categoryCount} categor${campaign.categoryCount === 1 ? "y" : "ies"}` : ""}
                          {campaign.counts.totalItems > 0 ? ` · ${campaign.counts.totalItems} item${campaign.counts.totalItems === 1 ? "" : "s"}` : ""}
                          {campaign.counts.statusCounts.flagged > 0 ? ` · ${campaign.counts.statusCounts.flagged} flagged` : ""}
                          {campaign.counts.geolocatedItems > 0 ? ` · ${campaign.counts.geolocatedItems} geolocated` : ""}
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
                  </div>
                </CartographicSelectionLink>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
