import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";

const paramsSchema = z.object({
  reportId: z.string().uuid(),
});

const patchReportSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    summary: z.union([z.string().trim().max(2000), z.null()]).optional(),
    status: z.enum(["draft", "generated", "archived"]).optional(),
    runIds: z.array(z.string().uuid()).max(20).optional(),
    sections: z
      .array(
        z.object({
          sectionKey: z.string().trim().min(1).max(80),
          title: z.string().trim().min(1).max(160),
          enabled: z.boolean(),
          sortOrder: z.number().int().min(0).max(100),
          configJson: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .max(30)
      .optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

async function loadReportAccess(reportId: string, userId: string) {
  const supabase = await createClient();
  const { data: report, error: reportError } = await supabase
    .from("reports")
    .select(
      "id, workspace_id, project_id, title, status, report_type, generated_at, latest_artifact_url, latest_artifact_kind"
    )
    .eq("id", reportId)
    .maybeSingle();

  if (reportError) {
    return { supabase, report: null, membership: null, error: reportError };
  }

  if (!report) {
    return { supabase, report: null, membership: null, error: null };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", report.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    return { supabase, report, membership: null, error: membershipError };
  }

  return { supabase, report, membership, error: null };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("reports.detail", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadReportAccess(parsedParams.data.reportId, user.id);

    if (access.error) {
      audit.error("report_access_failed", {
        reportId: parsedParams.data.reportId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
    }

    if (!access.report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (!access.membership || !canAccessWorkspaceAction("reports.read", access.membership.role)) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: project, error: projectError } = await access.supabase
      .from("projects")
      .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at")
      .eq("id", access.report.project_id)
      .maybeSingle();

    if (projectError) {
      audit.error("report_project_lookup_failed", {
        reportId: access.report.id,
        message: projectError.message,
        code: projectError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load report project" }, { status: 500 });
    }

    const { data: sections, error: sectionsError } = await access.supabase
      .from("report_sections")
      .select("id, report_id, section_key, title, enabled, sort_order, config_json, created_at, updated_at")
      .eq("report_id", access.report.id)
      .order("sort_order", { ascending: true });

    if (sectionsError) {
      audit.error("report_sections_lookup_failed", {
        reportId: access.report.id,
        message: sectionsError.message,
        code: sectionsError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load report sections" }, { status: 500 });
    }

    const { data: reportRunLinks, error: reportRunsError } = await access.supabase
      .from("report_runs")
      .select("id, report_id, run_id, sort_order, created_at, updated_at")
      .eq("report_id", access.report.id)
      .order("sort_order", { ascending: true });

    if (reportRunsError) {
      audit.error("report_runs_lookup_failed", {
        reportId: access.report.id,
        message: reportRunsError.message,
        code: reportRunsError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load report runs" }, { status: 500 });
    }

    const runIds = (reportRunLinks ?? []).map((item) => item.run_id);
    const runsResult = runIds.length
      ? await access.supabase
          .from("runs")
          .select("id, workspace_id, title, query_text, summary_text, ai_interpretation, metrics, created_at")
          .in("id", runIds)
      : { data: [], error: null };

    if (runsResult.error) {
      audit.error("runs_lookup_failed", {
        reportId: access.report.id,
        message: runsResult.error.message,
        code: runsResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked runs" }, { status: 500 });
    }

    const runMap = new Map((runsResult.data ?? []).map((run) => [run.id, run]));
    const runs = (reportRunLinks ?? [])
      .map((link) => {
        const run = runMap.get(link.run_id);
        if (!run) return null;
        return {
          ...run,
          report_run_id: link.id,
          sort_order: link.sort_order,
        };
      })
      .filter((run) => Boolean(run));

    const { data: artifacts, error: artifactsError } = await access.supabase
      .from("report_artifacts")
      .select("id, report_id, artifact_kind, storage_path, generated_by, generated_at, metadata_json, created_at, updated_at")
      .eq("report_id", access.report.id)
      .order("generated_at", { ascending: false });

    if (artifactsError) {
      audit.error("artifacts_lookup_failed", {
        reportId: access.report.id,
        message: artifactsError.message,
        code: artifactsError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load report artifacts" }, { status: 500 });
    }

    return NextResponse.json(
      {
        report: access.report,
        project,
        sections: sections ?? [],
        runs,
        artifacts: artifacts ?? [],
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("reports_detail_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading report" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("reports.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = patchReportSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid report update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadReportAccess(parsedParams.data.reportId, user.id);

    if (access.error) {
      audit.error("report_access_failed", {
        reportId: parsedParams.data.reportId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify report access" }, { status: 500 });
    }

    if (!access.report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (!access.membership || !canAccessWorkspaceAction("reports.write", access.membership.role)) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (parsed.data.runIds) {
      const { data: runRows, error: runError } = await access.supabase
        .from("runs")
        .select("id")
        .eq("workspace_id", access.report.workspace_id)
        .in("id", parsed.data.runIds);

      if (runError) {
        audit.error("runs_lookup_failed", {
          reportId: access.report.id,
          message: runError.message,
          code: runError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify linked runs" }, { status: 500 });
      }

      if ((runRows ?? []).length !== new Set(parsed.data.runIds).size) {
        return NextResponse.json({ error: "One or more linked runs are invalid" }, { status: 400 });
      }
    }

    const reportUpdate: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) {
      reportUpdate.title = parsed.data.title;
    }
    if (parsed.data.summary !== undefined) {
      reportUpdate.summary = parsed.data.summary;
    }
    if (parsed.data.status !== undefined) {
      if (
        parsed.data.status === "generated" &&
        !access.report.latest_artifact_kind
      ) {
        return NextResponse.json(
          {
            error:
              "Generate an artifact before marking this report as generated",
          },
          { status: 400 }
        );
      }
      reportUpdate.status = parsed.data.status;
    }

    if (Object.keys(reportUpdate).length > 0) {
      const { error: updateError } = await access.supabase.from("reports").update(reportUpdate).eq("id", access.report.id);

      if (updateError) {
        audit.error("report_update_failed", {
          reportId: access.report.id,
          message: updateError.message,
          code: updateError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to update report" }, { status: 500 });
      }
    }

    if (parsed.data.runIds) {
      const { error: deleteRunsError } = await access.supabase.from("report_runs").delete().eq("report_id", access.report.id);

      if (deleteRunsError) {
        audit.error("report_runs_delete_failed", {
          reportId: access.report.id,
          message: deleteRunsError.message,
          code: deleteRunsError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to replace linked runs" }, { status: 500 });
      }

      if (parsed.data.runIds.length > 0) {
        const { error: insertRunsError } = await access.supabase.from("report_runs").insert(
          parsed.data.runIds.map((runId, index) => ({
            report_id: access.report.id,
            run_id: runId,
            sort_order: index,
          }))
        );

        if (insertRunsError) {
          audit.error("report_runs_insert_failed", {
            reportId: access.report.id,
            message: insertRunsError.message,
            code: insertRunsError.code ?? null,
          });
          return NextResponse.json({ error: "Failed to replace linked runs" }, { status: 500 });
        }
      }
    }

    if (parsed.data.sections) {
      const { error: deleteSectionsError } = await access.supabase
        .from("report_sections")
        .delete()
        .eq("report_id", access.report.id);

      if (deleteSectionsError) {
        audit.error("report_sections_delete_failed", {
          reportId: access.report.id,
          message: deleteSectionsError.message,
          code: deleteSectionsError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to replace report sections" }, { status: 500 });
      }

      if (parsed.data.sections.length > 0) {
        const { error: insertSectionsError } = await access.supabase.from("report_sections").insert(
          parsed.data.sections.map((section) => ({
            report_id: access.report.id,
            section_key: section.sectionKey,
            title: section.title,
            enabled: section.enabled,
            sort_order: section.sortOrder,
            config_json: section.configJson ?? {},
          }))
        );

        if (insertSectionsError) {
          audit.error("report_sections_insert_failed", {
            reportId: access.report.id,
            message: insertSectionsError.message,
            code: insertSectionsError.code ?? null,
          });
          return NextResponse.json({ error: "Failed to replace report sections" }, { status: 500 });
        }
      }
    }

    audit.info("report_updated", {
      reportId: access.report.id,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true, reportId: access.report.id }, { status: 200 });
  } catch (error) {
    audit.error("reports_patch_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while updating report" }, { status: 500 });
  }
}
