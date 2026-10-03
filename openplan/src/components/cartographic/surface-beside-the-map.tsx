"use client";

import { useEffect } from "react";

/**
 * Narrows the page panel to a sidebar so the shell map fills the rest of the
 * window (see "THE PAGE AS A SIDEBAR BESIDE THE MAP" in cartographic.css).
 *
 * For a page that reads the shell's own map rather than drawing one. The Aerial
 * index lists missions whose areas the shell map already draws, but its panel
 * ran from the rail to the layer dock, so the map it was listing was covered.
 * Below 1024px wide nothing changes: the panel still covers the map, and "Read
 * the map" is how a planner sees it there.
 */
export function SurfaceBesideTheMap() {
  useEffect(() => {
    document.body.dataset.surfaceBesideMap = "true";
    return () => {
      delete document.body.dataset.surfaceBesideMap;
    };
  }, []);

  return null;
}

/** How much of the map's left and right edges the page panel and the map controls cover. */
export type MapInsets = { left: number; right: number };

/**
 * When the page sits beside the map: how far the page panel reaches into the
 * map from the left, and how far the map controls reach in from the right.
 * Zero on both sides otherwise. A camera move pads by these so the place it was
 * sent to is drawn in the open part of the map, not under either panel.
 */
export function surfaceBesideTheMapInsets(): MapInsets {
  const none = { left: 0, right: 0 };
  if (typeof document === "undefined" || document.body.dataset.surfaceBesideMap !== "true") return none;
  const surface = document.querySelector(".op-cart-surface");
  if (!surface) return none;
  const left = surface.getBoundingClientRect().right;
  // Below the breakpoint the panel spans the window; there is no map beside it
  // to pad toward, and padding by the whole width would push the camera off it.
  if (!(left > 0 && left < window.innerWidth * 0.75)) return none;
  const dock = document.querySelector(".op-cart-mapdock");
  const dockLeft = dock ? dock.getBoundingClientRect().left : 0;
  const right = dockLeft > left ? window.innerWidth - dockLeft : 0;
  return { left: Math.round(left), right: Math.round(Math.max(0, right)) };
}
