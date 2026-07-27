import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  checkMonthlyRunCap,
  isRunCapExceeded,
  isRunCapLookupError,
} from "@/lib/config/run-cap";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  fetchCensusForCorridor,
  bboxFromGeojson,
  ACS_YEAR,
  ACS_RETRIEVAL_URL,
} from "@/lib/data-sources/census";
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

const ANALYSIS_BODY_MAX_BYTES = BODY_LIMITS.normalJson;

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

  lines.push(
    `**Corridor Analysis Summary** (${census.tracts.length} census tracts, ` +
      `population: ${census.totalPopulation.toLocaleString()})`
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

  // Demographics
  lines.push(`**Demographics:** Median household income: ${formatCurrency(census.medianIncomeWeighted)}. ` +
    `${census.pctMinority}% minority, ${census.pctBelowPoverty}% below poverty.`);

  // Commute patterns
  lines.push(
    `**Commute Mode Share:** ${census.pctTransit}% transit, ${census.pctWalk}% walk, ` +
      `${census.pctBike}% bike, ${census.pctWfh}% remote. ` +
      `${census.pctZeroVehicle}% of households have zero vehicles.`
  );

  // Employment
  lines.push(
    `**Employment:** ~${lodes.totalJobs.toLocaleString()} jobs in the corridor area ` +
      `(${lodes.jobsPerResident} jobs per resident). Source: ${lodes.source}.`
  );

  // Transit access. An unobserved run says so rather than narrating nulls —
  // and must never be summarized as an area with no transit.
  lines.push(
    transit.observed
      ? `**Transit Access:** ${transit.totalStops} stops/stations (${transit.stopsPerSqMile}/sq mi), ` +
          `including ${transit.busStops} bus stops, ${transit.railStations} rail stations, ` +
          `${transit.ferryStops} ferry terminals. Access tier: ${transit.accessTier}.`
      : `**Transit Access:** Not measured. ${transit.unavailableReason ?? ""} Do not state or imply a transit stop count, density, or access tier for this corridor.`
  );
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
  lines.push(
    `**Scores:** Accessibility: ${scores.accessibilityScore}/100, ` +
      `Safety: ${scores.safetyScore}/100, Equity: ${scores.equityScore}/100. ` +
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

    // Run Census, transit access, and crash fetches in parallel
    const [census, transit, crashes] = await Promise.all([
      fetchCensusForCorridor(corridorForApi),
      fetchTransitAccessForBbox(bbox),
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

      // Census demographics
      totalPopulation: census.totalPopulation,
      medianIncome: census.medianIncomeWeighted,
      pctMinority: census.pctMinority,
      pctBelowPoverty: census.pctBelowPoverty,
      tractCount: census.tracts.length,

      // Commute patterns
      pctTransit: census.pctTransit,
      pctWalk: census.pctWalk,
      pctBike: census.pctBike,
      pctWfh: census.pctWfh,
      pctZeroVehicle: census.pctZeroVehicle,

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
      decisionUseStatus: "concept-level",
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
        transit: {
          source: transit.source,
          observed: transit.observed,
          note: transit.observed
            ? "Transit stop density is currently approximated from OSM/Overpass transit stop inventory."
            : (transit.unavailableReason ??
              "No transit source answered; stop counts and density were not measured."),
          fetchedAt: analysisGeneratedAt,
        },
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
    const supabase = createServiceRoleClient();
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
