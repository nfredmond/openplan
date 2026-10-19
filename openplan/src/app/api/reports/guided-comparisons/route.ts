import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadGuidedReportOptions } from "@/lib/reports/guided-comparison-server";

export async function GET(request: NextRequest) {
  const parsed = z.string().uuid().safeParse(request.nextUrl.searchParams.get("projectId"));
  if (!parsed.success) return NextResponse.json({ error: "Select a project." }, { status: 400 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const project = await client.from("projects").select("id, workspace_id").eq("id", parsed.data).maybeSingle();
  if (project.error) return NextResponse.json({ error: "The project could not be read." }, { status: 503 });
  if (!project.data) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const membership = await client.from("workspace_members").select("workspace_id, role")
    .eq("workspace_id", project.data.workspace_id).eq("user_id", user.id).maybeSingle();
  if (membership.error) return NextResponse.json({ error: "Workspace access could not be verified." }, { status: 503 });
  if (!membership.data || !canAccessWorkspaceAction("reports.read", membership.data.role)) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  try {
    return NextResponse.json({ options: await loadGuidedReportOptions(client, project.data.workspace_id, project.data.id) });
  } catch {
    return NextResponse.json({ error: "Saved comparisons could not be read. Restore access before selecting evidence." }, { status: 503 });
  }
}
