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
 *
 * IT WILL NOT GUESS A CAMERA. Switching a layer on and leaving the map at the
 * continental default is how this shipped in v0.20.0, and it made the link a
 * lie: a bike network covering thirteen kilometres, drawn correctly, inside a
 * view spanning a continent, is a layer nobody can see. So the link now also
 * asks the map to frame the extent the ingest recorded on the layer's current
 * version — the extent, never an approximation of one. A version with no bbox,
 * or with a bbox that cannot be a place on Earth, gets the layer switched on
 * and the camera left exactly where the planner had it. Silence is the honest
 * answer there; a plausible-looking flight to the wrong place is not.
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { fitInstructionFromExtent } from "@/lib/cartographic/geometry-bbox";

import {
  useCartographicMapFocus,
  useCartographicMapReading,
  useWorkspaceMapLayers,
} from "./cartographic-context";

/** The query parameter a "Show on the map" link carries. */
export const MAP_LAYER_DEEP_LINK_PARAM = "layer";

export function CartographicLayerDeepLink() {
  const searchParams = useSearchParams();
  const requestedLayerId = searchParams?.get(MAP_LAYER_DEEP_LINK_PARAM) ?? null;
  const { workspaceLayers, setWorkspaceLayer } = useWorkspaceMapLayers();
  const { setMapReading } = useCartographicMapReading();
  const { requestMapFocus } = useCartographicMapFocus();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!requestedLayerId) return;
    if (appliedRef.current === requestedLayerId) return;
    const named = workspaceLayers.find((listing) => listing.layer.id === requestedLayerId);
    if (!named) return;

    appliedRef.current = requestedLayerId;
    setWorkspaceLayer(requestedLayerId, true);
    setMapReading(true);

    // The extent of the version the map actually draws — not the layer's
    // newest upload, which may still be receiving, and not a bbox computed
    // from whatever features happen to be in the viewport, which would frame
    // the map to itself.
    const instruction = fitInstructionFromExtent(named.layer.currentVersion?.bbox ?? null);
    if (instruction) requestMapFocus(instruction);
  }, [requestedLayerId, workspaceLayers, setWorkspaceLayer, setMapReading, requestMapFocus]);

  return null;
}
