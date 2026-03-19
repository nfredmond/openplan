import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/models/[modelId]/runs/[modelRunId]/evidence-packet
// Generate and return the full evidence packet for a completed model run
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ modelId: string; modelRunId: string }> }
) {
  const { modelId, modelRunId } = await params;
  const supabase = await createClient();

  // Fetch model
  const { data: model, error: modelError } = await supabase
    .from("models")
    .select("id, title, workspace_id, config_json")
    .eq("id", modelId)
    .single();

  if (modelError || !model) {
    return NextResponse.json({ error: "Model not found." }, { status: 404 });
  }

  // Fetch run
  const { data: run, error: runError } = await supabase
    .from("model_runs")
    .select("*")
    .eq("id", modelRunId)
    .eq("model_id", modelId)
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: "Model run not found." }, { status: 404 });
  }

  // Fetch stages
  const { data: stages } = await supabase
    .from("model_run_stages")
    .select("*")
    .eq("run_id", modelRunId)
    .order("created_at", { ascending: true });

  // Fetch artifacts
  const { data: artifacts } = await supabase
    .from("model_run_artifacts")
    .select("*")
    .eq("run_id", modelRunId)
    .order("created_at", { ascending: true });

  // Fetch KPIs
  const { data: kpis } = await supabase
    .from("model_run_kpis")
    .select("*")
    .eq("run_id", modelRunId)
    .order("kpi_category", { ascending: true });

  // Build caveats
  const caveats: string[] = [];
  caveats.push("Model outputs are from an uncalibrated prototype engine.");

  const hasTransitSkims = (artifacts ?? []).some(
    (a: Record<string, unknown>) =>
      a.artifact_type === "skim_matrix" &&
      typeof a.file_url === "string" &&
      (a.file_url as string).includes("transit")
  );
  if (!hasTransitSkims) {
    caveats.push("Transit skims are not included in this run (no transit network data or transit mode not configured).");
  }

  const failedStages = (stages ?? []).filter((s: Record<string, unknown>) => s.status === "failed");
  if (failedStages.length > 0) {
    caveats.push(`${failedStages.length} stage(s) failed during execution. Results may be incomplete.`);
  }

  if ((kpis ?? []).length === 0) {
    caveats.push("No KPIs were extracted for this run.");
  }

  // Group KPIs by category
  const kpiSummary: Record<string, unknown[]> = {};
  for (const kpi of kpis ?? []) {
    const cat = (kpi as Record<string, unknown>).kpi_category as string;
    if (!kpiSummary[cat]) kpiSummary[cat] = [];
    kpiSummary[cat].push({
      name: (kpi as Record<string, unknown>).kpi_name,
      label: (kpi as Record<string, unknown>).kpi_label,
      value: (kpi as Record<string, unknown>).value,
      unit: (kpi as Record<string, unknown>).unit,
      geometry_ref: (kpi as Record<string, unknown>).geometry_ref,
    });
  }

  // Build stage summaries
  const stageSummaries = (stages ?? []).map((s: Record<string, unknown>) => {
    const started = s.started_at ? new Date(s.started_at as string).getTime() : null;
    const completed = s.completed_at ? new Date(s.completed_at as string).getTime() : null;
    const durationS = started && completed ? Math.round((completed - started) / 1000) : null;
    return {
      name: s.stage_name,
      status: s.status,
      duration_s: durationS,
    };
  });

  const runRecord = run as Record<string, unknown>;
  const evidencePacket = {
    packet_version: "1.0",
    generated_at: new Date().toISOString(),
    run_id: modelRunId,
    model_id: modelId,
    model_title: (model as Record<string, unknown>).title,
    engine: runRecord.engine_key ?? "deterministic",

    inputs: {
      skim_config: runRecord.skim_config_json ?? {},
    },

    assumptions: {
      snapshot: runRecord.result_summary_json ?? {},
      query_text: runRecord.run_title,
    },

    outputs: {
      kpi_summary: kpiSummary,
      artifacts: (artifacts ?? []).map((a: Record<string, unknown>) => ({
        type: a.artifact_type,
        file_url: a.file_url,
        hash: a.content_hash ?? null,
        size_bytes: a.file_size_bytes ?? null,
      })),
      stages: stageSummaries,
    },

    caveats,

    provenance: {
      platform: "OpenPlan",
      engine_version: `${runRecord.engine_key ?? "deterministic"}-prototype-v1`,
      run_started_at: runRecord.started_at,
      run_completed_at: runRecord.completed_at,
      run_status: runRecord.status,
    },
  };

  return NextResponse.json(evidencePacket);
}
