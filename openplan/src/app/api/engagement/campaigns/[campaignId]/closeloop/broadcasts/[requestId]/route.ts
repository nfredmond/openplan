import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { loadResponseBroadcast } from "@/lib/engagement/response-broadcast";

const paramsSchema = z.object({ campaignId: z.string().uuid(), requestId: z.string().uuid() });
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, context: { params: Promise<{ campaignId: string; requestId: string }> }) {
  const audit = createApiAuditLogger("engagement.response.broadcast", request);
  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ error: "Invalid identifiers" }, { status: 400, headers });
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json({ error: "Staff access could not be checked. Try again." }, { status: 503, headers });
    if (!access.campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404, headers });
    if (!access.allowed) return NextResponse.json({ error: "Staff access required" }, { status: 403, headers });
    const result = await loadResponseBroadcast(client, params.data.campaignId, params.data.requestId);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.status, headers });
    if (!result.report) return NextResponse.json({ error: "No subscriber update record was found for this request." }, { status: 404, headers });
    return NextResponse.json({ broadcast: result.report }, { headers });
  } catch {
    audit.error("broadcast_read_failed");
    return NextResponse.json({ error: "Subscriber update status could not be read. Try again." }, { status: 503, headers });
  }
}
