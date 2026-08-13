"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { WorkspaceGisLayerListing } from "@/lib/workspace-gis/types";

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

/**
 * THE WORKSPACE'S OWN LAYERS — a SECOND, DYNAMIC dimension beside `LayerKey`,
 * deliberately not folded into it.
 *
 * `LayerKey` is a closed union with an exhaustive `Record` of labels, nouns and
 * defaults, and that exhaustiveness is worth keeping: it is what makes the
 * compiler tell you that a tenth built-in layer needs a label and a coverage
 * noun. A workspace's uploaded layers cannot live in it — their ids are rows in
 * a table, their names are the planner's own words, and there is no compile-time
 * set of them. Widening `LayerKey` to `string` would trade a real guarantee for
 * a fake uniformity.
 *
 * So the two dimensions run in parallel and share their VOCABULARY instead:
 * visibility is a boolean per layer, coverage is the same `MapLayerStatus` the
 * built-in layers register, and the panel renders both from one code path.
 */
export type WorkspaceLayerVisibility = Record<string, boolean>;

/**
 * Where a planner's own on/off choices are kept.
 *
 * PER PLANNER AND PER BROWSER, on purpose (Q2's default). A visibility matrix
 * per module is configuration nobody asked for; a layer that is on for one
 * planner and off for their colleague is how every GIS client has ever worked.
 * The layer's `defaultVisible` is the agency-wide starting point the planner who
 * uploaded it set, and this remembers only DEPARTURES from it.
 *
 * Keyed by workspace so switching workspaces — a soft RSC refresh — cannot carry
 * one agency's toggles onto another's layers.
 */
const WORKSPACE_LAYER_VISIBILITY_STORAGE_PREFIX = "openplan.cartographic.workspaceLayers";

function visibilityStorageKey(workspaceId: string | null): string {
  return `${WORKSPACE_LAYER_VISIBILITY_STORAGE_PREFIX}.${workspaceId ?? "none"}`;
}

/** Remembered departures from `defaultVisible`, or `{}` when nothing is stored. */
export function readStoredWorkspaceLayerVisibility(
  workspaceId: string | null,
): WorkspaceLayerVisibility {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(visibilityStorageKey(workspaceId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: WorkspaceLayerVisibility = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") result[id] = value;
    }
    return result;
  } catch {
    // A private-mode browser or a corrupted value must not stop the map from
    // drawing; the layer simply falls back to its `defaultVisible`.
    return {};
  }
}

function writeStoredWorkspaceLayerVisibility(
  workspaceId: string | null,
  visibility: WorkspaceLayerVisibility,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(visibilityStorageKey(workspaceId), JSON.stringify(visibility));
  } catch {
    // Storage full or blocked. The toggle still works for this session.
  }
}

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
  /** The workspace's uploaded layers, as the backdrop last listed them. */
  workspaceLayers: WorkspaceGisLayerListing[];
  registerWorkspaceLayers: (
    listings: WorkspaceGisLayerListing[],
    workspaceId: string | null,
  ) => void;
  /**
   * Set when the layer catalog could not be READ, as opposed to being empty.
   *
   * A workspace with no uploaded layers and a workspace whose catalog request
   * failed produce the same empty list, and only one of them is a fact about
   * the workspace. Without this the panel tells a planner whose agency has
   * forty layers that they have none — quietly, in the same words it would use
   * if that were true. Null means the last read succeeded.
   */
  workspaceCatalogError: string | null;
  registerWorkspaceCatalogError: (message: string | null) => void;
  workspaceLayerVisibility: WorkspaceLayerVisibility;
  toggleWorkspaceLayer: (layerId: string) => void;
  setWorkspaceLayer: (layerId: string, on: boolean) => void;
  workspaceLayerStatus: Record<string, MapLayerStatus>;
  registerWorkspaceLayerStatus: (layerId: string, status: MapLayerStatus) => void;
  /**
   * READING THE MAP, as opposed to reading the page.
   *
   * ═══ THE PROBLEM THIS SOLVES, AND THE ONE IT REFUSES TO CREATE ═══
   *
   * The route content sits on `.op-cart-surface`, a fixed panel covering ~74% of
   * the window at `--panel` — 94% opaque in light palettes, 92% in dark, over an
   * 18px backdrop blur. Composited, a solid accent-orange fill directly beneath
   * it moves the panel by under 4% of one channel; a 2px line beneath a blur of
   * that radius contributes on the order of 1/255. It is a tint, not a window.
   * So on Safety and Aerial an uploaded layer was visible only in the margins.
   *
   * Lowering the opacity cannot fix it and makes everything else worse at the
   * same time. `--muted` — kickers, meta rows, placeholders, at 10.5–12px —
   * measures 3.37:1 light and 3.45:1 dark against a worst-case background AT
   * TODAY'S opacity. At 0.85 it is 2.84 / 2.72; at 0.80, 2.57 / 2.28. The
   * translucency needed to see a hairline through a blur is several times the
   * translucency that makes ordinary body text unreadable.
   *
   * The two demands are not in tension because the setting is wrong. They are in
   * tension because they are DIFFERENT MOMENTS. The opacity is correct for
   * reading a page and wrong for reading a map, and averaging them produces a
   * setting that serves neither. So the moment becomes explicit: while this is
   * on, the surface steps aside entirely and the map is at full, unblurred
   * opacity; while it is off, every page in the product is bit-for-bit what it
   * was. The surface's own opacity value never changes.
   *
   * Per session and never persisted, and cleared whenever the control that sets
   * it unmounts — which is what happens the moment a planner navigates off a map
   * surface. A planner who lands on the RTP registry must never find the page
   * missing because of a choice they made on Safety twenty minutes ago.
   */
  mapReading: boolean;
  setMapReading: (on: boolean) => void;
  toggleMapReading: () => void;
};

const CartographicContext = createContext<CartographicContextValue | null>(null);

export function CartographicProvider({ children }: { children: React.ReactNode }) {
  const [selection, setSelectionState] = useState<CartographicInspectorSelection | null>(null);
  const [layers, setLayersState] = useState<Record<LayerKey, boolean>>(DEFAULT_LAYERS);
  const [mapControls, setMapControls] = useState<CartographicMapControls | null>(null);
  const [layerStatus, setLayerStatus] = useState<Partial<Record<LayerKey, MapLayerStatus>>>({});
  const [workspaceLayers, setWorkspaceLayers] = useState<WorkspaceGisLayerListing[]>([]);
  const [workspaceLayerVisibility, setWorkspaceLayerVisibility] =
    useState<WorkspaceLayerVisibility>({});
  const [workspaceLayerStatus, setWorkspaceLayerStatus] = useState<Record<string, MapLayerStatus>>(
    {},
  );
  const [visibilityWorkspaceId, setVisibilityWorkspaceId] = useState<string | null>(null);
  const [workspaceCatalogError, setWorkspaceCatalogError] = useState<string | null>(null);
  const [mapReading, setMapReadingState] = useState(false);

  /*
    THE BODY ATTRIBUTE IS THE PUBLIC HALF OF THIS STATE.

    Everything that has to move when the page steps aside — the surface, the
    header, the canvas's own colour treatment — is styled from CSS that cannot
    read React state, and several of those elements are rendered by components
    that have no reason to know this mode exists. One attribute on `body` lets
    the stylesheet do it in one place. `inert`, which CSS cannot express, is
    still applied by the surface component itself.

    Removed on unmount rather than left behind: the shell unmounts on sign-out,
    and a stale `data-map-reading` on the body of the sign-in page would hide
    nothing but would be a lie about the app's state that the next mount reads.
  */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    if (mapReading) {
      body.dataset.mapReading = "true";
    } else {
      delete body.dataset.mapReading;
    }
    return () => {
      delete body.dataset.mapReading;
    };
  }, [mapReading]);

  const setMapReading = useCallback((on: boolean) => {
    setMapReadingState(on);
  }, []);

  const toggleMapReading = useCallback(() => {
    setMapReadingState((prev) => !prev);
  }, []);

  const registerWorkspaceCatalogError = useCallback((message: string | null) => {
    setWorkspaceCatalogError(message);
  }, []);

  const registerLayerStatus = useCallback((key: LayerKey, status: MapLayerStatus) => {
    setLayerStatus((prev) => ({ ...prev, [key]: status }));
  }, []);

  /**
   * Take the workspace's layer catalog, and resolve each layer's starting state.
   *
   * THE PRECEDENCE IS THE POINT: a planner's remembered choice beats the layer's
   * `defaultVisible`, and `defaultVisible` beats nothing at all. A layer that has
   * never been toggled by this person starts where the person who uploaded it
   * put it, which is the only setting anybody deliberately chose.
   *
   * Statuses recorded for layers that no longer exist are dropped here rather
   * than left to accumulate — a coverage note for a deleted layer is a sentence
   * about something the planner can no longer see.
   */
  const registerWorkspaceLayers = useCallback(
    (listings: WorkspaceGisLayerListing[], workspaceId: string | null) => {
      setWorkspaceLayers(listings);
      setVisibilityWorkspaceId(workspaceId);
      // A successful read is what clears a previous failure — the two states are
      // set from the same place so they cannot drift into "failed, and here are
      // your layers".
      setWorkspaceCatalogError(null);
      const stored = readStoredWorkspaceLayerVisibility(workspaceId);
      setWorkspaceLayerVisibility(() => {
        const next: WorkspaceLayerVisibility = {};
        for (const listing of listings) {
          const remembered = stored[listing.layer.id];
          next[listing.layer.id] =
            typeof remembered === "boolean" ? remembered : listing.layer.defaultVisible;
        }
        return next;
      });
      setWorkspaceLayerStatus((prev) => {
        const live = new Set(listings.map((listing) => listing.layer.id));
        const next: Record<string, MapLayerStatus> = {};
        for (const [id, status] of Object.entries(prev)) {
          if (live.has(id)) next[id] = status;
        }
        return next;
      });
    },
    [],
  );

  const setWorkspaceLayer = useCallback(
    (layerId: string, on: boolean) => {
      setWorkspaceLayerVisibility((prev) => {
        const next = { ...prev, [layerId]: on };
        writeStoredWorkspaceLayerVisibility(visibilityWorkspaceId, next);
        return next;
      });
    },
    [visibilityWorkspaceId],
  );

  const toggleWorkspaceLayer = useCallback(
    (layerId: string) => {
      setWorkspaceLayerVisibility((prev) => {
        const next = { ...prev, [layerId]: !prev[layerId] };
        writeStoredWorkspaceLayerVisibility(visibilityWorkspaceId, next);
        return next;
      });
    },
    [visibilityWorkspaceId],
  );

  const registerWorkspaceLayerStatus = useCallback((layerId: string, status: MapLayerStatus) => {
    setWorkspaceLayerStatus((prev) => ({ ...prev, [layerId]: status }));
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
      workspaceLayers,
      registerWorkspaceLayers,
      workspaceCatalogError,
      registerWorkspaceCatalogError,
      workspaceLayerVisibility,
      toggleWorkspaceLayer,
      setWorkspaceLayer,
      workspaceLayerStatus,
      registerWorkspaceLayerStatus,
      mapReading,
      setMapReading,
      toggleMapReading,
    }),
    [
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
      workspaceLayers,
      registerWorkspaceLayers,
      workspaceCatalogError,
      registerWorkspaceCatalogError,
      workspaceLayerVisibility,
      toggleWorkspaceLayer,
      setWorkspaceLayer,
      workspaceLayerStatus,
      registerWorkspaceLayerStatus,
      mapReading,
      setMapReading,
      toggleMapReading,
    ],
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

const EMPTY_WORKSPACE_LAYERS: WorkspaceGisLayerListing[] = [];
const EMPTY_WORKSPACE_VISIBILITY: WorkspaceLayerVisibility = {};
const EMPTY_WORKSPACE_STATUS: Record<string, MapLayerStatus> = {};

/**
 * The workspace's own uploaded layers: the catalog, each layer's on/off state,
 * and what its last viewport read established.
 *
 * Outside a provider this returns an empty catalog rather than throwing, for the
 * reason every hook in this file does: the shell renders on routes that own
 * their own map, and a component that merely wants to know whether there are
 * workspace layers must not crash the page when there is no cartographic tree
 * above it.
 */
export function useWorkspaceMapLayers() {
  const ctx = useContext(CartographicContext);
  if (!ctx) {
    return {
      workspaceLayers: EMPTY_WORKSPACE_LAYERS,
      registerWorkspaceLayers: NOOP as CartographicContextValue["registerWorkspaceLayers"],
      workspaceCatalogError: null,
      registerWorkspaceCatalogError: NOOP as (message: string | null) => void,
      workspaceLayerVisibility: EMPTY_WORKSPACE_VISIBILITY,
      toggleWorkspaceLayer: NOOP as (layerId: string) => void,
      setWorkspaceLayer: NOOP as (layerId: string, on: boolean) => void,
      workspaceLayerStatus: EMPTY_WORKSPACE_STATUS,
      registerWorkspaceLayerStatus: NOOP as (layerId: string, status: MapLayerStatus) => void,
    };
  }
  return {
    workspaceLayers: ctx.workspaceLayers,
    registerWorkspaceLayers: ctx.registerWorkspaceLayers,
    workspaceCatalogError: ctx.workspaceCatalogError,
    registerWorkspaceCatalogError: ctx.registerWorkspaceCatalogError,
    workspaceLayerVisibility: ctx.workspaceLayerVisibility,
    toggleWorkspaceLayer: ctx.toggleWorkspaceLayer,
    setWorkspaceLayer: ctx.setWorkspaceLayer,
    workspaceLayerStatus: ctx.workspaceLayerStatus,
    registerWorkspaceLayerStatus: ctx.registerWorkspaceLayerStatus,
  };
}

/**
 * Whether the page has stepped aside so the map can be read, and how to change
 * that.
 *
 * Outside a provider this reports `false` and does nothing, for the reason every
 * hook in this file returns an inert value rather than throwing: the overview
 * surface and the map dock are rendered in tests and on routes that own their
 * own map, and a component asking "is the page hidden?" must not be the thing
 * that crashes the page.
 */
export function useCartographicMapReading() {
  const ctx = useContext(CartographicContext);
  if (!ctx) {
    return {
      mapReading: false,
      setMapReading: NOOP as (on: boolean) => void,
      toggleMapReading: NOOP,
      /** A selection is open, so Escape already means "clear it". */
      hasSelection: false,
    };
  }
  return {
    mapReading: ctx.mapReading,
    setMapReading: ctx.setMapReading,
    toggleMapReading: ctx.toggleMapReading,
    hasSelection: ctx.selection !== null,
  };
}

export function useCartographicMapControls() {
  const ctx = useContext(CartographicContext);
  if (!ctx) {
    return { mapControls: null, registerMapControls: NOOP as (controls: CartographicMapControls | null) => void };
  }
  return { mapControls: ctx.mapControls, registerMapControls: ctx.registerMapControls };
}
