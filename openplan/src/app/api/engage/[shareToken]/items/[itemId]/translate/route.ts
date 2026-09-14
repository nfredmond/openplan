import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { TRANSLATION_LANGUAGES, machineTranslationUnavailableReason } from "@/lib/engagement/translation-languages";
import { publicTranslationResponseSchema, type PublicTranslationResponse } from "@/lib/engagement/public-translation-contract";
import { PublicTranslationQueueError, queuePublicTranslationGeneration, readPublicTranslationCache, readPublicTranslationGeneration } from "@/lib/engagement/public-translation-generation";

const headers = { "Cache-Control": "private, no-store" };
const paramsSchema = z.object({ shareToken: z.string().min(8).max(64), itemId: z.string().uuid() }).strict();
const intentSchema = z.object({ language: z.enum(TRANSLATION_LANGUAGES), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), retryOf: z.string().uuid().optional() }).strict();
type RouteContext = { params: Promise<{ shareToken: string; itemId: string }> };
const messages = {
  invalid: "Review the language and reload the original comment before translating it.",
  forbidden: "This comment is not available for translation.",
  conflict: "The original or request changed. Reload the comment or recover its current translation.",
  unavailable: "The translation request could not be confirmed. Check its status before requesting another attempt.",
  credential_unavailable: "Translation is unavailable with the current connection. The original remains available.",
  rate_limited: "Translation capacity is currently reserved. Keep reading the original and check again shortly.",
};
function failure(kind: keyof typeof messages, status: number) {
  return NextResponse.json({ kind, error: messages[kind] }, { status, headers: { ...headers, ...(status === 429 ? { "Retry-After": "300" } : {}) } });
}
function reply(value: PublicTranslationResponse) {
  const parsed = publicTranslationResponseSchema.safeParse(value);
  if (!parsed.success) return failure("unavailable", 503);
  const pending = parsed.data.source === "queue" && ["queued", "reserved", "running"].includes(parsed.data.request.state);
  return NextResponse.json(parsed.data, { status: pending ? 202 : 200, headers: { ...headers, ...(pending ? { "Retry-After": "2" } : {}) } });
}
function caught(error: unknown) {
  return error instanceof PublicTranslationQueueError ? failure(error.kind, error.status) : failure("unavailable", 503);
}

// Anonymous authority is the current published comment/share token, checked in
// SQL. This route queues bounded work; only the worker can authorize dispatch.
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.public_translate", request);
  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return failure("invalid", 400);
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) return failure("forbidden", 403);
    try { requireProviderBrowserOrigin(request); } catch { return failure("forbidden", 403); }
    const bytes = await readBytesWithLimitStreaming(request, 2048);
    if (!bytes.ok) { bytes.response.headers.set("Cache-Control", headers["Cache-Control"]); return bytes.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes)); } catch { return failure("invalid", 400); }
    const parsed = intentSchema.safeParse(raw);
    if (!parsed.success) return failure("invalid", 400);
    const { language, sourceHash } = parsed.data;
    const caveat = machineTranslationUnavailableReason(language);
    if (caveat) return reply({ source: "unavailable", language, sourceHash, translated: null, caveat });
    const service = createServiceRoleClient();
    // Explicit retries recover their named successor, not an unrelated legacy cache.
    if (parsed.data.retryOf === undefined) {
      const cached = await readPublicTranslationCache(service, params.data, parsed.data, request.signal);
      if (cached !== null) return reply({ source: "cache", language, sourceHash, translated: cached });
    }
    const { created, ...queued } = await queuePublicTranslationGeneration(service, params.data, parsed.data, request.signal);
    audit.info("public_translation_retained", { requestId: queued.requestId, created, state: queued.state });
    return reply({ source: "queue", sourceHash, request: queued, created });
  } catch (error) {
    audit.warn("public_translation_unconfirmed", { kind: error instanceof PublicTranslationQueueError ? error.kind : "unavailable" });
    return caught(error);
  }
}

// GET is recovery only. Missing work, failed reads and terminal failures remain
// distinct, and neither credential selection nor provider execution occurs here.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const params = paramsSchema.safeParse(await context.params);
    const pairs = [...request.nextUrl.searchParams];
    if (new Set(pairs.map(([key]) => key)).size !== pairs.length || pairs.some(([key]) => !["language", "sourceHash", "requestId"].includes(key))) return failure("invalid", 400);
    const parsed = intentSchema.omit({ retryOf: true }).safeParse({ language: request.nextUrl.searchParams.get("language"), sourceHash: request.nextUrl.searchParams.get("sourceHash") });
    const requestId = z.string().uuid().optional().safeParse(request.nextUrl.searchParams.get("requestId") ?? undefined);
    if (!params.success || !parsed.success || !requestId.success) return failure("invalid", 400);
    const { language, sourceHash } = parsed.data;
    const caveat = machineTranslationUnavailableReason(language);
    if (caveat) return reply({ source: "unavailable", language, sourceHash, translated: null, caveat });
    const service = createServiceRoleClient();
    const saved = await readPublicTranslationGeneration(service, params.data, parsed.data, requestId.data, request.signal);
    if (saved !== null) return reply({ source: "queue", sourceHash, request: saved });
    const cached = await readPublicTranslationCache(service, params.data, parsed.data, request.signal);
    return cached === null ? reply({ source: "missing", sourceHash, language, translated: null }) : reply({ source: "cache", sourceHash, language, translated: cached });
  } catch (error) { return caught(error); }
}
