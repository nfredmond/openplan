/**
 * Explicit workspace-membership guard for API routes.
 *
 * The companion to `loadCurrentWorkspaceMembership` in ./current.ts: that one
 * resolves the caller's *current* workspace, this one confirms membership in a
 * workspace the request names explicitly.
 *
 * It originally lived in `src/lib/knowledge-base/documents.ts`. It is a generic
 * workspace concern rather than a Knowledge Base one, and the Safety module
 * needs the same guard, so it moved here rather than being imported across
 * modules or duplicated. `knowledge-base/documents.ts` re-exports it so existing
 * imports keep working.
 */

import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

/**
 * Compatibility re-export. Membership is not where "is this a pending migration?"
 * is answered; two callers outside this module import it from here. Point them at
 * `@/lib/supabase/pending-schema` and delete this line.
 */
export { looksLikePendingSchema };

type QueryError = { message: string; code?: string | null } | null;

type MembershipQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => PromiseLike<{ data: { role: string } | null; error: QueryError }>;
        };
      };
    };
  };
};

export type WorkspaceMembershipResult =
  | { ok: true; role: string }
  | { ok: false; kind: "not_member" | "schema_pending" | "error"; message: string };

/**
 * Confirm the user belongs to the workspace, using the caller's RLS client.
 * Distinguishes a missing membership (404) from a not-yet-applied schema (503)
 * and a real query failure (500), matching the Data Hub records route.
 */
export async function checkWorkspaceMembership(
  supabase: unknown,
  userId: string,
  workspaceId: string
): Promise<WorkspaceMembershipResult> {
  const client = supabase as MembershipQueryClient;
  const { data, error } = await client
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (looksLikePendingSchema(error.message)) {
      return { ok: false, kind: "schema_pending", message: error.message };
    }
    return { ok: false, kind: "error", message: error.message };
  }
  if (!data) {
    return { ok: false, kind: "not_member", message: "Workspace not found" };
  }
  return { ok: true, role: data.role };
}
