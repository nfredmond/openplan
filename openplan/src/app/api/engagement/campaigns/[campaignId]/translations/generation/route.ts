import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { TRANSLATION_GENERATION_BODY_LIMIT, translationGenerationRequestSchema } from "@/lib/engagement/translation-generation-request";
import { queueTranslationGeneration, TranslationQueueError } from "@/lib/engagement/translation-generation-queue";

import { loadTranslationGenerationCatalog, translationGenerationCursorSchema } from "@/lib/engagement/translation-generation-catalog";
import { loadTranslationGenerationRequest } from "@/lib/engagement/translation-generation-read";

const headers = { "Cache-Control": "private, no-store" };
const messages = {
  invalid: "Review the translation fields, source versions and requested language.",
  forbidden: "Staff campaign access is required to request translations.",
  conflict: "The source, saved translation or request differs. Review the current copy before starting a new request.",
  unavailable: "OpenPlan could not confirm the request. Keep its request ID and retry the same request.",
  credential_unavailable: "The selected translation key could not be verified. Manual translation remains available.",
};
function refused(kind: keyof typeof messages, status: number) { return NextResponse.json({ kind, error: messages[kind] }, { status, headers }); }
export async function POST(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const audit = createApiAuditLogger("engagement.translation-generation", request);
  try {
    const params = z.object({ campaignId: z.string().uuid() }).safeParse(await context.params);
    if (!params.success) return refused("invalid", 400);
    // Generation has no registered Planner Agent action yet. Refuse marked
    // executions instead of attributing an unapproved agent write to a person.
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      return NextResponse.json({ kind: "forbidden", error: "Planner Agent translation requests are not supported. Use the staff translation editor." }, { status: 403, headers });
    }
    try { requireProviderBrowserOrigin(request); } catch { return refused("forbidden", 403); }
    const bytes = await readBytesWithLimitStreaming(request, TRANSLATION_GENERATION_BODY_LIMIT);
    if (!bytes.ok) { bytes.response.headers.set("Cache-Control", headers["Cache-Control"]); return bytes.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes)); }
    catch { return refused("invalid", 400); }
    const parsed = translationGenerationRequestSchema.safeParse(raw);
    if (!parsed.success) return refused("invalid", 400);
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return refused("forbidden", 401);
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
    if (access.error) return refused("unavailable", 503);
    if (!access.campaign) return refused("forbidden", 404);
    if (!access.allowed) return refused("forbidden", 403);
    const result = await queueTranslationGeneration(createServiceRoleClient(), { campaignId: params.data.campaignId,
      workspaceId: access.campaign.workspace_id, actorId: user.id }, parsed.data);
    audit.info("translation_generation_queued", { campaignId: params.data.campaignId, requestId: result.requestId, actorId: user.id, created: result.created, fieldCount: parsed.data.fields.length });
    return NextResponse.json(result, { status: result.created ? 202 : 200, headers });
  } catch (error) {
    const failure = error instanceof TranslationQueueError ? error : new TranslationQueueError("unavailable", 503);
    audit.warn("translation_generation_unconfirmed", { kind: failure.kind });
    return refused(failure.kind, failure.status);
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const audit = createApiAuditLogger("engagement.translation-generation-read", request);
  try {
    const params = z.object({ campaignId: z.string().uuid() }).safeParse(await context.params);
    const requestId = z.string().uuid().optional().safeParse(request.nextUrl.searchParams.get("requestId") ?? undefined);
    const beforeCreatedAt = request.nextUrl.searchParams.get("beforeCreatedAt");
    const beforeId = request.nextUrl.searchParams.get("beforeId");
    const cursor = beforeCreatedAt === null && beforeId === null ? null : translationGenerationCursorSchema.safeParse({ createdAt: beforeCreatedAt, id: beforeId });
    if (cursor !== null && (!cursor.success || (requestId.success && requestId.data !== undefined))) return refused("invalid", 400);
    if (!params.success || !requestId.success) return refused("invalid", 400);
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return refused("forbidden", 401);
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
    if (access.error) return refused("unavailable", 503);
    if (!access.campaign) return refused("forbidden", 404);
    if (!access.allowed) return refused("forbidden", 403);
    if (requestId.data === undefined) {
      const listed = await loadTranslationGenerationCatalog(client, { campaignId: params.data.campaignId, workspaceId: access.campaign.workspace_id }, cursor?.data ?? null);
      if (!listed.page) return refused(listed.forbidden ? "forbidden" : "unavailable", listed.forbidden ? 403 : 503);
      return NextResponse.json(listed.page, { headers });
    }
    const result = await loadTranslationGenerationRequest(client, { campaignId: params.data.campaignId,
      workspaceId: access.campaign.workspace_id, requestId: requestId.data });
    return NextResponse.json(result, { headers });
  } catch (error) {
    audit.warn("translation_generation_read_unavailable");
    return error instanceof TranslationQueueError ? refused(error.kind, error.status) : refused("unavailable", 503);
  }
}
