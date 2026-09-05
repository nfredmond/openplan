import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadReportAccess as sharedLoadReportAccess } from "@/lib/reports/api";
import { REPORT_SUMMARY_MAX_LENGTH, REPORT_TITLE_MAX_LENGTH } from "@/lib/reports/text-limits";
import {
  loadReportDualDemandAgreements,
  readAgreementCorridorSelections,
  retainCitedAgreementCorridorSelections,
  validateAgreementCorridorSelections,
  writeAgreementCorridorSelections,
} from "@/lib/reports/dual-demand-agreement";
import {
  readReportAerialOrthoSelections,
  writeReportAerialOrthoSelections,
} from "@/lib/reports/aerial-ortho-evidence";
import { verifySelectedReportAerialOrtho } from "@/lib/reports/aerial-ortho-evidence-server";
import {
  readReportSafetyIngestSelections,
  writeReportSafetyIngestSelections,
} from "@/lib/reports/safety-evidence-selection";

const paramsSchema = z.object({
  reportId: z.string().uuid(),
});

const patchReportSchema = z
  .object({
    title: z.string().trim().min(1).max(REPORT_TITLE_MAX_LENGTH).optional(),
    summary: z.union([z.string().trim().max(REPORT_SUMMARY_MAX_LENGTH), z.null()]).optional(),
    status: z.enum(["draft", "generated", "archived"]).optional(),
    runIds: z.array(z.string().uuid()).max(20).optional(),
    // Typed evidence citations (report_runs.model_run_id / county_run_id);
    // each replaces only its own kind.
    modelRunIds: z.array(z.string().uuid()).max(20).optional(),
    agreementCorridorSelections: z
      .array(
        z.object({
          modelRunId: z.string().uuid(),
          corridor: z.string().trim().min(1).max(240),
        })
      )
      .max(200)
      .optional(),
    aerialOrthoSelections: z
      .array(z.object({ custodyId: z.string().uuid() }))
      .max(1)
      .optional(),
    safetyIngestSelections: z
      .array(z.object({ ingestId: z.string().uuid() }))
      .max(1)
      .optional(),
    countyRunIds: z.array(z.string().uuid()).max(20).optional(),
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

/**
 * Thin wrapper over the shared resolver in `@/lib/reports/api`, kept here so
 * this route's handlers still get the client they mutate through. The lookup
 * itself is shared with the artifact-download route — two routes authorizing
 * the same resource two different ways is how one of them ends up laxer.
 */
async function loadReportAccess(reportId: string, userId: string) {
  const supabase = await createClient();
  const access = await sharedLoadReportAccess(supabase, reportId, userId);
  return { supabase, ...access };
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

    // Widened for typed evidence; a database without the typed-evidence
    // migration answers with a missing-column error, so fall back to the
    // legacy select and treat every citation as a legacy Analysis Studio run.
    let reportRunsResult = await access.supabase
      .from("report_runs")
      .select("id, report_id, run_id, model_run_id, county_run_id, sort_order, created_at, updated_at")
      .eq("report_id", access.report.id)
      .order("sort_order", { ascending: true });

    if (reportRunsResult.error && looksLikePendingSchema(reportRunsResult.error.message)) {
      reportRunsResult = (await access.supabase
        .from("report_runs")
        .select("id, report_id, run_id, sort_order, created_at, updated_at")
        .eq("report_id", access.report.id)
        .order("sort_order", { ascending: true })) as unknown as typeof reportRunsResult;
    }

    const { data: reportRunLinks, error: reportRunsError } = reportRunsResult;

    if (reportRunsError) {
      audit.error("report_runs_lookup_failed", {
        reportId: access.report.id,
        message: reportRunsError.message,
        code: reportRunsError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load report runs" }, { status: 500 });
    }

    const runLinks = (reportRunLinks ?? []) as Array<{
      id: string;
      report_id: string;
      run_id: string | null;
      model_run_id?: string | null;
      county_run_id?: string | null;
      sort_order: number;
      created_at?: string | null;
      updated_at?: string | null;
    }>;
    const runIds = runLinks.map((item) => item.run_id).filter((value): value is string => Boolean(value));
    const citedModelRunIds = runLinks
      .map((item) => item.model_run_id ?? null)
      .filter((value): value is string => Boolean(value));
    const citedCountyRunIds = runLinks
      .map((item) => item.county_run_id ?? null)
      .filter((value): value is string => Boolean(value));
    const [runsResult, modelRunsResult, countyRunsResult] = await Promise.all([
      runIds.length
        ? access.supabase
            .from("runs")
            .select("id, workspace_id, title, query_text, summary_text, ai_interpretation, metrics, created_at")
            .in("id", runIds)
        : Promise.resolve({ data: [], error: null }),
      citedModelRunIds.length
        ? access.supabase.from("model_runs").select("id, run_title, engine_key, status").in("id", citedModelRunIds)
        : Promise.resolve({ data: [], error: null }),
      citedCountyRunIds.length
        ? access.supabase.from("county_runs").select("id, run_name, stage").in("id", citedCountyRunIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (runsResult.error || modelRunsResult.error || countyRunsResult.error) {
      const firstError = runsResult.error ?? modelRunsResult.error ?? countyRunsResult.error;
      audit.error("runs_lookup_failed", {
        reportId: access.report.id,
        message: firstError?.message ?? "unknown",
        code: firstError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked runs" }, { status: 500 });
    }

    const runMap = new Map((runsResult.data ?? []).map((run) => [run.id, run]));
    const modelRunMap = new Map(
      ((modelRunsResult.data ?? []) as Array<{ id: string; run_title: string; engine_key: string; status: string }>).map(
        (run) => [run.id, run]
      )
    );
    const countyRunMap = new Map(
      ((countyRunsResult.data ?? []) as Array<{ id: string; run_name: string | null; stage: string | null }>).map(
        (run) => [run.id, run]
      )
    );
    // Legacy rows keep their exact shape (plus the kind discriminator); typed
    // rows resolve to title/status so the UI can render all three kinds. A
    // model run's honest status and engine always travel with it.
    const runs = runLinks
      .map((link) => {
        if (link.run_id) {
          const run = runMap.get(link.run_id);
          if (!run) return null;
          return {
            ...run,
            report_run_id: link.id,
            sort_order: link.sort_order,
            kind: "analysis" as const,
          };
        }

        if (link.model_run_id) {
          const modelRun = modelRunMap.get(link.model_run_id);
          if (!modelRun) return null;
          return {
            kind: "model" as const,
            id: modelRun.id,
            title: modelRun.run_title,
            engine_key: modelRun.engine_key,
            status: modelRun.status,
            report_run_id: link.id,
            sort_order: link.sort_order,
          };
        }

        if (link.county_run_id) {
          const countyRun = countyRunMap.get(link.county_run_id);
          if (!countyRun) return null;
          return {
            kind: "county" as const,
            id: countyRun.id,
            title: countyRun.run_name ?? "County run",
            stage: countyRun.stage,
            status: countyRun.stage,
            report_run_id: link.id,
            sort_order: link.sort_order,
          };
        }

        return null;
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
        agreementCorridorSelections: readAgreementCorridorSelections(access.report.metadata_json),
        aerialOrthoSelections: readReportAerialOrthoSelections(access.report.metadata_json),
        safetyIngestSelections: readReportSafetyIngestSelections(access.report.metadata_json),
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

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.documentJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = payloadBody.data;
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

    if (parsed.data.modelRunIds && parsed.data.modelRunIds.length > 0) {
      if (!access.report.project_id) {
        return NextResponse.json({ error: "Model-run citations require a project report" }, { status: 400 });
      }
      const { data: modelRunRows, error: modelRunError } = await access.supabase
        .from("model_runs")
        .select("id")
        .eq("workspace_id", access.report.workspace_id)
        .eq("project_id", access.report.project_id)
        .in("id", parsed.data.modelRunIds);

      if (modelRunError) {
        audit.error("model_runs_lookup_failed", {
          reportId: access.report.id,
          message: modelRunError.message,
          code: modelRunError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify linked model runs" }, { status: 500 });
      }

      if ((modelRunRows ?? []).length !== new Set(parsed.data.modelRunIds).size) {
        return NextResponse.json({ error: "One or more linked model runs are invalid" }, { status: 400 });
      }
    }

    let finalModelRunIds = parsed.data.modelRunIds;
    if (parsed.data.agreementCorridorSelections && !finalModelRunIds) {
      const { data: existingLinks, error: existingLinksError } = await access.supabase
        .from("report_runs")
        .select("model_run_id")
        .eq("report_id", access.report.id)
        .not("model_run_id", "is", null);
      if (existingLinksError) {
        return NextResponse.json({ error: "Failed to verify cited model runs" }, { status: 500 });
      }
      finalModelRunIds = ((existingLinks ?? []) as Array<{ model_run_id: string | null }>)
        .map((row) => row.model_run_id)
        .filter((value): value is string => Boolean(value));
    }

    const savedAgreementSelections = readAgreementCorridorSelections(access.report.metadata_json);
    const submittedAgreementSelections = parsed.data.agreementCorridorSelections
      ? readAgreementCorridorSelections({ agreementCorridorSelections: parsed.data.agreementCorridorSelections })
      : undefined;
    const finalAgreementSelections = submittedAgreementSelections ??
      (parsed.data.modelRunIds
        ? retainCitedAgreementCorridorSelections(savedAgreementSelections, parsed.data.modelRunIds)
        : savedAgreementSelections);
    if (parsed.data.agreementCorridorSelections) {
      if (!access.report.project_id) {
        return NextResponse.json({ error: "Agreement corridors require a project report" }, { status: 400 });
      }
      const agreementStates = await loadReportDualDemandAgreements({
        supabase: access.supabase,
        modelRunIds: finalModelRunIds ?? [],
        workspaceId: access.report.workspace_id,
        projectId: access.report.project_id,
      });
      const selectionValidation = validateAgreementCorridorSelections({
        selections: finalAgreementSelections,
        citedModelRunIds: finalModelRunIds ?? [],
        agreementStates,
      });
      if (!selectionValidation.ok) {
        return NextResponse.json({ error: selectionValidation.reason }, { status: 400 });
      }
    }

    if (parsed.data.countyRunIds && parsed.data.countyRunIds.length > 0) {
      const { data: countyRunRows, error: countyRunError } = await access.supabase
        .from("county_runs")
        .select("id")
        .eq("workspace_id", access.report.workspace_id)
        .in("id", parsed.data.countyRunIds);

      if (countyRunError) {
        audit.error("county_runs_lookup_failed", {
          reportId: access.report.id,
          message: countyRunError.message,
          code: countyRunError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify linked county runs" }, { status: 500 });
      }

      if ((countyRunRows ?? []).length !== new Set(parsed.data.countyRunIds).size) {
        return NextResponse.json({ error: "One or more linked county runs are invalid" }, { status: 400 });
      }
    }

    const finalAerialOrthoSelections = parsed.data.aerialOrthoSelections
      ? readReportAerialOrthoSelections({ aerialOrthoSelections: parsed.data.aerialOrthoSelections })
      : readReportAerialOrthoSelections(access.report.metadata_json);
    if (parsed.data.aerialOrthoSelections && finalAerialOrthoSelections.length > 0) {
      if (!access.report.project_id) {
        return NextResponse.json({ error: "Aerial preview evidence requires a project report" }, { status: 400 });
      }
      const selection = await verifySelectedReportAerialOrtho({
        supabase: access.supabase,
        workspaceId: access.report.workspace_id,
        projectId: access.report.project_id,
        custodyId: finalAerialOrthoSelections[0].custodyId,
      });
      if (selection.status !== "verified") {
        return NextResponse.json(
          { error: `${selection.reason} No aerial preview selection was saved.` },
          { status: selection.status === "unreadable" ? 500 : 400 },
        );
      }
    }

    const finalSafetyIngestSelections = parsed.data.safetyIngestSelections
      ? readReportSafetyIngestSelections({ safetyIngestSelections: parsed.data.safetyIngestSelections })
      : readReportSafetyIngestSelections(access.report.metadata_json);
    if (parsed.data.safetyIngestSelections && finalSafetyIngestSelections.length > 0) {
      if (!access.report.project_id) {
        return NextResponse.json({ error: "Crash evidence requires a project report" }, { status: 400 });
      }
      const { data: ingestRows, error: ingestError } = await access.supabase
        .from("safety_crash_ingests")
        .select("id")
        .eq("workspace_id", access.report.workspace_id)
        .eq("project_id", access.report.project_id)
        .in("id", finalSafetyIngestSelections.map(({ ingestId }) => ingestId));
      if (ingestError) {
        return NextResponse.json({ error: "Failed to verify crash evidence" }, { status: 500 });
      }
      if ((ingestRows ?? []).length !== finalSafetyIngestSelections.length) {
        return NextResponse.json(
          { error: "The selected crash acquisition is not attached to this report's project" },
          { status: 400 },
        );
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
    let nextReportMetadata: unknown = access.report.metadata_json;
    if (parsed.data.agreementCorridorSelections || parsed.data.modelRunIds) {
      nextReportMetadata = writeAgreementCorridorSelections(
        nextReportMetadata,
        finalAgreementSelections,
      );
    }
    if (parsed.data.aerialOrthoSelections) {
      nextReportMetadata = writeReportAerialOrthoSelections(nextReportMetadata, finalAerialOrthoSelections);
    }
    if (parsed.data.safetyIngestSelections) {
      nextReportMetadata = writeReportSafetyIngestSelections(nextReportMetadata, finalSafetyIngestSelections);
    }
    if (nextReportMetadata !== access.report.metadata_json) reportUpdate.metadata_json = nextReportMetadata;

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
      // Replace legacy rows only. Scoping the delete to run_id IS NOT NULL is
      // observably identical on a pre-migration database (every row has a
      // run_id there) while leaving typed model/county citations untouched.
      const { error: deleteRunsError } = await access.supabase
        .from("report_runs")
        .delete()
        .eq("report_id", access.report.id)
        .not("run_id", "is", null);

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

    // Typed replacements touch only their own kind. Sort order is per kind —
    // every reader groups citations by kind before ordering.
    const typedReplacements = [
      { column: "model_run_id" as const, ids: parsed.data.modelRunIds, label: "model" },
      { column: "county_run_id" as const, ids: parsed.data.countyRunIds, label: "county" },
    ];

    for (const replacement of typedReplacements) {
      if (!replacement.ids) continue;

      const { error: deleteTypedError } = await access.supabase
        .from("report_runs")
        .delete()
        .eq("report_id", access.report.id)
        .not(replacement.column, "is", null);

      if (deleteTypedError) {
        if (looksLikePendingSchema(deleteTypedError.message)) {
          return NextResponse.json(
            {
              error:
                "Typed run evidence requires the report_runs typed-evidence migration. Apply the latest database migration first.",
            },
            { status: 503 }
          );
        }

        audit.error("report_typed_runs_delete_failed", {
          reportId: access.report.id,
          kind: replacement.label,
          message: deleteTypedError.message,
          code: deleteTypedError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to replace linked run evidence" }, { status: 500 });
      }

      if (replacement.ids.length > 0) {
        const { error: insertTypedError } = await access.supabase.from("report_runs").insert(
          replacement.ids.map((citedRunId, index) => ({
            report_id: access.report.id,
            [replacement.column]: citedRunId,
            sort_order: index,
          }))
        );

        if (insertTypedError) {
          if (looksLikePendingSchema(insertTypedError.message)) {
            return NextResponse.json(
              {
                error:
                  "Typed run evidence requires the report_runs typed-evidence migration. Apply the latest database migration first.",
              },
              { status: 503 }
            );
          }

          audit.error("report_typed_runs_insert_failed", {
            reportId: access.report.id,
            kind: replacement.label,
            message: insertTypedError.message,
            code: insertTypedError.code ?? null,
          });
          return NextResponse.json({ error: "Failed to replace linked run evidence" }, { status: 500 });
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

    return NextResponse.json(
      {
        success: true,
        reportId: access.report.id,
        agreementCorridorSelections: finalAgreementSelections,
        aerialOrthoSelections: finalAerialOrthoSelections,
        safetyIngestSelections: finalSafetyIngestSelections,
      },
      { status: 200 },
    );
  } catch (error) {
    audit.error("reports_patch_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while updating report" }, { status: 500 });
  }
}
