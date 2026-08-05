import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { assistantActionAuditIdentity, recordAssistantActionExecution } from "@/lib/observability/action-audit";
import { verifyAssistantActionApproval } from "@/lib/assistant/action-approval-server";
import {
  createDefaultTargetedReportSections,
  defaultTargetedReportTitle,
  type ReportType,
} from "@/lib/reports/catalog";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const reportsFilterSchema = z.object({
  projectId: z.string().uuid().optional(),
  engagementCampaignId: z.string().uuid().optional(),
  reportType: z.enum(["project_status", "analysis_summary", "board_packet"]).optional(),
  status: z.enum(["draft", "generated", "archived"]).optional(),
});

const createReportSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    rtpCycleId: z.string().uuid().optional(),
    engagementCampaignId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160).optional(),
    reportType: z.enum(["project_status", "analysis_summary", "board_packet"]),
    summary: z.string().trim().max(2000).optional(),
    modelingCountyRunId: z.string().uuid().optional(),
    runIds: z.array(z.string().uuid()).max(20).optional(),
    // Typed evidence citations: worker model runs and county validation runs
    // a packet cites directly (report_runs.model_run_id / county_run_id).
    modelRunIds: z.array(z.string().uuid()).max(20).optional(),
    countyRunIds: z.array(z.string().uuid()).max(20).optional(),
    sections: z
      .array(
        z.object({
          sectionKey: z.string().trim().min(1).max(80),
          title: z.string().trim().min(1).max(160),
          enabled: z.boolean().default(true),
          sortOrder: z.number().int().min(0).max(100),
          configJson: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .max(30)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const targetCount =
      Number(Boolean(value.projectId)) +
      Number(Boolean(value.rtpCycleId)) +
      Number(Boolean(value.engagementCampaignId));
    if (targetCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one report target",
        path: ["projectId"],
      });
    }

    if (value.rtpCycleId && value.reportType !== "board_packet") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RTP cycle reports currently support board packets only",
        path: ["reportType"],
      });
    }

    if (value.engagementCampaignId && value.reportType === "board_packet") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Engagement campaign reports support status and summary packets, not board packets",
        path: ["reportType"],
      });
    }

    // Legacy Analysis Studio runs stay project-only; typed model/county run
    // citations are allowed on every target (RTP packets already carry
    // per-link modeling evidence, and a campaign packet may cite the runs
    // that informed its engagement window, so citing runs there is coherent).
    if (value.rtpCycleId && (value.runIds?.length ?? 0) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Linked runs are not supported on RTP cycle packet records yet",
        path: ["runIds"],
      });
    }

    if (value.engagementCampaignId && (value.runIds?.length ?? 0) > 0) {
      // Legacy linked runs are project-scoped records; a campaign target has
      // no project to scope them to.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Linked runs are project-scoped and are not supported on campaign reports",
        path: ["runIds"],
      });
    }
  });

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("reports.list", request);
  const startedAt = Date.now();

  try {
    const parsedFilters = reportsFilterSchema.safeParse({
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      engagementCampaignId: request.nextUrl.searchParams.get("engagementCampaignId") ?? undefined,
      reportType: request.nextUrl.searchParams.get("reportType") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
    });

    if (!parsedFilters.success) {
      audit.warn("validation_failed", { issues: parsedFilters.error.issues });
      return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const buildListQuery = (select: string, withCampaignFilter: boolean) => {
      let query = supabase
        .from("reports")
        .select(select)
        .order("updated_at", { ascending: false });

      if (parsedFilters.data.projectId) {
        query = query.eq("project_id", parsedFilters.data.projectId);
      }

      if (withCampaignFilter && parsedFilters.data.engagementCampaignId) {
        query = query.eq("engagement_campaign_id", parsedFilters.data.engagementCampaignId);
      }

      if (parsedFilters.data.reportType) {
        query = query.eq("report_type", parsedFilters.data.reportType);
      }

      if (parsedFilters.data.status) {
        query = query.eq("status", parsedFilters.data.status);
      }

      return query;
    };

    let { data, error } = await buildListQuery(
      "id, workspace_id, project_id, rtp_cycle_id, engagement_campaign_id, modeling_county_run_id, title, report_type, status, summary, generated_at, latest_artifact_url, latest_artifact_kind, created_at, updated_at, projects(id, name), rtp_cycles(id, title), engagement_campaigns(id, title), workspaces(name)",
      true
    );

    if (error && looksLikePendingSchema(error.message)) {
      if (parsedFilters.data.engagementCampaignId) {
        // The campaign-target column does not exist yet, so no campaign-scoped
        // report can exist either: an empty list is the truthful answer.
        audit.warn("reports_list_campaign_filter_pending_schema", {
          message: error.message,
        });
        return NextResponse.json({ reports: [], schemaPending: true }, { status: 200 });
      }

      ({ data, error } = await buildListQuery(
        "id, workspace_id, project_id, rtp_cycle_id, modeling_county_run_id, title, report_type, status, summary, generated_at, latest_artifact_url, latest_artifact_kind, created_at, updated_at, projects(id, name), rtp_cycles(id, title), workspaces(name)",
        false
      ));
    }

    if (error) {
      audit.error("reports_list_failed", {
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
    }

    audit.info("reports_list_loaded", {
      userId: user.id,
      count: data?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ reports: data ?? [] }, { status: 200 });
  } catch (error) {
    audit.error("reports_list_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading reports" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("reports.create", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.documentJson);
    if (!payloadBody.ok) return payloadBody.response;
    const payload = payloadBody.data;
    const parsed = createReportSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const runIds = parsed.data.runIds ?? [];
    const modelRunIds = parsed.data.modelRunIds ?? [];
    const countyRunIds = parsed.data.countyRunIds ?? [];
    const targetKind = parsed.data.projectId
      ? "project"
      : parsed.data.rtpCycleId
        ? "rtp_cycle"
        : "engagement_campaign";

    let target:
      | { kind: "project"; id: string; workspaceId: string; title: string }
      | { kind: "rtp_cycle"; id: string; workspaceId: string; title: string; status: string | null }
      | { kind: "engagement_campaign"; id: string; workspaceId: string; title: string }
      | null = null;

    if (parsed.data.projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id, workspace_id, name")
        .eq("id", parsed.data.projectId)
        .maybeSingle();

      if (projectError) {
        audit.error("project_lookup_failed", {
          projectId: parsed.data.projectId,
          message: projectError.message,
          code: projectError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify project" }, { status: 500 });
      }

      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }

      target = { kind: "project", id: project.id, workspaceId: project.workspace_id, title: project.name };
    } else if (parsed.data.rtpCycleId) {
      const { data: cycle, error: cycleError } = await supabase
        .from("rtp_cycles")
        .select("id, workspace_id, title, status")
        .eq("id", parsed.data.rtpCycleId)
        .maybeSingle();

      if (cycleError) {
        audit.error("rtp_cycle_lookup_failed", {
          rtpCycleId: parsed.data.rtpCycleId,
          message: cycleError.message,
          code: cycleError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify RTP cycle" }, { status: 500 });
      }

      if (!cycle) {
        return NextResponse.json({ error: "RTP cycle not found" }, { status: 404 });
      }

      target = { kind: "rtp_cycle", id: cycle.id, workspaceId: cycle.workspace_id, title: cycle.title, status: cycle.status };
    } else if (parsed.data.engagementCampaignId) {
      const { data: campaign, error: campaignError } = await supabase
        .from("engagement_campaigns")
        .select("id, workspace_id, title")
        .eq("id", parsed.data.engagementCampaignId)
        .maybeSingle();

      if (campaignError) {
        audit.error("engagement_campaign_lookup_failed", {
          engagementCampaignId: parsed.data.engagementCampaignId,
          message: campaignError.message,
          code: campaignError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify engagement campaign" }, { status: 500 });
      }

      if (!campaign) {
        return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
      }

      target = {
        kind: "engagement_campaign",
        id: campaign.id,
        workspaceId: campaign.workspace_id,
        title: campaign.title,
      };
    }

    if (!target) {
      return NextResponse.json({ error: "Report target is required" }, { status: 400 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", target.workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        workspaceId: target.workspaceId,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (!membership || !canAccessWorkspaceAction("reports.write", membership.role)) {
      audit.warn("forbidden_workspace", {
        workspaceId: target.workspaceId,
        userId: user.id,
        role: membership?.role ?? null,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (target.kind === "project" && runIds.length > 0) {
      const { data: runRows, error: runError } = await supabase
        .from("runs")
        .select("id")
        .eq("workspace_id", target.workspaceId)
        .in("id", runIds);

      if (runError) {
        audit.error("run_lookup_failed", {
          workspaceId: target.workspaceId,
          message: runError.message,
          code: runError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify linked runs" }, { status: 500 });
      }

      if ((runRows ?? []).length !== new Set(runIds).size) {
        return NextResponse.json({ error: "One or more linked runs are invalid" }, { status: 400 });
      }
    }

    if (modelRunIds.length > 0) {
      const { data: modelRunRows, error: modelRunError } = await supabase
        .from("model_runs")
        .select("id")
        .eq("workspace_id", target.workspaceId)
        .in("id", modelRunIds);

      if (modelRunError) {
        audit.error("model_run_lookup_failed", {
          workspaceId: target.workspaceId,
          message: modelRunError.message,
          code: modelRunError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify linked model runs" }, { status: 500 });
      }

      if ((modelRunRows ?? []).length !== new Set(modelRunIds).size) {
        return NextResponse.json({ error: "One or more linked model runs are invalid" }, { status: 400 });
      }
    }

    if (countyRunIds.length > 0) {
      const { data: countyRunRows, error: countyRunListError } = await supabase
        .from("county_runs")
        .select("id")
        .eq("workspace_id", target.workspaceId)
        .in("id", countyRunIds);

      if (countyRunListError) {
        audit.error("county_run_lookup_failed", {
          workspaceId: target.workspaceId,
          message: countyRunListError.message,
          code: countyRunListError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify linked county runs" }, { status: 500 });
      }

      if ((countyRunRows ?? []).length !== new Set(countyRunIds).size) {
        return NextResponse.json({ error: "One or more linked county runs are invalid" }, { status: 400 });
      }
    }

    if (parsed.data.modelingCountyRunId) {
      const { data: countyRun, error: countyRunError } = await supabase
        .from("county_runs")
        .select("id, workspace_id")
        .eq("id", parsed.data.modelingCountyRunId)
        .maybeSingle();

      if (countyRunError) {
        audit.error("modeling_county_run_lookup_failed", {
          workspaceId: target.workspaceId,
          countyRunId: parsed.data.modelingCountyRunId,
          message: countyRunError.message,
          code: countyRunError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify modeling county run" }, { status: 500 });
      }

      if (!countyRun || countyRun.workspace_id !== target.workspaceId) {
        return NextResponse.json({ error: "Modeling county run not found" }, { status: 400 });
      }
    }

    const reportTitle = parsed.data.title?.trim() || defaultTargetedReportTitle(target.title, parsed.data.reportType as ReportType);

    const reportInsertPayload = {
      workspace_id: target.workspaceId,
      project_id: target.kind === "project" ? target.id : null,
      rtp_cycle_id: target.kind === "rtp_cycle" ? target.id : null,
      engagement_campaign_id: target.kind === "engagement_campaign" ? target.id : null,
      modeling_county_run_id: parsed.data.modelingCountyRunId ?? null,
      title: reportTitle,
      report_type: parsed.data.reportType,
      summary: parsed.data.summary?.trim() || null,
      created_by: user.id,
      metadata_json:
        target.kind === "rtp_cycle"
          ? {
              queueTrace: {
                action: "create_record",
                actedAt: new Date().toISOString(),
                actorUserId: user.id,
                source: "reports.create",
                detail: "Created RTP packet record.",
              },
            }
          : {},
    };

    let reportInsertResult = await supabase
      .from("reports")
      .insert(reportInsertPayload)
      .select("id, workspace_id, project_id, rtp_cycle_id, engagement_campaign_id, modeling_county_run_id, title, report_type, status, summary, metadata_json, created_at, updated_at")
      .single();

    if (reportInsertResult.error && looksLikePendingSchema(reportInsertResult.error.message)) {
      if (target.kind === "engagement_campaign") {
        // A campaign target cannot fall back to the legacy insert: without the
        // engagement_campaign_id column the row would have no target at all,
        // which the target-presence constraint rightly refuses.
        audit.warn("report_insert_campaign_target_pending_schema", {
          workspaceId: target.workspaceId,
          message: reportInsertResult.error.message,
        });
        return NextResponse.json(
          {
            error: "Campaign-targeted reports need a database update",
            details: reportInsertResult.error.message,
            hint: "Apply migration 20260727000008_reports_engagement_campaign_target before creating campaign-scoped reports.",
          },
          { status: 503 }
        );
      }

      reportInsertResult = await supabase
        .from("reports")
        .insert({
          workspace_id: reportInsertPayload.workspace_id,
          project_id: reportInsertPayload.project_id,
          rtp_cycle_id: reportInsertPayload.rtp_cycle_id,
          title: reportInsertPayload.title,
          report_type: reportInsertPayload.report_type,
          summary: reportInsertPayload.summary,
          created_by: reportInsertPayload.created_by,
        })
        .select("id, workspace_id, project_id, rtp_cycle_id, title, report_type, status, summary, created_at, updated_at")
        .single();
    }

    const { data: report, error: reportError } = reportInsertResult;

    if (reportError || !report) {
      audit.error("report_insert_failed", {
        workspaceId: target.workspaceId,
        message: reportError?.message ?? "unknown",
        code: reportError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create report" }, { status: 500 });
    }

    const sections = parsed.data.sections ?? createDefaultTargetedReportSections(parsed.data.reportType as ReportType, target.kind, {
      rtpCycleStatus: target.kind === "rtp_cycle" ? target.status : undefined,
    });

    if (sections.length > 0) {
      const { error: sectionsError } = await supabase.from("report_sections").insert(
        sections.map((section) => ({
          report_id: report.id,
          section_key: section.sectionKey,
          title: section.title,
          enabled: section.enabled,
          sort_order: section.sortOrder,
          config_json: section.configJson ?? {},
        }))
      );

      if (sectionsError) {
        audit.error("report_sections_insert_failed", {
          reportId: report.id,
          message: sectionsError.message,
          code: sectionsError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to create report sections" }, { status: 500 });
      }
    }

    if (target.kind === "project" && runIds.length > 0) {
      const { error: reportRunsError } = await supabase.from("report_runs").insert(
        runIds.map((runId, index) => ({
          report_id: report.id,
          run_id: runId,
          sort_order: index,
        }))
      );

      if (reportRunsError) {
        audit.error("report_runs_insert_failed", {
          reportId: report.id,
          message: reportRunsError.message,
          code: reportRunsError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to link report runs" }, { status: 500 });
      }
    }

    if (modelRunIds.length > 0 || countyRunIds.length > 0) {
      const typedEvidenceRows = [
        ...modelRunIds.map((modelRunId, index) => ({
          report_id: report.id,
          model_run_id: modelRunId,
          sort_order: runIds.length + index,
        })),
        ...countyRunIds.map((countyRunId, index) => ({
          report_id: report.id,
          county_run_id: countyRunId,
          sort_order: runIds.length + modelRunIds.length + index,
        })),
      ];

      const { error: typedEvidenceError } = await supabase.from("report_runs").insert(typedEvidenceRows);

      if (typedEvidenceError) {
        if (looksLikePendingSchema(typedEvidenceError.message)) {
          return NextResponse.json(
            {
              error:
                "Typed run evidence requires the report_runs typed-evidence migration. Apply the latest database migration first.",
            },
            { status: 503 }
          );
        }

        audit.error("report_typed_evidence_insert_failed", {
          reportId: report.id,
          message: typedEvidenceError.message,
          code: typedEvidenceError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to link run evidence" }, { status: 500 });
      }
    }

    audit.info("report_created", {
      reportId: report.id,
      targetKind,
      targetId: target.id,
      workspaceId: target.workspaceId,
      userId: user.id,
      linkedRunCount: runIds.length,
      linkedModelRunCount: modelRunIds.length,
      linkedCountyRunCount: countyRunIds.length,
      durationMs: Date.now() - startedAt,
    });

    if (target.kind === "rtp_cycle") {
      const executionCompletedAt = new Date().toISOString();
      const executionStartedAt = new Date(startedAt).toISOString();
      const serviceSupabase = createServiceRoleClient();
      const approval = await verifyAssistantActionApproval({
        request,
        serviceSupabase,
        userId: user.id,
        workspaceId: target.workspaceId,
        action: {
          kind: "create_rtp_packet_record",
          rtpCycleId: target.id,
          ...(parsed.data.modelingCountyRunId ? { modelingCountyRunId: parsed.data.modelingCountyRunId } : {}),
        },
      });
      const { error: executionAuditError } = await recordAssistantActionExecution(serviceSupabase, {
        workspaceId: target.workspaceId,
        userId: user.id,
        actionKind: "create_rtp_packet_record",
        auditEvent: "planner_agent.create_rtp_packet_record",
        approval: "review",
        regrounding: "refresh_preview",
        outcome: "succeeded",
        ...assistantActionAuditIdentity(approval),
        inputSummary: {
          reportId: report.id,
          rtpCycleId: target.id,
          reportType: parsed.data.reportType,
        },
        startedAt: executionStartedAt,
        completedAt: executionCompletedAt,
      });

      if (executionAuditError) {
        audit.warn("assistant_action_execution_audit_failed", {
          reportId: report.id,
          message: executionAuditError.message,
          code: executionAuditError.code ?? null,
        });
      }
    }

    return NextResponse.json(
      {
        reportId: report.id,
        report,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("reports_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while creating report" }, { status: 500 });
  }
}
