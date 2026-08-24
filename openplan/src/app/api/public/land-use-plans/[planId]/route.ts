import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { loadPublishedLandUsePlanPacket } from "@/lib/land-use-plans/public";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({ planId: z.string().uuid() });
type Context = { params: Promise<{ planId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("public.land-use-plans.detail", request);
  audit.info("published_land_use_plan_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const result = await loadPublishedLandUsePlanPacket(params.data.planId);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : result.reason === "incomplete" ? 409 : 503;
    return NextResponse.json({ error: result.reason === "not_found" ? "Published plan not found" : "Published plan could not be loaded" }, { status });
  }
  return NextResponse.json(result.packet);
}
