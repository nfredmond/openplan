"use client";

/**
 * The control that gets the page out of the way of the map.
 *
 * ═══ WHY THIS IS A BUTTON AND NOT A SETTING ═══
 *
 * See `mapReading` in `cartographic-context` for the measurements. The short
 * version: the surface panel covers ~74% of the window and is opaque enough
 * that a layer beneath it contributes on the order of one part in 255, and the
 * translucency that would fix that takes ordinary body text from 3.37:1 to
 * 2.57:1. There is no opacity that serves both. There IS a moment when a
 * planner wants the map and a moment when they want the page, and this is how
 * they say which.
 *
 * ═══ THE RULES THIS CONTROL MUST NEVER BREAK ═══
 *
 * 1. IT NEVER DISAPPEARS. It sits in the map dock, above the surface, and looks
 *    the same in both states. A control that vanishes when it is used is a
 *    control that strands keyboard focus — and this one, of all of them, would
 *    strand it on a page that is no longer there.
 * 2. THERE IS ALWAYS A SECOND WAY BACK. Escape, unless a map selection is open,
 *    in which case Escape keeps its existing meaning (clear the selection) and
 *    this control is still one Tab away.
 * 3. LEAVING THE MAP ENDS THE MODE. The unmount cleanup, not a route list:
 *    this control only mounts inside `MapSurfaceOnly`, so navigating to the RTP
 *    registry unmounts it and restores the page by construction. A planner can
 *    never arrive at a records page to find it missing.
 * 4. THE STATE IS ANNOUNCED, NOT INFERRED. `aria-pressed` carries it for
 *    assistive technology and the status line carries it in words, because the
 *    visual signal — "most of the screen is now a map" — is the one signal a
 *    screen-reader user does not get.
 */

import { useCallback, useEffect, useRef } from "react";

import { useCartographicMapReading } from "./cartographic-context";

export function CartographicMapReadingToggle() {
  const { mapReading, setMapReading, toggleMapReading, hasSelection } =
    useCartographicMapReading();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Rule 3. Written as a cleanup with no dependency on the current value so it
  // runs exactly once, at unmount, whatever the mode was.
  useEffect(() => {
    return () => setMapReading(false);
  }, [setMapReading]);

  const exit = useCallback(() => {
    setMapReading(false);
    // Focus comes back to the control rather than being left wherever it was,
    // because "wherever it was" may be inside the surface that was inert.
    buttonRef.current?.focus();
  }, [setMapReading]);

  useEffect(() => {
    if (!mapReading) return;
    /*
      ESCAPE DEFERS TO AN OPEN SELECTION.

      `useEscapeToClearSelection` is registered on the same `window` and clears
      the inspector. Two handlers firing on one key press would close the
      inspector AND restore the page, which is one keystroke doing two things a
      planner asked for separately. The selection wins because it is the more
      recent, more specific thing on screen; the button is still one Tab away.
    */
    if (hasSelection) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      exit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mapReading, hasSelection, exit]);

  return (
    <div className="op-cart-mapread">
      <button
        ref={buttonRef}
        type="button"
        className="op-cart-mapread__btn"
        // The accessible name stays the same in both states — the STATE is
        // `aria-pressed`'s job, and a button that renames itself when pressed
        // reads to a screen reader as a different control appearing.
        aria-pressed={mapReading}
        aria-controls="op-cart-surface"
        onClick={toggleMapReading}
      >
        Read the map
      </button>
      {/*
        A live region rather than static help text: the thing that changed is
        off-screen for a sighted planner (the page slid away) and invisible to
        everyone else, so it is said out loud exactly when it happens. Both
        states are announced, so the mode never ends silently either.
      */}
      <p className="op-cart-mapread__state" role="status">
        {mapReading
          ? hasSelection
            ? "Page hidden. Use the button to bring it back."
            : "Page hidden. Press Esc, or use the button, to bring it back."
          : "Hides this page so you can see your layers on the map."}
      </p>
    </div>
  );
}
