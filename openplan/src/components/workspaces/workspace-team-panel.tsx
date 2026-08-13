"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { WORKSPACE_ROLE_DESCRIPTIONS } from "@/lib/auth/role-matrix";

/**
 * Invite teammates into a workspace, and manage the members already in it.
 *
 * The invitation API has existed for a while — but nothing in the app could
 * CREATE an invitation, so a workspace owner had no way to add anyone. That made OpenPlan single-player for every
 * multi-person organization, which is every MPO, city, county, tribe, and
 * consultancy.
 *
 * Member management closes the other half of that gap: roles can be changed
 * and members removed here, backed by /api/workspaces/members, which enforces
 * the authority rules (owner-only owner changes, last-owner protection)
 * server-side. Error copy from that API is rendered verbatim.
 *
 * Delivery is deliberately manual and said so plainly: the server does not send
 * email (`delivery: "manual"`), so the owner copies the link. Claiming "invite
 * sent" when nothing was sent would be exactly the kind of overclaim this
 * codebase guards against elsewhere.
 *
 * SELF-AFFECTING MUTATIONS ARE DIFFERENT. `canManage` is computed on the SERVER
 * from the caller's role, so the moment a caller demotes or removes THEMSELVES
 * this panel's authority is stale — and it cannot re-read its own way out of
 * it, because the members API answers 403 to a non-manager and 404 to a
 * non-member. Those two cases therefore ask the server to re-render the page
 * (`router.refresh()`) instead of trusting local state, and hold the controls
 * disabled until that lands. Anything else would keep offering management
 * actions whose next request is already refused.
 */

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

type Member = {
  userId: string;
  email: string | null;
  role: string;
  joinedAt: string | null;
};

type InviteRole = "member" | "admin" | "viewer";

// The descriptions come from the role vocabulary itself, so this panel and the
// invitation page a colleague reads cannot describe the same role differently.

type WorkspaceTeamPanelProps = {
  workspaceId: string;
  /** Only owners and admins may manage members; the API enforces this too. */
  canManage: boolean;
};

/** The roles the members API lets manage a team; everything else is read-only there. */
function isManagerRole(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function WorkspaceTeamPanel({ workspaceId, canManage }: WorkspaceTeamPanelProps) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [callerUserId, setCallerUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfChangeNotice, setSelfChangeNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  // Tracks the server re-render that follows a self-affecting mutation: it
  // stays pending until the page comes back with the caller's NEW role, which
  // is exactly how long the controls must stay disabled.
  const [refreshingAccess, startAccessRefresh] = useTransition();
  const busy = working || refreshingAccess;

  const load = useCallback(async () => {
    if (!canManage || !workspaceId) return;
    setLoading(true);
    try {
      const [invitationsRes, membersRes] = await Promise.all([
        fetch(`/api/workspaces/invitations?workspaceId=${encodeURIComponent(workspaceId)}`),
        fetch(`/api/workspaces/members?workspaceId=${encodeURIComponent(workspaceId)}`),
      ]);
      if (!invitationsRes.ok) {
        throw new Error((await invitationsRes.json().catch(() => ({}))).error ?? "Failed to load team");
      }
      if (!membersRes.ok) {
        throw new Error((await membersRes.json().catch(() => ({}))).error ?? "Failed to load members");
      }
      const invitationsBody = await invitationsRes.json();
      const membersBody = await membersRes.json();
      setInvitations(Array.isArray(invitationsBody.invitations) ? invitationsBody.invitations : []);
      setMembers(Array.isArray(membersBody.members) ? membersBody.members : []);
      setCallerUserId(typeof membersBody.callerUserId === "string" ? membersBody.callerUserId : null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The caller just changed their OWN membership and the server confirmed it.
   * Re-render the page from the server so `canManage` — and every other surface
   * rendered for this role — reflects the new truth; this panel disappears on
   * its own if management is no longer the caller's. Only re-list the team when
   * the caller can still read it; after leaving or dropping to member/viewer,
   * that request would be refused and its error would be noise, not news.
   *
   * `fact` states only what the server confirmed; the "reloading" half of the
   * message is rendered from the live transition state, so it is never claimed
   * after the reload has landed.
   */
  function applySelfMembershipChange(fact: string, callerStillManages: boolean) {
    setSelfChangeNotice(fact);
    if (callerStillManages) void load();
    startAccessRefresh(() => {
      router.refresh();
    });
  }

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setWorking(true);
    setError(null);
    setInviteUrl(null);
    setCopied(false);
    try {
      const res = await fetch("/api/workspaces/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, email, role }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create the invitation");
      setInviteUrl(body.invitationUrl ?? null);
      setEmail("");
      await load();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Could not create the invitation");
    } finally {
      setWorking(false);
    }
  }

  async function revoke(invitationId: string) {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces/invitations", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, invitationId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not revoke");
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Could not revoke");
    } finally {
      setWorking(false);
    }
  }

  async function changeMemberRole(member: Member, nextRole: string) {
    if (nextRole === member.role) return;
    const isSelf = callerUserId !== null && member.userId === callerUserId;
    setWorking(true);
    setError(null);
    setSelfChangeNotice(null);
    try {
      const res = await fetch("/api/workspaces/members", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, userId: member.userId, role: nextRole }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? "Could not change the role");
      }
      if (isSelf) {
        const stillManages = isManagerRole(nextRole);
        applySelfMembershipChange(
          stillManages
            ? `You changed your own role to ${nextRole}.`
            : `Your role is now ${nextRole}, which cannot manage this team.`,
          stillManages
        );
        return;
      }
      await load();
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "Could not change the role");
    } finally {
      setWorking(false);
    }
  }

  async function removeMember(member: Member) {
    const isSelf = callerUserId !== null && member.userId === callerUserId;
    const who = member.email ?? "this member";
    const confirmed = await confirm(
      isSelf
        ? {
            headline: "Leave this workspace?",
            consequence:
              "You will immediately lose access to all of its projects and data.",
            confirmLabel: "Leave this workspace",
            cancelLabel: "Stay",
          }
        : {
            headline: `Remove ${who} from the workspace?`,
            consequence:
              "They will immediately lose access to all of its projects and data.",
            confirmLabel: "Remove this member",
          }
    );
    if (!confirmed) return;

    setWorking(true);
    setError(null);
    setSelfChangeNotice(null);
    try {
      const res = await fetch("/api/workspaces/members", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, userId: member.userId }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? "Could not remove the member");
      }
      if (isSelf) {
        applySelfMembershipChange("You left this workspace.", false);
        return;
      }
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove the member");
    } finally {
      setWorking(false);
    }
  }

  if (!canManage) return null;

  const pending = invitations.filter((invitation) => invitation.status === "pending");
  const selfRole = callerUserId
    ? (members.find((member) => member.userId === callerUserId)?.role ?? null)
    : null;
  // The API is the authority; the select just avoids offering actions that
  // would be refused: only an owner may grant/revoke the owner role or touch
  // another owner at all.
  const assignableRoles = selfRole === "owner" ? ["owner", "admin", "member", "viewer"] : ["admin", "member", "viewer"];

  return (
    <section className="rounded-xl border border-border/70 p-5" aria-label="Workspace team">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Team</h2>
        <p className="text-xs text-muted-foreground">
          {members.length === 0 ? "" : `${members.length} member${members.length === 1 ? "" : "s"}`}
          {pending.length > 0 ? ` · ${pending.length} pending invitation${pending.length === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={invite}>
        <div className="min-w-56 flex-1 space-y-1">
          <label htmlFor="invite-email" className="text-xs font-medium text-muted-foreground">
            Work email
          </label>
          <Input
            id="invite-email"
            type="email"
            placeholder="colleague@agency.gov"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="invite-role" className="text-xs font-medium text-muted-foreground">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as InviteRole)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <Button type="submit" disabled={busy}>
          {working ? "Creating…" : "Create invitation"}
        </Button>
      </form>
      <p className="mt-1 text-xs text-muted-foreground">{WORKSPACE_ROLE_DESCRIPTIONS[role]}</p>

      {inviteUrl ? (
        <div className="mt-4 rounded-md border border-emerald-300/70 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/20">
          <p className="font-medium">Invitation link ready — send it yourself.</p>
          <p className="mt-1 text-muted-foreground">
            OpenPlan does not email invitations. Copy this link and send it to your colleague. It is
            shown once and cannot be retrieved again; if you lose it, create a new invitation.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-background/70 px-2 py-1 text-xs">
              {inviteUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(inviteUrl).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}

      {selfChangeNotice ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {selfChangeNotice}
          {refreshingAccess ? " Reloading your access…" : ""}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading team…</p>
        ) : (
          <>
            {members.length > 0 ? (
              <ul className="divide-y divide-border/60 text-sm" aria-label="Workspace members">
                {members.map((member) => {
                  const isSelf = callerUserId !== null && member.userId === callerUserId;
                  const targetIsOwner = member.role === "owner";
                  // An admin may not touch an owner; the API refuses it too.
                  const canEditTarget = selfRole === "owner" || !targetIsOwner;
                  return (
                    <li
                      key={member.userId}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{member.email ?? "Unknown email"}</span>
                        {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}{" "}
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {member.role}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {canEditTarget ? (
                          <select
                            aria-label={`Role for ${member.email ?? member.userId}`}
                            value={member.role}
                            disabled={busy}
                            onChange={(e) => void changeMemberRole(member, e.target.value)}
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                          >
                            {(assignableRoles.includes(member.role)
                              ? assignableRoles
                              : [member.role, ...assignableRoles]
                            ).map((option) => (
                              <option key={option} value={option}>
                                {option.charAt(0).toUpperCase() + option.slice(1)}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {canEditTarget || isSelf ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void removeMember(member)}
                          >
                            {isSelf ? "Leave" : "Remove"}
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {pending.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No pending invitations. Anyone you invite joins this workspace once they sign in with
                the invited address.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border/60 text-sm" aria-label="Pending invitations">
                {pending.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{invitation.email}</span>{" "}
                      <span className="text-muted-foreground">· {invitation.role}</span>
                      {invitation.expires_at ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · expires {new Date(invitation.expires_at).toLocaleDateString()}
                        </span>
                      ) : null}
                    </span>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void revoke(invitation.id)}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {confirmDialog}
    </section>
  );
}
