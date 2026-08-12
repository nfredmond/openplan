/**
 * One batch of an upload.
 *
 * The whole write path for geometry is the RPC below: `workspace_gis_append_features`
 * is SECURITY INVOKER, so the caller's row security decides both whether this
 * version is theirs and whether they may insert. There is no service-role path
 * into the feature table, and this route holds no privilege the caller does not.
 *
 * A RETRIED BATCH IS A NO-OP, NOT A DUPLICATE. Every feature carries its index
 * in the source file, and the table's UNIQUE (version_id, feature_index) turns
 * a resend into zero inserted rows. That is why `startIndex` is required and
 * why the response reports what was actually written rather than what was sent
 * — a client that retried needs to see 0 and carry on, not conclude it failed.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { readJsonWithLimit } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  WORKSPACE_GIS_BATCH_BYTE_LIMIT,
  validateFeatureBatch,
} from "@/lib/workspace-gis/ingest";
import type { WorkspaceGisIngestAppendResponse } from "@/lib/workspace-gis/types";

type RouteContext = { params: Promise<{ versionId: string }> };

const paramsSchema = z.object({ versionId: z.string().uuid() });

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("workspace-gis.ingest.append", request);

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

    const body = await readJsonWithLimit(request, WORKSPACE_GIS_BATCH_BYTE_LIMIT);
    if (!body.ok) return body.response;

    const batch = validateFeatureBatch(body.data);
    if (!batch.ok) return NextResponse.json({ error: batch.message }, { status: 400 });

    const { data, error } = await supabase.rpc("workspace_gis_append_features", {
      p_version_id: params.data.versionId,
      p_start_index: batch.startIndex,
      p_features: batch.features,
    });

    if (error) {
      // The function raises for a version that is not receiving (finished,
      // failed, or not this member's). Its own words are the honest ones.
      if (/no ingest is open|may only be appended/i.test(error.message)) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      // A geometry PostGIS will not accept aborts the whole batch — nothing
      // partial is stored, which is what makes a retry safe.
      audit.error("workspace_gis_append_failed", {
        versionId: params.data.versionId,
        startIndex: batch.startIndex,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json(
        {
          error:
            "Some shapes in this batch could not be stored as valid longitude/latitude geometry, so none of the batch " +
            "was stored. The upload is unfinished and is not drawn.",
        },
        { status: 422 }
      );
    }

    const insertedCount = typeof data === "number" ? data : 0;

    // Read back the running totals so the client's progress is the DATABASE's
    // count, not its own tally of what it believes it sent.
    //
    // A FAILED READ HERE IS REPORTED, NOT ZEROED. The features ARE stored — the
    // RPC above succeeded — so answering 500 would tell the client to retry a
    // batch that already landed. What is unknown is the progress, and a progress
    // read that quietly returns 0 of 0 makes a finished upload look stalled.
    const countsResult = await supabase
      .from("workspace_gis_layer_versions")
      .select("feature_count, declared_feature_count")
      .eq("id", params.data.versionId)
      .maybeSingle();

    if (countsResult.error) {
      audit.error("workspace_gis_append_progress_read_failed", {
        versionId: params.data.versionId,
        message: countsResult.error.message,
        code: countsResult.error.code ?? null,
      });
    }

    const counts = (countsResult.data ?? {}) as {
      feature_count?: number;
      declared_feature_count?: number;
    };

    const payload: WorkspaceGisIngestAppendResponse = {
      insertedCount,
      featureCount: counts.feature_count ?? 0,
      declaredFeatureCount: counts.declared_feature_count ?? 0,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    audit.error("workspace_gis_append_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while storing the upload" },
      { status: 500 }
    );
  }
}
