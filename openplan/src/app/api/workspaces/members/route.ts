import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { normalizeWorkspaceRole, WORKSPACE_ROLES, type WorkspaceRole } from "@/lib/auth/role-matrix";

export const runtime = "nodejs";

/**
 * Workspace member management: list members, change a member's role, remove a
 * member. The companion to /api/workspaces/invitations — that route controls
 * who can JOIN a workspace; this one controls what existing members are.
 *
 * Authority rules, enforced verb by verb below:
 * - Listing and managing members is owner/admin work (the invitations
 *   precedent: team-management data is operator information).
 * - Only an OWNER may grant or revoke the owner role, or demote/remove another
 *   owner. Admins manage members, viewers, and other admins — never an owner.
 * - LAST-OWNER PROTECTION: the last remaining owner can never be demoted or
 *   removed, including by themselves. A workspace without an owner would have
 *   nobody able to appoint one.
 * - Self-removal (leaving the workspace) is open to every role EXCEPT the last
 *   owner — the one deliberate exception to the owner/admin gate.
 */

const workspaceQuerySchema = z.object({ workspaceId: z.string().uuid() });

const updateSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(WORKSPACE_ROLES),
});

const removeSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

type ActorMembership = { role: WorkspaceRole | null };

/**
 * Explicit membership lookup for the caller — mirrors
 * /api/workspaces/invitations exactly: 404 for a non-member (a non-member
 * should not learn the workspace exists), never a caller-supplied role.
 */
async function requireMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  workspaceId: string
): Promise<{ ok: true; membership: ActorMembership } | { ok: false; response: NextResponse }> {
  const { data: membership, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, response: NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 }) };
  }
  if (!membership) {
    return { ok: false, response: NextResponse.json({ error: "Workspace not found" }, { status: 404 }) };
  }
  return { ok: true, membership: { role: normalizeWorkspaceRole(membership.role) } };
}

function isManagerRole(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin";
}

/** Authoritative owner count via the service role — never RLS-limited. */
async function countWorkspaceOwners(
  service: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string
): Promise<number | null> {
  const { count, error } = await service
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("role", "owner");

  if (error) return null;
  return count ?? 0;
}

async function loadTargetMembership(
  service: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  userId: string
): Promise<{ ok: true; role: WorkspaceRole | null } | { ok: false; response: NextResponse }> {
  const { data, error } = await service
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, response: NextResponse.json({ error: "Failed to load the member" }, { status: 500 }) };
  }
  if (!data) {
    return { ok: false, response: NextResponse.json({ error: "Member not found in this workspace" }, { status: 404 }) };
  }
  return { ok: true, role: normalizeWorkspaceRole((data as { role: string }).role) };
}

const LAST_OWNER_MESSAGE =
  "This workspace's last owner cannot be demoted or removed. Promote another owner first.";

/**
 * SQLSTATE raised by the owner-floor trigger (migration 20260728000004).
 *
 * The counts below are a courtesy — they turn the common case into a clear
 * 409 before any write is attempted. They are NOT the guarantee: counting and
 * then writing is check-then-act, and two owners demoting each other at the
 * same instant would both pass it. The database serializes that race and
 * refuses the second write; this is where that refusal becomes the same 409
 * the caller would have seen anyway.
 */
const OWNER_FLOOR_SQLSTATE = "OP409";

function isOwnerFloorViolation(error: { code?: string | null } | null): boolean {
  return error?.code === OWNER_FLOOR_SQLSTATE;
}

/** Current members with emails, for the workspace team panel. Owner/admin only. */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.members.list", request);

  const parsed = workspaceQuerySchema.safeParse(
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

  const guard = await requireMembership(supabase, user.id, parsed.data.workspaceId);
  if (!guard.ok) return guard.response;
  if (!isManagerRole(guard.membership.role)) {
    return NextResponse.json({ error: "Owner/admin access is required" }, { status: 403 });
  }

  // The ROSTER must be read with the service role, not the RLS client: the
  // only SELECT policy on workspace_members is members_read_own
  // (user_id = auth.uid(), migration 20260316000024, which replaced a
  // recursive policy), so an RLS read returns exactly one row — the caller —
  // and a team panel built on it could never list, let alone manage, a
  // teammate. The owner/admin guard above is what authorizes this read; the
  // workspace filter below is what scopes it.
  const service = createServiceRoleClient();
  const { data: rows, error } = await service
    .from("workspace_members")
    .select("user_id, role, joined_at")
    .eq("workspace_id", parsed.data.workspaceId)
    .order("joined_at", { ascending: true })
    .limit(200);

  if (error) {
    audit.warn("workspace_members_list_failed", { message: error.message });
    return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
  }

  // Emails live in auth.users, which is not readable through the RLS client;
  // the service-role auth admin API is the supported lookup. A failed lookup
  // yields a null email rather than failing the whole list.
  const members = await Promise.all(
    ((rows ?? []) as Array<{ user_id: string; role: string; joined_at: string | null }>).map(
      async (row) => {
        let email: string | null = null;
        try {
          const lookup = await service.auth.admin.getUserById(row.user_id);
          email = lookup.data.user?.email ?? null;
        } catch {
          email = null;
        }
        return {
          userId: row.user_id,
          email,
          role: row.role,
          joinedAt: row.joined_at,
        };
      }
    )
  );

  return NextResponse.json({ members, callerUserId: user.id });
}

/** Change a member's role. */
export async function PATCH(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.members.update", request);

  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid member update payload" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const guard = await requireMembership(supabase, user.id, parsed.data.workspaceId);
  if (!guard.ok) return guard.response;
  const actorRole = guard.membership.role;
  if (!isManagerRole(actorRole)) {
    return NextResponse.json({ error: "Owner/admin access is required" }, { status: 403 });
  }

  const service = createServiceRoleClient();
  const target = await loadTargetMembership(service, parsed.data.workspaceId, parsed.data.userId);
  if (!target.ok) return target.response;

  const newRole = parsed.data.role;

  // Owner-role changes in either direction are owner-only authority.
  if (actorRole !== "owner" && (target.role === "owner" || newRole === "owner")) {
    return NextResponse.json(
      { error: "Only an owner may grant the owner role or change another owner's role" },
      { status: 403 }
    );
  }

  // Last-owner protection — applies to everyone, including the owner themselves.
  if (target.role === "owner" && newRole !== "owner") {
    const owners = await countWorkspaceOwners(service, parsed.data.workspaceId);
    if (owners === null) {
      return NextResponse.json({ error: "Failed to verify workspace owners" }, { status: 500 });
    }
    if (owners <= 1) {
      return NextResponse.json({ error: LAST_OWNER_MESSAGE }, { status: 409 });
    }
  }

  const { error: updateError } = await service
    .from("workspace_members")
    .update({ role: newRole })
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("user_id", parsed.data.userId);

  if (updateError) {
    if (isOwnerFloorViolation(updateError)) {
      audit.warn("workspace_member_role_update_owner_floor", {
        workspaceId: parsed.data.workspaceId,
        targetUserId: parsed.data.userId,
      });
      return NextResponse.json({ error: LAST_OWNER_MESSAGE }, { status: 409 });
    }
    audit.error("workspace_member_role_update_failed", { message: updateError.message });
    return NextResponse.json({ error: "Failed to update the member's role" }, { status: 500 });
  }

  audit.info("workspace_member_role_updated", {
    workspaceId: parsed.data.workspaceId,
    targetUserId: parsed.data.userId,
    previousRole: target.role,
    role: newRole,
    actorUserId: user.id,
  });
  return NextResponse.json({ updated: true, userId: parsed.data.userId, role: newRole });
}

/** Remove a member — or leave the workspace yourself. */
export async function DELETE(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.members.remove", request);

  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const parsed = removeSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid member removal payload" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const guard = await requireMembership(supabase, user.id, parsed.data.workspaceId);
  if (!guard.ok) return guard.response;
  const actorRole = guard.membership.role;
  const removingSelf = parsed.data.userId === user.id;

  // Leaving the workspace is every member's right; removing SOMEONE ELSE is
  // owner/admin work.
  if (!removingSelf && !isManagerRole(actorRole)) {
    return NextResponse.json({ error: "Owner/admin access is required" }, { status: 403 });
  }

  const service = createServiceRoleClient();
  const target = await loadTargetMembership(service, parsed.data.workspaceId, parsed.data.userId);
  if (!target.ok) return target.response;

  if (!removingSelf && actorRole !== "owner" && target.role === "owner") {
    return NextResponse.json({ error: "Only an owner may remove an owner" }, { status: 403 });
  }

  if (target.role === "owner") {
    const owners = await countWorkspaceOwners(service, parsed.data.workspaceId);
    if (owners === null) {
      return NextResponse.json({ error: "Failed to verify workspace owners" }, { status: 500 });
    }
    if (owners <= 1) {
      return NextResponse.json({ error: LAST_OWNER_MESSAGE }, { status: 409 });
    }
  }

  const { error: deleteError } = await service
    .from("workspace_members")
    .delete()
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("user_id", parsed.data.userId);

  if (deleteError) {
    if (isOwnerFloorViolation(deleteError)) {
      audit.warn("workspace_member_remove_owner_floor", {
        workspaceId: parsed.data.workspaceId,
        targetUserId: parsed.data.userId,
      });
      return NextResponse.json({ error: LAST_OWNER_MESSAGE }, { status: 409 });
    }
    audit.error("workspace_member_remove_failed", { message: deleteError.message });
    return NextResponse.json({ error: "Failed to remove the member" }, { status: 500 });
  }

  audit.info(removingSelf ? "workspace_member_left" : "workspace_member_removed", {
    workspaceId: parsed.data.workspaceId,
    targetUserId: parsed.data.userId,
    targetRole: target.role,
    actorUserId: user.id,
  });
  return NextResponse.json({ removed: true, userId: parsed.data.userId, left: removingSelf });
}
