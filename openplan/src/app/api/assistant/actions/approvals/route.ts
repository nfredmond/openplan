import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  ASSISTANT_ACTION_APPROVAL_TTL_MS,
  assistantApprovalActionSchema,
  hashAssistantActionPayload,
  newAssistantApprovalId,
} from "@/lib/assistant/action-approval-server";
import { getActionMetadata } from "@/lib/runtime/action-metadata";

const approvalRequestSchema = z.object({
  workspaceId: z.string().uuid().nullable(),
  action: assistantApprovalActionSchema,
  requireApproval: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.actions.approvals", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
    const parsed = approvalRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid assistant approval request" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (parsed.data.workspaceId) {
      const { data: membership, error: membershipError } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("workspace_id", parsed.data.workspaceId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError) {
        audit.error("workspace_membership_lookup_failed", {
          workspaceId: parsed.data.workspaceId,
          userId: user.id,
          message: membershipError.message,
          code: membershipError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
      }

      if (!membership) {
        return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
      }
    }

    const metadata = getActionMetadata(parsed.data.action.kind);
    const inputHash = hashAssistantActionPayload(parsed.data.action);
    const needsApproval = metadata.approval === "approval_required" || parsed.data.requireApproval;
    const expiresAt = new Date(Date.now() + ASSISTANT_ACTION_APPROVAL_TTL_MS).toISOString();
    let approvalId: string | null = null;

    if (needsApproval) {
      approvalId = newAssistantApprovalId();
      const serviceSupabase = createServiceRoleClient();
      const { error: insertError } = await serviceSupabase.from("assistant_action_approvals").insert({
        id: approvalId,
        workspace_id: parsed.data.workspaceId,
        user_id: user.id,
        action_kind: parsed.data.action.kind,
        input_hash: inputHash,
        expires_at: expiresAt,
      });

      if (insertError) {
        audit.error("assistant_action_approval_insert_failed", {
          workspaceId: parsed.data.workspaceId,
          userId: user.id,
          actionKind: parsed.data.action.kind,
          message: insertError.message,
          code: insertError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to create assistant action approval" }, { status: 500 });
      }
    }

    audit.info("assistant_action_approval_prepared", {
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      actionKind: parsed.data.action.kind,
      approvalId,
      needsApproval,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        approvalId,
        inputHash,
        expiresAt: needsApproval ? expiresAt : null,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("assistant_action_approval_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error preparing assistant action approval" }, { status: 500 });
  }
}
