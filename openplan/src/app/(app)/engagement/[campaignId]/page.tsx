import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { ArrowRight, MapPinned, MessageSquareText, ShieldCheck } from "lucide-react";
import { EngagementOperatorActions } from "@/components/engagement/engagement-operator-actions";
import { EngagementCategoryCreator } from "@/components/engagement/engagement-category-creator";
import { EngagementItemRegistry } from "@/components/engagement/engagement-item-registry";
import { EngagementSurveyResults } from "@/components/engagement/survey-results-panel";
import { EngagementNotificationsInbox } from "@/components/engagement/notifications-inbox";
import { EngagementPublicLinkCompact } from "@/components/engagement/engagement-public-link-compact";
import { EngagementCampaignCreatedNotice } from "@/components/engagement/campaign-created-notice";
import { EngagementBulkModeration } from "@/components/engagement/engagement-bulk-moderation";
import { CampaignTranslationsPanel } from "@/components/engagement/campaign-translations-panel";
import { CampaignLinkedReportsSection } from "@/components/engagement/campaign-linked-reports-section";
import { CampaignHandoffReadinessSection } from "@/components/engagement/campaign-handoff-readiness-section";
import { CampaignAccessibilityEditor } from "@/components/engagement/campaign-accessibility-editor";
import { CommentImportPanel } from "@/components/engagement/comment-import-panel";
import {
  MACHINE_TRANSLATION_BATCH_MAX,
  TRANSLATION_ACCEPT_BATCH_MAX,
  loadCampaignTranslationState,
} from "@/lib/engagement/campaign-translations";
import { hasAnthropicAccess } from "@/lib/integrations/anthropic-access";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";
import { buildEngagementCommentMatrixPreview } from "@/lib/engagement/comment-matrix";
import { getEngagementHandoffReadiness, getEngagementPublicReviewCopyGuard } from "@/lib/engagement/readiness";
import { loadSurveyBuilderDefinition, aggregateCampaignSurvey } from "@/lib/engagement/survey-responses";
import { loadCloseLoopEntries } from "@/lib/engagement/close-loop";
import { loadOperatorNotifications } from "@/lib/notifications/engagement";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { getReportPacketFreshness, getReportPacketPriority } from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { collectReportIdsLinkedToEngagementCampaign } from "@/lib/reports/engagement";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  ENGAGEMENT_PHOTO_BUCKET,
  ENGAGEMENT_PHOTO_SIGNED_URL_TTL_SECONDS,
} from "@/lib/engagement/photo";
import { LocationDisplayMap } from "@/components/engagement/location-display-map";
import { EngagementContextLayersPanel } from "@/components/engagement/engagement-context-layers-panel";
import { loadCampaignContextLayerSummaries, loadParticipantContextLayers } from "@/lib/engagement/context-layers";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { EngagementSynthesisPanel } from "@/components/engagement/engagement-synthesis-panel";
import type { HeatmapPoint } from "@/components/engagement/participation-heatmap-map";
import { SpatialHotspotTuner } from "@/components/engagement/spatial-hotspot-tuner";
import { DemographicsPanel } from "@/components/engagement/demographics-panel";
import { loadSelfReportedDemographicsSource } from "@/lib/engagement/demographics";
import { RepresentativenessPanel } from "@/components/engagement/representativeness-panel";
import { JointRepresentativenessPanel } from "@/components/engagement/joint-representativeness-panel";
import {
  buildJointRepresentativeness,
  jointReadingIsPresentable,
} from "@/lib/engagement/joint-representativeness";
import type { CampaignRepresentativeness } from "@/lib/engagement/representativeness";
import { NearDuplicatesPanel } from "@/components/engagement/near-duplicates-panel";
import { loadNearDuplicates } from "@/lib/engagement/near-duplicates";
import { AiModerationPanel } from "@/components/engagement/ai-moderation-panel";
import { buildModerationQueueView } from "@/lib/engagement/ai-moderation-shared";
import {
  loadSentimentHotspots,
  negativeItemIdsFromSyntheses,
} from "@/lib/engagement/hotspots";
import { buildDailyIntake } from "@/lib/engagement/participation-dashboard";
import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";

type CampaignRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  rtp_cycle_id: string | null;
  rtp_cycle_chapter_id: string | null;
  title: string;
  summary: string | null;
  status: string;
  engagement_type: string;
  share_token: string | null;
  public_description: string | null;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
  demographics_enabled: boolean;
  representativeness_json: CampaignRepresentativeness | null;
  accessibility_contact_label: string | null;
  accessibility_contact_email: string | null;
  accessibility_contact_phone: string | null;
  accessibility_alternate_formats: string | null;
  ai_synthesis_json: EngagementSynthesis | null;
  ai_synthesized_at: string | null;
  created_at: string;
  updated_at: string;
};

type ReportRow = {
  id: string;
  project_id: string;
  title: string;
  report_type: string;
  status: string;
  generated_at: string | null;
  updated_at: string;
  latest_artifact_kind: string | null;
};

type ReportSectionLinkRow = {
  report_id: string;
  section_key: string;
  enabled: boolean;
  config_json: Record<string, unknown> | null;
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function fmtPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function EngagementCampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams?: Promise<{ created?: string }>;
}) {
  const { campaignId } = await params;
  const query = searchParams ? await searchParams : {};
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: campaignData, error: campaignError } = await supabase
    .from("engagement_campaigns")
    .select("id, workspace_id, project_id, rtp_cycle_id, rtp_cycle_chapter_id, title, summary, status, engagement_type, share_token, public_description, allow_public_submissions, submissions_closed_at, demographics_enabled, representativeness_json, ai_synthesis_json, ai_synthesized_at, created_at, updated_at, accessibility_contact_label, accessibility_contact_email, accessibility_contact_phone, accessibility_alternate_formats")
    .eq("id", campaignId)
    .maybeSingle();

  // A FAILED READ IS NOT A MISSING CAMPAIGN. These were one branch, so a
  // database error rendered the 404 page — telling a moderator the campaign
  // they are looking for does not exist when OpenPlan had simply failed to
  // look. On this page that is expensive: the next move is to re-create a
  // campaign whose share token is already published and whose comments are
  // still being collected. "Could not be read" and "not there" are different
  // facts and the page now says whichever is true.
  if (campaignError) {
    return (
      <section className="module-page">
        <div className="mx-auto w-full max-w-2xl">
          <StateBlock
            tone="danger"
            title="This campaign could not be read"
            description={`The database refused the query for this campaign: ${
              campaignError.message ?? "no reason was returned"
            }. That is not the same as the campaign not existing — OpenPlan cannot tell you either way right now, so do not treat this page as evidence the record is gone.`}
          />
          <p className="mt-4 text-sm">
            <Link href="/engagement" className="underline underline-offset-2 hover:text-foreground">
              Back to campaigns
            </Link>
          </p>
        </div>
      </section>
    );
  }

  if (!campaignData) {
    notFound();
  }

  const campaign = campaignData as CampaignRow;

  // Every read below is collected rather than swallowed: a read that failed may
  // not be rendered as an answer. This console's empty states are unusually
  // consequential — "No intake items yet" on a live campaign reads as nobody
  // having commented, and "No categories yet" as an unclassified backlog —
  // so each of them names the failure instead. See src/lib/ui/read-failures.ts.
  const reads = new ReadFailureLog();

  const [projectResult, categoriesResult, itemsResult, projectsResult, reportsResult, rtpCycleResult, rtpChapterResult] = await Promise.all([
    campaign.project_id
      ? supabase
          .from("projects")
          .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
          .eq("id", campaign.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("engagement_categories")
      .select("id, campaign_id, label, slug, description, sort_order, color, icon, created_at, updated_at")
      .eq("campaign_id", campaign.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("engagement_items")
      .select(
        "id, campaign_id, category_id, title, body, submitted_by, status, source_type, moderation_notes, latitude, longitude, geometry, photo_path, votes_count, parent_item_id, metadata_json, created_at, updated_at"
      )
      .eq("campaign_id", campaign.id)
      .order("updated_at", { ascending: false }),
    supabase.from("projects").select("id, name").eq("workspace_id", campaign.workspace_id).order("updated_at", { ascending: false }),
    campaign.project_id
      ? supabase
          .from("reports")
          .select("id, project_id, title, report_type, status, generated_at, updated_at, latest_artifact_kind")
          .eq("project_id", campaign.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] as ReportRow[], error: null }),
    // The RTP cycle (and chapter, when one is targeted) this campaign feeds.
    // Until the console read these, the attachment was set only from the RTP
    // side and was invisible here — a moderator classifying plan comments had
    // no way to see which plan they were collected for.
    campaign.rtp_cycle_id
      ? supabase.from("rtp_cycles").select("id, title, status").eq("id", campaign.rtp_cycle_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    campaign.rtp_cycle_chapter_id
      ? supabase.from("rtp_cycle_chapters").select("id, title").eq("id", campaign.rtp_cycle_chapter_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // Named in the moderator's words, because these labels are read back in a
  // sentence at the top of the page.
  const projectUnreadable = reads.check("the project this campaign is linked to", projectResult);
  const categoriesUnreadable = reads.check("this campaign's comment categories", categoriesResult);
  const itemsUnreadable = reads.check("the comments on this campaign", itemsResult);
  reads.check("the workspace's project list", projectsResult);
  const reportsUnreadable = reads.check("reports on the linked project", reportsResult);
  const rtpCycleUnreadable = reads.check("the RTP cycle this campaign is attached to", rtpCycleResult);
  const rtpChapterUnreadable = reads.check("the RTP chapter this campaign is targeted at", rtpChapterResult);
  const rtpCycle = rtpCycleResult.data as { id: string; title: string; status: string } | null;
  const rtpChapter = rtpChapterResult.data as { id: string; title: string } | null;

  const project = projectResult.data;
  const categories = categoriesResult.data;
  const items = itemsResult.data;
  const projects = projectsResult.data;
  const reports = reportsResult.data;

  const surveyQuestions = await loadSurveyBuilderDefinition(supabase, campaign.id);
  // Survey RESULTS read the sensitive response tables → service-role (RLS proven
  // by the campaign membership check above). Reads stay confined to survey-responses.ts.
  const surveyResults = await aggregateCampaignSurvey(createServiceRoleClient(), campaign.id);
  // Close-loop entries are operator-authored (RLS client is fine — membership proven above).
  const closeLoopEntries = await loadCloseLoopEntries(supabase, campaign.id);
  // Operator inbox — engagement_notifications has a member SELECT policy, so the
  // RLS client reads it directly (defense-in-depth with the membership proof above).
  const notifications = await loadOperatorNotifications(supabase, campaign.id, { limit: 30 });
  const builderCategories = ((categories ?? []) as Array<{ id: string; label: string }>).map((category) => ({
    id: category.id,
    label: category.label,
  }));

  const counts = summarizeEngagementItems(categories ?? [], items ?? []);
  const categoryColorById = new Map(
    ((categories ?? []) as Array<{ id: string; color?: string | null }>).map((c) => [c.id, c.color ?? null])
  );
  const handoffReadiness = getEngagementHandoffReadiness({
    campaignStatus: campaign.status,
    projectLinked: Boolean(project),
    categoryCount: (categories ?? []).length,
    counts,
  });
  const appendixReadiness = counts.appendixReadiness;
  const publicReviewCopyGuard = getEngagementPublicReviewCopyGuard({
    campaignStatus: campaign.status,
    allowPublicSubmissions: campaign.allow_public_submissions,
    shareToken: campaign.share_token,
    submissionsClosedAt: campaign.submissions_closed_at,
    appendixReadyCount: appendixReadiness.appendixReadyCount,
    actionableCount: counts.moderationQueue.actionableCount,
  });
  const commentMatrixPreview = buildEngagementCommentMatrixPreview(categories ?? [], items ?? [], { rowLimit: 8 });
  const categorySummaries = counts.categoryCounts.filter((category) => category.categoryId !== null);
  const uncategorizedSummary = counts.categoryCounts.find((category) => category.categoryId === null) ?? null;
  const reportRecords = (reports ?? []) as ReportRow[];
  const [reportSectionLinksResult, reportArtifactsResult] = reportRecords.length
    ? await Promise.all([
        supabase
          .from("report_sections")
          .select("report_id, section_key, enabled, config_json")
          .in(
            "report_id",
            reportRecords.map((report) => report.id)
          ),
        supabase
          .from("report_artifacts")
          .select("report_id, generated_at")
          .in(
            "report_id",
            reportRecords.map((report) => report.id)
          ),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  // These two decide whether a report is labelled "Campaign source linked" or
  // "Project-linked only", and how fresh its packet is. A failed section read
  // silently demotes every report to project-linked — a statement that the
  // campaign is sourced nowhere, made out of a query that never returned.
  const reportSectionLinksUnreadable = reads.check(
    "which reports name this campaign as a source",
    reportSectionLinksResult
  );
  reads.check("the generated packets for those reports", reportArtifactsResult);
  const reportIdsExplicitlyLinkedToCampaign = collectReportIdsLinkedToEngagementCampaign(
    (reportSectionLinksResult.data ?? []) as ReportSectionLinkRow[],
    campaign.id
  );
  const latestArtifactGeneratedAtByReportId = new Map<string, string | null>();
  for (const row of (reportArtifactsResult.data ?? []) as Array<{ report_id: string; generated_at: string | null }>) {
    const current = latestArtifactGeneratedAtByReportId.get(row.report_id);
    const rowTime = row.generated_at ? new Date(row.generated_at).getTime() : Number.NEGATIVE_INFINITY;
    const currentTime = current ? new Date(current).getTime() : Number.NEGATIVE_INFINITY;
    if (!latestArtifactGeneratedAtByReportId.has(row.report_id) || rowTime > currentTime) {
      latestArtifactGeneratedAtByReportId.set(row.report_id, row.generated_at);
    }
  }
  const campaignLinkedReports = reportRecords
    .map((report) => ({
      ...report,
      isExplicitCampaignSource: reportIdsExplicitlyLinkedToCampaign.has(report.id),
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: latestArtifactGeneratedAtByReportId.get(report.id) ?? report.generated_at,
        updatedAt: report.updated_at,
      }),
    }))
    .sort((left, right) => {
      const explicitSourcePriority = Number(right.isExplicitCampaignSource) - Number(left.isExplicitCampaignSource);
      if (explicitSourcePriority !== 0) {
        return explicitSourcePriority;
      }

      const freshnessPriority =
        getReportPacketPriority(left.packetFreshness.label) -
        getReportPacketPriority(right.packetFreshness.label);
      if (freshnessPriority !== 0) {
        return freshnessPriority;
      }

      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });
  const explicitlyLinkedReportCount = campaignLinkedReports.filter((report) => report.isExplicitCampaignSource).length;
  const projectOnlyReportCount = campaignLinkedReports.length - explicitlyLinkedReportCount;
  const refreshRecommendedReportCount = campaignLinkedReports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED
  ).length;
  const noPacketReportCount = campaignLinkedReports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET
  ).length;
  const packetAttentionCount = refreshRecommendedReportCount + noPacketReportCount;
  const recommendedCampaignReport =
    campaignLinkedReports.find((report) => report.isExplicitCampaignSource) ?? campaignLinkedReports[0] ?? null;
  const sourceSummaries = [...counts.sourceSummaries].sort((left, right) => right.count - left.count);
  const primarySource = sourceSummaries.find((source) => source.count > 0) ?? null;
  const recentItems = (items ?? []).slice(0, 20);

  // Photo thumbnails: the engagement-photos bucket is private with zero
  // storage policies, so signing requires the service role. This is safe
  // here because the RLS-scoped campaign read above already proved the
  // current user's workspace membership — moderators may see photos on
  // pending/flagged items; the public portal only ever signs approved ones.
  type ItemPhotoRef = { id: string; photo_path: string | null };
  const itemsWithPhotos = ((items ?? []) as ItemPhotoRef[]).filter(
    (item): item is { id: string; photo_path: string } =>
      typeof item.photo_path === "string" && item.photo_path.length > 0
  );
  const photoUrlByItemId = new Map<string, string>();
  if (itemsWithPhotos.length > 0) {
    const serviceClient = createServiceRoleClient();
    // Signing can fail on its own (bucket policy, expired service key) while
    // every comment loaded fine. A moderator looking at a comment whose photo
    // is the whole content must be told the photo could not be fetched, not
    // shown a comment that appears to have none.
    const signedUrlsResult = await serviceClient.storage
      .from(ENGAGEMENT_PHOTO_BUCKET)
      .createSignedUrls(
        itemsWithPhotos.map((item) => item.photo_path),
        ENGAGEMENT_PHOTO_SIGNED_URL_TTL_SECONDS
      );
    reads.check("photo thumbnails for the comments that have one", signedUrlsResult);
    const signedUrls = signedUrlsResult.data;
    for (const item of itemsWithPhotos) {
      const signed = (signedUrls ?? []).find((entry) => entry.path === item.photo_path);
      if (signed?.signedUrl) {
        photoUrlByItemId.set(item.id, signed.signedUrl);
      }
    }
  }

  type ItemGeometryRef = {
    id: string;
    title: string | null;
    body: string;
    latitude: number | null;
    longitude: number | null;
    geometry: unknown;
    votes_count: number | null;
    category_id: string | null;
  };
  const locatedItems = ((items ?? []) as ItemGeometryRef[]).filter(
    (item) => item.geometry !== null || (item.latitude !== null && item.longitude !== null)
  );

  // THE CAMPAIGN'S GIS CONTEXT, AND WHO MAY CHANGE IT.
  //
  // Role comes from `loadCampaignAccess` — the SAME function the upload route
  // gates on, called with the same action — so the panel and the API cannot
  // disagree about who gets a button. RLS proved this user is IN the workspace;
  // it did not prove their role. A viewer shown a control the route will 403 is
  // a worse screen than no control, and a member denied one they are allowed to
  // press is a capability nobody can reach.
  //
  // Two reads of the layer table, deliberately. The summary projection carries
  // no geometry, because a campaign with a dozen parcel layers must not ship
  // every polygon to a management list. The participant projection carries the
  // geometry and only PUBLISHED layers, and it is the same call the portal
  // makes, so a moderator reviews located comments against exactly what the
  // resident was looking at when they wrote them — "move it to the other side"
  // is no more reviewable over a blank basemap than it was writable over one.
  const [layerAccess, contextLayers, publishedContextLayers] = await Promise.all([
    loadCampaignAccess(supabase, campaign.id, user.id, "engagement.write"),
    loadCampaignContextLayerSummaries(supabase, campaign.id),
    loadParticipantContextLayers(supabase, campaign.id),
  ]);
  const canManageContextLayers = "allowed" in layerAccess && Boolean(layerAccess.allowed);

  // Participation insights (E3): the heatmap, the intake trend, and the
  // screening-grade spatial hotspot test. Sentiment for the hotspot test is
  // AI-derived from the campaign's E1 synthesis (a proxy), never a column.
  const negativeItemIds = negativeItemIdsFromSyntheses([campaign.ai_synthesis_json]);
  const negativeItemIdSet = new Set(negativeItemIds);
  const { analysis: hotspots } = await loadSentimentHotspots(supabase, {
    workspaceId: campaign.workspace_id,
    campaignId: campaign.id,
    negativeItemIds,
  });
  const heatmapPoints: HeatmapPoint[] = (
    (items ?? []) as Array<{
      id: string;
      status: string | null;
      latitude: number | null;
      longitude: number | null;
      votes_count: number | null;
    }>
  )
    .filter((it) => it.status === "approved" && typeof it.latitude === "number" && typeof it.longitude === "number")
    .map((it) => ({
      lng: it.longitude as number,
      lat: it.latitude as number,
      weight: (it.votes_count ?? 0) + 1,
      negative: negativeItemIdSet.has(it.id),
    }));
  const intakeTrend = buildDailyIntake(
    (items ?? []) as Array<{ created_at?: string | null; updated_at?: string | null }>
  );
  // E5a — k-anonymized self-reported demographics (only when the campaign opted
  // in). The SOURCE, not the summary: a failed aggregate read used to arrive here
  // as an empty one and render as "no respondents have shared demographics yet".
  const demographicsSource = await loadSelfReportedDemographicsSource(supabase, campaign.id, {
    collectionEnabled: campaign.demographics_enabled,
  });
  // E5c — read the two representativeness screens against each other. Pure over
  // caches the page already holds, so it costs nothing extra to compute and
  // degrades in both directions: no self-reported side never reads as
  // unrepresentative, no ACS baseline never reads as representative.
  const jointRepresentativeness = buildJointRepresentativeness({
    ecological: campaign.representativeness_json,
    selfReported: demographicsSource,
  });
  // E9 — fuzzy near-duplicate groups (pg_trgm) to help moderators collapse
  // paraphrased/re-posted comments the exact fingerprint check misses.
  const nearDuplicates =
    (items?.length ?? 0) >= 2
      ? (await loadNearDuplicates(supabase, { workspaceId: campaign.workspace_id, campaignId: campaign.id })).analysis
      : null;
  const nearDuplicateSnippetById = new Map(
    ((items ?? []) as Array<{ id: string; body: string; status: string | null }>).map((item) => [
      item.id,
      { snippet: item.body.trim().replace(/\s+/g, " ").slice(0, 120), status: item.status ?? "pending" },
    ])
  );

  // E9 part 2 — AI moderation assist: the queue (pending/flagged) plus whatever
  // the last scan persisted into metadata_json.ai_moderation. Read back by the
  // module that owns the write shape, so a stored value this build does not
  // recognize cannot be cast into one it does.
  const moderationQueue = buildModerationQueueView(
    (items ?? []) as Array<{ id: string; body: string; status: string | null; metadata_json?: unknown }>
  );

  // LANGUAGE ACCESS — what this campaign says in each of the languages the
  // portal can be read in, and what may honestly be claimed about that.
  //
  // Read through the CALLER's client on purpose: `engagement_content_translations`
  // has a member SELECT policy, so this is defense-in-depth with the membership
  // the campaign read above already proved, and a viewer sees the same coverage
  // an editor does (they simply get no controls).
  //
  // The reads inside are independently failure-tolerant, and one of those
  // failures is a REAL state right now rather than a hypothesis: the migration
  // that creates the table is not applied in every environment, and a select
  // against a missing relation errors. `coverage` then arrives NULL and the panel
  // says the answer is unknown — it must never draw a "not translated" card for
  // every language out of a database failure, because that is a claim about the
  // agency.
  const translationState = await loadCampaignTranslationState(supabase, campaign);
  // Whether the MODEL is reachable, asked inside the workspace's own integration
  // context so a workspace holding its own key is not told the deployment has
  // none. With no key the panel drops the suggestion controls and says why —
  // hand authoring is the capability, the model is only an accelerator.
  const machineTranslationAvailable = await withWorkspaceIntegrationContext(campaign.workspace_id, async () =>
    hasAnthropicAccess()
  );

  // WHY THE DISCLOSURE BLOCK IS FIRST. The readiness checks, the moderation
  // counts and half the panels below are computed over the reads above, so what
  // failed is stated once, before any of it. This is an operator surface, so the
  // database's own message is shown — it is what makes the failure actionable,
  // and no member of the public sees this page. The handoff verdict repeats the
  // caveat where it is read, because a failed read makes a readiness check FAIL:
  // an open check nothing established.
  //
  // WHY THE TRANSLATIONS PANEL SITS BESIDE THE MAP-LAYER PANEL. Both answer the
  // same operator question — what does a member of the public actually get on
  // this campaign's portal — and a translation surface filed anywhere else is a
  // surface nobody finds. `canManageContextLayers` is reused rather than
  // re-derived: it is the SAME `engagement.write` decision from the SAME
  // `loadCampaignAccess` call the translations route gates on, so the panel and
  // the API cannot disagree about who gets a button. A viewer still sees every
  // language's coverage — "what have we published in Spanish" is a question a
  // viewer is entitled to answer.
  //
  // Its three readability flags are passed STRAIGHT THROUGH rather than derived
  // at the render site from `coverage !== null`. Deriving them there collapsed
  // three different unknowns into one fact, and the panel says a different
  // sentence about each: translations unreadable is "unknown, not none"; a short
  // inventory means coverage is withheld because the list it would be measured
  // against is known to be incomplete; and a source language that could not be
  // READ must never be reported as a language nobody recorded — that is a
  // finding about the agency, and a failed query does not establish it.
  return (
    <section className="module-page">
      <CartographicSurfaceWide />
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/engagement" className="transition hover:text-foreground">
          Engagement
        </Link>
        <ArrowRight className="h-3.5 w-3.5" />
        <span className="text-foreground">{campaign.title}</span>
      </div>

      {reads.any ? (
        <div className="mb-4">
          <StateBlock
            tone="danger"
            title="Part of this campaign could not be read"
            description={`${reads.describe()} ${reads.messages().join(" · ")}`}
          />
        </div>
      ) : null}

      {query.created ? <EngagementCampaignCreatedNotice campaign={campaign} /> : null}

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
            <span className="module-record-chip"><span>Type</span><strong>{titleizeEngagementValue(campaign.engagement_type)}</strong></span>
          </div>
          <p className="text-[0.73rem] text-muted-foreground">
            {itemsUnreadable
              ? "Flagged count unavailable — the comments could not be read"
              : counts.statusCounts.flagged > 0
                ? `${counts.statusCounts.flagged} flagged`
                : "No flagged items"}
          </p>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{campaign.title}</h1>
            <p className="module-intro-description">
              {campaign.summary ||
                "This campaign is ready for categories, incoming comments, and moderation."}
            </p>
          </div>

          <EngagementPublicLinkCompact campaign={campaign} />

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Linked project</p>
              <p className="module-summary-value text-lg">
                {projectUnreadable ? "Unavailable" : project?.name ?? "Unlinked"}
              </p>
              <p className="module-summary-detail">
                {projectUnreadable
                  ? "This campaign names a project, but that record could not be read — it is not unlinked."
                  : "Project context stays visible so engagement does not float free."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Review queue</p>
              <p className="module-summary-value">
                {itemsUnreadable ? "Unavailable" : counts.moderationQueue.actionableCount}
              </p>
              <p className="module-summary-detail">
                {itemsUnreadable
                  ? "The comments could not be read, so the queue depth is unknown rather than empty."
                  : `${counts.statusCounts.pending} pending, ${counts.statusCounts.flagged} flagged for operator review.`}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Report status</p>
              <p className="module-summary-value">{handoffReadiness.completeCount}/{handoffReadiness.totalChecks}</p>
              <p className="module-summary-detail">
                {handoffReadiness.label}. {counts.statusCounts.approved} approved, {counts.uncategorizedItems} still need category assignment.
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
              <p className="module-operator-eyebrow">Moderation Summary</p>
              <h2 className="module-operator-title">Audit posture and review status</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Current moderation workload and workload signals. Operators should triage flagged and pending items before generating reports.
          </p>
          <div className="module-operator-list">
            {itemsUnreadable ? (
              <div className="module-operator-item">
                Moderation workload unavailable — the comments could not be read, so these are not counts of zero.
              </div>
            ) : (
              <>
                <div className="module-operator-item">Pending: {counts.moderationQueue.pendingCount}</div>
                <div className="module-operator-item">Flagged: {counts.moderationQueue.flaggedCount}</div>
                <div className="module-operator-item">Triaged: {counts.moderationQueue.triagedCount} ({fmtPercent(counts.moderationQueue.triagedShare)})</div>
                <div className="module-operator-item">Recent activity: {counts.recentActivity.count} items in the last 7 days</div>
                <div className="module-operator-item">Moderation notes present on {counts.moderationQueue.itemsWithNotesCount} items</div>
              </>
            )}
            <div className="module-operator-item">
              Linked reports: {reportsUnreadable || projectUnreadable ? "unavailable" : reportRecords.length}
            </div>
            <div className="module-operator-item">Last updated {fmtDateTime(campaign.updated_at)}</div>
          </div>
        </article>
      </header>

      <div className="mt-6 space-y-6">
        <CampaignHandoffReadinessSection
          handoffReadiness={handoffReadiness}
          publicReviewCopyGuard={publicReviewCopyGuard}
          counts={counts}
          appendixReadiness={appendixReadiness}
          commentMatrixPreview={commentMatrixPreview}
          campaign={campaign}
          project={project}
          projectUnreadable={projectUnreadable}
          readsIncomplete={projectUnreadable || categoriesUnreadable || itemsUnreadable}
          itemsUnreadable={itemsUnreadable}
          primarySource={primarySource}
          reportCount={reportRecords.length}
          linkedReportCount={campaignLinkedReports.length}
          packetAttentionCount={packetAttentionCount}
          recommendedReport={recommendedCampaignReport}
        />

        <CampaignLinkedReportsSection
          projectUnreadable={projectUnreadable}
          reportsUnreadable={reportsUnreadable}
          reportSectionLinksUnreadable={reportSectionLinksUnreadable}
          projectLinked={Boolean(project)}
          reports={campaignLinkedReports}
          explicitlyLinkedReportCount={explicitlyLinkedReportCount}
          projectOnlyReportCount={projectOnlyReportCount}
          packetAttentionCount={packetAttentionCount}
          recommendedReport={recommendedCampaignReport}
          latestArtifactGeneratedAtByReportId={latestArtifactGeneratedAtByReportId}
        />

        {/*
          THE RTP ATTACHMENT, VISIBLE FROM THE CAMPAIGN SIDE. These two columns
          were written only by the RTP cycle page's campaign creator and read by
          nothing on this console — so a moderator triaging comments collected
          for a plan could not see which plan, and the link was uneditable from
          here. The display lives on the console; the edit lives in Campaign
          management below (the same PATCH the rest of the metadata uses).
        */}
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Regional plan</p>
              <h2 className="module-section-title">RTP attachment</h2>
              <p className="module-section-description">
                Which Regional Transportation Plan cycle this campaign collects input for. Comments
                on an attached campaign feed that plan&apos;s comment-response record instead of
                being re-associated by hand later.
              </p>
            </div>
          </div>
          <div className="mt-5">
            {campaign.rtp_cycle_id === null ? (
              <p className="text-sm text-muted-foreground">
                This campaign is not attached to an RTP cycle. If its comments belong to a plan,
                attach one under Campaign management at the bottom of this page.
              </p>
            ) : rtpCycleUnreadable ? (
              <StateBlock
                tone="danger"
                title="The attached RTP cycle could not be read"
                description="This campaign is attached to an RTP cycle, but that record could not be loaded. The attachment is still in place — this is a failed read, not a missing attachment."
                compact
              />
            ) : !rtpCycle ? (
              <StateBlock
                tone="warning"
                title="The attached RTP cycle could not be found"
                description="This campaign records an attachment to an RTP cycle, but no such cycle came back. It may have been deleted; the attachment can be cleared or repointed under Campaign management below."
                compact
              />
            ) : (
              <div className="module-record-row">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone="info">{titleizeEngagementValue(rtpCycle.status)}</StatusBadge>
                      <span className="text-sm font-semibold text-foreground">{rtpCycle.title}</span>
                    </div>
                    <p className="module-record-summary">
                      {campaign.rtp_cycle_chapter_id === null
                        ? "Comments land on the whole plan — no specific chapter is targeted."
                        : rtpChapterUnreadable
                          ? "A specific chapter is targeted, but its record could not be read."
                          : rtpChapter
                            ? `Targeted chapter: ${rtpChapter.title}`
                            : "A specific chapter is targeted, but it could not be found — it may have been deleted."}
                    </p>
                  </div>
                </div>
                <MetaList>
                  <MetaItem>
                    <Link
                      href={`/rtp/${rtpCycle.id}`}
                      className="underline underline-offset-2 transition hover:text-foreground"
                    >
                      Open the RTP cycle
                    </Link>
                  </MetaItem>
                </MetaList>
              </div>
            )}
          </div>
        </article>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="space-y-6">
          <EngagementNotificationsInbox campaignId={campaign.id} initialNotifications={notifications} />
          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Category Registry</p>
                <h2 className="module-section-title">Current categories</h2>
                <p className="module-section-description">
                  Category structure stays intentionally light, and each category shows its item volume and moderation load.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <EngagementCategoryCreator campaignId={campaign.id} />
            </div>

            {categoriesUnreadable ? (
              <div className="mt-5">
                <StateBlock
                  tone="danger"
                  title="This campaign's categories could not be read"
                  description="OpenPlan cannot say whether this campaign has categories. Do not add duplicates on the strength of this screen — the list is missing, not empty."
                  compact
                />
              </div>
            ) : !(categories?.length) ? (
              <div className="mt-5">
                <EmptyState
                  title="No categories yet"
                  description="Add a few categories so intake can be classified before downstream reports rely on it."
                  compact
                />
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {categorySummaries.map((category) => (
                  <div key={category.categoryId} className="module-record-row">
                    <div className="module-record-head">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone="info">{category.label}</StatusBadge>
                          <StatusBadge tone={category.flaggedCount > 0 ? "warning" : "neutral"}>
                            {category.count} items
                          </StatusBadge>
                          {category.flaggedCount > 0 ? (
                            <StatusBadge tone="warning">{category.flaggedCount} flagged</StatusBadge>
                          ) : null}
                        </div>
                        <p className="module-record-summary">
                          {category.description || "No description yet. This category is available for classification."}
                        </p>
                      </div>
                    </div>
                    <MetaList>
                      <MetaItem>{Math.round(category.shareOfItems * 100)}% of campaign items</MetaItem>
                      <MetaItem>{category.pendingCount} pending</MetaItem>
                      <MetaItem>{category.approvedCount} approved</MetaItem>
                      <MetaItem>Last activity {fmtDateTime(category.lastActivityAt)}</MetaItem>
                    </MetaList>
                  </div>
                ))}

                {uncategorizedSummary && uncategorizedSummary.count > 0 ? (
                  <div className="module-record-row">
                    <div className="module-record-head">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone="warning">{uncategorizedSummary.label}</StatusBadge>
                          <StatusBadge tone="warning">{uncategorizedSummary.count} items</StatusBadge>
                        </div>
                        <p className="module-record-summary">{uncategorizedSummary.description}</p>
                      </div>
                    </div>
                    <MetaList>
                      <MetaItem>{uncategorizedSummary.pendingCount} pending</MetaItem>
                      <MetaItem>{uncategorizedSummary.flaggedCount} flagged</MetaItem>
                      <MetaItem>Last activity {fmtDateTime(uncategorizedSummary.lastActivityAt)}</MetaItem>
                    </MetaList>
                  </div>
                ) : null}
              </div>
            )}
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Analytics</p>
                <h2 className="module-section-title">Source and geography breakdown</h2>
                <p className="module-section-description">
                  Keep the summary lightweight but decision-useful: where intake came from, how much has map signal, and what still needs triage.
                </p>
              </div>
            </div>

            {itemsUnreadable ? (
              <div className="mt-5">
                <StateBlock
                  tone="danger"
                  title="The source and geography breakdown could not be computed"
                  description="Every number in this panel comes from the campaign's comments, and that read failed. No mix is shown rather than a mix of zero."
                  compact
                />
              </div>
            ) : sourceSummaries.every((source) => source.count === 0) ? (
              <div className="mt-5">
                <EmptyState title="No source mix yet" description="Add comments to see where input comes from and how coverage looks on the map." compact />
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {sourceSummaries
                  .filter((source) => source.count > 0)
                  .map((source) => (
                    <div key={source.sourceType} className="module-record-row">
                      <div className="module-record-head">
                        <div className="module-record-main">
                          <div className="module-record-kicker">
                            <StatusBadge tone="info">{titleizeEngagementValue(source.sourceType)}</StatusBadge>
                            <StatusBadge tone={source.flaggedCount > 0 ? "warning" : "neutral"}>{source.count} items</StatusBadge>
                            <StatusBadge tone={source.geolocatedCount > 0 ? "success" : "neutral"}>
                              <MapPinned className="h-3 w-3" />
                              {source.geolocatedCount} mapped
                            </StatusBadge>
                          </div>
                          <p className="module-record-summary">
                            {fmtPercent(source.shareOfItems)} of campaign intake. {source.pendingCount} pending, {source.approvedCount} approved, {source.rejectedCount} rejected.
                          </p>
                        </div>
                      </div>
                      <MetaList>
                        <MetaItem>{source.categorizedCount} categorized</MetaItem>
                        <MetaItem>{source.nonGeolocatedCount} non-geolocated</MetaItem>
                        <MetaItem>{source.flaggedCount} flagged</MetaItem>
                        <MetaItem>Last activity {fmtDateTime(source.lastActivityAt)}</MetaItem>
                      </MetaList>
                    </div>
                  ))}
              </div>
            )}
          </article>
        </div>

        <div className="space-y-6">
          <EngagementContextLayersPanel
            campaignId={campaign.id}
            layers={contextLayers.layers}
            readFailure={contextLayers.readFailure}
            canWrite={canManageContextLayers}
          />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Offline input</p>
                <h2 className="module-section-title">Comments that did not come through the portal</h2>
                <p className="module-section-description">
                  The open house, the comment cards, the project inbox, the council transcript. Everything
                  this page says about the campaign is computed over the comments it holds, so input that
                  never got entered is missing from the synthesis, the representativeness reading and the
                  appendix — and it is missing in a predictable direction, because portal submissions skew
                  toward people with a device and a data plan.
                </p>
              </div>
            </div>
            <div className="mt-5">
              <CommentImportPanel campaignId={campaign.id} />
            </div>
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Taking part another way</p>
                <h2 className="module-section-title">If a resident cannot use the portal</h2>
                <p className="module-section-description">
                  A map, a form and a comment feed each have people they do not work for. This is the
                  contact a resident reaches when the page is not usable for them — your agency&apos;s
                  words, not OpenPlan&apos;s, shown on the public portal in the resident&apos;s language.
                  OpenPlan makes no claim that the portal meets any accessibility standard, and this is
                  not one.
                </p>
              </div>
            </div>
            <div className="mt-5">
              <CampaignAccessibilityEditor
                campaignId={campaign.id}
                portalIsLive={Boolean(campaign.share_token) && campaign.allow_public_submissions && !campaign.submissions_closed_at}
                initial={{
                  contactLabel: campaign.accessibility_contact_label,
                  contactEmail: campaign.accessibility_contact_email,
                  contactPhone: campaign.accessibility_contact_phone,
                  alternateFormats: campaign.accessibility_alternate_formats,
                }}
              />
            </div>
          </article>

          <CampaignTranslationsPanel
            campaignId={campaign.id}
            fields={translationState.fields}
            entries={translationState.entries}
            coverage={translationState.coverage}
            sourceLocale={translationState.sourceLocale}
            sourceLocaleStated={translationState.sourceLocaleStated}
            readFailures={translationState.readFailures}
            translationsReadable={translationState.translationsReadable}
            inventoryComplete={translationState.inventoryComplete}
            sourceLocaleReadable={translationState.sourceLocaleReadable}
            machineTranslationAvailable={machineTranslationAvailable}
            machineBatchMax={MACHINE_TRANSLATION_BATCH_MAX}
            acceptBatchMax={TRANSLATION_ACCEPT_BATCH_MAX}
            canWrite={canManageContextLayers}
          />

          {locatedItems.length > 0 ? (
            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Geometry Review</p>
                  <h2 className="module-section-title">Located comments on the map</h2>
                  <p className="module-section-description">
                    Every item with a point, line, or area renders here — including pending and flagged items — so moderators can review geometry before approval.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <LocationDisplayMap
                  contextLayers={publishedContextLayers}
                  items={locatedItems.map((item) => ({
                    id: item.id,
                    latitude: item.latitude,
                    longitude: item.longitude,
                    title: item.title,
                    body: item.body,
                    geometry: item.geometry,
                    votesCount: item.votes_count ?? 0,
                    color: item.category_id ? categoryColorById.get(item.category_id) ?? null : null,
                  }))}
                />
              </div>
            </article>
          ) : null}

          {counts.statusCounts.approved > 0 ? (
            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">AI Synthesis</p>
                  <h2 className="module-section-title">Themes and cited narrative</h2>
                  <p className="module-section-description">
                    Cluster the approved comments into themes with sentiment and a narrative where every
                    sentence cites the source comments — screening-grade, not a representativeness finding.
                    Falls back to a deterministic summary when AI is offline.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <EngagementSynthesisPanel
                  campaignId={campaign.id}
                  approvedItemCount={counts.statusCounts.approved}
                  initialSynthesis={campaign.ai_synthesis_json}
                  initialSynthesizedAt={campaign.ai_synthesized_at}
                />
              </div>
            </article>
          ) : null}

          {(items?.length ?? 0) > 0 ? (
            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Participation Insights</p>
                  <h2 className="module-section-title">Heatmap and spatial hotspots</h2>
                  <p className="module-section-description">
                    Where residents engaged, the mix of what they said, and a screening-grade test for
                    statistically elevated clusters of negative sentiment — the spatial signal no pure
                    comment tool surfaces. Not an inferential or representativeness finding.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                {/*
                  The clustering radius is adjustable rather than fixed at 250 m.
                  A single default is a claim about geographic scale, and this
                  page serves a downtown block and a rural county equally — see
                  `SpatialHotspotTuner`. The first render is still the server's,
                  so this surface is complete before any JavaScript runs.
                */}
                <SpatialHotspotTuner
                  campaignId={campaign.id}
                  points={heatmapPoints}
                  initialHotspots={hotspots}
                  counts={counts}
                  categories={
                    (categories ?? []) as Array<{ id: string; label: string | null; color?: string | null }>
                  }
                  intake={intakeTrend}
                />
              </div>
            </article>
          ) : null}

          {surveyResults.approvedResponseCount > 0 ? (
            <EngagementSurveyResults
              approvedResponseCount={surveyResults.approvedResponseCount}
              questions={surveyResults.questions}
            />
          ) : null}

          {jointReadingIsPresentable(jointRepresentativeness) ? (
            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Representativeness</p>
                  <h2 className="module-section-title">Both screenings read together (screening)</h2>
                  <p className="module-section-description">
                    The area-based screening infers who was reached from the tracts comments came from; the
                    self-reported screening asks respondents directly. They can disagree, and when they do the
                    area-based inference is the one that can be wrong about individuals. Only race / ethnicity is
                    comparable across the two — the rest of each vocabulary has no counterpart.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <JointRepresentativenessPanel
                  joint={jointRepresentativeness}
                  spatialScreeningAvailable={heatmapPoints.length > 0}
                />
              </div>
            </article>
          ) : null}

          {demographicsSource.state !== "not_collected" && demographicsSource.state !== "not_loaded" ? (
            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Representativeness</p>
                  <h2 className="module-section-title">Respondent demographics (screening)</h2>
                  <p className="module-section-description">
                    Optional, self-reported demographics of respondents, shown only as k-anonymized aggregates. A
                    screening cue to check whether outreach reached the whole community — not a statistical sample or a
                    civil-rights finding.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <DemographicsPanel source={demographicsSource} />
              </div>
            </article>
          ) : null}

          {heatmapPoints.length > 0 ? (
            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Representativeness</p>
                  <h2 className="module-section-title">Where engagement came from (screening)</h2>
                  <p className="module-section-description">
                    An ecological, area-based check: did comments come disproportionately from higher- or lower-need
                    tracts than the study area as a whole? Inferred from geography over a self-selected sample — a cue
                    to check outreach reach, not a statistical sample or a civil-rights finding.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <RepresentativenessPanel campaignId={campaign.id} initialResult={campaign.representativeness_json} />
              </div>
            </article>
          ) : null}

          {nearDuplicates && nearDuplicates.groupCount > 0 ? (
            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Moderation</p>
                  <h2 className="module-section-title">Near-duplicate comments</h2>
                  <p className="module-section-description">
                    Fuzzy trigram look-alikes the exact-duplicate check misses (paraphrases, typos, re-posts) — a
                    screening aid to help collapse duplicates. Nothing is merged automatically.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <NearDuplicatesPanel analysis={nearDuplicates} snippetById={nearDuplicateSnippetById} />
              </div>
            </article>
          ) : null}

          {moderationQueue.queueItemCount > 0 ? (
            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Moderation</p>
                  <h2 className="module-section-title">AI moderation assist</h2>
                  <p className="module-section-description">
                    A Claude pass over the review queue that flags possible toxicity, personal info, off-topic, or
                    spam with a rationale — a triage aid. It never changes a comment&rsquo;s status; a moderator
                    decides. Falls back to a deterministic PII/spam check when AI is offline.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <AiModerationPanel campaignId={campaign.id} queue={moderationQueue} />
              </div>
            </article>
          ) : null}

          {(items?.length ?? 0) > 0 && (
            <EngagementBulkModeration
              campaignId={campaign.id}
              items={(items ?? []) as Array<{
                id: string;
                campaign_id: string;
                category_id: string | null;
                title: string | null;
                status: string;
                source_type: string;
              }>}
              categories={((categories ?? []) as Array<{ id: string; label: string }>).map((c) => ({
                id: c.id,
                label: c.label,
              }))}
            />
          )}

          {items?.length ? (
            <EngagementItemRegistry
              items={(recentItems as Array<{
                id: string;
                campaign_id: string;
                category_id: string | null;
                title: string | null;
                body: string;
                submitted_by: string | null;
                status: string;
                source_type: string;
                moderation_notes: string | null;
                latitude: number | null;
                longitude: number | null;
                geometry: unknown;
                votes_count: number | null;
                parent_item_id: string | null;
                updated_at: string;
              }>).map((item) => ({
                ...item,
                photo_url: photoUrlByItemId.get(item.id) ?? null,
              }))}
              categories={((categories ?? []) as Array<{ id: string; label: string }>).map((category) => ({
                id: category.id,
                label: category.label,
              }))}
              counts={counts}
            />
          ) : (
            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Moderation</p>
                  <h2 className="module-section-title">Recent intake registry</h2>
                  <p className="module-section-description">
                    {itemsUnreadable
                      ? "The comments on this campaign could not be read, so none can be listed here."
                      : "Create the first item to open moderation state inside this campaign."}
                  </p>
                </div>
              </div>
              <div className="mt-5">
                {itemsUnreadable ? (
                  // NOT "No intake items yet". On a live campaign that sentence
                  // says nobody in the community responded — the loudest false
                  // claim this console can make, and a broken query cannot make
                  // it.
                  <StateBlock
                    tone="danger"
                    title="This campaign's comments could not be read"
                    description="OpenPlan cannot say how much input this campaign has received. Nothing here means the campaign is empty — reload, and if it keeps failing the error is reported at the top of this page."
                  />
                ) : (
                  <EmptyState
                    title="No intake items yet"
                    description="Add internal notes, meeting observations, or moderated public input to start the campaign record."
                  />
                )}
              </div>
            </article>
          )}
        </div>
      </div>

      <EngagementOperatorActions
        campaign={campaign}
        projects={(projects ?? []) as Array<{ id: string; name: string }>}
        categories={builderCategories}
        surveyQuestions={surveyQuestions}
        closeLoopEntries={closeLoopEntries}
      />
    </section>
  );
}
