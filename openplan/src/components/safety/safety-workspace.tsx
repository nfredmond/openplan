"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type mapboxgl from "mapbox-gl";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
// The BACKGROUND PICKER IS THE PORTAL LANE'S, IMPORTED, NOT COPIED. It holds no
// style ids, takes resolved choices, and renders nothing when a deployment
// offers fewer than two — all of which is exactly what this surface needs. Its
// name says "public" because the portal is where it was first mounted; nothing
// in it is portal-specific, and a second copy under a safety-shaped name would
// be the thirteenth hardcoded style list this product is trying to stop having.
// The LAYER picker beside it is not reused: it takes a campaign's published
// context layers, which this surface has none of. The WORKSPACE layer catalog
// is a different thing and it now has a panel here — see
// `SafetyWorkspaceLayersPanel`, and the note on `useWorkspaceGisMapBinding`
// below for why it stopped being the shell's job.
import { PublicBasemapPicker } from "@/components/engagement/public-map-picker-basemap";
import type { PublicBasemapChoice, PublicBasemapId } from "@/lib/cartographic/basemaps";
import {
  CRASH_SEVERITY_COLOR,
  CRASH_SEVERITY_LEGEND_ORDER,
} from "@/lib/cartographic/crash-severity-palette";
import { summarizeCorridorText, type StudyAreaOrigin } from "@/lib/models/study-area";
import { ccrsCountyCodeFromGeoid } from "@/lib/safety/county-code";
import { recentCrashYears } from "@/lib/safety/crash-years";
// The KSI composition and the "can this source express it" test, both from
// their single declarations. Writing `fatal + severe_injury` here again is how a
// measure ends up defined in three files and changed in one.
import { CRASH_KSI_SEVERITIES } from "@/lib/safety/vocabulary";
import { SAFETY_KSI_COVERAGE_UNAVAILABLE, separatesSeriousInjuries } from "@/lib/safety/crash-evidence";
import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { SafetyCrashMap, safetyWorkspaceGisAnchorLayerId } from "./safety-crash-map";
import { SafetyWorkspaceLayersPanel } from "./safety-workspace-layers-panel";
import { SafetyLayerDeepLink } from "./safety-layer-deep-link";
import { SafetyMapFillsSurface } from "./safety-map-fills-surface";
import { useWorkspaceGisMapBinding } from "@/components/cartographic/use-workspace-gis-map-binding";
import { useAerialOrthoMapBinding } from "@/components/cartographic/use-aerial-ortho-map-binding";
import type { FitInstruction } from "@/lib/cartographic/geometry-bbox";
import { useTheme } from "@/components/theme-provider";
import { CrashExportButton } from "./crash-export-button";
import {
  COVERAGE_STATE_COPY,
  SEVERITY_LABELS,
  type SafetyCrashCollection,
  type SafetyCrashFeature,
  type SafetyCrashQueryResponse,
  type SafetyIngestHistoryEntry,
  type SafetyIngestSummary,
  type SafetyLiveCrashRead,
  type SafetyProjectOption,
} from "@/lib/safety/client-types";
import {
  describeGeocodingShortfall,
  describeUngeocodedCountyOption,
  SAFETY_CRASH_DATA_CAVEAT,
  SAFETY_FATAL_ONLY_CAVEAT,
  SAFETY_LIVE_READ_CAVEAT,
  SAFETY_SEVERITY_COMPLETENESS_CAVEAT,
  SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT,
} from "@/lib/safety/caveats";
import {
  CRASH_FILTER_DEFAULTS,
  CRASH_FILTER_FACETS,
  crashFeatureMatchesFilters,
  crashFilterSearchParams,
  describeCrashDimensions,
  facetValues,
  type CrashFilterSelection,
} from "@/lib/safety/crash-filters";
import { CrashFilterPanel, type CrashFacetCounts } from "./crash-filter-panel";
import { SafetyPrintableStreetContext } from "./safety-printable-street-context";

function CutoffProvenanceLink({
  provenance,
  short = false,
}: {
  provenance: Record<string, unknown> | null | undefined;
  short?: boolean;
}) {
  const sourceUrl = typeof provenance?.sourceUrl === "string" ? provenance.sourceUrl : null;
  const label = typeof provenance?.label === "string" ? provenance.label : "Source publication metadata";
  if (!sourceUrl) return null;
  return <> <a className="underline" href={sourceUrl} target="_blank" rel="noreferrer">{short ? "publication source" : label}</a>.</>;
}

/**
 * Keep only the LIVE crash points that match the current filters.
 *
 * Stored crashes are filtered by the query route in Postgres; a live read never
 * reaches Postgres, so the same filters have to be applied here or the controls
 * would be dead for exactly the planners the live lane exists for.
 *
 * WHAT THIS USED TO BE, AND WHY IT IS NOW ONE LINE. It was a hand-written set of
 * predicates whose own comment said they were "written to mirror" the route's.
 * That is a convention, and a convention only written down has already been
 * violated somewhere — a facet added to the route and not here is a filter that
 * silently answers differently depending on whether the planner acquired the
 * data or read it live. Both lanes now walk the single declaration in
 * `crash-filters.ts`, and `src/test/one-crash-filter-definition.test.ts` drives
 * both interpreters over the same corpus and asserts they select the same rows.
 */
function filterLiveCrashFeatures(
  features: SafetyCrashFeature[],
  filters: CrashFilterSelection
): SafetyCrashFeature[] {
  return features.filter((feature) => crashFeatureMatchesFilters(feature.properties, filters));
}

/**
 * How many of the crashes on screen carry each facet value.
 *
 * Counted off the VISIBLE features and captioned as such in the panel. They are
 * not a census of the record — a stored query is filtered in Postgres before it
 * arrives — and presenting them as one would let a planner read "Fatal (3)"
 * under an active filter as "this corridor had three fatal crashes".
 */
function countFacetValues(features: SafetyCrashFeature[]): CrashFacetCounts {
  const counts: CrashFacetCounts = {};
  for (const facet of CRASH_FILTER_FACETS) {
    const bucket: Record<string, number> = {};
    for (const value of facetValues(facet)) bucket[value] = 0;
    for (const feature of features) {
      const properties = feature.properties as unknown as Record<string, unknown>;
      if (facet.kind === "in") {
        const value = properties[facet.property];
        if (typeof value === "string" && value in bucket) bucket[value] += 1;
      } else {
        for (const option of facet.options) {
          if (properties[option.property] === true) bucket[option.value] += 1;
        }
      }
    }
    counts[facet.id] = bucket;
  }
  return counts;
}

/**
 * Split the years a live read ASKED FOR into the ones that came back with
 * records and the ones that came back with none.
 *
 * WHY THIS IS NOT COSMETIC. A crash source is not obliged to hold every year in
 * the rolling window, and a fatality census in particular publishes its annual
 * file well after the year ends — so a four-year window routinely returns two
 * years of records. The banner then shows one number, and a planner sizing a
 * safety problem reads it as four years of crashes when it is two. Halving a
 * study area's apparent crash burden is not a rounding error in a document that
 * competes for safety funding.
 *
 * The disclosure that was here could not say this: it fired only when the source
 * reported crashes AND no year carried a mappable record, which is very nearly
 * unreachable. The common case — some years answered, some did not — went
 * entirely unstated. This is the same defect class as the branch nothing can
 * satisfy, one level down.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY IS *WHY* A YEAR IS SILENT. Nothing in the
 * adapter contract can distinguish "no crashes were reported", "records came
 * back but none could be mapped", and "this year is not published yet" — so the
 * copy names all three and asserts none. Guessing would turn an unpublished year
 * into a finding that the roads were safe.
 *
 * Jurisdiction- and source-neutral: it compares two lists of integers.
 */
export function splitLiveReadYears(
  yearsRequested: number[],
  yearsCovered: number[]
): { answered: number[]; silent: number[] } {
  const covered = new Set(yearsCovered);
  return {
    answered: yearsRequested.filter((year) => covered.has(year)),
    silent: yearsRequested.filter((year) => !covered.has(year)),
  };
}

/**
 * A casualty count, or the honest absence of one.
 *
 * The one string this must never produce is "0" for a count the source did not
 * supply. A detail card saying nobody was killed in a collision whose outcome
 * was never recorded is the most consequential thing this page could get wrong,
 * and it is what the product did until the `unknown` severity band existed.
 */
function describeCasualty(value: number | null): string {
  return value === null ? "not reported" : value.toLocaleString();
}

function describeTractMetric(
  label: string,
  value: number | null,
  areaMedian: number | null
): string {
  if (value === null) return `${label} not available`;
  if (areaMedian === null) return `${label} ${value.toFixed(1)}%`;
  const comparison = value > areaMedian ? "above" : value < areaMedian ? "below" : "at";
  return `${label} ${value.toFixed(1)}% (${comparison} area median ${areaMedian.toFixed(1)}%)`;
}

/**
 * WHAT THE COLOURS ON THE MAP MEAN.
 *
 * The dots are painted from `CRASH_SEVERITY_COLOR` and this reads the same
 * constant, so a band added to the vocabulary cannot be painted on the map and
 * missing from the key. `unknown` is in the list on purpose: those points ARE
 * drawn, and a painted dot with no key entry leaves a reader guessing which rung
 * it belongs to — which for that band is the exact wrong guess, since it is not
 * a rung at all.
 *
 * It renders in two places and only ever one at a time: docked over the map from
 * `lg` up, and as a plain row at the top of the column below that. Measured at
 * 390×844, the docked version wrapped to three lines and covered a third of a
 * 256px-tall map — and the label it wraps on is the one that must not be
 * shortened ("Not classified — no casualty count reported" is a disclosure, not
 * a caption). Moving it rather than truncating it keeps both the map and the
 * sentence intact.
 */
function CrashSeverityKey({ className }: { className: string }) {
  return (
    <div className={className} data-testid="safety-severity-key">
      {CRASH_SEVERITY_LEGEND_ORDER.map((severity) => (
        <span key={severity} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: CRASH_SEVERITY_COLOR[severity] }}
          />
          {SEVERITY_LABELS[severity]}
        </span>
      ))}
    </div>
  );
}

/** One labelled fact on the collision card. Muted styling marks an absence. */
function CrashDetailLine({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={muted ? "italic text-muted-foreground" : ""}>{value}</dd>
    </div>
  );
}

/**
 * The area this page opens on, already resolved on the server.
 *
 * It is the flattened result of `resolveStudyArea` — the app's one statement of
 * study-area precedence — rather than a single owner's geography, because this
 * page can now be opened FOR a project (`/safety?projectId=…`) whose corridor is
 * a fraction of the workspace's county. `origin` is what makes the difference
 * visible: without it the picker would show a boundary with no account of why
 * that boundary and not the other one.
 *
 * The full `ResolvedStudyArea` is not passed as-is because its `geometry` is the
 * same polygon `corridorText` already carries, and a county boundary can be
 * megabytes on the wire.
 */
export type SafetyStudyAreaSeed = {
  /** The boundary, serialized — what the controlled picker takes. */
  corridorText: string;
  /** The resolved place identity, when the area has one. Null for a drawn area. */
  place: PlaceBoundaryResponse | null;
  /** The place's own name, when it has one. */
  label: string | null;
  origin: StudyAreaOrigin;
  originLabel: string | null;
};

const EMPTY_STUDY_AREA_SEED: SafetyStudyAreaSeed = {
  corridorText: "",
  place: null,
  label: null,
  origin: "none",
  originLabel: null,
};

type SafetyWorkspaceProps = {
  workspaceId: string;
  latestIngest: SafetyIngestSummary | null;
  /**
   * True when the crash-import history could not be READ. Distinct from "no
   * import exists": one is a fact about this workspace, the other is a fact
   * about the query, and only the first belongs in a sentence about crashes.
   */
  ingestsReadFailed?: boolean;
  /**
   * Where the picker STARTS, resolved on the server. Absent (or `origin: "none"`)
   * keeps the original behavior: nothing is preselected and nothing is fetched
   * until the user picks a study area.
   */
  studyArea?: SafetyStudyAreaSeed;
  /**
   * The project `/safety?projectId=…` was opened for, whether or not its area is
   * the one above — a project with no study area of its own is still the project
   * this visit is about, and the acquisition should still attach to it.
   */
  openedForProject?: { id: string; name: string | null } | null;
  /** Workspace projects for the attach-on-ingest selector. */
  projects?: SafetyProjectOption[];
  /** Recent acquisitions, newest first, with their project links. */
  ingestHistory?: SafetyIngestHistoryEntry[];
  /** Existing reports for the active project that can receive this pull. */
  projectReports?: Array<{ id: string; title: string }>;
  /**
   * The map backgrounds this deployment offers, resolved on the server by
   * `resolvePublicBasemapConfig` — the same registry and the same operator
   * setting the public portal reads. Empty means no usable map key, in which
   * case the map component draws its own "no map key" notice and no picker is
   * offered for a map that is not there.
   */
  basemapChoices?: readonly PublicBasemapChoice[];
  defaultBasemapId?: PublicBasemapId | null;
};

/**
 * The rough ground area of a recorded extent, in square kilometres.
 *
 * Equirectangular, and that is honest enough for "is this my corridor or my
 * county" — the question this answers. It is deliberately prefixed with ≈
 * wherever it is rendered, and it is never presented as a measurement of the
 * area a planner drew: it is the box the pull used.
 */
function describeExtentKm2(scope: {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}): string {
  const midLat = ((scope.minLat + scope.maxLat) / 2) * (Math.PI / 180);
  const kmPerDegreeLat = 110.574;
  const kmPerDegreeLon = 111.32 * Math.cos(midLat);
  const km2 =
    Math.abs(scope.maxLat - scope.minLat) *
    kmPerDegreeLat *
    Math.abs(scope.maxLon - scope.minLon) *
    kmPerDegreeLon;
  return km2 >= 10 ? Math.round(km2).toLocaleString() : km2.toFixed(1);
}

export function SafetyWorkspace({
  workspaceId,
  latestIngest,
  ingestsReadFailed = false,
  studyArea = EMPTY_STUDY_AREA_SEED,
  openedForProject = null,
  projects = [],
  ingestHistory = [],
  projectReports = [],
  basemapChoices = [],
  defaultBasemapId = null,
}: SafetyWorkspaceProps) {
  // The study area is still the user's to choose. Inheriting one only changes
  // where the picker STARTS — no place is ever invented here, and clearing the
  // area clears it fully.
  const [corridorText, setCorridorText] = useState(studyArea.corridorText);
  const [place, setPlace] = useState<PlaceBoundaryResponse | null>(studyArea.place);
  const [ingest, setIngest] = useState<SafetyIngestSummary | null>(latestIngest);
  const [history, setHistory] = useState<SafetyIngestHistoryEntry[]>(ingestHistory);
  // Optional project the NEXT acquisition is attached to. "" = unattached.
  // A project named in the URL is context; a prior acquisition is history and
  // must never silently reattach a new, possibly different study area.
  const [projectId, setProjectId] = useState(() => {
    const offered = (candidate: string) =>
      Boolean(candidate) && projects.some((project) => project.id === candidate);
    if (openedForProject && offered(openedForProject.id)) return openedForProject.id;
    return "";
  });
  const [response, setResponse] = useState<SafetyCrashQueryResponse | null>(null);
  const previousCorridorTextRef = useRef(corridorText);
  /**
   * Crashes read live from a source this workspace may not store.
   *
   * Held separately from `ingest` because it is a different fact: nothing was
   * acquired, nothing is in `safety_crashes`, and nothing will survive this
   * visit. Merging it into the ingest summary would make the coverage banner
   * claim a stored record that does not exist.
   */
  const [liveRead, setLiveRead] = useState<SafetyLiveCrashRead | null>(null);
  // One selection object, shared by the query route and the live predicate.
  // Opens with property-damage-only withheld — see `CRASH_FILTER_DEFAULTS` for
  // the planner's reason and for why that default could not ship before the
  // `unknown` severity band existed.
  const [filters, setFilters] = useState<CrashFilterSelection>(CRASH_FILTER_DEFAULTS);
  /** The collision whose detail card is open, by feature id. */
  const [selectedCrashId, setSelectedCrashId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestElapsedSeconds, setIngestElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ingesting) {
      setIngestElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setIngestElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [ingesting]);
  // Which background the map is drawn on. The picker renders nothing when the
  // deployment offers fewer than two, and this still resolves to something the
  // map can load — a map with no background is a grey rectangle.
  const [basemapId, setBasemapId] = useState<PublicBasemapId | null>(defaultBasemapId);
  const selectedBasemap =
    basemapChoices.find((choice) => choice.id === (basemapId ?? defaultBasemapId)) ??
    basemapChoices[0] ??
    null;

  /**
   * ═══ THE AGENCY'S OWN LAYERS, ON THE MAP THE PLANNER IS READING ═══
   *
   * Until 2026-08-13 this page carried TWO Mapbox instances. Safety drew the
   * crash map below, and the shell drew its cartographic backdrop behind the
   * whole page; the shell's layers panel and legend docked at the right edge and
   * drove the backdrop. Measured at 1600×900: a 1600×900 backdrop at (0,0)
   * behind an opaque panel, a 558×457 crash map at (305,350) in front of it, and
   * a 240×458 layers panel at x=1344 that governed the first and not the second.
   * Ticking a layer fetched it, painted it, and showed the planner nothing.
   *
   * `/safety` is now in `MAP_OWNING_ROUTES`, so the backdrop suppresses itself
   * and the shell's dock does not mount. This is what replaces it: the SAME hook
   * the backdrop and Corridor Analysis use, pointed at the crash map. The
   * catalog read, the viewport windowing, the retry bookkeeping and — the part
   * that matters most — the coverage notes come with it, rather than being
   * reimplemented here slightly differently. This repository's recorded rule is
   * that the second caller of a capability living inside the first will get it
   * wrong; this is the third caller, and it is why the capability was extracted.
   *
   * `theme` is the BASEMAP's, not the chrome's, and the registry answers it
   * directly: `PublicBasemapChoice.dark` exists precisely because "shapes drawn
   * on top are coloured against this background" is a question the caller has to
   * ask. A satellite background is dark whatever the app palette is doing, so
   * reading the app theme here would put dark casing on dark imagery for any
   * planner working in light mode over aerials. The app theme is the fallback
   * only for a deployment that offers no basemaps at all, where the map draws
   * its own "no map key" notice and nothing is painted anyway.
   */
  const crashMapRef = useRef<mapboxgl.Map | null>(null);
  const [crashMapReady, setCrashMapReady] = useState(false);
  /**
   * The crash map has finished building (or has been torn down).
   *
   * The ref is what the binding hook reads from inside its effects; the state is
   * what re-runs them. Both are needed and they are not redundant: a ref alone
   * would never wake the hook, and state alone would make every effect that
   * touches the map re-subscribe on each render.
   */
  const handleMapReady = useCallback((map: mapboxgl.Map | null) => {
    crashMapRef.current = map;
    setCrashMapReady(Boolean(map));
  }, []);
  const { resolvedTheme } = useTheme();
  const basemapInk: "light" | "dark" = selectedBasemap
    ? selectedBasemap.dark
      ? "dark"
      : "light"
    : resolvedTheme === "dark"
      ? "dark"
      : "light";

  useWorkspaceGisMapBinding({
    mapRef: crashMapRef,
    ready: crashMapReady,
    // Not before the map has a workspace to ask about: a catalog read for a
    // missing id is a request that can only fail.
    enabled: crashMapReady && Boolean(workspaceId),
    workspaceId,
    theme: basemapInk,
    resolveAnchorLayerId: safetyWorkspaceGisAnchorLayerId,
  });
  useAerialOrthoMapBinding({
    mapRef: crashMapRef,
    ready: crashMapReady,
    enabled: crashMapReady && Boolean(workspaceId),
    resolveAnchorLayerId: (map) => safetyWorkspaceGisAnchorLayerId(map),
  });

  /**
   * Where a "Show on the map" link asked the camera to go, pending application.
   *
   * Held as state rather than pushed at the map directly because the map is a
   * child: this is the request, the child acts on it, and `onFocusApplied`
   * clears it. Nulling it is what stops the frame being re-applied on every
   * re-render — and this component re-renders on every filter press.
   */
  const [mapFocus, setMapFocus] = useState<FitInstruction | null>(null);

  // Whether the box still holds the area this page opened with. Everything that
  // explains where that area came from is gated on it: once the planner picks
  // somewhere else, the explanation describes a boundary that is gone.
  const inheritedAreaIsCurrent =
    studyArea.origin !== "none" &&
    studyArea.corridorText !== "" &&
    corridorText === studyArea.corridorText;

  // Bounding box of the user's selection, or null until they pick one.
  const bbox = useMemo(() => {
    const summary = summarizeCorridorText(corridorText);
    if (!summary.valid || !summary.bbox) return null;
    return summary.bbox;
  }, [corridorText]);

  /**
   * The framing bbox as a tuple — MEMOIZED, and that is not a micro-optimisation.
   *
   * This was rebuilt on every render. The map frames on `[bbox]`, so a fresh
   * array identity meant `fitBounds` ran after EVERY render of this component —
   * which on a page with a filter panel, a study-area picker and a loading flag
   * is constantly. Two consequences, one of which was invisible until
   * 2026-08-13:
   *
   *   1. The camera was snapped back to the study area whenever anything on this
   *      page changed, so a planner who zoomed into an intersection lost it on
   *      the next filter press.
   *   2. Once anything subscribed to the map's `moveend` — which is exactly what
   *      `useWorkspaceGisMapBinding` does, to know which window to read the
   *      agency's layers for — it became an infinite loop: render → fitBounds →
   *      moveend → setState → render. React caught it as "Maximum update depth
   *      exceeded", 176 times in one page load.
   *
   * The second is the reason this is written down. The bug was already here and
   * cost nothing observable; the fix that made the page correct in every other
   * way is what turned it into a hang. A latent identity bug is a trap laid for
   * whoever touches the file next.
   */
  const mapBbox = useMemo<[number, number, number, number] | null>(
    () => (bbox ? [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat] : null),
    [bbox]
  );

  // Only a California COUNTY selection yields a lossless county filter. A city,
  // metro, drawn area, or out-of-state pick falls back to bbox-only, where
  // reported and mappable totals are equal by construction.
  const countyCode = useMemo(
    () => (place?.kind === "county" ? ccrsCountyCodeFromGeoid(place.geoid) : null),
    [place]
  );

  const loadCrashes = useCallback(async () => {
    if (!bbox) {
      setResponse(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId,
        minLon: String(bbox.minLon),
        minLat: String(bbox.minLat),
        maxLon: String(bbox.maxLon),
        maxLat: String(bbox.maxLat),
      });
      if (projectId) params.set("projectId", projectId);
      // The coverage banner describes one acquisition, so every point and
      // every exact count beside it must come from that same acquisition.
      // Without this id, overlapping county and project pulls were added
      // together while the banner named only the newest pull.
      if (ingest?.id) params.set("ingestId", ingest.id);
      // PlaceBoundaryResponse is produced only by the registered US Census
      // resolver. Drawn or uploaded geometry carries no country assertion, so
      // it does not activate the US-only road adapter.
      if (place) params.set("roadContextCountry", "US");
      // Serialized from the same declaration the route parses back, so a facet
      // cannot be sent under a name the route does not read.
      for (const [key, value] of crashFilterSearchParams(filters)) params.set(key, value);

      const res = await fetch(`/api/safety/crashes?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load crash data");
      }
      setResponse((await res.json()) as SafetyCrashQueryResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load crash data");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, filters, bbox, projectId, place, ingest?.id]);

  useEffect(() => {
    void loadCrashes();
  }, [loadCrashes]);

  // The rolling window every crash lane asks for, from the one shared helper.
  // It was a hardcoded `[2025, 2024, 2023, 2022, 2021]` here — already stale
  // when written, and silently wrong from each January onward — while the
  // corridor scorecard derived its window from the clock. The two lanes read the
  // same registry, so they must ask it the same question.
  const years = useMemo(() => recentCrashYears(), []);

  const runIngest = useCallback(async () => {
    if (!bbox) return;
    setIngesting(true);
    setError(null);
    try {
      const res = await fetch("/api/safety/crashes/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          bbox,
          years,
          ...(countyCode === null ? {} : { countyCode }),
          ...(projectId === "" ? {} : { projectId }),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Crash ingest failed");

      // A LIVE READ is a different outcome from an acquisition, and is kept as
      // one all the way to the screen. It writes no acquisition row, so it must
      // not enter the acquisition history or the stored-coverage banner — a
      // history entry for crashes no table holds would send a planner looking
      // for data that was never there.
      if (body.status === "read_only") {
        const collection =
          body.crashes && Array.isArray(body.crashes.features)
            ? (body.crashes as SafetyCrashCollection)
            : ({ type: "FeatureCollection", features: [] } as SafetyCrashCollection);
        const count = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
        setLiveRead({
          sourceLabel: typeof body.sourceLabel === "string" ? body.sourceLabel : "Unnamed source",
          attribution: typeof body.attribution === "string" ? body.attribution : null,
          coverageState:
            typeof body.coverageState === "string" ? body.coverageState : "source_unavailable",
          severityCompleteness:
            typeof body.severityCompleteness === "string" ? body.severityCompleteness : "fatal_only",
          crashCount: count(body.crashCount),
          geocodedCount: count(body.geocodedCount),
          truncated: Boolean(body.truncated),
          yearsRequested: years,
          yearsCovered: Array.isArray(body.yearsCovered) ? (body.yearsCovered as number[]) : [],
          publishedThrough: typeof body.publishedThrough === "string" ? body.publishedThrough : null,
          publishedThroughProvenance:
            body.publishedThroughProvenance && typeof body.publishedThroughProvenance === "object"
              ? body.publishedThroughProvenance as Record<string, unknown>
              : null,
          collection,
          retrievedAt: new Date().toISOString(),
          // Carried even though a live read stores nothing: the SAME filter
          // panel renders both lanes, so without it the panel would offer a
          // fatality census facets it cannot answer and show the empty result as
          // if it were a finding.
          dimensionCoverage: body.dimensionCoverage,
        });
        return;
      }

      // Anything else is an acquisition attempt, so a stale live read from a
      // previous study area must not survive alongside it.
      setLiveRead(null);

      // Normalize at the boundary. The banner renders these directly, so a
      // malformed or unexpected response body must not be able to white-screen
      // the page (an absent count would throw on .toLocaleString()).
      const count = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
      const summary: SafetyIngestSummary = {
        id: String(body.ingestId ?? ""),
        sourceLabel: typeof body.sourceLabel === "string" ? body.sourceLabel : null,
        attribution: null,
        coverageState: typeof body.coverageState === "string" ? body.coverageState : "source_unavailable",
        severityCompleteness:
          typeof body.severityCompleteness === "string" ? body.severityCompleteness : "fatal_injury_only",
        status: typeof body.status === "string" ? body.status : "failed",
        crashCount: count(body.crashCount),
        geocodedCount: count(body.geocodedCount),
        truncated: Boolean(body.truncated),
        yearsRequested: years,
        publishedThrough: typeof body.publishedThrough === "string" ? body.publishedThrough : null,
        publishedThroughProvenance:
          body.publishedThroughProvenance && typeof body.publishedThroughProvenance === "object"
            ? body.publishedThroughProvenance as Record<string, unknown>
            : null,
        fetchError: typeof body.error === "string" ? body.error : null,
        createdAt: new Date().toISOString(),
        // What the resolver actually consulted. Present only on a fresh
        // retrieval — the acquisition row does not store it — so a coverage gap
        // can name what was checked instead of asserting nothing exists.
        checkedSourceLabels: Array.isArray(body.checkedSources)
          ? (body.checkedSources as Array<{ label?: unknown }>)
              .map((entry) => (typeof entry?.label === "string" ? entry.label : null))
              .filter((label): label is string => Boolean(label))
          : undefined,
        dimensionCoverage: body.dimensionCoverage,
        partyCompleteness:
          typeof body.partyCompleteness === "string" ? body.partyCompleteness : undefined,
        // Null, not zero, whenever people were not retrieved. A zero would say
        // the collisions involved nobody.
        partyCount: typeof body.partyCount === "number" ? body.partyCount : null,
        involvementBasis:
          typeof body.involvementBasis === "string" ? body.involvementBasis : null,
      };
      setIngest(summary);
      setHistory((current) => [
        {
          id: summary.id,
          projectId: projectId === "" ? null : projectId,
          sourceLabel: summary.sourceLabel,
          coverageState: summary.coverageState,
          status: summary.status,
          crashCount: summary.crashCount,
          geocodedCount: summary.geocodedCount,
          yearsRequested: years,
          publishedThrough: summary.publishedThrough,
          publishedThroughProvenance: summary.publishedThroughProvenance,
          /*
            The extent this pull just used. The server records it; this row is
            built client-side, so without it the acquisition a planner has THIS
            SECOND created would be the one entry in the list with no area — the
            worst possible omission, since it is the one they are looking at.
          */
          scope: bbox
            ? {
                minLon: bbox.minLon,
                minLat: bbox.minLat,
                maxLon: bbox.maxLon,
                maxLat: bbox.maxLat,
                countyCode: null,
              }
            : null,
          createdAt: summary.createdAt,
        },
        ...current.filter((entry) => entry.id !== summary.id),
      ]);
      await loadCrashes();
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : "Crash ingest failed");
    } finally {
      setIngesting(false);
    }
  }, [workspaceId, loadCrashes, bbox, countyCode, projectId, years]);

  // Every acquisition and response belongs to the area it was retrieved for
  // and to no other. Keep the matching server-provided acquisition on initial
  // render, then clear all area-bound evidence whenever the picker moves.
  // Otherwise a California banner can sit above an Ohio boundary until the new
  // request finishes — a false current-geography claim even if no point moves.
  useEffect(() => {
    if (previousCorridorTextRef.current === corridorText) return;
    previousCorridorTextRef.current = corridorText;
    setLiveRead(null);
    setIngest(null);
    setResponse(null);
  }, [corridorText]);

  // The points actually on screen. A live read supplies its own, filtered here
  // because they never passed through the query route that filters stored ones.
  const visibleFeatures: SafetyCrashFeature[] = useMemo(
    () =>
      liveRead
        ? filterLiveCrashFeatures(liveRead.collection.features, filters)
        : (response?.features ?? []),
    [liveRead, response, filters]
  );

  // Which of the requested years the source actually answered with records.
  // Computed even when there is no live read so the hook order never varies.
  const liveYears = useMemo(
    () => splitLiveReadYears(liveRead?.yearsRequested ?? [], liveRead?.yearsCovered ?? []),
    [liveRead]
  );

  const facetCounts = useMemo(() => countFacetValues(visibleFeatures), [visibleFeatures]);
  const severityCounts = facetCounts.severity ?? {};

  const collection: SafetyCrashCollection | null =
    liveRead || response ? { type: "FeatureCollection", features: visibleFeatures } : null;

  // The coverage declaration of whichever source produced the points ON SCREEN.
  // Read off the live read first for the same reason `activeCompleteness` is: a
  // stale acquisition's capability describing a fatality census's points would
  // offer facets that source has no field for.
  const activeDimensionCoverage = liveRead
    ? liveRead.dimensionCoverage
    : (ingest?.dimensionCoverage ?? undefined);

  /**
   * The source behind the points ON SCREEN, by name, or null when none has
   * answered yet.
   *
   * Live read first, for the same reason `activeCompleteness` and
   * `activeDimensionCoverage` read that way: a stale acquisition's label
   * describing a live fatality census's points would attribute one source's
   * data to another. `checkedSourceLabels` is deliberately NOT used as a
   * fallback — those are the sources that were consulted, which on a
   * `no_coverage` result is precisely the list of sources that did NOT answer,
   * and naming one of them as though it had would be the strongest version of
   * the falsehood this whole module is built to avoid.
   */
  const activeSourceLabel: string | null =
    liveRead?.sourceLabel ??
    (ingest && ingest.status !== "no_coverage" ? (ingest.sourceLabel ?? null) : null);

  // Is there anything to filter? A planner in a state with no adapter must be
  // told that, not shown a panel of controls that can only return nothing.
  const sourceConfigured = Boolean(liveRead) || Boolean(ingest && ingest.status !== "no_coverage");

  const selectedCrash = useMemo(
    () => visibleFeatures.find((feature) => feature.properties.id === selectedCrashId) ?? null,
    [visibleFeatures, selectedCrashId]
  );

  // Collisions ON SCREEN the source never classified. The study-area equivalent
  // is `unclassifiedTotal` below; which of the two a sentence may use depends on
  // which lane produced the points, so they are paired with their scope in
  // `unclassifiedScope` rather than handed to a renderer as a bare number.
  const unclassifiedVisible = severityCounts.unknown ?? 0;

  const geocodingNote = ingest
    ? describeGeocodingShortfall(ingest.crashCount, ingest.geocodedCount)
    : null;

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );

  // The completeness of the source behind the points ON SCREEN, which is the
  // live read whenever there is one. Reading it off `ingest` would let a stale
  // acquisition's `kabco_full` describe a fatality census's points and produce a
  // KSI figure from crashes whose source never recorded an injury.
  const activeCompleteness = liveRead ? liveRead.severityCompleteness : ingest?.severityCompleteness;

  /**
   * ═══ THE HEADLINE COUNTS THE STUDY AREA, NOT THE DOTS ═══
   *
   * WHAT WAS WRONG. This figure was `severityCounts.fatal + .severe_injury`,
   * added up from `visibleFeatures` — the crashes the query route RETURNED. That
   * query is capped (PostgREST `max_rows`), and a real run drew 1,000 crashes
   * against 11,870 matching the study area, so the headline understated by
   * roughly an order of magnitude. A planner glancing at this can copy it into
   * a grant application, so its unit must be explicit: these are CRASH RECORDS,
   * not a count of people killed or injured.
   *
   * WHAT IT IS NOW. `severityTotals` from the route: one exact count per band
   * over every crash the current filters match, counted in Postgres through the
   * same filter closure that built the row query. The map's own count stays on
   * screen beside it as "showing N of M", so both numbers are visible and each
   * says what it is. There is deliberately NO TOGGLE between the two readings —
   * a figure whose meaning depends on invisible state is the same defect in a
   * new coat, and this is the number that ends up in a funding application.
   *
   * `null` NEVER BECOMES A ZERO. Three separate things make it null, and each
   * one produces a sentence instead of a figure: a source that cannot separate
   * suspected serious injury (fatal crashes plus a fabricated zero for serious-
   * injury crashes reads as "none occurred"), a band the database could not
   * count, and a live read — whose
   * crashes are in this browser and were never counted by anything.
   */
  const studyAreaSeverityTotals = liveRead ? null : (response?.severityTotals ?? null);

  const ksiTotal = useMemo(() => {
    if (!studyAreaSeverityTotals) return null;
    if (!separatesSeriousInjuries(activeCompleteness ?? "")) return null;
    let total = 0;
    for (const band of CRASH_KSI_SEVERITIES) {
      const count = studyAreaSeverityTotals[band];
      // A band the response did not carry is not a band with nothing in it.
      if (typeof count !== "number") return null;
      total += count;
    }
    return total;
  }, [studyAreaSeverityTotals, activeCompleteness]);

  /**
   * Collisions in the WHOLE study area the source never classified.
   *
   * This travels with the severe-crash figure and is rendered in the same block, never in
   * a paragraph further down. It is the qualification that makes the figure
   * defensible: a collision whose casualty counts the source never supplied may
   * or may not have been a severe crash, so the total is a floor rather than a count. A
   * number separated from that sentence is a claim nobody can defend, and this
   * one feeds RTP chapters and grant narratives.
   */
  const unclassifiedTotal =
    studyAreaSeverityTotals && typeof studyAreaSeverityTotals.unknown === "number"
      ? studyAreaSeverityTotals.unknown
      : null;

  // True when the route counted the study area and the source simply cannot
  // separate serious-injury crashes — distinct from "the counts could not be read", which gets its
  // own sentence rather than silence.
  const severityTotalsUnavailable =
    !liveRead && Boolean(response) && studyAreaSeverityTotals === null;

  /**
   * The unclassified count AND the population it is a count OF, together.
   *
   * The study-area total is the honest one wherever the route could count it. A
   * live read has only the visible count, because its crashes are in this
   * browser and Postgres never saw them. Pairing the number with its scope is
   * what stops one denominator being described in the words of the other — the
   * exact mistake the KSI headline was making before it counted the study area.
   */
  const unclassifiedScope: { count: number; whole: boolean } =
    unclassifiedTotal !== null
      ? { count: unclassifiedTotal, whole: true }
      : { count: unclassifiedVisible, whole: false };

  /**
   * ═══ THE MAP IS THE PAGE NOW, AND THE READING GOES IN A SIDEBAR ═══
   *
   * WHAT THIS REPLACED. Safety was a stack of cards in a scrolling column with
   * a 520px-tall map two thirds of the way down it. On the 1366×768 laptops
   * planners actually use, the map was a letterbox below the fold on a page
   * whose entire subject is where the collisions are; every filter press meant
   * scrolling up, and every result meant scrolling back down. This is the same
   * shape the public portal was rebuilt into: a map that fills the surface, and
   * one column beside it carrying everything you do to the map.
   *
   * NOTHING WAS DROPPED, AND THAT IS THE PART THAT MATTERED MOST. Safety's
   * caveats are load-bearing for the RTP and grant lanes — the live-read
   * warning, the fatality-census warning, the severity-completeness warning, the
   * geocoding shortfall, the property-damage comparability sentence, the
   * unclassified-severity sentence, the silent-years disclosure, the undrawable
   * count, the "not evidence that no crashes occurred" sentences. Every one of
   * them is still rendered, still attached to the figure it qualifies, and
   * moving a panel must never be allowed to separate the two.
   *
   * WHAT NO TEST OF THIS FILE CAN PROVE. jsdom applies no stylesheet, has no box
   * model and does not run Mapbox GL, so "the map fills the surface" and "the
   * sidebar scrolls on its own" are browser facts. They were looked at in a real
   * browser at desktop width and at 390×844; the tests here can only prove that
   * every panel and every caveat is present and reachable.
   */
  const selectedCollisionCard = (
    <>
      {/* THE PER-COLLISION RECORD, FIRST IN THE COLUMN — because it is the
          answer to the click a planner just made on the map beside it. Every
          dimension appears, including the ones the source said nothing about: a
          row reading "not reported for this collision" and a row reading "this
          source does not record it" are different facts, and a blank slot would
          be read as neither. */}
      {selectedCrash && (
        <section className="rounded-lg border p-4 text-sm" aria-label="Selected collision">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              {SEVERITY_LABELS[selectedCrash.properties.severity]} collision
            </h2>
            <button
              type="button"
              onClick={() => setSelectedCrashId(null)}
              className="rounded-md border px-2 py-1 text-xs"
            >
              Close
            </button>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1">
            <CrashDetailLine
              label="Date"
              value={
                selectedCrash.properties.collisionDate ??
                (selectedCrash.properties.collisionYear !== null
                  ? String(selectedCrash.properties.collisionYear)
                  : "not reported")
              }
              muted={selectedCrash.properties.collisionDate === null}
            />
            {/* Never a zero for a count the source did not supply. */}
            <CrashDetailLine
              label="People killed"
              value={describeCasualty(selectedCrash.properties.killedCount)}
              muted={selectedCrash.properties.killedCount === null}
            />
            <CrashDetailLine
              label="People injured"
              value={describeCasualty(selectedCrash.properties.injuredCount)}
              muted={selectedCrash.properties.injuredCount === null}
            />
            {describeCrashDimensions(
              selectedCrash.properties as unknown as Record<string, unknown>,
              activeDimensionCoverage
            ).map((row) => (
              <CrashDetailLine
                key={row.label}
                label={row.label}
                value={row.value}
                muted={row.state !== "reported"}
              />
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Source record {selectedCrash.properties.externalId} from{" "}
            {selectedCrash.properties.sourceId}. Fields shown as not reported are absent from the
            source record, not zero.
          </p>
        </section>
      )}
    </>
  );

  return (
    /*
      `flex-1 min-h-0`, NOT `h-full`. This component is one child of a page that
      may also be carrying read-failure and study-area notices above it, and
      `h-full` would claim the whole surface for itself and push those notices
      off the bottom. `min-h-0` is the half that is easy to forget: without it a
      flex child refuses to shrink below its content, the sidebar stops
      scrolling, and the map goes back to being a letterbox.
    */
    <div className="flex min-h-0 flex-1 flex-col" data-testid="safety-map-first">
      {/* Both render nothing. The first lets the map fill the route surface
          (see the component for the 340px it reclaims); the second answers the
          Data Hub's "Show on the map" link, which the shell used to answer and
          cannot any more now that this route owns its map. */}
      <SafetyMapFillsSurface />
      <SafetyLayerDeepLink onFocus={setMapFocus} />

      {/*
        THE SHELL, AND IT IS TWO DIFFERENT LAYOUTS ON PURPOSE.

        FROM `lg` UP: one row that never scrolls — the map takes all the height
        the surface has, and the sidebar scrolls inside itself beside it. That is
        the shape a planner works in, and the map stops being a letterbox.

        BELOW `lg`: one column that DOES scroll, with the map a fixed 16rem at
        the top. This was measured rather than guessed. At 390×844 the shell gets
        about 386px in total — the app's own chrome takes the rest — and splitting
        that between a map and a scrolling sidebar gave the map 240px and the
        sidebar 146px against 2,697px of content: a 24px-tall scroll window, which
        is not a usable control panel by any reading. A phone gets the map first
        and the controls under it, one scroll, everything reachable.
      */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border lg:flex-row lg:overflow-hidden"
        data-testid="safety-map-first-shell"
      >
        <div
          /*
            PHONE HEIGHT IS A SHARE OF THE SCREEN, NOT A FIXED 16rem.

            16rem is 256px, which on a 390×844 phone measured 27.5% of the
            window — a map-first page whose map was a quarter of it. The column
            below scrolls (measured: 1181px of sidebar in a scrolling parent),
            so height taken here costs the controls nothing but a scroll. `svh`,
            not `vh`: mobile browser chrome is inside `vh`, and 45vh overflows on
            exactly the device this branch exists for. The 16rem floor keeps the
            old behaviour on a short window (a landscape phone, a split screen)
            where 45% of the height is less than the map needs to be a map.
          */
          className="relative h-[max(16rem,45svh)] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1"
          data-testid="safety-map-stage"
        >
          <SafetyCrashMap
            collection={collection}
            bbox={mapBbox}
            // Empty only when this deployment has no usable map key, in which
            // case the map component draws its own notice and never reads this.
            styleUrl={selectedBasemap?.styleUrl ?? ""}
            onSelect={setSelectedCrashId}
            // The seam that makes this the only map on the page: the instance
            // goes up to `useWorkspaceGisMapBinding` above, and the camera
            // request from the Data Hub link comes back down.
            onMapReady={handleMapReady}
            focus={mapFocus}
            onFocusApplied={() => setMapFocus(null)}
          />

          {/* The background picker, docked over the map. Top-LEFT, because
              Mapbox's own zoom and compass buttons are top-right; two controls
              in one corner is how a map ends up with no map left. It renders
              nothing at all when the deployment offers fewer than two
              backgrounds.

              THE LEFT OFFSET CLEARS THE NAV RAIL. Since the surface runs to the
              left edge of the window on this route, the rail no longer sits in a
              column of its own — it floats over the map's left margin. A control
              at `left-3` would be underneath it (the rail is z-40 in the shell,
              this is z-10 inside a z-20 surface, so the rail wins and the picker
              is simply gone). `--op-cart-rail-edge` is the shell's own derived
              answer for where the collapsed rail stops; the `0px` fallback is
              what a render outside the cartographic shell — a test, a future
              embed — gets, and it restores the plain `left-3` position. */}
          <div
            className="pointer-events-none absolute top-3 z-10 flex flex-col gap-2"
            style={{
              left: "calc(var(--op-cart-rail-edge, 0px) + 0.75rem)",
              // The width has to pay for the offset AND for Mapbox's own zoom
              // and compass stack on the right — measured 40px plus its margin.
              // Without the second term, a 390px phone put a 15rem pill straight
              // through the ＋/− buttons.
              width: "min(15rem, calc(100% - var(--op-cart-rail-edge, 0px) - 4.25rem))",
            }}
          >
            <PublicBasemapPicker
              className="pointer-events-auto"
              choices={basemapChoices}
              selectedId={selectedBasemap?.id ?? "streets"}
              onSelect={(choice) => setBasemapId(choice.id)}
            />
          </div>

          {/* Docked over the map on a screen with room for it; the column below
              carries the same key on anything smaller.

              BOTTOM-RIGHT, NOT BOTTOM-LEFT. The bottom-left corner of a
              full-bleed map is where the shell's account card floats (fixed,
              z-30), and the key would have been half underneath it. The right
              side of the map is the sidebar's edge and is otherwise empty;
              `bottom-8` keeps it clear of Mapbox's attribution strip. */}
          <CrashSeverityKey className="pointer-events-none absolute bottom-8 right-3 z-10 hidden max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-background/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm lg:flex" />
        </div>

        {/* THE SIDEBAR. Everything a planner does to the map, in the order they
            do it: what they just clicked, where they are looking, what the
            source does and does not cover, the filters, and what is on screen
            right now. It scrolls on its own so the map never moves. */}
        <aside
          // `shrink-0` in BOTH directions. Below `lg` this is a row of a
          // scrolling column and a flex child that may shrink collapses to a
          // fraction of its content (measured: a 203px header inside a 69px
          // box); from `lg` it is the fixed-width column beside the map.
          className="flex shrink-0 flex-col border-t lg:h-full lg:min-h-0 lg:w-[27rem] lg:border-l lg:border-t-0"
          aria-label="Crash data controls"
          data-testid="safety-sidebar"
        >
          {/*
            THE MODULE HEADER LIVES AT THE TOP OF THE SIDEBAR, NOT ABOVE THE MAP.

            Measured in a real browser at 1600×900: as a full-width card above
            the shell it was 247px tall — a 44px display title, a description and
            the action row — and it left the map 210px, which is the letterbox
            this rebuild was supposed to end. Pinned here it costs the map
            nothing, and the primary action is still the first thing in the top
            corner of the panel rather than something found by scrolling.

            It keeps `.module-intro-card` / `.module-intro-actions` /
            `.module-intro-action`, because those classes are the product's one
            header-action pattern and `every-module-has-one-primary-header-action`
            walks up from the button to find them. The utilities beside them
            re-tune it for a 27rem column: Tailwind's utility layer wins over the
            component layer, so `p-4` and `text-xl` override the card's 1.8rem
            padding and its clamp(2rem,3vw,2.8rem) title without touching a
            shared stylesheet that twenty other modules render.
          */}
          <header className="module-intro-card shrink-0 rounded-none border-0 border-b p-4">
            <div className="module-intro-body mt-0">
              <h1 className="module-intro-title text-xl">Safety</h1>
              <p className="module-intro-description text-xs">
                Reported crashes for the study area, retrieved from the source agency.
              </p>
            </div>
            {/* Safety's primary action was already near the top of its page, but in
                one-off markup of its own — the only module whose header action was
                not the shared slot. Two patterns means two things to keep working,
                so this is the same `.module-intro-actions` every other module now
                uses. The project selector rides in the slot beside the button
                because the attachment is part of the same press: choosing a project
                after the retrieval attaches nothing. */}
            <div className="module-intro-actions mt-3">
              {projects.length > 0 && (
                <form action="/safety" method="get" className="min-w-0 flex-1">
                  <label className="flex min-w-0 flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Project context (optional)</span>
                  <select
                    name="projectId"
                    value={projectId}
                    onChange={(event) => {
                      setProjectId(event.target.value);
                      event.currentTarget.form?.requestSubmit();
                    }}
                    disabled={ingesting}
                    className="rounded-md border px-2 py-2 text-sm"
                    aria-label="Project for this crash import"
                  >
                    <option value="">No project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  </label>
                </form>
              )}
              <button
                type="button"
                onClick={() => void runIngest()}
                disabled={ingesting || !bbox}
                className="module-intro-action"
              >
                {ingesting ? "Retrieving crashes…" : "Retrieve crash data"}
              </button>
            </div>
            {ingesting ? (
              <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                The source is still working ({ingestElapsedSeconds}s elapsed). Large areas can take
                a minute or two; keep this page open. OpenPlan will show a source error if the request fails.
              </p>
            ) : null}
          </header>

          {/* `overflow-y-auto` only from `lg`: on a phone this column is part of
              the one page scroll, and a nested scroll region inside it is how a
              panel ends up with a 24px window. */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:overflow-y-auto">
            <CrashSeverityKey className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground lg:hidden" />

            {selectedCollisionCard}

            {/* The agency's own uploaded layers, driving the map beside this
                column. It used to be the shell's panel, docked at the right
                edge of the window, driving the backdrop behind the page — see
                the component's header for what that measured. */}
            <SafetyWorkspaceLayersPanel />

      {/* Study area — the app's single geography front door, reused, not reinvented. */}
      <section className="rounded-lg border p-4" aria-label="Study area">
        <h2 className="mb-2 text-sm font-medium">Study area</h2>
        <StudyAreaPicker
          corridorText={corridorText}
          onCorridorChange={setCorridorText}
          onPlaceResolved={setPlace}
          // Only while the inherited area is still the one in the box. The
          // moment a planner changes it, naming the OLD area would be labelling
          // a boundary that is no longer on screen.
          externalLabel={inheritedAreaIsCurrent ? studyArea.originLabel : null}
        />
        {inheritedAreaIsCurrent && (
          <p className="mt-2 text-xs text-muted-foreground">
            {/* Composed from `origin` rather than printed from `originLabel`,
                because `originLabel` collapses to the place NAME whenever the
                place has one. That says WHICH area is loaded but not WHY it is
                this one — and on this page the difference is the whole point: a
                county and a corridor inside it look equally plausible in the
                picker, and retrieving crashes for the wrong one of the two is
                not visible in the result. */}
            {studyArea.origin === "project" ? (
              <>
                Starting from the study area set on{" "}
                {openedForProject ? (
                  <Link
                    href={`/projects/${openedForProject.id}`}
                    className="underline underline-offset-2"
                  >
                    {openedForProject.name ?? "this project"}
                  </Link>
                ) : (
                  "this project"
                )}
                {studyArea.label ? <> ({studyArea.label})</> : null}.
              </>
            ) : studyArea.origin === "workspace_home" ? (
              <>
                Starting from this workspace&rsquo;s home geography
                {studyArea.label ? <> ({studyArea.label})</> : null}.
              </>
            ) : (
              <>Starting from {studyArea.originLabel}.</>
            )}{" "}
            Search or draw above to analyze somewhere else — this does not change the source.
          </p>
        )}
        {bbox && countyCode === null && (
          /* NO JURISDICTION IS NAMED HERE. This said "Pick a California county"
             to every workspace in the product — a Columbus, Ohio planner was
             told to pick a county in a state they do not work in. The limit is
             real (only a source publishing a county field can return the
             crashes it never geolocated) and it belongs to the SOURCE, so the
             sentence is composed from whichever source has actually answered
             for this study area. Before one has, it says only the half it can
             stand behind. */
          <p className="mt-2 text-xs text-muted-foreground" data-testid="safety-county-option-note">
            {describeUngeocodedCountyOption(activeSourceLabel)}
          </p>
        )}
      </section>

      {/* Coverage banner — source, attribution, and what the data does NOT establish. */}
      <section className="rounded-lg border p-4 text-sm" aria-label="Crash data coverage">
        {liveRead ? (
          /* A LIVE READ. Deliberately its own branch rather than a variant of
             the acquisition banner: every number here describes data that is in
             this browser and nowhere else, and the sentence that says so has to
             sit next to the counts, not under them. */
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{liveRead.sourceLabel}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {liveRead.crashCount.toLocaleString()} reported ·{" "}
                {liveRead.geocodedCount.toLocaleString()} mappable
              </span>
              <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                Live read — not saved
              </span>
            </div>
            <p className="text-muted-foreground">
              {COVERAGE_STATE_COPY[liveRead.coverageState] ?? liveRead.coverageState}
            </p>
            <p className="text-muted-foreground">{SAFETY_LIVE_READ_CAVEAT}</p>
            <p className="text-muted-foreground">
              {liveRead.publishedThrough
                ? `The source states that its published data runs through ${liveRead.publishedThrough}.`
                : "The source supplied no exact publication cutoff; requested and returned years are not substitutes."}
              <CutoffProvenanceLink provenance={liveRead.publishedThroughProvenance} />
            </p>
            {liveRead.severityCompleteness === "fatal_only" && (
              <p className="text-muted-foreground">{SAFETY_FATAL_ONLY_CAVEAT}</p>
            )}
            {liveRead.severityCompleteness === "fatal_injury_only" && (
              <p className="text-muted-foreground">{SAFETY_SEVERITY_COMPLETENESS_CAVEAT}</p>
            )}
            {/* WHICH YEARS ACTUALLY ANSWERED. The counts above are a total over
                the years that came back, not over the years that were asked for,
                and those are routinely different — see `splitLiveReadYears`. A
                planner told "12 fatal crashes" for a four-year window has been
                told something false if two of those years returned nothing. */}
            {liveYears.silent.length > 0 && (
              <p className="text-muted-foreground">
                {liveYears.answered.length > 0
                  ? `Records came back for ${liveYears.answered.join(", ")}, and the counts above cover only ${liveYears.answered.length === 1 ? "that year" : "those years"}. `
                  : "No records came back for any year requested. "}
                {`The source returned nothing for ${liveYears.silent.join(", ")}. That may mean no qualifying crashes were reported, that none could be mapped, or that the source has not published ${liveYears.silent.length === 1 ? "that year" : "those years"} yet — it is not evidence that no crashes occurred.`}
              </p>
            )}
            {liveRead.truncated && (
              <p className="text-muted-foreground">
                Retrieval stopped at the record cap, so this is a partial extract of the study area.
              </p>
            )}
          </div>
        ) : ingest ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{ingest.sourceLabel ?? "No source"}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {ingest.crashCount.toLocaleString()} reported ·{" "}
                {ingest.geocodedCount.toLocaleString()} mappable
              </span>
            </div>
            <p className="text-muted-foreground">
              {COVERAGE_STATE_COPY[ingest.coverageState] ?? ingest.coverageState}
            </p>
            <p className="text-muted-foreground">
              {ingest.publishedThrough
                ? `The source states that its published data runs through ${ingest.publishedThrough}.`
                : "The source supplied no exact publication cutoff; requested and returned years are not substitutes."}
              <CutoffProvenanceLink provenance={ingest.publishedThroughProvenance} />
            </p>
            {/* Name what was consulted. A coverage gap that can list the sources
                it checked is a far more useful — and more falsifiable — statement
                than one that only asserts a gap, and it is the disclosure that
                stops "no source covers you" reading as "we did not look". */}
            {ingest.checkedSourceLabels && ingest.checkedSourceLabels.length > 0 && (
              <p className="text-muted-foreground">
                Sources checked for this study area: {ingest.checkedSourceLabels.join(", ")}.
              </p>
            )}
            {/* COMPUTED FROM THIS EXTRACT, not from a constant. The geocoded
                share is wildly local — 77.7% statewide and 99.6% in one rural
                county of the same state, probed the same day — so a fixed
                percentage would describe almost no real acquisition correctly.
                The acquisition row already stores both counts. */}
            {geocodingNote && <p className="text-muted-foreground">{geocodingNote}</p>}
            {/* ═══ THE HEADLINE, AND EVERYTHING THAT QUALIFIES IT, IN ONE BLOCK ═══

                The figure, what it counts, how much of it the map is drawing,
                and how many collisions the source never classified — together,
                because a number that has to be read alongside a paragraph
                elsewhere on the page is a number that will be quoted alone. */}
            {ksiTotal !== null && (
              <div data-testid="safety-ksi-headline" className="flex flex-col gap-1">
                <p>
                  <span className="font-medium">
                    {ksiTotal.toLocaleString()} fatal or serious-injury crashes
                  </span>{" "}
                  <span className="text-muted-foreground">
                    across the whole area you picked, with these filters. This counts crash
                    records by their most severe reported outcome, not people killed or injured.
                  </span>
                </p>
                {response && (
                  /* THE MAP'S OWN COUNT, BESIDE THE TOTAL. Two numbers, each
                     saying what it is. The figure above is counted in the
                     database; this one is what fits on the map. */
                  <p className="text-xs text-muted-foreground">
                    {`The map is drawing ${response.returnedCount.toLocaleString()} of ${
                      response.matchedCountIsExact === false ? "at least " : ""
                    }${response.matchedCount.toLocaleString()} matching crashes. The figure above counts all of them, not just the dots.`}
                  </p>
                )}
                {unclassifiedTotal !== null && unclassifiedTotal > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {`${unclassifiedTotal.toLocaleString()} of those crashes are in no severity band at all, so the figure above is a floor rather than a full count. `}
                    {SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT}
                  </p>
                )}
              </div>
            )}
            {response && !separatesSeriousInjuries(activeCompleteness ?? "") ? (
              <p className="text-muted-foreground">{SAFETY_KSI_COVERAGE_UNAVAILABLE}</p>
            ) : <>
            {Array.isArray(response?.ksiConcentrations) && response.ksiConcentrations.length > 0 ? (
              <section className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <h2 className="text-sm font-semibold">Highest observed KSI concentrations</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ranked from every stored fatal and serious-injury crash in this selected area,
                  not only the dots the map can draw. A concentration is two or more crashes within
                  150 meters. It is screening evidence, not an intersection, corridor, rate, causal
                  finding, or High Injury Network.
                </p>
                <ol className="mt-2 space-y-2">
                  {response.ksiConcentrations.map((concentration) => (
                    <li key={`${concentration.rank}:${concentration.longitude}:${concentration.latitude}`} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/60 p-2 text-xs">
                      <div>
                        <p className="font-semibold">
                          {concentration.rank}. {concentration.crashCount.toLocaleString()} KSI crashes
                        </p>
                        <p className="text-muted-foreground">
                          {concentration.fatalCrashCount.toLocaleString()} fatal · {concentration.seriousInjuryCrashCount.toLocaleString()} serious injury
                        </p>
                        <p className="font-mono text-muted-foreground">
                          {concentration.latitude.toFixed(5)}, {concentration.longitude.toFixed(5)}
                        </p>
                        {concentration.roadIdentity?.status === "matched" ? (
                          <p className="text-muted-foreground">
                            Nearest named road: <strong className="text-foreground">{concentration.roadIdentity.name}</strong>
                            {` · ${concentration.roadIdentity.matchQuality} match, ${concentration.roadIdentity.distanceMeters} m · ${concentration.roadIdentity.sourceLabel} ${concentration.roadIdentity.vintage}`}
                          </p>
                        ) : (
                          <p className="text-muted-foreground">
                            Road identity unavailable. The coordinates above remain the source location.
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className="shrink-0 font-semibold underline underline-offset-2"
                        aria-label={`Show concentration ${concentration.rank} on map`}
                        onClick={() => setMapFocus({ kind: "center", center: [concentration.longitude, concentration.latitude] })}
                      >
                        Show on map
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            ) : response?.ksiConcentrations === null ? (
              <p className="text-muted-foreground">
                OpenPlan could not rank severe-crash concentrations for this area. The crash points
                and totals above still loaded; this location ranking did not.
              </p>
            ) : response && Array.isArray(response.ksiConcentrations) && response.ksiConcentrations.length === 0 ? (
              <p className="text-muted-foreground">
                No pair of stored fatal or serious-injury crashes fell within the 150-meter
                screening radius. That is not a finding that the area is safe.
              </p>
            ) : null}
            {Array.isArray(response?.ksiEquityTracts) && response.ksiEquityTracts.length > 0 ? (
              <section className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <h2 className="text-sm font-semibold">Community burden screen</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The same mapped KSI crashes are grouped by Census tract and ranked by observed
                  count. Demographics come from {response.ksiEquityDemographicSource.label} {response.ksiEquityDemographicSource.vintage} and are compared with medians for tracts intersecting the selected area.
                  Counts per 100,000 residents are not adjusted for roadway exposure, travel, or
                  time. This is screening context, not a causal, protected-class, or legal disparity finding.
                </p>
                <ol className="mt-2 space-y-2">
                  {response.ksiEquityTracts.slice(0, 5).map((tract) => (
                    <li key={tract.geoid} className="rounded-md border border-border/60 bg-background/60 p-2 text-xs">
                      <p className="font-semibold">
                        {tract.rank}. {tract.tractName ?? `Census tract ${tract.geoid}`} · {tract.ksiCrashCount.toLocaleString()} KSI crashes
                      </p>
                      <p className="text-muted-foreground">
                        {tract.ksiPer100k === null
                          ? "Resident-normalized rate not available"
                          : `${tract.ksiPer100k.toFixed(1)} KSI crashes per 100,000 tract residents`} · {tract.fatalCrashCount.toLocaleString()} fatal · {tract.seriousInjuryCrashCount.toLocaleString()} serious injury
                      </p>
                      <p className="text-muted-foreground">
                        {describeTractMetric("Poverty", tract.pctPoverty, tract.areaMedianPctPoverty)} · {describeTractMetric("Nonwhite population", tract.pctNonwhite, tract.areaMedianPctNonwhite)} · {describeTractMetric("Zero-vehicle households", tract.pctZeroVehicle, tract.areaMedianPctZeroVehicle)}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : response?.ksiEquityTracts === null ? (
              <p className="text-muted-foreground">
                OpenPlan could not compare mapped KSI crashes with community conditions. The crash
                counts still loaded; this demographic comparison did not.
              </p>
            ) : response && Array.isArray(response.ksiEquityTracts) && response.ksiEquityTracts.length === 0 ? (
              <p className="text-muted-foreground">
                No loaded Census tract demographics overlap the mapped KSI crashes in this area, so
                community burden is not determined here. The crash workflow remains available.
              </p>
            ) : null}
            </>}
            {response ? (
              <SafetyPrintableStreetContext
                projectName={openedForProject?.name ?? null}
                place={place}
                crashes={visibleFeatures}
                roads={response.roadContext ?? null}
                coverageLimit={response.roadContextCoverageLimit ?? "Road context coverage was not reported."}
              />
            ) : null}
            {projectId && ingest?.id && projectReports.length > 0 ? (
              <section className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs">
                <h2 className="text-sm font-semibold">Carry this Safety analysis into a report</h2>
                <p className="mt-1 text-muted-foreground">
                  Choose the exact crash acquisition in the report, save that evidence selection,
                  then generate the PDF. OpenPlan will freeze its counts, concentrations, road
                  matches, source, years, filters, and limits into the report.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {projectReports.map((report) => (
                    <Link
                      key={report.id}
                      href={`/reports/${report.id}?projectId=${encodeURIComponent(projectId)}&safetyIngestId=${encodeURIComponent(ingest.id)}#report-controls`}
                      className="rounded-md border border-primary/30 bg-background px-3 py-2 font-semibold text-primary"
                    >
                      Add to {report.title}
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
            {/* Counted and failed, which is not the same as a source that cannot
                separate serious-injury crashes (that gets the completeness caveat below). Said out
                loud rather than left as a missing figure, because a missing
                figure on this page reads as a zero. */}
            {severityTotalsUnavailable && (
              <p className="text-muted-foreground">
                The crashes on the map loaded, but OpenPlan could not count how many were fatal
                or serious across the whole area you picked, so no severe-crash figure is shown.
                That is a failed count, not a finding — try loading the area
                again.
              </p>
            )}
            {ingest.severityCompleteness === "fatal_injury_only" && (
              <p className="text-muted-foreground">{SAFETY_SEVERITY_COMPLETENESS_CAVEAT}</p>
            )}
            {ingest.severityCompleteness === "fatal_only" && (
              <p className="text-muted-foreground">{SAFETY_FATAL_ONLY_CAVEAT}</p>
            )}
            {ingest.status === "failed" && ingest.fetchError && (
              <p className="text-destructive">Last retrieval failed: {ingest.fetchError}</p>
            )}
            {ingest.truncated && (
              <p className="text-muted-foreground">
                Retrieval stopped at the record cap, so this is a partial extract of the study area.
              </p>
            )}
          </div>
        ) : bbox ? (
          <p className="text-muted-foreground">
            {ingestsReadFailed
              ? "This workspace's crash-import history could not be read, so nothing is shown on the map. That is a failed lookup, not a finding — imports may exist."
              : "No crash data has been retrieved for this study area yet. Nothing is shown on the map — that is not evidence that no crashes occurred."}
          </p>
        ) : (
          /* NO JURISDICTION IS NAMED HERE. This sentence used to say crash
             coverage was "currently California-only", which was a hardcoded
             jurisdiction in UI copy and — once the national fatality adapter was
             registered — no longer true. Which sources cover a place is the
             registry's answer, given per study area, so the promise made here is
             the one the product can actually keep: it will name the source, or
             name the gap. */
          <p className="text-muted-foreground">
            Choose a study area above to retrieve reported crashes for it. What is available depends
            on where you are: OpenPlan names the source that covers your study area, says what that
            source does and does not record, and tells you plainly when nothing covers it — rather
            than showing an empty map.
          </p>
        )}
      </section>

      {/* Controls generated from the one facet declaration in
          `crash-filters.ts`, so a facet cannot be filterable in the API and
          unreachable here. Facets the active source has no field for render
          disabled with the reason rather than returning an empty list. */}
      <CrashFilterPanel
        selection={filters}
        onChange={setFilters}
        counts={facetCounts}
        dimensionCoverage={activeDimensionCoverage}
        severityCompleteness={activeCompleteness}
        sourceConfigured={sourceConfigured}
        noSourceMessage={
          bbox
            ? "No crash source has answered for this study area yet, so there is nothing to filter. Use the retrieval button at the top of the page; if no source covers this area, OpenPlan will say so rather than showing an empty map."
            : "Filters appear once a study area is set and a source has answered for it. Controls over an empty record would return nothing, and nothing would read as a finding."
        }
      />

      {/* The severity bands never account for these, so the count is stated
          rather than left as the difference between two numbers.

          ONLY WHEN THERE IS NO SEVERE-CRASH FIGURE. When there is one, this same
          disclosure is rendered inside the headline block instead, against the
          study-area total rather than against the dots — a caveat has to sit
          with the number it qualifies, and two near-identical sentences on
          different denominators is worse than either alone. */}
      {ksiTotal === null && unclassifiedScope.count > 0 && (
        <p className="text-xs text-muted-foreground">
          {unclassifiedScope.count.toLocaleString()} of the collisions{" "}
          {unclassifiedScope.whole ? "in the area you picked" : "shown"} carry no casualty count
          from the source. {SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {history.length > 0 && (
        <section className="rounded-lg border p-4" aria-label="Import history">
          <h2 className="mb-2 text-sm font-medium">What you have imported</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">{entry.createdAt.slice(0, 10)}</span>
                <span>{entry.sourceLabel ?? "No source"}</span>
                <span className="text-muted-foreground">
                  {/* Reported vs geocoded, always both — an ungeocoded crash is
                      a real crash that cannot be plotted. */}
                  {entry.crashCount.toLocaleString()} crashes ingested,{" "}
                  {entry.geocodedCount.toLocaleString()} geocoded
                </span>
                <span className="text-muted-foreground">
                  {entry.publishedThrough
                    ? `source published through ${entry.publishedThrough}`
                    : "source supplied no exact publication cutoff"}
                  <CutoffProvenanceLink provenance={entry.publishedThroughProvenance} short />
                </span>
                <span className="text-muted-foreground">
                  {entry.yearsRequested.length === 0
                    ? "requested crash years not recorded"
                    : `Requested crash years: ${[...new Set(entry.yearsRequested)].sort((a, b) => a - b).join(", ")}`}
                  . Requested years do not establish source coverage.
                </span>
                {/*
                  WHERE THIS PULL LOOKED. A crash count with no stated area is a
                  number a planner cannot defend, and this list used to show
                  source, years, counts and status while saying nothing about
                  the place — so an acquisition covering one corridor read
                  identically to one covering a whole county. A tester filed it
                  as a blocker for exactly that reason.

                  It states the extent, which is what is actually recorded, and
                  does NOT invent a place name from a county code. Naming the
                  place means recording it when the pull is made.
                */}
                <span className="text-muted-foreground">
                  {entry.scope
                    ? `covers ≈ ${describeExtentKm2(entry.scope)} km²${
                        entry.scope.countyCode === null
                          ? ""
                          : ` · county code ${entry.scope.countyCode}`
                      }`
                    : "area not recorded for this import"}
                </span>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {entry.status}
                </span>
                {entry.projectId && (
                  <Link
                    href={`/projects/${entry.projectId}`}
                    className="rounded-full border px-2 py-0.5 text-xs underline-offset-2 hover:underline"
                    aria-label={`Open project ${projectNameById.get(entry.projectId) ?? "linked to this acquisition"}`}
                  >
                    {projectNameById.get(entry.projectId) ?? "Linked project"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        {loading
          ? "Loading crashes…"
          : liveRead
            ? /* Counted off the LIVE points, and against the source's own
                 mappable total rather than the stored query's — mixing the two
                 would describe one dataset with another's denominator. */
              `Showing ${visibleFeatures.length.toLocaleString()} of ${liveRead.geocodedCount.toLocaleString()} mappable crashes from this live read, matching these filters.`
            : response
              ? /* "AT LEAST" WHEN THE DENOMINATOR IS A FALLBACK. If the count
                   query failed, the route falls back to the number of rows it
                   fetched — which is capped — so stating it flat would claim the
                   study area holds exactly as many crashes as the map drew. */
                `Showing ${response.returnedCount.toLocaleString()} of ${
                  response.matchedCountIsExact === false ? "at least " : ""
                }${response.matchedCount.toLocaleString()} crashes matching these filters in view.`
              : "No crashes loaded."}{" "}
        {/* Rows the query matched and could not render — an unusable coordinate
            pair or a severity outside the vocabulary. Named separately from the
            display cap, because "there are more beyond the cap" sends a planner
            to widen the view while "these are in the table and undrawable"
            sends them to the record. */}
        {response && response.undrawableCount > 0
          ? `${response.undrawableCount.toLocaleString()} matching ${
              response.undrawableCount === 1 ? "crash" : "crashes"
            } could not be drawn because the stored coordinates or severity value were unusable, so ${
              response.undrawableCount === 1 ? "it is" : "they are"
            } missing from the map rather than absent from the record. `
          : ""}
        {SAFETY_CRASH_DATA_CAVEAT}
      </p>
          </div>

          {/* THE EXPORT IS PINNED TO THE BOTTOM OF THE SIDEBAR, not left at the
              end of a scroll. It is the last thing a planner does with this page
              and it was previously below the map, the record card and the import
              history — a control found by scrolling past everything else.

              The collisions on screen, in a file. Not a re-query written here:
              the same filter selection is serialized through
              `crashFilterSearchParams`, and the file itself is built by the one
              pure builder both the stored route and this browser use, so an
              export can never describe a different query from the one that
              produced it. */}
          <div className="shrink-0 border-t p-3">
            <CrashExportButton
              workspaceId={workspaceId}
              projectId={projectId || null}
              bbox={bbox}
              filters={filters}
              studyAreaLabel={place?.label ?? (corridorText.trim() || null)}
              liveFeatures={liveRead ? visibleFeatures : null}
              liveSourceLabel={liveRead?.sourceLabel ?? null}
              liveAttribution={liveRead?.attribution ?? null}
              disabledReason={
                !liveRead && (response?.matchedCount ?? 0) === 0
                  ? "Nothing matches these filters in this extent yet, so there is nothing to export."
                  : null
              }
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
