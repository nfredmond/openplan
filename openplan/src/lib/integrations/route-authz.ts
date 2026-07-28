/**
 * The owner/admin gate shared by the integration-keys routes. Lives in the
 * library layer because Next.js route files may export only handlers/config,
 * and both /api/workspaces/integration-keys and its /validate sibling need
 * the identical check.
 *
 * Mirrors the explicit-membership pattern of
 * src/app/api/workspaces/invitations/route.ts exactly: a fresh
 * `workspace_members` lookup per request, never a caller-supplied role.
 * Owner/admin is required for EVERY verb here — key metadata (which providers
 * are configured, last-4, timestamps) is operator information, and storing or
 * deleting a key changes what the whole workspace's requests do.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type IntegrationKeyManagerAccess =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

function canManageIntegrationKeys(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export async function requireIntegrationKeyManager(
  workspaceId: string
): Promise<IntegrationKeyManagerAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: membership, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 }),
    };
  }
  if (!membership) {
    // 404 rather than 403: a non-member should not learn the workspace exists.
    return {
      ok: false,
      response: NextResponse.json({ error: "Workspace not found" }, { status: 404 }),
    };
  }
  if (!canManageIntegrationKeys(membership.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Owner/admin access is required" }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}
