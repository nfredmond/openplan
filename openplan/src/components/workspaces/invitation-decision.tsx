"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceRole } from "@/lib/auth/role-matrix";

/**
 * ACCEPT AND DECLINE, PRESENTED AS TWO ANSWERS TO THE SAME QUESTION.
 *
 * The decline route has existed — written, tested, audited, email-matched —
 * with nothing in the product calling it, which meant the only way out of an
 * invitation was to ignore it until it expired. Both buttons are here, and
 * neither is the page's default action: there is no auto-submit, and nothing
 * happens until one is pressed.
 *
 * DECLINE IS NOT STYLED AS DANGER. Refusing a workspace invitation is an
 * ordinary answer, not a destructive act, and a red button teaches people that
 * saying no is the wrong choice. It is quieter than accept because accept is
 * what most invitations are for — not because declining is discouraged.
 *
 * WHAT EACH BUTTON GRANTS IS STATED BEFORE IT IS PRESSED, by the page above.
 * This component only carries out the answer.
 */
export function InvitationDecision({
  token,
  workspaceName,
  role,
  roleDescription,
  invitedEmail,
  invitedBy,
  expiresAt,
}: {
  token: string;
  /** Null when the workspace name could not be read; the decision stands anyway. */
  workspaceName: string | null;
  role: WorkspaceRole;
  roleDescription: string;
  invitedEmail: string;
  /** Null when the inviter's account is gone or unreadable. */
  invitedBy: string | null;
  expiresAt: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  async function answer(decision: "accept" | "decline") {
    setError(null);
    setPending(decision);

    let response: Response;
    try {
      response = await fetch(`/api/workspaces/invitations/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch {
      // A request that never reached the server has decided nothing, and the
      // invitation is still open. Say so, rather than leaving a spinner.
      setError("Could not reach OpenPlan. Your invitation is unchanged — check your connection and try again.");
      setPending(null);
      return;
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Could not ${decision} this invitation.`);
      setPending(null);
      return;
    }

    if (decision === "decline") {
      setDeclined(true);
      setPending(null);
      return;
    }

    // Accepted: the membership is what the rest of the app reads from, so the
    // server components have to be re-rendered, not just navigated to.
    router.push("/dashboard");
    router.refresh();
  }

  if (declined) {
    return (
      <section className="rounded-lg border border-border/70 bg-background/60 px-6 py-6">
        <h2 className="font-display text-2xl font-semibold tracking-tight">Invitation declined.</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          You have not joined {workspaceName ?? "this workspace"}, and nothing was shared with it. Whoever
          invited you can see that it was declined and can send a new invitation if this was a mistake.
        </p>
      </section>
    );
  }

  const expiry = new Date(expiresAt);
  const expiryLabel = Number.isNaN(expiry.getTime())
    ? null
    : expiry.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <section className="rounded-lg border border-border/70 bg-background/60 px-6 py-6">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Workspace invitation
      </p>
      <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">
        {workspaceName ? `Join ${workspaceName}.` : "Join this workspace."}
      </h2>

      <dl className="mt-5 space-y-3 border-y border-border/60 py-4 text-sm leading-6">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <dt className="font-semibold text-foreground">Your role</dt>
          <dd className="text-muted-foreground">
            {role} — {roleDescription}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <dt className="font-semibold text-foreground">Invited address</dt>
          <dd className="text-muted-foreground">{invitedEmail}</dd>
        </div>
        {invitedBy ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <dt className="font-semibold text-foreground">Invited by</dt>
            <dd className="text-muted-foreground">{invitedBy}</dd>
          </div>
        ) : null}
        {expiryLabel ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <dt className="font-semibold text-foreground">Open until</dt>
            <dd className="text-muted-foreground">{expiryLabel}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        Accepting adds your account to this workspace and gives everyone in it the access described above.
        Nothing is shared with the workspace until you accept.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void answer("accept")}
          disabled={pending !== null}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition-opacity disabled:opacity-60"
        >
          {pending === "accept" ? "Joining…" : "Accept and join"}
        </button>
        <button
          type="button"
          onClick={() => void answer("decline")}
          disabled={pending !== null}
          className="rounded-md border border-border/70 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
        >
          {pending === "decline" ? "Declining…" : "Decline"}
        </button>
      </div>
    </section>
  );
}
