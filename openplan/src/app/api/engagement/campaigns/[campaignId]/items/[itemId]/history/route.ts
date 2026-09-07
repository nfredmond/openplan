import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { readEveryPage } from "@/lib/supabase/paged-read";

export async function GET(request: NextRequest, context: { params: Promise<{ campaignId: string; itemId: string }> }) {
 const audit=createApiAuditLogger("engagement.history", request);
 audit.info("request_received");
  const parsed = z.object({ campaignId: z.string().uuid(), itemId: z.string().uuid() }).safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid contribution" }, { status: 400 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadCampaignAccess(client, parsed.data.campaignId, user.id, "engagement.write");
  if (access.error || !access.allowed || !access.campaign) return NextResponse.json({ error: "Staff access unavailable" }, { status: 403 });
  const rows = await readEveryPage((from, to) => client.from("engagement_item_history").select("id, actor_id, event, recorded_at, reason, record_json")
    .eq("campaign_id", parsed.data.campaignId).eq("item_id", parsed.data.itemId).order("recorded_at").order("id").range(from, to));
  if (!rows.complete) return NextResponse.json({ error: "History could not be loaded completely" }, { status: 503 });
  return NextResponse.json({ history: rows.rows.map((row) => ({ id: row.id, actorId: row.actor_id, event: row.event, recorded_at: row.recorded_at, reason: row.reason,
    record: { title: row.record_json.title, body: row.record_json.body, status: row.record_json.status } })) }, { headers: { "Cache-Control": "private, no-store" } });
}
