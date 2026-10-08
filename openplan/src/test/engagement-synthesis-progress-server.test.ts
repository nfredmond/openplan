import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), segment: vi.fn(), context: vi.fn(), thematic: vi.fn(), plan: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-progress-plan-server", () => ({ readSynthesisProgressPlan: mocks.plan }));
vi.mock("@/lib/engagement/synthesis-generation-requests-server", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/engagement/synthesis-generation-requests-server")>(), readSynthesisGenerationRequest: mocks.request,
}));
vi.mock("@/lib/engagement/synthesis-generation-selected-results-server", () => ({ loadSynthesisGenerationHistory: mocks.segment }));
vi.mock("@/lib/engagement/synthesis-context-history-server", () => ({ loadSynthesisContextHistory: mocks.context }));
vi.mock("@/lib/engagement/synthesis-thematic-history-server", () => ({ loadSynthesisThematicHistory: mocks.thematic }));
import { readSynthesisProgress } from "@/lib/engagement/synthesis-progress-server";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";

const id = (n: number) => `c7610000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const requestScope = { campaignId: id(1), workspaceId: id(2), requestId: id(3) };
const intent = { sourceId: id(5), sourceSha256: "a".repeat(64) };
const request = { id: id(3), actorId: id(4), intentText: "PRIVATE immutable request", intentSha256: "b".repeat(64) };
const original = { state: { request }, intent, cancellation: null };
const segment = { ...requestScope, requesterId: id(4), selections: { requestId: id(3), throughSequence: 2, plan: { retainedPlan: true } },
  inventory: { job: { jobId: id(3) }, source: { requestId: id(5), sha256: "a".repeat(64) }, manifestSha256: "c".repeat(64),
    status: "incomplete", entries: [{ disposition: "validated_output", parsed: "PRIVATE wording" }, { disposition: "awaiting_result" }, { disposition: "not_started" }] } };
const continuation = { request: { state: { request }, intent }, plan: {}, sha256: "d".repeat(64),
  manifest: { ...requestScope, status: "incomplete", throughSequence: 5 },
  entries: [{ status: "verified", capture: "PRIVATE source" }, { status: "awaiting_output" }, { status: "blocked_by_predecessor" }] };
const client = { rpc: vi.fn() }, service = { rpc: vi.fn(), from: vi.fn() };
const run = (stage: "segment" | "context" | "thematic" = "segment", signal = new AbortController().signal) =>
  readSynthesisProgress(client, service, { ...requestScope, stage }, signal);
beforeEach(() => {
  vi.resetAllMocks(); mocks.request.mockResolvedValue(structuredClone(original));
  mocks.plan.mockResolvedValue("sealed");
  mocks.segment.mockResolvedValue(structuredClone(segment)); mocks.context.mockResolvedValue(structuredClone(continuation));
  mocks.thematic.mockResolvedValue(structuredClone(continuation));
});

describe("compact progress from original-output reconstruction", () => {
  it.each(["context", "thematic"] as const)("carries the reconstructed %s resource assessment without a write", async stage => {
    const assessment = { taskIndex: 1, requiredTaskBytes: 68699, taskByteLimit: 65536 };
    mocks[stage].mockResolvedValue({ ...continuation, resourceAssessment: assessment });
    expect((await run(stage)).resourceAssessment).toEqual(assessment);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it.each(["segment", "context", "thematic"] as const)("brackets %s history with current native access and omits private text", async stage => {
    const result = await run(stage), reader = mocks[stage];
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request).toHaveBeenNthCalledWith(1, client, requestScope, expect.any(AbortSignal));
    expect(reader).toHaveBeenCalledExactlyOnceWith(client, service, requestScope, expect.any(AbortSignal));
    expect(mocks.request.mock.invocationCallOrder[0]).toBeLessThan(reader.mock.invocationCallOrder[0]);
    expect(mocks.request.mock.invocationCallOrder[1]).toBeGreaterThan(reader.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ ...requestScope, ...intent, stage, actorId: id(4), taskCount: 3,
      status: "incomplete", interpretation: stage === "segment" ? "not_assessed" : "machine_unreviewed" });
    expect(result.counts.map(row => row.count)).toEqual([1, 1, 1]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    if (stage === "segment") expect(mocks.plan).toHaveBeenCalledExactlyOnceWith(service, segment.selections.plan, expect.any(AbortSignal));
    else expect(mocks.plan).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled(); expect(service.rpc).not.toHaveBeenCalled(); expect(service.from).not.toHaveBeenCalled();
  });
  it.each(["segment", "context", "thematic"] as const)("refuses %s results if access is revoked after reconstruction", async stage => {
    mocks.request.mockResolvedValueOnce(original).mockRejectedValueOnce(new SynthesisGenerationRequestError("forbidden", 403));
    await expect(run(stage)).rejects.toMatchObject({ status: 403 });
  });
  it("does not reach private replay when initial access fails", async () => {
    mocks.request.mockRejectedValue(new SynthesisGenerationRequestError("forbidden", 403));
    await expect(run()).rejects.toMatchObject({ status: 403 }); expect(mocks.segment).not.toHaveBeenCalled();
  });
  it("does not turn a failed history read into zero", async () => {
    mocks.segment.mockRejectedValue(new Error("PRIVATE source unavailable"));
    await expect(run()).rejects.toThrow("unavailable");
  });
  it("refuses an invalid retained plan before reporting unstarted work", async () => {
    mocks.plan.mockRejectedValue(new Error("Saved analysis plan differs"));
    await expect(run()).rejects.toThrow("plan differs");
  });
  it.each(["not_prepared", "staging"])("keeps task counts unknown for %s segment preparation", async preparation => {
    mocks.plan.mockResolvedValue(preparation);
    expect(await run()).toMatchObject({ status: preparation, taskCount: null, selectionSequence: null, counts: [] });
  });
  it.each(["requester", "campaign", "workspace", "selection", "job", "source", "checksum"])("rejects a different segment %s", async kind => {
    const result = structuredClone(segment);
    if (kind === "requester") result.requesterId = id(99);
    if (kind === "campaign") result.campaignId = id(99);
    if (kind === "workspace") result.workspaceId = id(99);
    if (kind === "selection") result.selections.requestId = id(99);
    if (kind === "job") result.inventory.job.jobId = id(99);
    if (kind === "source") result.inventory.source.requestId = id(99);
    if (kind === "checksum") result.inventory.source.sha256 = "e".repeat(64);
    mocks.segment.mockResolvedValue(result); await expect(run()).rejects.toMatchObject({ status: 503 });
  });
  it.each(["context", "thematic"] as const)("refuses substituted %s original intent", async stage => {
    const result = structuredClone(continuation); result.request.state.request.intentText = "different request";
    mocks[stage].mockResolvedValue(result); await expect(run(stage)).rejects.toMatchObject({ status: 503 });
  });
  it("reports cancellation observed at the final access check without discarding retained results", async () => {
    mocks.request.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, cancellation: { id: id(6) } });
    expect(await run()).toMatchObject({ cancelled: true, taskCount: 3 });
  });
  it("refuses changed identity and an abort at the final access check", async () => {
    mocks.request.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, state: { request: { ...request, actorId: id(99) } } });
    await expect(run()).rejects.toMatchObject({ status: 503 });
    const controller = new AbortController(); mocks.request.mockResolvedValueOnce(original).mockImplementationOnce(async () => { controller.abort(); return original; });
    await expect(run("segment", controller.signal)).rejects.toThrow();
  });
  it("keeps unsealed thematic inputs unknown instead of reporting zero tasks", async () => {
    mocks.thematic.mockResolvedValue({ ...continuation, plan: null, entries: [], manifest: { ...requestScope, status: "inputs_not_sealed", throughSequence: null } });
    expect(await run("thematic")).toMatchObject({ status: "inputs_not_sealed", taskCount: null, counts: [] });
  });
});
