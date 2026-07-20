import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { checkAiUsageRateLimit } from "@/lib/billing/ai-rate-limit";
import { recordUsageEventBestEffort } from "@/lib/billing/usage-recording";
import {
  isTranslationLanguage,
  translateEngagementText,
  type TranslationLanguage,
} from "@/lib/engagement/translation";

const paramsSchema = z.object({
  shareToken: z.string().min(8).max(64),
  itemId: z.string().uuid(),
});

const bodySchema = z.object({ language: z.string().min(2).max(16) });

type RouteContext = { params: Promise<{ shareToken: string; itemId: string }> };
type SupabaseServiceClient = ReturnType<typeof createServiceRoleClient>;

type ApprovedItem = {
  id: string;
  workspaceId: string;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
};

/**
 * POST — machine-translate ONE approved community comment into a supported
 * language for reading. E8 (multilingual). Notes:
 * - Only APPROVED items in an ACTIVE campaign are translatable; anything else
 *   returns the same 404 as a missing item, so pending/rejected/foreign items
 *   can't be enumerated (mirrors the vote route).
 * - Translations are CACHED into metadata_json.ai_translations[lang]. The
 *   supported-language set is bounded (~11), so an item accrues at most a
 *   handful of cached entries regardless of request volume — repeat requests
 *   never re-hit the model. The per-workspace AI rate limit guards the FIRST
 *   (uncached) translation of each (item, language).
 * - AI-offline safe: with no key the lib returns source:"unavailable" and this
 *   still responds 200 (the client keeps showing the original text).
 */
async function resolveApprovedItem(
  supabase: SupabaseServiceClient,
  audit: ReturnType<typeof createApiAuditLogger>,
  shareToken: string,
  itemId: string
): Promise<{ ok: true; item: ApprovedItem } | { ok: false; response: NextResponse }> {
  const { data: campaign, error: campaignError } = await supabase
    .from("engagement_campaigns")
    .select("id, workspace_id, status")
    .eq("share_token", shareToken)
    .eq("status", "active")
    .maybeSingle();

  if (campaignError) {
    audit.error("engagement_translate_campaign_lookup_failed", { message: campaignError.message });
    return { ok: false, response: NextResponse.json({ error: "Failed to verify campaign" }, { status: 500 }) };
  }
  if (!campaign) {
    return { ok: false, response: NextResponse.json({ error: "Campaign not found or not publicly available" }, { status: 404 }) };
  }

  const { data: item, error: itemError } = await supabase
    .from("engagement_items")
    .select("id, title, body, metadata_json")
    .eq("id", itemId)
    .eq("campaign_id", campaign.id)
    .eq("status", "approved")
    .maybeSingle();

  if (itemError) {
    audit.error("engagement_translate_item_lookup_failed", { campaignId: campaign.id, itemId, message: itemError.message });
    return { ok: false, response: NextResponse.json({ error: "Failed to verify feedback item" }, { status: 500 }) };
  }
  if (!item) {
    return { ok: false, response: NextResponse.json({ error: "Feedback item not found" }, { status: 404 }) };
  }

  return {
    ok: true,
    item: {
      id: item.id,
      workspaceId: campaign.workspace_id as string,
      title: (item.title as string | null) ?? null,
      body: (item.body as string) ?? "",
      metadata: ((item.metadata_json as Record<string, unknown> | null) ?? {}),
    },
  };
}

function readCachedTranslation(metadata: Record<string, unknown>, language: TranslationLanguage): string | null {
  const bag = metadata.ai_translations;
  if (!bag || typeof bag !== "object") return null;
  const value = (bag as Record<string, unknown>)[language];
  return typeof value === "string" ? value : null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.public_translate", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid translate route params" }, { status: 400 });
    }

    const bodyRead = await readJsonWithLimit(request, BODY_LIMITS.adminTriageJson);
    if (!bodyRead.ok) return bodyRead.response;

    const parsedBody = bodySchema.safeParse(bodyRead.data);
    if (!parsedBody.success || !isTranslationLanguage(parsedBody.data.language)) {
      return NextResponse.json({ error: "Unsupported translation language" }, { status: 400 });
    }
    const language = parsedBody.data.language;

    const supabase = createServiceRoleClient();
    const resolved = await resolveApprovedItem(supabase, audit, parsedParams.data.shareToken, parsedParams.data.itemId);
    if (!resolved.ok) return resolved.response;
    const { item } = resolved;

    // Cache hit: return without any model call or rate-limit charge.
    const cached = readCachedTranslation(item.metadata, language);
    if (cached !== null) {
      return NextResponse.json({ source: "cache", language, translated: cached }, { status: 200 });
    }

    // First (uncached) translation of this (item, language): guard cost.
    const rateLimit = await checkAiUsageRateLimit(item.workspaceId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many translation requests right now. Please try again shortly." },
        { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds ?? 60) } }
      );
    }

    const sourceText = item.title ? `${item.title}\n\n${item.body}` : item.body;
    const result = await translateEngagementText({ text: sourceText, targetLanguage: language });

    if (result.source !== "ai" || result.translated === null) {
      // AI-offline / model error → the client keeps showing the original.
      return NextResponse.json({ source: "unavailable", language, translated: null, caveat: result.caveat }, { status: 200 });
    }

    // Cache into metadata_json.ai_translations[lang] via an ATOMIC db-side jsonb
    // merge (migration 098) rather than a client read-modify-write, so two
    // concurrent translations of the same comment into different languages can't
    // clobber each other's cache write. Non-fatal — we still return the
    // translation the caller just paid for even if the cache write fails.
    const { error: cacheError } = await supabase.rpc("engagement_cache_item_translation", {
      p_item_id: item.id,
      p_language: language,
      p_translation: result.translated,
    });
    if (cacheError) {
      audit.warn("engagement_translation_cache_write_failed", { itemId: item.id, message: cacheError.message });
    }

    await recordUsageEventBestEffort(
      {
        workspaceId: item.workspaceId,
        eventKey: "engagement_translation",
        bucketKey: "engagement_synthesis",
        sourceRoute: "/api/engage/[shareToken]/items/[itemId]/translate",
        metadata: { itemId: item.id, language, model: result.model },
      },
      audit
    );

    return NextResponse.json({ source: "ai", language, translated: result.translated, caveat: result.caveat }, { status: 200 });
  } catch (error) {
    audit.error("engage_public_translate_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while translating" }, { status: 500 });
  }
}
