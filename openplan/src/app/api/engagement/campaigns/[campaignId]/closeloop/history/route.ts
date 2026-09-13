import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { loadResponseHistory } from "@/lib/engagement/response-history-server";

export async function GET(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const audit = createApiAuditLogger("engagement.response-history", request);
  audit.info("request_received");
  const headers = { "Cache-Control": "private, no-store" };
  const parsed = z.object({ campaignId: z.string().uuid() }).safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid campaign" }, { status: 400, headers });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const access = await loadCampaignAccess(client, parsed.data.campaignId, user.id, "engagement.write");
  if (access.error) return NextResponse.json({ error: "Staff access could not be checked. Try again." }, { status: 503, headers });
  if (!access.campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404, headers });
  if (!access.allowed) return NextResponse.json({ error: "Staff access required" }, { status: 403, headers });
  const history = await loadResponseHistory(client, parsed.data.campaignId);
  if (history.error) return NextResponse.json({ error: history.error.message }, { status: 503, headers });
  return NextResponse.json({ history: history.rows }, { headers });
}
