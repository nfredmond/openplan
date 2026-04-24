import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createWorkspaceInvitation, normalizeInvitationRole } from "@/lib/workspaces/invitations";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

export const runtime = "nodejs";

const invitationSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().trim().email(),
  role: z.enum(["admin", "member"]).optional().default("member"),
});

function canManageWorkspaceMembers(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.invitations", request);
  const startedAt = Date.now();
  const payload = await request.json().catch(() => null);
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
