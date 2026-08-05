import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import {
  AI_RATE_LIMIT_BUCKET_KEYS,
  checkAiUsageRateLimit,
  recordAiUsageEvent,
} from "@/lib/runtime/ai-rate-limit";
import { hasAnthropicAccess } from "@/lib/integrations/anthropic-access";
import { isPortalLocale, type PortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { machineTranslationUnavailableReason } from "@/lib/engagement/translation-languages";
import { TRANSLATION_LANGUAGE_LABELS } from "@/lib/engagement/translation-languages";
import { translateEngagementText } from "@/lib/engagement/translation";
import {
  CAMPAIGN_TRANSLATION_COLUMNS,
  ENGAGEMENT_CONTENT_TRANSLATION_BUCKET,
  MACHINE_TRANSLATION_BATCH_MAX,
  TRANSLATION_ACCEPT_BATCH_MAX,
  hashTranslationSource,
  loadCampaignTranslatableFields,
  type CampaignTranslatableField,
} from "@/lib/engagement/campaign-translations";

/**
 * ONE CAMPAIGN'S PORTAL TEXT, IN ANOTHER LANGUAGE — the write side of
 * `engagement_content_translations`.
 *
 * Until this route existed nothing wrote that table, so every per-locale branch
 * of the portal resolver was unreachable and a campaign could only ever be read
 * in the language it was written in. Four actions, and the difference between
 * them is a difference in WHO IS ANSWERABLE for the words:
 *
 *   suggest         — a model drafts it and NOTHING IS SAVED. A starting point,
 *                     on screen, for the operator to correct.
 *   save            — the operator's own wording. `source = 'operator'`, which
 *                     is the agency saying it, so the portal renders it with no
 *                     caveat at all.
 *   publish_machine — model output, STORED and labelled. `source = 'machine'`,
 *                     which the portal discloses on every render. The text comes
 *                     from the model inside THIS request and is never taken from
 *                     the body, so a machine row provably came from a machine.
 *   accept          — promote an existing machine row to operator-authored. This
 *                     is the agency taking responsibility for wording it did not
 *                     write, and the disclosure a resident was reading
 *                     DISAPPEARS when it happens. The panel states that
 *                     consequence before the request is made; this route
 *                     restates it in the response so the confirmation and the
 *                     write come from the same place.
 *
 * WHY THE BODY CANNOT NAME ITS OWN TARGET. A translation is addressed
 * polymorphically — `entity_type` + `entity_id` + `field` — so a client free to
 * choose an address could attach a translation to another campaign's category.
 * Every requested field is resolved through THIS campaign's inventory
 * (`loadCampaignTranslatableFields`, which reads only rows scoped to the
 * campaign), and anything that does not resolve is refused. Campaign scope comes
 * from the database, never from the request.
 *
 * AI-OFFLINE SAFE. With no Anthropic key `suggest` and `publish_machine` answer
 * 200 with `available: false` and a sentence naming the reason. The operator can
 * still author every translation by hand, which is the whole capability; the
 * model is an accelerator, never the door.
 */

const paramsSchema = z.object({ campaignId: z.string().uuid() });

/**
 * The longest translation of one string this will store.
 *
 * NAMED, because the refusal has to be able to say it. The longest source
 * string the product itself permits is a 5,000-character close-loop entry, and
 * a faithful translation of one can be half again as long — so this is a limit
 * an honest operator can actually reach by doing the right thing, not only by
 * abusing the route. `25 × 8000` also still fits inside `BODY_LIMITS.documentJson`
 * below, so the widest legal request is never answered with a 413 instead.
 */
const TRANSLATION_TEXT_MAX = 8000;

const localeSchema = z.string().refine(isPortalLocale, { message: "unsupported language" });

/** `entity:id:field`, as `campaignTranslationFieldKey` builds it. */
const fieldKeySchema = z.string().trim().min(3).max(200);

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("suggest"),
    locale: localeSchema,
    fieldKeys: z.array(fieldKeySchema).min(1).max(MACHINE_TRANSLATION_BATCH_MAX),
  }),
  z.object({
    action: z.literal("publish_machine"),
    locale: localeSchema,
    fieldKeys: z.array(fieldKeySchema).min(1).max(MACHINE_TRANSLATION_BATCH_MAX),
  }),
  z.object({
    action: z.literal("accept"),
    locale: localeSchema,
    // Its own, larger cap: accepting spends nothing and the control an operator
    // reaches for is "accept every machine translation in this language", which
    // a thirty-question survey pushes past the machine batch without being
    // unusual. The panel slices to the same constant.
    fieldKeys: z.array(fieldKeySchema).min(1).max(TRANSLATION_ACCEPT_BATCH_MAX),
  }),
  z.object({
    action: z.literal("save"),
    locale: localeSchema,
    entries: z
      .array(
        z.object({
          fieldKey: fieldKeySchema,
          // The table refuses blank text, and it is right to: an empty
          // "translation" replaces something a resident could read with
          // nothing and reports success doing it. Removing a translation is
          // DELETE, which says what it means.
          text: z.string().trim().min(1).max(TRANSLATION_TEXT_MAX),
        })
      )
      .min(1)
      // Bounded so the widest legal request still fits inside the body limit
      // below. A cap that a valid request can exceed is a 413 nobody can act on.
      .max(MACHINE_TRANSLATION_BATCH_MAX),
  }),
]);

const deleteQuerySchema = z.object({
  locale: localeSchema,
  fieldKey: fieldKeySchema,
});

type RouteContext = { params: Promise<{ campaignId: string }> };

type Authorized =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: { id: string };
      campaign: {
        id: string;
        workspace_id: string;
        title?: string | null;
        summary?: string | null;
        public_description?: string | null;
      };
    };

/**
 * Discriminated on `ok` rather than on the presence of a key, for the reason the
 * context-layer route records: `in` narrowing over two differently-shaped
 * objects widens the refused branch, and a handler that can return `undefined`
 * is a 200-with-no-body waiting to happen.
 */
async function authorize(
  rawParams: unknown,
  audit: ReturnType<typeof createApiAuditLogger>
): Promise<Authorized> {
  const parsedParams = paramsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return { ok: false, response: NextResponse.json({ error: "Invalid campaign id" }, { status: 400 }) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // The same loader, with the same action, that the campaign console asks before
  // it renders a single control — so the panel and this route cannot disagree
  // about who gets a button. Publishing an agency's official wording in another
  // language is unambiguously a write, and the viewer tier's whole contract is
  // "read everything, change nothing".
  const access = await loadCampaignAccess(supabase, parsedParams.data.campaignId, user.id, "engagement.write");
  if (access.error) {
    audit.error("campaign_access_failed", {
      campaignId: parsedParams.data.campaignId,
      message: access.error.message,
      code: access.error.code ?? null,
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 }),
    };
  }
  if (!access.campaign) {
    return { ok: false, response: NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 }) };
  }
  if (!access.allowed) {
    return { ok: false, response: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) };
  }

  return { ok: true, supabase, user, campaign: access.campaign };
}

/**
 * Resolve requested keys against what this campaign actually shows a
 * participant. Unknown keys are returned rather than ignored: an operator whose
 * browser is holding a field that has since been archived is owed the sentence
 * saying so, not a silent partial write.
 */
function resolveFields(
  inventory: CampaignTranslatableField[],
  fieldKeys: string[]
): { resolved: CampaignTranslatableField[]; unknown: string[] } {
  const byKey = new Map(inventory.map((field) => [field.key, field]));
  const resolved: CampaignTranslatableField[] = [];
  const unknown: string[] = [];

  // De-duplicated, so a repeated key cannot become two model calls or two
  // conflicting rows in one upsert (PostgREST rejects the latter outright).
  for (const key of new Set(fieldKeys)) {
    const field = byKey.get(key);
    if (field) resolved.push(field);
    else unknown.push(key);
  }

  return { resolved, unknown };
}

function unknownFieldsResponse(unknown: string[]): NextResponse {
  return NextResponse.json(
    {
      error: "Some of those strings are no longer part of what participants read",
      details:
        `${unknown.length} of the strings in this request could not be found on this campaign. ` +
        "They may have been archived, unpublished, or deleted since this page loaded. Reload the " +
        "campaign and try again — nothing was saved.",
    },
    { status: 409 }
  );
}

/**
 * Machine translation, in a batch, run entirely server-side.
 *
 * `translateEngagementText` reaches the Anthropic access layer (node:crypto via
 * the workspace-integration context), which must never enter a browser bundle;
 * this is the only place in the feature that calls it.
 *
 * Sequential rather than parallel: a batch of 25 fired at once is a burst
 * against one workspace's key for no gain a human would notice, and a partial
 * failure mid-batch is easier to report honestly when the order is known.
 */
async function translateFields(
  fields: CampaignTranslatableField[],
  locale: PortalLocale
): Promise<{ translations: Array<{ field: CampaignTranslatableField; text: string; model: string }>; failedCount: number }> {
  const translations: Array<{ field: CampaignTranslatableField; text: string; model: string }> = [];
  let failedCount = 0;

  for (const field of fields) {
    const result = await translateEngagementText({ text: field.sourceText, targetLanguage: locale });
    const text = typeof result.translated === "string" ? result.translated.trim() : "";
    if (result.source !== "ai" || !text || !result.model) {
      failedCount += 1;
      continue;
    }
    translations.push({ field, text, model: result.model });
  }

  return { translations, failedCount };
}

function machineUnavailableResponse(locale: PortalLocale): NextResponse {
  return NextResponse.json({
    available: false,
    locale,
    suggestions: [],
    // Names the reason rather than showing an empty box. There is nothing to
    // buy: OpenPlan is free, and this is a key the workspace or the deployment
    // supplies.
    reason:
      "Machine translation is unavailable because this workspace and this deployment have no " +
      "Anthropic API key configured. You can still write every translation yourself — hand-written " +
      "translations are the agency's own wording and are what the portal publishes without a caveat.",
  });
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("engagement.translations.write", request);

  try {
    const authorized = await authorize(await context.params, audit);
    if (!authorized.ok) return authorized.response;

    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.documentJson);
    if (!body.ok) return body.response;

    const parsed = bodySchema.safeParse(body.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json(
        {
          error: "Invalid translation request",
          details:
            "A translation request needs a supported language and at least one string to translate. " +
            `Machine translation and saving are limited to ${MACHINE_TRANSLATION_BATCH_MAX} strings ` +
            `per request, and accepting to ${TRANSLATION_ACCEPT_BATCH_MAX}. ` +
            // The length is named because it is reachable by writing a long,
            // correct translation of a long, legitimate update — and a refusal
            // that lists only the limits the operator did not hit reads as a
            // fault with no cause.
            `One translation may be up to ${TRANSLATION_TEXT_MAX} characters; a longer one has to be shortened, ` +
            "or the original it translates split up.",
        },
        { status: 400 }
      );
    }

    const { supabase, user, campaign } = authorized;
    const locale = parsed.data.locale as PortalLocale;
    const languageName = TRANSLATION_LANGUAGE_LABELS[locale];

    // THE INVENTORY IS THE AUTHORIZATION FOR THE ADDRESS. See the header.
    const inventory = await loadCampaignTranslatableFields(supabase, campaign);
    if (inventory.readFailures.length > 0) {
      // A shrunken inventory would refuse valid fields, or worse, let a write
      // land against a field this request could not verify belongs here.
      audit.error("translation_inventory_read_failed", {
        campaignId: campaign.id,
        failures: inventory.readFailures.map((failure) => `${failure.label}: ${failure.message}`),
      });
      return NextResponse.json(
        {
          error: "Could not read what this campaign shows participants",
          details:
            "The list of translatable text could not be read, so nothing was saved. " +
            inventory.readFailures.map((failure) => `${failure.label}: ${failure.message}`).join("; "),
        },
        { status: 500 }
      );
    }

    if (parsed.data.action === "save") {
      const { resolved, unknown } = resolveFields(
        inventory.fields,
        parsed.data.entries.map((entry) => entry.fieldKey)
      );
      if (unknown.length > 0) return unknownFieldsResponse(unknown);

      const textByKey = new Map(parsed.data.entries.map((entry) => [entry.fieldKey, entry.text.trim()]));
      const rows = resolved.map((field) => ({
        workspace_id: campaign.workspace_id,
        campaign_id: campaign.id,
        entity_type: field.entity,
        entity_id: field.entityId,
        field: field.field,
        locale,
        translated_text: textByKey.get(field.key) ?? "",
        source: "operator" as const,
        // Meaningless for an operator row, and the table's own CHECK says so.
        machine_model: null,
        // What this was a translation OF, so a later edit of the original can be
        // reported as such instead of silently leaving a translation of a
        // sentence that no longer exists.
        source_text_hash: hashTranslationSource(field.sourceText),
        // WHO WROTE THE WORDS THAT ARE PUBLISHED NOW. An upsert cannot write a
        // column on insert only, so on a re-save this becomes the LAST author
        // rather than the first. That is the more useful of the two facts here:
        // when an agency is asked who wrote a published sentence, the answer
        // wanted is the person answerable for the wording currently on the
        // portal. The alternative — omitting it — would leave no author at all.
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }));

      const result = await supabase
        .from("engagement_content_translations")
        .upsert(rows, { onConflict: "entity_type,entity_id,field,locale" })
        .select(CAMPAIGN_TRANSLATION_COLUMNS);

      if (result.error) {
        audit.error("translation_save_failed", {
          campaignId: campaign.id,
          locale,
          fieldCount: rows.length,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json(
          { error: `Failed to save the ${languageName} translation`, details: result.error.message },
          { status: 500 }
        );
      }

      audit.info("translations_saved", {
        userId: user.id,
        campaignId: campaign.id,
        locale,
        source: "operator",
        fieldCount: rows.length,
        fields: resolved.map((field) => field.key),
      });

      return NextResponse.json({
        saved: rows.length,
        locale,
        source: "operator",
        // Said back from the place the write happened, not remembered in the UI.
        published: `Saved as your agency's own ${languageName} wording. Participants reading ${languageName} see it with no machine-translation caveat.`,
      });
    }

    if (parsed.data.action === "accept") {
      const { resolved, unknown } = resolveFields(inventory.fields, parsed.data.fieldKeys);
      if (unknown.length > 0) return unknownFieldsResponse(unknown);

      // PROMOTION, not a rewrite: the TEXT is untouched, and so is
      // `source_text_hash` — what this was translated FROM did not change.
      // What changes is who is answerable for it, and therefore whether a
      // resident sees a caveat.
      //
      // GROUPED BY (entity_type, field) rather than done as one query with two
      // `.in()` filters, because two `.in()`s are a CROSS PRODUCT: accepting one
      // topic's name and another topic's description would have matched all four
      // combinations and promoted two translations nobody asked about. Grouping
      // keeps each statement exact, and the number of statements is bounded by
      // the number of distinct translatable columns (currently eleven) rather
      // than by how many topics or questions the campaign has.
      //
      // Filtered on `source = 'machine'` so an operator row cannot be
      // "accepted" into a no-op that reports success, and so a colleague's own
      // wording is never quietly relabelled.
      const byColumn = new Map<string, { entity: string; field: string; entityIds: string[] }>();
      for (const field of resolved) {
        const groupKey = `${field.entity}|${field.field}`;
        const group = byColumn.get(groupKey) ?? { entity: field.entity, field: field.field, entityIds: [] };
        group.entityIds.push(field.entityId);
        byColumn.set(groupKey, group);
      }

      const acceptedKeys: string[] = [];
      for (const group of byColumn.values()) {
        const result = await supabase
          .from("engagement_content_translations")
          .update({
            source: "operator",
            machine_model: null,
            // WHO IS ANSWERABLE FOR THE PUBLISHED WORDS, moved to the person who
            // accepted them. `created_by` is defined in the save path above as
            // the author of the wording currently on the portal, and accepting
            // is precisely the moment that changes: the row stops being a
            // machine's output that someone generated and becomes the agency's
            // own sentence that THIS person put their name to. Leaving it
            // pointing at whoever ran the machine translation would answer "who
            // wrote this Spanish?" with the one person who deliberately did not.
            created_by: user.id,
            updated_at: new Date().toISOString(),
          })
          .eq("campaign_id", campaign.id)
          .eq("locale", locale)
          .eq("source", "machine")
          .eq("entity_type", group.entity)
          .eq("field", group.field)
          .in("entity_id", group.entityIds)
          .select("entity_type, entity_id, field");

        if (isWriteFailure(result.error)) {
          audit.error("translation_accept_failed", {
            campaignId: campaign.id,
            locale,
            entity: group.entity,
            field: group.field,
            message: result.error?.message ?? "unknown",
            code: result.error?.code ?? null,
          });
          return NextResponse.json(
            {
              error: `Failed to accept the ${languageName} machine translation`,
              details: result.error?.message,
              // Said plainly, because a half-applied promotion is a state the
              // operator has to be able to reason about.
              accepted: acceptedKeys.length,
            },
            { status: 500 }
          );
        }

        for (const row of (result.data ?? []) as Array<{ entity_type: string; entity_id: string; field: string }>) {
          acceptedKeys.push(`${row.entity_type}:${row.entity_id}:${row.field}`);
        }
      }

      const accepted = acceptedKeys;
      if (accepted.length === 0) {
        // The rows themselves were never read through this client before the
        // write, so zero matched is the ordinary answer to "is there a machine
        // translation here to accept" — 404, not a disclosed server fault.
        return noRowsMatchedResponse({ subject: "machine translation", targetWasVerified: false });
      }

      audit.info("machine_translations_accepted", {
        userId: user.id,
        campaignId: campaign.id,
        locale,
        // The audited fact that matters: text a model wrote is now published as
        // the agency's own, with the caveat removed.
        promotedToOperator: accepted.length,
        fields: resolved.map((field) => field.key),
      });

      return NextResponse.json({
        accepted: accepted.length,
        locale,
        published: `${accepted.length} machine ${accepted.length === 1 ? "translation is" : "translations are"} now published as your agency's own ${languageName} wording. The machine-translation caveat participants were reading is gone.`,
      });
    }

    // Both remaining actions spend money on a model, so they share the key
    // check, the spend meter, and the workspace-key context.
    const { resolved, unknown } = resolveFields(inventory.fields, parsed.data.fieldKeys);
    if (unknown.length > 0) return unknownFieldsResponse(unknown);

    const wantsPublish = parsed.data.action === "publish_machine";

    // REFUSED BEFORE THE MODEL, and before the key check, because this refusal
    // is a fact about the LANGUAGE rather than about the deployment. A
    // workspace with a perfectly good Anthropic key must still be told no here,
    // and told why — see `MACHINE_TRANSLATION_UNAVAILABLE`. Answering with the
    // no-key sentence instead would send a planner to fix an API key that would
    // not have helped.
    const machineRefusal = machineTranslationUnavailableReason(locale);
    if (machineRefusal) {
      audit.info("machine_translation_refused_for_language", { campaignId: campaign.id, locale });
      return NextResponse.json(
        {
          available: false,
          locale,
          suggestions: [],
          reason: machineRefusal,
          // Distinguishable from the missing-key case by machine, not only by
          // reading the prose: the panel offers "write it yourself" for both,
          // but only one of them is worth an operator changing configuration
          // over.
          refusedForLanguage: true,
        },
        { status: 200 }
      );
    }

    return await withWorkspaceIntegrationContext(campaign.workspace_id, async () => {
      // Checked INSIDE the workspace-key context: a workspace holding its own
      // key must not be told the deployment has none.
      if (!hasAnthropicAccess()) {
        audit.info("machine_translation_unavailable", { campaignId: campaign.id, locale });
        return machineUnavailableResponse(locale);
      }

      const rateLimit = await checkAiUsageRateLimit(campaign.workspace_id, {
        // This route's own bucket is counted alongside the staff buckets, so a
        // scripted loop over every language is bounded by the same window
        // everything else is.
        bucketKeys: [...AI_RATE_LIMIT_BUCKET_KEYS, ENGAGEMENT_CONTENT_TRANSLATION_BUCKET],
      });
      if (!rateLimit.allowed) {
        audit.warn("translation_rate_limited", { workspaceId: campaign.workspace_id, recentCount: rateLimit.count });
        return NextResponse.json(
          { error: "Too many AI requests in a short window. Please wait a moment and try again." },
          { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
        );
      }

      const { translations, failedCount } = await translateFields(resolved, locale);

      if (translations.length > 0) {
        // ONE event per request rather than per string. The window caps requests,
        // and a batch is bounded to MACHINE_TRANSLATION_BATCH_MAX, so the ceiling
        // on spend is still hard — while an operator working through a long
        // campaign never trips a limit meant for scripted abuse.
        void recordAiUsageEvent({
          workspaceId: campaign.workspace_id,
          bucketKey: ENGAGEMENT_CONTENT_TRANSLATION_BUCKET,
          eventKey: `engagement_content_translation:${campaign.id}:${locale}`,
          sourceRoute: "/api/engagement/campaigns/[campaignId]/translations",
          metadataJson: { locale, requested: resolved.length, translated: translations.length },
        });
      }

      // A FAILED TRANSLATION IS NOT AN ABSENT ONE. Reported as its own count so
      // the panel can say which strings the model could not do, rather than
      // leaving them looking untranslated by choice.
      const partial =
        failedCount > 0
          ? `${failedCount} of ${resolved.length} ${failedCount === 1 ? "string" : "strings"} could not be machine translated just now. Those are unchanged — they are not translations that came back empty.`
          : null;

      if (!wantsPublish) {
        return NextResponse.json({
          available: true,
          locale,
          reason: null,
          partial,
          // NOTHING IS SAVED by a suggestion. The operator edits and saves, or
          // publishes it as a labelled machine translation — both deliberate.
          suggestions: translations.map((entry) => ({ fieldKey: entry.field.key, text: entry.text })),
        });
      }

      if (translations.length === 0) {
        return NextResponse.json({
          available: true,
          locale,
          published: 0,
          partial:
            partial ??
            "The model returned nothing usable, so nothing was published. Nothing was changed for participants.",
        });
      }

      const rows = translations.map((entry) => ({
        workspace_id: campaign.workspace_id,
        campaign_id: campaign.id,
        entity_type: entry.field.entity,
        entity_id: entry.field.entityId,
        field: entry.field.field,
        locale,
        translated_text: entry.text,
        source: "machine" as const,
        machine_model: entry.model,
        source_text_hash: hashTranslationSource(entry.field.sourceText),
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }));

      const result = await supabase
        .from("engagement_content_translations")
        .upsert(rows, { onConflict: "entity_type,entity_id,field,locale" })
        .select(CAMPAIGN_TRANSLATION_COLUMNS);

      if (result.error) {
        audit.error("machine_translation_publish_failed", {
          campaignId: campaign.id,
          locale,
          message: result.error.message,
          code: result.error.code ?? null,
        });
        return NextResponse.json(
          { error: `Failed to publish the ${languageName} machine translation`, details: result.error.message },
          { status: 500 }
        );
      }

      audit.info("machine_translations_published", {
        userId: user.id,
        campaignId: campaign.id,
        locale,
        source: "machine",
        fieldCount: rows.length,
        models: [...new Set(rows.map((row) => row.machine_model))],
      });

      return NextResponse.json({
        available: true,
        locale,
        published: rows.length,
        partial,
        publishedNotice: `Published as MACHINE translation. Participants reading ${languageName} see this text with a machine-translation caveat until someone at your agency accepts or replaces it.`,
      });
    });
  } catch (error) {
    audit.error("translations_write_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while saving translations" }, { status: 500 });
  }
}

/**
 * Withdraw one translation.
 *
 * A wrong translation of an official sentence is worse than no translation, so
 * taking one back has to be as reachable as putting one up. The field is
 * addressed in the query string because a DELETE body is not carried reliably by
 * every client between here and the browser.
 */
export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("engagement.translations.delete", request);

  try {
    const authorized = await authorize(await context.params, audit);
    if (!authorized.ok) return authorized.response;

    const url = new URL(request.url);
    const parsed = deleteQuerySchema.safeParse({
      locale: url.searchParams.get("locale") ?? undefined,
      fieldKey: url.searchParams.get("fieldKey") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "A supported language and one string are required" }, { status: 400 });
    }

    const { supabase, user, campaign } = authorized;
    const inventory = await loadCampaignTranslatableFields(supabase, campaign);
    if (inventory.readFailures.length > 0) {
      return NextResponse.json(
        {
          error: "Could not read what this campaign shows participants",
          details: inventory.readFailures.map((failure) => `${failure.label}: ${failure.message}`).join("; "),
        },
        { status: 500 }
      );
    }

    const { resolved, unknown } = resolveFields(inventory.fields, [parsed.data.fieldKey]);
    if (unknown.length > 0 || resolved.length !== 1) return unknownFieldsResponse(unknown);
    const field = resolved[0];

    const result = await supabase
      .from("engagement_content_translations")
      .delete()
      .eq("campaign_id", campaign.id)
      .eq("locale", parsed.data.locale)
      .eq("entity_type", field.entity)
      .eq("entity_id", field.entityId)
      .eq("field", field.field)
      .select("entity_type, entity_id, field, locale")
      .maybeSingle();

    if (isWriteFailure(result.error)) {
      audit.error("translation_delete_failed", {
        campaignId: campaign.id,
        locale: parsed.data.locale,
        message: result.error?.message ?? "unknown",
        code: result.error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to withdraw the translation" }, { status: 500 });
    }

    if (writeMatchedNoRows(result)) {
      // Never read through this client before the write, so zero rows means
      // "there is no such translation" rather than a policy fault.
      return noRowsMatchedResponse({ subject: "translation", targetWasVerified: false });
    }

    audit.info("translation_withdrawn", {
      userId: user.id,
      campaignId: campaign.id,
      locale: parsed.data.locale,
      fieldKey: field.key,
    });

    return NextResponse.json({
      deleted: true,
      locale: parsed.data.locale,
      fieldKey: field.key,
      published: `Withdrawn. Participants reading ${TRANSLATION_LANGUAGE_LABELS[parsed.data.locale as PortalLocale]} now see this text as the project team wrote it, with the disclosure that it is not translated.`,
    });
  } catch (error) {
    audit.error("translations_delete_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while withdrawing the translation" }, { status: 500 });
  }
}
