import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { fetchCensusForCorridor, bboxFromGeojson } from "@/lib/data-sources/census";
import { fetchLODESForCorridor } from "@/lib/data-sources/lodes";
import { fetchCrashesForBbox } from "@/lib/data-sources/crashes";
import { fetchTransitAccessForBbox } from "@/lib/data-sources/transit";
import { screenEquity } from "@/lib/data-sources/equity";
import { computeCorridorScores } from "@/lib/data-sources/scoring";
import { classifyWalkBikeAccess } from "@/lib/accessibility/isochrone";
import { generateGrantInterpretation } from "@/lib/ai/interpret";
import { createApiAuditLogger } from "@/lib/observability/audit";

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
  queryText: z.string().trim().min(1),
  workspaceId: z.string().uuid(),
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

  // Transit access
  lines.push(
    `**Transit Access:** ${transit.totalStops} stops/stations (${transit.stopsPerSqMile}/sq mi), ` +
      `including ${transit.busStops} bus stops, ${transit.railStations} rail stations, ` +
      `${transit.ferryStops} ferry terminals. Access tier: ${transit.accessTier}.`
  );
  lines.push(`**Walk/Bike Access (baseline):** Tier ${walkBikeAccess.tier}. ${walkBikeAccess.rationale}`);

  // Safety
  const yearsStr = crashes.yearsQueried.join(", ");
  lines.push(
    `**Safety (${yearsStr || "estimated"}):** ${crashes.totalFatalCrashes} fatal crashes, ` +
      `${crashes.totalFatalities} fatalities (${crashes.pedestrianFatalities} pedestrian, ` +
      `${crashes.bicyclistFatalities} bicyclist). Crash density: ${crashes.crashesPerSquareMile}/sq mi.`
  );

  // Equity
  lines.push(
    `**Equity:** ${equity.disadvantagedTracts} of ${equity.totalTracts} tracts are disadvantaged ` +
      `(${equity.pctDisadvantaged}%). Justice40 eligible: ${equity.justice40Eligible ? "Yes" : "No"}. ` +
      `Method: ${equity.source}.`
  );
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
    const body = await request.json().catch(() => null);
    const parsed = analysisRequestSchema.safeParse(body);

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
    runId = crypto.randomUUID();

    audit.info("analysis_started", {
      runId,
      workspaceId,
      queryLength: queryText.length,
    });

    // --- Fetch real data from external sources ---
    const corridorForApi = corridorGeojson as {
      type: string;
      coordinates: number[][][] | number[][][][];
    };
    const bbox = bboxFromGeojson(corridorForApi);

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

    // Equity screening from census data
    const equity = screenEquity(census);

    // Compute composite scores
    const scores = computeCorridorScores(census, lodes, transit, crashes, equity);
    const walkBikeAccess = classifyWalkBikeAccess({
      pctWalk: census.pctWalk,
      pctBike: census.pctBike,
      pctZeroVehicle: census.pctZeroVehicle,
      transitStopsPerSqMile: transit.stopsPerSqMile,
    });

    // Build result GeoJSON
    const geojson = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: corridorGeojson,
          properties: { kind: "analysis_corridor", runId },
        },
        buildCentroidFeature(corridorGeojson),
      ],
    };

    // Generate human-readable summary
    const summary = generateSummary(census, lodes, transit, crashes, equity, scores, walkBikeAccess);

    // Build metrics object
    const metrics = {
      // Scores
      accessibilityScore: scores.accessibilityScore,
      safetyScore: scores.safetyScore,
      equityScore: scores.equityScore,
      overallScore: scores.overallScore,
      confidence: scores.confidence,

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

      // Safety
      totalFatalCrashes: crashes.totalFatalCrashes,
      totalFatalities: crashes.totalFatalities,
      pedestrianFatalities: crashes.pedestrianFatalities,
      bicyclistFatalities: crashes.bicyclistFatalities,
      severeInjuryCrashes: crashes.severeInjuryCrashes,
      totalInjuryCrashes: crashes.totalInjuryCrashes,
      crashesPerSquareMile: crashes.crashesPerSquareMile,

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
      justice40Eligible: equity.justice40Eligible,
      title6Flags: equity.title6Flags,

      // Data quality
      dataQuality: scores.dataQuality,
    };

    const aiInterpretationResult = await generateGrantInterpretation(metrics, summary);

    const finalizedMetrics = {
      ...metrics,
      aiInterpretationSource: aiInterpretationResult.source,
      dataQuality: {
        ...(scores.dataQuality ?? {}),
        aiInterpretationSource: aiInterpretationResult.source,
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
    audit.info("analysis_completed", {
      runId,
      workspaceId,
      durationMs,
      confidence: scores.confidence,
      aiSource: aiInterpretationResult.source,
    });

    return NextResponse.json(
      {
        runId,
        metrics: finalizedMetrics,
        geojson,
        summary,
        aiInterpretation: aiInterpretationResult.text,
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
