"use client";

import { useEffect } from "react";

/**
 * Let the map fill the route surface, edge to edge.
 *
 * ═══ THE MEASUREMENT THAT PRODUCED THIS ═══
 *
 * Safety's own layout was already map-first — one map, one docked sidebar. It
 * still read as a letterbox, and the reason was entirely outside the module.
 * Measured in a real browser at 1600×900 on 2026-08-13, inside a 1056×800
 * `.op-cart-surface`:
 *
 *   - `AppSecondaryNav` (`.shell-ledger-panel`) took 244px off the top — a list
 *     of the sibling modules in Safety's nav group, every one of which is also
 *     one click away in the rail on the left and in the command palette;
 *   - `.op-cart-surface__body` padding took another 96px (20 top, 76 bottom).
 *
 * 340px of a 800px surface, leaving the map 457px. On the 1366×768 laptops
 * planners actually use it is worse. The module can do nothing about either
 * from inside its own markup: both belong to the shell.
 *
 * ═══ WHY AN ATTRIBUTE RATHER THAN A ROUTE LIST IN THE STYLESHEET ═══
 *
 * `CartographicSurfaceWide` established this pattern and it is the right one: a
 * component a page mounts, setting one `body` attribute, cleaned up on unmount,
 * with the layout consequences in `cartographic.css` where the rest of the
 * shell's layout lives. A route list in the stylesheet would be a second copy of
 * the routing rule, free to drift from `lib/navigation/map-surfaces`.
 *
 * It is deliberately NOT keyed off `data-map-owner`, which `/explore` also sets.
 * Corridor Analysis has its own studio layout and its own padding expectations;
 * borrowing its attribute would change a page this lane never measured.
 *
 * ═══ WHAT IS TRADED, STATED PLAINLY ═══
 *
 * The section nav goes on this one route. That is a real loss and it is the
 * cheapest 244px on the page: the rail carries every module including all of
 * this section's, and it is permanently on screen. Nothing else is hidden — every
 * caveat, filter and disclosure in the sidebar is still rendered, and the sidebar
 * scrolls on its own.
 */
export function SafetyMapFillsSurface() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.mapFillsSurface = "true";
    return () => {
      if (typeof document !== "undefined") {
        delete document.body.dataset.mapFillsSurface;
      }
    };
  }, []);

  return null;
}
