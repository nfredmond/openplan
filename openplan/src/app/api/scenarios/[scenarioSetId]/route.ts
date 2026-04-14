import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { touchScenarioLinkedReportPackets } from "@/lib/reports/scenario-writeback";
import {
  SCENARIO_SET_STATUSES,
  buildScenarioLinkedReports,
  buildScenarioReportDraft,
  buildScenarioComparisonSummary,
  buildScenarioStudioHref,
  getScenarioComparisonReadiness,
} from "@/lib/scenarios/catalog";
import { loadScenarioSetAccess, looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";

const paramsSchema = z.object({
  scenarioSetId: z.string().uuid(),
});

const patchScenarioSetSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    summary: z.union([z.string().trim().max(2000), z.null()]).optional(),
    planningQuestion: z.union([z.string().trim().max(4000), z.null()]).optional(),
    status: z.enum(SCENARIO_SET_STATUSES).optional(),
    baselineEntryId: z.union([z.string().uuid(), z.null()]).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ scenarioSetId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("scenarios.detail", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid scenario set id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadScenarioSetAccess(supabase, parsedParams.data.scenarioSetId, user.id, "scenarios.read");

    if (access.error) {
      audit.error("scenario_set_access_failed", {
        scenarioSetId: parsedParams.data.scenarioSetId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load scenario set" }, { status: 500 });
    }

    if (!access.scenarioSet) {
      return NextResponse.json({ error: "Scenario set not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
      .eq("id", access.scenarioSet.project_id)
      .maybeSingle();

    if (projectError) {
      audit.error("scenario_set_project_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: projectError.message,
        code: projectError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked project" }, { status: 500 });
    }

    const { data: entries, error: entriesError } = await supabase
      .from("scenario_entries")
      .select(
        "id, scenario_set_id, entry_type, label, slug, summary, assumptions_json, attached_run_id, status, sort_order, created_at, updated_at"
      )
      .eq("scenario_set_id", access.scenarioSet.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (entriesError) {
      audit.error("scenario_entries_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: entriesError.message,
        code: entriesError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load scenario entries" }, { status: 500 });
    }

    const runIds = (entries ?? [])
      .map((entry) => entry.attached_run_id)
      .filter((value): value is string => Boolean(value));

    const runsResult = runIds.length
      ? await supabase
          .from("runs")
          .select("id, workspace_id, title, summary_text, created_at")
          .in("id", runIds)
      : { data: [], error: null };

    if (runsResult.error) {
      audit.error("scenario_runs_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: runsResult.error.message,
        code: runsResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load attached runs" }, { status: 500 });
    }

    const runMap = new Map((runsResult.data ?? []).map((run) => [run.id, run]));
    const hydratedEntries = (entries ?? []).map((entry) => ({
      ...entry,
      attached_run: entry.attached_run_id ? runMap.get(entry.attached_run_id) ?? null : null,
    }));
    const baselineEntry =
      hydratedEntries.find((entry) => entry.id === access.scenarioSet?.baseline_entry_id) ??
      hydratedEntries.find((entry) => entry.entry_type === "baseline") ??
      null;
    const alternativeEntries = hydratedEntries.filter((entry) => entry.entry_type !== "baseline");
    const comparisonSummary = buildScenarioComparisonSummary({
      baselineEntryId: baselineEntry?.id,
      baselineRunId: baselineEntry?.attached_run_id ?? null,
      candidateRunIds: alternativeEntries.map((entry) => entry.attached_run_id),
    });
    const reportQuery = await supabase
      .from("reports")
      .select("id, title, status, report_type, generated_at, updated_at")
      .eq("project_id", access.scenarioSet.project_id)
      .order("updated_at", { ascending: false });

    if (reportQuery.error) {
      audit.error("scenario_reports_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: reportQuery.error.message,
        code: reportQuery.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked reports" }, { status: 500 });
    }

    const reportIds = (reportQuery.data ?? []).map((report) => report.id);
    const reportRunsQuery = reportIds.length
      ? await supabase.from("report_runs").select("report_id, run_id").in("report_id", reportIds)
      : { data: [], error: null };

    if (reportRunsQuery.error) {
      audit.error("scenario_report_runs_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: reportRunsQuery.error.message,
        code: reportRunsQuery.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load report run links" }, { status: 500 });
    }

    const reportLinkage = buildScenarioLinkedReports({
      reports: reportQuery.data ?? [],
      reportRuns: reportRunsQuery.data ?? [],
      entries: hydratedEntries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        attached_run_id: entry.attached_run_id,
      })),
      baselineEntryId: baselineEntry?.id ?? null,
    });

    const [assumptionSetsResult, dataPackagesResult, indicatorSnapshotsResult, comparisonSnapshotsResult] = await Promise.all([
      supabase
        .from("scenario_assumption_sets")
        .select("id, scenario_entry_id, label, status, updated_at")
        .eq("scenario_set_id", access.scenarioSet.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("scenario_data_packages")
        .select("id, scenario_entry_id, label, package_type, status, updated_at")
        .eq("scenario_set_id", access.scenarioSet.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("scenario_indicator_snapshots")
        .select("id, scenario_entry_id, indicator_key, indicator_label, snapshot_at")
        .eq("scenario_set_id", access.scenarioSet.id)
        .order("snapshot_at", { ascending: false }),
      supabase
        .from("scenario_comparison_snapshots")
        .select("id, baseline_entry_id, candidate_entry_id, label, status, updated_at")
        .eq("scenario_set_id", access.scenarioSet.id)
        .order("updated_at", { ascending: false }),
    ]);

    const pendingScenarioSpineError = [
      assumptionSetsResult.error,
      dataPackagesResult.error,
      indicatorSnapshotsResult.error,
      comparisonSnapshotsResult.error,
    ].find((error) => looksLikePendingScenarioSpineSchema(error?.message));

    if (
      !pendingScenarioSpineError &&
      (assumptionSetsResult.error ||
        dataPackagesResult.error ||
        indicatorSnapshotsResult.error ||
        comparisonSnapshotsResult.error)
    ) {
      const scenarioSpineError =
        assumptionSetsResult.error ??
        dataPackagesResult.error ??
        indicatorSnapshotsResult.error ??
        comparisonSnapshotsResult.error;
      audit.error("scenario_spine_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: scenarioSpineError?.message ?? "unknown",
        code: scenarioSpineError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load scenario spine summary" }, { status: 500 });
    }

    return NextResponse.json(
      {
        scenarioSet: access.scenarioSet,
        project,
        entries: hydratedEntries.map((entry) => ({
          ...entry,
          evidence: {
            assumptionCount: Object.keys((entry.assumptions_json as Record<string, unknown>) ?? {}).length,
            hasAttachedRun: Boolean(entry.attached_run_id),
            attachedRunTitle: entry.attached_run?.title ?? null,
          },
          actions: {
            analysisHref: buildScenarioStudioHref({
              runId: entry.attached_run_id,
              baselineRunId:
                entry.entry_type === "alternative" ? baselineEntry?.attached_run_id ?? null : undefined,
              scenarioSetId: access.scenarioSet.id,
              entryId: entry.id,
            }),
            reportSummary: reportLinkage.entryReportSummary.get(entry.id) ?? {
              totalLinkedReports: 0,
              generatedLinkedReports: 0,
              latestReportId: null,
            },
          },
        })),
        baselineEntry,
        alternativeEntries,
        comparisons: alternativeEntries.map((entry) => {
          const readiness = getScenarioComparisonReadiness({
            baselineEntryId: baselineEntry?.id,
            baselineRunId: baselineEntry?.attached_run_id ?? null,
            candidateRunId: entry.attached_run_id,
          });

          return {
            scenarioEntryId: entry.id,
            scenarioEntryLabel: entry.label,
            baselineEntryId: baselineEntry?.id ?? null,
            comparisonStatus: readiness.status,
            comparisonLabel: readiness.label,
            comparisonReason: readiness.reason,
            ready: readiness.ready,
            evidenceReady: readiness.evidenceReady,
            sameRunAttached: readiness.sameRunAttached,
            baselineRunId: baselineEntry?.attached_run_id ?? null,
            candidateRunId: entry.attached_run_id ?? null,
            analysisHref: buildScenarioStudioHref({
              runId: entry.attached_run_id,
              baselineRunId: baselineEntry?.attached_run_id ?? null,
              scenarioSetId: access.scenarioSet.id,
              entryId: entry.id,
            }),
            reportDraft:
              baselineEntry && entry.attached_run_id
                ? buildScenarioReportDraft({
                    scenarioSetTitle: access.scenarioSet.title ?? "Scenario set",
                    planningQuestion: access.scenarioSet.planning_question ?? null,
                    baselineLabel: baselineEntry.label,
                    candidateLabel: entry.label,
                  })
                : null,
          };
        }),
        comparisonSummary,
        linkedReports: reportLinkage.linkedReports,
        sharedSpine: {
          schemaPending: Boolean(pendingScenarioSpineError),
          counts: {
            assumptionSets: pendingScenarioSpineError ? 0 : (assumptionSetsResult.data?.length ?? 0),
            dataPackages: pendingScenarioSpineError ? 0 : (dataPackagesResult.data?.length ?? 0),
            indicatorSnapshots: pendingScenarioSpineError ? 0 : (indicatorSnapshotsResult.data?.length ?? 0),
            comparisonSnapshots: pendingScenarioSpineError ? 0 : (comparisonSnapshotsResult.data?.length ?? 0),
          },
          recentAssumptionSets: pendingScenarioSpineError ? [] : (assumptionSetsResult.data ?? []).slice(0, 5),
          recentDataPackages: pendingScenarioSpineError ? [] : (dataPackagesResult.data ?? []).slice(0, 5),
          recentIndicatorSnapshots: pendingScenarioSpineError
            ? []
            : (indicatorSnapshotsResult.data ?? []).slice(0, 5),
          recentComparisonSnapshots: pendingScenarioSpineError
            ? []
            : (comparisonSnapshotsResult.data ?? []).slice(0, 5),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("scenarios_detail_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading scenario set" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("scenarios.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid scenario set id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = patchScenarioSetSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid scenario set update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadScenarioSetAccess(supabase, parsedParams.data.scenarioSetId, user.id, "scenarios.write");

    if (access.error) {
      audit.error("scenario_set_access_failed", {
        scenarioSetId: parsedParams.data.scenarioSetId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify scenario set access" }, { status: 500 });
    }

    if (!access.scenarioSet) {
      return NextResponse.json({ error: "Scenario set not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (parsed.data.baselineEntryId) {
      const { data: baselineEntry, error: baselineError } = await supabase
        .from("scenario_entries")
        .select("id, scenario_set_id, entry_type")
        .eq("id", parsed.data.baselineEntryId)
        .eq("scenario_set_id", access.scenarioSet.id)
        .maybeSingle();

      if (baselineError) {
        audit.error("baseline_entry_lookup_failed", {
          scenarioSetId: access.scenarioSet.id,
          entryId: parsed.data.baselineEntryId,
          message: baselineError.message,
          code: baselineError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify baseline entry" }, { status: 500 });
      }

      if (!baselineEntry || baselineEntry.entry_type !== "baseline") {
        return NextResponse.json({ error: "Baseline entry must be a baseline in this scenario set" }, { status: 400 });
      }
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) {
      updates.title = parsed.data.title;
    }
    if (parsed.data.summary !== undefined) {
      updates.summary = parsed.data.summary;
    }
    if (parsed.data.planningQuestion !== undefined) {
      updates.planning_question = parsed.data.planningQuestion;
    }
    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status;
    }
    if (parsed.data.baselineEntryId !== undefined) {
      updates.baseline_entry_id = parsed.data.baselineEntryId;
    }

    const { error: updateError } = await supabase.from("scenario_sets").update(updates).eq("id", access.scenarioSet.id);

    if (updateError) {
      audit.error("scenario_set_update_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: updateError.message,
        code: updateError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update scenario set" }, { status: 500 });
    }

    const packetWriteback = await touchScenarioLinkedReportPackets({
      supabase,
      scenarioSetId: access.scenarioSet.id,
      workspaceId: access.scenarioSet.workspace_id,
    });

    if (packetWriteback.error) {
      audit.warn("scenario_set_report_packet_writeback_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: packetWriteback.error.message,
        code: packetWriteback.error.code ?? null,
      });
    }

    audit.info("scenario_set_updated", {
      userId: user.id,
      scenarioSetId: access.scenarioSet.id,
      packetWritebackReportCount: packetWriteback.touchedReportIds.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true, scenarioSetId: access.scenarioSet.id }, { status: 200 });
  } catch (error) {
    audit.error("scenarios_patch_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while updating scenario set" }, { status: 500 });
  }
}
