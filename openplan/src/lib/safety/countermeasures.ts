/**
 * The countermeasure list a planner can attach to a high-injury segment.
 *
 * The list lives in a versioned data file with its source and retrieval date,
 * not in components. This module only validates and reads it. A crash
 * modification factor appears only with its CMF Clearinghouse ID; without one
 * the value stays out and the entry carries a visible [VERIFY] note.
 */

import { z } from "zod";
import fhwaProvenSafetyCountermeasures from "./countermeasures/fhwa-proven-safety-countermeasures.v1.json";

export const COUNTERMEASURE_CRASH_TYPES = [
  "pedestrian",
  "bicyclist",
  "speed_related",
  "roadway_departure",
  "nighttime",
  "intersection_turning",
  "intersection_angle",
  "rear_end",
] as const;
export type CountermeasureCrashType = (typeof COUNTERMEASURE_CRASH_TYPES)[number];

export const COUNTERMEASURE_CRASH_TYPE_LABELS: Record<CountermeasureCrashType, string> = {
  pedestrian: "Pedestrian",
  bicyclist: "Bicyclist",
  speed_related: "Speed-related",
  roadway_departure: "Roadway departure",
  nighttime: "Nighttime",
  intersection_turning: "Turning at intersections",
  intersection_angle: "Angle at intersections",
  rear_end: "Rear-end",
};

export const COUNTERMEASURE_FOCUS_AREAS = [
  "speed_management",
  "pedestrian_bicyclist",
  "roadway_departure",
  "intersections",
  "crosscutting",
] as const;

const httpsUrl = z.string().regex(/^https:\/\/[^\s]+$/);

const cmfSchema = z.object({
  value: z.number().positive().lt(10),
  cmfId: z.number().int().positive(),
  url: z.string().regex(/^https:\/\/cmfclearinghouse\.fhwa\.dot\.gov\/detail\.php\?facid=\d+$/),
  appliesTo: z.string().min(1),
});

const countermeasureSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1),
    focusArea: z.enum(COUNTERMEASURE_FOCUS_AREAS),
    crashTypes: z.array(z.enum(COUNTERMEASURE_CRASH_TYPES)).min(1),
    addresses: z.string().min(1),
    sourceUrl: httpsUrl,
    cmf: cmfSchema.nullable(),
    cmfNote: z.string().optional(),
  })
  .refine(
    (entry) => entry.cmf !== null || (entry.cmfNote ?? "").includes("[VERIFY]"),
    { message: "A countermeasure without a cited CMF must carry a [VERIFY] note" },
  )
  .refine(
    (entry) => entry.cmf === null || entry.cmf.url.endsWith(`facid=${entry.cmf.cmfId}`),
    { message: "A CMF value must cite its own Clearinghouse entry" },
  );

export const countermeasureFileSchema = z.object({
  schema: z.literal("openplan.safety_countermeasures.v1"),
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.object({
    title: z.string().min(1),
    publisher: z.string().min(1),
    url: httpsUrl,
    terms: z.string().min(1),
    retrievedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    retrievalNote: z.string().min(1),
  }),
  listNote: z.string().min(1),
  cmfPolicy: z.string().min(1),
  countermeasures: z.array(countermeasureSchema).min(1),
});

export type CountermeasureFile = z.infer<typeof countermeasureFileSchema>;
export type SafetyCountermeasure = CountermeasureFile["countermeasures"][number];

/** Validate a countermeasure file. Throws with the first problem found. */
export function parseCountermeasureFile(raw: unknown): CountermeasureFile {
  const parsed = countermeasureFileSchema.parse(raw);
  const ids = new Set<string>();
  for (const entry of parsed.countermeasures) {
    if (ids.has(entry.id)) throw new Error(`Duplicate countermeasure id: ${entry.id}`);
    ids.add(entry.id);
  }
  return parsed;
}

export const SAFETY_COUNTERMEASURE_FILE: CountermeasureFile = parseCountermeasureFile(fhwaProvenSafetyCountermeasures);
export const SAFETY_COUNTERMEASURES: readonly SafetyCountermeasure[] = SAFETY_COUNTERMEASURE_FILE.countermeasures;

export function getSafetyCountermeasure(id: string): SafetyCountermeasure | null {
  return SAFETY_COUNTERMEASURES.find((entry) => entry.id === id) ?? null;
}

/** The source line printed under any countermeasure table. */
export function describeCountermeasureSource(file: CountermeasureFile = SAFETY_COUNTERMEASURE_FILE): string {
  return `Source: ${file.source.publisher}, ${file.source.title}, ${file.source.url}. Retrieved ${file.source.retrievedOn}; list version ${file.version}.`;
}
