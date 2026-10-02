"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { ModalDialog } from "@/components/ui/modal-dialog";

import {
  buildPaletteCommands,
  type AppNavPaletteCommand,
} from "@/components/nav/nav-registry";

// Every navigable module, grouped like the rail — the shared nav registry is
// the single source, so the palette can never drift out of sync with what the
// rail and the auth proxy know about.
const COMMANDS: AppNavPaletteCommand[] = buildPaletteCommands();

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();

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

  function go(item: AppNavPaletteCommand | undefined) {
    if (!item) return;
    onOpenChange(false);
    router.push(item.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // Escape is the dialog's own: `ModalDialog` closes on it and returns focus.
    if (event.key === "ArrowDown") {
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

  const optionId = (index: number) => `${listId}-option-${index}`;

  /*
    A real modal with a combobox inside. It used to be a hand-built overlay:
    focus could leave it, closing did not return focus, and moving the highlight
    with the arrow keys was silent because the list had no roles. The input now
    owns a listbox and names the highlighted option.
  */
  return (
    <ModalDialog
      titleId={titleId}
      onRequestClose={() => onOpenChange(false)}
      initialFocusRef={inputRef}
      closeOnBackdropPress
      className="mt-[12vh] w-[calc(100%-2rem)] max-w-lg rounded-xl shadow-2xl"
    >
      <div onKeyDown={onKeyDown}>
        <h2 id={titleId} className="sr-only">
          Jump to a module
        </h2>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a module…"
            aria-label="Jump to a module"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <span className="rounded border border-border px-1.5 py-0.5 text-label text-muted-foreground">esc</span>
        </div>

        <ul id={listId} role="listbox" aria-label="Modules" className="max-h-80 overflow-auto py-1">
          {results.length === 0 ? (
            <li role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matching module.
            </li>
          ) : (
            results.map((item, index) => (
              // An option, not a button inside one: focus stays in the input and
              // `aria-activedescendant` says which row is highlighted.
              <li
                key={item.href}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onClick={() => go(item)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm ${
                  index === active ? "bg-muted/60 text-foreground" : "text-foreground/90"
                }`}
              >
                <span className="font-medium">{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.group}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </ModalDialog>
  );
}
