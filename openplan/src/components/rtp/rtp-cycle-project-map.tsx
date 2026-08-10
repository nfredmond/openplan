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
 * THE NO-TOKEN DEGRADE FETCHES ANYWAY, DELIBERATELY. A deployment with no
 * Mapbox key still holds the facts — how many projects are programmed, how many
 * have no location — and those are what an operator needs in order to know what
 * they are missing. Returning early on a missing token (as
 * `LocationDisplayMap` does, by rendering nothing at all) would make a
 * misconfigured deployment and a plan with no projects look identical.
 *
 * PROPS ARE DELIBERATELY ONE STRING so a server page can mount this without
 * serialising a payload. The layer is fetched client-side for the same reason
 * every other `/api/map-features/*` layer is: the route owns the scoping, the
 * disclosure and the audit entry, and a second server-side read of the same
 * rows would be a second place for those to be got wrong.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Map as MapIcon } from "lucide-react";

import { hasInvalidPublicMapboxToken, resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import {
  RTP_PORTFOLIO_ROLE_OPTIONS,
  formatRtpPortfolioRoleLabel,
  type RtpPortfolioRole,
} from "@/lib/rtp/catalog";
import type { RtpCycleProjectFeatureCollection } from "@/lib/cartographic/rtp-cycle-project-layer";

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

const SOURCE_ID = "rtp-cycle-projects";
const CIRCLE_LAYER_ID = "rtp-cycle-projects-circle";

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

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type LoadState =
  | { status: "loading" }
  | { status: "ready"; collection: RtpCycleProjectFeatureCollection }
  | { status: "failed"; message: string; hint: string | null };

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
    ? `of the ${fetched.toLocaleString()} loaded for this map`
    : `of ${fetched.toLocaleString()}`;

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
      `Showing ${drawn.toLocaleString()} of ${collection.matchedCount.toLocaleString()} programmed ` +
        `projects — the map draws at most ${collection.limit.toLocaleString()}. The rest are not ` +
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
  content.style.cssText = "padding: 4px; color: #0f172a; min-width: 160px;";

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
      : `${MONEY.format(amount)}${basisYear ? ` (${basisYear} dollars)` : ""}`;
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

  const [state, setState] = useState<LoadState>(
    suppliedCollection ? { status: "ready", collection: suppliedCollection } : { status: "loading" }
  );
  const [mapStartupFailed, setMapStartupFailed] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const styleLoadedRef = useRef(false);

  useEffect(() => {
    if (rtpCycleId === null) return;
    const controller = new AbortController();
    setState({ status: "loading" });

    (async () => {
      try {
        const response = await fetch(
          `/api/map-features/rtp-cycle-projects?rtpCycleId=${encodeURIComponent(rtpCycleId)}`,
          { method: "GET", credentials: "same-origin", signal: controller.signal }
        );

        if (!response.ok) {
          // The route's own wording, not a generic sentence: a 503 names the
          // migration an operator has to run, and flattening that into "could
          // not load" is how a one-command fix becomes a support thread.
          const body = (await response.json().catch(() => null)) as ErrorBody | null;
          if (controller.signal.aborted) return;
          setState({
            status: "failed",
            message: asText(body?.error) ?? `The project map could not be loaded (${response.status}).`,
            hint: asText(body?.hint),
          });
          return;
        }

        const payload = (await response.json()) as RtpCycleProjectFeatureCollection;
        if (controller.signal.aborted) return;

        if (!payload || payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
          setState({
            status: "failed",
            message: "The project map could not be loaded.",
            hint: "The map layer answered in a shape this panel does not recognise.",
          });
          return;
        }

        setState({ status: "ready", collection: payload });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setState({
          status: "failed",
          message: "The project map could not be loaded.",
          hint: null,
        });
      }
    })();

    return () => controller.abort();
  }, [rtpCycleId]);

  const collection = state.status === "ready" ? state.collection : null;
  const drawnCount = collection?.features.length ?? 0;
  const hasDrawableProjects = drawnCount > 0;

  // The container only exists once there is something to draw, so a callback
  // ref — not a plain `useRef` read inside an effect — is what guarantees the
  // map is built against a node that is actually mounted.
  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
  }, []);

  useEffect(() => {
    if (!MAPBOX_ACCESS_TOKEN) return;
    if (!collection || collection.features.length === 0) return;
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    // The opening frame is the plan's OWN first project, never a place-shaped
    // constant. `CONTINENTAL_US_CENTER` is reached only when there is nothing
    // to centre on, and the load handler fits to the full extent regardless.
    const first = collection.features[0]?.geometry.coordinates ?? null;

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container,
        style: "mapbox://styles/mapbox/light-v11",
        center: first ?? CONTINENTAL_US_CENTER,
        zoom: first ? SINGLE_POINT_ZOOM : NEUTRAL_ZOOM,
        attributionControl: false,
      });
    } catch {
      // WebGL unavailable, a blocked style request, a browser that cannot run
      // GL at all. A stated failure beats an empty grey rectangle.
      setMapStartupFailed(true);
      return;
    }

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      styleLoadedRef.current = true;
      map.addSource(SOURCE_ID, { type: "geojson", data: collection });
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

      map.on("click", CIRCLE_LAYER_ID, (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        new mapboxgl.Popup({ offset: 12, maxWidth: "280px" })
          .setLngLat(event.lngLat)
          .setDOMContent(buildPopupContent((feature.properties ?? {}) as Record<string, unknown>))
          .addTo(map);
      });
      map.on("mouseenter", CIRCLE_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", CIRCLE_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      const bounds = new mapboxgl.LngLatBounds();
      for (const feature of collection.features) {
        bounds.extend(feature.geometry.coordinates);
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      styleLoadedRef.current = false;
    };
    // Keyed on WHETHER there is anything to draw, not on the payload's
    // identity: re-running this on every re-fetch would tear the map down and
    // rebuild it under the planner. The effect below carries new data in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <p className="module-section-label">Project map</p>
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
          {!MAPBOX_ACCESS_TOKEN ? (
            <div className="rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No map key is configured on this deployment</p>
              <p className="mt-1.5">
                {HAS_UNUSABLE_MAPBOX_TOKEN
                  ? "A Mapbox token is set but is not a public key. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a token beginning with pk. — a secret sk. token is deliberately refused rather than sent to the browser."
                  : "Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a public Mapbox token (it begins with pk.) and this map will draw."}
              </p>
              {drawnCount > 0 ? (
                <p className="mt-1.5">
                  {drawnCount.toLocaleString()} of the{" "}
                  {(drawnCount + (collection?.droppedCount ?? 0)).toLocaleString()} projects loaded for this
                  plan {drawnCount === 1 ? "has" : "have"} a location recorded and would be drawn. Nothing
                  about the plan is missing — only the basemap.
                </p>
              ) : null}
            </div>
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
          ) : !MAPBOX_ACCESS_TOKEN ? null : mapStartupFailed ? (
            <div className="rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">The map could not start in this browser</p>
              <p className="mt-1.5">
                Mapbox needs WebGL. The {drawnCount.toLocaleString()} located{" "}
                {drawnCount === 1 ? "project" : "projects"} in this plan are still listed above.
              </p>
            </div>
          ) : (
            <div
              ref={attachContainer}
              data-testid="rtp-cycle-project-map-canvas"
              className="h-[360px] w-full overflow-hidden rounded-[0.5rem] border border-border/70 bg-muted/10"
            />
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
