import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadWorkspaceRoster, type RosterServiceClient } from "@/lib/workspaces/roster";

export const runtime = "nodejs";

/**
 * The member-visible roster: every member of a workspace may see who their
 * teammates are — id, email, role, NOTHING ELSE. This is deliberately a
 * separate route from /api/workspaces/members, which is the owner/admin
 * MANAGEMENT surface (joined dates, role changes, removal); widening that
 * route to members would widen its authority with it. This one exists so that
 * assigning work to a teammate does not require being an admin.
 *
 * The roster itself is read through the service role behind an explicit
 * caller-membership check inside `loadWorkspaceRoster` — the only SELECT
 * policy on workspace_members (members_read_own) returns one row through RLS,
 * which is a list of yourself, not a team.
 */

const rosterQuerySchema = z.object({ workspaceId: z.string().uuid() });

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.roster.list", request);

  const parsed = rosterQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workspace id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Structural cast: the clients are untyped by design in this repo, and
  // assigning the concrete supabase-js client into the structural slice trips
  // TS2589 (a recorded recurring trigger).
  const service = createServiceRoleClient() as unknown as RosterServiceClient;
  const roster = await loadWorkspaceRoster(service, user.id, parsed.data.workspaceId);

  if (!roster.ok) {
    if (roster.reason === "caller_not_member") {
      // A non-member should not learn the workspace exists — the
      // /api/workspaces/members and /invitations precedent.
      audit.warn("workspace_roster_non_member", {
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
      });
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // A failed read is a failed read — never an empty team.
    audit.error("workspace_roster_read_failed", {
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      reason: roster.reason,
      message: roster.message,
    });
    return NextResponse.json(
      {
        error:
          roster.reason === "membership_check_failed"
            ? "Failed to verify workspace access"
            : "Failed to load the workspace roster",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    members: roster.members.map((member) => ({
      userId: member.userId,
      email: member.email,
      role: member.role,
    })),
    callerUserId: user.id,
  });
}
