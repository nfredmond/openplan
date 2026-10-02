// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { synthesisContextHistoryFixture as fixture } from "./fixtures/engagement/synthesis-context-history";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

describe("current-staff historical context inputs", () => {
  it("retains cancellation reasons at the native Unicode character limit", async () => {
    const f = fixture(); f.cancel("😀".repeat(4000));
    expect((await f.loadInputs()).request.cancellation).toEqual(f.request.cancellation);
    f.cancel("a".repeat(4001));
    await expect(f.loadInputs()).rejects.toThrow();
  });
  it("retains parent selection reasons at the native Unicode character limit", async () => {
    const f = fixture(), entry = f.choices[0], receipt = JSON.parse(entry.receiptText);
    receipt.reason = "😀".repeat(4000);
    entry.receiptText = JSON.stringify(receipt); entry.receiptSha256 = hash(entry.receiptText);
    expect((await f.loadInputs()).preparationStatus).toBe("sealed");
    receipt.reason = "a".repeat(4001);
    entry.receiptText = JSON.stringify(receipt); entry.receiptSha256 = hash(entry.receiptText);
    await expect(f.loadInputs()).rejects.toThrow();
  });
  it("does not infer corruption when staging seals between independent reads", async () => {
    const f = fixture(), plans = f.rows.get("engagement_synthesis_generation_plans")!, seals = f.rows.get("engagement_synthesis_generation_plan_seals")!;
    f.rows.set("engagement_synthesis_generation_plans", plans.filter(row => row.request_id !== f.scope.requestId));
    f.rows.set("engagement_synthesis_generation_plan_seals", seals.filter(row => row.request_id !== f.scope.requestId));
    f.options.afterRead = (table, filters) => {
      if (table === "engagement_synthesis_generation_plans" && filters.request_id === f.scope.requestId) {
        f.rows.set("engagement_synthesis_generation_plans", plans); f.rows.set("engagement_synthesis_generation_plan_seals", seals);
      }
    };
    const first = await f.loadInputs(); expect(first.preparationStatus).toBe("not_prepared");
    expect((await f.loadInputs()).preparationStatus).toBe("sealed");
  });

  it("reports a retryable read when an unsealed frame commits between its component reads", async () => {
    const f = fixture(), frames = f.rows.get("engagement_synthesis_context_frames")!, tasks = f.rows.get("engagement_synthesis_generation_plan_tasks")!;
    f.rows.set("engagement_synthesis_context_frames", []); f.rows.set("engagement_synthesis_generation_plan_tasks", []);
    f.rows.set("engagement_synthesis_generation_plan_seals", f.rows.get("engagement_synthesis_generation_plan_seals")!.filter(row => row.request_id !== f.scope.requestId));
    f.options.afterRead = (table, filters) => {
      if (table === "engagement_synthesis_context_frames" && filters.frame_index === 0) {
        f.rows.set("engagement_synthesis_context_frames", frames); f.rows.set("engagement_synthesis_generation_plan_tasks", tasks);
      }
    };
    await expect(f.loadInputs()).rejects.toThrow("preparation changed during inspection; retry");
    expect((await f.loadInputs()).preparationStatus).toBe("staging");
  });
  it("reconstructs original frames without current execution or credential reads", async () => {
    const f = fixture(), value = await f.loadInputs();
    expect(value.preparationStatus).toBe("sealed");
    expect(value.plan).toEqual(f.plan); expect(value.storedFrameCount).toBe(f.plan.entries.length);
    expect(f.serviceRpc).not.toHaveBeenCalled();
    expect(f.trace.some(row => row.table.includes("credential") || row.table.includes("connections"))).toBe(false);
    expect(f.calls.filter(row => row.name === "read_engagement_synthesis_context_request")).toHaveLength(2);
    expect(f.calls[0].parameters).toEqual({ p_campaign: f.scope.campaignId, p_request: f.scope.requestId });
    expect(f.calls.at(-1)!.parameters).toEqual(f.calls[0].parameters);
    expect(f.calls.every(row => row.signal instanceof AbortSignal)).toBe(true);
    const frames = f.trace.filter(row => row.table === "engagement_synthesis_context_frames");
    expect(frames).toHaveLength(f.plan.entries.length);
    expect(frames.map(row => [row.columns, row.filters])).toEqual(f.plan.entries.map(entry => [
      "request_id,frame_index,frame_text,frame_sha256,frame_bytes", { request_id: f.scope.requestId, frame_index: entry.index },
    ]));
    const tasks = f.trace.filter(row => row.table === "engagement_synthesis_generation_plan_tasks");
    expect(tasks).toHaveLength(f.plan.entries.length);
    expect(tasks.map(row => [row.columns, row.filters])).toEqual(f.plan.entries.map(entry => [
      "request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256", { request_id: f.scope.requestId, task_index: entry.index },
    ]));
    for (const [table, projection] of [["engagement_synthesis_generation_plans", "request_id,header_text,header_sha256"],
      ["engagement_synthesis_generation_plan_seals", "request_id,receipt_text,receipt_sha256"]]) {
      expect(f.trace.find(row => row.table === table && row.filters.request_id === f.scope.requestId)?.columns).toBe(projection);
    }
  });
  it("preserves original cancellation and accepts cancellation during inspection", async () => {
    for (const during of [false, true]) {
      const f = fixture();
      if (during) f.historyOptions.before = name => { if (name === "read_engagement_synthesis_context_request" && f.historyOptions.contextReads === 1) f.cancel(); };
      else f.cancel();
      const result = await f.loadInputs(); expect(result.request.cancellation).toEqual(f.request.cancellation);
      expect(result.preparationStatus).toBe("sealed"); expect(f.serviceRpc).not.toHaveBeenCalled();
    }
  });
  it.each(["not_prepared", "staging", "all_frames_unsealed"])("preserves incomplete preparation %s", async mode => {
    const f = fixture();
    f.rows.set("engagement_synthesis_generation_plan_seals", f.rows.get("engagement_synthesis_generation_plan_seals")!.filter(row => row.request_id !== f.scope.requestId));
    if (mode === "not_prepared") f.rows.set("engagement_synthesis_generation_plans", f.rows.get("engagement_synthesis_generation_plans")!.filter(row => row.request_id !== f.scope.requestId));
    if (mode !== "all_frames_unsealed") for (const [table, key] of [["engagement_synthesis_context_frames", "frame_index"], ["engagement_synthesis_generation_plan_tasks", "task_index"]]) {
      f.rows.set(table, f.rows.get(table)!.filter(row => row.request_id !== f.scope.requestId || (mode === "staging" && row[key] === 0)));
    }
    const result = await f.loadInputs(); expect(result.preparationStatus).toBe(mode === "not_prepared" ? mode : "staging");
    expect(result.storedFrameCount).toBe(mode === "not_prepared" ? 0 : mode === "staging" ? 1 : f.plan.entries.length);
  });
  it.each([1, 2])("refuses staff access lost at context read %s", async read => {
    const f = fixture(); f.historyOptions.denyContextRead = read;
    await expect(f.loadInputs()).rejects.toThrow("Context request unavailable");
    if (read === 1) expect(f.trace).toHaveLength(0);
    else expect(f.trace.filter(row => row.table === "engagement_synthesis_context_frames")).toHaveLength(f.plan.entries.length);
  });
  it("rejects an immutable request change at final permission check", async () => {
    const f = fixture(); f.historyOptions.before = name => {
      if (name === "read_engagement_synthesis_context_request" && f.historyOptions.contextReads === 1) f.request.request.actorId = randomUUID();
    };
    await expect(f.loadInputs()).rejects.toThrow("Historical context inputs differ");
  });
  it.each(["campaignId", "workspaceId", "request"])("rejects foreign authenticated context %s", async field => {
    const f = fixture(); f.historyOptions.change = (name, data) => name !== "read_engagement_synthesis_context_request" ? data
      : { ...(data as object), [field]: field === "request" ? { ...f.request.request, id: randomUUID() } : randomUUID() };
    await expect(f.loadInputs()).rejects.toThrow("identity differs"); expect(f.trace).toHaveLength(0);
  });
  it.each(["segmentResultsManifestSha256", "contextManifestSha256", "contentManifestSha256", "targetRecordId"])("rejects self-hashed requested input drift %s", async field => {
    const f = fixture(); f.request.context.contextText = JSON.stringify({ ...JSON.parse(f.request.context.contextText),
      [field]: field === "targetRecordId" ? `item:${randomUUID()}` : "0".repeat(64) });
    f.request.context.contextSha256 = hash(f.request.context.contextText);
    await expect(f.loadInputs()).rejects.toThrow();
  });
  it.each(["request_id", "header_text", "header_sha256"])("rejects retained header drift %s", async field => {
    const f = fixture();
    if (field === "request_id") f.options.returnedPatch = { table: "engagement_synthesis_generation_plans", key: "request_id", value: f.scope.requestId, patch: { request_id: randomUUID() } };
    else Object.assign(f.planRow, { [field]: field === "header_text" ? " " + f.planRow.header_text : "0".repeat(64) });
    await expect(f.loadInputs()).rejects.toThrow("Historical context inputs differ");
  });
  it.each(["frame_text", "frame_sha256", "frame_bytes", "frame_index", "request_id"])("rejects original frame drift %s", async field => {
    const f = fixture(); f.options.returnedPatch = { table: "engagement_synthesis_context_frames", patch: {
      [field]: field === "frame_index" || field === "frame_bytes" ? 999 : field === "request_id" ? randomUUID() : field === "frame_text" ? "{}" : "0".repeat(64) } };
    await expect(f.loadInputs()).rejects.toThrow("Historical context inputs differ");
  });
  it.each(["task_sha256", "task_bytes", "task_index", "cumulative_bytes", "chain_sha256", "request_id"])("rejects frame reference row drift %s", async field => {
    const f = fixture(); f.options.returnedPatch = { table: "engagement_synthesis_generation_plan_tasks", patch: {
      [field]: field === "request_id" ? randomUUID() : field.endsWith("sha256") ? "0".repeat(64) : 999 } };
    await expect(f.loadInputs()).rejects.toThrow("Historical context inputs differ");
  });
  it.each(["frameIndex", "frameSha256", "frameBytes", "contextManifestSha256", "targetRecordId"])("rejects self-hashed reference drift %s", async field => {
    const f = fixture(), row = f.rows.get("engagement_synthesis_generation_plan_tasks")![0];
    row.task_text = JSON.stringify({ ...JSON.parse(String(row.task_text)), [field]: field === "frameIndex" || field === "frameBytes" ? 999 : "0".repeat(64) });
    row.task_sha256 = hash(String(row.task_text)); row.task_bytes = Buffer.byteLength(String(row.task_text));
    await expect(f.loadInputs()).rejects.toThrow("Historical context inputs differ");
  });
  it.each(["gap", "missing-frame", "missing-task", "short-seal", "foreign-seal", "corrupt-seal"])("rejects inconsistent retained preparation %s", async mode => {
    const f = fixture();
    if (mode === "gap") {
      // A hole in an unsealed prefix has no seal backstop.
      for (const table of ["engagement_synthesis_context_frames", "engagement_synthesis_generation_plan_tasks"]) f.rows.get(table)!.shift();
      f.rows.set("engagement_synthesis_generation_plan_seals", f.rows.get("engagement_synthesis_generation_plan_seals")!.filter(row => row.request_id !== f.scope.requestId));
    }
    if (mode === "short-seal") for (const table of ["engagement_synthesis_context_frames", "engagement_synthesis_generation_plan_tasks"]) f.rows.get(table)!.splice(1);
    if (mode === "missing-frame") f.rows.get("engagement_synthesis_context_frames")!.shift();
    if (mode === "missing-task") f.rows.get("engagement_synthesis_generation_plan_tasks")!.shift();
    if (mode === "foreign-seal") f.options.returnedPatch = { table: "engagement_synthesis_generation_plan_seals", key: "request_id", value: f.scope.requestId, patch: { request_id: randomUUID() } };
    if (mode === "corrupt-seal") f.sealRow.receipt_sha256 = "0".repeat(64);
    await expect(f.loadInputs()).rejects.toThrow(mode === "gap" ? /preparation changed during inspection; retry/ : /differ|seal/);
  });
  it.each(["read_engagement_synthesis_sources", "read_engagement_synthesis_generation_request", "read_engagement_synthesis_generation_selection_history"])("refuses denied historical dependency %s", async name => {
    const f = fixture(); f.historyOptions.denied = name; await expect(f.loadInputs()).rejects.toThrow(/unavailable/);
  });
  it("rejects failed storage reads and observes cancellation signals", async () => {
    const f = fixture(); f.options.failTable = "engagement_synthesis_context_frames";
    await expect(f.loadInputs()).rejects.toThrow("storage unavailable");
    f.options.failTable = ""; f.options.abortTable = "engagement_synthesis_context_frames";
    await expect(f.loadInputs()).rejects.toMatchObject({ name: "AbortError" });
  });
  it("rejects changed cancellation custody", async () => {
    const f = fixture(); f.cancel();
    Object.assign(f.request.cancellation as object, { receiptSha256: "0".repeat(64) });
    await expect(f.loadInputs()).rejects.toThrow("Historical context inputs differ");
  });
});
