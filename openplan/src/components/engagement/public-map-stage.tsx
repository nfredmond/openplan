"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { cn } from "@/lib/utils";
import { keepMapSizedToContainer } from "@/lib/mapbox/keep-map-sized";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import { hasEngagementLocation, readStoredEngagementGeometry, type EngagementGeometry } from "@/lib/engagement/geometry";
import {
  appendVertex,
  buildPreviewFeatureCollection,
  deriveGeometry,
  drawCoordinate,
  type DrawState,
  type EngagementDrawMode,
} from "@/lib/engagement/draw-state";
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";
import { syncContextLayers } from "@/lib/engagement/context-layer-paint";
import type { PortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { translatePublicBasemapChoices } from "@/lib/engagement/portal-i18n/basemap-words";
import type { PublicBasemapChoice, PublicBasemapId } from "@/lib/cartographic/basemaps";
import { OperatorDetail } from "@/components/ui/read-failure-notice";
import { PublicMapPickers } from "./public-map-pickers";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

/*
  THERE IS NO STYLE LIST IN THIS FILE, deliberately. The backgrounds a resident
  may choose between live in `src/lib/cartographic/basemaps.ts` — one registry
  for a product whose twelve map call sites each used to hardcode their own
  `mapbox://styles/...` string, which is exactly why the two engagement maps and
  the RTP cycle map disagreed about what a map should look like. This stage
  receives resolved choices and never spells a style URL.
*/

/**
 * WHETHER THIS DEPLOYMENT CAN DRAW A MAP AT ALL — exported so the shell around
 * this component cannot be wrong about it.
 *
 * The route decides `mapAvailable` server-side, which is right: the client
 * should never mount a stage it cannot fill. But a route that decided WRONGLY —
 * a new render site that hardcodes `true`, a copy of the page that forgets the
 * resolver — would produce the exact failure this whole surface is built to
 * avoid: a map-first page whose map is a blank rectangle, with no explanation
 * and no way to say where. So the shell ANDs the route's answer with this, and
 * "the notice is shown whenever the map is missing" becomes a property of the
 * components rather than a rule two files have to keep agreeing on.
 *
 * Read at module scope like the token itself: `NEXT_PUBLIC_*` is inlined at
 * build time and cannot change while the page is open.
 */
export const PARTICIPANT_MAP_CAN_DRAW = Boolean(MAPBOX_ACCESS_TOKEN);

const DEFAULT_MAP_COLOR = "#38bdf8";
const CLOSE_RING_PIXEL_TOLERANCE = 12;
const KEYBOARD_PAN_STEP_PX = 64;
const SEEDED_ZOOM = 11;
const NEUTRAL_ZOOM = 3.4;
/**
 * How long a background may take to arrive before the stage says it has not.
 *
 * Generous on purpose: this is a phone on a rural connection, and a notice over
 * a map that was merely slow is a worse mistake than a late one. `style.load`
 * clears it either way.
 */
const STYLE_LOAD_WATCHDOG_MS = 15_000;

export type ParticipantMapItem = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  title: string | null;
  body: string;
  geometry?: unknown;
  votesCount?: number;
  color?: string | null;
  categoryId?: string | null;
  createdAt?: string;
  submittedBy?: string | null;
  photoUrl?: string | null;
  replyCount?: number;
};

function safeHexColor(value: string | null | undefined): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : null;
}

function collectGeometryPositions(geometry: EngagementGeometry): [number, number][] {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString") return geometry.coordinates;
  return geometry.coordinates[0];
}

/** Where an approved comment sits on the map, or null when it has no place. */
export function participantItemGeometry(item: ParticipantMapItem): EngagementGeometry | null {
  const stored = readStoredEngagementGeometry(item.geometry ?? null);
  if (stored) return stored;
  if (item.geometry == null && hasEngagementLocation(item) && item.latitude !== null && item.longitude !== null) {
    return { type: "Point", coordinates: [item.longitude, item.latitude] };
  }
  return null;
}

const POINT_SOURCE = "engagement-points";
const SHAPE_SOURCE = "engagement-shapes";
const SELECTED_SOURCE = "engagement-selected";
const BUILDINGS_LAYER = "engagement-3d-buildings";
const BUILDINGS_PITCH = 55;
/** Pixels of slop around a tap, so a thumb can hit a 14px pin. */
const PICK_TOLERANCE_PX = 8;

const EMPTY_COLLECTION = { type: "FeatureCollection" as const, features: [] };

/**
 * The tilt-and-buildings switch, docked with Mapbox's own zoom buttons so it
 * looks and sits like them. Its words come from the stage, which owns the
 * resident's language.
 */
class BuildingsControl {
  readonly button: HTMLButtonElement;
  private readonly container: HTMLDivElement;

  constructor(onToggle: () => void) {
    this.container = document.createElement("div");
    this.container.className = "mapboxgl-ctrl mapboxgl-ctrl-group";
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.textContent = "3D";
    this.button.style.cssText = "font: 700 11px/29px system-ui, sans-serif; color: #0f172a;";
    this.button.addEventListener("click", onToggle);
    this.container.appendChild(this.button);
  }

  onAdd(): HTMLElement {
    return this.container;
  }

  onRemove(): void {
    this.container.remove();
  }
}

/**
 * Extruded buildings from the background's own street data, under the labels.
 * Backgrounds without building data get the tilt alone.
 */
function syncBuildings(map: mapboxgl.Map, on: boolean): void {
  const present = Boolean(map.getLayer(BUILDINGS_LAYER));
  if (!on) {
    if (present) map.removeLayer(BUILDINGS_LAYER);
    return;
  }
  if (present || !map.getSource("composite")) return;
  const firstLabel = map.getStyle()?.layers?.find((layer) => layer.type === "symbol")?.id;
  map.addLayer(
    {
      id: BUILDINGS_LAYER,
      type: "fill-extrusion",
      source: "composite",
      "source-layer": "building",
      filter: ["==", ["get", "extrude"], "true"],
      minzoom: 13,
      paint: {
        "fill-extrusion-color": "#cbd5e1",
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": ["get", "min_height"],
        "fill-extrusion-opacity": 0.8,
      },
    },
    firstLabel
  );
}

/**
 * How much of the map the open comment list covers, so the camera can keep a
 * selected place out from under it: beside the map on a wide screen, above it
 * on a phone.
 */
function overlayPadding(container: HTMLElement | null): { top: number; right: number; bottom: number; left: number } {
  const none = { top: 24, right: 24, bottom: 24, left: 24 };
  const stage = container?.parentElement;
  const panel = stage?.querySelector<HTMLElement>("[data-map-overlay-panel]");
  if (!stage || !panel) return none;
  const stageBox = stage.getBoundingClientRect();
  const panelBox = panel.getBoundingClientRect();
  if (panelBox.width < stageBox.width * 0.6) {
    return { ...none, left: Math.max(24, panelBox.right - stageBox.left + 24) };
  }
  return { ...none, top: Math.max(24, panelBox.bottom - stageBox.top + 24) };
}

/**
 * ONE MAP THAT DOES BOTH JOBS — the community's input and the resident's own
 * drawing, on a single `mapboxgl.Map`, filling whatever box its parent gives it.
 *
 * WHY IT IS NOT EITHER OF THE TWO MAPS IT REPLACES ON THIS SURFACE. The portal
 * used to mount `LocationDisplayMap` on the Feedback tab and `GeometryPickerMap`
 * on the Submit tab, so a resident could never see the pins their neighbours had
 * already dropped WHILE placing their own — the single most useful thing a
 * public comment map does. Both of those components stay exactly as they are:
 * the picker is still the survey's `map_point` widget and the context page's
 * inline field, and the display map is still the operator console's. This one is
 * for the participant map surface, and it shares their geometry rules through
 * `draw-state.ts` rather than restating them.
 *
 * SIZING, ONCE, IN ONE PLACE. The map div is `h-full w-full` inside a `relative`
 * parent — never `absolute inset-0`, because `mapbox-gl.css` sets
 * `.mapboxgl-map { position: relative }` at equal specificity and loads later,
 * which cancels the absolute positioning and yields a zero-height map. The
 * height comes from the shell's grid row and from nowhere else; this component
 * declares no pixel height of its own, which is the mistake that left
 * `.public-map-frame--editor`'s `min-height` dead behind a child's `h-[260px]`.
 *
 * WHAT NO TEST HERE CAN PROVE: jsdom applies no stylesheet, has no box model,
 * and does not run Mapbox GL at all. That the map actually fills the viewport is
 * checkable only in a browser.
 */
export function PublicMapStage({
  items,
  selectedItemId = null,
  onSelectItem,
  feed = null,
  contextLayers = null,
  initialView = null,
  drawEnabled = true,
  drawMode = "point",
  initialGeometry = null,
  onGeometryChange,
  basemapChoices,
  selectedBasemapId,
  onBasemapSelect,
  visibleLayerIds,
  onVisibleLayerIdsChange,
  translator,
  className,
}: {
  items: ParticipantMapItem[];
  /** The comment open in the side panel; its place is outlined on the map. */
  selectedItemId?: string | null;
  /** A tap on somebody's pin or shape opens it. It never marks the resident's own place. */
  onSelectItem?: (itemId: string | null) => void;
  /**
   * The comment list: a button docked above the map controls and, when open, a
   * panel over the map. The panel carries `data-map-overlay-panel` so the
   * camera can keep a selected place out from under it.
   */
  feed?: { button: ReactNode; panel: ReactNode } | null;
  contextLayers?: ParticipantContextLayerSet | null;
  /** Where the camera opens, from `resolvePortalMapFraming`. Null = nothing framed it. */
  initialView?: { center: [number, number]; zoom: number } | null;
  /** False on a closed campaign: the community's input is still shown, drawing is not offered. */
  drawEnabled?: boolean;
  drawMode?: EngagementDrawMode;
  initialGeometry?: EngagementGeometry | null;
  onGeometryChange?: (geometry: EngagementGeometry | null) => void;
  /**
   * From `resolvePublicBasemapConfig` on the server. EMPTY MEANS NO MAP, not
   * "no choice of background": there is no default style to fall back to, and
   * inventing one here would put a background on a resident's screen that the
   * deployment's own configuration excluded.
   */
  basemapChoices: readonly PublicBasemapChoice[];
  selectedBasemapId: PublicBasemapId;
  onBasemapSelect: (choice: PublicBasemapChoice) => void;
  /**
   * Which of the operator's published layers are currently drawn. Owned by the
   * shell rather than here, because the picker that changes them and the map
   * that draws them are siblings — two sources of truth for "what is on the map"
   * is how a legend ends up describing something the map is not showing.
   */
  visibleLayerIds: readonly string[];
  onVisibleLayerIdsChange: (next: string[]) => void;
  translator: PortalTranslator;
  className?: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [draw, setDraw] = useState<DrawState>(() => initialGeometry?.type === "Point" ? {mode:"point",vertices:[initialGeometry.coordinates],areaClosed:false} : initialGeometry?.type === "LineString" ? {mode:"line",vertices:initialGeometry.coordinates,areaClosed:false} : initialGeometry?.type === "Polygon" ? {mode:"area",vertices:initialGeometry.coordinates[0].slice(0,-1),areaClosed:true} : { mode: drawMode, vertices: [], areaClosed: false });
  const [announcement, setAnnouncement] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const instructionsId = useId();

  /*
    THE MAP NEVER CAME UP. A token can be present and still be revoked, scoped
    to the wrong thing, restricted to another site's URL, or blocked by a
    network the resident is on — and Mapbox reports every one of those as an
    `error` EVENT rather than by throwing. Without this the page a resident
    opened, on which the map IS the question, is a grey rectangle with a caption
    inviting them to tap it, forever, with nothing on the screen saying so.

    Only a style that has never loaded counts. A tile that 404s mid-pan or a
    single failed source is a hiccup on a working map, and blanking a map a
    resident is already using over one of those would be its own defect.
  */
  const [styleFailed, setStyleFailed] = useState(false);
  /** The background whose style reported an error, so the picker can mark it. */
  const [failedBasemapId, setFailedBasemapId] = useState<PublicBasemapId | null>(null);
  /**
   * Dismissed by the resident, or by their first move of the map — the "nobody
   * framed this" notice has done its job once they have taken the camera over.
   */
  const [unframedNoticeDismissed, setUnframedNoticeDismissed] = useState(false);

  const { t } = translator;

  /*
    The style the map should be on right now. Resolved from the registry's
    choices rather than from an id-to-URL map of this file's own, and falling
    back to the first offered choice when a caller names one this deployment does
    not offer — a map that renders SOMETHING is better than a map that renders a
    404, and the picker marks a failed choice separately.

    NULL WHEN THIS DEPLOYMENT OFFERS NO BACKGROUND AT ALL, and that is why there
    is no `?? "mapbox://styles/..."` here any more. A literal in this position is
    a style id in a file whose header says there are none, and it is the wrong
    ANSWER as well as the wrong place: a caller with no choices has been told by
    the registry that this deployment cannot draw a map, and quietly drawing one
    from a string typed here is how a build ends up serving a background the
    operator's own configuration excluded. No style, no map — said out loud
    below, in the same words as a missing key.
  */
  const selectedStyleUrl =
    (basemapChoices.find((choice) => choice.id === selectedBasemapId) ?? basemapChoices[0])?.styleUrl ?? null;

  /** The same backgrounds with the picker's words in the participant's language. */
  const translatedBasemapChoices = useMemo(
    () => translatePublicBasemapChoices(basemapChoices, translator),
    [basemapChoices, translator]
  );

  // Handlers registered once on the map instance read the live values through
  // refs; re-registering them on every render would double-handle every click.
  const drawRef = useRef(draw);
  const drawEnabledRef = useRef(drawEnabled);
  const onGeometryChangeRef = useRef(onGeometryChange);
  const onSelectItemRef = useRef(onSelectItem);
  const itemsRef = useRef(items);
  const buildingsControlRef = useRef<BuildingsControl | null>(null);
  const [buildings3d, setBuildings3d] = useState(false);
  const buildings3dRef = useRef(buildings3d);
  /** The 3D state the camera last moved for. */
  const appliedBuildingsRef = useRef(false);
  const contextLayersRef = useRef(contextLayers);
  const translatorRef = useRef(translator);
  /** The style currently applied to the live map, so a repaint knows whether it must wait for a swap. */
  const appliedStyleRef = useRef<string | null>(null);
  /** Whether the style on the map RIGHT NOW has finished loading. */
  const styleLoadedRef = useRef(false);
  /** Whether any style has ever loaded — the difference between a blank stage and a failed swap. */
  const everLoadedRef = useRef(false);
  /** Which background the error handler should blame, read at error time. */
  const selectedBasemapIdRef = useRef(selectedBasemapId);

  useEffect(() => {
    selectedBasemapIdRef.current = selectedBasemapId;
  }, [selectedBasemapId]);

  useEffect(() => {
    drawRef.current = draw;
    drawEnabledRef.current = drawEnabled;
    onGeometryChangeRef.current = onGeometryChange;
    onSelectItemRef.current = onSelectItem;
    itemsRef.current = items;
    buildings3dRef.current = buildings3d;
    contextLayersRef.current = contextLayers;
    translatorRef.current = translator;
  }, [draw, drawEnabled, onGeometryChange, onSelectItem, items, buildings3d, contextLayers, translator]);

  const selectedItemIdRef = useRef(selectedItemId);
  selectedItemIdRef.current = selectedItemId;
  /** Whether the camera has already been fitted to the data once. */
  const framedRef = useRef(false);
  /** The selection the camera last moved for. */
  const flownToRef = useRef<string | null>(null);

  /**
   * Move the camera to the selected comment once per selection. Called when the
   * selection changes and again when a style finishes painting, because a
   * shared `?item=` link selects before the first style has loaded.
   */
  const bringSelectedIntoView = (map: mapboxgl.Map) => {
    const id = selectedItemIdRef.current;
    if (!id || flownToRef.current === id) return;
    const item = itemsRef.current.find((entry) => entry.id === id);
    const geometry = item ? participantItemGeometry(item) : null;
    if (!geometry) return;
    flownToRef.current = id;

    const padding = overlayPadding(mapContainerRef.current);
    if (geometry.type === "Point") {
      const [lng, lat] = geometry.coordinates;
      const pixel = map.project([lng, lat]);
      const canvas = mapContainerRef.current;
      const width = canvas?.clientWidth ?? 0;
      const height = canvas?.clientHeight ?? 0;
      const inView =
        pixel.x >= padding.left && pixel.x <= width - padding.right &&
        pixel.y >= padding.top && pixel.y <= height - padding.bottom;
      // A pin inside a group is not drawn on its own, so zoom past the grouping.
      if (!inView || map.getZoom() < 16) {
        map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), padding });
      }
      return;
    }
    const bounds = new mapboxgl.LngLatBounds();
    collectGeometryPositions(geometry).forEach((position) => bounds.extend(position));
    map.fitBounds(bounds, {
      padding: { top: padding.top + 40, right: padding.right + 40, bottom: padding.bottom + 40, left: padding.left + 40 },
      maxZoom: 16,
    });
  };

  /** The selected comment's place as map data; empty when nothing is open. */
  const selectedFeatureCollection = () => {
    const id = selectedItemIdRef.current;
    const item = id ? itemsRef.current.find((entry) => entry.id === id) : undefined;
    const geometry = item ? participantItemGeometry(item) : null;
    if (!item || !geometry) return EMPTY_COLLECTION;
    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry,
          properties: { itemId: item.id, color: safeHexColor(item.color) ?? DEFAULT_MAP_COLOR },
        },
      ],
    };
  };

  // Tell the shell only after this stage has committed its own drawing state.
  // Calling the parent setter from inside setDraw's updater makes React render
  // the parent while this child is still rendering and logs a real runtime
  // error on the public portal.
  useEffect(() => {
    onGeometryChangeRef.current?.(deriveGeometry(draw));
  }, [draw]);

  const announceSeqRef = useRef(0);
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
  // A zero-width nonce so a repeated action with identical wording still mutates
  // the live region and gets spoken again. U+200B is invisible and not read.
  const announce = (message: string) => {
    announceSeqRef.current += 1;
    setAnnouncement(message + ZERO_WIDTH_SPACE.repeat(announceSeqRef.current % 2));
  };

  const applyDraw = (updater: (previous: DrawState) => DrawState) => {
    setDraw((previous) => updater(previous));
  };

  const commitVertex = (coord: [number, number]) => {
    if (!drawEnabledRef.current) return;
    const { outcome } = appendVertex(drawRef.current, coord);
    if (outcome === "closed-locked") {
      announce(translatorRef.current.t("portal.drawAreaAlreadyClosed"));
      return;
    }
    if (outcome === "limit") {
      announce(translatorRef.current.t("portal.drawVertexLimit"));
      return;
    }
    applyDraw((previous) => appendVertex(previous, coord).next);
    announce(
      outcome === "placed"
        ? translatorRef.current.t("portal.drawPointPlaced")
        : translatorRef.current.t("portal.drawVertexAdded")
    );
  };

  // A parent-driven mode change (the sidebar's point / line / area buttons)
  // starts a fresh shape — the previous vertices belong to a different geometry
  // type and silently reinterpreting them would submit a shape nobody drew.
  useEffect(() => {
    setDraw((previous) => {
      if (previous.mode === drawMode) return previous;
      return { mode: drawMode, vertices: [], areaClosed: false };
    });
  }, [drawMode]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current || !MAPBOX_ACCESS_TOKEN || !selectedStyleUrl) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const map = new mapboxgl.Map({
      container,
      style: selectedStyleUrl,
      center: initialView?.center ?? CONTINENTAL_US_CENTER,
      zoom: initialView?.zoom ?? NEUTRAL_ZOOM,
      // Mapbox's own buttons, in the resident's language.
      locale: {
        "NavigationControl.ZoomIn": translatorRef.current.t("portal.mapZoomIn"),
        "NavigationControl.ZoomOut": translatorRef.current.t("portal.mapZoomOut"),
        "NavigationControl.ResetBearing": translatorRef.current.t("portal.mapResetNorth"),
        "GeolocateControl.FindMyLocation": translatorRef.current.t("portal.mapFindMe"),
        "GeolocateControl.LocationNotAvailable": translatorRef.current.t("portal.mapFindMeUnavailable"),
      },
      /*
        ATTRIBUTION IS ON — added explicitly below rather than by the default,
        so its compactness is stated rather than inferred from the viewport.

        Every map in this product was constructed with `attributionControl:
        false` and nothing anywhere rendered "© Mapbox © OpenStreetMap". That is
        a licence term unmet, and on the one surface a member of the public reads
        it is unmet in public. Fixed here because this is the map a resident
        sees; the other ten instances are reported, not silently changed by a
        lane that does not own them.

        Compact rather than full because on a phone the bottom of this stage is
        the only strip the sheet does not cover.
      */
      attributionControl: false,
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    /*
      ═══ THE TWO HANDLERS THAT DECIDE WHETHER THIS STAGE IS HONEST ═══

      `style.load` is the only proof a background actually arrived. It clears
      the failure state, so a resident who switches to a background that works
      gets the map back with no reload.
    */
    map.on("style.load", () => {
      styleLoadedRef.current = true;
      everLoadedRef.current = true;
      setStyleFailed(false);
      setFailedBasemapId((previous) => (previous === selectedBasemapIdRef.current ? null : previous));
    });

    map.on("error", () => {
      // The style on screen is up: this is a tile or a source, not the map.
      if (styleLoadedRef.current) return;
      setFailedBasemapId(selectedBasemapIdRef.current);
      // Something has drawn before, so the resident still has a usable map on
      // the previous background — mark the failed choice and leave the map
      // alone. Nothing has ever drawn: the stage is blank and must say so.
      if (!everLoadedRef.current) setStyleFailed(true);
    });

    /*
      AND THE CASE WHERE NOTHING IS REPORTED AT ALL. A request that hangs — a
      captive portal, a proxy that swallows the connection — fires no `error`
      and no `style.load`, and the resident waits forever in front of a grey
      box. After this long, say so; `style.load` clears it if the map is merely
      slow, so a bad connection costs a notice rather than the map.
    */
    const watchdog = window.setTimeout(() => {
      if (everLoadedRef.current) return;
      setFailedBasemapId(selectedBasemapIdRef.current);
      setStyleFailed(true);
    }, STYLE_LOAD_WATCHDOG_MS);

    // The notice about an unframed map is for a resident who has not moved yet.
    map.on("movestart", () => setUnframedNoticeDismissed(true));

    // The stage can be mounted inside a collapsed sheet or a hidden tab, which
    // measures 0x0; the observer re-measures the moment it gets a box.
    const stopSizing = keepMapSizedToContainer(map, container);

    // The wrapper div is the single keyboard widget (WCAG 2.1.1), so Mapbox's
    // own keyboard handling is off — otherwise every arrow key is handled twice
    // and the canvas becomes a second tab stop with no accessible name.
    map.keyboard.disable();
    // The compass shows once the map is turned or tilted, and puts it back.
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    // Moves the camera only. The resident still taps, or presses Enter, to mark.
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        fitBoundsOptions: { maxZoom: 16 },
      }),
      "top-right"
    );
    const buildingsControl = new BuildingsControl(() => setBuildings3d((previous) => !previous));
    buildingsControlRef.current = buildingsControl;
    map.addControl(buildingsControl, "top-right");

    /*
      READING SOMEBODY'S COMMENT IS NOT MARKING YOUR OWN PLACE.

      Every tap used to go to the drawing tool, so tapping a neighbour's pin to
      read it also moved the resident's own mark onto that pin, observed in a
      browser on 2026-10-10. A tap now goes to what is under it first: a group
      of pins zooms in, a pin or a line opens that comment. Only an empty spot
      marks.

      An area is the exception while drawing is on. One comment can outline a
      whole neighbourhood, and letting it swallow taps would leave nowhere
      inside it to mark. Those comments open from the list instead.
    */
    map.on("click", (event) => {
      const current = drawRef.current;
      const next = drawCoordinate(event.lngLat.lng, event.lngLat.lat);
      const drawing = drawEnabledRef.current;

      // Area mode: clicking near the first vertex closes the ring. Pointer-only;
      // keyboard users press C. Checked before anything else so a pin under the
      // first point cannot stop a resident finishing their own shape.
      if (drawing && current.mode === "area" && !current.areaClosed && current.vertices.length >= 3) {
        const firstPixel = map.project(current.vertices[0]);
        const clickPixel = map.project(next);
        if (Math.hypot(firstPixel.x - clickPixel.x, firstPixel.y - clickPixel.y) <= CLOSE_RING_PIXEL_TOLERANCE) {
          applyDraw((previous) => ({ ...previous, areaClosed: true }));
          announce(translatorRef.current.t("portal.drawAreaClosed"));
          return;
        }
      }

      const pickable = ["engagement-clusters", "engagement-points", "engagement-shapes-line"];
      if (!drawing) pickable.push("engagement-shapes-fill");
      const layers = pickable.filter((id) => map.getLayer(id));
      const { x, y } = event.point;
      const hits = layers.length
        ? map.queryRenderedFeatures(
            [
              [x - PICK_TOLERANCE_PX, y - PICK_TOLERANCE_PX],
              [x + PICK_TOLERANCE_PX, y + PICK_TOLERANCE_PX],
            ],
            { layers }
          )
        : [];
      const hit = hits[0];

      if (hit?.layer?.id === "engagement-clusters") {
        const clusterId = hit.properties?.cluster_id as number | undefined;
        const source = map.getSource(POINT_SOURCE) as mapboxgl.GeoJSONSource | undefined;
        if (clusterId === undefined || !source || hit.geometry.type !== "Point") return;
        const center = hit.geometry.coordinates as [number, number];
        source.getClusterExpansionZoom(clusterId, (error, zoom) => {
          if (error || typeof zoom !== "number") return;
          map.easeTo({ center, zoom });
        });
        return;
      }

      const itemId = hit?.properties?.itemId as string | undefined;
      if (itemId) {
        onSelectItemRef.current?.(itemId);
        return;
      }

      if (!drawing) {
        onSelectItemRef.current?.(null);
        return;
      }
      commitVertex(next);
    });

    for (const layerId of ["engagement-clusters", "engagement-points", "engagement-shapes-line"]) {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    map.on("contextmenu", (event) => {
      event.preventDefault();
      undo();
    });

    mapRef.current = map;
    // The style this map was BUILT with. The repaint effect compares against it
    // to decide whether it must swap; leaving it unset is what silently broke
    // the background picker.
    appliedStyleRef.current = selectedStyleUrl;

    return () => {
      window.clearTimeout(watchdog);
      stopSizing();
      map.remove();
      mapRef.current = null;
      buildingsControlRef.current = null;
    };
    // Registered once; the handlers above read live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    EVERYTHING THAT LIVES ON THE MAP, PAINTED IN ONE PLACE — and re-painted from
    scratch whenever the style changes.

    A basemap swap wipes Mapbox's source and layer registry, which is why this is
    not three separate effects: the sketch preview, the community's shapes and
    the operator's context layers all have to come back together, in the same
    order, or a satellite toggle silently drops the thing the campaign is about.
    Markers are DOM elements and survive a style change, so they are torn down
    and rebuilt here too rather than accumulating one copy per repaint.
  */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    /*
      THE STYLE SWAP HAPPENS HERE, not in an effect of its own, and that ordering
      is the whole reason this is one effect. `setStyle` wipes every source and
      layer asynchronously; a separate effect would race this one, and the loser
      paints the community's pins onto a style that is about to be thrown away —
      a satellite toggle that silently empties the map.
    */
    const desiredStyle = selectedStyleUrl;
    if (!desiredStyle) return;
    /*
      `appliedStyleRef` is seeded where the map is CONSTRUCTED, and that is not
      a detail: it was declared here and only ever written inside this branch,
      so it stayed null forever, `styleChanged` was never true, and `setStyle`
      was never called. The background picker moved its radio, the sr-only
      readout changed, and the map underneath stayed on the background it opened
      with — a control that did nothing, with a test-visible field agreeing that
      it had.
    */
    const styleChanged = appliedStyleRef.current !== desiredStyle;
    if (styleChanged) {
      appliedStyleRef.current = desiredStyle;
      // The map is between styles from here until `style.load`, so an error
      // reported in that window belongs to the background being switched TO.
      styleLoadedRef.current = false;
      map.setStyle(desiredStyle);
    }

    const pointItems: (ParticipantMapItem & { latitude: number; longitude: number })[] = [];
    const shapeItems: (ParticipantMapItem & { parsedGeometry: EngagementGeometry })[] = [];
    for (const item of items) {
      const geometry = participantItemGeometry(item);
      if (!geometry) continue;
      if (geometry.type === "Point") {
        pointItems.push({ ...item, longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] });
      } else {
        shapeItems.push({ ...item, parsedGeometry: geometry });
      }
    }
    // Only what the resident has left switched on. The picker owns the set; the
    // map must never draw a layer the legend and the picker both say is off.
    const visible = new Set(visibleLayerIds);
    const layers = (contextLayersRef.current?.layers ?? []).filter((layer) => visible.has(layer.id));

    const pointData = {
      type: "FeatureCollection" as const,
      features: pointItems.map((item) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [item.longitude, item.latitude] },
        properties: { itemId: item.id, color: safeHexColor(item.color) ?? DEFAULT_MAP_COLOR },
      })),
    };
    const shapeData = {
      type: "FeatureCollection" as const,
      features: shapeItems.map((item) => ({
        type: "Feature" as const,
        geometry: item.parsedGeometry,
        properties: { itemId: item.id, color: safeHexColor(item.color) ?? DEFAULT_MAP_COLOR },
      })),
    };

    const paint = () => {
      /*
        THE COMMUNITY'S INPUT IS DATA ON THE MAP, NOT DOM ELEMENTS OVER IT.
        Pins used to be one HTML marker each, which every approved comment now
        reaches since the 200-row cap went, and a dense spot was a pile nobody
        could tap. A clustered source groups close pins into a count until the
        resident zooms in; a filter or a vote updates the data in place.
      */
      const shapeSource = map.getSource(SHAPE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      if (shapeSource) shapeSource.setData(shapeData);
      else {
        map.addSource(SHAPE_SOURCE, { type: "geojson", data: shapeData });
        const shapeColor = ["coalesce", ["get", "color"], DEFAULT_MAP_COLOR] as unknown as mapboxgl.Expression;
        map.addLayer({
          id: "engagement-shapes-fill",
          type: "fill",
          source: SHAPE_SOURCE,
          paint: { "fill-color": shapeColor, "fill-opacity": 0.2 },
          filter: ["==", ["geometry-type"], "Polygon"],
        });
        map.addLayer({
          id: "engagement-shapes-outline",
          type: "line",
          source: SHAPE_SOURCE,
          paint: { "line-color": shapeColor, "line-width": 2 },
          filter: ["==", ["geometry-type"], "Polygon"],
        });
        map.addLayer({
          id: "engagement-shapes-line",
          type: "line",
          source: SHAPE_SOURCE,
          paint: { "line-color": shapeColor, "line-width": 4 },
          filter: ["==", ["geometry-type"], "LineString"],
        });
      }

      const pointSource = map.getSource(POINT_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      if (pointSource) pointSource.setData(pointData);
      else {
        map.addSource(POINT_SOURCE, {
          type: "geojson",
          data: pointData,
          cluster: true,
          clusterRadius: 40,
          clusterMaxZoom: 15,
          // Two or three pins near each other stay pins; a pile becomes a count.
          clusterMinPoints: 4,
        });
        map.addLayer({
          id: "engagement-clusters",
          type: "circle",
          source: POINT_SOURCE,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#1e293b",
            "circle-opacity": 0.9,
            "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 24],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "engagement-cluster-count",
          type: "symbol",
          source: POINT_SOURCE,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
            "text-size": 13,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({
          id: "engagement-points",
          type: "circle",
          source: POINT_SOURCE,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["coalesce", ["get", "color"], DEFAULT_MAP_COLOR] as unknown as mapboxgl.Expression,
            "circle-radius": 7,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
      }

      // The comment open in the panel, ringed on top of everything else.
      if (!map.getSource(SELECTED_SOURCE)) {
        map.addSource(SELECTED_SOURCE, { type: "geojson", data: selectedFeatureCollection() });
        map.addLayer({
          id: "engagement-selected-line",
          type: "line",
          source: SELECTED_SOURCE,
          filter: ["!=", ["geometry-type"], "Point"],
          paint: { "line-color": "#0f172a", "line-width": 6, "line-opacity": 0.7 },
        });
        map.addLayer({
          id: "engagement-selected-point",
          type: "circle",
          source: SELECTED_SOURCE,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": ["coalesce", ["get", "color"], DEFAULT_MAP_COLOR] as unknown as mapboxgl.Expression,
            "circle-radius": 10,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 3,
          },
        });
      }

      // The resident's own sketch, on top of the community's.
      if (!map.getSource("engagement-draw")) {
        map.addSource("engagement-draw", {
          type: "geojson",
          data: buildPreviewFeatureCollection(drawRef.current),
        });
        map.addLayer({
          id: "engagement-draw-fill",
          type: "fill",
          source: "engagement-draw",
          paint: { "fill-color": "#f97316", "fill-opacity": 0.25 },
          filter: ["==", ["geometry-type"], "Polygon"],
        });
        map.addLayer({
          id: "engagement-draw-line",
          type: "line",
          source: "engagement-draw",
          paint: { "line-color": "#f97316", "line-width": 3 },
          filter: ["!=", ["geometry-type"], "Point"],
        });
        map.addLayer({
          id: "engagement-draw-points",
          type: "circle",
          source: "engagement-draw",
          paint: {
            "circle-radius": 6,
            "circle-color": "#f97316",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
          filter: ["==", ["geometry-type"], "Point"],
        });
      }

      /*
        ALWAYS, EVEN WITH NOTHING TO DRAW — and especially then. `syncContextLayers`
        does two jobs: it registers what should be on the map, and it RETIRES
        what should no longer be. Skipping the call when the visible set is empty
        skipped the retirement, so switching off the last (or the only) layer
        left it painted: the checkbox cleared, the map did not, and the one
        control this surface gives a resident over what they are looking at did
        nothing. An empty list is an instruction, not an absence of one.
      */
      syncContextLayers(map, layers, { beforeId: "engagement-shapes-fill" });

      syncBuildings(map, buildings3dRef.current);

      /*
        FRAME THE CAMERA ONLY WHEN NOTHING ELSE DID. `initialView` is the
        campaign's own stated area, resolved server-side, and it outranks the
        extent of whatever has been submitted so far: an agency that said "this
        consultation is about these six blocks" must not have its map yanked to a
        pin somebody dropped two towns over. Fitting to the data is the fallback
        for a campaign nobody framed.
      */
      if (!initialView && !framedRef.current) {
        // Once. A filter or a vote repaints the data; it must not move the camera.
        framedRef.current = true;
        const bounds = new mapboxgl.LngLatBounds();
        pointItems.forEach((item) => bounds.extend([item.longitude, item.latitude]));
        shapeItems.forEach((item) =>
          collectGeometryPositions(item.parsedGeometry).forEach((position) => bounds.extend(position))
        );
        layers.forEach((layer) => {
          if (!layer.bbox) return;
          bounds.extend([layer.bbox[0], layer.bbox[1]]);
          bounds.extend([layer.bbox[2], layer.bbox[3]]);
        });
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: SEEDED_ZOOM + 3 });
      }

      bringSelectedIntoView(map);
    };

    if (!styleChanged && map.isStyleLoaded()) paint();
    else map.once("style.load", paint);
    // `basemap` is a dependency because a style swap wipes the registry above.
  }, [items, contextLayers, initialView, selectedStyleUrl, visibleLayerIds]);

  /*
    THE SELECTED COMMENT: ring it, and bring it into view if it is not.
    The camera moves only when the selection changes and only when the place is
    off screen or hidden under the open list, so reading down the list does not
    swing the map about.
  */
  useEffect(() => {
    const map = mapRef.current;
    /*
      `styleLoadedRef`, not `map.isStyleLoaded()`. Mapbox answers false while
      tiles are still streaming in, long after `style.load`, so a shared link
      that selected a comment in that window never moved the camera (seen in a
      browser on 2026-10-10). Before `style.load`, the paint runs this instead.
    */
    if (!map || !styleLoadedRef.current) return;
    (map.getSource(SELECTED_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(selectedFeatureCollection());
    bringSelectedIntoView(map);
    // Runs on a selection change only; a vote must not re-run the camera.
  }, [selectedItemId]);

  useEffect(() => {
    if (!selectedItemId) flownToRef.current = null;
  }, [selectedItemId]);

  // The 3D switch: buildings and a tilt on, flat and north-up off.
  useEffect(() => {
    const control = buildingsControlRef.current;
    if (control) {
      const label = t("portal.map3d");
      control.button.setAttribute("aria-label", label);
      control.button.title = label;
      control.button.setAttribute("aria-pressed", String(buildings3d));
      control.button.style.background = buildings3d ? "#e2e8f0" : "";
    }
    // The camera moves on a flip of the switch, never on the first render.
    const flipped = appliedBuildingsRef.current !== buildings3d;
    appliedBuildingsRef.current = buildings3d;
    const map = mapRef.current;
    if (!flipped || !map || !styleLoadedRef.current) return;
    syncBuildings(map, buildings3d);
    map.easeTo(buildings3d ? { pitch: BUILDINGS_PITCH } : { pitch: 0, bearing: 0 });
  }, [buildings3d, t]);

  // Keep the sketch source in step with the state the keyboard and pointer
  // paths share.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("engagement-draw") as mapboxgl.GeoJSONSource | undefined;
    source?.setData(buildPreviewFeatureCollection(draw));
  }, [draw]);

  const clear = () => {
    if (drawRef.current.vertices.length === 0) return;
    applyDraw((previous) => ({ ...previous, vertices: [], areaClosed: false }));
    announce(t("portal.drawCleared"));
  };

  const undo = () => {
    if (drawRef.current.vertices.length === 0) return;
    applyDraw((previous) => ({
      ...previous,
      vertices: previous.vertices.slice(0, -1),
      areaClosed: false,
    }));
    announce(t("portal.drawUndone"));
  };

  const closeArea = () => {
    if (drawRef.current.mode !== "area" || drawRef.current.vertices.length < 3) return;
    applyDraw((previous) => ({ ...previous, areaClosed: true }));
    announce(t("portal.drawAreaClosed"));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Mapbox inserts real <button>s (the zoom controls) into this container. A
    // keydown on one of them bubbles here, and without this guard Enter on the
    // zoom-in button would commit a stray vertex and cancel the button.
    if (event.target !== event.currentTarget) return;
    const map = mapRef.current;
    if (!map) return;
    switch (event.key) {
      case "ArrowUp":
        map.panBy([0, -KEYBOARD_PAN_STEP_PX], { duration: 0 });
        event.preventDefault();
        break;
      case "ArrowDown":
        map.panBy([0, KEYBOARD_PAN_STEP_PX], { duration: 0 });
        event.preventDefault();
        break;
      case "ArrowLeft":
        map.panBy([-KEYBOARD_PAN_STEP_PX, 0], { duration: 0 });
        event.preventDefault();
        break;
      case "ArrowRight":
        map.panBy([KEYBOARD_PAN_STEP_PX, 0], { duration: 0 });
        event.preventDefault();
        break;
      case "+":
      case "=":
        map.zoomIn();
        event.preventDefault();
        break;
      case "-":
      case "_":
        map.zoomOut();
        event.preventDefault();
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        const center = map.getCenter();
        commitVertex(drawCoordinate(center.lng, center.lat));
        break;
      }
      case "Backspace":
      case "Delete":
        event.preventDefault();
        undo();
        break;
      case "c":
      case "C":
        if (drawRef.current.mode === "area") {
          event.preventDefault();
          closeArea();
        }
        break;
      case "Escape":
        if (drawRef.current.vertices.length > 0) {
          event.preventDefault();
          clear();
        }
        break;
      default:
        break;
    }
  };

  /*
    NO TOKEN, NO STAGE. This component renders NOTHING rather than a full-screen
    dashed rectangle apologising for itself — the route decides, server-side,
    that a deployment with no map key gets the sidebar-only shell instead, with
    the explanation at the top of it. A map-first page whose map is a placeholder
    is worse than a page that was never map-first.

    Kept as a guard here as well as at the route because this component may not
    be constructed without a token under any caller: `new mapboxgl.Map` with an
    empty token throws in the browser.
  */
  if (!MAPBOX_ACCESS_TOKEN) return null;

  /*
    THE TWO WAYS A TOKEN CAN BE PRESENT AND THE MAP STILL ABSENT. Both end in
    the same thing for a resident — a stage that will never show a map — so both
    say the same sentence to them, and differ only in the operator's detail.
  */
  const mapUnavailable: "no-background" | "load-failed" | null = !selectedStyleUrl
    ? "no-background"
    : styleFailed
      ? "load-failed"
      : null;

  /*
    NOTHING ANYWHERE SAYS WHERE THIS CAMPAIGN IS. Not just "no campaign area":
    no project area, no agency home, no approved pin, and no published layer
    with an extent — because any one of those frames the camera and the map is
    then showing a place somebody chose. `initialView` carries the first three
    (`resolvePortalMapFraming` decides between them); the rest is what this
    effect would otherwise have fitted the camera to.
  */
  const hasSomethingToShow =
    Boolean(initialView) ||
    items.some(hasEngagementLocation) ||
    (contextLayers?.layers ?? []).some((layer) => Boolean(layer.bbox));

  const showUnframedNotice = !mapUnavailable && !hasSomethingToShow && !unframedNoticeDismissed;

  return (
    <div className={cn("relative isolate h-full w-full overflow-hidden bg-muted/20", className)} data-testid="portal-map-stage">
      <div
        ref={mapContainerRef}
        role="application"
        tabIndex={0}
        aria-roledescription={t("portal.mapRoleDescription")}
        aria-label={drawEnabled ? t("portal.mapLabelDrawing") : t("portal.mapLabelReading")}
        aria-describedby={instructionsId}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        // `h-full w-full` in a `relative` parent — NOT `absolute inset-0`, which
        // mapbox-gl.css cancels with its own `position: relative`.
        className="h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />

      {isFocused && drawEnabled ? (
        // The crosshair Enter places a vertex at. Only while focused, because
        // pointer users aim with the cursor and a permanent reticle in the
        // middle of a full-screen map reads as a defect.
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-8 w-8 -translate-x-1/2 -translate-y-1/2">
          <span className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-orange-500 shadow" />
          <span className="absolute left-1/2 top-1/2 h-5 w-px -translate-x-1/2 -translate-y-1/2 bg-orange-500" />
          <span className="absolute left-1/2 top-1/2 h-px w-5 -translate-x-1/2 -translate-y-1/2 bg-orange-500" />
        </div>
      ) : null}

      {/*
        THE TWO MAP CONTROLS, from the shared pickers rather than a toggle of
        this file's own. Top-LEFT: on a phone the bottom of this stage is behind
        the sheet, and Mapbox's compact attribution has the bottom-right corner.

        `PublicMapLayerPicker` renders nothing when the campaign published no
        layers and nothing failed, and `PublicBasemapPicker` renders nothing when
        the deployment offers no choices — so an ordinary campaign gets a clean
        map rather than two empty panels.

        ═══ THE PICKER IS THE LEGEND, AND THERE IS NO SECOND ONE ═══

        `ParticipantMapLegend` used to be rendered here as well, from the FULL
        layer set rather than the visible one, which made it the only thing on
        the screen still naming a layer the resident had just switched off. Two
        wrongs at once: the same layer read twice on one small screen, and the
        second reading contradicting the map. The picker survives because it is
        the one that can be right — it carries the swatch, the operator's name,
        the description, the coverage notes and the read-failure sentence, and
        it is the only one of the two that KNOWS what is currently drawn. The
        legend stays exactly as it is on the other two maps, which have no
        picker.

        With no map, no controls: a background chooser and a layer list over a
        stage that cannot draw are two controls claiming to do something.
      */}

      {mapUnavailable ? null : (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex w-[min(16rem,calc(100%-6rem))] flex-col gap-2">
        {feed?.button ? <div className="pointer-events-auto">{feed.button}</div> : null}
        <PublicMapPickers
          className="pointer-events-none flex flex-col gap-2"
          contextLayers={contextLayers}
          visibleLayerIds={visibleLayerIds}
          onVisibleLayerIdsChange={onVisibleLayerIdsChange}
          /*
            THE BACKGROUNDS, NAMED IN THE RESIDENT'S LANGUAGE. The registry's own
            `label`/`description` are English literals — it is server
            configuration and cannot reach the participant catalog — so the
            picker used to render its heading translated and every option inside
            it in English. `translatePublicBasemapChoices` copies the words
            across and leaves `id`, `styleUrl` and `dark` exactly as they were,
            which is why the style lookup above still reads the untranslated
            `basemapChoices`.
          */
          basemapChoices={translatedBasemapChoices}
          selectedBasemapId={selectedBasemapId}
          onBasemapSelect={onBasemapSelect}
          failedBasemapId={failedBasemapId}
          /*
            OpenPlan's own words, in the language the rest of the page is in.
            These were the picker components' English defaults rendered under
            `lang={bcp47}` — an element declaring Farsi over English text, which
            is the one thing the participant surface's language rules forbid.
          */
          layerLabels={{
            heading: t("portal.layersHeading"),
            hint: t("portal.layersHint"),
            toggleLabel: t("portal.layersHeading"),
            readFailure: t("portal.layersReadFailure"),
            showAll: t("portal.layersShowAll"),
            hideAll: t("portal.layersHideAll"),
          }}
          basemapLabels={{
            heading: t("portal.backgroundHeading"),
            hint: t("portal.backgroundHint"),
            unavailable: t("portal.backgroundUnavailable"),
          }}
          lang={translator.bcp47}
        />
        </div>
      )}

      {mapUnavailable ? null : feed?.panel}

      {/*
        NOBODY SAID WHERE THIS IS ABOUT. Not an error and not a failure — the
        campaign, its project and the agency all have no area on record and no
        pin has landed yet — but a wide map filling a resident's screen under
        "tap where you mean" reads as a study area, and it is not one. So the
        map still works (a resident can move to their own street and drop a pin,
        which is the only thing left that could frame this) and the state is
        stated instead of implied. It clears itself the moment they move.
      */}
      {showUnframedNotice ? (
        <div
          role="status"
          data-testid="portal-map-unframed-notice"
          className="absolute bottom-8 left-3 z-10 max-w-[min(22rem,calc(100%-1.5rem))] rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
        >
          <p className="font-semibold text-foreground">{t("portal.mapNoAreaTitle")}</p>
          <p className="mt-1 text-muted-foreground">{t("portal.mapNoAreaBody")}</p>
          <button
            type="button"
            className="mt-2 min-h-11 rounded-md border border-border/60 px-3 py-1 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setUnframedNoticeDismissed(true)}
          >
            {t("portal.mapNoAreaDismiss")}
          </button>
        </div>
      ) : null}

      {/*
        THE MAP IS NOT COMING. Covering the stage rather than sitting beside it,
        because what is underneath is a grey rectangle, and the worst outcome on
        a page that IS the map is the resident who never learns that the blank
        square is broken rather than empty. The resident's half says what they
        can still do and stops; the cause is an operator's and is folded away.
      */}
      {mapUnavailable ? (
        <div
          data-testid="portal-map-stage-unavailable"
          className="absolute inset-0 z-30 flex items-center justify-center bg-background/95 p-6"
        >
          <div className="max-w-md text-sm text-muted-foreground">
            <p className="text-base font-semibold text-foreground">{t("portal.mapMissingTitle")}</p>
            <p className="mt-1.5">{t("portal.mapMissingBody")}</p>
            <OperatorDetail>
              {mapUnavailable === "no-background" ? (
                <p>
                  This deployment offers no map background, so no map can be drawn. Check
                  OPENPLAN_PUBLIC_BASEMAPS — every id it names is one OpenPlan does not know — or unset it
                  to use the default set.
                </p>
              ) : (
                <p>
                  Mapbox reported an error loading the map background, or it never arrived. The usual causes
                  are an access token that has been revoked, restricted to another site&apos;s URL, or scoped
                  without styles:read, and a network that blocks api.mapbox.com. The browser console holds
                  Mapbox&apos;s own message.
                </p>
              )}
            </OperatorDetail>
          </div>
        </div>
      ) : null}

      {/*
        THE STYLE THE MAP IS CURRENTLY ON, AS AN ATTRIBUTE — SO A TEST CAN READ
        IT AND A SCREEN READER CANNOT.

        This was `<span className="sr-only">{selectedStyleUrl}</span>`, and the
        comment above it said "Not visible copy", which was true and was the
        whole problem. `sr-only` is visually hidden and NOT hidden from
        assistive technology — that is its entire purpose — so on a PUBLIC
        engagement portal, a blind resident arriving to leave a comment about
        their neighbourhood had "mapbox://styles/mapbox/streets-v12" read aloud
        to them, in the accessible-content slot, as though it were something
        they needed.

        A `data-` attribute is exactly as readable to a test and completely
        silent to assistive technology, so nothing is traded: the observation
        survives, the resident stops hearing a URL. `hidden` would not have
        done: it removes the node from the a11y tree but Playwright's text
        queries skip it too, and `aria-hidden` on a text node is the pattern
        that gets copied to places where it becomes a WCAG failure.

        The keyboard-help paragraph below is `sr-only` and STAYS `sr-only` — it
        is real prose written for a person, which is what that class is for.
      */}
      <span data-testid="portal-map-basemap" data-basemap-style={selectedStyleUrl ?? ""} />

      <p id={instructionsId} className="sr-only">
        {drawEnabled ? t("portal.mapKeyboardHelp") : t("portal.mapKeyboardHelpReadOnly")}
      </p>

      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
