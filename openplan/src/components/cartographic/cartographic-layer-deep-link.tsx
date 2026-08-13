"use client";

/**
 * "Show on the map" — the other half of the link the Data Hub sends.
 *
 * ═══ THE GAP THIS CLOSES ═══
 *
 * The layer library told planners their uploads "become toggles on the Layers
 * panel on Safety and Aerial", and then nothing carried them there. They had to
 * know which module drew the map, navigate to it, find the panel, and find their
 * layer's row in it — for a layer they had just made, on a page with no
 * connection to the one they made it on. The commonest sentence in the
 * complaint that started this work was some form of "where do I look at it".
 *
 * So the manager links to `/safety?layer=<id>`, and this reads that back: the
 * named layer is switched on and the page steps aside, in one click, from the
 * screen where the planner uploaded it.
 *
 * ═══ WHAT IT REFUSES TO DO ═══
 *
 * IT APPLIES ONCE PER LAYER ID. If the planner then switches the layer off, or
 * brings the page back, the effect does not undo them — a URL parameter is an
 * opening instruction, not a standing order, and a link that keeps reasserting
 * itself is a page that will not let go of the wheel.
 *
 * IT WAITS FOR THE CATALOG. Visibility is resolved by the provider when the
 * layer list registers, so switching a layer on before that arrives would be
 * overwritten a moment later. It does nothing until the id it was given is
 * actually a layer in this workspace — which also means a stale or hand-edited
 * link quietly does nothing rather than turning on some other layer.
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useCartographicMapReading, useWorkspaceMapLayers } from "./cartographic-context";

/** The query parameter a "Show on the map" link carries. */
export const MAP_LAYER_DEEP_LINK_PARAM = "layer";

export function CartographicLayerDeepLink() {
  const searchParams = useSearchParams();
  const requestedLayerId = searchParams?.get(MAP_LAYER_DEEP_LINK_PARAM) ?? null;
  const { workspaceLayers, setWorkspaceLayer } = useWorkspaceMapLayers();
  const { setMapReading } = useCartographicMapReading();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!requestedLayerId) return;
    if (appliedRef.current === requestedLayerId) return;
    const known = workspaceLayers.some((listing) => listing.layer.id === requestedLayerId);
    if (!known) return;

    appliedRef.current = requestedLayerId;
    setWorkspaceLayer(requestedLayerId, true);
    setMapReading(true);
  }, [requestedLayerId, workspaceLayers, setWorkspaceLayer, setMapReading]);

  return null;
}
