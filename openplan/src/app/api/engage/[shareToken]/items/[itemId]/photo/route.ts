import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ENGAGEMENT_PHOTO_BUCKET, isEngagementPhotoPathForCampaign } from "@/lib/engagement/photo";

export const dynamic = "force-dynamic";

/** Recheck publication for each image request, including a reply's parent. Never redirect to a bearer storage URL. */
export async function GET(request: NextRequest, context: { params: Promise<{ shareToken: string; itemId: string }> }) {
 const audit=createApiAuditLogger("engage.photo", request);
 audit.info("request_received");
  const parsed = z.object({ shareToken: z.string().min(8).max(64), itemId: z.string().uuid() }).safeParse(await context.params);
  const denied = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!parsed.success) return denied();
  const service = createServiceRoleClient();
  const campaign = await service.from("engagement_campaigns").select("id").eq("share_token", parsed.data.shareToken).eq("status", "active").maybeSingle();
  if (campaign.error || !campaign.data) return denied();
  const item = await service.from("engagement_items").select("photo_path, parent_item_id").eq("id", parsed.data.itemId).eq("campaign_id", campaign.data.id).eq("status", "approved").maybeSingle();
  if (item.error || !item.data?.photo_path || !isEngagementPhotoPathForCampaign(item.data.photo_path, campaign.data.id)) return denied();
  if (item.data.parent_item_id) {
    const parent = await service.from("engagement_items").select("id").eq("id", item.data.parent_item_id).eq("campaign_id", campaign.data.id).eq("status", "approved").is("parent_item_id", null).maybeSingle();
    if (parent.error || !parent.data) return denied();
  }
  const file = await service.storage.from(ENGAGEMENT_PHOTO_BUCKET).download(item.data.photo_path);
  if (file.error || !file.data) return denied();
  return new NextResponse(await file.data.arrayBuffer(), { headers: { "Content-Type": file.data.type || "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
