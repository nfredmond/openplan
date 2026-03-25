import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { enqueueCountyRunResponseSchema } from "@/lib/api/county-onramp";
import {
  buildCountyOnrampWorkerPayloadFromStoredRequest,
  storedCountyOnrampRequestSchema,
} from "@/lib/api/county-onramp-worker";

const paramsSchema = z.object({
  countyRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ countyRunId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("county-runs.enqueue", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid county run route params" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: countyRun, error: countyRunError } = await supabase
      .from("county_runs")
      .select("id, requested_runtime_json")
      .eq("id", parsedParams.data.countyRunId)
      .maybeSingle();

    if (countyRunError) {
      audit.error("county_run_lookup_failed", {
        message: countyRunError.message,
        code: countyRunError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load county run" }, { status: 500 });
    }

    if (!countyRun) {
      return NextResponse.json({ error: "County run not found" }, { status: 404 });
    }

    const storedRequest = storedCountyOnrampRequestSchema.safeParse(countyRun.requested_runtime_json);
    if (!storedRequest.success) {
      audit.warn("county_run_missing_launch_state", {
        countyRunId: parsedParams.data.countyRunId,
      });
      return NextResponse.json({ error: "County run is missing launch request state" }, { status: 409 });
    }

    const workerPayload = buildCountyOnrampWorkerPayloadFromStoredRequest({
      origin: new URL(request.url).origin,
      jobId: crypto.randomUUID(),
      countyRunId: parsedParams.data.countyRunId,
      input: storedRequest.data,
    });

    const response = enqueueCountyRunResponseSchema.parse({
      countyRunId: parsedParams.data.countyRunId,
      status: "queued_stub",
      workerPayload,
    });

    audit.info("county_run_enqueue_prepared", {
      countyRunId: parsedParams.data.countyRunId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    audit.error("county_run_enqueue_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while preparing county run enqueue payload" }, { status: 500 });
  }
}
