import { describe, expect, it, vi } from "vitest";
import { loadSynthesisPreparationInputs } from "@/lib/engagement/synthesis-preparation-inputs";
import { preparationInputsFixture } from "./fixtures/engagement/synthesis-preparation-inputs";
import { sourceHash } from "./fixtures/engagement/synthesis-source";
const signal = () => new AbortController().signal;
const other = "a0000000-0000-4000-8000-000000000099";

describe("preparation original input reader", () => {
  it.each(["segment", "context", "thematic"] as const)("reconstructs original %s inputs between native lease checks", async stage => {
    const f = preparationInputsFixture(stage);
    f.response.mockImplementation(async (table, value) => { expect(f.rpc).toHaveBeenCalledTimes(1); return { data: f.rows.get(`${table}:${value}`) ?? null, error: null }; });
    const inputs = await loadSynthesisPreparationInputs(f.service, f.lease, signal());
    expect(inputs.stage).toBe(stage); expect(inputs.saved.snapshotText).toBe(f.source.snapshot_text); expect(inputs.request.id).toBe(f.scope.requestId);
    expect(f.rpc.mock.calls).toEqual(Array(2).fill(["renew_engagement_synthesis_preparation", { p_request: f.scope.requestId, p_token: f.lease.leaseToken }]));
    expect(f.trace.slice(0, 4).map(({ signal: _signal, ...entry }) => entry)).toEqual([
      { table: "engagement_synthesis_generation_requests", columns: "id,campaign_id,workspace_id,actor_id,source_id,intent_text,intent_sha256,created_at", key: "id", value: f.scope.requestId },
      { table: "engagement_synthesis_context_requests", columns: "request_id,parent_request_id,context_text,context_sha256,created_at", key: "request_id", value: f.scope.requestId },
      { table: "engagement_synthesis_thematic_requests", columns: "request_id,parent_request_id,thematic_text,thematic_sha256,created_at", key: "request_id", value: f.scope.requestId },
      { table: "engagement_synthesis_sources", columns: "id,campaign_id,workspace_id,snapshot_text,snapshot_sha256,created_at", key: "id", value: f.source.id },
    ]);
    if (inputs.stage === "context") { expect(inputs.parent.state.request.actorId).toBe(f.parent.actor_id); expect(f.trace[4]).toMatchObject({ value: f.parent.id, columns: f.trace[0].columns }); }
    if (inputs.stage === "thematic") expect(inputs.thematic.binding.parentRequestId).toBe(f.parent.id);
  });
  it.each(["initial", "final"])("rejects %s lease refusal", async when => {
    const f = preparationInputsFixture();
    if (when === "final") f.renewal.mockResolvedValueOnce({ data: f.lease, error: null });
    f.renewal.mockResolvedValueOnce({ data: null, error: { message: "access revoked" } });
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow("acknowledgement unavailable");
    expect(f.from).toHaveBeenCalledTimes(when === "initial" ? 0 : 4);
  });
  it.each(["id", "campaign_id", "workspace_id", "actor_id", "source_id", "intent_sha256"])("refuses changed request %s", async field => {
    const f = preparationInputsFixture(); Object.assign(f.request, { [field]: field === "intent_sha256" ? "c".repeat(64) : other });
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow();
  });
  it("refuses a self-consistent different request intent", async () => {
    const f = preparationInputsFixture(); f.request.intent_text = f.request.intent_text.replace("synthetic-context", "different-model"); f.request.intent_sha256 = sourceHash(f.request.intent_text);
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow("differ");
  });
  it.each(["id", "campaign_id", "workspace_id", "snapshot_sha256", "snapshot_text"])("refuses changed source %s", async field => {
    const f = preparationInputsFixture(); Object.assign(f.source, { [field]: field === "snapshot_sha256" ? "c".repeat(64) : field === "snapshot_text" ? f.source.snapshot_text + " " : other });
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow();
  });
  it("refuses different source bytes with a self-consistent source hash", async () => {
    const f = preparationInputsFixture(); f.source.snapshot_text += " "; f.source.snapshot_sha256 = sourceHash(f.source.snapshot_text);
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow("differ");
  });
  it.each(["segment", "context", "thematic"] as const)("refuses wrong %s stage extensions", async stage => {
    const f = preparationInputsFixture(stage);
    f.rows.set(`engagement_synthesis_context_requests:${f.scope.requestId}`, stage === "context" ? null : f.context);
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow("differ");
  });
  it.each(["context", "thematic"] as const)("refuses foreign %s extension", async stage => {
    const f = preparationInputsFixture(stage); f[stage].request_id = other;
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow("differ");
  });
  it("refuses a parent whose self-consistent intent names another source", async () => {
    const f = preparationInputsFixture("context"); const intent = JSON.parse(f.parent.intent_text); intent.sourceId = other; f.parent.source_id = other;
    f.parent.intent_text = JSON.stringify(intent); f.parent.intent_sha256 = sourceHash(f.parent.intent_text);
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow("differ");
  });
  it("refuses a parent whose self-consistent intent changes the source hash", async () => {
    const f = preparationInputsFixture("context"); const intent = JSON.parse(f.parent.intent_text); intent.sourceSha256 = "c".repeat(64);
    f.parent.intent_text = JSON.stringify(intent); f.parent.intent_sha256 = sourceHash(f.parent.intent_text);
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow("differ");
  });
  it("does not turn unavailable reads into missing input", async () => {
    const f = preparationInputsFixture(); f.response.mockResolvedValueOnce({ data: null, error: { message: "PRIVATE" } });
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow(/^Preparation input read unavailable$/);
  });
  it.each(["request", "context", "source"])("rejects missing required %s", async kind => {
    const f = preparationInputsFixture("context"); f.rows.set(kind === "source" ? `engagement_synthesis_sources:${f.source.id}` : kind === "context" ? `engagement_synthesis_context_requests:${f.scope.requestId}` : `engagement_synthesis_generation_requests:${f.scope.requestId}`, null);
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow();
  });
  it("rejects an inactive claim before reading", async () => {
    const f = preparationInputsFixture(); f.lease.active = false;
    await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow(); expect(f.from).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("rejects a late input success after its deadline", async () => {
    const f = preparationInputsFixture(), c = new AbortController(), timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(c.signal);
    try { f.response.mockImplementationOnce(async (_table, _value, s) => { c.abort(new Error("deadline")); expect(s.aborted).toBe(true); return { data: f.request, error: null }; });
      await expect(loadSynthesisPreparationInputs(f.service, f.lease, signal())).rejects.toThrow("deadline"); expect(timeout).toHaveBeenCalledWith(10_000); expect(f.trace).toHaveLength(1);
    } finally { timeout.mockRestore(); }
  });
});
