"use client";

import { useCartographicMapControls } from "./cartographic-context";

export function CartographicZoomControls() {
  const { mapControls } = useCartographicMapControls();

  return (
    <div className="op-cart-zoom" role="group" aria-label="Zoom">
      <button
        type="button"
        aria-label="Zoom in"
        disabled={!mapControls}
        onClick={() => mapControls?.zoomIn()}
      >
        ＋
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!mapControls}
        onClick={() => mapControls?.zoomOut()}
      >
        −
      </button>
    </div>
  );
}
