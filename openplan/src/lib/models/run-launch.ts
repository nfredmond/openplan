import { z } from "zod";
import type { ManagedRunModeKey } from "@/lib/models/run-modes";

const positionSchema = z.tuple([z.number(), z.number()]);
const ringSchema = z.array(positionSchema).min(4);

export const corridorPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(ringSchema).min(1),
});

export const corridorMultiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(ringSchema).min(1)).min(1),
});

export const corridorGeojsonSchema = z.union([corridorPolygonSchema, corridorMultiPolygonSchema]);

export type CorridorGeojson = z.infer<typeof corridorGeojsonSchema>;

export type LaunchTemplate = {
  queryText: string | null;
  corridorGeojson: CorridorGeojson | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function extractModelLaunchTemplate(configJson: Record<string, unknown> | null | undefined): LaunchTemplate {
  const root = asRecord(configJson);
  const runTemplate = asRecord(root.runTemplate);
  const analysisRequest = asRecord(root.analysisRequest);
  const scenarioDefaults = asRecord(root.scenarioDefaults);

  const queryTextCandidates = [
    runTemplate.queryText,
    runTemplate.analysisQueryText,
    analysisRequest.queryText,
    root.queryText,
    root.analysisQueryText,
    scenarioDefaults.queryText,
  ];

  const corridorCandidates = [
    runTemplate.corridorGeojson,
    analysisRequest.corridorGeojson,
    root.corridorGeojson,
    scenarioDefaults.corridorGeojson,
  ];

  const queryText =
    queryTextCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;

  let corridorGeojson: CorridorGeojson | null = null;
  for (const candidate of corridorCandidates) {
    const parsed = corridorGeojsonSchema.safeParse(candidate);
    if (parsed.success) {
      corridorGeojson = parsed.data;
      break;
    }
  }

  return { queryText, corridorGeojson };
}

export function mergeScenarioLaunchPayload({
  modelTemplate,
  scenarioAssumptions,
  overrideQueryText,
  overrideCorridorGeojson,
}: {
  modelTemplate: LaunchTemplate;
  scenarioAssumptions?: Record<string, unknown> | null | undefined;
  overrideQueryText?: string | null | undefined;
  overrideCorridorGeojson?: CorridorGeojson | null | undefined;
}) {
  const assumptions = asRecord(scenarioAssumptions);
  const assumptionQuery =
    [assumptions.analysisQueryText, assumptions.queryText]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?.trim() ?? null;
  const assumptionSuffix =
    typeof assumptions.analysisQuerySuffix === "string" && assumptions.analysisQuerySuffix.trim().length > 0
      ? assumptions.analysisQuerySuffix.trim()
      : null;
  const assumptionCorridor = corridorGeojsonSchema.safeParse(assumptions.corridorGeojson).success
    ? (assumptions.corridorGeojson as CorridorGeojson)
    : null;

  const queryBase = overrideQueryText?.trim() || assumptionQuery || modelTemplate.queryText || null;
  const queryText = queryBase ? [queryBase, assumptionSuffix].filter(Boolean).join(" — ") : null;
  const corridorGeojson = overrideCorridorGeojson || assumptionCorridor || modelTemplate.corridorGeojson || null;

  return {
    queryText,
    corridorGeojson,
    assumptionSnapshot: assumptions,
    engineKey: "deterministic_corridor_v1" as ManagedRunModeKey,
  };
}

/**
 * The transit provenance a model run must carry forward from the analysis run
 * that produced its scores, copied VERBATIM and never re-derived.
 *
 * A model run's result summary is four numbers, and four numbers cannot say how
 * transit was measured. Without this the scenario comparison board reported every
 * model run as "measurement not recorded", which refused every comparison against
 * an analysis run measured identically AND permitted the comparison between two
 * model runs measured differently — the refusal inverted in both directions at
 * once. `source` and `method` are the two fields `resolveTransitMethod` reads;
 * nothing else about the snapshot belongs in a run summary.
 */
function transitProvenanceFrom(metrics: Record<string, unknown>): Record<string, unknown> | null {
  const snapshots = metrics.sourceSnapshots;
  if (!snapshots || typeof snapshots !== "object" || Array.isArray(snapshots)) return null;

  const transit = (snapshots as Record<string, unknown>).transit;
  if (!transit || typeof transit !== "object" || Array.isArray(transit)) return null;

  const { source, method } = transit as { source?: unknown; method?: unknown };
  if (source === undefined && method === undefined) return null;

  return { transit: { source: source ?? null, method: method ?? null } };
}

export function buildModelRunResultSummary(payload: {
  runId: string;
  metrics?: Record<string, unknown> | null | undefined;
  summary?: string | null | undefined;
}) {
  const metrics = payload.metrics && typeof payload.metrics === "object" ? payload.metrics : {};
  const sourceSnapshots = transitProvenanceFrom(metrics);

  return {
    runId: payload.runId,
    overallScore: typeof metrics.overallScore === "number" ? metrics.overallScore : null,
    accessibilityScore: typeof metrics.accessibilityScore === "number" ? metrics.accessibilityScore : null,
    safetyScore: typeof metrics.safetyScore === "number" ? metrics.safetyScore : null,
    equityScore: typeof metrics.equityScore === "number" ? metrics.equityScore : null,
    confidence: typeof metrics.confidence === "string" ? metrics.confidence : null,
    summary: payload.summary ?? null,
    ...(sourceSnapshots ? { sourceSnapshots } : {}),
  };
}

/**
 * Compatibility re-export. This module never owned the question — it happened to
 * be where the models lane first needed it, and four unrelated callers now import
 * it from here. Point them at `@/lib/supabase/pending-schema` and delete this line.
 */
export { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
