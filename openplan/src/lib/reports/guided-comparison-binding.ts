import "server-only";
import { createHash } from "node:crypto";
import { guidedReportCanonicalJson, objectRecord, readGuidedComparisonSelection, type GuidedComparisonSelectionV1 } from "./guided-comparison";

export function guidedReportDigest(value: unknown): string {
  return createHash("sha256").update(guidedReportCanonicalJson(value)).digest("hex");
}

/** Check the saved metadata authority without reading live model rows or files.
 * A matching digest establishes stored integrity, not current custody or bytes. */
export function readScopedGuidedComparisonBinding(input: {
  reportId: string;
  report: { id: string; workspace_id: string; project_id: string | null; report_type: string;
    rtp_cycle_id?: string | null; engagement_campaign_id?: string | null; metadata_json: unknown };
  project: { id: string; workspace_id: string } | null;
}): GuidedComparisonSelectionV1 | null {
  const { report, project } = input;
  const saved = readGuidedComparisonSelection(report.metadata_json);
  if (!saved) return null;
  const payload = saved.payload;
  if (report.id !== input.reportId || !project || report.report_type !== "analysis_summary" ||
      report.rtp_cycle_id || report.engagement_campaign_id || !report.project_id ||
      project.id !== report.project_id || project.workspace_id !== report.workspace_id ||
      payload.workspaceId !== report.workspace_id || payload.projectId !== report.project_id) {
    throw new Error("The saved guided comparison binding does not match this report's workspace, project or target.");
  }
  const snapshot = objectRecord(payload.snapshot);
  const set = objectRecord(payload.scenarioSet);
  const cells = ["aequilibrae:baseline", "aequilibrae:build", "activitysim:baseline", "activitysim:build"];
  if (!snapshot || !set || snapshot.id !== saved.snapshotId || snapshot.status !== "ready" || typeof set.id !== "string" ||
      snapshot.scenario_set_id !== set.id || payload.entries.length !== 2 ||
      ![snapshot.baseline_entry_id, snapshot.candidate_entry_id].every((id) => typeof id === "string" &&
        payload.entries.filter((entry) => objectRecord(entry)?.id === id).length === 1) ||
      snapshot.baseline_entry_id === snapshot.candidate_entry_id ||
      !cells.every((cell) => payload.sources.filter((source) => `${source.method}:${source.role}` === cell).length === 1) ||
      new Set(payload.sources.map((source) => source.runId)).size !== 4 ||
      new Set(payload.sources.map((source) => objectRecord(source.output)?.id)).size !== 4 ||
      payload.sources.some((source) => {
        const link = objectRecord(source.link);
        const output = objectRecord(source.output);
        return !link || !output || link.comparison_snapshot_id !== saved.snapshotId || link.model_run_id !== source.runId ||
          link.method !== source.method || link.scenario_role !== source.role ||
          typeof output.id !== "string" || output.run_id !== source.runId || link.model_run_artifact_id !== output.id;
      })) {
    throw new Error("The saved guided comparison binding has inconsistent snapshot, scenario or output scopes.");
  }
  if (guidedReportDigest(payload) !== saved.bindingSha256) {
    throw new Error("The saved guided comparison binding digest changed. Review and save the exact snapshot again.");
  }
  return saved;
}
