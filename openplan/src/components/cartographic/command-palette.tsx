"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

type CommandItem = {
  label: string;
  href: string;
  group: string;
  keywords?: string;
};

// The navigable modules, grouped like the rail. Operator-only surfaces (/admin)
// are intentionally omitted — the palette is for everyone.
const COMMANDS: CommandItem[] = [
  { label: "Dashboard", href: "/dashboard", group: "Operate", keywords: "home overview" },
  { label: "Command Center", href: "/command-center", group: "Operate", keywords: "operations cross-domain" },
  { label: "Projects", href: "/projects", group: "Operate", keywords: "delivery control room milestones" },
  { label: "RTP", href: "/rtp", group: "Operate", keywords: "regional transportation plan cycle" },
  { label: "Plans", href: "/plans", group: "Operate" },
  { label: "Programs", href: "/programs", group: "Operate", keywords: "rtip stip funding windows" },
  { label: "Grants", href: "/grants", group: "Operate", keywords: "funding opportunities narrative bca" },
  { label: "Reports", href: "/reports", group: "Operate", keywords: "packets exports provenance" },
  { label: "Engagement", href: "/engagement", group: "Analyze", keywords: "community public map comments" },
  { label: "Analysis Studio", href: "/explore", group: "Analyze", keywords: "corridor analysis explore" },
  { label: "Scenarios", href: "/scenarios", group: "Analyze", keywords: "baseline comparison" },
  { label: "Models", href: "/models", group: "Analyze", keywords: "travel demand model run any place" },
  { label: "County Validation", href: "/county-runs", group: "Analyze", keywords: "onboarding screening" },
  { label: "Data Hub", href: "/data-hub", group: "Analyze", keywords: "datasets geometry" },
  { label: "Aerial Ops", href: "/aerial", group: "Analyze", keywords: "drone mission imagery" },
  { label: "Agent Activity", href: "/assistant-activity", group: "Govern", keywords: "planner agent audit ledger" },
  { label: "Billing", href: "/billing", group: "Govern", keywords: "subscription plan" },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset when the palette transitions to open — the adjust-state-during-render
  // pattern (not an effect), so query/selection are fresh on each open.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  // Global ⌘K / Ctrl+K opens the palette from anywhere (external key events).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange]);

  // Focus the input when open (DOM side effect only — no setState here).
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((command) =>
      `${command.label} ${command.group} ${command.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [query]);

  // Clamp the highlighted row at render time so a shrinking result set never
  // points past the end (avoids a state-sync effect).
  const active = Math.min(activeIndex, Math.max(0, results.length - 1));

  if (!open) return null;

  function go(item: CommandItem | undefined) {
    if (!item) return;
    onOpenChange(false);
    router.push(item.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(active + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(active - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
      role="presentation"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a module"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a module…"
            aria-label="Jump to a module"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</span>
        </div>

        <ul className="max-h-80 overflow-auto py-1">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matching module.</li>
          ) : (
            results.map((item, index) => (
              <li key={item.href}>
                <button
                  type="button"
                  onClick={() => go(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    index === active ? "bg-muted/60 text-foreground" : "text-foreground/90"
                  }`}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
