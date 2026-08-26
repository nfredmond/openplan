import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { CORRIDOR_COLUMNS, type ProjectCorridorRow } from "@/lib/cartographic/project-corridor-record";
import { PROJECT_PLACE_COLUMNS } from "@/lib/projects/project-place";
import {
  buildProjectGeoPackage,
  projectGeoPackageFilename,
  type ProjectGeoPackageProject,
} from "@/lib/projects/project-geopackage";

export const runtime = "nodejs";

const paramsSchema = z.object({ projectId: z.string().uuid() });
const PROJECT_EXPORT_COLUMNS = [
  "id",
  "workspace_id",
  "name",
  "summary",
  "status",
  "plan_type",
  "delivery_phase",
  "latitude",
  "longitude",
  "created_at",
  "updated_at",
  PROJECT_PLACE_COLUMNS,
].join(", ");

/**
 * Download one project's stored cartographic record as an OGC GeoPackage.
 *
 * Access is resolved against the project's own workspace, then both reads are
 * scoped again to that workspace. The second guard matters even with RLS: an
 * export must never assemble a file from a project record in one tenant and a
 * same-id child record in another if a policy or test double drifts.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.export.geopackage", request);
  const startedAt = Date.now();
  let auditedProjectId: string | null = null;

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }
    auditedProjectId = routeParams.data.projectId;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadProjectAccess(supabase, routeParams.data.projectId, user.id, "programs.read");
    if (access.error) {
      audit.error("project_access_failed", {
        projectId: routeParams.data.projectId,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    }
    if (!access.project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const projectRead = await supabase
      .from("projects")
      .select(PROJECT_EXPORT_COLUMNS)
      .eq("id", access.project.id)
      .eq("workspace_id", access.project.workspace_id)
      .maybeSingle();
    if (projectRead.error || !projectRead.data) {
      audit.error("project_export_read_failed", {
        projectId: access.project.id,
        workspaceId: access.project.workspace_id,
        message: projectRead.error?.message ?? "project disappeared during export",
      });
      return NextResponse.json({ error: "Failed to load project export record" }, { status: 500 });
    }

    const corridorRead = await supabase
      .from("project_corridors")
      .select(CORRIDOR_COLUMNS)
      .eq("project_id", access.project.id)
      .eq("workspace_id", access.project.workspace_id)
      .order("created_at", { ascending: true });
    if (corridorRead.error) {
      audit.error("project_export_corridors_failed", {
        projectId: access.project.id,
        workspaceId: access.project.workspace_id,
        message: corridorRead.error.message,
      });
      return NextResponse.json({ error: "Failed to load project corridors for export" }, { status: 500 });
    }

    const project = projectRead.data as unknown as ProjectGeoPackageProject;
    const generatedAt = new Date();
    const artifact = buildProjectGeoPackage({
      project,
      corridors: (corridorRead.data ?? []) as ProjectCorridorRow[],
      generatedAt,
    });
    const filename = projectGeoPackageFilename(project.name, generatedAt);

    audit.info("project_geopackage_exported", {
      projectId: access.project.id,
      workspaceId: access.project.workspace_id,
      userId: user.id,
      bytes: artifact.bytes.length,
      ...artifact.summary,
      durationMs: Date.now() - startedAt,
    });

    return new NextResponse(new Uint8Array(artifact.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/geopackage+sqlite3",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    audit.error("project_geopackage_export_unhandled_error", {
      projectId: auditedProjectId,
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while exporting project GeoPackage" }, { status: 500 });
  }
}
