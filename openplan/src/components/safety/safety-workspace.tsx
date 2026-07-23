"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

/** Nevada County — the pilot study area, and CCRS County Code 29. */
const DEFAULT_BBOX: [number, number, number, number] = [-121.3, 39.1, -120.0, 39.6];
const DEFAULT_COUNTY_CODE = 29;

const SEVERITY_ORDER: CrashSeverity[] = ["fatal", "severe_injury", "injury", "pdo"];

type SafetyWorkspaceProps = {
  workspaceId: string;
  latestIngest: SafetyIngestSummary | null;
};

export function SafetyWorkspace({ workspaceId, latestIngest }: SafetyWorkspaceProps) {
  const [ingest, setIngest] = useState<SafetyIngestSummary | null>(latestIngest);
  const [response, setResponse] = useState<SafetyCrashQueryResponse | null>(null);
  const [severities, setSeverities] = useState<CrashSeverity[]>([]);
  const [mode, setMode] = useState<"all" | "pedestrian" | "bicyclist" | "vru">("all");
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCrashes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId,
        minLon: String(DEFAULT_BBOX[0]),
        minLat: String(DEFAULT_BBOX[1]),
        maxLon: String(DEFAULT_BBOX[2]),
        maxLat: String(DEFAULT_BBOX[3]),
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
  }, [workspaceId, severities, mode]);

  useEffect(() => {
    void loadCrashes();
  }, [loadCrashes]);

  const runIngest = useCallback(async () => {
    setIngesting(true);
    setError(null);
    try {
      const years = [2025, 2024, 2023, 2022, 2021];
      const res = await fetch("/api/safety/crashes/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          bbox: {
            minLon: DEFAULT_BBOX[0],
            minLat: DEFAULT_BBOX[1],
            maxLon: DEFAULT_BBOX[2],
            maxLat: DEFAULT_BBOX[3],
          },
          years,
          countyCode: DEFAULT_COUNTY_CODE,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Crash ingest failed");

      setIngest({
        id: body.ingestId,
        sourceLabel: body.sourceLabel,
        attribution: null,
        coverageState: body.coverageState,
        severityCompleteness: "fatal_injury_only",
        status: body.status,
        crashCount: body.crashCount,
        geocodedCount: body.geocodedCount,
        truncated: body.truncated,
        yearsRequested: years,
        fetchError: body.error,
        createdAt: new Date().toISOString(),
      });
      await loadCrashes();
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : "Crash ingest failed");
    } finally {
      setIngesting(false);
    }
  }, [workspaceId, loadCrashes]);

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
          disabled={ingesting}
          className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {ingesting ? "Retrieving crashes…" : "Retrieve crash data"}
        </button>
      </header>

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
        ) : (
          <p className="text-muted-foreground">
            No crash data has been retrieved for this workspace yet. Nothing is shown on the map —
            that is not evidence that no crashes occurred.
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
        <SafetyCrashMap collection={collection} bbox={DEFAULT_BBOX} />
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
