import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadReportAccess } from "@/lib/reports/api";
import { verifyFrozenReportAerialOrthoSnapshots } from "@/lib/reports/aerial-ortho-evidence";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const paramsSchema = z.object({
  reportId: z.string().uuid(),
  artifactId: z.string().uuid(),
  custodyId: z.string().uuid(),
});

type RouteContext = { params: Promise<z.infer<typeof paramsSchema>> };

/** Authenticated access to the immutable PNG copied into one report packet. */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("reports.artifact.aerial", request);
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid aerial preview route params" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadReportAccess(supabase, parsed.data.reportId, user.id);
  if (access.error) return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  if (!access.report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  if (!access.membership || !canAccessWorkspaceAction("reports.read", access.membership.role)) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }
  if (!access.report.project_id) return NextResponse.json({ error: "Report has no project" }, { status: 404 });
  const { data: artifact, error } = await supabase
    .from("report_artifacts")
    .select("id, report_id, metadata_json")
    .eq("id", parsed.data.artifactId)
    .eq("report_id", access.report.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to load artifact" }, { status: 500 });
  if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  const state = verifyFrozenReportAerialOrthoSnapshots(artifact.metadata_json, {
    workspaceId: access.report.workspace_id,
    projectId: access.report.project_id,
    reportId: access.report.id,
    artifactId: artifact.id,
  });
  if (state.status !== "verified") {
    audit.warn("frozen_aerial_snapshot_rejected", { reportId: access.report.id, artifactId: artifact.id, state: state.status });
    return NextResponse.json({ error: "Frozen aerial preview is unavailable" }, { status: state.status === "absent" ? 404 : 422 });
  }
  const snapshot = state.snapshots[0];
  if (snapshot.custodyId !== parsed.data.custodyId) return NextResponse.json({ error: "Frozen aerial preview not found" }, { status: 404 });
  const service = createServiceRoleClient();
  const stored = await service.storage.from(snapshot.storageBucket).download(snapshot.storagePath);
  if (stored.error || !stored.data) return NextResponse.json({ error: "Failed to read frozen aerial preview" }, { status: 500 });
  const bytes = new Uint8Array(await stored.data.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== snapshot.byteSize || checksum !== snapshot.frozenChecksumSha256) {
    audit.warn("frozen_aerial_bytes_rejected", { reportId: access.report.id, artifactId: artifact.id });
    return NextResponse.json({ error: "Frozen aerial preview failed its custody check" }, { status: 422 });
  }
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": snapshot.contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
