import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { loadPublicLandUsePlanReviewPacket } from "@/lib/land-use-plans/public";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({ shareToken: z.string().regex(/^[0-9a-f]{48}$/) });
type Context = { params: Promise<{ shareToken: string }> };

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("public.land-use-plan-reviews.detail", request);
  audit.info("public_land_use_plan_review_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Review release not found" }, { status: 404 });
  const result = await loadPublicLandUsePlanReviewPacket(params.data.shareToken);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : result.reason === "incomplete" ? 409 : 503;
    return NextResponse.json({ error: result.reason === "not_found" ? "Review release not found" : "Review release could not be loaded" }, { status });
  }
  return NextResponse.json(result.packet);
}
