"use client";

import { useEffect } from "react";

// Escape-to-clear pairs with the map backdrop's background-click-to-clear
// (Phase 3 Slice G). Background click is mouse-only; this hook gives the
// keyboard path the same exit. Registered globally on `window` so focus
// can live anywhere in the app — list rows, the inspector dock buttons,
// the map canvas — and Escape still clears.
//
// Editable-target bail-out: if the user is typing in an input / textarea
// / contenteditable, Escape retains its native meaning (cancel IME
// composition, close a native dropdown, etc). Clearing an unrelated map
// selection while someone is typing would feel like a ghost action.

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // `isContentEditable` is unreliable in layout-free environments (JSDOM),
  // so fall back to an attribute-level ancestor walk. `closest` matches
  // self first, then ancestors.
  if (target.closest('[contenteditable="true"]')) return true;
  return false;
}

export function useEscapeToClearSelection({
  enabled,
  onClear,
}: {
  enabled: boolean;
  onClear: () => void;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isEditableTarget(event.target)) return;
      onClear();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onClear]);
}
