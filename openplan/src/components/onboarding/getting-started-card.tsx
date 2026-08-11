"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

/**
 * Shows or hides the dashboard's "Get started" checklist, on the user's say-so.
 *
 * WHY THIS EXISTS. The checklist used to remove itself the moment a workspace
 * had any activity at all — one project, and it was gone forever, even when
 * the workspace's home geography (the one setting the rest of the app reads)
 * was still unset. Activity is not the same as being set up. So the rule is
 * now: the checklist stays until the person reading it says they are done with
 * it, and while the home geography is unset it stays regardless — the card is
 * the thing telling them the workspace does not know where it is, and hiding
 * that message would recreate the silent-emptiness problem it exists to solve.
 *
 * WHERE THE DISMISSAL LIVES. In this browser's local storage, keyed by user
 * and workspace — the same per-browser mechanism the dashboard view switch
 * uses, and the only preferences mechanism this app has (there is no user
 * preferences table; checked 2026-08-10 before writing this). The tradeoff is
 * real and accepted: a dismissal does not follow the person to another
 * browser, so they may dismiss twice. The failure mode of the alternative — a
 * new table for one boolean — is worse than the paper cut.
 *
 * THE WAY BACK IS PERMANENT. When the card is hidden, a low-key "Getting
 * started" link renders in its place and reopens it. Dismissal is never a
 * one-way door.
 */
export function GettingStartedCard({
  userId,
  workspaceId,
  dismissible,
  children,
}: {
  userId: string;
  workspaceId: string;
  /**
   * False while the home geography is unset: the card may not be dismissed
   * while the one setting the rest of the app reads is still outstanding.
   */
  dismissible: boolean;
  children: ReactNode;
}) {
  const storageKey = `openplan:getting-started-dismissed:${userId}:${workspaceId}`;
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      // Storage can be unavailable; showing the card is the safe answer.
    }
  }, [storageKey]);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // The card still hides for this visit.
    }
  }

  function reopen() {
    setDismissed(false);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // The card still shows for this visit.
    }
  }

  // Before mount the stored choice is unknown, so the server-rendered card is
  // shown — which is also what the server rendered, so hydration has nothing
  // to correct.
  const hidden = mounted && dismissed && dismissible;

  if (hidden) {
    return (
      <p className="text-xs text-muted-foreground">
        <button
          type="button"
          onClick={reopen}
          className="inline-flex items-center gap-1 font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Getting started
        </button>{" "}
        — reopen the setup checklist any time.
      </p>
    );
  }

  return (
    <div>
      {children}
      {dismissible ? (
        <p className="mt-3 text-right text-xs">
          <button
            type="button"
            onClick={dismiss}
            className="font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Hide this checklist
          </button>
        </p>
      ) : null}
    </div>
  );
}
