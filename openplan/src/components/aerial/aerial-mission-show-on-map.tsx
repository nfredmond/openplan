"use client";

import { MapPinned } from "lucide-react";

import {
  useCartographicLayers,
  useCartographicMapFocus,
  useCartographicMapReading,
} from "@/components/cartographic/cartographic-context";
import type { FitInstruction } from "@/lib/cartographic/geometry-bbox";

/**
 * Moves the shell map to one mission's area of interest.
 *
 * It switches the mission-areas layer on first, because a camera sent to an
 * area whose layer is off shows an empty map with no reason to doubt it. On a
 * screen too narrow for the map to sit beside the page, it also opens "Read the
 * map", since otherwise the camera would move behind the page panel.
 */
export function AerialMissionShowOnMap({ title, focus }: { title: string; focus: FitInstruction }) {
  const { requestMapFocus } = useCartographicMapFocus();
  const { setLayer } = useCartographicLayers();
  const { setMapReading } = useCartographicMapReading();

  return (
    <button
      type="button"
      className="module-inline-action w-fit"
      aria-label={`Show ${title} on the map`}
      onClick={() => {
        setLayer("aerial", true);
        requestMapFocus(focus);
        if (window.matchMedia("(max-width: 1023px)").matches) setMapReading(true);
      }}
    >
      <MapPinned className="h-4 w-4" aria-hidden="true" />
      Show on map
    </button>
  );
}
