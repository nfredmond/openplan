import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

const DUPLICATE_KEY_CODE = "23505";

const createRecordSchema = z.discriminatedUnion("recordType", [
  z.object({
    recordType: z.literal("connector"),
    workspaceId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(120),
    key: z.string().trim().max(80).optional(),
    sourceType: z
      .enum(["census", "lodes", "gtfs", "crashes", "parcel", "manual", "custom", "policy"])
      .optional(),
    category: z.enum(["federal", "state", "regional", "local", "vendor", "internal"]).optional(),
    status: z.enum(["draft", "active", "degraded", "offline"]).optional(),
    cadence: z.enum(["manual", "daily", "weekly", "monthly", "quarterly", "annual", "ad_hoc"]).optional(),
    authMode: z.enum(["none", "api_key", "oauth", "service_account", "manual_upload"]).optional(),
    endpointUrl: z.string().trim().max(500).optional(),
    ownerLabel: z.string().trim().max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    policyMonitorEnabled: z.boolean().optional(),
    lastSuccessAt: z.string().trim().max(40).optional(),
    lastErrorAt: z.string().trim().max(40).optional(),
    lastErrorMessage: z.string().trim().max(2000).optional(),
  }),
  z.object({
    recordType: z.literal("dataset"),
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    connectorId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    relationshipType: z.enum(["primary_input", "reference", "evidence", "baseline"]).optional(),
    status: z.enum(["draft", "ready", "refreshing", "stale", "error", "archived"]).optional(),
    geographyScope: z
      .enum(["none", "point", "route", "corridor", "tract", "county", "region", "statewide", "national"])
      .optional(),
    geometryAttachment: z.enum(["none", "analysis_tracts", "analysis_corridor"]).optional(),
    thematicMetricKey: z
      .enum([
        "pctMinority",
        "pctBelowPoverty",
        "medianIncome",
        "isDisadvantaged",
        "zeroVehiclePct",
        "transitCommutePct",
        "overallScore",
        "accessibilityScore",
        "safetyScore",
        "equityScore",
      ])
      .optional(),
    thematicMetricLabel: z.string().trim().max(120).optional(),
    coverageSummary: z.string().trim().max(500).optional(),
    vintageLabel: z.string().trim().max(120).optional(),
    sourceUrl: z.string().trim().max(500).optional(),
    licenseLabel: z.string().trim().max(160).optional(),
    citationText: z.string().trim().max(2000).optional(),
    schemaVersion: z.string().trim().max(80).optional(),
    checksum: z.string().trim().max(160).optional(),
    rowCount: z.number().int().nonnegative().optional(),
    refreshCadence: z.enum(["manual", "daily", "weekly", "monthly", "quarterly", "annual", "ad_hoc"]).optional(),
    lastRefreshedAt: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(3000).optional(),
  }),
  z.object({
    recordType: z.literal("refreshJob"),
    workspaceId: z.string().uuid(),
    jobName: z.string().trim().min(1).max(160),
    connectorId: z.string().uuid().optional(),
    datasetId: z.string().uuid().optional(),
    jobType: z.enum(["ingest", "refresh", "validation", "backfill"]).optional(),
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).optional(),
    refreshMode: z.enum(["manual", "scheduled", "pipeline", "analysis_runtime"]).optional(),
    startedAt: z.string().trim().max(40).optional(),
    completedAt: z.string().trim().max(40).optional(),
    recordsWritten: z.number().int().nonnegative().optional(),
    triggeredByLabel: z.string().trim().max(120).optional(),
    errorSummary: z.string().trim().max(2000).optional(),
  }),
]);

function normalizeKey(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return normalized || "connector";
}

function looksLikePendingSchema(message: string | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

function schemaPendingResponse(details: string) {
  return NextResponse.json(
    {
      error: "Data Hub schema is not available yet",
      details,
      hint: "Apply the latest Supabase migrations for the Data Hub module before writing records.",
    },
    { status: 503 }
  );
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("data_hub.records.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
    const parsed = createRecordSchema.safeParse(payload);

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

    const { data: memberships, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .eq("workspace_id", parsed.data.workspaceId)
      .limit(1);

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        message: membershipError.message,
        code: membershipError.code ?? null,
      });

      if (looksLikePendingSchema(membershipError.message)) {
        return schemaPendingResponse(membershipError.message);
      }

      return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
    }

    if (!memberships || memberships.length === 0) {
      audit.warn("workspace_access_denied", {
        userId: user.id,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (parsed.data.recordType === "connector") {
      const connectorKey = normalizeKey(parsed.data.key?.trim() || parsed.data.displayName);

      const { data, error } = await supabase
        .from("data_connectors")
        .insert({
          workspace_id: parsed.data.workspaceId,
          key: connectorKey,
          display_name: parsed.data.displayName,
          source_type: parsed.data.sourceType ?? "custom",
          category: parsed.data.category ?? "internal",
          status: parsed.data.status ?? "active",
          cadence: parsed.data.cadence ?? "manual",
          auth_mode: parsed.data.authMode ?? "none",
          endpoint_url: parsed.data.endpointUrl?.trim() || null,
          owner_label: parsed.data.ownerLabel?.trim() || null,
          description: parsed.data.description?.trim() || null,
          policy_monitor_enabled: parsed.data.policyMonitorEnabled ?? false,
          last_success_at: parsed.data.lastSuccessAt?.trim() || null,
          last_error_at: parsed.data.lastErrorAt?.trim() || null,
          last_error_message: parsed.data.lastErrorMessage?.trim() || null,
          last_sync_at: parsed.data.lastSuccessAt?.trim() || parsed.data.lastErrorAt?.trim() || null,
          created_by: user.id,
        })
        .select(
          "id, workspace_id, key, display_name, source_type, category, status, cadence, auth_mode, endpoint_url, owner_label, description, policy_monitor_enabled, last_sync_at, last_success_at, last_error_at, last_error_message, created_at, updated_at"
        )
        .single();

      if (error) {
        audit.error("connector_insert_failed", {
          message: error.message,
          code: error.code ?? null,
          workspaceId: parsed.data.workspaceId,
          connectorKey,
        });

        if (looksLikePendingSchema(error.message)) {
          return schemaPendingResponse(error.message);
        }

        if (error.code === DUPLICATE_KEY_CODE) {
          return NextResponse.json(
            { error: "A connector with that key already exists in this workspace" },
            { status: 409 }
          );
        }

        return NextResponse.json({ error: "Failed to create connector", details: error.message }, { status: 500 });
      }

      audit.info("connector_created", {
        workspaceId: parsed.data.workspaceId,
        connectorId: data?.id ?? null,
        userId: user.id,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ recordType: "connector", record: data }, { status: 201 });
    }

    if (parsed.data.recordType === "dataset") {
      if (parsed.data.geometryAttachment === "analysis_tracts" && parsed.data.geographyScope !== "tract") {
        return NextResponse.json(
          { error: "Tract geometry attachments require geography scope = tract" },
          { status: 400 }
        );
      }

      if (
        parsed.data.geometryAttachment === "analysis_corridor" &&
        parsed.data.geographyScope !== "corridor" &&
        parsed.data.geographyScope !== "route"
      ) {
        return NextResponse.json(
          { error: "Corridor geometry attachments require geography scope = corridor or route" },
          { status: 400 }
        );
      }

      if (
        (parsed.data.geometryAttachment === "analysis_tracts" || parsed.data.geometryAttachment === "analysis_corridor") &&
        !parsed.data.thematicMetricKey
      ) {
        return NextResponse.json(
          { error: "Geometry attachments require a thematic metric key" },
          { status: 400 }
        );
      }

      if (parsed.data.connectorId) {
        const { data: connectors, error: connectorError } = await supabase
          .from("data_connectors")
          .select("id")
          .eq("id", parsed.data.connectorId)
          .eq("workspace_id", parsed.data.workspaceId)
          .limit(1);

        if (connectorError) {
          audit.error("dataset_connector_lookup_failed", {
            message: connectorError.message,
            code: connectorError.code ?? null,
            connectorId: parsed.data.connectorId,
          });

          if (looksLikePendingSchema(connectorError.message)) {
            return schemaPendingResponse(connectorError.message);
          }

          return NextResponse.json({ error: "Failed to verify connector" }, { status: 500 });
        }

        if (!connectors || connectors.length === 0) {
          return NextResponse.json({ error: "Connector not found" }, { status: 404 });
        }
      }

      if (parsed.data.projectId) {
        const { data: projects, error: projectError } = await supabase
          .from("projects")
          .select("id")
          .eq("id", parsed.data.projectId)
          .eq("workspace_id", parsed.data.workspaceId)
          .limit(1);

        if (projectError) {
          audit.error("dataset_project_lookup_failed", {
            message: projectError.message,
            code: projectError.code ?? null,
            projectId: parsed.data.projectId,
          });

          return NextResponse.json({ error: "Failed to verify linked project" }, { status: 500 });
        }

        if (!projects || projects.length === 0) {
          return NextResponse.json({ error: "Linked project not found" }, { status: 404 });
        }
      }

      const { data: dataset, error: datasetError } = await supabase
        .from("data_datasets")
        .insert({
          workspace_id: parsed.data.workspaceId,
          connector_id: parsed.data.connectorId ?? null,
          name: parsed.data.name,
          status: parsed.data.status ?? "draft",
          geography_scope: parsed.data.geographyScope ?? "none",
          geometry_attachment: parsed.data.geometryAttachment ?? "none",
          thematic_metric_key: parsed.data.thematicMetricKey ?? null,
          thematic_metric_label: parsed.data.thematicMetricLabel?.trim() || null,
          coverage_summary: parsed.data.coverageSummary?.trim() || null,
          vintage_label: parsed.data.vintageLabel?.trim() || null,
          source_url: parsed.data.sourceUrl?.trim() || null,
          license_label: parsed.data.licenseLabel?.trim() || null,
          citation_text: parsed.data.citationText?.trim() || null,
          schema_version: parsed.data.schemaVersion?.trim() || null,
          checksum: parsed.data.checksum?.trim() || null,
          row_count: parsed.data.rowCount ?? null,
          refresh_cadence: parsed.data.refreshCadence ?? "manual",
          last_refreshed_at: parsed.data.lastRefreshedAt?.trim() || null,
          notes: parsed.data.notes?.trim() || null,
          created_by: user.id,
        })
        .select(
          "id, workspace_id, connector_id, name, status, geography_scope, geometry_attachment, thematic_metric_key, thematic_metric_label, coverage_summary, vintage_label, source_url, license_label, citation_text, schema_version, checksum, row_count, refresh_cadence, last_refreshed_at, notes, created_at, updated_at"
        )
        .single();

      if (datasetError || !dataset) {
        audit.error("dataset_insert_failed", {
          message: datasetError?.message ?? "unknown",
          code: datasetError?.code ?? null,
          workspaceId: parsed.data.workspaceId,
        });

        if (looksLikePendingSchema(datasetError?.message)) {
          return schemaPendingResponse(datasetError?.message ?? "Schema is missing.");
        }

        return NextResponse.json(
          { error: "Failed to create dataset", details: datasetError?.message ?? "Unknown error" },
          { status: 500 }
        );
      }

      if (parsed.data.projectId) {
        const { error: linkError } = await supabase.from("data_dataset_project_links").insert({
          dataset_id: dataset.id,
          project_id: parsed.data.projectId,
          relationship_type: parsed.data.relationshipType ?? "reference",
          linked_by: user.id,
        });

        if (linkError) {
          audit.error("dataset_project_link_insert_failed", {
            message: linkError.message,
            code: linkError.code ?? null,
            datasetId: dataset.id,
            projectId: parsed.data.projectId,
          });

          if (looksLikePendingSchema(linkError.message)) {
            return schemaPendingResponse(linkError.message);
          }

          return NextResponse.json(
            { error: "Dataset created but linking failed", details: linkError.message, datasetId: dataset.id },
            { status: 500 }
          );
        }
      }

      audit.info("dataset_created", {
        workspaceId: parsed.data.workspaceId,
        datasetId: dataset.id,
        connectorId: parsed.data.connectorId ?? null,
        projectId: parsed.data.projectId ?? null,
        userId: user.id,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          recordType: "dataset",
          record: dataset,
          projectLink: parsed.data.projectId
            ? {
                projectId: parsed.data.projectId,
                relationshipType: parsed.data.relationshipType ?? "reference",
              }
            : null,
        },
        { status: 201 }
      );
    }

    if (!parsed.data.connectorId && !parsed.data.datasetId) {
      return NextResponse.json(
        { error: "Refresh jobs must reference a connector, a dataset, or both" },
        { status: 400 }
      );
    }

    if (parsed.data.connectorId) {
      const { data: connectors, error: connectorError } = await supabase
        .from("data_connectors")
        .select("id")
        .eq("id", parsed.data.connectorId)
        .eq("workspace_id", parsed.data.workspaceId)
        .limit(1);

      if (connectorError) {
        audit.error("refresh_job_connector_lookup_failed", {
          message: connectorError.message,
          code: connectorError.code ?? null,
          connectorId: parsed.data.connectorId,
        });
        return NextResponse.json({ error: "Failed to verify connector" }, { status: 500 });
      }

      if (!connectors || connectors.length === 0) {
        return NextResponse.json({ error: "Connector not found" }, { status: 404 });
      }
    }

    if (parsed.data.datasetId) {
      const { data: datasets, error: datasetLookupError } = await supabase
        .from("data_datasets")
        .select("id")
        .eq("id", parsed.data.datasetId)
        .eq("workspace_id", parsed.data.workspaceId)
        .limit(1);

      if (datasetLookupError) {
        audit.error("refresh_job_dataset_lookup_failed", {
          message: datasetLookupError.message,
          code: datasetLookupError.code ?? null,
          datasetId: parsed.data.datasetId,
        });
        return NextResponse.json({ error: "Failed to verify dataset" }, { status: 500 });
      }

      if (!datasets || datasets.length === 0) {
        return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
      }
    }

    const { data: refreshJob, error: refreshJobError } = await supabase
      .from("data_refresh_jobs")
      .insert({
        workspace_id: parsed.data.workspaceId,
        connector_id: parsed.data.connectorId ?? null,
        dataset_id: parsed.data.datasetId ?? null,
        job_name: parsed.data.jobName,
        job_type: parsed.data.jobType ?? "refresh",
        status: parsed.data.status ?? "queued",
        refresh_mode: parsed.data.refreshMode ?? "manual",
        started_at: parsed.data.startedAt?.trim() || null,
        completed_at: parsed.data.completedAt?.trim() || null,
        records_written: parsed.data.recordsWritten ?? null,
        triggered_by_label: parsed.data.triggeredByLabel?.trim() || null,
        error_summary: parsed.data.errorSummary?.trim() || null,
        created_by: user.id,
      })
      .select(
        "id, workspace_id, connector_id, dataset_id, job_name, job_type, status, refresh_mode, started_at, completed_at, records_written, triggered_by_label, error_summary, created_at"
      )
      .single();

    if (refreshJobError) {
      audit.error("refresh_job_insert_failed", {
        message: refreshJobError.message,
        code: refreshJobError.code ?? null,
        workspaceId: parsed.data.workspaceId,
      });

      if (looksLikePendingSchema(refreshJobError.message)) {
        return schemaPendingResponse(refreshJobError.message);
      }

      return NextResponse.json(
        { error: "Failed to create refresh job", details: refreshJobError.message },
        { status: 500 }
      );
    }

    audit.info("refresh_job_created", {
      workspaceId: parsed.data.workspaceId,
      refreshJobId: refreshJob?.id ?? null,
      connectorId: parsed.data.connectorId ?? null,
      datasetId: parsed.data.datasetId ?? null,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ recordType: "refreshJob", record: refreshJob }, { status: 201 });
  } catch (error) {
    audit.error("data_hub_records_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while creating Data Hub record" }, { status: 500 });
  }
}
