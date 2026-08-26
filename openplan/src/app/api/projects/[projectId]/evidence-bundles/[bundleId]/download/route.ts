import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadProjectAccess } from "@/lib/programs/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { sha256 } from "@/lib/project-evidence-bundles/archive";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paramsSchema = z.object({ projectId: z.string().uuid(), bundleId: z.string().uuid() });
const BUNDLE_BUCKET = "project-evidence-bundles";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; bundleId: string }> }
) {
  const audit = createApiAuditLogger("projects.evidence_bundles.download", request);
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid bundle route" }, { status: 400 });

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const access = await loadProjectAccess(supabase, parsed.data.projectId, user.id, "programs.read");
    if (access.error) return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    if (!access.project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const read = await supabase
      .from("project_evidence_bundles")
      .select("id, workspace_id, project_id, status, storage_bucket, storage_path, bundle_sha256, generated_at")
      .eq("id", parsed.data.bundleId)
      .eq("workspace_id", access.project.workspace_id)
      .eq("project_id", access.project.id)
      .eq("status", "ready")
      .maybeSingle();
    if (read.error || !read.data) return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
    const expectedPath = `${access.project.workspace_id}/${access.project.id}/${parsed.data.bundleId}.zip`;
    if (read.data.storage_bucket !== BUNDLE_BUCKET || read.data.storage_path !== expectedPath) {
      audit.warn("project_evidence_bundle_ref_out_of_scope", { bundleId: parsed.data.bundleId });
      return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
    }

    const service = createServiceRoleClient();
    const stored = await service.storage.from(BUNDLE_BUCKET).download(expectedPath);
    if (stored.error || !stored.data) {
      return NextResponse.json({ error: "Bundle bytes are unavailable" }, { status: 409 });
    }
    const bytes = Buffer.from(await stored.data.arrayBuffer());
    if (sha256(bytes) !== read.data.bundle_sha256) {
      audit.error("project_evidence_bundle_checksum_mismatch", { bundleId: parsed.data.bundleId });
      return NextResponse.json({ error: "Bundle checksum mismatch" }, { status: 409 });
    }
    const date = typeof read.data.generated_at === "string" ? read.data.generated_at.slice(0, 10) : "snapshot";
    audit.info("project_evidence_bundle_downloaded", {
      bundleId: parsed.data.bundleId,
      projectId: access.project.id,
      workspaceId: access.project.workspace_id,
      byteCount: bytes.length,
    });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="openplan-project-evidence-${date}.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    audit.error("project_evidence_bundle_download_unhandled_error", { bundleId: parsed.data.bundleId, error });
    return NextResponse.json({ error: "Unexpected error while downloading the evidence bundle" }, { status: 500 });
  }
}
