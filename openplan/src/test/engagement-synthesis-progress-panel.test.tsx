import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SynthesisProgressPanel } from "@/components/engagement/synthesis-progress-panel";
import type { SynthesisExecutionScope } from "@/lib/engagement/synthesis-execution-records";

const id = (n: number) => `c7630000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: SynthesisExecutionScope = { campaignId: id(1), workspaceId: id(2), requestId: id(3), actorId: id(4), sourceId: id(5),
  sourceSha256: "a".repeat(64), requestIntentSha256: "b".repeat(64), stage: "segment" };
const summary = { schemaVersion: 1, ...scope, checkedAt: "2026-10-07T01:00:00Z", cancelled: false,
  status: "incomplete", interpretation: "not_assessed", selectionSequence: 2, manifestSha256: "c".repeat(64), taskCount: 3,
  counts: [{ disposition: "validated_output", count: 1 }, { disposition: "awaiting_result", count: 1 }, { disposition: "not_started", count: 1 }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const lostAccess = vi.fn();
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => { vi.resetAllMocks(); transport = vi.fn<typeof fetch>().mockResolvedValue(json(summary)); vi.stubGlobal("fetch", transport); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = (next = scope, userId = scope.actorId) => render(<SynthesisProgressPanel {...next} userId={userId} onAccessLost={lostAccess} />);
const open = () => fireEvent.click(screen.getByRole("button", { name: "Inspect saved analysis results" }));

describe("saved analysis progress view", () => {
  it.each(["context", "thematic"] as const)("explains the %s task limit without authorizing a retry", async stage => {
    transport.mockResolvedValue(json({ ...summary, stage, interpretation: "machine_unreviewed",
      counts: [{ disposition: "unselected", count: 3 }],
      resourceAssessment: { taskIndex: 0, requiredTaskBytes: 68699, taskByteLimit: 65536 } }));
    mount({ ...scope, stage }); open();
    await screen.findByText("Next continuation exceeds its saved task limit");
    expect(screen.getByText("Task 1 requires 68,699 bytes. Its saved limit is 65,536 bytes.")).toBeTruthy();
    expect(screen.getByText("No selected attempt")).toBeTruthy();
    expect(screen.getByText(/does not establish whether a provider call occurred/)).toBeTruthy();
    expect(transport.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("reads on demand with pinned account/workspace and no write", async () => {
    mount(); expect(transport).not.toHaveBeenCalled(); open();
    await screen.findByText("Analysis results are incomplete");
    expect(screen.getByText("Selected attempt without retained output")).toBeTruthy();
    expect(screen.getByText("No selected attempt")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose a contribution to combine" })).toBeNull();
    expect(screen.getByText(/does not establish whether a provider call is still running or stopped/)).toBeTruthy();
    expect(transport).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`/synthesis/progress?requestId=${scope.requestId}&stage=segment`),
      expect.objectContaining({ method: "GET", cache: "no-store", headers: { "x-openplan-expected-user": scope.actorId, "x-openplan-expected-workspace": scope.workspaceId } }));
    expect(screen.getByText(/not a live worker connection/)).toBeTruthy();
  });
  it.each(["segment", "context", "thematic"] as const)("keeps completed %s output separate from findings", async stage => {
    transport.mockResolvedValue(json({ ...summary, stage, status: stage === "segment" ? "ready_for_record_consolidation" : stage === "context" ? "frames_complete" : "proposal_complete",
      interpretation: stage === "segment" ? "not_assessed" : "machine_unreviewed", cancelled: true,
      counts: [{ disposition: stage === "segment" ? "validated_output" : "verified", count: 3 }] }));
    mount({ ...scope, stage }); open();
    await screen.findByText("3 tasks accounted for in this saved selection.");
    expect(Boolean(screen.queryByRole("button", { name: "Choose a contribution to combine" }))).toBe(stage === "segment");
    expect(screen.getByText(/do not establish meaning, representative support, staff approval or publication/)).toBeTruthy();
    expect(screen.getByText(/cancellation does not prove that a call already sent stopped/)).toBeTruthy();
    expect(transport.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("does not render unsealed thematic inputs as zero tasks", async () => {
    transport.mockResolvedValue(json({ ...summary, stage: "thematic", status: "inputs_not_sealed", interpretation: "machine_unreviewed",
      taskCount: null, selectionSequence: null, counts: [] }));
    mount({ ...scope, stage: "thematic" }); open();
    await screen.findByText("The complete task count is not available until preparation finishes.");
    expect(screen.queryByText(/0 tasks accounted/)).toBeNull();
  });
  it("clears old results immediately while refreshing and leaves unavailable results explicit", async () => {
    mount(); open(); await screen.findByText("Analysis results are incomplete");
    let resolve!: (value: Response) => void;
    transport.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh results" }));
    expect(screen.queryByText("Analysis results are incomplete")).toBeNull();
    await act(async () => { resolve(json({}, 500)); });
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable result does not mean no work occurred");
    expect(screen.queryByText(/tasks accounted/)).toBeNull();
  });
  it.each([401, 403])("clears private output on current access denial %s", async status => {
    mount(); open(); await screen.findByText("Analysis results are incomplete");
    transport.mockResolvedValue(json({}, status)); fireEvent.click(screen.getByRole("button", { name: "Refresh results" }));
    await screen.findByRole("alert"); expect(lostAccess).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/tasks accounted/)).toBeNull();
  });
  it("refuses a response from another source", async () => {
    transport.mockResolvedValue(json({ ...summary, sourceSha256: "d".repeat(64) })); mount(); open();
    await screen.findByRole("alert"); expect(screen.queryByText(/tasks accounted/)).toBeNull();
  });
  it("ignores late denial from a previous account", async () => {
    let resolve!: (value: Response) => void;
    transport.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const rendered = mount(); open();
    rendered.rerender(<SynthesisProgressPanel {...scope} userId={id(99)} onAccessLost={lostAccess} />);
    await act(async () => { resolve(json({}, 403)); });
    expect(lostAccess).not.toHaveBeenCalled(); expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Inspect saved analysis results" })).toHaveAttribute("aria-expanded", "false");
  });
  it("aborts closed inspection and does not expose the late result when reopened", async () => {
    let resolve!: (value: Response) => void;
    transport.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    mount(); open(); const signal = transport.mock.calls[0][1]?.signal;
    open(); expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(json(summary)); });
    transport.mockResolvedValue(json({}, 500)); open(); await screen.findByRole("alert");
    expect(screen.queryByText("Analysis results are incomplete")).toBeNull();
  });
});
