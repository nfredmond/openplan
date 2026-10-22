// @vitest-environment node
import { createServer, type Server } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ target: "", failFactory: false, factories: 0, fakeRows: null as Array<Record<string, unknown>> | null }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => {
  state.factories++;
  if (state.failFactory) throw new Error("private-provider-sentinel");
  if (state.fakeRows) return { rpc: (_name: string, row: Record<string, unknown>) => ({
    abortSignal: (_signal: AbortSignal) => { state.fakeRows?.push(row); return Promise.resolve({ data: true, error: null }); },
  }) };
  return createClient(state.target, "synthetic-observation-key", { auth: { persistSession: false, autoRefreshToken: false } });
} }));
const { observeNodeQueue } = await import("@/lib/ops/node-queue-observation");
const servers: Server[] = [];
const argv = process.argv;
const nativeSetTimeout = setTimeout, nativeClearTimeout = clearTimeout;
type Row = { p_worker_kind: string; p_instance: string; p_sequence: number; p_state: string; p_build_sha: string | null };

afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); process.argv = argv;
  state.failFactory = false; state.factories = 0; state.fakeRows = null;
  for (const server of servers.splice(0)) {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

async function fixture(mode: "reply" | "stall-first" | "reject" | "false" | "stall-stop" = "reply") {
  process.argv = [argv[0], "synthetic-worker.ts"];
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", ""); vi.stubEnv("OPENPLAN_COMMIT_SHA", "a".repeat(40));
  let warned!: () => void; const warning = new Promise<void>(resolve => { warned = resolve; });
  const warnings = vi.spyOn(console, "error").mockImplementation(() => { warned(); });
  const handlers = new Map<string, () => void>();
  vi.spyOn(process, "on").mockImplementation(((event: string, handler: () => void) => {
    if (event === "SIGINT" || event === "SIGTERM") handlers.set(event, handler);
    return process;
  }) as typeof process.on);
  const removed: string[] = [];
  vi.spyOn(process, "off").mockImplementation(((event: string) => { removed.push(event); handlers.delete(event); return process; }) as typeof process.off);
  const rows: Row[] = [];
  const targets: Array<{ path: string | undefined; method: string | undefined }> = [];
  let arrived!: () => void, closed!: () => void, stopped!: () => void;
  const started = new Promise<void>(resolve => { arrived = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const stoppedStarted = new Promise<void>(resolve => { stopped = resolve; });
  const server = createServer((request, response) => {
    targets.push({ path: request.url, method: request.method });
    let raw = ""; request.on("data", chunk => { raw += chunk; });
    request.on("end", () => {
      rows.push(JSON.parse(raw)); if (rows.at(-1)?.p_state === "stopped") stopped(); response.setHeader("Content-Type", "application/json"); arrived();
      if ((mode === "stall-first" && rows.length === 1) || (mode === "stall-stop" && rows.at(-1)?.p_state === "stopped")) {
        response.on("close", () => { if (!response.writableEnded) closed(); }); return;
      }
      if (mode === "reject") { response.statusCode = 503; response.end('{"message":"private-provider-sentinel"}'); }
      else response.end(mode === "false" ? "false" : "true");
    });
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned observation fixture has no port");
  state.target = `http://127.0.0.1:${address.port}`;
  return { rows, targets, started, stoppedStarted, disconnected, handlers, removed, warnings, warning, close: () => server.closeAllConnections() };
}

async function mustClose(operation: Promise<void>, reason: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([operation, new Promise<never>((_, reject) => { timer = nativeSetTimeout(() => reject(new Error(reason)), 1500); })]); }
  finally { nativeClearTimeout(timer); }
}

async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); }

describe("Node queue process observation", () => {
  it("preserves work and records one original instance then stopped", async () => {
    const f = await fixture(); const intervals = vi.spyOn(globalThis, "setInterval");
    const result = await observeNodeQueue("engagement-email", async () => {
      await f.started;
      const timer = intervals.mock.results[0]?.value as ReturnType<typeof setInterval>;
      expect(timer.hasRef(), "Diagnostic timer cannot keep the worker alive").toBe(false);
      return "retained-result";
    });
    expect(result, "Observation must preserve work result").toBe("retained-result");
    expect(f.rows.map(row => [row.p_worker_kind, row.p_sequence, row.p_state]), "Process states keep original ordering")
      .toEqual([["engagement-email", 1, "running"], ["engagement-email", 2, "stopped"]]);
    expect(f.targets, "Observation must use its dedicated POST RPC").toEqual([
      { path: "/rest/v1/rpc/record_node_queue_process_observation", method: "POST" },
      { path: "/rest/v1/rpc/record_node_queue_process_observation", method: "POST" },
    ]);
    expect(new Set(f.rows.map(row => row.p_instance)).size, "Original process identity cannot change").toBe(1);
    expect(Object.keys(f.rows[0]).sort(), "Observation carries only operational fields").toEqual(
      ["p_worker_kind", "p_instance", "p_sequence", "p_state", "p_build_sha"].sort());
    expect(f.rows[0].p_instance).toMatch(/^[a-f0-9-]{36}$/);
    expect(f.rows.every(row => row.p_build_sha === "a".repeat(40))).toBe(true);
    expect(f.handlers.size, "Observation cannot take ownership of process signals").toBe(0);
    expect(f.removed, "Observation cannot remove worker signal listeners").toEqual([]);
  });
  it("preserves work errors when diagnostic storage refuses", async () => {
    const f = await fixture("reject"); const failure = new Error("original-work-error");
    await expect(observeNodeQueue("document-exports", async () => { await f.started; await f.warning; throw failure; }), "Work error must retain its identity")
      .rejects.toBe(failure);
    expect(f.warnings).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.warnings.mock.calls), "Warnings cannot expose provider data").not.toContain("private-provider-sentinel");
  });
  it("runs work when the diagnostic client cannot be created", async () => {
    const f = await fixture(); state.failFactory = true;
    await expect(observeNodeQueue("provider-api", async noticeStopping => { noticeStopping(); return 17; }), "Unavailable observation cannot fail work").resolves.toBe(17);
    expect(f.rows).toEqual([]); expect(f.handlers.size).toBe(0);
    expect(JSON.stringify(f.warnings.mock.calls)).not.toContain("private-provider-sentinel");
  });
  it("skips observation for direct help", async () => {
    const f = await fixture(); process.argv.push("--help");
    await expect(observeNodeQueue("gtfs-ingestion", async noticeStopping => { noticeStopping(); return "help"; })).resolves.toBe("help");
    expect(state.factories, "Help cannot construct a diagnostic client").toBe(0); expect(f.rows).toEqual([]);
  });
  it("refuses an unsupported diagnostic kind without failing work", async () => {
    await fixture();
    await expect(observeNodeQueue("foreign" as "provider-api", async noticeStopping => { noticeStopping(); return 23; })).resolves.toBe(23);
    expect(state.factories, "Unsupported observation cannot construct its client").toBe(0);
  });
  it("closes an actual in-flight read on exit without warning about its own cancellation", async () => {
    const f = await fixture("stall-first");
    let release!: () => void; const released = new Promise<void>(resolve => { release = resolve; });
    const operation = observeNodeQueue("provider-api", async () => { await released; });
    let failure: unknown = null;
    try { await f.started; release(); await mustClose(f.disconnected, "Actual observation exit did not close SDK request"); }
    catch (error) { failure = error; }
    finally { release(); if (failure) f.close(); await operation; }
    expect(failure, "Actual observation exit must close promptly").toBeNull();
    expect(f.rows.at(-1)?.p_state).toBe("stopped");
    expect(f.warnings, "Own cancellation is not a diagnostic failure").not.toHaveBeenCalled();
  });
  it("keeps one active request while a heartbeat stalls", async () => {
    const f = await fixture("stall-first"); vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await observeNodeQueue("translation-generation", async () => {
      await f.started; await vi.advanceTimersByTimeAsync(90_000); await settle();
      expect(f.rows, "A stalled observation cannot queue overlapping writes").toHaveLength(1);
    });
    expect(f.rows).toHaveLength(2);
  });
  it("captures the client and build for the original process", async () => {
    const f = await fixture();
    await observeNodeQueue("synthesis-preparation", async () => {
      await f.started; state.target = "http://127.0.0.1:1"; vi.stubEnv("OPENPLAN_COMMIT_SHA", "b".repeat(40));
    });
    expect(state.factories, "Original process must keep one diagnostic client").toBe(1);
    expect(f.rows, "Changed environment cannot redirect the final observation").toHaveLength(2);
    expect(f.rows.every(row => row.p_build_sha === "a".repeat(40)), "Original build metadata remains captured").toBe(true);
  });
  it("treats an unaccepted RPC result as unavailable without changing work", async () => {
    const f = await fixture("false");
    await expect(observeNodeQueue("provider-api", async () => { await f.started; return 31; })).resolves.toBe(31);
    expect(f.warnings, "A false diagnostic receipt cannot imply acceptance").toHaveBeenCalledTimes(1);
  });
  it("does not let a failed diagnostic logger fail work", async () => {
    const f = await fixture(); state.failFactory = true;
    f.warnings.mockImplementation(() => { throw new Error("private-log-sentinel"); });
    let failure: unknown = null, result: unknown;
    try { result = await observeNodeQueue("provider-api", async () => 37); } catch (error) { failure = error; }
    expect(failure, "Diagnostic logging cannot fail work").toBeNull(); expect(result).toBe(37);
  });
  it("uses a new identity for a restarted observation", async () => {
    const f = await fixture();
    for (let count = 0; count < 2; count++) {
      await observeNodeQueue("provider-api", async () => { await f.started; });
    }
    expect(new Set(f.rows.filter(row => row.p_state === "stopped").map(row => row.p_instance)).size,
      "A restarted process cannot revive the old observation identity").toBe(2);
  });
  it("records stopping on the next pulse with an increasing sequence", async () => {
    await fixture(); state.fakeRows = [];
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await observeNodeQueue("synthesis-execution", async noticeStopping => {
      await settle(); noticeStopping();
      await vi.advanceTimersByTimeAsync(30_000); await settle();
    });
    expect(state.fakeRows.map(row => [row.p_state, row.p_sequence]), "Signal observations keep monotone process state")
      .toEqual([["running", 1], ["stopping", 2], ["stopped", 3]]);
    expect(vi.getTimerCount(), "Observer exit must clear its owned timer").toBe(0);
  });
  it("closes an actual stalled observation by its request deadline", async () => {
    const f = await fixture("stall-first"); let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const operation = observeNodeQueue("provider-api", async () => { await released; return 41; });
    let closedInBudget = false, deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await f.started;
      closedInBudget = await Promise.race([f.disconnected.then(() => true),
        new Promise<false>(resolve => { deadlineTimer = nativeSetTimeout(() => resolve(false), 4500); })]);
    } finally { nativeClearTimeout(deadlineTimer); release(); f.close(); await operation; }
    expect(closedInBudget, "Actual diagnostic deadline must close its SDK connection").toBe(true);
  });
  it("bounds the final stopped write and keeps its deadline failure visible", async () => {
    const f = await fixture("stall-stop");
    const operation = observeNodeQueue("provider-api", async () => { await f.started; return 47; });
    let closedInBudget = false, deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let result: unknown;
    try {
      await f.stoppedStarted;
      closedInBudget = await Promise.race([f.disconnected.then(() => true),
        new Promise<false>(resolve => { deadlineTimer = nativeSetTimeout(() => resolve(false), 4500); })]);
    } finally { nativeClearTimeout(deadlineTimer); f.close(); result = await operation; }
    expect(closedInBudget, "Final diagnostic deadline must close its SDK connection").toBe(true);
    expect(result, "Final diagnostic failure cannot replace the work result").toBe(47);
    expect(f.warnings, "Stopped observation deadline remains visible").toHaveBeenCalledTimes(1);
  });
  it("records an unknown build instead of persisting arbitrary environment text", async () => {
    const f = await fixture();
    for (const invalid of ["private-build-sentinel", "a".repeat(41), "a".repeat(6)]) {
      vi.stubEnv("OPENPLAN_COMMIT_SHA", invalid);
      await observeNodeQueue("contract-calculations", async () => { await f.started; });
    }
    expect(f.rows.every(row => row.p_build_sha === null), "Invalid build metadata must remain unrecorded").toBe(true);
  });
});
