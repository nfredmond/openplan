import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), rpc: vi.fn(), query: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.auth }, from: mocks.query }), createServiceRoleClient: () => { mocks.service(); return { rpc: mocks.rpc }; } }));
vi.mock("@/lib/models/api", () => ({ loadModelAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { GET, POST } from "@/app/api/models/[modelId]/runs/[modelRunId]/recovery/route";
const [model, run, workspace, actor, requestId, stage, attempt] = Array.from({ length: 7 }, (_, n) => `${String(n + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);
const stamp = "2026-10-08T19:00:00+00:00";
const state = { model_id: model, run_id: run, workspace_id: workspace, status: "running", updated_at: stamp, attempt_managed: true, stages: [{ id: stage, status: "running", updated_at: stamp, active_attempt_id: attempt, attempt_managed: true }] };
const decision = () => ({ requestId, decision: "abandon_execution", expectedState: structuredClone(state), reason: "Synthetic reviewed abandonment", evidence: { scope: "unconfirmed" } });
const context = () => ({ params: Promise.resolve({ modelId: model, modelRunId: run }) });
const request = (body: unknown = decision(), headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/recovery", { method: "POST", headers: { "Content-Type": "application/json", "origin": "http://localhost", "x-openplan-expected-user": actor, "x-openplan-expected-workspace": workspace, ...headers }, body: JSON.stringify(body) });
const receipt = () => ({ request_id: requestId, workspace_id: workspace, run_id: run, actor_id: actor, outcome: "execution_abandoned", run_status: "cancelled", process_termination_verified: false, continuation_authorized: false, model_resumed: false, reported_evidence_verified: false, request_payload: { workspace_id: workspace, run_id: run, actor_id: actor, expected_state: structuredClone(state), reason: decision().reason, reported_evidence: decision().evidence } });
let runRow: Record<string, unknown> | null;
let runError: { message: string } | null;
let queries: Array<[string, unknown]>;
beforeEach(() => {
 vi.clearAllMocks(); mocks.auth.mockResolvedValue({ data: { user: { id: actor } } });
 mocks.access.mockResolvedValue({ model: { id: model, workspace_id: workspace }, membership: { workspace_id: workspace, role: "owner" }, allowed: true, error: null });
 mocks.rpc.mockResolvedValue({ data: receipt(), error: null });
 runRow = { id: run, model_id: model, workspace_id: workspace, engine_key: "aequilibrae" }; runError = null; queries = [];
 mocks.query.mockImplementation((table: string) => {
  queries.push(["table", table]);
  const chain = { select: (value: string) => { queries.push(["select", value]); return chain; }, eq: (key: string, value: string) => { queries.push([key, value]); return chain; }, maybeSingle: async () => ({ data: runRow, error: runError }) }; return chain;
 });
});
it("derives actor and scope and asserts the full run projection", async () => {
 const result = await POST(request(), context()); expect(result.status).toBe(200); expect(await result.json()).toEqual(receipt());
 expect(mocks.access).toHaveBeenCalledWith(expect.anything(), model, actor, "models.write");
 expect(queries).toEqual([["table", "model_runs"], ["select", "id, model_id, workspace_id, engine_key"], ["id", run], ["model_id", model], ["workspace_id", workspace]]);
 expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("abandon_model_run_execution", { p_request_id: requestId, p_workspace_id: workspace, p_run_id: run, p_actor_id: actor, p_expected_state: state, p_reason: decision().reason, p_evidence: decision().evidence });
});
it("reads a scoped inspection without continuation authority", async () => {
 const observation = { expected_state: state, process_termination_verified: false, continuation_authorized: false, model_resumed: false }; mocks.rpc.mockResolvedValue({ data: observation, error: null });
 const result = await GET(new NextRequest("http://localhost/api/recovery", { headers: { "x-openplan-expected-user": actor, "x-openplan-expected-workspace": workspace } }), context()); expect(result.status).toBe(200); expect(await result.json()).toEqual(observation);
 expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("inspect_model_run_recovery", { p_workspace_id: workspace, p_run_id: run, p_actor_id: actor });
});
it("refuses unauthenticated requests before privileged access", async () => { mocks.auth.mockResolvedValue({ data: { user: null } }); expect((await POST(request(), context())).status).toBe(401); expect(mocks.service).not.toHaveBeenCalled(); });
it.each(["member", "viewer"])("refuses %s recovery", async (role) => { mocks.access.mockResolvedValue({ model: { id: model, workspace_id: workspace }, membership: { workspace_id: workspace, role }, allowed: true, error: null }); expect((await POST(request(), context())).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled(); });
it.each(["actorId", "workspaceId", "modelRunId"])("rejects caller-supplied %s", async (key) => { expect((await POST(request({ ...decision(), [key]: stage }), context())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-approval-id", "x-openplan-assistant-input-hash"])("refuses agent header %s", async (header) => { expect((await POST(request(decision(), { [header]: "synthetic" }), context())).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled(); });
it.each(["workspace_id", "model_id", "run_id"])("refuses reviewed state with different %s", async (key) => { const body = decision(); Object.assign(body.expectedState, { [key]: actor }); expect((await POST(request(body), context())).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled(); });
it("refuses mismatched or unavailable run reads", async () => { runRow = { ...runRow, model_id: actor }; expect((await POST(request(), context())).status).toBe(404); runError = { message: "private lookup detail" }; expect((await POST(request(), context())).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled(); });
it("requires fresh review after progress", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { message: "Model recovery state changed", code: "P0001" } }); expect((await POST(request(), context())).status).toBe(409); });
it.each(["actor_id", "request_payload", "process_termination_verified", "model_resumed"])("keeps changed receipt %s unconfirmed", async (key) => { mocks.rpc.mockResolvedValue({ data: { ...receipt(), [key]: "changed" }, error: null }); const result = await POST(request(), context()); expect(result.status).toBe(503); expect((await result.json()).outcome).toBe("recovery_unconfirmed"); });
it("keeps lost replies unconfirmed and repeats exact requests", async () => { mocks.rpc.mockRejectedValueOnce(new Error("private transport detail")).mockResolvedValueOnce({ data: receipt(), error: null }); const first = await POST(request(), context()); expect(first.status).toBe(503); expect(await first.text()).not.toContain("private transport detail"); expect((await POST(request(), context())).status).toBe(200); expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]); });
it("refuses inspection with invented continuation authority", async () => { mocks.rpc.mockResolvedValue({ data: { expected_state: state, process_termination_verified: false, continuation_authorized: true, model_resumed: false }, error: null }); expect((await GET(new NextRequest("http://localhost/api/recovery", { headers: { "x-openplan-expected-user": actor, "x-openplan-expected-workspace": workspace } }), context())).status).toBe(503); });

it("rejects noncanonical request identities before transport", async () => { expect((await POST(request({ ...decision(), requestId: "AAAAAAAA-1111-4111-8111-111111111111" }), context())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });

it.each(["x-openplan-expected-user", "x-openplan-expected-workspace", "origin"])("refuses changed browser scope %s", async (header) => { expect((await POST(request(decision(), { [header]: "changed" }), context())).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled(); });

const historicalState = { ...state, attempt_managed: false, stages: [{ ...state.stages[0], active_attempt_id: null, attempt_managed: false }] };
const historicalDecision = (decisionName = "keep_as_record") => ({ requestId, decision: decisionName, expectedState: structuredClone(historicalState), reason: "Reviewed saved outputs" });
const historicalReceipt = (outcome = "kept_as_record") => ({ request_id: requestId, workspace_id: workspace, run_id: run, actor_id: actor, outcome, run_status: "running", run_record_changed: false, process_termination_verified: false, continuation_authorized: false, model_resumed: false, request_payload: { workspace_id: workspace, run_id: run, actor_id: actor, expected_state: structuredClone(historicalState), outcome, reason: "Reviewed saved outputs" } });
it.each([["keep_as_record", "kept_as_record"], ["close_for_fresh_run", "closed_for_fresh_run"]])("records historical %s with the session actor and reason", async (decisionName, outcome) => {
 mocks.rpc.mockResolvedValue({ data: historicalReceipt(outcome), error: null });
 const result = await POST(request(historicalDecision(decisionName)), context()); expect(result.status).toBe(200); expect(await result.json()).toEqual(historicalReceipt(outcome));
 expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("record_historical_model_run_decision", { p_request_id: requestId, p_workspace_id: workspace, p_run_id: run, p_actor_id: actor, p_expected_state: historicalState, p_outcome: outcome, p_reason: "Reviewed saved outputs" });
 expect(queries).toEqual([["table", "model_runs"], ["select", "id, model_id, workspace_id, engine_key"], ["id", run], ["model_id", model], ["workspace_id", workspace]]);
});
it.each(["member", "viewer"])("refuses a historical decision by a %s", async (role) => { mocks.access.mockResolvedValue({ model: { id: model, workspace_id: workspace }, membership: { workspace_id: workspace, role }, allowed: true, error: null }); expect((await POST(request(historicalDecision()), context())).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled(); });
it("refuses a historical decision from another workspace's owner", async () => { mocks.access.mockResolvedValue({ model: { id: model, workspace_id: workspace }, membership: { workspace_id: actor, role: "owner" }, allowed: true, error: null }); expect((await POST(request(historicalDecision()), context())).status).toBe(403); expect(mocks.service).not.toHaveBeenCalled(); });
it("refuses a historical decision about another workspace's run state", async () => { const body = historicalDecision(); body.expectedState.workspace_id = actor; expect((await POST(request(body), context())).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled(); });
it.each([["actorId", actor], ["outcome", "kept_as_record"], ["evidence", {}]])("rejects a historical decision carrying %s", async (key, value) => { expect((await POST(request({ ...historicalDecision(), [key]: value }), context())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
it.each(["resume_execution", "relaunch"])("rejects unknown decision %s", async (decisionName) => { expect((await POST(request(historicalDecision(decisionName)), context())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
it("rejects a blank historical reason", async () => { expect((await POST(request({ ...historicalDecision(), reason: "   " }), context())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
it.each(["Historical model run decision already recorded", "Historical model run decision requires historical enrollment", "Model recovery state changed"])("returns a conflict for %s", async (message) => { mocks.rpc.mockResolvedValue({ data: null, error: { message, code: "P0001" } }); expect((await POST(request(historicalDecision()), context())).status).toBe(409); });
it("returns forbidden when database authority changed", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { message: "Model recovery requires an owner or administrator", code: "42501" } }); expect((await POST(request(historicalDecision()), context())).status).toBe(403); });
it.each(["run_record_changed", "continuation_authorized", "model_resumed", "outcome", "actor_id"])("keeps a historical receipt with changed %s unconfirmed", async (key) => { mocks.rpc.mockResolvedValue({ data: { ...historicalReceipt(), [key]: key === "outcome" ? "closed_for_fresh_run" : key === "actor_id" ? workspace : true }, error: null }); const result = await POST(request(historicalDecision()), context()); expect(result.status).toBe(503); expect((await result.json()).outcome).toBe("recovery_unconfirmed"); });
it("keeps a lost historical reply unconfirmed and repeats the exact request", async () => { mocks.rpc.mockRejectedValueOnce(new Error("private transport detail")).mockResolvedValueOnce({ data: historicalReceipt(), error: null }); const first = await POST(request(historicalDecision()), context()); expect(first.status).toBe(503); expect(await first.text()).not.toContain("private transport detail"); expect((await POST(request(historicalDecision()), context())).status).toBe(200); expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]); });
it("refuses a historical decision for an in-process engine", async () => { runRow = { ...runRow, engine_key: "deterministic_corridor_v1" }; expect((await POST(request(historicalDecision()), context())).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled(); });
