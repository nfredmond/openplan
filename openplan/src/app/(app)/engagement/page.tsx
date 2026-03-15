import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FolderKanban, MessagesSquare, ShieldCheck } from "lucide-react";
import { EngagementCampaignCreator } from "@/components/engagement/engagement-campaign-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
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

  const [{ data: campaignsData }, { data: projectsData }, { data: itemsData }] = await Promise.all([
    supabase
      .from("engagement_campaigns")
      .select("id, workspace_id, project_id, title, summary, status, engagement_type, created_at, updated_at, projects(id, name)")
      .order("updated_at", { ascending: false }),
    supabase.from("projects").select("id, name").order("updated_at", { ascending: false }),
    supabase.from("engagement_items").select("campaign_id, status, latitude, longitude"),
  ]);

  const counts = new Map<string, { total: number; approved: number; geolocated: number }>();
  for (const item of itemsData ?? []) {
    const current = counts.get(item.campaign_id) ?? { total: 0, approved: 0, geolocated: 0 };
    current.total += 1;
    if (item.status === "approved") current.approved += 1;
    if (typeof item.latitude === "number" && typeof item.longitude === "number") current.geolocated += 1;
    counts.set(item.campaign_id, current);
  }

  const campaigns = ((campaignsData ?? []) as CampaignRow[])
    .map((campaign) => ({
      ...campaign,
      project: Array.isArray(campaign.projects) ? campaign.projects[0] ?? null : campaign.projects ?? null,
      counts: counts.get(campaign.id) ?? { total: 0, approved: 0, geolocated: 0 },
    }))
    .filter((campaign) => (filters.projectId ? campaign.project_id === filters.projectId : true))
    .filter((campaign) => (filters.status ? campaign.status === filters.status : true));

  const activeCount = campaigns.filter((campaign) => campaign.status === "active").length;
  const closedCount = campaigns.filter((campaign) => campaign.status === "closed").length;
  const totalItems = campaigns.reduce((sum, campaign) => sum + campaign.counts.total, 0);

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <MessagesSquare className="h-3.5 w-3.5" />
            Engagement catalog live
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Campaigns now have a real operator registry</h1>
            <p className="module-intro-description">
              Engagement V1 is intentionally narrow: create a campaign, link it to a project when needed, define intake
              categories, and moderate structured input items without inventing a public portal yet.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Campaigns</p>
              <p className="module-summary-value">{campaigns.length}</p>
              <p className="module-summary-detail">Workspace-scoped engagement containers with auditable ownership.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Active</p>
              <p className="module-summary-value">{activeCount}</p>
              <p className="module-summary-detail">{closedCount} already closed or archived.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Feedback items</p>
              <p className="module-summary-value">{totalItems}</p>
              <p className="module-summary-detail">Structured intake records across all listed campaigns.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Moderation posture</p>
              <h2 className="module-operator-title">This pass stays operator-facing by design</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Intake stays inside the audited app shell for now. The point of V1 is a durable schema and workflow lane,
            not external publishing complexity.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Campaigns can exist with or without a linked project, but never without workspace ownership.</div>
            <div className="module-operator-item">Categories are lightweight structure for moderation and reporting, not a full survey builder.</div>
            <div className="module-operator-item">Items track status, source, location signal, and internal notes from day one.</div>
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
                        <StatusBadge tone={campaign.counts.total > 0 ? "success" : "neutral"}>
                          {campaign.counts.total} items
                        </StatusBadge>
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
                    <span className="module-record-chip">{campaign.counts.approved} approved</span>
                    <span className="module-record-chip">{campaign.counts.geolocated} geolocated</span>
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
