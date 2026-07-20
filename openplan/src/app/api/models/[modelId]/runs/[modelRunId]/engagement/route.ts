import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  aggregateCorridorEngagement,
  buildSentimentByItemId,
  type CorridorEngagementItem,
} from "@/lib/engagement/corridor-join";
import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";

const paramsSchema = z.object({ modelId: z.string().uuid(), modelRunId: z.string().uuid() });

type RouteContext = { params: Promise<{ modelId: string; modelRunId: string }> };

/** Normalize a stored corridor value (Geometry | Feature | FeatureCollection)
 * to a bare GeoJSON Geometry that ST_GeomFromGeoJSON accepts. */
function toGeometry(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.type === "Feature") return toGeometry(v.geometry);
  if (v.type === "FeatureCollection" && Array.isArray(v.features) && v.features[0]) {
    return toGeometry((v.features[0] as Record<string, unknown>).geometry);
  }
  if (typeof v.type === "string" && Array.isArray(v.coordinates)) return v;
  return null;
}

/**
 * GET — the engagement<->modeling wedge for a model run: approved engagement
 * comments that fall within (buffered by ?buffer meters, default 150) the run's
 * corridor geometry, aggregated by sentiment (from the E1 synthesis) + category.
 * RLS-scoped: the run and the RPC only resolve for a workspace member.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("models.run.engagement.get", request);

  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid route params" }, { status: 400 });
    }
    const bufferMeters = Math.min(
      Math.max(Number(new URL(request.url).searchParams.get("buffer") ?? 150), 0),
      5000
    );

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: run, error: runError } = await supabase
      .from("model_runs")
      .select("id, workspace_id, corridor_geojson")
      .eq("id", parsed.data.modelRunId)
      .maybeSingle();
    if (runError) return NextResponse.json({ error: "Failed to load run" }, { status: 500 });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const geometry = toGeometry(run.corridor_geojson);
    if (!geometry) {
      return NextResponse.json({ summary: null, reason: "no_corridor_geometry" });
    }

    const { data: rows, error: rpcError } = await supabase.rpc("engagement_items_near_geometry", {
      p_workspace_id: run.workspace_id,
      p_geometry: geometry,
      p_buffer_meters: bufferMeters,
    });
    if (rpcError) {
      audit.error("corridor_join_rpc_failed", { message: rpcError.message, code: rpcError.code ?? null });
      return NextResponse.json({ error: "Spatial join failed" }, { status: 500 });
    }

    const items = (rows ?? []) as CorridorEngagementItem[];
    if (items.length === 0) {
      return NextResponse.json({
        summary: { total: 0, bySentiment: { positive: 0, mixed: 0, neutral: 0, negative: 0, unknown: 0 }, negativeSharePct: null, byCategory: [], nearest: [] },
        bufferMeters,
      });
    }

    const categoryIds = Array.from(new Set(items.map((i) => i.category_id).filter((v): v is string => Boolean(v))));
    const campaignIds = Array.from(new Set(items.map((i) => i.campaign_id)));

    const [{ data: categoryRows }, { data: campaignRows }] = await Promise.all([
      categoryIds.length
        ? supabase.from("engagement_categories").select("id, label").in("id", categoryIds)
        : Promise.resolve({ data: [] as Array<{ id: string; label: string | null }> }),
      supabase.from("engagement_campaigns").select("id, ai_synthesis_json").in("id", campaignIds),
    ]);

    const categoryLabelById = new Map<string, string>(
      (categoryRows ?? []).map((c: { id: string; label: string | null }) => [c.id, c.label ?? "Category"])
    );
    const syntheses = (campaignRows ?? []).map(
      (c: { ai_synthesis_json: EngagementSynthesis | null }) => c.ai_synthesis_json
    );
    const sentimentByItemId = buildSentimentByItemId(syntheses);

    const summary = aggregateCorridorEngagement(items, categoryLabelById, sentimentByItemId);
    return NextResponse.json({ summary, bufferMeters });
  } catch (error) {
    audit.error("corridor_join_unhandled", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Failed to load corridor engagement" }, { status: 500 });
  }
}
