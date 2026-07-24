"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Invite teammates into a workspace.
 *
 * The invitation API has existed for a while and sign-in already accepts an
 * `?invite=` token — but nothing in the app could CREATE one, so a workspace
 * owner had no way to add anyone. That made OpenPlan single-player for every
 * multi-person organization, which is every MPO, city, county, tribe, and
 * consultancy.
 *
 * Delivery is deliberately manual and said so plainly: the server does not send
 * email (`delivery: "manual"`), so the owner copies the link. Claiming "invite
 * sent" when nothing was sent would be exactly the kind of overclaim this
 * codebase guards against elsewhere.
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

type WorkspaceTeamPanelProps = {
  workspaceId: string;
  /** Only owners and admins may manage members; the API enforces this too. */
  canManage: boolean;
};

export function WorkspaceTeamPanel({ workspaceId, canManage }: WorkspaceTeamPanelProps) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    if (!canManage || !workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/invitations?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load team");
      const body = await res.json();
      setInvitations(Array.isArray(body.invitations) ? body.invitations : []);
      setMemberCount(typeof body.memberCount === "number" ? body.memberCount : null);
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

  if (!canManage) return null;

  const pending = invitations.filter((invitation) => invitation.status === "pending");

  return (
    <section className="rounded-xl border border-border/70 p-5" aria-label="Workspace team">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Team</h2>
        <p className="text-xs text-muted-foreground">
          {memberCount === null ? "" : `${memberCount} member${memberCount === 1 ? "" : "s"}`}
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
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <Button type="submit" disabled={working}>
          {working ? "Creating…" : "Create invitation"}
        </Button>
      </form>

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

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading team…</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pending invitations. Anyone you invite joins this workspace once they sign in with the
            invited address.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
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
                <Button type="button" variant="outline" disabled={working} onClick={() => void revoke(invitation.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
