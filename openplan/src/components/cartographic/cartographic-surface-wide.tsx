"use client";

import { useEffect } from "react";

/**
 * Opt content-heavy routes into the wide surface layout. Mount anywhere in the
 * page tree; while it's mounted, body[data-surface-wide="true"] is set, which
 * collapses the layers-panel gap so wide tables and long-form documents get
 * more horizontal room.
 */
export function CartographicSurfaceWide() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.surfaceWide = "true";
    return () => {
      if (typeof document !== "undefined") {
        delete document.body.dataset.surfaceWide;
      }
    };
  }, []);

  return null;
}
