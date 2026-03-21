import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadModelAccess } from "@/lib/models/api";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ modelId: string; modelRunId: string }>;
};

async function loadAuthorizedRun(
  modelId: string,
  modelRunId: string,
  permission: "models.read" | "models.write"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const access = await loadModelAccess(supabase, modelId, user.id, permission);
  if (access.error) {
    return { errorResponse: NextResponse.json({ error: "Failed to load model" }, { status: 500 }) } as const;
  }
  if (!access.model) {
    return { errorResponse: NextResponse.json({ error: "Model not found" }, { status: 404 }) } as const;
  }
  if (!access.membership || !access.allowed) {
    return { errorResponse: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) } as const;
  }

  const { data: run, error: runError } = await supabase
    .from("model_runs")
    .select("id, model_id")
    .eq("id", modelRunId)
    .eq("model_id", access.model.id)
    .maybeSingle();

  if (runError) {
    return { errorResponse: NextResponse.json({ error: "Failed to load model run" }, { status: 500 }) } as const;
  }
  if (!run) {
    return { errorResponse: NextResponse.json({ error: "Model run not found" }, { status: 404 }) } as const;
  }

  return { supabase, access, run } as const;
}

// GET /api/models/[modelId]/runs/[modelRunId]/kpis
export async function GET(req: NextRequest, context: RouteContext) {
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
  }

  const auth = await loadAuthorizedRun(
    parsedParams.data.modelId,
    parsedParams.data.modelRunId,
    "models.read"
  );
  if ("errorResponse" in auth) {
    return auth.errorResponse;
  }

  const baselineRunId = req.nextUrl.searchParams.get("baseline_run_id");

  const { data: kpis, error } = await auth.supabase
    .from("model_run_kpis")
    .select("*")
    .eq("run_id", parsedParams.data.modelRunId)
    .order("kpi_category", { ascending: true })
    .order("kpi_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (baselineRunId) {
    const { data: baselineRun, error: baselineRunError } = await auth.supabase
      .from("model_runs")
      .select("id")
      .eq("id", baselineRunId)
      .eq("model_id", auth.access.model.id)
      .maybeSingle();

    if (baselineRunError) {
      return NextResponse.json({ error: "Failed to load baseline run" }, { status: 500 });
    }
    if (!baselineRun) {
      return NextResponse.json(
        { error: "Baseline run not found for this model" },
        { status: 404 }
      );
    }

    const { data: baselineKpis, error: baselineError } = await auth.supabase
      .from("model_run_kpis")
      .select("*")
      .eq("run_id", baselineRunId)
      .order("kpi_category", { ascending: true })
      .order("kpi_name", { ascending: true });

    if (baselineError) {
      return NextResponse.json({ error: baselineError.message }, { status: 500 });
    }

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
        percentDelta =
          baselineValue !== 0
            ? ((currentValue - baselineValue) / Math.abs(baselineValue)) * 100
            : null;
      }

      return {
        ...kpi,
        baseline_value: baselineValue,
        absolute_delta: absoluteDelta,
        percent_delta:
          percentDelta !== null ? Math.round(percentDelta * 100) / 100 : null,
      };
    });

    return NextResponse.json({
      run_id: parsedParams.data.modelRunId,
      baseline_run_id: baselineRunId,
      comparison,
    });
  }

  const categories = new Map<string, { count: number; avg_value: number | null }>();
  for (const kpi of kpis ?? []) {
    const cat = (kpi as Record<string, unknown>).kpi_category as string;
    const val = (kpi as Record<string, unknown>).value as number | null;
    const existing = categories.get(cat) ?? { count: 0, avg_value: null };
    existing.count++;
    if (val !== null) {
      existing.avg_value =
        existing.avg_value !== null
          ? (existing.avg_value * (existing.count - 1) + val) / existing.count
          : val;
    }
    categories.set(cat, existing);
  }

  return NextResponse.json({
    run_id: parsedParams.data.modelRunId,
    kpi_count: (kpis ?? []).length,
    categories: Object.fromEntries(categories),
    kpis: kpis ?? [],
  });
}

// POST /api/models/[modelId]/runs/[modelRunId]/kpis
// Register KPI results for an authorized model run.
export async function POST(req: NextRequest, context: RouteContext) {
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
  }

  const auth = await loadAuthorizedRun(
    parsedParams.data.modelId,
    parsedParams.data.modelRunId,
    "models.write"
  );
  if ("errorResponse" in auth) {
    return auth.errorResponse;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const kpiRecords = Array.isArray(body.kpis) ? body.kpis : [body];

  const inserts = kpiRecords.map((kpi: Record<string, unknown>) => ({
    run_id: parsedParams.data.modelRunId,
    kpi_name: kpi.kpi_name as string,
    kpi_label: kpi.kpi_label as string,
    kpi_category: (kpi.kpi_category as string) ?? "general",
    value: (kpi.value as number) ?? null,
    unit: (kpi.unit as string) ?? "",
    geometry_ref: (kpi.geometry_ref as string) ?? null,
    breakdown_json: (kpi.breakdown_json as Record<string, unknown>) ?? {},
  }));

  const { data, error } = await auth.supabase
    .from("model_run_kpis")
    .insert(inserts)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      message: `${(data ?? []).length} KPI(s) registered.`,
      kpis: data ?? [],
    },
    { status: 201 }
  );
}
