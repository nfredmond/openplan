// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm, chmod, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ before: vi.fn(), after: vi.fn() }));
vi.mock("../../../workers/planner_agent_connector/connector-worker.mjs", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../workers/planner_agent_connector/connector-worker.mjs")>();
  return { ...actual, writeConnectorJournal: async (directory: string, value: unknown) => {
    await io.before(directory, value); await actual.writeConnectorJournal(directory, value); await io.after(directory, value);
  } };
});
import { acquireConnectorLock } from "../../../workers/planner_agent_connector/connector-worker.mjs";
import { runSynthesisPreparationJournal } from "@/lib/engagement/synthesis-preparation-journal";

const id = (n: number) => `d2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const requestId = id(1), date = "2026-10-02T12:00:00.000Z", later = "2026-10-02T12:02:00.000Z";
const sealSha256 = "b".repeat(64), directories: string[] = [];
afterEach(async () => { io.before.mockReset(); io.after.mockReset(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openplan-preparation-journal-")); directories.push(directory);
  const journal = async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8"));
  const save = (value: unknown) => writeFile(join(directory, "pending.json"), JSON.stringify(value), { mode: 0o600 });
  const lease = (token: string) => ({ schemaVersion: 1, requestId, campaignId: id(3), workspaceId: id(4), actorId: id(5),
    intentSha256: "a".repeat(64), stage: "segment", status: "running", attempts: 1, leaseUntil: later, leaseToken: token,
    failureCode: null, sealSha256: null, cancelled: false, createdAt: date, updatedAt: date,
    claim: { token, request_id: requestId, attempt: 1, claimed_at: date, initial_lease_until: later }, active: true });
  const native = async (name: string, params: Record<string, unknown>) => {
    const saved = await journal();
    if (name.startsWith("claim_")) {
      expect(saved).toMatchObject({ phase: "claim", requestId: params.p_request, token: params.p_token });
      return { data: lease(String(params.p_token)), error: null };
    }
    expect(name).toBe("finish_engagement_synthesis_preparation");
    expect(saved).toMatchObject({ phase: "outcome", lease: { requestId: params.p_request, leaseToken: params.p_token },
      outcome: params.p_seal_sha256 ? { sealSha256: params.p_seal_sha256 } : { failureCode: params.p_failure_code } });
    const { claim: _claim, active: _active, ...state } = lease(String(params.p_token));
    return { data: { ...state, status: params.p_seal_sha256 ? "prepared" : "failed", leaseUntil: null,
      sealSha256: params.p_seal_sha256, failureCode: params.p_failure_code }, error: null };
  };
  const response = vi.fn<(...args: [string, Record<string, unknown>, AbortSignal]) => Promise<{ data: unknown; error: unknown }>>(native);
  const rpc = vi.fn((name: string, params: Record<string, unknown>) => ({ abortSignal: (signal: AbortSignal) => response(name, params, signal) }));
  const prepare = vi.fn<Parameters<typeof runSynthesisPreparationJournal>[0]["prepare"]>(async () => ({ sealSha256 }));
  const controller = new AbortController();
  const args = { service: { rpc } as unknown as Pick<SupabaseClient, "rpc">, requestId, target: "http://localhost:29821/", directory, signal: controller.signal, prepare };
  const run = () => runSynthesisPreparationJournal(args);
  const outcome = (token = id(2)) => ({ version: 1, target: "http://localhost:29821", requestId, token, phase: "outcome", lease: lease(token), outcome: { sealSha256 } });
  return { directory, journal, save, lease, native, response, rpc, prepare, controller, args, run, outcome };
}

describe("durable preparation attempts", () => {
  it("syncs token before claim and exact outcome before finish, then retains a historical receipt", async () => {
    const f = await fixture(); const result = await f.run();
    expect(result).toMatchObject({ state: "acknowledged", requestId, outcome: { sealSha256 } });
    expect(await f.journal()).toMatchObject({ phase: "acknowledged", token: result.token, target: "http://localhost:29821", outcome: { sealSha256 } });
    expect(f.rpc).toHaveBeenCalledTimes(2); expect(f.prepare).toHaveBeenCalledTimes(1);
    expect((await stat(f.directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(f.directory, "pending.json"))).mode & 0o777).toBe(0o600);
    expect(await f.run()).toEqual(result); expect(f.rpc).toHaveBeenCalledTimes(2); expect(f.prepare).toHaveBeenCalledTimes(1);
  });
  it("reuses the saved token after an unknown claim reply", async () => {
    const f = await fixture(); f.response.mockResolvedValueOnce({ data: null, error: { message: "lost" } });
    await expect(f.run()).rejects.toThrow("acknowledgement unavailable"); const saved = await f.journal(); expect(saved.phase).toBe("claim");
    await f.run(); expect(f.rpc.mock.calls[0]).toEqual(f.rpc.mock.calls[1]); expect(f.rpc.mock.calls[1][1].p_token).toBe(saved.token); expect(f.prepare).toHaveBeenCalledTimes(1);
  });
  it("replays saved outcome after lost finish without preparing again", async () => {
    const f = await fixture(); f.response.mockImplementationOnce(f.native).mockRejectedValueOnce(new Error("lost finish"));
    await expect(f.run()).rejects.toThrow("lost finish"); const saved = await f.journal(); expect(saved.phase).toBe("outcome");
    await f.run(); expect(f.rpc.mock.calls[1]).toEqual(f.rpc.mock.calls[2]); expect(f.prepare).toHaveBeenCalledTimes(1);
    expect((await f.journal()).phase).toBe("acknowledged");
  });
  it("keeps outcome unconfirmed after a conflicting native reply", async () => {
    const f = await fixture(); await f.save(f.outcome()); f.response.mockResolvedValue({ data: null, error: { message: "superseded" } });
    await expect(f.run()).rejects.toThrow(); expect(await f.journal()).toEqual(f.outcome()); expect(f.prepare).not.toHaveBeenCalled();
  });
  it("replays explicit failure without creating a replacement attempt", async () => {
    const f = await fixture(); await f.save({ ...f.outcome(), outcome: { failureCode: "input_unavailable" } });
    expect(await f.run()).toMatchObject({ state: "acknowledged", outcome: { failureCode: "input_unavailable" } });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("finish_engagement_synthesis_preparation", { p_request: requestId, p_token: id(2), p_seal_sha256: null, p_failure_code: "input_unavailable" }); expect(f.prepare).not.toHaveBeenCalled();
  });
  it("records a confirmed inactive token without preparing or rotating it", async () => {
    const f = await fixture(); f.response.mockResolvedValueOnce({ data: null, error: null }); const first = await f.run();
    expect(first.state).toBe("not_active"); expect((await f.journal()).phase).toBe("not_active"); expect(await f.run()).toEqual(first);
    expect(f.rpc).toHaveBeenCalledTimes(1); expect(f.prepare).not.toHaveBeenCalled();
  });
  it("leaves a thrown preparation in claim phase for exact retry", async () => {
    const f = await fixture(); f.prepare.mockRejectedValueOnce(new Error("input read lost"));
    await expect(f.run()).rejects.toThrow("input read lost"); expect((await f.journal()).phase).toBe("claim"); await f.run(); expect(f.rpc.mock.calls[0]).toEqual(f.rpc.mock.calls[1]);
  });
  it.each(["claim", "outcome", "acknowledged"])("recovers disk failure before writing %s", async phase => {
    const f = await fixture(); io.before.mockImplementation(async (_directory, value) => { if (value.phase === phase) throw new Error("disk unavailable"); });
    await expect(f.run()).rejects.toThrow("disk unavailable");
    expect(f.rpc).toHaveBeenCalledTimes(phase === "claim" ? 0 : phase === "outcome" ? 1 : 2);
    if (phase === "acknowledged") expect((await f.journal()).phase).toBe("outcome");
    io.before.mockReset(); await f.run(); expect((await f.journal()).phase).toBe("acknowledged");
    expect(f.prepare).toHaveBeenCalledTimes(phase === "outcome" ? 2 : 1);
  });
  it("recovers an outcome whose rename succeeded before a disk error", async () => {
    const f = await fixture(); io.after.mockImplementation(async (_directory, value) => { if (value.phase === "outcome") throw new Error("sync unknown"); });
    await expect(f.run()).rejects.toThrow("sync unknown"); expect(f.rpc).toHaveBeenCalledTimes(1); expect((await f.journal()).phase).toBe("outcome");
    io.after.mockReset(); await f.run(); expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.rpc.mock.calls[1][0]).toBe("finish_engagement_synthesis_preparation");
  });
  it("prevents stage mutation from changing retained claim identity", async () => {
    const f = await fixture(); f.args.prepare = vi.fn(async (lease) => { lease.requestId = id(99); lease.claim!.token = id(98); return { sealSha256 }; });
    await expect(f.run()).resolves.toMatchObject({ state: "acknowledged" }); expect((await f.journal()).lease).toMatchObject({ requestId, claim: { token: f.rpc.mock.calls[0][1].p_token } });
  });
  it.each(["target", "request", "token", "lease", "outcome", "unknown-field", "version", "inactive-lease"].flatMap(kind =>
    ["outcome", "acknowledged"].map(phase => ({ kind, phase }))))("refuses corrupt $phase journal $kind before RPC", async ({ kind, phase }) => {
    const f = await fixture(), saved = { ...f.outcome(), phase };
    if (kind === "target") saved.target = "http://localhost:9999";
    if (kind === "request") saved.requestId = id(99);
    if (kind === "token") saved.token = id(99);
    if (kind === "lease") saved.lease.requestId = id(99);
    if (kind === "outcome") saved.outcome.sealSha256 = "invalid";
    if (kind === "unknown-field") Object.assign(saved, { ignored: true });
    if (kind === "version") saved.version = 2;
    if (kind === "inactive-lease") saved.lease.active = false;
    await f.save(saved); await expect(f.run()).rejects.toThrow(); expect(f.rpc).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
  });
  it.each(["malformed", "oversized", "public", "symlink"])("refuses %s journal without replacing it", async kind => {
    const f = await fixture(), path = join(f.directory, "pending.json");
    await f.save(f.outcome());
    if (kind === "malformed") await writeFile(path, "{");
    if (kind === "oversized") await writeFile(path, JSON.stringify(f.outcome()).padEnd(32_769, " "));
    if (kind === "public") await chmod(path, 0o644);
    if (kind === "symlink") { await rm(path); await writeFile(join(f.directory, "other.json"), JSON.stringify(f.outcome()), { mode: 0o600 }); await symlink(join(f.directory, "other.json"), path); }
    await expect(f.run()).rejects.toThrow(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("requires an exclusive private directory", async () => {
    const f = await fixture(), lock = await acquireConnectorLock(f.directory);
    try { await expect(f.run()).rejects.toThrow(); expect(f.rpc).not.toHaveBeenCalled(); } finally { await lock.release(); }
    await chmod(f.directory, 0o755); await expect(f.run()).rejects.toThrow(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("refuses an invalid target before filesystem or native work", async () => {
    const f = await fixture(); f.args.target = "https://user:private@example.invalid"; await expect(f.run()).rejects.toThrow(); expect(f.rpc).not.toHaveBeenCalled(); expect(io.before).not.toHaveBeenCalled();
  });
  it("honors cancellation before claiming", async () => {
    const f = await fixture(); f.controller.abort(); await expect(f.run()).rejects.toThrow(); expect(f.rpc).not.toHaveBeenCalled(); expect(io.before).not.toHaveBeenCalled();
  });
  it("preserves persisted outcome when interrupted before finish", async () => {
    const f = await fixture(); io.after.mockImplementation(async (_directory, value) => { if (value.phase === "outcome") f.controller.abort(); });
    await expect(f.run()).rejects.toThrow(); expect((await f.journal()).phase).toBe("outcome"); expect(f.rpc).toHaveBeenCalledTimes(1);
    io.after.mockReset(); f.args.signal = new AbortController().signal; await f.run(); expect(f.prepare).toHaveBeenCalledTimes(1);
  });
});
