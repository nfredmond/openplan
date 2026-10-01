// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { synthesisContextWorkerFixture as fixture } from "./fixtures/engagement/synthesis-context-worker";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

describe("context worker original input reconstruction", () => {
  it("rebuilds every frame from the original parent responses and saved source", async () => {
    const f = fixture(), result = await f.load();
    expect(result.plan).toEqual(f.plan); expect(result.contentArgs).toEqual(f.contentArgs);
    expect(result.request).toEqual(f.f.request); expect(f.plan.entries.length).toBeGreaterThan(1);
    expect(f.rpc.mock.calls).toEqual([
      ["read_engagement_synthesis_context_plan", { p_request: f.f.scope.requestId }],
      ["read_engagement_synthesis_context_parent_selections", { p_request: f.f.scope.requestId, p_after_task_index: -1, p_limit: 128 }],
    ]);
    const originals = f.trace.filter(row => row.table === "engagement_synthesis_context_frames");
    expect(originals.map(({ signal: _signal, ...row }) => row)).toEqual(f.plan.entries.map(frame => ({
      table: "engagement_synthesis_context_frames", columns: "request_id,frame_index,frame_text,frame_sha256,frame_bytes",
      filters: { request_id: f.f.scope.requestId, frame_index: frame.index },
    })));
    expect(f.trace.filter(row => row.table === "engagement_synthesis_generation_plan_tasks").every(row =>
      row.columns === "request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256")).toBe(true);
    expect(f.trace.every(row => row.signal instanceof AbortSignal)).toBe(true);
    expect(f.trace.some(row => row.table.includes("credentials"))).toBe(false);
  });
  it.each(["id", "source_id", "configuration_revision_id"])("rejects changed child request %s", async field => {
    const f = fixture(); f.options.returnedPatch = { table: "engagement_synthesis_generation_requests", key: "id", value: f.f.scope.requestId, patch: { [field]: randomUUID() } };
    await expect(f.load()).rejects.toThrow("inputs differ");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["engagement_synthesis_context_requests", "request_id"],
    ["engagement_synthesis_context_frames", "request_id"], ["engagement_synthesis_context_frames", "frame_index"],
    ["engagement_synthesis_generation_plan_tasks", "request_id"], ["engagement_synthesis_generation_plan_tasks", "task_index"],
  ])("rejects wrong returned %s %s despite correct query filters", async (table, field) => {
    const f = fixture(); f.options.returnedPatch = { table, patch: { [field]: field.endsWith("_index") ? 1 : randomUUID() } };
    await expect(f.load()).rejects.toThrow("inputs differ");
  });
  it.each(["id", "campaign_id", "workspace_id", "source_id"])("rejects changed parent scope %s", async field => {
    const f = fixture(); f.options.returnedPatch = { table: "engagement_synthesis_generation_requests", key: "id", value: f.parentRow.id, patch: { [field]: randomUUID() } };
    await expect(f.load()).rejects.toThrow("inputs differ");
    expect(f.trace.some(row => row.table === "engagement_synthesis_sources")).toBe(false);
  });
  it("rejects a self-hashed original frame replacement", async () => {
    const f = fixture(), frame = f.rows.get("engagement_synthesis_context_frames")!.find(frame => String(frame.frame_text).includes("SYNTHETIC"))!;
    expect(frame).toBeDefined();
    frame.frame_text = String(frame.frame_text).replace("SYNTHETIC", "REPLACED!");
    frame.frame_sha256 = hash(String(frame.frame_text)); frame.frame_bytes = Buffer.byteLength(String(frame.frame_text));
    await expect(f.load()).rejects.toThrow("inputs differ");
  });
  it.each(["frame_sha256", "frame_bytes"])("rejects inconsistent original frame %s", async field => {
    const f = fixture(); f.rows.get("engagement_synthesis_context_frames")![0][field] = field === "frame_bytes" ? 1 : "0".repeat(64);
    await expect(f.load()).rejects.toThrow("inputs differ");
  });
  it.each(["frameIndex", "frameSha256", "frameBytes", "contextManifestSha256", "targetRecordId"])("rejects self-hashed reference drift %s", async field => {
    const f = fixture(), row = f.rows.get("engagement_synthesis_generation_plan_tasks")![0], reference = JSON.parse(String(row.task_text));
    reference[field] = typeof reference[field] === "number" ? reference[field] + 1 : "0".repeat(64);
    row.task_text = JSON.stringify(reference); row.task_sha256 = hash(String(row.task_text)); row.task_bytes = Buffer.byteLength(String(row.task_text));
    await expect(f.load()).rejects.toThrow("inputs differ");
  });
  it.each(["task_sha256", "task_bytes", "cumulative_bytes", "chain_sha256"])("rejects reference ledger drift %s", async field => {
    const f = fixture(), row = f.rows.get("engagement_synthesis_generation_plan_tasks")![0];
    row[field] = typeof row[field] === "number" ? Number(row[field]) + 1 : "0".repeat(64);
    await expect(f.load()).rejects.toThrow("inputs differ");
  });
  it.each(["cancelled", "unsealed"])("refuses %s work", async mode => {
    const f = fixture(); if (mode === "cancelled") f.state.cancelled = true; else f.state.seal = null;
    await expect(f.load()).rejects.toThrow("active sealed plan");
    expect(f.trace.some(row => row.table === "engagement_synthesis_context_frames")).toBe(false);
  });
  it.each(["read_engagement_synthesis_context_plan", "read_engagement_synthesis_context_parent_selections"])("stops denied %s", async command => {
    const f = fixture(); f.options.failRpc = command; await expect(f.load()).rejects.toThrow("unavailable");
    expect(f.trace.some(row => row.table === "engagement_synthesis_context_frames")).toBe(false);
  });
  it.each(["engagement_synthesis_context_requests", "engagement_synthesis_context_frames", "engagement_synthesis_generation_plan_tasks"])("stops a failed %s read", async table => {
    const f = fixture(); f.options.failTable = table; await expect(f.load()).rejects.toThrow("unavailable");
  });
  it.each(["before", "engagement_synthesis_context_frames"])("stops an interrupted read %s", async at => {
    const f = fixture(); if (at === "before") f.controller.abort(); else f.options.abortTable = at;
    await expect(f.load()).rejects.toMatchObject({ name: "AbortError" });
    if (at === "before") expect(f.from).not.toHaveBeenCalled();
  });
});
