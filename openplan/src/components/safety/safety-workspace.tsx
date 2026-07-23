"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { summarizeCorridorText } from "@/lib/models/study-area";
import { ccrsCountyCodeFromGeoid } from "@/lib/safety/county-code";
import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { SafetyCrashMap } from "./safety-crash-map";
import {
  COVERAGE_STATE_COPY,
  SEVERITY_LABELS,
  type SafetyCrashCollection,
  type SafetyCrashQueryResponse,
  type SafetyIngestSummary,
} from "@/lib/safety/client-types";
import {
  SAFETY_CRASH_DATA_CAVEAT,
  SAFETY_GEOCODING_CAVEAT,
  SAFETY_SEVERITY_COMPLETENESS_CAVEAT,
} from "@/lib/safety/caveats";
import type { CrashSeverity } from "@/lib/safety/sources/types";

const SEVERITY_ORDER: CrashSeverity[] = ["fatal", "severe_injury", "injury", "pdo"];

type SafetyWorkspaceProps = {
  workspaceId: string;
  latestIngest: SafetyIngestSummary | null;
};

export function SafetyWorkspace({ workspaceId, latestIngest }: SafetyWorkspaceProps) {
  // The study area comes from the user, always. There is no default geography —
  // see the "Product non-negotiables" section of CLAUDE.md.
  const [corridorText, setCorridorText] = useState("");
  const [place, setPlace] = useState<PlaceBoundaryResponse | null>(null);
  const [ingest, setIngest] = useState<SafetyIngestSummary | null>(latestIngest);
  const [response, setResponse] = useState<SafetyCrashQueryResponse | null>(null);
  const [severities, setSeverities] = useState<CrashSeverity[]>([]);
  const [mode, setMode] = useState<"all" | "pedestrian" | "bicyclist" | "vru">("all");
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bounding box of the user's selection, or null until they pick one.
  const bbox = useMemo(() => {
    const summary = summarizeCorridorText(corridorText);
    if (!summary.valid || !summary.bbox) return null;
    return summary.bbox;
  }, [corridorText]);

  const mapBbox: [number, number, number, number] | null = bbox
    ? [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat]
    : null;

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
      if (severities.length) params.set("severity", severities.join(","));
      if (mode !== "all") params.set("mode", mode);

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
  }, [workspaceId, severities, mode, bbox]);

  useEffect(() => {
    void loadCrashes();
  }, [loadCrashes]);

  const runIngest = useCallback(async () => {
    if (!bbox) return;
    setIngesting(true);
    setError(null);
    try {
      const years = [2025, 2024, 2023, 2022, 2021];
      const res = await fetch("/api/safety/crashes/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          bbox,
          years,
          ...(countyCode === null ? {} : { countyCode }),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Crash ingest failed");

      // Normalize at the boundary. The banner renders these directly, so a
      // malformed or unexpected response body must not be able to white-screen
      // the page (an absent count would throw on .toLocaleString()).
      const count = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
      setIngest({
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
        fetchError: typeof body.error === "string" ? body.error : null,
        createdAt: new Date().toISOString(),
      });
      await loadCrashes();
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : "Crash ingest failed");
    } finally {
      setIngesting(false);
    }
  }, [workspaceId, loadCrashes, bbox, countyCode]);

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const feature of response?.features ?? []) {
      const severity = feature.properties.severity;
      counts[severity] = (counts[severity] ?? 0) + 1;
    }
    return counts;
  }, [response]);

  const collection: SafetyCrashCollection | null = response
    ? { type: "FeatureCollection", features: response.features }
    : null;

  const toggleSeverity = (severity: CrashSeverity) => {
    setSeverities((current) =>
      current.includes(severity) ? current.filter((s) => s !== severity) : [...current, severity]
    );
  };

  // The gap between reported and mappable crashes is the number this page must
  // never hide: an ungeocoded crash is a real crash that cannot be plotted.
  const ungeocoded = ingest ? Math.max(0, ingest.crashCount - ingest.geocodedCount) : 0;

  // KSI — killed or seriously injured — is the measure SS4A and HSIP run on, so
  // it is only shown when the source could actually separate KABCO A. Otherwise
  // the completeness caveat below explains why there is no KSI figure, rather
  // than a "0" that would read as "no serious injuries occurred".
  const ksiAvailable = ingest?.severityCompleteness === "kabco_full";
  const ksiCount = ksiAvailable
    ? (severityCounts.fatal ?? 0) + (severityCounts.severe_injury ?? 0)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Safety</h1>
          <p className="text-sm text-muted-foreground">
            Reported crashes for the study area, retrieved from the source agency.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runIngest()}
          disabled={ingesting || !bbox}
          className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {ingesting ? "Retrieving crashes…" : "Retrieve crash data"}
        </button>
      </header>

      {/* Study area — the app's single geography front door, reused, not reinvented. */}
      <section className="rounded-lg border p-4" aria-label="Study area">
        <h2 className="mb-2 text-sm font-medium">Study area</h2>
        <StudyAreaPicker
          corridorText={corridorText}
          onCorridorChange={setCorridorText}
          onPlaceResolved={setPlace}
        />
        {bbox && countyCode === null && (
          <p className="mt-2 text-xs text-muted-foreground">
            Counts for this selection come from the mapped area only. Pick a California{" "}
            <strong>county</strong> to also include reported crashes the source agency never
            geolocated.
          </p>
        )}
      </section>

      {/* Coverage banner — source, attribution, and what the data does NOT establish. */}
      <section className="rounded-lg border p-4 text-sm" aria-label="Crash data coverage">
        {ingest ? (
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
            {ungeocoded > 0 && (
              <p className="text-muted-foreground">
                {ungeocoded.toLocaleString()} reported crashes have no coordinates from the source
                agency and are counted above but not shown on the map. {SAFETY_GEOCODING_CAVEAT}
              </p>
            )}
            {ksiCount !== null && (
              <p>
                <span className="font-medium">{ksiCount.toLocaleString()} killed or seriously injured</span>{" "}
                <span className="text-muted-foreground">
                  (KSI) among the crashes in view — the measure SS4A and HSIP are scored on.
                </span>
              </p>
            )}
            {ingest.severityCompleteness === "fatal_injury_only" && (
              <p className="text-muted-foreground">{SAFETY_SEVERITY_COMPLETENESS_CAVEAT}</p>
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
            No crash data has been retrieved for this study area yet. Nothing is shown on the map —
            that is not evidence that no crashes occurred.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Choose a study area above to retrieve reported crashes for it. Crash coverage is
            currently California-only (California Crash Reporting System); anywhere else will report
            that plainly rather than showing an empty map.
          </p>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-3" aria-label="Crash filters">
        <div className="flex flex-wrap gap-2">
          {SEVERITY_ORDER.map((severity) => (
            <button
              key={severity}
              type="button"
              onClick={() => toggleSeverity(severity)}
              aria-pressed={severities.includes(severity)}
              className={`rounded-full border px-3 py-1 text-xs ${
                severities.includes(severity) ? "bg-foreground text-background" : ""
              }`}
            >
              {SEVERITY_LABELS[severity]}
              {severityCounts[severity] ? ` (${severityCounts[severity]})` : ""}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Mode</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
            className="rounded-md border px-2 py-1"
          >
            {/* "Any mode", not "All crashes" — this filter selects mode of
                travel, and a coverage-sounding label would overstate a dataset
                that omits ungeocoded records. */}
            <option value="all">Any mode</option>
            <option value="vru">Pedestrian or bicyclist</option>
            <option value="pedestrian">Pedestrian</option>
            <option value="bicyclist">Bicyclist</option>
          </select>
        </label>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="h-[520px] w-full overflow-hidden rounded-lg border">
        <SafetyCrashMap collection={collection} bbox={mapBbox} />
      </div>

      <p className="text-xs text-muted-foreground">
        {loading
          ? "Loading crashes…"
          : response
            ? `Showing ${response.returnedCount.toLocaleString()} of ${response.matchedCount.toLocaleString()} crashes matching these filters in view.`
            : "No crashes loaded."}{" "}
        {SAFETY_CRASH_DATA_CAVEAT}
      </p>
    </div>
  );
}
