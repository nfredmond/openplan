"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { CartographicInspectorSelection } from "./cartographic-inspector-dock";

export type LayerKey =
  | "projects"
  | "rtp"
  | "corridors"
  | "engagement"
  | "aerial"
  | "transit"
  | "crashes"
  | "equity";

export const LAYER_KEYS: LayerKey[] = [
  "projects",
  "rtp",
  "corridors",
  "engagement",
  "aerial",
  "transit",
  "crashes",
  "equity",
];

const DEFAULT_LAYERS: Readonly<Record<LayerKey, boolean>> = Object.freeze({
  projects: true,
  rtp: true,
  corridors: true,
  engagement: true,
  aerial: true,
  transit: false,
  crashes: false,
  equity: false,
});

type CartographicContextValue = {
  selection: CartographicInspectorSelection | null;
  setSelection: (selection: CartographicInspectorSelection | null) => void;
  clearSelection: () => void;
  layers: Record<LayerKey, boolean>;
  toggleLayer: (key: LayerKey) => void;
  setLayer: (key: LayerKey, on: boolean) => void;
};

const CartographicContext = createContext<CartographicContextValue | null>(null);

export function CartographicProvider({ children }: { children: React.ReactNode }) {
  const [selection, setSelectionState] = useState<CartographicInspectorSelection | null>(null);
  const [layers, setLayersState] = useState<Record<LayerKey, boolean>>(DEFAULT_LAYERS);

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
    () => ({ selection, setSelection, clearSelection, layers, toggleLayer, setLayer }),
    [selection, setSelection, clearSelection, layers, toggleLayer, setLayer],
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
