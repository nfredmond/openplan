"use client";

/**
 * The projects programmed in one RTP cycle, drawn on a map and coloured by the
 * role each one plays in the portfolio.
 *
 * WHAT THIS PANEL IS FOR. `RtpProgrammeLists` answers "what are we committing
 * to, and when". A board's next question is "where", and a list cannot answer
 * it: geographic equity, corridor coverage and the gap between the north end of
 * a region and the south are visible in seconds on a map and effectively
 * invisible in a table. Colour is by PORTFOLIO ROLE rather than by cost or
 * priority because that is the distinction the regulation draws — a constrained
 * project is a commitment, an illustrative one is not — and a reader who cannot
 * tell them apart is reading the wrong plan.
 *
 * THE HONESTY RULE THIS PANEL EXISTS TO KEEP. A map of 20 projects that draws
 * 14 dots, because 6 have never had a location recorded, asserts that 14 is the
 * programme — and nothing on screen contradicts it. So the route counts what it
 * could not draw (`withoutGeometry`), this panel states it above the map, and
 * an empty map is never presented as an empty plan. The same rule governs a
 * FAILED load: it renders as a failure, never as "this plan has no projects".
 *
 * A deployment without a map engine still fetches the project facts and
 * reports missing locations. A configuration failure is not an empty plan.
 *
 * The staff page passes the cycle id. Its client fetch keeps scoping,
 * disclosure and audit in the existing map-feature route. The public page
 * instead supplies its already-authorized collection, as described below.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapIcon } from "lucide-react";

import { MapUnavailableNotice } from "@/components/ui/map-unavailable-notice";
import { keepMapSizedToContainer } from "@/lib/mapbox/keep-map-sized";
import { hasInvalidPublicMapboxToken, resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { deploymentMapEngine, startMap, styleForEngine, type MapEngine } from "@/lib/maps/map-engine";
import { whenStyleAccepts } from "@/lib/maps/when-style-accepts";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import {
  RTP_PORTFOLIO_ROLE_OPTIONS,
  formatRtpPortfolioRoleLabel,
  type RtpPortfolioRole,
} from "@/lib/rtp/catalog";
import type { RtpCycleProjectFeatureCollection } from "@/lib/cartographic/rtp-cycle-project-layer";
import { formatMoney } from "@/lib/money/format";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

/**
 * A token that was configured and is not usable — an `sk.*` secret, most often.
 * Worth telling apart from "no token at all": the operator who set one needs to
 * hear that the value is wrong, not that the value is missing.
 */
const HAS_UNUSABLE_MAPBOX_TOKEN =
  hasInvalidPublicMapboxToken(
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  ) && !MAPBOX_ACCESS_TOKEN;

// Preserve this panel's refusal of an unusable configured token, including
// when an open style is present. Other callers keep the shared engine policy.
const MAP_ENGINE: MapEngine = HAS_UNUSABLE_MAPBOX_TOKEN
  ? { kind: "none", unusableToken: true }
  : deploymentMapEngine();

const SOURCE_ID = "rtp-cycle-projects";
const CIRCLE_LAYER_ID = "rtp-cycle-projects-circle";
const STYLE_LOAD_WATCHDOG_MS = 15_000;

/**
 * Colour per portfolio role.
 *
 * `satisfies Record<RtpPortfolioRole, string>` is the structural part: a fourth
 * role added to `RTP_PORTFOLIO_ROLE_OPTIONS` fails to compile HERE until it is
 * given a colour, rather than shipping as an unexplained grey dot with no legend
 * entry. The hues follow `rtpPortfolioRoleTone` — green for constrained (a
 * commitment), amber for illustrative (conditional on money that does not
 * exist), slate for candidate (not in the plan yet) — so a project's badge in
 * the project lists and its dot here cannot say different things.
 */
const PORTFOLIO_ROLE_COLOR = {
  constrained: "#22c55e",
  illustrative: "#f59e0b",
  candidate: "#64748b",
} satisfies Record<RtpPortfolioRole, string>;

/**
 * The order a plan presents the roles in — commitments first, then the
 * illustrative list, then what is not in the plan yet. Matches `ROLE_ORDER` in
 * `rtp-programme-lists.tsx`.
 */
const PORTFOLIO_ROLE_LEGEND_ORDER: readonly RtpPortfolioRole[] = [
  "constrained",
  "illustrative",
  "candidate",
];

/**
 * A role outside the catalog's vocabulary. Only reachable if a row is written
 * past the `portfolio_role` CHECK constraint, but a `match` expression needs a
 * fallback and a fallback that borrowed one of the three real colours would
 * draw an unknown role as a confident one.
 */
const UNKNOWN_ROLE_COLOR = "#a1a1aa";

const ROLE_COLOR_EXPRESSION = [
  "match",
  ["get", "portfolioRole"],
  ...PORTFOLIO_ROLE_LEGEND_ORDER.flatMap((role) => [role, PORTFOLIO_ROLE_COLOR[role]]),
  UNKNOWN_ROLE_COLOR,
] as unknown as mapboxgl.ExpressionSpecification;

/** Only reachable when a plan's projects are all at one point. */
const SINGLE_POINT_ZOOM = 11;
/** The whole continent — used only when there is nothing to frame on. */
const NEUTRAL_ZOOM = 3.4;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; collection: RtpCycleProjectFeatureCollection }
  | { status: "failed"; message: string; hint: string | null };

type FetchedResult = {
  rtpCycleId: string;
  result: Exclude<LoadState, { status: "loading" }>;
};

type ErrorBody = { error?: unknown; hint?: unknown };

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The sentences a viewer needs before they trust the dots.
 *
 * A list rather than a paragraph, for the reason `describeMapLayerCoverage`
 * gives: a layer can be truncated AND carrying unlocatable projects at once,
 * and joining the two would let one hide the other.
 */
export function describeRtpCycleProjectMapCoverage(
  collection: RtpCycleProjectFeatureCollection
): string[] {
  const notes: string[] = [];
  const drawn = collection.features.length;
  const fetched = drawn + collection.droppedCount;
  /**
   * The denominator is the rows this response CARRIED, which equals the plan's
   * programme only when nothing was truncated. Left unqualified, "30 of 500
   * projects have no location recorded" reads as the whole plan's total and
   * quietly contradicts the truncation sentence sitting beside it — so when the
   * cap bit, the number says what it is a count of.
   */
  const ofFetched = collection.truncated
    ? `of the ${fetched.toLocaleString("en-US")} loaded for this map`
    : `of ${fetched.toLocaleString("en-US")}`;

  if (collection.withoutGeometry > 0) {
    const n = collection.withoutGeometry;
    notes.push(
      `${n} ${ofFetched} ${fetched === 1 ? "project" : "projects"} ` +
        `${n === 1 ? "has" : "have"} no location recorded, so ${n === 1 ? "it is" : "they are"} ` +
        `missing from the map rather than absent from the plan. Set a location on the project's own ` +
        `page to place ${n === 1 ? "it" : "them"} here.`
    );
  }

  if (collection.withoutReadableProject > 0) {
    const n = collection.withoutReadableProject;
    notes.push(
      `${n} linked ${n === 1 ? "project record" : "project records"} could not be read, so ` +
        `${n === 1 ? "it is" : "they are"} not drawn. That is a database read, not a statement ` +
        `about the plan.`
    );
  }

  if (collection.truncated) {
    notes.push(
      `Showing ${drawn.toLocaleString("en-US")} of ${collection.matchedCount.toLocaleString("en-US")} programmed ` +
        `projects — the map draws at most ${collection.limit.toLocaleString("en-US")}. The rest are not ` +
        `drawn, which is not a finding that they are not in the plan.`
    );
  }

  return notes;
}

/**
 * Popup content is built from DOM nodes, never an HTML string. Project names
 * are user-authored text, and `setHTML` with interpolated content is how an
 * agency's own data becomes an injection vector on their own screen.
 */
function buildPopupContent(properties: Record<string, unknown>): HTMLElement {
  const content = document.createElement("div");
  content.style.cssText = "padding: 4px; color: #0f172a; min-width: 0px; overflow-wrap: anywhere;";

  const title = document.createElement("strong");
  title.style.cssText = "display: block; font-size: 13px;";
  title.textContent = asText(properties.projectName) ?? "Unnamed project";
  content.appendChild(title);

  const role = document.createElement("p");
  role.style.cssText = "margin: 4px 0 0; font-size: 12px;";
  role.textContent = formatRtpPortfolioRoleLabel(asText(properties.portfolioRole));
  content.appendChild(role);

  const cost = document.createElement("p");
  cost.style.cssText = "margin: 2px 0 0; font-size: 12px;";
  // An absent cost is UNPRICED and must never render as $0 — the misreading the
  // whole financial element is built to prevent.
  const amount = typeof properties.estimatedCost === "number" ? properties.estimatedCost : null;
  const basisYear = typeof properties.costBasisYear === "number" ? properties.costBasisYear : null;
  cost.textContent =
    amount === null
      ? "No cost recorded in this plan"
      : `${formatMoney(amount, { precision: "whole" })}${basisYear ? ` (${basisYear} dollars)` : ""}`;
  content.appendChild(cost);

  return content;
}

/**
 * Two ways in, one map.
 *
 * `{ rtpCycleId }` is the members-only cycle page: the component fetches from
 * `/api/map-features/rtp-cycle-projects`, which authorizes by workspace
 * membership. `{ collection }` is the PUBLIC plan share page: the server
 * component there is authorized by the share token, reads with the service
 * role, builds the same payload with the same lib builder, and hands it in —
 * this component never fetches, because the members-only route would answer
 * a resident 401.
 *
 * `audience: "public"` changes COPY only, never data: the empty states stop
 * instructing the reader to go place projects (a resident cannot), and say
 * what is true instead. Everything honest — the coverage notes, the
 * missing-key notice, the "no location recorded" counts — renders for both
 * audiences, because a resident misled by an empty map is the defect the
 * counts exist to prevent.
 */
type RtpCycleProjectMapProps =
  | { rtpCycleId: string; audience?: "operator" }
  | { collection: RtpCycleProjectFeatureCollection; audience: "public" };

export function RtpCycleProjectMap(props: RtpCycleProjectMapProps) {
  const suppliedCollection = "collection" in props ? props.collection : null;
  const rtpCycleId = "rtpCycleId" in props ? props.rtpCycleId : null;
  const isPublic = props.audience === "public";

  const [fetched, setFetched] = useState<FetchedResult | null>(null);
  const state: LoadState = suppliedCollection
    ? { status: "ready", collection: suppliedCollection }
    : fetched !== null && fetched.rtpCycleId === rtpCycleId
      ? fetched.result
      : { status: "loading" };
  const [mapStartupFailed, setMapStartupFailed] = useState(false);
  const [backgroundFailed, setBackgroundFailed] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const styleLoadedRef = useRef(false);
  const latestCollectionRef = useRef<RtpCycleProjectFeatureCollection | null>(null);

  useEffect(() => {
    if (rtpCycleId === null) return;
    const requestedCycleId = rtpCycleId;
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch(
          `/api/map-features/rtp-cycle-projects?rtpCycleId=${encodeURIComponent(requestedCycleId)}`,
          { method: "GET", credentials: "same-origin", signal: controller.signal }
        );

        if (!response.ok) {
          // The route's own wording, not a generic sentence: a 503 names the
          // migration an operator has to run, and flattening that into "could
          // not load" is how a one-command fix becomes a support thread.
          const body = (await response.json().catch(() => null)) as ErrorBody | null;
          if (controller.signal.aborted) return;
          setFetched({
            rtpCycleId: requestedCycleId,
            result: {
              status: "failed",
              message: asText(body?.error) ?? `The project map could not be loaded (${response.status}).`,
              hint: asText(body?.hint),
            },
          });
          return;
        }

        const payload = (await response.json()) as RtpCycleProjectFeatureCollection;
        if (controller.signal.aborted) return;

        if (!payload || payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
          setFetched({
            rtpCycleId: requestedCycleId,
            result: {
              status: "failed",
              message: "The project map could not be loaded.",
              hint: "The map layer answered in a shape this panel does not recognise.",
            },
          });
          return;
        }

        setFetched({ rtpCycleId: requestedCycleId, result: { status: "ready", collection: payload } });
      } catch (error) {
        if (controller.signal.aborted || (error as { name?: string }).name === "AbortError") return;
        setFetched({
          rtpCycleId: requestedCycleId,
          result: {
            status: "failed",
            message: "The project map could not be loaded.",
            hint: null,
          },
        });
      }
    })();

    return () => controller.abort();
  }, [rtpCycleId]);

  const collection = state.status === "ready" ? state.collection : null;
  const drawnCount = collection?.features.length ?? 0;
  const hasDrawableProjects = drawnCount > 0;

  // The engine and style may arrive after newer props or a newer read.
  useEffect(() => {
    latestCollectionRef.current = collection;
  }, [collection]);

  // The container only exists once there is something to draw, so a callback
  // ref — not a plain `useRef` read inside an effect — is what guarantees the
  // map is built against a node that is actually mounted.
  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
  }, []);

  useEffect(() => {
    if (MAP_ENGINE.kind === "none" || !hasDrawableProjects) return;
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    return startMap(MAP_ENGINE, mapboxgl, (gl) => {
      const first = latestCollectionRef.current?.features[0]?.geometry.coordinates ?? null;
      const map = new gl.Map({
        container,
        style: styleForEngine(MAP_ENGINE, "mapbox://styles/mapbox/light-v11") as string,
        center: first ?? CONTINENTAL_US_CENTER,
        zoom: first ? SINGLE_POINT_ZOOM : NEUTRAL_ZOOM,
        attributionControl: false,
      });
      let disposed = false;
      let backgroundLoaded = false;
      let watchdog: number | undefined;
      let popup: mapboxgl.Popup | null = null;
      let stopSizing = () => {};
      let stopWaitingForStyle = () => {};

      const onBackgroundLoaded = () => {
        if (disposed) return;
        backgroundLoaded = true;
        window.clearTimeout(watchdog);
        setBackgroundFailed(false);
      };
      const onMapError = () => {
        if (!disposed && !backgroundLoaded) setBackgroundFailed(true);
      };
      const onProjectClick = (event: mapboxgl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature) return;
        popup?.remove();
        popup = new gl.Popup({ offset: 12, maxWidth: "min(280px, calc(100% - 24px))" })
          .setLngLat(event.lngLat)
          .setDOMContent(buildPopupContent((feature.properties ?? {}) as Record<string, unknown>))
          .addTo(map);
        const popupElement = popup.getElement();
        // A native open handler can close the popup before addTo returns.
        if (!popupElement) return;
        // Controls use z-index 2. Keep the popup close button reachable above them.
        popupElement.style.zIndex = "3";
      };
      const onProjectEnter = () => {
        map.getCanvas().style.cursor = "pointer";
      };
      const onProjectLeave = () => {
        map.getCanvas().style.cursor = "";
      };

      const stop = () => {
        disposed = true;
        window.clearTimeout(watchdog);
        stopWaitingForStyle();
        stopSizing();
        popup?.remove();
        map.off("style.load", onBackgroundLoaded);
        map.off("error", onMapError);
        map.off("click", CIRCLE_LAYER_ID, onProjectClick);
        map.off("mouseenter", CIRCLE_LAYER_ID, onProjectEnter);
        map.off("mouseleave", CIRCLE_LAYER_ID, onProjectLeave);
        map.remove();
        if (mapRef.current === map) {
          mapRef.current = null;
          styleLoadedRef.current = false;
        }
      };

      try {
        mapRef.current = map;
        setMapStartupFailed(false);
        setBackgroundFailed(false);
        // The Projects tab may be hidden when this map is constructed.
        stopSizing = keepMapSizedToContainer(map, container);
        map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new gl.AttributionControl({ compact: true }), "bottom-right");
        map.on("style.load", onBackgroundLoaded);
        map.on("error", onMapError);
        watchdog = window.setTimeout(() => {
          if (!disposed && !backgroundLoaded) setBackgroundFailed(true);
        }, STYLE_LOAD_WATCHDOG_MS);

        stopWaitingForStyle = whenStyleAccepts(map, () => {
          const latest = latestCollectionRef.current;
          if (disposed || !latest) return;
          onBackgroundLoaded();
          map.addSource(SOURCE_ID, { type: "geojson", data: latest });
          map.addLayer({
            id: CIRCLE_LAYER_ID,
            type: "circle",
            source: SOURCE_ID,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 12, 8],
              "circle-color": ROLE_COLOR_EXPRESSION,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#ffffff",
            },
          });
          styleLoadedRef.current = true;
          map.on("click", CIRCLE_LAYER_ID, onProjectClick);
          map.on("mouseenter", CIRCLE_LAYER_ID, onProjectEnter);
          map.on("mouseleave", CIRCLE_LAYER_ID, onProjectLeave);

          const bounds = new gl.LngLatBounds();
          for (const feature of latest.features) bounds.extend(feature.geometry.coordinates);
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
          }
        });
      } catch (error) {
        stop();
        throw error;
      }
      return stop;
    }, () => setMapStartupFailed(true));
    // Payload changes update the existing map without another engine load.
  }, [hasDrawableProjects]);

  // Keeps the drawn dots in step with a payload that arrived after the map was
  // built (a re-fetch, a cycle switch). Separated from creation so new data
  // never costs a teardown.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current || !collection) return;
    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    source?.setData(collection);
  }, [collection]);

  const coverageNotes = collection ? describeRtpCycleProjectMapCoverage(collection) : [];
  const unknownRolePresent = Boolean(
    collection?.features.some(
      (feature) =>
        !PORTFOLIO_ROLE_LEGEND_ORDER.includes(feature.properties.portfolioRole as RtpPortfolioRole)
    )
  );

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <h2 className="module-section-title">Where this plan is spending</h2>
          <p className="module-section-description">
            Every project programmed in this cycle that has a location recorded, coloured by whether
            it is a commitment, on the illustrative list, or still a candidate.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.6rem] border border-border/70 bg-muted/40 text-muted-foreground">
          <MapIcon className="h-5 w-5" />
        </span>
      </div>

      {state.status === "loading" ? (
        <p className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          Loading the projects programmed in this plan…
        </p>
      ) : state.status === "failed" ? (
        <div
          role="alert"
          className="rounded-[0.5rem] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <p className="font-medium">{state.message}</p>
          {state.hint ? <p className="mt-1 text-destructive/90">{state.hint}</p> : null}
          <p className="mt-1 text-destructive/90">
            This is a read failure, not a finding that the plan has no projects.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {coverageNotes.length > 0 ? (
            <ul className="space-y-1.5 rounded-[0.5rem] border border-amber-400/45 bg-amber-400/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-100">
              {coverageNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          {/*
            The missing-key notice is a SIBLING of the map, not a branch of it.
            As a branch it was unreachable whenever there was nothing to draw —
            so a deployment with no key and no placed projects was never told
            its key was missing, and would have read the empty state as the
            whole story. Both facts are true at once, so both are stated.
          */}
          {MAP_ENGINE.kind === "none" ? (
            <MapUnavailableNotice unusableToken={MAP_ENGINE.unusableToken}>
              {drawnCount > 0 ? (
                <p className="mt-1.5">
                  {drawnCount.toLocaleString("en-US")} of the{" "}
                  {(drawnCount + (collection?.droppedCount ?? 0)).toLocaleString("en-US")} projects loaded for this
                  plan {drawnCount === 1 ? "has" : "have"} a location recorded and would be drawn. Nothing
                  about the plan is missing, only the map behind it.
                </p>
              ) : null}
            </MapUnavailableNotice>
          ) : null}

          {drawnCount === 0 ? (
            <div className="rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center">
              <p className="text-sm font-semibold text-foreground">
                {collection && collection.matchedCount > 0
                  ? "No project in this plan has a location recorded yet"
                  : "No projects are in this plan yet"}
              </p>
              {/*
                The second sentence is instructions, and instructions are for
                the person who can follow them. A resident on the public share
                page cannot open a project and set its location, so telling
                them to is copy written for somebody else — the first sentence
                already says everything that is true for them.
              */}
              {isPublic ? null : (
                <p className="mx-auto mt-1.5 max-w-prose text-sm text-muted-foreground">
                  {collection && collection.matchedCount > 0
                    ? "Open a project from the lists above and set its location. Each one you place appears here, coloured by its role in this plan."
                    : "Attach projects to this cycle from a project's own page, then record where each one is. The map fills in as they are placed."}
                </p>
              )}
            </div>
          ) : MAP_ENGINE.kind === "none" ? null : (
            <div className="space-y-3">
              {mapStartupFailed ? (
                <div role="status" className="rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">The map could not start in this browser</p>
                  <p className="mt-1.5">
                    The map library could not load or this browser could not initialize WebGL. The {drawnCount.toLocaleString("en-US")} located{" "}
                    {drawnCount === 1 ? "project" : "projects"} in this plan are still listed above.
                  </p>
                </div>
              ) : backgroundFailed ? (
                <div role="status" className="rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">The map background could not be loaded</p>
                  <p className="mt-1.5">
                    The project data loaded, but the background has not appeared. The project lists,
                    counts and location disclosures are still available. This panel keeps waiting
                    for the background.
                  </p>
                </div>
              ) : null}
              <div
                ref={attachContainer}
                // Keep the Projects tab's deep-link anchor on the mounted canvas.
                id="rtp-cycle-project-map-canvas"
                data-testid="rtp-cycle-project-map-canvas"
                role="region"
                aria-label="Projects programmed in this RTP cycle"
                className="h-[360px] w-full overflow-hidden rounded-[0.5rem] border border-border/70 bg-muted/10"
              />
            </div>
          )}

          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {PORTFOLIO_ROLE_LEGEND_ORDER.map((role) => (
              <li key={role} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-full border border-white/70"
                  style={{ backgroundColor: PORTFOLIO_ROLE_COLOR[role] }}
                />
                {formatRtpPortfolioRoleLabel(role)}
              </li>
            ))}
            {unknownRolePresent ? (
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-full border border-white/70"
                  style={{ backgroundColor: UNKNOWN_ROLE_COLOR }}
                />
                Role not recognised
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </article>
  );
}

/**
 * Exported for the guard that asserts the legend covers the catalog. Keeping it
 * out of the component's props keeps the mount site a single string.
 */
export const RTP_CYCLE_PROJECT_MAP_LEGEND = {
  order: PORTFOLIO_ROLE_LEGEND_ORDER,
  color: PORTFOLIO_ROLE_COLOR,
  unknownColor: UNKNOWN_ROLE_COLOR,
  catalogRoles: RTP_PORTFOLIO_ROLE_OPTIONS.map((option) => option.value),
} as const;
