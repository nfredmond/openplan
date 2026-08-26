import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { loadProjectEvidenceCandidateInventory } from "@/lib/project-evidence-bundles/inventory";

export const runtime = "nodejs";

const paramsSchema = z.object({ projectId: z.string().uuid() });

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.evidence_bundles.candidates", request);
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });

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

    const inventory = await loadProjectEvidenceCandidateInventory(supabase, access.project);
    audit.info("project_evidence_candidates_reviewed", {
      projectId: access.project.id,
      workspaceId: access.project.workspace_id,
      candidateCount: inventory.candidates.length,
      inventoryTruncated: inventory.inventoryTruncated,
      readFailed: inventory.readFailed,
    });
    return NextResponse.json(inventory, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    audit.error("project_evidence_candidates_unhandled_error", { projectId: parsed.data.projectId, error });
    return NextResponse.json({ error: "Unexpected error while loading evidence candidates" }, { status: 500 });
  }
}
