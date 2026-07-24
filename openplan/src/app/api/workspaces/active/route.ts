/**
 * Set the caller's ACTIVE workspace — the persisted selection the workspace
 * switcher writes. Every geography-aware and workspace-scoped page reads it
 * back through loadWorkspaceContext (src/lib/workspaces/current.ts).
 *
 * Membership is verified before the cookie is written: a user cannot pin
 * themselves to a workspace they do not belong to, and a stale cookie is
 * ignored on read anyway (it falls back to the default), so the two guards
 * compose.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { writeActiveWorkspaceId } from "@/lib/workspaces/active-workspace";

export const runtime = "nodejs";

const setActiveSchema = z.object({
  workspaceId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.active.set", request);

  const bodyResult = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
  if (!bodyResult.ok) return bodyResult.response;
  if (bodyResult.parseError) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = setActiveSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid workspaceId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membership = await checkWorkspaceMembership(supabase, user.id, parsed.data.workspaceId);
  if (!membership.ok) {
    if (membership.kind === "schema_pending") {
      return NextResponse.json({ error: "Workspace schema is not available yet" }, { status: 503 });
    }
    if (membership.kind === "not_member") {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    audit.error("active_workspace_membership_failed", {
      workspaceId: parsed.data.workspaceId,
      message: membership.message,
    });
    return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
  }

  await writeActiveWorkspaceId(parsed.data.workspaceId);

  audit.info("active_workspace_set", { workspaceId: parsed.data.workspaceId, userId: user.id });

  return NextResponse.json({ workspaceId: parsed.data.workspaceId }, { status: 200 });
}
