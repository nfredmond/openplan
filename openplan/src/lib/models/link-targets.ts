import type { ModelLinkType } from "@/lib/models/catalog";

/**
 * Where each kind of model link points, and what to select from it.
 *
 * This map existed three times — twice inside `api/models/[modelId]/route.ts`
 * (once for link validation, once for the linked-record hydration in its GET)
 * and once in `api/models/route.ts` — and the copies had already drifted. Two of
 * them named `data_datasets.geometry_scope`, a column that does not exist; the
 * column is `geography_scope` (20260313000014_data_hub_module.sql:47).
 *
 * PostgREST answers a bad projection with HTTP 400 / SQLSTATE 42703, so the
 * consequences were: saving a model with a dataset link always failed
 * validation, the model GET 500'd for any model carrying one, and the model
 * detail page — which never checks `.error` — rendered "0 linked datasets" over
 * a model that had several, then fed that structural zero into its readiness
 * score. The one copy that was CORRECT is the one that selected the least.
 *
 * Supabase clients here are deliberately untyped (see `lib/models/api.ts`), so
 * `.select()` strings are not checked against the schema and a column typo
 * surfaces at runtime rather than at build. That is the standing hazard this
 * module narrows: one map, in one place, with the projection sized to its job.
 *
 *   - `identitySelect` is what link VALIDATION needs, and all it needs — enough
 *     to count the rows that came back and read one label. Selecting display
 *     columns there is what let a display-only typo break saving a model at all.
 *   - `detailSelect` is what the model-detail response renders for a linked
 *     record.
 *
 * Not folded in here: the sibling `LINK_TARGET_CONFIG` maps under
 * `api/plans/**` and `api/programs/**`. They describe different link vocabularies
 * and carry their own row shapes; unifying them is a separate change.
 */
export type ModelLinkTarget = {
  table: string;
  labelField: "title" | "name";
  /** Identity + label only. What `validateModelLinks` reads, and nothing more. */
  identitySelect: string;
  /** The columns the model-detail response renders for a linked record. */
  detailSelect: string;
};

export const MODEL_LINK_TARGETS: Record<ModelLinkType, ModelLinkTarget> = {
  scenario_set: {
    table: "scenario_sets",
    labelField: "title",
    identitySelect: "id, workspace_id, title",
    detailSelect: "id, workspace_id, project_id, title, summary, planning_question, status, updated_at",
  },
  report: {
    table: "reports",
    labelField: "title",
    identitySelect: "id, workspace_id, title",
    detailSelect: "id, workspace_id, project_id, title, report_type, status, generated_at, updated_at",
  },
  data_dataset: {
    table: "data_datasets",
    labelField: "name",
    identitySelect: "id, workspace_id, name",
    detailSelect: "id, workspace_id, name, status, vintage_label, geography_scope, updated_at",
  },
  plan: {
    table: "plans",
    labelField: "title",
    identitySelect: "id, workspace_id, title",
    detailSelect: "id, workspace_id, project_id, title, plan_type, status, updated_at",
  },
  project_record: {
    table: "projects",
    labelField: "name",
    identitySelect: "id, workspace_id, name",
    detailSelect: "id, workspace_id, name, status, delivery_phase, updated_at",
  },
  run: {
    table: "runs",
    labelField: "title",
    identitySelect: "id, workspace_id, title",
    detailSelect: "id, workspace_id, title, created_at",
  },
};

/**
 * What `identitySelect` returns. `title` and `name` are both optional because
 * which one a row carries is decided by that target's `labelField` — the row is
 * read as `row[config.labelField]`, never as `row.title` directly.
 */
export type ModelLinkIdentityRow = {
  id: string;
  workspace_id: string;
  title?: string | null;
  name?: string | null;
};
