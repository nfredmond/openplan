/**
 * What would break if this layer went away — read before the delete dialog is
 * shown, so the dialog can name it instead of asking "are you sure?".
 *
 * Read-only. The refusal itself lives in the DELETE verb and, underneath it, in
 * the foreign key.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { listWorkspaceGisLayerReferences, loadWorkspaceGisLayer } from "@/lib/workspace-gis/store";
import { describeDeletionRefusal } from "@/lib/workspace-gis/references";
import type { WorkspaceGisLayerReferencesResponse } from "@/lib/workspace-gis/types";

type RouteContext = { params: Promise<{ layerId: string }> };

const paramsSchema = z.object({ layerId: z.string().uuid() });

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("workspace-gis.layer.references", request);

  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ error: "Invalid layer id" }, { status: 400 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { layer, error: layerError } = await loadWorkspaceGisLayer(supabase, params.data.layerId);
    if (layerError) {
      audit.error("workspace_gis_references_layer_read_failed", { message: layerError });
      return NextResponse.json({ error: "Failed to load the map layer" }, { status: 500 });
    }
    if (!layer) return NextResponse.json({ error: "Map layer not found" }, { status: 404 });

    const { references, error } = await listWorkspaceGisLayerReferences(supabase, layer.id);
    if (error) {
      // Reported as a failure, never as "nothing uses this". An empty list under
      // a failed read is exactly the sentence that gets an adopted plan deleted.
      audit.error("workspace_gis_references_query_failed", { message: error });
      return NextResponse.json(
        { error: "OpenPlan could not check what uses this layer." },
        { status: 500 }
      );
    }

    const payload: WorkspaceGisLayerReferencesResponse = {
      layerId: layer.id,
      references,
      deletable: references.length === 0,
      refusal: references.length === 0 ? null : describeDeletionRefusal(layer.name, references),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    audit.error("workspace_gis_references_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
