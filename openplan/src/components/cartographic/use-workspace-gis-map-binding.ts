"use client";

import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";

import {
  applyWorkspaceGisEmphasis,
  applyWorkspaceGisVisibility,
  paintWorkspaceGisLayers,
  viewportKeyFor,
  type WorkspaceGisMapTarget,
} from "@/lib/cartographic/workspace-gis-map-layers";
import { fetchWorkspaceGisFeatures, fetchWorkspaceGisLayers } from "@/lib/workspace-gis/client";
import type { WorkspaceGisFeatureCollection } from "@/lib/workspace-gis/types";

import { useWorkspaceMapLayers } from "./cartographic-context";

/**
 * Everything that has to happen between "this workspace has uploaded layers"
 * and "they are on this map" — the catalog read, the viewport tracking, the
 * per-layer window read, the coverage notes, the paint.
 *
 * ═══ WHY A HOOK RATHER THAN CODE IN EACH MAP ═══
 *
 * This lived inside the shell backdrop, which is the map behind every page
 * except `/explore`. Explore builds its own `mapboxgl.Map`, so it drew none of
 * this: the one page a planner opens *in order to read a map* was the one page
 * that never carried the agency's own layers. Explore is the second caller, and
 * this repository's recorded rule is that the second caller of a capability
 * living inside the first will reimplement it wrongly — so the capability moved
 * out before the second caller existed rather than after.
 *
 * The bookkeeping here is the part that is easy to get subtly wrong and hard to
 * see wrong: a read that is remembered before it succeeded leaves a layer
 * permanently blank behind a ticked checkbox; a catalog failure registered as an
 * empty list tells an agency with forty layers that they have none; a viewport
 * key that is not rounded fires a request per settled pixel.
 *
 * ═══ WHAT IT DOES NOT DO ═══
 *
 * It does not decide where the layers sit in the z-order (`resolveAnchorLayerId`
 * is the caller's, because the answer is a different layer name on each map),
 * and it does not own clicks or hovers — those belong to whichever map has its
 * own idiom for reading a feature.
 */

/*
 * The map is typed as a real `mapboxgl.Map` here, unlike in the painter module
 * next door, and the difference is deliberate. The painter is structurally typed
 * so a plain object can be a real test subject for the z-order; this hook is
 * React glue over `on`/`off`/`once`/`getBounds`, whose Mapbox signatures are
 * overloaded past the point where restating them would be honest. Both callers
 * hold a genuine map.
 */

export type WorkspaceGisMapBindingOptions = {
  /** The map to draw on. Read through a ref because it is built in an effect. */
  mapRef: { current: mapboxgl.Map | null };
  /** The map exists and its style has loaded at least once. */
  ready: boolean;
  /**
   * Whether this map should carry workspace layers at all.
   *
   * The shell backdrop passes `false` on routes that own their own map, so the
   * two bindings are never both live; Explore passes `false` until it knows
   * which workspace it is looking at, because a catalog read for the empty
   * string is a request that can only fail.
   */
  enabled: boolean;
  /**
   * The workspace these layers belong to. In the dep arrays below so a workspace
   * switch — a soft RSC refresh that does not remount the tree — refetches
   * instead of leaving one agency's parcels under another agency's map.
   */
  workspaceId: string | null;
  /** Which casing ink the basemap needs. The BASEMAP's theme, not the chrome's. */
  theme: "light" | "dark";
  /** The layer the workspace's layers sit immediately beneath on THIS map. */
  resolveAnchorLayerId: (map: WorkspaceGisMapTarget) => string | undefined;
  /** The layer a planner is currently pointing at, or null. Transient, never a mode. */
  emphasisLayerId?: string | null;
};

export function useWorkspaceGisMapBinding({
  mapRef,
  ready,
  enabled,
  workspaceId,
  theme,
  resolveAnchorLayerId,
  emphasisLayerId = null,
}: WorkspaceGisMapBindingOptions) {
  const {
    workspaceLayers,
    registerWorkspaceLayers,
    registerWorkspaceCatalogError,
    workspaceLayerVisibility,
    registerWorkspaceLayerStatus,
  } = useWorkspaceMapLayers();

  /** One viewport read per visible workspace layer, keyed by layer id. */
  const [collections, setCollections] = useState<Record<string, WorkspaceGisFeatureCollection>>({});
  /**
   * The current map window, rounded, as the trigger for workspace-layer reads.
   *
   * THE ONLY VIEWPORT-DRIVEN FETCH IN THE PRODUCT. Every other layer is a
   * whole-workspace read capped at a few hundred rows; a parcel fabric is a
   * quarter of a million polygons and there is no "whole layer" to ask for. So
   * this one asks for what is on screen and asks again when the screen moves.
   */
  const [viewportBbox, setViewportBbox] = useState<[number, number, number, number] | null>(null);

  /**
   * The viewport each workspace layer was last SUCCESSFULLY read for.
   *
   * Keyed by layer id, valued by the rounded viewport key, so panning back to a
   * window already drawn costs nothing and a failed read is simply absent —
   * which makes the next attempt a retry rather than a permanent blank layer
   * behind a ticked checkbox.
   */
  const layerViewportRef = useRef<Map<string, string>>(new Map());
  /** The workspace whose layer catalog has been requested. */
  const catalogFetchedForRef = useRef<string | null | undefined>(undefined);
  /** The anchor resolver, read through a ref so an inline lambda is not a dep. */
  const resolveAnchorRef = useRef(resolveAnchorLayerId);

  useEffect(() => {
    resolveAnchorRef.current = resolveAnchorLayerId;
  }, [resolveAnchorLayerId]);

  /**
   * The workspace's layer CATALOG — names, styles, versions, caveats.
   *
   * FETCHED WHETHER OR NOT ANY LAYER IS SWITCHED ON, unlike the geometry below:
   * the catalog is what the panel lists, and a planner has to be able to SEE
   * that their agency has four uploaded layers before they can decide to tick
   * one. Gating the list on the toggles would make the layers discoverable only
   * by someone who already knew they existed.
   *
   * It is small — a few rows of metadata — so pulling it on every navigation
   * costs nothing like the geometry does.
   */
  useEffect(() => {
    if (!enabled) return;
    if (catalogFetchedForRef.current === workspaceId) return;
    catalogFetchedForRef.current = workspaceId;

    let cancelled = false;
    let settled = false;
    (async () => {
      try {
        const listings = await fetchWorkspaceGisLayers();
        if (cancelled) return;
        settled = true;
        registerWorkspaceLayers(listings, workspaceId);
      } catch (error) {
        if (cancelled) return;
        // A workspace with no layers and a workspace whose catalog failed to
        // load both produce an empty list, and only one of them is a fact about
        // the workspace. Registering `[]` here said the second in the words of
        // the first: a planner whose agency has forty layers was shown a panel
        // stating they had none, with the failure going only to a console the
        // build strips in production. The failure is REGISTERED instead, so the
        // panel can say what happened — and the catalog is deliberately left
        // alone rather than emptied, because wiping it would also discard the
        // remembered on/off choices for layers that still exist.
        if (process.env.NODE_ENV !== "production") {
          console.warn("[workspace-gis-binding] workspace GIS catalog fetch failed", error);
        }
        registerWorkspaceCatalogError(
          "OpenPlan could not load this workspace's map layers, so this list is not a statement that there " +
            "are none. Reload the page to try again.",
        );
      }
    })();

    return () => {
      cancelled = true;
      // Only a completed read may be remembered — otherwise a navigation during
      // the request leaves the catalog permanently unfetched for this workspace.
      if (!settled) catalogFetchedForRef.current = undefined;
    };
  }, [enabled, workspaceId, registerWorkspaceLayers, registerWorkspaceCatalogError]);

  /**
   * Track the map window, so the workspace layers can be read for it.
   *
   * `moveend` rather than `move`: a read per animation frame during a pan would
   * be hundreds of requests for one gesture. The rounded key in `viewportKeyFor`
   * then absorbs the sub-metre jitter that a settled map still produces.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !enabled) return;

    const record = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      // A zoomed-out map reports a viewport WIDER THAN THE WORLD: at a
      // continental view Mapbox returns west = -185.4, because the visible
      // rectangle runs past the antimeridian. Those are screen coordinates,
      // not longitudes, and the feature route rightly refuses them — which
      // meant every workspace layer silently failed to load at low zoom with
      // nothing but a console line to say so. Found by opening the app, not
      // by a test: jsdom has no box model, so no unit test can produce a
      // viewport at all.
      //
      // Clamping is the honest reduction rather than a fudge: the data cannot
      // exist outside these bounds, so the clamped rectangle asks for exactly
      // the part of the view that could contain something. A layer spanning
      // the antimeridian would be over-fetched east-to-west by this, which is
      // a correctness-preserving trade (more rows considered, none missed).
      setViewportBbox([
        Math.max(bounds.getWest(), -180),
        Math.max(bounds.getSouth(), -90),
        Math.min(bounds.getEast(), 180),
        Math.min(bounds.getNorth(), 90),
      ]);
    };

    record();
    map.on("moveend", record);
    return () => {
      map.off("moveend", record);
    };
  }, [mapRef, ready, enabled]);

  /**
   * Read each VISIBLE workspace layer for the current window.
   *
   * GATED ON THE TOGGLE, and for a stronger version of the transit layer's
   * reason: this payload is unbounded in a way no other layer's is, and a
   * workspace with six uploaded layers switched on would otherwise fire six
   * requests on every pan. Off means not asked for.
   *
   * A LAYER THAT IS TOO DENSE IS STILL STORED, with no features and its true
   * count. That is the whole design: the response says "214,391 shapes in this
   * view", the map draws none of them, and the panel says so. Dropping the
   * response on the floor would leave the planner looking at an empty layer with
   * a ticked box and no explanation, which is the exact reading — "there is
   * nothing here" — that this layer refuses to allow.
   */
  useEffect(() => {
    if (!enabled) return;
    if (!viewportBbox) return;
    const key = viewportKeyFor(viewportBbox);

    const visible = workspaceLayers.filter(
      (listing) => workspaceLayerVisibility[listing.layer.id] === true,
    );
    if (visible.length === 0) return;

    const controller = new AbortController();
    for (const listing of visible) {
      const layerId = listing.layer.id;
      if (layerViewportRef.current.get(layerId) === key) continue;

      (async () => {
        try {
          const collection = await fetchWorkspaceGisFeatures(layerId, viewportBbox);
          if (controller.signal.aborted) return;
          layerViewportRef.current.set(layerId, key);
          setCollections((prev) => ({ ...prev, [layerId]: collection }));
          registerWorkspaceLayerStatus(layerId, {
            workspaceId,
            failed: false,
            // The route's own sentences, verbatim. Only it knows whether an
            // empty layer is too dense to draw, has no finished upload, or is
            // genuinely empty in this window — three states that look identical
            // on a map and read very differently to a planner.
            notes: collection.coverageNotes ?? [],
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          if ((error as { name?: string }).name === "AbortError") return;
          if (process.env.NODE_ENV !== "production") {
            console.warn(`[workspace-gis-binding] workspace layer ${layerId} read failed`, error);
          }
          registerWorkspaceLayerStatus(layerId, {
            workspaceId,
            failed: true,
            notes: [
              `${listing.layer.name}: this layer could not be loaded for the current map view, so nothing is ` +
                `drawn for it. That is not a finding that the area is empty.`,
            ],
          });
        }
      })();
    }

    return () => controller.abort();
  }, [
    enabled,
    viewportBbox,
    workspaceLayers,
    workspaceLayerVisibility,
    workspaceId,
    registerWorkspaceLayerStatus,
  ]);

  /**
   * A workspace switch invalidates every cached viewport read.
   *
   * Layer ids are per-workspace rows, so a stale entry cannot collide — but the
   * drawn geometry would survive the switch until the new workspace's layers
   * happened to be read, leaving one agency's parcels under another's map.
   */
  useEffect(() => {
    layerViewportRef.current = new Map();
    // Clearing on a workspace CHANGE is the point, and it has to be a state
    // write: the drawn geometry lives in state, and leaving it would put one
    // agency's parcels under another agency's map until the new workspace's
    // layers happened to be read. A cascading render on a workspace switch is a
    // fair price for that not happening.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollections({});
  }, [workspaceId]);

  /** Draw. Deferred to `style.load` when the style is still arriving. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !enabled) return;

    const paint = () => {
      paintWorkspaceGisLayers(map, {
        layers: workspaceLayers,
        collections,
        anchorLayerId: resolveAnchorRef.current(map),
        theme,
      });
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [mapRef, ready, enabled, workspaceLayers, collections, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !enabled) return;
    applyWorkspaceGisVisibility(map, workspaceLayers, workspaceLayerVisibility);
  }, [mapRef, ready, enabled, workspaceLayers, workspaceLayerVisibility, collections]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !enabled) return;
    applyWorkspaceGisEmphasis(map, workspaceLayers, emphasisLayerId);
  }, [mapRef, ready, enabled, workspaceLayers, emphasisLayerId, collections]);

  return { workspaceLayers, workspaceLayerVisibility, collections };
}
