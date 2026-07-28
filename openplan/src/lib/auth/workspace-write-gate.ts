/**
 * The viewer write gate for API routes that authorize writes by bare workspace
 * membership.
 *
 * Background: every workspace-content RLS write policy is role-blind — it asks
 * only `workspace_id IN (SELECT workspace_id FROM workspace_members WHERE
 * user_id = auth.uid())`. So a route that resolves a row through RLS and then
 * writes has confirmed MEMBERSHIP, never PERMISSION. When the read-only
 * "viewer" tier arrived, that gap let a viewer create, update, and delete
 * workspace content through those routes, contradicting the UI's promise:
 * "Read everything, change nothing."
 *
 * Modules that already have a role-matrix action gate on it directly
 * (`canAccessWorkspaceAction`) or through their own loader — `loadModelAccess`,
 * `loadScenarioSetAccess`, `loadPlanAccess`, `loadProgramAccess`,
 * `loadProjectAccess`, `loadCampaignAccess`, `loadFundingOpportunityAccess`.
 * This helper is for the rest: routes whose module has no matrix action yet, so
 * the matrix in role-matrix.ts stays the single policy table for what a viewer
 * may do while these routes still get the read-only floor.
 *
 * It refuses ONLY the viewer tier, deliberately. `isReadOnlyWorkspaceRole`
 * returns false for unknown/legacy role strings, so a bare-membership route
 * keeps its historical behavior for them — denying an existing member would be
 * a worse defect than the one being fixed here. `workspace_members.role` is
 * bare TEXT with no CHECK constraint, so that case is real, not theoretical.
 */

import { NextResponse } from "next/server";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";

/** The single wording every viewer refusal uses, matching the routes the
 *  earlier audit already gated (knowledge base, data hub, network ingest). */
export const VIEWER_READ_ONLY_MESSAGE = "Viewers have read-only access to this workspace";

export type WorkspaceWriteAccess =
  | { ok: true; role: string }
  | { ok: false; response: NextResponse };

/**
 * Confirm the caller may WRITE workspace content, using their own RLS client.
 *
 * Call it after authentication and after the workspace is resolved (from the
 * request, or from the parent record the write hangs off), and before the first
 * write — including writes to disk or to a worker, not just to Postgres.
 *
 * A non-member reads as 404 rather than 403: a caller who is not in the
 * workspace should not learn that it exists, which is the same choice
 * `checkWorkspaceMembership` and the invitations route already make.
 */
export async function requireWorkspaceWriteAccess(
  supabase: unknown,
  userId: string,
  workspaceId: string
): Promise<WorkspaceWriteAccess> {
  const membership = await checkWorkspaceMembership(supabase, userId, workspaceId);

  if (!membership.ok) {
    if (membership.kind === "not_member") {
      return {
        ok: false,
        response: NextResponse.json({ error: "Workspace not found" }, { status: 404 }),
      };
    }

    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 }),
    };
  }

  if (isReadOnlyWorkspaceRole(membership.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: VIEWER_READ_ONLY_MESSAGE }, { status: 403 }),
    };
  }

  return { ok: true, role: membership.role };
}
