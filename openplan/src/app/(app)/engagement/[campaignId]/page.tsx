import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { ArrowRight, FileStack, MapPinned, MessageSquareText, ShieldCheck } from "lucide-react";
import { EngagementCampaignControls } from "@/components/engagement/engagement-campaign-controls";
import { EngagementReportCreateButton } from "@/components/engagement/engagement-report-create-button";
import { EngagementCategoryCreator } from "@/components/engagement/engagement-category-creator";
import { EngagementItemComposer } from "@/components/engagement/engagement-item-composer";
import { EngagementItemRegistry } from "@/components/engagement/engagement-item-registry";
import { EngagementShareControls } from "@/components/engagement/engagement-share-controls";
import { EngagementBulkModeration } from "@/components/engagement/engagement-bulk-moderation";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";
import { getEngagementHandoffReadiness } from "@/lib/engagement/readiness";
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
import { createClient } from "@/lib/supabase/server";

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
    .select("id, workspace_id, project_id, title, summary, status, engagement_type, share_token, public_description, allow_public_submissions, submissions_closed_at, created_at, updated_at")
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

  const counts = summarizeEngagementItems(categories ?? [], items ?? []);
  const handoffReadiness = getEngagementHandoffReadiness({
    campaignStatus: campaign.status,
    projectLinked: Boolean(project),
    categoryCount: (categories ?? []).length,
    counts,
  });
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
              items={recentItems as Array<{
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
                updated_at: string;
              }>}
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
            categories={((categories ?? []) as Array<{ id: string; label: string }>).map((category) => ({
              id: category.id,
              label: category.label,
            }))}
          />
        </div>
      </div>
    </section>
  );
}
