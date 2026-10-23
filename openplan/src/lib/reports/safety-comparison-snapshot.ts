import { createHash } from "node:crypto";
import { z } from "zod";
import { SAFETY_COMPARISON_MEMBER_FIELDS, safetyComparisonRecordSchema, type SafetyComparisonRecord } from "@/lib/safety/candidate-comparison";
import { readSafetyPlanSnapshot, safetySeedHash } from "./safety-plan-snapshot";

export const SAFETY_COMPARISON_RECORD_SELECT = "id, workspace_id, project_id, report_id, parent_revision_id, created_by, created_at, content_hash, content_text, payload";
export const SAFETY_COMPARISON_RENDER_VERSION = "openplan.safety-input-review-render.v2";
const snapshotSchema = z.object({
  version: z.literal("openplan.safety-plan-snapshot.v2"), artifactId: z.string().uuid(),
  reportId: z.string().uuid(), workspaceId: z.string().uuid(), projectId: z.string().uuid(),
  generatedAt: z.string().datetime({ offset: true }), reportUpdatedAt: z.string().datetime({ offset: true }),
  projectUpdatedAt: z.string().datetime({ offset: true }),
  renderVersion: z.literal(SAFETY_COMPARISON_RENDER_VERSION), comparison: safetyComparisonRecordSchema,
}).strict();
export type SafetyComparisonSnapshot = z.infer<typeof snapshotSchema> & { hash: string };

/** DB hashes bind retained PostgreSQL JSON text, a separate contract from v1 stable JSON. */
export function readSafetyComparisonRecord(value: unknown): SafetyComparisonRecord | null {
  const parsed = safetyComparisonRecordSchema.safeParse(value);
  if (!parsed.success) return null;
  const row = parsed.data;
  try {
    if (createHash("sha256").update(row.content_text).digest("hex") !== row.content_hash || safetySeedHash(JSON.parse(row.content_text)) !== safetySeedHash(row.payload)) return null;
    if (row.payload.capture.projection.join(",") !== SAFETY_COMPARISON_MEMBER_FIELDS.join(",")) return null;
    if (row.payload.capture.stored !== row.payload.capture.included + row.payload.capture.excluded + row.payload.capture.indeterminate) return null;
    const reasons = Object.entries(row.payload.capture.reasonCounts);
    if (reasons.reduce((sum, [, count]) => sum + count, 0) !== row.payload.capture.stored
      || (row.payload.capture.reasonCounts.included ?? 0) !== row.payload.capture.included
      || reasons.filter(([key]) => key.startsWith("excluded_")).reduce((sum,[,count]) => sum+count,0) !== row.payload.capture.excluded
      || reasons.filter(([key]) => key.startsWith("indeterminate_")).reduce((sum,[,count]) => sum+count,0) !== row.payload.capture.indeterminate) return null;
    const acquisition = row.payload.source.acquisition;
    if (acquisition.id !== row.payload.inputs.acquisitionId || acquisition.workspace_id !== row.workspace_id || acquisition.project_id !== row.project_id || row.payload.source.projectId !== row.project_id) return null;
    const expectedCosts = new Set(row.payload.inputs.alternatives.filter(a => a.cost.kind === "project_estimate").map(a => a.id));
    if (row.payload.costs.length !== expectedCosts.size || new Set(row.payload.costs.map(c => c.alternativeId)).size !== expectedCosts.size || row.payload.costs.some(c => c.originProjectId !== row.project_id || !expectedCosts.has(c.alternativeId))) return null;
    return row;
  } catch { return null; }
}
export function buildSafetyComparisonSnapshot(input: Omit<z.infer<typeof snapshotSchema>, "version" | "renderVersion">): SafetyComparisonSnapshot {
  const payload = snapshotSchema.parse({ ...input, version: "openplan.safety-plan-snapshot.v2", renderVersion: SAFETY_COMPARISON_RENDER_VERSION });
  if (!readSafetyComparisonRecord(payload.comparison) || payload.comparison.report_id !== payload.reportId || payload.comparison.project_id !== payload.projectId || payload.comparison.workspace_id !== payload.workspaceId) throw new Error("Comparison snapshot ownership differs");
  return { ...payload, hash: safetySeedHash(payload) };
}

/** Exactly one recognized key. Dual keys, unknown versions and malformed snapshots refuse. */
export function readSafetyArtifactSnapshot(metadata: Record<string, unknown> | null | undefined) {
  const keys = Object.keys(metadata ?? {}).filter(key => /^safetyPlanSnapshot/.test(key) && metadata?.[key] !== null && metadata?.[key] !== undefined);
  if (!keys.length) return { kind: "absent" as const };
  if (keys.length !== 1) return { kind: "invalid" as const, reason: "Ambiguous Safety snapshot keys" };
  if (keys[0] === "safetyPlanSnapshotV1") {
    const snapshot = readSafetyPlanSnapshot(metadata!.safetyPlanSnapshotV1);
    return snapshot ? { kind: "v1" as const, snapshot } : { kind: "invalid" as const, reason: "Malformed v1 Safety snapshot" };
  }
  if (keys[0] !== "safetyPlanSnapshotV2") return { kind: "invalid" as const, reason: "Unsupported Safety snapshot version" };
  const parsed = snapshotSchema.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(metadata!.safetyPlanSnapshotV2);
  if (!parsed.success) return { kind: "invalid" as const, reason: "Malformed v2 Safety snapshot" };
  const { hash, ...payload } = parsed.data;
  if (safetySeedHash(payload) !== hash || !readSafetyComparisonRecord(payload.comparison) || payload.comparison.report_id !== payload.reportId || payload.comparison.project_id !== payload.projectId || payload.comparison.workspace_id !== payload.workspaceId) return { kind: "invalid" as const, reason: "V2 snapshot hash or source ownership differs" };
  return { kind: "v2" as const, snapshot: { ...payload, hash } };
}
