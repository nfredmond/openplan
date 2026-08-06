"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { CartographicInspectorSelection } from "./cartographic-inspector-dock";

export type LayerKey =
  | "projects"
  | "projectAreas"
  | "rtp"
  | "corridors"
  | "engagement"
  | "aerial"
  | "equity"
  | "crashes"
  | "transit";

export const LAYER_KEYS: LayerKey[] = [
  "projects",
  "projectAreas",
  "rtp",
  "corridors",
  "engagement",
  "aerial",
  "equity",
  "crashes",
  "transit",
];

const DEFAULT_LAYERS: Readonly<Record<LayerKey, boolean>> = Object.freeze({
  projects: true,
  // On by default: the area a project covers is the answer to "where are we
  // working?", and it is drawn as a soft fill beneath every point layer, so it
  // gives context without competing for clicks.
  projectAreas: true,
  rtp: true,
  engagement: true,
  corridors: true,
  aerial: true,
  equity: false,
  // Off by default, like the equity choropleth and for the same reason: a
  // several-hundred-point analytic overlay dominates everything beneath it, and
  // it answers a specialist question. The layers panel still lists it and still
  // shows its coverage notes while it is off, so a planner in an uncovered state
  // learns that crashes are unavailable to them without having to turn on a
  // layer that would draw nothing.
  crashes: false,
  // Off by default, for the crash layer's reason plus one of its own. A
  // mid-size agency contributes a few thousand stops, which is a dense analytic
  // overlay that would cover the workspace's own projects and pins; and unlike
  // the layers above, transit is another organisation's record that this
  // workspace happens to have ingested, so it is context a planner asks for
  // rather than the default subject of the map. The layers panel lists it while
  // it is off and shows its coverage notes once it has been read, so nothing
  // about it is discoverable only by leaving it on.
  transit: false,
});

export type CartographicMapControls = {
  zoomIn: () => void;
  zoomOut: () => void;
};

/**
 * What one layer's last fetch established.
 *
 * Registered by the map backdrop (which owns the fetches) and read by the
 * layers panel (which owns the only text surface), so a layer's coverage is
 * disclosed exactly once, from the request that actually happened, rather than
 * re-fetched by whichever component wants to talk about it.
 *
 * `workspaceId` is carried so a status cannot outlive its scope: switching
 * workspace is a soft RSC refresh that does not remount this tree, and a note
 * naming the previous workspace's data under the new workspace's map would be
 * an affirmatively false claim rather than merely stale pixels.
 */
export type MapLayerStatus = {
  workspaceId: string | null;
  /** Coverage sentences to show. Empty when the layer is complete. */
  notes: string[];
  /** True when the fetch itself failed — distinct from a layer that is empty. */
  failed: boolean;
};

type CartographicContextValue = {
  selection: CartographicInspectorSelection | null;
  setSelection: (selection: CartographicInspectorSelection | null) => void;
  clearSelection: () => void;
  layers: Record<LayerKey, boolean>;
  toggleLayer: (key: LayerKey) => void;
  setLayer: (key: LayerKey, on: boolean) => void;
  mapControls: CartographicMapControls | null;
  registerMapControls: (controls: CartographicMapControls | null) => void;
  layerStatus: Partial<Record<LayerKey, MapLayerStatus>>;
  registerLayerStatus: (key: LayerKey, status: MapLayerStatus) => void;
};

const CartographicContext = createContext<CartographicContextValue | null>(null);

export function CartographicProvider({ children }: { children: React.ReactNode }) {
  const [selection, setSelectionState] = useState<CartographicInspectorSelection | null>(null);
  const [layers, setLayersState] = useState<Record<LayerKey, boolean>>(DEFAULT_LAYERS);
  const [mapControls, setMapControls] = useState<CartographicMapControls | null>(null);
  const [layerStatus, setLayerStatus] = useState<Partial<Record<LayerKey, MapLayerStatus>>>({});

  const registerLayerStatus = useCallback((key: LayerKey, status: MapLayerStatus) => {
    setLayerStatus((prev) => ({ ...prev, [key]: status }));
  }, []);

  const registerMapControls = useCallback((controls: CartographicMapControls | null) => {
    setMapControls(controls);
  }, []);

  const setSelection = useCallback((next: CartographicInspectorSelection | null) => {
    setSelectionState(next);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionState(null);
  }, []);

  const toggleLayer = useCallback((key: LayerKey) => {
    setLayersState((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setLayer = useCallback((key: LayerKey, on: boolean) => {
    setLayersState((prev) => ({ ...prev, [key]: on }));
  }, []);

  const value = useMemo<CartographicContextValue>(
    () => ({
      selection,
      setSelection,
      clearSelection,
      layers,
      toggleLayer,
      setLayer,
      mapControls,
      registerMapControls,
      layerStatus,
      registerLayerStatus,
    }),
    [selection, setSelection, clearSelection, layers, toggleLayer, setLayer, mapControls, registerMapControls, layerStatus, registerLayerStatus],
  );

  return <CartographicContext.Provider value={value}>{children}</CartographicContext.Provider>;
}

export function useCartographic(): CartographicContextValue {
  const ctx = useContext(CartographicContext);
  if (!ctx) {
    throw new Error("useCartographic must be used within a CartographicProvider");
  }
  return ctx;
}

const NOOP = () => {};

export function useCartographicSelection() {
  const ctx = useContext(CartographicContext);
  if (!ctx) {
    return { selection: null, setSelection: NOOP, clearSelection: NOOP };
  }
  return {
    selection: ctx.selection,
    setSelection: ctx.setSelection,
    clearSelection: ctx.clearSelection,
  };
}

export function useCartographicLayers() {
  const ctx = useContext(CartographicContext);
  if (!ctx) {
    return { layers: DEFAULT_LAYERS, toggleLayer: NOOP, setLayer: NOOP };
  }
  return { layers: ctx.layers, toggleLayer: ctx.toggleLayer, setLayer: ctx.setLayer };
}

export function useCartographicLayerStatus() {
  const ctx = useContext(CartographicContext);
  if (!ctx) {
    return { layerStatus: {} as Partial<Record<LayerKey, MapLayerStatus>>, registerLayerStatus: NOOP as (key: LayerKey, status: MapLayerStatus) => void };
  }
  return { layerStatus: ctx.layerStatus, registerLayerStatus: ctx.registerLayerStatus };
}

export function useCartographicMapControls() {
  const ctx = useContext(CartographicContext);
  if (!ctx) {
    return { mapControls: null, registerMapControls: NOOP as (controls: CartographicMapControls | null) => void };
  }
  return { mapControls: ctx.mapControls, registerMapControls: ctx.registerMapControls };
}
