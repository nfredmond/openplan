import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { fetchCensusForCorridor, bboxFromGeojson } from "@/lib/data-sources/census";
import { fetchLODESForCorridor } from "@/lib/data-sources/lodes";
import { fetchCrashesForBbox } from "@/lib/data-sources/crashes";
import { screenEquity } from "@/lib/data-sources/equity";
import { computeCorridorScores } from "@/lib/data-sources/scoring";

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
  crashes: Awaited<ReturnType<typeof fetchCrashesForBbox>>,
  equity: ReturnType<typeof screenEquity>,
  scores: ReturnType<typeof computeCorridorScores>
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
      `(${equity.pctDisadvantaged}%). Justice40 eligible: ${equity.justice40Eligible ? "Yes" : "No"}.`
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
  const body = await request.json().catch(() => null);
  const parsed = analysisRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { corridorGeojson, queryText, workspaceId } = parsed.data;
  const runId = crypto.randomUUID();

  // --- Fetch real data from external sources ---
  const corridorForApi = corridorGeojson as { type: string; coordinates: number[][][] | number[][][][] };
  const bbox = bboxFromGeojson(corridorForApi);

  // Run Census and crash fetches in parallel
  const [census, crashes] = await Promise.all([
    fetchCensusForCorridor(corridorForApi),
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
  const scores = computeCorridorScores(census, lodes, crashes, equity);

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
  const summary = generateSummary(census, lodes, crashes, equity, scores);

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

    // Safety
    totalFatalCrashes: crashes.totalFatalCrashes,
    totalFatalities: crashes.totalFatalities,
    pedestrianFatalities: crashes.pedestrianFatalities,
    bicyclistFatalities: crashes.bicyclistFatalities,
    crashesPerSquareMile: crashes.crashesPerSquareMile,

    // Equity
    disadvantagedTracts: equity.disadvantagedTracts,
    pctDisadvantaged: equity.pctDisadvantaged,
    justice40Eligible: equity.justice40Eligible,
    title6Flags: equity.title6Flags,

    // Data quality
    dataQuality: scores.dataQuality,
  };

  // --- Persist run ---
  const supabase = createServiceRoleClient();
  const { error: insertError } = await supabase.from("runs").insert({
    id: runId,
    workspace_id: workspaceId,
    title: queryText.length > 60 ? queryText.slice(0, 57) + "..." : queryText,
    query_text: queryText,
    corridor_geojson: corridorGeojson,
    metrics,
    result_geojson: geojson,
    summary_text: summary,
  });

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to persist run", details: insertError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ runId, metrics, geojson, summary }, { status: 200 });
}
