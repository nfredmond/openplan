import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { loadCloseLoopEntries } from "@/lib/engagement/close-loop";
import { responseWriteRoute } from "@/lib/engagement/response-write-route";

import { classifyRouteReadFailure } from "@/lib/http/read-outcome";

const paramsSchema = z.object({ campaignId: z.string().uuid() });

type RouteContext = { params: Promise<{ campaignId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.closeloop.list", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.read");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    const entries = await loadCloseLoopEntries(supabase, access.campaign.id);
    const failure = classifyRouteReadFailure("saved staff responses", entries);
    if (failure) {
      audit.error("entries_read_failed", { campaignId: access.campaign.id, message: failure.message });
      return NextResponse.json(failure.body, { status: failure.status });
    }
    return NextResponse.json({ entries: entries.rows });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while listing close-loop entries" }, { status: 500 });
  }
}

export const POST = responseWriteRoute("create");
