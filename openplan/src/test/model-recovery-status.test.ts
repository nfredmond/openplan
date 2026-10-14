import { beforeEach, describe, expect, it, vi } from "vitest";
import { historicalRunNeedsDecision, modelRecoveryNeedsReview, modelRecoveryNotice, modelRelaunchNotice } from "@/lib/models/recovery-status";
import { managedRunStatusPresentation } from "@/lib/models/run-status";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc }) }));
import { loadModelRecoveryStatuses } from "@/lib/models/recovery-status-server";

const workspace = "10000000-0000-4000-8000-000000000001";
const run = "20000000-0000-4000-8000-000000000001";
const stamp = "2026-10-08T10:00:00+00:00";
const response = {
  workspace_id: workspace, run_id: run, provenance: "historical_unassessed",
  enrolled_at: stamp, observed_starts: 0, last_start_observed_at: null,
};
const runs = [{ id: run, engine_key: "aequilibrae" }];
const decisionRow = { request_id: "50000000-0000-4000-8000-000000000001", outcome: "kept_as_record", actor_id: "60000000-0000-4000-8000-000000000001", reason: "Synthetic review", recorded_at: stamp };

beforeEach(() => { rpc.mockReset(); rpc.mockImplementation(async (name: string) => ({ data: name === "inspect_model_relaunch_custody" ? { workspace_id: workspace, run_id: run, state: "unstarted" } : response, error: null })); });

describe("scoped recovery records", () => {
  it("reads the exact workspace/run and preserves observed enrollment", async () => {
    const result = await loadModelRecoveryStatuses(workspace, runs);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "inspect_model_recovery_status", { p_workspace: workspace, p_run: run });
    expect(rpc).toHaveBeenNthCalledWith(2, "inspect_model_relaunch_custody", { p_workspace: workspace, p_run: run });
    expect(result.get(run)).toEqual({ state: "historical_unassessed", relaunchCustody: "unstarted", enrolledAt: stamp, observedStarts: 0, lastStartObservedAt: null, historicalDecision: null });
  });
  it.each(["kept_as_record", "closed_for_fresh_run"] as const)("carries a recorded %s decision with its actor and reason", async (outcome) => {
    rpc.mockResolvedValueOnce({ data: { ...response, historical_decision: { ...decisionRow, outcome } }, error: null });
    expect((await loadModelRecoveryStatuses(workspace, runs)).get(run)).toMatchObject({
      state: "historical_unassessed",
      historicalDecision: { requestId: decisionRow.request_id, outcome, actorId: decisionRow.actor_id, reason: decisionRow.reason, recordedAt: stamp },
    });
  });
  it("reads an explicit null decision as undecided", async () => {
    rpc.mockResolvedValueOnce({ data: { ...response, historical_decision: null }, error: null });
    expect((await loadModelRecoveryStatuses(workspace, runs)).get(run)).toMatchObject({ state: "historical_unassessed", historicalDecision: null });
  });
  it.each(["retained", "unassessed", "unavailable"])("preserves %s custody separately from new-run provenance", async (state) => {
    rpc.mockResolvedValueOnce({ data: { ...response, provenance: "new_run" }, error: null });
    rpc.mockResolvedValueOnce(state === "unavailable"
      ? { data: null, error: { message: "private custody failure" } }
      : { data: { workspace_id: workspace, run_id: run, state }, error: null });
    expect((await loadModelRecoveryStatuses(workspace, runs)).get(run)).toEqual({
      state: "new_run", relaunchCustody: state, enrolledAt: stamp, observedStarts: 0, lastStartObservedAt: null,
    });
  });
  it("does not apply worker recovery rules to in-process engines", async () => {
    expect(await loadModelRecoveryStatuses(workspace, [{ id: run, engine_key: "deterministic_corridor_v1" }])).toEqual(new Map());
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["workspace", { workspace_id: "10000000-0000-4000-8000-000000000002" }],
    ["run", { run_id: "20000000-0000-4000-8000-000000000002" }],
    ["missing enrollment", { enrolled_at: null }],
    ["unknown provenance", { provenance: "approved" }],
    ["negative count", { observed_starts: -1 }],
    ["unmatched count", { observed_starts: 1 }],
    ["unmatched timestamp", { last_start_observed_at: stamp }],
    ["extra field", { authorize_replay: true }],
    ["decision on a new run", { provenance: "new_run", historical_decision: decisionRow }],
    ["unknown decision outcome", { historical_decision: { ...decisionRow, outcome: "resumed" } }],
    ["decision without reason", { historical_decision: { ...decisionRow, reason: "" } }],
    ["decision with extra field", { historical_decision: { ...decisionRow, continuation_authorized: true } }],
  ])("keeps %s failures unavailable", async (_, changed) => {
    rpc.mockResolvedValue({ data: { ...response, ...changed }, error: null });
    expect((await loadModelRecoveryStatuses(workspace, runs)).get(run)).toEqual({ state: "unavailable" });
  });
  it("keeps native and transport failures distinct from assessed records", async () => {
    rpc.mockResolvedValueOnce({ data: response, error: { message: "private detail" } });
    expect((await loadModelRecoveryStatuses(workspace, runs)).get(run)).toEqual({ state: "unavailable" });
    rpc.mockRejectedValueOnce(new Error("private transport detail"));
    expect((await loadModelRecoveryStatuses(workspace, runs)).get(run)).toEqual({ state: "unavailable" });
  });
  it("retains new execution observations without granting ownership", async () => {
    rpc.mockResolvedValueOnce({ data: { ...response, provenance: "new_run", observed_starts: 2, last_start_observed_at: stamp }, error: null });
    expect((await loadModelRecoveryStatuses(workspace, runs)).get(run)).toEqual({ state: "new_run", relaunchCustody: "unstarted", enrolledAt: stamp, observedStarts: 2, lastStartObservedAt: stamp });
  });
});

describe("historical status presentation", () => {
  it.each(["queued", "running", "failed", "succeeded"])("does not present historical %s as current execution", (status) => {
    const recovery = { state: "historical_unassessed" as const, enrolledAt: stamp, observedStarts: 0, lastStartObservedAt: null };
    expect(managedRunStatusPresentation({ status, engine_key: "aequilibrae", artifacts: [], recovery })).toEqual({ label: "Needs a decision", tone: "warning" });
    expect(modelRecoveryNeedsReview(recovery)).toBe(true);
    expect(historicalRunNeedsDecision(recovery)).toBe(true);
    expect(modelRecoveryNotice(recovery)).toBe("Recorded before recovery tracking. Keep as a record, or close it to run again.");
    expect(modelRelaunchNotice(recovery)).toBe("This run cannot be relaunched. Start a new run instead.");
  });
  it.each([
    ["kept_as_record", "Kept as a record", "Kept as a record. Its saved results stay as they were."],
    ["closed_for_fresh_run", "Closed", "Closed. Its saved results stay as they were. Start a new run to run it again."],
  ] as const)("labels a %s decision without making the run live", (outcome, label, notice) => {
    const historicalDecision = { requestId: decisionRow.request_id, outcome, actorId: decisionRow.actor_id, reason: "Synthetic review", recordedAt: stamp };
    const recovery = { state: "historical_unassessed" as const, enrolledAt: stamp, observedStarts: 0, lastStartObservedAt: null, historicalDecision };
    expect(managedRunStatusPresentation({ status: "running", engine_key: "aequilibrae", artifacts: [], recovery })).toEqual({ label, tone: "neutral" });
    expect(modelRecoveryNotice(recovery)).toBe(notice);
    expect(historicalRunNeedsDecision(recovery)).toBe(false);
    expect(modelRecoveryNeedsReview(recovery)).toBe(true);
    expect(modelRelaunchNotice(recovery)).not.toBeNull();
  });
  it("does not turn a failed read into historical enrollment", () => {
    expect(managedRunStatusPresentation({ status: "running", engine_key: "aequilibrae", artifacts: [], recovery: { state: "unavailable" } }).label).toBe("Recovery status unavailable");
    expect(modelRecoveryNotice({ state: "unavailable" })).toContain("could not be read");
  });
  it("retains the existing preflight distinction for assessed new runs", () => {
    const recovery = { state: "new_run" as const, enrolledAt: stamp, observedStarts: 1, lastStartObservedAt: stamp };
    expect(managedRunStatusPresentation({ status: "succeeded", engine_key: "behavioral_demand", artifacts: [], recovery }).label).toBe("Preflight only");
    expect(modelRecoveryNotice(recovery)).toBeNull();
    expect(modelRecoveryNeedsReview(recovery)).toBe(false);
  });
});
