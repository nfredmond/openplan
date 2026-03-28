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

export function buildModelRunResultSummary(payload: {
  runId: string;
  metrics?: Record<string, unknown> | null | undefined;
  summary?: string | null | undefined;
}) {
  const metrics = payload.metrics && typeof payload.metrics === "object" ? payload.metrics : {};

  return {
    runId: payload.runId,
    overallScore: typeof metrics.overallScore === "number" ? metrics.overallScore : null,
    accessibilityScore: typeof metrics.accessibilityScore === "number" ? metrics.accessibilityScore : null,
    safetyScore: typeof metrics.safetyScore === "number" ? metrics.safetyScore : null,
    equityScore: typeof metrics.equityScore === "number" ? metrics.equityScore : null,
    confidence: typeof metrics.confidence === "string" ? metrics.confidence : null,
    summary: payload.summary ?? null,
  };
}

export function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}
