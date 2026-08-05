import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { ArrowLeft, FileStack, FolderKanban, MessageSquare, Route as RouteIcon, ShieldCheck } from "lucide-react";
import { RtpChapterControls } from "@/components/rtp/rtp-chapter-controls";
import { RtpCycleDetailsEditor } from "@/components/rtp/rtp-cycle-details-editor";
import { RtpFinancialElementSection } from "./_components/rtp-financial-element-section";
import type {
  BillingInvoiceRow,
  EngagementCampaignRow,
  EngagementItemSummaryRow,
  FundingAwardRow,
  FundingOpportunityRow,
  ModelingClaimDecisionDefaultRow,
  ProjectFundingProfileRow,
  ProjectRtpLinkRow,
  ReportArtifactRow,
  RtpCycleChapterRow,
  RtpCycleRow,
  RtpPacketReportRow,
} from "./_components/_types";
import { RtpCyclePhaseControls } from "@/components/rtp/rtp-cycle-phase-controls";
import { RtpEngagementCampaignCreator } from "@/components/rtp/rtp-engagement-campaign-creator";
import { RtpReportCreator } from "@/components/rtp/rtp-report-creator";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";
import { renderChapterMarkdownToHtml } from "@/lib/markdown/render";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import {
  buildProjectFundingStackSummary,
  projectFundingStackTone,
} from "@/lib/projects/funding";
import {
  buildRtpAdoptionRecordProofSummary,
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
  buildPortfolioPriorityNarrative,
  buildRtpPriorityRationale,
  priorityTierLabel,
  priorityTierTone,
} from "@/lib/rtp/priority-scoring";
import { describeRtpPriorityFrameworkBinding } from "@/lib/rtp/priority-framework-binding";
import {
  loadRtpPriorityFrameworkBinding,
  type RtpPriorityFrameworkQuerySupabaseLike,
} from "@/lib/rtp/priority-framework-queries";
import { RtpPublicShareControls } from "@/components/rtp/rtp-public-share-controls";
import {
  describeComparisonSnapshotAggregate,
  parseStoredComparisonSnapshotAggregate,
} from "@/lib/reports/catalog";
import {
  loadScenarioComparisonSummaryForProjects,
  totalReadySnapshotCount,
} from "@/lib/scenarios/comparison-summary";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  loadRtpFinancialElement,
  type RtpFinancialElementSupabaseLike,
} from "@/lib/rtp/financial-element-queries";
import { createClient } from "@/lib/supabase/server";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

type RouteContext = {
  params: Promise<{ rtpCycleId: string }>;
};

/**
 * What happened to one read on this page.
 *
 * `pending_schema` is a deployment that has not run a migration yet — already
 * classified, and it has a truer thing to say than "could not be read", so it
 * keeps its existing fallback and stays out of the failure log. Everything else
 * is collected, because a read that failed may not be rendered as an answer:
 * without this, a 400 on `project_rtp_cycle_links` renders "No linked projects
 * yet", which is this page telling a planner their portfolio is empty.
 */
type SectionReadState = "ok" | "pending_schema" | "failed";

function classifyRead(
  reads: ReadFailureLog,
  label: string,
  result: { error?: { message?: string | null } | null } | null | undefined
): SectionReadState {
  if (looksLikePendingSchema(result?.error?.message)) return "pending_schema";
  return reads.check(label, result) ? "failed" : "ok";
}

/** NUMERIC columns arrive as strings from PostgREST; an unparseable one is absent, not zero. */
function toOptionalNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatProjectStatusLabel(value: string | null | undefined): string {
  return titleizeRtpValue(value);
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
        title="RTP cycle detail needs a workspace"
        description="An RTP cycle belongs to the workspace preparing it. You are signed in, but no workspace membership was found for this account."
      />
    );
  }

  const cycleResult = await supabase
    .from("rtp_cycles")
    .select(
      "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, financial_basis_year, annual_inflation_rate, anchor_latitude, anchor_longitude, public_share_token, public_share_enabled, created_at, updated_at"
    )
    .eq("id", rtpCycleId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  // A FAILED READ IS NOT A MISSING CYCLE. The error and the empty row were one
  // branch, so any database failure on `rtp_cycles` rendered the 404 page — this
  // page telling a planner that their RTP cycle does not exist, which is the one
  // sentence that makes someone re-create a plan update that is still there. A
  // genuine absence still 404s; a read that failed says it failed.
  if (cycleResult.error) {
    return (
      <section className="module-page">
        <div className="mx-auto w-full max-w-2xl px-2 py-10">
          <StateBlock
            tone="danger"
            title="This RTP cycle could not be read"
            description={`The query for this cycle did not complete: ${
              cycleResult.error.message ?? "no reason was returned"
            }. That is not the same as the cycle not existing — OpenPlan cannot tell you either way right now, so do not treat this page as evidence the cycle is gone.`}
          />
          <div className="mt-4">
            <Link href="/rtp" className="module-inline-action w-fit">
              <ArrowLeft className="h-4 w-4" />
              Back to RTP registry
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const cycle = cycleResult.data as RtpCycleRow | null;
  if (!cycle) {
    notFound();
  }

  // Every read below is classified and, where it is a real failure, collected —
  // so the page can render what loaded and disclose the rest by name instead of
  // presenting the gaps as findings. See src/lib/ui/read-failures.ts.
  const reads = new ReadFailureLog();

  const [chaptersResult, projectLinksResult, campaignsResult, packetReportsResult, defaultModelingClaimResult] = await Promise.all([
    supabase
      .from("rtp_cycle_chapters")
      .select("id, chapter_key, title, section_type, status, sort_order, required, guidance, summary, content_markdown, updated_at")
      .eq("rtp_cycle_id", cycle.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("project_rtp_cycle_links")
      .select("id, project_id, portfolio_role, priority_rationale, priority_scores, horizon_band_id, estimated_cost, cost_basis_year, created_at, updated_at, projects(id, name, status, delivery_phase, summary, rtp_posture_updated_at)")
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
    supabase
      .from("modeling_claim_decisions")
      .select("county_run_id")
      .eq("workspace_id", membership.workspace_id)
      .eq("track", "assignment")
      .not("county_run_id", "is", null)
      .order("decided_at", { ascending: false })
      .limit(1),
  ]);
  classifyRead(reads, "the default modeling run for this workspace", defaultModelingClaimResult);
  const defaultModelingCountyRunId = defaultModelingClaimResult.error
    ? null
    : (((defaultModelingClaimResult.data ?? []) as ModelingClaimDecisionDefaultRow[])[0]?.county_run_id ?? null);

  const chaptersState = classifyRead(reads, "the chapter sections of this cycle", chaptersResult);
  const chapters = chaptersState === "pending_schema"
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

  const projectLinksState = classifyRead(reads, "the projects linked to this cycle", projectLinksResult);
  const projectLinks = projectLinksResult.error
    ? []
    : ((projectLinksResult.data ?? []) as ProjectRtpLinkRow[]).map((link) => ({
        ...link,
        project: Array.isArray(link.projects) ? (link.projects[0] ?? null) : link.projects,
      }));

  // THE FINANCIAL ELEMENT. The loader is shared with the export and the public
  // draft-review surfaces; it returns the raw results too, so THIS page decides
  // how each failure is disclosed. A failed read here may not render as "this
  // plan has recorded no revenue".
  const financialElement = await loadRtpFinancialElement(
    supabase as unknown as RtpFinancialElementSupabaseLike,
    cycle.id
  );
  const horizonBandsState = classifyRead(reads, "the horizon periods of this plan", financialElement.results.bands);
  const financialAssumptionsState = classifyRead(
    reads,
    "the revenue and cost assumptions of this plan",
    financialElement.results.lines
  );
  const performanceMeasuresState = classifyRead(
    reads,
    "the performance measures of this plan",
    financialElement.results.measures
  );

  // Whether this planner may change any of it. The editors take it as a prop so
  // a viewer sees the plan's finances and no controls, rather than controls that
  // 403 when used.
  const canWritePlans = canAccessWorkspaceAction("plans.write", membership.role);

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

  // One label for the four funding reads: the planner reads them as one number,
  // and naming four tables in the disclosure sentence would tell them nothing
  // they can act on that "funding records" does not.
  const fundingStates = [
    classifyRead(reads, "funding records for the linked projects", fundingProfilesResult),
    classifyRead(reads, "committed awards for the linked projects", fundingAwardsResult),
    classifyRead(reads, "pursued funding for the linked projects", fundingOpportunitiesResult),
    classifyRead(reads, "reimbursement invoices for the linked projects", billingInvoicesResult),
  ];
  const fundingReadFailed = fundingStates.includes("failed");
  const fundingProfiles = fundingProfilesResult.error
    ? []
    : ((fundingProfilesResult.data ?? []) as ProjectFundingProfileRow[]);
  const fundingAwards = fundingAwardsResult.error
    ? []
    : ((fundingAwardsResult.data ?? []) as FundingAwardRow[]);
  const fundingOpportunities = fundingOpportunitiesResult.error
    ? []
    : ((fundingOpportunitiesResult.data ?? []) as FundingOpportunityRow[]);
  const billingInvoices = billingInvoicesResult.error
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

  const campaignsState = classifyRead(reads, "the engagement campaigns for this cycle", campaignsResult);
  const engagementCampaigns = campaignsResult.error
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
  const engagementItemsState = classifyRead(reads, "public comments on this cycle", engagementItemsResult);
  const engagementItems = engagementItemsResult.error
    ? []
    : ((engagementItemsResult.data ?? []) as EngagementItemSummaryRow[]);

  const packetReportsState = classifyRead(reads, "the board packet records for this cycle", packetReportsResult);
  const packetReports = packetReportsResult.error ? [] : ((packetReportsResult.data ?? []) as RtpPacketReportRow[]);
  const packetReportIds = packetReports.map((report) => report.id);
  const packetArtifactsResult = packetReportIds.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in("report_id", packetReportIds)
        .order("generated_at", { ascending: false })
    : { data: [], error: null };
  const packetArtifactsState = classifyRead(reads, "the generated packet artifacts", packetArtifactsResult);
  const packetArtifactsData = packetArtifactsResult.error ? [] : packetArtifactsResult.data;
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

  // Which of the public-review numbers below are answers and which are only the
  // shape of a failed query. `generatedPacketCount` is derived from the packet
  // ARTIFACT read as well as the packet record read, so both invalidate it.
  const packetRecordsUnavailable = packetReportsState === "failed" || packetArtifactsState === "failed";
  // The comment counts are filtered by campaign id, so a failed CAMPAIGN read
  // leaves the item query nothing to ask for: it then succeeds and answers
  // "none", which is true about the query and false about the cycle.
  const commentCountsUnavailable = engagementItemsState === "failed" || campaignsState === "failed";
  // The recommendations are computed from the same reads, and they are phrased
  // as instructions ("Create one whole-cycle engagement campaign…"). Acting on
  // one that a failed read produced creates a duplicate of a record that is
  // already there, which is worse than a wrong number.
  // `commentCountsUnavailable` already covers a failed campaign read — the
  // compiler proves the extra clause unreachable, which is the honest signal
  // that the campaign read is what makes the comment counts unanswerable.
  const publicReviewInputsUnavailable = packetRecordsUnavailable || commentCountsUnavailable;

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

  // Which body of law this workspace may cite for its priorities. Loaded from
  // the workspace's home geography — never assumed — so a plan outside
  // California stops publishing California statutes as its policy basis.
  const priorityFramework = await loadRtpPriorityFrameworkBinding(
    supabase as unknown as RtpPriorityFrameworkQuerySupabaseLike,
    membership.workspace_id
  );
  reads.check("the policy framework for this workspace", priorityFramework.result);

  const projectLinksWithFunding = projectLinks
    .map((link) => ({
      ...link,
      fundingStack: buildProjectFundingStackSummary(
        fundingProfileByProjectId.get(link.project_id) ?? null,
        fundingAwardsByProjectId.get(link.project_id) ?? [],
        fundingOpportunitiesByProjectId.get(link.project_id) ?? [],
        fundingInvoicesByProjectId.get(link.project_id) ?? []
      ),
      priority: buildRtpPriorityRationale(link.priority_scores ?? {}, priorityFramework.binding.criteria),
    }))
    // Prioritized portfolio: highest composite priority first (unscored fall last).
    .sort((a, b) => b.priority.summary.composite - a.priority.summary.composite);

  const portfolioPriority = buildPortfolioPriorityNarrative(
    projectLinks.map((link) => link.priority_scores ?? {}),
    priorityFramework.binding.criteria
  );
  const priorityFrameworkDisclosure = describeRtpPriorityFrameworkBinding(priorityFramework.binding);

  const fiscalReadFailed =
    horizonBandsState === "failed" || financialAssumptionsState === "failed" || projectLinksState === "failed";

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
  const scenarioComparisonState = classifyRead(
    reads,
    "scenario comparisons for the linked projects",
    scenarioComparisonSummary
  );
  const scenarioComparisonRows = scenarioComparisonSummary.rows;
  const scenarioComparisonIndicatorCount = new Set(scenarioComparisonRows.map((row) => row.indicator_key)).size;
  const scenarioComparisonReadyCount = totalReadySnapshotCount(scenarioComparisonRows);

  const chapterReadyForReviewCount = chapters.filter((chapter) => chapter.status === "ready_for_review").length;
  const chapterCompleteCount = chapters.filter((chapter) => chapter.status === "complete").length;
  const requiredChapterCount = chapters.filter((chapter) => chapter.required).length;
  const requiredChapterReadyForReviewCount = chapters.filter((chapter) => chapter.required && chapter.status === "ready_for_review").length;
  const requiredChapterCompleteCount = chapters.filter((chapter) => chapter.required && chapter.status === "complete").length;
  const adoptionRecordProof = buildRtpAdoptionRecordProofSummary({
    status: cycle.status,
    adoptionTargetDate: cycle.adoption_target_date,
    publicReviewOpenAt: cycle.public_review_open_at,
    publicReviewCloseAt: cycle.public_review_close_at,
    requiredChapterCount,
    requiredChaptersReadyForReviewCount: requiredChapterReadyForReviewCount,
    requiredChaptersCompleteCount: requiredChapterCompleteCount,
    packetRecordCount: packetReportsWithComparison.length,
    generatedPacketCount,
  });
  return (
    <section className="module-page">
      <CartographicSurfaceWide />

      {/*
        Disclosed, not logged. This is an internal page, so the database's own
        message is shown — an operator can act on it, and without it the notice
        only says something is wrong. The point of the sentence is that the empty
        lists and zero counts below are NOT findings about this cycle.
      */}
      {reads.any ? (
        <StateBlock
          tone="danger"
          title="Part of this cycle could not be read"
          description={`${reads.describe()} ${reads.messages().join(" · ")}`}
        />
      ) : null}

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
            {/*
              A count is an assertion. Where the read behind one failed, the card
              shows an em dash and says so — "0" here would be the page telling a
              planner their cycle has no chapters, no projects, no funding.
            */}
            <div className="module-summary-card">
              <p className="module-summary-label">Chapters</p>
              <p className="module-summary-value">{chaptersState === "failed" ? "—" : chapters.length}</p>
              <p className="module-summary-detail">
                {chaptersState === "failed"
                  ? "The chapter sections could not be read, so this is not a count of zero."
                  : "Initial RTP shell sections seeded for this cycle."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Ready for review</p>
              <p className="module-summary-value">{chaptersState === "failed" ? "—" : chapterReadyForReviewCount}</p>
              <p className="module-summary-detail">
                {chaptersState === "failed"
                  ? "Unavailable while the chapter sections cannot be read."
                  : "Sections that can move into coordinated review."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Complete</p>
              <p className="module-summary-value">{chaptersState === "failed" ? "—" : chapterCompleteCount}</p>
              <p className="module-summary-detail">
                {chaptersState === "failed"
                  ? "Unavailable while the chapter sections cannot be read."
                  : "Sections already marked complete."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked projects</p>
              <p className="module-summary-value">{projectLinksState === "failed" ? "—" : projectLinks.length}</p>
              <p className="module-summary-detail">
                {projectLinksState === "failed"
                  ? "The project links could not be read, so this is not a count of zero."
                  : "Portfolio records currently attached to this cycle."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Funding posture</p>
              <p className="module-summary-value">
                {projectLinksState === "failed" || fundingReadFailed ? "—" : `${fundedProjectCount}/${projectLinks.length}`}
              </p>
              <p className="module-summary-detail">
                {projectLinksState === "failed" || fundingReadFailed
                  ? "Funding posture is unavailable because part of the funding record could not be read — this is not a finding that nothing is funded."
                  : `${likelyCoveredProjectCount} more look coverable from pursued funding, while ${unfundedProjectCount} still carry a remaining gap.`}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Scenario signals</p>
              <p className="module-summary-value">
                {scenarioComparisonState === "failed" ? "—" : scenarioComparisonIndicatorCount}
              </p>
              <p className="module-summary-detail">
                {scenarioComparisonState === "failed"
                  ? "Scenario comparisons could not be read, so this page cannot say whether any are linked."
                  : scenarioComparisonIndicatorCount === 0
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

            {chaptersState === "failed" ? (
              <StateBlock
                tone="danger"
                title="Chapter sections could not be read"
                description="The chapters of this cycle could not be loaded, so none are shown. This is not the same as the cycle having no chapters — nothing here should be read as evidence that the shell is missing or that work was lost."
              />
            ) : chapters.length === 0 ? (
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
                        {chapter.content_markdown?.trim() ? (
                          <div
                            className="chapter-markdown mt-2 text-sm text-muted-foreground"
                            dangerouslySetInnerHTML={{
                              __html: renderChapterMarkdownToHtml(chapter.content_markdown),
                            }}
                          />
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">
                            No draft chapter content yet. Start writing the actual RTP section text here.
                          </p>
                        )}
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
          <RtpFinancialElementSection
            rtpCycleId={cycle.id}
            cycleFinancialBasisYear={cycle.financial_basis_year}
            annualInflationRate={cycle.annual_inflation_rate}
            projects={projectLinks.map((link) => ({
              linkId: link.id,
              projectId: link.project_id,
              projectName: link.project?.name ?? null,
              portfolioRole: link.portfolio_role,
              horizonBandId: link.horizon_band_id,
              estimatedCost: link.estimated_cost,
              costBasisYear: link.cost_basis_year,
            }))}
            readFailed={fiscalReadFailed}
            bands={financialElement.bands}
            lines={financialElement.lines}
            measures={financialElement.measures}
            measuresReadFailed={performanceMeasuresState === "failed"}
            canWrite={canWritePlans}
          />
        </section>

        <aside className="space-y-4">
          <RtpCycleDetailsEditor
            rtpCycleId={cycle.id}
            initialTitle={cycle.title}
            initialGeographyLabel={cycle.geography_label}
            initialHorizonStartYear={cycle.horizon_start_year}
            initialHorizonEndYear={cycle.horizon_end_year}
            initialAdoptionTargetDate={cycle.adoption_target_date}
            initialPublicReviewOpenAt={cycle.public_review_open_at}
            initialPublicReviewCloseAt={cycle.public_review_close_at}
            initialSummary={cycle.summary}
            initialAnchorLatitude={toOptionalNumber(cycle.anchor_latitude)}
            initialAnchorLongitude={toOptionalNumber(cycle.anchor_longitude)}
          />
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
              <RtpReportCreator
                rtpCycleId={cycle.id}
                defaultTitle={`${cycle.title} Board / Binder`}
                cycleStatus={cycle.status}
                modelingCountyRunId={defaultModelingCountyRunId}
              />
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

            <div className="space-y-3">
            {projectLinksState === "failed" ? (
              <StateBlock
                tone="danger"
                title="Linked projects could not be read"
                description="The projects attached to this cycle could not be loaded, so none are listed and the funding posture above is unavailable. This is not a finding that the cycle has no portfolio — do not re-attach projects on the strength of this page."
              />
            ) : projectLinks.length === 0 ? (
              <EmptyState
                title="No linked projects yet"
                description="Attach projects to this cycle from the project detail view so constrained and illustrative portfolio posture becomes visible here."
              />
            ) : (
              <div className="space-y-3">
                {portfolioPriority.scoredCount > 0 ? (
                  <div className="rounded-[0.5rem] border border-emerald-300/50 bg-emerald-50/50 px-4 py-3 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
                      Why this portfolio
                    </p>
                    <p className="mt-1 text-muted-foreground">{portfolioPriority.narrative}</p>
                  </div>
                ) : null}
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
                        {link.priority.summary.scoredCriteria > 0 ? (
                          <StatusBadge tone={priorityTierTone(link.priority.summary.tier)}>
                            Priority {link.priority.summary.composite}/100 · {priorityTierLabel(link.priority.summary.tier)}
                          </StatusBadge>
                        ) : null}
                        {project?.status ? (
                          <span className="module-record-chip"><span>Status</span><strong>{formatProjectStatusLabel(project.status)}</strong></span>
                        ) : null}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold tracking-tight">{project?.name ?? "Linked project"}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {link.priority.summary.scoredCriteria > 0
                            ? link.priority.narrative
                            : link.priority_rationale?.trim() || project?.summary?.trim() || "No prioritization rationale recorded yet."}
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
            {/*
              The publish control and the policy-basis disclosure describe the
              CYCLE, not its project list, so they sit OUTSIDE the ternary
              above. They used to live inside its third branch, which meant a
              cycle with drafted chapters and no projects linked yet — exactly
              the cycle a public draft review needs — had no way to be
              published at all, and a failed links read hid the control too.
            */}
            <div className="rounded-[0.5rem] border border-border/60 bg-muted/30 px-4 py-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {priorityFrameworkDisclosure.headline}
              </p>
              <p className="mt-1 text-muted-foreground">{priorityFrameworkDisclosure.detail}</p>
              {priorityFrameworkDisclosure.action ? (
                <p className="mt-1 text-muted-foreground">{priorityFrameworkDisclosure.action}</p>
              ) : null}
            </div>
            <RtpPublicShareControls
              rtpCycleId={cycle.id}
              initialEnabled={cycle.public_share_enabled ?? false}
              initialToken={cycle.public_share_token ?? null}
            />
            </div>
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

              {publicReviewInputsUnavailable ? (
                <p className="rounded-[0.5rem] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  This public-review posture, and the recommendations below it, are computed from records that could
                  not be read. Do not act on a recommendation to create a campaign or a packet from this page — it may
                  already exist and this page cannot currently see it.
                </p>
              ) : null}

              {/*
                The SECOND count grid on this page. The six cards in the header
                were gated against a failed read; these four were not, and they
                are the ones a planner reads during public-review closeout —
                "Pending comments 0" from a broken query is the page telling
                someone the comment record is clear.

                The comment counts depend on the CAMPAIGN read as well as their
                own: campaign ids are what the item query is filtered by, so a
                failed campaign read leaves the item query with nothing to ask
                for and it succeeds with an empty answer. A zero here would then
                be honest about the query and false about the world.
              */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="module-metric-card">
                  <p className="module-metric-label">Generated packets</p>
                  <p className="module-metric-value text-sm">
                    {packetRecordsUnavailable ? "—" : `${generatedPacketCount}/${packetReportsWithComparison.length}`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {packetRecordsUnavailable
                      ? "The packet records could not be read, so this is not a count of zero — a packet may already be generated."
                      : "Current rendered packet artifacts available for review and export."}
                  </p>
                </div>
                <div className="module-metric-card">
                  <p className="module-metric-label">Review targets</p>
                  <p className="module-metric-value text-sm">
                    {campaignsState === "failed" ? "—" : cycleLevelCampaigns.length}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {campaignsState === "failed"
                      ? "The engagement campaigns could not be read, so this is not a count of zero."
                      : `Whole-cycle campaigns, plus ${engagementCampaigns.length - cycleLevelCampaigns.length} chapter-targeted campaigns.`}
                  </p>
                </div>
                <div className="module-metric-card">
                  <p className="module-metric-label">Approved comments</p>
                  <p className="module-metric-value text-sm">
                    {commentCountsUnavailable ? "—" : engagementSummary.moderationQueue.readyForHandoffCount}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {commentCountsUnavailable
                      ? "Public comments could not be read, so this is not a count of zero."
                      : "Categorized items ready for packet handoff and response summary work."}
                  </p>
                </div>
                <div className="module-metric-card">
                  <p className="module-metric-label">Pending comments</p>
                  <p className="module-metric-value text-sm">
                    {commentCountsUnavailable ? "—" : engagementSummary.moderationQueue.pendingCount}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {commentCountsUnavailable
                      ? "Public comments could not be read, so an empty moderation queue here is not a finding that nothing is waiting."
                      : "Items still waiting for operator review before packet closeout."}
                  </p>
                </div>
              </div>

              <div className="rounded-[0.5rem] border border-border/70 bg-background px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Adoption record proof
                    </p>
                    <p className="mt-2 text-sm font-medium">{adoptionRecordProof.label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{adoptionRecordProof.detail}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right">
                    <StatusBadge tone={adoptionRecordProof.tone}>{adoptionRecordProof.label}</StatusBadge>
                    <p className="text-xs text-muted-foreground">
                      {adoptionRecordProof.readyCheckCount}/{adoptionRecordProof.totalCheckCount} proof checks ready
                    </p>
                  </div>
                </div>

                {/*
                  These checks are computed from the chapter, packet and comment
                  reads above. When one of those failed, a check reading "Needs
                  operator" may only mean OpenPlan could not look — and this
                  block is what a planner shows a board, so the difference has to
                  be on the same screen as the verdict.
                */}
                {chaptersState === "failed" ||
                packetReportsState === "failed" ||
                packetArtifactsState === "failed" ||
                engagementItemsState === "failed" ? (
                  <p className="mt-3 rounded-[0.5rem] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    Some records these checks depend on could not be read, so a check shown as “Needs operator” may
                    only mean OpenPlan could not look. Do not treat this block as an adoption record until the notice
                    at the top of this page clears.
                  </p>
                ) : null}

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {adoptionRecordProof.checks.map((check) => (
                    <div key={check.key} className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{check.label}</p>
                        <StatusBadge tone={check.ready ? "success" : "warning"}>{check.ready ? "Ready" : "Needs operator"}</StatusBadge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{check.detail}</p>
                    </div>
                  ))}
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

            {campaignsState === "failed" ? (
              <StateBlock
                tone="danger"
                title="Engagement campaigns could not be read"
                description="The campaigns attached to this cycle could not be loaded, so none are listed here or against the chapters above. This is not a finding that no public review target exists — creating a second one from this page would duplicate it."
              />
            ) : cycleLevelCampaigns.length === 0 ? (
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
