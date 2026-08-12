/**
 * One workspace GIS layer: read it with its version history, restyle it, move
 * which version it draws, archive it, or delete it.
 *
 * REGISTRY DISPOSITION — REFUSED as assistant actions, 2026-08-12, all four
 * writes on this route. Deletion is both a destructive act on a referenced
 * record and a queue-emptying shape; promoting a version is an id-only payload
 * that authors a judgement and silently changes what every map in the product
 * draws; restyling looks harmless but a label-field choice changes what a map
 * SAYS and an opacity of nothing hides a disclosure. Executable form:
 * `src/test/refused-workspace-gis-actions-stay-refused.test.ts`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import {
  isWriteFailure,
  noRowsMatchedResponse,
  writeMatchedNoRows,
} from "@/lib/http/write-outcome";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  WORKSPACE_GIS_LAYER_WITH_VERSION_COLUMNS,
  listWorkspaceGisLayerReferences,
  listWorkspaceGisVersions,
  loadWorkspaceGisLayer,
  mapLayerRow,
} from "@/lib/workspace-gis/store";
import { describeDeletionRefusal } from "@/lib/workspace-gis/references";
import { describeWorkspaceLayerVersion } from "@/lib/workspace-gis/coverage";

type RouteContext = { params: Promise<{ layerId: string }> };

const paramsSchema = z.object({ layerId: z.string().uuid() });

/**
 * A PATCH carries only the fields it changes. `.strict()` is load-bearing
 * rather than stylistic: this route is wider than any single edit, and a
 * payload carrying fields beyond these — a `workspaceId` override, a
 * `featureCount` — is refused outright instead of silently stripped.
 */
const patchLayerSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    opacity: z.number().gt(0).max(1).optional(),
    lineWidth: z.number().gt(0).max(12).optional(),
    labelField: z.string().trim().min(1).max(200).nullable().optional(),
    defaultVisible: z.boolean().optional(),
    sortOrder: z.number().int().min(-1000).max(1000).optional(),
    /** Which upload the maps draw. The database refuses anything unfinished. */
    currentVersionId: z.string().uuid().optional(),
    /** True archives, false restores. Deletion is a separate verb. */
    archived: z.boolean().optional(),
  })
  .strict();

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("workspace-gis.layer.read", request);

  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ error: "Invalid layer id" }, { status: 400 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { layer, error } = await loadWorkspaceGisLayer(supabase, params.data.layerId);
    if (error) {
      audit.error("workspace_gis_layer_read_failed", { message: error });
      return NextResponse.json({ error: "Failed to load the map layer" }, { status: 500 });
    }
    if (!layer) return NextResponse.json({ error: "Map layer not found" }, { status: 404 });

    const [{ versions }, { references }] = await Promise.all([
      listWorkspaceGisVersions(supabase, layer.id),
      listWorkspaceGisLayerReferences(supabase, layer.id),
    ]);

    return NextResponse.json(
      {
        layer,
        versions,
        references,
        notes: layer.currentVersion ? describeWorkspaceLayerVersion(layer.currentVersion) : [],
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("workspace_gis_layer_read_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("workspace-gis.layer.update", request);

  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ error: "Invalid layer id" }, { status: 400 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
    if (!membership || isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Your role in this workspace can read map layers but not change them." },
        { status: 403 }
      );
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;
    const parsed = patchLayerSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid change" },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const edit = parsed.data;
    if (edit.name !== undefined) update.name = edit.name;
    if (edit.description !== undefined) update.description = edit.description;
    if (edit.projectId !== undefined) update.project_id = edit.projectId;
    if (edit.color !== undefined) update.display_color = edit.color;
    if (edit.opacity !== undefined) update.display_opacity = edit.opacity;
    if (edit.lineWidth !== undefined) update.display_line_width = edit.lineWidth;
    if (edit.labelField !== undefined) update.label_field = edit.labelField;
    if (edit.defaultVisible !== undefined) update.default_visible = edit.defaultVisible;
    if (edit.sortOrder !== undefined) update.sort_order = edit.sortOrder;
    if (edit.currentVersionId !== undefined) update.current_version_id = edit.currentVersionId;
    if (edit.archived !== undefined) {
      update.archived_at = edit.archived ? new Date().toISOString() : null;
    }

    if (Object.keys(update).length === 1) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("workspace_gis_layers")
      .update(update)
      .eq("id", params.data.layerId)
      .eq("workspace_id", membership.workspace_id)
      .select(WORKSPACE_GIS_LAYER_WITH_VERSION_COLUMNS)
      .maybeSingle();

    // `isWriteFailure` rather than a bare `if (error)`: "matched no rows" is
    // not a server fault, and this route must be able to tell the two apart
    // before it decides between 404 and 500.
    if (isWriteFailure(error)) {
      // The current-version trigger raises for a version that is unfinished or
      // belongs to another layer. Its message is written for a planner and is
      // the honest one; a generic 500 here would hide the actual rule.
      if (/current_version_id/.test(error?.message ?? "")) {
        return NextResponse.json(
          {
            error:
              "That upload cannot be the one this layer draws: it is either unfinished or belongs to a different layer. " +
              "A layer only ever draws a complete upload of its own.",
          },
          { status: 409 }
        );
      }
      if (error?.code === "23505") {
        return NextResponse.json(
          { error: "This workspace already has a live map layer with that name." },
          { status: 409 }
        );
      }
      audit.error("workspace_gis_layer_update_failed", {
        layerId: params.data.layerId,
        message: error?.message ?? null,
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to change the map layer" }, { status: 500 });
    }

    // The route wrote straight at an id from the URL without reading the row
    // first, so zero rows is the ordinary answer to "does this exist and may
    // you change it" — 404, deliberately not 403, because distinguishing them
    // would confirm the existence of rows in other workspaces.
    if (writeMatchedNoRows({ data, error })) {
      return noRowsMatchedResponse({ subject: "map layer", targetWasVerified: false });
    }

    return NextResponse.json({ layer: mapLayerRow(data as unknown as Record<string, unknown>) }, { status: 200 });
  } catch (error) {
    audit.error("workspace_gis_layer_update_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

/**
 * DELETE — refused, by name, while anything has adopted the layer.
 *
 * TWO LOCKS, DELIBERATELY. This route reads the reference table first so the
 * planner gets a sentence naming what would break and the offer to archive
 * instead. The foreign key in 20260812000018 refuses the delete anyway if this
 * check is ever removed or raced — which is the point of having both: the
 * message is a courtesy, the key is the rule.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("workspace-gis.layer.delete", request);

  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ error: "Invalid layer id" }, { status: 400 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
    if (!membership || isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Your role in this workspace can read map layers but not delete them." },
        { status: 403 }
      );
    }

    const { layer, error: loadError } = await loadWorkspaceGisLayer(supabase, params.data.layerId);
    if (loadError) {
      audit.error("workspace_gis_layer_delete_load_failed", { message: loadError });
      return NextResponse.json({ error: "Failed to load the map layer" }, { status: 500 });
    }
    if (!layer) return NextResponse.json({ error: "Map layer not found" }, { status: 404 });

    const { references, error: referencesError } = await listWorkspaceGisLayerReferences(
      supabase,
      layer.id
    );
    if (referencesError) {
      // A read that FAILED establishes nothing about what uses this layer.
      // Deleting on an unknown is how an adopted plan stops resolving.
      audit.error("workspace_gis_layer_delete_references_failed", { message: referencesError });
      return NextResponse.json(
        {
          error:
            "OpenPlan could not check what uses this layer, so it was not deleted. Nothing was changed; try again.",
        },
        { status: 500 }
      );
    }

    if (references.length > 0) {
      return NextResponse.json(
        {
          error: describeDeletionRefusal(layer.name, references),
          references,
          deletable: false,
        },
        { status: 409 }
      );
    }

    // `.select("id")` so the delete can SEE whether it removed anything. A
    // delete that matched nothing and reported success is how a planner comes
    // back to a layer they were told was gone.
    const { data: deleted, error } = await supabase
      .from("workspace_gis_layers")
      .delete()
      .eq("id", layer.id)
      .eq("workspace_id", membership.workspace_id)
      .select("id");

    if (isWriteFailure(error)) {
      // 23503 = the foreign key refused it. Something adopted this layer
      // between the check above and here.
      if (error?.code === "23503") {
        return NextResponse.json(
          {
            error:
              `"${layer.name}" is now in use by something else and was not deleted. Reload the layer list to see what, ` +
              `or archive it instead.`,
            deletable: false,
          },
          { status: 409 }
        );
      }
      audit.error("workspace_gis_layer_delete_failed", {
        layerId: layer.id,
        message: error?.message ?? null,
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to delete the map layer" }, { status: 500 });
    }

    // This route READ the layer through the caller's own client moments ago, so
    // zero rows means the application believed a delete was allowed and the
    // database disagreed — a missing policy, not a missing row. That is a 500
    // that says so, rather than a 404 sending the planner to look for a layer
    // that is still there.
    if (Array.isArray(deleted) && deleted.length === 0) {
      audit.error("workspace_gis_layer_delete_matched_no_rows", { layerId: layer.id });
      return noRowsMatchedResponse({ subject: "map layer", targetWasVerified: true });
    }

    audit.info("workspace_gis_layer_deleted", {
      workspaceId: membership.workspace_id,
      layerId: layer.id,
    });
    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (error) {
    audit.error("workspace_gis_layer_delete_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
