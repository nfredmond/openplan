import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  checkMonthlyRunCap,
  isRunCapExceeded,
  isRunCapLookupError,
} from "@/lib/config/run-cap";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  fetchCensusForCorridor,
  censusReportedFigures,
  censusUniverseUnavailableNote,
  bboxFromGeojson,
  ACS_YEAR,
  ACS_RETRIEVAL_URL,
} from "@/lib/data-sources/census";
import { CORRIDOR_DECISION_USE_STATUS } from "@/lib/analysis/decision-use";
import { resolveJustice40ForTracts } from "@/lib/data-sources/equity-designation/registry";
import {
  federalJustice40NarrativeLine,
  proxyEquityNarrativeLine,
} from "@/lib/data-sources/equity-designation/disclosure";
import { fetchTractOverlayFeatures } from "@/lib/data-sources/census-geometry";
import { fetchLODESForCorridor } from "@/lib/data-sources/lodes";
import { fetchCrashesForBbox } from "@/lib/data-sources/crashes";
import { fetchTransitAccessForBbox } from "@/lib/data-sources/transit";
import { screenEquity } from "@/lib/data-sources/equity";
import { computeCorridorScores } from "@/lib/data-sources/scoring";
import { classifyWalkBikeAccess } from "@/lib/accessibility/isochrone";
import { buildAnalysisCostThresholdWarning } from "@/lib/ai/cost-threshold";
import { generateGrantInterpretation } from "@/lib/ai/interpret";
import { stripFactCitationTokens } from "@/lib/grants/narrative-grounding";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { validateCorridorGeometry } from "@/lib/geo/corridor-geometry";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { ANALYSIS_QUERY_MAX_CHARS } from "@/lib/analysis/query";

/**
 * This body is a GeoJSON body, and it is sized like one.
 *
 * It used to be `normalJson` (64 KB), which is the right size for a form post
 * and much too small for a real study-area boundary. An official US county
 * boundary from TIGERweb runs from ~10 KB to ~230 KB, and a metro area past
 * 300 KB, so a planner who picked their own county — the front door of this
 * whole product — could have the request refused for being too large, with no
 * boundary they could have chosen instead. A corridor file exported from GIS
 * hit the same wall from the other direction, since the upload accepts 10 MB.
 *
 * `networkGeoJson` is the limit this codebase already uses for a route whose
 * body is a boundary geometry (see the equity-designation ingest). It is a
 * bound, not a budget: the geometry is still validated, and everything
 * downstream reads a bbox and a centroid clip from it.
 */
const ANALYSIS_BODY_MAX_BYTES = BODY_LIMITS.networkGeoJson;

type Position = [number, number] | [number, number, number];

const positionSchema = z.tuple([z.number(), z.number()]);
const ringSchema = z.array(positionSchema).min(4);

const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(ringSchema).min(1),
});

const multiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(ringSchema).min(1)).min(1),
});

const analysisRequestSchema = z.object({
  corridorGeojson: z.union([polygonSchema, multiPolygonSchema]),
  queryText: z.string().trim().min(1).max(ANALYSIS_QUERY_MAX_CHARS),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
});

type CorridorGeoJSON = z.infer<typeof polygonSchema> | z.infer<typeof multiPolygonSchema>;

function collectPositions(corridorGeojson: CorridorGeoJSON): Position[] {
  if (corridorGeojson.type === "Polygon") {
    return corridorGeojson.coordinates.flat() as Position[];
  }
  return corridorGeojson.coordinates.flat(2) as Position[];
}

function buildCentroidFeature(corridorGeojson: CorridorGeoJSON) {
  const points = collectPositions(corridorGeojson);
  const [xSum, ySum] = points.reduce(
    ([xAcc, yAcc], [x, y]) => [xAcc + x, yAcc + y],
    [0, 0]
  );
  const count = points.length || 1;
  return {
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [xSum / count, ySum / count],
    },
    properties: { kind: "corridor_centroid" },
  };
}

function formatCurrency(n: number | null): string {
  if (n === null) return "N/A";
  return "$" + n.toLocaleString("en-US");
}

function generateSummary(
  census: Awaited<ReturnType<typeof fetchCensusForCorridor>>,
  lodes: Awaited<ReturnType<typeof fetchLODESForCorridor>>,
  transit: Awaited<ReturnType<typeof fetchTransitAccessForBbox>>,
  crashes: Awaited<ReturnType<typeof fetchCrashesForBbox>>,
  equity: ReturnType<typeof screenEquity>,
  scores: ReturnType<typeof computeCorridorScores>,
  walkBikeAccess: ReturnType<typeof classifyWalkBikeAccess>
): string {
  const lines: string[] = [];
  // Every ACS figure below is read through the reported-figures boundary, never
  // off the summary directly. `null` there means NOT MEASURED, and an unmeasured
  // universe gets a sentence saying so instead of a sentence narrating its
  // placeholder zero — which is what "0% transit, 0% walk, 0% bike" was.
  const reported = censusReportedFigures(census);

  lines.push(
    `**Corridor Analysis Summary** (${census.tracts.length} census tracts, ` +
      `population: ${
        reported.totalPopulation === null
          ? "not measured"
          : reported.totalPopulation.toLocaleString()
      })`
  );
  // The corridor centroid-clip can be unavailable (a TIGERweb hiccup) or match no
  // tract (a corridor smaller than any tract centroid). When it does, the figures
  // below cover the whole overlapping county set — never let that read as
  // study-area scale.
  if (census.clip.status === "unclipped_county_fallback") {
    const countyWord = census.clip.counties === 1 ? "county" : "counties";
    lines.push(
      `> ⚠️ **County-scale demographics, not corridor-scale.** The corridor clip was ` +
        `unavailable, so population, income, commute, and equity figures below cover the ` +
        `whole of the ${census.clip.counties} overlapping ${countyWord} ` +
        `(${census.clip.countyTracts} tracts). Do not read them as study-area totals.`
    );
  }
  lines.push("");

  // Demographics. A share whose ACS universe was empty is stated as not measured
  // — never as "0% minority, 0% below poverty", which reads as a finding about
  // the place rather than about the read.
  lines.push(
    census.measured.population
      ? `**Demographics:** Median household income: ${formatCurrency(reported.medianIncome)}. ` +
          `${reported.pctMinority}% minority, ${reported.pctBelowPoverty}% below poverty.`
      : `**Demographics:** Not measured. ${censusUniverseUnavailableNote(census, "population") ?? ""} ` +
          "Do not state or imply a population, income, minority share, or poverty share for this corridor."
  );

  // Commute patterns
  lines.push(
    census.measured.commuteMode
      ? `**Commute Mode Share:** ${reported.pctTransit}% transit, ${reported.pctWalk}% walk, ` +
          `${reported.pctBike}% bike, ${reported.pctWfh}% remote.`
      : `**Commute Mode Share:** Not measured. ${censusUniverseUnavailableNote(census, "commuteMode") ?? ""} ` +
          "Do not state or imply a transit, walk, bike, or remote-work share for this corridor."
  );
  lines.push(
    census.measured.vehicleAccess
      ? `**Vehicle Access:** ${reported.pctZeroVehicle}% of households have zero vehicles.`
      : `**Vehicle Access:** Not measured. ${censusUniverseUnavailableNote(census, "vehicleAccess") ?? ""} ` +
          "Do not state or imply a zero-vehicle household share for this corridor."
  );

  // Employment
  lines.push(
    `**Employment:** ~${lodes.totalJobs.toLocaleString()} jobs in the corridor area ` +
      `(${lodes.jobsPerResident} jobs per resident). Source: ${lodes.source}.`
  );

  // Transit access. The line is built by the transit lane itself, beside the
  // numbers, exactly as the crash lane does — the version that used to live here
  // could not describe a feed-derived answer at all, because it printed
  // "including ${busStops} bus stops" and a GTFS summary reports null there
  // (GTFS records a mode on the route, not on the stop). An unobserved run says
  // so rather than narrating nulls, and must never be summarized as an area with
  // no transit.
  lines.push(transit.narrativeLine);
  lines.push(`**Walk/Bike Access (baseline):** Tier ${walkBikeAccess.tier}. ${walkBikeAccess.rationale}`);

  // Safety — the crash lane writes its own line so an unobserved run cannot be
  // narrated here as "0 fatal crashes".
  lines.push(crashes.narrativeLine ?? "");

  // Equity — the ACS income+burden PROXY and the real federal CEJST/Justice40
  // determination are stated as two separate things. The proxy never wears the
  // word "Justice40"; the federal line carries the discontinued-program caveat.
  lines.push(
    proxyEquityNarrativeLine({
      disadvantagedTracts: equity.disadvantagedTracts,
      totalTracts: equity.totalTracts,
    })
  );
  lines.push(federalJustice40NarrativeLine(equity.federalJustice40));
  if (equity.title6Flags.length > 0) {
    lines.push(`Title VI considerations: ${equity.title6Flags.join("; ")}.`);
  }

  // Scores
  lines.push("");
  // `scores.safetyScore` is null whenever no crash source answered — which is the
  // ordinary case anywhere no registered adapter covers. Interpolating it wrote
  // the literal "Safety: null/100" into the deterministic summary, and that
  // sentence then became a CITABLE `s_<n>` fact for the grant narrative.
  lines.push(
    `**Scores:** Accessibility: ${scores.accessibilityScore}/100, ` +
      `Safety: ${scores.safetyScore === null ? "not scored (no crash source answered)" : `${scores.safetyScore}/100`}, ` +
      `Equity: ${scores.equityScore}/100. ` +
      `Overall: ${scores.overallScore}/100 (confidence: ${scores.confidence}).`
  );

  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("analysis", request);
  const startedAt = Date.now();

  let workspaceId: string | undefined;
  let runId: string | undefined;

  try {
    const body = await readJsonWithLimit(request, ANALYSIS_BODY_MAX_BYTES);
    if (!body.ok) {
      audit.warn("request_body_too_large", {
        byteLength: body.byteLength,
        maxBytes: ANALYSIS_BODY_MAX_BYTES,
      });
      return body.response;
    }

    const parsed = analysisRequestSchema.safeParse(body.data);

    if (!parsed.success) {
      audit.warn("validation_failed", {
        issues: parsed.error.issues.length,
      });

      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { corridorGeojson, queryText, workspaceId: parsedWorkspaceId } = parsed.data;
    workspaceId = parsedWorkspaceId;
    const projectId = parsed.data.projectId ?? null;

    const geometryValidation = validateCorridorGeometry(corridorGeojson);
    if (!geometryValidation.ok) {
      audit.warn("geometry_validation_failed", {
        issues: geometryValidation.issues.length,
        sample: geometryValidation.issues.slice(0, 3),
      });

      return NextResponse.json(
        { error: "Invalid corridor geometry", details: geometryValidation.issues },
        { status: 400 }
      );
    }

    const userSupabase = await createClient();
    const {
      data: { user },
    } = await userSupabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { workspaceId });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await userSupabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        workspaceId,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });

      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (!membership) {
      audit.warn("forbidden_workspace", {
        workspaceId,
        userId: user.id,
      });

      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (!canAccessWorkspaceAction("analysis.create", membership.role)) {
      audit.warn("forbidden_role", {
        workspaceId,
        userId: user.id,
        role: membership.role ?? null,
      });

      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    // Provenance: a run may be attributed to a project the planner chose.
    // The insert below runs with the service role, so the workspace check
    // happens here (the DB CHECK constraint backstops it).
    if (projectId) {
      const { data: projectRow, error: projectLookupError } = await userSupabase
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (projectLookupError) {
        audit.error("project_lookup_failed", {
          workspaceId,
          userId: user.id,
          projectId,
          message: projectLookupError.message,
          code: projectLookupError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to verify project" }, { status: 500 });
      }

      if (!projectRow) {
        audit.warn("forbidden_project", { workspaceId, userId: user.id, projectId });
        return NextResponse.json({ error: "Project not found in workspace" }, { status: 403 });
      }
    }

    // No subscription gate: OpenPlan is free and has no paid tier, so there is
    // no state in which a member of this workspace may not run an analysis.
    // Only an operator-set cap (unset by default) can refuse one.
    const runCap = await checkMonthlyRunCap(userSupabase, {
      workspaceId,
      tableName: "runs",
    });

    if (isRunCapLookupError(runCap)) {
      audit.error("run_cap_count_failed", {
        workspaceId,
        userId: user.id,
        message: runCap.message,
        code: runCap.code,
      });
      return NextResponse.json({ error: "Failed to validate the run limit" }, { status: 500 });
    }

    if (isRunCapExceeded(runCap)) {
      audit.warn("run_cap_reached", {
        workspaceId,
        userId: user.id,
        usedRuns: runCap.usedRuns,
        cap: runCap.cap,
      });
      return NextResponse.json({ error: runCap.message }, { status: 429 });
    }

    return await withWorkspaceIntegrationContext(workspaceId, async () => {
      runId = crypto.randomUUID();

      audit.info("analysis_started", {
        runId,
        workspaceId,
        userId: user.id,
        queryLength: queryText.length,
      });

      // --- Fetch real data from external sources ---
      const corridorForApi = corridorGeojson as {
        type: string;
        coordinates: number[][][] | number[][][][];
      };
      const bbox = bboxFromGeojson(corridorForApi);

      // A study area with no usable coordinates cannot be analyzed. Refuse it
      // rather than substituting a geography — every fetch below (ACS, transit,
      // crashes) would otherwise return real data for somewhere the user never
      // chose, and nothing downstream could tell it was the wrong place.
      if (!bbox) {
        audit.warn("analysis_rejected_empty_study_area", { workspaceId, userId: user.id });
        return NextResponse.json(
          { error: "Study area has no usable coordinates. Draw or select an area and try again." },
          { status: 400 }
        );
      }

      // The service-role client is created BEFORE the fetches because the
      // transit registry needs one: a workspace's own ingested GTFS feeds are
      // the strongest transit evidence available and they live in this database,
      // not on a public API. It is the same client the run is persisted with
      // further down.
      const supabase = createServiceRoleClient();

      // Run Census, transit access, and crash fetches in parallel
      const [census, transit, crashes] = await Promise.all([
        fetchCensusForCorridor(corridorForApi),
        // `workspaceId` is not a convenience here — it is the tenant boundary.
        // `gtfs_feeds.workspace_id IS NULL` means a PUBLIC PRELOADED feed shared
        // by every tenant, so a read that merely followed RLS would score this
        // corridor off a stranger's transit agency. See `transit/gtfs-feed.ts`.
        // `parsedWorkspaceId` and not the outer `workspaceId`: the outer one is
        // a `let` declared for the catch block and is therefore `string |
        // undefined` inside this closure, and a workspace filter that could be
        // undefined is the one thing this argument must never be.
        fetchTransitAccessForBbox(bbox, { workspaceId: parsedWorkspaceId, client: supabase }),
        fetchCrashesForBbox(bbox),
      ]);

      // LODES depends on census population
      const lodes = await fetchLODESForCorridor(
        corridorForApi,
        census.totalPopulation,
        census.totalCommuters
      );

      // Real federal Justice40 / CEJST determination, resolved from the designation
      // registry against the study-area tract GEOIDs — NEVER synthesized from the
      // income proxy. Falls to an honest not_determined out of coverage.
      const federalJustice40 = await resolveJustice40ForTracts(
        bbox,
        census.tracts.map((tract) => tract.geoid)
      );

      // Equity screening from census data (proxy), with the real determination injected.
      const equity = screenEquity(census, federalJustice40);

      // Compute composite scores
      const scores = computeCorridorScores(census, lodes, transit, crashes, equity);
      const walkBikeAccess = classifyWalkBikeAccess({
        pctWalk: census.pctWalk,
        pctBike: census.pctBike,
        pctZeroVehicle: census.pctZeroVehicle,
        transitStopsPerSqMile: transit.stopsPerSqMile,
      });

      const tractOverlayFeatures = await fetchTractOverlayFeatures(bbox, census.tracts);
      // Points come from the same fetch that produced the counts, so the map and
      // the scorecard cannot describe different data.
      const crashPointFeatures = crashes.points ?? [];

      // Build result GeoJSON
      const geojson = {
        type: "FeatureCollection" as const,
        features: [
          ...tractOverlayFeatures,
          ...crashPointFeatures,
          {
            type: "Feature" as const,
            geometry: corridorGeojson,
            properties: {
              kind: "analysis_corridor",
              runId,
              overallScore: scores.overallScore,
              accessibilityScore: scores.accessibilityScore,
              safetyScore: scores.safetyScore,
              equityScore: scores.equityScore,
            },
          },
          {
            ...buildCentroidFeature(corridorGeojson),
            properties: {
              kind: "corridor_centroid",
            },
          },
        ],
      };

      // Generate human-readable summary
      const summary = generateSummary(census, lodes, transit, crashes, equity, scores, walkBikeAccess);
      const analysisGeneratedAt = new Date().toISOString();
      // The single boundary for every ACS figure that leaves this route. Built
      // once here so the persisted metrics, the scorecard, the report, and the
      // AI fact list cannot disagree about which demographics exist.
      const reportedCensus = censusReportedFigures(census);

      // Crash provenance drives three separate disclosures below, so resolve it
      // once. `scores.dataQuality.crashDataAvailable` is derived in scoring.ts
      // from a substring test on the old source-id vocabulary ("...-estimate"),
      // which no longer describes anything now that the registry supplies real
      // adapter ids — the summary's own `observed` flag is the fact.
      const crashDataAvailable = crashes.observed === true;
      // A run that could not observe any crash history cannot be a high-confidence
      // run, whatever the rest of the inputs looked like.
      const confidence =
        crashDataAvailable || scores.confidence !== "high" ? scores.confidence : "medium";

      // Build metrics object
      const metrics = {
        // Scores
        accessibilityScore: scores.accessibilityScore,
        safetyScore: scores.safetyScore,
        equityScore: scores.equityScore,
        overallScore: scores.overallScore,
        confidence,

        // Census demographics. null (not 0) whenever the ACS universe behind a
        // figure was empty — the same contract the crash block below uses.
        // Consumers render null as "Not measured", and `buildInterpretationFacts`
        // drops null metrics, so the AI narrative physically cannot cite a
        // demographic figure that was never measured. A zero here therefore means
        // a real reading of zero, which is a finding worth writing down.
        totalPopulation: reportedCensus.totalPopulation,
        medianIncome: reportedCensus.medianIncome,
        pctMinority: reportedCensus.pctMinority,
        pctBelowPoverty: reportedCensus.pctBelowPoverty,
        tractCount: census.tracts.length,
        // The coverage itself, persisted so a report or a later reader can tell
        // "not measured" from "measured as zero" without re-deriving it.
        censusMeasuredUniverses: census.measured,

        // Commute patterns
        pctTransit: reportedCensus.pctTransit,
        pctWalk: reportedCensus.pctWalk,
        pctBike: reportedCensus.pctBike,
        pctWfh: reportedCensus.pctWfh,
        pctZeroVehicle: reportedCensus.pctZeroVehicle,

        // Employment
        totalJobs: lodes.totalJobs,
        jobsPerResident: lodes.jobsPerResident,

        // Transit access
        totalTransitStops: transit.totalStops,
        busStops: transit.busStops,
        railStations: transit.railStations,
        ferryStops: transit.ferryStops,
        stopsPerSquareMile: transit.stopsPerSqMile,
        transitAccessTier: transit.accessTier,
        // Null when the source has no opinion on frequency (OpenStreetMap holds
        // no schedule) — NOT zero, which would read as "no stop is frequent".
        frequentServiceShare: transit.frequentServiceShare,
        frequentServiceStops: transit.frequentServiceStops,
        frequentServiceHeadwayMinutes: transit.frequentServiceHeadwayMinutes,
        walkBikeAccessTier: walkBikeAccess.tier,
        walkBikeAccessScoreBoost: walkBikeAccess.scoreBoost,
        walkBikeAccessRationale: walkBikeAccess.rationale,

        // Safety. null (not 0) whenever no source answered: consumers render null
        // as "N/A", and `buildInterpretationFacts` drops null metrics, so the AI
        // narrative physically cannot cite a crash figure that was never measured.
        totalFatalCrashes: crashDataAvailable ? crashes.totalFatalCrashes : null,
        totalFatalities: crashDataAvailable ? crashes.totalFatalities : null,
        pedestrianFatalities: crashDataAvailable ? crashes.pedestrianFatalities : null,
        bicyclistFatalities: crashDataAvailable ? crashes.bicyclistFatalities : null,
        severeInjuryCrashes: crashDataAvailable ? crashes.severeInjuryCrashes : null,
        totalInjuryCrashes: crashDataAvailable ? crashes.totalInjuryCrashes : null,
        crashesPerSquareMile: crashDataAvailable ? crashes.crashesPerSquareMile : null,
        crashReportedTotal: crashDataAvailable ? crashes.reportedTotal : null,
        crashMappedTotal: crashDataAvailable ? crashes.mappedTotal : null,
        crashPointCount: crashPointFeatures.length,

        // Equity
        disadvantagedTracts: equity.disadvantagedTracts,
        pctDisadvantaged: equity.pctDisadvantaged,
        lowIncomeTracts: equity.lowIncomeTracts,
        highPovertyTracts: equity.highPovertyTracts,
        highMinorityTracts: equity.highMinorityTracts,
        lowVehicleAccessTracts: equity.lowVehicleAccessTracts,
        highTransitDependencyTracts: equity.highTransitDependencyTracts,
        burdenedLowIncomeTracts: equity.burdenedLowIncomeTracts,
        equitySource: equity.source,
        // Honestly-named proxy signal (was justice40Eligible). These flat scalars
        // are PERSISTED for the report to reconstruct the determination, but the
        // equity/Justice40 keys are excluded from the AI's citable fact list
        // (see NON_CITABLE_METRIC_KEYS in interpret.ts) so the grounded narrative
        // can't cite a bare "disadvantaged" fact without the caveat; the caveated
        // summary sentences are the only citable equity claims.
        proxyDisadvantagedFlag: equity.proxyDisadvantagedFlag,
        federalJustice40Status: equity.federalJustice40.status,
        federalJustice40Source: equity.federalJustice40.source,
        federalJustice40DatasetLabel: equity.federalJustice40.datasetLabel,
        federalJustice40NotDeterminedCause: equity.federalJustice40.notDeterminedCause,
        federalJustice40DeterminedTracts: equity.federalJustice40.coverage.determinedTracts,
        federalJustice40UndeterminedTracts: equity.federalJustice40.coverage.undeterminedTracts,
        federalJustice40DisadvantagedTracts: equity.federalJustice40.coverage.disadvantagedTracts,
        federalJustice40CrosswalkInferredTracts: equity.federalJustice40.coverage.crosswalkInferredTracts,
        title6Flags: equity.title6Flags,

        // Data quality
        dataQuality: {
          ...scores.dataQuality,
          crashDataAvailable,
        },

        // Traceability metadata
        methodsVersion: "openplan-gis-methods-v0.2",
        analysisGeneratedAt,
        // Read by `resolveDecisionUseDisclosure` and surfaced on the result card
        // and in the corridor report. It was a bare literal that nothing read for
        // as long as it existed; the constant now lives with the wording that
        // explains it, so the two cannot drift apart.
        decisionUseStatus: CORRIDOR_DECISION_USE_STATUS,
        sourceSnapshots: {
          census: {
            source: `census-acs5-${ACS_YEAR}`,
            dataset: "ACS 5-Year",
            vintage: ACS_YEAR,
            geography: "tract",
            tractCount: census.tracts.length,
            // Corridor vs whole-county provenance travels with the snapshot so a
            // report can never present county-scale demographics as study-area scale.
            clipStatus: census.clip.status,
            clipScale: census.clip.status === "clipped" ? "corridor" : "county",
            corridorTracts: census.clip.corridorTracts,
            countyTracts: census.clip.countyTracts,
            overlappingCounties: census.clip.counties,
            note:
              census.clip.status === "unclipped_county_fallback"
                ? `Corridor centroid-clip unavailable; figures cover the whole overlapping county set (${census.clip.countyTracts} tracts across ${census.clip.counties} ${census.clip.counties === 1 ? "county" : "counties"}), not just the drawn corridor.`
                : census.clip.status === "empty"
                  ? "No resolvable study-area geography or ACS data; demographic figures are empty."
                  : "Figures are clipped to tracts whose centroid falls inside the drawn corridor.",
            retrievalUrl: ACS_RETRIEVAL_URL,
            fetchedAt: analysisGeneratedAt,
          },
          lodes: {
            source: lodes.source,
            note:
              lodes.source === "acs-estimate"
                ? "LODES bulk ingestion is not yet active; employment values use ACS-based estimation."
                : "Employment values derived from direct LODES workflow.",
            fetchedAt: analysisGeneratedAt,
          },
          // Built by the transit lane, beside the figures it describes, so a
          // caller rendering transit numbers cannot forget to say how they were
          // measured. It carries `method` — the record of which source produced
          // this run's transit term, which is what lets a later reader see why
          // the same corridor scored differently before and after a feed was
          // ingested, and what makes two differently-measured runs refuse to
          // subtract. STORED RUNS ARE NEVER REWRITTEN: an old run keeps its old
          // method and its old score.
          transit: transit.sourceSnapshot,
          crashes: crashes.sourceSnapshot,
          equity: {
            source: equity.source,
            note: "Equity flags are an ACS income + burden proxy (corridor-level tract indicators) — a screening proxy, NOT the federal CEJST/Justice40 or California SB 535 disadvantaged-community designation.",
            fetchedAt: analysisGeneratedAt,
          },
          equityDesignation: {
            source: equity.federalJustice40.source,
            status: equity.federalJustice40.status,
            datasetLabel: equity.federalJustice40.datasetLabel,
            version: equity.federalJustice40.version,
            vintage: equity.federalJustice40.vintage,
            // WHEN THIS DEPLOYMENT CAPTURED THE DESIGNATION, distinct from the
            // dataset's own vintage above. A planner defending a Justice40
            // finding is asked how current their copy is; until now the answer
            // was written on every ingest and reachable from no surface. Null
            // means the source records no capture date — a bundled static asset
            // has none — and must not be read as "current".
            retrievedAt: equity.federalJustice40.retrievedAt,
            determinedTracts: equity.federalJustice40.coverage.determinedTracts,
            undeterminedTracts: equity.federalJustice40.coverage.undeterminedTracts,
            disadvantagedTracts: equity.federalJustice40.coverage.disadvantagedTracts,
            note:
              equity.federalJustice40.source === null
                ? "No official disadvantaged-community designation source covered this study area; Justice40 status is not determined."
                : "Federal CEJST/Justice40 is a DISCONTINUED program (rescinded 2025-01-20); this is a frozen historical v1.0 snapshot keyed on 2010 tracts, not a current federal determination.",
            fetchedAt: analysisGeneratedAt,
          },
        },
      };

      const aiInterpretationResult = await generateGrantInterpretation(metrics, summary);

      const finalizedMetrics = {
        ...metrics,
        aiInterpretationSource: aiInterpretationResult.source,
        dataQuality: {
          // Spread the already-corrected block, not `scores.dataQuality`, or the
          // crash-availability correction above is silently undone here.
          ...metrics.dataQuality,
          aiInterpretationSource: aiInterpretationResult.source,
          // Provenance disclosure: >0 means the stored narrative is the grounded
          // subset of the model's draft, not the full draft.
          aiInterpretationDroppedSentences: aiInterpretationResult.droppedSentenceCount,
        },
      };

      // --- Persist run ---
      const { error: insertError } = await supabase.from("runs").insert({
        id: runId,
        workspace_id: workspaceId,
        title: queryText.length > 60 ? queryText.slice(0, 57) + "..." : queryText,
        query_text: queryText,
        corridor_geojson: corridorGeojson,
        metrics: finalizedMetrics,
        result_geojson: geojson,
        summary_text: summary,
        ai_interpretation: aiInterpretationResult.text,
        // Only sent when the planner chose a project, so a deployment that has
        // not applied the provenance migration keeps working untouched.
        ...(projectId ? { project_id: projectId } : {}),
      });

      if (insertError) {
        audit.error("persist_failed", {
          runId,
          workspaceId,
          message: insertError.message,
          code: insertError.code ?? null,
          details: insertError.details ?? null,
        });

        return NextResponse.json(
          { error: "Failed to persist run", details: insertError.message },
          { status: 500 }
        );
      }

      const durationMs = Date.now() - startedAt;

      if (aiInterpretationResult.fallbackReason) {
        audit.warn("analysis_ai_fallback", {
          runId,
          workspaceId,
          reason: aiInterpretationResult.fallbackReason,
        });
      }

      if (aiInterpretationResult.droppedSentenceCount > 0) {
        audit.warn("analysis_ai_sentences_dropped", {
          runId,
          workspaceId,
          droppedSentenceCount: aiInterpretationResult.droppedSentenceCount,
          issues: aiInterpretationResult.droppedSentenceIssues.slice(0, 10),
        });
      }

      audit.info("analysis_completed", {
        runId,
        workspaceId,
        durationMs,
        confidence: scores.confidence,
        aiSource: aiInterpretationResult.source,
        aiModel: aiInterpretationResult.model,
        aiInputTokens: aiInterpretationResult.inputTokens,
        aiOutputTokens: aiInterpretationResult.outputTokens,
        aiTotalTokens: aiInterpretationResult.totalTokens,
        aiEstimatedCostUsd: aiInterpretationResult.estimatedCostUsd,
      });

      const costWarning = buildAnalysisCostThresholdWarning(
        aiInterpretationResult.estimatedCostUsd,
      );
      if (costWarning) {
        audit.warn("analysis_cost_threshold_exceeded", {
          runId,
          workspaceId,
          aiModel: aiInterpretationResult.model,
          aiInputTokens: aiInterpretationResult.inputTokens,
          aiOutputTokens: aiInterpretationResult.outputTokens,
          aiTotalTokens: aiInterpretationResult.totalTokens,
          ...costWarning,
        });
      }

      return NextResponse.json(
        {
          runId,
          metrics: finalizedMetrics,
          geojson,
          summary,
          // The stored value keeps its [fact:N] provenance tokens; this response
          // feeds the explore result card directly, so strip for display here
          // just like use-explore-run-history does for the history path.
          aiInterpretation: stripFactCitationTokens(aiInterpretationResult.text),
          aiInterpretationSource: aiInterpretationResult.source,
        },
        { status: 200 }
      );
    });
  } catch (error) {
    audit.error("analysis_unhandled_error", {
      runId,
      workspaceId,
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json(
      { error: "Analysis failed unexpectedly" },
      { status: 500 }
    );
  }
}
