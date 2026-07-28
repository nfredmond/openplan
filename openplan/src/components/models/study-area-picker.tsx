"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Loader2, MapPin, Pencil, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  PLACE_KIND_PLURAL_LABELS,
  type PlaceBoundaryResponse,
  type PlaceKind,
  type PlaceSearchItem,
} from "@/lib/api/place-geographies";
import type { EngagementGeometry } from "@/lib/engagement/geometry";
import { CONTINENTAL_US_CENTER, LARGE_AREA_KM2, summarizeCorridorText } from "@/lib/models/study-area";

const GeometryPickerMap = dynamic(
  () => import("@/components/engagement/geometry-picker-map").then((m) => m.GeometryPickerMap),
  {
    ssr: false,
    loading: () => <div className="h-[300px] w-full animate-pulse rounded-xl border border-border bg-muted/20" />,
  },
);

type PickerMode = "search" | "draw";

/**
 * What the last search could not reach.
 *
 * `null` means every lookup answered, so an empty result really is "no such
 * place". Anything else must be said out loud: an unset Census key or a
 * TIGERweb outage previously rendered as "No matching places. Try a different
 * spelling", which tells a planner their own county does not exist.
 */
type SearchCoverage = {
  unavailableKinds: PlaceKind[];
  searchUnavailable: boolean;
  reason: string | null;
};

function describeUnavailableKinds(kinds: PlaceKind[]): string {
  const labels = kinds.map((kind) => PLACE_KIND_PLURAL_LABELS[kind]);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

/**
 * The single geography front door for the whole app (any US county / city / CDP
 * / metro / micro, TIGERweb-backed). Do not build a second one — see the
 * "Product non-negotiables" section of CLAUDE.md.
 *
 * `onPlaceResolved` is optional and additive: callers that need to know WHICH
 * place was chosen (not just its geometry) can receive the resolved boundary —
 * e.g. Safety derives a state-specific county code from the GEOID. It fires only
 * for a searched place, never for a hand-drawn area, because a drawn polygon has
 * no place identity.
 *
 * `showRunEngineHint` exists because not every caller is choosing an area to RUN
 * a model over. Workspace configuration picks a place of record — no run follows
 * it — so telling that caller which engine a large area routes to would be
 * advice about something that is not going to happen. Defaults to true so every
 * modeling caller keeps the warning it has today.
 *
 * `externalLabel` names an area this picker did NOT choose. Because the picker is
 * controlled, its text can be set by something else entirely — a workspace home
 * geography prefill, an uploaded boundary file, a reloaded run — and the caller
 * is the only one who knows what that area is. The picker's own selection always
 * wins over it, and when no caller supplies one an outside area is still
 * described honestly as a custom one rather than given a borrowed name.
 */
export function StudyAreaPicker({
  corridorText,
  onCorridorChange,
  onPlaceResolved,
  showRunEngineHint = true,
  externalLabel = null,
}: {
  corridorText: string;
  onCorridorChange: (text: string) => void;
  onPlaceResolved?: (place: PlaceBoundaryResponse | null) => void;
  showRunEngineHint?: boolean;
  externalLabel?: string | null;
}) {
  const [mode, setMode] = useState<PickerMode>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingGeoid, setResolvingGeoid] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<SearchCoverage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The last text this picker itself emitted. Anything else arriving on the
  // `corridorText` prop came from outside (see `externalLabel`), and the label
  // this picker is holding then describes an area that is no longer set.
  const emittedTextRef = useRef<string | null>(null);

  const summary = useMemo(() => summarizeCorridorText(corridorText), [corridorText]);

  useEffect(() => {
    if (emittedTextRef.current === corridorText) return;
    // Not ours. Drop our label rather than let a previously picked place keep
    // its name on somebody else's boundary.
    setSelectedLabel(null);
  }, [corridorText]);

  /** Publish a new area, remembering it so the reset above does not fire. */
  function emitCorridorText(text: string) {
    emittedTextRef.current = text;
    onCorridorChange(text);
  }

  // Debounced place search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setCoverage(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/geographies/places?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as {
          items?: PlaceSearchItem[];
          unavailableKinds?: PlaceKind[];
          searchUnavailable?: boolean;
          unavailableReason?: string | null;
        };
        setResults(data.items ?? []);
        setCoverage({
          unavailableKinds: data.unavailableKinds ?? [],
          searchUnavailable: data.searchUnavailable ?? false,
          reason: data.unavailableReason ?? null,
        });
        setError(null);
      } catch (searchError) {
        if ((searchError as Error).name === "AbortError") return;
        setResults([]);
        // The request itself failed, so nothing was searched.
        setCoverage({ unavailableKinds: [], searchUnavailable: true, reason: null });
        setError(null);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(handle);
  }, [query]);

  async function selectPlace(item: PlaceSearchItem) {
    setResolvingGeoid(item.geoid);
    setError(null);
    try {
      const res = await fetch(
        `/api/geographies/place-boundary?kind=${item.kind}&geoid=${encodeURIComponent(item.geoid)}`,
      );
      if (!res.ok) throw new Error("boundary failed");
      const data = (await res.json()) as PlaceBoundaryResponse;
      emitCorridorText(JSON.stringify(data.geojson));
      onPlaceResolved?.(data);
      setSelectedLabel(data.label ?? item.label);
      setResults([]);
      setCoverage(null);
      setQuery("");
    } catch {
      setError(`Couldn't load the boundary for ${item.label}. Try another result or draw the area.`);
    } finally {
      setResolvingGeoid(null);
    }
  }

  function handleDraw(geometry: EngagementGeometry | null) {
    if (geometry && geometry.type === "Polygon") {
      emitCorridorText(JSON.stringify(geometry));
      // A drawn polygon has no place identity, so any place-derived context
      // (county codes, labels) must be cleared rather than left stale.
      onPlaceResolved?.(null);
      setSelectedLabel("Custom drawn area");
    }
  }

  function clearArea() {
    emitCorridorText("");
    onPlaceResolved?.(null);
    setSelectedLabel(null);
    setResults([]);
    setCoverage(null);
    setQuery("");
  }

  const drawCenter: [number, number] = summary.bbox
    ? [(summary.bbox.minLon + summary.bbox.maxLon) / 2, (summary.bbox.minLat + summary.bbox.maxLat) / 2]
    : CONTINENTAL_US_CENTER;
  const drawZoom = summary.bbox ? 9 : 3.6;

  return (
    <div className="space-y-3">
      <div className="inline-flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Study area input mode">
        <button
          type="button"
          onClick={() => setMode("search")}
          aria-pressed={mode === "search"}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mode === "search" ? "bg-primary/15 text-foreground" : "bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          <Search className="h-3.5 w-3.5" />
          Search a place
        </button>
        <button
          type="button"
          onClick={() => setMode("draw")}
          aria-pressed={mode === "draw"}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mode === "draw" ? "bg-primary/15 text-foreground" : "bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          <Pencil className="h-3.5 w-3.5" />
          Draw an area
        </button>
      </div>

      {mode === "search" ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type any US city, town, CDP, county, or metro area…"
              className="pl-9"
              aria-label="Search for a place"
              autoComplete="off"
            />
            {searching ? (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : null}
          </div>

          {results.length > 0 ? (
            <ul className="max-h-64 overflow-auto rounded-lg border border-border bg-background/95 shadow-sm">
              {results.map((item) => (
                <li key={`${item.kind}:${item.geoid}`}>
                  <button
                    type="button"
                    onClick={() => void selectPlace(item)}
                    disabled={resolvingGeoid !== null}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none disabled:opacity-60"
                  >
                    <span className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      <span className="font-medium text-foreground">{item.label}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge tone="neutral">{item.description}</StatusBadge>
                      {resolvingGeoid === item.geoid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {/*
            Three distinct outcomes, never collapsed into one another:
            nothing answered, some layers answered, everything answered but
            matched nothing. Only the last one is a spelling problem.
          */}
          {query.trim().length >= 2 && !searching && coverage?.searchUnavailable ? (
            <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                Place search is unavailable right now, so this is not a result — nothing was searched.{" "}
                {coverage.reason ?? "The US Census lookup services did not respond."} Draw the area instead, or try again
                shortly.
              </span>
            </p>
          ) : null}

          {query.trim().length >= 2 && !searching && coverage && !coverage.searchUnavailable && coverage.unavailableKinds.length > 0 ? (
            <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                These results are incomplete: {describeUnavailableKinds(coverage.unavailableKinds)} could not be searched.{" "}
                {coverage.reason ?? ""}
              </span>
            </p>
          ) : null}

          {query.trim().length >= 2 &&
          !searching &&
          results.length === 0 &&
          !error &&
          coverage !== null &&
          !coverage.searchUnavailable &&
          coverage.unavailableKinds.length === 0 ? (
            <p className="text-xs text-muted-foreground">No matching places. Try a different spelling, or draw the area.</p>
          ) : null}
        </div>
      ) : (
        <GeometryPickerMap
          onGeometryChange={handleDraw}
          initialMode="area"
          allowedModes={["area"]}
          initialCenter={drawCenter}
          initialZoom={drawZoom}
        />
      )}

      {error ? <p className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}

      {summary.valid ? (
        <div className="rounded-lg border border-emerald-300/60 bg-emerald-50/60 px-3 py-2.5 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-700 dark:text-emerald-300" />
              <div>
                <p className="font-medium text-foreground">
                  {selectedLabel ?? externalLabel ?? "Custom study area"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {summary.areaKm2 !== null ? `≈ ${summary.areaKm2.toLocaleString()} km² bounding extent` : "Study area set"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={clearArea}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>

          {showRunEngineHint && summary.areaKm2 !== null && summary.areaKm2 > LARGE_AREA_KM2 ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Large study area — best run on the <strong>AequilibraE (Fast Screening)</strong> engine. A metro-scale
              sketch run exceeds the 150-tract in-process cap and is routed to the AequilibraE worker automatically;
              expect a few minutes either way.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Search for any US place or draw an area to set the study boundary. No place is preset — this runs anywhere in the US.
        </p>
      )}
    </div>
  );
}
