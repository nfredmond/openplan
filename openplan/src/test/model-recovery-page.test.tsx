import { isValidElement, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelRunManager } from "@/components/models/model-run-manager";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), rpc: vi.fn(), reap: vi.fn(), from: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: () => { throw new Error("SIGN_IN"); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.auth }, from: mocks.from }),
  createServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/models/run-reconcile", () => ({ reconcileStaleModelRuns: mocks.reap }));
vi.mock("@/lib/models/worker-health-server", () => ({ loadModelingWorkerHealth: async () => null }));
vi.mock("@/lib/models/evidence-backbone", async (load) => ({
  ...await load<typeof import("@/lib/models/evidence-backbone")>(),
  loadModelRunClaimStatuses: async () => new Map(),
}));
import Page from "@/app/(app)/models/[modelId]/page";

const workspace = "10000000-0000-4000-8000-000000000001";
const model = "20000000-0000-4000-8000-000000000001";
const run = "30000000-0000-4000-8000-000000000001";
const stamp = "2026-10-08T10:00:00Z";
type Result = { data: unknown; error: { message: string } | null };
const results = new Map<string, Result>();
const queries: Array<{ table: string; method: string; args: unknown[] }> = [];
function builder(table: string) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "in", "neq", "is", "not", "gt", "maybeSingle", "single"]) {
    query[method] = (...args: unknown[]) => { queries.push({ table, method, args }); return query; };
  }
  query.then = (resolve: (result: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(results.get(table) ?? { data: [], error: null }).then(resolve, reject);
  return query;
}
function managerProps(node: ReactNode): ComponentProps<typeof ModelRunManager> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = managerProps(child); if (found) return found; }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === ModelRunManager) return node.props as ComponentProps<typeof ModelRunManager>;
  return managerProps(node.props.children);
}
const load = () => Page({ params: Promise.resolve({ modelId: model }), searchParams: Promise.resolve({}) });
const response = { workspace_id: workspace, run_id: run, provenance: "historical_unassessed", enrolled_at: stamp, observed_starts: 0, last_start_observed_at: null };

beforeEach(() => {
  vi.clearAllMocks(); results.clear(); queries.length = 0;
  mocks.auth.mockResolvedValue({ data: { user: { id: "40000000-0000-4000-8000-000000000001" } } });
  mocks.from.mockImplementation(builder);
  mocks.reap.mockResolvedValue(new Map());
  mocks.rpc.mockResolvedValue({ data: response, error: null });
  results.set("models", { data: { id: model, workspace_id: workspace, title: "Scoped model", model_family: "travel_demand", status: "draft", project_id: null, scenario_set_id: null, config_json: {} }, error: null });
  results.set("model_runs", { data: [{ id: run, model_id: model, engine_key: "aequilibrae", status: "running", run_title: "Saved run", stages: [], artifacts: [], result_summary_json: null }], error: null });
});

describe("authorized model recovery page join", () => {
  it("does not inspect recovery before sign-in", async () => {
    mocks.auth.mockResolvedValue({ data: { user: null } });
    await expect(load()).rejects.toThrow("SIGN_IN");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not inspect recovery when the user-scoped model is absent", async () => {
    results.set("models", { data: null, error: null });
    await expect(load()).rejects.toThrow("NOT_FOUND");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not inspect recovery after a failed model read", async () => {
    results.set("models", { data: null, error: { message: "read failed" } });
    await expect(load()).rejects.toThrow("Could not read this model");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("carries scoped historical status into the real manager props and excludes it from reaping", async () => {
    const props = managerProps(await load());
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "inspect_model_recovery_status", { p_workspace: workspace, p_run: run });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "inspect_model_relaunch_custody", { p_workspace: workspace, p_run: run });
    expect(props?.modelRuns[0]).toMatchObject({ id: run, status: "running", recovery: { state: "historical_unassessed" } });
    expect(mocks.reap).toHaveBeenCalledExactlyOnceWith([]);
    expect(queries).toContainEqual({ table: "models", method: "eq", args: ["id", model] });
    expect(queries).toContainEqual({ table: "model_runs", method: "eq", args: ["model_id", model] });
    const projection = queries.find((query) => query.table === "model_runs" && query.method === "select")?.args[0];
    expect(projection).toEqual(expect.stringContaining("id, model_id"));
    expect(projection).toEqual(expect.stringContaining("engine_key, status"));
  });
  it("keeps an unavailable recovery read visible and out of reaping", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    const props = managerProps(await load());
    expect(props?.modelRuns[0].recovery).toEqual({ state: "unavailable" });
    expect(mocks.reap).toHaveBeenCalledExactlyOnceWith([]);
  });
  it("does not use a different workspace's recovery record", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...response, workspace_id: "10000000-0000-4000-8000-000000000002" }, error: null });
    expect(managerProps(await load())?.modelRuns[0].recovery).toEqual({ state: "unavailable" });
    expect(mocks.reap).toHaveBeenCalledExactlyOnceWith([]);
  });
  it("retains ordinary reaping for an assessed new run", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...response, provenance: "new_run" }, error: null });
    const props = managerProps(await load());
    expect(props?.modelRuns[0].recovery?.state).toBe("new_run");
    expect(mocks.reap).toHaveBeenCalledWith([expect.objectContaining({ id: run })]);
  });
});


describe("recovery decision permission props", () => {
  const user = "40000000-0000-4000-8000-000000000001";
  it.each(["owner", "admin", "member"])("binds %s membership to the signed-in user and workspace", async (role) => {
    results.set("workspace_members", { data: { workspace_id: workspace, user_id: user, role }, error: null });
    const props = managerProps(await load());
    expect(props?.recoveryUserId).toBe(user);
    expect(props?.recoveryPermission).toBe(role === "member" ? "denied" : "allowed");
    expect(queries).toContainEqual({ table: "workspace_members", method: "select", args: ["workspace_id, user_id, role"] });
    expect(queries).toContainEqual({ table: "workspace_members", method: "eq", args: ["workspace_id", workspace] });
    expect(queries).toContainEqual({ table: "workspace_members", method: "eq", args: ["user_id", user] });
  });
  it.each(["workspace_id", "user_id"])("refuses a membership with different %s", async (field) => {
    results.set("workspace_members", { data: { workspace_id: workspace, user_id: user, role: "owner", [field]: model }, error: null });
    expect(managerProps(await load())?.recoveryPermission).toBe("denied");
  });
  it("keeps failed permission reads unavailable", async () => {
    results.set("workspace_members", { data: null, error: { message: "Synthetic read failure" } });
    expect(managerProps(await load())?.recoveryPermission).toBe("unavailable");
  });
});
