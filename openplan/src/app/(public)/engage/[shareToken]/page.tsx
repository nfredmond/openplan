import { notFound } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";

type CampaignRow = {
  id: string;
  title: string;
  summary: string | null;
  public_description: string | null;
  status: string;
  engagement_type: string;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
  updated_at: string;
};

type CategoryRow = {
  id: string;
  label: string;
  slug: string | null;
  description: string | null;
  sort_order: number | null;
};

type ApprovedItemRow = {
  id: string;
  category_id: string | null;
  title: string | null;
  body: string;
  submitted_by: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
};

export default async function PublicEngagementPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;

  if (!shareToken || shareToken.length < 8) {
    notFound();
  }

  const supabase = createServiceRoleClient();

  const { data: campaignData } = await supabase
    .from("engagement_campaigns")
    .select("id, title, summary, public_description, status, engagement_type, allow_public_submissions, submissions_closed_at, updated_at")
    .eq("share_token", shareToken)
    .eq("status", "active")
    .maybeSingle();

  if (!campaignData) {
    notFound();
  }

  const campaign = campaignData as CampaignRow;

  const [{ data: categoriesData }, { data: approvedItemsData }] = await Promise.all([
    supabase
      .from("engagement_categories")
      .select("id, label, slug, description, sort_order")
      .eq("campaign_id", campaign.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("engagement_items")
      .select("id, category_id, title, body, submitted_by, latitude, longitude, created_at")
      .eq("campaign_id", campaign.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const categories = (categoriesData ?? []) as CategoryRow[];
  const approvedItems = (approvedItemsData ?? []) as ApprovedItemRow[];
  const acceptingSubmissions = campaign.allow_public_submissions && !campaign.submissions_closed_at;

  return (
    <section className="module-page">
      <header className="mb-8">
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <MessageSquareText className="h-4 w-4" />
          <span>Community Engagement</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{campaign.title}</h1>
        {campaign.public_description ? (
          <p className="mt-3 max-w-2xl text-base text-muted-foreground leading-relaxed">{campaign.public_description}</p>
        ) : campaign.summary ? (
          <p className="mt-3 max-w-2xl text-base text-muted-foreground leading-relaxed">{campaign.summary}</p>
        ) : null}
      </header>

      <PublicEngagementPortal
        shareToken={shareToken}
        acceptingSubmissions={acceptingSubmissions}
        categories={categories.map((c) => ({ id: c.id, label: c.label, description: c.description }))}
        approvedItems={approvedItems.map((item) => ({
          id: item.id,
          categoryId: item.category_id,
          title: item.title,
          body: item.body,
          submittedBy: item.submitted_by,
          latitude: item.latitude,
          longitude: item.longitude,
          createdAt: item.created_at,
        }))}
        engagementType={campaign.engagement_type}
      />
    </section>
  );
}
