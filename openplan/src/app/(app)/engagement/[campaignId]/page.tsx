import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { ArrowRight, FileStack, MapPinned, MessageSquareText, ShieldCheck } from "lucide-react";
import { EngagementCampaignControls } from "@/components/engagement/engagement-campaign-controls";
import { EngagementReportCreateButton } from "@/components/engagement/engagement-report-create-button";
import { EngagementCategoryCreator } from "@/components/engagement/engagement-category-creator";
import { EngagementItemComposer } from "@/components/engagement/engagement-item-composer";
import { EngagementItemRegistry } from "@/components/engagement/engagement-item-registry";
import { EngagementSurveyBuilder } from "@/components/engagement/survey-builder";
import { EngagementSurveyResults } from "@/components/engagement/survey-results-panel";
import { EngagementCloseLoopBuilder } from "@/components/engagement/close-loop-builder";
import { EngagementNotificationsInbox } from "@/components/engagement/notifications-inbox";
import { EngagementShareControls } from "@/components/engagement/engagement-share-controls";
import { EngagementBulkModeration } from "@/components/engagement/engagement-bulk-moderation";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";
import { buildEngagementCommentMatrixPreview } from "@/lib/engagement/comment-matrix";
import { getEngagementHandoffReadiness, getEngagementPublicReviewCopyGuard } from "@/lib/engagement/readiness";
import { loadSurveyBuilderDefinition, aggregateCampaignSurvey } from "@/lib/engagement/survey-responses";
import { loadCloseLoopEntries } from "@/lib/engagement/close-loop";
import { loadOperatorNotifications } from "@/lib/notifications/engagement";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import {
  formatReportStatusLabel,
  formatReportTypeLabel,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  getReportPacketPriority,
  reportStatusTone,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { collectReportIdsLinkedToEngagementCampaign } from "@/lib/reports/engagement";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  ENGAGEMENT_PHOTO_BUCKET,
  ENGAGEMENT_PHOTO_SIGNED_URL_TTL_SECONDS,
} from "@/lib/engagement/photo";
import { LocationDisplayMap } from "@/components/engagement/location-display-map";
import { EngagementSynthesisPanel } from "@/components/engagement/engagement-synthesis-panel";
import { ParticipationHeatmapMap, type HeatmapPoint } from "@/components/engagement/participation-heatmap-map";
import { ParticipationDashboard } from "@/components/engagement/participation-dashboard";
import { DemographicsPanel } from "@/components/engagement/demographics-panel";
import { loadDemographicsSummary } from "@/lib/engagement/demographics";
import { RepresentativenessPanel } from "@/components/engagement/representativeness-panel";
import type { CampaignRepresentativeness } from "@/lib/engagement/representativeness";
import { NearDuplicatesPanel } from "@/components/engagement/near-duplicates-panel";
import { loadNearDuplicates } from "@/lib/engagement/near-duplicates";
import { AiModerationPanel, type ModeratedItem } from "@/components/engagement/ai-moderation-panel";
import type { ItemModeration } from "@/lib/engagement/ai-moderation";
import {
  hotspotsToFeatureCollection,
  loadSentimentHotspots,
  negativeItemIdsFromSyntheses,
} from "@/lib/engagement/hotspots";
import { buildDailyIntake } from "@/lib/engagement/participation-dashboard";
import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";

type CampaignRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
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
    .select("id, workspace_id, project_id, title, summary, status, engagement_type, share_token, public_description, allow_public_submissions, submissions_closed_at, demographics_enabled, representativeness_json, ai_synthesis_json, ai_synthesized_at, created_at, updated_at")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaignData) {
    notFound();
  }

  const campaign = campaignData as CampaignRow;

  const [{ data: project }, { data: categories }, { data: items }, { data: projects }, { data: reports }] = await Promise.all([
    campaign.project_id
      ? supabase
          .from("projects")
          .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
          .eq("id", campaign.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
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
      : Promise.resolve({ data: [] }),
  ]);

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
  const reportIdsExplicitlyLinkedToCampaign = collectReportIdsLinkedToEngagementCampaign(
    (reportSectionLinksResult.data ?? []) as ReportSectionLinkRow[],
    campaign.id
  );
  const latestArtifactByReportId = new Map<string, { generated_at: string | null }>();
  for (const row of (reportArtifactsResult.data ?? []) as Array<{ report_id: string; generated_at: string | null }>) {
    const current = latestArtifactByReportId.get(row.report_id);
    const rowTime = row.generated_at ? new Date(row.generated_at).getTime() : Number.NEGATIVE_INFINITY;
    const currentTime = current?.generated_at ? new Date(current.generated_at).getTime() : Number.NEGATIVE_INFINITY;
    if (!current || rowTime > currentTime) {
      latestArtifactByReportId.set(row.report_id, { generated_at: row.generated_at });
    }
  }
  const campaignLinkedReports = reportRecords
    .map((report) => ({
      ...report,
      isExplicitCampaignSource: reportIdsExplicitlyLinkedToCampaign.has(report.id),
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at,
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
    const { data: signedUrls } = await serviceClient.storage
      .from(ENGAGEMENT_PHOTO_BUCKET)
      .createSignedUrls(
        itemsWithPhotos.map((item) => item.photo_path),
        ENGAGEMENT_PHOTO_SIGNED_URL_TTL_SECONDS
      );
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
  const hotspotFeatures = hotspotsToFeatureCollection(hotspots.clusters);
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
  // E5a — k-anonymized self-reported demographics (only when the campaign opted in).
  const demographicsSummary = campaign.demographics_enabled
    ? (await loadDemographicsSummary(supabase, campaign.id)).summary
    : null;
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

  // E9 part 2 — AI moderation assist: the queue (pending/flagged) + any stored
  // per-item assessment (metadata_json.ai_moderation), flagged items surfaced.
  type StoredModeration = {
    flags?: string[];
    severity?: string;
    rationale?: string;
    suggested_action?: string;
    source?: string;
  };
  const moderationQueueItems = ((items ?? []) as Array<{
    id: string;
    body: string;
    status: string | null;
    metadata_json?: { ai_moderation?: StoredModeration } | null;
  }>).filter((item) => item.status === "pending" || item.status === "flagged");
  const moderationFlagged: ModeratedItem[] = moderationQueueItems
    .filter((item) => (item.metadata_json?.ai_moderation?.flags?.length ?? 0) > 0)
    .map((item) => {
      const mod = item.metadata_json!.ai_moderation!;
      return {
        id: item.id,
        snippet: item.body.trim().replace(/\s+/g, " ").slice(0, 120),
        moderation: {
          item_id: item.id,
          flags: (mod.flags ?? []) as ItemModeration["flags"],
          severity: (mod.severity ?? "none") as ItemModeration["severity"],
          rationale: mod.rationale ?? "",
          suggested_action: (mod.suggested_action ?? "review") as ItemModeration["suggested_action"],
        },
      };
    });
  const lastModerationSource =
    (moderationQueueItems.find((item) => item.metadata_json?.ai_moderation?.source)?.metadata_json?.ai_moderation
      ?.source as "ai" | "deterministic-fallback" | undefined) ?? null;

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
          <p className="text-[0.73rem] text-muted-foreground">{counts.statusCounts.flagged > 0 ? `${counts.statusCounts.flagged} flagged` : "No flagged items"}</p>
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
              <p className="module-summary-label">Review queue</p>
              <p className="module-summary-value">{counts.moderationQueue.actionableCount}</p>
              <p className="module-summary-detail">
                {counts.statusCounts.pending} pending, {counts.statusCounts.flagged} flagged for operator review.
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
            <div className="module-operator-item">Pending: {counts.moderationQueue.pendingCount}</div>
            <div className="module-operator-item">Flagged: {counts.moderationQueue.flaggedCount}</div>
            <div className="module-operator-item">Triaged: {counts.moderationQueue.triagedCount} ({fmtPercent(counts.moderationQueue.triagedShare)})</div>
            <div className="module-operator-item">Recent activity: {counts.recentActivity.count} items in the last 7 days</div>
            <div className="module-operator-item">Moderation notes present on {counts.moderationQueue.itemsWithNotesCount} items</div>
            <div className="module-operator-item">Linked reports: {reportRecords.length}</div>
            <div className="module-operator-item">Last updated {fmtDateTime(campaign.updated_at)}</div>
          </div>
        </article>
      </header>

      <div className="mt-6 space-y-6">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Handoff Readiness</p>
              <h2 className="module-section-title">Review posture and planning handoff</h2>
              <p className="module-section-description">
                Campaigns stay explicitly tied to planning context, moderation load, map coverage, and downstream report awareness.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={handoffReadiness.tone}>{handoffReadiness.label}</StatusBadge>
                    <StatusBadge tone="neutral">{handoffReadiness.completeCount}/{handoffReadiness.totalChecks} checks complete</StatusBadge>
                  </div>
                  <h3 className="module-record-title text-[1rem]">Campaign handoff decision</h3>
                  <p className="module-record-summary">{handoffReadiness.nextAction}</p>
                </div>
              </div>
              <MetaList>
                {handoffReadiness.checks.map((check) => (
                  <MetaItem key={check.id}>
                    {check.passed ? "Pass" : "Open"} · {check.label}
                  </MetaItem>
                ))}
              </MetaList>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {handoffReadiness.checks.map((check) => (
                <div key={check.id} className="module-summary-card">
                  <p className="module-summary-label">{check.label}</p>
                  <p className="module-summary-value text-lg">{check.passed ? "Ready" : "Open"}</p>
                  <p className="module-summary-detail">{check.detail}</p>
                </div>
              ))}
            </div>

            <div className="module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={project ? "success" : "neutral"}>{project ? "Linked project" : "Unlinked project"}</StatusBadge>
                    {project?.status ? <StatusBadge tone="neutral">{titleizeEngagementValue(project.status)}</StatusBadge> : null}
                  </div>
                  <h3 className="module-record-title text-[1rem]">{project?.name ?? "No project linked yet"}</h3>
                  <p className="module-record-summary">
                    {project
                      ? project.summary || "Project context is present even when campaign reporting stays lightweight."
                      : "Link a project when this intake should stay traceable to a planning effort rather than stand alone."}
                  </p>
                </div>
              </div>
              <MetaList>
                <MetaItem>Campaign status {titleizeEngagementValue(campaign.status)}</MetaItem>
                <MetaItem>Recent activity {counts.recentActivity.count} items</MetaItem>
                <MetaItem>{counts.geographyCoverage.geolocatedItems} geolocated</MetaItem>
                <MetaItem>{reportRecords.length} linked reports</MetaItem>
              </MetaList>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="module-summary-card">
                <p className="module-summary-label">Actionable review</p>
                <p className="module-summary-value">{counts.moderationQueue.actionableCount}</p>
                <p className="module-summary-detail">
                  {counts.moderationQueue.pendingCount} pending and {counts.moderationQueue.flaggedCount} flagged.
                </p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Categorized coverage</p>
                <p className="module-summary-value">{counts.categorizedItems}</p>
                <p className="module-summary-detail">
                  {counts.uncategorizedItems} items still need classification before reporting is reliable.
                </p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Map coverage</p>
                <p className="module-summary-value">{fmtPercent(counts.geographyCoverage.geolocatedShare)}</p>
                <p className="module-summary-detail">
                  {counts.geographyCoverage.geolocatedItems} geolocated, {counts.geographyCoverage.nonGeolocatedItems} non-geolocated.
                </p>
              </div>
            </div>

            <div className="module-note border-sky-300/40 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/20">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Map export readiness</p>
              <h3 className="mt-2 text-sm font-semibold text-foreground">
                {counts.exportCoverage.mapReadyItems} approved item{counts.exportCoverage.mapReadyItems === 1 ? "" : "s"} ready for GIS/map export
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {counts.exportCoverage.handoffReadyWithoutLocation > 0
                  ? `${counts.exportCoverage.handoffReadyWithoutLocation} approved categorized item${counts.exportCoverage.handoffReadyWithoutLocation === 1 ? "" : "s"} still need a map location before they can appear in public map exports.`
                  : counts.moderationQueue.readyForHandoffCount > 0
                    ? "Every handoff-ready item has a location for map display and downstream GIS review."
                    : "Approve and categorize geolocated items to build a reliable public map/export layer."}
              </p>
            </div>

            <div className="module-note border-amber-300/40 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Report appendix readiness</p>
              <h3 className="mt-2 text-sm font-semibold text-foreground">
                {appendixReadiness.appendixReadyCount} approved public comment{appendixReadiness.appendixReadyCount === 1 ? "" : "s"} ready for appendix review
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                This is a staff handoff cue, not a representativeness or legal sufficiency finding. Public comments, internal notes, meeting/email items, and duplicate-looking records stay separated before report use.
              </p>
              <div className="mt-3">
                <MetaList>
                  <MetaItem>{appendixReadiness.publicApprovedCategorizedCount} approved public comment{appendixReadiness.publicApprovedCategorizedCount === 1 ? "" : "s"}</MetaItem>
                  <MetaItem>{appendixReadiness.nonPublicApprovedCategorizedCount} internal/meeting/email ready item{appendixReadiness.nonPublicApprovedCategorizedCount === 1 ? "" : "s"}</MetaItem>
                  <MetaItem>{appendixReadiness.duplicateReviewCount} duplicate-review item{appendixReadiness.duplicateReviewCount === 1 ? "" : "s"}</MetaItem>
                  <MetaItem>{appendixReadiness.duplicateExcludedCount} appendix candidate{appendixReadiness.duplicateExcludedCount === 1 ? "" : "s"} held for duplicate review</MetaItem>
                </MetaList>
              </div>
              <div className="mt-5 rounded-[0.5rem] border border-amber-200/70 bg-background/75 p-4 dark:border-amber-900/70">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Comment matrix export preview</p>
                    <h4 className="mt-1 text-sm font-semibold text-foreground">
                      {commentMatrixPreview.counts.includedCount} included · {commentMatrixPreview.counts.heldDuplicateReviewCount} held · {commentMatrixPreview.counts.excludedInternalPrivateCount} internal/private excluded
                    </h4>
                  </div>
                  <StatusBadge tone="warning">Staff cue only</StatusBadge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{commentMatrixPreview.caveat}</p>
                <div className="mt-3 space-y-2">
                  {commentMatrixPreview.rows.map((row) => {
                    const postureTone =
                      row.posture === "included"
                        ? "success"
                        : row.posture === "held_duplicate_review"
                          ? "warning"
                          : row.posture === "excluded_internal_private"
                            ? "neutral"
                            : "info";

                    return (
                      <div key={row.itemId} className="module-record-row bg-background/80">
                        <div className="module-record-head">
                          <div className="module-record-main">
                            <div className="module-record-kicker">
                              <StatusBadge tone={postureTone}>{row.postureLabel}</StatusBadge>
                              <StatusBadge tone="neutral">{titleizeEngagementValue(row.sourceType)}</StatusBadge>
                              {row.categoryLabel ? <StatusBadge tone="info">{row.categoryLabel}</StatusBadge> : null}
                            </div>
                            <h5 className="module-record-title text-[0.95rem]">{row.title}</h5>
                            <p className="module-record-summary">{row.reason}</p>
                            <p className="module-record-summary">{row.bodyExcerpt}</p>
                          </div>
                        </div>
                        <MetaList>
                          <MetaItem>{row.submittedBy ? `Submitted by ${row.submittedBy}` : "Submitter not recorded"}</MetaItem>
                          <MetaItem>Updated {fmtDateTime(row.updatedAt)}</MetaItem>
                        </MetaList>
                      </div>
                    );
                  })}
                  {commentMatrixPreview.rows.length === 0 ? (
                    <div className="rounded-[0.5rem] border border-dashed border-border/80 bg-background/70 px-5 py-6 text-sm text-muted-foreground">
                      No comments are available for matrix preview yet.
                    </div>
                  ) : null}
                </div>
                {commentMatrixPreview.counts.previewedRowCount < commentMatrixPreview.counts.totalItemCount ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing {commentMatrixPreview.counts.previewedRowCount} of {commentMatrixPreview.counts.totalItemCount} comments in handoff order.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="module-note border-slate-300/50 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/30">
              <div className="module-record-kicker">
                <StatusBadge tone={publicReviewCopyGuard.tone}>{publicReviewCopyGuard.label}</StatusBadge>
                <StatusBadge tone={campaign.submissions_closed_at ? "neutral" : campaign.allow_public_submissions ? "warning" : "neutral"}>
                  {campaign.submissions_closed_at ? "Intake closed" : campaign.allow_public_submissions ? "Intake may be open" : "Staff-controlled intake"}
                </StatusBadge>
              </div>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Public-review copy guard</p>
              <h3 className="mt-2 text-sm font-semibold text-foreground">Keep handoff language supervised and source-bound</h3>
              <p className="mt-2 text-sm text-muted-foreground">{publicReviewCopyGuard.summary}</p>
              <p className="mt-2 text-sm text-muted-foreground">{publicReviewCopyGuard.nextCopyAction}</p>
              <div className="mt-3">
                <MetaList>
                  {publicReviewCopyGuard.guardrails.map((guardrail) => (
                    <MetaItem key={guardrail}>{guardrail}</MetaItem>
                  ))}
                </MetaList>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <article className="module-record-row">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={counts.moderationQueue.readyForHandoffCount > 0 ? "success" : "neutral"}>
                        {counts.moderationQueue.readyForHandoffCount} handoff-ready
                      </StatusBadge>
                      <StatusBadge tone={counts.moderationQueue.uncategorizedCount > 0 ? "warning" : "success"}>
                        {counts.moderationQueue.uncategorizedCount} uncategorized
                      </StatusBadge>
                    </div>
                    <h3 className="module-record-title text-[1rem]">Lightweight planning handoff cue</h3>
                    <p className="module-record-summary">
                      Approved items with category assignment are the cleanest candidates for report inclusion or planning review.
                    </p>
                  </div>
                </div>
                <MetaList>
                  <MetaItem>{counts.statusCounts.approved} approved total</MetaItem>
                  <MetaItem>{counts.moderationQueue.readyForHandoffCount} approved + categorized</MetaItem>
                  <MetaItem>{counts.moderationQueue.itemsWithNotesCount} with audit notes</MetaItem>
                </MetaList>
              </article>

              <article className="module-record-row">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone="info">
                        {primarySource ? `${titleizeEngagementValue(primarySource.sourceType)} lead source` : "No source mix yet"}
                      </StatusBadge>
                      <StatusBadge tone="neutral">{counts.recentActivity.count} recent items</StatusBadge>
                    </div>
                    <h3 className="module-record-title text-[1rem]">Recent intake signal</h3>
                    <p className="module-record-summary">
                      {primarySource
                        ? `${titleizeEngagementValue(primarySource.sourceType)} is currently the largest intake lane with ${primarySource.count} items.`
                        : "No intake items yet."}
                    </p>
                  </div>
                </div>
                <MetaList>
                  <MetaItem>{counts.recentActivity.byStatus.pending} pending in window</MetaItem>
                  <MetaItem>{counts.recentActivity.byStatus.flagged} flagged in window</MetaItem>
                  <MetaItem>Last activity {fmtDateTime(counts.lastActivityAt)}</MetaItem>
                </MetaList>
              </article>
            </div>

            <article className="module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={campaign.project_id ? "success" : "warning"}>
                      {campaign.project_id ? "Project-linked" : "Project link required"}
                    </StatusBadge>
                    <StatusBadge tone={counts.moderationQueue.readyForHandoffCount > 0 ? "success" : "neutral"}>
                      {counts.moderationQueue.readyForHandoffCount} handoff-ready
                    </StatusBadge>
                  </div>
                  <h3 className="module-record-title text-[1rem]">Create an engagement handoff packet</h3>
                  <p className="module-record-summary">
                    Seed a project-linked report with this campaign as an explicit source section so planning review does not rely on manual copy-paste.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <MetaList>
                  <MetaItem>{counts.totalItems} total items</MetaItem>
                  <MetaItem>{counts.moderationQueue.actionableCount} actionable review items</MetaItem>
                  <MetaItem>{reportRecords.length} existing project reports</MetaItem>
                  <MetaItem>{packetAttentionCount} packet issue{packetAttentionCount === 1 ? "" : "s"}</MetaItem>
                </MetaList>
                <EngagementReportCreateButton
                  campaign={campaign}
                  counts={counts}
                  existingReportGuidance={
                    recommendedCampaignReport
                      ? {
                          reportCount: campaignLinkedReports.length,
                          packetAttentionCount,
                          recommendedReportId: recommendedCampaignReport.id,
                          recommendedReportTitle: recommendedCampaignReport.title,
                          recommendedAction: getReportPacketActionLabel(
                            recommendedCampaignReport.packetFreshness.label
                          ),
                          recommendedDetail: recommendedCampaignReport.packetFreshness.detail,
                        }
                      : null
                  }
                />
              </div>
            </article>
          </div>
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Report Awareness</p>
              <h2 className="module-section-title">Project-linked reports</h2>
              <p className="module-section-description">
                Linked project reports remain visible so campaigns do not sit outside the broader Planning OS record.
              </p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
              <FileStack className="h-5 w-5" />
            </span>
          </div>

          {!project ? (
            <div className="mt-5">
              <EmptyState
                title="No linked project yet"
                description="Attach this campaign to a project before expecting report-aware handoff cues."
                compact
              />
            </div>
          ) : reportRecords.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No reports linked through this project yet"
                description="Project-linked reports will appear here once reporting catches up with the campaign."
                compact
              />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <MetaList>
                <MetaItem>{explicitlyLinkedReportCount} explicit campaign-source reports</MetaItem>
                <MetaItem>{projectOnlyReportCount} project-linked only</MetaItem>
                <MetaItem>{packetAttentionCount} packet issue{packetAttentionCount === 1 ? "" : "s"}</MetaItem>
              </MetaList>

              <div
                className={`module-note ${
                  packetAttentionCount > 0
                    ? "border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20"
                    : "border-emerald-400/35 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Campaign reporting posture
                </p>
                <h3 className="mt-2 text-sm font-semibold text-foreground">
                  {packetAttentionCount > 0 && recommendedCampaignReport
                    ? `${recommendedCampaignReport.title} needs packet attention`
                    : "Linked campaign packets look current"}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {recommendedCampaignReport
                    ? getReportPacketActionLabel(recommendedCampaignReport.packetFreshness.label)
                    : "Open reports to create the first linked packet for this campaign's project context."}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {recommendedCampaignReport?.packetFreshness.detail ??
                    "No project-linked reports are available for this campaign yet."}
                </p>
              </div>

              {campaignLinkedReports.slice(0, 4).map((report) => (
                <Link key={report.id} href={`/reports/${report.id}`} className="module-record-row is-interactive group block">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={reportStatusTone(report.status)}>{formatReportStatusLabel(report.status)}</StatusBadge>
                        <StatusBadge tone={report.packetFreshness.tone}>{report.packetFreshness.label}</StatusBadge>
                      </div>
                      <h3 className="module-record-title text-[1rem] transition group-hover:text-primary">{report.title}</h3>
                      <p className="module-record-summary">{formatReportTypeLabel(report.report_type)} · {report.isExplicitCampaignSource ? "Campaign source linked" : "Project-linked only"}</p>
                      <p className="module-record-summary">
                        {report.isExplicitCampaignSource
                          ? "This report explicitly includes this campaign as an engagement source section."
                          : "This report shares the project context, but does not explicitly source this campaign yet."}
                      </p>
                      <p className="module-record-summary">{report.packetFreshness.detail}</p>
                      <p className="module-record-summary">{getReportPacketActionLabel(report.packetFreshness.label)}</p>
                      <p className="module-record-summary">
                        Updated {fmtDateTime(report.updated_at)}
                        {latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at
                          ? ` • Generated ${fmtDateTime(latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at)}`
                          : " • Draft report record"}
                      </p>
                    </div>
                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>
                </Link>
              ))}
            </div>
          )}
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
                  Category structure stays intentionally light, but each lane now exposes item volume and moderation load.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <EngagementCategoryCreator campaignId={campaign.id} />
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

            {sourceSummaries.every((source) => source.count === 0) ? (
              <div className="mt-5">
                <EmptyState title="No source mix yet" description="Register items to expose source, moderation, and map coverage patterns." compact />
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
              <div className="mt-5 space-y-6">
                {heatmapPoints.length > 0 || hotspotFeatures.features.length > 0 ? (
                  <ParticipationHeatmapMap
                    points={heatmapPoints}
                    hotspots={hotspotFeatures}
                    sentimentAvailable={hotspots.sentimentAvailable}
                  />
                ) : null}
                <ParticipationDashboard
                  counts={counts}
                  categories={
                    (categories ?? []) as Array<{ id: string; label: string | null; color?: string | null }>
                  }
                  hotspots={hotspots}
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

          {campaign.demographics_enabled && demographicsSummary ? (
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
                <DemographicsPanel summary={demographicsSummary} />
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

          {moderationQueueItems.length > 0 ? (
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
                <AiModerationPanel
                  campaignId={campaign.id}
                  queueCount={moderationQueueItems.length}
                  flagged={moderationFlagged}
                  lastSource={lastModerationSource}
                />
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
      </div>

      <div className="mt-12 space-y-6 border-t pt-12">
        <div className="module-section-heading">
          <p className="module-section-label">Operator Actions</p>
          <h2 className="module-section-title">Campaign management and intake</h2>
          <p className="module-section-description">
            Update campaign settings, manage share tokens, or manually compose new intake items.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <EngagementCampaignControls campaign={campaign} projects={(projects ?? []) as Array<{ id: string; name: string }>} />
          <EngagementShareControls campaign={campaign} />
        </div>

        <div className="grid gap-6 xl:grid-cols-1">
          <EngagementItemComposer
            campaignId={campaign.id}
            categories={builderCategories}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-1">
          <EngagementSurveyBuilder
            campaignId={campaign.id}
            categories={builderCategories}
            initialQuestions={surveyQuestions}
          />
          <EngagementCloseLoopBuilder
            campaignId={campaign.id}
            categories={builderCategories}
            initialEntries={closeLoopEntries}
          />
        </div>
      </div>
    </section>
  );
}
