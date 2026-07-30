import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type WorkspaceRole, WORKSPACE_ROLES } from "@/lib/auth/role-matrix";
import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { invitationPath } from "@/lib/workspaces/invitation-path";

export const WORKSPACE_INVITATION_STATUSES = ["pending", "accepted", "declined", "revoked", "expired"] as const;

export type WorkspaceInvitationStatus = (typeof WORKSPACE_INVITATION_STATUSES)[number];

export type WorkspaceInvitationRow = {
  id: string;
  workspace_id: string;
  email: string;
  email_normalized: string;
  role: WorkspaceRole;
  status: WorkspaceInvitationStatus;
  token_hash: string;
  token_prefix: string | null;
  invited_by_user_id: string | null;
  accepted_by_user_id?: string | null;
  expires_at: string;
  accepted_at?: string | null;
  declined_at?: string | null;
  revoked_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WorkspaceInvitationSupabaseLike = Pick<SupabaseClient, "from">;

export type CreateWorkspaceInvitationInput = {
  supabase: WorkspaceInvitationSupabaseLike;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  invitedByUserId?: string | null;
  origin: string;
  expiresAt?: Date;
  now?: Date;
};

/**
 * Either an invitation, or the one outcome that is neither an invitation nor a
 * failure: the reissue UPDATE matched no rows. Nothing broke and nothing was
 * saved, so it is returned rather than thrown — a caller that cannot tell the
 * two apart reports a race as a broken database.
 */
export type CreateWorkspaceInvitationResult =
  | {
      ok: true;
      invitation: WorkspaceInvitationRow;
      token: string;
      invitationUrl: string;
      reissued: boolean;
    }
  | { ok: false; reason: "reissue_matched_no_rows" };

export type InvitationLookupResult =
  | { ok: true; invitation: WorkspaceInvitationRow }
  | { ok: false; reason: "not_found" | "not_pending" | "expired"; invitation?: WorkspaceInvitationRow };

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * WHAT ACCEPTING ACTUALLY GRANTS, in words the person deciding can act on.
 *
 * Kept beside `ROLE_RANK` so the sentence and the authority it describes are
 * edited together — a role whose powers change and whose description does not
 * is a consent screen that misinforms. `Record<WorkspaceRole, …>` rather than
 * `Record<string, …>` makes a new role a build error here rather than a blank
 * space on the page where the grant should be stated.
 */
export const WORKSPACE_ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "Full control, including billing-free workspace settings and ownership transfer.",
  admin: "Manage the team and all workspace content.",
  member: "Create and edit workspace content.",
  viewer: "Read everything, change nothing.",
};

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function normalizeInvitationEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeInvitationRole(value: string | null | undefined): WorkspaceRole | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !isWorkspaceRole(normalized)) {
    return null;
  }

  return normalized;
}

export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenPrefixFromHash(tokenHash: string): string {
  return tokenHash.slice(0, 12);
}

export function defaultInvitationExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
}

/**
 * WHERE AN INVITATION LINK LANDS, and why it is no longer `/sign-up`.
 *
 * It used to point at `/sign-up?invite=…&redirect=/dashboard`, and the sign-in
 * form that followed POSTed the token to `/accept` on the way past. Signing in
 * WAS accepting: a person who followed the link to see what they had been sent
 * joined a workspace without being shown its name, the role they were given, or
 * who invited them — and there was no way to say no, because
 * `/api/workspaces/invitations/decline` existed with nothing calling it.
 *
 * Now the link lands on the invitation itself. That page states what is being
 * offered and by whom, and accepting and declining are two buttons a person
 * chooses between. Signing in is authentication again, not a decision.
 *
 * The token stays in the PATH rather than the query so it survives the
 * sign-up → sign-in hop as a plain redirect target, which is one fewer place
 * for it to be dropped.
 */
export function buildInvitationUrl(origin: string, token: string): string {
  return new URL(invitationPath(token), origin).toString();
}

/**
 * Re-exported so server callers have one import for the invitation vocabulary.
 * It is DEFINED in `invitation-path.ts` because this module imports
 * `node:crypto`, and the sign-in form that also needs the path runs in the
 * browser — see that file.
 */
export { invitationPath };

export function higherWorkspaceRole(left: WorkspaceRole, right: WorkspaceRole): WorkspaceRole {
  return ROLE_RANK[left] >= ROLE_RANK[right] ? left : right;
}

export function isInvitationExpired(invitation: Pick<WorkspaceInvitationRow, "expires_at">, now = new Date()): boolean {
  return Date.parse(invitation.expires_at) <= now.getTime();
}

export async function createWorkspaceInvitation({
  supabase,
  workspaceId,
  email,
  role,
  invitedByUserId = null,
  origin,
  expiresAt,
  now = new Date(),
}: CreateWorkspaceInvitationInput): Promise<CreateWorkspaceInvitationResult> {
  const emailNormalized = normalizeInvitationEmail(email);
  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const tokenPrefix = tokenPrefixFromHash(tokenHash);
  const effectiveExpiresAt = expiresAt ?? defaultInvitationExpiresAt(now);

  const existing = await supabase
    .from("workspace_invitations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("email_normalized", emailNormalized)
    .eq("status", "pending")
    .maybeSingle();

  if (existing.error) {
    throw new Error(existing.error.message);
  }

  const payload = {
    workspace_id: workspaceId,
    email: email.trim(),
    email_normalized: emailNormalized,
    role,
    status: "pending" as const,
    token_hash: tokenHash,
    token_prefix: tokenPrefix,
    invited_by_user_id: invitedByUserId,
    expires_at: effectiveExpiresAt.toISOString(),
    accepted_by_user_id: null,
    accepted_at: null,
    declined_at: null,
    revoked_at: null,
  };

  const query = existing.data?.id
    ? supabase
        .from("workspace_invitations")
        .update(payload)
        .eq("id", existing.data.id)
        .select("*")
        .single()
    : supabase.from("workspace_invitations").insert(payload).select("*").single();

  const result = await query;
  if (isWriteFailure(result.error)) {
    throw new Error(result.error?.message ?? "Failed to create workspace invitation");
  }

  const reissued = Boolean(existing.data?.id);

  // Zero rows means two different things on the two branches. On the reissue
  // branch the pending invitation read a moment ago is no longer updatable —
  // accepted, revoked, or refused below the application — so nothing was saved
  // and the caller is told exactly that. On the insert branch the row WAS
  // written and only the read-back came back empty, which is not this outcome
  // and keeps the throw it has always had.
  if (reissued && writeMatchedNoRows(result)) {
    return { ok: false, reason: "reissue_matched_no_rows" };
  }

  if (!result.data) {
    throw new Error(result.error?.message ?? "Failed to create workspace invitation");
  }

  return {
    ok: true,
    invitation: result.data as WorkspaceInvitationRow,
    token,
    invitationUrl: buildInvitationUrl(origin, token),
    reissued,
  };
}

export async function loadInvitationByToken(
  supabase: WorkspaceInvitationSupabaseLike,
  token: string,
  now = new Date()
): Promise<InvitationLookupResult> {
  const tokenHash = hashInvitationToken(token);
  const result = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (!result.data) {
    return { ok: false, reason: "not_found" };
  }

  const invitation = result.data as WorkspaceInvitationRow;
  if (invitation.status !== "pending") {
    return { ok: false, reason: "not_pending", invitation };
  }

  if (isInvitationExpired(invitation, now)) {
    return { ok: false, reason: "expired", invitation };
  }

  return { ok: true, invitation };
}
