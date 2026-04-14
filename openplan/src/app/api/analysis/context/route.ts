import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";

const workspaceIdSchema = z.string().uuid();

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

function looksLikeOptionalSummaryFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Unexpected table|does not exist|schema cache|could not find the table/i.test(error.message);
}

async function loadWorkspaceOperationsSummarySafe(
  supabase: WorkspaceOperationsSupabaseLike,
  workspaceId: string,
  audit: ReturnType<typeof createApiAuditLogger>
) {
  try {
    return await loadWorkspaceOperationsSummaryForWorkspace(supabase, workspaceId);
  } catch (error) {
    if (!looksLikeOptionalSummaryFailure(error)) {
      throw error;
    }

    audit.warn("operations_summary_optional_unavailable", {
      workspaceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

type ProjectRow = {
  id: string;
  name: string;
  summary: string | null;
  status: string;
  plan_type: string;
  delivery_phase: string;
  updated_at: string;
};

type ProjectLinkRow = {
  dataset_id: string;
  relationship_type: string;
  linked_at: string;
};

type DatasetRow = {
  id: string;
  connector_id: string | null;
  name: string;
  status: string;
  geography_scope: string;
  geometry_attachment: string;
  thematic_metric_key: string | null;
  thematic_metric_label: string | null;
  vintage_label: string | null;
  last_refreshed_at: string | null;
};

type ConnectorRow = {
  id: string;
  display_name: string;
};

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("analysis.context.get", request);
  const startedAt = Date.now();

  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    const parsed = workspaceIdSchema.safeParse(workspaceId);

    if (!parsed.success) {
      audit.warn("validation_failed", { workspaceId });
      return NextResponse.json({ error: "Invalid workspaceId" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", {
        workspaceId: parsed.data,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", parsed.data)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        workspaceId: parsed.data,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to verify workspace access",
          details: membershipError.message,
        },
        { status: 500 }
      );
    }

    if (!membership) {
      audit.warn("forbidden_workspace", {
        workspaceId: parsed.data,
        userId: user.id,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (!canAccessWorkspaceAction("analysis.context.read", membership.role)) {
      audit.warn("forbidden_role", {
        workspaceId: parsed.data,
        userId: user.id,
        role: membership.role ?? null,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const [projectResult, operationsSummary] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, summary, status, plan_type, delivery_phase, updated_at")
        .eq("workspace_id", parsed.data)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadWorkspaceOperationsSummarySafe(
        supabase as unknown as WorkspaceOperationsSupabaseLike,
        parsed.data,
        audit
      ),
    ]);

    const { data: projectData, error: projectError } = projectResult;

    if (projectError) {
      audit.error("project_lookup_failed", {
        workspaceId: parsed.data,
        userId: user.id,
        message: projectError.message,
        code: projectError.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to load analysis context",
          details: projectError.message,
        },
        { status: 500 }
      );
    }

    const { data: recentRuns, error: runsError } = await supabase
      .from("runs")
      .select("id, title, created_at")
      .eq("workspace_id", parsed.data)
      .order("created_at", { ascending: false })
      .limit(5);


    if (runsError) {
      audit.error("recent_runs_lookup_failed", {
        workspaceId: parsed.data,
        userId: user.id,
        message: runsError.message,
        code: runsError.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to load analysis context",
          details: runsError.message,
        },
        { status: 500 }
      );
    }

    if (!projectData) {
      audit.info("analysis_context_loaded", {
        workspaceId: parsed.data,
        userId: user.id,
        hasProject: false,
        recentRunCount: recentRuns?.length ?? 0,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          workspaceId: parsed.data,
          project: null,
          linkedDatasets: [],
          migrationPending: false,
          counts: {
            deliverables: 0,
            risks: 0,
            issues: 0,
            decisions: 0,
            meetings: 0,
            linkedDatasets: 0,
            overlayReadyDatasets: 0,
            recentRuns: recentRuns?.length ?? 0,
          },
          recentRuns: recentRuns ?? [],
          operationsSummary,
        },
        { status: 200 }
      );
    }

    const project = projectData as ProjectRow;

    const [deliverablesResult, risksResult, issuesResult, decisionsResult, meetingsResult, datasetLinksResult] =
      await Promise.all([
        supabase.from("project_deliverables").select("id").eq("project_id", project.id),
        supabase.from("project_risks").select("id").eq("project_id", project.id),
        supabase.from("project_issues").select("id").eq("project_id", project.id),
        supabase.from("project_decisions").select("id").eq("project_id", project.id),
        supabase.from("project_meetings").select("id").eq("project_id", project.id),
        supabase
          .from("data_dataset_project_links")
          .select("dataset_id, relationship_type, linked_at")
          .eq("project_id", project.id)
          .order("linked_at", { ascending: false }),
      ]);

    const countErrors = [deliverablesResult, risksResult, issuesResult, decisionsResult, meetingsResult]
      .map((result) => result.error)
      .filter(Boolean);

    if (countErrors.length > 0) {
      const firstError = countErrors[0];
      audit.error("project_counts_lookup_failed", {
        workspaceId: parsed.data,
        projectId: project.id,
        userId: user.id,
        message: firstError?.message ?? "unknown",
        code: firstError?.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to load project context",
          details: firstError?.message ?? "Unknown project counts failure",
        },
        { status: 500 }
      );
    }

    const migrationPending = looksLikePendingSchema(datasetLinksResult.error?.message);

    if (datasetLinksResult.error && !migrationPending) {
      audit.error("dataset_links_lookup_failed", {
        workspaceId: parsed.data,
        projectId: project.id,
        userId: user.id,
        message: datasetLinksResult.error.message,
        code: datasetLinksResult.error.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to load linked datasets",
          details: datasetLinksResult.error.message,
        },
        { status: 500 }
      );
    }

    const datasetLinkRows = migrationPending
      ? []
      : ((datasetLinksResult.data ?? []) as ProjectLinkRow[]);

    const linkedDatasetIds = datasetLinkRows.map((item) => item.dataset_id);

    const datasetsResult = linkedDatasetIds.length
      ? await supabase
          .from("data_datasets")
          .select("id, connector_id, name, status, geography_scope, geometry_attachment, thematic_metric_key, thematic_metric_label, vintage_label, last_refreshed_at")
          .in("id", linkedDatasetIds)
      : { data: [], error: null };

    const datasetsPending = looksLikePendingSchema(datasetsResult.error?.message);
    const dataHubPending = migrationPending || datasetsPending;

    if (datasetsResult.error && !datasetsPending) {
      audit.error("datasets_lookup_failed", {
        workspaceId: parsed.data,
        projectId: project.id,
        userId: user.id,
        message: datasetsResult.error.message,
        code: datasetsResult.error.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to load linked datasets",
          details: datasetsResult.error.message,
        },
        { status: 500 }
      );
    }

    const datasetRows = dataHubPending ? [] : ((datasetsResult.data ?? []) as DatasetRow[]);

    const connectorIds = datasetRows
      .map((dataset) => dataset.connector_id)
      .filter((value): value is string => Boolean(value));

    const connectorsResult = connectorIds.length
      ? await supabase.from("data_connectors").select("id, display_name").in("id", connectorIds)
      : { data: [], error: null };

    const connectorsPending = looksLikePendingSchema(connectorsResult.error?.message);
    const finalMigrationPending = dataHubPending || connectorsPending;

    if (connectorsResult.error && !connectorsPending) {
      audit.error("connectors_lookup_failed", {
        workspaceId: parsed.data,
        projectId: project.id,
        userId: user.id,
        message: connectorsResult.error.message,
        code: connectorsResult.error.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to load linked datasets",
          details: connectorsResult.error.message,
        },
        { status: 500 }
      );
    }

    const connectorMap = new Map(
      (finalMigrationPending ? [] : ((connectorsResult.data ?? []) as ConnectorRow[])).map((connector) => [
        connector.id,
        connector.display_name,
      ])
    );
    const datasetMap = new Map(datasetRows.map((dataset) => [dataset.id, dataset]));

    const linkedDatasets = finalMigrationPending
      ? []
      : datasetLinkRows
          .map((link) => {
            const dataset = datasetMap.get(link.dataset_id);
            if (!dataset) return null;

            const thematicReady =
              dataset.status === "ready" &&
              Boolean(dataset.thematic_metric_key) &&
              ((dataset.geography_scope === "tract" && dataset.geometry_attachment === "analysis_tracts") ||
                ((dataset.geography_scope === "corridor" || dataset.geography_scope === "route") &&
                  dataset.geometry_attachment === "analysis_corridor") ||
                (dataset.geography_scope === "point" && dataset.geometry_attachment === "analysis_crash_points"));

            return {
              datasetId: dataset.id,
              name: dataset.name,
              status: dataset.status,
              geographyScope: dataset.geography_scope,
              geometryAttachment: dataset.geometry_attachment,
              thematicMetricKey: dataset.thematic_metric_key,
              thematicMetricLabel: dataset.thematic_metric_label,
              relationshipType: link.relationship_type,
              vintageLabel: dataset.vintage_label,
              lastRefreshedAt: dataset.last_refreshed_at,
              connectorLabel: dataset.connector_id ? connectorMap.get(dataset.connector_id) ?? null : null,
              overlayReady:
                dataset.status === "ready" &&
                ["point", "route", "corridor", "tract", "county", "region", "statewide", "national"].includes(
                  dataset.geography_scope
                ),
              thematicReady,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const overlayReadyDatasets = linkedDatasets.filter((dataset) => dataset.overlayReady).length;

    audit.info("analysis_context_loaded", {
      workspaceId: parsed.data,
      userId: user.id,
      projectId: project.id,
      linkedDatasetCount: linkedDatasets.length,
      migrationPending: finalMigrationPending,
      recentRunCount: recentRuns?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        workspaceId: parsed.data,
        project: {
          id: project.id,
          name: project.name,
          summary: project.summary,
          status: project.status,
          planType: project.plan_type,
          deliveryPhase: project.delivery_phase,
          updatedAt: project.updated_at,
        },
        linkedDatasets,
        migrationPending: finalMigrationPending,
        counts: {
          deliverables: deliverablesResult.data?.length ?? 0,
          risks: risksResult.data?.length ?? 0,
          issues: issuesResult.data?.length ?? 0,
          decisions: decisionsResult.data?.length ?? 0,
          meetings: meetingsResult.data?.length ?? 0,
          linkedDatasets: linkedDatasets.length,
          overlayReadyDatasets,
          recentRuns: recentRuns?.length ?? 0,
        },
        recentRuns: recentRuns ?? [],
        operationsSummary,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("analysis_context_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json(
      { error: "Unexpected error while loading analysis context" },
      { status: 500 }
    );
  }
}
