import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  markScenarioLinkedReportsBasisStale,
  type ScenarioReportWritebackSupabaseLike,
} from "@/lib/reports/scenario-writeback";
import { SCENARIO_ASSUMPTION_SET_STATUSES } from "@/lib/scenarios/catalog";
import { loadScenarioSetAccess, looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";

const paramsSchema = z.object({
  scenarioSetId: z.string().uuid(),
});

const createAssumptionSetSchema = z.object({
  scenarioEntryId: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000).optional(),
  assumptions: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(SCENARIO_ASSUMPTION_SET_STATUSES).optional(),
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
  const audit = createApiAuditLogger("scenarios.spine.assumption_sets.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid scenario set id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = createAssumptionSetSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid assumption set payload" }, { status: 400 });
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

    const { data: assumptionSet, error: insertError } = await supabase
      .from("scenario_assumption_sets")
      .insert({
        scenario_set_id: access.scenarioSet.id,
        scenario_entry_id: parsed.data.scenarioEntryId ?? null,
        label: parsed.data.label.trim(),
        summary: parsed.data.summary?.trim() || null,
        assumptions_json: parsed.data.assumptions ?? {},
        status: parsed.data.status ?? "draft",
        created_by: user.id,
      })
      .select("id, scenario_set_id, scenario_entry_id, label, summary, assumptions_json, status, created_at, updated_at")
      .single();

    if (insertError || !assumptionSet) {
      if (looksLikePendingScenarioSpineSchema(insertError?.message)) {
        return NextResponse.json(
          {
            error: "Scenario spine schema is not available yet",
            hint: "Apply the latest Supabase migrations for the scenarios module before creating assumption sets.",
          },
          { status: 503 }
        );
      }

      audit.error("scenario_assumption_set_insert_failed", {
        scenarioSetId: access.scenarioSet.id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create assumption set" }, { status: 500 });
    }

    const staleWriteback = await markScenarioLinkedReportsBasisStale({
      supabase: supabase as unknown as ScenarioReportWritebackSupabaseLike,
      scenarioSetId: access.scenarioSet.id,
      workspaceId: access.scenarioSet.workspace_id,
      runId: null,
      reason: `Scenario assumption set ${assumptionSet.label} changed the linked RTP packet basis.`,
    });

    if (staleWriteback.error) {
      audit.warn("scenario_assumption_set_report_basis_stale_failed", {
        scenarioSetId: access.scenarioSet.id,
        assumptionSetId: assumptionSet.id,
        message: staleWriteback.error.message,
        code: staleWriteback.error.code ?? null,
      });
    }

    audit.info("scenario_assumption_set_created", {
      userId: user.id,
      scenarioSetId: access.scenarioSet.id,
      assumptionSetId: assumptionSet.id,
      staleReportCount: staleWriteback.staleReportIds.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ assumptionSetId: assumptionSet.id, assumptionSet }, { status: 201 });
  } catch (error) {
    audit.error("scenario_assumption_set_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while creating assumption set" }, { status: 500 });
  }
}
