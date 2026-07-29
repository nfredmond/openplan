import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import {
  CONTEXT_LAYER_SUMMARY_COLUMNS,
  contextLayerPublicationWarning,
} from "@/lib/engagement/context-layers";

/**
 * One GIS context layer: rename, restyle, reorder, publish, unpublish, delete.
 *
 * PUBLISHING IS THE INTERESTING ONE. `visible_to_participants` is the switch
 * that makes a layer world-readable through the campaign's share link — the
 * engagement portal is unauthenticated by design, so there is no smaller
 * audience available. The route echoes the plain-language consequence back on
 * every request that turns it on, so the confirmation the operator sees is
 * generated from the same place the write happens rather than being a sentence
 * someone remembered to put in the UI.
 */

const paramsSchema = z.object({
  campaignId: z.string().uuid(),
  layerId: z.string().uuid(),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, "color must be a #RRGGBB hex string")
      .optional(),
    visibleToParticipants: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No changes were requested" });

const DUPLICATE_KEY_CODE = "23505";

type RouteContext = { params: Promise<{ campaignId: string; layerId: string }> };

/**
 * Discriminated on `ok` rather than on the presence of a `failure` key: `in`
 * narrowing over two differently-shaped objects widens the refused branch, and
 * a handler that returns `NextResponse | undefined` is a 200-with-no-body
 * waiting to happen.
 */
type Authorized =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: { id: string };
      campaign: { id: string; workspace_id: string };
      layerId: string;
    };

async function authorize(
  rawParams: unknown,
  audit: ReturnType<typeof createApiAuditLogger>
): Promise<Authorized> {
  const parsedParams = paramsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return { ok: false, response: NextResponse.json({ error: "Invalid campaign or layer id" }, { status: 400 }) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

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

  return {
    ok: true,
    supabase,
    user,
    campaign: access.campaign as { id: string; workspace_id: string },
    layerId: parsedParams.data.layerId,
  };
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("engagement.context_layers.update", request);

  try {
    const authorized = await authorize(await context.params, audit);
    if (!authorized.ok) return authorized.response;

    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;

    const parsed = patchSchema.safeParse(body.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid map layer update" }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description || null;
    if (parsed.data.color !== undefined) patch.display_color = parsed.data.color;
    if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;
    if (parsed.data.visibleToParticipants !== undefined) {
      patch.visible_to_participants = parsed.data.visibleToParticipants;
    }

    const result = await authorized.supabase
      .from("engagement_context_layers")
      .update(patch)
      .eq("id", authorized.layerId)
      .eq("campaign_id", authorized.campaign.id)
      .select(CONTEXT_LAYER_SUMMARY_COLUMNS)
      .maybeSingle();

    if (isWriteFailure(result.error)) {
      if (result.error?.code === DUPLICATE_KEY_CODE) {
        return NextResponse.json(
          { error: "This campaign already has a map layer with that name. Choose a different one." },
          { status: 409 }
        );
      }
      audit.error("context_layer_update_failed", {
        campaignId: authorized.campaign.id,
        layerId: authorized.layerId,
        message: result.error?.message ?? "unknown",
        code: result.error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update the map layer" }, { status: 500 });
    }

    if (writeMatchedNoRows(result)) {
      // The layer row itself was never read before this write, so zero rows is
      // the ordinary answer to "does this layer exist on this campaign".
      return noRowsMatchedResponse({ subject: "map layer", targetWasVerified: false });
    }

    const layer = result.data as unknown as { id: string; name: string; visible_to_participants: boolean };

    audit.info("context_layer_updated", {
      userId: authorized.user.id,
      campaignId: authorized.campaign.id,
      layerId: layer.id,
      visibleToParticipants: layer.visible_to_participants,
      fields: Object.keys(patch).filter((key) => key !== "updated_at"),
    });

    return NextResponse.json({
      layer,
      publicationWarning: layer.visible_to_participants ? contextLayerPublicationWarning(layer.name) : null,
    });
  } catch (error) {
    audit.error("context_layer_update_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while updating the map layer" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("engagement.context_layers.delete", request);

  try {
    const authorized = await authorize(await context.params, audit);
    if (!authorized.ok) return authorized.response;

    const result = await authorized.supabase
      .from("engagement_context_layers")
      .delete()
      .eq("id", authorized.layerId)
      .eq("campaign_id", authorized.campaign.id)
      .select("id")
      .maybeSingle();

    if (isWriteFailure(result.error)) {
      audit.error("context_layer_delete_failed", {
        campaignId: authorized.campaign.id,
        layerId: authorized.layerId,
        message: result.error?.message ?? "unknown",
        code: result.error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to remove the map layer" }, { status: 500 });
    }

    if (writeMatchedNoRows(result)) {
      return noRowsMatchedResponse({ subject: "map layer", targetWasVerified: false });
    }

    audit.info("context_layer_deleted", {
      userId: authorized.user.id,
      campaignId: authorized.campaign.id,
      layerId: authorized.layerId,
    });

    return NextResponse.json({ deleted: true, layerId: authorized.layerId });
  } catch (error) {
    audit.error("context_layer_delete_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while removing the map layer" }, { status: 500 });
  }
}
