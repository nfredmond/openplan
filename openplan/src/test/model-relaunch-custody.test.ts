import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, createService } = vi.hoisted(() => ({ rpc: vi.fn(), createService: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: createService }));
import { inspectRelaunchCustody } from "@/lib/models/relaunch-custody";
const workspace = "11111111-1111-4111-8111-111111111111";
const run = "22222222-2222-4222-8222-222222222222";
const receipt = { workspace_id: workspace, run_id: run, state: "unstarted" };
beforeEach(() => {
  vi.resetAllMocks();
  createService.mockReturnValue({ rpc });
  rpc.mockResolvedValue({ data: receipt, error: null });
});
describe("model relaunch custody inspection", () => {
  it.each(["unstarted", "retained", "unassessed"] as const)("accepts the exact scoped %s state", async state => {
    rpc.mockResolvedValue({ data: { ...receipt, state }, error: null });
    expect(await inspectRelaunchCustody(workspace, run)).toBe(state);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("inspect_model_relaunch_custody", { p_workspace: workspace, p_run: run });
  });
  it.each([null, [], {}, { ...receipt, state: true }, { ...receipt, state: "unknown" },
    { ...receipt, run_id: workspace }, { ...receipt, workspace_id: run },
    { ...receipt, extra: true }])("refuses incomplete or mismatched replies: %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await inspectRelaunchCustody(workspace, run)).toBe("unavailable");
  });
  it("refuses a query error even with an apparently successful payload", async () => {
    rpc.mockResolvedValue({ data: receipt, error: { message: "Private error" } });
    expect(await inspectRelaunchCustody(workspace, run)).toBe("unavailable");
  });
  it("refuses transport or service configuration failures", async () => {
    rpc.mockRejectedValue(new Error("Private transport detail"));
    expect(await inspectRelaunchCustody(workspace, run)).toBe("unavailable");
    createService.mockImplementation(() => { throw new Error("Private configuration detail"); });
    expect(await inspectRelaunchCustody(workspace, run)).toBe("unavailable");
  });
});

// Software selection only. These mocked projections are not installed custody.
import { readModelAttemptOutputs, currentCompletedModelOutputs, filterCompletedAttemptRows, currentModelResultRows } from "@/lib/models/attempt-output-read";
const outputId = "40000000-0000-4000-8000-000000000001";
const attemptId = "50000000-0000-4000-8000-000000000001";
const output = { kind: "kpi", ownership_state: "current_completed", record: { id: outputId, run_id: run, attempt_id: attemptId, kpi_name: "daily_vmt", value: 20, unit: "vehicle-miles/day" } };
const outputResponse = () => ({ run_id: run, run_status: "succeeded", outputs: structuredClone([output]) });

it("selects exact current-completed projections while retaining same-name inactive records", async () => {
  const data = outputResponse();
  const inactive = { ...structuredClone(output), ownership_state: "retained_inactive", record: { ...output.record, id: workspace, value: 900 } };
  data.outputs.unshift(inactive);
  rpc.mockResolvedValue({ data, error: null });
  const read = await readModelAttemptOutputs(workspace, run);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("read_model_attempt_outputs", { p_workspace_id: workspace, p_run_id: run });
  expect(read.available).toBe(true); if (!read.available) throw new Error("Missing projection");
  expect(read.outputs).toHaveLength(2);
  const projected = [inactive.record, output.record].map(({ id, run_id, attempt_id, kpi_name, value, unit }) => ({ id, run_id, attempt_id, kpi_name, value, unit }));
  expect(filterCompletedAttemptRows(read, "kpi", projected)).toEqual([output.record]);
  expect(filterCompletedAttemptRows(read, "kpi", [{ ...output.record, value: 900 }])).toEqual([]);
  expect(filterCompletedAttemptRows(read, "artifact", projected)).toEqual([]);
});
it.each(["legacy_unknown", "invalid_binding", "retained_inactive", "current_in_progress"])("does not select %s as a current completed result", async ownership_state => {
  const data = outputResponse(); data.outputs[0].ownership_state = ownership_state;
  rpc.mockResolvedValue({ data, error: null }); const read = await readModelAttemptOutputs(workspace, run);
  expect(read.available).toBe(true); if (!read.available) throw new Error("Missing projection");
  expect(currentCompletedModelOutputs(read, "kpi")).toEqual([]);
});
it.each(["queued", "running", "failed", "cancelled"])("withholds completed-run results on a %s parent", async run_status => {
  rpc.mockResolvedValue({ data: { ...outputResponse(), run_status }, error: null });
  const read = await readModelAttemptOutputs(workspace, run); expect(read.available).toBe(true);
  if (read.available) expect(currentCompletedModelOutputs(read, "kpi")).toEqual([]);
});
it.each([
  { ...outputResponse(), run_id: workspace },
  { ...outputResponse(), outputs: [{ ...output, record: { ...output.record, run_id: workspace } }] },
  { ...outputResponse(), outputs: [{ ...output, record: { ...output.record, attempt_id: null } }] },
  { ...outputResponse(), outputs: [output, output] },
  { ...outputResponse(), outputs: [{ ...output, ownership_state: "approved" }] },
])("rejects mismatched, unowned, duplicate or unknown output authority", async data => {
  rpc.mockResolvedValue({ data, error: null });
  expect(await readModelAttemptOutputs(workspace, run)).toEqual({ available: false });
});
it("keeps output RPC errors and transport loss unavailable", async () => {
  rpc.mockResolvedValue({ data: outputResponse(), error: { message: "private error" } });
  expect(await readModelAttemptOutputs(workspace, run)).toEqual({ available: false });
  rpc.mockRejectedValue(new Error("private transport"));
  expect(await readModelAttemptOutputs(workspace, run)).toEqual({ available: false });
});
function runReader(managed: boolean, scopedWorkspace = workspace) {
  const calls: unknown[] = [];
  const client = { from(table: string) {
    calls.push(table); let from = 0;
    const query = { select(columns: string) { calls.push(columns); return query; },
      eq(key: string, value: string) { calls.push([key, value]); return query; },
      in(key: string, values: string[]) { calls.push([key, values]); return query; }, order(key: string) { calls.push(key); return query; },
      range(start: number) { from = start; return query; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: from === 0 ? [{ id: run, workspace_id: scopedWorkspace, attempt_managed: managed, status: "succeeded" }] : [], error: null })); } };
    return query;
  } };
  return { client, calls };
}
it("filters only authorized current-result rows, leaving legacy meaning separate", async () => {
  const legacy = runReader(false); const rows = [output.record];
  expect(await currentModelResultRows(legacy.client, workspace, [run], "kpi", rows)).toEqual({ data: rows, error: null });
  expect(rpc).not.toHaveBeenCalled();
  expect(legacy.calls).toContain("id, workspace_id, attempt_managed, status");
  expect(legacy.calls).toContainEqual(["workspace_id", workspace]);
  expect(legacy.calls).toContainEqual(["id", [run]]);
  const managed = runReader(true); rpc.mockResolvedValue({ data: outputResponse(), error: null });
  expect(await currentModelResultRows(managed.client, workspace, [run], "kpi", rows)).toEqual({ data: rows, error: null });
  expect((await currentModelResultRows(runReader(true, run).client, workspace, [run], "kpi", rows)).error).not.toBeNull();
});
it("does not redirect an unpinned published citation across retained attempts", async () => {
  const data = outputResponse(); data.outputs.push({ ...structuredClone(output), ownership_state: "retained_inactive", record: { ...output.record, id: workspace } });
  rpc.mockResolvedValue({ data, error: null });
  expect((await currentModelResultRows(runReader(true).client, workspace, [run], "kpi", [output.record], true)).error).not.toBeNull();
});

it("refuses current rows lost behind a disclosed query cap instead of reporting zero", async () => {
  rpc.mockResolvedValue({ data: outputResponse(), error: null });
  expect((await currentModelResultRows(runReader(true).client, workspace, [run], "kpi", [])).error).not.toBeNull();
  expect(await currentModelResultRows(runReader(true).client, workspace, [run], "kpi", [], false, ["unrequested_metric"]))
    .toEqual({ data: [], error: null });
});

it("keeps the scoped retry stale-state predicate and message with nonretry PT409", () => {
  const sql = readFileSync("supabase/migrations/20261022050000_model_output_preserving_relaunch.sql", "utf8");
  const command = sql.match(/CREATE FUNCTION public\.relaunch_model_run_attempts\(p_request_id uuid,p_workspace_id uuid,p_run_id uuid,p_actor_id uuid,p_expected_state jsonb,p_reason text\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)?.[1];
  expect(command, "The scoped six-argument retry command must remain present").toBeDefined();
  if (!command) throw new Error("Missing scoped six-argument retry command");
  expect(command.replace(/\s+/g, " ")).toContain("IF p_expected_state IS DISTINCT FROM public.model_recovery_expected_state(p_run_id) THEN RAISE EXCEPTION 'Model recovery state changed' USING ERRCODE='PT409'; END IF;");
  expect(command).not.toMatch(/ERRCODE\s*=\s*'40001'/);
});
