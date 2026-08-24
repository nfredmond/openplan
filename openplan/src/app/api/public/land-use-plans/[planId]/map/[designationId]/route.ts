import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readWgs84Viewport } from "@/lib/geo/wgs84-bounds";
import { loadPublishedLandUsePlanPacket } from "@/lib/land-use-plans/public";
import { loadPublicDesignationMap } from "@/lib/land-use-plans/public-map";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({ planId: z.string().uuid(), designationId: z.string().uuid() });
type Context = { params: Promise<{ planId: string; designationId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("public.land-use-plans.map", request);
  audit.info("public_land_use_plan_map_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Map not found" }, { status: 404 });
  const bbox = readWgs84Viewport(request.nextUrl.searchParams.get("bbox")?.split(",").map(Number));
  if (!bbox) return NextResponse.json({ error: "Pass a valid bbox=west,south,east,north" }, { status: 400 });
  const plan = await loadPublishedLandUsePlanPacket(params.data.planId);
  if (!plan.ok) return NextResponse.json({ error: "Map not found" }, { status: plan.reason === "not_found" ? 404 : 503 });
  const map = await loadPublicDesignationMap(plan.packet.content, params.data.designationId, bbox);
  if (!map.ok) return NextResponse.json({ error: map.reason === "not_found" ? "Map not found" : "Map could not be verified" }, { status: map.reason === "not_found" ? 404 : 503 });
  return NextResponse.json(map.payload);
}
