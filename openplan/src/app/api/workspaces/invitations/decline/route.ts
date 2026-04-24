import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  loadInvitationByToken,
  normalizeInvitationEmail,
  type WorkspaceInvitationRow,
} from "@/lib/workspaces/invitations";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

export const runtime = "nodejs";

const declineInvitationSchema = z.object({
  token: z.string().trim().min(24).max(256),
});

async function markExpired(
  serviceSupabase: ReturnType<typeof createServiceRoleClient>,
  invitation: WorkspaceInvitationRow
) {
  await serviceSupabase
    .from("workspace_invitations")
    .update({ status: "expired" })
    .eq("id", invitation.id);
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.invitations.decline", request);
  const startedAt = Date.now();
  const payload = await request.json().catch(() => null);
  const parsed = declineInvitationSchema.safeParse(payload);

  if (!parsed.success) {
    audit.warn("workspace_invitation_decline_validation_failed", { issues: parsed.error.issues.length });
    return NextResponse.json({ error: "Invalid invitation decline payload" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    audit.warn("workspace_invitation_decline_unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceSupabase = createServiceRoleClient();
  let lookup;
  try {
    lookup = await loadInvitationByToken(serviceSupabase, parsed.data.token);
  } catch (error) {
    audit.error("workspace_invitation_decline_lookup_failed", {
      userId: user.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to load invitation" }, { status: 500 });
  }

  if (!lookup.ok) {
    if (lookup.reason === "expired" && lookup.invitation) {
      await markExpired(serviceSupabase, lookup.invitation).catch((error) => {
        audit.warn("workspace_invitation_expire_mark_failed", {
          invitationId: lookup.invitation?.id,
          message: error instanceof Error ? error.message : "unknown",
        });
      });
    }

    audit.warn("workspace_invitation_decline_unavailable", {
      reason: lookup.reason,
      invitationId: lookup.invitation?.id ?? null,
      userId: user.id,
    });
    return NextResponse.json(
      {
        error:
          lookup.reason === "expired"
            ? "Invitation has expired"
            : "Invitation is not available",
      },
      { status: lookup.reason === "expired" ? 410 : 404 }
    );
  }

  const invitation = lookup.invitation;
  const userEmail = normalizeInvitationEmail(user.email ?? "");
  if (!userEmail || userEmail !== invitation.email_normalized) {
    audit.warn("workspace_invitation_decline_email_mismatch", {
      invitationId: invitation.id,
      workspaceId: invitation.workspace_id,
      userId: user.id,
      invitationEmail: invitation.email_normalized,
      userEmail,
    });
    return NextResponse.json({ error: "Invitation email does not match the signed-in user" }, { status: 403 });
  }

  const { error } = await serviceSupabase
    .from("workspace_invitations")
    .update({
      status: "declined",
      declined_at: new Date().toISOString(),
    })
    .eq("id", invitation.id);

  if (error) {
    audit.error("workspace_invitation_decline_failed", {
      invitationId: invitation.id,
      workspaceId: invitation.workspace_id,
      userId: user.id,
      message: error.message,
    });
    return NextResponse.json({ error: "Failed to decline invitation" }, { status: 500 });
  }

  audit.info("workspace_invitation_declined", {
    invitationId: invitation.id,
    workspaceId: invitation.workspace_id,
    userId: user.id,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(
    {
      workspaceId: invitation.workspace_id,
      status: "declined",
    },
    { status: 200 }
  );
}
