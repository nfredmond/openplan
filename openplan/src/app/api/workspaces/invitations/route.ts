import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createWorkspaceInvitation, normalizeInvitationRole } from "@/lib/workspaces/invitations";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

export const runtime = "nodejs";

const invitationSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().trim().email(),
  role: z.enum(["admin", "member"]).optional().default("member"),
});

function canManageWorkspaceMembers(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

const workspaceQuerySchema = z.object({ workspaceId: z.string().uuid() });
const revokeSchema = z.object({
  workspaceId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

/**
 * Shared owner/admin gate. Managing who can reach a workspace is exactly the
 * authority that must not be inferred loosely, so every verb here runs the same
 * explicit membership lookup rather than trusting a caller-supplied role.
 */
async function requireManagerMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  workspaceId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
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
    // 404 rather than 403: a non-member should not learn the workspace exists.
    return { ok: false, response: NextResponse.json({ error: "Workspace not found" }, { status: 404 }) };
  }
  if (!canManageWorkspaceMembers(membership.role)) {
    return { ok: false, response: NextResponse.json({ error: "Owner/admin access is required" }, { status: 403 }) };
  }
  return { ok: true };
}

/** Pending invitations and current members for the workspace team panel. */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.invitations.list", request);

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

  const guard = await requireManagerMembership(supabase, user.id, parsed.data.workspaceId);
  if (!guard.ok) return guard.response;

  // RLS scopes both reads to the caller's workspaces; the explicit filter keeps
  // the intent obvious. Note token_hash is never selected — the raw token is
  // shown once at creation and is not recoverable afterwards by design.
  const [invitationsResult, membersResult] = await Promise.all([
    supabase
      .from("workspace_invitations")
      .select("id, email, role, status, expires_at, created_at, accepted_at, revoked_at")
      .eq("workspace_id", parsed.data.workspaceId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("workspace_members")
      .select("user_id, role, created_at")
      .eq("workspace_id", parsed.data.workspaceId)
      .limit(200),
  ]);

  if (invitationsResult.error) {
    audit.warn("workspace_invitation_list_failed", { message: invitationsResult.error.message });
    return NextResponse.json({ error: "Failed to load invitations" }, { status: 500 });
  }

  return NextResponse.json({
    invitations: invitationsResult.data ?? [],
    memberCount: membersResult.error ? null : (membersResult.data ?? []).length,
  });
}

/** Revoke a pending invitation so its link stops working. */
export async function DELETE(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.invitations.revoke", request);

  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const parsed = revokeSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid revoke payload" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const guard = await requireManagerMembership(supabase, user.id, parsed.data.workspaceId);
  if (!guard.ok) return guard.response;

  // Only a still-pending invitation can be revoked, and the workspace filter is
  // repeated in the write so an id from another workspace cannot be cancelled.
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from("workspace_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.invitationId)
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    audit.error("workspace_invitation_revoke_failed", { message: error.message });
    return NextResponse.json({ error: "Failed to revoke invitation" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "No pending invitation matched" }, { status: 404 });
  }

  audit.info("workspace_invitation_revoked", {
    workspaceId: parsed.data.workspaceId,
    invitationId: parsed.data.invitationId,
    userId: user.id,
  });
  return NextResponse.json({ revoked: true, invitationId: parsed.data.invitationId });
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.invitations", request);
  const startedAt = Date.now();
  const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
  if (!payloadBody.ok) return payloadBody.response;
  const payload = payloadBody.data;
  const parsed = invitationSchema.safeParse(payload);

  if (!parsed.success) {
    audit.warn("workspace_invitation_validation_failed", { issues: parsed.error.issues.length });
    return NextResponse.json({ error: "Invalid workspace invitation payload" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    audit.warn("workspace_invitation_unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const input = parsed.data;
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    audit.error("workspace_invitation_membership_lookup_failed", {
      workspaceId: input.workspaceId,
      userId: user.id,
      message: membershipError.message,
      code: membershipError.code ?? null,
    });
    return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
  }

  if (!membership || !canManageWorkspaceMembers(membership.role)) {
    audit.warn("workspace_invitation_forbidden", {
      workspaceId: input.workspaceId,
      userId: user.id,
      role: membership?.role ?? null,
    });
    return NextResponse.json({ error: "Owner/admin access is required" }, { status: 403 });
  }

  const role = normalizeInvitationRole(input.role);
  if (!role || role === "owner") {
    return NextResponse.json({ error: "Workspace invitations may target admin or member roles" }, { status: 400 });
  }

  try {
    const serviceSupabase = createServiceRoleClient();
    const invitation = await createWorkspaceInvitation({
      supabase: serviceSupabase,
      workspaceId: input.workspaceId,
      email: input.email,
      role,
      invitedByUserId: user.id,
      origin: request.nextUrl.origin,
    });

    audit.info(invitation.reissued ? "workspace_invitation_reissued" : "workspace_invitation_created", {
      workspaceId: input.workspaceId,
      invitedByUserId: user.id,
      invitationId: invitation.invitation.id,
      emailNormalized: invitation.invitation.email_normalized,
      role,
      expiresAt: invitation.invitation.expires_at,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        invitationId: invitation.invitation.id,
        workspaceId: input.workspaceId,
        email: invitation.invitation.email,
        role: invitation.invitation.role,
        status: invitation.invitation.status,
        expiresAt: invitation.invitation.expires_at,
        invitationUrl: invitation.invitationUrl,
        reissued: invitation.reissued,
        delivery: "manual",
      },
      { status: invitation.reissued ? 200 : 201 }
    );
  } catch (error) {
    audit.error("workspace_invitation_create_failed", {
      workspaceId: input.workspaceId,
      userId: user.id,
      message: error instanceof Error ? error.message : "unknown",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Failed to create workspace invitation" }, { status: 500 });
  }
}
