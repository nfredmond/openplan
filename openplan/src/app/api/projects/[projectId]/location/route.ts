import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

/**
 * Where a project sits on the map.
 *
 * `projects.latitude/longitude` shipped in 20260421000065 and is read by
 * `/api/map-features/projects` to draw the backdrop's project markers — but
 * nothing in the product ever wrote it. The create form does not collect a
 * location, there is no project-edit route, and the columns' only writer was
 * the demo seed deleted in aaae44fc. So every project created by using the app
 * was invisible on the map, permanently.
 *
 * This is a sub-route rather than a general `PATCH /api/projects/[projectId]`
 * on purpose: it matches the funding-profile / rtp-links / records convention
 * already established for this resource, and it does not open a broad mutable
 * surface on the project record as a side effect of fixing the map.
 */

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

/**
 * Latitude and longitude move together or not at all. A project with only one
 * of the two is not a partially-placed project, it is an unplaceable one — the
 * map-features route filters on both being non-null, so a half-written pair is
 * silently invisible rather than an error anyone can see. Bounds mirror the
 * `projects_latitude_range_chk` / `projects_longitude_range_chk` constraints so
 * a bad value is a 400 here rather than a 500 from Postgres.
 */
const patchLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
  })
  .refine(
    (value) => (value.latitude === null) === (value.longitude === null),
    { message: "latitude and longitude must be provided together, or both null to clear the location." }
  );

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.location.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const payload = patchLocationSchema.safeParse(payloadBody.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        { error: payload.error.issues[0]?.message ?? "Invalid project location payload" },
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
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    }

    if (!access.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    // User (RLS) client: the projects update policy re-checks workspace
    // membership, so the explicit check above is defense in depth rather than
    // the only guard.
    const { data, error } = await supabase
      .from("projects")
      .update({
        latitude: payload.data.latitude,
        longitude: payload.data.longitude,
      })
      .eq("id", access.project.id)
      .select("id, latitude, longitude, updated_at")
      .single();

    if (isWriteFailure(error)) {
      audit.error("project_location_update_failed", {
        projectId: access.project.id,
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update project location" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      // `loadProjectAccess` already read this exact project row through the
      // caller's client and the role gate above passed, so matching no rows
      // means the database refused a write the application believed was allowed.
      audit.error("project_location_update_matched_no_rows", {
        projectId: access.project.id,
        workspaceId: access.project.workspace_id,
        userId: user.id,
        role: access.membership?.role ?? null,
      });
      return noRowsMatchedResponse({ subject: "project location", targetWasVerified: true });
    }

    const record = data as { id: string; latitude: number | null; longitude: number | null; updated_at: string };

    audit.info("project_location_updated", {
      projectId: record.id,
      workspaceId: access.project.workspace_id,
      userId: user.id,
      cleared: record.latitude === null,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        project: {
          id: record.id,
          latitude: record.latitude,
          longitude: record.longitude,
          updatedAt: record.updated_at,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("project_location_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while updating project location" }, { status: 500 });
  }
}
