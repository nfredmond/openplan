import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let currentWorkspace;
  try {
    currentWorkspace = await loadCurrentWorkspaceMembership(supabase, user.id);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch workspace membership",
        details: error instanceof Error ? error.message : "Unknown workspace membership failure",
      },
      { status: 500 }
    );
  }

  const membership = currentWorkspace.membership;
  const workspace = currentWorkspace.workspace;

  if (!membership) {
    return NextResponse.json({ error: "No workspace membership found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      workspaceId: membership.workspace_id,
      name: workspace?.name ?? null,
      role: membership.role,
    },
    { status: 200 }
  );
}
