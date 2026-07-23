import { createServiceRoleClient } from "@/lib/supabase/server";
import { ENGAGEMENT_PHOTO_BUCKET, ENGAGEMENT_PHOTO_SIGNED_URL_TTL_SECONDS } from "@/lib/engagement/photo";
import { loadSurveyDefinition } from "@/lib/engagement/survey-responses";
import { loadPublishedCloseLoopEntries } from "@/lib/engagement/close-loop";
import { isEmailTransportConfigured } from "@/lib/notifications/email";
import type { PortalSurveyQuestion } from "@/components/engagement/public-survey-form";
import type { PublicCloseLoopEntry } from "@/components/engagement/public-close-loop";

// Single source of truth for the PUBLIC engagement portal's gate + data. Used by
// both the full public page ((public)/engage/[shareToken]) and the minimal-chrome
// embed page ((embed)/embed/[shareToken]). Service-role, share_token + active
// gated — anon has zero RLS access to these tables. Returns null when there is no
// active campaign for the token, so callers render notFound().

export type PublicPortalCampaign = {
  id: string;
  project_id: string | null;
  title: string;
  summary: string | null;
  public_description: string | null;
  status: string;
  engagement_type: string;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
  demographics_enabled: boolean;
  updated_at: string;
};

export type PublicPortalProject = { id: string; name: string; summary: string | null };

type CategoryRow = { id: string; label: string; slug: string | null; description: string | null; sort_order: number | null; color: string | null };
type ApprovedItemRow = {
  id: string;
  category_id: string | null;
  title: string | null;
  body: string;
  submitted_by: string | null;
  latitude: number | null;
  longitude: number | null;
  geometry: unknown;
  photo_path: string | null;
  votes_count: number | null;
  parent_item_id: string | null;
  created_at: string;
};

// The prop object PublicEngagementPortal consumes (kept structural so both pages
// pass it through with a spread).
export type PublicPortalProps = {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: { id: string; label: string; description: string | null; color: string | null }[];
  approvedItems: {
    id: string;
    categoryId: string | null;
    title: string | null;
    body: string;
    submittedBy: string | null;
    latitude: number | null;
    longitude: number | null;
    geometry: unknown;
    votesCount: number;
    parentItemId: string | null;
    photoUrl: string | null;
    createdAt: string;
  }[];
  engagementType: string;
  demographicsEnabled: boolean;
  projectContext: { name: string; summary: string | null } | null;
  surveyQuestions: PortalSurveyQuestion[];
  closeLoopEntries: PublicCloseLoopEntry[];
  // Only true when an email transport is actually configured — the "notify me"
  // affordance is hidden otherwise so the UI never promises email it can't send.
  emailUpdatesAvailable: boolean;
};

export type PublicPortalBundle = {
  campaign: PublicPortalCampaign;
  project: PublicPortalProject | null;
  acceptingSubmissions: boolean;
  portalProps: PublicPortalProps;
};

export async function loadPublicPortalBundle(shareToken: string): Promise<PublicPortalBundle | null> {
  if (!shareToken || shareToken.length < 8) return null;

  const supabase = createServiceRoleClient();

  const { data: campaignData } = await supabase
    .from("engagement_campaigns")
    .select("id, project_id, title, summary, public_description, status, engagement_type, allow_public_submissions, submissions_closed_at, demographics_enabled, updated_at")
    .eq("share_token", shareToken)
    .eq("status", "active")
    .maybeSingle();

  if (!campaignData) return null;

  const campaign = campaignData as PublicPortalCampaign;

  const [{ data: projectData }, { data: categoriesData }, { data: approvedItemsData }, surveyDefinition, closeLoopRows] = await Promise.all([
    campaign.project_id
      ? supabase.from("projects").select("id, name, summary").eq("id", campaign.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("engagement_categories")
      .select("id, label, slug, description, sort_order, color")
      .eq("campaign_id", campaign.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("engagement_items")
      .select("id, category_id, title, body, submitted_by, latitude, longitude, geometry, photo_path, votes_count, parent_item_id, created_at")
      .eq("campaign_id", campaign.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(200),
    // Definition tables only; response tables stay confined to survey-responses.ts.
    loadSurveyDefinition(supabase, campaign.id),
    // Published entries only — drafts never leave the operator.
    loadPublishedCloseLoopEntries(supabase, campaign.id),
  ]);

  const project = (projectData ?? null) as PublicPortalProject | null;
  const categories = (categoriesData ?? []) as CategoryRow[];
  const approvedItems = (approvedItemsData ?? []) as ApprovedItemRow[];
  const acceptingSubmissions = campaign.allow_public_submissions && !campaign.submissions_closed_at;

  const surveyQuestions: PortalSurveyQuestion[] = surveyDefinition.questions.map((question) => ({
    id: question.id,
    questionType: question.question_type,
    prompt: question.prompt,
    helpText: question.help_text,
    required: question.required,
    config: question.config_json,
    options: (surveyDefinition.optionsByQuestion.get(question.id) ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      value: option.value,
    })),
  }));

  const categoryLabelById = new Map(categories.map((category) => [category.id, category.label]));
  const closeLoopEntries: PublicCloseLoopEntry[] = closeLoopRows.map((entry) => ({
    id: entry.id,
    themeTitle: entry.theme_title,
    youSaid: entry.you_said,
    weDid: entry.we_did,
    categoryLabel: entry.category_id ? categoryLabelById.get(entry.category_id) ?? null : null,
  }));

  // Photos live in a PRIVATE service-role-only bucket. Short-TTL signed URLs are
  // minted here for APPROVED items only (the query filters status) — pending or
  // rejected photos are never reachable from the public portal or an embed.
  const photoUrlByItemId = new Map<string, string>();
  const photoPaths = approvedItems
    .filter((item) => typeof item.photo_path === "string" && item.photo_path.length > 0)
    .map((item) => item.photo_path as string);

  if (photoPaths.length > 0) {
    const { data: signedUrls } = await supabase.storage
      .from(ENGAGEMENT_PHOTO_BUCKET)
      .createSignedUrls(photoPaths, ENGAGEMENT_PHOTO_SIGNED_URL_TTL_SECONDS);

    for (const item of approvedItems) {
      if (!item.photo_path) continue;
      const signed = (signedUrls ?? []).find((entry) => entry.path === item.photo_path);
      if (signed?.signedUrl) photoUrlByItemId.set(item.id, signed.signedUrl);
    }
  }

  const portalProps: PublicPortalProps = {
    shareToken,
    acceptingSubmissions,
    categories: categories.map((c) => ({ id: c.id, label: c.label, description: c.description, color: c.color })),
    approvedItems: approvedItems.map((item) => ({
      id: item.id,
      categoryId: item.category_id,
      title: item.title,
      body: item.body,
      submittedBy: item.submitted_by,
      latitude: item.latitude,
      longitude: item.longitude,
      geometry: item.geometry ?? null,
      votesCount: item.votes_count ?? 0,
      parentItemId: item.parent_item_id,
      photoUrl: photoUrlByItemId.get(item.id) ?? null,
      createdAt: item.created_at,
    })),
    engagementType: campaign.engagement_type,
    demographicsEnabled: campaign.demographics_enabled,
    projectContext: project ? { name: project.name, summary: project.summary } : null,
    surveyQuestions,
    closeLoopEntries,
    emailUpdatesAvailable: isEmailTransportConfigured(),
  };

  return { campaign, project, acceptingSubmissions, portalProps };
}
