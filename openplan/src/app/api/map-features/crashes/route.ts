import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { MAP_FEATURE_LAYER_LIMIT } from "@/lib/cartographic/layer-disclosure";
import {
  describeCrashLayerCoverage,
  summarizeAcquiredAreas,
  summarizeCrashAcquisitions,
  NO_ACQUIRED_AREAS,
  type CrashLayerScopeState,
  type LonLatBox,
} from "@/lib/cartographic/crash-layer-coverage";
import { homeGeographyBbox, parseWorkspaceHomeGeography } from "@/lib/workspaces/home-geography";
import { resolveCrashSources } from "@/lib/safety/sources/registry";
import { readCrashRowFacts } from "@/lib/safety/crash-properties";
import { CRASH_QUERY_PROJECTION } from "@/lib/safety/crash-filters";

/**
 * Acquired collisions as a shared map layer.
 *
 * WHICH CRASH LANE THIS IS, and why it is the persisted one rather than the live
 * source read that Explore uses, is argued at length in
 * `src/lib/cartographic/crash-layer-coverage.ts`. The short version: this route
 * takes no bounding box (no `/api/map-features/*` route does), so a live read
 * would have nothing honest to key on, and the table is the only crash record
 * that belongs to the workspace rather than to a moment in time.
 *
 * WHY IT IS NOT `/api/safety/crashes`. That route is the Safety workbench's
 * filtered query: it requires a bbox and takes severity/mode/year filters, and
 * it caps at 2,000. This one is the shell backdrop's parameterless
 * workspace-scoped layer, capped like its six siblings. They read the same
 * table with the same workspace scope, so they cannot disagree about the record
 * — only about how much of it is on screen, which both disclose.
 *
 * WHAT MAKES AN EMPTY RESPONSE SAFE. Two independent reads, because an empty
 * crash layer has four different meanings and only one of them is a finding:
 * no source covers the workspace's stated area; no acquisition has been run;
 * an acquisition failed; or an acquisition genuinely found nothing. The
 * coverage notes say which, every time.
 *
 * WHAT MAKES A NON-EMPTY RESPONSE SAFE is a separate question, and it is why the
 * acquisition read pulls each run's recorded EXTENT. An acquisition takes a
 * caller-supplied bbox with an optional project id; nothing clips it to the
 * workspace's home geography, and the home geography is optional besides. So the
 * drawn crashes and the stated area are two different footprints, and a note
 * describing the second while the first is on screen is a claim the map itself
 * refutes. `summarizeAcquiredAreas` gives the copy the comparison so it can say
 * which footprint each sentence is about.
 */

/** Identity + extent, never the boundary polygon — this fires on every navigation. */
const HOME_GEOGRAPHY_EXTENT_COLUMNS =
  "home_geography_source, home_geography_label, home_min_lon, home_min_lat, home_max_lon, home_max_lat";

/**
 * The crash columns this layer asks for, GENERATED — never hand-written.
 *
 * `CRASH_QUERY_PROJECTION` is derived from the facet registry in
 * `src/lib/safety/crash-filters.ts`, which takes every column name from
 * `src/lib/safety/vocabulary.ts`. This route used to spell its own list, which
 * made it a THIRD reader of those names beside the two that are generated —
 * and the consequence was not hypothetical: adding a dimension to the
 * vocabulary flowed automatically into the Safety workbench query and the
 * export, and would silently NOT have reached this shared backdrop layer. The
 * facet would have been filterable everywhere and invisible on the map every
 * other module draws on.
 *
 * The embed is appended by COMPOSITION rather than by restating the columns.
 * It is the only thing this route needs that the shared projection has no
 * business knowing about: `/api/safety/crashes` keys features by external id
 * and source, while this one attributes each crash to the project its
 * ACQUISITION was run for.
 */
const CRASH_LAYER_PROJECTION = `${CRASH_QUERY_PROJECTION},safety_crash_ingests!inner(project_id)`;

/**
 * What THIS route reads off a crash row by name.
 *
 * Deliberately short. The collision FACTS are read by `readCrashRowFacts` from
 * the same row object, so listing them again here would be a second inventory
 * of the same columns drifting beside the generated projection. The index
 * signature is what lets the row go straight to that reader with no cast.
 */
type CrashRow = Record<string, unknown> & {
  id: string;
  latitude: number | string | null;
  longitude: number | string | null;
  /**
   * The embedded acquisition. PostgREST returns a to-one embed as an object,
   * but some driver/route combinations surface it as a single-element array,
   * so both shapes are unwrapped rather than assumed.
   */
  safety_crash_ingests: { project_id: string | null } | Array<{ project_id: string | null }> | null;
};

type IngestSummaryRow = {
  status: string | null;
  coverage_state: string | null;
  severity_completeness: string | null;
  crash_count: number | string | null;
  geocoded_count: number | string | null;
  /**
   * The area the acquisition actually requested
   * (20260723000004_safety_crashes.sql). NOT NULL in the table, but typed
   * nullable here because a `.select()` string is not schema-checked: an
   * absent column arrives as `undefined`, and treating that as a zero-degree
   * box at 0°N 0°E would report every acquisition as outside the workspace.
   */
  min_lon: number | string | null;
  min_lat: number | string | null;
  max_lon: number | string | null;
  max_lat: number | string | null;
};

/** The four ingest columns naming the area an acquisition asked about. */
const INGEST_EXTENT_COLUMNS = "min_lon, min_lat, max_lon, max_lat";

function coerceInt(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : 0;
}

function coerceLat(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n < -90 || n > 90) return null;
  return n;
}

function coerceLng(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n < -180 || n > 180) return null;
  return n;
}

/**
 * An acquisition's recorded area, or `null` when any corner is unreadable.
 *
 * `null` travels all the way through to a sentence saying the extent could not
 * be compared. Substituting a default box would be the silent degrade: it would
 * place the acquisition somewhere definite and let the copy make a confident
 * claim about a fact the row does not carry.
 */
function extentOf(row: IngestSummaryRow): LonLatBox | null {
  const minLon = coerceLng(row.min_lon);
  const minLat = coerceLat(row.min_lat);
  const maxLon = coerceLng(row.max_lon);
  const maxLat = coerceLat(row.max_lat);
  if (minLon === null || minLat === null || maxLon === null || maxLat === null) return null;
  return { minLon, minLat, maxLon, maxLat };
}

function projectIdOf(embed: CrashRow["safety_crash_ingests"]): string | null {
  if (!embed) return null;
  const row = Array.isArray(embed) ? embed[0] : embed;
  const projectId = row?.project_id;
  return typeof projectId === "string" && projectId.length > 0 ? projectId : null;
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-features.crashes", request);
  const startedAt = Date.now();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

    if (!membership) {
      return NextResponse.json(
        {
          type: "FeatureCollection" as const,
          features: [],
          returnedCount: 0,
          matchedCount: 0,
          droppedCount: 0,
          truncated: false,
          limit: MAP_FEATURE_LAYER_LIMIT,
          coverageNotes: describeCrashLayerCoverage({
            scopeState: "no_workspace",
            scopeLabel: null,
            checkedSourceLabels: [],
            acquisitionState: "none",
            acquiredAreas: NO_ACQUIRED_AREAS,
            anyUngeocoded: false,
            anySeverityIncomplete: false,
            unclassifiedCount: 0,
            returnedCount: 0,
            matchedCount: 0,
            droppedCount: 0,
            limit: MAP_FEATURE_LAYER_LIMIT,
          }),
        },
        { status: 200 }
      );
    }

    const workspaceId = membership.workspace_id;

    // Does a STORABLE crash source cover where this workspace says it works?
    // Asked with `use: "ingest"` on purpose: the read-only registry includes the
    // national FARS backstop, which `safety_crashes.source_id` will not accept,
    // so answering "covered" from it would promise data this layer can never
    // hold. The refusal below names every source it checked.
    const workspaceResult = await supabase
      .from("workspaces")
      .select(HOME_GEOGRAPHY_EXTENT_COLUMNS)
      .eq("id", workspaceId)
      .maybeSingle();

    // `coverage_unknown` is not a neutral fallback. Its copy states that this
    // workspace has not stated a home geography and sends the planner to the
    // dashboard to state one — a claim about a setting, which a failed read did
    // not establish. The same reasoning that makes an unreadable acquisition
    // history fatal to this layer applies here: a coverage sentence that cannot
    // be built honestly must not be built at all.
    const scopeFailure = classifyRouteReadFailure(
      "the workspace's home geography",
      workspaceResult,
      { pendingError: "Workspace geography schema is not available yet" }
    );
    if (scopeFailure) {
      audit.error("crash_layer_scope_read_failed", {
        workspaceId,
        message: scopeFailure.message,
      });
      return NextResponse.json(scopeFailure.body, { status: scopeFailure.status });
    }

    const homeGeography = parseWorkspaceHomeGeography(workspaceResult.data);
    const bbox = homeGeographyBbox(homeGeography);

    let scopeState: CrashLayerScopeState = "coverage_unknown";
    let checkedSourceLabels: string[] = [];
    if (bbox) {
      const resolution = resolveCrashSources(bbox, "ingest");
      if (resolution.kind === "resolved") {
        scopeState = "covered";
      } else {
        scopeState = "out_of_coverage";
        checkedSourceLabels = resolution.checked.map((entry) => entry.label);
      }
    }

    // Both reads ride the same round trip. `count: "exact"` on each keeps the
    // disclosure and the drawn features from coming out of differently-filtered
    // queries, and the acquisition read is what turns an empty crash layer from
    // a silent zero into a stated reason.
    const [crashResult, ingestResult] = await Promise.all([
      supabase
        .from("safety_crashes")
        .select(CRASH_LAYER_PROJECTION, { count: "exact" })
        .eq("workspace_id", workspaceId)
        .order("collision_date", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .limit(MAP_FEATURE_LAYER_LIMIT),
      supabase
        .from("safety_crash_ingests")
        .select(
          `status, coverage_state, severity_completeness, crash_count, geocoded_count, ${INGEST_EXTENT_COLUMNS}`,
          { count: "exact" }
        )
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(MAP_FEATURE_LAYER_LIMIT),
    ]);

    // A failed acquisition read is fatal to the LAYER, not just to its copy.
    // Drawing crash points whose coverage sentences could not be built is the
    // silent degrade this module exists to prevent: the backdrop renders a
    // failed layer as "could not be loaded, which is not a finding that there
    // are none here", which is the true statement.
    if (crashResult.error || ingestResult.error) {
      audit.error("crash_layer_query_failed", {
        workspaceId,
        crashError: crashResult.error?.message ?? null,
        ingestError: ingestResult.error?.message ?? null,
      });
      return NextResponse.json({ error: "Failed to load acquired crashes" }, { status: 500 });
    }

    const rows = (crashResult.data ?? []) as unknown as CrashRow[];
    const ingestRows = (ingestResult.data ?? []) as unknown as IngestSummaryRow[];

    const features = rows.flatMap((row) => {
      const lat = coerceLat(row.latitude);
      const lng = coerceLng(row.longitude);
      if (lat === null || lng === null) return [];
      // The SHARED reader, not a local copy. A severity outside the vocabulary
      // cannot be coloured or labelled honestly, so `readCrashRowFacts` returns
      // null and the row is counted as undrawable rather than painted as a
      // severity it is not.
      //
      // WHAT THIS REPLACED, AND WHY IT MATTERED. Both casualty counts used to go
      // through `coerceInt`, which returns 0 for anything unreadable — so a
      // collision whose counts the source never supplied was published to the
      // shared map as "0 killed, 0 injured" and rendered in the inspector as a
      // crash where nobody was hurt. That is roughly 5% of one state's records
      // and 9.5% in one rural county of it. Null now travels to the screen and
      // the inspector says "not reported".
      const facts = readCrashRowFacts(row);
      if (!facts) return [];
      return [
        {
          type: "Feature" as const,
          id: row.id,
          geometry: { type: "Point" as const, coordinates: [lng, lat] },
          properties: {
            kind: "safety_crash",
            crashId: row.id,
            projectId: projectIdOf(row.safety_crash_ingests),
            ...facts,
          },
        },
      ];
    });

    const matchedCount =
      typeof crashResult.count === "number" && Number.isFinite(crashResult.count)
        ? crashResult.count
        : rows.length;
    const droppedCount = rows.length - features.length;

    const acquisitionState = summarizeCrashAcquisitions(
      ingestRows.map((row) => ({
        status: row.status ?? "",
        coverageState: row.coverage_state ?? "",
      })),
      { storedCrashCount: matchedCount }
    );

    // Both flags are read only from acquisitions that actually COMPLETED. A
    // pending or failed run stored nothing, so its severity capability and its
    // geocoding shortfall say nothing about the points on screen.
    const readyIngests = ingestRows.filter((row) => row.status === "ready");
    const anyUngeocoded = readyIngests.some(
      (row) => coerceInt(row.crash_count) > coerceInt(row.geocoded_count)
    );
    const anySeverityIncomplete = readyIngests.some(
      (row) => (row.severity_completeness ?? "") !== "kabco_full"
    );

    // Where the drawn crashes actually came from, compared against the stated
    // area. Completed acquisitions only: a queued or failed run asked for an
    // area but stored nothing, so crediting the drawn set to it would describe
    // the layer as covering ground it holds no rows for.
    const acquiredAreas = summarizeAcquiredAreas(readyIngests.map(extentOf), bbox);

    // Counted off the DRAWN set — the only population this response can honestly
    // count, since both reads are capped. The copy says "of the collisions drawn
    // here" for that reason.
    const unclassifiedCount = features.filter(
      (feature) => feature.properties.severity === "unknown"
    ).length;

    const coverageNotes = describeCrashLayerCoverage({
      scopeState,
      scopeLabel: homeGeography?.home_geography_label ?? null,
      checkedSourceLabels,
      acquisitionState,
      acquiredAreas,
      anyUngeocoded,
      anySeverityIncomplete,
      unclassifiedCount,
      returnedCount: features.length,
      matchedCount,
      droppedCount,
      limit: MAP_FEATURE_LAYER_LIMIT,
    });

    audit.info("crash_layer_loaded", {
      workspaceId,
      count: features.length,
      matchedCount,
      droppedCount,
      scopeState,
      acquisitionState,
      // Logged because "the dots are outside the stated area" is the condition
      // that used to produce a false note; an operator seeing it in the log can
      // check the sentence a planner was actually shown.
      acquiredAreaCount: acquiredAreas.areaCount,
      acquiredAreasOutsideHome: acquiredAreas.outsideHomeCount,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        type: "FeatureCollection" as const,
        features,
        returnedCount: features.length,
        matchedCount,
        droppedCount,
        truncated: features.length + droppedCount < matchedCount,
        limit: MAP_FEATURE_LAYER_LIMIT,
        scopeState,
        acquisitionState,
        coverageNotes,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("crash_layer_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading acquired crashes" },
      { status: 500 }
    );
  }
}
