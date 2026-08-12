/**
 * Closing an upload — as complete, or as failed.
 *
 * FINALIZING IS NOT THE RULE, IT IS THE REQUEST TO APPLY IT. `ingest_status =
 * 'ready'` is CHECK-constrained in 20260812000015 to mean the count that
 * arrived equals the count declared when the ingest opened, so a client that
 * calls this early cannot talk its way past it. This route checks the same
 * thing first only so the planner gets a sentence instead of a constraint name.
 *
 * PROMOTION HAPPENS HERE, DELIBERATELY. A finished upload becomes the version
 * the maps draw. That is what a planner uploading a file means, and leaving it
 * un-promoted would ship the shipped-invisible defect in its purest form: a
 * complete, stored, tested layer that no map draws and no button reveals.
 * Rolling back to an earlier version is a separate, explicit act on the layer.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { describeIncompleteIngest } from "@/lib/workspace-gis/ingest";
import {
  WORKSPACE_GIS_VERSION_COLUMNS,
  mapVersionRow,
} from "@/lib/workspace-gis/store";
import { WORKSPACE_GIS_INGEST_FAILURE_REASONS } from "@/lib/workspace-gis/types";
import type { WorkspaceGisIngestFinalizeResponse } from "@/lib/workspace-gis/types";

type RouteContext = { params: Promise<{ versionId: string }> };

const paramsSchema = z.object({ versionId: z.string().uuid() });

/**
 * The body is optional: no body finalizes. A body may only record a FAILURE,
 * and only from the fixed vocabulary — the sentence a planner reads is written
 * from that code, so a client cannot author the explanation of its own failure.
 */
const finalizeSchema = z
  .object({
    failed: z.literal(true),
    reason: z.enum(WORKSPACE_GIS_INGEST_FAILURE_REASONS),
  })
  .strict();

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("workspace-gis.ingest.finalize", request);

  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ error: "Invalid upload id" }, { status: 400 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
    if (!membership || isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Your role in this workspace can read map layers but not upload them." },
        { status: 403 }
      );
    }

    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;

    let failure: { reason: string } | null = null;
    if (body.data !== null && body.data !== undefined) {
      const parsed = finalizeSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "A finalize call either sends nothing, or records a failure from the known reasons." },
          { status: 400 }
        );
      }
      failure = { reason: parsed.data.reason };
    }

    const { data: versionRow, error: readError } = await supabase
      .from("workspace_gis_layer_versions")
      .select(WORKSPACE_GIS_VERSION_COLUMNS)
      .eq("id", params.data.versionId)
      .maybeSingle();

    if (readError) {
      audit.error("workspace_gis_finalize_read_failed", { message: readError.message });
      return NextResponse.json({ error: "Failed to read the upload" }, { status: 500 });
    }
    if (!versionRow) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

    const version = mapVersionRow(versionRow as unknown as Record<string, unknown>);

    if (failure) {
      const { data, error } = await supabase
        .from("workspace_gis_layer_versions")
        .update({ ingest_status: "failed", ingest_failure_reason: failure.reason })
        .eq("id", version.id)
        .eq("ingest_status", "receiving")
        .select(WORKSPACE_GIS_VERSION_COLUMNS)
        .maybeSingle();

      // `isWriteFailure` rather than a bare `if (error)`: PostgREST reports
      // "matched no rows" as an error under `.single()` and as a null row under
      // `.maybeSingle()`, and folding the first into a 500 turns "this upload
      // already finished" into "something broke on the server".
      if (isWriteFailure(error)) {
        audit.error("workspace_gis_finalize_fail_failed", { message: error?.message ?? null });
        return NextResponse.json({ error: "Failed to record the upload failure" }, { status: 500 });
      }
      if (writeMatchedNoRows({ data, error })) {
        return NextResponse.json(
          { error: "This upload is already finished; it cannot now be recorded as failed." },
          { status: 409 }
        );
      }
      audit.info("workspace_gis_ingest_failed", {
        versionId: version.id,
        reason: failure.reason,
      });
      return NextResponse.json(
        {
          version: mapVersionRow(data as unknown as Record<string, unknown>),
          becameCurrent: false,
        } satisfies WorkspaceGisIngestFinalizeResponse,
        { status: 200 }
      );
    }

    if (version.ingestStatus === "ready") {
      // Idempotent: a client that lost the reply to its finalize may send it
      // again, and the honest answer is the finished version, not an error.
      return NextResponse.json(
        { version, becameCurrent: false } satisfies WorkspaceGisIngestFinalizeResponse,
        { status: 200 }
      );
    }

    if (version.ingestStatus !== "receiving") {
      return NextResponse.json(
        { error: "This upload was recorded as failed and cannot be finished." },
        { status: 409 }
      );
    }

    if (version.featureCount !== version.declaredFeatureCount) {
      return NextResponse.json(
        {
          error: describeIncompleteIngest(version.featureCount, version.declaredFeatureCount),
          featureCount: version.featureCount,
          declaredFeatureCount: version.declaredFeatureCount,
        },
        { status: 409 }
      );
    }

    const { data: finalized, error: finalizeError } = await supabase
      .from("workspace_gis_layer_versions")
      .update({ ingest_status: "ready", finalized_at: new Date().toISOString() })
      .eq("id", version.id)
      .eq("ingest_status", "receiving")
      .select(WORKSPACE_GIS_VERSION_COLUMNS)
      .maybeSingle();

    if (isWriteFailure(finalizeError)) {
      audit.error("workspace_gis_finalize_failed", {
        versionId: version.id,
        message: finalizeError?.message ?? null,
        code: finalizeError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to finish the upload" }, { status: 500 });
    }
    // Zero rows here is not a 404 and not a 500: the version was read a moment
    // ago through this same client, so it exists and is visible — what changed
    // is its status, which means another request finalized or failed it first.
    // That is a conflict, and saying so is what tells the client to re-read
    // rather than retry.
    if (writeMatchedNoRows({ data: finalized, error: finalizeError })) {
      return NextResponse.json(
        { error: "This upload is no longer open; nothing was changed." },
        { status: 409 }
      );
    }

    // The layer now draws it. The trigger on workspace_gis_layers re-checks
    // that the version is ready and belongs to this layer, so this UPDATE
    // cannot promote something the CHECK above would have refused.
    // `.select("id")` is not decoration: without it this UPDATE cannot see
    // whether it changed anything, and a promotion that matched no rows would
    // report the layer as drawing a version it is not.
    const { data: promoted, error: promoteError } = await supabase
      .from("workspace_gis_layers")
      .update({ current_version_id: version.id, updated_at: new Date().toISOString() })
      .eq("id", version.layerId)
      .eq("workspace_id", membership.workspace_id)
      .select("id");

    const promotionMissed =
      !promoteError && Array.isArray(promoted) && promoted.length === 0;

    if (promoteError || promotionMissed) {
      // The geometry IS stored and the version IS complete; only the pointer
      // failed to move. Say exactly that rather than reporting a failed upload.
      audit.error("workspace_gis_promote_failed", {
        versionId: version.id,
        layerId: version.layerId,
        message: promoteError?.message ?? "the update matched no rows",
      });
      return NextResponse.json(
        {
          version: mapVersionRow(finalized as unknown as Record<string, unknown>),
          becameCurrent: false,
          warning:
            "The upload finished and is stored, but this layer is still drawing its previous version. Switch to the " +
            "new version from the layer's history.",
        },
        { status: 200 }
      );
    }

    audit.info("workspace_gis_ingest_finalized", {
      workspaceId: membership.workspace_id,
      layerId: version.layerId,
      versionId: version.id,
      featureCount: version.featureCount,
    });

    return NextResponse.json(
      {
        version: mapVersionRow(finalized as unknown as Record<string, unknown>),
        becameCurrent: true,
      } satisfies WorkspaceGisIngestFinalizeResponse,
      { status: 200 }
    );
  } catch (error) {
    audit.error("workspace_gis_finalize_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while finishing the upload" },
      { status: 500 }
    );
  }
}
