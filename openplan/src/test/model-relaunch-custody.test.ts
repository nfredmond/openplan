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
