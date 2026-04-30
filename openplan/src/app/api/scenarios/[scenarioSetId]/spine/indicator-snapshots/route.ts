import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  markScenarioLinkedReportsBasisStale,
  type ScenarioReportWritebackSupabaseLike,
} from "@/lib/reports/scenario-writeback";
import { loadScenarioSetAccess, looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";

const paramsSchema = z.object({
  scenarioSetId: z.string().uuid(),
});

const createIndicatorSnapshotSchema = z.object({
  scenarioEntryId: z.string().uuid().optional(),
  indicatorKey: z.string().trim().min(1).max(120),
  indicatorLabel: z.string().trim().min(1).max(160),
  value: z.record(z.string(), z.unknown()).optional(),
  unitLabel: z.string().trim().max(80).optional(),
  geographyLabel: z.string().trim().max(160).optional(),
  sourceLabel: z.string().trim().max(160).optional(),
  snapshotAt: z.string().trim().datetime({ offset: true }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type RouteContext = {
  params: Promise<{ scenarioSetId: string }>;
};

async function loadScenarioEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioSetId: string,
  scenarioEntryId: string | undefined
) {
  if (!scenarioEntryId) return { entry: null, error: null };

  const { data, error } = await supabase
    .from("scenario_entries")
    .select("id, scenario_set_id, entry_type")
    .eq("id", scenarioEntryId)
    .eq("scenario_set_id", scenarioSetId)
    .maybeSingle();

  return { entry: data, error };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("scenarios.spine.indicator_snapshots.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid scenario set id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = createIndicatorSnapshotSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid indicator snapshot payload" }, { status: 400 });
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

    const { entry, error: entryError } = await loadScenarioEntry(
      supabase,
      access.scenarioSet.id,
      parsed.data.scenarioEntryId
    );

    if (entryError) {
      audit.error("scenario_entry_lookup_failed", {
        scenarioSetId: access.scenarioSet.id,
        scenarioEntryId: parsed.data.scenarioEntryId ?? null,
        message: entryError.message,
        code: entryError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify scenario entry" }, { status: 500 });
    }

    if (parsed.data.scenarioEntryId && !entry) {
      return NextResponse.json({ error: "Scenario entry must belong to this scenario set" }, { status: 400 });
    }

    const { data: indicatorSnapshot, error: insertError } = await supabase
      .from("scenario_indicator_snapshots")
      .insert({
        scenario_set_id: access.scenarioSet.id,
        scenario_entry_id: parsed.data.scenarioEntryId ?? null,
        indicator_key: parsed.data.indicatorKey.trim(),
        indicator_label: parsed.data.indicatorLabel.trim(),
        value_json: parsed.data.value ?? {},
        unit_label: parsed.data.unitLabel?.trim() || null,
        geography_label: parsed.data.geographyLabel?.trim() || null,
        source_label: parsed.data.sourceLabel?.trim() || null,
        snapshot_at: parsed.data.snapshotAt ?? new Date().toISOString(),
        metadata_json: parsed.data.metadata ?? {},
        created_by: user.id,
      })
      .select(
        "id, scenario_set_id, scenario_entry_id, indicator_key, indicator_label, value_json, unit_label, geography_label, source_label, snapshot_at, metadata_json, created_at, updated_at"
      )
      .single();

    if (insertError || !indicatorSnapshot) {
      if (looksLikePendingScenarioSpineSchema(insertError?.message)) {
        return NextResponse.json(
          {
            error: "Scenario spine schema is not available yet",
            hint: "Apply the latest Supabase migrations for the scenarios module before creating indicator snapshots.",
          },
          { status: 503 }
        );
      }

      audit.error("scenario_indicator_snapshot_insert_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create indicator snapshot" }, { status: 500 });
    }

    const staleWriteback = await markScenarioLinkedReportsBasisStale({
      supabase: supabase as unknown as ScenarioReportWritebackSupabaseLike,
      scenarioSetId: access.scenarioSet.id,
      workspaceId: access.scenarioSet.workspace_id,
      runId: null,
      reason: `Scenario indicator snapshot ${indicatorSnapshot.indicator_label} changed the linked RTP packet basis.`,
    });

    if (staleWriteback.error) {
      audit.warn("scenario_indicator_snapshot_report_basis_stale_failed", {
        scenarioSetId: access.scenarioSet.id,
        indicatorSnapshotId: indicatorSnapshot.id,
        message: staleWriteback.error.message,
        code: staleWriteback.error.code ?? null,
      });
    }

    audit.info("scenario_indicator_snapshot_created", {
      userId: user.id,
      scenarioSetId: access.scenarioSet.id,
      indicatorSnapshotId: indicatorSnapshot.id,
      staleReportCount: staleWriteback.staleReportIds.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ indicatorSnapshotId: indicatorSnapshot.id, indicatorSnapshot }, { status: 201 });
  } catch (error) {
    audit.error("scenario_indicator_snapshot_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while creating indicator snapshot" }, { status: 500 });
  }
}
