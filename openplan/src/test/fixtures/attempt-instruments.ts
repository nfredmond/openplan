import type { AttemptInstrument } from "@/lib/models/attempt-instrument-read";

export function attemptInstrumentFixture(runId: string, workspaceId: string, index: number): AttemptInstrument {
  return {
    id: `custody-${index}`, workspace_id: workspaceId, model_run_id: runId,
    stage_id: `stage-${Math.floor(index / 2)}`, attempt_id: `attempt-${Math.floor(index / 2)}`,
    demand_method: index % 2 ? "activitysim" : "aequilibrae",
    scientific_outcome: "inconclusive", created_at: "2026-10-09T00:00:00Z",
    ...Object.fromEntries(["model_output", "input_bundle", "match_audit", "comparison_basis", "assessment", "diagnosis"].flatMap(role => [
      [`${role}_artifact_id`, `${role}-${index}`], [`${role}_sha256`, index.toString(16).padStart(64, "0")],
    ])),
  } as AttemptInstrument;
}
