// @vitest-environment node
import { ProviderApiTransportError } from "../lib/assistant/provider-api-transport";
import { synthesisExecutionDiagnostics } from "../lib/engagement/synthesis-execution-service";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ page: vi.fn(), run: vi.fn(), beforeSave: vi.fn() }));
vi.mock("../lib/engagement/synthesis-execution-queue-reader", () => ({ readSynthesisExecutionQueuePage: mocks.page }));
vi.mock("../lib/engagement/synthesis-execution-queue-driver", () => ({ runQueuedSynthesisSchedule: mocks.run }));
vi.mock("../../../workers/planner_agent_connector/connector-worker.mjs", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../workers/planner_agent_connector/connector-worker.mjs")>();
  return { ...actual, writeConnectorJournal: async (directory: string, value: unknown) => {
    await mocks.beforeSave(value); await actual.writeConnectorJournal(directory, value);
  } };
});
import { runSynthesisExecutionQueuePass } from "../lib/engagement/synthesis-execution-queue-coordinator";
import { acquireConnectorLock } from "../../../workers/planner_agent_connector/connector-worker.mjs";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function receipt(n: number) {
  const commandText = JSON.stringify({ schemaVersion: 1, queueId: id(n), authorizationId: id(n+100), authorizationIntentSha256: "a".repeat(64),
    requestId: id(50), campaignId: id(51), workspaceId: id(52), actorId: id(53), sourceId: id(54), sourceSha256: "b".repeat(64), requestIntentSha256: "c".repeat(64), stage: "segment" });
  return { schemaVersion: 1, queueId: id(n), commandText, commandSha256: createHash("sha256").update(commandText).digest("hex"), createdAt: "2026-10-07T23:00:00Z" };
}
const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "synthesis-queue-")); directories.push(directory);
  const controller = new AbortController();
  const args = { directory, root: join(directory, "worker"), target: "http://localhost:29821", service: {} as Pick<SupabaseClient, "from" | "rpc">, signal: controller.signal };
  return { args, controller, run: () => runSynthesisExecutionQueuePass(args), journal: async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8")) };
}
beforeEach(() => { vi.resetAllMocks(); mocks.page.mockResolvedValue({ entries: [1,2].map(n => ({ receipt: receipt(n) })), nextCursor: id(2) }); });
afterEach(async () => { for (const p of directories.splice(0)) await rm(p, { recursive: true, force: true }); });
describe("durable execution page coordinator", () => {
  it("saves each original entry before dispatch and advances only after return", async () => {
    const f = await fixture();
    mocks.run.mockImplementation(async args => {
      const state = await f.journal(); expect(state.pending[0]).toEqual(args.receipt); expect(state.after).toBe(id(2));
      expect(args.root).toBe(f.args.root); expect(args.target).toBe(f.args.target);
    });
    expect((await f.run()).outcomes.map(x => x.state)).toEqual(["schedule_returned", "schedule_returned"]);
    expect((await f.journal()).pending).toEqual([]);
  });
  it("continues unrelated entries after an unavailable schedule", async () => {
    const f = await fixture(); mocks.run.mockRejectedValueOnce(new Error("unknown"));
    expect((await f.run()).outcomes.map(x => x.state)).toEqual(["unconfirmed", "schedule_returned"]);
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });
  it.each(["api_endpoint_denied", "api_endpoint_policy_invalid"])("reports safe operator guidance for %s", async code => {
    const f = await fixture(); mocks.run.mockRejectedValueOnce(new ProviderApiTransportError(code));
    const result = await f.run();
    expect(result.outcomes[0]).toEqual({ queueId: id(1), state: "unconfirmed", reason: "endpoint_policy" });
    expect(synthesisExecutionDiagnostics(result)).toEqual([`Queue ${id(1)}: provider endpoint policy refused execution. Check the worker process OPENPLAN_AI_LOCAL_ENDPOINTS and outbound host policy. Preserve its journals and inspect saved task results before any retry; dispatch may already be retained.`]);
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });
  it.each([new Error("secret provider body"), new ProviderApiTransportError("secret provider body"),
    { code: "api_endpoint_denied", message: "secret provider body" }])("does not publish unknown or forged error details", async error => {
    const f = await fixture(); mocks.run.mockRejectedValueOnce(error);
    const result = await f.run();
    expect(result.outcomes[0]).toEqual({ queueId: id(1), state: "unconfirmed" });
    expect(synthesisExecutionDiagnostics(result)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("resumes an interrupted entry before discovery with unchanged command", async () => {
    const f = await fixture(); mocks.run.mockImplementationOnce(async () => f.controller.abort());
    await expect(f.run()).rejects.toThrow(); expect((await f.journal()).pending).toHaveLength(2);
    f.args.signal = new AbortController().signal; await f.run();
    expect(mocks.page).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[1][0].commandText).toBe(mocks.run.mock.calls[0][0].commandText);
  });
  it("does not dispatch when saving discovered work fails", async () => {
    const f = await fixture(); mocks.beforeSave.mockImplementation(state => { if (state.pending.length) throw new Error("disk"); });
    await expect(f.run()).rejects.toThrow("disk"); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("replays the same entry after progress persistence fails", async () => {
    const f = await fixture(); mocks.beforeSave.mockImplementation(state => { if (mocks.run.mock.calls.length && state.pending.length === 1) throw new Error("disk"); });
    await expect(f.run()).rejects.toThrow("disk"); mocks.beforeSave.mockReset(); await f.run();
    expect(mocks.run.mock.calls[1][0].receipt).toEqual(mocks.run.mock.calls[0][0].receipt);
  });
  it.each(["target", "root", "checksum", "cursor"])("refuses changed journal %s", async field => {
    const f = await fixture(); mocks.run.mockImplementationOnce(async () => f.controller.abort()); await expect(f.run()).rejects.toThrow();
    const state = await f.journal(); if (field === "checksum") state.pending[0].commandSha256 = "0".repeat(64);
    else if (field === "cursor") state.after = id(99); else state[field] += "/changed";
    await writeFile(join(f.args.directory, "pending.json"), JSON.stringify(state));
    f.args.signal = new AbortController().signal; mocks.run.mockClear(); await expect(f.run()).rejects.toThrow(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("wraps discovery only after an empty page", async () => {
    const f = await fixture(); await f.run(); mocks.page.mockResolvedValueOnce({ entries: [], nextCursor: null });
    expect((await f.run()).queueWrapped).toBe(true); await f.run();
    expect(mocks.page.mock.calls.map(c => c[1])).toEqual([null, id(2), null]);
  });
  it("refuses a concurrent local coordinator", async () => {
    const f = await fixture(), lock = await acquireConnectorLock(f.args.directory);
    try { await expect(f.run()).rejects.toThrow(); expect(mocks.run).not.toHaveBeenCalled(); } finally { await lock.release(); }
  });
});
