import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, MessageSquareText, ShieldCheck } from "lucide-react";
import { EngagementCampaignControls } from "@/components/engagement/engagement-campaign-controls";
import { EngagementCategoryCreator } from "@/components/engagement/engagement-category-creator";
import { EngagementItemComposer } from "@/components/engagement/engagement-item-composer";
import { EngagementItemRegistry } from "@/components/engagement/engagement-item-registry";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";

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
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default async function EngagementCampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: campaignData } = await supabase
    .from("engagement_campaigns")
    .select("id, workspace_id, project_id, title, summary, status, engagement_type, created_at, updated_at")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaignData) {
    notFound();
  }

  const campaign = campaignData as CampaignRow;

  const [{ data: project }, { data: categories }, { data: items }, { data: projects }] = await Promise.all([
    campaign.project_id
      ? supabase
          .from("projects")
          .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
          .eq("id", campaign.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("engagement_categories")
      .select("id, campaign_id, label, slug, description, sort_order, created_at, updated_at")
      .eq("campaign_id", campaign.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("engagement_items")
      .select(
        "id, campaign_id, category_id, title, body, submitted_by, status, source_type, moderation_notes, latitude, longitude, metadata_json, created_at, updated_at"
      )
      .eq("campaign_id", campaign.id)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase.from("projects").select("id, name").eq("workspace_id", campaign.workspace_id).order("updated_at", { ascending: false }),
  ]);

  const statusCounts = { pending: 0, approved: 0, rejected: 0, flagged: 0 } as Record<string, number>;
  let geolocatedItems = 0;
  for (const item of items ?? []) {
    statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
    if (typeof item.latitude === "number" && typeof item.longitude === "number") geolocatedItems += 1;
  }

  return (
    <section className="module-page">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/engagement" className="transition hover:text-foreground">
          Engagement
        </Link>
        <ArrowRight className="h-3.5 w-3.5" />
        <span className="text-foreground">{campaign.title}</span>
      </div>

      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <MessageSquareText className="h-3.5 w-3.5" />
            Campaign detail
          </div>
          <div className="module-record-kicker">
            <StatusBadge tone={engagementStatusTone(campaign.status)}>
              {titleizeEngagementValue(campaign.status)}
            </StatusBadge>
            <StatusBadge tone="info">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge>
            <StatusBadge tone={statusCounts.flagged > 0 ? "warning" : "success"}>
              {statusCounts.flagged > 0 ? `${statusCounts.flagged} flagged` : "No flagged items"}
            </StatusBadge>
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{campaign.title}</h1>
            <p className="module-intro-description">
              {campaign.summary ||
                "This campaign is ready for category setup, item intake, and operator moderation review."}
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Linked project</p>
              <p className="module-summary-value text-lg">{project?.name ?? "Unlinked"}</p>
              <p className="module-summary-detail">Project context stays visible so engagement does not float free.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Categories</p>
              <p className="module-summary-value">{categories?.length ?? 0}</p>
              <p className="module-summary-detail">Lightweight intake structure for moderation and later reporting.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Items</p>
              <p className="module-summary-value">{items?.length ?? 0}</p>
              <p className="module-summary-detail">{geolocatedItems} geolocated, {statusCounts.approved} approved.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Audit posture</p>
              <h2 className="module-operator-title">Moderation signal is first-class</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            V1 keeps counts and review state visible in one place: project linkage, intake categories, recent items, and
            moderation status totals.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Pending: {statusCounts.pending}</div>
            <div className="module-operator-item">Approved: {statusCounts.approved}</div>
            <div className="module-operator-item">Rejected: {statusCounts.rejected}</div>
            <div className="module-operator-item">Flagged: {statusCounts.flagged}</div>
            <div className="module-operator-item">Last updated {fmtDateTime(campaign.updated_at)}</div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <EngagementCampaignControls campaign={campaign} projects={(projects ?? []) as Array<{ id: string; name: string }>} />
        <EngagementItemComposer
          campaignId={campaign.id}
          categories={((categories ?? []) as Array<{ id: string; label: string }>).map((category) => ({
            id: category.id,
            label: category.label,
          }))}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="space-y-6">
          <EngagementCategoryCreator campaignId={campaign.id} />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Registry</p>
                <h2 className="module-section-title">Current categories</h2>
                <p className="module-section-description">
                  Category structure stays intentionally light in this pass.
                </p>
              </div>
            </div>

            {!(categories?.length) ? (
              <div className="mt-5">
                <EmptyState
                  title="No categories yet"
                  description="Add a few categories so intake can be classified before downstream reports rely on it."
                  compact
                />
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {categories?.map((category) => (
                  <div key={category.id} className="module-record-row">
                    <div className="module-record-head">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone="info">{category.label}</StatusBadge>
                        </div>
                        <p className="module-record-summary">
                          {category.description || "No description yet. This category is available for classification."}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>

        {items?.length ? (
          <EngagementItemRegistry
            items={(items ?? []) as Array<{
              id: string;
              campaign_id: string;
              category_id: string | null;
              title: string | null;
              body: string;
              submitted_by: string | null;
              status: string;
              source_type: string;
              moderation_notes: string | null;
              updated_at: string;
            }>}
            categories={((categories ?? []) as Array<{ id: string; label: string }>).map((category) => ({
              id: category.id,
              label: category.label,
            }))}
          />
        ) : (
          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Moderation</p>
                <h2 className="module-section-title">Recent intake registry</h2>
                <p className="module-section-description">
                  Create the first item to open moderation state inside this campaign.
                </p>
              </div>
            </div>
            <div className="mt-5">
              <EmptyState
                title="No intake items yet"
                description="Register internal notes, meeting observations, or moderated public input to start the campaign record."
              />
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
