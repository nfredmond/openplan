// @vitest-environment node
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSynthesisThematicWorkerAttempt, runSynthesisGenerationWorkerAttempt } from "@/lib/engagement/synthesis-generation-worker";
import { synthesisThematicExecutionWorkerFixture } from "./fixtures/engagement/synthesis-thematic-execution-worker";

const fixtures: Awaited<ReturnType<typeof synthesisThematicExecutionWorkerFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.unstubAllEnvs(); });
async function fixture(priorCount: number | "final" = 0) { const f = await synthesisThematicExecutionWorkerFixture(priorCount); fixtures.push(f); return f; }
describe("thematic worker shared durable execution", () => {
  it.each([0, 2, "final"] as const)("dispatches task %s using reconstructed thematic and keeps exact response bytes", async priorCount => {
    const f = await fixture(priorCount), result = await runSynthesisThematicWorkerAttempt(f.args), pending = await f.journal();
    expect(result).toEqual({ state: "delivered", attemptId: pending.attemptId, captureSha256: pending.captureSha256 });
    expect(f.trace.filter(row => !row.name.startsWith("read_")).map(row => [row.name, row.phase, row.thematic])).toEqual([
      ["claim_engagement_synthesis_thematic_attempt", "prepared", true], ["dispatch_engagement_synthesis_thematic_attempt", "dispatching", true],
      ["retain_engagement_synthesis_generation_output", "observed", true],
    ]);
    expect(JSON.parse(f.calls[0]).response_format.json_schema.name).toBe(`synthesis_thematic_${JSON.parse(f.f.next.task.canonical).input.stage}_v1`);
    expect(JSON.parse(f.calls[0]).messages[1].content).toBe(f.f.next.task.canonical);
    f.rpc.mockClear(); f.f.from.mockClear();
    expect(await runSynthesisThematicWorkerAttempt(f.args)).toEqual(result);
    expect(f.calls).toHaveLength(1); expect(f.f.from).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledOnce(); expect(f.rpc.mock.calls[0][0]).toBe("retain_engagement_synthesis_generation_output");
  });
  it("retries an unknown thematic claim with the same exact task and predecessor", async () => {
    const f = await fixture(2); f.options.loseClaim = true;
    await expect(runSynthesisThematicWorkerAttempt(f.args)).rejects.toThrow("acknowledgement unavailable");
    expect((await f.journal()).thematic).toBe(true);
    await runSynthesisThematicWorkerAttempt(f.args);
    const claims = f.trace.filter(row => row.name.startsWith("claim_"));
    expect(claims).toHaveLength(2); expect(claims[1].values).toEqual(claims[0].values); expect(f.calls).toHaveLength(1);
  });
  it("keeps an unknown thematic dispatch unobserved without invoking the provider", async () => {
    const f = await fixture(); f.options.loseDispatch = true;
    await expect(runSynthesisThematicWorkerAttempt(f.args)).rejects.toThrow("acknowledgement unavailable");
    f.rpc.mockClear();
    expect((await runSynthesisThematicWorkerAttempt(f.args)).state).toBe("unobserved");
    expect((await f.journal()).thematic).toBe(true); expect(f.rpc).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  });
  it("redelivers an observed thematic response without a second call", async () => {
    const f = await fixture(); f.options.loseOutput = true;
    await expect(runSynthesisThematicWorkerAttempt(f.args)).rejects.toThrow("retain and retry the same capture");
    await runSynthesisThematicWorkerAttempt(f.args);
    const deliveries = f.trace.filter(row => row.name.startsWith("retain_"));
    expect(deliveries).toHaveLength(2); expect(deliveries[1].values).toEqual(deliveries[0].values); expect(f.calls).toHaveLength(1);
  });
  it("refuses lost current thematic authority before a provider call", async () => {
    const f = await fixture(); f.options.failStatus = true;
    await expect(runSynthesisThematicWorkerAttempt(f.args)).rejects.toThrow(); expect(f.calls).toHaveLength(0);
  });
  it.each(["pending", "temporary"])("refuses a thematic %s journal in the segment worker", async mode => {
    const f = await fixture(); await runSynthesisThematicWorkerAttempt(f.args);
    if (mode === "temporary") {
      const path = join(f.directory, "pending.json");
      await writeFile(join(f.directory, "pending-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.tmp"), await readFile(path), { mode: 0o600 });
      await unlink(path);
    }
    f.rpc.mockClear();
    await expect(runSynthesisGenerationWorkerAttempt(f.args)).rejects.toThrow("journal or acknowledgement differs");
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(1);
  });
  it.each(["prepared", "delivered"])("refuses a segment %s journal in the thematic worker", async phase => {
    const f = await fixture();
    if (phase === "prepared") f.options.loseClaim = true;
    await runSynthesisThematicWorkerAttempt(f.args).catch(error => {
      if (phase !== "prepared") throw error;
    });
    const pending = await f.journal();
    expect(pending.phase).toBe(phase);
    delete pending.thematic;
    await writeFile(join(f.directory, "pending.json"), JSON.stringify(pending), { mode: 0o600 });
    f.rpc.mockClear();
    await expect(runSynthesisThematicWorkerAttempt(f.args)).rejects.toThrow("journal or acknowledgement differs");
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(phase === "prepared" ? 0 : 1);
  });
  it.each(["prepared","delivered"])("refuses an ambiguous %s journal",async phase=>{
    const f=await fixture();if(phase==="prepared")f.options.loseClaim=true;
    await runSynthesisThematicWorkerAttempt(f.args).catch(error=>{if(phase!=="prepared")throw error;});
    const pending=await f.journal();pending.context=true;await writeFile(join(f.directory,"pending.json"),JSON.stringify(pending),{mode:0o600});
    f.rpc.mockClear();await expect(runSynthesisThematicWorkerAttempt(f.args)).rejects.toThrow("journal or acknowledgement differs");expect(f.rpc).not.toHaveBeenCalled();
  });

});
