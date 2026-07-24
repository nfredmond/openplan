"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import type { WorkspaceOption } from "@/lib/workspaces/current";
import { WorkspaceSwitcher } from "@/components/workspaces/workspace-switcher";
import { CommandPalette } from "./command-palette";

type CartographicHeaderProps = {
  workspaceName: string;
  workspaceUpdatedLabel?: string | null;
  workspaces?: WorkspaceOption[];
  currentWorkspaceId?: string | null;
  onNewRun?: () => void;
};

export function CartographicHeader({
  workspaceName,
  workspaceUpdatedLabel,
  workspaces = [],
  currentWorkspaceId = null,
  onNewRun,
}: CartographicHeaderProps) {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);

  function handleNewRun() {
    if (onNewRun) {
      onNewRun();
      return;
    }
    router.push("/explore");
  }

  // No plan chip: OpenPlan is free with no tiers, so the only honest metadata
  // here is when the workspace was last touched.
  const meta = workspaceUpdatedLabel && workspaceUpdatedLabel.length > 0 ? workspaceUpdatedLabel : null;

  return (
    <>
      <header className="op-cart-hdr">
        <div className="op-cart-pill">
          <div className="op-cart-ws-mark" aria-hidden />
          <div className="op-cart-ws-body">
            <div className="op-cart-ws-name">
              <WorkspaceSwitcher
                workspaces={workspaces}
                currentWorkspaceId={currentWorkspaceId}
                currentWorkspaceName={workspaceName}
              />
            </div>
            <div className="op-cart-ws-meta">{meta}</div>
          </div>
        </div>

        <button
          type="button"
          className="op-cart-pill op-cart-search"
          onClick={() => setPaletteOpen(true)}
          aria-label="Jump to a module (Command-K)"
        >
          <Search size={14} strokeWidth={1.8} />
          <span className="op-cart-search__placeholder">Jump to a module…</span>
          <span className="op-cart-kbd">⌘K</span>
        </button>

        <button type="button" className="op-cart-btn op-cart-btn--primary" onClick={handleNewRun}>
          <Plus size={14} strokeWidth={2} />
          New run
        </button>
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
