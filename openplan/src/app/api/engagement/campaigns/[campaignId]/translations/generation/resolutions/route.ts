import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { GENERATION_RESOLUTION_BODY_LIMIT, translationGenerationResolutionIntentSchema } from "@/lib/engagement/translation-generation-resolution";
import { resolveTranslationGenerationRequest } from "@/lib/engagement/translation-generation-resolution-server";
import { TranslationQueueError } from "@/lib/engagement/translation-generation-queue";

const headers = { "Cache-Control": "private, no-store" };
const messages = {
  invalid: "Keep the original browser copy and review the resolution request.",
  forbidden: "The original requester needs current staff campaign access to resolve this request.",
  conflict: "This resolution identity already has different retained details. Keep both copies for review.",
  unavailable: "OpenPlan could not confirm the resolution. Keep its exact saved request and retry it.",
};
function refused(kind: keyof typeof messages, status: number) {
  return NextResponse.json({ kind, error: messages[kind] }, { status, headers });
}

/** Resolve only the retained identity; generation of a replacement is a separate action. */
export async function POST(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const audit = createApiAuditLogger("engagement.translation-generation-resolution", request);
  try {
    const params = z.object({ campaignId: z.string().uuid() }).safeParse(await context.params);
    if (!params.success) return refused("invalid", 400);
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      return NextResponse.json({ kind: "forbidden", error: "Planner Agent translation resolution is not supported. Use the staff translation editor." }, { status: 403, headers });
    }
    try { requireProviderBrowserOrigin(request); } catch { return refused("forbidden", 403); }
    const bytes = await readBytesWithLimitStreaming(request, GENERATION_RESOLUTION_BODY_LIMIT);
    if (!bytes.ok) { bytes.response.headers.set("Cache-Control", headers["Cache-Control"]); return bytes.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes)); }
    catch { return refused("invalid", 400); }
    const intent = translationGenerationResolutionIntentSchema.safeParse(raw);
    if (!intent.success) return refused("invalid", 400);
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return refused("forbidden", 401);
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
    if (access.error) return refused("unavailable", 503);
    if (!access.campaign) return refused("forbidden", 404);
    if (!access.allowed) return refused("forbidden", 403);
    // Pin a persisted browser intent to its original login and workspace.
    // These headers constrain the authenticated scope; they never grant access.
    if (request.headers.get("x-openplan-expected-user") !== user.id
      || request.headers.get("x-openplan-expected-workspace") !== access.campaign.workspace_id) return refused("forbidden", 403);
    const packet = await resolveTranslationGenerationRequest(client, { campaignId: params.data.campaignId, workspaceId: access.campaign.workspace_id, actorId: user.id }, intent.data);
    audit.info("translation_generation_resolved", { campaignId: params.data.campaignId, actorId: user.id, requestId: intent.data.requestId,
      resolutionId: intent.data.resolutionId, replayed: packet.replayed });
    return NextResponse.json(packet, { status: packet.replayed ? 200 : 201, headers });
  } catch (error) {
    const kind = error instanceof TranslationQueueError && error.kind !== "credential_unavailable" ? error.kind : "unavailable";
    const status = error instanceof TranslationQueueError ? error.status : 503;
    audit.warn("translation_generation_resolution_unconfirmed", { kind });
    return refused(kind, status);
  }
}
