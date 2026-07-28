/**
 * The shared vocabulary for a project corridor: which types exist, and which
 * Level-of-Service grades exist.
 *
 * WHY THIS MODULE. Both lists are enforced by CHECK constraints in
 * `20260421000066_project_corridors.sql`. Until now nothing in the app wrote a
 * corridor, so nothing had to know them. Once a route validates input and a form
 * offers a dropdown, the same list exists in three places — the database, the
 * API schema, and the UI — and three copies of a list drift. A row rejected by
 * Postgres because a select offered an option the CHECK does not allow is a
 * 500 that reads as a bug in saving, not as a mismatch in vocabulary.
 *
 * So the API and the UI both read from here, and `corridor-vocabulary.test.ts`
 * reads the migration to prove this file still matches the constraint.
 *
 * The vocabulary is deliberately generic — highway / arterial / transit / bike /
 * trail / custom, and LOS A–F — because it must describe a corridor anywhere,
 * for any agency. `custom` is the escape hatch for anything these six miss.
 */

export const CORRIDOR_TYPES = [
  "highway",
  "arterial",
  "transit",
  "bike",
  "trail",
  "custom",
] as const;

export type CorridorType = (typeof CORRIDOR_TYPES)[number];

export const CORRIDOR_TYPE_LABELS: Record<CorridorType, string> = {
  highway: "Highway",
  arterial: "Arterial",
  transit: "Transit",
  bike: "Bikeway",
  trail: "Trail",
  custom: "Other",
};

/** The database default, so a create form and the column agree on the fallback. */
export const DEFAULT_CORRIDOR_TYPE: CorridorType = "arterial";

export const CORRIDOR_LOS_GRADES = ["A", "B", "C", "D", "E", "F"] as const;

export type CorridorLosGrade = (typeof CORRIDOR_LOS_GRADES)[number];

/**
 * LOS is optional on purpose: a corridor a planner has drawn but not yet graded
 * is a normal state, and the backdrop paints it with the neutral base color.
 * Forcing a grade would mean inventing one.
 */
export const CORRIDOR_LOS_GRADE_LABELS: Record<CorridorLosGrade, string> = {
  A: "A — free flow",
  B: "B — reasonably free flow",
  C: "C — stable flow",
  D: "D — approaching unstable",
  E: "E — at capacity",
  F: "F — breakdown",
};

/**
 * Vertex cap for a drawn corridor. Matches the engagement geometry cap so the
 * shared picker behaves identically wherever it is used, and bounds what a
 * client can push into a jsonb column.
 */
export const CORRIDOR_MAX_VERTICES = 200;

export function isCorridorType(value: unknown): value is CorridorType {
  return typeof value === "string" && (CORRIDOR_TYPES as readonly string[]).includes(value);
}

export function isCorridorLosGrade(value: unknown): value is CorridorLosGrade {
  return typeof value === "string" && (CORRIDOR_LOS_GRADES as readonly string[]).includes(value);
}
