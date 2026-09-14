import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { translationPublicationIntentSchema } from "@/lib/engagement/translation-publication";
import { publishRetainedTranslations } from "@/lib/engagement/translation-publication-server";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { TRANSLATION_WRITE_BODY_LIMIT, translationWriteIntentSchema, writeTranslations } from "@/lib/engagement/translation-write";

const headers = { "Cache-Control": "private, no-store" };
const unavailable = { kind: "unavailable", error: "OpenPlan could not confirm this save. Keep your words and retry the same request." };
const invalid = { kind: "invalid", error: "Review the translation fields, observed source and saved version, and change reason." };

export async function POST(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const audit = createApiAuditLogger("engagement.translation-command", request);
  try {
    const params = z.object({ campaignId: z.string().uuid() }).safeParse(await context.params);
    if (!params.success) return NextResponse.json(invalid, { status: 400, headers });
    // Translation writes have no registered Planner Agent action yet.
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      return NextResponse.json({ kind: "forbidden", error: "Planner Agent translation writes are not supported. Use the staff translation editor." }, { status: 403, headers });
    }
    try { requireProviderBrowserOrigin(request); } catch {
      return NextResponse.json({ kind: "forbidden", error: "Use the staff translation editor to change translations." }, { status: 403, headers });
    }
    const bytes = await readBytesWithLimitStreaming(request, TRANSLATION_WRITE_BODY_LIMIT);
    if (!bytes.ok) {
      bytes.response.headers.set("Cache-Control", headers["Cache-Control"]);
      return bytes.response;
    }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes)); }
    catch { return NextResponse.json(invalid, { status: 400, headers }); }
    const parsed = z.union([translationWriteIntentSchema, translationPublicationIntentSchema]).safeParse(raw);
    if (!parsed.success) return NextResponse.json(invalid, { status: 400, headers });
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ kind: "forbidden", error: "Sign in to save these translations." }, { status: 401, headers });
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json(unavailable, { status: 503, headers });
    if (!access.campaign) return NextResponse.json({ kind: "forbidden", error: "Campaign not found or no longer accessible." }, { status: 404, headers });
    if (!access.allowed) return NextResponse.json({ kind: "forbidden", error: "Staff access is required to change translations." }, { status: 403, headers });
    // Re-reading current source here would reject a confirmed retry after a
    // later correction. The transaction checks access, receipt, then versions.
    const scope = { campaignId: params.data.campaignId, workspaceId: access.campaign.workspace_id };
    const written = parsed.data.operation === "publish_generated"
      ? await publishRetainedTranslations(client, { ...scope, publisherId: user.id }, parsed.data)
      : await writeTranslations(client, scope, parsed.data);
    if (written.error) {
      audit.warn("translation_write_refused", { campaignId: params.data.campaignId, requestId: parsed.data.requestId, kind: written.error.kind });
      return NextResponse.json({ kind: written.error.kind, error: written.error.message }, { status: written.error.status, headers });
    }
    audit.info("translation_write_confirmed", { campaignId: params.data.campaignId, userId: user.id, requestId: written.result.requestId,
      operation: written.result.operation, entryCount: written.result.entries.length, replayed: written.result.replayed });
    return NextResponse.json(written.result, { headers });
  } catch {
    audit.error("translation_write_unconfirmed");
    return NextResponse.json(unavailable, { status: 503, headers });
  }
}
