import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/models/[modelId]/runs/[modelRunId]/kpis
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ modelId: string; modelRunId: string }> }
) {
  const { modelRunId } = await params;
  const supabase = await createClient();

  const baselineRunId = req.nextUrl.searchParams.get("baseline_run_id");

  // Fetch KPIs for the target run
  const { data: kpis, error } = await supabase
    .from("model_run_kpis")
    .select("*")
    .eq("run_id", modelRunId)
    .order("kpi_category", { ascending: true })
    .order("kpi_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If a baseline_run_id is provided, fetch baseline KPIs for comparison
  if (baselineRunId) {
    const { data: baselineKpis, error: baselineError } = await supabase
      .from("model_run_kpis")
      .select("*")
      .eq("run_id", baselineRunId)
      .order("kpi_category", { ascending: true })
      .order("kpi_name", { ascending: true });

    if (baselineError) {
      return NextResponse.json({ error: baselineError.message }, { status: 500 });
    }

    // Build comparison deltas
    const baselineMap = new Map(
      (baselineKpis ?? []).map((k: Record<string, unknown>) => [
        `${k.kpi_name}::${k.geometry_ref ?? ""}`,
        k,
      ])
    );

    const comparison = (kpis ?? []).map((kpi: Record<string, unknown>) => {
      const key = `${kpi.kpi_name}::${kpi.geometry_ref ?? ""}`;
      const baseline = baselineMap.get(key) as Record<string, unknown> | undefined;
      const currentValue = kpi.value as number | null;
      const baselineValue = baseline?.value as number | null;

      let absoluteDelta: number | null = null;
      let percentDelta: number | null = null;

      if (currentValue !== null && baselineValue !== null) {
        absoluteDelta = currentValue - baselineValue;
        percentDelta = baselineValue !== 0 ? ((currentValue - baselineValue) / Math.abs(baselineValue)) * 100 : null;
      }

      return {
        ...kpi,
        baseline_value: baselineValue,
        absolute_delta: absoluteDelta,
        percent_delta: percentDelta !== null ? Math.round(percentDelta * 100) / 100 : null,
      };
    });

    return NextResponse.json({
      run_id: modelRunId,
      baseline_run_id: baselineRunId,
      comparison,
    });
  }

  // Summary by category
  const categories = new Map<string, { count: number; avg_value: number | null }>();
  for (const kpi of kpis ?? []) {
    const cat = (kpi as Record<string, unknown>).kpi_category as string;
    const val = (kpi as Record<string, unknown>).value as number | null;
    const existing = categories.get(cat) ?? { count: 0, avg_value: null };
    existing.count++;
    if (val !== null) {
      existing.avg_value = existing.avg_value !== null
        ? (existing.avg_value * (existing.count - 1) + val) / existing.count
        : val;
    }
    categories.set(cat, existing);
  }

  return NextResponse.json({
    run_id: modelRunId,
    kpi_count: (kpis ?? []).length,
    categories: Object.fromEntries(categories),
    kpis: kpis ?? [],
  });
}

// POST /api/models/[modelId]/runs/[modelRunId]/kpis
// Register KPI results (called by worker after extraction)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ modelId: string; modelRunId: string }> }
) {
  const { modelRunId } = await params;
  const supabase = await createClient();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // Support both single KPI and batch insert
  const kpiRecords = Array.isArray(body.kpis) ? body.kpis : [body];

  const inserts = kpiRecords.map((kpi: Record<string, unknown>) => ({
    run_id: modelRunId,
    kpi_name: kpi.kpi_name as string,
    kpi_label: kpi.kpi_label as string,
    kpi_category: (kpi.kpi_category as string) ?? "general",
    value: (kpi.value as number) ?? null,
    unit: (kpi.unit as string) ?? "",
    geometry_ref: (kpi.geometry_ref as string) ?? null,
    breakdown_json: (kpi.breakdown_json as Record<string, unknown>) ?? {},
  }));

  const { data, error } = await supabase
    .from("model_run_kpis")
    .insert(inserts)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    message: `${(data ?? []).length} KPI(s) registered.`,
    kpis: data ?? [],
  }, { status: 201 });
}
