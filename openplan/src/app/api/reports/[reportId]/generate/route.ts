import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { recordAssistantActionExecution } from "@/lib/observability/action-audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { readJsonWithLimit } from "@/lib/http/body-limit";
import {
  checkMonthlyRunQuota,
  isQuotaExceeded,
  isQuotaLookupError,
  QUOTA_WEIGHTS,
} from "@/lib/billing/quota";
import {
  isWorkspaceSubscriptionActive,
  resolveWorkspaceEntitlements,
  subscriptionGateMessage,
} from "@/lib/billing/subscription";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { evaluateReportArtifactGate } from "@/lib/stage-gates/report-artifacts";
import { loadCountyRunModelingEvidence } from "@/lib/models/evidence-backbone";
import { buildRtpExportHtml, normalizeRtpLinkedProjects } from "@/lib/rtp/export";
import { buildRtpCycleReadiness, buildRtpCycleWorkflowSummary, buildRtpPublicReviewSummary } from "@/lib/rtp/catalog";
import { buildPortfolioFundingSnapshot } from "@/lib/projects/funding";
import { getRtpPacketPresetAlignment } from "@/lib/reports/catalog";
import {
  buildProjectStageGateSnapshot,
  buildProjectStageGateSummary,
} from "@/lib/stage-gates/summary";
import {
  buildReportEngagementSummary,
  extractEngagementHandoffProvenance,
  extractEngagementCampaignId,
} from "@/lib/reports/engagement";
import { buildReportHtml } from "@/lib/reports/html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { buildEvidenceChainSummary } from "@/lib/reports/evidence-chain";
import { buildProjectFundingSnapshot } from "@/lib/projects/funding";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import {
  loadReportScenarioSetLinks,
  type ReportScenarioSupabaseLike,
} from "@/lib/reports/scenario-provenance";
import {
  extractReportModelingEvidenceClaimStatuses,
  summarizeReportModelingEvidenceForMetadata,
  type ReportModelingEvidence,
} from "@/lib/reports/modeling-evidence";

function looksLikePendingSchema(message: string | null | undefined) {
  return /column .* does not exist|schema cache/i.test(message ?? "");
}

function looksLikeOptionalQueryFallback(message: string | null | undefined) {
  return looksLikePendingSchema(message) || /Unexpected table:/i.test(message ?? "");
}

async function safeOptionalQuery<T>(
  run: () => PromiseLike<{ data: T; error: { message: string; code?: string | null } | null }>,
  fallbackData: T
) {
  try {
    const result = await run();
    if (result.error && looksLikeOptionalQueryFallback(result.error.message)) {
      return { data: fallbackData, error: null };
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (looksLikeOptionalQueryFallback(message)) {
      return { data: fallbackData, error: null };
    }

    throw error;
  }
}

const paramsSchema = z.object({
  reportId: z.string().uuid(),
});

const REPORT_GENERATE_MAX_BODY_BYTES = 32 * 1024;

const generateSchema = z.object({
  format: z.enum(["html", "pdf"]).default("html"),
});

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

type ProjectRecordSnapshotEntry = {
  count: number;
  latestTitle: string | null;
  latestAt: string | null;
};

type ReportCountyRunEvidenceRow = {
  id: string;
  run_name: string | null;
  geography_label: string | null;
  stage: string | null;
  updated_at: string | null;
};

function maxTimestamp(values: Array<string | null | undefined>) {
  const timestamps = values
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function buildProjectRecordSnapshot(entries: {
  deliverables: Array<{ title: string; due_date: string | null; created_at: string }>;
  risks: Array<{ title: string; created_at: string }>;
  issues: Array<{ title: string; created_at: string }>;
  decisions: Array<{ title: string; decided_at: string | null; created_at: string }>;
  meetings: Array<{ title: string; meeting_at: string | null; created_at: string }>;
}) {
  const buildEntry = <T extends { title: string; created_at: string }>(
    items: T[],
    getAt: (item: T) => string | null
  ): ProjectRecordSnapshotEntry => ({
    count: items.length,
    latestTitle: items[0]?.title ?? null,
    latestAt: items[0] ? getAt(items[0]) : null,
  });

  return {
    deliverables: buildEntry(entries.deliverables, (item) => item.due_date ?? item.created_at),
    risks: buildEntry(entries.risks, (item) => item.created_at),
    issues: buildEntry(entries.issues, (item) => item.created_at),
    decisions: buildEntry(entries.decisions, (item) => item.decided_at ?? item.created_at),
    meetings: buildEntry(entries.meetings, (item) => item.meeting_at ?? item.created_at),
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("reports.generate", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
    }

    const bodyRead = await readJsonWithLimit(request, REPORT_GENERATE_MAX_BODY_BYTES);
    if (!bodyRead.ok) {
      audit.warn("request_body_too_large", {
        reportId: parsedParams.data.reportId,
        byteLength: bodyRead.byteLength,
        maxBytes: REPORT_GENERATE_MAX_BODY_BYTES,
      });
      return bodyRead.response;
    }

    const payload = bodyRead.data ?? {};
    const parsed = generateSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid generation request" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let reportLookupResult = await supabase
      .from("reports")
      .select("id, workspace_id, project_id, rtp_cycle_id, title, summary, report_type, status, created_at, generated_at, metadata_json")
      .eq("id", parsedParams.data.reportId)
      .maybeSingle();

    if (reportLookupResult.error && looksLikePendingSchema(reportLookupResult.error.message)) {
      reportLookupResult = await supabase
        .from("reports")
        .select("id, workspace_id, project_id, rtp_cycle_id, title, summary, report_type, status, created_at, generated_at")
        .eq("id", parsedParams.data.reportId)
        .maybeSingle();
    }

    const { data: report, error: reportError } = reportLookupResult;

    if (reportError) {
      audit.error("report_lookup_failed", {
        reportId: parsedParams.data.reportId,
        message: reportError.message,
        code: reportError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify report" }, { status: 500 });
    }

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", report.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        reportId: report.id,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (!membership || !canAccessWorkspaceAction("report.generate", membership.role)) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: workspaceBilling, error: workspaceBillingError } = await supabase
      .from("workspaces")
      .select("plan, subscription_plan, subscription_status")
      .eq("id", report.workspace_id)
      .maybeSingle();

    if (workspaceBillingError) {
      audit.error("workspace_billing_lookup_failed", {
        workspaceId: report.workspace_id,
        userId: user.id,
        message: workspaceBillingError.message,
        code: workspaceBillingError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace billing" }, { status: 500 });
    }

    if (!isWorkspaceSubscriptionActive(workspaceBilling ?? {})) {
      const gateMessage = subscriptionGateMessage(workspaceBilling ?? {});
      audit.warn("subscription_inactive", {
        workspaceId: report.workspace_id,
        userId: user.id,
        subscriptionStatus: workspaceBilling?.subscription_status ?? null,
      });
      return NextResponse.json({ error: gateMessage }, { status: 402 });
    }

    const { plan } = resolveWorkspaceEntitlements(workspaceBilling ?? {});
    const quota = await checkMonthlyRunQuota(supabase, {
      workspaceId: report.workspace_id,
      plan,
      tableName: "runs",
      weight: QUOTA_WEIGHTS.DEFAULT,
    });

    if (isQuotaLookupError(quota)) {
      audit.error("run_limit_count_failed", {
        workspaceId: report.workspace_id,
        userId: user.id,
        message: quota.message,
        code: quota.code,
      });
      return NextResponse.json({ error: "Failed to validate plan limits" }, { status: 500 });
    }

    if (isQuotaExceeded(quota)) {
      audit.warn("run_limit_reached", {
        workspaceId: report.workspace_id,
        userId: user.id,
        plan: quota.plan,
        usedRuns: quota.usedRuns,
        monthlyLimit: quota.monthlyLimit,
      });
      return NextResponse.json({ error: quota.message }, { status: 429 });
    }

    if (report.rtp_cycle_id) {
      const [workspaceResult, cycleResult, sectionsResult, chaptersResult, linksResult, campaignsResult, countyRunsResult] = await Promise.all([
        supabase.from("workspaces").select("id, name, plan").eq("id", report.workspace_id).maybeSingle(),
        supabase
          .from("rtp_cycles")
          .select(
            "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, updated_at"
          )
          .eq("id", report.rtp_cycle_id)
          .maybeSingle(),
        supabase
          .from("report_sections")
          .select("id, section_key, title, enabled, sort_order, config_json")
          .eq("report_id", report.id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("rtp_cycle_chapters")
          .select("id, title, section_type, status, summary, guidance, content_markdown, sort_order")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("project_rtp_cycle_links")
          .select("id, project_id, portfolio_role, priority_rationale, projects(id, name, status, delivery_phase, summary)")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
          .order("created_at", { ascending: false }),
        supabase
          .from("engagement_campaigns")
          .select("id, title, status, engagement_type, summary, rtp_cycle_chapter_id")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
          .order("updated_at", { ascending: false }),
        safeOptionalQuery(
          () =>
            supabase
              .from("county_runs")
              .select("id, run_name, geography_label, stage, updated_at")
              .eq("workspace_id", report.workspace_id)
              .order("updated_at", { ascending: false })
              .limit(5),
          [] as ReportCountyRunEvidenceRow[]
        ),
      ]);

      const loadErrors = [
        workspaceResult.error,
        cycleResult.error,
        sectionsResult.error,
        chaptersResult.error,
        linksResult.error,
        campaignsResult.error,
      ].filter(Boolean);

      if (countyRunsResult.error) {
        audit.warn("rtp_modeling_county_runs_lookup_failed", {
          reportId: report.id,
          workspaceId: report.workspace_id,
          message: countyRunsResult.error.message,
          code: countyRunsResult.error.code ?? null,
        });
      }

      if (loadErrors.length > 0 || !cycleResult.data) {
        const firstError = loadErrors[0];
        audit.error("rtp_report_generation_load_failed", {
          reportId: report.id,
          message: firstError?.message ?? "RTP cycle not found",
          code: firstError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load RTP packet source records" }, { status: 500 });
      }

      const cycle = cycleResult.data;
      const sections = sectionsResult.data ?? [];
      const chapters = chaptersResult.data ?? [];
      const linkedProjects = normalizeRtpLinkedProjects(linksResult.data ?? []);
      const campaigns = campaignsResult.data ?? [];
      const countyRuns = countyRunsResult.error ? [] : (countyRunsResult.data ?? []);
      const modelingEvidence: ReportModelingEvidence[] = await Promise.all(
        countyRuns.map(async (countyRun) => {
          const evidenceResult = await loadCountyRunModelingEvidence({
            supabase,
            countyRunId: countyRun.id,
            track: "assignment",
          });

          if (evidenceResult.error) {
            audit.warn("rtp_modeling_evidence_lookup_failed", {
              reportId: report.id,
              workspaceId: report.workspace_id,
              countyRunId: countyRun.id,
              message: evidenceResult.error.message,
              code: evidenceResult.error.code ?? null,
              missingSchema: evidenceResult.error.missingSchema ?? false,
            });
          }

          return {
            countyRunId: countyRun.id,
            runName: countyRun.run_name,
            geographyLabel: countyRun.geography_label,
            stage: countyRun.stage,
            updatedAt: countyRun.updated_at,
            evidence: evidenceResult.evidence,
          };
        })
      );
      const modelingEvidenceMetadata = summarizeReportModelingEvidenceForMetadata(modelingEvidence);
      const modelingEvidenceClaimStatuses = extractReportModelingEvidenceClaimStatuses(modelingEvidence);
      const linkedProjectIds = linkedProjects
        .map((link) => link.project?.id ?? null)
        .filter((value): value is string => Boolean(value));
      const [fundingProfilesResult, fundingAwardsResult, fundingOpportunitiesResult, billingInvoicesResult] =
        linkedProjectIds.length > 0
          ? await Promise.all([
              supabase
                .from("project_funding_profiles")
                .select("project_id, funding_need_amount, local_match_need_amount, updated_at")
                .in("project_id", linkedProjectIds),
              supabase
                .from("funding_awards")
                .select("project_id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
                .in("project_id", linkedProjectIds),
              supabase
                .from("funding_opportunities")
                .select("project_id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
                .in("project_id", linkedProjectIds),
              supabase
                .from("billing_invoice_records")
                .select("project_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
                .in("project_id", linkedProjectIds),
            ])
          : [
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
            ];
      const fundingProfileByProjectId = new Map(
        ((fundingProfilesResult.data ?? []) as Array<{ project_id: string; funding_need_amount: number | null; local_match_need_amount: number | null; updated_at: string | null }>).map((profile) => [profile.project_id, profile])
      );
      const fundingAwardsByProjectId = new Map<string, Array<{ awarded_amount: number | string | null; match_amount: number | string | null; risk_flag: string | null; obligation_due_at: string | null; updated_at: string | null; created_at: string | null }>>();
      const fundingOpportunitiesByProjectId = new Map<string, Array<{ expected_award_amount: number | string | null; decision_state: string | null; opportunity_status: string | null; closes_at: string | null; updated_at: string | null; created_at: string | null }>>();
      const fundingInvoicesByProjectId = new Map<string, Array<{ status: string | null; amount: number | string | null; retention_percent: number | string | null; retention_amount: number | string | null; net_amount: number | string | null; due_date: string | null; invoice_date: string | null; created_at: string | null }>>();
      for (const award of (fundingAwardsResult.data ?? []) as Array<{ project_id: string; awarded_amount: number | string | null; match_amount: number | string | null; risk_flag: string | null; obligation_due_at: string | null; updated_at: string | null; created_at: string | null }>) {
        const current = fundingAwardsByProjectId.get(award.project_id) ?? [];
        current.push(award);
        fundingAwardsByProjectId.set(award.project_id, current);
      }
      for (const opportunity of (fundingOpportunitiesResult.data ?? []) as Array<{ project_id: string; expected_award_amount: number | string | null; decision_state: string | null; opportunity_status: string | null; closes_at: string | null; updated_at: string | null; created_at: string | null }>) {
        const current = fundingOpportunitiesByProjectId.get(opportunity.project_id) ?? [];
        current.push(opportunity);
        fundingOpportunitiesByProjectId.set(opportunity.project_id, current);
      }
      for (const invoice of (billingInvoicesResult.data ?? []) as Array<{ project_id: string; status: string | null; amount: number | string | null; retention_percent: number | string | null; retention_amount: number | string | null; net_amount: number | string | null; due_date: string | null; invoice_date: string | null; created_at: string | null }>) {
        const current = fundingInvoicesByProjectId.get(invoice.project_id) ?? [];
        current.push(invoice);
        fundingInvoicesByProjectId.set(invoice.project_id, current);
      }
      const portfolioFundingSnapshot = buildPortfolioFundingSnapshot({
        projects: linkedProjectIds.map((projectId) => ({
          profile: fundingProfileByProjectId.get(projectId) ?? null,
          awards: fundingAwardsByProjectId.get(projectId) ?? [],
          opportunities: fundingOpportunitiesByProjectId.get(projectId) ?? [],
          invoices: fundingInvoicesByProjectId.get(projectId) ?? [],
        })),
        capturedAt: report.generated_at ?? new Date().toISOString(),
      });
      const campaignIds = campaigns.map((campaign) => campaign.id);
      const engagementItemsResult = campaignIds.length
        ? await supabase
            .from("engagement_items")
            .select(
              "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at"
            )
            .in("campaign_id", campaignIds)
        : { data: [], error: null };
      const engagementCounts = summarizeEngagementItems(
        [],
        (engagementItemsResult.data ?? []) as Array<{
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
        }>
      );
      const cycleLevelCampaignCount = campaigns.filter((campaign) => !campaign.rtp_cycle_chapter_id).length;
      const chapterLevelCampaignCount = campaigns.length - cycleLevelCampaignCount;
      const enabledSectionKeys = sections.filter((section) => section.enabled).map((section) => section.section_key);
      const packetPresetAlignment = getRtpPacketPresetAlignment({
        cycleStatus: cycle.status,
        sections: sections.map((section) => ({
          sectionKey: section.section_key,
          enabled: section.enabled,
          sortOrder: section.sort_order,
        })),
      });
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
        cycleLevelCampaignCount,
        chapterCampaignCount: chapterLevelCampaignCount,
        packetRecordCount: 1,
        generatedPacketCount: 1,
        pendingCommentCount: engagementCounts.moderationQueue.pendingCount,
        approvedCommentCount: engagementCounts.moderationQueue.approvedCount,
        readyCommentCount: engagementCounts.moderationQueue.readyForHandoffCount,
      });
      const format = parsed.data.format;
      const chapterCompleteCount = chapters.filter((chapter) => chapter.status === "complete").length;
      const chapterReadyForReviewCount = chapters.filter((chapter) => chapter.status === "ready_for_review").length;
      const html = buildRtpExportHtml({
        cycle,
        chapters,
        linkedProjects,
        campaigns,
        options: {
          sectionKeys: enabledSectionKeys,
          titleSuffix: "OpenPlan RTP Packet",
          publicReviewSummary: {
            ...publicReviewSummary,
            cycleLevelCampaignCount,
            chapterLevelCampaignCount,
            pendingCommentCount: engagementCounts.moderationQueue.pendingCount,
            readyCommentCount: engagementCounts.moderationQueue.readyForHandoffCount,
          },
          modelingEvidence,
        },
      });
      const generatedAt = new Date().toISOString();
      const artifactId = crypto.randomUUID();
      let rtpPdfStoragePath: string | null = null;
      if (format === "pdf") {
        let pdfBuffer: Buffer;
        try {
          pdfBuffer = await renderHtmlToPdf(html);
        } catch (pdfError) {
          audit.error("report_pdf_render_failed", {
            reportId: report.id,
            message: pdfError instanceof Error ? pdfError.message : String(pdfError),
          });
          return NextResponse.json({ error: "Failed to render PDF" }, { status: 500 });
        }
        const storagePath = `${report.workspace_id}/${report.id}/${artifactId}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("report-artifacts")
          .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: false });
        if (uploadError) {
          audit.error("report_pdf_upload_failed", {
            reportId: report.id,
            message: uploadError.message,
          });
          return NextResponse.json({ error: "Failed to upload PDF artifact" }, { status: 500 });
        }
        rtpPdfStoragePath = storagePath;
      }
      const artifactMetadata = {
        htmlContent: html,
        generatedAt,
        auditability: {
          posture: "rtp_packet_v1",
          note: "This output assembles RTP cycle narrative, portfolio posture, and engagement targets into a packet record artifact.",
        },
        sourceContext: {
          reportOrigin: "rtp_cycle_packet",
          reportReason: "board_packet_record",
          rtpCycleId: cycle.id,
          rtpCycleTitle: cycle.title,
          rtpCycleUpdatedAt: cycle.updated_at,
          chapterCount: chapters.length,
          chapterCompleteCount,
          chapterReadyForReviewCount,
          linkedProjectCount: linkedProjects.length,
          engagementCampaignCount: campaigns.length,
          cycleLevelCampaignCount,
          chapterLevelCampaignCount,
          engagementPendingCommentCount: engagementCounts.moderationQueue.pendingCount,
          engagementApprovedCommentCount: engagementCounts.moderationQueue.approvedCount,
          engagementReadyCommentCount: engagementCounts.moderationQueue.readyForHandoffCount,
          publicReviewSummary,
          rtpFundingSnapshot: portfolioFundingSnapshot,
          readiness,
          workflow,
          modelingEvidence: modelingEvidenceMetadata,
          modelingEvidenceCount: modelingEvidenceMetadata.length,
          modelingEvidenceClaimStatuses,
          enabledSectionCount: sections.filter((section) => section.enabled).length,
          enabledSectionKeys,
          packetPresetAlignment,
        },
        generationMode: format === "pdf" ? "rtp_pdf_packet" : "rtp_html_packet",
      };

      const { data: artifact, error: artifactError } = await supabase
        .from("report_artifacts")
        .insert({
          id: artifactId,
          report_id: report.id,
          artifact_kind: format,
          storage_path: rtpPdfStoragePath,
          generated_by: user.id,
          generated_at: generatedAt,
          metadata_json: artifactMetadata,
        })
        .select("id, report_id, artifact_kind, generated_at, metadata_json")
        .single();

      if (artifactError || !artifact) {
        audit.error("artifact_insert_failed", {
          reportId: report.id,
          message: artifactError?.message ?? "unknown",
          code: artifactError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to persist report artifact" }, { status: 500 });
      }

      const latestArtifactUrl = `/reports/${report.id}#artifact-${artifact.id}`;
      const nextMetadataJson = {
        ...(report.metadata_json && typeof report.metadata_json === "object" ? report.metadata_json : {}),
        queueTrace: {
          action: report.generated_at ? "refresh_artifact" : "generate_first_artifact",
          actedAt: generatedAt,
          actorUserId: user.id,
          source: "reports.generate",
          detail: report.generated_at ? "Refreshed RTP packet artifact." : "Generated first RTP packet artifact.",
        },
      };

      let reportUpdateResult = await supabase
        .from("reports")
        .update({
          status: "generated",
          generated_at: generatedAt,
          latest_artifact_kind: format,
          latest_artifact_url: latestArtifactUrl,
          metadata_json: nextMetadataJson,
          rtp_basis_stale: false,
          rtp_basis_stale_reason: null,
          rtp_basis_stale_run_id: null,
          rtp_basis_stale_marked_at: null,
        })
        .eq("id", report.id);

      if (reportUpdateResult.error && looksLikePendingSchema(reportUpdateResult.error.message)) {
        reportUpdateResult = await supabase
          .from("reports")
          .update({
            status: "generated",
            generated_at: generatedAt,
            latest_artifact_kind: format,
            latest_artifact_url: latestArtifactUrl,
          })
          .eq("id", report.id);
      }

      const { error: reportUpdateError } = reportUpdateResult;

      if (reportUpdateError) {
        audit.error("report_update_failed", {
          reportId: report.id,
          message: reportUpdateError.message,
          code: reportUpdateError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to update report generation status" }, { status: 500 });
      }

      audit.info("rtp_report_generated", {
        reportId: report.id,
        artifactId: artifact.id,
        format,
        storagePath: rtpPdfStoragePath,
        userId: user.id,
        linkedProjectCount: linkedProjects.length,
        modelingEvidenceCount: modelingEvidenceMetadata.length,
        modelingEvidenceClaimStatuses,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          reportId: report.id,
          artifactId: artifact.id,
          format,
          latestArtifactUrl,
          storagePath: rtpPdfStoragePath,
          warnings: [],
        },
        { status: 200 }
      );
    }

    const [
      workspaceResult,
      projectResult,
      sectionsResult,
      reportRunsResult,
      stageGateDecisionsResult,
      deliverablesResult,
      risksResult,
      issuesResult,
      decisionsResult,
      meetingsResult,
      fundingProfileResult,
      fundingAwardsResult,
      fundingOpportunitiesResult,
      billingInvoicesResult,
      countyRunsResult,
    ] = await Promise.all([
      supabase.from("workspaces").select("id, name, plan").eq("id", report.workspace_id).maybeSingle(),
      supabase
        .from("projects")
        .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at")
        .eq("id", report.project_id)
        .maybeSingle(),
      supabase
        .from("report_sections")
        .select("id, section_key, title, enabled, sort_order, config_json")
        .eq("report_id", report.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("report_runs")
        .select("id, run_id, sort_order")
        .eq("report_id", report.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("stage_gate_decisions")
        .select("id, gate_id, decision, rationale, decided_at, missing_artifacts")
        .eq("workspace_id", report.workspace_id)
        .order("decided_at", { ascending: false })
        .limit(200),
      supabase
        .from("project_deliverables")
        .select("id, title, summary, status, due_date, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("project_risks")
        .select("id, title, description, status, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("project_issues")
        .select("id, title, description, status, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("project_decisions")
        .select("id, title, rationale, status, decided_at, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("project_meetings")
        .select("id, title, notes, meeting_at, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false })
        .limit(8),
      safeOptionalQuery(
        () =>
          supabase
            .from("project_funding_profiles")
            .select("id, funding_need_amount, local_match_need_amount, updated_at")
            .eq("project_id", report.project_id)
            .maybeSingle(),
        null
      ),
      safeOptionalQuery(
        () =>
          supabase
            .from("funding_awards")
            .select("id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
            .eq("project_id", report.project_id)
            .order("updated_at", { ascending: false }),
        [] as Array<Record<string, unknown>>
      ),
      safeOptionalQuery(
        () =>
          supabase
            .from("funding_opportunities")
            .select("id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
            .eq("project_id", report.project_id)
            .order("updated_at", { ascending: false }),
        [] as Array<Record<string, unknown>>
      ),
      safeOptionalQuery(
        () =>
          supabase
            .from("billing_invoice_records")
            .select("id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
            .eq("project_id", report.project_id)
            .order("created_at", { ascending: false }),
        [] as Array<Record<string, unknown>>
      ),
      safeOptionalQuery(
        () =>
          supabase
            .from("county_runs")
            .select("id, run_name, geography_label, stage, updated_at")
            .eq("workspace_id", report.workspace_id)
            .order("updated_at", { ascending: false })
            .limit(5),
        [] as ReportCountyRunEvidenceRow[]
      ),
    ]);

    const loadErrors = [
      workspaceResult.error,
      projectResult.error,
      sectionsResult.error,
      reportRunsResult.error,
      stageGateDecisionsResult.error,
      deliverablesResult.error,
      risksResult.error,
      issuesResult.error,
      decisionsResult.error,
      meetingsResult.error,
      fundingProfileResult.error,
      fundingAwardsResult.error,
      fundingOpportunitiesResult.error,
      billingInvoicesResult.error,
    ].filter(Boolean);

    if (countyRunsResult.error) {
      audit.warn("report_modeling_county_runs_lookup_failed", {
        reportId: report.id,
        workspaceId: report.workspace_id,
        message: countyRunsResult.error.message,
        code: countyRunsResult.error.code ?? null,
      });
    }

    if (loadErrors.length > 0 || !projectResult.data) {
      const firstError = loadErrors[0];
      audit.error("report_generation_load_failed", {
        reportId: report.id,
        message: firstError?.message ?? "Project not found",
        code: firstError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load report source records" }, { status: 500 });
    }

    const projectCountyRuns = countyRunsResult.error ? [] : (countyRunsResult.data ?? []);
    const projectModelingEvidencePromise: Promise<ReportModelingEvidence[]> = Promise.all(
      projectCountyRuns.map(async (countyRun) => {
        const evidenceResult = await loadCountyRunModelingEvidence({
          supabase,
          countyRunId: countyRun.id,
          track: "assignment",
        });

        if (evidenceResult.error) {
          audit.warn("report_modeling_evidence_lookup_failed", {
            reportId: report.id,
            workspaceId: report.workspace_id,
            countyRunId: countyRun.id,
            message: evidenceResult.error.message,
            code: evidenceResult.error.code ?? null,
            missingSchema: evidenceResult.error.missingSchema ?? false,
          });
        }

        return {
          countyRunId: countyRun.id,
          runName: countyRun.run_name,
          geographyLabel: countyRun.geography_label,
          stage: countyRun.stage,
          updatedAt: countyRun.updated_at,
          evidence: evidenceResult.evidence,
        };
      })
    );

    const engagementCampaignId = extractEngagementCampaignId(sectionsResult.data ?? []);
    const engagementProvenance = extractEngagementHandoffProvenance(sectionsResult.data ?? []);
    const [engagementCampaignResult, engagementCategoriesResult, engagementItemsResult] =
      engagementCampaignId
        ? await Promise.all([
            supabase
              .from("engagement_campaigns")
              .select("id, title, summary, status, engagement_type, share_token, updated_at")
              .eq("workspace_id", report.workspace_id)
              .eq("id", engagementCampaignId)
              .maybeSingle(),
            supabase
              .from("engagement_categories")
              .select("id, label, slug, description, sort_order, created_at, updated_at")
              .eq("campaign_id", engagementCampaignId)
              .order("sort_order", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase
              .from("engagement_items")
              .select("id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at")
              .eq("campaign_id", engagementCampaignId)
              .order("updated_at", { ascending: false }),
          ])
        : [
            { data: null, error: null },
            { data: [], error: null },
            { data: [], error: null },
          ];

    const engagementLoadErrors = [
      engagementCampaignResult.error,
      engagementCategoriesResult.error,
      engagementItemsResult.error,
    ].filter(Boolean);

    if (engagementLoadErrors.length > 0) {
      const firstError = engagementLoadErrors[0];
      audit.error("report_engagement_load_failed", {
        reportId: report.id,
        campaignId: engagementCampaignId,
        message: firstError?.message ?? "unknown",
        code: firstError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load engagement handoff context" }, { status: 500 });
    }

    const engagement = buildReportEngagementSummary({
      campaign: engagementCampaignResult.data,
      categories: engagementCategoriesResult.data ?? [],
      items: engagementItemsResult.data ?? [],
    });

    const runIds = (reportRunsResult.data ?? []).map((item) => item.run_id);
    const runsResult = runIds.length
      ? await supabase
          .from("runs")
          .select("id, title, query_text, summary_text, ai_interpretation, metrics, created_at")
          .in("id", runIds)
      : { data: [], error: null };

    if (runsResult.error) {
      audit.error("report_runs_load_failed", {
        reportId: report.id,
        message: runsResult.error.message,
        code: runsResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked runs" }, { status: 500 });
    }

    const runMap = new Map((runsResult.data ?? []).map((run) => [run.id, run]));
    const linkedRuns = (reportRunsResult.data ?? [])
      .map((item) => runMap.get(item.run_id) ?? null)
      .filter((item): item is NonNullable<(typeof runsResult.data)[number]> => Boolean(item));

    const runAudit = linkedRuns.map((run) => ({
      runId: run.id,
      gate: evaluateReportArtifactGate(run),
      transparency: buildSourceTransparency(run.metrics ?? {}, typeof run.ai_interpretation === "string" ? "ai" : "fallback"),
    }));
    const linkedRunContext = linkedRuns.map((run) => ({
      id: run.id,
      title: run.title ?? "Untitled run",
      created_at: run.created_at ?? report.created_at,
    }));
    const scenarioSetLinksResult = await loadReportScenarioSetLinks({
      supabase: supabase as unknown as ReportScenarioSupabaseLike,
      linkedRuns: linkedRunContext,
      onSchemaPending: (warning) => {
        audit.warn("scenario_spine_schema_pending", {
          reportId: report.id,
          source: warning.source,
          message: warning.message,
        });
      },
    });

    if (scenarioSetLinksResult.error) {
      audit.error("report_scenario_context_load_failed", {
        reportId: report.id,
        message: scenarioSetLinksResult.error.message,
        code: scenarioSetLinksResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load scenario provenance" }, { status: 500 });
    }

    const scenarioSetLinks = scenarioSetLinksResult.data;
    const modelingEvidence = await projectModelingEvidencePromise;
    const modelingEvidenceMetadata = summarizeReportModelingEvidenceForMetadata(modelingEvidence);
    const modelingEvidenceClaimStatuses = extractReportModelingEvidenceClaimStatuses(modelingEvidence);

    const projectRecordsSnapshot = buildProjectRecordSnapshot({
      deliverables: deliverablesResult.data ?? [],
      risks: risksResult.data ?? [],
      issues: issuesResult.data ?? [],
      decisions: decisionsResult.data ?? [],
      meetings: meetingsResult.data ?? [],
    });
    const projectFundingSnapshot = buildProjectFundingSnapshot({
      profile: fundingProfileResult.data,
      awards: fundingAwardsResult.data ?? [],
      opportunities: fundingOpportunitiesResult.data ?? [],
      invoices: billingInvoicesResult.data ?? [],
      capturedAt: new Date().toISOString(),
      projectUpdatedAt: projectResult.data.updated_at,
    });
    const stageGateSnapshot = buildProjectStageGateSnapshot(
      buildProjectStageGateSummary(
        (stageGateDecisionsResult.data ?? []) as Array<{
          gate_id: string;
          decision: string;
          rationale: string | null;
          decided_at: string | null;
          missing_artifacts?: string[] | null;
        }>
      )
    );

    const evidenceChainSummary = buildEvidenceChainSummary({
      linkedRunCount: linkedRuns.length,
      scenarioSetLinks,
      projectRecordsSnapshot,
      engagementCampaignCurrent: engagement
        ? {
            status: engagement.campaign.status,
          }
        : null,
      engagementItemCount: engagement?.counts.totalItems ?? 0,
      engagementReadyForHandoffCount:
        engagement?.counts.moderationQueue.readyForHandoffCount ?? 0,
      stageGateSnapshot,
      modelingEvidenceCount: modelingEvidence.length,
      modelingEvidenceClaimStatuses,
    });

    const scenarioSpineSummary = {
      assumptionSetCount: scenarioSetLinks.reduce(
        (sum, link) => sum + (link.sharedSpine?.assumptionSetCount ?? 0),
        0
      ),
      dataPackageCount: scenarioSetLinks.reduce(
        (sum, link) => sum + (link.sharedSpine?.dataPackageCount ?? 0),
        0
      ),
      indicatorSnapshotCount: scenarioSetLinks.reduce(
        (sum, link) => sum + (link.sharedSpine?.indicatorSnapshotCount ?? 0),
        0
      ),
      pendingCount: scenarioSetLinks.filter((link) => link.sharedSpine?.schemaPending).length,
      latestAssumptionSetUpdatedAt: maxTimestamp(
        scenarioSetLinks.map((link) => link.sharedSpine?.latestAssumptionSetUpdatedAt ?? null)
      ),
      latestDataPackageUpdatedAt: maxTimestamp(
        scenarioSetLinks.map((link) => link.sharedSpine?.latestDataPackageUpdatedAt ?? null)
      ),
      latestIndicatorSnapshotAt: maxTimestamp(
        scenarioSetLinks.map((link) => link.sharedSpine?.latestIndicatorSnapshotAt ?? null)
      ),
    };

    const html = buildReportHtml({
      report,
      workspace: workspaceResult.data,
      project: projectResult.data,
      runs: linkedRuns,
      sections: sectionsResult.data ?? [],
      deliverables: (deliverablesResult.data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.summary,
        status: item.status,
        at: item.due_date ?? item.created_at,
      })),
      risks: (risksResult.data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.description,
        status: item.status,
        at: item.created_at,
      })),
      issues: (issuesResult.data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.description,
        status: item.status,
        at: item.created_at,
      })),
      decisions: (decisionsResult.data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.rationale,
        status: item.status,
        at: item.decided_at ?? item.created_at,
      })),
      meetings: (meetingsResult.data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.notes,
        at: item.meeting_at ?? item.created_at,
      })),
      engagement,
      scenarioSetLinks,
      projectFundingSnapshot,
      projectRecordsSnapshot,
      stageGateSnapshot,
      modelingEvidence,
    });

    const format = parsed.data.format;
    const generatedAt = new Date().toISOString();
    const artifactId = crypto.randomUUID();
    let projectPdfStoragePath: string | null = null;
    if (format === "pdf") {
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await renderHtmlToPdf(html);
      } catch (pdfError) {
        audit.error("report_pdf_render_failed", {
          reportId: report.id,
          message: pdfError instanceof Error ? pdfError.message : String(pdfError),
        });
        return NextResponse.json({ error: "Failed to render PDF" }, { status: 500 });
      }
      const storagePath = `${report.workspace_id}/${report.id}/${artifactId}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("report-artifacts")
        .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: false });
      if (uploadError) {
        audit.error("report_pdf_upload_failed", {
          reportId: report.id,
          message: uploadError.message,
        });
        return NextResponse.json({ error: "Failed to upload PDF artifact" }, { status: 500 });
      }
      projectPdfStoragePath = storagePath;
    }
    const artifactMetadata = {
      metadata_schema_version: "2026-04",
      htmlContent: html,
      generatedAt,
      auditability: {
        posture: "structured_packet_v1",
        note: "This output assembles structured records and linked run evidence as a review packet with explicit provenance.",
      },
      sourceContext: {
        reportOrigin: engagementProvenance?.origin ?? "report_builder",
        reportReason: engagementProvenance?.reason ?? null,
        projectUpdatedAt: projectResult.data.updated_at,
        linkedRunCount: linkedRuns.length,
        scenarioSetLinkCount: scenarioSetLinks.length,
        scenarioSetLinks,
        scenarioSpineSummary,
        deliverableCount: deliverablesResult.data?.length ?? 0,
        riskCount: risksResult.data?.length ?? 0,
        issueCount: issuesResult.data?.length ?? 0,
        decisionCount: decisionsResult.data?.length ?? 0,
        meetingCount: meetingsResult.data?.length ?? 0,
        stageGateSnapshot,
        projectRecordsSnapshot,
        projectFundingSnapshot,
        evidenceChainSummary,
        modelingEvidence: modelingEvidenceMetadata,
        modelingEvidenceCount: modelingEvidenceMetadata.length,
        modelingEvidenceClaimStatuses,
        engagementCampaignId:
          engagement?.campaign.id ?? engagementProvenance?.campaign.id ?? null,
        engagementCampaignSnapshot: engagementProvenance?.campaign ?? null,
        engagementSnapshotCapturedAt: engagementProvenance?.capturedAt || null,
        engagementCountsSnapshot: engagementProvenance?.counts ?? null,
        engagementCampaignCurrent:
          engagement?.campaign
            ? {
                id: engagement.campaign.id,
                title: engagement.campaign.title,
                summary: engagement.campaign.summary,
                status: engagement.campaign.status,
                engagementType: engagement.campaign.engagement_type,
                updatedAt: engagement.campaign.updated_at,
              }
            : null,
        engagementItemCount: engagement?.counts.totalItems ?? 0,
        engagementReadyForHandoffCount:
          engagement?.counts.moderationQueue.readyForHandoffCount ?? 0,
        auditWarningCount: runAudit.reduce(
          (count, item) => count + item.gate.missingArtifacts.length,
          0
        ),
      },
      runAudit,
      generationMode: format === "pdf" ? "structured_pdf_packet" : "structured_html_packet",
    };

    const { data: artifact, error: artifactError } = await supabase
      .from("report_artifacts")
      .insert({
        id: artifactId,
        report_id: report.id,
        artifact_kind: format,
        storage_path: projectPdfStoragePath,
        generated_by: user.id,
        generated_at: generatedAt,
        metadata_json: artifactMetadata,
      })
      .select("id, report_id, artifact_kind, generated_at, metadata_json")
      .single();

    if (artifactError || !artifact) {
      audit.error("artifact_insert_failed", {
        reportId: report.id,
        message: artifactError?.message ?? "unknown",
        code: artifactError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to persist report artifact" }, { status: 500 });
    }

    const latestArtifactUrl = `/reports/${report.id}#artifact-${artifact.id}`;
    const nextMetadataJson = {
      ...(report.metadata_json && typeof report.metadata_json === "object" ? report.metadata_json : {}),
      queueTrace: {
        action: report.generated_at ? "refresh_artifact" : "generate_first_artifact",
        actedAt: generatedAt,
        actorUserId: user.id,
        source: "reports.generate",
        detail: report.generated_at ? "Refreshed report artifact." : "Generated first report artifact.",
      },
    };

    let reportUpdateResult = await supabase
      .from("reports")
      .update({
        status: "generated",
        generated_at: generatedAt,
        latest_artifact_kind: format,
        latest_artifact_url: latestArtifactUrl,
        metadata_json: nextMetadataJson,
        rtp_basis_stale: false,
        rtp_basis_stale_reason: null,
        rtp_basis_stale_run_id: null,
        rtp_basis_stale_marked_at: null,
      })
      .eq("id", report.id);

    if (reportUpdateResult.error && looksLikePendingSchema(reportUpdateResult.error.message)) {
      reportUpdateResult = await supabase
        .from("reports")
        .update({
          status: "generated",
          generated_at: generatedAt,
          latest_artifact_kind: format,
          latest_artifact_url: latestArtifactUrl,
        })
        .eq("id", report.id);
    }

    const { error: reportUpdateError } = reportUpdateResult;

    if (reportUpdateError) {
      audit.error("report_update_failed", {
        reportId: report.id,
        message: reportUpdateError.message,
        code: reportUpdateError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update report generation status" }, { status: 500 });
    }

    audit.info("report_generated", {
      reportId: report.id,
      artifactId: artifact.id,
      format,
      storagePath: projectPdfStoragePath,
      userId: user.id,
      linkedRunCount: linkedRuns.length,
      modelingEvidenceCount: modelingEvidenceMetadata.length,
      modelingEvidenceClaimStatuses,
      durationMs: Date.now() - startedAt,
    });

    const executionCompletedAt = new Date().toISOString();
    const executionStartedAt = new Date(startedAt).toISOString();
    const { error: executionAuditError } = await recordAssistantActionExecution(supabase, {
      workspaceId: report.workspace_id,
      userId: user.id,
      actionKind: "generate_report_artifact",
      auditEvent: "planner_agent.generate_report_artifact",
      approval: "safe",
      regrounding: "refresh_preview",
      outcome: "succeeded",
      inputSummary: {
        reportId: report.id,
        artifactId: artifact.id,
        linkedRunCount: linkedRuns.length,
      },
      startedAt: executionStartedAt,
      completedAt: executionCompletedAt,
    });

    if (executionAuditError) {
      audit.warn("assistant_action_execution_audit_failed", {
        reportId: report.id,
        artifactId: artifact.id,
        message: executionAuditError.message,
        code: executionAuditError.code ?? null,
      });
    }

    return NextResponse.json(
      {
        reportId: report.id,
        artifactId: artifact.id,
        format,
        latestArtifactUrl,
        storagePath: projectPdfStoragePath,
        warnings: runAudit.flatMap((item) =>
          item.gate.missingArtifacts.map((missingArtifact) => ({
            runId: item.runId,
            missingArtifact,
          }))
        ),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("reports_generate_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while generating report" }, { status: 500 });
  }
}
