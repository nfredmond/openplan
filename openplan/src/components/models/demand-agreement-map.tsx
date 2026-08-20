"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import {
  AGREEMENT_VERIFICATION_HEADERS,
  parseDemandAgreementArtifact,
  type DemandAgreementArtifactDecision,
  type DemandAgreementFeatureProperties,
  type DemandAgreementVerification,
  type RenderableDemandAgreementArtifact,
} from "@/lib/models/demand-agreement-artifact";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";

const MAPBOX_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

type Position = [number, number];

function forEachGeometryPosition(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  visit: (position: Position) => void,
): void {
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  for (const line of lines) {
    for (const position of line) visit([position[0], position[1]]);
  }
}

function firstGeometryPosition(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): Position {
  const position = geometry.type === "LineString"
    ? geometry.coordinates[0]
    : geometry.coordinates[0][0];
  return [position[0], position[1]];
}

function artifactBounds(artifact: RenderableDemandAgreementArtifact): mapboxgl.LngLatBounds {
  let minimumLongitude = Number.POSITIVE_INFINITY;
  let maximumLongitude = Number.NEGATIVE_INFINITY;
  let minimumShiftedLongitude = Number.POSITIVE_INFINITY;
  let maximumShiftedLongitude = Number.NEGATIVE_INFINITY;
  let minimumLatitude = Number.POSITIVE_INFINITY;
  let maximumLatitude = Number.NEGATIVE_INFINITY;

  // Keep two longitude frames while streaming the vertices. The narrower one
  // handles study areas on either side of the antimeridian without allocating
  // a statewide-scale coordinate array or spreading it onto the call stack.
  for (const feature of artifact.features) {
    forEachGeometryPosition(feature.geometry, ([longitude, latitude]) => {
      const shiftedLongitude = longitude < 0 ? longitude + 360 : longitude;
      minimumLongitude = Math.min(minimumLongitude, longitude);
      maximumLongitude = Math.max(maximumLongitude, longitude);
      minimumShiftedLongitude = Math.min(minimumShiftedLongitude, shiftedLongitude);
      maximumShiftedLongitude = Math.max(maximumShiftedLongitude, shiftedLongitude);
      minimumLatitude = Math.min(minimumLatitude, latitude);
      maximumLatitude = Math.max(maximumLatitude, latitude);
    });
  }

  let west = minimumLongitude;
  let east = maximumLongitude;
  if (maximumShiftedLongitude - minimumShiftedLongitude < maximumLongitude - minimumLongitude) {
    west = minimumShiftedLongitude;
    east = maximumShiftedLongitude;
    if ((west + east) / 2 > 180) {
      west -= 360;
      east -= 360;
    }
  }
  const bounds = new mapboxgl.LngLatBounds();
  bounds.extend([west, minimumLatitude]);
  bounds.extend([east, maximumLatitude]);
  return bounds;
}

const UUID_PATH =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const AGREEMENT_ROUTE_PATTERN = new RegExp(
  `^/api/models/${UUID_PATH}/runs/${UUID_PATH}/agreement$`,
  "i",
);

function isSameOriginAgreementRoute(value: string): boolean {
  try {
    const parsed = new URL(value, window.location.origin);
    return (
      parsed.origin === window.location.origin &&
      AGREEMENT_ROUTE_PATTERN.test(parsed.pathname) &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

function verificationFromHeaders(headers: Headers): DemandAgreementVerification | undefined {
  const artifactSha256 = headers.get(AGREEMENT_VERIFICATION_HEADERS.artifact);
  const assignmentProfileSha256 = headers.get(
    AGREEMENT_VERIFICATION_HEADERS.assignmentProfile,
  );
  const networkSettingsSha256 = headers.get(AGREEMENT_VERIFICATION_HEADERS.networkSettings);
  const networkStateSha256 = headers.get(AGREEMENT_VERIFICATION_HEADERS.networkState);
  if (
    !artifactSha256 ||
    !assignmentProfileSha256 ||
    !networkSettingsSha256 ||
    !networkStateSha256
  ) {
    return undefined;
  }
  return {
    artifactSha256,
    assignmentProfileSha256,
    networkSettingsSha256,
    networkStateSha256,
  };
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function popupContent(
  properties: DemandAgreementFeatureProperties,
  methods: { first: string; second: string },
): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "op-map-popup";
  root.style.fontFamily = "system-ui";
  root.style.fontSize = "13px";
  root.style.lineHeight = "1.55";

  const title = document.createElement("strong");
  title.textContent = properties.name || properties.link_type || "Road segment";
  root.append(title);

  const values: Array<[string, string]> = [
    [methods.first, formatNumber(properties.first_volume)],
    [methods.second, formatNumber(properties.second_volume)],
    ["Sensitivity", `${properties.agreement} · GEH ${formatNumber(properties.geh)}`],
  ];
  for (const [label, value] of values) {
    root.append(document.createElement("br"), document.createTextNode(`${label}: `));
    const strong = document.createElement("strong");
    strong.textContent = value;
    root.append(strong);
  }
  return root;
}

function accessibleDetail(
  properties: DemandAgreementFeatureProperties,
  methods: { first: string; second: string },
): string {
  const label = properties.name || properties.link_type || "Road segment";
  return `${label}. ${methods.first}: ${formatNumber(properties.first_volume)}. ${methods.second}: ${formatNumber(properties.second_volume)}. Sensitivity: ${properties.agreement}. GEH ${formatNumber(properties.geh)}.`;
}

function eventProperties(value: unknown): DemandAgreementFeatureProperties | null {
  if (typeof value !== "object" || value === null) return null;
  const properties = value as Partial<DemandAgreementFeatureProperties>;
  if (
    typeof properties.first_volume !== "number" ||
    !Number.isFinite(properties.first_volume) ||
    properties.first_volume < 0 ||
    typeof properties.second_volume !== "number" ||
    !Number.isFinite(properties.second_volume) ||
    properties.second_volume < 0 ||
    typeof properties.geh !== "number" ||
    !Number.isFinite(properties.geh) ||
    properties.geh < 0 ||
    typeof properties.carries_meaningful_traffic !== "boolean" ||
    (properties.agreement !== "agree" &&
      properties.agreement !== "marginal" &&
      properties.agreement !== "diverge")
  ) {
    return null;
  }
  return properties as DemandAgreementFeatureProperties;
}

function mapErrorDetail(event: unknown): string | null {
  if (typeof event === "object" && event !== null && "error" in event) {
    const error = (event as { error?: unknown }).error;
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
  }
  return null;
}

type AgreementLoadState =
  | { status: "loading"; geojsonUrl: string }
  | { status: "loaded"; geojsonUrl: string; decision: DemandAgreementArtifactDecision }
  | { status: "failed"; geojsonUrl: string; message: string };

export function DemandAgreementMap({ geojsonUrl }: { geojsonUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cycleFeatureRef = useRef<((direction: 1 | -1) => void) | null>(null);
  const detailId = useId();
  const [activeDetail, setActiveDetail] = useState("");
  const [mapWarning, setMapWarning] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<AgreementLoadState>({
    status: "loading",
    geojsonUrl,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoadState({ status: "loading", geojsonUrl });
    setActiveDetail("");
    setMapWarning(null);
    cycleFeatureRef.current = null;

    const loadArtifact = async () => {
      try {
        if (!isSameOriginAgreementRoute(geojsonUrl)) {
          throw new Error("Agreement map URL is not an authenticated OpenPlan run route");
        }
        const response = await fetch(geojsonUrl, {
          signal: controller.signal,
          credentials: "same-origin",
          redirect: "error",
          headers: { accept: "application/geo+json" },
        });
        if (!response.ok) throw new Error(`Failed to load agreement map: ${response.status}`);
        const verification = verificationFromHeaders(response.headers);
        let payload: unknown;
        try {
          payload = JSON.parse(await response.text());
        } catch {
          throw new Error("Agreement map response is not valid JSON");
        }
        const decision = parseDemandAgreementArtifact(payload, verification);
        if (!cancelled) setLoadState({ status: "loaded", geojsonUrl, decision });
      } catch (caught) {
        if (!cancelled) {
          setLoadState({
            status: "failed",
            geojsonUrl,
            message: caught instanceof Error ? caught.message : "Failed to load agreement map",
          });
        }
      }
    };
    void loadArtifact();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [geojsonUrl]);

  const currentLoadState: AgreementLoadState = useMemo(
    () =>
      loadState.geojsonUrl === geojsonUrl
        ? loadState
        : { status: "loading", geojsonUrl },
    [geojsonUrl, loadState],
  );

  useEffect(() => {
    if (
      currentLoadState.status !== "loaded" ||
      currentLoadState.decision.status !== "render_links" ||
      !containerRef.current ||
      !MAPBOX_TOKEN
    ) {
      return;
    }

    const { artifact, methods } = currentLoadState.decision;
    let disposed = false;
    let mapLoaded = false;
    let map: mapboxgl.Map;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: CONTINENTAL_US_CENTER,
        zoom: 3.4,
        attributionControl: false,
      });
    } catch (caught) {
      setLoadState({
        status: "failed",
        geojsonUrl,
        message: caught instanceof Error ? caught.message : "Failed to construct agreement map",
      });
      return;
    }

    const failMap = (message: string) => {
      if (!disposed) setLoadState({ status: "failed", geojsonUrl, message });
    };
    try {
      map.on("error", (event) => {
        const detail = mapErrorDetail(event);
        if (!mapLoaded) {
          failMap(
            detail
              ? `Agreement map failed to load: ${detail}`
              : "Agreement map failed to load.",
          );
        } else if (!disposed) {
          setMapWarning(
            detail
              ? `Part of the agreement map failed after it opened: ${detail}`
              : "Part of the agreement map failed after it opened.",
          );
        }
      });
      map.addControl(new mapboxgl.NavigationControl(), "top-right");
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
    } catch (caught) {
      map.remove();
      failMap(
        caught instanceof Error ? caught.message : "Failed to set up agreement map controls",
      );
      return;
    }

    const drawMap = () => {
      try {
        map.addSource("demand-agreement", { type: "geojson", data: artifact });
        const bounds = artifactBounds(artifact);
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, duration: 0 });

        map.addLayer({
          id: "demand-agreement-lines",
          type: "line",
          source: "demand-agreement",
          paint: {
            "line-color": [
              "match",
              ["get", "agreement"],
              "agree",
              "#22c55e",
              "marginal",
              "#f59e0b",
              "diverge",
              "#ef4444",
              "#64748b",
            ],
            "line-dasharray": [
              "match",
              ["get", "agreement"],
              "agree",
              ["literal", [1, 0]],
              "marginal",
              ["literal", [3, 1.5]],
              "diverge",
              ["literal", [0.75, 1.5]],
              ["literal", [1, 0]],
            ],
            "line-width": [
              "interpolate",
              ["linear"],
              ["max", ["get", "first_volume"], ["get", "second_volume"]],
              0,
              1,
              10_000,
              4,
              50_000,
              8,
            ],
            "line-opacity": ["case", ["get", "carries_meaningful_traffic"], 0.9, 0.22],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });

        const hoverPopup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: "320px",
        });
        const selectedPopup = new mapboxgl.Popup({
          closeButton: true,
          closeOnClick: false,
          maxWidth: "320px",
        });
        const showFeature = (
          properties: DemandAgreementFeatureProperties,
          longitudeLatitude: mapboxgl.LngLatLike,
          popup: mapboxgl.Popup,
        ) => {
          popup.setLngLat(longitudeLatitude).setDOMContent(popupContent(properties, methods)).addTo(map);
          popup.getElement()?.style.setProperty("z-index", "20");
          setActiveDetail(accessibleDetail(properties, methods));
        };

        map.on("mouseenter", "demand-agreement-lines", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "demand-agreement-lines", () => {
          map.getCanvas().style.cursor = "";
          hoverPopup.remove();
        });
        map.on("mousemove", "demand-agreement-lines", (event) => {
          const properties = eventProperties(event.features?.[0]?.properties);
          if (properties) showFeature(properties, event.lngLat, hoverPopup);
        });
        map.on("click", "demand-agreement-lines", (event) => {
          const properties = eventProperties(event.features?.[0]?.properties);
          if (properties) showFeature(properties, event.lngLat, selectedPopup);
        });

        let keyboardIndex = -1;
        cycleFeatureRef.current = (direction) => {
          if (keyboardIndex < 0) {
            keyboardIndex = direction === 1 ? 0 : artifact.features.length - 1;
          } else {
            keyboardIndex =
              (keyboardIndex + direction + artifact.features.length) % artifact.features.length;
          }
          const feature = artifact.features[keyboardIndex];
          const position = firstGeometryPosition(feature.geometry);
          showFeature(feature.properties, position, selectedPopup);
        };
        mapLoaded = true;
      } catch (caught) {
        failMap(caught instanceof Error ? caught.message : "Failed to draw agreement map");
      }
    };
    try {
      map.once("load", drawMap);
    } catch (caught) {
      failMap(caught instanceof Error ? caught.message : "Failed to register agreement map load");
      return;
    }
    return () => {
      disposed = true;
      cycleFeatureRef.current = null;
      map.remove();
    };
  }, [currentLoadState, geojsonUrl]);

  const handleMapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      cycleFeatureRef.current?.(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      cycleFeatureRef.current?.(-1);
    }
  };

  let content: React.ReactNode;
  if (currentLoadState.status === "loading") {
    content = (
      <div className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-300" role="status">
        Checking whether this run supports an individual-link comparison…
      </div>
    );
  } else if (currentLoadState.status === "failed") {
    content = (
      <div className="flex min-h-40 items-center justify-center p-6 text-sm text-red-300" role="alert">
        {currentLoadState.message}
      </div>
    );
  } else if (currentLoadState.decision.status === "withhold_links") {
    content = (
      <section className="p-6" data-testid="demand-agreement-map-withheld" role="status">
        <h3 className="text-sm font-semibold text-zinc-100">Individual-link map withheld</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
          {currentLoadState.decision.plannerMessage}
        </p>
      </section>
    );
  } else if (!MAPBOX_TOKEN) {
    content = (
      <div className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-300" role="status">
        This OpenPlan installation does not have a public map key configured, so the agreement map cannot be displayed.
      </div>
    );
  } else {
    content = (
      <>
        <div className="absolute left-3 top-3 z-10 rounded-xl border border-white/10 bg-zinc-900/90 px-4 py-3 shadow-lg backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Demand-method sensitivity</p>
          <p className="mt-1 text-xs text-zinc-400">Agreement is concurrence, not evidence that either method is correct.</p>
        </div>
        <ul
          aria-label="Demand-method sensitivity classes"
          className="absolute bottom-4 left-3 z-10 flex flex-wrap gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-zinc-900/90 px-4 py-2 text-xs text-zinc-300"
        >
          <li><span className="mr-1 inline-block w-5 border-t-2 border-solid border-green-500 align-middle" aria-hidden="true" /> Agree</li>
          <li><span className="mr-1 inline-block w-5 border-t-2 border-dashed border-amber-500 align-middle" aria-hidden="true" /> Marginal</li>
          <li><span className="mr-1 inline-block w-5 border-t-2 border-dotted border-red-500 align-middle" aria-hidden="true" /> Diverge</li>
        </ul>
        {mapWarning ? (
          <div className="absolute right-3 top-16 z-10 max-w-sm rounded-lg border border-amber-400/40 bg-zinc-950/95 px-3 py-2 text-xs text-amber-100" role="alert">
            {mapWarning}
          </div>
        ) : null}
        <div
          ref={containerRef}
          aria-describedby={detailId}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
          aria-label="Demand-method link sensitivity map"
          className="h-[520px] w-full"
          onKeyDown={handleMapKeyDown}
          role="region"
          tabIndex={0}
        />
        <p className="sr-only" id={detailId} aria-live="polite" data-testid="demand-agreement-active-detail">
          {activeDetail || "Use the arrow keys to inspect compared road links."}
        </p>
      </>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[0.5rem] border border-border/70 bg-zinc-900" data-testid="demand-agreement-map">
      {content}
    </div>
  );
}
