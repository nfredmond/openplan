"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { CommandPalette } from "./command-palette";

type CartographicHeaderProps = {
  workspaceName: string;
  workspacePlan: string;
  workspaceUpdatedLabel?: string | null;
  onNewRun?: () => void;
};

export function CartographicHeader({
  workspaceName,
  workspacePlan,
  workspaceUpdatedLabel,
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

  const meta =
    workspaceUpdatedLabel && workspaceUpdatedLabel.length > 0
      ? `${workspacePlan} · ${workspaceUpdatedLabel}`
      : workspacePlan;

  return (
    <>
      <header className="op-cart-hdr">
        <div className="op-cart-pill">
          <div className="op-cart-ws-mark" aria-hidden />
          <div className="op-cart-ws-body">
            <div className="op-cart-ws-name">{workspaceName}</div>
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
