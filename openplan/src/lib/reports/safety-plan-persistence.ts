import { z } from "zod";
import { readSafetyPlanSnapshot, type SafetyPlanSnapshot } from "./safety-plan-snapshot";
import { sameSafetyRevision } from "./safety-revision";
export { sameSafetyRevision } from "./safety-revision";

export const SAFETY_PLAN_PERSISTENCE_VERSION = "openplan.safety-plan-persistence.v1";
export const SAFETY_PLAN_PERSISTENCE_SELECT = "artifact_id, workspace_id, project_id, report_id, schema_version, snapshot_hash, source_project_updated_at, persisted_project_updated_at, source_report_updated_at, report_updated_at";
const revision = z.string().datetime({ offset: true });
export const safetyPlanPersistenceSchema = z.object({
  artifact_id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid(), report_id: z.string().uuid(),
  schema_version: z.literal(SAFETY_PLAN_PERSISTENCE_VERSION), snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
  source_project_updated_at: revision, persisted_project_updated_at: revision,
  source_report_updated_at: revision, report_updated_at: revision,
}).strict();
export type SafetyPlanPersistence = z.infer<typeof safetyPlanPersistenceSchema>;

export type SafetyArtifactInsert = {
  id: string; report_id: string; artifact_kind: "html" | "pdf"; storage_path: string | null;
  generated_by: string; generated_at: string; metadata_json: Record<string, unknown>;
};
export type SafetyReportWriteback = {
  status: "generated"; generated_at: string; latest_artifact_kind: "html" | "pdf";
  latest_artifact_url: string; metadata_json: Record<string, unknown>;
  rtp_basis_stale: false; rtp_basis_stale_reason: null; rtp_basis_stale_run_id: null; rtp_basis_stale_marked_at: null;
};
type PersistenceClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };

/** All own writes share one source-revision lock; only the RPC can attest their resulting revision. */
export async function persistSafetyPlanGeneration(input: {
  client: PersistenceClient; actorId: string; snapshot: SafetyPlanSnapshot;
  artifact: SafetyArtifactInsert; reportUpdate: SafetyReportWriteback;
}): Promise<{ error: { message: string; code?: string } | null; status: number; storageDisposition: "remove_unpersisted" | "retain" }> {
  const { snapshot, artifact } = input;
  const retained = readSafetyPlanSnapshot(artifact.metadata_json.safetyPlanSnapshotV1);
  if (!retained || retained.hash !== snapshot.hash || artifact.id !== snapshot.artifactId || artifact.report_id !== snapshot.reportId || artifact.generated_by !== input.actorId) {
    return { error: { message: "Safety persistence payload does not match the frozen source" }, status: 422, storageDisposition: "remove_unpersisted" };
  }
  const result = await input.client.rpc("persist_safety_plan_generation", {
    p_actor: input.actorId, p_artifact: artifact, p_report_update: input.reportUpdate,
  });
  if (result.error) return {
    error: result.error, status: result.error.code === "40001" ? 409 : 500,
    // These PostgreSQL responses abort this RPC transaction. A transport error
    // or an invalid success receipt cannot establish whether it committed.
    storageDisposition: ["40001", "42501", "23514"].includes(result.error.code ?? "") ? "remove_unpersisted" : "retain",
  };
  const parsed = safetyPlanPersistenceSchema.safeParse(result.data);
  const receipt = parsed.success ? parsed.data : null;
  if (!receipt || receipt.artifact_id !== snapshot.artifactId || receipt.report_id !== snapshot.reportId || receipt.project_id !== snapshot.projectId || receipt.workspace_id !== snapshot.workspaceId || receipt.snapshot_hash !== snapshot.hash || !sameSafetyRevision(receipt.source_project_updated_at, snapshot.projectUpdatedAt) || !sameSafetyRevision(receipt.source_report_updated_at, snapshot.reportUpdatedAt)) {
    return { error: { message: "Safety generation did not return its exact source custody receipt" }, status: 500, storageDisposition: "retain" };
  }
  return { error: null, status: 200, storageDisposition: "retain" };
}
