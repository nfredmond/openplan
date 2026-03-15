import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { SCENARIO_SET_STATUSES } from "@/lib/scenarios/catalog";
import { loadProjectAccess } from "@/lib/scenarios/api";

const listScenarioSetsSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(SCENARIO_SET_STATUSES).optional(),
});

const createScenarioSetSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000).optional(),
  planningQuestion: z.string().trim().max(4000).optional(),
  status: z.enum(SCENARIO_SET_STATUSES).optional(),
});

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("scenarios.list", request);
  const startedAt = Date.now();

  try {
    const parsedFilters = listScenarioSetsSchema.safeParse({
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let query = supabase
      .from("scenario_sets")
      .select(
        "id, workspace_id, project_id, title, summary, planning_question, status, baseline_entry_id, created_at, updated_at, projects(id, name), workspaces(name)"
      )
      .order("updated_at", { ascending: false });

    if (parsedFilters.data.projectId) {
      query = query.eq("project_id", parsedFilters.data.projectId);
    }

    if (parsedFilters.data.status) {
      query = query.eq("status", parsedFilters.data.status);
    }

    const { data, error } = await query;

    if (error) {
      audit.error("scenario_sets_list_failed", {
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load scenarios" }, { status: 500 });
    }

    const scenarioSets = data ?? [];
    const scenarioSetIds = scenarioSets.map((item) => item.id);

    const entriesResult = scenarioSetIds.length
      ? await supabase
          .from("scenario_entries")
          .select("scenario_set_id, entry_type")
          .in("scenario_set_id", scenarioSetIds)
      : { data: [], error: null };

    if (entriesResult.error) {
      audit.error("scenario_entries_summary_failed", {
        message: entriesResult.error.message,
        code: entriesResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to summarize scenario entries" }, { status: 500 });
    }

    const counts = new Map<string, { baselineCount: number; alternativeCount: number }>();
    for (const entry of entriesResult.data ?? []) {
      const current = counts.get(entry.scenario_set_id) ?? { baselineCount: 0, alternativeCount: 0 };
      if (entry.entry_type === "baseline") {
        current.baselineCount += 1;
      } else {
        current.alternativeCount += 1;
      }
      counts.set(entry.scenario_set_id, current);
    }

    audit.info("scenario_sets_list_loaded", {
      userId: user.id,
      count: scenarioSets.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        scenarioSets: scenarioSets.map((scenarioSet) => ({
          ...scenarioSet,
          counts: counts.get(scenarioSet.id) ?? { baselineCount: 0, alternativeCount: 0 },
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("scenarios_list_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading scenarios" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("scenarios.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
    const parsed = createScenarioSetSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadProjectAccess(supabase, parsed.data.projectId, user.id, "scenarios.write");

    if (access.error) {
      audit.error("project_access_failed", {
        projectId: parsed.data.projectId,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify linked project" }, { status: 500 });
    }

    if (!access.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: scenarioSet, error: insertError } = await supabase
      .from("scenario_sets")
      .insert({
        workspace_id: access.project.workspace_id,
        project_id: access.project.id,
        title: parsed.data.title.trim(),
        summary: parsed.data.summary?.trim() || null,
        planning_question: parsed.data.planningQuestion?.trim() || null,
        status: parsed.data.status ?? "draft",
        created_by: user.id,
      })
      .select("id, workspace_id, project_id, title, summary, planning_question, status, baseline_entry_id, created_at, updated_at")
      .single();

    if (insertError || !scenarioSet) {
      audit.error("scenario_set_insert_failed", {
        projectId: access.project.id,
        workspaceId: access.project.workspace_id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create scenario set" }, { status: 500 });
    }

    audit.info("scenario_set_created", {
      userId: user.id,
      workspaceId: access.project.workspace_id,
      projectId: access.project.id,
      scenarioSetId: scenarioSet.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        scenarioSetId: scenarioSet.id,
        scenarioSet,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("scenarios_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while creating scenario set" }, { status: 500 });
  }
}
