/**
 * REGISTRY DISPOSITION — REFUSED as an assistant action, 2026-08-12. Creating a
 * layer is the front half of writing geometry, and geometry is the one artifact
 * a planner cannot check on an approval sheet: a layer in the wrong place and a
 * layer in the right place look identical there. The executable form of this
 * refusal is `src/test/refused-workspace-gis-actions-stay-refused.test.ts`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  WORKSPACE_GIS_LAYER_WITH_VERSION_COLUMNS,
  listWorkspaceGisLayers,
  mapLayerRow,
} from "@/lib/workspace-gis/store";
import { describeWorkspaceLayerVersion } from "@/lib/workspace-gis/coverage";
import type { WorkspaceGisLayerListing } from "@/lib/workspace-gis/types";

const createLayerSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    // The four style controls. Defaults match the table's, so a wizard that
    // sends none produces the same layer the database would.
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "A layer colour is a #rrggbb hex value.")
      .optional(),
    opacity: z.number().gt(0).max(1).optional(),
    lineWidth: z.number().gt(0).max(12).optional(),
    defaultVisible: z.boolean().optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("workspace-gis.layers.list", request);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
    if (!membership) return NextResponse.json({ layers: [] }, { status: 200 });

    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "1";
    const { layers, error } = await listWorkspaceGisLayers(supabase, {
      workspaceId: membership.workspace_id,
      includeArchived,
    });

    if (error) {
      audit.error("workspace_gis_layers_query_failed", {
        workspaceId: membership.workspace_id,
        message: error,
      });
      return NextResponse.json({ error: "Failed to load map layers" }, { status: 500 });
    }

    // Every caveat the version carries travels WITH the layer, in one payload.
    // A surface that had to ask for them separately would render a layer before
    // it knew what to say about it.
    const listings: WorkspaceGisLayerListing[] = layers.map((layer) => ({
      layer,
      notes: layer.currentVersion ? describeWorkspaceLayerVersion(layer.currentVersion) : [],
    }));

    return NextResponse.json({ layers: listings }, { status: 200 });
  } catch (error) {
    audit.error("workspace_gis_layers_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while loading map layers" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("workspace-gis.layers.create", request);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
    if (!membership) {
      return NextResponse.json({ error: "No workspace membership" }, { status: 403 });
    }
    if (isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Your role in this workspace can read map layers but not add them." },
        { status: 403 }
      );
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;
    const parsed = createLayerSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid layer" },
        { status: 400 }
      );
    }

    const insert: Record<string, unknown> = {
      workspace_id: membership.workspace_id,
      project_id: parsed.data.projectId ?? null,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      default_visible: parsed.data.defaultVisible ?? false,
      created_by: user.id,
    };
    if (parsed.data.color) insert.display_color = parsed.data.color;
    if (parsed.data.opacity !== undefined) insert.display_opacity = parsed.data.opacity;
    if (parsed.data.lineWidth !== undefined) insert.display_line_width = parsed.data.lineWidth;

    const { data, error } = await supabase
      .from("workspace_gis_layers")
      .insert(insert)
      .select(WORKSPACE_GIS_LAYER_WITH_VERSION_COLUMNS)
      .single();

    if (error) {
      // 23505 is the live-name unique index. A planner naming a new upload the
      // same as an existing layer needs to be told which, not shown a code.
      if (error.code === "23505") {
        return NextResponse.json(
          {
            // "…or upload into the existing layer as a new version" was here
            // and pointed at nothing a planner can do: the ingest route accepts
            // a layerId, but the upload wizard is the only way in and it always
            // creates a new layer. Advice that names an unreachable path costs
            // a planner the time it takes to go looking for it.
            error: `This workspace already has a map layer called "${parsed.data.name}". Give this one a different name — both will be kept as separate layers, so you can compare them and remove whichever is wrong.`,
          },
          { status: 409 }
        );
      }
      audit.error("workspace_gis_layer_insert_failed", {
        workspaceId: membership.workspace_id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create the map layer" }, { status: 500 });
    }

    audit.info("workspace_gis_layer_created", {
      workspaceId: membership.workspace_id,
      layerId: String((data as unknown as Record<string, unknown>).id),
    });

    return NextResponse.json({ layer: mapLayerRow(data as unknown as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    audit.error("workspace_gis_layer_create_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while creating the map layer" },
      { status: 500 }
    );
  }
}
