import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";
import {
  loadJsonArtifact,
  resolveRunWorkDir,
  workerLocalRoot,
} from "@/lib/models/artifact-source";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  buildBehavioralDemandComparison,
  normalizeBehavioralComparisonSource,
} from "@/lib/models/behavioral-kpi-comparison";

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
    .select("id, model_id, engine_key, status")
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

async function loadBehavioralArtifactSource(supabase: Awaited<ReturnType<typeof createClient>>, runId: string) {
  const { data: artifacts, error } = await supabase
    .from("model_run_artifacts")
    .select("artifact_type, file_url")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (artifacts ?? []) as Array<{ artifact_type: string; file_url: string | null }>;
  const candidates = rows.filter(
    (artifact) =>
      typeof artifact.file_url === "string" &&
      Boolean(artifact.file_url) &&
      (artifact.artifact_type === "activitysim_behavioral_kpi_summary" || artifact.artifact_type === "evidence_packet")
  );

  for (const candidate of candidates) {
    try {
      // Scoped read: file_url is member-writable data, so the resolver is
      // bound to the candidate run's storage prefix / local work dir.
      const envRoot = workerLocalRoot();
      const payload = await loadJsonArtifact(candidate.file_url as string, {
        bucket: "run-artifacts",
        objectPathPrefix: `model-runs/${runId}/`,
        localRoot: envRoot ? resolveRunWorkDir(envRoot, runId) : undefined,
      });
      const normalized = normalizeBehavioralComparisonSource(payload);
      if (normalized) {
        return normalized;
      }
    } catch (error) {
      console.warn("Failed to load behavioral comparison artifact", {
        runId,
        artifactType: candidate.artifact_type,
        fileUrl: candidate.file_url,
        error,
      });
    }
  }

  return null;
}

// GET /api/models/[modelId]/runs/[modelRunId]/kpis
export async function GET(req: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("model_runs.kpis.read", req);
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
    audit.error("model_run_kpis_lookup_failed", {
      modelRunId: parsedParams.data.modelRunId,
      message: error.message,
      code: error.code ?? null,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (baselineRunId) {
    const { data: baselineRun, error: baselineRunError } = await auth.supabase
      .from("model_runs")
      .select("id, engine_key, status")
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

    if (auth.run.engine_key === "behavioral_demand") {
      if (baselineRun.engine_key !== "behavioral_demand") {
        const blockedComparison = buildBehavioralDemandComparison(null, null);
        return NextResponse.json({
          run_id: parsedParams.data.modelRunId,
          baseline_run_id: baselineRunId,
          comparison: [],
          behavioral_comparison: {
            ...blockedComparison,
            support: {
              ...blockedComparison.support,
              message:
                "Behavioral comparison is only supportable when both runs come from the behavioral-demand lane.",
              reason_codes: ["baseline_engine_mismatch"],
            },
          },
        });
      }

      const [currentBehavioralSource, baselineBehavioralSource] = await Promise.all([
        loadBehavioralArtifactSource(auth.supabase, parsedParams.data.modelRunId),
        loadBehavioralArtifactSource(auth.supabase, baselineRunId),
      ]);
      const behavioralComparison = buildBehavioralDemandComparison(
        currentBehavioralSource,
        baselineBehavioralSource
      );

      return NextResponse.json({
        run_id: parsedParams.data.modelRunId,
        baseline_run_id: baselineRunId,
        comparison: behavioralComparison.comparison.rows,
        behavioral_comparison: behavioralComparison,
      });
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

  const categories = new Map<
    string,
    { count: number; value_count: number; avg_value: number | null }
  >();
  for (const kpi of kpis ?? []) {
    const cat = (kpi as Record<string, unknown>).kpi_category as string;
    const val = (kpi as Record<string, unknown>).value as number | null;
    const existing = categories.get(cat) ?? { count: 0, value_count: 0, avg_value: null };
    existing.count++;
    if (typeof val === "number") {
      existing.avg_value =
        existing.avg_value !== null
          ? (existing.avg_value * existing.value_count + val) / (existing.value_count + 1)
          : val;
      existing.value_count++;
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
  const audit = createApiAuditLogger("model_runs.kpis.write", req);
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
    const bodyBody = await readJsonOrNullWithLimit<Record<string, unknown>>(req, BODY_LIMITS.normalJson);
    if (!bodyBody.ok) return bodyBody.response;
    body = bodyBody.data ?? {};
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const kpiRecords = Array.isArray(body.kpis) ? body.kpis : [body];

  if (
    kpiRecords.some(
      (kpi) =>
        kpi &&
        typeof kpi === "object" &&
        (kpi as Record<string, unknown>).kpi_category === "behavioral_onramp"
    )
  ) {
    audit.warn("behavioral_onramp_model_run_kpi_rejected", {
      modelRunId: parsedParams.data.modelRunId,
      attemptedCount: kpiRecords.length,
    });
    return NextResponse.json(
      {
        error:
          "behavioral_onramp KPIs must be registered through county-run manifest ingestion.",
      },
      { status: 400 }
    );
  }

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
    audit.error("model_run_kpis_insert_failed", {
      modelRunId: parsedParams.data.modelRunId,
      attemptedCount: inserts.length,
      message: error.message,
      code: error.code ?? null,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  audit.info("model_run_kpis_registered", {
    modelRunId: parsedParams.data.modelRunId,
    registeredCount: (data ?? []).length,
  });

  return NextResponse.json(
    {
      message: `${(data ?? []).length} KPI(s) registered.`,
      kpis: data ?? [],
    },
    { status: 201 }
  );
}
