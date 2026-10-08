import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRunManager } from "@/components/models/model-run-manager";
import type { ModelRecoveryStatus } from "@/lib/models/recovery-status";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }));
vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: () => <div /> }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
const stamp = "2026-10-08T10:00:00Z";
const historical: ModelRecoveryStatus = { state: "historical_unassessed", enrolledAt: stamp, observedStarts: 0, lastStartObservedAt: null };

function show(status: string, recovery: ModelRecoveryStatus, engine = "aequilibrae") {
  return render(<ModelRunManager
    modelId="10000000-0000-4000-8000-000000000001" modelTitle="Recovery test"
    defaultQueryText="Synthetic test" defaultCorridorText="" scenarioEntries={[]} schemaPending={false}
    modelRuns={[{
      id: "20000000-0000-4000-8000-000000000001", run_title: "Saved model run",
      engine_key: engine, status, recovery, source_analysis_run_id: null,
      scenario_entry_id: null, result_summary_json: null, error_message: null,
      started_at: status === "queued" ? null : stamp, completed_at: null, created_at: stamp,
      stages: [{ id: "30000000-0000-4000-8000-000000000001", stage_name: "Protected computation", status, started_at: status === "queued" ? null : stamp, completed_at: null, log_tail: "Saved log entry" }],
      artifacts: [],
    }]}
  />);
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); refresh.mockClear(); });

describe("model recovery controls", () => {
  it.each(["queued", "running", "failed"])("retains saved %s without offering replay or live progress", (status) => {
    show(status, historical);
    expect(screen.getAllByText("Reconciliation required")).toHaveLength(2);
    expect(screen.getByTestId("run-recovery-notice")).toHaveTextContent(`Saved run status: ${status}`);
    expect(screen.getByText(`Saved: ${status}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Relaunch worker run|Reset queue/ })).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByTestId("run-runtime-expectation")).toBeNull();
  });
  it("distinguishes unreadable custody from historical enrollment", () => {
    show("queued", { state: "unavailable" });
    expect(screen.getAllByText("Recovery status unavailable")).toHaveLength(2);
    expect(screen.getByTestId("run-recovery-notice")).toHaveTextContent("could not be read");
    expect(screen.queryByText("Reconciliation required")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reset queue/ })).toBeNull();
  });
  it.each(["aequilibrae", "behavioral_demand"])("offers the queue control for a new %s run", (engine) => {
    show("queued", { ...historical, state: "new_run" }, engine);
    expect(screen.getByRole("button", { name: "Reset queue" })).toBeInTheDocument();
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
