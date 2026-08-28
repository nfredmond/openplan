"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { WorkspaceOption } from "@/lib/workspaces/current";
import { WorkspaceSwitcher } from "@/components/workspaces/workspace-switcher";
import { CommandPalette } from "./command-palette";
import { LocalClock } from "./local-clock";
import { ThemeControls } from "@/components/theme-controls";

type CartographicHeaderProps = {
  workspaceName: string;
  workspaces?: WorkspaceOption[];
  currentWorkspaceId?: string | null;
};

export function CartographicHeader({
  workspaceName,
  workspaces = [],
  currentWorkspaceId = null,
}: CartographicHeaderProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);

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
            {/*
              No plan chip: OpenPlan is free with no tiers. This line is the
              reader's own clock — see LocalClock for what it replaced and why.
            */}
            <LocalClock className="op-cart-ws-meta" />
          </div>
        </div>

        <div className="op-cart-hdr__spacer" aria-hidden />

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

        {/* Appearance stays in the header because it affects every page. Work
            creation belongs to the page that owns the record, where its one
            primary action can name what will be created. */}
        <div className="op-cart-hdr__actions">
          <ThemeControls className="op-cart-appearance" />
        </div>
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
