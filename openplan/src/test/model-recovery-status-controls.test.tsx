import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRunManager } from "@/components/models/model-run-manager";
import type { ModelRecoveryStatus } from "@/lib/models/recovery-status";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }));
vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: () => <div /> }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
const stamp = "2026-10-08T10:00:00Z";
const historical: ModelRecoveryStatus = { state: "historical_unassessed", enrolledAt: stamp, observedStarts: 0, lastStartObservedAt: null };

const model = "10000000-0000-4000-8000-000000000001";
const run = "20000000-0000-4000-8000-000000000001";
const stage = "30000000-0000-4000-8000-000000000001";
const user = "40000000-0000-4000-8000-000000000001";
const workspace = "50000000-0000-4000-8000-000000000001";
const artifact = "60000000-0000-4000-8000-000000000001";
type Options = { permission?: "allowed" | "denied" | "unavailable"; artifacts?: Array<{ id: string; artifact_type: string; file_url: string; file_size_bytes: number | null }> };

function show(status: string, recovery: ModelRecoveryStatus, engine = "aequilibrae", options?: Options) {
  return render(<ModelRunManager
    {...(options ? { recoveryUserId: user, workspaceId: workspace, recoveryPermission: options.permission ?? "allowed" } : {})}
    modelId={model} modelTitle="Recovery test"
    defaultQueryText="Synthetic test" defaultCorridorText="" scenarioEntries={[]} schemaPending={false}
    modelRuns={[{
      id: "20000000-0000-4000-8000-000000000001", run_title: "Saved model run",
      engine_key: engine, status, recovery, source_analysis_run_id: null,
      scenario_entry_id: null, result_summary_json: null, error_message: null,
      started_at: status === "queued" ? null : stamp, completed_at: null, created_at: stamp,
      stages: [{ id: "30000000-0000-4000-8000-000000000001", stage_name: "Protected computation", status, started_at: status === "queued" ? null : stamp, completed_at: null, log_tail: "Saved log entry" }],
      artifacts: options?.artifacts ?? [],
    }]}
  />);
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); refresh.mockClear(); });

describe("model recovery controls", () => {
  it.each(["queued", "running", "failed"])("retains saved %s without offering replay or live progress", (status) => {
    show(status, historical);
    expect(screen.getAllByText("Needs a decision")).toHaveLength(2);
    expect(screen.getByTestId("run-recovery-notice")).toHaveTextContent("Recorded before recovery tracking. Keep as a record, or close it to run again.");
    expect(screen.getByTestId("run-recovery-operator-detail")).toHaveTextContent(`Saved run status: ${status}`);
    expect(screen.getByText(`Saved: ${status}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Relaunch worker run|Reset queue/ })).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByTestId("run-runtime-expectation")).toBeNull();
  });
  it("distinguishes unreadable custody from historical enrollment", () => {
    show("queued", { state: "unavailable" });
    expect(screen.getAllByText("Recovery status unavailable")).toHaveLength(2);
    expect(screen.getByTestId("run-recovery-notice")).toHaveTextContent("could not be read");
    expect(screen.queryByText("Needs a decision")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reset queue/ })).toBeNull();
  });
  it.each(["aequilibrae", "behavioral_demand"])("offers the queue control for a new %s run", (engine) => {
    show("queued", { ...historical, state: "new_run", relaunchCustody: "unstarted" }, engine);
    expect(screen.getByRole("button", { name: "Reset queue" })).toBeInTheDocument();
  });
  it.each(["retained", "unassessed", "unavailable", undefined] as const)("withholds relaunch for %s custody without rewriting provenance", (relaunchCustody) => {
    show("cancelled", { ...historical, state: "new_run", relaunchCustody });
    expect(screen.queryByRole("button", { name: /Relaunch worker run|Reset queue/ })).toBeNull();
    expect(screen.getByText(/Relaunch is unavailable/)).toBeInTheDocument();
    expect(screen.queryByTestId("run-recovery-notice")).toBeNull();
  });
  it("withholds the behavioral recovery control for historical work", () => {
    show("queued", historical, "behavioral_demand");
    expect(screen.queryByRole("button", { name: "Reset queue" })).toBeNull();
  });
  it("does not keep polling a historical running record", async () => {
    vi.useFakeTimers();
    show("running", historical);
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(refresh).not.toHaveBeenCalled();
  });
  it("preserves polling and progress for a newly enrolled running record", async () => {
    vi.useFakeTimers();
    show("running", { ...historical, state: "new_run", observedStarts: 1, lastStartObservedAt: stamp });
    expect(screen.queryByTestId("run-recovery-notice")).toBeNull();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(refresh).toHaveBeenCalled();
  });
});

const state = { run_id: run, workspace_id: workspace, model_id: model, status: "running", updated_at: stamp, attempt_managed: false,
  stages: [{ id: stage, status: "running", updated_at: stamp, active_attempt_id: null, attempt_managed: false }] };
const decided = (outcome: "kept_as_record" | "closed_for_fresh_run"): ModelRecoveryStatus => ({ ...historical,
  historicalDecision: { requestId: "70000000-0000-4000-8000-000000000001", outcome, actorId: user, reason: "Synthetic review", recordedAt: stamp } });
function receiptFor(body: { requestId: string; decision: string; expectedState: unknown; reason: string }) {
  const outcome = body.decision === "keep_as_record" ? "kept_as_record" : "closed_for_fresh_run";
  return { request_id: body.requestId, workspace_id: workspace, run_id: run, actor_id: user, outcome, run_status: "running", run_record_changed: false,
    process_termination_verified: false, continuation_authorized: false, model_resumed: false,
    request_payload: { workspace_id: workspace, run_id: run, actor_id: user, expected_state: body.expectedState, outcome, reason: body.reason } };
}
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

describe("historical run keep or close", () => {
  it("offers keep and close to an owner instead of the abandonment panel", () => {
    show("running", historical, "aequilibrae", { permission: "allowed" });
    const notice = screen.getByTestId("run-recovery-notice");
    expect(within(notice).getByRole("button", { name: "Keep it" })).toBeDisabled();
    expect(within(notice).getByRole("button", { name: "Close to run again" })).toBeDisabled();
    expect(screen.queryByTestId("model-recovery-panel")).toBeNull();
  });
  it("keeps the abandonment panel for a new run", () => {
    show("running", { ...historical, state: "new_run", observedStarts: 1, lastStartObservedAt: stamp }, "aequilibrae", { permission: "allowed" });
    expect(screen.getByTestId("model-recovery-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("historical-run-decision")).toBeNull();
  });
  it.each(["denied", "unavailable"] as const)("refuses %s permission without a control", (permission) => {
    show("running", historical, "aequilibrae", { permission });
    expect(screen.getByTestId("historical-run-decision")).toHaveTextContent(permission === "denied" ? "A workspace owner or admin decides" : "Permissions could not be checked");
    expect(screen.queryByRole("button", { name: "Keep it" })).toBeNull();
  });
  it("records keep with the reviewed state and reason, then refreshes", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return init?.method === "POST" ? json(200, receiptFor(JSON.parse(String(init.body)))) : json(200, { expected_state: state, process_termination_verified: false, continuation_authorized: false, model_resumed: false });
    }));
    show("running", historical, "aequilibrae", { permission: "allowed" });
    fireEvent.change(screen.getByLabelText("Reason, saved with the decision"), { target: { value: "Reviewed saved outputs" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(calls.map((call) => [call.url, call.init?.method ?? "GET"])).toEqual([[`/api/models/${model}/runs/${run}/recovery`, "GET"], [`/api/models/${model}/runs/${run}/recovery`, "POST"]]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ requestId: expect.any(String), decision: "keep_as_record", expectedState: state, reason: "Reviewed saved outputs" });
    expect(calls[1].init?.headers).toMatchObject({ "x-openplan-expected-user": user, "x-openplan-expected-workspace": workspace });
    expect(screen.getByRole("status")).toHaveTextContent("Decision recorded.");
  });
  it("resends the identical request after an unconfirmed reply", async () => {
    const posts: string[] = [];
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return json(200, { expected_state: state, process_termination_verified: false, continuation_authorized: false, model_resumed: false });
      posts.push(String(init.body));
      return attempt++ === 0 ? json(503, { outcome: "recovery_unconfirmed" }) : json(200, receiptFor(JSON.parse(String(init.body))));
    }));
    show("running", historical, "aequilibrae", { permission: "allowed" });
    fireEvent.change(screen.getByLabelText("Reason, saved with the decision"), { target: { value: "Close it" } });
    fireEvent.click(screen.getByRole("button", { name: "Close to run again" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("could not be confirmed"));
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close to run again" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(posts).toHaveLength(2);
    expect(posts[1]).toBe(posts[0]);
  });
  it("does not report a receipt that claims the run changed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? json(200, { ...receiptFor(JSON.parse(String(init.body))), run_record_changed: true })
      : json(200, { expected_state: state, process_termination_verified: false, continuation_authorized: false, model_resumed: false })));
    show("running", historical, "aequilibrae", { permission: "allowed" });
    fireEvent.change(screen.getByLabelText("Reason, saved with the decision"), { target: { value: "Keep" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("The decision was not recorded."));
    expect(refresh).not.toHaveBeenCalled();
  });
  it("shows a kept run as a read-only record with its outputs still downloadable", () => {
    show("succeeded", decided("kept_as_record"), "aequilibrae", { permission: "allowed", artifacts: [{ id: artifact, artifact_type: "link_volumes", file_url: "local://synthetic", file_size_bytes: 10 }] });
    expect(screen.getAllByText("Kept as a record").length).toBeGreaterThan(0);
    expect(screen.getByTestId("run-recovery-notice")).toHaveTextContent("Kept as a record. Its saved results stay as they were.");
    expect(screen.getByTestId("run-recovery-operator-detail")).toHaveTextContent("kept_as_record");
    expect(screen.getByTestId("run-recovery-operator-detail")).toHaveTextContent("Synthetic review");
    expect(screen.queryByRole("button", { name: /Keep it|Close to run again|Relaunch worker run|Reset queue|Start a new run/ })).toBeNull();
    expect(screen.getByRole("link", { name: new RegExp(`^View / Download .*artifact ${artifact}$`) })).toHaveAttribute("href", `/api/models/${model}/runs/${run}/artifacts/${artifact}/download`);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("lets a closed run seed a fresh launch without relaunching it", () => {
    show("running", decided("closed_for_fresh_run"), "behavioral_demand", { permission: "allowed" });
    expect(screen.getByTestId("run-recovery-notice")).toHaveTextContent("Closed. Its saved results stay as they were. Start a new run to run it again.");
    expect(screen.queryByRole("button", { name: /Relaunch worker run|Reset queue|Keep it/ })).toBeNull();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const engine = screen.getByLabelText("Run mode") as HTMLSelectElement;
    expect(engine.value).not.toBe("behavioral_demand");
    fireEvent.click(screen.getByRole("button", { name: "Start a new run" }));
    expect(engine.value).toBe("behavioral_demand");
    expect(document.activeElement).toBe(engine);
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
