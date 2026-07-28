import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  CORRIDOR_LOS_GRADES,
  CORRIDOR_MAX_VERTICES,
  CORRIDOR_TYPES,
  DEFAULT_CORRIDOR_TYPE,
} from "@/lib/cartographic/corridor-vocabulary";
import { isCorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";
import {
  CORRIDOR_COLUMNS,
  serializeProjectCorridor,
  type ProjectCorridorRow,
} from "@/lib/cartographic/project-corridor-record";

/**
 * Corridors belonging to a project.
 *
 * `project_corridors` shipped in 20260421000066 with full RLS for insert,
 * update and delete — and no way to reach any of it. There was no route, no
 * server action, and no UI, so the only corridor that ever existed came from
 * the demo seed deleted in aaae44fc. A planner could not draw one at all, and
 * the "Study corridors" backdrop layer was permanently empty.
 *
 * These are display corridors for the cartographic backdrop, deliberately NOT
 * the transportation-modeling `network_corridors` chain, which needs a full
 * network package behind it. The distinction is stated on the table comment and
 * is worth preserving: a planner sketching a corridor to show on a map should
 * not have to build a model package first.
 */

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

/**
 * Geometry is validated with the SAME predicate the read route and the backdrop
 * use (`isCorridorLineGeoJson`), so a corridor that saves is a corridor that
 * renders. A row that stored differently-shaped geometry would be accepted here
 * and then silently dropped by the map — present in the database, absent from
 * the map, with nothing reporting it.
 */
const corridorGeometrySchema = z
  .unknown()
  .refine(isCorridorLineGeoJson, {
    message: "Corridor geometry must be a GeoJSON LineString with at least two [longitude, latitude] positions.",
  })
  .refine(
    (value) => (value as { coordinates: unknown[] }).coordinates.length <= CORRIDOR_MAX_VERTICES,
    { message: `A corridor may have at most ${CORRIDOR_MAX_VERTICES} vertices.` }
  );

const createCorridorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  corridorType: z.enum(CORRIDOR_TYPES).optional(),
  losGrade: z.enum(CORRIDOR_LOS_GRADES).nullable().optional(),
  geometry: corridorGeometrySchema,
});

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.corridors.list", request);

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadProjectAccess(supabase, routeParams.data.projectId, user.id, "programs.read");
    if (access.error) {
      audit.error("project_access_failed", {
        projectId: routeParams.data.projectId,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    }

    if (!access.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("project_corridors")
      .select(CORRIDOR_COLUMNS)
      .eq("project_id", access.project.id)
      .order("created_at", { ascending: true });

    if (error) {
      audit.error("project_corridors_list_failed", {
        projectId: access.project.id,
        message: error.message,
      });
      return NextResponse.json({ error: "Failed to load project corridors" }, { status: 500 });
    }

    return NextResponse.json(
      { corridors: ((data ?? []) as ProjectCorridorRow[]).map(serializeProjectCorridor) },
      { status: 200 }
    );
  } catch (error) {
    audit.error("project_corridors_list_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while loading project corridors" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.corridors.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const payload = createCorridorSchema.safeParse(payloadBody.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        { error: payload.error.issues[0]?.message ?? "Invalid corridor payload" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadProjectAccess(supabase, routeParams.data.projectId, user.id, "programs.write");
    if (access.error) {
      audit.error("project_access_failed", {
        projectId: routeParams.data.projectId,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    }

    if (!access.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    // The corridor inherits the PROJECT's workspace, never a client-supplied
    // one, so a corridor cannot be planted in a workspace via a forged body.
    const { data, error } = await supabase
      .from("project_corridors")
      .insert({
        workspace_id: access.project.workspace_id,
        project_id: access.project.id,
        name: payload.data.name,
        corridor_type: payload.data.corridorType ?? DEFAULT_CORRIDOR_TYPE,
        los_grade: payload.data.losGrade ?? null,
        geometry_geojson: payload.data.geometry,
        created_by: user.id,
      })
      .select(CORRIDOR_COLUMNS)
      .single();

    if (error || !data) {
      audit.error("project_corridor_insert_failed", {
        projectId: access.project.id,
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create corridor" }, { status: 500 });
    }

    const row = data as ProjectCorridorRow;

    audit.info("project_corridor_created", {
      corridorId: row.id,
      projectId: access.project.id,
      workspaceId: access.project.workspace_id,
      userId: user.id,
      vertexCount: (payload.data.geometry as { coordinates: unknown[] }).coordinates.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ corridor: serializeProjectCorridor(row) }, { status: 201 });
  } catch (error) {
    audit.error("project_corridor_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while creating corridor" }, { status: 500 });
  }
}
