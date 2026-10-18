/** Composition uses an explicit model of inherited write effects, not PostgreSQL execution. */
import { describe, expect, it, vi } from "vitest";
import { buildSafetySeedPreview } from "@/lib/grants/ss4a-safety-seed";
import { readSafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import { persistSafetyPlanGeneration, sameSafetyRevision, SAFETY_PLAN_PERSISTENCE_VERSION, type SafetyArtifactInsert, type SafetyReportWriteback } from "@/lib/reports/safety-plan-persistence";
import { safetySeedFixture, seedId } from "./fixtures/grants/safety-seed";

function generationComposition() {
  const rows = safetySeedFixture();
  const snapshot = readSafetyPlanSnapshot(rows.artifact.metadata_json.safetyPlanSnapshotV1)!;
  rows.project.updated_at = snapshot.projectUpdatedAt; // P0 before persistence.
  const effects: string[] = [];
  const artifact: SafetyArtifactInsert = { id: snapshot.artifactId, report_id: snapshot.reportId, artifact_kind: "html", storage_path: "fixture.html",
    generated_by: seedId(99), generated_at: snapshot.generatedAt, metadata_json: { safetyPlanSnapshotV1: snapshot, generationWriteback: null } };
  const reportUpdate: SafetyReportWriteback = { status: "generated", generated_at: snapshot.generatedAt,
    latest_artifact_kind: "html", latest_artifact_url: `/api/reports/${snapshot.reportId}/artifacts/${snapshot.artifactId}/download`,
    metadata_json: rows.report.metadata_json, rtp_basis_stale: false, rtp_basis_stale_reason: null, rtp_basis_stale_run_id: null, rtp_basis_stale_marked_at: null };
  const rpc = vi.fn(async (): Promise<{ data: unknown; error: { code: string; message: string } | null }> => {
    if (!sameSafetyRevision(rows.project.updated_at, snapshot.projectUpdatedAt)) return { data: null, error: { code: "40001", message: "Project source changed before Safety persistence" } };
    rows.artifact = { id: artifact.id, report_id: artifact.report_id, generated_at: artifact.generated_at, metadata_json: { ...artifact.metadata_json } };
    rows.project.updated_at = "2026-10-18T12:00:01.000001+00:00"; effects.push("artifact insert: P1");
    rows.report.updated_at = "2026-10-18T12:00:02.000002+00:00";
    rows.project.updated_at = "2026-10-18T12:00:02.000002+00:00"; effects.push("report writeback: P2");
    rows.artifact.metadata_json.generationWriteback = { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: rows.report.updated_at };
    rows.project.updated_at = "2026-10-18T12:00:03.000003+00:00"; effects.push("artifact receipt: P3");
    rows.persistence = { artifact_id: snapshot.artifactId, workspace_id: snapshot.workspaceId, project_id: snapshot.projectId, report_id: snapshot.reportId,
      schema_version: SAFETY_PLAN_PERSISTENCE_VERSION, snapshot_hash: snapshot.hash, source_project_updated_at: snapshot.projectUpdatedAt,
      persisted_project_updated_at: rows.project.updated_at, source_report_updated_at: snapshot.reportUpdatedAt, report_updated_at: rows.report.updated_at };
    return { data: rows.persistence, error: null };
  });
  const input = { client: { rpc }, actorId: artifact.generated_by, snapshot, artifact, reportUpdate };
  return { rows, snapshot, effects, input, rpc };
}

describe("generated Safety artifact to SS4A preview composition", () => {
  it("keeps P0 immutable, accounts for all three own effects, and previews the bound P3 source", async () => {
    const f = generationComposition(); const frozen = structuredClone(f.snapshot);
    expect(await persistSafetyPlanGeneration(f.input)).toEqual({ error: null, status: 200 });
    expect(f.rpc).toHaveBeenCalledWith("persist_safety_plan_generation", { p_actor: seedId(99), p_artifact: f.input.artifact, p_report_update: f.input.reportUpdate });
    expect(f.effects).toEqual(["artifact insert: P1", "report writeback: P2", "artifact receipt: P3"]);
    expect(f.snapshot).toEqual(frozen);
    expect(f.rows.project.updated_at).not.toBe(f.snapshot.projectUpdatedAt);
    expect(f.rows.persistence.source_project_updated_at).toBe(f.snapshot.projectUpdatedAt);
    expect(() => buildSafetySeedPreview(f.rows)).not.toThrow();
    expect(buildSafetySeedPreview(f.rows).sections).toHaveLength(6);
  });
  it("refuses a genuine later project edit even one microsecond after P3 in the same millisecond", async () => {
    const f = generationComposition();
    expect((await persistSafetyPlanGeneration(f.input)).status).toBe(200);
    const receipt = structuredClone(f.rows.persistence);
    f.rows.project.name = "Operator changed the project source";
    f.rows.project.updated_at = "2026-10-18T12:00:03.000004+00:00";
    expect(Date.parse(f.rows.project.updated_at)).toBe(Date.parse(receipt.persisted_project_updated_at));
    expect(() => buildSafetySeedPreview(f.rows)).toThrow(/custody.*stale/);
    expect(f.rows.persistence).toEqual(receipt);
  });
  it("refuses a source edit before persistence without adopting that current revision", async () => {
    const f = generationComposition();
    f.rows.project.updated_at = "2026-10-18T12:00:00.000001+00:00";
    expect(await persistSafetyPlanGeneration(f.input)).toMatchObject({ status: 409, error: { code: "40001" } });
    expect(f.effects).toEqual([]);
  });
  it("refuses an artifact payload that differs from the frozen identity before opening the RPC", async () => {
    const f = generationComposition(); f.input.artifact.id = seedId(80);
    expect((await persistSafetyPlanGeneration(f.input)).status).toBe(422);
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.effects).toEqual([]);
  });
  it("requires exact custody identity and refuses malformed or foreign RPC receipts", async () => {
    const f = generationComposition();
    f.input.client.rpc.mockResolvedValueOnce({ data: { ...f.rows.persistence, artifact_id: seedId(80) }, error: null });
    expect((await persistSafetyPlanGeneration(f.input)).status).toBe(500);
    f.input.client.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await persistSafetyPlanGeneration(f.input)).status).toBe(500);
  });
  it("compares equivalent offsets and full PostgreSQL revision precision without a grace period", () => {
    expect(sameSafetyRevision("2026-10-18T12:00:03.000003Z", "2026-10-18T05:00:03.000003-07:00")).toBe(true);
    expect(sameSafetyRevision("2026-10-18T12:00:03Z", "2026-10-18T12:00:03.000000+00:00")).toBe(true);
    expect(sameSafetyRevision("2026-10-18T12:00:03.000003Z", "2026-10-18T12:00:03.000004Z")).toBe(false);
    expect(sameSafetyRevision(undefined, undefined)).toBe(false);
  });
});
