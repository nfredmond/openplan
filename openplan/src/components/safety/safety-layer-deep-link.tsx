"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

// The parameter NAME comes from the shell's own deep-link module, not a second
// spelling of "layer": the Data Hub builds the link from that constant, and two
// files each holding their own string is how a link stops working silently.
import { MAP_LAYER_DEEP_LINK_PARAM } from "@/components/cartographic/cartographic-layer-deep-link";
import { useWorkspaceMapLayers } from "@/components/cartographic/cartographic-context";
import { fitInstructionFromExtent, type FitInstruction } from "@/lib/cartographic/geometry-bbox";

/**
 * "Show on the map" — Safety's half of the link the Data Hub sends.
 *
 * ═══ WHY SAFETY NEEDS ITS OWN ═══
 *
 * The layer library links to `MAP_SURFACE_ROUTES[0]?layer=<id>`, which is
 * `/safety`, and the shell answered it with `CartographicLayerDeepLink`. That
 * component rides inside `MapSurfaceOnly`, and as of 2026-08-13 `/safety` owns
 * its map, so the shell's dock — and the deep-link handler with it — no longer
 * mounts here. Left alone, the commonest path out of the Data Hub would have
 * landed on a page that silently ignored the parameter: the layer would not
 * switch on, the camera would not move, and nothing would say why.
 *
 * ═══ WHAT IT DELIBERATELY DOES NOT DO ═══
 *
 * IT DOES NOT ENTER MAP-READING MODE. The shell's version calls
 * `setMapReading(true)` to slide the route panel off the screen, because on a
 * records-shaped page the map is behind the content. Here the map IS the page —
 * it fills the surface with the controls docked beside it — so hiding the panel
 * would take away the very layer list the link just switched a layer on in.
 *
 * IT APPLIES ONCE PER LAYER ID. Switching the layer off afterwards, or coming
 * back to the page, is not undone: a URL parameter is an opening instruction,
 * not a standing order.
 *
 * IT WAITS FOR THE CATALOG, so a switch-on cannot be overwritten a moment later
 * when the layer list registers — and so a stale or hand-edited link quietly
 * does nothing rather than turning on some other layer.
 *
 * IT WILL NOT GUESS A CAMERA. The frame comes from the extent the ingest
 * recorded on the layer's current version, never an approximation. A version
 * with no usable bbox gets the layer switched on and the camera left exactly
 * where the planner had it: silence is honest, a confident flight to the wrong
 * place is not.
 */
export function SafetyLayerDeepLink({
  onFocus,
}: {
  /** Where the map should go, when the named layer records an extent. */
  onFocus: (instruction: FitInstruction) => void;
}) {
  const searchParams = useSearchParams();
  const requestedLayerId = searchParams?.get(MAP_LAYER_DEEP_LINK_PARAM) ?? null;
  const { workspaceLayers, setWorkspaceLayer } = useWorkspaceMapLayers();
  const appliedRef = useRef<string | null>(null);
  const onFocusRef = useRef(onFocus);

  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  useEffect(() => {
    if (!requestedLayerId) return;
    if (appliedRef.current === requestedLayerId) return;
    const named = workspaceLayers.find((listing) => listing.layer.id === requestedLayerId);
    if (!named) return;

    appliedRef.current = requestedLayerId;
    setWorkspaceLayer(requestedLayerId, true);

    const instruction = fitInstructionFromExtent(named.layer.currentVersion?.bbox ?? null);
    if (instruction) onFocusRef.current(instruction);
  }, [requestedLayerId, workspaceLayers, setWorkspaceLayer]);

  return null;
}
