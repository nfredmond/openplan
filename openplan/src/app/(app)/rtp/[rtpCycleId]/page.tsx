import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileStack, FolderKanban, MessageSquare, Route as RouteIcon, ShieldCheck } from "lucide-react";
import { RtpChapterControls } from "@/components/rtp/rtp-chapter-controls";
import { RtpCyclePhaseControls } from "@/components/rtp/rtp-cycle-phase-controls";
import { RtpEngagementCampaignCreator } from "@/components/rtp/rtp-engagement-campaign-creator";
import { RtpReportCreator } from "@/components/rtp/rtp-report-creator";
import { EmptyState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import {
  buildProjectFundingStackSummary,
  projectFundingReimbursementTone,
  projectFundingStackTone,
} from "@/lib/projects/funding";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  buildRtpPublicReviewSummary,
  formatRtpChapterStatusLabel,
  formatRtpCycleStatusLabel,
  formatRtpDate,
  formatRtpDateTime,
  formatRtpPortfolioRoleLabel,
  RTP_CHAPTER_TEMPLATES,
  rtpChapterStatusTone,
  rtpCycleStatusTone,
  rtpPortfolioRoleTone,
  titleizeRtpValue,
} from "@/lib/rtp/catalog";
import {
  describeComparisonSnapshotAggregate,
  parseStoredComparisonSnapshotAggregate,
} from "@/lib/reports/catalog";
import {
  loadScenarioComparisonSummaryForProjects,
  totalReadySnapshotCount,
} from "@/lib/scenarios/comparison-summary";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

type RouteContext = {
  params: Promise<{ rtpCycleId: string }>;
};

type RtpCycleRow = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
  adoption_target_date: string | null;
  public_review_open_at: string | null;
  public_review_close_at: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

type RtpCycleChapterRow = {
  id: string;
  chapter_key: string;
  title: string;
  section_type: string;
  status: string;
  sort_order: number;
  required: boolean;
  guidance: string | null;
  summary: string | null;
  content_markdown: string | null;
  updated_at: string;
};

type ProjectLinkProjectRow = {
  id: string;
  name: string;
  status: string;
  delivery_phase: string;
  summary: string | null;
  rtp_posture_updated_at: string | null;
};

type ProjectFundingProfileRow = {
  project_id: string;
  funding_need_amount: number | null;
  local_match_need_amount: number | null;
};

type FundingAwardRow = {
  project_id: string;
  awarded_amount: number | string;
  match_amount: number | string;
  risk_flag: string;
  obligation_due_at: string | null;
};

type FundingOpportunityRow = {
  project_id: string;
  decision_state: string;
  opportunity_status: string;
  expected_award_amount: number | string | null;
};

type BillingInvoiceRow = {
  project_id: string;
  funding_award_id: string | null;
  status: string;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
  due_date: string | null;
};

type ProjectRtpLinkRow = {
  id: string;
  project_id: string;
  portfolio_role: string;
  priority_rationale: string | null;
  created_at: string;
  projects: ProjectLinkProjectRow | ProjectLinkProjectRow[] | null;
};

type CampaignProjectRow = {
  id: string;
  name: string;
};

type EngagementCampaignRow = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  engagement_type: string;
  rtp_cycle_chapter_id: string | null;
  updated_at: string;
  projects: CampaignProjectRow | CampaignProjectRow[] | null;
};

type RtpPacketReportRow = {
  id: string;
  title: string;
  updated_at: string;
};

type EngagementItemSummaryRow = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  status: string | null;
  source_type: string | null;
  latitude: number | null;
  longitude: number | null;
  moderation_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ReportArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(message ?? "");
}

function formatProjectStatusLabel(value: string | null | undefined): string {
  return titleizeRtpValue(value);
}

function projectStatusTone(status: string | null | undefined): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "on_hold") return "warning";
  if (status === "complete") return "info";
  if (status === "draft") return "neutral";
  return "neutral";
}

export default async function RtpCycleDetailPage({ params }: RouteContext) {
  const { rtpCycleId } = await params;
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
        moduleLabel="RTP"
        title="RTP cycles need a provisioned workspace"
        description="RTP cycle detail only appears inside a real workspace. You are signed in, but no workspace membership was found for this account."
      />
    );
  }

  const { data: cycleData } = await supabase
    .from("rtp_cycles")
    .select(
      "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, created_at, updated_at"
    )
    .eq("id", rtpCycleId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  const cycle = cycleData as RtpCycleRow | null;
  if (!cycle) {
    notFound();
  }

  const [chaptersResult, projectLinksResult, campaignsResult, packetReportsResult] = await Promise.all([
    supabase
      .from("rtp_cycle_chapters")
      .select("id, chapter_key, title, section_type, status, sort_order, required, guidance, summary, content_markdown, updated_at")
      .eq("rtp_cycle_id", cycle.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("project_rtp_cycle_links")
      .select("id, project_id, portfolio_role, priority_rationale, created_at, projects(id, name, status, delivery_phase, summary, rtp_posture_updated_at)")
      .eq("rtp_cycle_id", cycle.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("engagement_campaigns")
      .select("id, title, summary, status, engagement_type, rtp_cycle_chapter_id, updated_at, projects(id, name)")
      .eq("rtp_cycle_id", cycle.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("reports")
      .select("id, title, report_type, updated_at")
      .eq("rtp_cycle_id", cycle.id)
      .eq("report_type", "board_packet")
      .order("updated_at", { ascending: false }),
  ]);

  const chapters = looksLikePendingSchema(chaptersResult.error?.message)
    ? RTP_CHAPTER_TEMPLATES.map((template) => ({
        id: `template-${template.chapterKey}`,
        chapter_key: template.chapterKey,
        title: template.title,
        section_type: template.sectionType,
        status: "not_started",
        sort_order: template.sortOrder,
        required: template.required,
        guidance: template.guidance,
        summary: null,
        content_markdown: null,
        updated_at: cycle.updated_at,
      }))
    : ((chaptersResult.data ?? []) as RtpCycleChapterRow[]);

  const projectLinks = looksLikePendingSchema(projectLinksResult.error?.message)
    ? []
    : ((projectLinksResult.data ?? []) as ProjectRtpLinkRow[]).map((link) => ({
        ...link,
        project: Array.isArray(link.projects) ? (link.projects[0] ?? null) : link.projects,
      }));

  const linkedProjectIds = projectLinks.map((link) => link.project_id);
  const [fundingProfilesResult, fundingAwardsResult, fundingOpportunitiesResult, billingInvoicesResult] = await Promise.all([
    linkedProjectIds.length
      ? supabase
          .from("project_funding_profiles")
          .select("project_id, funding_need_amount, local_match_need_amount")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("funding_awards")
          .select("project_id, awarded_amount, match_amount, risk_flag, obligation_due_at")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("funding_opportunities")
          .select("project_id, decision_state, opportunity_status, expected_award_amount")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("billing_invoice_records")
          .select("project_id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const fundingProfiles = looksLikePendingSchema(fundingProfilesResult.error?.message)
    ? []
    : ((fundingProfilesResult.data ?? []) as ProjectFundingProfileRow[]);
  const fundingAwards = looksLikePendingSchema(fundingAwardsResult.error?.message)
    ? []
    : ((fundingAwardsResult.data ?? []) as FundingAwardRow[]);
  const fundingOpportunities = looksLikePendingSchema(fundingOpportunitiesResult.error?.message)
    ? []
    : ((fundingOpportunitiesResult.data ?? []) as FundingOpportunityRow[]);
  const billingInvoices = looksLikePendingSchema(billingInvoicesResult.error?.message)
    ? []
    : ((billingInvoicesResult.data ?? []) as BillingInvoiceRow[]);
  const fundingProfileByProjectId = new Map(fundingProfiles.map((profile) => [profile.project_id, profile]));
  const fundingAwardsByProjectId = new Map<string, FundingAwardRow[]>();
  const fundingOpportunitiesByProjectId = new Map<string, FundingOpportunityRow[]>();
  const fundingInvoicesByProjectId = new Map<string, BillingInvoiceRow[]>();
  for (const award of fundingAwards) {
    const current = fundingAwardsByProjectId.get(award.project_id) ?? [];
    current.push(award);
    fundingAwardsByProjectId.set(award.project_id, current);
  }
  for (const opportunity of fundingOpportunities) {
    const current = fundingOpportunitiesByProjectId.get(opportunity.project_id) ?? [];
    current.push(opportunity);
    fundingOpportunitiesByProjectId.set(opportunity.project_id, current);
  }
  for (const invoice of billingInvoices) {
    if (!invoice.funding_award_id) continue;
    const current = fundingInvoicesByProjectId.get(invoice.project_id) ?? [];
    current.push(invoice);
    fundingInvoicesByProjectId.set(invoice.project_id, current);
  }

  const engagementCampaigns = looksLikePendingSchema(campaignsResult.error?.message)
    ? []
    : ((campaignsResult.data ?? []) as EngagementCampaignRow[]).map((campaign) => ({
        ...campaign,
        project: Array.isArray(campaign.projects) ? (campaign.projects[0] ?? null) : campaign.projects,
      }));
  const engagementCampaignIds = engagementCampaigns.map((campaign) => campaign.id);
  const engagementItemsResult = engagementCampaignIds.length
    ? await supabase
        .from("engagement_items")
        .select("id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at")
        .in("campaign_id", engagementCampaignIds)
    : { data: [], error: null };
  const engagementItems = looksLikePendingSchema(engagementItemsResult.error?.message)
    ? []
    : ((engagementItemsResult.data ?? []) as EngagementItemSummaryRow[]);

  const packetReports = (packetReportsResult.data ?? []) as RtpPacketReportRow[];
  const packetReportIds = packetReports.map((report) => report.id);
  const { data: packetArtifactsData } = packetReportIds.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in("report_id", packetReportIds)
        .order("generated_at", { ascending: false })
    : { data: [] };
  const latestArtifactByReportId = new Map<string, ReportArtifactRow>();
  for (const artifact of (packetArtifactsData ?? []) as ReportArtifactRow[]) {
    if (!latestArtifactByReportId.has(artifact.report_id)) {
      latestArtifactByReportId.set(artifact.report_id, artifact);
    }
  }
  const packetReportsWithComparison = packetReports.map((report) => ({
    ...report,
    comparisonDigest: describeComparisonSnapshotAggregate(
      parseStoredComparisonSnapshotAggregate(
        latestArtifactByReportId.get(report.id)?.metadata_json ?? null
      )
    ),
    generatedAt: latestArtifactByReportId.get(report.id)?.generated_at ?? null,
  }));

  const campaignsByChapterId = new Map<string, Array<(typeof engagementCampaigns)[number]>>();
  const cycleLevelCampaigns: Array<(typeof engagementCampaigns)[number]> = [];
  for (const campaign of engagementCampaigns) {
    if (campaign.rtp_cycle_chapter_id) {
      const current = campaignsByChapterId.get(campaign.rtp_cycle_chapter_id) ?? [];
      current.push(campaign);
      campaignsByChapterId.set(campaign.rtp_cycle_chapter_id, current);
    } else {
      cycleLevelCampaigns.push(campaign);
    }
  }

  const engagementSummary = summarizeEngagementItems([], engagementItems);
  const generatedPacketCount = packetReportsWithComparison.filter((report) => Boolean(report.generatedAt)).length;

  const readiness = buildRtpCycleReadiness({
    geographyLabel: cycle.geography_label,
    horizonStartYear: cycle.horizon_start_year,
    horizonEndYear: cycle.horizon_end_year,
    adoptionTargetDate: cycle.adoption_target_date,
    publicReviewOpenAt: cycle.public_review_open_at,
    publicReviewCloseAt: cycle.public_review_close_at,
  });
  const workflow = buildRtpCycleWorkflowSummary({ status: cycle.status, readiness });
  const publicReviewSummary = buildRtpPublicReviewSummary({
    status: cycle.status,
    publicReviewOpenAt: cycle.public_review_open_at,
    publicReviewCloseAt: cycle.public_review_close_at,
    cycleLevelCampaignCount: cycleLevelCampaigns.length,
    chapterCampaignCount: engagementCampaigns.length - cycleLevelCampaigns.length,
    packetRecordCount: packetReportsWithComparison.length,
    generatedPacketCount,
    pendingCommentCount: engagementSummary.moderationQueue.pendingCount,
    approvedCommentCount: engagementSummary.moderationQueue.approvedCount,
    readyCommentCount: engagementSummary.moderationQueue.readyForHandoffCount,
  });

  const projectLinksWithFunding = projectLinks.map((link) => ({
    ...link,
    fundingStack: buildProjectFundingStackSummary(
      fundingProfileByProjectId.get(link.project_id) ?? null,
      fundingAwardsByProjectId.get(link.project_id) ?? [],
      fundingOpportunitiesByProjectId.get(link.project_id) ?? [],
      fundingInvoicesByProjectId.get(link.project_id) ?? []
    ),
  }));

  const fundedProjectCount = projectLinksWithFunding.filter((link) => link.fundingStack.status === "funded").length;
  const likelyCoveredProjectCount = projectLinksWithFunding.filter(
    (link) => link.fundingStack.status !== "funded" && link.fundingStack.pipelineStatus === "likely_covered"
  ).length;
  const unfundedProjectCount = projectLinksWithFunding.filter(
    (link) => link.fundingStack.pipelineStatus === "unfunded" || link.fundingStack.pipelineStatus === "partially_covered"
  ).length;
  const paidReimbursementTotal = projectLinksWithFunding.reduce(
    (sum, link) => sum + link.fundingStack.paidReimbursementAmount,
    0
  );
  const outstandingReimbursementTotal = projectLinksWithFunding.reduce(
    (sum, link) => sum + link.fundingStack.outstandingReimbursementAmount,
    0
  );
  const uninvoicedAwardTotal = projectLinksWithFunding.reduce(
    (sum, link) => sum + link.fundingStack.uninvoicedAwardAmount,
    0
  );

  const scenarioComparisonSummary = linkedProjectIds.length
    ? await loadScenarioComparisonSummaryForProjects({
        supabase,
        projectIds: linkedProjectIds,
      })
    : { rows: [], scenarioSetProjectMap: new Map<string, string>(), error: null };
  const scenarioComparisonRows = scenarioComparisonSummary.rows;
  const scenarioComparisonIndicatorCount = new Set(scenarioComparisonRows.map((row) => row.indicator_key)).size;
  const scenarioComparisonReadyCount = totalReadySnapshotCount(scenarioComparisonRows);

  const chapterReadyForReviewCount = chapters.filter((chapter) => chapter.status === "ready_for_review").length;
  const chapterCompleteCount = chapters.filter((chapter) => chapter.status === "complete").length;
  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <Link href="/rtp" className="module-inline-action w-fit">
            <ArrowLeft className="h-4 w-4" />
            Back to RTP registry
          </Link>

          <div className="module-intro-kicker mt-4">
            <RouteIcon className="h-3.5 w-3.5" />
            RTP cycle shell
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{cycle.title}</h1>
            <p className="module-intro-description">
              One cycle now anchors portfolio posture, editable chapter workflow, and RTP-targeted engagement entry points.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={rtpCycleStatusTone(cycle.status)}>{formatRtpCycleStatusLabel(cycle.status)}</StatusBadge>
            <StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge>
          </div>

          <p className="text-sm text-muted-foreground">
            {cycle.summary?.trim() || "No cycle summary yet. Add the planning scope, board posture, and intended public-facing narrative for this update."}
          </p>

          <div className="module-summary-grid cols-5">
            <div className="module-summary-card">
              <p className="module-summary-label">Chapters</p>
              <p className="module-summary-value">{chapters.length}</p>
              <p className="module-summary-detail">Initial RTP shell sections seeded for this cycle.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Ready for review</p>
              <p className="module-summary-value">{chapterReadyForReviewCount}</p>
              <p className="module-summary-detail">Sections that can move into coordinated review.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Complete</p>
              <p className="module-summary-value">{chapterCompleteCount}</p>
              <p className="module-summary-detail">Sections already marked complete.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked projects</p>
              <p className="module-summary-value">{projectLinks.length}</p>
              <p className="module-summary-detail">Portfolio records currently attached to this cycle.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Funding posture</p>
              <p className="module-summary-value">{fundedProjectCount}/{projectLinks.length}</p>
              <p className="module-summary-detail">{likelyCoveredProjectCount} more look coverable from pursued funding, while {unfundedProjectCount} still carry a remaining gap.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Scenario signals</p>
              <p className="module-summary-value">{scenarioComparisonIndicatorCount}</p>
              <p className="module-summary-detail">
                {scenarioComparisonIndicatorCount === 0
                  ? "No ready scenario comparisons are linked to these projects yet."
                  : `${scenarioComparisonReadyCount} ready comparison snapshot${scenarioComparisonReadyCount === 1 ? "" : "s"} aggregated across linked projects.`}
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
              <p className="module-operator-eyebrow">Digital RTP shell</p>
              <h2 className="module-operator-title">Chapter structure is now a first-class operating surface</h2>
            </div>
          </div>
          <p className="module-operator-copy">{workflow.detail}</p>
          <div className="module-operator-list">
            {workflow.actionItems.map((item) => (
              <div key={item} className="module-operator-item">{item}</div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="module-metric-card">
              <p className="module-metric-label">Geography</p>
              <p className="module-metric-value text-sm">{cycle.geography_label?.trim() || "Not set"}</p>
            </div>
            <div className="module-metric-card">
              <p className="module-metric-label">Horizon</p>
              <p className="module-metric-value text-sm">
                {typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number"
                  ? `${cycle.horizon_start_year}–${cycle.horizon_end_year}`
                  : "Not set"}
              </p>
            </div>
            <div className="module-metric-card">
              <p className="module-metric-label">Adoption target</p>
              <p className="module-metric-value text-sm">{formatRtpDate(cycle.adoption_target_date)}</p>
            </div>
            <div className="module-metric-card">
              <p className="module-metric-label">Public review</p>
              <p className="module-metric-value text-sm">
                {cycle.public_review_open_at && cycle.public_review_close_at
                  ? `${formatRtpDate(cycle.public_review_open_at)} → ${formatRtpDate(cycle.public_review_close_at)}`
                  : "Not set"}
              </p>
            </div>
          </div>
        </article>
      </header>

      <div className="module-grid-layout mt-6 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(24rem,0.9fr)]">
        <section className="space-y-4">
          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Chapter shell</p>
                <h2 className="module-section-title">Editable RTP sections</h2>
                <p className="module-section-description">
                  The shell is no longer just seeded structure. Each chapter can now carry explicit workflow status, working summary, and guidance.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
                <FileStack className="h-5 w-5" />
              </span>
            </div>

            {chapters.length === 0 ? (
              <EmptyState
                title="No chapter shell yet"
                description="This cycle does not have seeded chapter scaffolding yet. Apply the latest migration and reopen the cycle."
              />
            ) : (
              <div className="space-y-4">
                {chapters.map((chapter) => {
                  const chapterCampaigns = campaignsByChapterId.get(chapter.id) ?? [];
                  return (
                    <article key={chapter.id} className="module-row-card gap-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold tracking-tight">{chapter.title}</h3>
                            <StatusBadge tone={rtpChapterStatusTone(chapter.status)}>
                              {formatRtpChapterStatusLabel(chapter.status)}
                            </StatusBadge>
                            <span className="module-record-chip"><span>Section</span><strong>{titleizeRtpValue(chapter.section_type)}</strong></span>
                          </div>
                          <p className="mt-1 text-[0.73rem] text-muted-foreground">{chapter.required ? "Required" : "Optional"} · {chapterCampaigns.length} campaign{chapterCampaigns.length === 1 ? "" : "s"}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{chapter.guidance?.trim() || "No guidance yet."}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <div>Updated {formatRtpDateTime(chapter.updated_at)}</div>
                          <div>Key {chapter.chapter_key}</div>
                        </div>
                      </div>

                      <div className="rounded-[0.5rem] border border-border/70 bg-muted/25 px-4 py-3">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current shell posture</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {chapter.summary?.trim() || "No chapter summary yet. This shell is ready for chapter-level narrative, evidence, and comment threading."}
                        </p>
                      </div>

                      <div className="rounded-[0.5rem] border border-border/70 bg-background px-4 py-3">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Draft content</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                          {chapter.content_markdown?.trim() || "No draft chapter content yet. Start writing the actual RTP section text here."}
                        </p>
                      </div>

                      {chapterCampaigns.length > 0 ? (
                        <div className="space-y-2 rounded-[0.5rem] border border-border/70 bg-background px-4 py-3">
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Chapter engagement targets</p>
                          {chapterCampaigns.map((campaign) => (
                            <div key={campaign.id} className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link href={`/engagement/${campaign.id}`} className="text-sm font-semibold tracking-tight hover:text-foreground/80">
                                  {campaign.title}
                                </Link>
                                <StatusBadge tone={engagementStatusTone(campaign.status)}>{titleizeEngagementValue(campaign.status)}</StatusBadge>
                                <StatusBadge tone="neutral">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {campaign.summary?.trim() || "No campaign summary yet."}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {String(chapter.id).startsWith("template-") ? null : (
                        <RtpChapterControls
                          rtpCycleId={cycle.id}
                          chapter={{
                            id: chapter.id,
                            title: chapter.title,
                            status: chapter.status,
                          guidance: chapter.guidance,
                          summary: chapter.summary,
                          contentMarkdown: chapter.content_markdown,
                        }}
                      />
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </article>
        </section>

        <aside className="space-y-4">
          <RtpCyclePhaseControls
            cycle={{ id: cycle.id, status: cycle.status }}
            linkedPacketReports={packetReports.map((report) => ({ id: report.id, title: report.title }))}
          />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Export</p>
                <h2 className="module-section-title">RTP cycle output snapshot</h2>
                <p className="module-section-description">
                  Export the current cycle, chapter, portfolio, and engagement posture without waiting for deeper report-model integration.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/12 text-amber-700 dark:text-amber-300">
                <FileStack className="h-5 w-5" />
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <RtpReportCreator rtpCycleId={cycle.id} defaultTitle={`${cycle.title} Board / Binder`} cycleStatus={cycle.status} />
              <Link href={`/rtp/${cycle.id}/document`} className="module-inline-action">
                Open digital RTP document
              </Link>
              <Link href={`/api/rtp-cycles/${cycle.id}/export?format=html`} target="_blank" className="module-inline-action">
                Open HTML export
              </Link>
              <Link href={`/api/rtp-cycles/${cycle.id}/export?format=pdf`} target="_blank" className="module-inline-action">
                Open PDF export
              </Link>
            </div>

            {packetReportsWithComparison.length > 0 ? (
              <div className="mt-4 space-y-3 rounded-[0.5rem] border border-border/70 bg-muted/25 px-4 py-4">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Existing packet records
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Review which RTP packet records already carry saved comparison context before opening them.
                  </p>
                </div>
                <div className="space-y-2">
                  {packetReportsWithComparison.map((report) => (
                    <Link
                      key={report.id}
                      href={`/reports/${report.id}`}
                      className="block rounded-xl border border-border/70 bg-background px-3 py-3 transition hover:border-primary/35"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{report.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {report.generatedAt
                              ? `Latest packet generated ${formatRtpDateTime(report.generatedAt)}`
                              : `Report updated ${formatRtpDateTime(report.updated_at)}`}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {report.comparisonDigest ? (
                            <StatusBadge tone="info">Comparison-backed</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">No saved comparisons</StatusBadge>
                          )}
                        </div>
                      </div>
                      {report.comparisonDigest ? (
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          {report.comparisonDigest.headline} · {report.comparisonDigest.detail}
                        </p>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </article>

          <RtpEngagementCampaignCreator
            rtpCycleId={cycle.id}
            chapterOptions={chapters
              .filter((chapter) => !String(chapter.id).startsWith("template-"))
              .map((chapter) => ({ id: chapter.id, title: chapter.title }))}
          />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Portfolio posture</p>
                <h2 className="module-section-title">Cycle-linked projects</h2>
                <p className="module-section-description">
                  The RTP chapter workflow and project portfolio now sit under the same cycle record, with real funding posture pulled from project funding profiles and awards.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                <FolderKanban className="h-5 w-5" />
              </span>
            </div>

            {projectLinks.length === 0 ? (
              <EmptyState
                title="No linked projects yet"
                description="Attach projects to this cycle from the project detail view so constrained and illustrative portfolio posture becomes visible here."
              />
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <div className="module-metric-card">
                    <p className="module-metric-label">Funded</p>
                    <p className="module-metric-value text-sm">{fundedProjectCount}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Committed awards meet target need.</p>
                  </div>
                  <div className="module-metric-card">
                    <p className="module-metric-label">Likely covered</p>
                    <p className="module-metric-value text-sm">{likelyCoveredProjectCount}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Pursued opportunities appear able to close the remaining gap.</p>
                  </div>
                  <div className="module-metric-card">
                    <p className="module-metric-label">Still unfunded</p>
                    <p className="module-metric-value text-sm">{unfundedProjectCount}</p>
                    <p className="mt-1 text-xs text-muted-foreground">A real gap remains even after committed and likely funding.</p>
                  </div>
                  <div className="module-metric-card">
                    <p className="module-metric-label">Paid reimbursements</p>
                    <p className="module-metric-value text-sm">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(paidReimbursementTotal)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Linked award invoices already marked paid.</p>
                  </div>
                  <div className="module-metric-card">
                    <p className="module-metric-label">Outstanding requests</p>
                    <p className="module-metric-value text-sm">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(outstandingReimbursementTotal)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Submitted or approved requests still awaiting payment.</p>
                  </div>
                  <div className="module-metric-card">
                    <p className="module-metric-label">Uninvoiced awards</p>
                    <p className="module-metric-value text-sm">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(uninvoicedAwardTotal)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Committed award dollars not yet tied to linked invoice requests.</p>
                  </div>
                </div>

                {projectLinksWithFunding.map((link) => {
                  const project = link.project;
                  return (
                    <article key={link.id} className="module-row-card gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={rtpPortfolioRoleTone(link.portfolio_role)}>
                          {formatRtpPortfolioRoleLabel(link.portfolio_role)}
                        </StatusBadge>
                        <StatusBadge tone={projectFundingStackTone(link.fundingStack.pipelineStatus)}>{link.fundingStack.pipelineLabel}</StatusBadge>
                        {project?.status ? (
                          <span className="module-record-chip"><span>Status</span><strong>{formatProjectStatusLabel(project.status)}</strong></span>
                        ) : null}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold tracking-tight">{project?.name ?? "Linked project"}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {link.priority_rationale?.trim() || project?.summary?.trim() || "No prioritization rationale recorded yet."}
                        </p>
                      </div>
                      <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                        {link.fundingStack.reimbursementLabel} · Committed {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(link.fundingStack.committedFundingAmount)} · Gap {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(link.fundingStack.unfundedAfterLikelyAmount)} · Paid {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(link.fundingStack.paidReimbursementAmount)} · Outstanding {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(link.fundingStack.outstandingReimbursementAmount)}{link.fundingStack.awardRiskCount > 0 ? ` · ${link.fundingStack.awardRiskCount} award risk` : ""}
                      </p>
                      {project?.rtp_posture_updated_at ? (
                        <p className="text-[0.7rem] text-muted-foreground/80">
                          Posture cached {formatRtpDateTime(project.rtp_posture_updated_at)}
                        </p>
                      ) : null}
                      {project?.id ? (
                        <Link href={`/projects/${project.id}`} className="module-inline-action w-fit">
                          Open project workspace
                        </Link>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Public review control</p>
                <h2 className="module-section-title">Comment-response foundation</h2>
                <p className="module-section-description">
                  Keep the RTP packet, planwide review target, and moderated public input tied to the same cycle before board closeout.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/12 text-amber-700 dark:text-amber-300">
                <MessageSquare className="h-5 w-5" />
              </span>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={publicReviewSummary.tone}>{publicReviewSummary.label}</StatusBadge>
                <StatusBadge tone={rtpCycleStatusTone(cycle.status)}>{formatRtpCycleStatusLabel(cycle.status)}</StatusBadge>
              </div>

              <p className="text-sm text-muted-foreground">{publicReviewSummary.detail}</p>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="module-metric-card">
                  <p className="module-metric-label">Generated packets</p>
                  <p className="module-metric-value text-sm">{generatedPacketCount}/{packetReportsWithComparison.length}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Current rendered packet artifacts available for review and export.</p>
                </div>
                <div className="module-metric-card">
                  <p className="module-metric-label">Review targets</p>
                  <p className="module-metric-value text-sm">{cycleLevelCampaigns.length}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Whole-cycle campaigns, plus {engagementCampaigns.length - cycleLevelCampaigns.length} chapter-targeted campaigns.</p>
                </div>
                <div className="module-metric-card">
                  <p className="module-metric-label">Approved comments</p>
                  <p className="module-metric-value text-sm">{engagementSummary.moderationQueue.readyForHandoffCount}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Categorized items ready for packet handoff and response summary work.</p>
                </div>
                <div className="module-metric-card">
                  <p className="module-metric-label">Pending comments</p>
                  <p className="module-metric-value text-sm">{engagementSummary.moderationQueue.pendingCount}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Items still waiting for operator review before packet closeout.</p>
                </div>
              </div>

              <div className="module-operator-list">
                {publicReviewSummary.actionItems.map((item) => (
                  <div key={item} className="module-operator-item">{item}</div>
                ))}
              </div>
            </div>
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Cycle-wide engagement</p>
                <h2 className="module-section-title">Whole-plan campaign targets</h2>
                <p className="module-section-description">
                  Use whole-cycle campaigns for planwide public review, then point deeper campaigns at specific chapters as needed.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-violet-500/12 text-violet-700 dark:text-violet-300">
                <MessageSquare className="h-5 w-5" />
              </span>
            </div>

            {cycleLevelCampaigns.length === 0 ? (
              <EmptyState
                title="No whole-cycle campaigns yet"
                description="Create one above if you want a planwide comment or review target for this RTP update."
              />
            ) : (
              <div className="space-y-3">
                {cycleLevelCampaigns.map((campaign) => (
                  <article key={campaign.id} className="module-row-card gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={engagementStatusTone(campaign.status)}>{titleizeEngagementValue(campaign.status)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge>
                    </div>
                    <div>
                      <Link href={`/engagement/${campaign.id}`} className="text-sm font-semibold tracking-tight hover:text-foreground/80">
                        {campaign.title}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {campaign.summary?.trim() || "No campaign summary yet."}
                      </p>
                    </div>
                    {campaign.project ? (
                      <p className="text-xs text-muted-foreground">Linked project: {campaign.project.name}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </article>
        </aside>
      </div>
    </section>
  );
}
