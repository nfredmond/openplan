"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { summarizeCorridorText, type StudyAreaOrigin } from "@/lib/models/study-area";
import { ccrsCountyCodeFromGeoid } from "@/lib/safety/county-code";
import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { SafetyCrashMap } from "./safety-crash-map";
import {
  COVERAGE_STATE_COPY,
  SEVERITY_LABELS,
  type SafetyCrashCollection,
  type SafetyCrashQueryResponse,
  type SafetyIngestHistoryEntry,
  type SafetyIngestSummary,
  type SafetyProjectOption,
} from "@/lib/safety/client-types";
import {
  SAFETY_CRASH_DATA_CAVEAT,
  SAFETY_GEOCODING_CAVEAT,
  SAFETY_SEVERITY_COMPLETENESS_CAVEAT,
} from "@/lib/safety/caveats";
import type { CrashSeverity } from "@/lib/safety/sources/types";

const SEVERITY_ORDER: CrashSeverity[] = ["fatal", "severe_injury", "injury", "pdo"];

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
};

export function SafetyWorkspace({
  workspaceId,
  latestIngest,
  studyArea = EMPTY_STUDY_AREA_SEED,
  openedForProject = null,
  projects = [],
  ingestHistory = [],
}: SafetyWorkspaceProps) {
  // The study area is still the user's to choose. Inheriting one only changes
  // where the picker STARTS — no place is ever invented here, and clearing the
  // area clears it fully.
  const [corridorText, setCorridorText] = useState(studyArea.corridorText);
  const [place, setPlace] = useState<PlaceBoundaryResponse | null>(studyArea.place);
  const [ingest, setIngest] = useState<SafetyIngestSummary | null>(latestIngest);
  const [history, setHistory] = useState<SafetyIngestHistoryEntry[]>(ingestHistory);
  // Optional project the NEXT acquisition is attached to. "" = unattached.
  //
  // The project this page was OPENED for wins, because naming it in the URL is a
  // statement and the last acquisition's project is only a habit — the same
  // order of precedence the study area itself follows. Failing that, the most
  // recent acquisition's project (when it is still offered): a re-acquisition
  // that silently dropped the project link would strand project-scoped crash
  // counts on the older data. Either way it is visible in the selector below, so
  // clearing it stays a one-click choice.
  const [projectId, setProjectId] = useState(() => {
    const offered = (candidate: string) =>
      Boolean(candidate) && projects.some((project) => project.id === candidate);
    if (openedForProject && offered(openedForProject.id)) return openedForProject.id;
    const lastProjectId = ingestHistory[0]?.projectId ?? "";
    return offered(lastProjectId) ? lastProjectId : "";
  });
  const [response, setResponse] = useState<SafetyCrashQueryResponse | null>(null);
  const [severities, setSeverities] = useState<CrashSeverity[]>([]);
  const [mode, setMode] = useState<"all" | "pedestrian" | "bicyclist" | "vru">("all");
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          ...(projectId === "" ? {} : { projectId }),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Crash ingest failed");

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
        fetchError: typeof body.error === "string" ? body.error : null,
        createdAt: new Date().toISOString(),
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
  }, [workspaceId, loadCrashes, bbox, countyCode, projectId]);

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

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );

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
        <div className="flex flex-wrap items-end gap-3">
          {projects.length > 0 && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Attach to project (optional)</span>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={ingesting}
                className="rounded-md border px-2 py-2 text-sm"
                aria-label="Project for this crash acquisition"
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => void runIngest()}
            disabled={ingesting || !bbox}
            className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
          >
            {ingesting ? "Retrieving crashes…" : "Retrieve crash data"}
          </button>
        </div>
      </header>

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

      {history.length > 0 && (
        <section className="rounded-lg border p-4" aria-label="Acquisition history">
          <h2 className="mb-2 text-sm font-medium">Acquisition history</h2>
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
          : response
            ? `Showing ${response.returnedCount.toLocaleString()} of ${response.matchedCount.toLocaleString()} crashes matching these filters in view.`
            : "No crashes loaded."}{" "}
        {SAFETY_CRASH_DATA_CAVEAT}
      </p>
    </div>
  );
}
