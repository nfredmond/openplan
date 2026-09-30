// @vitest-environment node
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSynthesisGenerationWorkerAttempt } from "@/lib/engagement/synthesis-generation-worker";
import { createSynthesisGenerationApiAttempt } from "@/lib/engagement/synthesis-generation-api";
import { acquireConnectorLock } from "../../../workers/planner_agent_connector/connector-worker.mjs";
import { synthesisWorkerFixture, synthesisWorkerHash } from "./fixtures/engagement/synthesis-worker";

const fixtures: Awaited<ReturnType<typeof synthesisWorkerFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function fixture() { const f = await synthesisWorkerFixture(); fixtures.push(f); return f; }
async function save(f: Awaited<ReturnType<typeof fixture>>, value: unknown) { await writeFile(join(f.args.directory, "pending.json"), JSON.stringify(value), { mode: 0o600 }); }
describe("synthesis worker custody and recovery", () => {
  it("journals before claim, dispatch and delivery with the real local API", async () => {
    const f = await fixture(), result = await runSynthesisGenerationWorkerAttempt(f.args), journal = await f.journal();
    expect(result).toEqual({ state: "delivered", attemptId: journal.attemptId, captureSha256: journal.captureSha256 });
    expect(f.rpcTrace.filter(row => !row.name.startsWith("read_")).map(row => [row.name, row.phase])).toEqual([
      ["claim_engagement_synthesis_generation_attempt", "prepared"], ["dispatch_engagement_synthesis_generation_attempt", "dispatching"],
      ["retain_engagement_synthesis_generation_output", "observed"],
    ]);
    expect(journal.phase).toBe("delivered"); expect(journal.observation.receipt.bodyComplete).toBe(true);
    expect(JSON.parse(f.providerCalls[0].body).messages[1].content).toBe(f.task.canonical);
    expect(f.providerCalls).toHaveLength(1);
    const bytes = await readFile(join(f.args.directory, "pending.json"), "utf8");
    expect(bytes).not.toContain(f.revision.credentialCiphertext!); expect(bytes).not.toContain("SYNTHETIC-SAVED-KEY");
    expect((await stat(f.args.directory)).mode & 0o077).toBe(0); expect((await stat(join(f.args.directory, "pending.json"))).mode & 0o077).toBe(0);
    f.rpc.mockClear(); f.from.mockClear();
    expect(await runSynthesisGenerationWorkerAttempt(f.args)).toEqual(result);
    expect(f.rpc).toHaveBeenCalledOnce(); expect(f.rpc.mock.calls[0][0]).toBe("retain_engagement_synthesis_generation_output");
    expect(f.from).not.toHaveBeenCalled(); expect(f.providerCalls).toHaveLength(1);
  });
  it("retries an unknown claim acknowledgement with the same attempt and worker", async () => {
    const f = await fixture(); f.options.loseClaim = true;
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("acknowledgement unavailable");
    const pending = await f.journal(); expect(pending.phase).toBe("prepared");
    await runSynthesisGenerationWorkerAttempt(f.args);
    const claims = f.rpcTrace.filter(row => row.name.startsWith("claim_"));
    expect(claims).toHaveLength(2); expect(claims[0].values).toEqual(claims[1].values);
    expect(claims[1].values.p_attempt).toBe(pending.attemptId); expect(f.providerCalls).toHaveLength(1);
  });
  it("keeps an unknown dispatch acknowledgement unobserved without filling the output slot", async () => {
    const f = await fixture(); f.options.loseDispatch = true;
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("acknowledgement unavailable");
    const pending = await f.journal(); expect(pending.phase).toBe("dispatching"); f.rpc.mockClear(); f.from.mockClear();
    expect(await runSynthesisGenerationWorkerAttempt(f.args)).toEqual({ state: "unobserved", attemptId: pending.attemptId });
    expect((await f.journal()).phase).toBe("unobserved"); expect(f.rpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
    expect(f.providerCalls).toHaveLength(0);
    expect(await runSynthesisGenerationWorkerAttempt(f.args)).toEqual({ state: "unobserved", attemptId: pending.attemptId });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("resumes a claimed attempt after a credential read failure without claiming again", async () => {
    const f = await fixture(); f.options.failRow = "workspace_provider_api_credentials";
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("retained row unavailable");
    expect((await f.journal()).phase).toBe("claimed"); f.options.failRow = "";
    expect((await runSynthesisGenerationWorkerAttempt(f.args)).state).toBe("delivered");
    expect(f.rpcTrace.filter(row => row.name.startsWith("claim_"))).toHaveLength(1); expect(f.providerCalls).toHaveLength(1);
  });
  it("redelivers only the original bytes after an unknown output acknowledgement", async () => {
    const f = await fixture(); f.options.loseOutput = true;
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("retain and retry the same capture");
    const pending = await f.journal(); expect(pending.phase).toBe("observed");
    const first = f.rpcTrace.find(row => row.name.startsWith("retain_"))!; f.from.mockClear();
    const result = await runSynthesisGenerationWorkerAttempt(f.args);
    const retained = f.rpcTrace.filter(row => row.name.startsWith("retain_")); expect(retained).toHaveLength(2);
    expect(retained[1].values).toEqual(first.values); expect(result.state).toBe("delivered");
    expect(f.from).not.toHaveBeenCalled(); expect(f.providerCalls).toHaveLength(1);
    expect((await f.journal()).observation).toEqual(pending.observation);
  });
  it("recovers a receipt larger than the old one-megabyte worker journal", async () => {
    const f = await fixture(); f.options.providerOutput = "é".repeat(750000);
    f.authorizationIntent.responseByteLimit = 4194304; f.resealGrant(); f.options.loseOutput = true;
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("retain and retry the same capture");
    expect((await stat(join(f.args.directory, "pending.json"))).size).toBeGreaterThan(1_000_000);
    const first = f.rpcTrace.find(row => row.name.startsWith("retain_"))!;
    expect((await runSynthesisGenerationWorkerAttempt(f.args)).state).toBe("delivered");
    expect(f.rpcTrace.filter(row => row.name.startsWith("retain_"))[1].values).toEqual(first.values);
    expect(f.providerCalls).toHaveLength(1);
  });
  it("cannot use a replayed dispatch acknowledgement to call a provider", async () => {
    const f = await fixture(); f.options.dispatchPatch = { authorizedNow: false };
    expect((await runSynthesisGenerationWorkerAttempt(f.args)).state).toBe("unobserved");
    expect(f.providerCalls).toHaveLength(0); expect(f.rpcTrace.filter(row => row.name.startsWith("retain_"))).toHaveLength(0);
  });
  it.each([
    { attemptId: "a0000000-0000-4000-8000-000000000001" }, { workerId: "a0000000-0000-4000-8000-000000000001" },
    { authorizationId: "a0000000-0000-4000-8000-000000000001" }, { taskIndex: 1 }, { bindingText: "{}" },
    { claimExpiresAt: "2099-01-01T00:00:00Z" },
  ])("refuses inconsistent claim acknowledgement %j", async patch => {
    const f = await fixture(); f.options.claimPatch = patch;
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("acknowledgement differs");
    expect((await f.journal()).phase).toBe("prepared"); expect(f.providerCalls).toHaveLength(0);
    expect(f.rpcTrace.some(row => row.name.startsWith("dispatch_"))).toBe(false);
  });
  it("stops on an unreadable status before constructing an API adapter", async () => {
    const f = await fixture(), generate = vi.fn(createSynthesisGenerationApiAttempt); f.options.failStatus = true;
    await expect(runSynthesisGenerationWorkerAttempt({ ...f.args, generate })).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled(); expect(f.providerCalls).toHaveLength(0);
  });
  it("stops at an expired unchanged native deadline before constructing an API adapter", async () => {
    const f = await fixture(), generate = vi.fn(createSynthesisGenerationApiAttempt);
    Object.defineProperty(f.options.statusPatch, "canContinue", { enumerable: true, get() {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse(f.authorizationIntent.expiresAt) + 1); return true;
    } });
    await expect(runSynthesisGenerationWorkerAttempt({ ...f.args, generate })).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled(); expect(f.providerCalls).toHaveLength(0);
  });
  it.each([
    { canContinue: false }, { attemptId: "a0000000-0000-4000-8000-000000000001" },
    { workerId: "a0000000-0000-4000-8000-000000000002" }, { dispatchSha256: "a".repeat(64) },
    { outputSha256: "a".repeat(64) }, { expiresAt: null }, { expiresAt: "2026-01-01T00:00:00Z" },
    { expiresAt: "2099-01-01T00:00:00Z" },
  ])("stops before a call for changed native status %j", async patch => {
    const f = await fixture(); f.options.statusPatch = patch;
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow();
    expect((await f.journal()).phase).toBe("running"); expect(f.providerCalls).toHaveLength(0);
    expect((await runSynthesisGenerationWorkerAttempt(f.args)).state).toBe("unobserved");
    expect(f.rpcTrace.filter(row => row.name.startsWith("retain_"))).toHaveLength(0);
  });
  it("observes lost authority during a call and retains the actual interrupted response", async () => {
    const f = await fixture(); f.options.holdResponse = true;
    const pending = runSynthesisGenerationWorkerAttempt(f.args); await f.arrived; f.options.statusPatch = { canContinue: false };
    expect((await pending).state).toBe("delivered");
    const journal = await f.journal(); expect(journal.observation.receipt.bodyComplete).toBe(false);
    expect(journal.observation.receipt.termination).toBe("request_interrupted"); expect(f.providerCalls).toHaveLength(1);
    const delivery = f.rpcTrace.find(row => row.name.startsWith("retain_"))!;
    expect(JSON.parse(Buffer.from(String(delivery.values.p_capture_base64), "base64").toString()).outcome).toBe("interrupted");
  });
  it("preserves a returned receipt when later interpretation throws", async () => {
    const f = await fixture();
    const generate: typeof createSynthesisGenerationApiAttempt = args => {
      const invoke = createSynthesisGenerationApiAttempt(args);
      return async () => { await invoke(); throw new Error("SYNTHETIC later interpretation failure"); };
    };
    await expect(runSynthesisGenerationWorkerAttempt({ ...f.args, generate })).rejects.toThrow("later interpretation failure");
    expect((await f.journal()).phase).toBe("observed"); f.from.mockClear();
    expect((await runSynthesisGenerationWorkerAttempt(f.args)).state).toBe("delivered");
    expect(f.from).not.toHaveBeenCalled(); expect(f.providerCalls).toHaveLength(1);
  });
  it("recovers an original receipt temporary left before atomic rename", async () => {
    const f = await fixture(); f.options.loseOutput = true;
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow(); const original = await f.journal();
    await writeFile(join(f.args.directory, "pending-a0000000-0000-4000-8000-000000000001.tmp"), JSON.stringify(original), { mode: 0o600 });
    const running = { ...original, phase: "running" }; delete running.observation; await save(f, running);
    f.from.mockClear(); expect((await runSynthesisGenerationWorkerAttempt(f.args)).state).toBe("delivered");
    expect((await f.journal()).observation).toEqual(original.observation);
    expect(f.from).not.toHaveBeenCalled(); expect(f.providerCalls).toHaveLength(1);
  });
  it("does not treat a partially written temporary as an observed result", async () => {
    const f = await fixture(); f.options.loseDispatch = true;
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow();
    const path = join(f.args.directory, "pending-a0000000-0000-4000-8000-000000000001.tmp");
    await writeFile(path, '{"phase":"observed",', { mode: 0o600 });
    expect((await runSynthesisGenerationWorkerAttempt(f.args)).state).toBe("unobserved");
    expect(await readFile(path, "utf8")).toBe('{"phase":"observed",'); expect(f.providerCalls).toHaveLength(0);
    expect(f.rpcTrace.some(row => row.name.startsWith("retain_"))).toBe(false);
  });
  it("refuses two conflicting but internally valid original observations", async () => {
    const f = await fixture(); f.options.loseOutput = true;
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow(); const changed = await f.journal();
    const text = '{"different":"SYNTHETIC response"}';
    Object.assign(changed.observation.receipt, { bodyBase64: Buffer.from(text).toString("base64"), bodySha256: synthesisWorkerHash(text), retainedBytes: Buffer.byteLength(text) });
    await writeFile(join(f.args.directory, "pending-a0000000-0000-4000-8000-000000000001.tmp"), JSON.stringify(changed), { mode: 0o600 });
    f.rpc.mockClear();
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("conflicting retained observations");
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.providerCalls).toHaveLength(1);
  });
  it("rejects a changed acknowledgement while preserving the original observation", async () => {
    const f = await fixture(); f.options.outputPatch = { captureSha256: "a".repeat(64) };
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("acknowledgement differs");
    expect((await f.journal()).phase).toBe("observed"); expect(f.providerCalls).toHaveLength(1);
  });
  it.each(["target", "authorization", "task", "job-attempt", "job-grant", "job-task", "dispatch-checksum", "observed-checksum", "delivered-checksum"])("refuses a changed recovery %s", async mode => {
    const f = await fixture(); await runSynthesisGenerationWorkerAttempt(f.args); const journal = await f.journal();
    const args = { ...f.args };
    if (mode === "target") journal.target = "http://127.0.0.1:12345";
    if (mode === "authorization") args.authorizationId = "a0000000-0000-4000-8000-000000000001";
    if (mode === "task") args.taskIndex = 1;
    if (mode === "job-attempt") {
      journal.job.binding.attemptId = "a0000000-0000-4000-8000-000000000001";
      const receipt = JSON.parse(journal.dispatch.receiptText);
      receipt.attemptId = journal.job.binding.attemptId; receipt.binding = journal.job.binding;
      journal.dispatch.receiptText = JSON.stringify(receipt); journal.dispatch.receiptSha256 = synthesisWorkerHash(journal.dispatch.receiptText);
      journal.observation.dispatchSha256 = journal.dispatch.receiptSha256;
      journal.phase = "observed"; delete journal.captureSha256;
    }
    if (mode === "job-grant") journal.job.authorizationId = "a0000000-0000-4000-8000-000000000001";
    if (mode === "job-task") journal.job.taskIndex = 1;
    if (mode === "dispatch-checksum") journal.dispatch.receiptSha256 = "a".repeat(64);
    if (mode === "observed-checksum") journal.observation.receipt.bodySha256 = "a".repeat(64);
    if (mode === "delivered-checksum") journal.captureSha256 = "a".repeat(64);
    await save(f, journal); f.rpc.mockClear(); f.from.mockClear();
    await expect(runSynthesisGenerationWorkerAttempt(args)).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled(); expect(f.providerCalls).toHaveLength(1);
  });
  it("refuses concurrent ownership of the same journal", async () => {
    const f = await fixture(), lock = await acquireConnectorLock(f.args.directory);
    try { await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("connector_already_running"); }
    finally { await lock.release(); }
    expect(f.from).not.toHaveBeenCalled(); expect(f.providerCalls).toHaveLength(0);
  });
  it("refuses nonprivate and malformed saved journals", async () => {
    const f = await fixture(); await writeFile(join(f.args.directory, "pending.json"), "{}", { mode: 0o644 });
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("connector_file_not_private");
    await chmod(join(f.args.directory, "pending.json"), 0o600);
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow(); expect(f.from).not.toHaveBeenCalled();
  });
});
