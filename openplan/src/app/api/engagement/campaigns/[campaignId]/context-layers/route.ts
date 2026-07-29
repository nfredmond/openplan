import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { readBytesWithLimit } from "@/lib/http/body-limit";
import {
  CONTEXT_LAYER_SUMMARY_COLUMNS,
  contextLayerByteCapMessage,
  describeContextLayerSrs,
  loadCampaignContextLayerSummaries,
  resolveContextLayerByteCap,
  resolveContextLayerFeatureCap,
} from "@/lib/engagement/context-layers";
import { importContextLayer } from "@/lib/engagement/context-layer-import";

/**
 * GIS context layers on one engagement campaign.
 *
 * GET  — every layer, published or not (operator management view, no geometry).
 * POST — upload a GeoJSON / KML / KMZ / zipped shapefile as raw request bytes.
 *
 * A layer is created HIDDEN. Publishing is a separate, deliberate PATCH on the
 * layer, because turning `visible_to_participants` on puts the geometry in front
 * of every unauthenticated visitor holding the campaign's share link, and an
 * upload button is not consent to publish.
 *
 * The raw body carries the file; the small metadata rides in the query string,
 * the same shape as the public photo-upload route. `readBytesWithLimit` is used
 * even when this deployment sets no cap, so the route keeps the one body reader
 * the API inventory guard requires.
 */

const paramsSchema = z.object({ campaignId: z.string().uuid() });

const uploadQuerySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  /**
   * The legend entry a resident reads. Optional at upload only because the
   * filename the operator chose is itself operator-written text; the management
   * panel pre-fills it from the file and the operator can rename it. It is never
   * machine-invented.
   */
  name: z.string().trim().min(1).max(120).optional(),
  /** A note rendered under the name in the participant legend. */
  description: z.string().trim().max(2000).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "color must be a #RRGGBB hex string")
    .optional(),
});

const DUPLICATE_KEY_CODE = "23505";

type RouteContext = { params: Promise<{ campaignId: string }> };

function filenameStem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).trim();
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.context_layers.list", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, parsedParams.data.campaignId, user.id, "engagement.read");
    if (access.error) {
      audit.error("campaign_access_failed", {
        campaignId: parsedParams.data.campaignId,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    }
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    const { layers, readFailure } = await loadCampaignContextLayerSummaries(supabase, access.campaign.id);

    // A failed read is reported as a failure, never as an empty list — an empty
    // list here would read as "this campaign has no context layers".
    if (readFailure) {
      audit.error("context_layers_read_failed", { campaignId: access.campaign.id, message: readFailure });
      return NextResponse.json(
        { error: "Failed to read the campaign's map layers", details: readFailure },
        { status: 500 }
      );
    }

    return NextResponse.json({ layers });
  } catch (error) {
    audit.error("context_layers_list_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while reading map layers" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.context_layers.upload", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const url = new URL(request.url);
    const parsedQuery = uploadQuerySchema.safeParse({
      filename: url.searchParams.get("filename") ?? undefined,
      name: url.searchParams.get("name") ?? undefined,
      description: url.searchParams.get("description") ?? undefined,
      color: url.searchParams.get("color") ?? undefined,
    });
    if (!parsedQuery.success) {
      audit.warn("validation_failed", { issues: parsedQuery.error.issues });
      return NextResponse.json(
        { error: "A layer upload needs a filename, and a name of 120 characters or fewer." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, parsedParams.data.campaignId, user.id, "engagement.write");
    if (access.error) {
      audit.error("campaign_access_failed", {
        campaignId: parsedParams.data.campaignId,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    }
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    // THE BODY IS READ ONLY AFTER THE CALLER IS KNOWN TO BE ALLOWED TO WRITE.
    // `readBytesWithLimit` buffers the whole request into memory, and the
    // operator ceiling below is UNSET on a default deployment, so reading first
    // would let anyone at all — signed out, or a viewer in someone else's
    // workspace — push an unbounded body into this process before being turned
    // away. Authorizing first costs nothing: the file is not needed until the
    // import, and a rejected caller's bytes are never buffered.
    const byteCap = resolveContextLayerByteCap();
    const bodyRead = await readBytesWithLimit(request, byteCap ?? Number.MAX_SAFE_INTEGER);
    if (!bodyRead.ok) {
      // Only reachable when this deployment's operator configured a cap. The
      // generic "request body too large" is replaced by one that names who can
      // change it, because OpenPlan sells nothing and there is no upgrade.
      audit.warn("context_layer_upload_over_byte_cap", { byteLength: bodyRead.byteLength, capBytes: byteCap });
      return NextResponse.json(
        { error: contextLayerByteCapMessage(byteCap ?? bodyRead.byteLength, bodyRead.byteLength) },
        { status: 413 }
      );
    }

    const imported = importContextLayer({
      filename: parsedQuery.data.filename,
      bytes: bodyRead.bytes,
      featureCap: resolveContextLayerFeatureCap(),
    });

    if (!imported.ok) {
      // 415 for "this is not a shape of file I read", 422 for "I read it and it
      // cannot be placed honestly". The distinction matters to the planner: the
      // first is a wrong export format, the second is a wrong projection.
      const status = imported.reason === "unsupported_format" ? 415 : 422;
      audit.warn("context_layer_import_refused", {
        campaignId: access.campaign.id,
        reason: imported.reason,
        filename: parsedQuery.data.filename,
      });
      return NextResponse.json({ error: imported.message, reason: imported.reason }, { status });
    }

    const name = parsedQuery.data.name ?? filenameStem(parsedQuery.data.filename);
    if (!name) {
      return NextResponse.json(
        { error: "This layer needs a name — it is the legend entry participants read." },
        { status: 400 }
      );
    }

    const { data: layer, error: insertError } = await supabase
      .from("engagement_context_layers")
      .insert({
        campaign_id: access.campaign.id,
        workspace_id: access.campaign.workspace_id,
        name,
        description: parsedQuery.data.description || null,
        source_format: imported.format,
        source_filename: parsedQuery.data.filename,
        source_byte_size: bodyRead.byteLength,
        srs_authority: imported.srs.authority,
        srs_code: imported.srs.code,
        srs_name: imported.srs.name,
        srs_basis: imported.srs.basis,
        geometry_kinds: imported.geometryKinds,
        feature_count: imported.featureCount,
        source_feature_count: imported.sourceFeatureCount,
        dropped_feature_count: imported.droppedFeatureCount,
        truncated: imported.truncated,
        features: imported.featureCollection,
        bbox: imported.bbox,
        ...(parsedQuery.data.color ? { display_color: parsedQuery.data.color } : {}),
        // Never published by an upload. See the module header.
        visible_to_participants: false,
        created_by: user.id,
      })
      .select(CONTEXT_LAYER_SUMMARY_COLUMNS)
      .single();

    if (insertError || !layer) {
      if (insertError?.code === DUPLICATE_KEY_CODE) {
        return NextResponse.json(
          { error: `This campaign already has a map layer called “${name}”. Give this one a different name.` },
          { status: 409 }
        );
      }

      audit.error("context_layer_insert_failed", {
        campaignId: access.campaign.id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to save the map layer" }, { status: 500 });
    }

    audit.info("context_layer_created", {
      userId: user.id,
      campaignId: access.campaign.id,
      layerId: (layer as unknown as { id: string }).id,
      format: imported.format,
      featureCount: imported.featureCount,
      truncated: imported.truncated,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        layer,
        // What the file said about itself, in words, so the operator can check
        // the layer landed where they expect BEFORE deciding to publish it.
        srsSummary: describeContextLayerSrs(imported.srs),
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("context_layer_upload_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while saving the map layer" }, { status: 500 });
  }
}
