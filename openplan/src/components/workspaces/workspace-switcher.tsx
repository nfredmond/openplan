"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import type { WorkspaceOption } from "@/lib/workspaces/current";

/**
 * Switch the active workspace.
 *
 * A user can belong to more than one workspace (their own plus any they were
 * invited to); this is how they move between them. The selection persists
 * server-side (POST /api/workspaces/active writes an httpOnly cookie that every
 * page loader reads back), so the browser is never the source of truth — this
 * component is handed the current selection as a prop and only tells the server
 * to change it, then refreshes.
 *
 * With a single workspace there is nothing to switch, so it renders the name as
 * plain text — no empty dropdown.
 */
export function WorkspaceSwitcher({
  workspaces,
  currentWorkspaceId,
  currentWorkspaceName,
}: {
  workspaces: WorkspaceOption[];
  currentWorkspaceId: string | null;
  currentWorkspaceName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (workspaces.length <= 1) {
    return <span className="text-sm font-semibold text-foreground">{currentWorkspaceName}</span>;
  }

  async function select(workspaceId: string) {
    if (workspaceId === currentWorkspaceId) {
      setOpen(false);
      return;
    }
    setPendingId(workspaceId);
    setError(null);
    try {
      const res = await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not switch workspace");
      }
      setOpen(false);
      // The selection lives in a server cookie; refresh so every server
      // component re-resolves against the new active workspace.
      router.refresh();
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : "Could not switch workspace");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm font-semibold text-foreground transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="max-w-[16rem] truncate">{currentWorkspaceName}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <>
          {/* Click-away layer. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <ul
            role="listbox"
            aria-label="Switch workspace"
            className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-auto rounded-lg border border-border bg-background/98 py-1 shadow-lg"
          >
            {workspaces.map((workspace) => {
              const isCurrent = workspace.id === currentWorkspaceId;
              const isPending = workspace.id === pendingId;
              return (
                <li key={workspace.id} role="option" aria-selected={isCurrent}>
                  <button
                    type="button"
                    onClick={() => void select(workspace.id)}
                    disabled={pendingId !== null}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground">{workspace.name}</span>
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-muted-foreground" />
                    ) : isCurrent ? (
                      <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : null}
                  </button>
                </li>
              );
            })}
            {error ? (
              <li className="px-3 py-2 text-xs text-destructive" role="alert">
                {error}
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
    </div>
  );
}
