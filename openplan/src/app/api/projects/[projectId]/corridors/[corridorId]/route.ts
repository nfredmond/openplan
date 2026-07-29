import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import {
  CORRIDOR_LOS_GRADES,
  CORRIDOR_MAX_VERTICES,
  CORRIDOR_TYPES,
} from "@/lib/cartographic/corridor-vocabulary";
import { isCorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";
import {
  CORRIDOR_COLUMNS,
  serializeProjectCorridor,
  type ProjectCorridorRow,
} from "@/lib/cartographic/project-corridor-record";

/** Editing and removing one corridor. See the collection route for why these exist. */

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  corridorId: z.string().uuid(),
});

const corridorGeometrySchema = z
  .unknown()
  .refine(isCorridorLineGeoJson, {
    message: "Corridor geometry must be a GeoJSON LineString with at least two [longitude, latitude] positions.",
  })
  .refine(
    (value) => (value as { coordinates: unknown[] }).coordinates.length <= CORRIDOR_MAX_VERTICES,
    { message: `A corridor may have at most ${CORRIDOR_MAX_VERTICES} vertices.` }
  );

/**
 * Every field optional, but at least one required — a PATCH that changes
 * nothing is a client bug worth surfacing, not a silent no-op that returns 200
 * and leaves the caller believing it saved something.
 */
const patchCorridorSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    corridorType: z.enum(CORRIDOR_TYPES).optional(),
    losGrade: z.enum(CORRIDOR_LOS_GRADES).nullable().optional(),
    geometry: corridorGeometrySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

/**
 * Resolve the project, the caller's access to it, and the corridor — checking
 * that the corridor actually belongs to the project in the URL.
 *
 * That last check is the one worth naming. Without it, `/projects/A/corridors/X`
 * would happily edit corridor X even when X belongs to project B, as long as
 * the caller could write to A. RLS would still confine it to workspaces the
 * caller belongs to, so this is not a cross-tenant hole — but within a
 * workspace it would let a URL edit something it does not name, and a 404 is
 * the honest answer.
 */
async function resolveCorridorContext(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; corridorId: string }> },
  action: "programs.read" | "programs.write"
) {
  const routeParams = paramsSchema.safeParse(await context.params);
  if (!routeParams.success) {
    return { failure: NextResponse.json({ error: "Invalid project or corridor id" }, { status: 400 }) } as const;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { failure: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const access = await loadProjectAccess(supabase, routeParams.data.projectId, user.id, action);
  if (access.error) {
    return { failure: NextResponse.json({ error: "Failed to verify project access" }, { status: 500 }) } as const;
  }
  if (!access.project) {
    return { failure: NextResponse.json({ error: "Project not found" }, { status: 404 }) } as const;
  }
  if (!access.membership || !access.allowed) {
    return { failure: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) } as const;
  }

  const { data: corridor, error: corridorError } = await supabase
    .from("project_corridors")
    .select(CORRIDOR_COLUMNS)
    .eq("id", routeParams.data.corridorId)
    .eq("project_id", access.project.id)
    .maybeSingle();

  if (corridorError) {
    return { failure: NextResponse.json({ error: "Failed to load corridor" }, { status: 500 }) } as const;
  }
  if (!corridor) {
    return { failure: NextResponse.json({ error: "Corridor not found" }, { status: 404 }) } as const;
  }

  return {
    failure: null,
    supabase,
    user,
    project: access.project,
    corridor: corridor as ProjectCorridorRow,
  } as const;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; corridorId: string }> }
) {
  const audit = createApiAuditLogger("projects.corridors.update", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const payload = patchCorridorSchema.safeParse(payloadBody.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        { error: payload.error.issues[0]?.message ?? "Invalid corridor payload" },
        { status: 400 }
      );
    }

    const resolved = await resolveCorridorContext(request, context, "programs.write");
    if (resolved.failure) return resolved.failure;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (payload.data.name !== undefined) updates.name = payload.data.name;
    if (payload.data.corridorType !== undefined) updates.corridor_type = payload.data.corridorType;
    if (payload.data.losGrade !== undefined) updates.los_grade = payload.data.losGrade;
    if (payload.data.geometry !== undefined) updates.geometry_geojson = payload.data.geometry;

    const { data, error } = await resolved.supabase
      .from("project_corridors")
      .update(updates)
      .eq("id", resolved.corridor.id)
      .select(CORRIDOR_COLUMNS)
      .single();

    if (isWriteFailure(error)) {
      audit.error("project_corridor_update_failed", {
        corridorId: resolved.corridor.id,
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update corridor" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      // `resolveCorridorContext` read this corridor row itself — not just its
      // project — through the caller's client, and the write role gate passed.
      // Matching nothing now is the database refusing what the app allowed.
      audit.error("project_corridor_update_matched_no_rows", {
        corridorId: resolved.corridor.id,
        projectId: resolved.project.id,
        workspaceId: resolved.project.workspace_id,
        userId: resolved.user.id,
      });
      return noRowsMatchedResponse({ subject: "corridor", targetWasVerified: true });
    }

    audit.info("project_corridor_updated", {
      corridorId: resolved.corridor.id,
      projectId: resolved.project.id,
      workspaceId: resolved.project.workspace_id,
      userId: resolved.user.id,
      changedGeometry: payload.data.geometry !== undefined,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ corridor: serializeProjectCorridor(data as ProjectCorridorRow) }, { status: 200 });
  } catch (error) {
    audit.error("project_corridor_update_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating corridor" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; corridorId: string }> }
) {
  const audit = createApiAuditLogger("projects.corridors.delete", request);
  const startedAt = Date.now();

  try {
    const resolved = await resolveCorridorContext(request, context, "programs.write");
    if (resolved.failure) return resolved.failure;

    const { error } = await resolved.supabase
      .from("project_corridors")
      .delete()
      .eq("id", resolved.corridor.id);

    if (error) {
      audit.error("project_corridor_delete_failed", {
        corridorId: resolved.corridor.id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to delete corridor" }, { status: 500 });
    }

    audit.info("project_corridor_deleted", {
      corridorId: resolved.corridor.id,
      projectId: resolved.project.id,
      workspaceId: resolved.project.workspace_id,
      userId: resolved.user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ deleted: { id: resolved.corridor.id } }, { status: 200 });
  } catch (error) {
    audit.error("project_corridor_delete_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while deleting corridor" }, { status: 500 });
  }
}
