import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadTranslationSnapshot } from "@/lib/engagement/translation-snapshot";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const audit = createApiAuditLogger("engagement.translation-snapshot", request);
  try {
    const params = z.object({ campaignId: z.string().uuid() }).safeParse(await context.params);
    if (!params.success) return NextResponse.json({ error: "Invalid campaign" }, { status: 400, headers });
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in to read this campaign." }, { status: 401, headers });
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.read");
    if (access.error) return NextResponse.json({ error: "Campaign access could not be checked." }, { status: 503, headers });
    if (!access.campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404, headers });
    if (!access.allowed) return NextResponse.json({ error: "Campaign access required" }, { status: 403, headers });
    const result = await loadTranslationSnapshot(client, params.data.campaignId);
    if (result.error) {
      audit.warn("translation_snapshot_unavailable", { campaignId: params.data.campaignId });
      return NextResponse.json({ error: "The current translation snapshot could not be read. Try again." }, { status: 503, headers });
    }
    return NextResponse.json({ snapshot: result.snapshot }, { headers });
  } catch {
    audit.error("translation_snapshot_unavailable");
    return NextResponse.json({ error: "The current translation snapshot could not be read. Try again." }, { status: 503, headers });
  }
}
