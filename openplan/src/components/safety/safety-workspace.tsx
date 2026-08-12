"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { summarizeCorridorText, type StudyAreaOrigin } from "@/lib/models/study-area";
import { ccrsCountyCodeFromGeoid } from "@/lib/safety/county-code";
import { recentCrashYears } from "@/lib/safety/crash-years";
import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { SafetyCrashMap } from "./safety-crash-map";
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
};

export function SafetyWorkspace({
  workspaceId,
  latestIngest,
  ingestsReadFailed = false,
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
  }, [workspaceId, filters, bbox]);

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

  // A live read belongs to the area it was retrieved for and to no other.
  // Leaving it on screen after the planner moves the study area would plot one
  // place's fatalities over another's boundary — the most consequential thing
  // this page could get wrong.
  useEffect(() => {
    setLiveRead(null);
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

  // Is there anything to filter? A planner in a state with no adapter must be
  // told that, not shown a panel of controls that can only return nothing.
  const sourceConfigured = Boolean(liveRead) || Boolean(ingest && ingest.status !== "no_coverage");

  const selectedCrash = useMemo(
    () => visibleFeatures.find((feature) => feature.properties.id === selectedCrashId) ?? null,
    [visibleFeatures, selectedCrashId]
  );

  // Collisions on screen the source never classified. Stated beside the severity
  // figures or the bands quietly fail to add up to the total, and a reader fills
  // the gap in with "property damage" — which is exactly the wrong answer, since
  // these are the records that used to BE property damage by mistake.
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

  // KSI — killed or seriously injured — is the measure SS4A and HSIP run on, so
  // it is only shown when the source could actually separate KABCO A. Otherwise
  // the completeness caveat below explains why there is no KSI figure, rather
  // than a "0" that would read as "no serious injuries occurred".
  const ksiAvailable = activeCompleteness === "kabco_full";
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
        sourceConfigured={sourceConfigured}
        noSourceMessage={
          bbox
            ? "No crash source has answered for this study area yet, so there is nothing to filter. Use the retrieval button at the top of the page; if no source covers this area, OpenPlan will say so rather than showing an empty map."
            : "Filters appear once a study area is set and a source has answered for it. Controls over an empty record would return nothing, and nothing would read as a finding."
        }
      />

      {/* The severity bands never account for these, so the count is stated
          rather than left as the difference between two numbers. */}
      {unclassifiedVisible > 0 && (
        <p className="text-xs text-muted-foreground">
          {unclassifiedVisible.toLocaleString()} of the collisions shown carry no casualty count from
          the source. {SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="h-[520px] w-full overflow-hidden rounded-lg border">
        <SafetyCrashMap collection={collection} bbox={mapBbox} onSelect={setSelectedCrashId} />
      </div>

      {/* THE PER-COLLISION RECORD. Every dimension appears, including the ones
          the source said nothing about: a row reading "not reported for this
          collision" and a row reading "this source does not record it" are
          different facts, and a blank slot would be read as neither. */}
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
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
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
              ? `Showing ${response.returnedCount.toLocaleString()} of ${response.matchedCount.toLocaleString()} crashes matching these filters in view.`
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

      {/* The collisions on screen, in a file. Not a re-query written here: the
          same filter selection is serialized through `crashFilterSearchParams`,
          and the file itself is built by the one pure builder both the stored
          route and this browser use, so an export can never describe a
          different query from the one that produced it. */}
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
  );
}
