import { NextRequest, NextResponse } from "next/server";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  AERIAL_ARTIFACT_BUCKET,
  AERIAL_ARTIFACT_CUSTODY_COLUMNS,
  AERIAL_ORTHO_PREVIEW_KIND,
} from "@/lib/aerial/artifact-custody";
import {
  buildAerialOrthoCatalog,
  verifyAerialOrthoCatalogRow,
  type AerialOrthoCatalogRow,
} from "@/lib/aerial/ortho-map-layers";

const CATALOG_LIMIT = 500;
const SIGNED_URL_TTL_SECONDS = 15 * 60;
const CUSTODY_SELECT = `${AERIAL_ARTIFACT_CUSTODY_COLUMNS}, workspace_id, mission_id, created_at, aerial_missions!inner(id, workspace_id, project_id, title, collected_at, projects(name))`;

function expiresAt(): string {
  return new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-layers.aerial-orthos", request);
  const startedAt = Date.now();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
    if (!membership) {
      return NextResponse.json({ state: "absent", layers: [], notes: [] }, { status: 200 });
    }

    const custodyId = request.nextUrl.searchParams.get("custodyId");
    let query = supabase
      .from("aerial_artifact_custody")
      .select(CUSTODY_SELECT)
      .eq("workspace_id", membership.workspace_id)
      .eq("kind", AERIAL_ORTHO_PREVIEW_KIND)
      .order("created_at", { ascending: false })
      .limit(custodyId ? 1 : CATALOG_LIMIT);

    if (custodyId) query = query.eq("id", custodyId);
    const { data, error } = await query;
    if (error) {
      audit.error("aerial_ortho_catalog_read_failed", {
        workspaceId: membership.workspace_id,
        custodyId,
        message: error.message,
      });
      return NextResponse.json(
        {
          state: "unreadable",
          layers: [],
          notes: [
            "OpenPlan could not read the aerial preview catalog. This is not a finding that no imagery exists.",
          ],
        },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as AerialOrthoCatalogRow[];
    if (!custodyId) {
      const catalog = buildAerialOrthoCatalog(rows, membership.workspace_id);
      audit.info("aerial_ortho_catalog_loaded", {
        workspaceId: membership.workspace_id,
        state: catalog.state,
        layerCount: catalog.layers.length,
        matchedRows: rows.length,
        capped: rows.length === CATALOG_LIMIT,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        rows.length === CATALOG_LIMIT
          ? {
              ...catalog,
              notes: [
                ...catalog.notes,
                `The catalog read reached ${CATALOG_LIMIT.toLocaleString()} preview records. Older previews may not be listed.`,
              ],
            }
          : catalog,
        { status: 200 },
      );
    }

    const row = rows[0];
    if (!row) {
      return NextResponse.json(
        { state: "absent", detail: "That aerial preview is not available in this workspace." },
        { status: 404 },
      );
    }
    const verified = verifyAerialOrthoCatalogRow(row, membership.workspace_id);
    if (verified.state !== "verified") {
      return NextResponse.json(
        { state: "unavailable", detail: verified.reason },
        { status: 422 },
      );
    }

    const service = createServiceRoleClient();
    const { data: signed, error: signError } = await service.storage
      .from(AERIAL_ARTIFACT_BUCKET)
      .createSignedUrl(verified.storagePath, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      audit.error("aerial_ortho_sign_failed", {
        workspaceId: membership.workspace_id,
        custodyId,
        message: signError?.message ?? "no signed URL returned",
      });
      return NextResponse.json(
        {
          state: "unreadable",
          detail: "The preview is held, but OpenPlan could not create a display link. Reload to try again.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { state: "verified", layer: { ...verified.layer, url: signed.signedUrl, expiresAt: expiresAt() } },
      { status: 200 },
    );
  } catch (error) {
    audit.error("aerial_ortho_catalog_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json(
      {
        state: "unreadable",
        layers: [],
        notes: [
          "OpenPlan could not read the aerial preview catalog. This is not a finding that no imagery exists.",
        ],
      },
      { status: 500 },
    );
  }
}
