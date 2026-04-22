"use client";

import { useRouter } from "next/navigation";
import { Bell, Plus, Search } from "lucide-react";

type CartographicHeaderProps = {
  workspaceName: string;
  workspacePlan: string;
  workspaceUpdatedLabel?: string | null;
  notificationCount?: number;
  onNewRun?: () => void;
};

export function CartographicHeader({
  workspaceName,
  workspacePlan,
  workspaceUpdatedLabel,
  notificationCount,
  onNewRun,
}: CartographicHeaderProps) {
  const router = useRouter();

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
    <header className="op-cart-hdr">
      <div className="op-cart-pill">
        <div className="op-cart-ws-mark" aria-hidden />
        <div className="op-cart-ws-body">
          <div className="op-cart-ws-name">{workspaceName}</div>
          <div className="op-cart-ws-meta">{meta}</div>
        </div>
      </div>

      <div className="op-cart-pill op-cart-search">
        <Search size={14} strokeWidth={1.8} />
        <input
          type="search"
          placeholder="Jump to project, run, RTP packet…"
          aria-label="Search OpenPlan"
        />
        <span className="op-cart-kbd">⌘K</span>
      </div>

      <button className="op-cart-btn" type="button" aria-label="Notifications">
        <Bell size={14} strokeWidth={1.8} />
        {typeof notificationCount === "number" && notificationCount > 0 ? (
          <span>{notificationCount}</span>
        ) : null}
      </button>

      <button
        type="button"
        className="op-cart-btn op-cart-btn--primary"
        onClick={handleNewRun}
      >
        <Plus size={14} strokeWidth={2} />
        New run
      </button>
    </header>
  );
}
