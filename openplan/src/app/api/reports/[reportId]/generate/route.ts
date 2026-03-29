import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { evaluateReportArtifactGate } from "@/lib/stage-gates/report-artifacts";
import {
  buildReportEngagementSummary,
  extractEngagementHandoffProvenance,
  extractEngagementCampaignId,
} from "@/lib/reports/engagement";
import { buildReportHtml } from "@/lib/reports/html";
import { loadReportScenarioSetLinks } from "@/lib/reports/scenario-provenance";

const paramsSchema = z.object({
  reportId: z.string().uuid(),
});

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

    const payload = await request.json().catch(() => ({}));
    const parsed = generateSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid generation request" }, { status: 400 });
    }

    if (parsed.data.format === "pdf") {
      return NextResponse.json(
        { error: "PDF export is not available for Reports yet" },
        { status: 501 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: report, error: reportError } = await supabase
      .from("reports")
      .select("id, workspace_id, project_id, title, summary, report_type, status, created_at")
      .eq("id", parsedParams.data.reportId)
      .maybeSingle();

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

    const [
      workspaceResult,
      projectResult,
      sectionsResult,
      reportRunsResult,
      deliverablesResult,
      risksResult,
      issuesResult,
      decisionsResult,
      meetingsResult,
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
    ]);

    const loadErrors = [
      workspaceResult.error,
      projectResult.error,
      sectionsResult.error,
      reportRunsResult.error,
      deliverablesResult.error,
      risksResult.error,
      issuesResult.error,
      decisionsResult.error,
      meetingsResult.error,
    ].filter(Boolean);

    if (loadErrors.length > 0 || !projectResult.data) {
      const firstError = loadErrors[0];
      audit.error("report_generation_load_failed", {
        reportId: report.id,
        message: firstError?.message ?? "Project not found",
        code: firstError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load report source records" }, { status: 500 });
    }

    const engagementCampaignId = extractEngagementCampaignId(sectionsResult.data ?? []);
    const engagementProvenance = extractEngagementHandoffProvenance(sectionsResult.data ?? []);
    const [engagementCampaignResult, engagementCategoriesResult, engagementItemsResult] =
      engagementCampaignId
        ? await Promise.all([
            supabase
              .from("engagement_campaigns")
              .select("id, title, summary, status, engagement_type, updated_at")
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
    const scenarioSetLinksResult = await loadReportScenarioSetLinks({
      supabase,
      linkedRuns,
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

    const projectRecordsSnapshot = buildProjectRecordSnapshot({
      deliverables: deliverablesResult.data ?? [],
      risks: risksResult.data ?? [],
      issues: issuesResult.data ?? [],
      decisions: decisionsResult.data ?? [],
      meetings: meetingsResult.data ?? [],
    });

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
      projectRecordsSnapshot,
    });

    const generatedAt = new Date().toISOString();
    const artifactMetadata = {
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
        deliverableCount: deliverablesResult.data?.length ?? 0,
        riskCount: risksResult.data?.length ?? 0,
        issueCount: issuesResult.data?.length ?? 0,
        decisionCount: decisionsResult.data?.length ?? 0,
        meetingCount: meetingsResult.data?.length ?? 0,
        projectRecordsSnapshot,
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
      generationMode: "structured_html_packet",
    };

    const { data: artifact, error: artifactError } = await supabase
      .from("report_artifacts")
      .insert({
        report_id: report.id,
        artifact_kind: "html",
        storage_path: null,
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
    const { error: reportUpdateError } = await supabase
      .from("reports")
      .update({
        status: "generated",
        generated_at: generatedAt,
        latest_artifact_kind: "html",
        latest_artifact_url: latestArtifactUrl,
      })
      .eq("id", report.id);

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
      userId: user.id,
      linkedRunCount: linkedRuns.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        reportId: report.id,
        artifactId: artifact.id,
        format: "html",
        latestArtifactUrl,
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
