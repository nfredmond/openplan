"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { aerialMissionFeatureToSelection } from "@/lib/cartographic/mission-feature-to-selection";
import { projectFeatureToSelection } from "@/lib/cartographic/project-feature-to-selection";
import { projectAreaFeatureToSelection } from "@/lib/cartographic/project-area-feature-to-selection";
import { crashFeatureToSelection } from "@/lib/cartographic/crash-feature-to-selection";
import {
  CRASH_SEVERITY_COLOR,
  CRASH_SEVERITY_UNKNOWN_COLOR,
} from "@/lib/cartographic/crash-severity-palette";
// Shared with the legend, so the dot on the map and the swatch in the key cannot
// describe the same stop differently. See the palette module's own header.
import { TRANSIT_SERVICE_TIER_COLOR } from "@/lib/cartographic/transit-service-tier-palette";
import { corridorFeatureToSelection } from "@/lib/cartographic/corridor-feature-to-selection";
import { rtpCycleFeatureToSelection } from "@/lib/cartographic/rtp-cycle-feature-to-selection";
import { tractFeatureToSelection } from "@/lib/cartographic/tract-feature-to-selection";
import { engagementItemFeatureToSelection } from "@/lib/cartographic/engagement-item-feature-to-selection";
import { workspaceGisFeatureToSelection } from "@/lib/cartographic/workspace-gis-feature-to-selection";
import { fitInstructionFromGeometry } from "@/lib/cartographic/geometry-bbox";
import { hasInvalidPublicMapboxToken, resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import type { HomeMapView } from "@/lib/workspaces/home-geography";
import { useTheme } from "@/components/theme-provider";

import {
  useCartographicLayers,
  useCartographicLayerStatus,
  useCartographicMapControls,
  useCartographicSelection,
  useWorkspaceMapLayers,
  type LayerKey,
} from "./cartographic-context";
import { fetchWorkspaceGisFeatures, fetchWorkspaceGisLayers } from "@/lib/workspace-gis/client";
import type {
  WorkspaceGisFeatureCollection,
  WorkspaceGisLayerListing,
} from "@/lib/workspace-gis/types";
import {
  describeMapLayerCoverage,
  describeMapLayerFailure,
  type MapLayerDisclosure,
} from "@/lib/cartographic/layer-disclosure";
import {
  BASIC_SERVICE_HEADWAY_MINUTES,
  FREQUENT_SERVICE_HEADWAY_MINUTES,
} from "@/lib/gtfs/service-levels";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);
const HAS_INVALID_PUBLIC_MAPBOX_TOKEN = hasInvalidPublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
) && !MAPBOX_ACCESS_TOKEN;

// Routes that own their own map and should suppress the shell backdrop.
const MAP_OWNING_ROUTES = ["/explore"];

// Opening framing, in strict order of how much the map actually knows:
//
//   1. the workspace's own features — applied by the initial-fit effect below,
//      once a payload carrying geometry arrives;
//   2. the workspace's stated home geography — `homeMapView`, resolved on the
//      server so this client component never guesses or fetches it;
//   3. the shared neutral continental view.
//
// Only (3) is a constant, and it is deliberately not a place. A place-shaped
// default meant every workspace, anywhere on earth, opened on one small
// California town.
const NEUTRAL_CENTER = CONTINENTAL_US_CENTER;
const NEUTRAL_ZOOM = 3.4;

const AOI_SOURCE_ID = "cartographic-aerial-mission-aois";
const AOI_FILL_LAYER_ID = "cartographic-aerial-mission-aois-fill";
const AOI_OUTLINE_LAYER_ID = "cartographic-aerial-mission-aois-outline";

const PROJECTS_SOURCE_ID = "cartographic-projects";
const PROJECTS_CIRCLE_LAYER_ID = "cartographic-projects-circle";

// The AREA a project studies, which is a separate record from its site marker
// above (see `src/lib/projects/project-place.ts`). Separate source so
// feature-state highlight cannot cross-contaminate between the two.
const PROJECT_AREAS_SOURCE_ID = "cartographic-project-areas";
const PROJECT_AREAS_FILL_LAYER_ID = "cartographic-project-areas-fill";
const PROJECT_AREAS_OUTLINE_LAYER_ID = "cartographic-project-areas-outline";

const CRASHES_SOURCE_ID = "cartographic-crashes";
const CRASHES_HALO_LAYER_ID = "cartographic-crashes-halo";
const CRASHES_CORE_LAYER_ID = "cartographic-crashes-core";

const CORRIDORS_SOURCE_ID = "cartographic-corridors";
const CORRIDORS_LINE_LAYER_ID = "cartographic-corridors-line";

const RTP_CYCLES_SOURCE_ID = "cartographic-rtp-cycles";
const RTP_CYCLES_CIRCLE_LAYER_ID = "cartographic-rtp-cycles-circle";

const CENSUS_TRACTS_SOURCE_ID = "cartographic-census-tracts";
const CENSUS_TRACTS_FILL_LAYER_ID = "cartographic-census-tracts-fill";
const CENSUS_TRACTS_OUTLINE_LAYER_ID = "cartographic-census-tracts-outline";

const ENGAGEMENT_SOURCE_ID = "cartographic-engagement-items";
const ENGAGEMENT_CIRCLE_LAYER_ID = "cartographic-engagement-items-layer";

// Transit stops from the workspace's own ingested feeds. THE ONLY CLUSTERED
// SOURCE on this backdrop, and the reason is the row count rather than taste: a
// mid-size agency contributes a few thousand stops on one weekday, which drawn
// as individual dots is a solid band along every corridor that hides both the
// pattern and everything underneath it. Clustering renders the same payload as
// a few dozen circles at regional zoom and resolves to individual stops as the
// planner comes in, which is the zoom at which one stop is a thing you can
// reason about.
const TRANSIT_SOURCE_ID = "cartographic-transit-stops";
const TRANSIT_CLUSTER_LAYER_ID = "cartographic-transit-stops-cluster";
const TRANSIT_CLUSTER_COUNT_LAYER_ID = "cartographic-transit-stops-cluster-count";
const TRANSIT_STOPS_CIRCLE_LAYER_ID = "cartographic-transit-stops-circle";

// ── The workspace's own uploaded GIS layers ─────────────────────────────────
//
// Unlike every layer above, these are not a fixed set: their ids are rows in
// `workspace_gis_layers`, so their Mapbox source and layer ids are DERIVED from
// the layer id rather than declared. One source per layer, and up to four
// drawing layers over it — fill, outline, circle, label — because one uploaded
// shapefile can legitimately hold polygons, lines and points at once and Mapbox
// needs a layer per geometry class.
const workspaceGisSourceId = (layerId: string) => `cartographic-workspace-gis-${layerId}`;
const workspaceGisFillLayerId = (layerId: string) => `${workspaceGisSourceId(layerId)}-fill`;
const workspaceGisLineLayerId = (layerId: string) => `${workspaceGisSourceId(layerId)}-line`;
const workspaceGisCircleLayerId = (layerId: string) => `${workspaceGisSourceId(layerId)}-circle`;
const workspaceGisLabelLayerId = (layerId: string) => `${workspaceGisSourceId(layerId)}-label`;

/**
 * Every drawing layer one uploaded layer owns, BOTTOM TO TOP.
 *
 * The order is the z-order within a layer and it is not arbitrary: a polygon
 * fill under its own outline under any points, so a layer holding all three
 * reads as one thing rather than as points buried under their own fill. The
 * label rides on top of its own geometry.
 */
function workspaceGisDrawingLayerIds(layerId: string): string[] {
  return [
    workspaceGisFillLayerId(layerId),
    workspaceGisLineLayerId(layerId),
    workspaceGisCircleLayerId(layerId),
    workspaceGisLabelLayerId(layerId),
  ];
}

/** The clickable ones. A label is not a click target; the shape under it is. */
function workspaceGisClickableLayerIds(layerId: string): string[] {
  return [
    workspaceGisFillLayerId(layerId),
    workspaceGisLineLayerId(layerId),
    workspaceGisCircleLayerId(layerId),
  ];
}

const KNOWN_SOURCES = [
  AOI_SOURCE_ID,
  PROJECTS_SOURCE_ID,
  PROJECT_AREAS_SOURCE_ID,
  CORRIDORS_SOURCE_ID,
  RTP_CYCLES_SOURCE_ID,
  CENSUS_TRACTS_SOURCE_ID,
  ENGAGEMENT_SOURCE_ID,
  CRASHES_SOURCE_ID,
] as const;

const FEATURE_LAYERS = [
  AOI_FILL_LAYER_ID,
  PROJECTS_CIRCLE_LAYER_ID,
  PROJECT_AREAS_FILL_LAYER_ID,
  CORRIDORS_LINE_LAYER_ID,
  RTP_CYCLES_CIRCLE_LAYER_ID,
  CENSUS_TRACTS_FILL_LAYER_ID,
  ENGAGEMENT_CIRCLE_LAYER_ID,
  CRASHES_CORE_LAYER_ID,
  // Both transit layers are here so a click on either counts as a feature hit.
  // Without the cluster id, clicking a cluster would fall through to
  // `onBackgroundClick` and clear whatever the planner had selected — the
  // selection would vanish on the way to zooming in.
  TRANSIT_CLUSTER_LAYER_ID,
  TRANSIT_STOPS_CIRCLE_LAYER_ID,
] as const;

/**
 * The layer the workspace's own uploaded layers sit immediately BELOW.
 *
 * WHY BENEATH EVERYTHING, ALWAYS. An agency's uploaded layers are reference —
 * parcels, city limits, a bike network — and the workspace's own records are the
 * subject. A parcel fabric drawn over the project pins would bury the work the
 * planner came to look at and, worse, would eat the clicks: `FEATURE_LAYERS`
 * decides what counts as a feature hit, and a polygon covering the whole
 * viewport wins every one of them. Under the tract choropleth for the same
 * reason — that layer is an analytic finding and this one is a basemap the
 * agency happens to own.
 *
 * Returns `undefined` when nothing is drawn yet, which Mapbox reads as "on top"
 * — correct, because with no feature layers present there is nothing to be
 * buried under.
 */
function workspaceGisAnchorLayerId(map: mapboxgl.Map): string | undefined {
  if (map.getLayer(CENSUS_TRACTS_FILL_LAYER_ID)) return CENSUS_TRACTS_FILL_LAYER_ID;
  return FEATURE_LAYERS.find((id) => map.getLayer(id));
}

/** Round a viewport to four decimals (~11 m) so a one-pixel pan is not a refetch. */
function viewportKeyFor(bbox: [number, number, number, number]): string {
  return bbox.map((value) => value.toFixed(4)).join(",");
}

/**
 * Frequent-service tiers as a Mapbox `match`, built from the shared thresholds.
 *
 * NEITHER THRESHOLD IS A LITERAL HERE, and that is a product rule rather than a
 * style preference: 15 and 30 minutes are the reporting VOCABULARY the whole
 * transit lane is built on (see `service-levels.ts`), and a jurisdiction with a
 * 20-minute test must be able to change one constant rather than hunt for a
 * number typed into a paint expression. The route derives `serviceTierMinutes`
 * from the same two constants, so the dot and the popup can never disagree
 * about which tier a stop met.
 *
 * The fallback colour is for a stop with NO derivable peak headway — a place
 * with a single daily trip has no interval — and it is deliberately muted
 * rather than the wider tier's colour, so "not frequent enough to tier" never
 * borrows the meaning of "meets the 30-minute tier".
 */
const TRANSIT_FREQUENT_COLOR = TRANSIT_SERVICE_TIER_COLOR.frequent;
const TRANSIT_BASIC_COLOR = TRANSIT_SERVICE_TIER_COLOR.basic;
const TRANSIT_UNTIERED_COLOR = TRANSIT_SERVICE_TIER_COLOR.untiered;
const TRANSIT_TIER_PAINT: mapboxgl.ExpressionSpecification = [
  "match",
  ["get", "serviceTierMinutes"],
  FREQUENT_SERVICE_HEADWAY_MINUTES,
  TRANSIT_FREQUENT_COLOR,
  BASIC_SERVICE_HEADWAY_MINUTES,
  TRANSIT_BASIC_COLOR,
  TRANSIT_UNTIERED_COLOR,
];

// Crash severity as a Mapbox `match`. Built from the shared palette rather than
// written out, so the legend swatches and these dots cannot describe the same
// severity differently. The trailing fallback is the unknown-severity colour: a
// severity outside the KABCO vocabulary must not borrow a real one's meaning.
const CRASH_SEVERITY_PAINT: mapboxgl.ExpressionSpecification = [
  "match",
  ["get", "severity"],
  "fatal",
  CRASH_SEVERITY_COLOR.fatal,
  "severe_injury",
  CRASH_SEVERITY_COLOR.severe_injury,
  "injury",
  CRASH_SEVERITY_COLOR.injury,
  "pdo",
  CRASH_SEVERITY_COLOR.pdo,
  CRASH_SEVERITY_UNKNOWN_COLOR,
];

/**
 * The two crash circle paints, hoisted out of their `addLayer` calls so a test
 * can run Mapbox's own style validator over them.
 *
 * WHY THEY ARE UP HERE RATHER THAN INLINE. A layer whose paint the style spec
 * rejects throws out of `addLayer` and is simply never added. The map keeps
 * working and nothing on screen reports a missing layer, so the failure is
 * visible only in the browser console — which is how the core circles came to
 * be rejected while the halo beneath them was accepted: crashes drew as blurred
 * halos with no dot in the middle, and hover and selection on that layer did
 * nothing at all. An empty layer and an absent one look identical, and crash
 * data is California-only today, so most workspaces could never have noticed.
 *
 * Inline expressions cannot be reached from a test. These can — see
 * `cartographic-crash-layer-paint.test.ts`, which validates them exactly as the
 * browser does and turns a console message into a failed build.
 */
export const CRASH_HALO_CIRCLE_PAINT = {
  "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 11, 12],
  "circle-color": CRASH_SEVERITY_PAINT,
  "circle-opacity": 0.18,
  "circle-blur": 0.8,
} satisfies mapboxgl.CircleLayerSpecification["paint"];

export const CRASH_CORE_CIRCLE_PAINT = {
  /*
    `interpolate` on ["zoom"] MUST be the top-level expression.

    This read `case(selected, 9, interpolate(zoom, …))`, putting the zoom
    expression inside a branch, which Mapbox rejects: "zoom expression may only
    be used as input to a top-level step or interpolate".

    Inverting the nesting preserves the behaviour exactly — selected stays 9 at
    every zoom, unselected still runs 3.5 → 7 across zoom 5 → 11. Interpolate
    output stops may be data-driven, so `feature-state` is legal here.
  */
  "circle-radius": [
    "interpolate",
    ["linear"],
    ["zoom"],
    5,
    ["case", ["boolean", ["feature-state", "selected"], false], 9, 3.5],
    11,
    ["case", ["boolean", ["feature-state", "selected"], false], 9, 7],
  ],
  "circle-color": CRASH_SEVERITY_PAINT,
  "circle-stroke-color": "#ffffff",
  "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 1],
  "circle-opacity": 0.95,
} satisfies mapboxgl.CircleLayerSpecification["paint"];

// The project-area fill. Same green family as the project marker but far lighter
// — the area is context for the work, not a competing figure.
const PROJECT_AREA_COLOR = "#4f8a7b";

// Sequential teal ramp for the equity choropleth, painted on
// `pctZeroVehicle`. Bins mirror the legend entry so the visual key lines
// up with what the backdrop draws. The `null` fallthrough renders tracts
// with missing data in a neutral mid-gray rather than the lightest bin,
// so viewers can distinguish "no data" from "<5% zero-vehicle".
const EQUITY_RAMP_NULL = "#cccccc";
const EQUITY_RAMP_COLORS = {
  lowest: "#d4e8e5", // <5%
  low: "#8fb5b0", //   5–10%
  mid: "#4d847c", //   10–15%
  high: "#1f544c", // >15%
} as const;

// LOS-driven color ramp. Lower grades degrade from calm blue-slate toward
// congestion red, matching planning convention. `null` falls through to the
// neutral base, keeping the ramp layer-agnostic for corridors without LOS.
const CORRIDOR_LOS_COLOR: Record<string, string> = {
  A: "#4a7a9e",
  B: "#4a7a9e",
  C: "#c8962f",
  D: "#c8962f",
  E: "#b45239",
  F: "#8a2e24",
};
const CORRIDOR_BASE_COLOR = "#4a7a9e";

// Fit-to-selection viewport targets. maxZoom keeps a tiny feature (single
// small polygon, short corridor) from punching past neighborhood scale on
// fitBounds; padding leaves room for UI chrome on the sides. POINT_ZOOM
// lands projects at neighborhood scale so the marker has spatial context.
const FIT_PADDING = 64;
const FIT_MAX_ZOOM = 15;
const FIT_DURATION_MS = 400;
const POINT_FIT_ZOOM = 14;

// The one-shot framing of the whole workspace stops at regional scale — a
// workspace holding a single point should read as "here is your region", not
// as a street-level zoom onto one marker.
const INITIAL_FIT_MAX_ZOOM = 11;

export type MissionAoiFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string;
    geometry: unknown;
    properties: Record<string, unknown>;
  }>;
};

type ProjectFeatureCollection = MissionAoiFeatureCollection;
type ProjectAreaFeatureCollection = MissionAoiFeatureCollection;
type CrashFeatureCollection = MissionAoiFeatureCollection;
type CorridorFeatureCollection = MissionAoiFeatureCollection;
type RtpCycleFeatureCollection = MissionAoiFeatureCollection;
type CensusTractFeatureCollection = MissionAoiFeatureCollection;
type EngagementFeatureCollection = MissionAoiFeatureCollection;
type TransitStopFeatureCollection = MissionAoiFeatureCollection;

function routeOwnsMap(pathname: string): boolean {
  return MAP_OWNING_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * The only thing the bounds walker needs from a bounds object. Typing against
 * this instead of `mapboxgl.LngLatBounds` keeps the walker testable without a
 * live Mapbox instance — the framing rules are the part worth pinning, and they
 * are pure.
 */
export type BoundsAccumulator = {
  extend(position: [number, number]): unknown;
};

/**
 * Fold every feature of a collection into a bounds accumulator, reusing the
 * same geometry rules as fit-to-selection so the initial framing and a later
 * click agree on what a feature's extent is. Geometries the shared helper
 * rejects are skipped rather than guessed at.
 */
export function extendBoundsWithCollection(
  bounds: BoundsAccumulator,
  collection: MissionAoiFeatureCollection | null,
): void {
  for (const feature of collection?.features ?? []) {
    const instruction = fitInstructionFromGeometry(feature.geometry);
    if (!instruction) continue;
    if (instruction.kind === "center") {
      bounds.extend(instruction.center);
      continue;
    }
    bounds.extend(instruction.bbox[0]);
    bounds.extend(instruction.bbox[1]);
  }
}

export function CartographicMapBackdrop({
  homeMapView = null,
  workspaceId = null,
}: {
  /**
   * The camera implied by the workspace's home geography, derived on the server
   * by `deriveHomeMapView` and handed down by `CartographicShell`. `null` means
   * the workspace has not stated a geography — the neutral view, never a
   * substituted place.
   */
  homeMapView?: HomeMapView | null;
  /**
   * The workspace these layers were fetched for. In the dep arrays below so a
   * workspace switch — a soft RSC refresh that does not remount this tree —
   * refetches instead of leaving the previous workspace's features, and its
   * coverage notes, under the new workspace's map.
   */
  workspaceId?: string | null;
} = {}) {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const { registerLayerStatus } = useCartographicLayerStatus();

  /**
   * Record what a layer's fetch established, so the layers panel can say it.
   * A FAILED fetch is registered too: a layer that could not load and a layer
   * that is genuinely empty look identical on a map, and only one of them is a
   * finding about the workspace.
   */
  const noteLayer = useCallback(
    (key: LayerKey, disclosure: MapLayerDisclosure | null, failed: boolean) => {
      registerLayerStatus(key, {
        workspaceId,
        failed,
        notes: failed
          ? [describeMapLayerFailure(key)]
          : disclosure
            ? describeMapLayerCoverage(key, disclosure)
            : [],
      });
    },
    [registerLayerStatus, workspaceId],
  );

  /** Coerce the disclosure off an untyped payload; null when absent (older body). */
  const disclosureOf = useCallback((payload: unknown): MapLayerDisclosure | null => {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const returnedCount = num(p.returnedCount);
    const matchedCount = num(p.matchedCount);
    const droppedCount = num(p.droppedCount);
    const limit = num(p.limit);
    if (returnedCount === null || matchedCount === null || droppedCount === null || limit === null) {
      return null;
    }
    return { returnedCount, matchedCount, droppedCount, limit, truncated: Boolean(p.truncated) };
  }, []);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [themeMounted, setThemeMounted] = useState(false);
  const [ready, setReady] = useState(() => !MAPBOX_ACCESS_TOKEN);
  const [aois, setAois] = useState<MissionAoiFeatureCollection | null>(null);
  const [projectMarkers, setProjectMarkers] = useState<ProjectFeatureCollection | null>(null);
  const [projectAreas, setProjectAreas] = useState<ProjectAreaFeatureCollection | null>(null);
  const [crashes, setCrashes] = useState<CrashFeatureCollection | null>(null);
  const [corridors, setCorridors] = useState<CorridorFeatureCollection | null>(null);
  const [rtpCycles, setRtpCycles] = useState<RtpCycleFeatureCollection | null>(null);
  const [censusTracts, setCensusTracts] =
    useState<CensusTractFeatureCollection | null>(null);
  const [engagementItems, setEngagementItems] =
    useState<EngagementFeatureCollection | null>(null);
  const [transitStops, setTransitStops] = useState<TransitStopFeatureCollection | null>(null);
  /** One viewport read per visible workspace layer, keyed by layer id. */
  const [workspaceCollections, setWorkspaceCollections] = useState<
    Record<string, WorkspaceGisFeatureCollection>
  >({});
  /**
   * The current map window, rounded, as the trigger for workspace-layer reads.
   *
   * THE ONLY VIEWPORT-DRIVEN FETCH ON THIS BACKDROP. Every other layer is a
   * whole-workspace read capped at a few hundred rows; a parcel fabric is a
   * quarter of a million polygons and there is no "whole layer" to ask for. So
   * this one asks for what is on screen and asks again when the screen moves.
   */
  const [viewportBbox, setViewportBbox] = useState<[number, number, number, number] | null>(null);
  const {
    workspaceLayers,
    registerWorkspaceLayers,
    registerWorkspaceCatalogError,
    workspaceLayerVisibility,
    registerWorkspaceLayerStatus,
  } = useWorkspaceMapLayers();
  const { layers } = useCartographicLayers();
  const { registerMapControls } = useCartographicMapControls();
  const { selection, setSelection, clearSelection } = useCartographicSelection();
  const router = useRouter();
  const navigateRef = useRef<(path: string) => void>((path) => router.push(path));
  const backdropTheme = themeMounted && resolvedTheme === "dark" ? "dark" : "light";
  // Guards for the one-shot initial framing. Both reset when the map instance
  // is rebuilt (a theme swap tears it down), so a re-created backdrop re-frames
  // the workspace instead of being stranded at the neutral continental view.
  const didInitialFitRef = useRef(false);
  const userMovedMapRef = useRef(false);
  /**
   * The workspace whose transit stops have already been requested.
   *
   * Transit is the one layer whose fetch is gated on its toggle, so this ref is
   * what keeps ticking the box off and on again from re-pulling a payload that
   * is an order of magnitude wider than any other layer's. It holds a WORKSPACE
   * ID rather than a boolean so a workspace switch — a soft RSC refresh that
   * does not remount this tree — refetches instead of leaving the previous
   * workspace's agency drawn under the new workspace's map.
   */
  const transitFetchedForRef = useRef<string | null | undefined>(undefined);
  /**
   * The viewport each workspace layer was last successfully read for.
   *
   * Keyed by layer id, valued by the rounded viewport key, so panning back to a
   * window already drawn costs nothing and a failed read is simply absent —
   * which makes the next attempt a retry rather than a permanent blank layer
   * behind a ticked checkbox.
   */
  const workspaceLayerViewportRef = useRef<Map<string, string>>(new Map());
  /** The workspace whose layer catalog has been requested. */
  const workspaceCatalogFetchedForRef = useRef<string | null | undefined>(undefined);
  /**
   * The live catalog and visibility, readable from a Mapbox event handler.
   *
   * Click handlers are registered once and must not be torn down and rebuilt on
   * every catalog change — re-registering a handler mid-gesture drops the click.
   * So the handler reads through refs, exactly as `navigateRef` does for the
   * router.
   */
  const workspaceLayersRef = useRef<WorkspaceGisLayerListing[]>(workspaceLayers);
  const workspaceVisibilityRef = useRef<Record<string, boolean>>(workspaceLayerVisibility);
  // The map is constructed once (and rebuilt only on a theme swap), so the
  // opening camera has to be read through a ref rather than a dependency —
  // putting `homeMapView` in the effect's dep list would tear the map down and
  // rebuild it on every parent re-render, since the prop is a fresh object.
  const homeMapViewRef = useRef(homeMapView);

  useEffect(() => {
    homeMapViewRef.current = homeMapView;
  }, [homeMapView]);

  useEffect(() => {
    // One-shot mount gate so stored theme state can resolve without a hydration style diff.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeMounted(true);
  }, []);

  useEffect(() => {
    navigateRef.current = (path: string) => router.push(path);
  }, [router]);

  const suppressed = routeOwnsMap(pathname);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (suppressed) {
      document.body.dataset.mapOwner = "true";
    } else {
      delete document.body.dataset.mapOwner;
    }
    return () => {
      if (typeof document !== "undefined") {
        delete document.body.dataset.mapOwner;
      }
    };
  }, [suppressed, workspaceId, noteLayer, disclosureOf, registerLayerStatus]);

  useEffect(() => {
    if (suppressed) return;
    if (!themeMounted) return;
    if (!containerRef.current || mapRef.current) return;
    if (!MAPBOX_ACCESS_TOKEN) {
      // Fall back to the CSS parchment gradient (no Mapbox) — still visually on-brand.
      // This also prevents a mis-scoped secret token (`sk.*`) in a public env var from
      // crashing route-level smoke tests or being handed to Mapbox GL.
      if (HAS_INVALID_PUBLIC_MAPBOX_TOKEN) {
        console.warn("[cartographic-backdrop] NEXT_PUBLIC_MAPBOX token must use a public pk.* token; rendering CSS fallback.");
      }
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const styleUrl =
      backdropTheme === "dark"
        ? "mapbox://styles/mapbox/dark-v11"
        : "mapbox://styles/mapbox/light-v11";

    const home = homeMapViewRef.current;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: home?.center ?? NEUTRAL_CENTER,
      zoom: home?.zoom ?? NEUTRAL_ZOOM,
      attributionControl: false,
      logoPosition: "bottom-left",
      interactive: true,
      pitchWithRotate: false,
      dragRotate: false,
    });

    didInitialFitRef.current = false;
    userMovedMapRef.current = false;
    // Only user-driven moves carry an originalEvent; programmatic fits do not.
    // Once the planner has moved the map themselves, no late-arriving payload
    // is allowed to yank the viewport out from under them.
    map.on("movestart", (event) => {
      if ((event as { originalEvent?: unknown }).originalEvent) {
        userMovedMapRef.current = true;
      }
    });

    map.on("load", () => setReady(true));
    mapRef.current = map;
    registerMapControls({
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
    });

    return () => {
      registerMapControls(null);
      map.remove();
      mapRef.current = null;
    };
  }, [suppressed, themeMounted, backdropTheme, registerMapControls]);

  // Swap style when theme toggles (without tearing down the whole map).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const styleUrl =
      backdropTheme === "dark"
        ? "mapbox://styles/mapbox/dark-v11"
        : "mapbox://styles/mapbox/light-v11";
    try {
      map.setStyle(styleUrl);
    } catch {
      // no-op: style change is best-effort
    }
  }, [backdropTheme]);

  // Fetch workspace-scoped mission AOIs once the shell is mounted. Unauthenticated
  // calls return 401 and we silently render no polygons — the public landing
  // routes don't use the shell backdrop, so this only fires for signed-in sessions.
  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/aerial-missions", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          // 401 on anon sessions is expected and silent; surface everything
          // else so a real 500 is at least greppable in devtools.
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] aerial-missions fetch returned ${response.status}`,
            );
            noteLayer("aerial", null, true);
          }
          return;
        }
        const payload = (await response.json()) as MissionAoiFeatureCollection;
        if (cancelled) return;
        if (payload && payload.type === "FeatureCollection") {
          setAois(payload);
          noteLayer("aerial", disclosureOf(payload), false);
        }
      } catch (error) {
        // Network failures render as "no AOIs" rather than surfacing error UI,
        // but still log so the failure is diagnosable.
        console.warn("[cartographic-backdrop] aerial-missions fetch failed", error);
        noteLayer("aerial", null, true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppressed, workspaceId, noteLayer, disclosureOf, registerLayerStatus]);

  // Same pattern for project markers — separate source + circle layer.
  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/projects", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] projects fetch returned ${response.status}`,
            );
            noteLayer("projects", null, true);
          }
          return;
        }
        const payload = (await response.json()) as ProjectFeatureCollection;
        if (cancelled) return;
        if (payload && payload.type === "FeatureCollection") {
          setProjectMarkers(payload);
          noteLayer("projects", disclosureOf(payload), false);
        }
      } catch (error) {
        console.warn("[cartographic-backdrop] projects fetch failed", error);
        noteLayer("projects", null, true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppressed, workspaceId, noteLayer, disclosureOf, registerLayerStatus]);

  // Same pattern for the AREA each project studies — a separate layer from the
  // markers above, because a project's site and the area its work covers are
  // separate records (20260728000009) and a planner wants to see both.
  useEffect(() => {
    if (suppressed) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/map-features/project-areas", {
          method: "GET",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] project-areas fetch returned ${response.status}`,
            );
            noteLayer("projectAreas", null, true);
          }
          return;
        }
        const payload = (await response.json()) as ProjectAreaFeatureCollection;
        if (controller.signal.aborted) return;
        if (payload && payload.type === "FeatureCollection") {
          setProjectAreas(payload);
          noteLayer("projectAreas", disclosureOf(payload), false);
        }
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        console.warn("[cartographic-backdrop] project-areas fetch failed", error);
        noteLayer("projectAreas", null, true);
      }
    })();
    return () => controller.abort();
  }, [suppressed, workspaceId, noteLayer, disclosureOf, registerLayerStatus]);

  // Acquired crashes. Fetched even while the layer is toggled OFF, deliberately:
  // the response carries the coverage sentences that tell a planner in an
  // uncovered state that crash data is unavailable to them, and gating the fetch
  // on the toggle would hide that behind a checkbox nobody has a reason to tick.
  //
  // The route builds its own sentences — it is the only layer whose emptiness
  // has four different meanings (no covering source, nothing acquired, an
  // acquisition that failed, an acquisition that genuinely found nothing) — so
  // they are used verbatim rather than re-derived from counts here.
  useEffect(() => {
    if (suppressed) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/map-features/crashes", {
          method: "GET",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(`[cartographic-backdrop] crashes fetch returned ${response.status}`);
            noteLayer("crashes", null, true);
          }
          return;
        }
        const payload = (await response.json()) as CrashFeatureCollection;
        if (controller.signal.aborted) return;
        if (payload && payload.type === "FeatureCollection") {
          setCrashes(payload);
          const coverageNotes = (payload as unknown as { coverageNotes?: unknown }).coverageNotes;
          registerLayerStatus("crashes", {
            workspaceId,
            failed: false,
            notes: Array.isArray(coverageNotes)
              ? coverageNotes.filter((note): note is string => typeof note === "string")
              : [],
          });
        }
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        console.warn("[cartographic-backdrop] crashes fetch failed", error);
        noteLayer("crashes", null, true);
      }
    })();
    return () => controller.abort();
  }, [suppressed, workspaceId, noteLayer, disclosureOf, registerLayerStatus]);

  /**
   * Transit stops from the workspace's own ingested feeds.
   *
   * THE ONE LAYER WHOSE FETCH IS GATED ON ITS TOGGLE, and the divergence from
   * the crash layer directly above is deliberate rather than an oversight.
   *
   * Crashes are fetched while switched off because their coverage sentences
   * answer a question a planner has BEFORE they would ever tick the box — does
   * any crash source cover my area at all — and hiding that behind a checkbox
   * would hide it from everyone who never ticks it. Transit's sentences answer
   * a different question, and it is one nobody asks until they have asked for
   * the layer: which of MY OWN ingested feeds is in use, and why is this corner
   * empty. The planner reaches those notes by the same action that reveals
   * them.
   *
   * What makes the gate worth it is payload. This layer's cap is ten times the
   * shared one, because the row count of a real agency demanded it, so pulling
   * it on every navigation for a layer that is off by default would be the
   * heaviest thing the shell does and the least often looked at. Once pulled it
   * is KEPT — the ref above means toggling off and on again costs nothing.
   *
   * The route's coverage notes are used verbatim rather than re-derived from
   * counts here, exactly as for crashes: an empty transit layer has four
   * different meanings (no feed of this workspace's own, no completed ingest in
   * use, nothing derived for the day being drawn, or genuinely no stops), and
   * only the route knows which one it is looking at.
   */
  useEffect(() => {
    if (suppressed) return;
    if (!layers.transit) return;
    if (transitFetchedForRef.current === workspaceId) return;
    transitFetchedForRef.current = workspaceId;

    const controller = new AbortController();
    // ONLY A COMPLETED READ MAY BE REMEMBERED. A 500, a network failure, or an
    // abort that fires because the planner toggled the layer off mid-flight
    // must all clear the ref — otherwise the very next attempt would see a
    // matching workspace id, skip the fetch, and leave the layer permanently
    // empty behind a checkbox that looks switched on. That is precisely the
    // shipped-invisible shape: a capability that works, gated behind a state
    // machine that can only be observed by trying it twice.
    let settled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/transit", {
          method: "GET",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(`[cartographic-backdrop] transit fetch returned ${response.status}`);
            noteLayer("transit", null, true);
          }
          return;
        }
        const payload = (await response.json()) as TransitStopFeatureCollection;
        if (controller.signal.aborted) return;
        if (payload && payload.type === "FeatureCollection") {
          settled = true;
          setTransitStops(payload);
          const coverageNotes = (payload as unknown as { coverageNotes?: unknown }).coverageNotes;
          registerLayerStatus("transit", {
            workspaceId,
            failed: false,
            notes: Array.isArray(coverageNotes)
              ? coverageNotes.filter((note): note is string => typeof note === "string")
              : [],
          });
        }
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        console.warn("[cartographic-backdrop] transit fetch failed", error);
        noteLayer("transit", null, true);
      }
    })();
    return () => {
      controller.abort();
      if (!settled) transitFetchedForRef.current = undefined;
    };
  }, [suppressed, layers.transit, workspaceId, noteLayer, registerLayerStatus]);

  useEffect(() => {
    workspaceLayersRef.current = workspaceLayers;
  }, [workspaceLayers]);

  useEffect(() => {
    workspaceVisibilityRef.current = workspaceLayerVisibility;
  }, [workspaceLayerVisibility]);

  /**
   * The workspace's layer CATALOG — names, styles, versions, caveats.
   *
   * FETCHED WHETHER OR NOT ANY LAYER IS SWITCHED ON, unlike the geometry below,
   * and for the crash layer's reason: the catalog is what the panel lists, and a
   * planner has to be able to SEE that their agency has four uploaded layers
   * before they can decide to tick one. Gating the list on the toggles would
   * make the layers discoverable only by someone who already knew they existed.
   *
   * It is small — a few rows of metadata — so pulling it on every navigation
   * costs nothing like the geometry does.
   */
  useEffect(() => {
    if (suppressed) return;
    if (workspaceCatalogFetchedForRef.current === workspaceId) return;
    workspaceCatalogFetchedForRef.current = workspaceId;

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
          console.warn("[cartographic-backdrop] workspace GIS catalog fetch failed", error);
        }
        registerWorkspaceCatalogError(
          "OpenPlan could not load this workspace's map layers, so this list is not a statement that there " +
            "are none. Reload the page to try again."
        );
      }
    })();

    return () => {
      cancelled = true;
      // Only a completed read may be remembered — otherwise a navigation during
      // the request leaves the catalog permanently unfetched for this workspace.
      if (!settled) workspaceCatalogFetchedForRef.current = undefined;
    };
  }, [suppressed, workspaceId, registerWorkspaceLayers, registerWorkspaceCatalogError]);

  /**
   * Track the map window, so the workspace layers can be read for it.
   *
   * `moveend` rather than `move`: a read per animation frame during a pan would
   * be hundreds of requests for one gesture. The rounded key in
   * `viewportKeyFor` then absorbs the sub-metre jitter that a settled map still
   * produces.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const record = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      setViewportBbox([
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ]);
    };

    record();
    map.on("moveend", record);
    return () => {
      map.off("moveend", record);
    };
  }, [ready]);

  /**
   * Read each VISIBLE workspace layer for the current window.
   *
   * GATED ON THE TOGGLE, like transit and for a stronger version of its reason:
   * this payload is unbounded in a way no other layer's is, and a workspace with
   * six uploaded layers switched on would otherwise fire six requests on every
   * pan. Off means not asked for.
   *
   * A LAYER THAT IS TOO DENSE IS STILL STORED, with no features and its true
   * count. That is the whole design: the response says "214,391 shapes in this
   * view", the map draws none of them, and the panel says so. Dropping the
   * response on the floor would leave the planner looking at an empty layer with
   * a ticked box and no explanation, which is the exact reading — "there is
   * nothing here" — that this layer refuses to allow.
   */
  useEffect(() => {
    if (suppressed) return;
    if (!viewportBbox) return;
    const key = viewportKeyFor(viewportBbox);

    const visible = workspaceLayers.filter(
      (listing) => workspaceLayerVisibility[listing.layer.id] === true
    );
    if (visible.length === 0) return;

    const controller = new AbortController();
    for (const listing of visible) {
      const layerId = listing.layer.id;
      if (workspaceLayerViewportRef.current.get(layerId) === key) continue;

      (async () => {
        try {
          const collection = await fetchWorkspaceGisFeatures(layerId, viewportBbox);
          if (controller.signal.aborted) return;
          workspaceLayerViewportRef.current.set(layerId, key);
          setWorkspaceCollections((prev) => ({ ...prev, [layerId]: collection }));
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
            console.warn(`[cartographic-backdrop] workspace layer ${layerId} read failed`, error);
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
    suppressed,
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
    workspaceLayerViewportRef.current = new Map();
    // Clearing on a workspace CHANGE is the point, and it has to be a state
    // write: the drawn geometry lives in state, and leaving it would put one
    // agency's parcels under another agency's map until the new workspace's
    // layers happened to be read. A cascading render on a workspace switch is a
    // fair price for that not happening.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkspaceCollections({});
  }, [workspaceId]);

  // Same pattern for project corridors — separate source + line layer.
  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/corridors", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] corridors fetch returned ${response.status}`,
            );
            noteLayer("corridors", null, true);
          }
          return;
        }
        const payload = (await response.json()) as CorridorFeatureCollection;
        if (cancelled) return;
        if (payload && payload.type === "FeatureCollection") {
          setCorridors(payload);
          noteLayer("corridors", disclosureOf(payload), false);
        }
      } catch (error) {
        console.warn("[cartographic-backdrop] corridors fetch failed", error);
        noteLayer("corridors", null, true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppressed, workspaceId, noteLayer, disclosureOf, registerLayerStatus]);

  // Same pattern for RTP cycle pins — separate source + circle layer.
  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/rtp-cycles", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] rtp-cycles fetch returned ${response.status}`,
            );
            noteLayer("rtp", null, true);
          }
          return;
        }
        const payload = (await response.json()) as RtpCycleFeatureCollection;
        if (cancelled) return;
        if (payload && payload.type === "FeatureCollection") {
          setRtpCycles(payload);
          noteLayer("rtp", disclosureOf(payload), false);
        }
      } catch (error) {
        console.warn("[cartographic-backdrop] rtp-cycles fetch failed", error);
        noteLayer("rtp", null, true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppressed, workspaceId, noteLayer, disclosureOf, registerLayerStatus]);

  // Same pattern for the equity census-tract choropleth. Public data, but the
  // route still auth-gates so public landing pages don't pull a large GeoJSON
  // payload for no reason. Payload is workspace-agnostic.
  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/census-tracts", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] census-tracts fetch returned ${response.status}`,
            );
            noteLayer("equity", null, true);
          }
          return;
        }
        const payload = (await response.json()) as CensusTractFeatureCollection;
        if (cancelled) return;
        if (payload && payload.type === "FeatureCollection") {
          setCensusTracts(payload);
          // The census-tracts route builds its own scope-aware sentences (it is
          // the only layer whose scope is a geography rather than the
          // workspace), so they are used verbatim instead of re-derived here.
          const coverageNotes = (payload as unknown as { coverageNotes?: unknown }).coverageNotes;
          registerLayerStatus("equity", {
            workspaceId,
            failed: false,
            notes: Array.isArray(coverageNotes) ? coverageNotes.filter((n): n is string => typeof n === "string") : [],
          });
        }
      } catch (error) {
        console.warn("[cartographic-backdrop] census-tracts fetch failed", error);
        noteLayer("equity", null, true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppressed, workspaceId, noteLayer, disclosureOf, registerLayerStatus]);

  // Same pattern for approved engagement items — low-weight point features
  // that keep community input visible without overwhelming heavier geometry.
  useEffect(() => {
    if (suppressed) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/map-features/engagement", {
          method: "GET",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] engagement fetch returned ${response.status}`,
            );
            noteLayer("engagement", null, true);
          }
          return;
        }
        const payload = (await response.json()) as EngagementFeatureCollection;
        if (controller.signal.aborted) return;
        if (payload && payload.type === "FeatureCollection") {
          setEngagementItems(payload);
          noteLayer("engagement", disclosureOf(payload), false);
        }
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        console.warn("[cartographic-backdrop] engagement fetch failed", error);
        noteLayer("engagement", null, true);
      }
    })();
    return () => controller.abort();
  }, [suppressed, workspaceId, noteLayer, disclosureOf, registerLayerStatus]);

  // Paint AOIs onto the map once both the map and the data are ready.
  // Runs again on style swaps because setStyle() wipes the source/layer registry.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !aois) return;

    const paint = () => {
      if (!map.getSource(AOI_SOURCE_ID)) {
        map.addSource(AOI_SOURCE_ID, {
          type: "geojson",
          data: aois as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(AOI_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(aois as unknown as GeoJSON.FeatureCollection);
      }

      if (!map.getLayer(AOI_FILL_LAYER_ID)) {
        map.addLayer({
          id: AOI_FILL_LAYER_ID,
          type: "fill",
          source: AOI_SOURCE_ID,
          paint: {
            "fill-color": "#e45635",
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              0.36,
              0.18,
            ],
          },
        });
      }

      if (!map.getLayer(AOI_OUTLINE_LAYER_ID)) {
        map.addLayer({
          id: AOI_OUTLINE_LAYER_ID,
          type: "line",
          source: AOI_SOURCE_ID,
          paint: {
            "line-color": "#e45635",
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              2.75,
              1.75,
            ],
            "line-opacity": 0.85,
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, aois, resolvedTheme]);

  // Paint project markers onto the map once both the map and the data are
  // ready. Separate source from AOIs so feature-state highlight never
  // cross-contaminates between the two layers. Accent-2 green (#1f6b5e)
  // keeps projects visually distinct from AOI orange.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !projectMarkers) return;

    const paint = () => {
      if (!map.getSource(PROJECTS_SOURCE_ID)) {
        map.addSource(PROJECTS_SOURCE_ID, {
          type: "geojson",
          data: projectMarkers as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(PROJECTS_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(projectMarkers as unknown as GeoJSON.FeatureCollection);
      }

      if (!map.getLayer(PROJECTS_CIRCLE_LAYER_ID)) {
        map.addLayer({
          id: PROJECTS_CIRCLE_LAYER_ID,
          type: "circle",
          source: PROJECTS_SOURCE_ID,
          paint: {
            "circle-color": "#1f6b5e",
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              9,
              6,
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              2.5,
              1.5,
            ],
            "circle-opacity": 0.92,
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, projectMarkers, resolvedTheme]);

  // Paint the area each project studies. Deliberately drawn as a soft fill with
  // a dashed outline: it is the ground the work stands on, and a solid boundary
  // at full weight would compete with the corridors and AOIs that ARE the work.
  //
  // The dash also carries meaning — a stored place boundary is the source's
  // generalized outline, not a surveyed limit, and a crisp solid line would
  // imply a precision the geometry does not have.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !projectAreas) return;

    const paint = () => {
      if (!map.getSource(PROJECT_AREAS_SOURCE_ID)) {
        map.addSource(PROJECT_AREAS_SOURCE_ID, {
          type: "geojson",
          data: projectAreas as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(PROJECT_AREAS_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(projectAreas as unknown as GeoJSON.FeatureCollection);
      }

      // Keep areas beneath every point/line layer so a marker, corridor or pin
      // inside the area still picks up first on a click.
      const beforeId = [
        AOI_FILL_LAYER_ID,
        PROJECTS_CIRCLE_LAYER_ID,
        CORRIDORS_LINE_LAYER_ID,
        RTP_CYCLES_CIRCLE_LAYER_ID,
        ENGAGEMENT_CIRCLE_LAYER_ID,
        CRASHES_CORE_LAYER_ID,
      ].find((id) => map.getLayer(id));

      if (!map.getLayer(PROJECT_AREAS_FILL_LAYER_ID)) {
        map.addLayer(
          {
            id: PROJECT_AREAS_FILL_LAYER_ID,
            type: "fill",
            source: PROJECT_AREAS_SOURCE_ID,
            paint: {
              "fill-color": PROJECT_AREA_COLOR,
              "fill-opacity": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                0.3,
                0.12,
              ],
            },
          },
          beforeId,
        );
      }

      if (!map.getLayer(PROJECT_AREAS_OUTLINE_LAYER_ID)) {
        map.addLayer(
          {
            id: PROJECT_AREAS_OUTLINE_LAYER_ID,
            type: "line",
            source: PROJECT_AREAS_SOURCE_ID,
            paint: {
              "line-color": PROJECT_AREA_COLOR,
              "line-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                3,
                1.5,
              ],
              "line-opacity": 0.85,
              "line-dasharray": [2, 1.5],
            },
          },
          beforeId,
        );
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, projectAreas, resolvedTheme]);

  // Paint corridor LineStrings onto the map once both the map and the data
  // are ready. Separate source from AOIs + projects so feature-state
  // highlight never cross-contaminates. LOS-driven color via a match
  // expression on feature properties — lines without LOS fall back to the
  // calm base color so un-graded corridors still render legibly.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !corridors) return;

    const paint = () => {
      if (!map.getSource(CORRIDORS_SOURCE_ID)) {
        map.addSource(CORRIDORS_SOURCE_ID, {
          type: "geojson",
          data: corridors as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(CORRIDORS_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(corridors as unknown as GeoJSON.FeatureCollection);
      }

      if (!map.getLayer(CORRIDORS_LINE_LAYER_ID)) {
        map.addLayer({
          id: CORRIDORS_LINE_LAYER_ID,
          type: "line",
          source: CORRIDORS_SOURCE_ID,
          paint: {
            "line-color": [
              "match",
              ["get", "losGrade"],
              "A",
              CORRIDOR_LOS_COLOR.A,
              "B",
              CORRIDOR_LOS_COLOR.B,
              "C",
              CORRIDOR_LOS_COLOR.C,
              "D",
              CORRIDOR_LOS_COLOR.D,
              "E",
              CORRIDOR_LOS_COLOR.E,
              "F",
              CORRIDOR_LOS_COLOR.F,
              CORRIDOR_BASE_COLOR,
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              5,
              3,
            ],
            "line-opacity": 0.9,
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, corridors, resolvedTheme]);

  // Paint RTP cycle pins onto the map once both the map and the data are
  // ready. Distinct muted-plum color separates the single-cycle pin from
  // project markers (green) and AOIs (orange). Larger base radius because
  // RTP cycles are typically 1-2 per workspace — the pin should read as a
  // prominent anchor, not a minor dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !rtpCycles) return;

    const paint = () => {
      if (!map.getSource(RTP_CYCLES_SOURCE_ID)) {
        map.addSource(RTP_CYCLES_SOURCE_ID, {
          type: "geojson",
          data: rtpCycles as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(RTP_CYCLES_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(rtpCycles as unknown as GeoJSON.FeatureCollection);
      }

      if (!map.getLayer(RTP_CYCLES_CIRCLE_LAYER_ID)) {
        map.addLayer({
          id: RTP_CYCLES_CIRCLE_LAYER_ID,
          type: "circle",
          source: RTP_CYCLES_SOURCE_ID,
          paint: {
            "circle-color": "#6b4a9e",
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              12,
              8,
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              3,
              2,
            ],
            "circle-opacity": 0.92,
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, rtpCycles, resolvedTheme]);

  // Paint census tracts as an equity choropleth once both the map and the
  // data are ready. Separate source so feature-state highlight never
  // cross-contaminates. Step expression bins `pctZeroVehicle` into 4 teal
  // shades; null values render in neutral gray so "no data" reads as
  // distinct from "<5% zero-vehicle". Tracts paint beneath all other
  // data-driven layers so point/line features remain picker-friendly —
  // `beforeId` wiring uses the first existing feature layer it finds to
  // force z-order regardless of source add-order.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !censusTracts) return;

    const paint = () => {
      if (!map.getSource(CENSUS_TRACTS_SOURCE_ID)) {
        map.addSource(CENSUS_TRACTS_SOURCE_ID, {
          type: "geojson",
          data: censusTracts as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(CENSUS_TRACTS_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(censusTracts as unknown as GeoJSON.FeatureCollection);
      }

      // Force tracts beneath point/line layers so a clicked AOI, project,
      // corridor, or RTP pin still picks up first. Pick the first rendered
      // feature-layer id that currently exists on the style.
      //
      // The project-area fill leads the list on purpose. Both it and this
      // choropleth are fills, so whichever is added second would otherwise land
      // on top — and which one that is depends on which fetch resolves first,
      // making the stacking order a race. Naming the area fill here pins tracts
      // beneath it in both orders.
      const beforeId = [
        PROJECT_AREAS_FILL_LAYER_ID,
        AOI_FILL_LAYER_ID,
        PROJECTS_CIRCLE_LAYER_ID,
        CORRIDORS_LINE_LAYER_ID,
        RTP_CYCLES_CIRCLE_LAYER_ID,
        ENGAGEMENT_CIRCLE_LAYER_ID,
        CRASHES_CORE_LAYER_ID,
      ].find((id) => map.getLayer(id));

      if (!map.getLayer(CENSUS_TRACTS_FILL_LAYER_ID)) {
        map.addLayer(
          {
            id: CENSUS_TRACTS_FILL_LAYER_ID,
            type: "fill",
            source: CENSUS_TRACTS_SOURCE_ID,
            paint: {
              "fill-color": [
                "case",
                ["==", ["get", "pctZeroVehicle"], null],
                EQUITY_RAMP_NULL,
                [
                  "step",
                  ["get", "pctZeroVehicle"],
                  EQUITY_RAMP_COLORS.lowest,
                  5,
                  EQUITY_RAMP_COLORS.low,
                  10,
                  EQUITY_RAMP_COLORS.mid,
                  15,
                  EQUITY_RAMP_COLORS.high,
                ],
              ],
              "fill-opacity": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                0.7,
                0.45,
              ],
            },
          },
          beforeId,
        );
      }

      if (!map.getLayer(CENSUS_TRACTS_OUTLINE_LAYER_ID)) {
        map.addLayer(
          {
            id: CENSUS_TRACTS_OUTLINE_LAYER_ID,
            type: "line",
            source: CENSUS_TRACTS_SOURCE_ID,
            paint: {
              "line-color": "#1f544c",
              "line-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                1.75,
                0.75,
              ],
              "line-opacity": 0.55,
            },
          },
          beforeId,
        );
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, censusTracts, resolvedTheme]);

  // Paint approved engagement points above the equity choropleth but below
  // primary project/RTP pins when those layers are present.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !engagementItems) return;

    const paint = () => {
      if (!map.getSource(ENGAGEMENT_SOURCE_ID)) {
        map.addSource(ENGAGEMENT_SOURCE_ID, {
          type: "geojson",
          data: engagementItems as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(ENGAGEMENT_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(engagementItems as unknown as GeoJSON.FeatureCollection);
      }

      const beforeId = [
        PROJECTS_CIRCLE_LAYER_ID,
        RTP_CYCLES_CIRCLE_LAYER_ID,
      ].find((id) => map.getLayer(id));

      if (!map.getLayer(ENGAGEMENT_CIRCLE_LAYER_ID)) {
        map.addLayer(
          {
            id: ENGAGEMENT_CIRCLE_LAYER_ID,
            type: "circle",
            source: ENGAGEMENT_SOURCE_ID,
            paint: {
              "circle-color": "#c24a7f",
              "circle-radius": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                8,
                5,
              ],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                2.25,
                1.25,
              ],
              "circle-opacity": 0.9,
            },
          },
          beforeId,
        );
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, engagementItems, resolvedTheme]);

  // Paint acquired crash points: a soft halo so dense clusters read as intensity
  // without individual collisions disappearing, and a core dot that stays
  // clickable. Both take colour from the shared severity palette, which the
  // legend also reads, so a red dot means the same thing in both places.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !crashes) return;

    const paint = () => {
      if (!map.getSource(CRASHES_SOURCE_ID)) {
        map.addSource(CRASHES_SOURCE_ID, {
          type: "geojson",
          data: crashes as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(CRASHES_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(crashes as unknown as GeoJSON.FeatureCollection);
      }

      // Beneath the workspace's own project and RTP pins: a crash is evidence
      // about a place, and the work being managed there should still win a click.
      const beforeId = [PROJECTS_CIRCLE_LAYER_ID, RTP_CYCLES_CIRCLE_LAYER_ID].find((id) =>
        map.getLayer(id),
      );

      if (!map.getLayer(CRASHES_HALO_LAYER_ID)) {
        map.addLayer(
          {
            id: CRASHES_HALO_LAYER_ID,
            type: "circle",
            source: CRASHES_SOURCE_ID,
            paint: CRASH_HALO_CIRCLE_PAINT,
          },
          beforeId,
        );
      }

      if (!map.getLayer(CRASHES_CORE_LAYER_ID)) {
        map.addLayer(
          {
            id: CRASHES_CORE_LAYER_ID,
            type: "circle",
            source: CRASHES_SOURCE_ID,
            paint: CRASH_CORE_CIRCLE_PAINT,
          },
          beforeId,
        );
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, crashes, resolvedTheme]);

  /**
   * Paint transit stops: clusters at regional zoom, individual stops coloured
   * by frequent-service tier as the planner comes in.
   *
   * CLUSTERING IS NOT DECORATION HERE. A few thousand individual dots along a
   * corridor render as one continuous band that hides both the pattern and the
   * projects underneath it, and Mapbox is drawing every one of them the whole
   * time. `clusterMaxZoom` is set below the zoom at which one stop is a thing a
   * planner can reason about, so the transition happens where the question
   * changes from "where is there service" to "what calls at this corner".
   *
   * THE CLUSTER CIRCLE IS DELIBERATELY NOT TIER-COLOURED. A cluster's colour
   * would have to be an average of the headways inside it, and an averaged
   * service level is a figure nobody derived and nothing in this product would
   * stand behind. Clusters carry a COUNT — how many stops are in there, which
   * is a fact — and the tier appears only once the individual stops do.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !transitStops) return;

    const paint = () => {
      if (!map.getSource(TRANSIT_SOURCE_ID)) {
        map.addSource(TRANSIT_SOURCE_ID, {
          type: "geojson",
          data: transitStops as unknown as GeoJSON.FeatureCollection,
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 45,
        });
      } else {
        const source = map.getSource(TRANSIT_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(transitStops as unknown as GeoJSON.FeatureCollection);
      }

      // Beneath the workspace's own project and RTP pins, for the crash layer's
      // reason: transit is context about a place, and the work being managed
      // there should still win a click.
      const beforeId = [PROJECTS_CIRCLE_LAYER_ID, RTP_CYCLES_CIRCLE_LAYER_ID].find((id) =>
        map.getLayer(id),
      );

      if (!map.getLayer(TRANSIT_CLUSTER_LAYER_ID)) {
        map.addLayer(
          {
            id: TRANSIT_CLUSTER_LAYER_ID,
            type: "circle",
            source: TRANSIT_SOURCE_ID,
            filter: ["has", "point_count"],
            paint: {
              "circle-color": TRANSIT_FREQUENT_COLOR,
              "circle-opacity": 0.55,
              "circle-radius": ["step", ["get", "point_count"], 14, 25, 20, 100, 27],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1.25,
            },
          },
          beforeId,
        );
      }

      if (!map.getLayer(TRANSIT_CLUSTER_COUNT_LAYER_ID)) {
        map.addLayer(
          {
            id: TRANSIT_CLUSTER_COUNT_LAYER_ID,
            type: "symbol",
            source: TRANSIT_SOURCE_ID,
            filter: ["has", "point_count"],
            layout: {
              "text-field": ["get", "point_count_abbreviated"],
              "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
              "text-size": 11,
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#ffffff" },
          },
          beforeId,
        );
      }

      if (!map.getLayer(TRANSIT_STOPS_CIRCLE_LAYER_ID)) {
        map.addLayer(
          {
            id: TRANSIT_STOPS_CIRCLE_LAYER_ID,
            type: "circle",
            source: TRANSIT_SOURCE_ID,
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": TRANSIT_TIER_PAINT,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6.5],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1,
              "circle-opacity": 0.92,
            },
          },
          beforeId,
        );
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, transitStops, resolvedTheme]);

  /**
   * Draw the workspace's own layers: one source each, up to four layers over it.
   *
   * ── WHY THE LABEL VALUE IS COPIED TO A TOP-LEVEL PROPERTY ──
   *
   * A feature's attributes arrive nested, as `properties.attributes`. Mapbox GL
   * feeds a GeoJSON source through its own vector-tile encoder, and that encoder
   * carries only SCALAR property values — a nested object survives as its JSON
   * text. So `["get", field, ["get", "attributes"]]` in a text-field expression
   * reads a string and yields nothing, silently: the layer draws, the labels
   * simply never appear, and no error is raised anywhere. The label value is
   * therefore lifted to a flat property here, where the failure would be a
   * visible wrong label rather than an invisible missing one. The nested object
   * is left in place for the inspector, which parses it back.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const paint = () => {
      const anchor = workspaceGisAnchorLayerId(map);

      /**
       * Bottom to top: polygons, then lines, then points — across ALL layers,
       * not within each — so a bike network drawn over a zoning fill stays
       * visible whatever order the layers were uploaded in. `sortOrder` then
       * settles ties within a geometry class, which is the only place a
       * planner's own ordering can change anything.
       */
      const ordered = [...workspaceLayers].sort(
        (left, right) => left.layer.sortOrder - right.layer.sortOrder
      );

      for (const listing of ordered) {
        const layer = listing.layer;
        const collection = workspaceCollections[layer.id];
        if (!collection) continue;

        const sourceId = workspaceGisSourceId(layer.id);
        const labelField = layer.style.labelField;
        const data: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: collection.features.map((feature) => {
            const attributes = feature.properties.attributes ?? {};
            const labelValue = labelField ? attributes[labelField] : undefined;
            return {
              type: "Feature",
              // The feature index is the stable id within a version, and it is
              // what a selection's `featureRef` carries.
              id: feature.properties.featureIndex,
              geometry: feature.geometry as GeoJSON.Geometry,
              properties: {
                ...feature.properties,
                label:
                  labelValue === null || labelValue === undefined ? "" : String(labelValue),
              },
            };
          }),
        };

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, { type: "geojson", data });
        } else {
          (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(data);
        }

        const color = layer.style.color;
        const opacity = layer.style.opacity;
        const lineWidth = layer.style.lineWidth;

        if (!map.getLayer(workspaceGisFillLayerId(layer.id))) {
          map.addLayer(
            {
              id: workspaceGisFillLayerId(layer.id),
              type: "fill",
              source: sourceId,
              filter: ["==", ["geometry-type"], "Polygon"],
              // The fill is deliberately WEAKER than the planner's chosen
              // opacity, which governs the outline. A zoning layer at full
              // opacity is an opaque sheet over the basemap, and the streets
              // underneath are how a planner knows where they are.
              paint: { "fill-color": color, "fill-opacity": opacity * 0.35 },
            },
            anchor
          );
        } else {
          map.setPaintProperty(workspaceGisFillLayerId(layer.id), "fill-color", color);
          map.setPaintProperty(workspaceGisFillLayerId(layer.id), "fill-opacity", opacity * 0.35);
        }

        if (!map.getLayer(workspaceGisLineLayerId(layer.id))) {
          map.addLayer(
            {
              id: workspaceGisLineLayerId(layer.id),
              type: "line",
              source: sourceId,
              // Lines AND polygon outlines: a polygon's edge is what makes a
              // parcel readable, and a `fill` alone at 35% opacity has none.
              filter: ["match", ["geometry-type"], ["LineString", "Polygon"], true, false],
              paint: { "line-color": color, "line-opacity": opacity, "line-width": lineWidth },
            },
            anchor
          );
        } else {
          map.setPaintProperty(workspaceGisLineLayerId(layer.id), "line-color", color);
          map.setPaintProperty(workspaceGisLineLayerId(layer.id), "line-opacity", opacity);
          map.setPaintProperty(workspaceGisLineLayerId(layer.id), "line-width", lineWidth);
        }

        if (!map.getLayer(workspaceGisCircleLayerId(layer.id))) {
          map.addLayer(
            {
              id: workspaceGisCircleLayerId(layer.id),
              type: "circle",
              source: sourceId,
              filter: ["==", ["geometry-type"], "Point"],
              paint: {
                "circle-color": color,
                "circle-opacity": opacity,
                // Derived from the line width so one control moves both: a
                // planner who thickened a bike network expects its nodes to
                // follow, and a second hidden constant would drift from it.
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, lineWidth, 16, lineWidth * 3],
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 1,
              },
            },
            anchor
          );
        } else {
          map.setPaintProperty(workspaceGisCircleLayerId(layer.id), "circle-color", color);
          map.setPaintProperty(workspaceGisCircleLayerId(layer.id), "circle-opacity", opacity);
        }

        if (labelField) {
          if (!map.getLayer(workspaceGisLabelLayerId(layer.id))) {
            map.addLayer(
              {
                id: workspaceGisLabelLayerId(layer.id),
                type: "symbol",
                source: sourceId,
                layout: {
                  "text-field": ["get", "label"],
                  "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
                  "text-size": 11,
                  // Never `text-allow-overlap`: a parcels layer labelled by APN
                  // would render a solid block of overlapping text. Mapbox drops
                  // the ones that collide, which reads as a labelled map rather
                  // than as ink.
                  "text-optional": true,
                },
                paint: {
                  "text-color": color,
                  "text-halo-color": "#ffffff",
                  "text-halo-width": 1.2,
                },
              },
              anchor
            );
          } else {
            map.setPaintProperty(workspaceGisLabelLayerId(layer.id), "text-color", color);
          }
        } else if (map.getLayer(workspaceGisLabelLayerId(layer.id))) {
          // The planner cleared the label field. The layer goes, rather than
          // being left drawing the last field they chose.
          map.removeLayer(workspaceGisLabelLayerId(layer.id));
        }
      }

      // ENFORCE the stacking every pass rather than only at insertion. A layer
      // added while the tract choropleth was absent sits above it forever
      // otherwise, and re-ordering by `sortOrder` would never take effect on a
      // layer that already existed.
      const currentAnchor = workspaceGisAnchorLayerId(map);
      if (currentAnchor) {
        for (const listing of ordered) {
          for (const drawingLayerId of workspaceGisDrawingLayerIds(listing.layer.id)) {
            if (map.getLayer(drawingLayerId)) {
              try {
                map.moveLayer(drawingLayerId, currentAnchor);
              } catch {
                // Best-effort ordering; a failure here is a cosmetic z-order,
                // never a wrong position on the ground.
              }
            }
          }
        }
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, workspaceLayers, workspaceCollections, resolvedTheme]);

  /**
   * Honour each workspace layer's toggle. All of its drawing layers move
   * together, so a layer never renders as labels floating over nothing.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const listing of workspaceLayers) {
      const visibility = workspaceLayerVisibility[listing.layer.id] ? "visible" : "none";
      for (const drawingLayerId of workspaceGisDrawingLayerIds(listing.layer.id)) {
        if (map.getLayer(drawingLayerId)) {
          try {
            map.setLayoutProperty(drawingLayerId, "visibility", visibility);
          } catch {
            // no-op: the workspace layer toggle is best-effort
          }
        }
      }
    }
  }, [ready, workspaceLayers, workspaceLayerVisibility, workspaceCollections]);

  // Frame the workspace's own features once, on the first payload that carries
  // any. This outranks the home-geography camera on purpose: real data already
  // in scope is a better answer than a stated boundary, and a stated boundary
  // is a better answer than the neutral view.
  //
  // Census tracts are deliberately excluded: that payload is workspace-
  // agnostic reference data, so fitting to it would frame whatever the tract
  // service happens to return rather than this workspace's work.
  //
  // Crashes are excluded for a different reason. They ARE the workspace's data,
  // but their extent is the footprint of an ACQUISITION — typically a whole
  // county pulled in one request — so framing to them would show the shape of a
  // data pull rather than the shape of the work. Project areas are included:
  // that is a boundary the workspace deliberately chose.
  //
  // Transit stops are excluded for the crash layer's reason and one more. Their
  // extent is an AGENCY's service area, which is somebody else's footprint
  // rather than this workspace's work; and the layer is fetched only once a
  // planner asks for it, so a late-arriving payload would yank a camera they
  // had already settled. The absence from this dep array is the mechanism —
  // said out loud here so it reads as a decision rather than an omission.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (didInitialFitRef.current || userMovedMapRef.current) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const collection of [
      aois,
      projectMarkers,
      projectAreas,
      corridors,
      rtpCycles,
      engagementItems,
    ]) {
      extendBoundsWithCollection(bounds, collection);
    }
    if (bounds.isEmpty()) return;

    didInitialFitRef.current = true;
    map.fitBounds(bounds, {
      padding: FIT_PADDING,
      maxZoom: INITIAL_FIT_MAX_ZOOM,
      duration: 0,
    });
  }, [ready, aois, projectMarkers, projectAreas, corridors, rtpCycles, engagementItems]);

  // Honor the layers.aerial toggle from the cartographic context.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.aerial ? "visible" : "none";
    for (const layerId of [AOI_FILL_LAYER_ID, AOI_OUTLINE_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        try {
          map.setLayoutProperty(layerId, "visibility", visibility);
        } catch {
          // no-op: layers.aerial toggle is best-effort
        }
      }
    }
  }, [layers.aerial, ready, aois]);

  // Honor the layers.projects toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.projects ? "visible" : "none";
    if (map.getLayer(PROJECTS_CIRCLE_LAYER_ID)) {
      try {
        map.setLayoutProperty(PROJECTS_CIRCLE_LAYER_ID, "visibility", visibility);
      } catch {
        // no-op: layers.projects toggle is best-effort
      }
    }
  }, [layers.projects, ready, projectMarkers]);

  // Honor the layers.projectAreas toggle. Fill + outline move together so the
  // area reads as one layer from the planner's side.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.projectAreas ? "visible" : "none";
    for (const layerId of [PROJECT_AREAS_FILL_LAYER_ID, PROJECT_AREAS_OUTLINE_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        try {
          map.setLayoutProperty(layerId, "visibility", visibility);
        } catch {
          // no-op: layers.projectAreas toggle is best-effort
        }
      }
    }
  }, [layers.projectAreas, ready, projectAreas]);

  // Honor the layers.crashes toggle. Halo + core move together so a crash never
  // renders as a glow with no dot inside it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.crashes ? "visible" : "none";
    for (const layerId of [CRASHES_HALO_LAYER_ID, CRASHES_CORE_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        try {
          map.setLayoutProperty(layerId, "visibility", visibility);
        } catch {
          // no-op: layers.crashes toggle is best-effort
        }
      }
    }
  }, [layers.crashes, ready, crashes]);

  // Honor the layers.transit toggle. All three layers move together so a stop
  // never renders as a cluster count with no circle under it, or as a cluster
  // whose members are drawn beside it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.transit ? "visible" : "none";
    for (const layerId of [
      TRANSIT_CLUSTER_LAYER_ID,
      TRANSIT_CLUSTER_COUNT_LAYER_ID,
      TRANSIT_STOPS_CIRCLE_LAYER_ID,
    ]) {
      if (map.getLayer(layerId)) {
        try {
          map.setLayoutProperty(layerId, "visibility", visibility);
        } catch {
          // no-op: layers.transit toggle is best-effort
        }
      }
    }
  }, [layers.transit, ready, transitStops]);

  // Honor the layers.corridors toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.corridors ? "visible" : "none";
    if (map.getLayer(CORRIDORS_LINE_LAYER_ID)) {
      try {
        map.setLayoutProperty(CORRIDORS_LINE_LAYER_ID, "visibility", visibility);
      } catch {
        // no-op: layers.corridors toggle is best-effort
      }
    }
  }, [layers.corridors, ready, corridors]);

  // Honor the layers.rtp toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.rtp ? "visible" : "none";
    if (map.getLayer(RTP_CYCLES_CIRCLE_LAYER_ID)) {
      try {
        map.setLayoutProperty(RTP_CYCLES_CIRCLE_LAYER_ID, "visibility", visibility);
      } catch {
        // no-op: layers.rtp toggle is best-effort
      }
    }
  }, [layers.rtp, ready, rtpCycles]);

  // Honor the layers.equity toggle. Fill + outline toggled together so the
  // choropleth reads as a single layer from the user's perspective.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.equity ? "visible" : "none";
    for (const layerId of [CENSUS_TRACTS_FILL_LAYER_ID, CENSUS_TRACTS_OUTLINE_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        try {
          map.setLayoutProperty(layerId, "visibility", visibility);
        } catch {
          // no-op: layers.equity toggle is best-effort
        }
      }
    }
  }, [layers.equity, ready, censusTracts]);

  // Honor the layers.engagement toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.engagement ? "visible" : "none";
    if (map.getLayer(ENGAGEMENT_CIRCLE_LAYER_ID)) {
      try {
        map.setLayoutProperty(ENGAGEMENT_CIRCLE_LAYER_ID, "visibility", visibility);
      } catch {
        // no-op: layers.engagement toggle is best-effort
      }
    }
  }, [layers.engagement, ready, engagementItems]);

  // Click + hover handlers on the AOI fill layer. Handlers are registered on
  // the map once ready and torn down on unmount. They survive style swaps
  // because the registration is layer-id-scoped, not source-scoped.
  //
  // Fit-on-click uses the feature geometry directly from the click event
  // rather than reading it back from the source — avoids any round-trip
  // through `queryRenderedFeatures` and stays decoupled from the selection
  // state (so fitting fires on user-initiated clicks only, never from list
  // row hovers that `setSelection` without touching the map).
  //
  // Background click-to-clear fires on the map-level click. Mapbox dispatches
  // layer clicks before the map click, but the map click still fires for
  // every click, so the handler uses `queryRenderedFeatures` against the
  // three known feature layers to distinguish feature hits from background
  // hits.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const fitToFeatureGeometry = (geometry: unknown) => {
      const instruction = fitInstructionFromGeometry(geometry);
      if (!instruction) return;
      if (instruction.kind === "center") {
        map.easeTo({
          center: instruction.center,
          zoom: POINT_FIT_ZOOM,
          duration: FIT_DURATION_MS,
        });
        return;
      }
      map.fitBounds(instruction.bbox, {
        padding: FIT_PADDING,
        maxZoom: FIT_MAX_ZOOM,
        duration: FIT_DURATION_MS,
      });
    };

    const onClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = aerialMissionFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: AOI_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };
    const onMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    const onProjectClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = projectFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: PROJECTS_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    const onProjectAreaClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = projectAreaFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: PROJECT_AREAS_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    const onCrashClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = crashFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: CRASHES_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        // Deliberately no fit: a crash is a point, and easing to street level on
        // every dot would throw away the pattern the planner was reading. The
        // inspector dock names the collision; the camera stays where it was.
      }
    };

    const onCorridorClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = corridorFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: CORRIDORS_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    const onRtpClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = rtpCycleFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: RTP_CYCLES_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    const onTractClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = tractFeatureToSelection(feature.properties, {
        sourceId: CENSUS_TRACTS_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    const onEngagementClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = engagementItemFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: ENGAGEMENT_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    /**
     * A transit stop's popup — built as DOM NODES, never as an HTML string.
     *
     * `stop_name` and the route ids come out of a third party's published feed
     * and are written to the page verbatim. `setHTML` with an interpolated feed
     * value would make any agency's GTFS export a script-injection vector into
     * every workspace that ingested it; `textContent` cannot be one, and costs
     * nothing but a few lines.
     *
     * WHAT IT SAYS, AND WHAT IT STRUCTURALLY CANNOT. Every line is a rate or a
     * count over a whole service day. There is no departure time in it because
     * there is no departure time in the payload — the route does not ask
     * `gtfs_stops_map` for `first_departure_seconds` or
     * `last_departure_seconds`, so this popup could not print one if someone
     * later decided it should. That is the boundary being kept by construction
     * rather than by remembering: a service level is a planning fact about a
     * schedule that was published, a departure time is a promise to a rider
     * standing on the corner, and OpenPlan reads no feed that could keep the
     * second one.
     */
    const transitPopup = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: "280px",
      offset: 10,
    });

    const transitPopupContent = (properties: Record<string, unknown>) => {
      const root = document.createElement("div");
      root.className = "op-map-popup op-map-popup--transit";

      const text = (className: string, value: string) => {
        const node = document.createElement("div");
        node.className = className;
        node.textContent = value;
        root.appendChild(node);
      };

      const stopName = typeof properties.stopName === "string" ? properties.stopName.trim() : "";
      const agencyName = typeof properties.agencyName === "string" ? properties.agencyName.trim() : "";
      const dayName = typeof properties.serviceDay === "string" ? properties.serviceDay : "";
      const dayLabel = dayName ? dayName.charAt(0).toUpperCase() + dayName.slice(1) : "weekday";
      const trips = typeof properties.tripsPerDay === "number" ? properties.tripsPerDay : 0;
      const headway =
        typeof properties.peakHeadwayMinutes === "number" ? properties.peakHeadwayMinutes : null;
      const routesServing =
        typeof properties.routesServing === "number" ? properties.routesServing : 0;

      // Mapbox flattens feature properties through JSON when a source is
      // clustered, so an array arrives as a string. Both shapes are read rather
      // than one assumed — the alternative is a popup that silently lists no
      // routes on exactly the layer that is always clustered.
      const rawRouteIds = properties.routeIds;
      let routeIds: string[] = [];
      if (Array.isArray(rawRouteIds)) {
        routeIds = rawRouteIds.filter((id): id is string => typeof id === "string");
      } else if (typeof rawRouteIds === "string") {
        try {
          const parsed: unknown = JSON.parse(rawRouteIds);
          if (Array.isArray(parsed)) {
            routeIds = parsed.filter((id): id is string => typeof id === "string");
          }
        } catch {
          routeIds = [];
        }
      }

      text("op-map-popup__title", stopName.length > 0 ? stopName : "Unnamed stop");
      if (agencyName.length > 0) {
        text("op-map-popup__kicker", agencyName);
      }
      text(
        "op-map-popup__line",
        `About ${trips.toLocaleString()} trips call here on a ${dayLabel}.`,
      );
      text(
        "op-map-popup__line",
        headway === null
          ? "Too few trips that day to derive an interval between them."
          : `About one vehicle every ${headway.toLocaleString()} minutes in the busiest hour.`,
      );
      if (routesServing > 0) {
        const listed = routeIds.slice(0, 4).join(", ");
        const suffix =
          routeIds.length > 0
            ? ` (${listed}${routesServing > routeIds.length || routeIds.length > 4 ? ", and others" : ""})`
            : "";
        text(
          "op-map-popup__line",
          `Served by ${routesServing.toLocaleString()} ${routesServing === 1 ? "route" : "routes"}${suffix}.`,
        );
      }
      text(
        "op-map-popup__note",
        "Derived from a published feed, averaged over one service day — a service level, not a timetable.",
      );

      return root;
    };

    const onTransitStopClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const geometry = feature.geometry;
      if (!geometry || geometry.type !== "Point") return;
      const [lng, lat] = geometry.coordinates as [number, number];
      transitPopup
        .setLngLat([lng, lat])
        .setDOMContent(transitPopupContent((feature.properties ?? {}) as Record<string, unknown>))
        .addTo(map);
    };

    // A cluster is not a feature a planner can be told anything about, so
    // clicking one asks the source how far in it has to go to break apart, and
    // goes there. Answering with "1,204 stops" and no way through would be a
    // dead end on the layer's most clickable target.
    const onTransitClusterClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (typeof clusterId !== "number") return;
      const source = map.getSource(TRANSIT_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (!source || typeof source.getClusterExpansionZoom !== "function") return;
      const geometry = feature?.geometry;
      if (!geometry || geometry.type !== "Point") return;
      const center = geometry.coordinates as [number, number];
      // Callback form, which is what this Mapbox GL version's types require.
      // A failure is a no-op rather than a thrown error: the planner can still
      // zoom by hand, and a dead click is a smaller harm than a crashed map.
      source.getClusterExpansionZoom(clusterId, (error, zoom) => {
        if (error || typeof zoom !== "number") return;
        map.easeTo({ center, zoom, duration: FIT_DURATION_MS });
      });
    };

    /**
     * The workspace's own drawing layers that are currently on the map.
     *
     * READ THROUGH A REF, not a dependency, and that is the whole reason this
     * handler is map-level rather than layer-scoped. `map.on("click", layerId,
     * …)` needs the layer id at registration time, and these ids are rows in a
     * table — a layer uploaded five minutes from now has no id yet. Re-running
     * this effect to pick up a new layer would tear down and re-register every
     * handler on the map, which drops any click in flight.
     */
    const renderedWorkspaceLayerIds = (): string[] =>
      workspaceLayersRef.current
        .filter((listing) => workspaceVisibilityRef.current[listing.layer.id] === true)
        .flatMap((listing) => workspaceGisClickableLayerIds(listing.layer.id))
        .filter((layerId) => map.getLayer(layerId));

    const onWorkspaceGisClick = (e: mapboxgl.MapMouseEvent) => {
      const layerIds = renderedWorkspaceLayerIds();
      if (layerIds.length === 0) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: layerIds });
      const feature = hits[0];
      if (!feature) return;

      const layerId = (feature.properties as { layerId?: unknown } | null)?.layerId;
      const listing = workspaceLayersRef.current.find(
        (candidate) => candidate.layer.id === layerId
      );
      if (!listing) return;

      const version = listing.layer.currentVersion;
      const nextSelection = workspaceGisFeatureToSelection(feature.properties, {
        // The layer's NAME and the label field come from the catalog, never from
        // the clicked feature: the feature carries ids, and a name assembled
        // from the data would be a guess about which column is the name.
        layerName: listing.layer.name,
        versionLabel: version ? `Version ${version.versionNumber}` : null,
        labelField: listing.layer.style.labelField,
        sourceId: workspaceGisSourceId(listing.layer.id),
      });
      if (nextSelection) {
        setSelection(nextSelection);
        // Deliberately NO fit-to-feature. Clicking a parcel to read its
        // attributes should not throw the planner's map to that parcel's
        // extent — they are working at a scale they chose, and a workspace
        // layer is reference under that work rather than the subject of it.
      }
    };

    const onBackgroundClick = (e: mapboxgl.MapMouseEvent) => {
      const renderedLayers = [
        ...FEATURE_LAYERS.filter((layerId) => map.getLayer(layerId)),
        // The workspace's uploaded layers count as feature hits too. Without
        // them a click that just selected a parcel would fall through to here,
        // find nothing, and clear the selection it had only just made — the
        // inspector would flash and empty.
        ...renderedWorkspaceLayerIds(),
      ];
      if (renderedLayers.length === 0) {
        // No feature layers mounted yet — any click is background.
        clearSelection();
        return;
      }
      const hits = map.queryRenderedFeatures(e.point, { layers: renderedLayers });
      if (hits.length === 0) {
        clearSelection();
      }
    };

    map.on("click", AOI_FILL_LAYER_ID, onClick);
    map.on("mouseenter", AOI_FILL_LAYER_ID, onMouseEnter);
    map.on("mouseleave", AOI_FILL_LAYER_ID, onMouseLeave);
    map.on("click", PROJECTS_CIRCLE_LAYER_ID, onProjectClick);
    map.on("mouseenter", PROJECTS_CIRCLE_LAYER_ID, onMouseEnter);
    map.on("mouseleave", PROJECTS_CIRCLE_LAYER_ID, onMouseLeave);
    map.on("click", PROJECT_AREAS_FILL_LAYER_ID, onProjectAreaClick);
    map.on("mouseenter", PROJECT_AREAS_FILL_LAYER_ID, onMouseEnter);
    map.on("mouseleave", PROJECT_AREAS_FILL_LAYER_ID, onMouseLeave);
    map.on("click", CRASHES_CORE_LAYER_ID, onCrashClick);
    map.on("mouseenter", CRASHES_CORE_LAYER_ID, onMouseEnter);
    map.on("mouseleave", CRASHES_CORE_LAYER_ID, onMouseLeave);
    map.on("click", CORRIDORS_LINE_LAYER_ID, onCorridorClick);
    map.on("mouseenter", CORRIDORS_LINE_LAYER_ID, onMouseEnter);
    map.on("mouseleave", CORRIDORS_LINE_LAYER_ID, onMouseLeave);
    map.on("click", RTP_CYCLES_CIRCLE_LAYER_ID, onRtpClick);
    map.on("mouseenter", RTP_CYCLES_CIRCLE_LAYER_ID, onMouseEnter);
    map.on("mouseleave", RTP_CYCLES_CIRCLE_LAYER_ID, onMouseLeave);
    map.on("click", CENSUS_TRACTS_FILL_LAYER_ID, onTractClick);
    map.on("mouseenter", CENSUS_TRACTS_FILL_LAYER_ID, onMouseEnter);
    map.on("mouseleave", CENSUS_TRACTS_FILL_LAYER_ID, onMouseLeave);
    map.on("click", ENGAGEMENT_CIRCLE_LAYER_ID, onEngagementClick);
    map.on("mouseenter", ENGAGEMENT_CIRCLE_LAYER_ID, onMouseEnter);
    map.on("mouseleave", ENGAGEMENT_CIRCLE_LAYER_ID, onMouseLeave);
    map.on("click", TRANSIT_STOPS_CIRCLE_LAYER_ID, onTransitStopClick);
    map.on("mouseenter", TRANSIT_STOPS_CIRCLE_LAYER_ID, onMouseEnter);
    map.on("mouseleave", TRANSIT_STOPS_CIRCLE_LAYER_ID, onMouseLeave);
    map.on("click", TRANSIT_CLUSTER_LAYER_ID, onTransitClusterClick);
    map.on("mouseenter", TRANSIT_CLUSTER_LAYER_ID, onMouseEnter);
    map.on("mouseleave", TRANSIT_CLUSTER_LAYER_ID, onMouseLeave);
    // Registered BEFORE the background handler: Mapbox calls map-level click
    // handlers in registration order, so the selection is made before anything
    // gets the chance to decide the click was background.
    map.on("click", onWorkspaceGisClick);
    map.on("click", onBackgroundClick);

    return () => {
      map.off("click", AOI_FILL_LAYER_ID, onClick);
      map.off("mouseenter", AOI_FILL_LAYER_ID, onMouseEnter);
      map.off("mouseleave", AOI_FILL_LAYER_ID, onMouseLeave);
      map.off("click", PROJECTS_CIRCLE_LAYER_ID, onProjectClick);
      map.off("mouseenter", PROJECTS_CIRCLE_LAYER_ID, onMouseEnter);
      map.off("mouseleave", PROJECTS_CIRCLE_LAYER_ID, onMouseLeave);
      map.off("click", PROJECT_AREAS_FILL_LAYER_ID, onProjectAreaClick);
      map.off("mouseenter", PROJECT_AREAS_FILL_LAYER_ID, onMouseEnter);
      map.off("mouseleave", PROJECT_AREAS_FILL_LAYER_ID, onMouseLeave);
      map.off("click", CRASHES_CORE_LAYER_ID, onCrashClick);
      map.off("mouseenter", CRASHES_CORE_LAYER_ID, onMouseEnter);
      map.off("mouseleave", CRASHES_CORE_LAYER_ID, onMouseLeave);
      map.off("click", CORRIDORS_LINE_LAYER_ID, onCorridorClick);
      map.off("mouseenter", CORRIDORS_LINE_LAYER_ID, onMouseEnter);
      map.off("mouseleave", CORRIDORS_LINE_LAYER_ID, onMouseLeave);
      map.off("click", RTP_CYCLES_CIRCLE_LAYER_ID, onRtpClick);
      map.off("mouseenter", RTP_CYCLES_CIRCLE_LAYER_ID, onMouseEnter);
      map.off("mouseleave", RTP_CYCLES_CIRCLE_LAYER_ID, onMouseLeave);
      map.off("click", CENSUS_TRACTS_FILL_LAYER_ID, onTractClick);
      map.off("mouseenter", CENSUS_TRACTS_FILL_LAYER_ID, onMouseEnter);
      map.off("mouseleave", CENSUS_TRACTS_FILL_LAYER_ID, onMouseLeave);
      map.off("click", ENGAGEMENT_CIRCLE_LAYER_ID, onEngagementClick);
      map.off("mouseenter", ENGAGEMENT_CIRCLE_LAYER_ID, onMouseEnter);
      map.off("mouseleave", ENGAGEMENT_CIRCLE_LAYER_ID, onMouseLeave);
      map.off("click", TRANSIT_STOPS_CIRCLE_LAYER_ID, onTransitStopClick);
      map.off("mouseenter", TRANSIT_STOPS_CIRCLE_LAYER_ID, onMouseEnter);
      map.off("mouseleave", TRANSIT_STOPS_CIRCLE_LAYER_ID, onMouseLeave);
      map.off("click", TRANSIT_CLUSTER_LAYER_ID, onTransitClusterClick);
      map.off("mouseenter", TRANSIT_CLUSTER_LAYER_ID, onMouseEnter);
      map.off("mouseleave", TRANSIT_CLUSTER_LAYER_ID, onMouseLeave);
      map.off("click", onWorkspaceGisClick);
      map.off("click", onBackgroundClick);
      // The popup is created inside this effect, so it has to be torn down with
      // it — a theme swap rebuilds the map and would otherwise leave a detached
      // popup holding a reference to the old instance.
      transitPopup.remove();
    };
  }, [ready, setSelection, clearSelection]);

  // Highlight the selected feature by writing feature-state.selected = true.
  // Paint expressions on every source-backed layer read from feature-state,
  // so the visual lift happens without re-adding layers. Re-runs on data
  // + selection change because setStyle() wipes feature-state along with
  // sources/layers. Dispatch on sourceId so a project selection never
  // lights up an AOI and vice-versa.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const apply = () => {
      for (const sourceId of KNOWN_SOURCES) {
        if (!map.getSource(sourceId)) continue;
        try {
          map.removeFeatureState({ source: sourceId });
        } catch {
          // no-op: nothing to clear
        }
      }
      const ref = selection?.featureRef;
      if (ref && (KNOWN_SOURCES as readonly string[]).includes(ref.sourceId)) {
        try {
          map.setFeatureState(
            { source: ref.sourceId, id: ref.featureId },
            { selected: true },
          );
        } catch {
          // no-op: feature may not yet be loaded on this source
        }
      }
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once("style.load", apply);
    }
  }, [
    selection,
    ready,
    aois,
    projectMarkers,
    projectAreas,
    corridors,
    rtpCycles,
    censusTracts,
    engagementItems,
    crashes,
  ]);

  if (suppressed) return null;

  const usingMapbox = Boolean(MAPBOX_ACCESS_TOKEN);

  return (
    <div
      aria-hidden
      className="op-map-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        // D2 parchment fallback — radial gradients over base bg
        background: usingMapbox
          ? "var(--bg)"
          : [
              "radial-gradient(1200px 700px at 70% 40%, var(--map-park) 0%, transparent 45%)",
              "radial-gradient(900px 500px at 20% 70%, var(--map-water) 0%, transparent 40%)",
              "radial-gradient(700px 400px at 80% 80%, var(--map-2) 0%, transparent 60%)",
              "var(--map-1)",
            ].join(","),
      }}
    >
      {usingMapbox ? (
        <div
          ref={containerRef}
          className="op-map-backdrop__canvas"
          style={{
            position: "absolute",
            inset: 0,
            opacity: ready ? 1 : 0,
            transition: "opacity 300ms ease",
            filter:
              backdropTheme === "dark"
                ? "saturate(0.8) brightness(0.95)"
                : "saturate(0.7) contrast(0.95)",
          }}
        />
      ) : null}
      {/* Parchment warm-tint overlay so Mapbox light style feels cartographic. */}
      {usingMapbox ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              backdropTheme === "dark"
                ? "linear-gradient(180deg, rgba(17,22,24,0.2) 0%, rgba(17,22,24,0.35) 100%)"
                : "linear-gradient(180deg, rgba(244,241,236,0.3) 0%, rgba(244,241,236,0.12) 100%)",
          }}
        />
      ) : null}
    </div>
  );
}
