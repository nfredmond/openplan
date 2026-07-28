import { z } from "zod";

/**
 * The editable fields of a project record, and the vocabulary they accept.
 *
 * WHY THIS MODULE. `POST /api/projects` and `PATCH /api/projects/[projectId]`
 * write the same five columns. Two hand-written schemas for one row is how
 * create and edit drift: a status the create form accepts and the edit form
 * rejects is a bug nobody notices until a planner is stuck mid-workflow.
 *
 * It also fixes a real gap in the create path. `status` and `delivery_phase`
 * carry CHECK constraints in `20260313000011_projects_module.sql`, but the
 * create schema validated them only as `z.string().min(1).max(40)` — so an
 * unrecognized status reached Postgres and came back as a 500 that reads like
 * saving is broken, rather than a 400 naming the allowed values.
 * `project-record-fields.test.ts` reads the migration to prove these lists still
 * match the constraints.
 *
 * `plan_type` is deliberately NOT an enum: the column has no CHECK, because the
 * kinds of plan an agency runs vary by agency and by country, and pinning that
 * vocabulary in code would be exactly the sort of hardcoding a planner outside
 * the original scope would have to edit source to escape.
 */

export const PROJECT_STATUSES = ["draft", "active", "on_hold", "complete"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_DELIVERY_PHASES = [
  "scoping",
  "analysis",
  "engagement",
  "programming",
  "delivery",
  "complete",
] as const;
export type ProjectDeliveryPhase = (typeof PROJECT_DELIVERY_PHASES)[number];

/** Defaults the create path applies when a field is omitted. */
export const PROJECT_DEFAULT_STATUS: ProjectStatus = "active";
export const PROJECT_DEFAULT_DELIVERY_PHASE: ProjectDeliveryPhase = "scoping";
export const PROJECT_DEFAULT_PLAN_TYPE = "corridor_plan";

export const projectNameSchema = z.string().trim().min(1).max(120);
export const projectSummarySchema = z.string().trim().max(2000);
export const projectPlanTypeSchema = z.string().trim().min(1).max(80);
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export const projectDeliveryPhaseSchema = z.enum(PROJECT_DELIVERY_PHASES);

/**
 * Statuses that mean "this project is no longer being worked".
 *
 * `DELETE` refuses a project that carries downstream evidence and points here
 * instead: retiring a project is a status change, which is reversible, where a
 * delete is not. See `project-delete-preconditions.ts`.
 */
export const PROJECT_RETIRED_STATUSES: readonly ProjectStatus[] = ["complete"];

/** Human-facing labels. Kept beside the vocabulary so a new value cannot ship unlabelled. */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  active: "Active",
  on_hold: "On hold",
  complete: "Complete",
};

export const PROJECT_DELIVERY_PHASE_LABELS: Record<ProjectDeliveryPhase, string> = {
  scoping: "Scoping",
  analysis: "Analysis",
  engagement: "Engagement",
  programming: "Programming",
  delivery: "Delivery",
  complete: "Complete",
};
