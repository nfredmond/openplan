// @vitest-environment node
import { unobservedNodeQueues } from "./helpers/node-process-observation";
import { createServer, type Server } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ target: "", transports: [] as Array<typeof fetch | undefined> }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (options: { fetchImpl?: typeof fetch } = {}) => {
    state.transports.push(options.fetchImpl);
    return createClient(state.target, "synthetic-health-service-key", {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: options.fetchImpl },
    });
  },
}));
const { GET } = await import("@/app/api/health/deep/route");
const nativeSetTimeout = setTimeout;
const nativeClearTimeout = clearTimeout;
const servers: Server[] = [];
const token = "synthetic-health-operator";

afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); state.transports.length = 0;
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

async function fixture(stall?: "database" | "storage" | "processes") {
  const queries: Array<{ path: string; select: string | null }> = [];
  const rpcBodies: unknown[] = [];
  let entered!: () => void, closed!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://fixture.invalid");
    queries.push({ path: url.pathname, select: url.searchParams.get("select") });
    const kind = url.pathname === "/rest/v1/modeling_worker_heartbeats" ? "database"
      : url.pathname === "/storage/v1/bucket" ? "storage"
      : url.pathname === "/rest/v1/rpc/read_node_queue_process_observations" ? "processes" : null;
    response.setHeader("Content-Type", "application/json");
    if (!kind) { response.statusCode = 404; response.end("{}"); return; }
    const complete = () => {
      if (kind === stall) {
        response.on("close", () => { if (!response.writableEnded) closed(); });
        entered(); return;
      }
      response.end(kind === "processes" ? JSON.stringify(unobservedNodeQueues()) : "[]");
    };
    if (kind === "processes") {
      let body = ""; request.on("data", chunk => { body += chunk; });
      request.on("end", () => { rpcBodies.push(JSON.parse(body || "{}")); complete(); });
    } else complete();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Owned health fixture has no port");
  state.target = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("OPENPLAN_HEALTH_TOKEN", token);
  const ending = new AbortController();
  const request = new NextRequest("http://application.invalid/api/health/deep", {
    signal: ending.signal, headers: { authorization: `Bearer ${token}` },
  });
  return { queries, rpcBodies, started, disconnected, ending, request, run: () => GET(request) };
}

async function mustClose(disconnected: Promise<void>, reason: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([disconnected, new Promise<never>((_, reject) => {
      timer = nativeSetTimeout(() => reject(new Error(reason)), 1500);
    })]);
  } finally { nativeClearTimeout(timer); }
}

async function inheritedCancellation(useRequest: boolean) {
  const f = await fixture("database"); const response = f.run(); await f.started;
  const transport = state.transports[0];
  if (!transport) throw new Error("Health probe must configure actual SDK transport");
  const inherited = new AbortController(); inherited.abort(new Error("Inherited health request ended"));
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  try {
    const operation = useRequest
      ? transport(new Request(`${state.target}/extra`, { signal: inherited.signal }))
      : transport(`${state.target}/extra`, { signal: inherited.signal });
    const failure: unknown = await operation.then(() => null, (error: unknown) => error);
    expect(failure, "Inherited health cancellation cannot start another request").toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Inherited health request ended");
    expect(fetchSpy, "Active inherited cancellation cannot reach SDK fetch").not.toHaveBeenCalled();
  } finally { f.ending.abort(); await response; }
  expect(f.queries, "Inherited cancellation must preserve the one original request").toHaveLength(1);
}

async function deadlineCancellation(kind: "database" | "storage" | "processes") {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const f = await fixture(kind); const response = f.run(); await f.started;
  await vi.advanceTimersByTimeAsync(8000);
  expect((await response).status, "Health deadline must report the failed probe").toBe(503);
  await mustClose(f.disconnected, `Actual ${kind} deadline did not close SDK connection`);
}

describe("deep health actual SDK transport", () => {
  it("reads the exact heartbeat projection and Storage with distinct transports", async () => {
    const f = await fixture(); const response = await f.run();
    expect(response.status, "Actual health reads must succeed").toBe(200);
    expect(f.queries, "Actual health query projection differs").toEqual([
      { path: "/rest/v1/modeling_worker_heartbeats", select: "worker_kind,last_successful_heartbeat_at" },
      { path: "/storage/v1/bucket", select: null },
      { path: "/rest/v1/rpc/read_node_queue_process_observations", select: null },
    ]);
    expect(f.rpcBodies, "Node process reader must keep empty RPC parameters").toEqual([{}]);
    expect(state.transports, "Each probe needs its own SDK cancellation transport").toHaveLength(3);
    expect(new Set(state.transports).size, "Every health probe retains a separate transport").toBe(3);
  });
  it("refuses pre-cancelled probes before constructing a client", async () => {
    const f = await fixture(); f.ending.abort(new Error("Health caller ended"));
    expect((await f.run()).status).toBe(503);
    expect(state.transports, "Pre-cancelled health cannot construct an SDK client").toEqual([]);
    expect(f.queries).toEqual([]);
  });
  it("closes an actual read when its caller ends and starts no later probe", async () => {
    const f = await fixture("database"); const response = f.run(); await f.started;
    f.ending.abort(new Error("Health caller ended"));
    expect((await response).status).toBe(503);
    await mustClose(f.disconnected, "Actual caller cancellation did not close SDK connection");
    expect(state.transports, "Cancelled caller cannot start the Storage probe").toHaveLength(1);
    expect(f.queries).toHaveLength(1);
  });
  it("preserves inherited RequestInit cancellation", async () => inheritedCancellation(false));
  it("preserves inherited Request cancellation", async () => inheritedCancellation(true));
  it("refuses a retired probe before inspecting another request signal", async () => {
    const f = await fixture(); await f.run(); const transport = state.transports[0];
    if (!transport) throw new Error("Health probe must configure actual SDK transport");
    const options = { get signal(): AbortSignal { throw new Error("Retired probe inspected another signal"); } };
    await expect(transport(`${state.target}/extra`, options), "Retired probe must refuse before inspecting another signal")
      .rejects.toMatchObject({ name: "AbortError" });
    expect(f.queries).toHaveLength(3);
  });
  it("closes the actual database read at its deadline", async () => deadlineCancellation("database"));
  it("closes the actual Storage read at its deadline", async () => deadlineCancellation("storage"));
  it("closes the actual Node process read at its deadline", async () => deadlineCancellation("processes"));
});
