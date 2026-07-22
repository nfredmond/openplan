import { describe, expect, it } from "vitest";
import { reapStaleRuns, type ReaperClient, type ReaperRun } from "@/lib/models/run-reaper";
import { QUEUE_STALE_THRESHOLD_MS, RUN_STALE_THRESHOLD_MS } from "@/lib/models/run-liveness";

const NOW = 1_800_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60 * 1000;

interface RpcCall {
  fn: string;
  params: Record<string, unknown>;
}

/**
 * Mock client. Every stale run triggers one `reap_model_run_if_stale` RPC.
 * `rpcResult` lets a test simulate the atomic guard's outcome: `{ data: true }`
 * (reaped), `{ data: false }` (worker won the race), or `{ error }`.
 */
function makeClient(rpcResult: { data?: unknown; error?: unknown } = { data: true, error: null }) {
  const rpcCalls: RpcCall[] = [];
  const client: ReaperClient = {
    rpc(fn: string, params: Record<string, unknown>) {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: rpcResult.data ?? null, error: rpcResult.error ?? null });
    },
  };
  return { client, rpcCalls };
}

describe("reapStaleRuns", () => {
  it("reaps a crashed running run via the atomic RPC with the frozen stage heartbeat as the guard", async () => {
    const frozen = RUN_STALE_THRESHOLD_MS + 5 * MIN;
    const runs: ReaperRun[] = [
      {
        id: "run-crashed",
        status: "running",
        created_at: iso(frozen + 10 * MIN),
        updated_at: iso(frozen + 8 * MIN), // static run heartbeat (older than stage)
        stages: [{ status: "running", updated_at: iso(frozen) }],
      },
    ];

    const { client, rpcCalls } = makeClient({ data: true });
    const result = await reapStaleRuns(client, runs, NOW);

    expect(result.reapedRunIds).toEqual(["run-crashed"]);
    expect(result.details[0].liveness).toBe("stale_running");

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("reap_model_run_if_stale");
    expect(rpcCalls[0].params.p_run_id).toBe("run-crashed");
    // Guard uses the FRESHEST progress signal = the stage heartbeat, not the
    // (older, static) run.updated_at.
    expect(rpcCalls[0].params.p_stale_before).toBe(iso(frozen));
    expect(rpcCalls[0].params.p_message).toContain("crashed");
  });

  it("reaps a never-claimed queued run when the worker is offline", async () => {
    const runs: ReaperRun[] = [
      {
        id: "run-orphan",
        status: "queued",
        created_at: iso(QUEUE_STALE_THRESHOLD_MS + 3 * MIN),
        updated_at: iso(QUEUE_STALE_THRESHOLD_MS + 3 * MIN),
        stages: [{ status: "queued" }, { status: "queued" }, { status: "queued" }],
      },
    ];

    const { client, rpcCalls } = makeClient({ data: true });
    const result = await reapStaleRuns(client, runs, NOW);

    expect(result.reapedRunIds).toEqual(["run-orphan"]);
    expect(result.details[0].liveness).toBe("stale_queued");
    expect(rpcCalls[0].params.p_message).toContain("offline");
  });

  it("does not touch a queued run when a workerLikelyAlive override is passed (busy elsewhere)", async () => {
    const runs: ReaperRun[] = [
      {
        id: "run-waiting",
        status: "queued",
        created_at: iso(QUEUE_STALE_THRESHOLD_MS + 3 * MIN),
        updated_at: iso(QUEUE_STALE_THRESHOLD_MS + 3 * MIN),
      },
    ];

    const { client, rpcCalls } = makeClient({ data: true });
    const result = await reapStaleRuns(client, runs, NOW, { workerLikelyAlive: true });

    expect(result.reapedRunIds).toEqual([]);
    expect(rpcCalls).toHaveLength(0);
  });

  it("does not count a run as reaped when the RPC returns false (worker won the race)", async () => {
    const runs: ReaperRun[] = [
      {
        id: "run-just-claimed",
        status: "queued",
        created_at: iso(QUEUE_STALE_THRESHOLD_MS + 3 * MIN),
        updated_at: iso(QUEUE_STALE_THRESHOLD_MS + 3 * MIN),
      },
    ];

    const { client, rpcCalls } = makeClient({ data: false });
    const result = await reapStaleRuns(client, runs, NOW);

    expect(result.reapedRunIds).toEqual([]);
    expect(rpcCalls).toHaveLength(1); // the RPC WAS attempted...
    expect(result.details).toEqual([]); // ...but it re-validated and no-oped.
  });

  it("does not count a run as reaped when the RPC errors", async () => {
    const frozen = RUN_STALE_THRESHOLD_MS + 5 * MIN;
    const runs: ReaperRun[] = [
      {
        id: "run-raced",
        status: "running",
        created_at: iso(frozen + 10 * MIN),
        updated_at: iso(frozen),
        stages: [{ status: "running", updated_at: iso(frozen) }],
      },
    ];

    const { client } = makeClient({ error: { message: "db error" } });
    const result = await reapStaleRuns(client, runs, NOW);

    expect(result.reapedRunIds).toEqual([]);
  });

  it("leaves progressing and terminal runs untouched (no RPC calls)", async () => {
    const runs: ReaperRun[] = [
      { id: "run-live", status: "running", updated_at: iso(1 * MIN), stages: [{ status: "running", updated_at: iso(1 * MIN) }] },
      { id: "run-done", status: "succeeded", updated_at: iso(120 * MIN) },
    ];

    const { client, rpcCalls } = makeClient({ data: true });
    const result = await reapStaleRuns(client, runs, NOW);

    expect(result.reapedRunIds).toEqual([]);
    expect(result.scanned).toBe(2);
    expect(rpcCalls).toHaveLength(0);
  });
});
