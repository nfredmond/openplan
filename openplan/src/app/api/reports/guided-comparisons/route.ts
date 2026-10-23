import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadGuidedReportOptions } from "@/lib/reports/guided-comparison-server";

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("reports.guided-comparisons", request);
  const parsed = z.string().uuid().safeParse(request.nextUrl.searchParams.get("projectId"));
  if (!parsed.success) {
    audit.warn("validation_failed");
    return NextResponse.json({ error: "Select a project." }, { status: 400 });
  }
  try {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) {
      audit.warn("authentication_required");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const project = await client.from("projects").select("id, workspace_id").eq("id", parsed.data).maybeSingle();
    if (project.error) {
      audit.error("project_read_failed");
      return NextResponse.json({ error: "The project could not be read." }, { status: 503 });
    }
    if (!project.data) {
      audit.warn("project_not_found");
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const membership = await client.from("workspace_members").select("workspace_id, role")
      .eq("workspace_id", project.data.workspace_id).eq("user_id", user.id).maybeSingle();
    if (membership.error) {
      audit.error("workspace_access_read_failed");
      return NextResponse.json({ error: "Workspace access could not be verified." }, { status: 503 });
    }
    if (!membership.data || !canAccessWorkspaceAction("reports.read", membership.data.role)) {
      audit.warn("workspace_access_denied");
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }
    const options = await loadGuidedReportOptions(client, project.data.workspace_id, project.data.id);
    audit.info("guided_comparisons_read_succeeded", { optionCount: options.length });
    return NextResponse.json({ options });
  } catch {
    audit.error("guided_comparisons_read_failed");
    return NextResponse.json({ error: "Saved comparisons could not be read. Restore access before selecting evidence." }, { status: 503 });
  }
}
