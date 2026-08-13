"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { SEVERITY_LABELS, type SafetyCrashCollection } from "@/lib/safety/client-types";
import {
  CRASH_SEVERITY_COLOR,
  CRASH_SEVERITY_LEGEND_ORDER,
  CRASH_SEVERITY_UNKNOWN_COLOR,
} from "@/lib/cartographic/crash-severity-palette";
import { isCrashSeverity } from "@/lib/safety/vocabulary";
// The casualty sentence is SHARED with the shell map's inspector. Both used to
// own a copy and both got it wrong the same way — a null count rendered as 0.
import { describeCrashCasualtyLine } from "@/lib/cartographic/crash-feature-to-selection";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import { OperatorDetail } from "@/components/ui/read-failure-notice";

// Both accepted env names, resolved through the shared helper so this map has
// the same token story as every other one. Reading only the newer name meant an
// operator who had set the legacy `NEXT_PUBLIC_MAPBOX_TOKEN` got a working shell
// map and a blank crash map, with nothing saying why.
const MAPBOX_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

/** True when this deployment can draw a map at all. Read by the shell above. */
export const SAFETY_CRASH_MAP_CAN_DRAW = MAPBOX_TOKEN.length > 0;

// Crashes are only queried once a study area exists, so the constructed view
// is strictly the "no study area chosen yet" state — the bbox effect below
// frames every state that has data. A place-shaped default here would have
// shown a California town to a planner working anywhere else.
const INITIAL_ZOOM = 3.4;

const CRASH_SOURCE_ID = "safety-crashes";
const CRASH_HALO_LAYER_ID = "safety-crash-halo";
const CRASH_CORE_LAYER_ID = "safety-crash-core";

const EMPTY_COLLECTION: SafetyCrashCollection = { type: "FeatureCollection", features: [] };

/**
 * Severity paint, BUILT FROM THE SHARED PALETTE rather than from a local copy.
 *
 * This file used to hold its own `match` expression, and the palette module said
 * so in a standing note: the two agreed on the real bands but not on the
 * fallback, because this map had no explicit `pdo` case, so property-damage-only
 * and every unrecognised severity painted the same slate. That mattered the
 * moment a fifth band arrived — `unknown`, for a collision whose casualty counts
 * the source never supplied — because a hand-written expression that has not
 * heard of it paints it as property damage, which is the precise falsehood the
 * band was added to stop. Generating the expression means a band added to the
 * vocabulary cannot be silently mis-painted here.
 */
const SEVERITY_COLOR: mapboxgl.ExpressionSpecification = [
  "match",
  ["get", "severity"],
  ...CRASH_SEVERITY_LEGEND_ORDER.flatMap((severity) => [severity, CRASH_SEVERITY_COLOR[severity]]),
  CRASH_SEVERITY_UNKNOWN_COLOR,
] as mapboxgl.ExpressionSpecification;

type SafetyCrashMapProps = {
  collection: SafetyCrashCollection | null;
  /** [minLon, minLat, maxLon, maxLat] — the study area to frame on load. */
  bbox: [number, number, number, number] | null;
  /**
   * The background to draw under the crashes, resolved from the shared basemap
   * registry by whoever mounts this. Never a style URL written here: twelve call
   * sites once each spelled their own, and the registry exists so a background a
   * planner can switch to is the same background everywhere in the product.
   */
  styleUrl: string;
  /**
   * Called with a feature id when a planner clicks a collision, or null when
   * they click empty map. Optional so the map stays usable without a detail
   * surface to open.
   */
  onSelect?: (crashId: string | null) => void;
};

/**
 * One line of the collision popup, as a real DOM node.
 *
 * ═══ WHY THIS IS NOT AN HTML STRING ANY MORE ═══
 *
 * The popup was assembled with `setHTML` and an inline `font-size:12px` and
 * NOTHING ELSE — no colour, no background. Mapbox's own stylesheet paints
 * `.mapboxgl-popup-content` white and leaves the text colour to inherit from the
 * page, so in a dark palette the popup was near-white type on a white card: the
 * one surface on this page a planner could not read, and only in dark mode.
 *
 * The fix is to opt into `.op-map-popup`, the themed popup family already
 * defined in `cartographic.css` — `--panel-solid` behind, `--ink`/`--ink-2` in
 * front, in every palette, both modes — which the transit-stop popup uses and
 * which `cartographic.css` explicitly invites the other five popup builders to
 * adopt. That family is class-based, and class-based styling wants real
 * elements, so the popup is built with `createElement` and `textContent`. Two
 * things fall out of that and both are improvements: nothing here can be an
 * unescaped interpolation (there is no HTML parsing left to abuse), and the
 * popup is now a DOM node a test can read.
 */
function popupLine(className: string, text: string): HTMLElement {
  const node = document.createElement("div");
  node.className = className;
  node.textContent = text;
  return node;
}

export function SafetyCrashMap({ collection, bbox, styleUrl, onSelect }: SafetyCrashMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // The map is built once, so the click handlers close over a ref rather than
  // over the prop — otherwise selecting a collision would call whichever
  // callback existed at mount forever.
  const onSelectRef = useRef(onSelect);
  // Same reason, for the data: the paint below runs on EVERY `style.load`,
  // including the ones a background switch causes minutes after mount, and it
  // must draw the crashes on screen now rather than the ones that were on screen
  // when the map was built.
  const collectionRef = useRef(collection);
  // Which style the map has been TOLD to load. Compared before calling
  // `setStyle`, so a re-render that changes nothing does not throw the style
  // away and repaint.
  const styleUrlRef = useRef(styleUrl);

  // BOTH REFS ARE SYNCED IN AN EFFECT, not during render. Assigning to
  // `ref.current` while rendering is a real React hazard (a discarded render
  // leaves the ref pointing at data that never reached the screen) and
  // `react-hooks/refs` fails the build for it. Declared FIRST so it runs before
  // the effect below, which reads what it just wrote.
  useEffect(() => {
    onSelectRef.current = onSelect;
    collectionRef.current = collection;
  }, [onSelect, collection]);

  // Create the map once; data updates are handled by the effect below so a
  // filter change never tears down and rebuilds the map.
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleUrlRef.current,
      center: CONTINENTAL_US_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "280px" });

    /**
     * Put the crash layers back on the map.
     *
     * BOUND TO `style.load`, NOT `load`, AND THAT IS THE WHOLE POINT. A style
     * swap — which is what the background picker does — throws away every source
     * and layer the app added. `load` fires once, at mount; a map wired to it
     * loses its crashes the first time somebody switches to satellite and never
     * gets them back, with no error anywhere. `style.load` fires for the initial
     * style AND for each later one, so this runs again on each swap.
     *
     * (The sentence above is worded around `safety-claim-boundaries.test.ts`,
     * which reads this file as prose and refuses a coverage claim — "every …
     * crashes" within a few words is the shape it forbids. It was right to fire:
     * a guard that reads comments cannot tell a claim about a Mapbox event from
     * a claim about a road, and the cheap fix is to say it differently.)
     */
    const paint = () => {
      if (!map.getSource(CRASH_SOURCE_ID)) {
        map.addSource(CRASH_SOURCE_ID, {
          type: "geojson",
          data: collectionRef.current ?? EMPTY_COLLECTION,
        });
      }

      // Soft halo beneath the core dot, so dense clusters read as intensity
      // without the individual points disappearing.
      if (!map.getLayer(CRASH_HALO_LAYER_ID)) {
        map.addLayer({
          id: CRASH_HALO_LAYER_ID,
          type: "circle",
          source: CRASH_SOURCE_ID,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 11, 12],
            "circle-color": SEVERITY_COLOR,
            "circle-opacity": 0.18,
            "circle-blur": 0.8,
          },
        });
      }

      if (!map.getLayer(CRASH_CORE_LAYER_ID)) {
        map.addLayer({
          id: CRASH_CORE_LAYER_ID,
          type: "circle",
          source: CRASH_SOURCE_ID,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 11, 7],
            "circle-color": SEVERITY_COLOR,
            "circle-stroke-color": "#fff7ed",
            "circle-stroke-width": 1,
            "circle-opacity": 0.95,
          },
        });
      }

      const source = map.getSource(CRASH_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      source?.setData(collectionRef.current ?? EMPTY_COLLECTION);
    };

    map.on("style.load", paint);

    map.on("mouseenter", CRASH_CORE_LAYER_ID, (event) => {
      map.getCanvas().style.cursor = "pointer";
      const feature = event.features?.[0];
      if (!feature) return;
      const props = feature.properties ?? {};
      const date = typeof props.collisionDate === "string" ? props.collisionDate : "Date not reported";
      // The band's own label, not a de-underscored raw value. `unknown` reads
      // "Not classified — no casualty count reported", which is a sentence
      // that has to survive into the popup: "unknown" alone would be taken for
      // an unknown SEVERITY rather than for an absent report.
      const severity = isCrashSeverity(props.severity)
        ? SEVERITY_LABELS[props.severity]
        : "Severity not recognised";
      const modes = [
        props.pedestrianInvolved ? "pedestrian" : null,
        props.bicyclistInvolved ? "bicyclist" : null,
        props.motorcyclistInvolved ? "motorcyclist" : null,
      ].filter(Boolean);

      const root = document.createElement("div");
      root.className = "op-map-popup";
      root.dataset.testid = "safety-crash-popup";
      root.append(popupLine("op-map-popup__title", severity));
      root.append(popupLine("op-map-popup__kicker", date));
      root.append(
        popupLine(
          "op-map-popup__line",
          describeCrashCasualtyLine(props.killedCount, props.injuredCount)
        )
      );
      if (modes.length) {
        root.append(popupLine("op-map-popup__line", `Involved: ${modes.join(", ")}`));
      }
      // The popup is a summary of ONE point and cannot say which fields the
      // source omitted — that needs the coverage declaration, which is in the
      // sidebar. So it says where the rest is instead of implying there is no
      // more.
      root.append(popupLine("op-map-popup__note", "Click for the full record."));

      popup.setLngLat(event.lngLat).setDOMContent(root).addTo(map);
    });

    // Clicking a collision opens its full record; clicking empty map closes
    // it. The popup is a summary and cannot state which fields the source
    // omitted — that distinction needs the acquisition's coverage declaration,
    // which lives on the page, not on the point.
    map.on("click", CRASH_CORE_LAYER_ID, (event) => {
      const feature = event.features?.[0];
      const id = feature?.properties?.id;
      if (typeof id === "string") onSelectRef.current?.(id);
    });

    map.on("click", (event) => {
      const hits = map.queryRenderedFeatures(event.point, { layers: [CRASH_CORE_LAYER_ID] });
      if (hits.length === 0) onSelectRef.current?.(null);
    });

    map.on("mouseleave", CRASH_CORE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Intentionally mount-only: data, framing and the background are applied by
    // the effects below, so re-renders never recreate the map. This used to
    // need an `exhaustive-deps` suppression because the setup read `collection`
    // directly; it reads the ref now, so there is nothing left to suppress —
    // and a stale disable directive is itself a lint error here.
  }, []);

  // THE BACKGROUND CHANGED. `setStyle` discards the crash source and layers;
  // the `style.load` handler above puts them back. Nothing here re-adds them,
  // because a second copy of that logic is how the two drift apart.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleUrlRef.current === styleUrl) return;
    styleUrlRef.current = styleUrl;
    map.setStyle(styleUrl);
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // `isStyleLoaded` rather than a "have I painted yet" flag of our own: during
    // a background switch the source genuinely does not exist, and asking the
    // map is the only answer that stays true across a style swap. The pending
    // data is not lost — `paint` reads the ref when the new style lands.
    if (!map.isStyleLoaded()) return;
    const source = map.getSource(CRASH_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    source?.setData(collection ?? EMPTY_COLLECTION);
  }, [collection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bbox) return;
    map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 40, duration: 0 });
  }, [bbox]);

  if (!MAPBOX_TOKEN) {
    return (
      // What is off, what still works, and who can turn it on — before any
      // variable name a planner has no way to set.
      <div
        className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
        data-testid="safety-crash-map-unavailable"
      >
        <p className="font-medium text-foreground">The crash map can&apos;t be drawn</p>
        <p>
          This OpenPlan deployment has no map key configured. The crash counts and rates on this
          page are unaffected — only the map is missing. Whoever runs this deployment can add the
          key.
        </p>
        <OperatorDetail className="text-left">
          <p>
            Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a public Mapbox token (it begins with pk.) and
            rebuild.
          </p>
        </OperatorDetail>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" data-testid="safety-crash-map" />;
}
