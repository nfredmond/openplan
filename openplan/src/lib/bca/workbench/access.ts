import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
export async function authorizeBcaProject(projectId: string, write: boolean) {
  if (!z.string().uuid().safeParse(projectId).success)
    return {
      error: NextResponse.json(
        { error: "Invalid project id" },
        { status: 400 },
      ),
    };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      error: NextResponse.json(
        { error: "Sign in to access this analysis" },
        { status: 401 },
      ),
    };
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, workspace_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error)
    return {
      error: NextResponse.json(
        { error: "Could not verify project access" },
        { status: 500 },
      ),
    };
  if (!project)
    return {
      error: NextResponse.json({ error: "Project not found" }, { status: 404 }),
    };
  const membership = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", project.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error)
    return {
      error: NextResponse.json(
        { error: "Could not verify membership" },
        { status: 500 },
      ),
    };
  if (
    !membership.data ||
    !canAccessWorkspaceAction(
      write ? "programs.write" : "programs.read",
      membership.data.role,
    )
  )
    return {
      error: NextResponse.json(
        { error: "Workspace access denied" },
        { status: 403 },
      ),
    };
  return { supabase, user, project };
}
