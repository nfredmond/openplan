import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import {
  loadWorkspaceReminderPreference,
  MAX_REMINDER_ADVANCE_DAYS,
  MIN_REMINDER_ADVANCE_DAYS,
} from "@/lib/notifications/reminder-preferences";

const workspaceIdSchema = z.string().uuid();
const patchSchema = z.object({
  workspaceId: workspaceIdSchema,
  advanceDays: z.number().int().min(MIN_REMINDER_ADVANCE_DAYS).max(MAX_REMINDER_ADVANCE_DAYS),
  emailDigestEnabled: z.boolean(),
});

async function caller(workspaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const membership = await checkWorkspaceMembership(supabase, user.id, workspaceId);
  if (!membership.ok) {
    return { response: NextResponse.json({ error: "Workspace not found" }, { status: membership.kind === "schema_pending" ? 503 : 404 }) };
  }
  return { supabase, membership };
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.reminder_preferences.read", request);
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!workspaceIdSchema.safeParse(workspaceId).success) {
    audit.warn("reminder_preferences_invalid_workspace");
    return NextResponse.json({ error: "A valid workspaceId is required" }, { status: 400 });
  }
  const auth = await caller(workspaceId);
  if ("response" in auth) return auth.response;
  const loaded = await loadWorkspaceReminderPreference(auth.supabase, workspaceId);
  if (loaded.error) audit.warn("reminder_preferences_read_degraded", { workspaceId, error: loaded.error });
  else audit.info("reminder_preferences_read", { workspaceId, pending: loaded.pending });
  return NextResponse.json({ ...loaded.preference, pending: loaded.pending, error: loaded.error });
}

export async function PATCH(request: NextRequest) {
  const audit = createApiAuditLogger("workspaces.reminder_preferences.update", request);
  const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid reminder preferences" }, { status: 400 });
  const auth = await caller(parsed.data.workspaceId);
  if ("response" in auth) return auth.response;
  if (!canAccessWorkspaceAction("workspace.configure", auth.membership.role)) {
    audit.warn("reminder_preferences_update_forbidden", { workspaceId: parsed.data.workspaceId });
    return NextResponse.json({ error: "Only workspace owners and admins can change reminder preferences" }, { status: 403 });
  }
  const { error } = await auth.supabase.from("workspace_reminder_preferences").upsert(
    {
      workspace_id: parsed.data.workspaceId,
      advance_days: parsed.data.advanceDays,
      email_digest_enabled: parsed.data.emailDigestEnabled,
    },
    { onConflict: "workspace_id" }
  );
  if (error) {
    audit.error("reminder_preferences_update_failed", { workspaceId: parsed.data.workspaceId, error });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  audit.info("reminder_preferences_updated", {
    workspaceId: parsed.data.workspaceId,
    advanceDays: parsed.data.advanceDays,
    emailDigestEnabled: parsed.data.emailDigestEnabled,
  });
  return NextResponse.json(parsed.data);
}
