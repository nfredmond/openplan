"use client";

import { useEffect, useId, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { cn } from "@/lib/utils";
import { keepMapSizedToContainer } from "@/lib/mapbox/keep-map-sized";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import type { EngagementGeometry } from "@/lib/engagement/geometry";
/*
  THE GEOMETRY RULES ARE SHARED, NOT COPIED. `draw-state.ts` holds the pure
  vertex/preview/derive logic this picker and the full-screen participant map
  (`public-map-stage.tsx`) both obey. They were private to this file until a
  second drawing map existed; a shared capability living inside one of its two
  callers gets reimplemented — slightly differently — by the other, and the
  difference here would be invisible until an operator opened a polygon nobody
  could close.
*/
import {
  appendVertex,
  buildPreviewFeatureCollection,
  deriveGeometry,
  type DrawState,
  type EngagementDrawMode,
} from "@/lib/engagement/draw-state";
// Re-exported because `public-survey-form.tsx` imports the mode type from this
// component, which is where it lived before the extraction. Kept so the seam
// moved without every call site moving with it.
export type { EngagementDrawMode } from "@/lib/engagement/draw-state";
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";
import { syncContextLayers } from "@/lib/engagement/context-layer-paint";
import { ParticipantMapLegend } from "./participant-map-legend";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

/**
 * WHETHER THIS DEPLOYMENT CAN DRAW A MAP AT ALL, readable by the form that
 * mounts this picker.
 *
 * The picker already answers the question for itself below (`if
 * (!MAPBOX_ACCESS_TOKEN)`), but a surrounding form has to answer it too, and for
 * different reasons: the sentences describing where "this map" opens must not be
 * printed above a map that is not there, and the "where" question has to be
 * asked in words instead. Exporting the one reading is what stops the form and
 * the picker disagreeing — the alternative is the form re-reading
 * `process.env` and the two drifting the first time the token resolution
 * changes.
 *
 * `NEXT_PUBLIC_*` is inlined at build time, so this is a constant in the bundle
 * rather than a runtime lookup.
 */
export const GEOMETRY_PICKER_CAN_DRAW = Boolean(MAPBOX_ACCESS_TOKEN);

const CLOSE_RING_PIXEL_TOLERANCE = 12;
const KEYBOARD_PAN_STEP_PX = 64;

/**
 * EVERY WORD THIS MAP SAYS, so that none of them is a literal inside it.
 *
 * ═══ THE DEFECT THIS CLOSES ═══
 *
 * This picker is the drawing map on `/engage/<token>/about` and inside `/embed`
 * — both PUBLIC surfaces, both of which declare the resident's language on their
 * own wrapper — and every sentence it produced was an English literal written in
 * a surveyor's vocabulary: "Click the map or press Enter to drop a pin at the
 * crosshair", "2 vertices · line ready", "Vertex limit reached". Three separate
 * problems in one string: English inside a Spanish page, a mouse verb on a
 * surface most people reach by phone, and "vertex" — a word for the corner of a
 * shape that nobody outside a GIS office uses.
 *
 * ═══ WHY ENGLISH DEFAULTS STILL LIVE HERE ═══
 *
 * The operator console mounts this same component (the study-area picker, the
 * project map) with no portal locale anywhere in scope, and importing the
 * message catalog into this client component would ship EVERY locale's strings
 * to a resident's phone in order to render one — the exact thing `translator.ts`
 * exists to prevent. So the English lives here, the participant surfaces pass
 * the catalog's words in through `words`, and
 * `src/test/public-engagement-drawing-map-words.test.tsx` fails if the two ever
 * come to say different things.
 *
 * A `{count}` arrives already formatted for the reader's locale.
 */
export type GeometryPickerWords = {
  modeGroupLabel: string;
  /** What kind of widget this is, for a screen reader. Not a question. */
  roleDescription: string;
  modePoint: string;
  modeLine: string;
  modeArea: string;
  finishArea: string;
  undoLast: string;
  startOver: string;
  hintPoint: string;
  hintPointPlaced: string;
  hintLine: string;
  hintLineStarted: string;
  hintLineMany: (count: string) => string;
  hintArea: string;
  hintAreaFew: (count: string) => string;
  hintAreaReady: (count: string) => string;
  hintAreaClosed: (count: string) => string;
  needThreePoints: string;
  vertexLimit: string;
  pointPlaced: string;
  vertexAdded: string;
  areaAlreadyClosed: string;
  startedOver: string;
  undone: string;
  mapLabel: string;
  pointerHelp: string;
  keyboardHelp: string;
  mapUnavailable: string;
};

export const EN_GEOMETRY_PICKER_WORDS: GeometryPickerWords = {
  modeGroupLabel: "What are you marking?",
  roleDescription: "Map you can draw on",
  modePoint: "A spot",
  modeLine: "A street or path",
  modeArea: "An area",
  finishArea: "Finish the area",
  undoLast: "Undo the last point",
  startOver: "Start over",
  hintPoint: "Tap the map to mark the place you mean.",
  hintPointPlaced: "Marked. Tap somewhere else to move it.",
  hintLine: "Tap the map to draw along a street or path.",
  hintLineStarted: "One point so far. Tap again to keep going.",
  hintLineMany: (count) => `${count} points so far. Keep tapping to make the line longer.`,
  hintArea: "Tap the map to start outlining an area.",
  hintAreaFew: (count) => `${count} so far. An area needs at least three points.`,
  hintAreaReady: (count) => `${count} points. Tap the first one again to finish the area.`,
  hintAreaClosed: (count) => `Area finished, with ${count} points.`,
  needThreePoints: "Add at least three points before you finish the area.",
  vertexLimit: "That is as many points as one shape can have.",
  pointPlaced: "Marked. Press Enter again to move it somewhere else.",
  vertexAdded: "Point added to your shape.",
  areaAlreadyClosed: "This area is finished. Start over to draw a different one.",
  startedOver: "Starting over. What you drew has been removed.",
  undone: "Last point removed.",
  mapLabel: "Map of this project. Mark the place you mean.",
  pointerHelp: "Tap or click the map to add a point. Right-click removes the last one.",
  keyboardHelp:
    "Use the arrow keys to move the map and the plus and minus keys to zoom. Press Enter to mark the spot in the middle of the map. Press Backspace to undo the last mark. Press C to finish an area. Press Escape to start over.",
  mapUnavailable:
    "You can still tell us what you think. Answer the questions below, and describe the place in your own words.",
};

function statusCaption(state: DrawState, words: GeometryPickerWords): string {
  const count = String(state.vertices.length);

  if (state.mode === "point") {
    return state.vertices.length === 0 ? words.hintPoint : words.hintPointPlaced;
  }

  if (state.mode === "line") {
    if (state.vertices.length === 0) return words.hintLine;
    if (state.vertices.length === 1) return words.hintLineStarted;
    return words.hintLineMany(count);
  }

  if (state.areaClosed) return words.hintAreaClosed(count);
  if (state.vertices.length === 0) return words.hintArea;
  if (state.vertices.length < 3) return words.hintAreaFew(count);
  return words.hintAreaReady(count);
}

/**
 * Geometry picker for the public engagement submission form. House pattern from
 * src/components/aerial/mission-aoi-editor.tsx — custom handling on a geojson
 * preview source, no external draw library.
 *
 * Pointer: Point = click to place/move; Line = click vertices (double-click adds
 * the final one); Area = click vertices, close by clicking the first vertex, the
 * Close area button, or C. Right-click / Undo removes the last vertex; Escape clears.
 *
 * Keyboard (WCAG 2.1.1 — the map is a single focusable widget): arrow keys pan,
 * +/- zoom, Enter/Space places a vertex at the center crosshair, Backspace removes
 * the last, C closes an area, Escape clears. Changes are announced via a live region.
 */
export function GeometryPickerMap({
  onGeometryChange,
  initialMode = "point",
  allowedModes = ["point", "line", "area"],
  // Neutral by default. This component is rendered on the PUBLIC, embeddable
  // resident-facing engagement portal, so a place-specific default meant
  // residents everywhere opened their agency's map on rural California.
  // Callers that know their geography pass initialCenter; nobody inherits
  // somebody else's town.
  initialCenter = CONTINENTAL_US_CENTER,
  initialZoom = 3.5,
  contextLayers = null,
  words = EN_GEOMETRY_PICKER_WORDS,
  lang,
}: {
  onGeometryChange: (geometry: EngagementGeometry | null) => void;
  /** Starting draw mode (default "point" for the engagement submission form). */
  initialMode?: EngagementDrawMode;
  /** Which mode toggles to show; a single mode hides the selector entirely. */
  allowedModes?: EngagementDrawMode[];
  /** Initial map center [lng, lat]. Defaults to the neutral continental view. */
  initialCenter?: [number, number];
  initialZoom?: number;
  /**
   * Operator-published GIS context — the proposed alignment, the parcels, the
   * existing network — drawn UNDER the sketch, with a legend. Null means the
   * caller has not wired the campaign's layers through yet, which renders
   * exactly as it did before: a basemap and nothing else.
   */
  contextLayers?: ParticipantContextLayerSet | null;
  /**
   * What this map says, in the reader's language. Omitted by the operator
   * console, which has no portal locale; passed by the participant surfaces from
   * the message catalog. See `GeometryPickerWords`.
   */
  words?: GeometryPickerWords;
  /**
   * BCP-47 tag of the words above, stamped on every element that renders one.
   * Omitted with the English defaults, because an element declaring a language
   * it is not written in is the failure the participant i18n seam exists to
   * prevent — and an unstamped element correctly inherits whatever the page
   * already declares.
   */
  lang?: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [draw, setDraw] = useState<DrawState>({ mode: initialMode, vertices: [], areaClosed: false });
  const modeOptions: Array<{ id: EngagementDrawMode; label: string }> = [
    { id: "point", label: words.modePoint },
    { id: "line", label: words.modeLine },
    { id: "area", label: words.modeArea },
  ];
  const visibleModes = modeOptions.filter((option) => allowedModes.includes(option.id));
  const [hint, setHint] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const drawRef = useRef(draw);
  const onGeometryChangeRef = useRef(onGeometryChange);
  const instructionsId = useId();

  useEffect(() => {
    drawRef.current = draw;
    onGeometryChangeRef.current = onGeometryChange;
  }, [draw, onGeometryChange]);

  const announceSeqRef = useRef(0);
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
  // A zero-width space nonce toggles the live-region text on every call, so
  // repeat actions with identical wording (e.g. moving a point twice) still
  // mutate the DOM and get re-announced. U+200B is invisible and not spoken.
  const announce = (message: string) => {
    announceSeqRef.current += 1;
    setAnnouncement(message + ZERO_WIDTH_SPACE.repeat(announceSeqRef.current % 2));
  };

  const applyDraw = (updater: (previous: DrawState) => DrawState) => {
    setDraw((previous) => {
      const next = updater(previous);
      onGeometryChangeRef.current(deriveGeometry(next));
      return next;
    });
  };

  // Shared commit used by both a map click and a keyboard Enter at the crosshair.
  // For clicks, the caller handles the area-close pixel test first.
  const commitVertex = (coord: [number, number]) => {
    setHint(null);
    const { outcome } = appendVertex(drawRef.current, coord);
    if (outcome === "closed-locked") {
      setHint(words.areaAlreadyClosed);
      announce(words.areaAlreadyClosed);
      return;
    }
    if (outcome === "limit") {
      setHint(words.vertexLimit);
      announce(words.vertexLimit);
      return;
    }
    applyDraw((previous) => appendVertex(previous, coord).next);
    announce(outcome === "placed" ? words.pointPlaced : words.vertexAdded);
  };

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current || !MAPBOX_ACCESS_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/dark-v11",
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: false,
    });

    // This picker is mounted inside the project page's Evidence tab, which is
    // not the landing tab: the container is `display: none` while that tab is
    // shut, so the map measures 0x0 and would stay blank once it is opened.
    const stopSizing = keepMapSizedToContainer(map, container);

    // The wrapping <div> is the single keyboard widget; drive pan/zoom from our
    // own handler so there is no duplicate tab stop or double-handled key.
    map.keyboard.disable();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      const canvas = map.getCanvas();
      canvas.setAttribute("tabindex", "-1");
      canvas.setAttribute("aria-hidden", "true");

      map.addSource("engagement-draw", {
        type: "geojson",
        data: buildPreviewFeatureCollection(drawRef.current),
      });
      map.addLayer({
        id: "engagement-draw-fill",
        type: "fill",
        source: "engagement-draw",
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.2 },
        filter: ["==", ["geometry-type"], "Polygon"],
      });
      map.addLayer({
        id: "engagement-draw-line",
        type: "line",
        source: "engagement-draw",
        paint: { "line-color": "#38bdf8", "line-width": 3 },
        filter: ["!=", ["geometry-type"], "Point"],
      });
      map.addLayer({
        id: "engagement-draw-points",
        type: "circle",
        source: "engagement-draw",
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#38bdf8",
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 1.5,
        },
        filter: ["==", ["geometry-type"], "Point"],
      });
    });

    map.on("click", (event) => {
      const current = drawRef.current;
      const next: [number, number] = [
        Number(event.lngLat.lng.toFixed(6)),
        Number(event.lngLat.lat.toFixed(6)),
      ];

      // Area mode: clicking near the first vertex closes the ring (pointer-only
      // shortcut; keyboard users press C).
      if (current.mode === "area" && !current.areaClosed && current.vertices.length >= 3) {
        const firstPixel = map.project(current.vertices[0]);
        const clickPixel = map.project(next);
        const distance = Math.hypot(firstPixel.x - clickPixel.x, firstPixel.y - clickPixel.y);
        if (distance <= CLOSE_RING_PIXEL_TOLERANCE) {
          setHint(null);
          applyDraw((previous) => ({ ...previous, areaClosed: true }));
          announce(words.hintAreaClosed(String(current.vertices.length)));
          return;
        }
      }

      commitVertex(next);
    });

    map.on("dblclick", (event) => {
      event.preventDefault();
      const current = drawRef.current;
      if (current.mode === "area") {
        if (current.vertices.length < 3) {
          setHint(words.needThreePoints);
          return;
        }
        applyDraw((previous) => ({ ...previous, areaClosed: true }));
        announce(words.hintAreaClosed(String(current.vertices.length)));
      }
    });

    // Right-click removes the last vertex (house pattern).
    map.on("contextmenu", (event) => {
      event.preventDefault();
      undo();
    });

    mapRef.current = map;

    return () => {
      stopSizing();
      map.remove();
      mapRef.current = null;
    };
    // Handlers read state via drawRef, so a single registration is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the preview source with draw state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("engagement-draw") as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(buildPreviewFeatureCollection(draw));
  }, [draw]);

  // Paint the operator's context layers UNDER the resident's own sketch.
  // `beforeId` is the first draw layer, so nothing an operator uploads can bury
  // the geometry this map exists to collect. Deferred to `style.load` when the
  // style is not up yet — the same shape as the cartographic backdrop, which
  // re-runs its paint for exactly this reason.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Nothing to do when the caller has not wired the campaign's layers through
    // at all. That is the difference between "this map shows no context" and
    // "this map was told there is none": a null prop means the render site never
    // supplied them, and touching the map's source registry to say so would be
    // work with no observable purpose.
    if (!contextLayers) return;
    const layers = contextLayers.layers;

    const paint = () => {
      const beforeId = map.getLayer("engagement-draw-fill") ? "engagement-draw-fill" : undefined;
      syncContextLayers(map, layers, { beforeId });
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [contextLayers]);

  const setMode = (mode: EngagementDrawMode) => {
    if (mode === draw.mode) return;
    setHint(null);
    applyDraw(() => ({ mode, vertices: [], areaClosed: false }));
    announce(words.startedOver);
  };

  const clear = () => {
    setHint(null);
    if (drawRef.current.vertices.length === 0) return;
    applyDraw((previous) => ({ ...previous, vertices: [], areaClosed: false }));
    announce(words.startedOver);
  };

  const undo = () => {
    setHint(null);
    if (drawRef.current.vertices.length === 0) return;
    applyDraw((previous) => ({
      ...previous,
      vertices: previous.vertices.slice(0, -1),
      areaClosed: false,
    }));
    announce(words.undone);
  };

  const closeArea = () => {
    if (drawRef.current.mode !== "area") return;
    if (drawRef.current.vertices.length < 3) {
      setHint(words.needThreePoints);
      announce(words.needThreePoints);
      return;
    }
    applyDraw((previous) => ({ ...previous, areaClosed: true }));
    announce(words.hintAreaClosed(String(drawRef.current.vertices.length)));
  };

  const handleMapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Only handle keys aimed at the widget itself. Mapbox inserts the zoom
    // controls (real <button>s) into this same container; without this guard a
    // keydown on a focused zoom button bubbles here and would commit a stray
    // vertex while cancelling the button's own activation.
    if (event.target !== event.currentTarget) return;
    const map = mapRef.current;
    if (!map) return;
    switch (event.key) {
      case "ArrowUp":
        map.panBy([0, -KEYBOARD_PAN_STEP_PX]);
        event.preventDefault();
        break;
      case "ArrowDown":
        map.panBy([0, KEYBOARD_PAN_STEP_PX]);
        event.preventDefault();
        break;
      case "ArrowLeft":
        map.panBy([-KEYBOARD_PAN_STEP_PX, 0]);
        event.preventDefault();
        break;
      case "ArrowRight":
        map.panBy([KEYBOARD_PAN_STEP_PX, 0]);
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
        const c = map.getCenter();
        commitVertex([Number(c.lng.toFixed(6)), Number(c.lat.toFixed(6))]);
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

  if (!MAPBOX_ACCESS_TOKEN) {
    /*
      NO MAP. What a member of the public needs here is what they can still do;
      WHY it cannot be drawn is an unset access token, which is an operator's
      problem and belongs nowhere near a resident's screen. The old sentence
      ("Map is unavailable because Mapbox access token is missing.") named a
      product a resident has never heard of and an environment variable they
      cannot set.
    */
    return (
      <div
        data-testid="geometry-picker-map-unavailable"
        lang={lang}
        className="flex h-[200px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground p-4 text-center"
      >
        {words.mapUnavailable}
      </div>
    );
  }

  return (
    <div className="space-y-2" lang={lang}>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex overflow-hidden rounded-lg border border-border"
          role="group"
          aria-label={words.modeGroupLabel}
          hidden={visibleModes.length <= 1}
        >
          {visibleModes.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-pressed={draw.mode === option.id}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                draw.mode === option.id
                  ? "bg-primary/15 text-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {draw.mode === "area" && !draw.areaClosed && draw.vertices.length >= 3 ? (
          <button type="button" onClick={closeArea} className="min-h-11 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {words.finishArea}
          </button>
        ) : null}
        {draw.vertices.length > 0 ? (
          <>
            <button type="button" onClick={undo} className="min-h-11 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {words.undoLast}
            </button>
            <button type="button" onClick={clear} className="min-h-11 text-xs font-medium text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {words.startOver}
            </button>
          </>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border">
        <div
          ref={mapContainerRef}
          role="application"
          tabIndex={0}
          aria-roledescription={words.roleDescription}
          aria-label={words.mapLabel}
          aria-describedby={instructionsId}
          onKeyDown={handleMapKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="h-[260px] w-full bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        {isFocused ? (
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2">
            <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary/80 shadow" />
            <span className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-primary/80" />
            <span className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-primary/80" />
          </div>
        ) : null}
        <div className="absolute bottom-3 left-3 max-w-[55%] rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
          <span className="text-muted-foreground">{hint ?? statusCaption(draw, words)}</span>
        </div>
        <ParticipantMapLegend contextLayers={contextLayers} />
      </div>

      <p id={instructionsId} className="text-xs text-muted-foreground">
        {words.pointerHelp} {words.keyboardHelp}
      </p>

      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
